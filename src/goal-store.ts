import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SkillCatalog, SkillSnapshot } from './skill-service.js';
import type { WebReadStore } from './web-read-store.js';
import type { GoalWebSelection } from './web-read-types.js';
import type { Run, RunStatus } from './contracts.js';
import { validatePlanQuantity, validateQuantityApproval } from './goal-plan-quantity.js';
import type {
  Goal, GoalActor, GoalCheckpoint, GoalCommand, GoalControlReceipt, GoalExecution,
  GoalExecutionInput, GoalPlan, GoalPlanDraft, GoalPlanSpec, GoalResult, GoalStep, GoalView,
} from './goal-types.js';

interface RunTransactions {
  transaction<T>(fn: () => T): T;
  begin(now: string): Run;
  finish(id: string, status: Exclude<RunStatus, 'running'>, now: string, output?: string, error?: string): void;
  event(runId: string, type: string, details: string, now: string): void;
  redact(value: unknown): string;
}
type Row = Record<string, unknown>;
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const json = <T>(value: unknown): T => JSON.parse(String(value)) as T;
const binding = (actor: GoalActor): string => hash([actor.ownerId, actor.target.channel === 'console'
  ? ['console'] : ['feishu', actor.target.appId, actor.target.chatId, actor.target.userOpenId]]);

