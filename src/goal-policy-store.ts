import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from './contracts.js';
import type { Goal, GoalActor, GoalCheckpoint, GoalExecution, GoalReadyInput } from './goal-types.js';
import type { GoalPolicy, PolicyAuthorization, PolicyCommand, PolicyProposal, ProactiveOptions } from './goal-policy-types.js';
import { nextWake, utc } from './goal-schedule.js';
import { GitHubObserver, validateWatch } from './github-observer.js';

interface Transactions { transaction<T>(fn: () => T): T; begin(now: string): Run; finish(id: string, now: string): void }
const defaults: ProactiveOptions = { enabled: false, inputRate: 0, outputRate: 0, dailyCalls: 20, dailyExecutions: 20,
  dailyBudgetCny: 1, totalExecutions: 100, totalBudgetCny: 5 };
const decode = <T>(value: unknown): T => JSON.parse(String(value)) as T;

// 与 Goal 共用连接和短事务。宿主来源 Run 是技术审计记录，权限只来自独立的策略/触发/消费账本。
export class GoalPolicyStore {
  private options = defaults;
  observer?: GitHubObserver;
  interrupt?: (goalId: string) => void;
  constructor(private readonly db: DatabaseSync, private readonly tx: Transactions,
    private readonly getGoal: (actor: GoalActor, id: string) => Goal) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS goal_policies (
        id TEXT PRIMARY KEY, goalId TEXT NOT NULL REFERENCES goals(id), ownerId TEXT NOT NULL, accessKey TEXT NOT NULL,
        version INTEGER NOT NULL, status TEXT NOT NULL, goalRevision INTEGER NOT NULL, planRevision INTEGER NOT NULL,
        specJson TEXT NOT NULL CHECK(json_valid(specJson)), nextAt TEXT, reason TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS goal_active_policy ON goal_policies(goalId) WHERE status='active';
      CREATE TABLE IF NOT EXISTS goal_policy_events (
        id INTEGER PRIMARY KEY, policyId TEXT NOT NULL REFERENCES goal_policies(id), version INTEGER NOT NULL,
        sourceRunId TEXT UNIQUE REFERENCES runs(id), at TEXT NOT NULL, action TEXT NOT NULL, details TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_triggers (
        id TEXT PRIMARY KEY, policyId TEXT NOT NULL REFERENCES goal_policies(id), policyVersion INTEGER NOT NULL,
        source TEXT NOT NULL, sourceKey TEXT NOT NULL, at TEXT NOT NULL, status TEXT NOT NULL,
        UNIQUE(policyId,policyVersion,source,sourceKey)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_grants (
        id TEXT PRIMARY KEY, triggerId TEXT NOT NULL REFERENCES goal_triggers(id), policyId TEXT NOT NULL REFERENCES goal_policies(id),
        policyVersion INTEGER NOT NULL, goalRevision INTEGER NOT NULL, segment INTEGER NOT NULL,
        sourceRunId TEXT NOT NULL UNIQUE REFERENCES runs(id), executionRunId TEXT UNIQUE REFERENCES runs(id),
        at TEXT NOT NULL, consumedAt TEXT, reserveCny REAL NOT NULL, status TEXT NOT NULL,
        UNIQUE(triggerId,segment)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_observer_cursors (
        policyId TEXT PRIMARY KEY REFERENCES goal_policies(id), head TEXT, failures INTEGER NOT NULL DEFAULT 0, lastError TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS goal_observations (
        id TEXT PRIMARY KEY, policyId TEXT NOT NULL REFERENCES goal_policies(id), policyVersion INTEGER NOT NULL,
        head TEXT NOT NULL, previous TEXT NOT NULL, at TEXT NOT NULL, dataJson TEXT NOT NULL CHECK(json_valid(dataJson)),
        triggerId TEXT UNIQUE REFERENCES goal_triggers(id), UNIQUE(policyId,head)
      ) STRICT;
    `);
  }

  configure(options: ProactiveOptions): void {
    for (const key of ['inputRate', 'outputRate', 'dailyCalls', 'dailyExecutions', 'dailyBudgetCny', 'totalExecutions', 'totalBudgetCny'] as const) {
      if (!Number.isFinite(options[key]) || options[key] < 0) throw new Error('主动执行宿主限额无效');
    }
    this.options = { ...options };
  }

  private read(row: Record<string, unknown>): GoalPolicy {
    return { ...decode<PolicyProposal>(row.specJson), id: String(row.id), ownerId: String(row.ownerId), accessKey: String(row.accessKey),
      version: Number(row.version), expectedGoalRevision: Number(row.goalRevision), status: row.status as GoalPolicy['status'],
      nextAt: row.nextAt as string | null, reason: row.reason as string | null, createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) };
  }
  get(actor: GoalActor, id: string): GoalPolicy {
    const row = this.db.prepare('SELECT * FROM goal_policies WHERE id=?').get(id);
    if (!row) throw new Error('策略不存在');
    const goal = this.getGoal(actor, String(row.goalId));
    if (goal.ownerId !== row.ownerId || goal.accessKey !== row.accessKey) throw new Error('策略身份不一致');
    return this.read(row);
  }
  list(actor: GoalActor): GoalPolicy[] {
    return this.db.prepare('SELECT * FROM goal_policies WHERE ownerId=? ORDER BY createdAt,id LIMIT 101').all(actor.ownerId)
      .filter(row => { try { this.getGoal(actor, String(row.goalId)); return true; } catch { return false; } }).map(row => this.read(row));
  }
  private source(command: PolicyCommand): void {
    const run = this.db.prepare('SELECT * FROM runs WHERE id=?').get(command.sourceRunId);
    if (!command.text.trim() || Buffer.byteLength(command.text) > 16000 || !run || run.status !== 'running' || run.taskId !== null
      || this.db.prepare('SELECT 1 FROM goal_grants WHERE sourceRunId=? OR executionRunId=?').get(String(run.id), String(run.id))
      || this.db.prepare('SELECT 1 FROM goal_executions WHERE runId=? OR triggerRunId=?').get(String(run.id), String(run.id))
      || this.db.prepare('SELECT 1 FROM goal_policy_events WHERE sourceRunId=?').get(String(run.id))
      || this.db.prepare("SELECT 1 FROM run_events WHERE runId=? AND type='goal_control'").get(String(run.id))) throw new Error('策略必须来自新的一次可信用户操作');
  }
  private event(policy: GoalPolicy, action: string, now: string, details: unknown, source?: string): void {
    this.db.prepare('INSERT INTO goal_policy_events (policyId,version,sourceRunId,at,action,details) VALUES (?,?,?,?,?,?)')
      .run(policy.id, policy.version, source ?? null, now, action, JSON.stringify(details));
  }
  approve(command: PolicyCommand, proposal: PolicyProposal, now: string): GoalPolicy {
    return this.tx.transaction(() => {
      utc(now); this.source(command);
      if (!this.options.enabled) throw new Error('主动执行总开关未开启');
      const goal = this.getGoal(command.actor, proposal.goalId);
      if (proposal.capability !== 'text_only' || proposal.expectedGoalRevision !== goal.revision || proposal.planRevision !== goal.planRevision
        || goal.planRevision < 1 || goal.status !== 'waiting_user' || !goal.currentStepId || goal.pendingAction || goal.blockedReason || goal.controlRequested) throw new Error('需当前已批准计划、唯一合法目标和版本；不得绕过等待审批或失败');
      const checkpointRow = goal.checkpointRunId && this.db.prepare("SELECT checkpointJson FROM goal_executions WHERE runId=? AND status='committed'").get(goal.checkpointRunId);
      const checkpoint = checkpointRow ? decode<GoalCheckpoint>(checkpointRow.checkpointJson) : null;
      // 已批准新Plan解决的是旧草稿审批；同一Plan正在等待反馈时，策略审批不能替代用户回答。
      if (checkpoint?.planRevision === goal.planRevision && (checkpoint.stepOutcome !== 'complete' || checkpoint.needsUserFeedback !== false)) throw new Error('当前计划仍等待用户反馈；请先明确继续并处理反馈，不能用策略绕过');
      utc(proposal.expiresAt);
      if (proposal.expiresAt <= now) throw new Error('策略已过期');
      const limits = proposal.limits;
      for (const key of ['segmentsPerTrigger', 'dailyExecutions', 'dailyModelCalls', 'totalExecutions'] as const) {
        if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > 100 || key === 'segmentsPerTrigger' && limits[key] > 5) throw new Error('每次触发只允许1至5个片段；次数限额必须明确');
      }
      for (const key of ['dailyBudgetCny', 'totalBudgetCny'] as const) if (!Number.isFinite(limits[key]) || limits[key] <= 0 || limits[key] > 100) throw new Error('必须明确有限的人民币预算');
      if (proposal.schedule.kind === 'github') validateWatch(proposal.schedule);
      const nextAt = proposal.schedule.kind === 'github' ? now : nextWake(proposal.schedule, now);
      if (!nextAt || nextAt >= proposal.expiresAt) throw new Error('有效期内没有未来触发时间');
      const id = randomUUID();
      this.db.prepare("INSERT INTO goal_policies VALUES (?,?,?,?,1,'active',?,?,?,?,NULL,?,?)")
        .run(id, goal.id, goal.ownerId, goal.accessKey, goal.revision, goal.planRevision, JSON.stringify(proposal), nextAt, now, now);
      const policy = this.get(command.actor, id);
      if (proposal.schedule.kind === 'github') this.db.prepare('INSERT INTO goal_observer_cursors (policyId) VALUES (?)').run(id);
      this.event(policy, 'approved', now, proposal, command.sourceRunId);
      return policy;
    });
  }

  control(command: PolicyCommand, id: string, expectedVersion: number, action: 'pause' | 'revoke', now: string): GoalPolicy {
    const updated = this.tx.transaction(() => {
      utc(now); this.source(command);
      const policy = this.get(command.actor, id);
      if (policy.version !== expectedVersion || !['pause', 'revoke'].includes(action) || policy.status === 'revoked') throw new Error('策略版本或状态已变化');
      this.stop(policy, action === 'pause' ? 'paused' : 'revoked', 'user_' + action, now);
      this.event({ ...policy, version: policy.version + 1 }, action, now, { text: command.text }, command.sourceRunId);
      return this.get(command.actor, id);
    });
    this.interrupt?.(updated.goalId);
    return updated;
  }
  private stop(policy: GoalPolicy, status: GoalPolicy['status'], reason: string, now: string): void {
    this.db.prepare('UPDATE goal_policies SET status=?,version=version+1,nextAt=NULL,reason=?,updatedAt=? WHERE id=? AND version=?')
      .run(status, reason, now, policy.id, policy.version);
    this.db.prepare("UPDATE goal_grants SET status='revoked' WHERE policyId=? AND status='issued'").run(policy.id);
    this.db.prepare("UPDATE goal_triggers SET status='stopped' WHERE policyId=? AND status='pending'").run(policy.id);
    // 撤销也通过 Goal revision 取消提交权；迟到结果不能成为新 Checkpoint。
    this.db.prepare(`UPDATE goals SET status=CASE WHEN status='running' THEN 'running' ELSE 'waiting_user' END,
      controlRequested=CASE WHEN status='running' THEN coalesce(controlRequested,'pause') ELSE NULL END,
      readyInputJson=NULL,revision=revision+1,updatedAt=? WHERE id=? AND
      (status='ready' AND json_extract(readyInputJson,'$.policyId')=? OR status='running' AND EXISTS
        (SELECT 1 FROM goal_grants WHERE policyId=? AND executionRunId IN (SELECT runId FROM goal_executions WHERE goalId=? AND status='running')))`)
      .run(now, policy.goalId, policy.id, policy.id, policy.goalId);
    this.event(policy, 'stopped', now, { status, reason });
  }

  // 只由宿主时钟调用。长停机合并为一个到期触发，下一次从当前时刻向前计算。
  scan(now: string, accepts: (goal: Goal) => boolean): void {
    this.tx.transaction(() => {
      utc(now); if (!this.options.enabled) return;
      for (const row of this.db.prepare("SELECT * FROM goal_policies WHERE status='active' ORDER BY nextAt,id LIMIT 100").all()) {
        const policy = this.read(row), goal = this.db.prepare('SELECT * FROM goals WHERE id=?').get(policy.goalId)!;
        const actor = { ownerId: policy.ownerId, target: decode<GoalActor['target']>(goal.targetJson) };
        const current = this.getGoal(actor, policy.goalId);
        if (!accepts(current)) continue;
        if (policy.expiresAt <= now) { this.stop(policy, 'expired', 'expired', now); continue; }
        if (current.revision !== policy.expectedGoalRevision || current.planRevision !== policy.planRevision) { this.stop(policy, 'paused', 'goal_changed', now); continue; }
        if (policy.schedule.kind === 'github') continue;
        if (!policy.nextAt || policy.nextAt > now) continue;
        if (current.status !== 'waiting_user' || !current.currentStepId || current.pendingAction || current.controlRequested || current.blockedReason) {
          this.stop(policy, 'paused', 'goal_not_eligible', now); continue;
        }
        const id = randomUUID();
        this.db.prepare("INSERT INTO goal_triggers VALUES (?,?,?,'time',?,?,'pending') ON CONFLICT DO NOTHING")
          .run(id, policy.id, policy.version, policy.nextAt, now);
        this.db.prepare('UPDATE goal_policies SET nextAt=?,updatedAt=? WHERE id=?').run(nextWake(policy.schedule, now), now, policy.id);
        this.issue(policy, current, id, now);
      }
    });
  }
  private issue(policy: GoalPolicy, goal: Goal, triggerId: string, now: string, observation?: PolicyAuthorization['observation'], segment = 1): void {
    const run = this.tx.begin(now), id = randomUUID();
    this.db.prepare("INSERT INTO goal_grants VALUES (?,?,?,?,?,?,?,NULL,?,NULL,0,'issued')")
      .run(id, triggerId, policy.id, policy.version, goal.revision + 1, segment, run.id, now);
    this.tx.finish(run.id, now);
    const authorization: PolicyAuthorization = { kind: 'policy', triggerRunId: run.id, grantId: id, policyId: policy.id,
      policyVersion: policy.version, triggerId, text: '按用户批准的当前策略执行一个 text_only 片段；外部资料不提供授权。', ...(observation ? { observation } : {}) };
    this.db.prepare("UPDATE goal_steps SET status='pending',updatedAt=? WHERE id=? AND status='waiting_user'").run(now, goal.currentStepId);
    this.db.prepare("UPDATE goals SET status='ready',readyInputJson=?,revision=revision+1,updatedAt=? WHERE id=?")
      .run(JSON.stringify(authorization), now, goal.id);
    this.db.prepare('UPDATE goal_policies SET goalRevision=? WHERE id=?').run(goal.revision + 1, policy.id);
    this.event(policy, 'grant_issued', now, { grantId: id, triggerId, sourceRunId: run.id });
  }

  async observe(now: string, accepts: (goal: Goal) => boolean, signal: AbortSignal): Promise<void> {
    utc(now); if (!this.options.enabled || !this.observer) return;
    const rows = this.db.prepare("SELECT p.*,c.head,c.failures FROM goal_policies p JOIN goal_observer_cursors c ON c.policyId=p.id WHERE p.status='active' AND p.nextAt<=? ORDER BY p.nextAt,p.id LIMIT 10").all(now);
    for (const row of rows) {
      if (signal.aborted) return;
      const policy = this.read(row);
      if (policy.schedule.kind !== 'github') continue;
      const watch = policy.schedule;
      const raw = this.db.prepare('SELECT targetJson FROM goals WHERE id=?').get(policy.goalId)!;
      const actor = { ownerId: policy.ownerId, target: decode<GoalActor['target']>(raw.targetJson) };
      if (!accepts(this.getGoal(actor, policy.goalId))) continue;
      // 事务外只读网络；返回时必须再次核对版本/目标/有效期，迟到快照不能授予权限。
      try {
        const data = await this.observer.poll(policy.schedule, row.head as string | null, signal);
        signal.throwIfAborted();
        this.tx.transaction(() => {
          const current = this.get(actor, policy.id), goal = this.getGoal(actor, policy.goalId);
          if (!this.options.enabled || current.status !== 'active' || current.version !== policy.version) return;
          if (this.db.prepare('SELECT head FROM goal_observer_cursors WHERE policyId=?').get(policy.id)?.head !== row.head) return;
          if (current.expiresAt <= now || current.expectedGoalRevision !== goal.revision || current.planRevision !== goal.planRevision
            || goal.status !== 'waiting_user' || goal.pendingAction || goal.controlRequested || goal.blockedReason || !goal.currentStepId) {
            this.stop(current, 'paused', 'observer_goal_changed_or_waiting', now); return;
          }
          this.db.prepare('UPDATE goal_policies SET nextAt=?,updatedAt=? WHERE id=?').run(new Date(Date.parse(now) + watch.intervalSeconds * 1000).toISOString(), now, policy.id);
          this.db.prepare('UPDATE goal_observer_cursors SET failures=0,lastError=NULL WHERE policyId=?').run(policy.id);
          if (row.head === data.head) return;
          if (row.head === null) { this.db.prepare('UPDATE goal_observer_cursors SET head=? WHERE policyId=?').run(data.head, policy.id); this.event(policy, 'observer_baseline', now, { head: data.head }); return; }
          if (this.db.prepare('SELECT 1 FROM goal_observations WHERE policyId=? AND head=?').get(policy.id, data.head)) return;
          const id = randomUUID(), triggerId = randomUUID();
          this.db.prepare("INSERT INTO goal_triggers VALUES (?,?,?,'github',?,?,'pending')").run(triggerId, policy.id, policy.version, data.head, now);
          this.db.prepare('INSERT INTO goal_observations VALUES (?,?,?,?,?,?,?,?)').run(id, policy.id, policy.version, data.head, String(row.head), now, JSON.stringify(data), triggerId);
          this.db.prepare('UPDATE goal_observer_cursors SET head=? WHERE policyId=?').run(data.head, policy.id);
          this.issue(current, goal, triggerId, now, { id, repository: watch.repository, branch: watch.branch, previous: String(row.head), data });
          this.event(policy, 'observation_committed', now, { id, triggerId, head: data.head });
        });
      } catch (error) {
        if (signal.aborted) return;
        this.tx.transaction(() => {
          const current = this.get(actor, policy.id);
          if (current.status !== 'active' || current.version !== policy.version) return;
          const failures = Math.min(Number(row.failures) + 1, 16);
          const interval = watch.intervalSeconds;
          this.db.prepare('UPDATE goal_observer_cursors SET failures=?,lastError=? WHERE policyId=?').run(failures, String(error).slice(0, 1000), policy.id);
          this.db.prepare('UPDATE goal_policies SET nextAt=?,updatedAt=? WHERE id=?').run(new Date(Date.parse(now) + Math.max(interval, Math.min(21600, interval * 2 ** Math.min(failures, 8))) * 1000).toISOString(), now, policy.id);
          this.event(policy, 'observation_failed', now, { failures, error: String(error).slice(0, 1000) });
        });
      }
    }
  }

  // GoalStore 在领取事务中调用：预算预留、唯一消费和创建 Execution 同提交或同回滚。
  consume(goal: Goal, authorization: GoalReadyInput, now: string): Run | undefined {
    if (authorization.kind !== 'policy') return undefined;
    const row = this.db.prepare('SELECT * FROM goal_policies WHERE id=?').get(authorization.policyId);
    const grant = this.db.prepare('SELECT * FROM goal_grants WHERE id=?').get(authorization.grantId);
    if (!row || !grant) throw new Error('宿主策略授权账本缺失');
    const policy = this.read(row);
    if (!this.options.enabled || policy.status !== 'active' || policy.version !== authorization.policyVersion || policy.expiresAt <= now
      || policy.goalId !== goal.id || policy.ownerId !== goal.ownerId || policy.accessKey !== goal.accessKey || policy.planRevision !== goal.planRevision
      || policy.expectedGoalRevision !== goal.revision || grant.goalRevision !== goal.revision || grant.status !== 'issued'
      || grant.policyId !== policy.id || grant.policyVersion !== policy.version || grant.triggerId !== authorization.triggerId || grant.sourceRunId !== authorization.triggerRunId) {
      this.stop(policy, 'paused', 'authorization_invalid', now); return undefined;
    }
    // 按最大输入字节数和最大输出 Token 全额预留，不因缺失 usage 或失败而返还。
    const reserve = Math.ceil((32768 * this.options.inputRate + 4096 * this.options.outputRate) / 1e6 * 1e6) / 1e6;
    const usage = (all: boolean, daily: boolean) => this.db.prepare(`SELECT count(*) AS n,coalesce(sum(reserveCny),0) AS c FROM goal_grants
      WHERE consumedAt IS NOT NULL ${all ? '' : 'AND policyId=?'} ${daily ? 'AND substr(consumedAt,1,10)=?' : ''}`)
      .get(...[...all ? [] : [policy.id], ...daily ? [now.slice(0, 10)] : []])!;
    const pd = usage(false, true), pt = usage(false, false), gd = usage(true, true), gt = usage(true, false);
    if (this.options.inputRate <= 0 || this.options.outputRate <= 0 || reserve <= 0
      || Number(pd.n) >= Math.min(policy.limits.dailyExecutions, policy.limits.dailyModelCalls) || Number(pt.n) >= policy.limits.totalExecutions
      || Number(gd.n) >= Math.min(this.options.dailyCalls, this.options.dailyExecutions) || Number(gt.n) >= this.options.totalExecutions
      || Number(pd.c) + reserve > policy.limits.dailyBudgetCny || Number(pt.c) + reserve > policy.limits.totalBudgetCny
      || Number(gd.c) + reserve > this.options.dailyBudgetCny || Number(gt.c) + reserve > this.options.totalBudgetCny) {
      this.stop(policy, 'blocked', 'budget_or_rate_unavailable', now); return undefined;
    }
    const executionRunId = this.tx.begin(now).id;
    this.db.prepare("UPDATE goal_grants SET status='consumed',executionRunId=?,consumedAt=?,reserveCny=? WHERE id=? AND status='issued'")
      .run(executionRunId, now, reserve, String(grant.id));
    this.db.prepare('UPDATE goal_policies SET goalRevision=? WHERE id=?').run(goal.revision + 1, policy.id);
    this.event(policy, 'grant_consumed', now, { grantId: grant.id, executionRunId, reserveCny: reserve });
    return this.db.prepare('SELECT * FROM runs WHERE id=?').get(executionRunId) as unknown as Run;
  }

  current(execution: GoalExecution, now: string): boolean {
    const auth = execution.input.authorization;
    if (auth.kind !== 'policy') return true;
    const policy = this.db.prepare('SELECT * FROM goal_policies WHERE id=?').get(auth.policyId);
    return this.options.enabled && policy?.status === 'active' && policy.version === auth.policyVersion
      && decode<PolicyProposal>(policy.specJson).expiresAt > now;
  }
  settled(execution: GoalExecution, goal: Goal, now: string): void {
    const auth = execution.input.authorization;
    if (auth.kind !== 'policy') return;
    const row = this.db.prepare('SELECT * FROM goal_policies WHERE id=?').get(auth.policyId)!;
    const policy = this.read(row);
    this.db.prepare('UPDATE goal_triggers SET status=? WHERE id=?').run(execution.status === 'committed' ? 'consumed' : 'stopped', auth.triggerId);
    if (policy.status !== 'active') return;
    if (execution.status !== 'committed' || goal.status !== 'waiting_user' || goal.pendingAction || !goal.currentStepId
      || execution.checkpoint?.stepOutcome !== 'complete' || execution.checkpoint?.needsUserFeedback !== false) {
      this.stop(policy, 'paused', 'execution_requires_user_or_stopped', now); return;
    }
    this.db.prepare('UPDATE goal_policies SET goalRevision=?,updatedAt=? WHERE id=?').run(goal.revision, now, policy.id);
    const grant = this.db.prepare('SELECT segment FROM goal_grants WHERE id=?').get(auth.grantId)!;
    if (Number(grant.segment) < policy.limits.segmentsPerTrigger && policy.expiresAt > now) {
      this.db.prepare("UPDATE goal_triggers SET status='pending' WHERE id=?").run(auth.triggerId);
      this.issue(policy, goal, auth.triggerId, now, auth.observation, Number(grant.segment) + 1);
    } else if (policy.nextAt === null) this.stop(policy, 'paused', 'one_shot_completed', now);
  }
  audit(actor: GoalActor, id: string): { policy: GoalPolicy; triggers: unknown[]; grants: unknown[]; events: unknown[]; observations: unknown[]; cursor: unknown } {
    const policy = this.get(actor, id);
    return { policy, triggers: this.db.prepare('SELECT * FROM goal_triggers WHERE policyId=? ORDER BY at,id').all(id),
      grants: this.db.prepare('SELECT * FROM goal_grants WHERE policyId=? ORDER BY at,id').all(id),
      events: this.db.prepare('SELECT * FROM goal_policy_events WHERE policyId=? ORDER BY id').all(id),
      observations: this.db.prepare('SELECT * FROM goal_observations WHERE policyId=? ORDER BY at,id').all(id),
      cursor: this.db.prepare('SELECT * FROM goal_observer_cursors WHERE policyId=?').get(id) ?? null };
  }
}
