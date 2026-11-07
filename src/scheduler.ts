import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionInterrupted } from './contracts.js';
import type { AgentExecutor, Channel, Scheduler } from './contracts.js';
import { SqliteStore } from './sqlite-store.js';
import { BackgroundLane } from './background-lane.js';
import { NotificationWorker } from './notification-worker.js';

export class TaskScheduler implements Scheduler {
  private readonly shutdown = new AbortController();
  private loop?: Promise<void>;
  private busy = false;
  private blockedReason?: string;
  private readonly notifications: NotificationWorker;
  private readonly eagerDelivery: boolean;

  constructor(
    private readonly store: SqliteStore,
    private readonly executor: AgentExecutor,
    private readonly channel: Channel,
    private readonly pollIntervalMs: number,
    private readonly reportError: (error: unknown) => void,
    private readonly clock = () => new Date(),
    private readonly lane = new BackgroundLane(),
    notifications?: NotificationWorker,
  ) {
    this.eagerDelivery = !notifications;
    this.notifications = notifications ?? new NotificationWorker(store, channel,
      { ownerId: 'local-user', accepts: () => true, pollIntervalMs, reportError }, clock);
  }

  start(): void {
    if (this.loop || this.shutdown.signal.aborted) throw new Error('调度器不能重复启动');
    this.loop = this.runLoop();
  }

  private async runLoop(): Promise<void> {
    while (!this.shutdown.signal.aborted) {
      try { await this.tick(); } catch (error) { this.reportError(error); }
      try { await delay(this.pollIntervalMs, undefined, { signal: this.shutdown.signal }); }
      catch { break; }
    }
  }

  async tick(): Promise<void> {
    if (this.busy || this.shutdown.signal.aborted) return;
    const release = this.lane.acquire();
    if (!release) return;
    this.busy = true;
    try {
      if (!this.store.hasDueTasks(this.clock().toISOString())) {
        if (this.eagerDelivery) await this.notifications.tick();
        return;
      }
      try { this.executor.checkReady?.(); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (reason !== this.blockedReason) {
          this.blockedReason = reason;
          this.reportError(new Error(`后台任务执行前检查失败，任务保持 pending，尚未领取：${reason}`));
        }
        return;
      }
      this.blockedReason = undefined;
      if (this.shutdown.signal.aborted) return;
      const claimed = this.store.claimDue(this.clock().toISOString());
      if (!claimed) return;
      const { task, run } = claimed;
      let output: string | undefined, failure: string | undefined;
      let status: 'succeeded' | 'failed' | 'interrupted' = 'succeeded';
      try {
        const result = await this.executor.execute({
          prompt: task.instruction, scope: 'task', signal: this.shutdown.signal,
          observer: this.store.observer(run.id),
        });
        if (this.shutdown.signal.aborted) throw new ExecutionInterrupted('服务正在停止');
        output = result.text;
      } catch (error) {
        status = error instanceof ExecutionInterrupted || this.shutdown.signal.aborted ? 'interrupted' : 'failed';
        failure = error instanceof Error ? error.message : String(error);
      }
      // 模型异常与聚合提交异常分开；Outbox失败整体回滚，不能将已生成结果再伪报模型失败。
      this.store.finishTaskRun(run.id, status, this.clock().toISOString(), output, failure);
    } finally {
      this.busy = false;
      release();
    }
    // main注入独立Worker；直接使用Scheduler的既有入口仍保留一次即时投递。
    if (this.eagerDelivery) await this.notifications.tick();
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    await this.loop;
    if (this.eagerDelivery) await this.notifications.stop();
  }
}
