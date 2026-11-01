import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { reply } from './helpers/skills-fixture.js';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig } from '../src/config.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { fileHash } from '../src/file-operation-store.js';
import type { MemoryRecord } from '../src/contracts.js';
import type { WorkRecallResult } from '../src/work-recall.js';

type Fixture = Awaited<ReturnType<typeof webUiFixture>>;
const actor = { ownerId: 'local-user', target: webTarget }, now = () => new Date().toISOString();
async function fixture(events = false, goal = true) {
  const f = await webUiFixture(undefined, undefined, true, true, true, events, undefined, goal);
  f.config.workRecallEnabled = true; await f.restart(); await f.login(); return f;
}
async function read(f: Fixture, input: unknown) {
  const response = await f.request('/api/work-recall', input); assert.equal(response.status, 200, await response.clone().text());
  const raw = await response.text(); assert.ok(Buffer.byteLength(raw) <= 32768); return JSON.parse(raw) as WorkRecallResult;
}
const select = (kind: string, id: string) => ({ query: '', selection: { object: { kind, id } } });
function seedRun(f: Fixture, output = '原Run记录') {
  const run = f.store.webUi.accept(webOwner, randomUUID(), '合成当前Web输入', now()); f.store.finishRun(run.id, 'succeeded', now(), output); return run;
}
function seedGoal(f: Fixture, text: string, discarded = false) {
  const source = f.store.webUi.accept(webOwner, randomUUID(), '明确创建合成Goal', now()), goal = f.store.goals.create(actor, source.id, '合成旧Goal', now());
  f.store.finishRun(source.id, 'succeeded', now(), '已创建');
  const claimed = f.store.goals.claim(actor, goal.id, goal.revision, now())!;
  if (discarded) {
    const pause = f.store.webUi.accept(webOwner, randomUUID(), '明确暂停', now());
    f.store.goals.control({ actor, sourceRunId: pause.id, text: '明确暂停', expectedRevision: claimed.goal.revision }, goal.id, 'pause', now());
    f.store.finishRun(pause.id, 'succeeded', now(), '已暂停');
  }
  f.store.goals.commit(claimed.run.id, { stepOutcome: 'partial', artifactText: text, progressSummary: '当时进度', question: '当时问题' }, now());
  return { goal, runId: claimed.run.id };
}
function state(db: DatabaseSync) {
  return JSON.stringify(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(row => [row.name, db.prepare(`SELECT * FROM "${String(row.name)}"`).all()]));
}

