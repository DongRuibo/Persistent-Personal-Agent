import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readConfig, redactor } from '../src/config.js';

test('配置校验：IANA 时区、有效毫秒值、无凭据的 API URL', () => {
  assert.equal(readConfig({ USER_TIMEZONE: 'Europe/London' }).timeZone, 'Europe/London');
  assert.throws(() => readConfig({ USER_TIMEZONE: '+08:00' }));
  assert.throws(() => readConfig({ POLL_INTERVAL_MS: '0' }));
  assert.throws(() => readConfig({ EXECUTION_TIMEOUT_MS: 'NaN' }));
  assert.throws(() => readConfig({ LLM_BASE_URL: 'https://name:password@example.com/v1' }));
  assert.throws(() => readConfig({ LLM_BASE_URL: 'https://example.com/v1?token=test' }));
});

test('错误日志不保留配置的 Key 或 Bearer 认证', () => {
  const redact = redactor('test-only-secret');
  assert.equal(redact(new Error('request failed test-only-secret')), 'request failed <REDACTED>');
  assert.equal(redact('Authorization: Bearer example-value'), 'Authorization: Bearer <REDACTED>');
  assert.equal(redact('api_key=example-value'), 'api_key=<REDACTED>');
});
