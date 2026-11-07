import assert from 'node:assert/strict';
import { test } from 'node:test';
import type * as lark from '@larksuiteoapi/node-sdk';
import { ExecutionFailure, httpFailure } from '../src/execution-failure.js';
import { FeishuSdkTransport } from '../src/feishu-transport.js';
import { readConfig } from '../src/config.js';
import { NotificationWorker } from '../src/notification-worker.js';
import { fixture, seedGoal, approve, proposal } from './helpers/proactive-fixture.js';

test('重试入口：Retry-After秒数/HTTP日期、永久错误与次数上限', () => {
  const now = Date.parse('2026-11-07T00:00:00Z');
  assert.equal(httpFailure(429, '45', now).retryAfterMs, 45000);
  assert.equal(httpFailure(503, 'Sat, 07 Nov 2026 00:01:00 GMT', now).retryAfterMs, 60000);
  assert.equal(httpFailure(400).kind, 'permanent_error');
  assert.equal(readConfig({}).goalMaxAttempts, 1);
  for (const value of ['0','4','1.5','invalid']) assert.throws(() => readConfig({ GOAL_MAX_ATTEMPTS: value }), /GOAL_MAX_ATTEMPTS/u);
});

test('飞书SDK HTTP错误入口保留分类与Retry-After，丢弃正文和凭据', async () => {
  let status = 429;
  const request = async (options: { url?: string }) => {
    if (options.url?.includes('tenant_access_token')) return { code: 0, tenant_access_token: 'fake-adapter-token', expire: 7200 };
    throw Object.assign(new Error('secret-response-body'), { response: { status, headers: { 'retry-after': '45' }, data: { secret: 'secret-response-body' } } });
  };
  const transport = new FeishuSdkTransport({ appId: 'cli_0123456789abcdef', appSecret: 'fake-adapter-secret', allowedOpenId: 'ou_fake' }, () => {}, () => {}, {
    request, post: async (url: string) => request({ url }),
  } as unknown as lark.HttpInstance);
  try {
    for (const [code, kind] of [[429,'rate_limited'],[500,'transient_server_error'],[400,'permanent_error']] as const) {
      status = code;
      await assert.rejects(transport.sendText('offline-chat', '合成消息', 'stable-test-id'), error => error instanceof ExecutionFailure
        && error.kind === kind && error.httpStatus === code && error.retryAfterMs === 45000 && !error.message.includes('secret-response-body'));
    }
  } finally { transport.stop(); }
});

test('Task通知Worker默认不激活关闭的策略Goal通知；显式开启才投递', async () => {
  const f = await fixture(); let accepted = 0;
  try {
    approve(f.store, proposal(seedGoal(f.store))); f.failDelivery(1); f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick();
    f.time('2026-10-23T01:00:30.000Z');
    const options = { ownerId: 'local-user', targetFilter: { channel: 'console' as const }, pollIntervalMs: 10, reportError: () => {} };
    const channel = { sendMessage: async () => { accepted++; } }, disabled = new NotificationWorker(f.store, channel, options, () => f.now);
    await disabled.tick(); await disabled.stop(); assert.equal(accepted, 0);
    const enabled = new NotificationWorker(f.store, channel, { ...options, includeGoals: true }, () => f.now);
    await enabled.tick(); await enabled.stop(); assert.equal(accepted, 1);
  } finally { await f.close(); }
});
