import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import { GoalRunner, renderGoalState } from '../src/goal-runner.js';
import { BackgroundLane } from '../src/background-lane.js';
import { independentAudit } from '../scripts/independent-console-acceptance.js';
import type { GoalResult } from '../src/goal-types.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/manual-m3-approved-not-queued.json', import.meta.url), 'utf8')) as {
  message: string; objective: string; viewMessage: string; wrongChatReply: string; bootstrapResult: GoalResult;
};
const unqueued = '正式计划已批准，但当前Step尚未排队或执行。必须由用户再次明确要求继续，宿主授权后才可领取正式片段。';

test('M3真实形态：确认只审批且明确未排队，原错误保留、三处收据同源、重启无执行', async () => {
  const receipts: string[] = [];
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(m => m.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(content(payload.messages.at(-1)?.content));
      return reply(JSON.stringify({ action: 'goal_manage', mode: 'query', evidence: message, goalAction: 'view', selector: { keywords: ['澄川'] } }));
    }
    const index = payload.messages.findLastIndex(m => m.role === 'user');
    if (!payload.messages.slice(index + 1).some(m => m.role === 'tool')) return toolCall('goal_manage', {});
    receipts.push(JSON.parse(content(payload.messages.at(-1)?.content)).result);
    return reply(live.wrongChatReply);
  }, { enabled: false });
  let runner: GoalRunner | undefined;
  try {
    const actor = f.goals.actor(), now = f.tasks.now().toISOString(), source = f.store.beginRun(null, now);
    const created = f.store.goals.create(actor, source.id, live.objective, now);
    f.store.finishRun(source.id, 'succeeded', now);
    const bootstrap = f.store.goals.claim(actor, created.id, created.revision, now)!;
    f.store.goals.commit(bootstrap.run.id, live.bootstrapResult, now); f.store.event(bootstrap.run.id, 'delivery_succeeded');
    await f.chat(live.viewMessage); const before = f.goals.plan(created.id);
    const approved = await f.chat(live.message), after = f.goals.plan(created.id);
    assert.equal(after.goal.status, 'waiting_user'); assert.equal(after.goal.readyInput, null); assert.equal(after.goal.planRevision, 1);
    assert.deepEqual(after.executions, before.executions); assert.deepEqual(after.checkpoint, before.checkpoint);
    assert.equal(after.steps.find(s => s.id === after.goal.currentStepId)?.status, 'pending');
    assert.ok(receipts.at(-1)!.includes(unqueued), '旧版本没有明确区分已批准和已排队');
    assert.ok(approved.text.includes(unqueued)); assert.ok(approved.text.includes(renderGoalState(after)));
    assert.match(receipts.at(-1)!, /历史Checkpoint：已提交.*Plan v0/);
    assert.ok(!approved.text.includes('正式步骤还在排队等待执行'));
    assert.equal(f.payloads.length, 5, '查看3次、短确认2次；不新增纠错或后台请求');
    assert.ok(f.store.events(approved.run.id).some(e => e.type === 'delivery_succeeded'));
    const path = join(f.config.sessionDir, readdirSync(f.config.sessionDir)[0]!, 'chat.session.jsonl');
    const entries = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(entries.some(e => content(e.message?.content).includes(live.wrongChatReply)), '原始错误回答不重写');
    const saved = entries.filter(e => e.customType === 'host-goal-result-v1').at(-1)!;
    assert.ok(saved.content.endsWith(receipts.at(-1)!)); assert.ok(saved.content.includes(unqueued));
    await f.restart();
    runner = new GoalRunner(f.store, f.executor, { sendMessage: async () => assert.fail('审批不能触发投递') }, new BackgroundLane(), {
      ownerId: 'local-user', accepts: () => true, pollIntervalMs: 10, reportError: e => { throw e; }, fatal: () => assert.fail('不应停止'),
    }, () => f.tasks.now());
    await runner.tick(); assert.deepEqual(f.goals.plan(created.id), after); assert.equal(f.payloads.length, 5);
    const audit = independentAudit(f.root); assert.ok(Object.values(audit.counts).every(n => n === 0));
    assert.equal(f.memory.listForHost().length, 0); assert.equal(f.requests, 0); assert.equal(f.dns, 0); assert.deepEqual(f.errors, []);
  } finally { await runner?.stop(); await f.close(); }
});

test('M3对照：批准并继续才ready；running/partial与投递语义保持独立', async () => {
  const f = await webFixture(() => assert.fail('状态检查不调用模型'), { enabled: false });
  try {
    const actor = f.goals.actor(), now = f.tasks.now().toISOString(), source = f.store.beginRun(null, now);
    const created = f.store.goals.create(actor, source.id, live.objective, now); f.store.finishRun(source.id, 'succeeded', now);
    const bootstrap = f.store.goals.claim(actor, created.id, created.revision, now)!;
    f.store.goals.commit(bootstrap.run.id, live.bootstrapResult, now); const goal = f.goals.get(created.id);
    const approved = f.store.goals.approvePlan({ actor, expectedRevision: goal.revision, sourceRunId: f.store.beginRun(null, now).id,
      text: '批准并继续一段' }, goal.id, goal.pendingAction!.hash, now, true);
    assert.equal(approved.status, 'ready'); assert.ok(approved.readyInput);
    assert.match(renderGoalState(f.goals.plan(goal.id)), /已排队，等待领取/); assert.ok(!renderGoalState(f.goals.plan(goal.id)).includes(unqueued));
    const claim = f.store.goals.claim(actor, goal.id, approved.revision, now)!;
    assert.match(renderGoalState(f.goals.plan(goal.id)), /当前Step执行：running/);
    f.store.goals.commit(claim.run.id, { stepOutcome: 'partial', artifactText: '已提交的正式题目', progressSummary: '等回答', question: '请回答' }, now);
    const partial = f.goals.plan(goal.id); assert.match(renderGoalState(partial), /当前Step执行：committed/);
    assert.match(renderGoalState(partial), /投递：unconfirmed/); assert.ok(!renderGoalState(partial).includes(unqueued), '不能把已执行的partial说成从未执行');
    f.store.event(claim.run.id, 'delivery_succeeded'); assert.match(renderGoalState(f.goals.plan(goal.id)), /投递：succeeded/);
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});
