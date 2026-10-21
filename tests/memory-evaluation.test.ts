import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

test('检索评测可复现且报告真实漏检/误排，所有 Context 遵守预算；不把脚本成功视为质量达标', () => {
  const run = () => {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/evaluate-memory.ts'], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    return JSON.parse(child.stdout) as { cases: { contextBytes: number; retrievedKeys: string[]; top1: boolean; latencyMs?: number }[]; holdout: { cases: { contextBytes: number; latencyMs?: number }[] } };
  };
  const first = run();
  const second = run();
  const stable = (cases: { latencyMs?: number }[]) => cases.map(({ latencyMs: _latency, ...rest }) => rest);
  assert.deepEqual(stable(second.cases), stable(first.cases));
  assert.deepEqual(stable(second.holdout.cases), stable(first.holdout.cases));
  assert.equal(first.cases.length, 16);
  assert.ok(first.holdout.cases.length >= 20);
  assert.ok(first.holdout.cases.every(sample => sample.contextBytes <= 2048));
  assert.ok(first.cases.every((sample) => sample.contextBytes <= 2048 && new Set(sample.retrievedKeys).size === sample.retrievedKeys.length));
});
