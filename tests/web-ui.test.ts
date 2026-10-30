import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { reply, toolCall, content } from './helpers/skills-fixture.js';
import { readWebUiConfig, prepareWebUiData } from '../src/web-ui-server.js';
import { webTarget, webOwner } from '../src/web-ui-channel.js';
import { ChannelRouter } from '../src/channel-router.js';
import { TaskScheduler } from '../src/scheduler.js';
import { GoalRunner } from '../src/goal-runner.js';
import { fileHash } from '../src/file-operation-store.js';
import { FileOutputService } from '../src/file-output-service.js';
import { intentReply } from './helpers/intent-stub.js';
import type { WebFile, WebSnapshot } from '../src/web-ui-types.js';
import { chatTimeline } from '../web/src/chat-timeline.js';

test('Web 默认关闭、仅回环、独立密钥和数据根；拒绝接管已有非Web目录', async () => {
  assert.throws(() => readWebUiConfig({}), /WEB_UI_ENABLED/);
  const env = { WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: 'fixture-independent-key-at-least-32-bytes', WEB_UI_DATA_DIR: join(tmpdir(), 'web-only') };
  assert.equal(readWebUiConfig(env).port, 4317);
  for (const change of [{ WEB_UI_HOST: '0.0.0.0' }, { WEB_UI_ACCESS_KEY: 'short' }, { LLM_API_KEY: env.WEB_UI_ACCESS_KEY },
    { DATABASE_PATH: join(tmpdir(), 'foreign.db') }, { SESSION_DIR: join(tmpdir(), 'foreign-sessions') }, { WEB_UI_PORT: 'NaN' }]) assert.throws(() => readWebUiConfig({ ...env, ...change }));
  const root = mkdtempSync(join(tmpdir(), 'web-config-')); writeFileSync(join(root, 'existing.txt'), 'keep');
  await assert.rejects(prepareWebUiData(root), /不能接管/); assert.equal(readFileSync(join(root, 'existing.txt'), 'utf8'), 'keep');
  const clean = join(root, 'clean'); await prepareWebUiData(clean); await prepareWebUiData(clean);
});

test('认证保护全部数据与写入口；Cookie、Origin、CSRF、Host和有界请求', async () => {
  const f = await webUiFixture(); try {
    for (const path of ['/api/snapshot', `/api/runs/${randomUUID()}`, `/api/files/${randomUUID()}`, `/api/goals/${randomUUID()}`]) assert.equal((await f.request(path)).status, 401);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'hello' })).status, 401);
    assert.equal((await f.request('/api/login', { key: 'wrong' })).status, 401);
    const login = await f.login(); const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=43200/);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'hi' }, { Origin: 'https://evil.test' })).status, 403);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'hi' }, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'hi', ownerId: 'console' })).status, 400);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'x'.repeat(40000) })).status, 413);
    const hostStatus = await new Promise<number>(done => {
      const req = httpRequest(f.origin + '/api/session', { headers: { Host: 'evil.test' } }, res => { res.resume(); done(res.statusCode!); }); req.end();
    });
    assert.equal(hostStatus, 403);
    assert.equal(f.payloads.length, 0);
    assert.equal((await f.request('/api/logout', {})).status, 200);
    assert.equal((await f.request('/api/snapshot')).status, 401);
  } finally { await f.close(); }
});