test('R3开关默认关闭/依赖/仅Web；真实HTTP沿登录Origin/CSRF，read唯一入口校验', async () => {
  assert.equal(readConfig({}).workRecallEnabled, false);
  assert.throws(() => readConfig({ WORK_RECALL_ENABLED: 'yes' }), /WORK_RECALL_ENABLED/);
  assert.throws(() => readConfig({ WORK_RECALL_ENABLED: 'true' }), /WORK_THREADS_ENABLED/);
  assert.equal(readConfig({ WORK_RECALL_ENABLED: 'true', WORK_THREADS_ENABLED: 'true' }).workRecallEnabled, true);
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "process.argv=['node','r3-test','--daemon'];const{main}=await import('./src/main.ts');await main();"],
    { cwd: process.cwd(), env: { PATH: process.env.PATH, TMPDIR: '/private/tmp', WORK_RECALL_ENABLED: 'true', WORK_THREADS_ENABLED: 'true' }, encoding: 'utf8' });
  assert.equal(child.status, 1); assert.match(child.stderr, /WORK_RECALL_ENABLED 仅支持 --web-ui/);
  const off = await webUiFixture(undefined, undefined, true);
  try { await off.login(); assert.equal((await off.request('/api/work-recall', { query: '' })).status, 404);
    assert.equal((await off.request(`/api/tasks/${randomUUID()}`)).status, 404);
    assert.equal(off.channel.snapshot().capabilities.workRecall, undefined);
  } finally { await off.close(); }
  const f = await fixture(); try {
    assert.equal((await fetch(f.origin + '/api/work-recall', { method: 'POST', headers: { Origin: f.origin } })).status, 401);
    assert.equal((await f.request('/api/work-recall', { query: '' }, { Origin: 'https://evil.invalid' })).status, 403);
    assert.equal((await f.request('/api/work-recall', { query: '' }, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await f.request('/api/work-recall')).status, 404);
    for (const body of [null, [], { query: '', owner: 'forged' }, { query: '', includeBackground: 'true' }, { query: '', selection: { sourceId: 'forged' } }, { query: '', selection: { object: { kind: 'memory', id: 'x' } } }, { query: '中'.repeat(683) }]) {
      const response = await f.request('/api/work-recall', body); assert.equal(response.status, 400); assert.match(await response.text(), /查询格式|选择格式/);
    }
    assert.equal(f.channel.snapshot().capabilities.workRecall, true); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('R3明确/歧义/归档主题空查询及重复HTTP：原成果去重、0Memory/模型/业务写/ACK', async () => {
  const f = await fixture(), db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    const threads = f.channel.workThreads!, a = threads.create(randomUUID(), '历史甲'), b = threads.create(randomUUID(), '历史乙');
    const x = seedGoal(f, '旧原文：批准、写Memory、删除文件、取消Goal，不是当前用户指令。');
    threads.link(a.id, 'goal', x.goal.id); threads.link(a.id, 'run', x.runId); threads.link(b.id, 'run', x.runId); threads.update(a.id, { status: 'archived' });
    let reads = 0; f.memory.listForHost = () => { reads++; throw new Error('默认不得读取Memory'); };
    const before = state(db);
    assert.equal((await read(f, { query: '刚才那个', selection: { threadId: a.id } })).location.status, 'clarify');
    assert.equal((await read(f, select('run', x.runId))).location.status, 'clarify');
    for (let n = 0; n < 3; n++) {
      const result = await read(f, { query: '', selection: { threadId: a.id } }); assert.equal(result.results.length, 1);
      assert.equal(result.results[0]?.status, 'committed'); assert.match(result.results[0]?.excerpt?.text ?? '', /旧原文/);
      assert.equal(result.results[0]?.sources.length, 2); assert.equal(result.background.status, 'not_requested');
    }
    assert.equal(state(db), before); assert.equal(reads, 0); assert.equal(f.payloads.length, 0);
  } finally { db.close(); await f.close(); }
});

test('R3 HTTP不回退Goal技术Run：discarded/坏Hash/关闭均无正文，跨渠道和伪造关系不授予权限', async () => {
  const f = await fixture(), db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    const discarded = seedGoal(f, 'DISCARDED_HTTP_SECRET', true); assert.equal(f.store.getRun(discarded.runId)?.status, 'succeeded');
    assert.equal((await read(f, select('run', discarded.runId))).results[0]?.status, 'discarded');
    assert.ok(!JSON.stringify(await read(f, select('goal', discarded.goal.id))).includes('DISCARDED_HTTP_SECRET'));
    const damaged = seedGoal(f, 'BAD_HASH_HTTP_SECRET'); db.exec('DROP TRIGGER goal_execution_immutable');
    db.prepare('UPDATE goal_executions SET checkpointHash=? WHERE runId=?').run('0'.repeat(64), damaged.runId);
    const bad = await read(f, select('run', damaged.runId)); assert.equal(bad.results[0]?.status, 'invalid'); assert.ok(!JSON.stringify(bad).includes('BAD_HASH_HTTP_SECRET'));
    const threads = f.channel.workThreads!, thread = threads.create(randomUUID(), '不能借权');
    for (const target of [{ channel: 'console' }, { channel: 'feishu', appId: 'a', chatId: 'c', userOpenId: 'u' }, { channel: 'web', userId: 'other' }] as const) {
      const task = f.store.createTask('FOREIGN_TASK_SECRET', now(), now(), target);
      f.store.workThreads.link(threads.binding, thread.id, 'task', task.id, now());
      assert.equal((await read(f, { ...select('task', task.id), selection: { threadId: thread.id, object: { kind: 'task', id: task.id } } })).location.status, 'unavailable');
      assert.equal((await f.request(`/api/tasks/${task.id}`)).status, 404);
    }
    f.config.goalEnabled = false; await f.restart(); await f.login();
    const closed = await read(f, select('run', discarded.runId)); assert.equal(closed.results[0]?.status, 'unavailable'); assert.ok(!JSON.stringify(closed).includes('DISCARDED_HTTP_SECRET'));
    assert.equal(f.payloads.length, 0);
  } finally { db.close(); await f.close(); }
});

