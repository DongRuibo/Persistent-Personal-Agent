import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { policyConsole } from '../src/goal-policy-console.js';
import { actor, approve, fixture, hostOptions, initialTime, proposal, seedGoal } from './helpers/proactive-fixture.js';

const noFeedback = { stepOutcome: 'complete' as const, artifactText: '虚构阶段摘要', progressSummary: '本段完成', question: '无需反馈，等待策略后续触发', needsUserFeedback: false };
test('场景C：多触发/有界续段，每段独立Pi与Checkpoint，跨重启达到全局/策略次数上限停止', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store, initialTime, 8), spec = proposal(goal);
    spec.limits = { ...spec.limits, segmentsPerTrigger: 2, dailyExecutions: 2, totalExecutions: 3 };
    const policy = approve(f.store, spec); f.result(noFeedback);
    f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick(); assert.equal(f.calls, 1);
    assert.equal(f.store.goals.get(actor, goal.id).status, 'ready');
    await f.runner.tick(); await f.runner.tick(); assert.equal(f.calls, 2);
    assert.equal(f.store.goals.get(actor, goal.id).status, 'waiting_user');
    const checkpoint = f.store.goals.get(actor, goal.id).checkpointRunId;
    await f.restart(); await f.runner.tick(); assert.equal(f.calls, 2);
    f.time('2026-10-24T01:00:00.000Z'); await f.runner.tick(); await f.runner.tick(); await f.runner.tick();
    assert.equal(f.calls, 3); assert.equal(f.store.policies.get(actor, policy.id).status, 'blocked');
    const view = f.store.goals.view(actor, goal.id);
    assert.equal(view.checkpoint?.previousCheckpointRunId, checkpoint); assert.equal(view.executions.length, 4);
    assert.equal(view.goal.status, 'waiting_user'); assert.equal(view.goal.readyInput, null);
    const grants = f.store.policies.audit(actor, policy.id).grants as { consumedAt: string | null; reserveCny: number }[];
    assert.equal(grants.filter(g => g.consumedAt).length, 3); assert.ok(grants.filter(g => g.consumedAt).every(g => g.reserveCny > 0));
    assert.equal(f.payloads.length, 3); assert.ok(f.payloads.every(p => (p as { tools?: unknown[] }).tools?.length === undefined));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('金额不足/未知费率保守阻塞；宿主全局限额跨Goal且重启保留', async () => {
  const f = await fixture();
  try {
    f.store.policies.configure({ ...hostOptions, totalBudgetCny: 0.05 });
    const first = seedGoal(f.store), second = seedGoal(f.store);
    const p1 = approve(f.store, proposal(first)), p2 = approve(f.store, proposal(second));
    f.result({ ...noFeedback, needsUserFeedback: true }); f.time('2026-10-23T01:00:00.000Z');
    await f.runner.tick(); await f.runner.tick();
    assert.equal(f.calls, 1);
    assert.equal([f.store.policies.get(actor, p1.id), f.store.policies.get(actor, p2.id)].filter(p => p.status === 'blocked').length, 1);
    await f.restart(); await f.runner.tick(); assert.equal(f.calls, 1);
  } finally { await f.close(); }
});