test('本机启动一次性登录：需要密钥签发，换取原有会话后跳转聊天；不放宽CSRF或调用模型', async () => {
  const f = await webUiFixture(); try {
    assert.equal((await f.request('/api/launch', { key: 'wrong' })).status, 401);
    assert.equal((await f.request('/api/launch', { key: f.key }, { Origin: 'https://evil.test' })).status, 403);
    const issued = await f.request('/api/launch', { key: f.key });
    assert.equal(issued.status, 200); assert.equal(issued.headers.get('set-cookie'), null);
    const { url } = await issued.json() as { url: string };
    assert.equal(new URL(url).origin, f.origin); assert.ok(!url.includes(f.key));
    assert.equal((await f.request('/api/snapshot')).status, 401);
    const login = await fetch(url, { redirect: 'manual' });
    assert.equal(login.status, 303); assert.equal(login.headers.get('location'), '/#chat');
    assert.equal(login.headers.get('cache-control'), 'no-store');
    assert.equal(login.headers.get('referrer-policy'), 'no-referrer');
    const cookie = login.headers.get('set-cookie')!;
    assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /Max-Age=43200/);
    const headers = { Cookie: cookie.split(';')[0]! };
    assert.equal((await f.request('/api/snapshot', undefined, headers)).status, 200);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'hello' }, headers)).status, 403);
    const session = await (await f.request('/api/session', undefined, headers)).json() as { csrf: string };
    assert.equal((await f.request('/api/logout', {}, { ...headers, 'X-CSRF-Token': session.csrf })).status, 200);
    assert.equal((await f.request('/api/snapshot', undefined, headers)).status, 401);
    assert.equal((await fetch(url, { redirect: 'manual' })).status, 401);
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('本机启动登录凭据短时有效，重新签发及重启后旧入口失效', async t => {
  const f = await webUiFixture(); try {
    let now = Date.now(); t.mock.method(Date, 'now', () => now);
    const first = await (await f.request('/api/launch', { key: f.key })).json() as { url: string };
    assert.ok(first.url);
    now += 60001;
    assert.equal((await fetch(first.url, { redirect: 'manual' })).status, 401);
    const second = await (await f.request('/api/launch', { key: f.key })).json() as { url: string };
    const third = await (await f.request('/api/launch', { key: f.key })).json() as { url: string };
    assert.equal((await fetch(second.url, { redirect: 'manual' })).status, 401);
    const path = new URL(third.url).pathname;
    await f.restart();
    assert.equal((await fetch(f.origin + path, { redirect: 'manual' })).status, 401);
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('登录限流不调用模型', async () => {
  const f = await webUiFixture(); try {
    for (let i = 0; i < 10; i++) assert.equal((await f.request('/api/login', { key: 'wrong' })).status, 401);
    assert.equal((await f.request('/api/login', { key: f.key })).status, 429); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('snapshot只投影文件元数据，聊天和活动不夹带冻结预览；详情读取不等于ACK或批准', async () => {
  const f = await webUiFixture(); try {
    await f.login(); const now = new Date().toISOString(), root = new FileOutputService(f.output, f.store.files).key;
    let lastId = '', lastRunId = '', lastHash = '', lastPreview = '';
    for (let i = 0; i < 60; i++) {
      const run = f.store.webUi.accept(webOwner, randomUUID(), `提议文件 ${i}`, now);
      const content = `冻结正文标记-${i}\n` + '正文'.repeat(600);
      const p = f.store.files.propose({ actor: { owner: webOwner, channel: JSON.stringify(webTarget) }, root, runId: run.id,
        requestHash: fileHash(`当前请求-${i}`), kind: 'write', path: `file-${i}.md`, oldIdentity: null, oldHash: null,
        content, contentHash: fileHash(content), modificationHash: fileHash(`修改-${i}`), expires: Date.now() + 300000 }, `+冻结Diff标记-${i}`);
      f.store.finishRun(run.id, 'succeeded', now, p.preview);
      lastId = p.id; lastRunId = run.id; lastHash = p.hash; lastPreview = p.preview;
    }
    const response = await f.request('/api/snapshot'), raw = await response.text(), snapshot = JSON.parse(raw) as WebSnapshot;
    console.log(JSON.stringify({ snapshotBytes: Buffer.byteLength(raw), files: snapshot.files.length }));
    assert.equal(snapshot.files.length, 60);
    assert.ok(!raw.includes('冻结正文标记')); assert.ok(!raw.includes('冻结Diff标记')); assert.ok(!raw.includes('待批准文件操作（未写入）'));
    for (const file of snapshot.files) {
      assert.ok(!('content' in file)); assert.ok(!('diff' in file)); assert.ok(!('preview' in file)); assert.ok(!('run' in file));
      assert.equal(file.acknowledged, false); assert.equal(file.status, 'pending');
      assert.equal(file.createdAt, now); assert.match(file.hash, /^[a-f0-9]{64}$/u); assert.ok(file.expires > Date.now());
    }
    assert.equal(snapshot.chats.at(-1)?.run.output, null); assert.equal(snapshot.activity[0]?.output, null);
    assert.equal(snapshot.chats.at(-1)?.run.fileOperationId, lastId);
    const details = await (await f.request(`/api/files/${lastId}`)).json() as WebFile;
    assert.equal(details.preview, lastPreview); assert.match(details.content, /冻结正文标记-59/); assert.equal(details.diff, '+冻结Diff标记-59');
    assert.equal(details.hash, lastHash); assert.equal(details.run.output, lastPreview); assert.equal(details.acknowledged, false);
    assert.ok(!f.store.events(lastRunId).some(e => e.type === 'delivery_succeeded'));
    assert.equal((await f.request(`/api/files/${lastId}/decision`, { requestId: randomUUID(), hash: lastHash, action: 'confirm' })).status, 409);
    assert.equal((await f.request(`/api/runs/${lastRunId}/ack`, { hash: '0'.repeat(64) })).status, 409);
    assert.equal((await f.request(`/api/runs/${lastRunId}/ack`, { hash: lastHash })).status, 200);
    const after = await (await f.request('/api/snapshot')).json() as WebSnapshot;
    assert.equal(after.files[0]?.acknowledged, true); assert.equal(after.files[0]?.status, 'pending'); assert.ok(!existsSync(join(f.output, 'file-59.md')));
    assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('真实Pi调用：持久请求去重、并发拒绝、刷新和重启不重放；原生Session恢复', async () => {
  let release: (() => void) | undefined;
  const gate = new Promise<void>(done => { release = done; });
  const f = await webUiFixture(async () => { await gate; return reply('已收到第一轮中文消息'); });
  try {
    await f.login(); const requestId = randomUUID(), body = { requestId, text: '第一轮中文消息' };
    const first = await (await f.request('/api/chat', body)).json() as { id: string };
    assert.equal((await (await f.request('/api/chat', body)).json() as { id: string }).id, first.id);
    assert.equal((await f.request('/api/chat', { requestId, text: 'different' })).status, 409);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: 'second' })).status, 409);
    await f.request('/api/snapshot'); release!(); await f.channel.drain();
    assert.equal(f.payloads.length, 1); assert.equal(f.store.getRun(first.id)?.status, 'succeeded');
    assert.ok(!f.store.events(first.id).some(e => e.type === 'delivery_succeeded'));
    await f.request('/api/snapshot'); await f.restart(); await f.login();
    assert.equal((await (await f.request('/api/chat', body)).json() as { id: string }).id, first.id);
    assert.equal(f.payloads.length, 1);
    await f.request('/api/chat', { requestId: randomUUID(), text: '第二轮读取上下文' }); await f.channel.drain();
    assert.match(JSON.stringify(f.payloads[1]!.messages), /第一轮中文消息/);
    const snapshot = await (await f.request('/api/snapshot')).json() as WebSnapshot;
    assert.equal(snapshot.chats.length, 2); assert.equal(snapshot.chats[0]?.run.output, '已收到第一轮中文消息');
    assert.equal(snapshot.activity[0]?.output, '已收到第一轮中文消息');
    assert.deepEqual(f.errors, []);
  } finally { release!(); await f.close(); }
});

test('Task/Goal/Run/文件与收件箱按可信Web身份隔离；错误渠道不回退', async () => {
  const f = await webUiFixture(); try {
    await f.login(); const now = new Date().toISOString(), other = { channel: 'web' as const, userId: 'other' };
    const own = f.store.createTask('自己的任务', now, now, webTarget);
    const foreign = f.store.createTask('不可泄露的其他任务', now, now, other);
    f.store.createTask('Console任务', now, now, { channel: 'console' });
    f.store.createTask('飞书任务', now, now, { channel: 'feishu', appId: 'a', userOpenId: 'u', chatId: 'c' });
    const ownGoal = f.store.goals.create({ ownerId: 'local-user', target: webTarget }, f.store.beginRun(null, now).id, '自己的目标', now);
    const foreignGoal = f.store.goals.create({ ownerId: 'local-user', target: other }, f.store.beginRun(null, now).id, '其他目标', now);
    const run = f.store.beginRun(foreign.id, now);
    const fileRun = f.store.beginRun(null, now);
    const foreignFile = f.store.files.propose({ actor: { owner: 'other-web-owner', channel: JSON.stringify(other) }, root: 'fixture-root', runId: fileRun.id,
      requestHash: fileHash('request'), kind: 'write', path: 'foreign.md', oldIdentity: null, oldHash: null, content: '不可泄露的文件正文',
      contentHash: fileHash('不可泄露的文件正文'), modificationHash: fileHash('modification'), expires: Date.now() + 300000 }, '');
    assert.equal((await f.request(`/api/runs/${run.id}`)).status, 404);
    assert.equal((await f.request(`/api/goals/${foreignGoal.id}`)).status, 404);
    assert.equal((await f.request(`/api/goals/${ownGoal.id}`)).status, 200);
    assert.equal((await f.request(`/api/files/${randomUUID()}`)).status, 404);
    assert.equal((await f.request(`/api/files/${foreignFile.id}`)).status, 404);
    const snapshot = await (await f.request('/api/snapshot')).json() as WebSnapshot;
    assert.deepEqual(snapshot.tasks.map(t => t.id), [own.id]); assert.deepEqual(snapshot.goals.map(g => g.id), [ownGoal.id]);
    assert.ok(!JSON.stringify(snapshot).includes('不可泄露')); assert.ok(!JSON.stringify(snapshot).includes('accessKey'));
    await assert.rejects(f.channel.sendMessage({ target: other, runId: run.id, text: 'wrong' }));
    const router = new ChannelRouter({ async sendMessage() { throw new Error('不应回退'); } });
    await assert.rejects(router.sendMessage({ target: webTarget, text: 'wrong' }), /Web/);
    assert.equal(f.store.webUi.chats(webOwner).length, 0);
  } finally { await f.close(); }
});

test('已接纳后进程中断的Web请求重启标记interrupted，不补调模型或重放', async () => {
  const f = await webUiFixture(); try {
    const requestId = randomUUID(), run = f.store.webUi.accept(webOwner, requestId, '已接纳但未执行', new Date().toISOString());
    await f.restart(); await f.login();
    const response = await (await f.request('/api/chat', { requestId, text: '已接纳但未执行' })).json() as { id: string; status: string };
    assert.equal(response.id, run.id); assert.equal(response.status, 'interrupted'); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('Web明确Memory保存仍经原Guard，来源为web且重启可读取；没有额外文件权限', async () => {
  let n = 0;
  const f = await webUiFixture(payload => {
    const intent = intentReply(payload); if (intent) return reply(intent);
    assert.ok(!payload.tools?.some(t => ['bash', 'powershell', 'read', 'ls'].includes(t.function.name)));
    return ++n === 1 ? toolCall('memory_remember', { kind: 'project', key: 'aurora.database', content: '项目 Aurora 数据库使用 SQLite。' }) : reply('已收到宿主保存收据');
  });
  try {
    await f.login(); await f.request('/api/chat', { requestId: randomUUID(), text: '记住：项目 Aurora 数据库使用 SQLite。' }); await f.channel.drain();
    const record = f.memory.listForHost()[0]!; assert.equal(record.source.channel, 'web'); assert.match(record.content, /SQLite/);
    await f.restart(); assert.equal(f.memory.listForHost()[0]?.id, record.id); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Web收件箱落盘失败只记录投递失败，不重跑Task；任务结果仍来自权威Run', async t => {
  const f = await webUiFixture(() => reply('独立任务最终结果')); try {
    const now = new Date().toISOString(), task = f.store.createTask('模拟提醒', now, now, webTarget);
    t.mock.method(f.store.webUi, 'putNotice', () => { throw new Error('fixture inbox unavailable'); });
    const scheduler = new TaskScheduler(f.store, f.executor, f.channel, 1000, () => {}, () => new Date(), f.lane);
    await scheduler.tick(); await scheduler.tick();
    assert.equal(f.payloads.length, 1); assert.equal(f.store.getTask(task.id)?.status, 'succeeded');
    assert.equal(f.channel.snapshot().inbox.length, 0); assert.equal(f.channel.snapshot().tasks[0]?.result, '独立任务最终结果');
    assert.ok(f.channel.snapshot().activity[0]?.viewed === false);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('T3完整预览ACK与用户Confirm分离，原Guard一次性提交；真实编辑Diff与结果状态', async () => {
  let kind = 'write', call = 0;
  const f = await webUiFixture(() => ++call % 2 === 1 ? kind === 'write'
    ? toolCall('write', { path: 'answer.md', content: '第一句。\n第二句。\n' })
    : toolCall('edit', { path: 'answer.md', edits: [{ oldText: '第二句。', newText: '修改后的第二句。' }] }) : reply('模型自称已完成，宿主收据覆盖'));
  try {
    await f.login();
    const propose = async () => {
      await f.request('/api/chat', { requestId: randomUUID(), text: `本次允许${kind === 'write' ? '创建' : '编辑'}输出文件：answer.md\n只提出预览` });
      await f.channel.drain(); const summary = (await (await f.request('/api/snapshot')).json() as WebSnapshot).files[0]!;
      return await (await f.request(`/api/files/${summary.id}`)).json() as WebFile;
    };
    const p = await propose(); assert.equal(p.status, 'pending'); assert.equal(p.acknowledged, false);
    assert.equal(p.content, '第一句。\n第二句。\n'); assert.equal(existsSync(join(f.output, 'answer.md')), false);
    const decision = { requestId: randomUUID(), hash: p.hash, action: 'confirm' };
    assert.equal((await f.request(`/api/files/${p.id}/decision`, decision)).status, 409);
    assert.equal((await f.request(`/api/runs/${p.runId}/ack`, {})).status, 409);
    assert.equal((await f.request(`/api/runs/${p.runId}/ack`, { hash: '0'.repeat(64) })).status, 409);
    assert.equal((await f.request(`/api/runs/${p.runId}/ack`, { hash: p.hash })).status, 200);
    assert.equal(existsSync(join(f.output, 'answer.md')), false);
    const count = f.payloads.length;
    const confirmed = await f.request(`/api/files/${p.id}/decision`, decision); assert.equal(confirmed.status, 202); await f.channel.drain();
    assert.equal(f.channel.file(p.id).status, 'committed'); assert.equal(f.payloads.length, count);
    assert.equal((await f.request(`/api/files/${p.id}/decision`, decision)).status, 202);
    assert.equal((await f.request(`/api/files/${p.id}/decision`, { ...decision, requestId: randomUUID() })).status, 409);
    kind = 'edit'; call = 0; const edit = await propose();
    assert.match(edit.diff, /-.*第二句/); assert.match(edit.diff, /\+.*修改后的第二句/);
    assert.match(readFileSync(join(f.output, 'answer.md'), 'utf8'), /\n第二句/);
    await f.request(`/api/runs/${edit.runId}/ack`, { hash: edit.hash });
    await f.request(`/api/files/${edit.id}/decision`, { requestId: randomUUID(), hash: edit.hash, action: 'confirm' }); await f.channel.drain();
    assert.equal(f.channel.file(edit.id).status, 'committed'); assert.match(readFileSync(join(f.output, 'answer.md'), 'utf8'), /修改后的第二句/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('T3通过Chat命令也不能跳过投递；过期、错误Hash/ID、已拒绝禁止批准', async t => {
  let n = 0; const f = await webUiFixture(() => ++n % 2 === 1 ? toolCall('write', { path: 'draft.md', content: '未提交正文' }) : reply('模型原话'));
  try {
    await f.login(); await f.request('/api/chat', { requestId: randomUUID(), text: '本次允许创建输出文件：draft.md\n正文' }); await f.channel.drain();
    const p = (await (await f.request('/api/snapshot')).json() as WebSnapshot).files[0]!;
    await f.request('/api/chat', { requestId: randomUUID(), text: `确认文件操作 ${p.id} ${p.hash}` }); await f.channel.drain();
    assert.equal(f.channel.file(p.id).status, 'pending'); assert.ok(!existsSync(join(f.output, 'draft.md')));
    assert.equal((await f.request(`/api/files/${randomUUID()}/decision`, { requestId: randomUUID(), hash: p.hash, action: 'confirm' })).status, 404);
    await f.request(`/api/runs/${p.runId}/ack`, { hash: p.hash });
    assert.equal((await f.request(`/api/files/${p.id}/decision`, { requestId: randomUUID(), hash: '0'.repeat(64), action: 'confirm' })).status, 409);
    t.mock.method(Date, 'now', () => p.expires + 1);
    assert.equal((await f.request(`/api/files/${p.id}/decision`, { requestId: randomUUID(), hash: p.hash, action: 'confirm' })).status, 409);
    t.mock.restoreAll();
    await f.request(`/api/files/${p.id}/decision`, { requestId: randomUUID(), hash: p.hash, action: 'reject' }); await f.channel.drain();
    assert.equal(f.channel.file(p.id).status, 'cancelled'); assert.ok(!existsSync(join(f.output, 'draft.md')));
    assert.equal((await f.request(`/api/files/${p.id}/decision`, { requestId: randomUUID(), hash: p.hash, action: 'confirm' })).status, 409);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('后台Task通过原Scheduler/Pi执行并投影到Chat，收件箱持久化与已查看分离；刷新不重跑', async () => {
  const f = await webUiFixture(p => { assert.deepEqual(p.tools ?? [], []); return reply('后台完成结果'); });
  try {
    await f.login(); const now = new Date().toISOString(), task = f.store.createTask('测试提醒', now, now, webTarget);
    const router = new ChannelRouter({ async sendMessage() { throw new Error('wrong channel'); } }, undefined, f.channel);
    const scheduler = new TaskScheduler(f.store, f.executor, router, 1000, error => f.errors.push(error), () => new Date(), f.lane);
    assert.equal(chatTimeline(f.channel.snapshot()).length, 0);
    await scheduler.tick(); await scheduler.tick(); assert.equal(f.payloads.length, 1);
    const notice = f.channel.snapshot().inbox[0]!; assert.equal(notice.taskId, task.id); assert.equal(notice.viewedAt, null);
    const timeline = chatTimeline(f.channel.snapshot());
    assert.equal(timeline.length, 1); assert.equal(timeline[0]!.id, `task:${notice.runId}`);
    assert.equal(f.channel.snapshot().chats.length, 0);
    assert.deepEqual(chatTimeline(f.channel.snapshot()), timeline);
    await f.restart(); await f.login(); assert.equal(f.payloads.length, 1); assert.equal(f.channel.snapshot().inbox.length, 1);
    assert.deepEqual(chatTimeline(f.channel.snapshot()), timeline);
    assert.equal(f.channel.snapshot().inbox[0]!.viewedAt, null);
    assert.equal((await f.request(`/api/inbox/${notice.runId}/view`, {})).status, 200);
    assert.ok(f.channel.snapshot().inbox[0]!.viewedAt); assert.equal(f.channel.snapshot().capabilities.push, false);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('Web Chat经Guard创建Goal，原Runner生成计划/Checkpoint并入箱；API不泄露内部授权', async () => {
  const f = await webUiFixture(payload => {
    const system = content(payload.messages.find(m => m.role === 'system')?.content);
    const user = content(payload.messages.findLast(m => m.role === 'user')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      return reply(JSON.stringify({ action: 'goal_manage', goalAction: 'create', mode: 'request', evidence: JSON.parse(user).message }));
    }
    if (system.includes('有界纯文本片段')) {
      assert.deepEqual(payload.tools ?? [], []);
      return reply(JSON.stringify({ stepOutcome: 'complete', artifactText: '离线面试计划', progressSummary: '计划待批准', question: '是否批准？',
        proposedPlan: { steps: [{ title: '面试练习', instruction: '做一道面试练习', deliverable: '题目与说明', doneWhen: '用户核对练习结果' }], changeReason: '初始计划' } }));
    }
    const index = payload.messages.findLastIndex(m => m.role === 'user');
    return payload.messages.slice(index + 1).some(m => m.role === 'tool') ? reply('收到目标创建收据') : toolCall('goal_manage', {});
  });
  try {
    await f.login();
    await f.request('/api/chat', { requestId: randomUUID(), text: '我想逐步准备离线面试，请创建长期目标' }); await f.channel.drain();
    const goal = f.channel.snapshot().goals[0]!; assert.ok(goal);
    const runner = new GoalRunner(f.store, f.executor, f.channel, f.lane, { ownerId: 'local-user', accepts: t => t.channel === 'web' && t.userId === webTarget.userId,
      pollIntervalMs: 1000, reportError: e => f.errors.push(e), fatal: () => assert.fail('unexpected fatal') });
    await runner.tick(); const calls = f.payloads.length; await runner.tick(); assert.equal(f.payloads.length, calls);
    const detailResponse = await f.request(`/api/goals/${goal.id}`); assert.equal(detailResponse.status, 200);
    const detail = await detailResponse.json() as { status: string; pendingPlan: unknown[]; checkpoint: { artifactText: string } };
    assert.equal(detail.status, 'waiting_user'); assert.equal(detail.pendingPlan.length, 1); assert.equal(detail.checkpoint.artifactText, '离线面试计划');
    assert.ok(!JSON.stringify(detail).includes('accessKey')); assert.ok(!JSON.stringify(detail).includes('readyInput'));
    assert.equal(f.channel.snapshot().inbox[0]?.goalId, goal.id); assert.equal(f.channel.snapshot().inbox[0]?.viewedAt, null);
    await f.restart(); assert.equal(f.payloads.length, calls); assert.equal(f.channel.snapshot().inbox[0]?.goalId, goal.id); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
