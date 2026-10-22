import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parse = (value: unknown) => JSON.parse(String(value));

// 仅核对显式给定数据库，不加载.env、不建表、不调用模型、不输出目标/成果/接收人正文。
export function auditGoals(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec('BEGIN'); // 同一只读快照，避免并发提交期间跨表读到不同版本。
    const violations: string[] = [];
    const goals = db.prepare('SELECT * FROM goals ORDER BY createdAt,id').all();
    const executions = db.prepare('SELECT e.*,r.status AS runStatus,r.taskId FROM goal_executions e JOIN runs r ON e.runId=r.id').all();
    const plans = db.prepare('SELECT * FROM goal_plans').all();
    for (const plan of plans) if (hash(parse(plan.specJson)) !== plan.hash) violations.push(`plan_hash:${plan.goalId}:${plan.revision}`);
    for (const execution of executions) {
      if (execution.taskId !== null || hash(parse(execution.inputJson)) !== execution.inputHash) violations.push(`execution_input:${execution.runId}`);
      if (execution.status === 'committed') {
        const checkpoint = parse(execution.checkpointJson);
        if (execution.runStatus !== 'succeeded' || hash(checkpoint) !== execution.checkpointHash || checkpoint.executionRunId !== execution.runId
          || checkpoint.goalId !== execution.goalId || checkpoint.stepId !== execution.stepId || checkpoint.previousCheckpointRunId !== execution.baseCheckpointRunId) violations.push(`checkpoint:${execution.runId}`);
      } else if (execution.checkpointJson !== null || execution.status === 'running' && execution.runStatus !== 'running') violations.push(`execution_status:${execution.runId}`);
    }
    const summary = goals.map(goal => {
      const attempts = executions.filter(item => item.goalId === goal.id), active = attempts.filter(item => item.status === 'running');
      const plan = plans.find(item => item.goalId === goal.id && item.revision === goal.planRevision);
      const steps = db.prepare('SELECT * FROM goal_steps WHERE goalId=?').all(String(goal.id));
      if (!plan || parse(plan.specJson).objectiveHash !== hash(goal.objective)) violations.push(`current_plan:${goal.id}`);
      if ((goal.status === 'running' ? 1 : 0) !== active.length) violations.push(`active_execution:${goal.id}`);
      if (goal.checkpointRunId && !attempts.some(item => item.runId === goal.checkpointRunId && item.status === 'committed')) violations.push(`checkpoint_pointer:${goal.id}`);
      if (goal.currentStepId && !steps.some(item => item.id === goal.currentStepId)) violations.push(`step_pointer:${goal.id}`);
      if ((goal.status === 'ready') !== !!goal.readyInputJson) violations.push(`ready_input:${goal.id}`);
      if (goal.readyInputJson) {
        const input = parse(goal.readyInputJson);
        if (executions.some(item => item.triggerRunId === input.triggerRunId)) violations.push(`consumed_authorization:${goal.id}`);
      }
      if (goal.pendingActionJson) {
        const { hash: fingerprint, ...draft } = parse(goal.pendingActionJson);
        if (hash(draft) !== fingerprint || draft.baseRevision !== goal.planRevision) violations.push(`plan_draft:${goal.id}`);
      }
      return { id: goal.id, status: goal.status, revision: goal.revision, planRevision: goal.planRevision,
        checkpointRunId: goal.checkpointRunId, pendingPlan: !!goal.pendingActionJson, executions: attempts.length,
        committed: attempts.filter(item => item.status === 'committed').length,
        deliveryErrors: db.prepare('SELECT count(*) AS n FROM runs r JOIN goal_executions e ON e.runId=r.id WHERE e.goalId=? AND r.deliveryError IS NOT NULL').get(String(goal.id))!.n };
    });
    if (db.prepare('PRAGMA foreign_key_check').all().length) violations.push('foreign_keys');
    return { mode: 'read-only-sqlite-audit', passed: violations.length === 0, goals: summary, violations };
  } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) { console.error('用法：node --import tsx scripts/audit-goals.ts <隔离数据库绝对路径>'); process.exitCode = 1; }
  else {
    try { const report = auditGoals(resolve(process.argv[2]!)); console.log(JSON.stringify(report, null, 2)); if (!report.passed) process.exitCode = 1; }
    catch { console.error('只读Goal核对失败，请确认隔离数据库路径和结构；没有创建或修复数据库。'); process.exitCode = 1; }
  }
}
