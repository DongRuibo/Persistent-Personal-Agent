import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';
import { nextWake } from '../src/goal-schedule.js';
import { policyConsole } from '../src/goal-policy-console.js';
import { readConfig } from '../src/config.js';
import { actor, approve, fixture, hostOptions, initialTime, proposal, seedGoal } from './helpers/proactive-fixture.js';

test('时间策略：UTC/IANA、DST缺口/重复跳过、每周和长期停机合并', () => {
  const daily = { kind: 'daily' as const, time: '02:30', timeZone: 'America/New_York' };
  assert.equal(nextWake(daily, '2026-03-08T00:00:00.000Z'), '2026-03-09T06:30:00.000Z');
  assert.equal(nextWake({ ...daily, time: '01:30' }, '2026-11-01T00:00:00.000Z'), '2026-11-02T06:30:00.000Z');
  assert.equal(nextWake({ kind: 'weekly', time: '09:00', timeZone: 'Asia/Shanghai', weekday: 1 }, initialTime), '2026-10-26T01:00:00.000Z');
  assert.throws(() => nextWake({ ...daily, time: '25:00' }, initialTime));
  assert.throws(() => nextWake({ ...daily, timeZone: '+08:00' }, initialTime));
});

test('场景A：真实Pi+SQLite+本机HTTP，定时片段提交Checkpoint，等待反馈、重启、暂停后不重放', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store), policy = approve(f.store, proposal(goal));
    await f.runner.tick(); assert.equal(f.calls, 0);
    f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick();
    const view = f.store.goals.view(actor, goal.id);
    assert.equal(f.calls, 1); assert.equal(view.goal.status, 'waiting_user');
    assert.equal(view.checkpoint?.artifactText, '虚构练习题'); assert.equal(view.checkpoint?.needsUserFeedback, true);
    assert.equal(f.store.policies.get(actor, policy.id).status, 'paused');
    const audit = f.store.policies.audit(actor, policy.id);
    assert.equal(audit.grants.length, 1); assert.equal((audit.grants[0] as { status: string }).status, 'consumed');
    const auth = view.executions.at(-1)!.execution.input.authorization; assert.equal(auth.kind, 'policy');
    assert.throws(() => f.store.goals.create(actor, auth.triggerRunId, '伪造来源', initialTime));
    assert.equal((f.payloads[0] as { tools?: unknown[] }).tools?.length ?? 0, 0);
    await f.restart(); f.time('2026-11-01T01:00:00.000Z'); await f.runner.tick(); assert.equal(f.calls, 1);
    assert.equal(f.store.goals.view(actor, goal.id).goal.checkpointRunId, view.goal.checkpointRunId);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('策略领取与消费：重复扫描/双连接竞争、重启、单次未来和错过周期最多一次', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store); const spec = proposal(goal);
    const policy = approve(f.store, spec); const at = '2026-11-20T01:00:00.000Z';
    f.store.policies.scan(at, () => true); f.store.policies.scan(at, () => true);
    assert.equal(f.store.policies.audit(actor, policy.id).triggers.length, 1);
    const current = f.store.goals.get(actor, goal.id);
    const other = new SqliteStore(f.store === undefined ? '' : `${f.root}/app.db`); other.policies.configure(hostOptions);
    const claimed = f.store.goals.claim(actor, goal.id, current.revision, at)!;
    assert.throws(() => other.goals.claim(actor, goal.id, current.revision, at)); other.close();
    assert.equal(f.store.goals.view(actor, goal.id).executions.length, 2);
    await f.restart(); assert.equal(f.store.goals.executionForHost(claimed.run.id).status, 'interrupted');
    assert.equal(f.store.goals.get(actor, goal.id).status, 'blocked');
    assert.equal(f.store.policies.get(actor, policy.id).status, 'paused');
    assert.equal(f.calls, 0);
  } finally { await f.close(); }
});

test('宿主开关/身份/版本/审批/停止状态/预算和费率缺失全部拒绝，撤销尚未消费授权', () => {
  const store = new SqliteStore(':memory:');
  try {
    const goal = seedGoal(store), spec = proposal(goal);
    assert.equal(readConfig({}).proactive?.enabled, false);
    assert.throws(() => readConfig({ PROACTIVE_ENABLED: 'true' }));
    assert.throws(() => approve(store, spec), /总开关/);
    store.policies.configure(hostOptions);
    assert.throws(() => approve(store, { ...spec, expectedGoalRevision: 999 }));
    const policy = approve(store, spec);
    assert.throws(() => store.policies.get({ ...actor, ownerId: 'other' }, policy.id));
    store.policies.scan('2026-10-23T01:00:00.000Z', () => true);
    assert.throws(() => policyConsole(store, actor, `/policy revoke ${JSON.stringify({ id: policy.id, version: 99 })}`, initialTime));
    policyConsole(store, actor, `/policy revoke ${JSON.stringify({ id: policy.id, version: 1 })}`, initialTime);
    assert.equal(store.goals.get(actor, goal.id).readyInput, null);
    assert.equal(store.policies.get(actor, policy.id).status, 'revoked');
    const next = seedGoal(store); const second = approve(store, proposal(next));
    store.policies.configure({ ...hostOptions, inputRate: 0 });
    store.policies.scan('2026-10-23T01:00:00.000Z', () => true);
    const ready = store.goals.get(actor, next.id);
    assert.equal(store.goals.claim(actor, next.id, ready.revision, '2026-10-23T01:00:00.000Z'), undefined);
    assert.equal(store.policies.get(actor, second.id).status, 'blocked');
    assert.equal(store.goals.view(actor, next.id).executions.length, 1);
  } finally { store.close(); }
});

test('单次触发、过期和Goal状态/计划改变都不能留下后续执行权限', async () => {
  for (const change of ['once', 'expired', 'pause', 'plan'] as const) {
    const f = await fixture();
    try {
      const goal = seedGoal(f.store), spec = proposal(goal);
      spec.schedule = { kind: 'once', at: '2026-10-23T01:00:00.000Z', timeZone: 'Asia/Shanghai' };
      if (change === 'expired') spec.expiresAt = '2026-10-23T01:01:00.000Z';
      const policy = approve(f.store, spec);
      if (change === 'pause' || change === 'plan') {
        const run = f.store.beginRun(null, initialTime), command = { actor, sourceRunId: run.id, text: change, expectedRevision: goal.revision };
        if (change === 'pause') f.store.goals.control(command, goal.id, 'pause', initialTime);
        else f.store.goals.proposePlan(command, goal.id, { changeReason: '新计划', steps: [{ title: '新步骤', instruction: '新内容', deliverable: '文本', doneWhen: '提交' }] }, initialTime);
        f.store.finishRun(run.id, 'succeeded', initialTime, '已控制');
      }
      f.time(change === 'expired' ? '2026-10-23T02:00:00.000Z' : '2026-10-23T01:00:00.000Z');
      await f.runner.tick(); await f.runner.tick();
      assert.equal(f.calls, change === 'once' ? 1 : 0);
      assert.ok(['paused', 'expired'].includes(f.store.policies.get(actor, policy.id).status));
      assert.equal(f.store.goals.get(actor, goal.id).readyInput, null);
    } finally { await f.close(); }
  }
});
