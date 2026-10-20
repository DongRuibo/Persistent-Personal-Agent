import { createHash } from 'node:crypto';
import type { AgentExecutor, Channel, MessageTarget, OutboundMessage } from './contracts.js';
import { ExecutionInterrupted } from './contracts.js';
import type { FeishuConfig } from './config.js';
import type { FeishuTransport } from './feishu-transport.js';
import { SqliteStore } from './sqlite-store.js';
import { TaskService } from './task-service.js';

type FeishuTarget = Extract<MessageTarget, { channel: 'feishu' }>;
interface IncomingEvent {
  sender?: { sender_type?: unknown; sender_id?: { open_id?: unknown } };
  message?: { message_id?: unknown; chat_id?: unknown; chat_type?: unknown; message_type?: unknown; content?: unknown };
}

// 以 JSON 编码后的 UTF-8 字节计算分片，覆盖中文、emoji 和控制字符转义。
export function splitFeishuText(text: string): string[] {
  const parts: string[] = [];
  let part = '';
  let size = 11; // {"text":""}
  for (const character of text) {
    const bytes = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (size + bytes > 16000) { parts.push(part); part = ''; size = 11; }
    part += character;
    size += bytes;
  }
  if (part) parts.push(part);
  return parts;
}

export class FeishuChannel implements Channel {
  private work: Promise<void> = Promise.resolve();
  private readonly shutdown = new AbortController();

  constructor(
    private readonly config: FeishuConfig,
    private readonly transport: FeishuTransport,
    private readonly executor: AgentExecutor,
    private readonly tasks: TaskService,
    private readonly store: SqliteStore,
    private readonly redact: (value: unknown) => string,
    private readonly reportError: (error: unknown) => void,
  ) {}

  async start(): Promise<void> { await this.transport.start((event) => this.receive(event)); }

  receive(raw: unknown): void {
    if (this.shutdown.signal.aborted || !raw || typeof raw !== 'object') return;
    const { sender, message } = raw as IncomingEvent;
    if (sender?.sender_type !== 'user' || sender.sender_id?.open_id !== this.config.allowedOpenId ||
      message?.chat_type !== 'p2p' || message.message_type !== 'text' ||
      typeof message.message_id !== 'string' || !message.message_id ||
      typeof message.chat_id !== 'string' || !message.chat_id || typeof message.content !== 'string') return;
    let text: string;
    try {
      const content: unknown = JSON.parse(message.content);
      if (!content || typeof content !== 'object' || !('text' in content) || typeof content.text !== 'string') return;
      text = content.text.trim();
    } catch { return; }
    if (!text || text.length > 10000) return;
    const run = this.store.acceptFeishuMessage(this.config.appId, message.message_id, new Date().toISOString());
    if (!run) return;
    const target: FeishuTarget = { channel: 'feishu', appId: this.config.appId, chatId: message.chat_id, userOpenId: this.config.allowedOpenId };
    this.work = this.work.then(() => this.process(text, target, run.id)).catch((error: unknown) => this.reportError(this.redact(error)));
  }

  private async process(text: string, target: FeishuTarget, runId: string): Promise<void> {
    if (this.shutdown.signal.aborted) {
      this.store.finishRun(runId, 'interrupted', new Date().toISOString(), undefined, '服务在排队消息执行前停止；不自动重放');
      return;
    }
    let reply: string;
    try {
      const result = await this.tasks.withTarget(target, () => this.executor.execute({
        prompt: text, scope: 'chat', signal: this.shutdown.signal, observer: this.store.observer(runId),
      }));
      if (this.shutdown.signal.aborted) throw new ExecutionInterrupted('服务正在停止');
      this.store.finishRun(runId, 'succeeded', new Date().toISOString(), result.text);
      reply = result.text;
    } catch (error) {
      const interrupted = this.shutdown.signal.aborted || error instanceof ExecutionInterrupted;
      this.store.finishRun(runId, interrupted ? 'interrupted' : 'failed', new Date().toISOString(), undefined, this.redact(error));
      reply = interrupted ? '本次执行中断，请先核对任务状态；不会自动重试。' : '本次执行失败，请检查本地执行日志；不会自动重试。';
    }
    try {
      await this.sendMessage({ text: reply, runId, target });
      this.store.event(runId, 'delivery_succeeded');
    } catch (error) {
      this.store.deliveryFailed(runId, this.redact(error));
      this.reportError(this.redact(error));
    }
  }

  async sendMessage(message: OutboundMessage): Promise<void> {
    const target = message.target;
    if (target?.channel !== 'feishu' || target.appId !== this.config.appId ||
      target.userOpenId !== this.config.allowedOpenId || !target.chatId) throw new Error('飞书接收目标与当前授权配置不一致，拒绝发送');
    if (!message.runId) throw new Error('飞书消息必须关联执行记录');
    const parts = splitFeishuText(this.redact(message.text));
    if (!parts.length) throw new Error('飞书消息内容为空');
    for (const [index, text] of parts.entries()) {
      const uuid = createHash('sha256').update(`${message.runId}:${index}`).digest('hex').slice(0, 32);
      await this.transport.sendText(target.chatId, text, uuid);
    }
  }

  async drain(): Promise<void> { await this.work; }

  async stop(): Promise<void> {
    this.shutdown.abort();
    this.transport.stop();
    await this.work;
  }
}
