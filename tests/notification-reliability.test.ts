import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { notificationCases } from '../evals/runners/phase2-notifications.js';
import { goalRecoveryCases } from '../evals/runners/phase2-goals.js';

for (const [id, scenario] of Object.entries({ ...notificationCases, ...goalRecoveryCases })) test(`第二轮可靠性 ${id}`, {
  timeout: 30000, skip: process.platform === 'win32' && ['N02','N03','N08','G11'].includes(id) ? 'POSIX真实强杀验证' : false,
}, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `p2-test-${id}-`)));
  const checks: { name: string; passed: boolean; actual?: unknown }[] = [];
  try {
    await scenario({ root, target: process.cwd(), trace: [], observations: {}, check(name, passed, actual) { checks.push({ name, passed, actual }); } });
    assert.ok(checks.length > 0); assert.deepEqual(checks.filter(c => !c.passed), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
