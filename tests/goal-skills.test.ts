import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { GoalService } from '../src/goal-service.js';
import { OperationGuard } from '../src/operation-guard.js';
import { SkillService, skillHash } from '../src/skill-service.js';
import { parseGoalResult, renderGoal } from '../src/goal-runner.js';
import type { Goal, GoalResult, GoalStepProposal } from '../src/goal-types.js';
import { installSkill } from './helpers/skills-fixture.js';
import { actor, initialTime } from './helpers/proactive-fixture.js';

const step = { title: '资料整理', instruction: '整理给定资料', deliverable: '一份摘要', doneWhen: '摘要已交付' };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'goal-skill-binding-')), managed = join(root, 'managed');
  installSkill(managed); installSkill(managed, 'interview-practice');
  const store = new SqliteStore(join(root, 'app.db')), skills = new SkillService(managed);
  const tasks = new TaskService(store, 'Asia/Shanghai', () => new Date(initialTime));
  const goals = new GoalService(store, tasks, () => {}); goals.setSkills(skills);
  let intent: unknown;
  const guard = new OperationGuard(tasks, undefined, async () => intent, {});
  function command(goal: Goal, text: string) { return { actor, expectedRevision: goal.revision, text, sourceRunId: store.beginRun(null, initialTime).id }; }
  function seed(objective = '帮我逐步整理面试资料', selected?: string) {
    const run = store.beginRun(null, initialTime), goal = store.goals.create(actor, run.id, objective, initialTime);
    store.finishRun(run.id, 'succeeded', initialTime, '已创建');
    const execution = store.goals.claim(actor, goal.id, goal.revision, initialTime)!;
    store.goals.commit(execution.run.id, { stepOutcome: 'complete', artifactText: '待批计划', progressSummary: '待审批', question: '是否批准？',
      proposedPlan: { changeReason: '初步规划', steps: [{ ...step, ...(selected ? { skillId: selected } : {}) }] } }, initialTime);
    return goals.get(goal.id);
  }
  async function chat(prompt: string, fields: Record<string, unknown>, delivered = true) {
    intent = { action: 'goal_manage', mode: 'request', evidence: prompt, selector: { keywords: ['面试'] }, ...fields };
    const run = store.beginRun(null, initialTime);
    try {
      const response = await guard.withRequest({ prompt, scope: 'chat', signal: new AbortController().signal,
        source: { channel: 'console', reference: run.id }, observer: store.observer(run.id) }, async () => { await guard.manageGoals(goals); return { text: '模型回复' }; });
      store.finishRun(run.id, 'succeeded', initialTime, response.text); if (delivered) store.event(run.id, 'delivery_succeeded'); return response.text;
    } catch (error) { store.finishRun(run.id, 'failed', initialTime, undefined, String(error)); throw error; }
  }
  return { root, managed, store, skills, goals, seed, command, chat, close() { store.close(); } };
}

test('模型只提议ID，宿主映射批准Hash进入草稿；用户指定Skill自动绑定且不能被替换', () => {
  const f = fixture();
  try {
    const goal = f.seed(undefined, 'agent-notes'), draft = goal.pendingAction!;
    assert.equal(draft.spec.skillBindings?.length, 1);
    const binding = draft.spec.skillBindings![0]!;
    assert.equal(binding.packageHash, f.skills.snapshot('agent-notes').hash);
    assert.equal(binding.stepId, draft.spec.steps[0]!.stepId);
    assert.ok(renderGoal(f.store.goals.view(actor, goal.id)).includes(binding.packageHash));
    const explicit = f.seed('使用Skill interview-practice，帮我逐步准备面试');
    assert.equal(explicit.pendingAction!.spec.skillBindings![0]!.skillId, 'interview-practice');
    assert.throws(() => f.seed('使用Skill agent-notes，帮我逐步准备面试', 'interview-practice'), /违反用户/);
    assert.throws(() => f.seed('使用Skill nonexistent，帮我逐步准备面试'), /未批准/);
    const plain = f.seed(); assert.equal(plain.pendingAction!.spec.skillBindings, undefined);
    assert.equal(f.store.goals.view(actor, plain.id).plan.spec.skillBindings, undefined, '旧Plan v0不回填');
  } finally { f.close(); }
});

test('模型不能提交Hash/本机路径，不兼容Skill、未知ID及数量违规均原子拒绝', () => {
  const f = fixture();
  try {
    const base: GoalResult = { stepOutcome: 'complete', artifactText: '计划', progressSummary: '摘要', question: '确认', proposedPlan: { changeReason: '初始', steps: [step] } };
    for (const extra of [{ packageHash: 'a'.repeat(64) }, { path: '/private/SKILL.md' }]) {
      assert.throws(() => parseGoalResult(JSON.stringify({ ...base, proposedPlan: { ...base.proposedPlan, steps: [{ ...step, ...extra }] } })), /Schema/);
    }
    assert.throws(() => f.seed(undefined, 'unknown'), /未批准/);
    const goal = f.seed('帮我逐步准备面试，计划最多1步');
    const prior = f.goals.get(goal.id);
    assert.throws(() => f.store.goals.proposePlan(f.command(prior, '调整计划'), goal.id,
      { changeReason: '违反数量', steps: [{ ...step, skillId: 'agent-notes' }, { ...step, skillId: 'agent-notes' }] }, initialTime), /数量/);
    assert.deepEqual(f.goals.get(goal.id), prior);
  } finally { f.close(); }
});

