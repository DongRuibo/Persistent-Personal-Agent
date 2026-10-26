import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { manualGoalV2Definition, readManualGoalReview } from '../scripts/manual-goal-console-review.js';
import { manualGoalDefinition } from '../scripts/manual-goal-console-cases.js';
import { digest, openIndependent } from '../scripts/independent-console-budget.js';
import { stagedModel } from '../scripts/staged-console-cases.js';

test('新五维评分：仅模型解释失败可人工审阅后继续，其余维度/归属/缺失评分不得放行', () => {
  const data = mkdtempSync(join(tmpdir(), 'manual-review-')), audit = '{"fixture":"new mock audit"}';
  writeFileSync(join(data, 'M3-audit.json'), audit);
  assert.throws(() => readManualGoalReview(data, 'M3', 'mock-run'), /尚无人工/);
  const review = { caseId: 'M3', foregroundRunId: 'mock-run', auditHash: digest(audit), humanReviewed: true,
    modelSemanticPass: false, hostAuthorizationPass: true, userVisibleResultPass: true, persistencePass: true, safetyPass: true };
  const file = join(data, 'M3-review.json');
  writeFileSync(file, JSON.stringify(review)); const before = readFileSync(file, 'utf8');
  const result = readManualGoalReview(data, 'M3', 'mock-run');
  assert.equal(result.mayContinue, true); assert.equal(result.overallPass, false); assert.equal(result.review.modelSemanticPass, false);
  assert.equal(readFileSync(file, 'utf8'), before, '不把失败改成通过或改写评分');
  for (const key of ['hostAuthorizationPass', 'userVisibleResultPass', 'persistencePass', 'safetyPass'] as const) {
    writeFileSync(file, JSON.stringify({ ...review, [key]: false })); assert.equal(readManualGoalReview(data, 'M3', 'mock-run').mayContinue, false);
  }
  for (const change of [{ humanReviewed: false }, { caseId: 'M2' }, { foregroundRunId: 'other-run' }, { auditHash: 'a'.repeat(64) }, { modelSemanticPass: 'false' }]) {
    writeFileSync(file, JSON.stringify({ ...review, ...change })); assert.throws(() => readManualGoalReview(data, 'M3', 'mock-run'), /无效/);
  }
});

test('新v2入口默认拒绝，复用原九句与限额；旧scope不能借新规则续跑', () => {
  assert.equal(manualGoalV2Definition.cases, manualGoalDefinition.cases);
  assert.deepEqual(manualGoalV2Definition.limits, manualGoalDefinition.limits);
  const r = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/manual-goal-console-v2-acceptance.ts'], {
    encoding: 'utf8', windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot },
  });
  assert.equal(r.status, 1); assert.match(r.stderr, /40请求\/6.60元/);
  const parent = mkdtempSync(join(tmpdir(), 'manual-v2-scope-'));
  const profile = { ...stagedModel, inputRate: 2, outputRate: 8, cacheReadRate: 0.04, extraFeesCny: 0 as const,
    checkedAt: new Date().toISOString(), planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64), casesHash: '4'.repeat(64), nodeVersion: process.version };
  const root = join(parent, 'v1'), old = openIndependent(root, profile, false, manualGoalDefinition); old.close();
  const file = join(root, 'independent-budget.json'), before = readFileSync(file, 'utf8');
  assert.throws(() => openIndependent(root, profile, true, manualGoalV2Definition), /旧scope/); assert.equal(readFileSync(file, 'utf8'), before);
  const fresh = openIndependent(join(parent, 'v2'), profile, false, manualGoalV2Definition); fresh.begin('M1');
  fresh.budget.reserve('M1', 100, 1); fresh.persist(); fresh.finish('M1', true); fresh.close();
  const resumed = openIndependent(join(parent, 'v2'), profile, true, manualGoalV2Definition);
  assert.equal(resumed.budget.ledger.attempts.length, 1); assert.throws(() => resumed.begin('M1')); resumed.close();
});
