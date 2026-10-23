import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { integratedLimits, integratedWebLimit, IntegratedAcceptanceBudget, integratedAcceptanceFetch, openIntegratedAcceptance } from '../scripts/integrated-console-acceptance.js';
import type { AcceptanceProfile } from '../scripts/integrated-console-acceptance.js';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';

const profile = (extra: Partial<AcceptanceProfile> = {}): AcceptanceProfile => ({ endpoint: 'https://model.invalid/v1/chat/completions', model: 'local-stub',
  inputRate: 2, outputRate: 8, checkedAt: new Date().toISOString(), planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64), ...extra });
const ledger = (p = profile()) => ({ version: 2 as const, scope: 's0-s1b-v301-console-v2' as const, identity: 'a'.repeat(64), limits: { ...integratedLimits }, profile: p, attempts: [],
  webLimit: { ...integratedWebLimit }, webAttempts: [] });
const directory = () => join(mkdtempSync(join(tmpdir(), 'integrated-budget-')), 'new-root');

test('统一入口默认拒绝联网，32/6/64KiB/4096与未知费率闸全部离线验证', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/integrated-console-acceptance.ts'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(child.status, 1); assert.match(child.stderr, /另行批准/);
  const b = new IntegratedAcceptanceBudget(ledger());
  for (let i = 0; i < 32; i++) b.reserve(1000, 512).status = 500;
  assert.throws(() => b.reserve(1, 1), /上限/); assert.equal(new IntegratedAcceptanceBudget(JSON.parse(JSON.stringify(b.ledger))).ledger.attempts.length, 32);
  for (const [bytes, output] of [[65537, 1], [1, 4097], [0, 1], [1, NaN]]) assert.throws(() => new IntegratedAcceptanceBudget(ledger()).reserve(bytes!, output!), /超过/);
  const expensive = new IntegratedAcceptanceBudget(ledger(profile({ inputRate: 1000, outputRate: 1000 })));
  assert.throws(() => expensive.reserve(65536, 4096), /上限/); assert.equal(expensive.ledger.attempts.length, 0);
  for (const rate of [0, NaN, -1, Infinity]) assert.throws(() => new IntegratedAcceptanceBudget(ledger(profile({ inputRate: rate }))), /损坏/);
  assert.throws(() => openIntegratedAcceptance(directory(), profile({ checkedAt: '2000-01-01T00:00:00.000Z' })), /费率/);
  const expired = new IntegratedAcceptanceBudget(ledger()); expired.ledger.profile.checkedAt = '2000-01-01T00:00:00.000Z';
  assert.throws(() => expired.reserve(1, 1), /费率/); assert.equal(expired.ledger.attempts.length, 0);
});

test('主入口显式注入不触发双启动；直接启动及旧验收import启动方式仍可使用', () => {
  for (const args of [['--import', 'tsx', 'src/main.ts', '--help'], ['--import', 'tsx', '--input-type=module', '-e',
    `process.argv=[process.execPath,${JSON.stringify(resolve('src/main.ts'))},'--help']; await import('./src/main.ts');`]]) {
    const child = spawnSync(process.execPath, args, { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, windowsHide: true });
    assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /help|帮助|quit/u);
  }
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
    "const {main}=await import('./src/main.ts'); if(typeof main!=='function') process.exitCode=1;"], { encoding: 'utf8', env: { PATH: process.env.PATH }, windowsHide: true });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout, '');
});