// 仅负责同连接的短事务；没有调度、模型调用或自然语言授权能力。
export class GoalStore {
  web?: WebReadStore;
  private skills?: SkillCatalog;
  setSkills(skills?: SkillCatalog): void { this.skills = skills; }
  policy?: {
    consume(goal: Goal, authorization: NonNullable<Goal['readyInput']>, now: string): Run | undefined;
    current(execution: GoalExecution, now: string): boolean;
    settled(execution: GoalExecution, goal: Goal, now: string): void;
  };
  constructor(private readonly db: DatabaseSync, private readonly tx: RunTransactions) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, ownerId TEXT NOT NULL, accessKey TEXT NOT NULL,
        targetJson TEXT NOT NULL CHECK(json_valid(targetJson)), objective TEXT NOT NULL,
        createdByRunId TEXT NOT NULL UNIQUE REFERENCES runs(id),
        status TEXT NOT NULL CHECK(status IN ('ready','running','waiting_user','paused','blocked','completed','cancelled')),
        revision INTEGER NOT NULL CHECK(revision>=0), planRevision INTEGER NOT NULL CHECK(planRevision>=0),
        currentStepId TEXT, checkpointRunId TEXT, readyInputJson TEXT, pendingActionJson TEXT,
        controlRequested TEXT CHECK(controlRequested IN ('pause','cancel')),
        blockedReason TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, finishedAt TEXT,
        CHECK((status='ready')=(readyInputJson IS NOT NULL)),
        CHECK(controlRequested IS NULL OR status='running'),
        CHECK(readyInputJson IS NULL OR json_valid(readyInputJson)),
        CHECK(pendingActionJson IS NULL OR json_valid(pendingActionJson)),
        FOREIGN KEY(id,planRevision) REFERENCES goal_plans(goalId,revision) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(id,currentStepId) REFERENCES goal_steps(goalId,id) DEFERRABLE INITIALLY DEFERRED,
        FOREIGN KEY(id,checkpointRunId) REFERENCES goal_executions(goalId,runId) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_plans (
        goalId TEXT NOT NULL REFERENCES goals(id), revision INTEGER NOT NULL CHECK(revision>=0),
        baseRevision INTEGER, sourceRunId TEXT NOT NULL REFERENCES runs(id),
        approvedByRunId TEXT REFERENCES runs(id), specJson TEXT NOT NULL CHECK(json_valid(specJson)),
        changeReason TEXT NOT NULL, hash TEXT NOT NULL, createdAt TEXT NOT NULL,
        PRIMARY KEY(goalId,revision),
        CHECK((revision=0 AND baseRevision IS NULL AND approvedByRunId IS NULL)
          OR (revision>0 AND baseRevision=revision-1 AND approvedByRunId IS NOT NULL))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_steps (
        id TEXT PRIMARY KEY, goalId TEXT NOT NULL REFERENCES goals(id),
        status TEXT NOT NULL CHECK(status IN ('pending','running','waiting_user','completed','failed','blocked','superseded')),
        lastExecutionRunId TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
        UNIQUE(goalId,id),
        FOREIGN KEY(goalId,id,lastExecutionRunId) REFERENCES goal_executions(goalId,stepId,runId) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_executions (
        runId TEXT PRIMARY KEY REFERENCES runs(id), goalId TEXT NOT NULL REFERENCES goals(id),
        stepId TEXT NOT NULL, planRevision INTEGER NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0),
        triggerRunId TEXT NOT NULL UNIQUE REFERENCES runs(id), baseGoalRevision INTEGER NOT NULL,
        baseCheckpointRunId TEXT, capabilityClass TEXT NOT NULL CHECK(capabilityClass='text_only'),
        status TEXT NOT NULL CHECK(status IN ('running','committed','failed','interrupted','discarded','uncertain')),
        inputJson TEXT NOT NULL CHECK(json_valid(inputJson)), inputHash TEXT NOT NULL,
        checkpointJson TEXT, checkpointHash TEXT, reasonCode TEXT,
        UNIQUE(goalId,runId), UNIQUE(goalId,stepId,runId), UNIQUE(goalId,sequence), CHECK(runId<>triggerRunId),
        CHECK((status='committed')=(checkpointJson IS NOT NULL)),
        CHECK((checkpointJson IS NULL)=(checkpointHash IS NULL)),
        CHECK(checkpointJson IS NULL OR json_valid(checkpointJson)),
        FOREIGN KEY(goalId,stepId) REFERENCES goal_steps(goalId,id),
        FOREIGN KEY(goalId,planRevision) REFERENCES goal_plans(goalId,revision),
        FOREIGN KEY(goalId,baseCheckpointRunId) REFERENCES goal_executions(goalId,runId)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS goal_one_running ON goal_executions(goalId) WHERE status='running';
      CREATE UNIQUE INDEX IF NOT EXISTS step_one_running ON goal_executions(stepId) WHERE status='running';
      CREATE INDEX IF NOT EXISTS goal_ready_queue ON goals(status,updatedAt,id);
      CREATE TRIGGER IF NOT EXISTS goal_plan_immutable BEFORE UPDATE ON goal_plans
        BEGIN SELECT RAISE(ABORT,'Goal Plan 不可改写'); END;
      CREATE TRIGGER IF NOT EXISTS goal_execution_immutable BEFORE UPDATE ON goal_executions WHEN OLD.status<>'running'
        BEGIN SELECT RAISE(ABORT,'已结束 Goal Execution 不可改写'); END;
    `);
  }

  private text(value: string, limit: number): string {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value, 'utf8') > limit) throw new Error('Goal 文本为空或超出容量');
    return this.tx.redact(value.trim());
  }

  private time(now: string): void {
    if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw new Error('Goal 时间必须为规范 UTC ISO');
  }

  private goal(row: Row): Goal {
    const { targetJson, readyInputJson, pendingActionJson, ...fields } = row;
    return { ...fields, target: json(targetJson), readyInput: readyInputJson === null ? null : json(readyInputJson),
      pendingAction: pendingActionJson === null ? null : json(pendingActionJson) } as Goal;
  }

  private execution(row: Row): GoalExecution {
    const { inputJson, checkpointJson, ...fields } = row;
    return { ...fields, input: json(inputJson), checkpoint: checkpointJson === null ? null : json(checkpointJson) } as GoalExecution;
  }

  get(actor: GoalActor, id: string): Goal {
    const row = this.db.prepare('SELECT * FROM goals WHERE id=? AND ownerId=? AND accessKey=?').get(id, actor.ownerId, binding(actor));
    if (!row) throw new Error('Goal 不存在或无权访问');
    return this.goal(row);
  }

  list(actor: GoalActor): Goal[] {
    return this.db.prepare('SELECT * FROM goals WHERE ownerId=? AND accessKey=? ORDER BY createdAt DESC,rowid DESC LIMIT 101')
      .all(actor.ownerId, binding(actor)).map(row => this.goal(row));
  }

  // 仅供可信 Runner 扫描；领取仍须验证绑定、版本和一次授权。
  readyForHost(): Goal[] {
    return this.db.prepare("SELECT * FROM goals WHERE status='ready' ORDER BY updatedAt,id").all().map(row => this.goal(row));
  }

  executionForHost(runId: string): GoalExecution {
    const row = this.db.prepare('SELECT * FROM goal_executions WHERE runId=?').get(runId);
    if (!row) throw new Error('Goal Execution 不存在');
    const execution = this.execution(row);
    if (hash(execution.input) !== execution.inputHash || execution.checkpoint && hash(execution.checkpoint) !== execution.checkpointHash) throw new Error('Goal Execution Hash 不一致');
    return execution;
  }

  private plan(goal: Goal): GoalPlan {
    const row = this.db.prepare('SELECT * FROM goal_plans WHERE goalId=? AND revision=?').get(goal.id, goal.planRevision);
    if (!row) throw new Error('Goal Plan 不一致');
    const { specJson, ...fields } = row;
    if (hash(json(specJson)) !== row.hash) throw new Error('Goal Plan Hash 不一致');
    return { ...fields, spec: json(specJson) } as GoalPlan;
  }

  private checkpoint(goal: Goal): GoalCheckpoint | null {
    if (!goal.checkpointRunId) return null;
    const row = this.db.prepare("SELECT * FROM goal_executions WHERE goalId=? AND runId=? AND status='committed'").get(goal.id, goal.checkpointRunId);
    if (!row || hash(json(row.checkpointJson)) !== row.checkpointHash) throw new Error('Goal Checkpoint 指针或 Hash 不一致');
    return json(row.checkpointJson);
  }

  view(actor: GoalActor, id: string): GoalView {
    return this.tx.transaction(() => {
      const goal = this.get(actor, id);
      const rows = this.db.prepare('SELECT * FROM goal_executions WHERE goalId=? ORDER BY sequence').all(id);
      return { goal, plan: this.plan(goal), checkpoint: this.checkpoint(goal),
        steps: this.db.prepare('SELECT * FROM goal_steps WHERE goalId=? ORDER BY rowid').all(id) as unknown as GoalStep[],
        executions: rows.map(row => ({ execution: this.execution(row),
          run: this.db.prepare('SELECT * FROM runs WHERE id=?').get(String(row.runId)) as unknown as Run })) };
    });
  }

  controlReceipt(actor: GoalActor, sourceRunId: string): GoalControlReceipt | undefined {
    const row = this.db.prepare("SELECT details FROM run_events WHERE runId=? AND type='goal_control' ORDER BY id LIMIT 1").get(sourceRunId);
    if (!row) return undefined;
    const receipt = json<GoalControlReceipt>(row.details);
    this.get(actor, receipt.goalId);
    return receipt;
  }

  private source(sourceRunId: string): void {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(sourceRunId);
    if (!run || run.taskId !== null || run.status !== 'running'
      || this.db.prepare('SELECT 1 FROM goal_executions WHERE runId=? OR triggerRunId=?').get(sourceRunId, sourceRunId)
      || this.db.prepare("SELECT 1 FROM run_events WHERE runId=? AND type='goal_control'").get(sourceRunId)) {
      throw new Error('需要新的宿主用户授权 Run；禁止重复或后台执行授权');
    }
    if (this.db.prepare('SELECT 1 FROM goal_grants WHERE sourceRunId=? OR executionRunId=?').get(sourceRunId, sourceRunId)
      || this.db.prepare('SELECT 1 FROM goal_policy_events WHERE sourceRunId=?').get(sourceRunId)) throw new Error('策略或触发 Run 不是新的用户操作');
  }

  private command(command: GoalCommand, id: string, now: string): Goal {
    this.time(now); this.text(command.text, 16_000); this.source(command.sourceRunId);
    const goal = this.get(command.actor, id);
    if (goal.revision !== command.expectedRevision) throw new Error('Goal revision 已变化，请重新展示');
    return goal;
  }

  private receipt(goal: Goal, sourceRunId: string, action: GoalControlReceipt['action'], now: string): Goal {
    const receipt: GoalControlReceipt = { goalId: goal.id, action, revision: goal.revision, sourceRunId };
    this.tx.event(sourceRunId, 'goal_control', JSON.stringify(receipt), now);
    return goal;
  }

  create(actor: GoalActor, sourceRunId: string, objective: string, now: string): Goal {
    return this.tx.transaction(() => {
      this.time(now); this.source(sourceRunId); this.text(actor.ownerId, 256);
      const id = randomUUID(), stepId = randomUUID();
      const safeObjective = this.text(objective, 16_000);
      const spec: GoalPlanSpec = { objectiveHash: hash(safeObjective), steps: [{ stepId, title: '梳理目标与初步计划',
        instruction: '根据已知条件梳理目标，提出初步计划；缺少信息时询问用户，不虚构依据。',
        deliverable: '初步计划与需要用户补充的信息', doneWhen: '计划草稿已提交，等待用户批准' }] };
      const input = { triggerRunId: sourceRunId, text: safeObjective, kind: 'create' };
      this.db.prepare(`INSERT INTO goals (id,ownerId,accessKey,targetJson,objective,createdByRunId,status,revision,planRevision,
        currentStepId,createdAt,updatedAt,readyInputJson) VALUES (?,?,?,?,?,?,'ready',0,0,?,?,?,?)`)
        .run(id, actor.ownerId, binding(actor), JSON.stringify(actor.target), safeObjective, sourceRunId, stepId, now, now, JSON.stringify(input));
      this.db.prepare("INSERT INTO goal_steps (id,goalId,status,createdAt,updatedAt) VALUES (?,?,'pending',?,?)").run(stepId, id, now, now);
      this.db.prepare('INSERT INTO goal_plans VALUES (?,0,NULL,?,NULL,?,?,?,?)')
        .run(id, sourceRunId, JSON.stringify(spec), '宿主 bootstrap', hash(spec), now);
      return this.receipt(this.get(actor, id), sourceRunId, 'create', now);
    });
  }

  blockSkill(actor: GoalActor, id: string, expectedRevision: number, now: string): void {
    this.tx.transaction(() => {
      this.time(now);
      const goal = this.get(actor, id);
      if (goal.status !== 'ready' || goal.revision !== expectedRevision) return;
      // 尚未领取的Step仍是pending；只阻塞Goal，重新审批后可合法领取原步骤。
      this.db.prepare("UPDATE goals SET status='blocked',blockedReason='skill_unavailable',readyInputJson=NULL,revision=revision+1,updatedAt=? WHERE id=?").run(now, id);
      if (goal.readyInput) this.tx.event(goal.readyInput.triggerRunId, 'goal_skill_blocked', JSON.stringify({ goalId: id }), now);
    });
  }

  validateWeb(actor: GoalActor, id: string): void {
    const goal = this.get(actor, id);
    const binding = this.plan(goal).spec.webBindings?.find(item => item.stepId === goal.currentStepId);
    if (binding && !this.web) throw new Error('Goal Web快照校验服务不可用');
    if (binding) this.web!.freezeForGoal(actor, binding);
  }

  blockWeb(actor: GoalActor, id: string, expectedRevision: number, now: string): void {
    this.tx.transaction(() => {
      const goal = this.get(actor, id);
      if (goal.status !== 'ready' || goal.revision !== expectedRevision) return;
      this.db.prepare("UPDATE goals SET status='blocked',blockedReason='web_snapshot_unavailable',readyInputJson=NULL,revision=revision+1,updatedAt=? WHERE id=?").run(now, id);
      if (goal.readyInput) this.tx.event(goal.readyInput.triggerRunId, 'goal_web_blocked', JSON.stringify({ goalId: id }), now);
    });
  }

  claim(actor: GoalActor, id: string, expectedRevision: number, now: string, skill?: SkillSnapshot): { goal: Goal; execution: GoalExecution; run: Run } | undefined {
    return this.tx.transaction(() => {
      this.time(now);
      const goal = this.get(actor, id);
      if (goal.revision !== expectedRevision) throw new Error('Goal revision 已变化');
      if (goal.status !== 'ready') return undefined;
      const authorization = goal.readyInput;
      const step = this.plan(goal).spec.steps.find(item => item.stepId === goal.currentStepId);
      const stepRow = this.db.prepare('SELECT status FROM goal_steps WHERE goalId=? AND id=?').get(id, goal.currentStepId);
      const receipt = authorization?.kind !== 'policy' && authorization && this.controlReceipt(actor, authorization.triggerRunId);
      if (!authorization || authorization.kind !== 'policy' && (!receipt || receipt.goalId !== id || receipt.revision !== goal.revision) || !step || stepRow?.status !== 'pending'
        || goal.controlRequested || goal.blockedReason || goal.pendingAction) throw new Error('Goal 领取条件或授权不一致');
      const input: GoalExecutionInput = { goalId: id, objective: goal.objective, planRevision: goal.planRevision, step,
        authorization, previousCheckpoint: this.checkpoint(goal) };
      const bound = this.plan(goal).spec.skillBindings?.find(binding => binding.stepId === step.stepId);
      if (bound ? !skill || skill.id !== bound.skillId || skill.hash !== bound.packageHash || skill.version !== bound.version
        || !skill.text || Buffer.byteLength(skill.text) > 4096 : !!skill) throw new Error('Skill执行快照与已批准Plan绑定不一致');
      if (skill) input.skill = structuredClone(skill);
      const webBinding = this.plan(goal).spec.webBindings?.find(binding => binding.stepId === step.stepId);
      if (webBinding) {
        if (!this.web) throw new Error('Goal Web快照校验服务不可用');
        input.web = this.web.freezeForGoal(actor, webBinding);
      }
      const run = authorization.kind === 'policy' ? this.policy?.consume(goal, authorization, now) : this.tx.begin(now);
      if (!run) return undefined;
      const sequence = Number(this.db.prepare('SELECT coalesce(max(sequence),0)+1 AS n FROM goal_executions WHERE goalId=?').get(id)!.n);
      this.db.prepare(`INSERT INTO goal_executions (runId,goalId,stepId,planRevision,sequence,triggerRunId,baseGoalRevision,
        baseCheckpointRunId,capabilityClass,status,inputJson,inputHash) VALUES (?,?,?,?,?,?,?,?,'text_only','running',?,?)`)
        .run(run.id, id, step.stepId, goal.planRevision, sequence, authorization.triggerRunId, goal.revision + 1,
          goal.checkpointRunId, JSON.stringify(input), hash(input));
      this.db.prepare("UPDATE goal_steps SET status='running',lastExecutionRunId=?,updatedAt=? WHERE id=?").run(run.id, now, step.stepId);
      this.db.prepare("UPDATE goals SET status='running',revision=revision+1,readyInputJson=NULL,updatedAt=? WHERE id=? AND revision=?")
        .run(now, id, goal.revision);
      this.tx.event(run.id, 'goal_claimed', JSON.stringify({ goalId: id, stepId: step.stepId, sequence }), now);
      return { goal: this.get(actor, id), execution: this.execution(this.db.prepare('SELECT * FROM goal_executions WHERE runId=?').get(run.id)!), run };
    });
  }

  continue(command: GoalCommand, id: string, now: string, regenerate = false): Goal {
    return this.tx.transaction(() => {
      const goal = this.command(command, id, now);
      if (goal.blockedReason === 'invariant_violation') throw new Error('Goal 状态不确定，必须人工核对');
      if (goal.status === 'paused' && (goal.pendingAction || !goal.currentStepId)) {
        // 恢复计划/完成确认界面不产生执行授权，不能用“继续”跳过决定。
        this.db.prepare("UPDATE goals SET status='waiting_user',revision=revision+1,updatedAt=? WHERE id=?").run(now, id);
        return this.receipt(this.get(command.actor, id), command.sourceRunId, 'continue', now);
      }
      if (!['waiting_user', 'paused', 'blocked'].includes(goal.status) || goal.pendingAction || !goal.currentStepId) throw new Error('Goal 当前不能继续；需先处理计划或确认完成');
      if (goal.blockedReason && !regenerate) throw new Error('中断或阻塞后需要明确重新生成授权');
      const input = { triggerRunId: command.sourceRunId, text: this.text(command.text, 16_000), kind: regenerate ? 'regenerate' : 'continue' };
      this.db.prepare("UPDATE goal_steps SET status='pending',updatedAt=? WHERE goalId=? AND id=? AND status IN ('pending','waiting_user','blocked','failed')")
        .run(now, id, goal.currentStepId);
      this.db.prepare("UPDATE goals SET status='ready',readyInputJson=?,blockedReason=NULL,revision=revision+1,updatedAt=? WHERE id=?")
        .run(JSON.stringify(input), now, id);
      return this.receipt(this.get(command.actor, id), command.sourceRunId, 'continue', now);
    });
  }

  private draft(goal: Goal, runId: string, proposed: NonNullable<GoalResult['proposedPlan']>, userText = goal.objective, previousOverride?: GoalPlanSpec): GoalPlanDraft {
    if (!Array.isArray(proposed.steps) || proposed.steps.length < 1 || proposed.steps.length > 12) throw new Error('计划步骤必须为1至12项');
    validatePlanQuantity(goal.objective, proposed.steps.length);
    const previous = previousOverride ?? this.plan(goal).spec, current = previous.steps;
    const bindings: NonNullable<GoalPlanSpec['skillBindings']> = [];
    const catalog = this.skills?.list() ?? [];
    const explicitIds = [...userText.matchAll(/(?:使用|采用|改用|选用|绑定)\s*(?:Skill|技能)\s*[:：]?\s*([a-z0-9-]+)/giu)].map(match => match[1]!);
    if (explicitIds.some(id => !catalog.some(info => info.id === id))) throw new Error('用户指定的Skill未批准或不可用');
    const named = catalog.filter(info => new RegExp(`(?:使用|采用|改用|选用|绑定)\\s*(?:Skill|技能)?\\s*[:：]?\\s*${info.id}(?![a-z0-9-])`, 'iu').test(userText));
    if (named.length > 1) throw new Error('指定了多个Skill，请明确每步选择');
    const spec: GoalPlanSpec = { objectiveHash: hash(goal.objective), steps: proposed.steps.map(item => {
      const definition = { stepId: item.stepId ?? randomUUID(), title: this.text(item.title, 512),
        instruction: this.text(item.instruction, 4000), deliverable: this.text(item.deliverable, 2000), doneWhen: this.text(item.doneWhen, 2000) };
      if (item.stepId && !current.some(old => JSON.stringify(old) === JSON.stringify(definition))) throw new Error('计划 Step ID 跨目标或定义已变化，需新建步骤');
      if (Object.keys(item).some(key => !['stepId', 'title', 'instruction', 'deliverable', 'doneWhen', 'skillId'].includes(key))) throw new Error('模型不能提供Skill路径或可信Hash');
      const old = previous.skillBindings?.find(binding => binding.stepId === definition.stepId);
      const completed = this.db.prepare('SELECT status FROM goal_steps WHERE id=? AND goalId=?').get(definition.stepId, goal.id)?.status === 'completed';
      if (completed) {
        if (item.skillId !== undefined && item.skillId !== (old?.skillId ?? null)) throw new Error('已完成Step不能修改Skill绑定');
        if (old) bindings.push(old);
      } else {
        const selected = item.skillId === undefined ? old?.skillId ?? named[0]?.id : item.skillId;
        if (named[0] && item.skillId !== undefined && item.skillId !== named[0].id) throw new Error('模型Skill提议违反用户明确选择');
        if (selected) {
          const info = catalog.find(info => info.id === selected && info.enabled && info.goalCompatible);
          if (!info || info.disableModelInvocation && !named.some(item => item.id === selected)) throw new Error('Skill未批准、不兼容或需要用户明确指定');
          if (old && item.skillId === undefined && old.packageHash !== info.hash) throw new Error('Skill已升级，需明确改选并重新批准');
          bindings.push({ stepId: definition.stepId, skillId: info.id, packageHash: info.hash, version: info.version });
        } else if (item.skillId !== undefined && item.skillId !== null) throw new Error('Skill ID无效');
      }
      return definition;
    }) };
    if (bindings.length) spec.skillBindings = bindings;
    const webBindings = previous.webBindings?.filter(binding => spec.steps.some(step => step.stepId === binding.stepId));
    if (webBindings?.length) spec.webBindings = structuredClone(webBindings);
    if (new Set(spec.steps.map(step => step.stepId)).size !== spec.steps.length) throw new Error('计划步骤重复');
    const body = { baseRevision: goal.planRevision, revision: goal.planRevision + 1, spec, sourceRunId: runId,
      changeReason: this.text(proposed.changeReason, 2000) };
    return { ...body, hash: hash(body) };
  }

  private running(runId: string): { execution: GoalExecution; goal: Goal } {
    const row = this.db.prepare("SELECT * FROM goal_executions WHERE runId=? AND status='running'").get(runId);
    if (!row) throw new Error('Goal Execution 已结束或不存在');
    const execution = this.execution(row);
    if (hash(execution.input) !== execution.inputHash) throw new Error('Goal Execution 输入 Hash 不一致');
    return { execution, goal: this.goal(this.db.prepare('SELECT * FROM goals WHERE id=?').get(execution.goalId)!) };
  }

  commit(runId: string, result: GoalResult, now: string): GoalExecution {
    return this.tx.transaction(() => {
      this.time(now);
      const { execution, goal } = this.running(runId);
      // 控制先提交时，迟到的文本只留在 Run，不成为有效进度。
      if (this.policy && !this.policy.current(execution, now) || goal.controlRequested || goal.revision !== execution.baseGoalRevision || goal.planRevision !== execution.planRevision
        || goal.currentStepId !== execution.stepId || goal.checkpointRunId !== execution.baseCheckpointRunId) {
        this.tx.finish(runId, 'succeeded', now, this.text(result.artifactText, 32_000));
        this.stopExecution(execution, goal, 'discarded', 'stale_result', now);
      } else {
        if (goal.status !== 'running' || !['partial', 'complete', 'blocked'].includes(result.stepOutcome)) throw new Error('Goal 结果状态无效');
        if (execution.input.web) {
          const frozen = this.web?.freezeForGoal({ ownerId: goal.ownerId, target: goal.target }, execution.input.web.binding);
          if (!frozen || hash(frozen) !== hash(execution.input.web)) throw new Error('Goal Web执行资料已损坏，拒绝提交');
        }
        if (goal.planRevision === 0 && result.stepOutcome === 'complete' && !result.proposedPlan) throw new Error('bootstrap 完成必须提交计划草稿');
        if (result.stepOutcome === 'blocked' && result.proposedPlan) throw new Error('阻塞结果不能同时申请计划批准');
        const proposedPlan = result.proposedPlan ? this.draft(goal, runId, result.proposedPlan) : null;
        const checkpoint: GoalCheckpoint = { schemaVersion: 1, goalId: goal.id, planRevision: goal.planRevision,
          stepId: execution.stepId, executionRunId: runId, previousCheckpointRunId: execution.baseCheckpointRunId,
          inputSourceRunId: execution.triggerRunId, stepOutcome: result.stepOutcome,
          artifactText: this.text(result.artifactText, 32_000), progressSummary: this.text(result.progressSummary, 4000),
          question: this.text(result.question, 4000), blockedReason: result.stepOutcome === 'blocked' ? this.text(result.blockedReason ?? '', 2000) : null,
          proposedPlan, ...(result.needsUserFeedback === undefined ? {} : { needsUserFeedback: result.needsUserFeedback }) };
        this.tx.finish(runId, 'succeeded', now, checkpoint.artifactText);
        this.db.prepare("UPDATE goal_executions SET status='committed',checkpointJson=?,checkpointHash=? WHERE runId=?")
          .run(JSON.stringify(checkpoint), hash(checkpoint), runId);
        const stepStatus = result.stepOutcome === 'complete' ? 'completed' : result.stepOutcome === 'blocked' ? 'blocked' : 'waiting_user';
        this.db.prepare('UPDATE goal_steps SET status=?,updatedAt=? WHERE id=?').run(stepStatus, now, execution.stepId);
        const currentStepId = result.stepOutcome === 'complete' ? this.nextStep(goal) : execution.stepId;
        this.db.prepare(`UPDATE goals SET status=?,currentStepId=?,checkpointRunId=?,pendingActionJson=?,blockedReason=?,
          revision=revision+1,updatedAt=? WHERE id=?`).run(result.stepOutcome === 'blocked' ? 'blocked' : 'waiting_user', currentStepId,
          runId, proposedPlan ? JSON.stringify(proposedPlan) : null, checkpoint.blockedReason, now, goal.id);
        this.tx.event(runId, 'goal_checkpoint_committed', JSON.stringify({ goalId: goal.id, stepOutcome: result.stepOutcome }), now);
        this.policy?.settled(this.executionForHost(runId), this.get({ ownerId: goal.ownerId, target: goal.target }, goal.id), now);
      }
      return this.execution(this.db.prepare('SELECT * FROM goal_executions WHERE runId=?').get(runId)!);
    });
  }

  private nextStep(goal: Goal): string | null {
    for (const step of this.plan(goal).spec.steps) {
      if (this.db.prepare('SELECT status FROM goal_steps WHERE id=? AND goalId=?').get(step.stepId, goal.id)?.status !== 'completed') return step.stepId;
    }
    return null;
  }

  approvePlan(command: GoalCommand, id: string, draftHash: string, now: string, executeNext = false): Goal {
    // 包校验在事务外完成；进入事务后仍以原revision/draftHash进行CAS，不跨事务扫描目录。
    const preview = this.get(command.actor, id).pendingAction;
    for (const binding of preview?.spec.skillBindings ?? []) {
      if (this.db.prepare('SELECT status FROM goal_steps WHERE id=? AND goalId=?').get(binding.stepId, id)?.status === 'completed') continue;
      if (!this.skills) throw new Error('SKILLS_ENABLED未开启，不能批准Skill绑定');
      this.skills.snapshot(binding.skillId, binding.packageHash);
    }
    return this.tx.transaction(() => {
      const goal = this.command(command, id, now), draft = goal.pendingAction;
      if (goal.status !== 'waiting_user' || !draft || draft.hash !== draftHash || draft.baseRevision !== goal.planRevision) throw new Error('计划草稿或审批状态已变化');
      const { hash: draftFingerprint, ...body } = draft;
      if (hash(body) !== draftFingerprint) throw new Error('计划草稿 Hash 不一致');
      validateQuantityApproval(goal.objective, draft.spec.steps.length, command.text);
      for (const binding of draft.spec.webBindings ?? []) {
        if (this.db.prepare('SELECT status FROM goal_steps WHERE id=? AND goalId=?').get(binding.stepId, goal.id)?.status === 'completed') continue;
        if (!this.web) throw new Error('Goal Web快照校验服务不可用');
        this.web.freezeForGoal(command.actor, binding);
      }
      for (const binding of draft.spec.skillBindings ?? []) {
        if (this.db.prepare('SELECT status FROM goal_steps WHERE id=? AND goalId=?').get(binding.stepId, goal.id)?.status === 'completed') continue;
        if (!this.skills?.list().some(info => info.id === binding.skillId && info.hash === binding.packageHash && info.goalCompatible && info.enabled)) throw new Error('Skill批准版本已变化，请重新调整并展示计划');
      }
      const current = this.plan(goal).spec.steps;
      let incomplete = false;
      for (const step of draft.spec.steps) {
        const existing = this.db.prepare('SELECT * FROM goal_steps WHERE id=?').get(step.stepId);
        if (existing && (existing.goalId !== id || !current.some(old => JSON.stringify(old) === JSON.stringify(step)))) throw new Error('计划步骤归属或定义不一致');
        if (existing?.status === 'completed') { if (incomplete) throw new Error('已完成步骤不能放在未完成步骤之后'); }
        else incomplete = true;
        if (!existing) this.db.prepare("INSERT INTO goal_steps (id,goalId,status,createdAt,updatedAt) VALUES (?,?,'pending',?,?)").run(step.stepId, id, now, now);
      }
      for (const step of current) {
        if (!draft.spec.steps.some(next => next.stepId === step.stepId)) this.db.prepare("UPDATE goal_steps SET status='superseded',updatedAt=? WHERE id=? AND status<>'completed'").run(now, step.stepId);
      }
      this.db.prepare('INSERT INTO goal_plans VALUES (?,?,?,?,?,?,?,?,?)').run(id, draft.revision, draft.baseRevision,
        draft.sourceRunId, command.sourceRunId, JSON.stringify(draft.spec), draft.changeReason, hash(draft.spec), now);
      const next = this.nextStep({ ...goal, planRevision: draft.revision });
      if (executeNext && !next) throw new Error('没有可执行步骤，不能额外授权');
      if (executeNext) this.db.prepare("UPDATE goal_steps SET status='pending',updatedAt=? WHERE id=? AND status='waiting_user'").run(now, next);
      const ready = executeNext ? JSON.stringify({ triggerRunId: command.sourceRunId, text: this.text(command.text, 16_000), kind: 'approve' }) : null;
      this.db.prepare(`UPDATE goals SET planRevision=?,currentStepId=?,pendingActionJson=NULL,status=?,readyInputJson=?,
        blockedReason=NULL,revision=revision+1,updatedAt=? WHERE id=?`).run(draft.revision, next, executeNext ? 'ready' : 'waiting_user', ready, now, id);
      return this.receipt(this.get(command.actor, id), command.sourceRunId, 'approve_plan', now);
    });
  }

  proposePlan(command: GoalCommand, id: string, proposed: NonNullable<GoalResult['proposedPlan']>, now: string): Goal {
    return this.tx.transaction(() => {
      const goal = this.command(command, id, now);
      if (['completed', 'cancelled'].includes(goal.status) || goal.controlRequested === 'cancel' || goal.blockedReason === 'invariant_violation') throw new Error('当前 Goal 不能调整计划');
      const draft = this.draft(goal, command.sourceRunId, proposed, command.text);
      // 调整先撤销未领取授权；运行中先登记暂停，迟到结果不能成为进度。
      this.db.prepare(`UPDATE goals SET pendingActionJson=?,readyInputJson=NULL,status=?,controlRequested=?,
        revision=revision+1,updatedAt=? WHERE id=?`).run(JSON.stringify(draft), goal.status === 'running' ? 'running' : 'waiting_user',
          goal.status === 'running' ? 'pause' : null, now, id);
      return this.receipt(this.get(command.actor, id), command.sourceRunId, 'revise_plan', now);
    });
  }

  proposeWebBinding(command: GoalCommand, id: string, selection: GoalWebSelection | null, position: number | undefined, now: string): Goal {
    return this.tx.transaction(() => {
      const goal = this.command(command, id, now);
      if (['completed', 'cancelled'].includes(goal.status) || goal.controlRequested || goal.blockedReason === 'invariant_violation') throw new Error('当前Goal不能调整资料');
      if (goal.pendingAction) {
        const { hash: fingerprint, ...body } = goal.pendingAction;
        if (hash(body) !== fingerprint || body.baseRevision !== goal.planRevision) throw new Error('原计划草稿Hash或版本不符');
      }
      const previous = goal.pendingAction?.spec ?? this.plan(goal).spec;
      const target = position === undefined ? previous.steps.find(step => step.stepId === goal.currentStepId)
        ?? (previous.steps.length === 1 ? previous.steps[0] : undefined) : previous.steps[position - 1];
      if (!target || position !== undefined && (!Number.isSafeInteger(position) || position < 1)
        || this.db.prepare('SELECT status FROM goal_steps WHERE id=? AND goalId=?').get(target.stepId, id)?.status === 'completed') throw new Error('请明确一个未完成步骤；已完成Step资料不可改写');
      const draft = this.draft(goal, command.sourceRunId, { steps: previous.steps, changeReason: command.text }, command.text, previous);
      const bindings = draft.spec.webBindings?.filter(binding => binding.stepId !== target.stepId) ?? [];
      if (selection) {
        if (!this.web) throw new Error('Goal Web快照校验服务不可用');
        bindings.push(this.web.selectForGoal(command.actor, target.stepId, selection));
      }
      if (bindings.length) draft.spec.webBindings = bindings; else delete draft.spec.webBindings;
      const { hash: _oldHash, ...body } = draft; draft.hash = hash(body);
      this.db.prepare("UPDATE goals SET pendingActionJson=?,readyInputJson=NULL,status=?,controlRequested=?,revision=revision+1,updatedAt=? WHERE id=?")
        .run(JSON.stringify(draft), goal.status === 'running' ? 'running' : 'waiting_user', goal.status === 'running' ? 'pause' : null, now, id);
      return this.receipt(this.get(command.actor, id), command.sourceRunId, 'revise_plan', now);
    });
  }

  control(command: GoalCommand, id: string, action: 'pause' | 'cancel' | 'complete', now: string): Goal {
    return this.tx.transaction(() => {
      if (!['pause', 'cancel', 'complete'].includes(action)) throw new Error('未知 Goal 控制动作');
      const goal = this.command(command, id, now);
      if (['completed', 'cancelled'].includes(goal.status)) throw new Error('终态 Goal 不能再次控制');
      if (action === 'complete' && (goal.status !== 'waiting_user' || goal.pendingAction || goal.currentStepId)) throw new Error('需完成当前计划并明确确认目标达成');
      if (action === 'pause' && goal.controlRequested === 'cancel') throw new Error('取消优先于暂停');
      const running = goal.status === 'running';
      this.db.prepare(`UPDATE goals SET status=?,controlRequested=?,readyInputJson=NULL,pendingActionJson=?,
        finishedAt=?,revision=revision+1,updatedAt=? WHERE id=?`).run(running ? 'running' : action === 'pause' ? 'paused' : action === 'cancel' ? 'cancelled' : 'completed',
          running ? action : null, action === 'cancel' ? null : goal.pendingAction ? JSON.stringify(goal.pendingAction) : null,
          !running && action !== 'pause' ? now : null, now, id);
      return this.receipt(this.get(command.actor, id), command.sourceRunId, action, now);
    });
  }

  finishFailure(runId: string, kind: 'failed' | 'interrupted', reason: string, now: string): void {
    this.tx.transaction(() => {
      this.time(now);
      const { execution, goal } = this.running(runId);
      this.tx.finish(runId, kind, now, undefined, this.text(reason, 2000));
      this.stopExecution(execution, goal, kind, kind, now);
    });
  }

  private stopExecution(execution: GoalExecution, goal: Goal, status: 'failed' | 'interrupted' | 'discarded' | 'uncertain', reason: string, now: string): void {
    const control = goal.controlRequested;
    this.db.prepare('UPDATE goal_executions SET status=?,reasonCode=? WHERE runId=?').run(status, reason, execution.runId);
    this.db.prepare('UPDATE goal_steps SET status=?,updatedAt=? WHERE id=?').run(status === 'failed' ? 'failed' : 'blocked', now, execution.stepId);
    this.db.prepare(`UPDATE goals SET status=?,controlRequested=NULL,readyInputJson=NULL,pendingActionJson=?,blockedReason=?,
      finishedAt=?,revision=revision+1,updatedAt=? WHERE id=?`).run(control === 'cancel' ? 'cancelled' : control === 'pause' ? 'paused' : 'blocked',
        control === 'cancel' ? null : goal.pendingAction ? JSON.stringify(goal.pendingAction) : null,
        status === 'uncertain' ? 'invariant_violation' : reason, control === 'cancel' ? now : null, now, goal.id);
    this.tx.event(execution.runId, 'goal_execution_stopped', JSON.stringify({ goalId: goal.id, status, control, reason }), now);
    this.policy?.settled(this.executionForHost(execution.runId), this.get({ ownerId: goal.ownerId, target: goal.target }, goal.id), now);
  }

  // 仅 SqliteStore 在同一恢复事务中调用；Run 已中断，不能嵌套 BEGIN 或重新执行。
  recoverInTransaction(now: string): void {
    if (!this.db.isTransaction) throw new Error('Goal 恢复必须由 SqliteStore 同连接事务调用');
    const rows = this.db.prepare("SELECT e.*,r.status AS runStatus FROM goal_executions e JOIN runs r ON r.id=e.runId WHERE e.status='running'").all();
    for (const row of rows) {
      const execution = this.execution(row), goal = this.goal(this.db.prepare('SELECT * FROM goals WHERE id=?').get(execution.goalId)!);
      const step = this.db.prepare('SELECT status,lastExecutionRunId FROM goal_steps WHERE goalId=? AND id=?').get(goal.id, execution.stepId);
      const consistent = row.runStatus === 'interrupted' && goal.status === 'running' && goal.currentStepId === execution.stepId
        && goal.planRevision === execution.planRevision && goal.checkpointRunId === execution.baseCheckpointRunId
        && (goal.controlRequested !== null || goal.revision === execution.baseGoalRevision)
        && step?.status === 'running' && step.lastExecutionRunId === execution.runId && hash(execution.input) === execution.inputHash;
      this.stopExecution(execution, goal, consistent ? 'interrupted' : 'uncertain', consistent ? 'interrupted' : 'invariant_violation', now);
    }
  }
}