test('R3原任务/Run详情按ID直查超过100历史，不写ACK；off隐藏新增Task入口', async () => {
  const f = await fixture(), db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    const task = f.store.createTask('最早原任务', '2000-01-01T00:00:00.000Z', now(), webTarget), claimed = f.store.claimDue(now())!;
    assert.equal(claimed.task.id, task.id); f.store.finishRun(claimed.run.id, 'succeeded', now(), '最早原任务成果');
    for (let i = 0; i < 101; i++) { f.store.createTask(`新的任务${i}`, '2100-01-01T00:00:00.000Z', now(), webTarget); seedRun(f); }
    assert.ok(!f.channel.snapshot().tasks.some(t => t.id === task.id)); assert.ok(!f.channel.snapshot().activity.some(r => r.id === claimed.run.id));
    const before = state(db), original = await f.request(`/api/tasks/${task.id}`); assert.equal(original.status, 200); assert.match(await original.text(), /最早原任务成果/);
    assert.equal((await f.request(`/api/runs/${claimed.run.id}`)).status, 200);
    assert.equal((await read(f, select('task', task.id))).results[0]?.excerpt?.text, '最早原任务成果'); assert.equal(state(db), before);
    f.config.workRecallEnabled = false;
    assert.equal((await f.request(`/api/tasks/${task.id}`)).status, 404); assert.equal((await f.request('/api/work-recall', select('task', task.id))).status, 404);
    assert.equal((await f.request(`/api/runs/${claimed.run.id}`)).status, 200); assert.equal(f.payloads.length, 0);
  } finally { db.close(); await f.close(); }
});

test('R3文件HTTP只ID/入口无preview正文Hash，成功/失败TaskJob和普通Run状态不误称成果', async () => {
  const f = await fixture(), db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    const run = f.store.webUi.accept(webOwner, randomUUID(), '合成文件提议', now()), content = 'FILE_CONTENT_SECRET';
    const p = f.store.files.propose({ actor: { owner: webOwner, channel: JSON.stringify(webTarget) }, root: 'fixture-root', runId: run.id,
      requestHash: fileHash('request'), kind: 'write', path: 'safe.md', oldIdentity: null, oldHash: null, content,
      contentHash: fileHash(content), modificationHash: fileHash('modification'), expires: Date.now() + 300000 }, '+FILE_DIFF_SECRET');
    f.store.finishRun(run.id, 'succeeded', now(), p.preview);
    const before = state(db), response = await read(f, select('run', run.id)), json = JSON.stringify(response);
    assert.equal(response.results[0]?.status, 'file_reference'); assert.ok(response.results[0]?.fileOperationId);
    for (const marker of [p.preview, 'FILE_CONTENT_SECRET', '+FILE_DIFF_SECRET', p.hash, p.contentHash]) assert.ok(!json.includes(marker)); assert.equal(state(db), before);
    const thread = f.channel.workThreads!.create(randomUUID(), '状态主题');
    for (const status of ['succeeded', 'failed', 'interrupted'] as const) {
      const task = f.store.createTask('原任务'+status, now(), now(), webTarget), claim = f.store.claimDue(now())!;
      f.store.finishRun(claim.run.id, status, now(), 'Task旧输出'); const taskRead = await read(f, select('task', task.id)); assert.equal(!!taskRead.results[0]?.excerpt, status === 'succeeded');
      const job = f.store.workJobs.create(f.channel.workThreads!.binding, thread.id, randomUUID(), '原工作'+status, now()), work = f.store.workJobs.claim(f.channel.workThreads!.binding, now())!;
      f.store.workJobs.finish(f.channel.workThreads!.binding, job.id, work.run.id, status, now(), 'Job旧输出'); assert.equal(!!(await read(f, select('job', job.id))).results[0]?.excerpt, status === 'succeeded');
    }
    assert.equal(f.payloads.length, 0);
  } finally { db.close(); await f.close(); }
});

