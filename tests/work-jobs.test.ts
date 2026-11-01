import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';
import { readConfig } from '../src/config.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) }, now = '2026-11-01T00:00:00.000Z';
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'work-job-store-')), path = join(root, 'app.db');
  const store = new SqliteStore(path), db = new DatabaseSync(path);
  const thread = store.workThreads.create(actor, randomUUID(), '合成工作主题', now);
  return { store, db, path, thread,
    create: (text = '整理本次给出的文字') => store.workJobs.create(actor, thread.id, randomUUID(), text, now),
    close() { db.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('后台开关默认关闭、严格布尔、依赖工作主题', () => {
  const env = { DATABASE_PATH: '/private/tmp/not-opened-work-jobs.db' };
  assert.equal(readConfig(env).workJobsEnabled, false);
  assert.throws(() => readConfig({ ...env, WORK_JOBS_ENABLED: '1' }), /WORK_JOBS_ENABLED/);
  assert.throws(() => readConfig({ ...env, WORK_JOBS_ENABLED: 'true' }), /WORK_THREADS_ENABLED/);
  assert.equal(readConfig({ ...env, WORK_JOBS_ENABLED: 'true', WORK_THREADS_ENABLED: 'true' }).workJobsEnabled, true);
});

test('只入队不建Run；同请求去重，主题/内容冲突拒绝；归档不撤销已有工作', () => {
  const f = fixture(); try {
    const id = randomUUID(), job = f.store.workJobs.create(actor, f.thread.id, id, '原始输入', now);
    assert.equal(job.status, 'queued'); assert.equal(job.runId, null); assert.equal(f.store.listRuns().length, 0);
    assert.deepEqual(f.store.workJobs.create(actor, f.thread.id, id, '原始输入', now), job);
    const other = f.store.workThreads.create(actor, randomUUID(), '另一主题', now);
    assert.throws(() => f.store.workJobs.create(actor, other.id, id, '原始输入', now), /其他内容或主题/);
    assert.throws(() => f.store.workJobs.create(actor, f.thread.id, id, '冲突输入', now), /其他内容或主题/);
    f.store.workThreads.update(actor, f.thread.id, { status: 'archived' }, now);
    assert.deepEqual(f.store.workJobs.create(actor, f.thread.id, id, '原始输入', now), job);
    assert.throws(() => f.create(), /恢复主题/);
    assert.equal(f.store.workJobs.claim(actor, now)?.job.id, job.id);
  } finally { f.close(); }
});

test('读取、创建、取消及领取按身份/渠道隔离，未知主题拒绝', () => {
  const f = fixture(); try {
    const job = f.create();
    for (const foreign of [{ ...actor, owner: 'other' }, { ...actor, channel: '{"channel":"console"}' }]) {
      assert.throws(() => f.store.workJobs.get(foreign, job.id), /无权访问/);
      assert.throws(() => f.store.workJobs.cancel(foreign, job.id, now), /无权访问/);
      assert.throws(() => f.store.workJobs.create(foreign, f.thread.id, randomUUID(), '越权', now), /无权访问/);
      assert.deepEqual(f.store.workJobs.list(foreign), []); assert.equal(f.store.workJobs.claim(foreign, now), undefined);
    }
    assert.throws(() => f.store.workJobs.create(actor, randomUUID(), randomUUID(), '未知', now), /无权访问/);
    assert.throws(() => f.store.workJobs.list(actor, randomUUID()), /无权访问/);
  } finally { f.close(); }
});

test('queued取消不建Run；running取消原子结束Run，迟到成功无资格，终态取消幂等', () => {
  const f = fixture(); try {
    const queued = f.create(); assert.equal(f.store.workJobs.cancel(actor, queued.id, now).status, 'cancelled');
    assert.equal(f.store.listRuns().length, 0); assert.equal(f.store.workJobs.claim(actor, now), undefined);
    assert.equal(f.store.workJobs.cancel(actor, queued.id, now).status, 'cancelled');
    const job = f.create(), claimed = f.store.workJobs.claim(actor, now)!;
    assert.equal(claimed.job.id, job.id);
    assert.throws(() => f.store.finishRun(claimed.run.id, 'succeeded', now, '绕过'), /WorkJobStore/);
    assert.equal(f.store.workJobs.cancel(actor, job.id, now).status, 'cancelled');
    assert.equal(f.store.getRun(claimed.run.id)?.status, 'interrupted');
    assert.equal(f.store.workJobs.finish(actor, job.id, claimed.run.id, 'succeeded', now, '迟到成功'), false);
    assert.equal(f.store.getRun(claimed.run.id)?.output, null);
    const done = f.create(), run = f.store.workJobs.claim(actor, now)!.run;
    assert.equal(f.store.workJobs.finish(actor, done.id, run.id, 'succeeded', now, '正常结果'), true);
    assert.equal(f.store.workJobs.cancel(actor, done.id, now).status, 'succeeded');
    assert.equal(f.store.getRun(run.id)?.output, '正常结果');
  } finally { f.close(); }
});

for (const operation of ['claim', 'finish', 'cancel', 'recover'] as const) test(`${operation}的Job写入失败时技术Run和Job一起回滚`, () => {
  const f = fixture(); try {
    const job = f.create();
    const run = operation === 'claim' ? undefined : f.store.workJobs.claim(actor, now)!.run;
    const status = { claim: 'running', finish: 'succeeded', cancel: 'cancelled', recover: 'interrupted' }[operation];
    f.db.exec(`CREATE TRIGGER fail_job BEFORE UPDATE ON work_jobs WHEN NEW.status='${status}' BEGIN SELECT RAISE(ABORT,'injected job failure'); END;`);
    assert.throws(() => {
      if (operation === 'claim') f.store.workJobs.claim(actor, now);
      if (operation === 'finish') f.store.workJobs.finish(actor, job.id, run!.id, 'succeeded', now, '不得部分提交');
      if (operation === 'cancel') f.store.workJobs.cancel(actor, job.id, now);
      if (operation === 'recover') f.store.recoverInterrupted(now);
    }, /injected/);
    assert.equal(f.store.workJobs.get(actor, job.id).status, run ? 'running' : 'queued');
    if (run) assert.equal(f.store.getRun(run.id)?.status, 'running');
    else assert.equal(f.store.listRuns().length, 0);
    f.db.exec('DROP TRIGGER fail_job');
    if (run) { f.store.recoverInterrupted(now); assert.equal(f.store.workJobs.get(actor, job.id).status, 'interrupted'); }
  } finally { f.close(); }
});

test('重开与统一恢复：queued保留、running中断、已完成与取消不重排；请求去重仍有效', () => {
  const f = fixture(); let reopened: SqliteStore | undefined;
  try {
    const done = f.create(), first = f.store.workJobs.claim(actor, now)!;
    f.store.workJobs.finish(actor, done.id, first.run.id, 'succeeded', now, '已提交成果');
    const running = f.create(), second = f.store.workJobs.claim(actor, now)!;
    const queued = f.create(), cancelled = f.create(); f.store.workJobs.cancel(actor, cancelled.id, now);
    reopened = new SqliteStore(f.path); assert.equal(reopened.recoverInterrupted(now), 1);
    assert.equal(reopened.workJobs.get(actor, running.id).status, 'interrupted');
    assert.equal(reopened.getRun(second.run.id)?.status, 'interrupted');
    assert.equal(reopened.workJobs.get(actor, queued.id).status, 'queued');
    assert.equal(reopened.workJobs.get(actor, done.id).status, 'succeeded');
    assert.equal(reopened.getRun(first.run.id)?.output, '已提交成果');
    assert.equal(reopened.workJobs.get(actor, cancelled.id).status, 'cancelled');
    assert.deepEqual(reopened.workJobs.create(actor, queued.threadId, queued.requestId, queued.instruction, now), queued);
    assert.equal(reopened.recoverInterrupted(now), 0); assert.equal(reopened.listRuns().length, 2);
  } finally { reopened?.close(); f.close(); }
});

test('Job绑定证明Run可见；伪造手工关系不扩大归属，原Task/Run不受影响', () => {
  const f = fixture(); try {
    const foreign = f.store.beginRun(null, now), task = f.store.createTask('旧提醒', now, now);
    f.db.prepare("INSERT INTO work_links VALUES(?,'run',?,'user',?)").run(f.thread.id, foreign.id, now);
    assert.equal(f.store.webUi.ownsRun(actor.owner, actor.channel, foreign.id), false);
    const job = f.create(), run = f.store.workJobs.claim(actor, now)!.run;
    assert.equal(f.store.webUi.ownsRun(actor.owner, actor.channel, run.id), true);
    assert.equal(f.store.webUi.ownsRun('other', actor.channel, run.id), false);
    assert.equal(f.store.webUi.ownsRun(actor.owner, '{"channel":"console"}', run.id), false);
    f.store.workJobs.finish(actor, job.id, run.id, 'succeeded', now, '后台结果');
    assert.equal(f.store.getRun(foreign.id)?.status, 'running'); assert.equal(f.store.getTask(task.id)?.status, 'pending');
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});
