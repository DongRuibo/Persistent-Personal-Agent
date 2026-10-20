import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionInterrupted } from './contracts.js';
import type { AgentExecutor, Channel, Scheduler } from './contracts.js';
import { SqliteStore } from './sqlite-store.js';

export class TaskScheduler implements Scheduler {
  private readonly shutdown = new AbortController();
  private loop?: Promise<void>;
  private busy = false;

  constructor(
    private readonly store: SqliteStore,
    private readonly executor: AgentExecutor,
    private readonly channel: Channel,
    private readonly pollIntervalMs: number,
    private readonly reportError: (error: unknown) => void,
    private readonly clock = () => new Date(),
  ) {}

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
    this.busy = true;
    try {
      const claimed = this.store.claimDue(this.clock().toISOString());
      if (!claimed) return;
      const { task, run } = claimed;
      let message: string;
      try {
        const result = await this.executor.execute({
          prompt: task.instruction, scope: 'task', signal: this.shutdown.signal,
          observer: this.store.observer(run.id),
        });
        if (this.shutdown.signal.aborted) throw new ExecutionInterrupted('服务正在停止');
        this.store.finishRun(run.id, 'succeeded', this.clock().toISOString(), result.text);
        message = result.text;
      } catch (error) {
        const status = error instanceof ExecutionInterrupted || this.shutdown.signal.aborted ? 'interrupted' : 'failed';
        const detail = error instanceof Error ? error.message : String(error);
        this.store.finishRun(run.id, status, this.clock().toISOString(), undefined, detail);
        message = `任务 ${status}: ${detail}`;
      }
      // 先提交任务结果，再投递通知；通知失败只记录，不重新执行模型或工具。
      try {
        await this.channel.sendMessage({ text: message, taskId: task.id, runId: run.id, target: task.target });
        this.store.event(run.id, 'delivery_succeeded');
      } catch (error) {
        this.store.deliveryFailed(run.id, error instanceof Error ? error.message : String(error));
        this.reportError(error);
      }
    } finally {
      this.busy = false;
    }
  }

  async stop(): Promise<void> {
    this.shutdown.abort();
    await this.loop;
  }
}
