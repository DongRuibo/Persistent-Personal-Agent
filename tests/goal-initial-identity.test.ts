import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/sqlite-store.js';
import { GoalRunner, goalProjection, parseGoalResult, renderGoal } from '../src/goal-runner.js';
import { BackgroundLane } from '../src/background-lane.js';
import { SkillService } from '../src/skill-service.js';
import { approveSkill } from '../src/skills-admin.js';
import type { GoalResult } from '../src/goal-types.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/integrated-live-g1.json', import.meta.url), 'utf8'));
const actor = { ownerId: 'local-user', target: { channel: 'console' as const } };
const now = '2026-10-24T00:00:00.000Z';
function fixture(result: GoalResult = structuredClone(live.result)) {
  const root = mkdtempSync(join(tmpdir(), 'initial-identity-')), path = join(root, 'app.db');
  let store = new SqliteStore(path), calls = 0;
  const raw = new DatabaseSync(path);
  // 只向全新测试库插入脱敏的初始快照，保留所有原有保护触发器。
  raw.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  for (const [table, rows] of Object.entries(live.seed) as [string, Record<string, string | number | null>[]][]) for (const row of rows) {
    raw.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
  }
  raw.exec('COMMIT'); raw.close();
  const dir = join(root, 'skills'); cpSync('skills/interview-practice', join(dir, 'interview-practice'), { recursive: true }); approveSkill(dir, 'interview-practice', true);
  const skills = new SkillService(dir), messages: string[] = [];
  const executor = { skills, execute: async () => { calls++; return { text: JSON.stringify(result) }; }, close: async () => {} };
  let runner: GoalRunner;
  const boot = () => runner = new GoalRunner(store, executor,
    { sendMessage: async message => { messages.push(message.text); } }, new BackgroundLane(),
    { ownerId: actor.ownerId, accepts: () => true, pollIntervalMs: 10, reportError: error => { throw error; }, fatal: () => assert.fail('不应停机') }, () => new Date(now));
  boot();
  const id = live.seed.goals[0].id as string;
  return { root, id, skills, executor, get store() { return store; }, get runner() { return runner; }, messages, get calls() { return calls; },
    async restart() { await runner.stop(); store.close(); store = new SqliteStore(path); store.recoverInterrupted(now); boot(); },
    async close() { await runner.stop(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('综合真实G1 response08原形离线回放：首次草稿使用宿主新身份，保留bootstrap和审批边界', async () => {
  const f = fixture();
  try {
    const before = f.store.goals.view(actor, f.id);
    assert.equal(before.plan.spec.steps[0]!.stepId, live.result.proposedPlan.steps[0].stepId);
    assert.notEqual(before.plan.spec.steps[0]!.title, live.result.proposedPlan.steps[0].title);
    await f.runner.tick(); await f.runner.tick();
    const view = f.store.goals.view(actor, f.id);
    assert.equal(view.goal.status, 'waiting_user'); assert.equal(f.calls, 1);
    assert.equal(view.goal.planRevision, 0); assert.equal(view.goal.pendingAction!.spec.steps.length, 1);
    assert.notEqual(view.goal.pendingAction!.spec.steps[0]!.stepId, live.bootstrap.stepId);
    assert.deepEqual(view.plan, before.plan); assert.equal(view.executions[0]!.execution.status, 'committed');
    assert.equal(view.goal.pendingAction!.spec.skillBindings![0]!.skillId, 'interview-practice');
    assert.ok(f.store.events(view.executions[0]!.run.id).some(e => e.type === 'goal_initial_step_identity_assigned'));
    const checkpoint = view.checkpoint;
    await f.restart(); await f.runner.tick();
    assert.equal(f.calls, 1); assert.deepEqual(f.store.goals.view(actor, f.id).checkpoint, checkpoint);
  } finally { await f.close(); }
});

test('初始化投影不向模型暴露bootstrap身份；持久Execution身份保留', async () => {
  const f = fixture();
  try {
    const goal = f.store.goals.get(actor, f.id), claimed = f.store.goals.claim(actor, f.id, goal.revision, now)!;
    const projection = goalProjection(claimed.execution, f.store.goals.view(actor, f.id));
    assert.ok(!projection.prompt.includes(live.bootstrap.stepId));
    const schema = JSON.parse(projection.prompt.split('resultSchema=')[1]!.split('\n')[0]!);
    assert.equal(schema.properties.proposedPlan.properties.steps.items.properties.stepId, undefined);
    assert.equal(claimed.execution.stepId, live.bootstrap.stepId);
    assert.deepEqual(parseGoalResult(JSON.stringify(live.result)), live.result);
  } finally { await f.close(); }
});

test('非法首次Step ID保留安全业务原因：Run/Execution/阻塞/重启一致且不重复调用', async () => {
  const result = structuredClone(live.result) as GoalResult; result.proposedPlan!.steps[0]!.stepId = 'forged-other-goal';
  const f = fixture(result);
  try {
    await f.runner.tick(); await f.runner.tick();
    const view = f.store.goals.view(actor, f.id), run = view.executions[0]!.run, execution = view.executions[0]!.execution;
    assert.match(run.error!, /goal_plan_step_identity/);
    assert.equal(execution.reasonCode, 'goal_plan_step_identity'); assert.equal(view.goal.blockedReason, execution.reasonCode);
    assert.match(renderGoal(view), /计划 Step ID 跨目标或定义已变化/);
    assert.equal(view.checkpoint, null); assert.equal(view.goal.pendingAction, null); assert.equal(f.calls, 1);
    await f.restart(); await f.runner.tick();
    assert.equal(f.calls, 1); assert.deepEqual(f.store.goals.view(actor, f.id), view);
  } finally { await f.close(); }
});

test('首次兼容不能覆盖跨Goal ID或重复ID；数量与Skill约束仍先验证', async () => {
  const f = fixture();
  try {
    for (const kind of ['cross-goal', 'duplicate', 'quantity', 'skill'] as const) {
      const goal = f.store.goals.create(actor, f.store.beginRun(null, now).id,
        kind === 'quantity' ? '逐步练习，正式计划最多1个Step' : '逐步完成虚构练习', now);
      const claim = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
      const result = structuredClone(live.result) as GoalResult;
      result.proposedPlan!.steps[0]!.stepId = claim.execution.stepId;
      if (kind === 'cross-goal') result.proposedPlan!.steps[0]!.stepId = live.bootstrap.stepId;
      if (kind === 'duplicate' || kind === 'quantity') result.proposedPlan!.steps.push({ ...result.proposedPlan!.steps[0]! });
      if (kind === 'skill') result.proposedPlan!.steps[0]!.skillId = 'unapproved-skill';
      const before = f.store.goals.view(actor, goal.id);
      assert.throws(() => f.store.goals.commit(claim.run.id, result, now),
        kind === 'cross-goal' ? /跨目标/ : kind === 'duplicate' ? /重复/ : kind === 'quantity' ? /数量约束/ : /Skill/);
      assert.deepEqual(f.store.goals.view(actor, goal.id), before);
      assert.ok(!f.store.events(claim.run.id).some(e => e.type === 'goal_initial_step_identity_assigned'));
      f.store.goals.finishFailure(claim.run.id, 'failed', '离线反例结束', now);
    }
  } finally { await f.close(); }
});

test('后续初始化片段不能重映射bootstrap；正式修订和已完成Step不可改写', async () => {
  const f = fixture();
  const command = (id: string) => ({ actor, sourceRunId: f.store.beginRun(null, now).id,
    expectedRevision: f.store.goals.get(actor, id).revision, text: '根据用户新反馈调整' });
  try {
    const first = f.store.goals.claim(actor, f.id, 0, now)!;
    const result = structuredClone(live.result) as GoalResult;
    f.store.goals.commit(first.run.id, { ...result, proposedPlan: undefined }, now);
    let goal = f.store.goals.continue(command(f.id), f.id, now);
    const second = f.store.goals.claim(actor, f.id, goal.revision, now)!;
    assert.throws(() => f.store.goals.commit(second.run.id, result, now), /跨目标或定义已变化/);
    delete result.proposedPlan!.steps[0]!.stepId;
    f.store.goals.commit(second.run.id, result, now);
    goal = f.store.goals.get(actor, f.id);
    const draft = goal.pendingAction!;
    goal = f.store.goals.approvePlan(command(f.id), f.id, draft.hash, now, true);
    const formal = f.store.goals.view(actor, f.id), third = f.store.goals.claim(actor, f.id, goal.revision, now, f.skills.snapshot('interview-practice'))!;
    const altered = { ...formal.plan.spec.steps[0]!, instruction: '未经批准改写原Step' };
    assert.throws(() => f.store.goals.commit(third.run.id, { ...result, proposedPlan: { changeReason: '非法改写', steps: [altered] } }, now), /定义已变化/);
    f.store.goals.commit(third.run.id, { ...result, stepOutcome: 'complete', proposedPlan: undefined }, now);
    const completed = f.store.goals.view(actor, f.id);
    assert.throws(() => f.store.goals.proposePlan(command(f.id), f.id, { changeReason: '非法改写完成项', steps: [altered] }, now), /定义已变化/);
    assert.deepEqual(f.store.goals.view(actor, f.id), completed);
    assert.equal(completed.steps.find(s => s.id === altered.stepId)!.status, 'completed');
  } finally { await f.close(); }
});

test('未知COMMIT异常只呈现通用原因，不泄露内部消息、伪造Checkpoint或重试模型', async t => {
  const f = fixture();
  t.mock.method(f.store.goals, 'commit', () => { throw new Error('SECRET_FIXTURE_KEY /private/internal/file'); });
  try {
    await f.runner.tick(); await f.runner.tick();
    const view = f.store.goals.view(actor, f.id);
    assert.equal(view.executions[0]!.run.error, 'checkpoint_commit_failed'); assert.equal(view.checkpoint, null);
    assert.ok(!renderGoal(view).includes('SECRET_FIXTURE')); assert.equal(f.calls, 1);
  } finally { await f.close(); }
});

test('未知执行异常与非法JSON不回显内部消息或原始片段，保持一次授权一次调用', async t => {
  for (const mode of ['executor', 'json'] as const) await t.test(mode, async () => {
    const f = fixture();
    const call = t.mock.method(f.executor, 'execute', async () => {
      if (mode === 'executor') throw new Error('PRIVATE_INTERNAL_PATH /private/file');
      return { text: '{PRIVATE_JSON_SECRET' };
    });
    try {
      await f.runner.tick(); await f.runner.tick();
      const view = f.store.goals.view(actor, f.id);
      assert.equal(view.executions.length, 1); assert.equal(view.checkpoint, null);
      assert.equal(call.mock.callCount(), 1);
      assert.equal(view.executions[0]!.run.error, mode === 'executor' ? 'goal_execution_failed' : 'goal_output_json：Goal 输出不是合法JSON');
      assert.ok(!JSON.stringify(view.executions[0]!.run).includes('PRIVATE_'));
    } finally { await f.close(); }
  });
});
