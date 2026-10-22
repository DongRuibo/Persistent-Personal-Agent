import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { OperationGuard } from '../src/operation-guard.js';
import type { DialogueReferences } from '../src/operation-guard.js';
import { GoalService } from '../src/goal-service.js';
import type { GoalDisplay } from '../src/goal-service.js';
import type { ExecutionRequest, MessageTarget } from '../src/contracts.js';
import type { Goal, GoalResult } from '../src/goal-types.js';

const start = '2026-10-22T03:00:00.000Z';
const step = { title: '练习', instruction: '出题', deliverable: '一道题', doneWhen: '已交付' };
const result: GoalResult = { stepOutcome: 'complete', artifactText: '虚构初步计划', progressSummary: '待审批', question: '是否批准计划？', proposedPlan: { steps: [step], changeReason: '初始计划' } };
function fixture() {
  const store = new SqliteStore(':memory:'); let now = new Date(start);
  const tasks = new TaskService(store, 'Asia/Shanghai', () => now);
  const interrupted: string[] = [], goals = new GoalService(store, tasks, id => { interrupted.push(id); });
  const state: DialogueReferences = {};
  let value: unknown, parseCalls = 0;
  const guard = new OperationGuard(tasks, undefined, async () => { parseCalls++; return value; }, state);
  const execute = async (prompt: string, intent: Record<string, unknown>, delivered = true, target: MessageTarget = { channel: 'console' }) => {
    value = { action: 'goal_manage', mode: 'request', evidence: prompt, ...intent };
    const run = store.beginRun(null, now.toISOString());
    const request: ExecutionRequest = { prompt, scope: 'chat', signal: new AbortController().signal, source: { channel: target.channel, reference: run.id }, observer: store.observer(run.id) };
    try {
      const response = await tasks.withTarget(target, () => guard.withRequest(request, async () => { await guard.manageGoals(goals); return { text: '模型口头成功不能覆盖宿主' }; }));
      store.finishRun(run.id, 'succeeded', now.toISOString(), response.text);
      if (delivered) store.event(run.id, 'delivery_succeeded');
      return { ...response, run };
    } catch (error) { store.finishRun(run.id, 'failed', now.toISOString(), undefined, String(error)); throw error; }
  };
  const create = async (name = '面试准备') => { await execute(`帮我逐步${name}`, { goalAction: 'create' }); return goals.list()[0]!; };
  const bootstrap = (goal: Goal) => { const claimed = store.goals.claim(goals.actor(), goal.id, goal.revision, now.toISOString())!; store.goals.commit(claimed.run.id, result, now.toISOString()); return goals.get(goal.id); };
  const view = (word = '面试') => execute(`查看${word}目标进度`, { goalAction: 'view', mode: 'query', selector: { keywords: [word] } });
  return { store, tasks, goals, guard, state, execute, create, bootstrap, view, interrupted,
    get parseCalls() { return parseCalls; }, advance() { now = new Date(now.getTime() + 300001); }, close() { store.close(); } };
}

test('自然创建保留原话、查询只读，模型不能把普通事实/否定/引用/自动推进变成权限', async () => {
  const f = fixture();
  try {
    for (const prompt of ['我在准备面试', '帮我自动持续准备面试', '如果帮我逐步准备面试', '他说“帮我逐步准备面试”', '不要帮我逐步准备面试']) {
      await f.execute(prompt, { goalAction: 'create' }).catch(() => {});
      assert.equal(f.goals.list().length, 0);
    }
    const goal = await f.create(); assert.equal(goal.objective, '帮我逐步面试准备');
    const before = f.goals.get(goal.id); await f.view(); assert.deepEqual(f.goals.get(goal.id), before);
    assert.equal(f.store.listTasks().length, 0);
  } finally { f.close(); }
});

