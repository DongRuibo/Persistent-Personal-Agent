import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { IndependentBudget, openIndependent } from '../scripts/independent-console-budget.js';
import { independentFetch } from '../scripts/independent-console-acceptance.js';
import { manualGoalCases, manualGoalDefinition } from '../scripts/manual-goal-console-cases.js';
import { stagedModel } from '../scripts/staged-console-cases.js';
import { naturalPauseDefinition } from '../scripts/natural-pause-console-cases.js';

const profile = () => ({ ...stagedModel, inputRate: 2, outputRate: 8, cacheReadRate: 0.04, extraFeesCny: 0 as const,
  checkedAt: new Date().toISOString(), planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64), casesHash: '4'.repeat(64), nodeVersion: process.version });
const root = () => join(mkdtempSync(join(tmpdir(), 'manual-goal-budget-')), 'round');

test('M入口默认不执行；九条原话和6/4/4/5/4/4/5/4/4上限与RC一致，零GET', () => {
  const path = root();
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/manual-goal-console-acceptance.ts', '--case=M1', '--root=' + path], {
    encoding: 'utf8', windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(r.status, 1); assert.match(r.stderr, /40请求\/6.60元/); assert.equal(existsSync(path), false);
  const rc = readFileSync('docs/evaluations/local-rc-review.md', 'utf8'), plan = readFileSync('docs/evaluations/manual-goal-console-live-plan.md', 'utf8');
  for (const spec of Object.values(manualGoalCases)) { assert.ok(rc.includes(spec.prompt)); assert.ok(plan.includes(spec.prompt)); }
  assert.deepEqual(Object.values(manualGoalCases).map(c => c.max), [6, 4, 4, 5, 4, 4, 5, 4, 4]);
  assert.equal(Object.values(manualGoalCases).reduce((n, c) => n + c.expected, 0), 29);
  assert.deepEqual(manualGoalDefinition.limits, { requests: 40, microCny: 6600000, bodyBytes: 65536, outputTokens: 4096, publicGets: 0 });
});

test('M预算复用原闸：40次/人民币/各消息/容量先拒绝，费率未知不执行', () => {
  const d = manualGoalDefinition;
  const fresh = () => ({ version: 1 as const, scope: d.scope, identity: 'a'.repeat(64), profile: profile(), limits: d.limits, groups: d.groups,
    cases: Object.keys(manualGoalCases).map(id => ({ id, at: new Date().toISOString() })), attempts: [] });
  const b = new IndependentBudget(fresh(), d);
  for (const [id, spec] of Object.entries(manualGoalCases)) for (let n = 0; n < spec.max; n++) b.reserve(id, 65536, 4096);
  assert.equal(b.ledger.attempts.length, 40); assert.equal(b.reserved, 6594560);
  assert.throws(() => b.reserve('M9', 1, 1)); assert.equal(b.ledger.attempts.length, 40);
  const perMessage = new IndependentBudget(fresh(), d);
  for (let n = 0; n < 6; n++) perMessage.reserve('M1', 1, 1);
  assert.throws(() => perMessage.reserve('M1', 1, 1)); assert.equal(perMessage.ledger.attempts.length, 6);
  assert.throws(() => perMessage.reserve('M2', 65537, 1)); assert.throws(() => perMessage.reserve('M2', 1, 4097));
  const high = fresh(); high.profile.inputRate = 3; const costly = new IndependentBudget(high, d); let stopped = false;
  for (const [id, spec] of Object.entries(manualGoalCases)) for (let n = 0; n < spec.max && !stopped; n++) {
    try { costly.reserve(id, 65536, 4096); } catch { stopped = true; }
  }
  assert.ok(stopped); assert.ok(costly.reserved <= 6600000); assert.ok(costly.ledger.attempts.length < 40);
  const unknown = fresh(); unknown.profile.cacheReadRate = NaN; assert.throws(() => new IndependentBudget(unknown, d));
});

test('M独立scope、单次消息、跨重启/配置/pending不退额；旧PRS和N账本不混用', () => {
  const path = root(), p = profile(); let s = openIndependent(path, p, false, manualGoalDefinition);
  s.begin('M1'); s.budget.reserve('M1', 1000, 4096); s.persist(); s.finish('M1', true); s.close();
  const file = join(path, 'independent-budget.json'), saved = readFileSync(file, 'utf8');
  assert.throws(() => openIndependent(path, p, true), /旧scope/); assert.equal(readFileSync(file, 'utf8'), saved);
  assert.throws(() => openIndependent(path, p, true, naturalPauseDefinition), /旧scope/); assert.equal(readFileSync(file, 'utf8'), saved);
  s = openIndependent(path, p, true, manualGoalDefinition); assert.equal(s.budget.ledger.attempts.length, 1);
  assert.throws(() => s.begin('M1')); assert.throws(() => s.begin('M2')); s.begin('M2', true); s.finish('M2', false); s.close();
  s = openIndependent(path, p, true, manualGoalDefinition); assert.throws(() => s.begin('M3', true)); s.close();
  const changed = { ...p, codeHash: '5'.repeat(64) }; assert.throws(() => openIndependent(path, changed, true, manualGoalDefinition), /变化/);
  const unfinished = root(); const active = openIndependent(unfinished, p, false, manualGoalDefinition); active.begin('M1'); active.close();
  assert.throws(() => openIndependent(unfinished, p, true, manualGoalDefinition), /未完成Case/);
  writeFileSync(join(unfinished, 'independent-budget.json.pending'), 'uncertain');
  assert.throws(() => openIndependent(unfinished, p, true, manualGoalDefinition), /未完成写入/);
});

test('M传输GET在DNS前拒绝，断连的已落盘预留不退款、不能重开重发', async () => {
  for (const mode of ['get', 'disconnect'] as const) {
    const path = root(), p = profile(), s = openIndependent(path, p, false, manualGoalDefinition); mkdirSync(join(path, 'P')); s.begin('M1');
    let sent = 0;
    const transport = independentFetch(s, 'M1', 'offline-only-key', async () => { sent++; throw new Error('offline disconnect'); });
    const options = mode === 'get' ? { method: 'GET' } : { method: 'POST', body: JSON.stringify({ model: stagedModel.model, max_tokens: 4096,
      messages: [{ role: 'user', content: manualGoalCases.M1.prompt }] }) };
    await assert.rejects(transport(stagedModel.endpoint, options)); s.close();
    assert.equal(sent, mode === 'get' ? 0 : 1);
    const ledger = JSON.parse(readFileSync(join(path, 'independent-budget.json'), 'utf8'));
    assert.equal(ledger.attempts.length, sent); assert.ok(ledger.halted);
    if (sent) assert.ok(ledger.attempts[0].reservedMicroCny > 0);
    assert.throws(() => openIndependent(path, p, true, manualGoalDefinition), /共同安全故障/);
  }
});
