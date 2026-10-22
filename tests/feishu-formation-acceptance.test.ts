import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FeishuAcceptanceBudget, recordAcceptanceResponse } from '../scripts/feishu-formation-acceptance.js';

const payload = { model: 'deepseek-ai/DeepSeek-V4.1-Flash', enable_thinking: false, max_tokens: 512 };
const create = () => new FeishuAcceptanceBudget({ version: 1, identity: 'fictional', attempts: [] });

test('验收流读取器提前取消仍保存已收原始输出；跨块凭据在累计快照中脱敏', async () => {
  const root = mkdtempSync(join(tmpdir(), 'feishu-audit-')), file = join(root, 'response.txt');
  try {
    const input = new ReadableStream<Uint8Array>({ start(controller) {
      for (const part of ['data: fictional-', 'secret\n\ndata: [DONE]\n\n']) controller.enqueue(new TextEncoder().encode(part));
      // 保持未关闭，模拟SDK看到[DONE]后自行取消而不等流的flush。
    } });
    const response = recordAcceptanceResponse(new Response(input), file, text => text.replaceAll('fictional-secret', '<REDACTED>'));
    const reader = response.body!.getReader();
    await reader.read(); await reader.read(); await reader.cancel();
    assert.equal(readFileSync(file, 'utf8'), 'data: <REDACTED>\n\ndata: [DONE]\n\n');
  } finally {
    if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('feishu-audit-')) throw new Error('测试清理目录异常');
    rmSync(root, { recursive: true, force: true });
  }
});

test('飞书验收跨重启累计40请求；失败请求不退额', () => {
  const first = create();
  for (let i = 0; i < 20; i++) first.reserve(payload, 1000);
  const resumed = new FeishuAcceptanceBudget(JSON.parse(JSON.stringify(first.ledger)));
  for (let i = 0; i < 20; i++) resumed.reserve(payload, 1000);
  assert.throws(() => resumed.reserve(payload, 1000), /上限/);
  assert.equal(resumed.ledger.attempts.length, 40);
});

test('飞书验收按完整请求字节和输出上限在联网前限制2元', () => {
  const budget = create();
  budget.reserve(payload, 990000);
  assert.throws(() => budget.reserve(payload, 10000), /上限/);
  assert.equal(budget.ledger.attempts.length, 1);
  assert.ok(budget.reservedMicroCny < 2_000_000);
});

test('V2.1b.4独立32次账本跨重启累计，旧46次账本不变', () => {
  const old = new FeishuAcceptanceBudget({ version: 1, identity: 'old-round', requestLimit: 48, attempts: [] });
  for (let i = 0; i < 46; i++) old.reserve(payload, 1000);
  const previous = JSON.stringify(old.ledger);
  const fresh = new FeishuAcceptanceBudget({ version: 1, identity: 'new-round', requestLimit: 32, attempts: [] });
  for (let i = 0; i < 15; i++) fresh.reserve(payload, 1000);
  const resumed = new FeishuAcceptanceBudget(JSON.parse(JSON.stringify(fresh.ledger)));
  for (let i = 15; i < 32; i++) resumed.reserve(payload, 1000);
  assert.throws(() => resumed.reserve(payload, 1000), /32请求/);
  assert.equal(JSON.stringify(old.ledger), previous);
  const expensive = new FeishuAcceptanceBudget({ version: 1, identity: 'new-round', requestLimit: 32, attempts: [] });
  expensive.reserve(payload, 990000);
  assert.throws(() => expensive.reserve(payload, 10000), /2元/);
});

test('明确扩至48次保留原请求和费用，续测不能绕过2元闸', () => {
  const original = create();
  for (let i = 0; i < 23; i++) original.reserve(payload, 1000);
  const spent = original.reservedMicroCny;
  const resumed = new FeishuAcceptanceBudget({ ...JSON.parse(JSON.stringify(original.ledger)), requestLimit: 48 });
  assert.equal(resumed.ledger.attempts.length, 23);
  assert.equal(resumed.reservedMicroCny, spent);
  for (let i = 23; i < 48; i++) resumed.reserve(payload, 1000);
  assert.throws(() => resumed.reserve(payload, 1000), /48请求/);
  const expensive = new FeishuAcceptanceBudget({ version: 1, identity: 'fictional', requestLimit: 48, attempts: [] });
  expensive.reserve(payload, 990000);
  assert.throws(() => expensive.reserve(payload, 10000), /2元/);
});

test('飞书验收拒绝错误模型、推理、无输出上限及无效账本', () => {
  for (const invalid of [{ ...payload, model: 'other' }, { ...payload, enable_thinking: true }, { ...payload, max_tokens: 4097 }, { model: payload.model }]) {
    assert.throws(() => create().reserve(invalid, 1000), /不符/);
  }
  assert.throws(() => new FeishuAcceptanceBudget({ version: 1, identity: '', attempts: [{ at: '', bytes: 1, outputLimit: 1, reservedMicroCny: -1 }] }), /无效/);
});
