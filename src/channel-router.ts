import type { Channel, OutboundMessage } from './contracts.js';

export class ChannelRouter implements Channel {
  constructor(private readonly console: Channel, private readonly feishu?: Channel, private readonly web?: Channel) {}

  async sendMessage(message: OutboundMessage): Promise<void> {
    if (!message.target || message.target.channel === 'console') return this.console.sendMessage(message);
    if (message.target.channel === 'web') {
      if (!this.web) throw new Error('任务需要 Web 渠道；请使用 --web-ui 启动，不回退到 Console');
      return this.web.sendMessage(message);
    }
    if (message.target.channel !== 'feishu' || !this.feishu) throw new Error('任务需要飞书渠道；请使用 --feishu 启动，不回退到 Console');
    await this.feishu.sendMessage(message);
  }
}
