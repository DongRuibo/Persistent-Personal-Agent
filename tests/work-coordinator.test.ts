import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebUiChannel, webOwner, webTarget } from '../src/web-ui-channel.js';
import { WebUiServer } from '../src/web-ui-server.js';
import { TaskService } from '../src/task-service.js';
import { BackgroundLane } from '../src/background-lane.js';
import type { AgentExecutor } from '../src/contracts.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';
import { readConfig } from '../src/config.js';

const now = '2026-11-02T00:00:00.000Z';
test('协调接收先queued且不建Run，领取后才建Run', () => {
  const store = new SqliteStore(':memory:');
  try {
    const row = store.webUi.enqueue('owner', 'request', '原始文字', now);
    assert.equal(row.status, 'queued'); assert.equal(row.runId, null);
    assert.equal(store.listRuns().length, 0);
    const claimed = store.webUi.claim('owner', now)!;
    assert.equal(claimed.requestId, 'request'); assert.equal(claimed.status, 'claimed');
    assert.equal(store.listRuns().length, 1); assert.equal(store.webUi.claim('owner', now), undefined);
  } finally { store.close(); }
});
test('协调开关默认关闭，严格依赖Threads/Jobs/Recall而不依赖Routing', () => {
  assert.equal(readConfig({}).workCoordinatorEnabled, false);
  assert.throws(() => readConfig({ WORK_COORDINATOR_ENABLED: '1' }), /WORK_COORDINATOR_ENABLED/);
  assert.throws(() => readConfig({ WORK_COORDINATOR_ENABLED: 'true' }), /WORK_THREADS_ENABLED/);
  assert.equal(readConfig({ WORK_COORDINATOR_ENABLED: 'true', WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true' }).workCoordinatorEnabled, true);
});

test('八条等待、幂等先于容量、冲突拒绝；撤回退款且不能撤回claimed，按owner隔离', () => {
  const store = new SqliteStore(':memory:');
  try {
    const rows = Array.from({ length: 8 }, (_, i) => store.webUi.enqueue('a', `r${i}`, `文字${i}`, now));
    assert.deepEqual(store.webUi.enqueue('a', 'r0', '文字0', now), rows[0]);
    assert.throws(() => store.webUi.enqueue('a', 'r0', '改文', now), /其他内容/);
    assert.throws(() => store.webUi.enqueue('a', 'ninth', '未接收', now), /八条/);
    assert.equal(store.webUi.find('a', 'ninth'), undefined);
    assert.equal(store.webUi.enqueue('b', 'r0', '另一用户', now).status, 'queued');
    assert.throws(() => store.webUi.cancelQueued('foreign', 'r0'), /不存在/);
    assert.equal(store.webUi.cancelQueued('a', 'r0').status, 'cancelled');
    assert.equal(store.webUi.cancelQueued('a', 'r0').status, 'cancelled');
    assert.equal(store.webUi.enqueue('a', 'r0', '文字0', now).status, 'cancelled');
    store.webUi.enqueue('a', 'ninth', '现在收到', now);
    const claimed = store.webUi.claim('a', now)!; assert.equal(claimed.requestId, 'r1');
    assert.throws(() => store.webUi.cancelQueued('a', 'r1'), /已领取/);
    assert.equal(store.webUi.enqueue('a', 'r1', '文字1', now).runId, claimed.runId);
    assert.equal(store.listRuns().length, 1);
  } finally { store.close(); }
});

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'coordinator-store-')), path = join(root, 'app.db');
  const store = new SqliteStore(path), db = new DatabaseSync(path);
  return { root, path, store, db, close() { db.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('领取写入故障时请求与新Run一起回滚，恢复后仅领取一次', () => {
  const f = fixture(); try {
    f.store.webUi.enqueue(actor.owner, 'r1', '原文', now);
    f.db.exec("CREATE TRIGGER fail_claim BEFORE UPDATE ON web_ui_chats BEGIN SELECT RAISE(ABORT,'injected claim failure'); END");
    assert.throws(() => f.store.webUi.claim(actor.owner, now), /injected/);
    assert.equal(f.store.webUi.find(actor.owner, 'r1')?.status, 'queued');
    assert.equal(f.store.webUi.find(actor.owner, 'r1')?.runId, null); assert.equal(f.store.listRuns().length, 0);
    f.db.exec('DROP TRIGGER fail_claim');
    assert.ok(f.store.webUi.claim(actor.owner, now)?.runId); assert.equal(f.store.webUi.claim(actor.owner, now), undefined);
    assert.equal(f.store.listRuns().length, 1); assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('临时旧库迁移：chat/suggest/policy原行、Run、旧Job及输入不变，旧根按自身ID解释', t => {
  const root = mkdtempSync(join(tmpdir(), 'coordinator-migration-')), path = join(root, 'old.db');
  let store = new SqliteStore(path);
  const thread = store.workThreads.create(actor, randomUUID(), '旧主题', now);
  for (const mode of ['chat', 'suggest', 'policy'] as const) {
    const run = store.webUi.accept(actor.owner, mode, `旧正文-${mode}\n中文`, now, mode, mode === 'chat' ? '{}' : '{"source":"原选择"}');
    if (mode !== 'chat') store.finishRun(run.id, 'succeeded', now, `旧输出-${mode}`);
  }
  const oldJob = store.workJobs.create(actor, thread.id, 'old-job', '旧Job原始输入', now);
  store.close();
  const db = new DatabaseSync(path);
  try {
    // 只在临时库还原本任务起点的两张表，其他业务表与数据保留。
    db.exec(`PRAGMA foreign_keys=OFF;
      DROP TABLE web_request_items;
      CREATE TABLE web_ui_chats_old(owner TEXT NOT NULL,requestId TEXT NOT NULL,runId TEXT NOT NULL UNIQUE REFERENCES runs(id),text TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'chat',selectionJson TEXT NOT NULL DEFAULT '{}',PRIMARY KEY(owner,requestId)) STRICT;
      INSERT INTO web_ui_chats_old SELECT owner,requestId,runId,text,mode,selectionJson FROM web_ui_chats;
      DROP TABLE web_ui_chats; ALTER TABLE web_ui_chats_old RENAME TO web_ui_chats;
      CREATE TABLE work_jobs_old(id TEXT PRIMARY KEY,owner TEXT NOT NULL,channel TEXT NOT NULL,threadId TEXT NOT NULL REFERENCES work_threads(id),requestId TEXT NOT NULL,instruction TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','interrupted','cancelled')),runId TEXT UNIQUE REFERENCES runs(id),createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,UNIQUE(owner,channel,requestId)) STRICT;
      INSERT INTO work_jobs_old SELECT id,owner,channel,threadId,requestId,instruction,status,runId,createdAt,updatedAt FROM work_jobs;
      DROP TABLE work_jobs; ALTER TABLE work_jobs_old RENAME TO work_jobs;`);
    const before = { chats: db.prepare('SELECT * FROM web_ui_chats ORDER BY requestId').all(), runs: db.prepare('SELECT * FROM runs ORDER BY id').all(), jobs: db.prepare('SELECT * FROM work_jobs ORDER BY id').all() };
    assert.equal(db.prepare('PRAGMA table_info(web_ui_chats)').all().find(c => c.name === 'runId')?.notnull, 1);
    store = new SqliteStore(path);
    const after = { chats: db.prepare('SELECT owner,requestId,runId,text,mode,selectionJson FROM web_ui_chats ORDER BY requestId').all(), runs: db.prepare('SELECT * FROM runs ORDER BY id').all(), jobs: db.prepare('SELECT id,owner,channel,threadId,requestId,instruction,status,runId,createdAt,updatedAt FROM work_jobs ORDER BY id').all() };
    assert.deepEqual(after, before);
    assert.equal(db.prepare('PRAGMA table_info(web_ui_chats)').all().find(c => c.name === 'runId')?.notnull, 0);
    for (const row of store.webUi.chats(actor.owner)) { assert.equal(row.status, 'claimed'); assert.equal(row.createdAt, now); assert.equal(row.coordinator, 0); }
    const job = store.workJobs.get(actor, oldJob.id); assert.equal(job.rootJobId, oldJob.id); assert.equal(job.previousJobId, null); assert.equal(job.inputReferences, null);
    assert.equal(store.recoverInterrupted(now), 1); assert.equal(store.webUi.find(actor.owner, 'chat')?.status, 'claimed');
    assert.equal(store.webUi.claim(actor.owner, now), undefined);
    const queued = store.webUi.enqueue(actor.owner, 'new', '新消息', now); assert.equal(queued.runId, null);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    t.diagnostic(JSON.stringify({ migrationBefore: before, migrationAfter: after, nullableRunId: true, legacyJobRoot: job.rootJobId }));
    store.close(); store = new SqliteStore(path); assert.equal(store.webUi.find(actor.owner, 'new')?.status, 'queued');
  } finally { store.close(); db.close(); rmSync(root, { recursive: true, force: true }); }
});

test('子项/补充收据与Job根、前序、冻结引用可持久回读，旧显式Job不改变执行输入', () => {
  const f = fixture(); try {
    f.store.webUi.enqueue(actor.owner, 'parent', '先整理文字；再重点讲调度', now);
    const thread = f.store.workThreads.create(actor, randomUUID(), '合成主题', now);
    const root = f.store.workJobs.create(actor, thread.id, 'explicit', '原始文字', now);
    assert.equal(root.rootJobId, root.id); assert.equal(root.sourceItemId, null); assert.equal(root.inputHash, null);
    const itemId = randomUUID(), ranges = [{ start: 6, end: 13, role: 'instruction' }];
    f.db.prepare(`INSERT INTO web_request_items(itemId,owner,channel,requestId,ordinal,rangesJson,decision,permission,targetKind,targetId,baseJobId,permissionItemId,consumedByJobId,receipt,createdAt)
      VALUES(?,?,?,'parent',0,?,'feedback','available','job',?,?,NULL,NULL,'已收到，待采纳',?)`)
      .run(itemId, actor.owner, actor.channel, JSON.stringify(ranges), root.id, root.id, now);
    const refs = [{ kind: 'request', requestId: 'parent', itemId, hash: 'original-hash' }, { kind: 'job_result', jobId: root.id, runId: 'reference-only', hash: 'artifact-hash' }];
    // 本例只验证T1关系列，后继许可消费和组装输入在T3实现。
    const next = f.store.workJobs.create(actor, thread.id, itemId, '冻结后的示例输入', now);
    f.db.prepare('UPDATE work_jobs SET rootJobId=?,previousJobId=?,sourceItemId=?,inputReferencesJson=?,inputHash=? WHERE id=?')
      .run(root.id, root.id, itemId, JSON.stringify(refs), 'frozen-input-hash', next.id);
    f.db.prepare("UPDATE web_request_items SET permission='consumed',consumedByJobId=? WHERE itemId=?").run(next.id, itemId);
    const item = f.store.workCoordinator.items(actor, 'parent')[0]!;
    assert.deepEqual(item.ranges, ranges); assert.equal(item.permission, 'consumed'); assert.equal(item.consumedByJobId, next.id);
    assert.deepEqual(f.store.workCoordinator.items({ ...actor, owner: 'other' }, 'parent'), []);
    assert.deepEqual(f.store.workCoordinator.items({ ...actor, channel: 'console' }, 'parent'), []);
    const reread = f.store.workJobs.get(actor, next.id);
    assert.equal(reread.rootJobId, root.id); assert.equal(reread.previousJobId, root.id); assert.equal(reread.sourceItemId, itemId); assert.deepEqual(reread.inputReferences, refs);
    assert.equal(f.store.workJobs.get(actor, root.id).instruction, '原始文字'); assert.equal(f.store.listRuns().length, 0);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { f.close(); }
});

test('HTTP新模式连续接收八条等待/撤回/串行领取/满额幂等；单轮结束释放前台门', async () => {
  const f = fixture(), lane = new BackgroundLane(), seen: string[] = [], errors: unknown[] = [];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const executor: AgentExecutor = { async execute(request) { seen.push(request.prompt); if (seen.length === 1) await hold; return { text: `回复-${request.prompt}` }; }, async close() {} };
  const config = readConfig({ LLM_API_KEY: 'fake-coordinator', WORK_COORDINATOR_ENABLED: 'true', WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true' });
  const channel = new WebUiChannel(f.store, new TaskService(f.store, 'Asia/Shanghai'), executor, config, undefined, lane, e => errors.push(e), { listForHost: () => [] });
  const server = new WebUiServer(channel, 'fake-coordinator-web-key-at-least-32bytes', f.root), origin = await server.start(0);
  let cookie = '', csrf = '';
  const request = (path: string, body?: unknown) => fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const login = await request('/login', { key: 'fake-coordinator-web-key-at-least-32bytes' }); cookie = login.headers.get('set-cookie')!.split(';')[0]!; csrf = (await login.json() as { csrf: string }).csrf;
    const firstId = randomUUID(), first = await request('/chat', { requestId: firstId, text: '首条' }); assert.equal(first.status, 202);
    const firstReceipt = await first.json() as WebRequestReceipt; assert.equal(firstReceipt.status, 'queued'); assert.equal(firstReceipt.runId, null);
    assert.equal((await (await request(`/chat-requests/${firstId}`)).json() as WebRequestReceipt).status, 'claimed');
    const pending = Array.from({ length: 8 }, (_, i) => ({ requestId: randomUUID(), text: `待处理${i}` }));
    for (const body of pending) { const r = await request('/chat', body); assert.equal(r.status, 202); assert.equal((await r.json() as WebRequestReceipt).run, null); }
    assert.equal(f.store.listRuns().length, 1); assert.equal((await request('/chat', pending[0])).status, 202);
    assert.equal((await request('/chat', { ...pending[0], text: '冲突' })).status, 409);
    const unreceived = randomUUID(); assert.equal((await request('/chat', { requestId: unreceived, text: '满额' })).status, 429); assert.equal(f.store.webUi.find(webOwner, unreceived), undefined);
    assert.equal((await request(`/chat-requests/${firstId}/cancel`, {})).status, 409);
    const cancelled = await request(`/chat-requests/${pending[1]!.requestId}/cancel`, {}); assert.equal(cancelled.status, 200); assert.equal((await cancelled.json() as WebRequestReceipt).status, 'cancelled');
    assert.equal(channel.snapshot().requests?.length, 9); assert.equal(channel.snapshot().chats.length, 1);
    assert.equal(lane.acquire(true), undefined); release(); await channel.drain();
    assert.deepEqual(seen, ['首条', ...pending.filter((_, i) => i !== 1).map(p => p.text)]);
    assert.equal(f.store.listRuns().length, 8); assert.equal(channel.snapshot().capabilities.workRouting, undefined);
    const free = lane.acquire(true); assert.ok(free); free(); assert.deepEqual(errors, []);
    for (const receipt of channel.snapshot().requests ?? []) if (receipt.run) assert.equal(receipt.run.status, 'succeeded');
  } finally { release(); await server.stop(); f.close(); }
});
