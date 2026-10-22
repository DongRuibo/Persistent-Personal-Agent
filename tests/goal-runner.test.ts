import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { BackgroundLane } from '../src/background-lane.js';
import { GoalRunner } from '../src/goal-runner.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskScheduler } from '../src/scheduler.js';
import { readConfig } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { TaskService } from '../src/task-service.js';
import { FileMemoryService } from '../src/memory-service.js';
import type { AgentExecutor, ExecutionRequest } from '../src/contracts.js';
import type { GoalActor, GoalResult } from '../src/goal-types.js';
import { sseText } from './helpers/intent-stub.js';

const now = '2026-10-22T03:00:00.000Z';
const actor: GoalActor = { ownerId: 'local-user', target: { channel: 'console' } };
const result: GoalResult = { stepOutcome: 'complete', artifactText: '虚构计划成果', progressSummary: '计划待批准', question: '是否批准？',
  proposedPlan: { changeReason: '初始计划', steps: [{ title: '练习问答', instruction: '出一道题', deliverable: '一道题', doneWhen: '题目已交付' }] } };
function fixture(execute: AgentExecutor['execute']) {
  const root = mkdtempSync(join(tmpdir(), 'goal-runner-'));
  const store = new SqliteStore(join(root, 'app.db')), lane = new BackgroundLane();
  let calls = 0, fatal = 0;
  const executor: AgentExecutor = { execute: request => { calls++; return execute(request); }, close: async () => {} };
  const messages: string[] = [], errors: unknown[] = [];
  const runner = new GoalRunner(store, executor, { sendMessage: async message => { messages.push(message.text); } }, lane,
    { ownerId: actor.ownerId, accepts: target => target.channel === 'console', pollIntervalMs: 5, reportError: error => { errors.push(error); }, fatal: () => { fatal++; } }, () => new Date(now));
  const goal = store.goals.create(actor, store.beginRun(null, now).id, '虚构面试准备', now);
  return { root, store, lane, runner, executor, goal, messages, errors, get calls() { return calls; }, get fatal() { return fatal; },
    async close() { await runner.stop(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('Runner 一次授权只执行一段；等用户、投递失败和重复 tick 不重跑', async () => {
  const f = fixture(async () => ({ text: JSON.stringify(result) }));
  try {
    await Promise.all([f.runner.tick(), f.runner.tick()]);
    const view = f.store.goals.view(actor, f.goal.id);
    assert.equal(view.goal.status, 'waiting_user'); assert.equal(view.executions.length, 1);
    assert.equal(view.executions[0]?.execution.status, 'committed'); assert.equal(f.calls, 1);
    f.store.deliveryFailed(view.executions[0]!.run.id, '模拟通知丢失');
    await f.runner.tick(); assert.equal(f.calls, 1); assert.equal(f.messages.length, 1);
  } finally { await f.close(); }
});

test('真实结果22/30回放：自编Step ID或缺必填字段均不提交，保留旧Checkpoint；新步骤ID由宿主生成', async () => {
  const raw = readFileSync(new URL('./fixtures/v3-goal-live-step-id-result.json', import.meta.url), 'utf8');
  let text = JSON.stringify({ ...result, stepOutcome: 'partial', proposedPlan: undefined });
  const f = fixture(async () => ({ text }));
  const authorize = (regenerate = false) => {
    const goal = f.store.goals.get(actor, f.goal.id);
    f.store.goals.continue({ actor, sourceRunId: f.store.beginRun(null, now).id, expectedRevision: goal.revision,
      text: regenerate ? '重新生成纯文本片段' : '继续一段' }, goal.id, now, regenerate);
  };
  try {
    await f.runner.tick(); const checkpoint = f.store.goals.get(actor, f.goal.id).checkpointRunId;
    text = raw; authorize(); await f.runner.tick(); await f.runner.tick();
    let view = f.store.goals.view(actor, f.goal.id);
    assert.equal(view.goal.status, 'blocked'); assert.equal(view.goal.checkpointRunId, checkpoint);
    assert.equal(view.goal.pendingAction, null); assert.equal(view.executions[1]?.execution.status, 'failed');
    assert.equal(f.calls, 2);
    text = readFileSync(new URL('./fixtures/v3-goal-live-missing-fields-result.json', import.meta.url), 'utf8');
    authorize(true); await f.runner.tick();
    view = f.store.goals.view(actor, f.goal.id);
    assert.equal(view.goal.status, 'blocked'); assert.equal(view.goal.checkpointRunId, checkpoint);
    assert.match(view.executions[2]!.run.error!, /Schema/); assert.equal(f.calls, 3);
    // 仅离线构造符合契约的对照，不修改原真实响应，也不把它当真实模型复验。
    const corrected = JSON.parse(raw) as GoalResult;
    for (const step of corrected.proposedPlan!.steps) delete step.stepId;
    text = JSON.stringify(corrected); authorize(true); await f.runner.tick();
    view = f.store.goals.view(actor, f.goal.id);
    assert.equal(view.goal.status, 'waiting_user'); assert.equal(view.checkpoint?.previousCheckpointRunId, checkpoint);
    assert.equal(view.goal.pendingAction?.spec.steps.length, 2);
    assert.ok(view.goal.pendingAction?.spec.steps.every(step => /^[0-9a-f-]{36}$/u.test(step.stepId)));
  } finally { await f.close(); }
});

for (const action of ['pause', 'cancel'] as const) test(`Runner ${action} 先持久化再abort；不响应取消的迟到结果不提交`, async () => {
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = fixture(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return { text: JSON.stringify(result) }; });
  try {
    const work = f.runner.tick(); await started;
    const running = f.store.goals.get(actor, f.goal.id);
    f.store.goals.control({ actor, sourceRunId: f.store.beginRun(null, now).id, expectedRevision: running.revision, text: action }, running.id, action, now);
    f.runner.interrupt(running.id);
    assert.equal(f.store.goals.get(actor, f.goal.id).status, 'running');
    await f.runner.tick(); assert.equal(f.calls, 1);
    release(); await work;
    const view = f.store.goals.view(actor, f.goal.id);
    assert.equal(view.goal.status, action === 'pause' ? 'paused' : 'cancelled'); assert.equal(view.checkpoint, null);
    assert.equal(view.executions[0]?.execution.status, 'interrupted');
    await f.runner.tick(); assert.equal(f.calls, 1);
  } finally { await f.close(); }
});

test('Checkpoint事务失败先重读后阻塞，提交已成功但回执异常采用成果；不能重读则停机', async (t) => {
  for (const mode of ['rollback', 'ack', 'unreadable'] as const) {
    const f = fixture(async () => ({ text: JSON.stringify(result) }));
    const original = f.store.goals.commit.bind(f.store.goals);
    t.mock.method(f.store.goals, 'commit', (...args: Parameters<typeof original>) => {
      if (mode === 'ack') original(...args);
      throw new Error('模拟 COMMIT 异常');
    });
    if (mode === 'unreadable') t.mock.method(f.store.goals, 'executionForHost', () => { throw new Error('模拟数据库不可读'); });
    try {
      await f.runner.tick(); await f.runner.tick(); assert.equal(f.calls, 1);
      const view = f.store.goals.view(actor, f.goal.id);
      assert.equal(view.goal.status, mode === 'ack' ? 'waiting_user' : mode === 'rollback' ? 'blocked' : 'running');
      assert.equal(f.fatal, mode === 'unreadable' ? 1 : 0);
    } finally { t.mock.restoreAll(); await f.close(); }
  }
});

test('非法JSON/字段扩权/非法计划/超预算都阻塞，无自动修JSON或模型重试', async () => {
  for (const text of ['not-json', JSON.stringify({ ...result, status: 'completed' }), JSON.stringify({ ...result, proposedPlan: { steps: [], changeReason: '非法' } })]) {
    const f = fixture(async () => ({ text }));
    try { await f.runner.tick(); await f.runner.tick(); assert.equal(f.calls, 1); assert.equal(f.store.goals.get(actor, f.goal.id).status, 'blocked'); } finally { await f.close(); }
  }
  const f = fixture(async () => ({ text: JSON.stringify(result) }));
  try {
    f.store.goals.control({ actor, sourceRunId: f.store.beginRun(null, now).id, expectedRevision: 0, text: '暂停' }, f.goal.id, 'cancel', now);
    const goal = f.store.goals.create(actor, f.store.beginRun(null, now).id, '大'.repeat(2000), now);
    await f.runner.tick(); assert.equal(f.calls, 0); assert.equal(f.store.goals.get(actor, goal.id).status, 'blocked');
  } finally { await f.close(); }
});

test('真实SQLite提交故障整体回滚后失败，不留下半个Checkpoint', async () => {
  const f = fixture(async () => ({ text: JSON.stringify(result) }));
  const raw = new DatabaseSync(join(f.root, 'app.db'));
  try {
    raw.exec("CREATE TRIGGER fail_cp BEFORE INSERT ON run_events WHEN NEW.type='goal_checkpoint_committed' BEGIN SELECT RAISE(ABORT,'故障夹具'); END");
    await f.runner.tick(); const view = f.store.goals.view(actor, f.goal.id);
    assert.equal(view.goal.status, 'blocked'); assert.equal(view.checkpoint, null); assert.equal(view.executions[0]?.run.status, 'failed');
  } finally { raw.close(); await f.close(); }
});

test('后台门：旧Task优先、Goal等待前台、执行互斥；stop等待手动tick完成', async () => {
  let release!: () => void;
  const f = fixture(async request => {
    if (request.scope === 'task') return { text: '旧任务结果' };
    await new Promise<void>(resolve => { release = resolve; request.signal.addEventListener('abort', () => resolve(), { once: true }); });
    return { text: JSON.stringify(result) };
  });
  const task = f.store.createTask('旧任务', now, now);
  const scheduler = new TaskScheduler(f.store, f.executor, { sendMessage: async () => {} }, 5, () => {}, () => new Date(now), f.lane);
  try {
    await f.runner.tick(); assert.equal(f.calls, 0); await scheduler.tick(); assert.equal(f.store.getTask(task.id)?.status, 'succeeded');
    const releaseForeground = f.lane.foreground(); await f.runner.tick(); assert.equal(f.calls, 1); releaseForeground();
    const work = f.runner.tick(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.store.goals.get(actor, f.goal.id).status, 'running');
    await scheduler.tick(); const stopping = f.runner.stop(); await stopping; await work;
    assert.equal(f.store.goals.get(actor, f.goal.id).status, 'blocked'); release();
  } finally { await scheduler.stop(); await f.close(); }
});

test('真实Pi SDK+模拟模型：Goal无工具、只读Memory、独立新Session和settled；等待重开库不调用模型', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'goal-pi-'));
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), GOAL_ENABLED: 'true', LLM_API_KEY: 'fake-goal-key', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'https://example.invalid/v1' });
  let store = new SqliteStore(config.databasePath), calls = 0;
  const memory = new FileMemoryService(config.memoryDir);
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)); calls++; requests.push(JSON.stringify(payload));
    assert.equal(payload.tools?.length ?? 0, 0);
    assert.equal(payload.messages.filter((item: { role: string }) => item.role === 'user').length, 1);
    return new Response(sseText(JSON.stringify(result)));
  });
  const tasks = new TaskService(store, config.timeZone);
  const executor = await createPiExecutor(config, tasks, 'goal-pi-test', memory);
  const makeRunner = () => new GoalRunner(store, executor, { sendMessage: async () => {} }, new BackgroundLane(),
    { ownerId: actor.ownerId, accepts: () => true, pollIntervalMs: 5, reportError: () => {}, fatal: () => { assert.fail('不应停机'); } });
  let runner = makeRunner();
  try {
    const goal = store.goals.create(actor, store.beginRun(null, now).id, 'GOAL_PRIVATE_MARKER 虚构面试', now);
    await runner.tick(); const view = store.goals.view(actor, goal.id);
    assert.equal(view.goal.status, 'waiting_user'); assert.ok(store.events(view.executions[0]!.run.id).some(event => event.type === 'agent_settled'));
    await runner.stop(); store.close(); store = new SqliteStore(config.databasePath); store.recoverInterrupted(now); runner = makeRunner();
    await runner.tick(); assert.equal(calls, 1); assert.equal(store.goals.view(actor, goal.id).checkpoint?.artifactText, result.artifactText);
    assert.equal(memory.listForHost().length, 0); assert.equal(store.listTasks().length, 0); assert.equal(requests.length, 1);
  } finally { await runner.stop(); await executor.close(); memory.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('真实Pi故障：HTTP500/非法JSON/截断/非法工具不重试，Memory预检和领取后Context损坏均关闭失败', async (t) => {
  for (const mode of ['http', 'json', 'length', 'tool', 'memory-before', 'memory-context'] as const) {
    const root = mkdtempSync(join(tmpdir(), 'goal-pi-fault-'));
    const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), GOAL_ENABLED: 'true', LLM_API_KEY: 'fake-goal-fault-key', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'https://example.invalid/v1', EXECUTION_TIMEOUT_MS: '500' });
    const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
    let calls = 0;
    t.mock.method(globalThis, 'fetch', async () => {
      calls++;
      if (mode === 'http') return new Response(JSON.stringify({ error: { message: '模拟失败' } }), { status: 500 });
      if (mode === 'length' || mode === 'tool') {
        const delta = mode === 'tool' ? { role: 'assistant', tool_calls: [{ index: 0, id: 'forbidden', type: 'function', function: { name: 'create_task', arguments: '{}' } }] } : { role: 'assistant', content: '截断' };
        return new Response(`data: ${JSON.stringify({ id: 'bad', model: 'local-stub', choices: [{ index: 0, delta, finish_reason: mode === 'tool' ? 'tool_calls' : 'length' }] })}\n\ndata: [DONE]\n\n`);
      }
      return new Response(sseText(mode === 'json' ? 'invalid' : JSON.stringify(result)));
    });
    const executor = await createPiExecutor(config, tasks, 'goal-fault-test', memory);
    const runner = new GoalRunner(store, executor, { sendMessage: async () => {} }, new BackgroundLane(),
      { ownerId: actor.ownerId, accepts: () => true, pollIntervalMs: 10, reportError: () => {}, fatal: () => {} });
    try {
      const goal = store.goals.create(actor, store.beginRun(null, now).id, '虚构目标', now);
      if (mode === 'memory-before') t.mock.method(memory, 'repair', () => { throw new Error('领取前故障'); });
      if (mode === 'memory-context') t.mock.method(memory, 'buildContext', () => { throw new Error('领取后Context损坏'); });
      await runner.tick(); await runner.tick();
      assert.equal(calls, mode === 'memory-before' || mode === 'memory-context' ? 0 : 1, mode);
      assert.equal(store.goals.get(actor, goal.id).status, mode === 'memory-before' ? 'ready' : 'blocked', mode);
      t.mock.restoreAll(); assert.equal(store.listTasks().length, 0); assert.equal(memory.listForHost().length, 0);
    } finally { t.mock.restoreAll(); await runner.stop(); await executor.close(); memory.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
  }
});