test('独占锁、原子预留、重启累计、篡改限额/金额/模型/源码和历史账本均保守拒绝', () => {
  const root = directory(), p = profile(); let session = openIntegratedAcceptance(root, p);
  assert.throws(() => openIntegratedAcceptance(root, p, true), /exist|EEXIST/);
  session.budget.reserve(1000, 512); session.persist(); const reserved = session.budget.reserved; session.close();
  session = openIntegratedAcceptance(root, p, true); assert.equal(session.budget.reserved, reserved); session.close();
  for (const change of [{ model: 'different' }, { codeHash: '9'.repeat(64) }, { outputRate: 9 }]) assert.throws(() => openIntegratedAcceptance(root, { ...p, ...change }, true), /改变/);
  const file = join(root, 'integrated-budget.json'), original = readFileSync(file, 'utf8');
  for (const mutate of [(v: any) => { v.limits.requests = 99; }, (v: any) => { v.attempts[0].reservedMicroCny = 1; }, (v: any) => { v.scope = 'v3.0.1-console-retest'; }]) {
    const value = JSON.parse(original); mutate(value); writeFileSync(file, JSON.stringify(value));
    assert.throws(() => openIntegratedAcceptance(root, p, true), /损坏/);
  }
  writeFileSync(file, original); writeFileSync(file + '.pending', '原子写入时退出');
  assert.throws(() => openIntegratedAcceptance(root, p, true), /人工核对/);
});

test('发送前已经持久化；失败保持消费，非法端点/方法/容量/模型零网络，写入失败不能绕过', async () => {
  const root = directory(), p = profile(), session = openIntegratedAcceptance(root, p); let sends = 0;
  const guarded = integratedAcceptanceFetch(session, 'fake-secret', async () => {
    sends++; const persisted = JSON.parse(readFileSync(join(root, 'integrated-budget.json'), 'utf8'));
    assert.equal(persisted.attempts.length, sends); throw new Error('模拟连接中断');
  });
  const init = { method: 'POST', body: JSON.stringify({ model: p.model, max_tokens: 512, messages: [] }) };
  try {
    for (const [url, request] of [[p.endpoint + '/other', init], [p.endpoint, { ...init, method: 'GET' }],
      [p.endpoint, { ...init, body: JSON.stringify({ model: 'other', max_tokens: 512 }) }],
      [p.endpoint, { ...init, body: JSON.stringify({ model: p.model, max_tokens: 512, text: 'x'.repeat(65536) }) }]] as const) await assert.rejects(guarded(url, request));
    assert.equal(sends, 0); await assert.rejects(guarded(p.endpoint, init), /连接中断/);
    assert.equal(session.budget.ledger.attempts.length, 1);
    mkdirSync(join(root, 'integrated-budget.json.pending'));
    await assert.rejects(guarded(p.endpoint, init)); assert.equal(sends, 1);
    await assert.rejects(guarded(p.endpoint, init)); assert.equal(sends, 1);
  } finally { session.close(); }
});

test('原版Pi实际Chat/辅助解析/工具后请求共用同一物理账本，重启不重置或自动重放', async () => {
  const nativeFetch = globalThis.fetch;
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(m => m.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(content(payload.messages.at(-1)?.content)); return reply(JSON.stringify({ action: 'goal_manage', mode: 'request', goalAction: 'create', evidence: message }));
    }
    const index = payload.messages.findLastIndex(m => m.role === 'user');
    return payload.messages.slice(index + 1).some(m => m.role === 'tool') ? reply('模型收尾') : toolCall('goal_manage', {});
  });
  const root = join(f.root, 'budget'), p = profile({ endpoint: f.config.baseUrl + '/chat/completions' });
  let session = openIntegratedAcceptance(root, p);
  try {
    globalThis.fetch = integratedAcceptanceFetch(session, f.config.apiKey!, nativeFetch);
    await f.chat('帮我逐步建立虚构目标');
    assert.equal(f.payloads.length, 3); assert.equal(session.budget.ledger.attempts.length, 3);
    session.close(); session = openIntegratedAcceptance(root, p, true);
    globalThis.fetch = integratedAcceptanceFetch(session, f.config.apiKey!, nativeFetch);
    await f.restart(); assert.equal(session.budget.ledger.attempts.length, 3); assert.equal(f.requests, 0);
    assert.ok(readFileSync(join(root, 'request-01.json'), 'utf8').includes('messages'));
  } finally { globalThis.fetch = nativeFetch; session.close(); await f.close(); }
});
