import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { redactor } from '../src/config.js';
import type { Goal, GoalActor, GoalCommand, GoalResult, GoalStepProposal } from '../src/goal-types.js';
import { SqliteStore } from '../src/sqlite-store.js';

const now = '2026-10-22T03:00:00.000Z';
const actor: GoalActor = { ownerId: 'fictional-user', target: { channel: 'console' } };
const step = (title: string): GoalStepProposal => ({ title, instruction: `分析${title}`, deliverable: `${title}产物`, doneWhen: `${title}已交付` });
const result = (stepOutcome: GoalResult['stepOutcome'] = 'partial'): GoalResult => ({ stepOutcome, artifactText: '虚构分析结果',
  progressSummary: '本段完成分析', question: '请提供反馈', ...(stepOutcome === 'blocked' ? { blockedReason: '需要补充资料' } : {}) });
function command(store: SqliteStore, goal: Goal, text = '明确继续一段'): GoalCommand {
  return { actor, sourceRunId: store.beginRun(null, now).id, expectedRevision: goal.revision, text };
}
function create(store: SqliteStore): Goal { return store.goals.create(actor, store.beginRun(null, now).id, '虚构面试准备目标', now); }
function bootstrap(store: SqliteStore, goal = create(store)): Goal {
  const claimed = store.goals.claim(actor, goal.id, goal.revision, now)!;
  store.goals.commit(claimed.run.id, { ...result('complete'), proposedPlan: { steps: [step('分析能力'), step('制定练习')], changeReason: '初始计划' } }, now);
  return store.goals.get(actor, goal.id);
}
function approved(store: SqliteStore): Goal {
  const goal = bootstrap(store);
  return store.goals.approvePlan(command(store, goal, '批准计划并继续一段'), goal.id, goal.pendingAction!.hash, now, true);
}
function fixture(): { directory: string; path: string; store: SqliteStore; raw: DatabaseSync; close(): void } {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-goals-'));
  const path = join(directory, 'app.db'), store = new SqliteStore(path), raw = new DatabaseSync(path);
  raw.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  return { directory, path, store, raw, close() { raw.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}
function child(code: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    processChild.stdout.on('data', chunk => { output += String(chunk); });
    processChild.stderr.on('data', chunk => { errors += String(chunk); });
    processChild.on('error', reject);
    processChild.on('close', code => resolve({ code, output: output || errors }));
  });
}
const storeImport = JSON.stringify(pathToFileURL(join(process.cwd(), 'src/sqlite-store.ts')).href);

test('Goal 四表、bootstrap v0 与来源收据原子创建；只允许一次来源请求', () => {
  const store = new SqliteStore(':memory:');
  try {
    const goal = create(store), view = store.goals.view(actor, goal.id);
    assert.equal(goal.status, 'ready'); assert.equal(view.plan.revision, 0);
    assert.equal(view.steps.length, 1); assert.equal(view.steps[0]?.status, 'pending');
    assert.equal(view.executions.length, 0); assert.equal(view.checkpoint, null);
    assert.equal(store.goals.controlReceipt(actor, goal.createdByRunId)?.action, 'create');
    assert.throws(() => store.goals.create(actor, goal.createdByRunId, '不能扩大授权', now), /授权/);
    assert.throws(() => store.goals.create(actor, 'unknown', '没有用户来源', now), /授权/);
    assert.throws(() => store.goals.create(actor, store.beginRun(null, now).id, '目标', '2026-10-22T11:00:00+08:00'), /UTC/);
  } finally { store.close(); }
});

