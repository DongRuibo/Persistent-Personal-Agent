import type { MemoryRecord, MessageTarget } from './contracts.js';
import type { FileMemoryService } from './memory-service.js';
import type { SqliteStore } from './sqlite-store.js';
import { retrieve } from './memory-retriever.js';
import { WorkThreadError } from './work-thread-store.js';
import type { WorkObject, WorkObjectKind, WorkThreadActor, WorkThreadDetail } from './work-thread-types.js';

// 只由可信 Web 宿主组装；关联既不授予对象访问权，也不参与 Guard 的操作许可。
export class WorkThreadService {
  readonly binding: WorkThreadActor;
  constructor(private readonly store: SqliteStore, private readonly memory: Pick<FileMemoryService, 'listForHost'>,
    private readonly actor: { owner: string; target: Extract<MessageTarget, { channel: 'web' }> },
    private readonly goalsEnabled: boolean) {
    this.binding = { owner: actor.owner, channel: JSON.stringify(actor.target) };
  }
  private object(kind: WorkObjectKind, id: string, memories?: MemoryRecord[]): WorkObject | null {
    if (kind === 'task') {
      const task = this.store.getTask(id);
      return task && task.target.channel === 'web' && task.target.userId === this.actor.target.userId
        ? { kind, id, title: task.instruction.slice(0, 240), status: task.status, updatedAt: task.updatedAt } : null;
    }
    if (kind === 'goal') {
      if (!this.goalsEnabled) return null;
      // 原 Goal 查询以异常表示不可见；只转换这一已知结果，存储故障继续上报。
      try {
        const goal = this.store.goals.get({ ownerId: 'local-user', target: this.actor.target }, id);
        return { kind, id, title: goal.objective.slice(0, 240), status: goal.status, updatedAt: goal.updatedAt };
      } catch (error) {
        if (error instanceof Error && error.message === 'Goal 不存在或无权访问') return null;
        throw error;
      }
    }
    if (kind === 'run') {
      if (!this.store.webUi.ownsRun(this.binding.owner, this.binding.channel, id)) return null;
      const run = this.store.getRun(id)!;
      return { kind, id, title: `${run.taskId ? '任务' : '执行'}记录 ${id.slice(0, 8)}`, status: run.status,
        updatedAt: run.finishedAt ?? run.startedAt };
    }
    const record = (memories ?? this.memory.listForHost()).find(item => item.id === id);
    if (!record || record.source.channel !== 'web'
      || !this.store.webUi.ownsRun(this.binding.owner, this.binding.channel, record.source.reference)) return null;
    return { kind, id, title: record.key, status: 'available', updatedAt: record.updatedAt };
  }
  candidates(kind: WorkObjectKind): WorkObject[] {
    const memories = kind === 'memory' ? this.memory.listForHost() : undefined;
    const ids = kind === 'task' ? this.store.tasksForTarget(this.actor.target).map(task => task.id)
      : kind === 'goal' ? this.goalsEnabled ? this.store.goals.list({ ownerId: 'local-user', target: this.actor.target }).map(goal => goal.id) : []
      : kind === 'run' ? this.store.webUi.runs(this.binding.owner, this.binding.channel)
      : memories!.map(record => record.id);
    return ids.map(id => this.object(kind, id, memories)).filter((item): item is WorkObject => item !== null).slice(0, 100);
  }
  detail(id: string): WorkThreadDetail {
    const thread = this.store.workThreads.get(this.binding, id), links = this.store.workThreads.links(this.binding, id);
    const memories = links.some(link => link.kind === 'memory') ? this.memory.listForHost() : undefined;
    return { ...thread, links: links.map(link => ({ ...link, object: this.object(link.kind, link.objectId, memories) })) };
  }
  link(id: string, kind: WorkObjectKind, objectId: string): void {
    if (!this.object(kind, objectId)) throw new WorkThreadError(404, '关联对象不存在或无权访问');
    this.store.workThreads.link(this.binding, id, kind, objectId, new Date().toISOString());
  }
  // 路由候选只读 Goal/Task 元数据，复用原归属判断，不触发 Memory 正文扫描。
  routingObject(kind: 'goal' | 'task', id: string): WorkObject {
    const object = this.object(kind, id);
    if (!object) throw new WorkThreadError(404, '关联对象不存在或无权访问');
    return object;
  }
  routingObjects(id: string): WorkObject[] {
    return this.store.workThreads.links(this.binding, id)
      .filter(link => link.kind === 'goal' || link.kind === 'task')
      .map(link => this.object(link.kind, link.objectId)).filter((item): item is WorkObject => item !== null);
  }
  // 与B1分开投影：不扩展持久关联种类，不调用会读取Memory的detail。
  recallObject(kind: 'goal' | 'task' | 'run' | 'job', id: string) {
    if (kind === 'goal' || kind === 'task') return this.object(kind, id);
    if (kind === 'job') {
      const job = this.store.workJobs.get(this.binding, id);
      return { kind, id, title: job.instruction.slice(0, 240), status: job.status, updatedAt: job.updatedAt, threadId: job.threadId };
    }
    const run = this.store.webUi.runMetadata(this.binding.owner, this.binding.channel, id);
    return run ? { kind, id, title: `${run.taskId ? '任务' : '执行'}记录 ${id.slice(0, 8)}`, status: run.status,
      updatedAt: run.finishedAt ?? run.startedAt } : null;
  }
  recallObjects(id: string) {
    const linked = this.store.workThreads.links(this.binding, id).filter(link => link.kind !== 'memory')
      .map(link => this.recallObject(link.kind as 'goal' | 'task' | 'run', link.objectId)).filter(item => item !== null);
    const jobs = this.store.workJobs.list(this.binding, id).map(job => ({ kind: 'job' as const, id: job.id,
      title: job.instruction.slice(0, 240), status: job.status, updatedAt: job.updatedAt, threadId: job.threadId }));
    return [...linked, ...jobs];
  }
  recallThreads(kind: 'goal' | 'task' | 'run' | 'job', id: string) {
    if (kind === 'job') return [this.get(this.store.workJobs.get(this.binding, id).threadId)];
    return this.list().filter(thread => this.store.workThreads.links(this.binding, thread.id)
      .some(link => link.kind === kind && link.objectId === id));
  }
  recallExecution(runId: string) {
    return this.store.goals.recallExecution({ ownerId: 'local-user', target: this.actor.target }, runId, this.goalsEnabled);
  }
  recallHistory(goalId: string) {
    this.routingObject('goal', goalId);
    return this.store.goals.recallHistory({ ownerId: 'local-user', target: this.actor.target }, goalId);
  }
  recallRun(runId: string) { return this.store.webUi.recallRun(this.binding.owner, this.binding.channel, runId); }
  recallObjectRun(kind: 'task' | 'job', id: string) {
    if (kind === 'job') {
      const job = this.store.workJobs.get(this.binding, id);
      return { runId: job.runId, instruction: job.instruction };
    }
    if (!this.object('task', id)) return null;
    return { runId: this.store.webUi.taskRunId(this.binding.channel, id), instruction: this.store.getTask(id)!.instruction };
  }
  recallEventEvidence(threadId: string, eventId: string) {
    return this.store.sourceEvents.recallEvidence(this.binding, this, threadId, eventId);
  }
  recallBackground(query: string, threadId?: string) {
    const ids = threadId ? new Set(this.store.workThreads.links(this.binding, threadId)
      .filter(link => link.kind === 'memory').map(link => link.objectId)) : undefined;
    // 沿原listForHost修复/扫描读取，仅在显式背景分支调用；过滤后才纯计算检索，不触发改写。
    const records = this.memory.listForHost().filter(record => record.source.channel === 'web'
      && this.store.webUi.ownsRun(this.binding.owner, this.binding.channel, record.source.reference)
      && (!ids || ids.has(record.id)));
    return retrieve(records, query).records;
  }
  recallSourceIds(threadId: string) {
    return [...new Set(this.store.sourceEvents.subscriptions(this.binding, threadId, this).map(item => item.sourceId))];
  }
  recallEvents(threadId?: string, eventId?: string) {
    return this.store.sourceEvents.recallMetadata(this.binding, this, threadId, eventId);
  }
  get(id: string) { return this.store.workThreads.get(this.binding, id); }
  list(object?: { kind: 'goal' | 'task'; id: string }) {
    const threads = this.store.workThreads.list(this.binding);
    return object ? threads.filter(thread => this.store.workThreads.links(this.binding, thread.id)
      .some(link => link.kind === object.kind && link.objectId === object.id)) : threads;
  }
  create(id: string, title: string) { return this.store.workThreads.create(this.binding, id, title, new Date().toISOString()); }
  update(id: string, change: Parameters<SqliteStore['workThreads']['update']>[2]) {
    return this.store.workThreads.update(this.binding, id, change, new Date().toISOString());
  }
  unlink(id: string, kind: WorkObjectKind, objectId: string): void {
    // 原对象已删除时仍可清理本人的关系；不调用任何原业务对象的写入方法。
    this.store.workThreads.unlink(this.binding, id, kind, objectId, new Date().toISOString());
  }
}