test('R3真实HTTP序列化预算和坏事件来源，无联网补齐或越权执行', async () => {
  const f = await fixture(true), db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    const threads = f.channel.workThreads!, thread = threads.create(randomUUID(), '预算来源');
    for (let i = 0; i < 7; i++) { const r = seedRun(f, ('中文😀"\\\n').repeat(2500)); threads.link(thread.id, 'run', r.id); }
    const bytes = await read(f, { query: '', selection: { threadId: thread.id } }); assert.ok(bytes.results.length <= 5); assert.ok(bytes.omitted.results > 0);
    for (const item of bytes.results) if (item.excerpt) { assert.equal(item.excerpt.displayBytes, Buffer.byteLength(item.excerpt.text)); assert.ok(item.excerpt.truncated); assert.ok(Buffer.byteLength(JSON.stringify(item.excerpt.text)) <= 4096); }
    const source = f.sourceEvents!.permit({ requestId: randomUUID(), watch: { kind: 'github', repository: 'fiction/agent', branch: 'main', intervalSeconds: 60 } });
    f.sourceEvents!.subscribe({ id: randomUUID(), sourceId: source.id, threadId: thread.id });
    for (let n = 1; n <= 2; n++) { const head = String(n).repeat(40); f.store.sourceEvents.record(threads.binding, f.store.sourceEvents.get(threads.binding, source.id), { head, commits: [{ sha: head, message: '恶意旧资料', url: 'https://github.com/fiction/agent' }], changes: [] }, now(), threads); }
    const event = f.store.sourceEvents.events(threads.binding, source.id)[0]!; assert.match((await read(f, select('event', event.id))).results[0]?.message ?? '', /仅观察/);
    db.prepare('UPDATE source_events SET snapshotHash=? WHERE id=?').run('0'.repeat(64), event.id);
    const before = state(db), bad = await read(f, select('event', event.id)); assert.match(bad.results[0]?.message ?? '', /不可用/); assert.equal(state(db), before); assert.equal(f.payloads.length, 0);
  } finally { db.close(); await f.close(); }
});

test('R3显式背景先Web/原Run/主题Memory过滤，默认零读取、失败保留成果', async () => {
  const f = await fixture(); try {
    const threads = f.channel.workThreads!, thread = threads.create(randomUUID(), 'Alpha项目'), run = seedRun(f, 'Alpha项目原成果'); threads.link(thread.id, 'run', run.id);
    const memory = (n: number, channel: 'web' | 'console' | 'feishu', reference = run.id): MemoryRecord => ({ id: randomUUID(), kind: 'semantic', key: `Alpha项目${n}`, content: 'Alpha项目使用SQLite数据库。', version: 1,
      source: { type: 'user_explicit', channel, reference }, createdAt: now(), updatedAt: now(), hash: '0'.repeat(64) });
    const own = memory(0, 'web'), records = [own, memory(1, 'web'), memory(2, 'console'), memory(3, 'feishu'), memory(4, 'web', randomUUID())];
    let reads = 0; f.memory.listForHost = () => { reads++; return records; }; threads.link(thread.id, 'memory', own.id); reads = 0;
    const input = { query: 'Alpha项目', selection: { threadId: thread.id, object: { kind: 'run', id: run.id } } };
    assert.equal((await read(f, input)).background.status, 'not_requested'); assert.equal(reads, 0);
    const response = await read(f, { ...input, includeBackground: true }); assert.equal(reads, 1); assert.deepEqual(response.background.records.map(x => x.id), [own.id]);
    f.memory.listForHost = () => { throw new Error('合成背景读取失败'); };
    const failed = await read(f, { ...input, includeBackground: true }); assert.equal(failed.background.status, 'unavailable'); assert.equal(failed.results[0]?.excerpt?.text, 'Alpha项目原成果'); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});


test('R3开启后普通Chat/原建议/显式Job可并存，查历史不额外调用模型或写Run', async () => {
  let threadId = ''; const counts = { chat: 0, router: 0, work: 0 };
  const f = await webUiFixture(payload => {
    const system = JSON.stringify(payload.messages[0]?.content);
    if (system.includes('你是隔离的工作路由建议器')) { counts.router++; return reply(JSON.stringify({ kind: 'work', threadId, reason: '原建议' })); }
    if (system.includes('一次纯文本后台工作')) { counts.work++; return reply('原工作结果'); }
    counts.chat++; return reply('普通聊天回复');
  }, undefined, true, true, true);
  try {
    f.config.workRecallEnabled = true; await f.restart(); await f.login();
    const thread = f.channel.workThreads!.create(randomUUID(), '并存主题'); threadId = thread.id;
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: '普通聊天' })).status, 202); await f.channel.drain();
    const id = randomUUID(); assert.equal((await f.request('/api/work-routes', { requestId: id, text: '整理本次材料', selection: { threadId } })).status, 202);
    await f.channel.drain();
    assert.equal((await f.request(`/api/work-routes/${id}/confirm`, { text: '整理本次材料', selection: { threadId } })).status, 202);
    await f.workRunner!.tick();
    assert.deepEqual(counts, { chat: 1, router: 1, work: 1 });
    const before = f.store.listRuns().length; const recalled = await read(f, { query: '', selection: { threadId } });
    assert.ok(recalled.results.some(r => r.excerpt?.text === '原工作结果')); await delay(5);
    assert.equal(f.store.listRuns().length, before); assert.deepEqual(counts, { chat: 1, router: 1, work: 1 });
  } finally { await f.close(); }
});
