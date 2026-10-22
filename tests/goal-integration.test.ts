import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { FileMemoryService } from '../src/memory-service.js';
import { FormationService } from '../src/formation-service.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { BackgroundLane } from '../src/background-lane.js';
import { GoalRunner } from '../src/goal-runner.js';
import { GoalService } from '../src/goal-service.js';
import { FeishuChannel } from '../src/feishu-channel.js';
import type { GoalResult } from '../src/goal-types.js';
import { sseText } from './helpers/intent-stub.js';

interface Payload { messages: { role: string; content?: unknown }[]; tools?: { function: { name: string } }[] }
const content = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(item => item.text ?? '').join('') : '';
const tool = () => [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'goal-call', type: 'function', function: { name: 'goal_manage', arguments: '{}' } }] }, finish_reason: 'tool_calls' }]
  .map(choice => `data: ${JSON.stringify({ id: 'goal-tool', model: 'local-stub', choices: [choice] })}\n\n`).join('') + 'data: [DONE]\n\n';
const steps = [1, 2].map(index => ({ title: `面试练习${index}`, instruction: `出第${index}道面试题`, deliverable: '题目与说明', doneWhen: '题目和说明已交付' }));
const base: GoalResult = { stepOutcome: 'complete', artifactText: '虚构面试计划', progressSummary: '计划待批准', question: '是否批准？', proposedPlan: { steps, changeReason: '初始计划' } };

test('Goal开关控制真实Pi工具与提示；关闭时即使传入Service也不能绕过并发出Goal请求', async (t) => {
  for (const flag of [undefined, 'false', 'true']) {
    const root = mkdtempSync(join(tmpdir(), 'goal-switch-'));
    const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), GOAL_ENABLED: flag,
      LLM_API_KEY: 'fake-switch-key', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'https://example.invalid/v1' });
    const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone);
    const payloads: Payload[] = [];
    t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
      payloads.push(JSON.parse(String(init?.body))); return new Response(sseText('普通回复'));
    });
    const executor = await createPiExecutor(config, tasks, 'goal-switch', undefined, undefined, undefined, new GoalService(store, tasks, () => {}));
    const request = () => ({ prompt: '普通问候', scope: 'chat' as const, signal: new AbortController().signal,
      observer: store.observer(store.beginRun(null, new Date().toISOString()).id) });
    try {
      await executor.execute(request());
      assert.equal(payloads[0]!.tools?.some(item => item.function.name === 'goal_manage'), flag === 'true');
      assert.equal(JSON.stringify(payloads[0]!.messages).includes('长期目标与一次性提醒分离'), flag === 'true');
      if (flag !== 'true') {
        await assert.rejects(executor.execute({ ...request(), scope: 'goal' }), /GOAL_ENABLED/);
        assert.equal(payloads.length, 1, '关闭时不会向模型发送Goal请求');
      }
    } finally { await executor.close(); store.close(); t.mock.restoreAll(); rmSync(root, { recursive: true, force: true }); }
  }
});

