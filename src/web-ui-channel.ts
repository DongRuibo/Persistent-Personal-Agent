import { createHash } from 'node:crypto';
import { ExecutionInterrupted } from './contracts.js';
import type { AgentExecutor, Channel, MessageTarget, OutboundMessage } from './contracts.js';
import type { SqliteStore } from './sqlite-store.js';
import type { TaskService } from './task-service.js';
import type { GoalService } from './goal-service.js';
import type { BackgroundLane } from './background-lane.js';
import type { Config } from './config.js';
import type { WebFile, WebGoalDetail, WebRun, WebSnapshot } from './web-ui-types.js';
import type { FileMemoryService } from './memory-service.js';
import { WorkThreadService } from './work-thread-service.js';
import { WorkRouter } from './work-router.js';
import type { WebWorkJob } from './web-ui-types.js';
import type { WebSearchCall } from './web-search-types.js';

export const webTarget: MessageTarget & { channel: 'web' } = { channel: 'web', userId: 'local-user' };
export const webChatKey = JSON.stringify(['web', webTarget.userId]);
export const webOwner = createHash('sha256').update(webChatKey).digest('hex');
const targetJson = JSON.stringify(webTarget);
export class WebUiError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export class WebUiChannel implements Channel {
  private readonly shutdown = new AbortController();
  private work?: Promise<void>;
  readonly workThreads?: WorkThreadService;
  readonly workRouter?: WorkRouter;
  constructor(private readonly store: SqliteStore, private readonly tasks: TaskService, private readonly executor: AgentExecutor,
    private readonly config: Config, private readonly goals?: GoalService, private readonly lane?: BackgroundLane,
    private readonly reportError: (error: unknown) => void = () => {}, memory?: Pick<FileMemoryService, 'listForHost'>, interruptWork: (id: string) => void = () => {}) {
    if (config.workThreadsEnabled) {
      if (!memory) throw new Error('工作主题需要宿主 Memory 查询服务');
      this.workThreads = new WorkThreadService(store, memory, { owner: webOwner, target: webTarget }, !!goals);
    }
    if (config.workJobsEnabled) {
      if (!this.workThreads) throw new Error('后台工作需要 WORK_THREADS_ENABLED=true');
      this.workRouter = new WorkRouter(store.workJobs, this.workThreads.binding, (id, text) => this.submit(id, text), interruptWork);
    }
  }

  job(id: string): WebWorkJob {
    if (!this.workRouter) throw new WebUiError(404, '接口不存在');
    const job = this.workRouter.get(id);
    return { ...job, run: job.runId ? this.run(job.runId) : null };
  }

