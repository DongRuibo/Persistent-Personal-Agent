import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';
import * as Value from 'typebox/value';
import { ExecutionInterrupted } from './contracts.js';
import type { AgentExecutor, Channel, MessageTarget } from './contracts.js';
import type { Goal, GoalActor, GoalExecution, GoalResult, GoalView } from './goal-types.js';
import { SqliteStore } from './sqlite-store.js';
import { BackgroundLane } from './background-lane.js';
import { GoalPlanQuantityError, planQuantityQuestion } from './goal-plan-quantity.js';

const bounded = (maxLength: number) => Type.String({ minLength: 1, maxLength });
export const goalResultSchema = Type.Object({
  stepOutcome: Type.Union(['partial', 'complete', 'blocked'].map(value => Type.Literal(value))),
  artifactText: bounded(32000), progressSummary: bounded(4000), question: bounded(4000),
  blockedReason: Type.Optional(bounded(2000)),
  needsUserFeedback: Type.Optional(Type.Boolean()),
  proposedPlan: Type.Optional(Type.Object({ changeReason: bounded(2000), steps: Type.Array(Type.Object({
    stepId: Type.Optional(bounded(64)), title: bounded(512), instruction: bounded(4000),
    deliverable: bounded(2000), doneWhen: bounded(2000),
  }, { additionalProperties: false }), { minItems: 1, maxItems: 12 }) }, { additionalProperties: false })),
}, { additionalProperties: false });

export function parseGoalResult(text: string): GoalResult {
  if (Buffer.byteLength(text) > 64000) throw new Error('Goal 输出超过容量');
  const value: unknown = JSON.parse(text);
  if (!Value.Check(goalResultSchema, value)) throw new Error('Goal 输出不符合结果 Schema');
  return value as GoalResult;
}

export function goalProjection(execution: GoalExecution, view: GoalView): { prompt: string; memoryQuery: string } {
  const input = execution.input;
  const observation = input.authorization.kind === 'policy' ? input.authorization.observation : undefined;
  const authorization = input.authorization.kind === 'policy' ? { ...input.authorization, observation: undefined } : input.authorization;
  const goal = { goalId: input.goalId, objective: input.objective, input: authorization };
  const plan = { revision: input.planRevision, steps: view.plan.spec.steps, currentStep: input.step };
  const prior = input.previousCheckpoint;
  // 摘要、问题和否定条件不截断；超限先阻塞，用户可缩小目标或计划。
  const checkpoint = prior ? { runId: prior.executionRunId, progressSummary: prior.progressSummary,
    question: prior.question, blockedReason: prior.blockedReason, artifactText: prior.artifactText, artifactTruncated: false } : null;
  if (checkpoint && Buffer.byteLength(JSON.stringify(checkpoint)) > 6144) {
    const full = checkpoint.artifactText; checkpoint.artifactText = ''; checkpoint.artifactTruncated = true;
    // 完整成果仍在不可变Checkpoint；只对成果摘录明确标记，目标/反馈/摘要/问题不截断。
    for (const char of full) {
      if (Buffer.byteLength(JSON.stringify({ ...checkpoint, artifactText: checkpoint.artifactText + char })) > 6144) break;
      checkpoint.artifactText += char;
    }
  }
  for (const [value, limit] of [[goal, 4096], [plan, 4096], [checkpoint, 6144], [observation ?? null, 10240]] as const) {
    if (Buffer.byteLength(JSON.stringify(value)) > limit) throw new Error('Goal 输入超过分区预算，请缩小或分段；尚未调用模型');
  }
  const snapshot = JSON.stringify({ goal, plan, checkpoint, ...(observation ? { observation } : {}), capability: 'text_only' });
  if (Buffer.byteLength(snapshot) > (observation ? 24576 : 14336)) throw new Error('Goal 快照超过总预算');
  return { prompt: `本次只执行一个片段。${input.authorization.kind === 'policy' ? '这是宿主策略授权的片段；需要用户反馈或审批时 needsUserFeedback=true；只有本段已完成且无需反馈时可填false。该字段不能扩大授权或自行继续。' : ''}resultSchema=${JSON.stringify(goalResultSchema)}\nUNTRUSTED_GOAL_SNAPSHOT=${snapshot}`,
    memoryQuery: `${input.objective}\n${input.step.title}\n${input.step.instruction}` };
}

