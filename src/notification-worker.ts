import { setTimeout as delay } from 'node:timers/promises';
import type { Channel, MessageTarget } from './contracts.js';
import type { SqliteStore } from './sqlite-store.js';

// 仅投递已提交的发送意图，不持有模型执行门，不领取或重跑Task。
export class NotificationWorker {
  private readonly shutdown = new AbortController();
  private loop?: Promise<void>;
  private work?: Promise<void>;
  constructor(private readonly store: SqliteStore, private readonly channel: Channel,
    private readonly options: { ownerId: string; accepts(target: MessageTarget): boolean; pollIntervalMs: number; reportError(error: unknown): void; timeoutMs?: number; includeGoals?: boolean },
    private readonly clock = () => new Date()) {}
  start(): void {
    if (this.loop || this.shutdown.signal.aborted) throw new Error('通知Worker不能重复启动');
    this.loop = this.run();
  }
  private async run(): Promise<void> {
    while (!this.shutdown.signal.aborted) {
      try { await this.tick(); } catch (error) { this.options.reportError(error); }
      try { await delay(this.options.pollIntervalMs, undefined, { signal: this.shutdown.signal }); } catch { break; }
    }
  }
  tick(): Promise<void> {
    if (this.work || this.shutdown.signal.aborted) return Promise.resolve();
    this.work = this.store.notifications.deliver(this.channel, this.options.ownerId, this.options.accepts, this.clock().toISOString(),
      { timeoutMs: this.options.timeoutMs, clock: this.clock, taskOnly: !this.options.includeGoals }).then(result => { if (result?.error) this.options.reportError(new Error(result.error)); })
      .finally(() => { this.work = undefined; });
    return this.work;
  }
  async stop(): Promise<void> { this.shutdown.abort(); await Promise.all([this.loop, this.work]); }
}
