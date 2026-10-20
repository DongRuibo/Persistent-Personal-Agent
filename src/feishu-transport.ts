import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from './config.js';

export interface FeishuTransport {
  start(receive: (event: unknown) => void): Promise<void>;
  stop(): void;
  sendText(chatId: string, text: string, uuid: string): Promise<void>;
}

// SDK 会将日志参数包装成嵌套数组。只提取白名单字段，不序列化原始错误、URL 或请求体。
export function feishuDiagnostic(values: unknown[]): string {
  const texts: string[] = [];
  let httpStatus: number | undefined;
  let apiCode: number | undefined;
  let remaining = 100;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 8 || remaining-- <= 0) return;
    if (typeof value === 'string') { texts.push(value.slice(0, 2048)); return; }
    if (Array.isArray(value)) { value.slice(0, 20).forEach((item) => visit(item, depth + 1)); return; }
    if (!value || typeof value !== 'object') return;
    const entry = value as Record<string, unknown>;
    if (typeof entry.status === 'number' && Number.isInteger(entry.status) && entry.status >= 100 && entry.status <= 599) httpStatus = entry.status;
    if (typeof entry.code === 'number' && Number.isInteger(entry.code) && entry.code >= 0 && entry.code <= 999999999) apiCode = entry.code;
    for (const field of ['message', 'code', 'response', 'data']) visit(entry[field], depth + 1);
  };
  visit(values, 0);
  const text = texts.join('\n');
  const networkCode = text.match(/\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|EPROTO|ERR_TLS_CERT_ALTNAME_INVALID|CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b/)?.[1];
  httpStatus ??= Number(text.match(/\b(?:status code|HTTP)\s*[:=]?\s*([1-5]\d{2})\b/i)?.[1]) || undefined;
  apiCode ??= Number(text.match(/\bcode\s*[:=]\s*(\d{1,9})\b/i)?.[1]) || undefined;
  const categories: [RegExp, string][] = [
    [/no pong\/inbound within/i, 'heartbeat_timeout'],
    [/handshake timeout/i, 'handshake_timeout'],
    [/reconnect exhausted/i, 'reconnect_exhausted'],
    [/failed to handle inbound frame|invalid pong payload|failed to merge event fragments/i, 'frame_error'],
    [/invoke event failed/i, 'event_handler_error'],
    [/send data failed/i, 'ws_send_error'],
    [/ws connect failed|new WebSocket error|^connect failed$/im, 'ws_connect_error'],
    [/\bws error\b/i, 'ws_error'],
    [/socket hang up|system busy/i, 'network_or_service_error'],
  ];
  const category = networkCode ? 'network_error' : apiCode !== undefined ? 'api_error'
    : httpStatus ? 'http_error' : categories.find(([pattern]) => pattern.test(text))?.[1] ?? 'unknown';
  return [`category=${category}`, networkCode && `networkCode=${networkCode}`, httpStatus && `httpStatus=${httpStatus}`,
    apiCode !== undefined && `apiCode=${apiCode}`].filter((value) => value !== undefined && value !== false).join(' ');
}

// 仅此适配层依赖飞书 SDK；不把 Axios 错误、请求头或连接票据写入日志。
export class FeishuSdkTransport implements FeishuTransport {
  private readonly client: lark.Client;
  private ws?: lark.WSClient;
  private rejectStart?: (error: Error) => void;
  private readonly logger: lark.Logger;

  constructor(
    private readonly config: FeishuConfig,
    private readonly reportError: (error: unknown) => void,
    private readonly onFatal: () => void,
    private readonly http: lark.HttpInstance = Object.assign(Object.create(lark.defaultHttpInstance), {
      request: <T = unknown, R = T, D = unknown>(options: lark.HttpRequestOptions<D>) =>
        lark.defaultHttpInstance.request<T, R, D>({ ...options, timeout: 10000 }) as Promise<R>,
      post: <T = unknown, R = T, D = unknown>(url: string, data?: D, options?: lark.HttpRequestOptions<D>) =>
        lark.defaultHttpInstance.post<T, R, D>(url, data, { ...options, timeout: 10000 }) as Promise<R>,
    }),
  ) {
    this.logger = {
      error: (...values: unknown[]) => this.log(`飞书 SDK 错误：${feishuDiagnostic(values)}`),
      warn: (...values: unknown[]) => this.log(`飞书 SDK 警告：${feishuDiagnostic(values)}`),
      info: () => {}, debug: () => {}, trace: () => {},
    };
    this.client = new lark.Client({
      appId: config.appId, appSecret: config.appSecret, domain: lark.Domain.Feishu,
      appType: lark.AppType.SelfBuild, logger: this.logger, loggerLevel: lark.LoggerLevel.warn, httpInstance: http,
    });
  }

  private log(message: string): void { this.reportError(`[${new Date().toISOString()}] ${message}`); }

  async start(receive: (event: unknown) => void): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.rejectStart = reject;
      this.ws = new lark.WSClient({
        appId: this.config.appId, appSecret: this.config.appSecret, domain: lark.Domain.Feishu,
        logger: this.logger, loggerLevel: lark.LoggerLevel.warn, httpInstance: this.http,
        handshakeTimeoutMs: 10000,
        onReady: () => { this.log('飞书连接：已连接 state=connected'); resolve(); },
        onError: (error) => {
          const detail = feishuDiagnostic([error]);
          this.log(`飞书连接：最终失败 state=failed ${detail}`);
          reject(new Error(`飞书长连接失败：${detail}`));
          this.onFatal();
        },
        onReconnecting: () => this.log('飞书连接：正在自动重连 state=reconnecting'),
        onReconnected: () => this.log('飞书连接：重连成功 state=connected'),
      });
    });
    const timeout = setTimeout(() => this.rejectStart?.(new Error('飞书长连接启动超过30秒，未确认连接成功')), 30000);
    try {
      await Promise.all([this.ws!.start({ eventDispatcher: new lark.EventDispatcher({ logger: this.logger }).register({
        // SQLite 接收记录落盘后立即返回，绝不等待模型或发消息。
        'im.message.receive_v1': async (event) => { receive(event); },
      }) }), ready]);
    } finally {
      clearTimeout(timeout);
      this.rejectStart = undefined;
    }
  }

  stop(): void {
    this.rejectStart?.(new Error('飞书连接已停止'));
    this.ws?.close({ force: true });
  }

  async sendText(chatId: string, text: string, uuid: string): Promise<void> {
    let response: Awaited<ReturnType<typeof this.client.im.message.create>>;
    try {
      response = await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }), uuid },
      });
    } catch (error) {
      throw new Error(`飞书消息请求失败或超时；${feishuDiagnostic([error])}；结果可能已送达，不自动重发`);
    }
    if (response.code !== 0) throw new Error(`飞书消息发送失败，code=${typeof response.code === 'number' ? response.code : 'unknown'}`);
  }
}
