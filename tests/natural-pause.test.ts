import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { IndependentBudget, openIndependent } from '../scripts/independent-console-budget.js';
import { naturalPauseCases, naturalPauseDefinition } from '../scripts/natural-pause-console-cases.js';
import { independentCases } from '../scripts/independent-console-cases.js';
import { stagedModel } from '../scripts/staged-console-cases.js';
import { independentFetch } from '../scripts/independent-console-acceptance.js';

const profile = () => ({ ...stagedModel, inputRate: 2, outputRate: 8, cacheReadRate: 0.04, extraFeesCny: 0 as const, checkedAt: new Date().toISOString(),
  planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64), casesHash: '4'.repeat(64), nodeVersion: process.version });
const root = () => join(mkdtempSync(join(tmpdir(), 'natural-pause-budget-')), 'new-round');

test('新暂停入口默认拒绝；独立scope只含三句原话、14/2.31/零GET，旧Case与结果不追改', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/natural-pause-console-acceptance.ts'], { encoding: 'utf8', windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.equal(r.status, 1); assert.match(r.stderr, /14请求\/2.31元/);
  assert.deepEqual(Object.keys(naturalPauseCases), ['N1', 'N2', 'N3']);
  assert.equal(naturalPauseCases.N1.prompt, independentCases.P1.prompt); assert.equal(naturalPauseCases.N2.prompt, independentCases.P2.prompt);
  assert.equal(naturalPauseCases.N3.prompt, '暂停那个学习计划'); assert.ok(!naturalPauseCases.N1.prompt.includes('学习计划'));
  assert.deepEqual(naturalPauseDefinition.limits, { requests: 14, microCny: 2310000, bodyBytes: 65536, outputTokens: 4096, publicGets: 0 });
});

test('新scope复用持久预算但不能接旧账本、借组额度、重发或重启清零；失败与pending保守拒绝', () => {
  const path = root(), p = profile(); let session = openIndependent(path, p, false, naturalPauseDefinition);
  session.begin('N1'); assert.throws(() => session.begin('P1')); session.budget.reserve('N1', 65536, 4096); session.persist(); session.finish('N1', true); session.close();
  const file = join(path, 'independent-budget.json'), before = readFileSync(file, 'utf8');
  assert.throws(() => openIndependent(path, p, true), /旧scope/); assert.equal(readFileSync(file, 'utf8'), before); assert.equal(existsSync(join(path, 'independent.lock')), false);
  session = openIndependent(path, p, true, naturalPauseDefinition); assert.equal(session.budget.ledger.attempts.length, 1);
  assert.throws(() => session.begin('N1')); assert.throws(() => session.begin('N2'));
  session.begin('N2', true); session.budget.reserve('N2', 100, 1); session.persist(); session.finish('N2', false); session.close();
  session = openIndependent(path, p, true, naturalPauseDefinition); assert.throws(() => session.begin('N3', true)); session.close();
  writeFileSync(file + '.pending', 'incomplete'); assert.throws(() => openIndependent(path, p, true, naturalPauseDefinition), /未完成/);
  const oldRoot = root(), old = openIndependent(oldRoot, p); old.close();
  const oldFile = join(oldRoot, 'independent-budget.json'), oldText = readFileSync(oldFile, 'utf8');
  assert.throws(() => openIndependent(oldRoot, p, true, naturalPauseDefinition), /旧scope/); assert.equal(readFileSync(oldFile, 'utf8'), oldText);
});

test('新暂停总闸和单Case容量/次数/费用限制发送前生效，费率变化/未知不放行', () => {
  const d = naturalPauseDefinition, p = profile();
  const ledger = { version: 1 as const, scope: d.scope, identity: 'a'.repeat(64), profile: p, limits: d.limits, groups: d.groups,
    cases: [{ id: 'N1', at: new Date().toISOString() }, { id: 'N2', at: new Date().toISOString() }, { id: 'N3', at: new Date().toISOString() }], attempts: [] };
  const b = new IndependentBudget(ledger, d);
  for (const [id, n] of [['N1', 6], ['N2', 4], ['N3', 4]] as const) for (let i = 0; i < n; i++) b.reserve(id, 65536, 4096);
  assert.equal(b.ledger.attempts.length, 14); assert.equal(b.reserved, 2308096); assert.throws(() => b.reserve('N3', 1, 1)); assert.equal(b.ledger.attempts.length, 14);
  assert.throws(() => b.reserve('N1', 65537, 1)); assert.throws(() => b.reserve('N1', 1, 4097));
  const expensive = structuredClone(ledger); expensive.profile.inputRate = 3; expensive.attempts = [];
  const high = new IndependentBudget(expensive, d); for (let i = 0; i < 6; i++) high.reserve('N1', 65536, 4096);
  for (let i = 0; i < 4; i++) high.reserve('N2', 65536, 4096);
  assert.throws(() => high.reserve('N3', 65536, 4096)); assert.ok(high.reserved <= 2310000);
  const unknown = structuredClone(ledger); unknown.profile.cacheReadRate = NaN; assert.throws(() => new IndependentBudget(unknown, d));
});

test('新scope的固定传输仍在DNS/模型发送前拒绝GET，持久停止且不恢复额度', async () => {
  const path = root(), p = profile(), session = openIndependent(path, p, false, naturalPauseDefinition);
  session.begin('N1'); let sent = 0;
  const guarded = independentFetch(session, 'N1', 'offline-key', async () => { sent++; return new Response('not expected'); });
  try {
    await assert.rejects(guarded(stagedModel.endpoint, { method: 'GET' }), /GET在DNS前拒绝/);
    assert.equal(sent, 0); assert.equal(session.budget.ledger.attempts.length, 0); assert.ok(session.budget.ledger.halted);
  } finally { session.close(); }
  assert.throws(() => openIndependent(path, p, true, naturalPauseDefinition), /共同安全故障/);
});
