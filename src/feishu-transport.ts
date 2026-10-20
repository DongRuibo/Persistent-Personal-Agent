import * as lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from './config.js';

export interface FeishuTransport {
  start(receive: (event: unknown) => void): Promise<void>;
  stop(): void;
  sendText(chatId: string, text: string, uuid: string): Promise<void>;
}

// 仅此适配层依赖飞书 SDK；不把 Axios 错误、请求头或连接票据写入日志。
export class FeishuSdkTransport implements FeishuTransport {
  private readonly client: lark.Client;
  private ws?: lark.WSClient;
  private rejectStart?: (error: Error) => void;
  private readonly logger: lark.Logger;

  constructor(
    private readonly config: FeishuConfig,
    reportError: (error: unknown) => void,
    private readonly onFatal: () => void,
    private readonly http: lark.HttpInstance = Object.assign(Object.create(lark.defaultHttpInstance), {
      request: <T = unknown, R = T, D = unknown>(options: lark.HttpRequestOptions<D>) =>
        lark.defaultHttpInstance.request<T, R, D>({ ...options, timeout: 10000 }) as Promise<R>,
      post: <T = unknown, R = T, D = unknown>(url: string, data?: D, options?: lark.HttpRequestOptions<D>) =>
        lark.defaultHttpInstance.post<T, R, D>(url, data, { ...options, timeout: 10000 }) as Promise<R>,
    }),
  ) {
    this.logger = {
      error: () => reportError('飞书 SDK 错误：请检查应用配置、权限和网络；敏感详情已省略'),
      warn: () => reportError('飞书 SDK 警告：请检查连接状态'),
      info: () => {}, debug: () => {}, trace: () => {},
    };
    this.client = new lark.Client({
      appId: config.appId, appSecret: config.appSecret, domain: lark.Domain.Feishu,
      appType: lark.AppType.SelfBuild, logger: this.logger, loggerLevel: lark.LoggerLevel.warn, httpInstance: http,
    });
  }

  async start(receive: (event: unknown) => void): Promise<void> {
    const ready = new Promise<void>((resolve, reject) => {
      this.rejectStart = reject;
      this.ws = new lark.WSClient({
        appId: this.config.appId, appSecret: this.config.appSecret, domain: lark.Domain.Feishu,
        logger: this.logger, loggerLevel: lark.LoggerLevel.warn, httpInstance: this.http,
        handshakeTimeoutMs: 10000,
        onReady: resolve,
        onError: () => { reject(new Error('飞书长连接失败，请检查应用凭据、长连接配置和网络')); this.onFatal(); },
        onReconnecting: () => this.logger.warn(),
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
    } catch {
      throw new Error('飞书消息请求失败或超时；结果可能已送达，不自动重发');
    }
    if (response.code !== 0) throw new Error(`飞书消息发送失败，code=${typeof response.code === 'number' ? response.code : 'unknown'}`);
  }
}
