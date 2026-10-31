import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { readConfig } from '../src/config.js';
import type { ExecutionRequest, MessageTarget } from '../src/contracts.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { WorkThreadService } from '../src/work-thread-service.js';
import type { WorkObject, WorkObjectKind, WorkThread, WorkThreadDetail } from '../src/work-thread-types.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { fileHash } from '../src/file-operation-store.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';

type Fixture = Awaited<ReturnType<typeof webUiFixture>>;
const now = '2026-11-01T00:00:00.000Z', binding = { owner: webOwner, channel: JSON.stringify(webTarget) };
async function json<T>(f: Fixture, path: string, body?: unknown): Promise<T> {
  const res = await f.request(path, body); assert.equal(res.status, 200, await res.clone().text()); return res.json() as Promise<T>;
}
function request(prompt: string, reference: string, channel: 'web' | 'console' | 'feishu' = 'web'): ExecutionRequest {
  return { prompt, source: { channel, reference }, scope: 'chat', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } };
}
function seed(f: Fixture) {
  const task = f.store.createTask('临时工作任务', '2100-01-01T00:00:00.000Z', now, webTarget);
  const run = f.store.webUi.accept(webOwner, randomUUID(), '临时工作对话', now);
  const goal = f.store.goals.create({ ownerId: 'local-user', target: webTarget }, run.id, '临时工作目标', now);
  const memory = f.memory.withRequest(request('记住：临时项目使用 SQLite。', run.id), () => f.memory.remember({
    kind: 'project', key: 'workthread.database', content: '临时项目使用 SQLite。',
  }));
  f.store.finishRun(run.id, 'succeeded', now, '不应复制到关联表的执行正文');
  return { task, run: f.store.getRun(run.id)!, goal, memory };
}

test('工作主题默认关闭；开关只接受显式布尔字符串', () => {
  const env = { LLM_API_KEY: 'fake-workthread-test', LLM_MODEL: 'local-stub', DATABASE_PATH: '/tmp/not-opened-workthread.db' };
  assert.equal(readConfig(env).workThreadsEnabled, false);
  assert.equal(readConfig({ ...env, WORK_THREADS_ENABLED: 'true' }).workThreadsEnabled, true);
  assert.throws(() => readConfig({ ...env, WORK_THREADS_ENABLED: '1' }), /WORK_THREADS_ENABLED/);
});

