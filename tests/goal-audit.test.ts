import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { auditGoals } from '../scripts/audit-goals.js';
import { SqliteStore } from '../src/sqlite-store.js';

test('验收核对脚本只读且不输出隐私正文；能发现成功Run但Checkpoint缺失，不能修复或重试', () => {
  const root = mkdtempSync(join(tmpdir(), 'goal-audit-')), path = join(root, 'app.db');
  const store = new SqliteStore(path), actor = { ownerId: 'local-user', target: { channel: 'console' as const } }, now = new Date().toISOString();
  try {
    const goal = store.goals.create(actor, store.beginRun(null, now).id, 'PRIVATE_OBJECTIVE', now);
    const execution = store.goals.claim(actor, goal.id, goal.revision, now)!;
    assert.equal(auditGoals(path).passed, true); assert.ok(!JSON.stringify(auditGoals(path)).includes('PRIVATE_OBJECTIVE'));
    const raw = new DatabaseSync(path); raw.prepare("UPDATE runs SET status='succeeded' WHERE id=?").run(execution.run.id); raw.close();
    const before = readFileSync(path), report = auditGoals(path);
    assert.equal(report.passed, false); assert.ok(report.violations.some(value => value.startsWith('execution_status')));
    assert.deepEqual(readFileSync(path), before); assert.equal(store.goals.get(actor, goal.id).status, 'running');
    assert.throws(() => auditGoals(join(root, 'missing.db')));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
