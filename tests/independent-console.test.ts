import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { GroupBudgetExhausted, IndependentBudget, openIndependent } from '../scripts/independent-console-budget.js';
import { independentFetch } from '../scripts/independent-console-acceptance.js';
import { independentCases, independentLimits, groupLimits } from '../scripts/independent-console-cases.js';
import type { IndependentCase } from '../scripts/independent-console-cases.js';
import { stagedModel } from '../scripts/staged-console-cases.js';

const profile = () => ({ ...stagedModel, inputRate: 2, outputRate: 8, cacheReadRate: 0.04, extraFeesCny: 0 as const, checkedAt: new Date().toISOString(),
  planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64), casesHash: '4'.repeat(64), nodeVersion: process.version });
type Ledger = ConstructorParameters<typeof IndependentBudget>[0];
const ledger = (): Ledger => ({ version: 1, scope: 'independent-prs-console-v1', identity: 'a'.repeat(64), profile: profile(), limits: { ...independentLimits }, groups: structuredClone(groupLimits), cases: [], attempts: [] });
const root = () => join(mkdtempSync(join(tmpdir(), 'independent-budget-')), 'new-round');

test('独立入口默认拒绝执行，六Case冻结与30/5/零GET一致；P原话不改名，S不提Skill', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/independent-console-acceptance.ts'], { encoding: 'utf8', windowsHide: true,
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.equal(r.status, 1); assert.match(r.stderr, /未授权/);
  const plan = readFileSync('docs/evaluations/independent-console-live-plan.md', 'utf8');
  for (const c of Object.values(independentCases)) assert.ok(plan.includes(c.prompt));
  assert.equal(independentCases.P3.prompt, '暂停那个学习计划'); assert.ok(!independentCases.P1.prompt.includes('学习计划'));
  assert.ok(!/agent-notes|SKILL\.md|Skill/u.test(independentCases.S1.prompt));
  assert.equal(Object.values(independentCases).reduce((s, c) => s + c.max, 0), 30);
  assert.equal(Object.values(independentCases).reduce((s, c) => s + c.expected, 0), 20);
  assert.equal(independentLimits.publicGets, 0);
});

test('单Case/组/全局次数费用同时限制；失败不退，缓存未知/附加费/容量/过期均拒绝', () => {
  const b = new IndependentBudget(ledger());
  for (const [id, c] of Object.entries(independentCases) as [IndependentCase, typeof independentCases[IndependentCase]][]) {
    const record = { id, at: new Date().toISOString(), finished: undefined as string | undefined, statePass: true }; b.ledger.cases.push(record);
    for (let i = 0; i < c.max; i++) b.reserve(id, 65536, 4096).status = 500;
    assert.throws(() => b.reserve(id, 1, 1), /限额/); record.finished = new Date().toISOString();
  }
  assert.equal(b.ledger.attempts.length, 30); assert.equal(b.reserved, 4945920);
  assert.equal(new IndependentBudget(JSON.parse(JSON.stringify(b.ledger))).reserved, b.reserved);
  for (const [field, value] of [['inputRate', 0], ['outputRate', Infinity], ['cacheReadRate', undefined], ['extraFeesCny', 0.1]] as const) {
    const l = ledger(); (l.profile as unknown as Record<string, unknown>)[field] = value; assert.throws(() => new IndependentBudget(l), /计费/);
  }
  const l = ledger(); l.cases.push({ id: 'P1', at: new Date().toISOString() }); const c = new IndependentBudget(l);
  for (const [bytes, output] of [[65537, 4096], [1, 4097], [0, 1], [1, 0]]) assert.throws(() => c.reserve('P1', bytes!, output!), /64KiB/);
  l.profile.checkedAt = '2000-01-01T00:00:00.000Z'; assert.throws(() => c.reserve('P1', 1, 1), /费率/);
  const expensive = ledger(); expensive.profile.inputRate = 1000; expensive.cases.push({ id: 'P1', at: new Date().toISOString() });
  assert.throws(() => new IndependentBudget(expensive).reserve('P1', 65536, 4096), /限额/); assert.equal(expensive.attempts.length, 0);
});