test('多目标必须澄清；独立序号检查、旧版本、过期/未投递和跨渠道清单不授权', async () => {
  const f = fixture();
  const pause = { goalAction: 'pause', selector: { keywords: ['面试'] } };
  try {
    const first = await f.create('面试准备甲'), second = await f.create('面试准备乙');
    assert.match((await f.execute('暂停面试任务', pause)).text, /多个可能目标/);
    await f.execute('第二个', { goalAction: 'pause', selector: { reference: 'choice', position: 1, keywords: [] } });
    assert.equal(f.goals.get(first.id).status, 'ready'); assert.equal(f.goals.get(second.id).status, 'ready');
    await f.execute('第二个', { goalAction: 'pause', selector: { reference: 'choice', position: 2, keywords: [] } });
    assert.equal(f.goals.get(first.id).status, 'paused'); assert.equal(f.goals.get(second.id).status, 'ready');
    await f.execute('查看面试目标', { goalAction: 'list', mode: 'query', selector: { keywords: ['面试'] } }, false);
    await assert.rejects(f.execute('第二个', { goalAction: 'cancel', selector: { reference: 'choice', position: 2, keywords: [] } }), /投递/);
    await f.view(); f.advance();
    await assert.rejects(f.execute('第二个', { goalAction: 'cancel', selector: { reference: 'choice', position: 2, keywords: [] } }), /过期/);
    await f.view();
    await assert.rejects(f.execute('第二个', { goalAction: 'cancel', selector: { reference: 'choice', position: 2, keywords: [] } }, true,
      { channel: 'feishu', appId: 'fake-app', chatId: 'fake-chat', userOpenId: 'fake-user' }), /无权/);
  } finally { f.close(); }
});

test('计划必须成功显示并绑定Hash/版本；短确认只批准，不被模型扩大为执行；继续不能跳过审批', async () => {
  const f = fixture();
  try {
    let goal = f.bootstrap(await f.create());
    await f.view();
    await assert.rejects(f.execute('继续之前的面试准备任务', { goalAction: 'continue', selector: { keywords: ['面试'] } }), /计划/);
    await f.view(); const before = f.parseCalls;
    await f.execute('确认', { goalAction: 'approve_plan', executeNext: true });
    assert.equal(f.parseCalls, before, '有效短确认不额外解析');
    goal = f.goals.get(goal.id); assert.equal(goal.planRevision, 1); assert.equal(goal.status, 'waiting_user'); assert.equal(goal.readyInput, null);
    await f.execute('继续之前的面试准备任务', { goalAction: 'continue', selector: { keywords: ['面试'] } });
    assert.equal(f.goals.get(goal.id).status, 'ready');
  } finally { f.close(); }
});

test('列表只显示标题不能批准隐藏草稿；明确批准并继续只授权一次，重复提议和并发跨工具共享Frame', async () => {
  const f = fixture();
  try {
    const one = f.bootstrap(await f.create('面试甲')), two = f.bootstrap(await f.create('面试乙'));
    await f.view();
    const response = await f.execute('批准第一个计划并继续一段', { goalAction: 'approve_plan', executeNext: true, selector: { keywords: [], reference: 'choice', position: 1 } });
    assert.match(response.text, /先核对/); assert.equal(f.goals.get(two.id).planRevision, 0);
    await f.execute('批准刚才的计划并继续一段', { goalAction: 'approve_plan', executeNext: true, selector: { keywords: [], reference: 'last' } });
    assert.equal(f.goals.get(two.id).status, 'ready'); assert.equal(f.goals.get(one.id).planRevision, 0);
    const run = f.store.beginRun(null, start);
    const request: ExecutionRequest = { prompt: '查看目标', scope: 'chat', signal: new AbortController().signal, source: { channel: 'console', reference: run.id }, observer: f.store.observer(run.id) };
    await f.guard.withRequest(request, async () => {
      // 解析进行中也已占用同一Frame；另一个家族的工具不能抢权限。
      const first = f.guard.manageGoals(f.goals);
      await assert.rejects(f.guard.perform('create_task', {}, () => assert.fail('不能执行')), /消费/);
      await first.catch(() => {});
      await assert.rejects(f.guard.manageGoals(f.goals), /消费/);
      return { text: '结束' };
    });
    assert.equal(f.store.listTasks().length, 0);
  } finally { f.close(); }
});

