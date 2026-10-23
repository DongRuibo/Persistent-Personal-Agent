import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.js';
import { planQuantity, planQuantityQuestion, validatePlanQuantity, validateQuantityApproval } from '../src/goal-plan-quantity.js';
import type { Goal, GoalCommand, GoalResult, GoalStepProposal } from '../src/goal-types.js';

const now = '2026-10-23T03:00:00.000Z', actor = { ownerId: 'fake-user', target: { channel: 'console' as const } };
const step = (title: string): GoalStepProposal => ({ title, instruction: '内部子步骤：1.阅读；2.理解；3.核对', deliverable: '说明', doneWhen: '已交付' });
const result: GoalResult = { stepOutcome: 'complete', artifactText: '完整结果，不自动裁剪', progressSummary: '待用户核对', question: '请核对计划' };
function command(store: SqliteStore, goal: Goal, text: string): GoalCommand {
  return { actor, sourceRunId: store.beginRun(null, now).id, expectedRevision: goal.revision, text };
}

test('自然数量正例：明确正式Plan步数的中文/数字/全角、上下界与子步骤分开', () => {
  for (const prompt of ['帮我逐步学习。计划最多两步', '正式Plan不超过２个Step', '计划最多包含两步', '计划两步以内']) {
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 1));
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 2));
    assert.throws(() => validatePlanQuantity(prompt, 3), /数量约束不符/);
  }
  for (const prompt of ['计划两步', '正式计划只能有两个步骤', '计划恰好2步']) {
    assert.throws(() => validatePlanQuantity(prompt, 1), /数量约束不符/);
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 2));
    assert.throws(() => validatePlanQuantity(prompt, 3), /数量约束不符/);
  }
  assert.throws(() => validatePlanQuantity('正式计划至少两步', 1), /数量约束不符/);
  assert.throws(() => validatePlanQuantity('计划最多两步；计划至少三步', 2), /数量约束不符/);
  for (const prompt of ['计划分为2至3步', '正式Plan两到三步', '计划2-3个Step']) {
    assert.throws(() => validatePlanQuantity(prompt, 1), /数量约束不符/);
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 2));
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 3));
    assert.throws(() => validatePlanQuantity(prompt, 4), /数量约束不符/);
  }
});

test('数量反例：一个任务/一道题/每次一步/引文/假设/子计划不等同于正式Step总数', () => {
  for (const prompt of ['逐步完成一个任务', '只出一道题', '每次只执行一步', '参考“计划最多一步”，我的正式计划不限步数',
    '如果计划最多一步就太粗', '不要把计划两步当成我的要求', '每个子计划最多两步']) {
    assert.deepEqual(planQuantity(prompt).evidence, [], prompt);
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 3));
    assert.equal(planQuantityQuestion(prompt, 3), undefined);
  }
});

test('安排数量不强转Step：保留三步，单独确认拆解；数字、引文、错误口径不能代替决定', () => {
  for (const prompt of ['计划一项：阅读说明', '只安排一项学习内容', '只安排一项阅读练习', '学习计划只有一项阅读安排']) {
    assert.doesNotThrow(() => validatePlanQuantity(prompt, 3));
    assert.match(planQuantityQuestion(prompt, 3)!, /数量口径待确认/);
    assert.equal(planQuantityQuestion(prompt, 1), undefined);
    for (const text of ['确认', '批准计划', '允许将一项安排拆成两步', '允许将两项安排拆成三步', '他说“允许将一项安排拆成三步”', '如果允许将一项安排拆成三步']) {
      assert.throws(() => validateQuantityApproval(prompt, 3, text), /数量口径待确认/);
    }
    assert.doesNotThrow(() => validateQuantityApproval(prompt, 3, '批准计划，允许将1项安排拆成三步'));
  }
  assert.throws(() => validateQuantityApproval('计划最多一步', 3, '批准计划，允许将1项安排拆成三步'), /数量约束不符/);
  assert.doesNotThrow(() => validateQuantityApproval('计划一项：阅读说明；正式计划最多三步', 3, '批准计划'));
  assert.equal(planQuantityQuestion('只安排一项阅读；正式计划三步', 3), undefined);
});

