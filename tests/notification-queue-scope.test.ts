import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/sqlite-store.js';
import { NotificationWorker } from '../src/notification-worker.js';
import type { Channel, MessageTarget, NotificationTargetFilter, OutboundMessage } from '../src/contracts.js';

const epoch = '2026-11-07T00:00:00.000Z', later = '2026-11-07T00:00:01.000Z';
const consoleTarget = { channel: 'console' as const }, web = { channel: 'web' as const, userId: 'fixture-web-user' };
const feishu = { channel: 'feishu' as const, appId: 'fixture-app', userOpenId: 'fixture-user', chatId: 'fixture-chat' };
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'notification-scope-'))), path = join(root, 'app.db');
  const store = new SqliteStore(path), db = new DatabaseSync(path), stores = [store], workers: NotificationWorker[] = [], sent: OutboundMessage[] = [];
  let now = later;
  function worker(targetFilter: NotificationTargetFilter, includeGoals = false, channel: Channel = { sendMessage: async message => { sent.push(message); } }, connection = store) {
    const options = { ownerId: 'local-user', targetFilter, includeGoals, pollIntervalMs: 10, reportError(error: unknown) { throw error; } };
    const result = new NotificationWorker(connection, channel, options, () => new Date(now)); workers.push(result); return result;
  }
  return { store, db, sent, worker,
    task(target: MessageTarget, at = epoch, owner = 'local-user') {
      const task = store.createTask('合成范围提醒', at, at, target), claimed = store.claimDue(at)!;
      store.finishTaskRun(claimed.run.id, 'succeeded', at, '合成唯一成果');
      const row = store.notifications.listForHost().find(item => item.taskId === task.id)!;
      if (owner !== 'local-user') db.prepare('UPDATE goal_notifications SET ownerId=? WHERE id=?').run(owner, row.id);
      return { taskId: task.id, runId: claimed.run.id, id: row.id };
    },
    goal(target: MessageTarget = consoleTarget) {
      const actor = { ownerId: 'local-user', target }, source = store.beginRun(null, epoch), goal = store.goals.create(actor, source.id, '合成Goal通知', epoch);
      store.finishRun(source.id, 'succeeded', epoch); const claim = store.goals.claim(actor, goal.id, goal.revision, epoch)!;
      store.goals.commit(claim.run.id, { stepOutcome: 'partial', artifactText: '合成成果', progressSummary: '等待反馈', question: '继续？' }, epoch);
      const id = randomUUID();
      // 合成持久Goal通知形态用于投递范围测试，不调用模型或扩展写入权限。
      db.prepare(`INSERT INTO goal_notifications(id,runId,goalId,ownerId,targetJson,goalRevision,text,status,attempts,nextAt,createdAt)
        VALUES (?,?,?,'local-user',?,1,'合成Goal成果','pending',0,?,?)`).run(id, claim.run.id, goal.id, JSON.stringify(target), epoch, epoch);
      return { id, runId: claim.run.id };
    },
    snapshot() { return db.prepare('SELECT * FROM goal_notifications ORDER BY id').all(); },
    time(value: string) { now = value; },
    connection() { const connection = new SqliteStore(path); stores.push(connection); return connection; },
    async close() { await Promise.all(workers.map(w => w.stop())); db.close(); for (const connection of stores) connection.close(); rmSync(root, { recursive: true, force: true }); },
  };
}

for (const sample of [
  { name: 'A：100条Console不能阻塞飞书', prefix: consoleTarget, current: feishu },
  { name: 'B-app：100条旧appId不能阻塞当前飞书', prefix: { ...feishu, appId: 'old-app' }, current: feishu },
  { name: 'B-user：100条旧userOpenId不能阻塞当前飞书', prefix: { ...feishu, userOpenId: 'old-user' }, current: feishu },
  { name: 'D：100条飞书不能阻塞Console', prefix: feishu, current: consoleTarget },
  { name: 'Web：100条旧userId不能阻塞当前用户', prefix: { ...web, userId: 'old-web-user' }, current: web },
]) test(sample.name, async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 100; i++) f.task(sample.prefix);
    const excluded = f.snapshot(), current = f.task(sample.current, later);
    await f.worker(sample.current).tick();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0]?.notificationId, current.id); assert.deepEqual(f.sent[0]?.target, sample.current);
    assert.deepEqual(f.snapshot().filter(row => row.id !== current.id), excluded);
    assert.equal(f.store.getTask(current.taskId)?.status, 'succeeded'); assert.equal(f.store.listRuns(current.taskId).length, 1);
  } finally { await f.close(); }
});

test('C：100条Goal不能阻塞默认taskOnly的Task', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 100; i++) f.goal();
    const goals = f.snapshot(), current = f.task(consoleTarget, later);
    await f.worker(consoleTarget).tick();
    assert.equal(f.sent.length, 1); assert.equal(f.sent[0]?.notificationId, current.id);
    assert.deepEqual(f.snapshot().filter(row => row.id !== current.id), goals);
  } finally { await f.close(); }
});