test('绑定必须成功展示后批准；投递失败、旧展示和已禁用/升级包不能批准', async () => {
  const f = fixture();
  try {
    const goal = f.seed(undefined, 'agent-notes');
    assert.match(await f.chat('批准面试计划', { goalAction: 'approve_plan' }, false), /请先核对/);
    assert.equal(f.goals.get(goal.id).planRevision, 0);
    await assert.rejects(f.chat('批准面试计划', { goalAction: 'approve_plan' }), /投递/);
    const view = await f.chat('查看面试进度', { goalAction: 'view', mode: 'query' });
    assert.ok(view.includes('agent-notes@1.0.0')); assert.ok(view.includes('Hash='));
    const manifest = JSON.parse(readFileSync(join(f.managed, 'approved.json'), 'utf8')); manifest.skills[0].enabled = false;
    writeFileSync(join(f.managed, 'approved.json'), JSON.stringify(manifest));
    await assert.rejects(f.chat('批准面试计划', { goalAction: 'approve_plan' }), /禁用/);
    assert.equal(f.goals.get(goal.id).planRevision, 0);
    manifest.skills[0].enabled = true; writeFileSync(join(f.managed, 'approved.json'), JSON.stringify(manifest));
    await f.chat('查看面试进度', { goalAction: 'view', mode: 'query' });
    await f.chat('批准面试计划', { goalAction: 'approve_plan' });
    assert.equal(f.goals.get(goal.id).planRevision, 1);
    assert.equal(f.goals.get(goal.id).status, 'waiting_user', '批准不隐含执行');
  } finally { f.close(); }
});

test('绑定改动只形成新草稿，旧Plan/Checkpoint不变；当前原话之外不能扩大为绑定', async () => {
  const f = fixture();
  try {
    let goal = f.seed(undefined, 'agent-notes');
    goal = f.store.goals.approvePlan(f.command(goal, '批准计划'), goal.id, goal.pendingAction!.hash, initialTime);
    const original = f.store.goals.view(actor, goal.id);
    await assert.rejects(f.chat('面试资料使用TypeScript', { goalAction: 'revise_plan', skillId: 'interview-practice' }), /操作依据/);
    await f.chat('给面试当前步骤使用Skill interview-practice', { goalAction: 'revise_plan', skillId: 'interview-practice' });
    const next = f.goals.get(goal.id); assert.equal(next.planRevision, 1);
    assert.equal(next.pendingAction!.spec.skillBindings![0]!.skillId, 'interview-practice');
    assert.notEqual(skillHash(next.pendingAction!.spec), original.plan.hash);
    assert.deepEqual(f.store.goals.view(actor, goal.id).checkpoint, original.checkpoint);
    assert.deepEqual(f.store.goals.view(actor, goal.id).plan, original.plan);
    await f.chat('批准面试计划', { goalAction: 'approve_plan' });
    assert.equal(f.goals.get(goal.id).planRevision, 2);
    await f.chat('移除面试当前步骤的Skill', { goalAction: 'revise_plan', skillId: null });
    assert.equal(f.goals.get(goal.id).pendingAction!.spec.skillBindings, undefined);
  } finally { f.close(); }
});

test('已完成Step的绑定、定义和成果不可被改写；新草稿可以保留已完成步骤', () => {
  const f = fixture();
  try {
    let goal = f.seed(undefined, 'agent-notes');
    goal = f.store.goals.approvePlan(f.command(goal, '批准并继续一段'), goal.id, goal.pendingAction!.hash, initialTime, true);
    const execution = f.store.goals.claim(actor, goal.id, goal.revision, initialTime)!;
    f.store.goals.commit(execution.run.id, { stepOutcome: 'complete', artifactText: '完成的成果', progressSummary: '完成', question: '请确认达成' }, initialTime);
    goal = f.goals.get(goal.id); const view = f.store.goals.view(actor, goal.id);
    const done = view.plan.spec.steps[0]!;
    assert.throws(() => f.store.goals.proposePlan(f.command(goal, '调整Skill'), goal.id,
      { changeReason: '改已完成步骤', steps: [{ ...done, skillId: 'interview-practice' }] }, initialTime), /已完成/);
    const proposed: GoalStepProposal[] = [done, { ...step, skillId: 'interview-practice' }];
    const next = f.store.goals.proposePlan(f.command(goal, '增加练习'), goal.id, { changeReason: '新增', steps: proposed }, initialTime);
    assert.equal(next.pendingAction!.spec.skillBindings?.[0]?.packageHash, view.plan.spec.skillBindings?.[0]?.packageHash);
    assert.deepEqual(f.store.goals.view(actor, goal.id).checkpoint, view.checkpoint);
  } finally { f.close(); }
});