test('真实SQLite事务：数量错误不提交Plan/Checkpoint；重启、版本和已完成Step原样保留', () => {
  const directory = mkdtempSync(join(tmpdir(), 'goal-quantity-')), path = join(directory, 'app.db');
  let store = new SqliteStore(path);
  try {
    let goal = store.goals.create(actor, store.beginRun(null, now).id, '逐步学习。正式计划最多两步', now);
    const init = store.goals.claim(actor, goal.id, goal.revision, now)!;
    const steps = [step('阅读'), step('练习')];
    const draft = { steps, changeReason: '完整计划' };
    const initialView = store.goals.view(actor, goal.id);
    assert.throws(() => store.goals.commit(init.run.id, { ...result, proposedPlan: { steps: [...steps, step('加测')], changeReason: '扩大' } }, now), /数量约束不符/);
    assert.deepEqual(store.goals.view(actor, goal.id), initialView);
    store.goals.commit(init.run.id, { ...result, proposedPlan: draft }, now);
    goal = store.goals.get(actor, goal.id);
    goal = store.goals.approvePlan(command(store, goal, '批准并继续'), goal.id, goal.pendingAction!.hash, now, true);
    const first = store.goals.claim(actor, goal.id, goal.revision, now)!;
    store.goals.commit(first.run.id, result, now);
    goal = store.goals.get(actor, goal.id);
    const before = store.goals.view(actor, goal.id), completed = before.plan.spec.steps[0]!;
    const oldExecution = store.goals.executionForHost(first.run.id);
    const source = command(store, goal, '调整计划');
    assert.throws(() => store.goals.proposePlan(source, goal.id, { steps: [completed, step('后续'), step('额外')], changeReason: '不能把已完成排除计数' }, now), /数量约束不符/);
    assert.deepEqual(store.goals.view(actor, goal.id), before);
    const revised = store.goals.proposePlan(source, goal.id, { steps: [completed, step('后续')], changeReason: '保留旧成果' }, now);
    assert.equal(revised.planRevision, 1); assert.equal(revised.pendingAction!.revision, 2);
    store.close(); store = new SqliteStore(path);
    const accepted = store.goals.approvePlan(command(store, revised, '批准计划'), goal.id, revised.pendingAction!.hash, now);
    const after = store.goals.view(actor, goal.id);
    assert.equal(accepted.planRevision, 2); assert.equal(accepted.checkpointRunId, goal.checkpointRunId);
    assert.equal(after.steps.find(s => s.id === completed.stepId)!.status, 'completed');
    assert.deepEqual(after.plan.spec.steps[0], completed);
    assert.deepEqual(store.goals.executionForHost(first.run.id), oldExecution);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('存储审批口同样要求安排拆解确认；拒绝时不消耗收据、不改草稿或Checkpoint', () => {
  const store = new SqliteStore(':memory:');
  try {
    let goal = store.goals.create(actor, store.beginRun(null, now).id, '计划一项：阅读一段说明', now);
    const init = store.goals.claim(actor, goal.id, goal.revision, now)!;
    store.goals.commit(init.run.id, { ...result, proposedPlan: { steps: [step('阅读'), step('理解'), step('复述')], changeReason: '拆解' } }, now);
    goal = store.goals.get(actor, goal.id); const before = store.goals.view(actor, goal.id);
    const request = command(store, goal, '确认');
    assert.throws(() => store.goals.approvePlan(request, goal.id, goal.pendingAction!.hash, now), /数量口径待确认/);
    assert.deepEqual(store.goals.view(actor, goal.id), before);
    assert.equal(store.goals.controlReceipt(actor, request.sourceRunId), undefined);
    const accepted = store.goals.approvePlan({ ...request, text: '批准计划，允许将一项安排拆成三步' }, goal.id, goal.pendingAction!.hash, now);
    assert.equal(accepted.planRevision, 1); assert.equal(accepted.readyInput, null);
    assert.equal(accepted.checkpointRunId, goal.checkpointRunId);
    assert.deepEqual(store.goals.view(actor, goal.id).executions, before.executions);
  } finally { store.close(); }
});