export function renderGoal(view: GoalView): string {
  const { goal, plan, checkpoint } = view;
  const status = goal.controlRequested ? `正在${goal.controlRequested === 'cancel' ? '取消' : '暂停'}，等待执行停止` : goal.status;
  const lines = [`目标：${goal.objective}`, `状态：${status}；版本：${goal.revision}；计划：v${goal.planRevision}`,
    ...plan.spec.steps.map((step, i) => `${i + 1}. ${step.title}；${view.steps.find(item => item.id === step.stepId)?.status}`)];
  if (checkpoint) lines.push(`已提交成果（${checkpoint.executionRunId}）：\n${checkpoint.artifactText}`, `进度：${checkpoint.progressSummary}`, `等待：${checkpoint.question}`);
  if (goal.pendingAction) lines.push(`待批准计划 v${goal.pendingAction.revision}（理由：${goal.pendingAction.changeReason}）：`,
    ...goal.pendingAction.spec.steps.map((step, i) => `${i + 1}. ${step.title}\n说明：${step.instruction}\n产物：${step.deliverable}\n验收：${step.doneWhen}`),
    ...[planQuantityQuestion(goal.objective, goal.pendingAction.spec.steps.length)].filter((text): text is string => !!text),
    '请明确批准计划；如需执行，同时说“批准并继续一段”。调整计划请给出完整步骤及产物、验收条件。');
  if (goal.blockedReason) lines.push(`阻塞：${goal.blockedReason}；核实原因后可明确要求重新生成纯文本片段。`);
  const lastError = view.executions.at(-1)?.run.error;
  if (lastError?.startsWith('计划数量约束不符：')) lines.push(lastError);
  if (!goal.currentStepId && !goal.pendingAction && goal.status === 'waiting_user') lines.push('计划产物已交付，请确认目标是否达成；模型不会自行完成目标。');
  if (view.executions.some(item => item.run.deliveryError)) lines.push('有历史通知投递失败；以上为数据库已提交成果，查询不会重新执行。');
  return lines.join('\n');
}

export class GoalRunner {
  private readonly shutdown = new AbortController();
  private loop?: Promise<void>;
  private work?: Promise<void>;
  private active?: { goalId: string; runId: string; controller: AbortController };
  private halted = false;
  private blockedReason?: string;

  constructor(private readonly store: SqliteStore, private readonly executor: AgentExecutor,
    private readonly channel: Channel, private readonly lane: BackgroundLane,
    private readonly options: { ownerId: string; accepts(target: MessageTarget): boolean; pollIntervalMs: number;
      reportError(error: unknown): void; fatal(): void; proactiveEnabled?: boolean; delivered?(goal: Goal, runId: string): void }, private readonly clock = () => new Date()) {}

  start(): void {
    if (this.loop || this.shutdown.signal.aborted) throw new Error('GoalRunner 不能重复启动');
    this.loop = this.runLoop();
  }

  private async runLoop(): Promise<void> {
    while (!this.shutdown.signal.aborted && !this.halted) {
      try { await this.tick(); } catch (error) { this.options.reportError(error); }
      try { await delay(this.options.pollIntervalMs, undefined, { signal: this.shutdown.signal }); } catch { break; }
    }
  }

  tick(): Promise<void> {
    if (this.work || this.halted || this.shutdown.signal.aborted) return Promise.resolve();
    this.work = this.runOne().finally(() => { this.work = undefined; });
    return this.work;
  }

  // 必须先由控制事务撤销提交权限，再协作中止指定片段。
  interrupt(goalId: string): void {
    if (this.active?.goalId === goalId) this.active.controller.abort();
  }

  private halt(error: unknown): void {
    this.halted = true;
    this.options.reportError(error);
    this.options.fatal();
  }

