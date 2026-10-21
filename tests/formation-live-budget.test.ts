import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { FormationLiveBudget, safeReportJson } from '../scripts/formation-live-budget.js';
import { redactor } from '../src/config.js';

const payload = { model: 'deepseek-ai/DeepSeek-V4.1-Flash', enable_thinking: false, max_tokens: 512 };
test('Formation真实验收脚本无授权参数不联网；错误模型不能绕过授权预算', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-formation-live.ts'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /16请求\/1元明确授权/); assert.equal(result.stdout, '');
  const wrong = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-formation-live.ts', '--allow-paid'], { encoding: 'utf8', env: { ...process.env, LLM_MODEL: 'outside', LLM_BASE_URL: 'https://api.siliconflow.cn/v1', LLM_API_KEY: 'fake-fixture-only' } });
  assert.notEqual(wrong.status, 0); assert.match(wrong.stderr, /需在本机配置/); assert.equal(wrong.stdout, '');
});
test('验收报告先对字符串值脱敏再JSON编码，不破坏引号、换行或结构', () => {
  const value = { sample: '我的密码是password=fictional-value，不要保存。', quoted: 'password=fictional-value\n下一行"引号"', nested: [{ tokens: 7, text: 'Bearer fictional-value' }] };
  const output = safeReportJson(value, redactor('fictional-value'));
  const decoded = JSON.parse(output) as typeof value;
  assert.equal(decoded.nested[0]?.tokens, 7); assert.ok(!output.includes('fictional-value'));
  assert.ok(decoded.quoted.includes('下一行"引号"'));
});
test('Formation验收限制16请求/分阶段次数/1元保守预留，未知失败不退预算', () => {
  const budget = new FormationLiveBudget();
  for (let i = 0; i < 12; i++) budget.reserve('extraction', payload, 1200);
  assert.throws(() => budget.reserve('extraction', payload, 1200), /上限/);
  for (const phase of ['approval', 'generation'] as const) for (let i = 0; i < 2; i++) budget.reserve(phase, payload, 1200);
  assert.equal(budget.attempts.length, 16); assert.throws(() => budget.reserve('generation', payload, 1200), /上限/);
  const expensive = new FormationLiveBudget();
  for (let i = 0; i < 5; i++) expensive.reserve('extraction', payload, 16384);
  const before = expensive.reservedCny;
  assert.throws(() => expensive.reserve('extraction', payload, 16384), /1元/); assert.equal(expensive.reservedCny, before);
  for (const bad of [{ ...payload, tools: [{}] }, { ...payload, max_tokens: 4096 }, { ...payload, enable_thinking: true }]) assert.throws(() => new FormationLiveBudget().reserve('extraction', bad, 1200), /不符/);
});
