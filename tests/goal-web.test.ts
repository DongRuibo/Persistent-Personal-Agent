import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { goalWebFixture } from './helpers/goal-web-fixture.js';

test('S1-B完整原生链：Chat快照→明确资料/Goal/步骤→新草稿→展示审批→Skill展开/冻结输入→Checkpoint→重启不重取', async () => {
  const f = await goalWebFixture();
  try {
    await f.seed(); const bootstrap = JSON.stringify(f.view.executions[0]);
    assert.ok(!f.goal.pendingAction!.spec.webBindings);
    const text = (await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步')).text;
    assert.match(text, /待批准计划.*v1/); assert.match(text, /读取时间=/); assert.match(text, /范围=全文/);
    const bound = f.goal.pendingAction!.spec.webBindings![0]!;
    assert.equal(f.goal.planRevision, 0); assert.ok(f.goal.pendingAction!.spec.skillBindings?.length);
    await f.web.chat('批准银杏计划并继续一段'); await f.runner.tick();
    assert.equal(f.goal.planRevision, 1); assert.equal(f.goal.status, 'waiting_user');
    const execution = f.view.executions.at(-1)!.execution;
    assert.equal(execution.input.web!.binding.snapshotId, bound.snapshotId);
    assert.ok(execution.input.web!.text.includes('PI_SNAPSHOT_ONLY'));
    assert.ok(execution.input.skill!.text.includes('interview-practice'));
    assert.equal(execution.inputHash, createHash('sha256').update(JSON.stringify(execution.input)).digest('hex'));
    assert.equal(f.view.checkpoint?.executionRunId, execution.runId);
    assert.equal(JSON.stringify(f.view.executions[0]), bootstrap);
    const calls = f.calls; await f.restart(); await f.runner.tick();
    assert.equal(f.calls, calls); assert.equal(f.web.requests, 1);
    const goalPayload = f.web.payloads.filter(p => JSON.stringify(p).includes('UNTRUSTED_WEB_SNAPSHOT_V1')).at(-1)!;
    assert.equal(goalPayload.tools?.length ?? 0, 0);
    assert.ok(JSON.stringify(goalPayload).includes('<skill name=\\"interview-practice\\"'));
    assert.deepEqual(f.web.errors, []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('全文超限不裁剪：只有用户明确行范围才能绑定，绑定元数据/节选Hash进入审批', async () => {
  const f = await goalWebFixture('第一行来源\n' + 'x'.repeat(7000) + '\n第三行');
  try {
    await f.seed(); const before = f.goal;
    await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步').catch(() => {});
    assert.deepEqual(f.goal, before); assert.equal(f.web.requests, 1);
    await f.web.chat('将已获取的 Pi Skills 文档第1至1行绑定到银杏学习目标第1步');
    const bound = f.goal.pendingAction!.spec.webBindings![0]!;
    assert.deepEqual(bound.lines, { start: 1, end: 1 }); assert.equal(bound.bytes > 4096, true);
    await f.web.chat('批准银杏计划并继续一段'); await f.runner.tick();
    assert.equal(f.view.executions.at(-1)!.execution.input.web!.text, '第一行来源');
    assert.equal(f.web.requests, 1);
  } finally { await f.close(); }
});

test('损坏、丢失、跨身份及错版本快照均阻塞且不联网、不消费模型；同源多份需要明确最近一次', async t => {
  for (const kind of ['corrupt', 'missing', 'owner', 'version'] as const) await t.test(kind, async () => {
    const f = await goalWebFixture(); let db: DatabaseSync | undefined;
    try {
      await f.seed(); await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步'); await f.web.chat('批准银杏计划并继续一段');
      db = new DatabaseSync(f.web.config.databasePath);
      if (kind === 'missing') db.exec('DELETE FROM web_read_calls');
      else if (kind === 'owner') db.exec("UPDATE web_read_calls SET owner='another-owner'");
      else db.exec(`UPDATE web_read_calls SET snapshotJson=json_set(snapshotJson,'$.${kind === 'corrupt' ? 'text' : 'version'}','tampered')`);
      const calls = f.calls; await f.runner.tick(); await f.runner.tick();
      assert.equal(f.goal.status, 'blocked'); assert.equal(f.goal.blockedReason, 'web_snapshot_unavailable');
      assert.equal(f.calls, calls); assert.equal(f.web.requests, 1); assert.equal(f.view.executions.length, 1);
    } finally { db?.close(); await f.close(); }
  });
});

test('绑定变更重新展示审批，旧Plan/已完成Step/Checkpoint不改写，模型不能提供快照Hash', async () => {
  const f = await goalWebFixture();
  try {
    await f.seed(); await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步');
    await f.web.chat('批准银杏计划并继续一段'); await f.runner.tick();
    const old = f.view, oldRevision = f.goal.planRevision;
    await f.web.chat('将已获取的 Pi Skills 文档第1至1行绑定到银杏学习目标第1步').catch(() => {});
    assert.deepEqual(f.view, old);
    await f.web.chat('将已获取的 Pi Skills 文档第1至1行绑定到银杏学习目标第2步');
    assert.equal(f.goal.planRevision, oldRevision); assert.equal(f.goal.pendingAction!.revision, oldRevision + 1);
    assert.deepEqual(f.goal.pendingAction!.spec.webBindings!.find(b => b.stepId === old.plan.spec.steps[0]!.stepId), old.plan.spec.webBindings![0]);
    await f.web.chat('批准银杏计划');
    assert.equal(f.goal.planRevision, oldRevision + 1); assert.deepEqual(f.view.executions, old.executions);
    assert.equal(f.goal.checkpointRunId, old.goal.checkpointRunId);
    assert.equal(f.web.requests, 1);
  } finally { await f.close(); }
});

test('同资源多份快照必须明确最近一次；跨渠道、失败展示、含混范围不产生绑定，拒绝模型伪造元数据', async () => {
  const f = await goalWebFixture();
  try {
    await f.seed(); const latest = await f.web.chat('请读取 Pi Skills 文档，并总结加载流程');
    const before = f.goal;
    for (const message of ['将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步',
      '将已获取的 Pi Skills 文档绑定到银杏学习目标第1步',
      '如果将最近读取的 Pi Skills 文档全文绑定到银杏学习目标第1步']) {
      await f.web.chat(message).catch(() => {}); assert.deepEqual(f.goal, before);
    }
    await f.web.chat('将最近读取的 Pi Skills 文档全文绑定到银杏学习目标第1步');
    const bound = f.goal.pendingAction!.spec.webBindings![0]!;
    assert.equal(bound.snapshotId, f.web.store.web.calls().find(call => call.runId === latest.run.id)!.id);
    assert.throws(() => f.web.store.web.freezeForGoal({ ownerId: 'local-user', target: { channel: 'feishu', appId: 'fake', chatId: 'fake', userOpenId: 'fake' } }, bound), /身份/);
    assert.throws(() => f.web.store.web.freezeForGoal(f.web.goals.actor(), { ...bound, selectedHash: '0'.repeat(64) }), /Hash/);
    const current = f.goal, run = f.web.store.beginRun(null, f.web.tasks.now().toISOString());
    assert.throws(() => f.web.store.goals.proposePlan({ actor: f.web.goals.actor(), sourceRunId: run.id, expectedRevision: current.revision, text: '调整计划' }, current.id,
      { steps: [{ title: '新步骤', instruction: '只读文本', deliverable: '练习', doneWhen: '已交付', webBindings: [bound] } as never], changeReason: '模型尝试提供可信绑定' }, f.web.tasks.now().toISOString()), /模型不能/);
    assert.equal(f.web.requests, 2);
  } finally { await f.close(); }
});