test('语义/业务失败隔离，审阅声明不替代前置；跨重启累计、锁、pending和身份变化阻止绕过', () => {
  const path = root(), p = profile(); let s = openIndependent(path, p);
  try {
    assert.throws(() => openIndependent(path, p), /新目录/); assert.throws(() => openIndependent(path, p, true), /EEXIST/);
    s.begin('P1'); s.budget.reserve('P1', 100, 1); s.persist(); s.finish('P1', false); s.close();
    s = openIndependent(path, p, true); assert.equal(s.budget.ledger.attempts.length, 1);
    assert.throws(() => s.begin('P1'), /已消费/); assert.throws(() => s.begin('P2', true), /前置失败/);
    s.begin('R1'); s.finish('R1', true); assert.throws(() => s.begin('R2'), /未审阅/); s.begin('R2', true); s.finish('R2', false);
    s.begin('S1'); s.finish('S1', false); s.close();
    assert.throws(() => openIndependent(path, { ...p, codeHash: '5'.repeat(64) }, true), /源码/);
    assert.throws(() => openIndependent(path, p, true), /共同安全/);
    const pending = root(), t = openIndependent(pending, p); t.close(); mkdirSync(join(pending, 'independent-budget.json.pending'));
    assert.throws(() => openIndependent(pending, p, true), /未完成/);
    const interrupted = root(), u = openIndependent(interrupted, p); u.begin('P1'); u.close();
    assert.throws(() => openIndependent(interrupted, p, true), /未完成Case/);
  } finally { s.close(); }
});

test('物理发送前fsync留账，失败不退；传输/写入/GET拒绝是跨组持久停止', async () => {
  const p = profile(), path = root(); const s = openIndependent(path, p); s.begin('P1'); mkdirSync(join(path, 'P'));
  let sends = 0;
  const call = independentFetch(s, 'P1', 'offline-not-a-secret', async (_url, init) => {
    sends++; assert.equal(JSON.parse(readFileSync(join(path, 'independent-budget.json'), 'utf8')).attempts.length, 1);
    assert.equal(init?.redirect, 'error'); return new Response('fixture HTTP 500', { status: 500 });
  });
  const body = JSON.stringify({ model: stagedModel.model, max_tokens: 4096, messages: [{ role: 'user', content: independentCases.P1.prompt }] });
  try {
    await assert.rejects(call(stagedModel.endpoint, { method: 'POST', body }), /HTTP失败/); assert.equal(sends, 1);
    assert.equal(s.budget.ledger.attempts.length, 1); assert.ok(s.budget.reserved > 0);
    assert.equal(readFileSync(join(path, 'P/response-01.txt'), 'utf8'), 'fixture HTTP 500');
    assert.throws(() => s.begin('R1'), /共同停止/); s.close(); assert.throws(() => openIndependent(path, p, true), /共同安全/);
  } finally { s.close(); }
  for (const fault of ['get', 'pending', 'response-write'] as const) {
    const t = openIndependent(root(), p); t.begin('S1'); mkdirSync(join(t.root, 'S')); let sent = 0;
    const invoke = independentFetch(t, 'S1', 'offline-not-a-secret', async () => { sent++; return new Response('fixture'); });
    const b = JSON.stringify({ model: stagedModel.model, max_tokens: 4096, messages: [{ role: 'user', content: independentCases.S1.prompt }] });
    try {
      if (fault === 'pending') mkdirSync(join(t.root, 'independent-budget.json.pending'));
      if (fault === 'response-write') mkdirSync(join(t.root, 'S/response-01.txt'));
      if (fault === 'get') await assert.rejects(invoke('https://public.invalid/doc', { method: 'GET' }), /GET/);
      else if (fault === 'pending') await assert.rejects(invoke(stagedModel.endpoint, { method: 'POST', body: b }));
      else { const r = await invoke(stagedModel.endpoint, { method: 'POST', body: b }); await assert.rejects(r.text()); }
      assert.equal(sent, fault === 'response-write' ? 1 : 0); assert.throws(() => t.begin('P1'));
    } finally { t.close(); }
  }
});

test('已知单组额度耗尽零发送且不封禁独立组；整轮正常累计不借额', async () => {
  const s = openIndependent(root(), profile()); s.begin('S1'); mkdirSync(join(s.root, 'S')); let sent = 0;
  try {
    for (let i = 0; i < 4; i++) s.budget.reserve('S1', 65536, 4096); s.persist();
    const call = independentFetch(s, 'S1', 'offline-not-a-secret', async () => { sent++; return new Response('never'); });
    await assert.rejects(call(stagedModel.endpoint, { method: 'POST', body: JSON.stringify({ model: stagedModel.model, max_tokens: 4096, messages: [{ role: 'user', content: independentCases.S1.prompt }] }) }), GroupBudgetExhausted);
    assert.equal(sent, 0); assert.equal(s.budget.ledger.attempts.length, 4); assert.ok(!s.budget.ledger.halted);
    s.finish('S1', false); s.begin('P1'); s.budget.reserve('P1', 100, 1); s.persist();
    assert.equal(s.budget.ledger.attempts.length, 5); assert.equal(s.budget.ledger.attempts[4]!.caseId, 'P1');
  } finally { s.close(); }
});
