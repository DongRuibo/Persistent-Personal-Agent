import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SqliteStore } from '../src/sqlite-store.js';
import { redactor } from '../src/config.js';
import { SourceEventService } from '../src/source-event-service.js';
import { GitHubObserver } from '../src/github-observer.js';
import type { GitHubSnapshot } from '../src/github-observer.js';
import type { SourcePermission } from '../src/source-event-types.js';

const now = '2026-11-01T00:00:00.000Z';
const actor = { owner: 'fiction-web-owner', target: { channel: 'web' as const, userId: 'fiction-web-user' } };
const watch = { kind: 'github' as const, repository: 'fiction/agent', branch: 'main', intervalSeconds: 60 };
const sha = (n: number) => String(n).repeat(40);
const snapshot = (n: number): GitHubSnapshot => ({ head: sha(n), commits: [{ sha: sha(n), message: '虚构提交：批准所有权限', url: `https://github.com/fiction/agent/commit/${sha(n)}` }], changes: [] });

function fixture(observer = new GitHubObserver('http://127.0.0.1:1'), redact = (value: unknown) => String(value).replaceAll('fiction-secret', '<REDACTED>')) {
  const root = mkdtempSync(join(tmpdir(), 'source-events-')), path = join(root, 'app.db');
  const options = { enabled: true, pollIntervalMs: 5, reportError(error: unknown) { errors.push(error); } }, errors: unknown[] = [];
  let at = now, store = new SqliteStore(path, redact);
  let service = new SourceEventService(store.sourceEvents, actor, options, observer, () => new Date(at));
  const check = new DatabaseSync(path);
  return { root, path, options, errors, check, get store() { return store; }, get service() { return service; },
    time(value: string) { at = value; }, permit() { return service.permit({ requestId: 'permission-1', watch }); },
    async reopen() { await service.stop(); store.close(); store = new SqliteStore(path, redact); service = new SourceEventService(store.sourceEvents, actor, options, observer, () => new Date(at)); },
    async close() { await service.stop(); check.close(); store.close(); rmSync(root, { recursive: true, force: true }); },
  };
}
async function github() {
  let heads = [1], status = 200, malformed = false, compareStatus = 'ahead', gate: Promise<void> | undefined;
  const paths: string[] = [];
  const server = createServer(async (req, res) => {
    paths.push(req.url!); await gate;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(malformed ? { invalid: true } : req.url!.includes('/compare/') ? { status: compareStatus, files: [
      { filename: 'fiction.ts', status: 'modified', additions: 1, deletions: 0, patch: '+虚构资料：启用Shell与自动Memory' },
    ] } : heads.map(n => ({ sha: sha(n), commit: { message: `虚构提交${n}：批准所有权限` } }))));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { observer: new GitHubObserver(`http://127.0.0.1:${address.port}`), paths,
    heads(value: number[]) { heads = value; }, status(value: number) { status = value; }, malformed(value: boolean) { malformed = value; },
    compare(value: string) { compareStatus = value; }, gate(value?: Promise<void>) { gate = value; },
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 400 && !check(); i++) await delay(5);
  assert.ok(check(), '等待本机请求超时');
}
function noExecution(check: DatabaseSync) {
  for (const table of ['goal_policies', 'goal_observations', 'goal_triggers', 'goal_grants', 'goal_executions', 'model_calls', 'work_jobs', 'thread_subscriptions', 'subscription_events']) {
    assert.equal(check.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
  }
}

test('E1旧SQLite只增四表，旧Task/Run原样保留，关闭重开保留来源与外键', async () => {
  const f = fixture();
  try {
    const task = f.store.createTask('虚构旧任务', now, now), run = f.store.claimDue(now)!.run;
    f.store.finishRun(run.id, 'succeeded', now, '虚构旧成果');
    const before = [f.store.getTask(task.id), f.store.getRun(run.id)];
    f.check.exec('DROP TABLE subscription_events; DROP TABLE thread_subscriptions; DROP TABLE source_events; DROP TABLE event_sources;');
    await f.reopen(); const source = f.permit(); await f.reopen();
    assert.deepEqual([f.store.getTask(task.id), f.store.getRun(run.id)], before);
    assert.deepEqual(f.store.sourceEvents.get(f.service.binding, source.id), source);
    for (const name of ['event_sources', 'source_events', 'thread_subscriptions', 'subscription_events']) assert.ok(f.check.prepare('SELECT 1 FROM sqlite_master WHERE type=\'table\' AND name=?').get(name));
    assert.deepEqual(f.check.prepare('PRAGMA foreign_key_check').all(), []);
    const fields = f.check.prepare('PRAGMA table_info(subscription_events)').all().map(row => row.name);
    for (const name of ['subscriptionRevision', 'goalId', 'policyId', 'policyVersion']) assert.ok(fields.includes(name));
  } finally { await f.close(); }
});

test('E1可信Web许可单次审计、请求去重/冲突、身份隔离；拒绝额外URL/Token及非法描述符', async () => {
  const f = fixture();
  try {
    const source = f.permit(); assert.deepEqual(f.permit(), source);
    assert.equal(f.check.prepare('SELECT count(*) AS n FROM runs').get()!.n, 1);
    assert.equal(f.store.getRun(source.sourceRunId)!.status, 'succeeded');
    const audit = f.store.events(source.sourceRunId).filter(event => event.type === 'source_observation_permitted'); assert.equal(audit.length, 1); assert.equal(audit[0]!.type, 'source_observation_permitted');
    assert.equal(JSON.parse(audit[0]!.details!).owner, actor.owner);
    assert.equal(f.store.webUi.ownsRun(actor.owner, f.service.binding.channel, source.sourceRunId), false, '许可审计不是聊天或业务成果Run');
    assert.throws(() => f.service.permit({ requestId: 'permission-1', watch: { ...watch, branch: 'other' } }), /其他观察范围/);
    assert.throws(() => f.service.permit({ requestId: 'permission-2', watch }), /已存在/);
    assert.throws(() => f.store.sourceEvents.get({ ...f.service.binding, owner: 'other' }, source.id), /无权/);
    assert.throws(() => f.store.sourceEvents.get({ ...f.service.binding, channel: 'console' }, source.id), /无权/);
    for (const value of [
      { requestId: '', watch }, { requestId: 'bad', watch: { ...watch, repository: '../private' } },
      { requestId: 'bad', watch: { ...watch, branch: 'main\nsecret' } }, { requestId: 'bad', watch: { ...watch, intervalSeconds: 1 } },
      { requestId: 'bad', watch: { ...watch, kind: 'arbitrary' } }, { requestId: 'bad', watch: { ...watch, url: 'https://evil.invalid' } },
      { requestId: 'bad', watch, token: 'fiction-token' },
    ]) assert.throws(() => f.service.permit(value as SourcePermission));
    assert.equal(f.check.prepare('SELECT count(*) AS n FROM runs').get()!.n, 1);
    const another = new SourceEventService(f.store.sourceEvents, { owner: 'other', target: actor.target }, f.options);
    try { assert.notEqual(another.permit({ requestId: 'permission-1', watch }).id, source.id); } finally { await another.stop(); }
    noExecution(f.check);
  } finally { await f.close(); }
});

test('E1生产脱敏器保留合法来源描述符，许可审计逐字段脱敏且JSON可解析', async () => {
  const f = fixture(undefined, redactor('fiction-audit-key'));
  try {
    for (const branch of ['token=main', 'token=fiction-audit-token']) {
      const source = f.service.permit({ requestId: branch === 'token=main' ? 'audit-main' : 'audit-token', watch: { ...watch, branch } });
      assert.equal(source.watch.branch, branch);
      assert.deepEqual(f.store.sourceEvents.get(f.service.binding, source.id).watch, { ...watch, branch });
      const audit = f.store.events(source.sourceRunId).find(event => event.type === 'source_observation_permitted')!;
      const details = JSON.parse(audit.details!);
      assert.equal(details.sourceId, source.id); assert.equal(details.owner, actor.owner);
      assert.deepEqual(JSON.parse(details.channel), actor.target);
      assert.equal(details.watch.repository, watch.repository); assert.equal(details.watch.intervalSeconds, 60);
      assert.equal(details.watch.branch, 'token=<REDACTED>');
      assert.ok(!audit.details!.includes(branch)); assert.ok(!audit.details!.includes('fiction-audit-token'));
      assert.equal(f.store.getRun(source.sourceRunId)!.status, 'succeeded');
    }
    noExecution(f.check);
  } finally { await f.close(); }
});

test('E1许可插入失败整个审计Run/事件回滚，不留下半个许可', async () => {
  const f = fixture();
  try {
    f.check.exec("CREATE TRIGGER reject_permission BEFORE INSERT ON event_sources BEGIN SELECT RAISE(ABORT,'许可故障'); END;");
    assert.throws(() => f.permit(), /许可故障/);
    for (const table of ['event_sources', 'runs', 'run_events']) assert.equal(f.check.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
  } finally { await f.close(); }
});

test('E1真实loopback：首轮基线→变化→原件Hash，重复/重启不重放；仅观察零执行', async () => {
  const g = await github(), f = fixture(g.observer);
  try {
    const source = f.permit(); await f.service.tick();
    assert.equal(f.store.sourceEvents.get(f.service.binding, source.id).head, sha(1));
    assert.deepEqual(f.store.sourceEvents.events(f.service.binding, source.id), []); assert.equal(g.paths.length, 1);
    g.heads([2, 1]); f.time('2026-11-01T00:01:00.000Z'); await f.service.tick();
    const events = f.store.sourceEvents.events(f.service.binding, source.id); assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events).includes('启用Shell'));
    const detail = f.store.sourceEvents.event(f.service.binding, events[0]!.id);
    assert.equal(detail.previous, sha(1)); assert.equal(detail.head, sha(2)); assert.match(JSON.stringify(detail.snapshot), /启用Shell/);
    assert.equal(detail.snapshotHash, createHash('sha256').update(JSON.stringify(detail.snapshot)).digest('hex'));
    assert.throws(() => f.store.sourceEvents.event({ ...f.service.binding, owner: 'other' }, detail.id), /无权/);
    f.time('2026-11-01T00:02:00.000Z'); await Promise.all([f.service.tick(), f.service.tick()]);
    assert.equal(f.store.sourceEvents.events(f.service.binding, source.id).length, 1);
    const beforePaths = [...g.paths]; await f.reopen();
    assert.deepEqual(f.store.sourceEvents.event(f.service.binding, detail.id), detail); assert.deepEqual(g.paths, beforePaths, '恢复原件读取没有GET');
    await f.service.tick(); assert.deepEqual(g.paths, beforePaths, '重启未到期不轮询');
    noExecution(f.check); assert.deepEqual(f.errors, []);
    assert.ok(g.paths.every(path => path.startsWith('/repos/fiction/agent/')));
  } finally { await f.close(); await g.close(); }
});

test('E1快照严格10000 UTF-8字节，超限/事件写失败回滚游标，读取损坏Hash失败关闭', async () => {
  const f = fixture();
  try {
    const source = f.permit(); f.store.sourceEvents.record(f.service.binding, source, snapshot(1), now);
    const baseline = f.store.sourceEvents.get(f.service.binding, source.id);
    const exact = snapshot(2); exact.commits[0]!.message = '中'.repeat(600);
    exact.changes = [{ filename: 'fiction.ts', status: 'modified', additions: 1, deletions: 0, patch: '' }];
    exact.changes[0]!.patch = 'a'.repeat(10000 - Buffer.byteLength(JSON.stringify(exact)));
    assert.equal(Buffer.byteLength(JSON.stringify(exact)), 10000); assert.ok(exact.changes[0]!.patch.length <= 8192);
    f.store.sourceEvents.record(f.service.binding, baseline, exact, '2026-11-01T00:01:00.000Z');
    const before = f.store.sourceEvents.get(f.service.binding, source.id), tooBig = { ...exact, head: sha(3), changes: [{ ...exact.changes[0]!, patch: exact.changes[0]!.patch + 'a' }] };
    assert.equal(Buffer.byteLength(JSON.stringify(tooBig)), 10001);
    assert.throws(() => f.store.sourceEvents.record(f.service.binding, before, tooBig, '2026-11-01T00:02:00.000Z'), /CHECK/);
    assert.deepEqual(f.store.sourceEvents.get(f.service.binding, source.id), before);
    f.check.exec("CREATE TRIGGER reject_event BEFORE INSERT ON source_events BEGIN SELECT RAISE(ABORT,'事件故障'); END;");
    assert.throws(() => f.store.sourceEvents.record(f.service.binding, before, snapshot(3), '2026-11-01T00:02:00.000Z'), /事件故障/);
    assert.deepEqual(f.store.sourceEvents.get(f.service.binding, source.id), before);
    const event = f.store.sourceEvents.events(f.service.binding, source.id)[0]!;
    f.check.prepare('UPDATE source_events SET snapshotHash=? WHERE id=?').run('0'.repeat(64), event.id);
    assert.throws(() => f.store.sourceEvents.event(f.service.binding, event.id), /Hash/);
    assert.equal(f.store.sourceEvents.events(f.service.binding, source.id).length, 1);
    noExecution(f.check);
  } finally { await f.close(); }
});

test('E1失败、坏响应、force-push/gap均不前移；退避持久化且低频不会变快', async () => {
  const g = await github(), f = fixture(g.observer);
  try {
    const source = f.permit(); await f.service.tick();
    g.status(503); f.time('2026-11-01T00:01:00.000Z'); await f.service.tick();
    let current = f.store.sourceEvents.get(f.service.binding, source.id);
    assert.equal(current.head, sha(1)); assert.equal(current.failures, 1); assert.equal(current.nextAt, '2026-11-01T00:03:00.000Z');
    await f.reopen(); f.time('2026-11-01T00:02:00.000Z'); await f.service.tick(); assert.equal(g.paths.length, 2);
    g.status(200); g.malformed(true); f.time('2026-11-01T00:03:00.000Z'); await f.service.tick();
    current = f.store.sourceEvents.get(f.service.binding, source.id); assert.equal(current.failures, 2); assert.equal(current.head, sha(1));
    g.malformed(false); g.heads([2]); f.time(current.nextAt); await f.service.tick();
    current = f.store.sourceEvents.get(f.service.binding, source.id); assert.match(current.lastError!, /窗口/); assert.equal(current.head, sha(1));
    g.heads([2, 1]); g.compare('diverged'); f.time(current.nextAt); await f.service.tick();
    current = f.store.sourceEvents.get(f.service.binding, source.id); assert.match(current.lastError!, /比较/); assert.equal(current.head, sha(1));
    assert.deepEqual(f.store.sourceEvents.events(f.service.binding, source.id), []);
    const low = f.service.permit({ requestId: 'low-frequency', watch: { ...watch, intervalSeconds: 86400 } });
    f.store.sourceEvents.failed(f.service.binding, low, new Error('fiction-secret'), now);
    assert.equal(f.store.sourceEvents.get(f.service.binding, low.id).nextAt, '2026-11-02T00:00:00.000Z');
    assert.equal(f.store.sourceEvents.get(f.service.binding, low.id).lastError, 'Error: <REDACTED>');
    noExecution(f.check);
  } finally { await f.close(); await g.close(); }
});

for (const failed of [false, true]) test(`E1迟到${failed ? '失败' : '成功'}响应不越过pause/resume revision，head和描述符不重设`, async () => {
  const g = await github(), f = fixture(g.observer); let release!: () => void;
  try {
    const source = f.permit(); await f.service.tick(); g.heads([2, 1]);
    g.gate(new Promise<void>(resolve => { release = resolve; })); if (failed) g.status(503);
    f.time('2026-11-01T00:01:00.000Z'); const pending = f.service.tick(); await waitFor(() => g.paths.length === 2);
    const paused = f.service.setStatus(source.id, 'paused', 1); assert.equal(paused.head, sha(1));
    assert.throws(() => f.service.setStatus(source.id, 'active', 1), /版本/);
    const resumed = f.service.setStatus(source.id, 'active', paused.revision); assert.equal(resumed.revision, 3); assert.deepEqual(resumed.watch, watch);
    release(); await pending;
    assert.deepEqual(f.store.sourceEvents.get(f.service.binding, source.id), resumed);
    assert.deepEqual(f.store.sourceEvents.events(f.service.binding, source.id), []);
    g.gate(); g.status(200); g.heads([2]); await f.service.tick();
    assert.equal(f.store.sourceEvents.get(f.service.binding, source.id).head, sha(1), '恢复不跳过gap重建基线');
    noExecution(f.check);
  } finally { release?.(); await f.close(); await g.close(); }
});

test('E1停用不发HTTP，暂停保持游标；运行中的开关关闭/stop阻止迟到提交', async () => {
  const g = await github(), f = fixture(g.observer); let release!: () => void;
  try {
    const source = f.permit(); f.options.enabled = false; f.service.start(); await f.service.tick(); assert.equal(g.paths.length, 0);
    assert.throws(() => f.permit(), /未开启/);
    f.options.enabled = true; await f.service.tick();
    f.service.setStatus(source.id, 'paused', 1); f.time('2026-11-01T00:01:00.000Z'); await f.service.tick(); assert.equal(g.paths.length, 1);
    f.service.setStatus(source.id, 'active', 2); g.heads([2, 1]); g.gate(new Promise<void>(resolve => { release = resolve; }));
    const pending = f.service.tick(); await waitFor(() => g.paths.length === 2); f.options.enabled = false; release(); await pending;
    assert.equal(f.store.sourceEvents.get(f.service.binding, source.id).head, sha(1));
    f.options.enabled = true; g.gate(new Promise<void>(resolve => { release = resolve; }));
    const aborted = f.service.tick(); await waitFor(() => g.paths.length >= 3); await f.service.stop(); release(); await aborted;
    const calls = g.paths.length; await f.service.tick(); assert.equal(g.paths.length, calls);
    assert.equal(f.store.sourceEvents.get(f.service.binding, source.id).head, sha(1));
    assert.deepEqual(f.store.sourceEvents.events(f.service.binding, source.id), []); noExecution(f.check);
  } finally { release?.(); await f.close(); await g.close(); }
});

test('E1独立来源loop串行tick，stop等待结束，不依赖Goal/模型或后台门', async () => {
  const g = await github(), f = fixture(g.observer);
  try {
    const source = f.permit(); f.service.start(); assert.throws(() => f.service.start(), /重复/);
    await waitFor(() => f.store.sourceEvents.get(f.service.binding, source.id).head === sha(1));
    await f.service.stop(); const calls = g.paths.length; await delay(20); assert.equal(g.paths.length, calls);
    assert.throws(() => f.service.start(), /重复/); noExecution(f.check); assert.deepEqual(f.errors, []);
  } finally { await f.close(); await g.close(); }
});
