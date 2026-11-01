import * as Value from 'typebox/value';
import { ExecutionInterrupted } from './contracts.js';
import type { ExecutionObserver } from './contracts.js';
import { workRouteSchema } from './work-route-types.js';
import type { WorkRouteRequest, WorkRouteSuggestion, WorkRouteContext, WorkRoutePreparation, WorkRouteModel } from './work-route-types.js';
import type { WorkJobStore } from './work-job-store.js';
import type { WorkJob } from './work-job-types.js';
import type { WorkThreadActor } from './work-thread-types.js';
import type { WorkThreadService } from './work-thread-service.js';
import { WorkThreadError } from './work-thread-store.js';
import type { WebRun } from './web-ui-types.js';

type ChatInput = { mode: 'chat'; requestId: string; text: string };
type WorkInput = { mode: 'work'; requestId: string; text: string; threadId: string };

export type { WorkRouteRequest, WorkRouteSuggestion, WorkRouteContext, WorkRoutePreparation } from './work-route-types.js';
export function prepareWorkRoute(input: WorkRouteRequest, service: WorkThreadService): WorkRoutePreparation {
  let selected = input.selection.threadId ? service.get(input.selection.threadId) : undefined;
  if (selected?.status === 'archived') throw new WorkThreadError(409, '请先恢复主题，再请求路由建议');
  const reference = input.selection.object;
  const object = reference ? service.routingObject(reference.kind, reference.id) : undefined;
  const threads = selected ? [selected] : service.list(reference).filter(thread => thread.status === 'active');
  const context: WorkRouteContext = { threads, objects: [] };
  if (threads.length > 20 || Buffer.byteLength(input.text, 'utf8') > 14 * 1024) {
    return { context: { threads: [], objects: [] }, suggestion: { kind: 'clarify', question: '请缩小到最多20个主题，并将本次文字限制在14 KiB以内。' } };
  }
  if (selected && reference && !service.list(reference).some(thread => thread.id === selected!.id)) {
    return { context, suggestion: { kind: 'clarify', question: '明确对象与所选主题没有关联，请重新选择主题或对象。' } };
  }
  if (!selected && reference && threads.length === 1) selected = threads[0];
  if (selected) context.objects = service.routingObjects(selected.id);
  else if (object) context.objects = [object];
  if (context.objects.length > 20 || Buffer.byteLength(JSON.stringify(context), 'utf8') > 8 * 1024) {
    return { context: { threads: [], objects: [] }, suggestion: { kind: 'clarify', question: '候选元数据超过20个对象或8 KiB，请缩小主题或对象范围。' } };
  }
  if (reference && threads.length > 1) {
    return { context, suggestion: { kind: 'clarify', question: '此对象关联多个主题，请明确选择本次主题。' } };
  }
  if (reference) {
    const target = selected ? { threadId: selected.id } : {};
    return { context, suggestion: reference.kind === 'task'
      ? { kind: 'existing_task', taskId: reference.id, ...target, reason: '已定位明确任务；后续操作仍需原聊天与授权入口处理。' }
      : { kind: 'existing_goal', goalId: reference.id, ...target, reason: '已定位明确目标；后续操作仍需原聊天与授权入口处理。' } };
  }
  return { context, suggestion: null };
}

// 只在模型适配入口校验一次；往下传递已定类型的建议，不能生成任何授权。
export function parseWorkRouteSuggestion(text: string, input: WorkRouteRequest, context: WorkRouteContext): WorkRouteSuggestion {
  const value: unknown = JSON.parse(text);
  if (!Value.Check(workRouteSchema, value)) throw new Error('路由建议格式无效；未执行任何操作');
  const result = value as WorkRouteSuggestion;
  if (result.kind === 'chat' || result.kind === 'clarify') return result;
  if (result.threadId && !context.threads.some(thread => thread.id === result.threadId)
    || input.selection.threadId && result.threadId !== input.selection.threadId) throw new Error('路由建议主题与候选或当前选择不一致');
  if (result.kind !== 'work') {
    const kind = result.kind === 'existing_task' ? 'task' : 'goal';
    const id = result.kind === 'existing_task' ? result.taskId : result.goalId;
    if (!context.objects.some(object => object.kind === kind && object.id === id)) throw new Error('路由对象不在允许候选中');
    if (context.threads.length && !result.threadId) throw new Error('路由对象缺少当前主题');
  }
  return result;
}

export async function suggestWorkRoute(input: WorkRouteRequest, service: WorkThreadService, model: WorkRouteModel,
  signal: AbortSignal, observer: ExecutionObserver, prepared = prepareWorkRoute(input, service)): Promise<WorkRouteSuggestion> {
  if (signal.aborted) throw new ExecutionInterrupted('路由建议已取消；未执行任何操作');
  const result = prepared.suggestion ?? await model({ input, context: prepared.context, signal, observer });
  if (signal.aborted) throw new ExecutionInterrupted('路由建议已取消；未执行任何操作');
  const { reason: _reason, question: _question, ...ids } = result as WorkRouteSuggestion & { reason?: string; question?: string };
  observer.event('work_route_suggested', JSON.stringify({ ...ids, source: prepared.suggestion ? 'deterministic' : 'model' }));
  return result;
}

// 显式分派，不猜测文字意图，也不请求 Router 模型；原 Chat 和 Guard 继续负责自然语言操作。
export class WorkRouter {
  constructor(private readonly jobs: WorkJobStore, readonly actor: WorkThreadActor,
    private readonly chat: (requestId: string, text: string) => WebRun, private readonly interrupt: (id: string) => void) {}
  route(input: ChatInput): WebRun;
  route(input: WorkInput): WorkJob;
  route(input: ChatInput | WorkInput): WebRun | WorkJob {
    return input.mode === 'chat' ? this.chat(input.requestId, input.text)
      : this.jobs.create(this.actor, input.threadId, input.requestId, input.text, new Date().toISOString());
  }
  list(threadId?: string): WorkJob[] { return this.jobs.list(this.actor, threadId); }
  get(id: string): WorkJob { return this.jobs.get(this.actor, id); }
  cancel(id: string): WorkJob {
    const job = this.jobs.cancel(this.actor, id, new Date().toISOString());
    if (job.status === 'cancelled') this.interrupt(id);
    return job;
  }
}