test('运行中用户暂停/取消/计划修改/撤销：迟到结果不覆盖旧进度，不产生后续策略授权', async () => {
  for (const action of ['pause', 'cancel', 'revise', 'revoke'] as const) {
    const f = await fixture(); let release = () => {};
    try {
      const goal = seedGoal(f.store), spec = proposal(goal); spec.limits.segmentsPerTrigger = 3;
      const policy = approve(f.store, spec), previous = goal.checkpointRunId;
      f.result(noFeedback); f.holdResponse(new Promise<void>(resolve => { release = resolve; })); f.time('2026-10-23T01:00:00.000Z');
      const running = f.runner.tick();
      while (f.calls === 0) await new Promise(resolve => setTimeout(resolve, 5));
      const current = f.store.goals.get(actor, goal.id);
      if (action === 'revoke') policyConsole(f.store, actor, `/policy revoke ${JSON.stringify({ id: policy.id, version: 1 })}`, '2026-10-23T01:00:00.000Z');
      else {
        const run = f.store.beginRun(null, initialTime), command = { actor, sourceRunId: run.id, expectedRevision: current.revision, text: action };
        if (action === 'revise') f.store.goals.proposePlan(command, goal.id, { changeReason: '用户修改', steps: [{ title: '新步骤', instruction: '新步骤', deliverable: '新文本', doneWhen: '已交付' }] }, initialTime);
        else f.store.goals.control(command, goal.id, action, initialTime);
        f.store.finishRun(run.id, 'succeeded', initialTime, '控制已提交');
      }
      release(); await running; await f.runner.tick();
      const view = f.store.goals.view(actor, goal.id); assert.equal(view.goal.checkpointRunId, previous);
      assert.equal(view.executions.at(-1)!.execution.status, 'discarded'); assert.equal(view.goal.readyInput, null);
      assert.equal(f.calls, 1); assert.equal(f.store.policies.audit(actor, policy.id).grants.length, 1);
      assert.equal(view.goal.status, action === 'cancel' ? 'cancelled' : 'paused');
    } finally { release(); await f.close(); }
  }
});

test('计划确认、partial、缺少反馈标志、blocked及失败不续段；已完成Step不重跑', async () => {
  for (const result of [{ ...noFeedback, needsUserFeedback: undefined }, { ...noFeedback, stepOutcome: 'partial' as const },
    { ...noFeedback, stepOutcome: 'blocked' as const, blockedReason: '需要权限' },
    { ...noFeedback, proposedPlan: { changeReason: '需要审批', steps: [{ title: '下一计划', instruction: '下一计划', deliverable: '文本', doneWhen: '完成' }] } }]) {
    const f = await fixture();
    try {
      const goal = seedGoal(f.store), spec = proposal(goal); spec.limits.segmentsPerTrigger = 5;
      const policy = approve(f.store, spec); f.result(result); f.time('2026-10-23T01:00:00.000Z');
      await f.runner.tick(); await f.runner.tick(); assert.equal(f.calls, 1);
      assert.equal(f.store.policies.get(actor, policy.id).status, 'paused');
      assert.equal(f.store.goals.get(actor, goal.id).readyInput, null);
    } finally { await f.close(); }
  }
});

test('Outbox：提交后投递失败/重启只重发通知，有限重试；成功确认丢失允许重复但不重跑Pi', async () => {
  const f = await fixture();
  try {
    approve(f.store, proposal(seedGoal(f.store))); f.failDelivery(2); f.time('2026-10-23T01:00:00.000Z');
    await f.runner.tick(); assert.equal(f.calls, 1); assert.equal(f.sent.length, 1);
    await f.restart(); await f.runner.tick(); assert.equal(f.sent.length, 1);
    f.time('2026-10-23T01:00:30.000Z'); await f.runner.tick(); assert.equal(f.sent.length, 2);
    f.time('2026-10-23T01:01:30.000Z'); await f.runner.tick(); assert.equal(f.sent.length, 3);
    assert.equal((f.store.notifications.listForHost()[0] as { status: string }).status, 'sent'); assert.equal(f.calls, 1);
    assert.equal(new Set(f.sent).size, 1);
  } finally { await f.close(); }
});