test('旧SQLite增量迁移不改原Task/Run；主题与关联关闭重开后保留', () => {
  const root = mkdtempSync(join(tmpdir(), 'workthread-migration-')), path = join(root, 'old.db');
  const old = new DatabaseSync(path), taskId = randomUUID(), runId = randomUUID();
  // 迁移前的任务/执行表没有 WorkThread，模拟已经存在且完成的业务数据。
  old.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,instruction TEXT NOT NULL,dueAt TEXT NOT NULL,status TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL,target TEXT NOT NULL) STRICT;
    CREATE TABLE runs(id TEXT PRIMARY KEY,taskId TEXT UNIQUE REFERENCES tasks(id),status TEXT NOT NULL,startedAt TEXT NOT NULL,finishedAt TEXT,output TEXT,error TEXT,deliveryError TEXT) STRICT;`);
  old.prepare('INSERT INTO tasks VALUES(?,?,?,?,?,?,?)').run(taskId, '旧任务正文', now, 'succeeded', now, now, JSON.stringify(webTarget));
  old.prepare('INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)').run(runId, taskId, 'succeeded', now, now, '旧执行结果', null, null);
  const before = [old.prepare('SELECT * FROM tasks').all(), old.prepare('SELECT * FROM runs').all()]; old.close();
  let store = new SqliteStore(path);
  try {
    const service = new WorkThreadService(store, { listForHost: () => [] }, { owner: webOwner, target: webTarget }, false);
    const theme = service.create(randomUUID(), '旧任务整理'); service.link(theme.id, 'task', taskId); service.link(theme.id, 'run', runId);
    store.close(); store = new SqliteStore(path);
    const again = new WorkThreadService(store, { listForHost: () => [] }, { owner: webOwner, target: webTarget }, false);
    assert.deepEqual(again.detail(theme.id).links.map(link => link.objectId).sort(), [taskId, runId].sort());
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      assert.deepEqual([check.prepare('SELECT * FROM tasks').all(), check.prepare('SELECT * FROM runs').all()], before);
      assert.deepEqual(check.prepare('PRAGMA table_info(work_links)').all().map(c => c.name), ['threadId', 'kind', 'objectId', 'source', 'createdAt']);
      assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { check.close(); }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('Web主题创建去重；四类对象关联去重、重启保留；业务数据和Session不变', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const objects = seed(f), memories = f.memory.listForHost();
    const sessionFiles = readdirSync(f.config.sessionDir, { recursive: true, withFileTypes: true }).filter(x => x.isFile())
      .map(x => ({ path: join(x.parentPath, x.name), content: readFileSync(join(x.parentPath, x.name)) }));
    await f.login(); const id = randomUUID();
    const first = await json<WorkThread>(f, '/api/work-threads', { id, title: '  第一阶段  ' });
    assert.equal(first.title, '第一阶段');
    assert.deepEqual(await json(f, '/api/work-threads', { id, title: '第一阶段' }), first);
    assert.equal((await f.request('/api/work-threads', { id, title: '冲突名称' })).status, 409);
    for (const [kind, object] of Object.entries(objects)) {
      const body = { kind, objectId: object.id, action: 'link' };
      await json(f, `/api/work-threads/${id}/links`, body);
      const before = await json<WorkThreadDetail>(f, `/api/work-threads/${id}`);
      await json(f, `/api/work-threads/${id}/links`, body);
      assert.deepEqual(await json(f, `/api/work-threads/${id}`), before);
      const candidates = await json<WorkObject[]>(f, `/api/work-objects/${kind}`);
      assert.ok(candidates.some(item => item.id === object.id));
    }
    const detail = await json<WorkThreadDetail>(f, `/api/work-threads/${id}`);
    assert.equal(detail.links.length, 4); assert.ok(detail.links.every(link => link.source === 'user' && link.object));
    assert.ok(!JSON.stringify(detail).includes(objects.memory.content)); assert.ok(!JSON.stringify(detail).includes(objects.run.output!));
    assert.deepEqual(f.memory.listForHost(), memories); assert.deepEqual(f.store.getTask(objects.task.id), objects.task);
    assert.ok(!f.store.events(objects.run.id).some(e => e.type === 'delivery_succeeded'));
    assert.deepEqual(readdirSync(f.config.sessionDir, { recursive: true, withFileTypes: true }).filter(x => x.isFile()).map(x => join(x.parentPath, x.name)), sessionFiles.map(x => x.path));
    for (const file of sessionFiles) assert.deepEqual(readFileSync(file.path), file.content);
    await f.restart(); await f.login();
    assert.deepEqual(await json(f, `/api/work-threads/${id}`), detail);
    assert.equal(f.payloads.length, 0); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('关联状态来自原对象；改名、归档、移除和转关联不改变执行；删除Memory后显示不可用', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const { task, goal, memory, run } = seed(f); await f.login();
    const a = await json<WorkThread>(f, '/api/work-threads', { id: randomUUID(), title: '主题甲' });
    const b = await json<WorkThread>(f, '/api/work-threads', { id: randomUUID(), title: '主题乙' });
    for (const [kind, object] of Object.entries({ task, goal, memory })) await json(f, `/api/work-threads/${a.id}/links`, { kind, objectId: object.id, action: 'link' });
    await json(f, `/api/work-threads/${a.id}`, { title: '改名后的主题', status: 'archived' });
    assert.equal((await f.request(`/api/work-threads/${a.id}/links`, { kind: 'run', objectId: run.id, action: 'link' })).status, 409);
    assert.deepEqual(f.store.getTask(task.id), task); assert.deepEqual(f.store.goals.get({ ownerId: 'local-user', target: webTarget }, goal.id), goal);
    assert.deepEqual(f.memory.listForHost(), [memory]);
    f.store.cancelTask(task.id, '2026-11-01T01:00:00.000Z');
    let view = await json<WorkThreadDetail>(f, `/api/work-threads/${a.id}`);
    assert.equal(view.links.find(link => link.kind === 'task')!.object!.status, 'cancelled');
    f.memory.withRequest(request('忘记：key=workthread.database', run.id), () => f.memory.forget(memory.id, memory.version));
    view = await json(f, `/api/work-threads/${a.id}`); assert.equal(view.links.find(link => link.kind === 'memory')!.object, null);
    await json(f, `/api/work-threads/${a.id}/links`, { kind: 'memory', objectId: memory.id, action: 'unlink' });
    await json(f, `/api/work-threads/${a.id}/links`, { kind: 'task', objectId: task.id, action: 'unlink' });
    await json(f, `/api/work-threads/${b.id}/links`, { kind: 'task', objectId: task.id, action: 'link' });
    await json(f, `/api/work-threads/${a.id}`, { status: 'active' });
    assert.equal((await json<WorkThreadDetail>(f, `/api/work-threads/${a.id}`)).links.length, 1);
    assert.equal((await json<WorkThreadDetail>(f, `/api/work-threads/${b.id}`)).links[0]?.object?.status, 'cancelled');
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('其他Web身份、Console与飞书的Task/Goal/Run/Memory不会被列出或关联', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const own = seed(f); await f.login();
    const thread = await json<WorkThread>(f, '/api/work-threads', { id: randomUUID(), title: '本人主题' });
    const targets: MessageTarget[] = [{ channel: 'console' }, { channel: 'feishu', appId: 'a', userOpenId: 'u', chatId: 'c' }, { channel: 'web', userId: 'other' }];
    for (const target of targets) {
      const task = f.store.createTask('不应泄露的其他任务', now, now, target), run = f.store.beginRun(task.id, now);
      const goal = f.store.goals.create({ ownerId: 'local-user', target }, f.store.beginRun(null, now).id, '不应泄露的其他目标', now);
      const memory = f.memory.withRequest(request(`记住：不应泄露的${target.channel}记忆。`, run.id, target.channel), () => f.memory.remember({
        kind: 'project', key: `private.${target.channel}`, content: `不应泄露的${target.channel}记忆。`,
      }));
      for (const [kind, object] of Object.entries({ task, goal, run, memory })) {
        assert.equal((await f.request(`/api/work-threads/${thread.id}/links`, { kind, objectId: object.id, action: 'link' })).status, 404);
        const candidates = await json<WorkObject[]>(f, `/api/work-objects/${kind}`);
        assert.ok(candidates.some(item => item.id === own[kind as WorkObjectKind].id));
        assert.ok(!candidates.some(item => item.id === object.id)); assert.ok(!JSON.stringify(candidates).includes('不应泄露'));
      }
    }
    const orphan = f.memory.withRequest(request('记住：缺少Run来源的记录。', randomUUID()), () => f.memory.remember({ kind: 'project', key: 'orphan.run', content: '缺少Run来源的记录。' }));
    assert.equal((await f.request(`/api/work-threads/${thread.id}/links`, { kind: 'memory', objectId: orphan.id, action: 'link' })).status, 404);
    assert.equal((await json<WorkThreadDetail>(f, `/api/work-threads/${thread.id}`)).links.length, 0);
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('主题本身验证owner和channel；关联不能给原本无权访问的对象授权', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const own = seed(f); await f.login();
    for (const actor of [{ ...binding, owner: 'other' }, { ...binding, channel: JSON.stringify({ channel: 'console' }) }]) {
      const thread = f.store.workThreads.create(actor, randomUUID(), '不可见主题', now);
      for (const body of [undefined, { title: '越权改名' }]) assert.equal((await f.request(`/api/work-threads/${thread.id}`, body)).status, 404);
      for (const action of ['link', 'unlink']) assert.equal((await f.request(`/api/work-threads/${thread.id}/links`, { kind: 'task', objectId: own.task.id, action })).status, 404);
      assert.equal((await f.request('/api/work-threads', { id: thread.id, title: thread.title })).status, 404);
    }
    assert.deepEqual(await json(f, '/api/work-threads'), []);
    const ownThread = f.channel.workThreads!.create(randomUUID(), '当前主题');
    const foreign = f.store.createTask('不可见的关系目标', now, now, { channel: 'console' });
    // 模拟历史关系失去权限：已有关系也不能成为新的对象访问凭据。
    f.store.workThreads.link(binding, ownThread.id, 'task', foreign.id, now);
    const detail = await json<WorkThreadDetail>(f, `/api/work-threads/${ownThread.id}`);
    assert.equal(detail.links[0]!.object, null); assert.ok(!JSON.stringify(detail).includes(foreign.instruction));
    assert.equal((await f.request(`/api/work-threads/${ownThread.id}/links`, { kind: 'task', objectId: foreign.id, action: 'link' })).status, 404);
    await json(f, `/api/work-threads/${ownThread.id}/links`, { kind: 'task', objectId: foreign.id, action: 'unlink' });
  } finally { await f.close(); }
});

test('入口拒绝错误ID、类型、调用者字段和空更新；鉴权与CSRF仍有效', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const id = randomUUID();
    for (const path of ['/api/work-threads', `/api/work-threads/${id}`, '/api/work-objects/task']) assert.equal((await f.request(path)).status, 401);
    assert.equal((await f.request('/api/work-threads', { id, title: '未登录' })).status, 401);
    await f.login();
    for (const headers of [{ Origin: 'https://other.invalid' }, { 'X-CSRF-Token': 'wrong' }] as Record<string, string>[]) assert.equal((await f.request('/api/work-threads', { id, title: '未授权' }, headers)).status, 403);
    for (const body of [{ id: 'bad', title: '标题' }, { id, title: '  ' }, { id, title: '字'.repeat(121) }, { id, title: '标题', owner: webOwner }]) assert.equal((await f.request('/api/work-threads', body)).status, 400);
    await json(f, '/api/work-threads', { id, title: '有效标题' });
    for (const body of [{}, { title: null }, { status: 'running' }, { channel: 'web' }]) assert.equal((await f.request(`/api/work-threads/${id}`, body)).status, 400);
    for (const body of [{ kind: 'session', objectId: randomUUID(), action: 'link' }, { kind: ['task'], objectId: randomUUID(), action: 'link' },
      { kind: 'task', objectId: 'bad', action: 'link' }, { kind: 'task', objectId: randomUUID(), action: 'execute' }]) assert.equal((await f.request(`/api/work-threads/${id}/links`, body)).status, 400);
    for (const kind of ['task', 'goal', 'run', 'memory']) assert.equal((await f.request(`/api/work-threads/${id}/links`, { kind, objectId: randomUUID(), action: 'link' })).status, 404);
    assert.equal((await f.request(`/api/work-threads/${randomUUID()}`)).status, 404);
    assert.equal((await f.request('/api/work-threads/bad')).status, 404);
    assert.equal((await f.request('/api/work-objects/session')).status, 404);
    assert.deepEqual((await json<WorkThreadDetail>(f, `/api/work-threads/${id}`)).links, []);
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('关闭后新增接口不可用、旧snapshot保持原数据；再次开启恢复关系', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const { task } = seed(f); await f.login();
    const thread = f.channel.workThreads!.create(randomUUID(), '开关验证'); f.channel.workThreads!.link(thread.id, 'task', task.id);
    const { capabilities, ...before } = f.channel.snapshot(); assert.equal(capabilities.workThreads, true);
    f.config.workThreadsEnabled = false; await f.restart(); await f.login();
    for (const [path, body] of [['/api/work-threads', undefined], ['/api/work-threads', { id: randomUUID(), title: '关闭' }],
      [`/api/work-threads/${thread.id}`, undefined], [`/api/work-threads/${thread.id}`, { title: '改名' }],
      [`/api/work-threads/${thread.id}/links`, { kind: 'task', objectId: task.id, action: 'unlink' }], ['/api/work-objects/task', undefined]] as const) {
      assert.equal((await f.request(path, body)).status, 404);
    }
    const { capabilities: off, ...after } = f.channel.snapshot(); assert.deepEqual(after, before); assert.equal(off.workThreads, false);
    assert.deepEqual({ ...off, workThreads: true }, capabilities);
    f.config.workThreadsEnabled = true; await f.restart(); await f.login();
    assert.equal((await json<WorkThreadDetail>(f, `/api/work-threads/${thread.id}`)).links[0]?.objectId, task.id);
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('关联文件Run不展示正文、不写ACK，也不能绕过文件审批', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    await f.login();
    const run = f.store.webUi.accept(webOwner, randomUUID(), '临时文件提议', now);
    const content = '未经确认不得写入的正文';
    const file = f.store.files.propose({ actor: binding, root: 'fixture-output', runId: run.id, requestHash: fileHash('request'), kind: 'write',
      path: 'output.md', oldIdentity: null, oldHash: null, content, contentHash: fileHash(content), modificationHash: fileHash('modification'), expires: Date.now() + 60000 }, '');
    f.store.finishRun(run.id, 'succeeded', now, file.preview);
    const thread = f.channel.workThreads!.create(randomUUID(), '审批边界');
    await json(f, `/api/work-threads/${thread.id}/links`, { kind: 'run', objectId: run.id, action: 'link' });
    const detail = await json(f, `/api/work-threads/${thread.id}`); assert.ok(!JSON.stringify(detail).includes(content));
    assert.ok(!f.store.events(run.id).some(e => e.type === 'delivery_succeeded'));
    assert.equal((await f.request(`/api/files/${file.id}/decision`, { hash: file.hash, action: 'confirm', requestId: randomUUID() })).status, 409);
    assert.equal(f.store.files.get(file.id).status, 'pending'); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('Goal关闭时不能查询或新增Goal关联；原关系保留但不返回目标信息', async () => {
  const f = await webUiFixture(undefined, undefined, true); try {
    const { goal } = seed(f), service = f.channel.workThreads!, thread = service.create(randomUUID(), 'Goal开关');
    service.link(thread.id, 'goal', goal.id);
    const off = new WorkThreadService(f.store, f.memory, { owner: webOwner, target: webTarget }, false);
    assert.deepEqual(off.candidates('goal'), []); assert.equal(off.detail(thread.id).links[0]?.object, null);
    assert.throws(() => off.link(thread.id, 'goal', goal.id), /无权访问/);
  } finally { await f.close(); }
});