test('计划增补草稿撤销ready、保留旧版；批准才切换；运行中调整先暂停并阻止旧结果', async () => {
  const f = fixture();
  try {
    let goal = f.bootstrap(await f.create()); await f.view();
    await f.execute('批准面试计划并继续一段', { goalAction: 'approve_plan', selector: { keywords: ['面试'] }, executeNext: true });
    await f.execute('面试计划先补Agent Loop', { goalAction: 'revise_plan', selector: { keywords: ['面试'] }, bodyEvidence: 'Agent Loop', revisionMode: 'prepend' });
    goal = f.goals.get(goal.id); assert.equal(goal.status, 'waiting_user'); assert.equal(goal.readyInput, null); assert.equal(goal.planRevision, 1);
    assert.equal(goal.pendingAction?.spec.steps[0]?.title, 'Agent Loop');
    await f.execute('批准面试计划并继续一段', { goalAction: 'approve_plan', selector: { keywords: ['面试'] }, executeNext: true });
    goal = f.goals.get(goal.id); assert.equal(goal.planRevision, 2);
    const claimed = f.store.goals.claim(f.goals.actor(), goal.id, goal.revision, start)!;
    await f.execute('面试计划先补TypeScript', { goalAction: 'revise_plan', selector: { keywords: ['面试'] }, bodyEvidence: 'TypeScript', revisionMode: 'prepend' });
    assert.equal(f.interrupted.at(-1), goal.id); assert.equal(f.goals.get(goal.id).controlRequested, 'pause');
    f.store.goals.commit(claimed.run.id, { ...result, proposedPlan: undefined }, start);
    assert.equal(f.goals.get(goal.id).status, 'paused'); assert.equal(f.goals.get(goal.id).pendingAction?.spec.steps[0]?.title, 'TypeScript');
    assert.equal(f.store.goals.executionForHost(claimed.run.id).status, 'discarded');
  } finally { f.close(); }
});

test('完成要求明确确认并已交付计划；失败阻塞普通继续无效、明确重新生成才有新授权', async () => {
  const f = fixture();
  try {
    let goal = f.bootstrap(await f.create()); await f.view();
    await f.execute('批准面试计划并继续一段', { goalAction: 'approve_plan', selector: { keywords: ['面试'] }, executeNext: true });
    goal = f.goals.get(goal.id);
    let claimed = f.store.goals.claim(f.goals.actor(), goal.id, goal.revision, start)!;
    f.store.goals.finishFailure(claimed.run.id, 'failed', '模拟模型失败', start);
    await assert.rejects(f.execute('继续面试任务', { goalAction: 'continue', selector: { keywords: ['面试'] } }), /重新生成/);
    await f.execute('重新生成面试任务这一段', { goalAction: 'continue', regenerate: true, selector: { keywords: ['面试'] } });
    goal = f.goals.get(goal.id); claimed = f.store.goals.claim(f.goals.actor(), goal.id, goal.revision, start)!;
    f.store.goals.commit(claimed.run.id, { ...result, proposedPlan: undefined }, start); await f.view();
    await assert.rejects(f.execute('面试任务不用做了', { goalAction: 'complete', selector: { keywords: ['面试'] } }), /明确|授权/);
    await f.execute('确认面试目标已完成', { goalAction: 'complete', selector: { keywords: ['面试'] } });
    assert.equal(f.goals.get(goal.id).status, 'completed');
  } finally { f.close(); }
});

test('通知等待期间计划变化：只登记实际发送的旧版本，不能把新草稿冒充已展示', async () => {
  const f = fixture(); let displayed: GoalDisplay | undefined;
  f.goals.setDisplaySink(view => { displayed = view; });
  try {
    const old = f.bootstrap(await f.create()), runId = old.checkpointRunId!;
    f.store.event(runId, 'delivery_succeeded');
    f.store.goals.proposePlan({ actor: f.goals.actor(), sourceRunId: f.store.beginRun(null, start).id, expectedRevision: old.revision, text: '先补新内容' }, old.id,
      { steps: [{ ...step, title: '用户尚未看见的新计划' }], changeReason: '明确调整' }, start);
    f.goals.displayed(old, runId);
    assert.equal(displayed?.items[0]?.revision, old.revision);
    assert.throws(() => f.goals.validateDisplay(displayed!, true), /版本/);
  } finally { f.close(); }
});
