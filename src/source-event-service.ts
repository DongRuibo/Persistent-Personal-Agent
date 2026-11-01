import { setTimeout as delay } from 'node:timers/promises';
import type { MessageTarget } from './contracts.js';
import { GitHubObserver, validateWatch } from './github-observer.js';
import { utc } from './goal-schedule.js';
import { SourceEventError } from './source-event-store.js';
import type { WorkThreadService } from './work-thread-service.js';
import type { SubscriptionRequest, WorkEventFeed } from './source-event-types.js';
import type { SourceEventStore } from './source-event-store.js';
import type { EventSource, SourcePermission } from './source-event-types.js';
import type { WorkThreadActor } from './work-thread-types.js';

// 只由本机 Web 宿主组装；permit 必须来自当前明确许可，不注册为模型工具。
export class SourceEventService {
  readonly binding: WorkThreadActor;
  private readonly shutdown = new AbortController();
  private loop?: Promise<void>;
  private work?: Promise<void>;
  constructor(private readonly store: SourceEventStore,
    actor: { owner: string; target: Extract<MessageTarget, { channel: 'web' }> },
    private readonly options: { enabled: boolean; pollIntervalMs: number; reportError(error: unknown): void; threads?: WorkThreadService; dispatch?: (eventId: string, subscriptionId: string, now: string) => void },
    private readonly observer = new GitHubObserver(), private readonly clock = () => new Date()) {
    this.binding = { owner: actor.owner, channel: JSON.stringify(actor.target) };
    if (options.threads && (options.threads.binding.owner !== this.binding.owner || options.threads.binding.channel !== this.binding.channel)) throw new Error('来源与工作主题宿主身份不一致');
  }
  permit(permission: SourcePermission): EventSource {
    if (!this.options.enabled || this.shutdown.signal.aborted) throw new Error('来源观察未开启或已停止');
    if (!permission || typeof permission.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/u.test(permission.requestId)
      || !permission.watch || permission.watch.kind !== 'github' || Object.keys(permission).some(key => !['requestId', 'watch'].includes(key))
      || Object.keys(permission.watch).some(key => !['kind', 'repository', 'branch', 'intervalSeconds'].includes(key))) throw new SourceEventError(400, '需明确的来源许可请求和固定GitHub描述符');
    try { validateWatch(permission.watch); } catch (error) { throw new SourceEventError(400, error instanceof Error ? error.message : '来源范围无效'); }
    return this.store.permit(this.binding, permission, this.clock().toISOString());
  }
  setStatus(id: string, status: EventSource['status'], expectedRevision: number): EventSource {
    if (!this.options.enabled || this.shutdown.signal.aborted) throw new Error('来源观察未开启或已停止');
    if (!['active', 'paused'].includes(status) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new SourceEventError(400, '来源状态或版本无效');
    return this.store.setStatus(this.binding, id, status, expectedRevision, this.clock().toISOString());
  }
  list() { return this.store.list(this.binding); }
  event(id: string) { return this.store.event(this.binding, id); }
  private threads(): WorkThreadService {
    if (!this.options.enabled || this.shutdown.signal.aborted || !this.options.threads) throw new SourceEventError(404, '订阅宿主未开启');
    return this.options.threads;
  }
  subscribe(input: SubscriptionRequest) {
    if (!input || Object.keys(input).some(key => !['id', 'sourceId', 'threadId', 'goalId'].includes(key))
      || ![input.id, input.sourceId, input.threadId].every(value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(value))
      || input.goalId != null && (typeof input.goalId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(input.goalId))) throw new SourceEventError(400, '订阅来源或目标ID无效');
    return this.store.subscribe(this.binding, input, this.clock().toISOString(), this.threads());
  }
  subscriptionStatus(id: string, status: 'active' | 'paused', expectedRevision: number) {
    if (!['active', 'paused'].includes(status) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new SourceEventError(400, '订阅状态或版本无效');
    return this.store.setSubscriptionStatus(this.binding, id, status, expectedRevision, this.clock().toISOString(), this.threads());
  }
  feed(threadId: string): WorkEventFeed {
    const threads = this.threads();
    return { subscriptions: this.store.subscriptions(this.binding, threadId, threads), events: this.store.threadEvents(this.binding, threadId, threads) };
  }
  policyContext(id: string) { return this.store.policyContext(this.binding, id, this.threads()); }
  start(): void {
    if (!this.options.enabled) return;
    if (this.loop || this.shutdown.signal.aborted) throw new Error('来源观察不能重复启动');
    this.loop = this.runLoop();
  }
  private async runLoop(): Promise<void> {
    while (!this.shutdown.signal.aborted) {
      try { await this.tick(); } catch (error) { this.options.reportError(error); }
      try { await delay(this.options.pollIntervalMs, undefined, { signal: this.shutdown.signal }); } catch { break; }
    }
  }
  tick(): Promise<void> {
    if (!this.options.enabled || this.shutdown.signal.aborted || this.work) return Promise.resolve();
    this.work = this.poll().finally(() => { this.work = undefined; });
    return this.work;
  }
  private async poll(): Promise<void> {
    const now = this.clock().toISOString(); utc(now);
    this.store.settlePending(this.binding, now, this.options.threads);
    this.dispatchPending(now);
    for (const source of this.store.due(this.binding, now)) {
      if (!this.options.enabled || this.shutdown.signal.aborted) return;
      let snapshot;
      try { snapshot = await this.observer.poll(source.watch, source.head, this.shutdown.signal); }
      catch (error) {
        if (!this.options.enabled || this.shutdown.signal.aborted) return;
        this.store.failed(this.binding, source, error, this.clock().toISOString()); continue;
      }
      if (!this.options.enabled || this.shutdown.signal.aborted) return;
      // 网络错误才退避；事实提交故障交宿主报告，不能伪装成观察失败吞掉。
      this.store.record(this.binding, source, snapshot, this.clock().toISOString(), this.options.threads);
      this.dispatchPending(this.clock().toISOString());
    }
  }
  private dispatchPending(now: string): void {
    if (!this.options.enabled || this.shutdown.signal.aborted || !this.options.dispatch) return;
    for (const row of this.store.pendingPolicyEvents(this.binding)) this.options.dispatch(row.eventId, row.subscriptionId, now);
  }
  async stop(): Promise<void> { this.shutdown.abort(); await this.loop; await this.work; }
}
