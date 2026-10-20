import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { readConfig, readFeishuConfig, redactor } from '../src/config.js';

test('配置校验：IANA 时区、有效毫秒值、无凭据的 API URL', () => {
  assert.equal(readConfig({ USER_TIMEZONE: 'Europe/London' }).timeZone, 'Europe/London');
  assert.throws(() => readConfig({ USER_TIMEZONE: '+08:00' }));
  assert.throws(() => readConfig({ POLL_INTERVAL_MS: '0' }));
  assert.throws(() => readConfig({ EXECUTION_TIMEOUT_MS: 'NaN' }));
  assert.throws(() => readConfig({ LLM_BASE_URL: 'https://name:password@example.com/v1' }));
  assert.throws(() => readConfig({ LLM_BASE_URL: 'https://example.com/v1?token=test' }));
});

test('Session 目录可配置，默认跟随数据库，避免独立调试库复用正式会话', () => {
  const config = readConfig({ DATABASE_PATH: './data/debug.db' });
  assert.equal(config.sessionDir, `${config.databasePath}.sessions`);
  assert.equal(readConfig({ SESSION_DIR: './data/private-sessions' }).sessionDir, resolve('./data/private-sessions'));
});

test('错误日志不保留配置的 Key 或 Bearer 认证', () => {
  const redact = redactor('test-only-secret');
  assert.equal(redact(new Error('request failed test-only-secret')), 'request failed <REDACTED>');
  assert.equal(redact('Authorization: Bearer example-value'), 'Authorization: Bearer <REDACTED>');
  assert.equal(redact('api_key=example-value'), 'api_key=<REDACTED>');
});

test('飞书配置只在启用时校验，用户白名单必须显式设置；多凭据一起脱敏', () => {
  assert.doesNotThrow(() => readConfig({}));
  assert.throws(() => readFeishuConfig({}), /FEISHU_APP_ID/);
  const env = { FEISHU_APP_ID: 'cli_0123456789abcdef', FEISHU_APP_SECRET: 'test-app-secret' };
  assert.throws(() => readFeishuConfig(env), /FEISHU_ALLOWED_OPEN_ID/);
  assert.throws(() => readFeishuConfig({ ...env, FEISHU_ALLOWED_OPEN_ID: 'user-id' }), /open_id/);
  assert.equal(readFeishuConfig({ ...env, FEISHU_ALLOWED_OPEN_ID: 'ou_owner' }).allowedOpenId, 'ou_owner');
  assert.equal(redactor('test-key', 'test-app-secret')('test-key test-app-secret'), '<REDACTED> <REDACTED>');
});
