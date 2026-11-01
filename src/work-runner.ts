import { setTimeout as delay } from 'node:timers/promises';
import { ExecutionInterrupted } from './contracts.js';
import type { AgentExecutor, Channel, MessageTarget } from './contracts.js';
import type { SqliteStore } from './sqlite-store.js';
import type { BackgroundLane } from './background-lane.js';
import type { WorkThreadActor } from './work-thread-types.js';

export class WorkRunner {
  private readonly shutdown = new AbortController();
  private loop?: Promise<void>;
  private work?: Promise<void>;
  private active?: { id: string; controller: AbortController };
  private halted = false;
  private blockedReason?: string;

  constructor(private readonly store: SqliteStore, private readonly executor: AgentExecutor,
    private readonly channel: Channel, private readonly lane: BackgroundLane,
    private readonly options: { actor: WorkThreadActor; target: Extract<MessageTarget, { channel: 'web' }>;
      pollIntervalMs: number; goalReady(): boolean; reportError(error: unknown): void; fatal(): void },
    private readonly clock = () => new Date()) {}
  start(): void {
    if (this.loop || this.shutdown.signal.aborted) throw new Error('WorkRunner 不能重复启动');
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
  interrupt(id: string): void { if (this.active?.id === id) this.active.controller.abort(); }
  private async runOne(): Promise<void> {
    if (!this.store.workJobs.hasQueued(this.options.actor)) return;
    const release = this.lane.acquire(true);
    if (!release) return;
    let finished: { runId: string; jobId: string; threadId: string } | undefined;
    try {
      if (this.store.hasDueTasks(this.clock().toISOString()) || this.options.goalReady()) return;
      try { this.executor.checkReady?.(); }
      catch (error) {
        const reason = String(error);
        if (reason !== this.blockedReason) { this.blockedReason = reason; this.options.reportError(error); }
        return;
      }
      this.blockedReason = undefined;
      if (this.shutdown.signal.aborted || this.store.hasDueTasks(this.clock().toISOString()) || this.options.goalReady()) return;
      const claimed = this.store.workJobs.claim(this.options.actor, this.clock().toISOString());
      if (!claimed) return;
      const { job, run } = claimed, controller = new AbortController();
      this.active = { id: job.id, controller };
      const signal = AbortSignal.any([this.shutdown.signal, controller.signal]);
      let text: string | undefined, detail: string | undefined, status: 'succeeded' | 'failed' | 'interrupted' = 'succeeded';
      try {
        text = (await this.executor.execute({ prompt: job.instruction, scope: 'work', signal, observer: this.store.observer(run.id) })).text;
        if (signal.aborted) throw new ExecutionInterrupted('后台工作已中断；不自动重试');
      } catch (error) {
        status = signal.aborted || error instanceof ExecutionInterrupted ? 'interrupted' : 'failed';
        detail = error instanceof Error ? error.message : String(error);
      }
      try {
        if (this.store.workJobs.finish(this.options.actor, job.id, run.id, status, this.clock().toISOString(), status === 'succeeded' ? text : undefined, detail)) {
          finished = { runId: run.id, jobId: job.id, threadId: job.threadId };
        }
      } catch (error) {
        // 提交异常不补跑模型，也不放出新的工作；停服后由同一恢复事务核对状态。
        this.halted = true; this.options.reportError(error); this.options.fatal();
      }
    } finally { this.active = undefined; release(); }
    if (!finished) return;
    const run = this.store.getRun(finished.runId)!;
    try {
      await this.channel.sendMessage({ target: this.options.target, runId: run.id,
        text: `后台工作 ${finished.jobId.slice(0, 8)} · ${this.store.workThreads.get(this.options.actor, finished.threadId).title}\n`
          + (run.status === 'succeeded' ? run.output! : `后台工作${run.status === 'failed' ? '失败' : '中断'}：${run.error}`) });
      this.store.event(run.id, 'delivery_succeeded');
    } catch (error) {
      this.store.deliveryFailed(run.id, error instanceof Error ? error.message : String(error)); this.options.reportError(error);
    }
  }
  async stop(): Promise<void> { this.shutdown.abort(); await this.loop; await this.work; }
}