test('Outbox聚合事务故障整体回滚，恢复后无模型补交；sending恢复及第三次失败进入dead', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store); approve(f.store, proposal(goal));
    const db = new DatabaseSync(`${f.root}/app.db`);
    db.exec("CREATE TRIGGER fail_notice BEFORE INSERT ON goal_notifications BEGIN SELECT RAISE(ABORT,'injected_outbox_failure'); END");
    f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick(); assert.equal(f.calls, 1);
    assert.equal(f.store.goals.get(actor, goal.id).checkpointRunId, goal.checkpointRunId);
    assert.equal(f.store.notifications.listForHost().length, 0); assert.ok(f.errors.length > 0);
    db.exec('DROP TRIGGER fail_notice'); db.close(); await f.restart();
    f.failDelivery(10); await f.runner.tick();
    const recovery = new DatabaseSync(`${f.root}/app.db`); recovery.exec("UPDATE goal_notifications SET status='sending'"); recovery.close();
    await f.restart(); f.time('2026-10-23T01:00:30.000Z'); await f.runner.tick();
    f.time('2026-10-23T01:01:30.000Z'); await f.runner.tick(); f.time('2026-10-23T01:20:00.000Z'); await f.runner.tick();
    assert.equal((f.store.notifications.listForHost()[0] as { status: string }).status, 'dead'); assert.equal(f.calls, 1);
  } finally { await f.close(); }
});

test('Pi公开请求钩子在HTTP前拒绝超容量输入，不触发收费修复或第二请求', async () => {
  const f = await fixture();
  try {
    const run = f.store.beginRun(null, initialTime);
    await assert.rejects(f.executor.execute({ scope: 'goal', prompt: 'x'.repeat(40000), signal: new AbortController().signal, observer: f.store.observer(run.id) }));
    assert.equal(f.calls, 0);
  } finally { await f.close(); }
});

test('已有V3.0四表/Task/Run数据增量迁移，旧用户授权和已完成Step/Checkpoint可继续使用', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store), run = f.store.beginRun(null, initialTime);
    const before = f.store.goals.view(actor, goal.id);
    f.store.goals.continue({ actor, sourceRunId: run.id, text: '继续一段', expectedRevision: goal.revision }, goal.id, initialTime);
    f.store.finishRun(run.id, 'succeeded', initialTime, '用户授权');
    const task = f.store.createTask('旧一次性任务', '2027-01-01T00:00:00.000Z', initialTime);
    const db = new DatabaseSync(`${f.root}/app.db`);
    // 虚构临时库移除新表，构造只有原表和旧JSON的升级输入，不接触历史验收库。
    db.exec('PRAGMA foreign_keys=OFF; DROP TABLE goal_notifications; DROP TABLE goal_observations; DROP TABLE goal_observer_cursors; DROP TABLE goal_grants; DROP TABLE goal_triggers; DROP TABLE goal_policy_events; DROP TABLE goal_policies;');
    db.close(); await f.restart();
    assert.equal(f.store.getTask(task.id)?.status, 'pending');
    assert.equal(f.store.goals.get(actor, goal.id).checkpointRunId, before.goal.checkpointRunId);
    assert.equal(f.store.goals.view(actor, goal.id).plan.hash, before.plan.hash);
    assert.equal(f.store.goals.get(actor, goal.id).readyInput?.kind, 'continue');
    await f.runner.tick(); assert.equal(f.calls, 1); assert.equal(f.store.policies.list(actor).length, 0);
    const view = f.store.goals.view(actor, goal.id);
    assert.equal(view.checkpoint?.previousCheckpointRunId, before.goal.checkpointRunId);
    assert.ok(before.steps.filter(step => step.status === 'completed').every(step => view.steps.find(next => next.id === step.id)?.status === 'completed'));
  } finally { await f.close(); }
});

test('新的策略审批也不能覆盖同一Plan的待反馈或partial阻塞', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store); approve(f.store, proposal(goal));
    f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick();
    const waiting = f.store.goals.get(actor, goal.id);
    assert.equal(waiting.status, 'waiting_user');
    assert.throws(() => approve(f.store, proposal(waiting), '2026-10-23T01:00:00.000Z'), /等待用户反馈/);
    await f.runner.tick(); assert.equal(f.calls, 1);
  } finally { await f.close(); }
});
