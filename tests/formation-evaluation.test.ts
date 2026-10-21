import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateFormation } from '../scripts/evaluate-formation.js';

test('60个冻结虚构窗口：30开发/30留出，模拟提议过滤与分类/冲突、无未经批准写入', async () => {
  const report = await evaluateFormation();
  assert.equal(report.rows.length, 60);
  assert.equal(report.development.windows, 30); assert.equal(report.holdout.windows, 30);
  assert.deepEqual(report.rows.filter(row => !row.passed).map(row => [row.id, row.expected, row.actual]), []);
  assert.ok(report.rows.every(row => row.unauthorizedWrites === 0));
  assert.equal(report.actualApiRequests, 0); assert.equal(report.semanticPrecision, null);
});