  run(id: string, includeDetails = true): WebRun {
    if (!this.store.webUi.ownsRun(webOwner, targetJson, id)) throw new WebUiError(404, '执行记录不存在');
    const r = this.store.getRun(id)!;
    const fileOperationId = includeDetails ? undefined : this.store.webUi.fileForRun(webOwner, targetJson, id);
    const calls = this.store.modelCalls(id);
    const events = this.store.events(id), webCalls = new Map<string, WebSearchCall>();
    for (const event of events) {
      if (event.type !== 'tavily_call' || !event.details) continue;
      const call = JSON.parse(event.details) as WebSearchCall;
      // 进程退出不会重放请求；未结束的工具随原Run终态显示为失败。
      if (call.status === 'running' && r.status !== 'running') {
        call.status = 'failed'; call.message = '网页请求已中断，未自动重试。';
      }
      webCalls.set(call.id, call);
    }
    const web = [...webCalls.values()], last = web.at(-1);
    const summary = last ? { calls: web.length, searches: web.filter(c => c.kind === 'search' && c.status === 'succeeded').length,
      reads: web.filter(c => c.kind === 'fetch' && c.status === 'succeeded').length, sources: new Set(web.flatMap(c => c.sources.map(s => s.url))).size,
      status: last.status, kind: last.kind, ...(last.message ? { message: last.message } : {}) } : undefined;
    const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') => calls.reduce((n, c) => n + c[key], 0);
    return { id: r.id, taskId: r.taskId, status: r.status, startedAt: r.startedAt, finishedAt: r.finishedAt,
      // 轮询中的文件Run只带详情引用，避免通过聊天/活动再次携带完整审批预览。
      output: fileOperationId ? null : r.output?.slice(0, 32768) ?? null, ...(fileOperationId ? { fileOperationId } : {}), truncated: (r.output?.length ?? 0) > 32768,
      error: r.error ? '执行失败或中断，请核对状态；详细诊断保留在本机。' : null,
      viewed: events.some(e => e.type === 'delivery_succeeded'),
      ...(this.workRouter ? { deliveryError: r.deliveryError ? '通知投递失败；结果已保留。' : null } : {}),
      ...(summary ? { web: summary, ...(includeDetails ? { webCalls: web } : {}) } : {}),
      usage: { calls: calls.length, inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'),
        cacheWriteTokens: sum('cacheWriteTokens'), cost: calls.length && calls.every(c => c.cost !== null) ? calls.reduce((n, c) => n + c.cost!, 0) : null } };
  }
  submit(requestId: string, text: string, before?: () => void): WebRun {
    const old = this.store.webUi.find(webOwner, requestId);
    if (old) {
      if (old.text !== text) throw new WebUiError(409, '此请求 ID 已用于其他内容');
      return this.run(old.runId);
    }
    if (this.shutdown.signal.aborted) throw new WebUiError(503, '服务正在停止');
    if (this.work) throw new WebUiError(409, 'Agent 正在执行，请等待当前请求结束');
    before?.();
    const run = this.store.webUi.accept(webOwner, requestId, text, new Date().toISOString());
    const release = this.lane?.foreground();
    this.work = this.process(run.id, text).catch(this.reportError).finally(() => { this.work = undefined; release?.(); });
    return this.run(run.id);
  }
  private async process(id: string, text: string): Promise<void> {
    try {
      const result = await this.tasks.withTarget(webTarget, () => this.executor.execute({ prompt: text, scope: 'chat',
        signal: this.shutdown.signal, observer: this.store.observer(id), source: { channel: 'web', reference: id } }));
      if (this.shutdown.signal.aborted) throw new ExecutionInterrupted('服务正在停止');
      this.store.finishRun(id, 'succeeded', new Date().toISOString(), result.text);
    } catch (error) {
      this.store.finishRun(id, error instanceof ExecutionInterrupted || this.shutdown.signal.aborted ? 'interrupted' : 'failed',
        new Date().toISOString(), undefined, error instanceof Error ? error.message : String(error));
    }
    // 浏览器读到响应不等于用户已看到；只有显式渲染 ACK 才写 delivery_succeeded。
  }
  file(id: string): WebFile {
    if (!this.store.webUi.fileIds(webOwner, targetJson).includes(id)) throw new WebUiError(404, '文件操作不存在或不在最近 60 项中');
    const { proposal: p, status } = this.store.files.get(id);
    const run = this.run(p.runId);
    return { run, id: p.id, runId: p.runId, path: p.path, kind: p.kind, hash: p.hash, contentHash: p.contentHash,
      content: p.content, preview: p.preview, diff: p.diff ?? '',
      createdAt: run.startedAt, expires: p.expires, status: status === 'pending' && p.expires <= Date.now() ? 'expired' : status, acknowledged: run.viewed };
  }
  acknowledge(id: string, hash?: string): void {
    const run = this.run(id);
    if (run.status !== 'succeeded' || run.truncated) throw new WebUiError(409, '结果尚未完整完成，不能确认展示');
    const file = this.store.webUi.fileIds(webOwner, targetJson).map(key => this.file(key)).find(f => f.runId === id);
    if (file && file.hash !== hash) throw new WebUiError(409, '完整文件预览 Hash 不匹配');
    if (file && file.preview !== run.output) throw new WebUiError(409, '来源 Run 结果与冻结预览不一致');
    if (!run.viewed) this.store.event(id, 'delivery_succeeded', 'web_render_ack');
  }
  decide(id: string, hash: string, action: 'confirm' | 'reject', requestId: string): WebRun {
    return this.submit(requestId, `${action === 'confirm' ? '确认' : '取消'}文件操作 ${id} ${hash}`, () => {
      const f = this.file(id);
      if (f.hash !== hash || f.status !== 'pending' || !f.acknowledged) throw new WebUiError(409, '请先展示完整预览；操作也可能已过期或已消费');
    });
  }
  goal(id: string): WebGoalDetail {
    if (!this.goals) throw new WebUiError(409, 'Goal 未启用');
    const view = this.tasks.withTarget(webTarget, () => {
      if (!this.goals!.list().some(g => g.id === id)) throw new WebUiError(404, 'Goal 不存在或不在当前列表中');
      return this.goals!.plan(id);
    });
    const g = view.goal;
    return { id: g.id, objective: g.objective, status: g.status, updatedAt: g.updatedAt, blockedReason: g.blockedReason,
      planRevision: view.plan.revision, steps: view.plan.spec.steps.map(s => ({ id: s.stepId, title: s.title, instruction: s.instruction,
        deliverable: s.deliverable, doneWhen: s.doneWhen, status: view.steps.find(v => v.id === s.stepId)?.status ?? 'pending' })),
      checkpoint: view.checkpoint ? { artifactText: view.checkpoint.artifactText.slice(0, 16000), progressSummary: view.checkpoint.progressSummary, question: view.checkpoint.question } : null,
      pendingPlan: g.pendingAction?.spec.steps.map(s => ({ title: s.title, instruction: s.instruction, deliverable: s.deliverable, doneWhen: s.doneWhen })) ?? null };
  }
  snapshot(): WebSnapshot {
    const chats = this.store.webUi.chats(webOwner).reverse().map(c => ({ requestId: c.requestId, text: c.text, run: this.run(c.runId, false) }));
    const inbox = this.store.webUi.inbox(webOwner);
    const tasks = this.store.tasksForTarget(webTarget).slice(0, 100).map(t => ({ id: t.id, instruction: t.instruction, dueAt: t.dueAt,
      status: t.status, updatedAt: t.updatedAt, result: this.store.webUi.taskResult(targetJson, t.id) }));
    const goals = this.tasks.withTarget(webTarget, () => this.goals?.list() ?? []).slice(0, 100).map(g => ({
      id: g.id, objective: g.objective, status: g.status, updatedAt: g.updatedAt, blockedReason: g.blockedReason }));
    const files = this.store.webUi.fileIds(webOwner, targetJson).map(id => {
      const f = this.file(id);
      return { id: f.id, runId: f.runId, path: f.path, kind: f.kind, hash: f.hash, contentHash: f.contentHash,
        createdAt: f.createdAt, expires: f.expires, status: f.status, acknowledged: f.acknowledged };
    });
    return { chats, tasks, goals, files,
      activity: this.store.webUi.runs(webOwner, targetJson).map(id => this.run(id, false)), inbox,
      capabilities: { goal: !!this.goals, skills: this.executor.skills?.list().map(s => s.id) ?? [], filesRead: !!this.config.localFiles?.enabled,
        filesWrite: !!this.config.localOutput?.enabled, webRead: !!this.config.webReadEnabled, webSearch: !!this.config.webSearchEnabled, workThreads: !!this.workThreads, workJobs: !!this.workRouter, busy: !!this.work, push: false } };
  }
  async sendMessage(message: OutboundMessage): Promise<void> {
    if (message.target?.channel !== 'web' || message.target.userId !== webTarget.userId || !message.runId
      || !this.store.webUi.ownsRun(webOwner, targetJson, message.runId)) throw new Error('Web 通知身份或执行归属不匹配');
    this.store.webUi.putNotice(webOwner, message.runId, message.text, message.taskId, message.goalId);
  }
  viewNotice(id: string): void {
    if (!this.store.webUi.inbox(webOwner).some(n => n.runId === id)) throw new WebUiError(404, '通知不存在');
    this.store.webUi.viewNotice(webOwner, id);
  }
  async drain(): Promise<void> { await this.work; }
  async stop(): Promise<void> { this.shutdown.abort(); await this.work; }
}
