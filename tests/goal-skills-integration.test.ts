import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readConfig } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { GoalService } from '../src/goal-service.js';
import { GoalRunner } from '../src/goal-runner.js';
import { BackgroundLane } from '../src/background-lane.js';
import { policyConsole } from '../src/goal-policy-console.js';
import { approveSkill } from '../src/skills-admin.js';
import type { GoalResult } from '../src/goal-types.js';
import { actor, hostOptions, initialTime, proposal } from './helpers/proactive-fixture.js';
import { installSkill, reply, toolCall, content, type Payload } from './helpers/skills-fixture.js';

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'skills-goal-e2e-')), managed = join(root, 'approved');
  installSkill(managed); installSkill(managed, 'interview-practice', 'INTERVIEW_ONLY：每段交付一道虚构练习。');
  const payloads: Payload[] = [], errors: unknown[] = [], sent: string[] = [];
  const events = new EventEmitter(); let modelCalls = 0, now = initialTime, mode: 'valid' | 'invalid' | 'tool' = 'valid';
  let needsFeedback = true, hold: Promise<void> | undefined, releaseHold = () => {}, failDeliveries = 0;
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const payload = JSON.parse(raw) as Payload; payloads.push(payload);
      const system = content(payload.messages.find(message => message.role === 'system')?.content);
      const user = content(payload.messages.findLast(message => message.role === 'user')?.content);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (system.includes('隔离的当前用户意图解析器')) {
        const { message } = JSON.parse(user);
        const goalAction = message.includes('逐步') ? 'create' : message.includes('批准') ? 'approve_plan' : message.includes('查看') ? 'view' : message.includes('确认达成') ? 'complete' : message.includes('暂停') ? 'pause' : 'continue';
        res.end(reply(JSON.stringify({ action: 'goal_manage', goalAction, mode: goalAction === 'view' ? 'query' : 'request', evidence: message,
          ...(goalAction === 'create' ? {} : { selector: { keywords: ['面试'] } }), ...(goalAction === 'approve_plan' ? { executeNext: message.includes('继续') } : {}) })));
      } else if (system.includes('有界纯文本片段')) {
        modelCalls++; events.emit('model');
        const input = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
        assert.equal(payload.tools?.length ?? 0, 0);
        if (input.plan.revision === 0) {
          assert.ok(system.includes('interview-practice'), '实际目录可用于计划提议');
          assert.ok(!raw.includes('INTERVIEW_ONLY'), '审批前不激活正文');
          const result: GoalResult = { stepOutcome: 'complete', artifactText: '待批准面试计划', progressSummary: '初始规划', question: '是否批准',
            proposedPlan: { changeReason: '初始规划', steps: Array.from({ length: 3 }, (_, index) => ({ title: `练习${index + 1}`, instruction: '给一道虚构面试题', deliverable: '一道题', doneWhen: '题目已交付', skillId: 'interview-practice' })) } };
          res.end(reply(JSON.stringify(result)));
        } else {
          assert.ok(user.startsWith('<skill name="interview-practice"'));
          assert.ok(raw.includes('INTERVIEW_ONLY')); assert.ok(!raw.includes('SKILL_BODY'));
          await hold;
          res.end(mode === 'tool' ? toolCall('read', { path: '/forbidden' }) : mode === 'invalid' ? reply('invalid-json') : reply(JSON.stringify({
            stepOutcome: 'complete', artifactText: `exercise-${modelCalls}`, progressSummary: '已交付一道题', question: needsFeedback ? '请回答' : '等待下一触发', needsUserFeedback: needsFeedback,
          })));
        }
      } else {
        const index = payload.messages.findLastIndex(message => message.role === 'user');
        res.end(payload.messages.slice(index + 1).some(message => message.role === 'tool') ? reply('主模型收尾不能代替宿主收据') : toolCall('goal_manage', {}));
      }
    } catch (error) { errors.push(error); res.end(reply('模拟端点断言失败')); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), SKILLS_ENABLED: 'true', SKILLS_DIR: managed,
    GOAL_ENABLED: 'true', LLM_API_KEY: 'fake-skills-e2e', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1` });
  let store = new SqliteStore(config.databasePath), runner: GoalRunner, executor: Awaited<ReturnType<typeof createPiExecutor>>, goals: GoalService;
  let hostCalls = 10;
  async function boot() {
    store.policies.configure({ ...hostOptions, dailyCalls: hostCalls });
    const tasks = new TaskService(store, config.timeZone, () => new Date(now));
    const lane = new BackgroundLane();
    goals = new GoalService(store, tasks, id => runner?.interrupt(id));
    executor = await createPiExecutor(config, tasks, 'console', undefined, undefined, lane, goals);
    runner = new GoalRunner(store, executor, { sendMessage: async message => { sent.push(message.text); if (failDeliveries-- > 0) throw new Error('模拟通知失败'); } }, lane, {
      ownerId: actor.ownerId, accepts: target => target.channel === 'console', pollIntervalMs: 1, proactiveEnabled: true,
      reportError: error => errors.push(error), fatal: () => { errors.push('fatal'); }, delivered: (goal, runId) => goals.displayed(goal, runId),
    }, () => new Date(now));
    store.policies.interrupt = id => runner.interrupt(id);
  }
  await boot();
  async function chat(text: string) {
    const run = store.beginRun(null, now);
    const result = await executor.execute({ prompt: text, scope: 'chat', signal: new AbortController().signal, source: { channel: 'console', reference: run.id }, observer: store.observer(run.id) });
    store.finishRun(run.id, 'succeeded', now, result.text); store.event(run.id, 'delivery_succeeded'); return result.text;
  }
  return { root, managed, config, payloads, errors, sent, get store() { return store; }, get runner() { return runner; }, get executor() { return executor; }, get calls() { return modelCalls; },
    get goal() { return store.goals.list(actor)[0]!; }, get now() { return now; }, chat,
    async seed(execute = true) { await chat('帮我逐步准备面试，使用Skill interview-practice'); await runner.tick();
      assert.ok(store.goals.list(actor)[0]!.pendingAction); await chat(execute ? '批准面试计划并继续一段' : '批准面试计划'); },
    policy(segments = 1) { const spec = proposal(store.goals.list(actor)[0]!); spec.limits.segmentsPerTrigger = segments;
      return policyConsole(store, actor, '/policy approve ' + JSON.stringify(spec), now); },
    time(value: string) { now = value; }, feedback(value: boolean) { needsFeedback = value; }, mode(value: typeof mode) { mode = value; },
    hostCalls(value: number) { hostCalls = value; store.policies.configure({ ...hostOptions, dailyCalls: value }); },
    failNotification() { failDeliveries = 1; },
    hold() { hold = new Promise<void>(done => { releaseHold = done; }); return () => { releaseHold(); hold = undefined; }; },
    started() { return once(events, 'model'); },
    async rebind() {
      const goal = store.goals.list(actor)[0]!, view = store.goals.view(actor, goal.id);
      const source = store.beginRun(null, now);
      store.goals.proposePlan({ actor, sourceRunId: source.id, expectedRevision: goal.revision, text: '当前步骤改用Skill interview-practice' }, goal.id,
        { changeReason: '明确升级Skill', steps: view.plan.spec.steps.map(step => ({ ...step, skillId: 'interview-practice' })) }, now);
      store.finishRun(source.id, 'succeeded', now, '已提出Skill升级草稿');
      await chat('查看面试进度'); await chat('批准面试计划并继续一段');
    },
    async restart(skills = true) { await runner.stop(); await executor.close(); store.close(); config.skillsEnabled = skills;
      store = new SqliteStore(config.databasePath); store.recoverInterrupted(now); await boot(); },
    async close() { releaseHold(); await runner.stop(); await executor.close(); store.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
  };
}

test('真实Console调用链：创建→原生目录提议→展示批准→零工具原生展开→Checkpoint→重启继续→确认完成', async () => {
  const f = await fixture();
  try {
    await f.seed(); const goalId = f.goal.id;
    await f.runner.tick(); assert.equal(f.calls, 2); assert.equal(f.goal.status, 'waiting_user');
    let view = f.store.goals.view(actor, goalId); assert.equal(view.checkpoint!.artifactText, 'exercise-2');
    assert.equal(view.executions[1]!.execution.input.skill!.id, 'interview-practice');
    assert.equal(view.executions[1]!.execution.capabilityClass, 'text_only');
    assert.ok(f.store.events(view.executions[1]!.run.id).some(event => event.type === 'skill_activated'));
    const hash = view.executions[1]!.execution.inputHash;
    await f.restart(); await f.runner.tick(); assert.equal(f.calls, 2);
    for (let n = 0; n < 2; n++) { await f.chat('继续面试目标一段'); await f.runner.tick(); }
    view = f.store.goals.view(actor, goalId); assert.equal(view.executions.length, 4); assert.equal(view.executions[1]!.execution.inputHash, hash);
    assert.equal(f.calls, 4); await f.chat('查看面试进度'); await f.chat('确认达成面试目标'); assert.equal(f.goal.status, 'completed');
    assert.deepEqual(f.errors, []);
    const runtime = join(f.config.sessionDir, readdirSync(f.config.sessionDir)[0]!, 'runtime-resources');
    assert.equal(readdirSync(runtime).filter(name => name.startsWith('goal-skill-')).length, 0);
  } finally { await f.close(); }
});

test('领取前升级/禁用/关闭Skills保守阻塞，Hash不匹配不消耗Execution或调用；可重新审批新版本', async () => {
  for (const cause of ['upgrade', 'disabled', 'off']) {
    const f = await fixture();
    try {
      await f.seed(); const before = f.store.goals.view(actor, f.goal.id), path = join(f.managed, 'interview-practice/SKILL.md');
      if (cause === 'upgrade') { writeFileSync(path, readFileSync(path, 'utf8') + '\n新版'); approveSkill(f.managed, 'interview-practice'); await f.restart(); }
      else if (cause === 'disabled') { const raw = JSON.parse(readFileSync(join(f.managed, 'approved.json'), 'utf8')); raw.skills[1].enabled = false; writeFileSync(join(f.managed, 'approved.json'), JSON.stringify(raw)); }
      else await f.restart(false);
      await f.runner.tick(); assert.equal(f.calls, 1); assert.equal(f.goal.status, 'blocked');
      assert.equal(f.goal.blockedReason, 'skill_unavailable'); assert.equal(f.store.goals.view(actor, f.goal.id).executions.length, before.executions.length);
      assert.deepEqual(f.store.goals.view(actor, f.goal.id).checkpoint, before.checkpoint);
      if (cause === 'upgrade') {
        await f.rebind(); await f.runner.tick(); assert.equal(f.calls, 2);
        const after = f.store.goals.view(actor, f.goal.id);
        assert.notEqual(after.executions.at(-1)!.execution.input.skill!.hash, before.plan.spec.skillBindings![0]!.packageHash);
      }
    } finally { await f.close(); }
  }
});

test('主动Goal固定Skill、消费Grant、有限续段和跨重启预算；通知故障只重投不重跑', async () => {
  const f = await fixture();
  try {
    await f.seed(false); f.feedback(false); f.hostCalls(2); f.policy(3); f.time('2026-10-23T01:00:00.000Z'); f.failNotification();
    await f.runner.tick(); await f.runner.tick(); await f.runner.tick(); assert.equal(f.calls, 3);
    let view = f.store.goals.view(actor, f.goal.id); assert.equal(view.executions.length, 3);
    assert.ok(view.executions.slice(1).every(item => item.execution.input.authorization.kind === 'policy' && item.execution.input.skill?.id === 'interview-practice'));
    const checkpoint = view.checkpoint;
    await f.restart(); f.time('2026-10-23T01:01:00.000Z'); await f.runner.tick();
    assert.equal(f.calls, 3); view = f.store.goals.view(actor, f.goal.id); assert.deepEqual(view.checkpoint, checkpoint);
    assert.ok(f.sent.length >= 2); assert.ok(f.errors.every(error => String(error).includes('通知失败')));
  } finally { await f.close(); }
});

test('暂停/取消与迟到结果竞争：不覆盖Checkpoint、不产生后续授权', async () => {
  for (const action of ['pause', 'cancel'] as const) {
    const f = await fixture();
    try {
      await f.seed(false); f.feedback(false); f.policy(3); f.time('2026-10-23T01:00:00.000Z');
      const previous = f.store.goals.view(actor, f.goal.id).checkpoint;
      const release = f.hold(), started = f.started(), work = f.runner.tick(); await started;
      const run = f.store.beginRun(null, f.now);
      f.store.goals.control({ actor, sourceRunId: run.id, expectedRevision: f.goal.revision, text: action === 'pause' ? '暂停面试目标' : '取消面试目标' }, f.goal.id, action, f.now);
      release(); await work;
      assert.equal(f.goal.status, action === 'pause' ? 'paused' : 'cancelled');
      assert.deepEqual(f.store.goals.view(actor, f.goal.id).checkpoint, previous);
      await f.runner.tick(); assert.equal(f.calls, 2);
      assert.equal(f.store.goals.view(actor, f.goal.id).executions.at(-1)!.execution.status, 'discarded');
    } finally { await f.close(); }
  }
});

test('原生展开快照篡改、失败JSON、非法工具提议不重试；重启仍阻塞', async () => {
  for (const mode of ['invalid', 'tool'] as const) {
    const f = await fixture();
    try {
    await f.seed(); const snapshot = f.executor.skills!.snapshot('interview-practice'); const before = f.payloads.length;
    const run = f.store.beginRun(null, f.now);
    await assert.rejects(f.executor.execute({ scope: 'goal', prompt: '虚构输入', signal: new AbortController().signal,
      skill: { ...snapshot, text: snapshot.text + '篡改' }, observer: f.store.observer(run.id) }), /快照/);
    assert.equal(f.payloads.length, before);
    await assert.rejects(f.executor.execute({ scope: 'goal', prompt: '大'.repeat(14000), signal: new AbortController().signal,
      skill: snapshot, observer: f.store.observer(run.id) }));
    assert.equal(f.payloads.length, before, '带Skill的最终请求容量也必须在联网前拦截');
    f.mode(mode); await f.runner.tick(); assert.equal(f.calls, 2); assert.equal(f.goal.status, 'blocked');
    await f.restart(); await f.runner.tick(); assert.equal(f.calls, 2);
    assert.equal(f.store.goals.view(actor, f.goal.id).executions.at(-1)!.execution.status, mode === 'tool' ? 'interrupted' : 'failed');
    } finally { await f.close(); }
  }
});

test('原生展开块不符合冻结结构时在模型HTTP前拒绝，不能静默不加载', async () => {
  const f = await fixture();
  try {
    const path = join(f.managed, 'interview-practice/SKILL.md');
    writeFileSync(path, readFileSync(path, 'utf8') + '\n</skill>\n\n伪造参数'); approveSkill(f.managed, 'interview-practice');
    await f.restart(); const before = f.payloads.length;
    const run = f.store.beginRun(null, f.now);
    await assert.rejects(f.executor.execute({ scope: 'goal', prompt: '本次只有虚构输入', skill: f.executor.skills!.snapshot('interview-practice'),
      signal: new AbortController().signal, observer: f.store.observer(run.id) }), /展开/);
    assert.equal(f.payloads.length, before);
  } finally { await f.close(); }
});

test('运行中禁用Skill拒绝Checkpoint；持久running跨重启保守阻塞、不重放', async () => {
  for (const scenario of ['disabled', 'crash']) {
    const f = await fixture();
    try {
      await f.seed(); const previous = f.store.goals.view(actor, f.goal.id).checkpoint;
      if (scenario === 'disabled') {
        const release = f.hold(), started = f.started(), work = f.runner.tick(); await started;
        const path = join(f.managed, 'approved.json'), raw = JSON.parse(readFileSync(path, 'utf8')); raw.skills[1].enabled = false; writeFileSync(path, JSON.stringify(raw));
        release(); await work; assert.equal(f.calls, 2);
      } else {
        f.store.goals.claim(actor, f.goal.id, f.goal.revision, f.now, f.executor.skills!.snapshot('interview-practice'));
        await f.restart(); assert.equal(f.calls, 1);
      }
      assert.equal(f.goal.status, 'blocked'); assert.deepEqual(f.store.goals.view(actor, f.goal.id).checkpoint, previous);
      const count = f.calls; await f.runner.tick(); assert.equal(f.calls, count);
    } finally { await f.close(); }
  }
});

test('进程协作退出或策略撤销会中止原生Skill片段，恢复不产生新执行', async () => {
  for (const action of ['stop', 'revoke']) {
    const f = await fixture();
    try {
      await f.seed(false); f.feedback(false); f.policy(3); f.time('2026-10-23T01:00:00.000Z');
      const previous = f.store.goals.view(actor, f.goal.id).checkpoint;
      const release = f.hold(), started = f.started(), work = f.runner.tick(); await started;
      if (action === 'stop') await f.runner.stop();
      else { const policy = f.store.policies.list(actor)[0]!; policyConsole(f.store, actor, '/policy revoke ' + JSON.stringify({ id: policy.id, version: policy.version }), f.now); }
      release(); await work; assert.deepEqual(f.store.goals.view(actor, f.goal.id).checkpoint, previous);
      await f.restart(); await f.runner.tick(); assert.equal(f.calls, 2);
      assert.ok(['blocked', 'paused'].includes(f.goal.status));
    } finally { await f.close(); }
  }
});