  private async runOne(): Promise<void> {
    // 保留原有前台/在途后台优先级，只作瞬时准入探测，不跨网络持门。
    const admission = this.lane.acquire(true);
    if (!admission) return;
    admission();
    const accepts = (item: Goal) => item.ownerId === this.options.ownerId && this.options.accepts(item.target);
    // 投递和只读观察不占模型执行门；等待期间旧Task仍可领取。
    if (this.options.proactiveEnabled) {
      await this.store.notifications.deliver(this.channel, this.options.ownerId, this.options.accepts, this.clock().toISOString());
      if (this.shutdown.signal.aborted) return;
      if (this.store.hasDueTasks(this.clock().toISOString())) return;
      this.store.policies.scan(this.clock().toISOString(), accepts);
      await this.store.policies.observe(this.clock().toISOString(), accepts, this.shutdown.signal);
    }
    if (this.shutdown.signal.aborted) return;
    const release = this.lane.acquire(true);
    if (!release) return;
    let finished: { goal: Goal; actor: GoalActor; runId: string; policy: boolean } | undefined;
    try {
      // 网络等待之后重新检查；模型执行及聚合提交仍共用同一互斥门。
      if (this.store.hasDueTasks(this.clock().toISOString())) return;
      const goal = this.store.goals.readyForHost().find(item => accepts(item) && (item.readyInput?.kind !== 'policy' || this.options.proactiveEnabled));
      if (!goal) return;
      try { this.executor.checkReady?.(); }
      catch (error) {
        const reason = String(error);
        if (reason !== this.blockedReason) { this.blockedReason = reason; this.options.reportError(error); }
        return;
      }
      this.blockedReason = undefined;
      // 同步健康检查也可能耗时；领取和消费预算前再核对到期Task。
      if (this.shutdown.signal.aborted || this.store.hasDueTasks(this.clock().toISOString())) return;
      const actor: GoalActor = { ownerId: goal.ownerId, target: goal.target };
      const claimed = this.store.goals.claim(actor, goal.id, goal.revision, this.clock().toISOString());
      if (!claimed) return;
      const { execution, run } = claimed;
      const controller = new AbortController();
      this.active = { goalId: goal.id, runId: run.id, controller };
      const signal = AbortSignal.any([this.shutdown.signal, controller.signal]);
      let result: GoalResult | undefined, failure: unknown;
      try {
        const projection = goalProjection(execution, this.store.goals.view(actor, goal.id));
        const response = await this.executor.execute({ ...projection, scope: 'goal', policyExecution: execution.input.authorization.kind === 'policy', signal, observer: this.store.observer(run.id) });
        if (signal.aborted) throw new ExecutionInterrupted('Goal 执行中断');
        result = parseGoalResult(response.text);
      } catch (error) { failure = error; }
      try {
        if (result) this.store.goals.commit(run.id, result, this.clock().toISOString());
        else this.store.goals.finishFailure(run.id, signal.aborted || failure instanceof ExecutionInterrupted ? 'interrupted' : 'failed',
          (failure instanceof Error ? failure.message : String(failure)).slice(0, 600), this.clock().toISOString());
      } catch (error) {
        // 提交返回异常先按 Run 重读，绝不再请求模型补交或覆盖已提交成果。
        try {
          const current = this.store.goals.executionForHost(run.id);
          this.store.goals.view(actor, goal.id);
          const technical = this.store.getRun(run.id);
          if (current.status === 'running' && technical?.status === 'running') this.store.goals.finishFailure(run.id, 'failed',
            error instanceof GoalPlanQuantityError ? error.message : 'checkpoint_commit_failed', this.clock().toISOString());
          else if (current.status !== 'committed' || technical?.status !== 'succeeded') throw error;
        } catch (readError) { this.halt(readError); return; }
      }
      finished = { goal, actor, runId: run.id, policy: execution.input.authorization.kind === 'policy' };
    } finally { this.active = undefined; release(); }
    // 只释放一次执行门，再等待通知；stop仍等待在途工作，不遗留数据库写入。
    if (!finished || this.shutdown.signal.aborted) return;
    const { goal, actor, runId } = finished;
    if (finished.policy) {
      if (this.options.proactiveEnabled) await this.store.notifications.deliver(this.channel, this.options.ownerId, this.options.accepts, this.clock().toISOString());
      return;
    }
    try {
      const displayed = this.store.goals.view(actor, goal.id);
      await this.channel.sendMessage({ text: renderGoal(displayed), goalId: goal.id, runId, target: goal.target });
      this.store.event(runId, 'delivery_succeeded');
      // 绑定实际发送的版本；网络等待期间的新计划不能冒充用户已经看到的内容。
      this.options.delivered?.(displayed.goal, runId);
    } catch (error) {
      try { this.store.deliveryFailed(runId, String(error)); } catch (auditError) { this.halt(auditError); }
      this.options.reportError(error);
    }
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    await Promise.all([this.work, this.loop]);
  }
}
