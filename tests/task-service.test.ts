import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { redactor } from '../src/config.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';

const now = new Date('2026-10-20T00:00:00.000Z');
const due = '2026-10-20T00:01:00.000Z';

test('创建、查询、取消；取消后永不领取', () => {
  const store = new SqliteStore(':memory:');
  try {
    const tasks = new TaskService(store, 'Asia/Taipei', () => now);
    const task = tasks.create('打个招呼', '1分钟后');
    assert.equal(task.dueAt, due);
    assert.equal(tasks.get(task.id).status, 'pending');
    assert.equal(tasks.list().length, 1);
    assert.equal(tasks.cancel(task.id).status, 'cancelled');
    assert.throws(() => tasks.cancel(task.id), /不能取消/);
    assert.equal(store.claimDue(due), undefined);
    assert.throws(() => tasks.create('', '1分钟后'));
    assert.throws(() => tasks.get('missing'));
  } finally { store.close(); }
});

test('多个数据库连接只有一个能领取；运行中和完成后不可取消', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-claim-'));
  const path = join(directory, 'test.db');
  const first = new SqliteStore(path);
  const second = new SqliteStore(path);
  try {
    const tasks = new TaskService(first, 'Asia/Taipei', () => now);
    const task = tasks.create('任务', '1分钟后');
    assert.equal(first.claimDue(now.toISOString()), undefined);
    const claimed = first.claimDue(due)!;
    assert.equal(claimed.task.id, task.id);
    assert.equal(second.claimDue(due), undefined);
    assert.throws(() => tasks.cancel(task.id), /running/);
    first.finishRun(claimed.run.id, 'succeeded', due, '完成');
    assert.equal(second.getTask(task.id)?.status, 'succeeded');
    assert.throws(() => tasks.cancel(task.id), /succeeded/);
    assert.throws(() => first.finishRun(claimed.run.id, 'succeeded', due), /已结束/);
    assert.equal(first.listRuns(task.id).length, 1);
  } finally {
    first.close(); second.close(); rmSync(directory, { recursive: true, force: true });
  }
});

test('关闭再打开恢复 pending，running 标记中断且不重试，日志脱敏持久化', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-restart-'));
  const path = join(directory, 'test.db');
  let store = new SqliteStore(path, redactor('test-only-secret'));
  try {
    const tasks = new TaskService(store, 'Asia/Taipei', () => now);
    const running = tasks.create('先执行', '1分钟后');
    const pending = tasks.create('后执行', '2分钟后');
    const claimed = store.claimDue(due)!;
    store.observer(claimed.run.id).modelCall({ provider: 'test', model: 'stub', inputTokens: 12, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, cost: null, stopReason: 'error', error: 'test-only-secret' });
    store.close();
    store = new SqliteStore(path, redactor('test-only-secret'));
    assert.equal(store.recoverInterrupted(due), 1);
    assert.equal(store.recoverInterrupted(due), 0);
    assert.equal(store.getTask(running.id)?.status, 'interrupted');
    assert.equal(store.getRun(claimed.run.id)?.status, 'interrupted');
    assert.equal(store.modelCalls(claimed.run.id)[0]?.error, '<REDACTED>');
    assert.ok(store.events(claimed.run.id).some((event) => event.type === 'run_interrupted'));
    assert.equal(store.getTask(pending.id)?.status, 'pending');
    assert.equal(store.claimDue('2026-10-20T00:02:00.000Z')?.task.id, pending.id);
    assert.equal(store.claimDue('2026-10-20T00:02:00.000Z'), undefined);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