test('Goal 创建失败不留下空 Goal、Plan 或 Step；Run 收据失败整体回滚', () => {
  const f = fixture();
  try {
    const source = f.store.beginRun(null, now);
    f.raw.exec("CREATE TRIGGER fail_create BEFORE INSERT ON run_events WHEN NEW.type='goal_control' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => f.store.goals.create(actor, source.id, '虚构目标', now), /fixture failure/);
    for (const table of ['goals', 'goal_plans', 'goal_steps', 'goal_executions']) assert.equal(f.raw.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
    assert.equal(f.store.getRun(source.id)?.status, 'running');
    assert.equal(f.store.goals.controlReceipt(actor, source.id), undefined);
  } finally { f.close(); }
});

test('两个独立进程竞争同一 ready 授权：只有一个领取，另一个不能增加 Run', async () => {
  const f = fixture();
  try {
    const goal = create(f.store);
    const code = `import { SqliteStore } from ${storeImport};
      const store = new SqliteStore(${JSON.stringify(f.path)});
      try { const claim=store.goals.claim(${JSON.stringify(actor)},${JSON.stringify(goal.id)},0,${JSON.stringify(now)});
        console.log(claim ? 'claimed' : 'none'); } catch { console.log('rejected'); } finally { store.close(); }`;
    const outcomes = await Promise.all([child(code), child(code)]);
    assert.ok(outcomes.every(outcome => outcome.code === 0), JSON.stringify(outcomes));
    assert.equal(outcomes.filter(outcome => outcome.output.trim() === 'claimed').length, 1);
    const view = f.store.goals.view(actor, goal.id);
    assert.equal(view.executions.length, 1); assert.equal(f.store.listRuns().length, 2);
    assert.equal(view.goal.readyInput, null); assert.equal(view.executions[0]?.run.taskId, null);
    assert.equal(view.executions[0]?.execution.triggerRunId, goal.createdByRunId);
    assert.equal(view.executions[0]?.execution.capabilityClass, 'text_only');
  } finally { f.close(); }
});

test('领取失败回滚 Goal、Run、Execution 和 Step；同一授权仍可合法领取', () => {
  const f = fixture();
  try {
    const goal = create(f.store);
    f.raw.exec("CREATE TRIGGER fail_claim BEFORE INSERT ON run_events WHEN NEW.type='goal_claimed' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => f.store.goals.claim(actor, goal.id, goal.revision, now), /fixture failure/);
    assert.equal(f.store.goals.get(actor, goal.id).status, 'ready');
    assert.equal(f.store.listRuns().length, 1); assert.equal(f.store.goals.view(actor, goal.id).steps[0]?.status, 'pending');
    f.raw.exec('DROP TRIGGER fail_claim');
    assert.ok(f.store.goals.claim(actor, goal.id, goal.revision, now));
  } finally { f.close(); }
});

test('bootstrap 完成只保存 v1 草稿；批准才创建不可变 Plan 与业务 Step', () => {
  const f = fixture();
  try {
    const goal = bootstrap(f.store), view = f.store.goals.view(actor, goal.id);
    assert.equal(goal.status, 'waiting_user'); assert.equal(goal.planRevision, 0); assert.equal(goal.currentStepId, null);
    assert.equal(view.steps.length, 1); assert.equal(view.steps[0]?.status, 'completed');
    assert.equal(view.checkpoint?.proposedPlan?.hash, goal.pendingAction?.hash);
    assert.equal(f.raw.prepare('SELECT count(*) AS n FROM goal_plans').get()!.n, 1);
    assert.throws(() => f.store.goals.continue(command(f.store, goal), goal.id, now), /计划/);
    const request = command(f.store, goal, '仅批准计划');
    assert.throws(() => f.store.goals.approvePlan(request, goal.id, 'wrong-hash', now), /草稿/);
    const accepted = f.store.goals.approvePlan(request, goal.id, goal.pendingAction!.hash, now);
    assert.equal(accepted.planRevision, 1); assert.equal(accepted.status, 'waiting_user'); assert.equal(accepted.readyInput, null);
    assert.equal(f.store.goals.view(actor, goal.id).steps.length, 3);
    assert.equal(f.raw.prepare('SELECT count(*) AS n FROM goal_plans').get()!.n, 2);
    assert.throws(() => f.raw.prepare("UPDATE goal_plans SET changeReason='篡改' WHERE revision=0").run(), /不可改写/);
    assert.throws(() => f.store.goals.approvePlan(request, goal.id, goal.pendingAction!.hash, now), /授权/);
    assert.equal(f.store.goals.claim(actor, goal.id, accepted.revision, now), undefined);
  } finally { f.close(); }
});

test('计划批准任一写入失败整体回滚，旧版本、草稿和步骤不变', () => {
  const f = fixture();
  try {
    const goal = bootstrap(f.store), before = f.store.goals.view(actor, goal.id);
    f.raw.exec("CREATE TRIGGER fail_approval BEFORE INSERT ON goal_plans WHEN NEW.revision=1 BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    const request = command(f.store, goal);
    assert.throws(() => f.store.goals.approvePlan(request, goal.id, goal.pendingAction!.hash, now, true), /fixture failure/);
    assert.deepEqual(f.store.goals.view(actor, goal.id), before);
    assert.equal(f.store.goals.controlReceipt(actor, request.sourceRunId), undefined);
  } finally { f.close(); }
});

for (const outcome of ['partial', 'complete', 'blocked'] as const) {
  test(`stepOutcome=${outcome} 的 Step/Execution/Goal 及 Checkpoint 映射`, () => {
    const store = new SqliteStore(':memory:');
    try {
      const goal = approved(store), claimed = store.goals.claim(actor, goal.id, goal.revision, now)!;
      const previous = goal.checkpointRunId;
      const execution = store.goals.commit(claimed.run.id, result(outcome), now);
      const view = store.goals.view(actor, goal.id), current = view.steps.find(item => item.id === claimed.execution.stepId)!;
      assert.equal(execution.status, 'committed'); assert.equal(store.getRun(claimed.run.id)?.status, 'succeeded');
      assert.equal(view.goal.status, outcome === 'blocked' ? 'blocked' : 'waiting_user');
      assert.equal(current.status, outcome === 'complete' ? 'completed' : outcome === 'blocked' ? 'blocked' : 'waiting_user');
      assert.equal(view.goal.checkpointRunId, claimed.run.id); assert.equal(view.checkpoint?.previousCheckpointRunId, previous);
      assert.equal(view.checkpoint?.inputSourceRunId, claimed.execution.triggerRunId);
      assert.equal(view.checkpoint?.executionRunId, claimed.run.id);
      assert.equal(view.goal.readyInput, null);
      assert.equal(store.goals.claim(actor, goal.id, view.goal.revision, now), undefined);
      assert.throws(() => store.goals.commit(claimed.run.id, result(), now), /已结束/);
      if (outcome === 'complete') assert.notEqual(view.goal.currentStepId, claimed.execution.stepId);
      else assert.equal(view.goal.currentStepId, claimed.execution.stepId);
      if (outcome === 'blocked') assert.throws(() => store.goals.continue(command(store, view.goal), goal.id, now), /重新生成/);
    } finally { store.close(); }
  });
}

test('Checkpoint 提交的最后事件失败时，Run、Step、Execution、指针和草稿全部回滚', () => {
  const f = fixture();
  try {
    const goal = approved(f.store), claim = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
    const before = f.store.goals.view(actor, goal.id), events = f.store.events(claim.run.id);
    f.raw.exec("CREATE TRIGGER fail_commit BEFORE INSERT ON run_events WHEN NEW.type='goal_checkpoint_committed' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => f.store.goals.commit(claim.run.id, result('complete'), now), /fixture failure/);
    assert.deepEqual(f.store.goals.view(actor, goal.id), before);
    assert.deepEqual(f.store.events(claim.run.id), events);
    f.raw.exec('DROP TRIGGER fail_commit');
    // 核对为未提交后保守结束；不重新执行模型，也不自动提交已有文本。
    f.store.goals.finishFailure(claim.run.id, 'interrupted', '提交失败待核对', now);
    const after = f.store.goals.view(actor, goal.id);
    assert.equal(after.goal.status, 'blocked'); assert.equal(after.goal.checkpointRunId, goal.checkpointRunId);
    assert.equal(after.executions.at(-1)?.run.status, 'interrupted');
  } finally { f.close(); }
});

test('不能从普通 finishRun 拆开 Goal Run 与 Checkpoint 的聚合事务', () => {
  const store = new SqliteStore(':memory:');
  try {
    const goal = create(store), claim = store.goals.claim(actor, goal.id, 0, now)!;
    assert.throws(() => store.finishRun(claim.run.id, 'succeeded', now), /GoalStore/);
    assert.equal(store.getRun(claim.run.id)?.status, 'running');
    assert.equal(store.goals.view(actor, goal.id).goal.checkpointRunId, null);
    assert.throws(() => store.goals.create(actor, claim.run.id, '后台扩大权限', now), /授权/);
  } finally { store.close(); }
});

for (const phase of ['claim', 'commit'] as const) {
  test(`延迟外键在 ${phase} 的 COMMIT 才失败，整个聚合仍回滚且连接可继续使用`, () => {
    const f = fixture();
    try {
      const goal = approved(f.store);
      if (phase === 'claim') {
        const before = f.store.goals.view(actor, goal.id), runCount = f.store.listRuns().length;
        f.raw.exec("CREATE TRIGGER late_failure AFTER INSERT ON goal_executions BEGIN UPDATE goals SET currentStepId='nonexistent' WHERE id=NEW.goalId; END");
        assert.throws(() => f.store.goals.claim(actor, goal.id, goal.revision, now), /FOREIGN KEY/);
        assert.deepEqual(f.store.goals.view(actor, goal.id), before); assert.equal(f.store.listRuns().length, runCount);
      } else {
        const claim = f.store.goals.claim(actor, goal.id, goal.revision, now)!, before = f.store.goals.view(actor, goal.id);
        f.raw.exec(`CREATE TRIGGER late_failure AFTER INSERT ON run_events WHEN NEW.type='goal_checkpoint_committed'
          BEGIN UPDATE goals SET checkpointRunId='nonexistent' WHERE id='${goal.id}'; END`);
        assert.throws(() => f.store.goals.commit(claim.run.id, result(), now), /FOREIGN KEY/);
        assert.deepEqual(f.store.goals.view(actor, goal.id), before);
      }
      f.raw.exec('DROP TRIGGER late_failure');
      assert.equal(f.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
      assert.ok(f.store.beginRun(null, now).id);
    } finally { f.close(); }
  });
}

test('取消与结果提交跨进程竞争：只接受一个事务顺序，过期控制不得声称成功', async () => {
  const f = fixture();
  try {
    const goal = approved(f.store), claim = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
    const request = command(f.store, claim.goal, '取消此目标');
    const prelude = `import { SqliteStore } from ${storeImport};const store=new SqliteStore(${JSON.stringify(f.path)});`;
    const outcomes = await Promise.all([
      child(`${prelude}try { store.goals.commit(${JSON.stringify(claim.run.id)},${JSON.stringify(result())},${JSON.stringify(now)}); console.log('result'); }
        finally {store.close();}`),
      child(`${prelude}try { store.goals.control(${JSON.stringify(request)},${JSON.stringify(goal.id)},'cancel',${JSON.stringify(now)});console.log('cancel'); }
        catch (error) { if(!error.message.includes('revision')) throw error; console.log('stale-control'); } finally {store.close();}`),
    ]);
    assert.ok(outcomes.every(item => item.code === 0), JSON.stringify(outcomes));
    const view = f.store.goals.view(actor, goal.id), receipt = f.store.goals.controlReceipt(actor, request.sourceRunId);
    if (receipt) {
      assert.equal(view.goal.status, 'cancelled'); assert.equal(view.executions.at(-1)?.execution.status, 'discarded');
      assert.equal(view.goal.checkpointRunId, goal.checkpointRunId);
    } else {
      assert.equal(outcomes[1]?.output.trim(), 'stale-control');
      assert.equal(view.goal.status, 'waiting_user'); assert.equal(view.goal.checkpointRunId, claim.run.id);
    }
    assert.equal(view.executions.length, 2); assert.equal(view.goal.readyInput, null);
  } finally { f.close(); }
});

for (const action of ['pause', 'cancel'] as const) {
  test(`${action} 先提交，迟到结果被 discarded，不移动 Checkpoint`, () => {
    const store = new SqliteStore(':memory:');
    try {
      const goal = approved(store), claim = store.goals.claim(actor, goal.id, goal.revision, now)!;
      const controlled = store.goals.control(command(store, claim.goal), goal.id, action, now);
      assert.equal(controlled.status, 'running'); assert.equal(controlled.controlRequested, action);
      const execution = store.goals.commit(claim.run.id, result('complete'), now);
      const after = store.goals.get(actor, goal.id);
      assert.equal(execution.status, 'discarded'); assert.equal(execution.checkpoint, null);
      assert.equal(after.status, action === 'pause' ? 'paused' : 'cancelled');
      assert.equal(after.checkpointRunId, goal.checkpointRunId); assert.equal(after.controlRequested, null);
      assert.equal(store.getRun(claim.run.id)?.status, 'succeeded');
      assert.equal(store.goals.view(actor, goal.id).steps.find(item => item.id === claim.execution.stepId)?.status, 'blocked');
    } finally { store.close(); }
  });
  test(`结果先提交，${action} 只影响后续推进，保留新成果`, () => {
    const store = new SqliteStore(':memory:');
    try {
      const goal = approved(store), claim = store.goals.claim(actor, goal.id, goal.revision, now)!;
      store.goals.commit(claim.run.id, result(), now);
      const finished = store.goals.get(actor, goal.id);
      const after = store.goals.control(command(store, finished), goal.id, action, now);
      assert.equal(after.status, action === 'pause' ? 'paused' : 'cancelled');
      assert.equal(after.checkpointRunId, claim.run.id);
      assert.equal(store.goals.view(actor, goal.id).checkpoint?.artifactText, '虚构分析结果');
    } finally { store.close(); }
  });
}

for (const control of ['none', 'pause', 'cancel'] as const) {
  test(`真实子进程退出后恢复 ${control}，持久控制优先且无自动授权`, async () => {
    const f = fixture();
    try {
      const goal = approved(f.store);
      const run = await child(`import { SqliteStore } from ${storeImport};
        const store=new SqliteStore(${JSON.stringify(f.path)}), actor=${JSON.stringify(actor)}, now=${JSON.stringify(now)};
        const claim=store.goals.claim(actor,${JSON.stringify(goal.id)},${goal.revision},now);
        if (${JSON.stringify(control)}!=='none') store.goals.control({actor,sourceRunId:store.beginRun(null,now).id,
          expectedRevision:claim.goal.revision,text:'当前用户停止请求'},claim.goal.id,${JSON.stringify(control)},now);
        console.log(claim.run.id); process.exit(77);`);
      assert.equal(run.code, 77, run.output);
      const runId = run.output.trim();
      f.store.recoverInterrupted(now);
      const after = f.store.goals.view(actor, goal.id), eventCount = f.store.events(runId).length;
      assert.equal(after.goal.status, control === 'pause' ? 'paused' : control === 'cancel' ? 'cancelled' : 'blocked');
      assert.equal(after.goal.controlRequested, null); assert.equal(after.goal.readyInput, null);
      assert.equal(after.goal.checkpointRunId, goal.checkpointRunId);
      assert.equal(after.executions.at(-1)?.execution.status, 'interrupted');
      assert.equal(after.executions.at(-1)?.run.status, 'interrupted');
      assert.equal(f.store.recoverInterrupted(now), 0); assert.equal(f.store.events(runId).length, eventCount);
      if (control === 'cancel') assert.throws(() => f.store.goals.continue(command(f.store, after.goal), goal.id, now, true), /不能继续/);
      else {
        assert.throws(() => f.store.goals.continue(command(f.store, after.goal), goal.id, now), /重新生成/);
        const ready = f.store.goals.continue(command(f.store, after.goal, '已核对中断，重新生成当前纯文本一段'), goal.id, now, true);
        const next = f.store.goals.claim(actor, goal.id, ready.revision, now)!;
        assert.notEqual(next.run.id, runId); assert.equal(next.execution.sequence, 3);
        assert.equal(next.execution.input.previousCheckpoint?.executionRunId, goal.checkpointRunId);
      }
    } finally { f.close(); }
  });
}

test('ready 未消费授权和待批准草稿跨关闭重开持久化；暂停草稿后继续只恢复审批', () => {
  const f = fixture();
  try {
    const ready = create(f.store);
    const second = new SqliteStore(f.path);
    try {
      second.recoverInterrupted(now);
      assert.ok(second.goals.claim(actor, ready.id, ready.revision, now));
    } finally { second.close(); }
    f.store.recoverInterrupted(now);
    const goal = bootstrap(f.store), paused = f.store.goals.control(command(f.store, goal), goal.id, 'pause', now);
    const reopened = new SqliteStore(f.path);
    try {
      reopened.recoverInterrupted(now);
      const restored = reopened.goals.get(actor, goal.id);
      assert.deepEqual(restored.pendingAction, goal.pendingAction);
      const resumed = reopened.goals.continue(command(reopened, restored), goal.id, now);
      assert.equal(resumed.status, 'waiting_user'); assert.equal(resumed.readyInput, null);
      assert.equal(reopened.goals.claim(actor, goal.id, resumed.revision, now), undefined);
      assert.equal(paused.checkpointRunId, resumed.checkpointRunId);
    } finally { reopened.close(); }
  } finally { f.close(); }
});

test('cancel 覆盖停止中的 pause；pause 不能覆盖 cancel；控制失败整体回滚', () => {
  const f = fixture();
  try {
    const goal = create(f.store), claim = f.store.goals.claim(actor, goal.id, 0, now)!;
    const paused = f.store.goals.control(command(f.store, claim.goal), goal.id, 'pause', now);
    f.raw.exec("CREATE TRIGGER fail_control BEFORE INSERT ON run_events WHEN NEW.type='goal_control' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => f.store.goals.control(command(f.store, paused), goal.id, 'cancel', now), /fixture failure/);
    assert.equal(f.store.goals.get(actor, goal.id).controlRequested, 'pause');
    f.raw.exec('DROP TRIGGER fail_control');
    const cancelled = f.store.goals.control(command(f.store, paused), goal.id, 'cancel', now);
    assert.throws(() => f.store.goals.control(command(f.store, cancelled), goal.id, 'pause', now), /优先/);
    f.store.recoverInterrupted(now);
    assert.equal(f.store.goals.get(actor, goal.id).status, 'cancelled');
  } finally { f.close(); }
});

test('前台控制已提交但聊天/投递失败；Checkpoint 通知丢失均可只读重展示', () => {
  const f = fixture();
  try {
    const goal = bootstrap(f.store), request = command(f.store, goal, '批准但不执行');
    const approvedGoal = f.store.goals.approvePlan(request, goal.id, goal.pendingAction!.hash, now);
    f.store.finishRun(request.sourceRunId, 'failed', now, undefined, '聊天后续失败');
    f.store.deliveryFailed(request.sourceRunId, '前台发送失败');
    const cpRun = goal.checkpointRunId!;
    f.store.deliveryFailed(cpRun, 'Checkpoint 通知失败');
    const second = new SqliteStore(f.path);
    try {
      second.recoverInterrupted(now);
      const count = second.listRuns().length;
      const receipt = second.goals.controlReceipt(actor, request.sourceRunId)!;
      assert.equal(receipt.action, 'approve_plan'); assert.equal(receipt.revision, approvedGoal.revision);
      const view = second.goals.view(actor, receipt.goalId);
      assert.equal(view.plan.revision, 1); assert.equal(view.checkpoint?.artifactText, '虚构分析结果');
      assert.equal(view.executions[0]?.run.deliveryError, 'Checkpoint 通知失败');
      assert.equal(view.executions[0]?.execution.status, 'committed');
      assert.equal(second.listRuns().length, count); assert.equal(view.goal.readyInput, null);
      assert.equal(second.goals.claim(actor, goal.id, view.goal.revision, now), undefined);
    } finally { second.close(); }
  } finally { f.close(); }
});

test('Plan v2 保留完成步骤原义和 v1 快照；旧步骤 superseded，新定义使用新 ID', () => {
  const f = fixture();
  try {
    const goal = approved(f.store), plan1 = f.store.goals.view(actor, goal.id).plan;
    const first = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
    f.store.goals.commit(first.run.id, result('complete'), now);
    const waiting = f.store.goals.get(actor, goal.id);
    const ready = f.store.goals.continue(command(f.store, waiting), goal.id, now);
    const second = f.store.goals.claim(actor, goal.id, ready.revision, now)!;
    const unchanged = plan1.spec.steps[0]!;
    assert.throws(() => f.store.goals.commit(second.run.id, { ...result(), proposedPlan: { steps: [{ ...unchanged, instruction: '篡改已完成原义' }], changeReason: '坏计划' } }, now), /定义/);
    f.store.goals.commit(second.run.id, { ...result(), proposedPlan: { steps: [unchanged, step('调整练习')], changeReason: '根据反馈调整' } }, now);
    const draft = f.store.goals.get(actor, goal.id);
    const accepted = f.store.goals.approvePlan(command(f.store, draft), goal.id, draft.pendingAction!.hash, now);
    const view = f.store.goals.view(actor, goal.id);
    assert.equal(accepted.planRevision, 2); assert.equal(view.plan.baseRevision, 1);
    assert.equal(view.steps.find(item => item.id === unchanged.stepId)?.status, 'completed');
    assert.equal(view.steps.find(item => item.id === second.execution.stepId)?.status, 'superseded');
    assert.deepEqual(JSON.parse(String(f.raw.prepare('SELECT specJson FROM goal_plans WHERE goalId=? AND revision=1').get(goal.id)!.specJson)), plan1.spec);
    assert.equal(f.raw.prepare('SELECT count(*) AS n FROM goal_plans WHERE goalId=?').get(goal.id)!.n, 3);
  } finally { f.close(); }
});

test('所有业务步骤完成后仍等待用户明确确认；不能仅靠模型宣称完成 Goal', () => {
  const store = new SqliteStore(':memory:');
  try {
    let goal = approved(store);
    for (let i = 0; i < 2; i++) {
      const claim = store.goals.claim(actor, goal.id, goal.revision, now)!;
      store.goals.commit(claim.run.id, result('complete'), now);
      goal = store.goals.get(actor, goal.id);
      if (i === 0) {
        assert.throws(() => store.goals.control(command(store, goal), goal.id, 'complete', now), /当前计划/);
        goal = store.goals.continue(command(store, goal), goal.id, now);
      }
    }
    assert.equal(goal.status, 'waiting_user'); assert.equal(goal.currentStepId, null);
    goal = store.goals.control(command(store, goal, '暂停这个目标'), goal.id, 'pause', now);
    goal = store.goals.continue(command(store, goal, '恢复到待确认完成'), goal.id, now);
    assert.equal(goal.status, 'waiting_user'); assert.equal(goal.readyInput, null);
    assert.equal(store.goals.claim(actor, goal.id, goal.revision, now), undefined);
    goal = store.goals.control(command(store, goal, '我确认这个目标已经达成'), goal.id, 'complete', now);
    assert.equal(goal.status, 'completed'); assert.equal(goal.finishedAt, now);
    assert.throws(() => store.goals.continue(command(store, goal), goal.id, now), /不能继续/);
    assert.throws(() => store.goals.control(command(store, goal), goal.id, 'cancel', now), /终态/);
  } finally { store.close(); }
});

test('失败与中断不移动旧 Checkpoint；新的显式重新生成使用新 Execution', () => {
  const store = new SqliteStore(':memory:');
  try {
    for (const kind of ['failed', 'interrupted'] as const) {
      const goal = approved(store), claim = store.goals.claim(actor, goal.id, goal.revision, now)!;
      store.goals.finishFailure(claim.run.id, kind, '模拟模型未完成', now);
      const after = store.goals.view(actor, goal.id);
      assert.equal(after.goal.status, 'blocked'); assert.equal(after.goal.checkpointRunId, goal.checkpointRunId);
      assert.equal(after.executions.at(-1)?.execution.status, kind);
      assert.equal(after.steps.find(item => item.id === claim.execution.stepId)?.status, kind === 'failed' ? 'failed' : 'blocked');
      assert.equal(store.goals.claim(actor, goal.id, after.goal.revision, now), undefined);
    }
  } finally { store.close(); }
});

test('Run 已成功但无 Checkpoint 的异常组合保守 uncertain，不能从文本猜进度', () => {
  const f = fixture();
  try {
    const goal = approved(f.store), claim = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
    f.raw.prepare("UPDATE runs SET status='succeeded',output='文本声称成功' WHERE id=?").run(claim.run.id);
    f.store.recoverInterrupted(now);
    const view = f.store.goals.view(actor, goal.id);
    assert.equal(view.executions.at(-1)?.execution.status, 'uncertain');
    assert.equal(view.goal.status, 'blocked'); assert.equal(view.goal.blockedReason, 'invariant_violation');
    assert.equal(view.goal.checkpointRunId, goal.checkpointRunId);
    assert.throws(() => f.store.goals.continue(command(f.store, view.goal), goal.id, now, true), /人工核对/);
    assert.throws(() => f.store.goals.recoverInTransaction(now), /同连接事务/);
  } finally { f.close(); }
});

test('跨用户/渠道、旧 revision、跨 Goal Step、旧来源和后台 Task Run 均无授权', () => {
  const store = new SqliteStore(':memory:');
  try {
    const goal = approved(store), other = approved(store);
    const wrongActor = { ...actor, ownerId: 'other-user' };
    assert.throws(() => store.goals.view(wrongActor, goal.id), /无权/);
    assert.throws(() => store.goals.claim({ ...actor, target: { channel: 'feishu', appId: 'app', chatId: 'chat', userOpenId: 'user' } }, goal.id, goal.revision, now), /无权/);
    assert.throws(() => store.goals.claim(actor, goal.id, 0, now), /revision/);
    const claim = store.goals.claim(actor, goal.id, goal.revision, now)!;
    assert.throws(() => store.goals.commit(claim.run.id, { ...result(), proposedPlan: { steps: [store.goals.view(actor, other.id).plan.spec.steps[0]!], changeReason: '跨目标' } }, now), /跨目标/);
    const task = store.createTask('旧提醒', now, now), taskRun = store.claimDue(now)!.run;
    assert.equal(taskRun.taskId, task.id);
    assert.throws(() => store.goals.create(actor, taskRun.id, '后台工具越权', now), /授权/);
    store.goals.commit(claim.run.id, result(), now);
    const waiting = store.goals.get(actor, goal.id);
    assert.throws(() => store.goals.continue({ actor, sourceRunId: goal.createdByRunId, expectedRevision: waiting.revision, text: '历史继续' }, goal.id, now), /授权/);
  } finally { store.close(); }
});

test('Checkpoint 外键拒绝跨 Goal 指针；已提交 Execution 不可改写', () => {
  const f = fixture();
  try {
    const goal = bootstrap(f.store), other = bootstrap(f.store);
    assert.throws(() => f.raw.prepare('UPDATE goals SET checkpointRunId=? WHERE id=?').run(other.checkpointRunId, goal.id), /FOREIGN KEY/);
    assert.throws(() => f.raw.prepare("UPDATE goal_executions SET checkpointJson='{}' WHERE runId=?").run(goal.checkpointRunId), /不可改写/);
    assert.equal(f.store.goals.view(actor, goal.id).checkpoint?.executionRunId, goal.checkpointRunId);
    assert.equal(f.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { f.close(); }
});

test('共享恢复故障整体回滚旧 Task/Run 与 Goal；旧唯一约束及一次性终态不变', () => {
  const f = fixture();
  try {
    const pending = f.store.createTask('未到期旧提醒', '2026-10-23T00:00:00.000Z', now);
    const task = f.store.createTask('到期旧提醒', now, now), taskClaim = f.store.claimDue(now)!;
    const goal = create(f.store), claim = f.store.goals.claim(actor, goal.id, 0, now)!;
    assert.throws(() => f.store.beginRun(task.id, now), /UNIQUE/);
    f.raw.exec("CREATE TRIGGER fail_recover BEFORE INSERT ON run_events WHEN NEW.type='goal_execution_stopped' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
    assert.throws(() => f.store.recoverInterrupted(now), /fixture failure/);
    assert.equal(f.store.getRun(taskClaim.run.id)?.status, 'running'); assert.equal(f.store.getTask(task.id)?.status, 'running');
    assert.equal(f.store.getRun(claim.run.id)?.status, 'running'); assert.equal(f.store.goals.get(actor, goal.id).status, 'running');
    f.raw.exec('DROP TRIGGER fail_recover');
    f.store.recoverInterrupted(now);
    assert.equal(f.store.getTask(task.id)?.status, 'interrupted'); assert.equal(f.store.getTask(pending.id)?.status, 'pending');
    assert.equal(f.store.claimDue(now), undefined); assert.equal(f.store.goals.get(actor, goal.id).status, 'blocked');
    assert.equal(f.raw.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { f.close(); }
});

test('Goal 存储文本与收据沿用宿主脱敏，无模型调用或 Memory/Session 写入', () => {
  const store = new SqliteStore(':memory:', redactor('fixture-secret'));
  try {
    const goal = store.goals.create(actor, store.beginRun(null, now).id, '虚构目标 fixture-secret', now);
    const claim = store.goals.claim(actor, goal.id, 0, now)!;
    store.goals.commit(claim.run.id, { ...result(), artifactText: '结果 fixture-secret' }, now);
    const view = store.goals.view(actor, goal.id);
    assert.ok(!JSON.stringify(view).includes('fixture-secret'));
    assert.match(view.checkpoint!.artifactText, /REDACTED/);
    assert.deepEqual(store.modelCalls(claim.run.id), []);
    assert.deepEqual(store.formation.jobs(), []);
    assert.deepEqual(store.listTasks(), []);
  } finally { store.close(); }
});
