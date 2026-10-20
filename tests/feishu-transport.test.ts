import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as lark from '@larksuiteoapi/node-sdk';
import { FeishuSdkTransport } from '../src/feishu-transport.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';

test('官方 SDK 发送适配：chat_id、JSON 文本、uuid；API 错误与网络错误不泄露凭据', async () => {
  const config = { appId: 'cli_abcdef0123456789', appSecret: 'transport-test-secret', allowedOpenId: 'ou_owner' };
  const requests: lark.HttpRequestOptions<unknown>[] = [];
  const logs: unknown[] = [];
  let code = 0;
  let networkError = false;
  // 只替换 SDK 的 HTTP 传输；API 序列化和 token 获取仍走官方 SDK。
  const request = async (options: lark.HttpRequestOptions<unknown>) => {
      requests.push(options);
      if (options.url?.includes('tenant_access_token')) return { code: 0, tenant_access_token: 'transport-test-token', expire: 7200 };
      if (networkError) throw new Error(`Authorization: Bearer transport-test-token; AppSecret=${config.appSecret}`);
      return { code, data: { message_id: 'sent-message' }, msg: `unused sensitive detail ${config.appSecret}` };
    };
  const http = {
    request,
    post: async (url: string, data?: unknown, options?: lark.HttpRequestOptions<unknown>) => request({ ...options, url, data, method: 'post' }),
  } as unknown as lark.HttpInstance;
  const transport = new FeishuSdkTransport(config, (entry) => logs.push(entry), () => {}, http);
  try {
    await transport.sendText('oc_private', '你好\n😀', 'stable-message-id');
    const sent = requests.find((request) => request.url?.includes('/im/v1/messages'))!;
    assert.ok(sent);
    assert.equal(sent.params?.receive_id_type, 'chat_id');
    assert.deepEqual(sent.data, { receive_id: 'oc_private', msg_type: 'text', content: JSON.stringify({ text: '你好\n😀' }), uuid: 'stable-message-id' });
    code = 230013;
    await assert.rejects(transport.sendText('oc_private', '结果', 'error-message-id'), /^Error: 飞书消息发送失败，code=230013$/);
    networkError = true;
    await assert.rejects(transport.sendText('oc_private', '结果', 'timeout-message-id'), /^Error: 飞书消息请求失败或超时/);
    assert.ok(!JSON.stringify(logs).includes(config.appSecret));
    assert.ok(!JSON.stringify(logs).includes('transport-test-token'));
  } finally { transport.stop(); }
});

test('真实官方 WSClient 在本机完成 WebSocket 握手后才就绪，stop 会关闭连接', { timeout: 5000 }, async () => {
  const server = createServer();
  const sockets = new Set<Duplex>();
  let connected = false;
  server.on('upgrade', (request, socket) => {
    connected = true;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.on('data', () => {});
    const accept = createHash('sha1').update(String(request.headers['sec-websocket-key']) + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const http = { request: async () => ({ code: 0, data: {
    URL: `ws://127.0.0.1:${address.port}/ws?device_id=fake&service_id=1`,
    ClientConfig: { PingInterval: 60, ReconnectCount: 1, ReconnectInterval: 1, ReconnectNonce: 0 },
  } }) } as unknown as lark.HttpInstance;
  const errors: unknown[] = [];
  const transport = new FeishuSdkTransport({ appId: 'cli_1111111111111111', appSecret: 'fake-secret', allowedOpenId: 'ou_owner' }, (error) => errors.push(error), () => {}, http);
  try {
    await transport.start(() => {});
    assert.equal(connected, true);
    assert.equal(sockets.size, 1);
    assert.deepEqual(errors, []);
    transport.stop();
  } finally {
    transport.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('长连接就绪前停止会结束 start 等待；迟到的连接配置不会重新启动服务', async () => {
  let reply!: (value: unknown) => void;
  const http = { request: () => new Promise((resolve) => { reply = resolve; }) } as unknown as lark.HttpInstance;
  const transport = new FeishuSdkTransport({ appId: 'cli_2222222222222222', appSecret: 'fake-secret', allowedOpenId: 'ou_owner' }, () => {}, () => {}, http);
  const starting = transport.start(() => {});
  const stopped = assert.rejects(starting, /连接已停止/);
  transport.stop();
  reply({ code: 100004, data: {}, msg: 'mock late failure' });
  await stopped;
  transport.stop();
});
