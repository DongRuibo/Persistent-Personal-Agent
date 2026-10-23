import type { ExecutionRequest } from './contracts.js';
import type { Goal, GoalActor, GoalCommand, GoalStepProposal } from './goal-types.js';
import type { SqliteStore } from './sqlite-store.js';
import type { TaskService } from './task-service.js';
import { renderGoal } from './goal-runner.js';
import type { SkillCatalog } from './skill-service.js';

export type GoalAction = 'create' | 'list' | 'view' | 'continue' | 'pause' | 'cancel' | 'approve_plan' | 'revise_plan' | 'complete';
export interface GoalDisplay {
  items: { id: string; revision: number; draftHash?: string }[];
  expires: number; displayRunId: string; action?: GoalAction;
  details: boolean;
}

// 此服务仅供 Guard 调用；没有模型类型、工具参数或独立的授权上下文。
export class GoalService {
  setSkills(skills?: SkillCatalog): void { this.store.goals.setSkills(skills); }
  private displaySink?: (display: GoalDisplay) => void;
  constructor(private readonly store: SqliteStore, private readonly tasks: TaskService,
    private readonly interrupt: (goalId: string) => void, private readonly ownerId = 'local-user') {}

  actor(): GoalActor { return { ownerId: this.ownerId, target: this.tasks.currentTarget() }; }
  setDisplaySink(sink: (display: GoalDisplay) => void): void { this.displaySink = sink; }
  displayed(goal: Goal, runId: string): void {
    if (goal.ownerId !== this.ownerId) throw new Error('Goal显示归属不一致');
    this.displaySink?.({ items: [{ id: goal.id, revision: goal.revision, draftHash: goal.pendingAction?.hash }],
      expires: this.tasks.now().getTime() + 300000, displayRunId: runId, details: true });
  }
  list(): Goal[] { return this.store.goals.list(this.actor()); }
  get(id: string): Goal { return this.store.goals.get(this.actor(), id); }
  receipt(request: ExecutionRequest): Goal | undefined {
    const receipt = request.source && this.store.goals.controlReceipt(this.actor(), request.source.reference);
    return receipt ? this.get(receipt.goalId) : undefined;
  }
  render(id: string): string { return renderGoal(this.store.goals.view(this.actor(), id)); }
  plan(id: string) { return this.store.goals.view(this.actor(), id); }

  validateDisplay(display: GoalDisplay, details = false): void {
    const run = this.store.getRun(display.displayRunId);
    if (details && !display.details || display.expires <= this.tasks.now().getTime() || run?.status !== 'succeeded'
      || !this.store.events(display.displayRunId).some(event => event.type === 'delivery_succeeded')) throw new Error('清单未成功投递或已过期，请重新查看目标');
    for (const item of display.items) {
      const goal = this.get(item.id);
      if (goal.revision !== item.revision || item.draftHash !== goal.pendingAction?.hash) throw new Error('目标或计划版本已变化，请重新查看');
    }
  }

  apply(request: ExecutionRequest, action: GoalAction, goal?: Goal, options: {
    executeNext?: boolean; regenerate?: boolean; prepend?: string; steps?: GoalStepProposal[]; skillId?: string | null;
  } = {}): Goal {
    request.signal.throwIfAborted();
    if (request.scope !== 'chat' || !request.source || request.source.channel !== this.actor().target.channel) throw new Error('Goal 需要当前可信交互来源');
    const now = this.tasks.now().toISOString();
    if (action === 'create') {
      if (Buffer.byteLength(request.prompt) > 3000) throw new Error('目标原话过长，请缩小到3000字节以内');
      return this.store.goals.create(this.actor(), request.source.reference, request.prompt, now);
    }
    if (!goal) throw new Error('需要唯一目标');
    const command: GoalCommand = { actor: this.actor(), sourceRunId: request.source.reference, expectedRevision: goal.revision, text: request.prompt };
    let updated: Goal;
    if (action === 'continue') updated = this.store.goals.continue(command, goal.id, now, options.regenerate);
    else if (action === 'approve_plan') {
      updated = this.store.goals.approvePlan(command, goal.id, goal.pendingAction?.hash ?? '', now, options.executeNext);
    }
    else if (action === 'revise_plan') {
      const view = this.plan(goal.id);
      const completed = view.plan.spec.steps.filter(step => view.steps.find(item => item.id === step.stepId)?.status === 'completed');
      const pending = view.plan.spec.steps.filter(step => !completed.includes(step));
      if (options.skillId !== undefined && !pending.some(step => step.stepId === goal.currentStepId)) throw new Error('没有可绑定的当前未完成步骤');
      const steps = options.skillId !== undefined ? view.plan.spec.steps.map(step => step.stepId === goal.currentStepId ? { ...step, skillId: options.skillId } : step)
        : options.prepend ? [...completed, { title: options.prepend, instruction: options.prepend,
        deliverable: `按本项要求交付文本：${options.prepend}`, doneWhen: '产物已交付，等待用户核对' }, ...pending] : [...completed, ...options.steps ?? []];
      updated = this.store.goals.proposePlan(command, goal.id, { steps, changeReason: request.prompt }, now);
    } else if (action === 'pause' || action === 'cancel' || action === 'complete') updated = this.store.goals.control(command, goal.id, action, now);
    else throw new Error('查询不能产生写操作');
    if (updated.controlRequested) this.interrupt(updated.id);
    return updated;
  }
}