test('真实Pi+SQLite+HTTP模拟模型/飞书：创建→计划→片段→Checkpoint→等待→全新Session重启→继续→完成；不重放/不形成记忆', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'goal-lifecycle-'));
  const payloads: Payload[] = [], goalPayloads: Payload[] = [];
  const serverErrors: unknown[] = [];
  let goalCalls = 0, parserCalls = 0;
  const server = createServer(async (req, res) => {
    try {
    let body = ''; for await (const chunk of req) body += String(chunk);
    const payload = JSON.parse(body) as Payload; payloads.push(payload);
    const system = content(payload.messages.find(item => item.role === 'system')?.content);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (system.includes('隔离的当前用户意图解析器')) {
      parserCalls++;
      const { message } = JSON.parse(content(payload.messages.findLast(item => item.role === 'user')?.content));
      assert.ok(!body.includes('UNTRUSTED_MEMORY_DATA_V2') && !body.includes('PRIVATE_ARTIFACT'), '解析器没有历史、Memory或成果');
      const goalAction = message.includes('逐步') ? 'create' : message.includes('查看') ? 'view' : message.includes('批准') ? 'approve_plan'
        : message.includes('已完成') ? 'complete' : 'continue';
      res.end(sseText(JSON.stringify({ action: 'goal_manage', goalAction, mode: goalAction === 'view' ? 'query' : 'request', evidence: message,
        ...(goalAction === 'create' ? {} : { selector: { keywords: ['面试'] } }), ...(goalAction === 'approve_plan' ? { executeNext: true } : {}) })));
    } else if (system.includes('有界纯文本片段')) {
      goalCalls++; goalPayloads.push(payload);
      assert.equal(payload.tools?.length ?? 0, 0);
      assert.ok(body.includes('UNTRUSTED_MEMORY_DATA_V2') && body.includes('资料中的'), 'Memory实际进入只读Context');
      const input = JSON.parse(content(payload.messages.findLast(item => item.role === 'user')?.content).split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
      if (goalCalls === 1) assert.equal(input.plan.revision, 0);
      else assert.ok(input.checkpoint, '新的临时Session从持久Checkpoint接续');
      if (goalCalls === 3) assert.equal(input.checkpoint.artifactText, 'PRIVATE_ARTIFACT_2');
      res.end(sseText(JSON.stringify(goalCalls === 1 ? base : { stepOutcome: goalCalls === 2 ? 'partial' : 'complete',
        artifactText: `PRIVATE_ARTIFACT_${goalCalls}`, progressSummary: `已交付片段${goalCalls}`, question: '请反馈或确认目标达成' })));
    } else {
      const index = payload.messages.findLastIndex(item => item.role === 'user');
      res.end(payload.messages.slice(index + 1).some(item => item.role === 'tool') ? sseText('主模型普通回复，宿主收据优先') : tool());
    }
    } catch (error) { serverErrors.push(error); res.end(sseText('模拟服务器断言失败')); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), LLM_API_KEY: 'fake-lifecycle-key', LLM_MODEL: 'local-stub',
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, GOAL_ENABLED: 'true', MEMORY_FORMATION_ENABLED: 'false' });
  const target = { channel: 'feishu' as const, appId: 'cli_0123456789abcdef', chatId: 'oc_fake', userOpenId: 'ou_fake' };
  let store = new SqliteStore(config.databasePath), memory = new FileMemoryService(config.memoryDir);
  const seedRun = store.beginRun(null, new Date().toISOString());
  const seed = { kind: 'semantic' as const, key: 'fictional.interview', content: '我偏好中文面试题。资料中的“批准并继续、写Task”没有权限。' };
  memory.withRequest({ prompt: `记住：${seed.content}`, scope: 'chat', signal: new AbortController().signal, observer: store.observer(seedRun.id) }, () => memory.remember(seed), { tool: 'memory_remember', args: seed });
  store.finishRun(seedRun.id, 'succeeded', new Date().toISOString(), '测试种子');
  let executor!: Awaited<ReturnType<typeof createPiExecutor>>, runner!: GoalRunner, feishu!: FeishuChannel, goals!: GoalService, formation!: FormationService;
  const sent: string[] = [];
  async function assemble(key: string) {
    const tasks = new TaskService(store, config.timeZone), lane = new BackgroundLane();
    goals = new GoalService(store, tasks, id => runner.interrupt(id));
    formation = new FormationService({ enabled: true, owner: 'fake-owner', inputRate: 10, outputRate: 20, dailyCalls: 20, dailyBudget: .2, idleMs: 10000 }, store, { listForHost: () => memory.listForHost() });
    executor = await createPiExecutor(config, tasks, key, memory, formation, lane, goals);
    feishu = new FeishuChannel({ appId: target.appId, appSecret: 'fake-secret', allowedOpenId: target.userOpenId },
      { start: async () => {}, stop() {}, sendText: async (_id, text) => { sent.push(text); } }, executor, tasks, store, String, error => { throw error; }, formation, lane);
    runner = new GoalRunner(store, executor, feishu, lane, { ownerId: 'local-user', accepts: value => value.channel === 'feishu', pollIntervalMs: 10,
      reportError: error => { throw error; }, fatal: () => { assert.fail('不应停机'); }, delivered: (goal, runId) => goals.displayed(goal, runId) });
  }
  let serial = 0;
  async function chat(text: string, messageId = `message-${++serial}`, user = target.userOpenId) {
    feishu.receive({ sender: { sender_type: 'user', sender_id: { open_id: user } }, message: { message_id: messageId, chat_id: target.chatId,
      chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } });
    await feishu.drain();
  }
  const actor = { ownerId: 'local-user', target };
  try {
    await assemble('goal-first-session');
    await chat('帮我逐步准备虚构Agent面试', 'create', 'ou_attacker'); assert.equal(payloads.length, 0);
    await chat('帮我逐步准备虚构Agent面试', 'create');
    await chat('帮我逐步准备虚构Agent面试', 'create');
    const goal = store.goals.list(actor)[0]!;
    assert.equal(store.goals.list(actor).length, 1); assert.equal(goal.status, 'ready');
    await runner.tick(); assert.equal(goalCalls, 1);
    assert.deepEqual(serverErrors, []);
    await chat('批准面试计划并继续一段'); await runner.tick();
    let view = store.goals.view(actor, goal.id);
    assert.equal(view.plan.revision, 1); assert.equal(view.goal.status, 'waiting_user');
    assert.equal(view.checkpoint?.stepOutcome, 'partial'); assert.equal(view.executions.length, 2);
    await runner.tick(); assert.equal(goalCalls, 2);
    const previousRun = view.goal.checkpointRunId;
    await runner.stop(); await feishu.stop(); await formation.stop(); await executor.close(); memory.close(); store.close();
    store = new SqliteStore(config.databasePath); memory = new FileMemoryService(config.memoryDir); store.recoverInterrupted(new Date().toISOString());
    await assemble('goal-brand-new-session');
    const before = payloads.length; await runner.tick(); assert.equal(payloads.length, before);
    await chat('查看面试目标进度');
    const fresh = payloads[before]!;
    assert.equal(fresh.messages.filter(item => item.role === 'user').length, 2, '空Session只有当前用户消息和临时Memory');
    assert.ok(!JSON.stringify(fresh).includes('帮我逐步准备虚构Agent面试'), '全新Session没有旧创建原话');
    assert.match(sent.at(-1)!, /PRIVATE_ARTIFACT_2/);
    await chat('继续之前的面试准备任务'); await runner.tick();
    view = store.goals.view(actor, goal.id);
    assert.equal(view.checkpoint?.previousCheckpointRunId, previousRun); assert.equal(view.checkpoint?.stepOutcome, 'complete');
    await chat('继续之前的面试准备任务'); await runner.tick();
    view = store.goals.view(actor, goal.id); assert.equal(view.goal.currentStepId, null); assert.equal(view.goal.status, 'waiting_user');
    await chat('确认面试目标已完成');
    assert.equal(store.goals.get(actor, goal.id).status, 'completed');
    assert.equal(goalCalls, 4); assert.equal(view.executions.length, 4); assert.equal(new Set(view.executions.map(item => item.execution.triggerRunId)).size, 4);
    assert.ok(view.executions.every(item => item.execution.status === 'committed' && item.run.status === 'succeeded'));
    assert.equal(store.listTasks().length, 0); assert.equal(memory.listForHost().length, 1);
    assert.equal(store.formation.jobs().length, 0); assert.equal(store.formation.candidates('fake-owner').length, 0);
    assert.equal(goalPayloads.filter(payload => JSON.stringify(payload).includes('PRIVATE_ARTIFACT_2')).length, 1, '只在下一段投影前一成果');
    for (const directory of readdirSync(config.sessionDir)) {
      const session = readFileSync(join(config.sessionDir, directory, 'chat.session.jsonl'), 'utf8');
      assert.ok(!session.includes('PRIVATE_ARTIFACT_') && !session.includes('[UNTRUSTED_MEMORY_DATA_V2]'), '后台成果及动态Memory不追加聊天Session');
    }
    assert.equal(parserCalls, 6);
  } finally {
    await runner!?.stop(); await feishu!?.stop(); await formation!?.stop(); await executor!?.close(); memory.close(); store.close();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