test('owner/status/nextAt资格保持；非当前owner、未到期和终态通知不领取', async () => {
  const f = fixture();
  try {
    for (let i = 0; i < 100; i++) f.task(consoleTarget, epoch, 'other-owner');
    const future = f.task(consoleTarget), dead = f.task(consoleTarget), sent = f.task(consoleTarget);
    f.db.prepare('UPDATE goal_notifications SET nextAt=? WHERE id=?').run('2027-01-01T00:00:00.000Z', future.id);
    f.db.prepare("UPDATE goal_notifications SET status='dead' WHERE id=?").run(dead.id);
    f.db.prepare("UPDATE goal_notifications SET status='sent' WHERE id=?").run(sent.id);
    const excluded = f.snapshot(), current = f.task(consoleTarget, later);
    await f.worker(consoleTarget).tick(); assert.equal(f.sent[0]?.notificationId, current.id); assert.equal(f.sent.length, 1);
    assert.deepEqual(f.snapshot().filter(row => row.id !== current.id), excluded);
  } finally { await f.close(); }
});

test('飞书范围不绑定chatId：同一app/user的不同聊天地址仍可投递', async () => {
  const f = fixture();
  try {
    const a = f.task(feishu), b = f.task({ ...feishu, chatId: 'fixture-other-chat' }, later), worker = f.worker(feishu);
    await worker.tick(); await worker.tick(); assert.deepEqual(f.sent.map(m => m.notificationId), [a.id,b.id]);
    assert.deepEqual(f.sent.map(m => m.target?.channel === 'feishu' ? m.target.chatId : null), [feishu.chatId,'fixture-other-chat']);
  } finally { await f.close(); }
});

test('includeGoals显式开启后同范围Goal和Task均保留原顺序投递', async () => {
  const f = fixture();
  try {
    const a = f.goal(), b = f.task(consoleTarget, later), worker = f.worker(consoleTarget, true);
    await worker.tick(); await worker.tick(); assert.deepEqual(f.sent.map(m => m.notificationId), [a.id,b.id]);
    assert.ok(f.store.notifications.listForHost().every(row => row.status === 'sent'));
  } finally { await f.close(); }
});

test('E-order：过滤后仍按createdAt/id稳定排序', async () => {
  const f = fixture();
  try {
    const a = f.task(consoleTarget), b = f.task(consoleTarget), c = f.task(consoleTarget);
    f.db.prepare('UPDATE goal_notifications SET id=?,createdAt=? WHERE id=?').run('z-first', epoch, a.id);
    f.db.prepare('UPDATE goal_notifications SET id=?,createdAt=? WHERE id=?').run('b-tie', later, b.id);
    f.db.prepare('UPDATE goal_notifications SET id=?,createdAt=? WHERE id=?').run('a-tie', later, c.id);
    const worker = f.worker(consoleTarget); await worker.tick(); await worker.tick(); await worker.tick();
    assert.deepEqual(f.sent.map(m => m.notificationId), ['z-first','a-tie','b-tie']);
  } finally { await f.close(); }
});

function gate() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }

test('E-concurrent：两个SQLite连接的Worker同一有效租约只领取一次', async () => {
  const f = fixture(), started = gate(), release = gate(); let sending: Promise<void> | undefined, calls = 0;
  try {
    const current = f.task(consoleTarget), channel = { sendMessage: async () => { calls++; started.open(); await release.promise; } };
    const a = f.worker(consoleTarget, false, channel), b = f.worker(consoleTarget, false, channel, f.connection());
    sending = a.tick(); await started.promise; await b.tick(); assert.equal(calls, 1);
    assert.equal(f.store.notifications.listForHost().find(row => row.id === current.id)?.attempts, 1);
    release.open(); await sending; await b.tick(); assert.equal(calls, 1);
  } finally { release.open(); await sending; await f.close(); }
});

test('E-fencing：过期租约恢复后旧确认不覆盖新Sent；Task仍只有原Run', async () => {
  const f = fixture(), started = gate(), release = gate(); let sending: Promise<void> | undefined, calls = 0;
  try {
    const current = f.task(consoleTarget);
    const channel = { sendMessage: async () => { if (++calls === 1) { started.open(); await release.promise; } } };
    const a = f.worker(consoleTarget, false, channel), b = f.worker(consoleTarget, false, channel, f.connection());
    sending = a.tick(); await started.promise; f.time('2026-11-07T00:00:32.000Z'); await b.tick();
    const confirmed = f.snapshot(); assert.equal(f.store.notifications.listForHost()[0]?.status, 'sent');
    release.open(); await sending; assert.deepEqual(f.snapshot(), confirmed);
    assert.equal(calls, 2); assert.equal(f.store.notifications.listForHost()[0]?.uncertain, 1);
    assert.equal(f.store.events(current.runId).filter(e => e.type === 'delivery_succeeded').length, 1);
    assert.equal(f.store.listRuns(current.taskId).length, 1);
  } finally { release.open(); await sending; await f.close(); }
});

test('E-scope：查询和过期租约回收不修改其他身份/渠道/Goal的通知', async () => {
  const f = fixture();
  try {
    const foreign = f.task(feishu), otherOwner = f.task(consoleTarget, epoch, 'other-owner'), goal = f.goal();
    for (const id of [foreign.id,otherOwner.id,goal.id]) f.db.prepare("UPDATE goal_notifications SET status='sending',attempts=1,leaseToken='old-token',leaseUntil=? WHERE id=?").run(epoch,id);
    const excluded = f.snapshot(), current = f.task(consoleTarget, later);
    await f.worker(consoleTarget).tick(); assert.equal(f.sent[0]?.notificationId, current.id);
    assert.deepEqual(f.snapshot().filter(row => row.id !== current.id), excluded);
  } finally { await f.close(); }
});
