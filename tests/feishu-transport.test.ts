import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as lark from '@larksuiteoapi/node-sdk';
import { FeishuSdkTransport, feishuDiagnostic } from '../src/feishu-transport.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';

test('诊断仅保留固定类别和数字状态码，嵌套错误与未知文本均不泄露凭据', () => {
  const secret = 'diagnostic-only-secret';
  const error = Object.assign(new Error(`getaddrinfo ENOTFOUND ${secret}`), {
    code: 'ENOTFOUND', config: { url: `https://example.invalid/ws?ticket=${secret}`, headers: { Authorization: `Bearer ${secret}` } },
    response: { status: 502, data: { code: 99991663, msg: secret, request_id: secret } },
  });
  assert.equal(feishuDiagnostic([[[error]]]), 'category=network_error networkCode=ENOTFOUND httpStatus=502 apiCode=99991663');
  assert.equal(feishuDiagnostic([['[ws]', `code: 100004, ${secret}`]]), 'category=api_error apiCode=100004');
  assert.equal(feishuDiagnostic([new Error(`Request failed with status code 403; ${secret}`)]), 'category=http_error httpStatus=403');
  for (const [message, category] of [
    ['no pong/inbound within 10s of last ping', 'heartbeat_timeout'],
    ['handshake timeout after 10000ms', 'handshake_timeout'],
    ['WebSocket reconnect exhausted after 1 attempts', 'reconnect_exhausted'],
    ['ws connect failed', 'ws_connect_error'],
    ['failed to handle inbound frame', 'frame_error'],
    ['invoke event failed', 'event_handler_error'],
    [secret, 'unknown'],
  ]) assert.equal(feishuDiagnostic([['[ws]', message]]), `category=${category}`);
  assert.equal(feishuDiagnostic([{ message: secret, code: secret, headers: { token: secret } }]), 'category=unknown');
  const circular: unknown[] = [];
  circular.push(circular);
  assert.equal(feishuDiagnostic(circular), 'category=unknown');
});

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
      if (networkError) throw Object.assign(new Error(`ECONNRESET Authorization: Bearer transport-test-token; AppSecret=${config.appSecret}`), { code: 'ECONNRESET' });
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
    assert.ok(logs.some((entry) => String(entry).includes('category=network_error networkCode=ECONNRESET')));
    assert.ok(!JSON.stringify(logs).includes(config.appSecret));
    assert.ok(!JSON.stringify(logs).includes('transport-test-token'));
  } finally { transport.stop(); }
});

test('真实官方 WSClient 握手与断线重连均记录状态，stop 会关闭连接', { timeout: 5000 }, async () => {
  const server = createServer();
  const sockets = new Set<Duplex>();
  let connections = 0;
  server.on('upgrade', (request, socket) => {
    connections++;
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
  const logs: unknown[] = [];
  let fatal = false;
  const transport = new FeishuSdkTransport({ appId: 'cli_1111111111111111', appSecret: 'fake-secret', allowedOpenId: 'ou_owner' }, (entry) => logs.push(entry), () => { fatal = true; }, http);
  try {
    await transport.start(() => {});
    assert.equal(connections, 1);
    assert.equal(sockets.size, 1);
    assert.ok(logs.some((entry) => String(entry).includes('state=connected')), '首次握手应报告连接成功');
    for (const socket of sockets) socket.destroy();
    for (let attempt = 0; attempt < 300 && !logs.some((entry) => String(entry).includes('重连成功')); attempt++) await delay(10);
    assert.equal(connections, 2);
    assert.ok(logs.some((entry) => String(entry).includes('state=reconnecting')));
    assert.ok(logs.some((entry) => String(entry).includes('重连成功 state=connected')));
    assert.ok(logs.every((entry) => /^\[\d{4}-\d{2}-\d{2}T/.test(String(entry))), '状态记录含 UTC 时间');
    assert.equal(fatal, false, '暂时断线由 SDK 恢复，不停止服务');
    assert.ok(!JSON.stringify(logs).includes('device_id'));
    assert.ok(!JSON.stringify(logs).includes('fake-secret'));
    transport.stop();
  } finally {
    transport.stop();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('不可恢复的连接配置错误保留业务码及失败状态，不输出服务端敏感详情', { timeout: 5000 }, async () => {
  const secret = 'fatal-test-secret';
  const logs: unknown[] = [];
  let fatals = 0;
  let requests = 0;
  const http = { request: async () => { requests++; return { code: 100004, data: {}, msg: `AppSecret=${secret}; ticket=private-ticket` }; } } as unknown as lark.HttpInstance;
  const transport = new FeishuSdkTransport({ appId: 'cli_3333333333333333', appSecret: secret, allowedOpenId: 'ou_owner' }, (entry) => logs.push(entry), () => { fatals++; }, http);
  try {
    await assert.rejects(transport.start(() => {}), /^Error: 飞书长连接失败：category=api_error apiCode=100004$/);
    assert.equal(requests, 1);
    assert.equal(fatals, 1);
    assert.ok(logs.some((entry) => String(entry).includes('state=failed category=api_error apiCode=100004')));
    assert.ok(!JSON.stringify(logs).includes(secret));
    assert.ok(!JSON.stringify(logs).includes('private-ticket'));
  } finally { transport.stop(); }
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
