import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { SqliteStore } from '../src/sqlite-store.js';
import type { WebWorkRoute, WebWorkJob, WebSnapshot, WebRun } from '../src/web-ui-types.js';
import type { WorkRouteRequest } from '../src/work-route-types.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { chatTimeline } from '../web/src/chat-timeline.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { reply } from './helpers/skills-fixture.js';
import type { Payload } from './helpers/skills-fixture.js';

const now = '2026-11-01T00:00:00.000Z';
const routing = (payload: Payload) => JSON.stringify(payload.messages[0]?.content).includes('你是隔离的工作路由建议器');
async function fixture(handler?: (p: Payload) => string | Promise<string>) {
  let threadId = '';
  const f = await webUiFixture(handler ?? (p => reply(routing(p) ? JSON.stringify({ kind: 'work', threadId, reason: '建议整理本次原文' }) : '普通Chat或Worker模拟回答')), undefined, true, true, true);
  await f.login(); const thread = f.channel.workThreads!.create(randomUUID(), 'B3合成主题'); threadId = thread.id;
  const input = (text = '整理以下材料：SDK、宿主、Run。', selection: WorkRouteRequest['selection'] = { threadId }): WorkRouteRequest => ({ mode: 'suggest', requestId: randomUUID(), text, selection });
  return { ...f, get store() { return f.store; }, get channel() { return f.channel; }, get memory() { return f.memory; }, get workRunner() { return f.workRunner; }, thread, input };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const body = (input: WorkRouteRequest) => ({ requestId: input.requestId, text: input.text, selection: input.selection });
const expected = (input: WorkRouteRequest) => ({ text: input.text, selection: input.selection });
async function submit(f: Fixture, input: WorkRouteRequest): Promise<WebWorkRoute> {
  const res = await f.request('/api/work-routes', body(input)); assert.equal(res.status, 202, await res.clone().text()); return res.json() as Promise<WebWorkRoute>;
}
async function settled(f: Fixture, id: string): Promise<WebWorkRoute> {
  for (let i = 0; i < 200; i++) {
    const res = await f.request(`/api/work-routes/${id}`); assert.equal(res.status, 200);
    const view = await res.json() as WebWorkRoute;
    if (view.run.status !== 'running') return view;
    await delay(10);
  }
  throw new Error('本机建议未在测试等待窗内结束');
}

test('旧Web请求表增量mode/context默认值、显式INSERT及重开保留原Task/Run', () => {
  const root = mkdtempSync(join(tmpdir(), 'route-migration-')), path = join(root, 'app.db');
  let store = new SqliteStore(path);
  try {
    const requestId = randomUUID(), old = store.webUi.accept(webOwner, requestId, '旧聊天原文', now);
    const task = store.createTask('旧任务', now, now, webTarget); store.finishRun(old.id, 'succeeded', now, '旧回答'); store.close();
    const db = new DatabaseSync(path); db.exec('ALTER TABLE web_ui_chats DROP COLUMN selectionJson; ALTER TABLE web_ui_chats DROP COLUMN mode;'); db.close();
    store = new SqliteStore(path);
    assert.deepEqual({ ...store.webUi.find(webOwner, requestId) }, { requestId, runId: old.id, text: '旧聊天原文', mode: 'chat', selectionJson: '{}' });
    assert.deepEqual(store.getTask(task.id), task); assert.equal(store.getRun(old.id)?.output, '旧回答');
    const newId = randomUUID(), selectionJson = JSON.stringify({ threadId: randomUUID() });
    const added = store.webUi.accept(webOwner, newId, '新建议', now, 'suggest', selectionJson); store.close(); store = new SqliteStore(path);
    assert.equal(store.webUi.find(webOwner, newId)?.runId, added.id); assert.equal(store.webUi.find(webOwner, newId)?.selectionJson, selectionJson);
    assert.equal(store.webUi.chats(webOwner).length, 1); assert.equal(store.webUi.chats(webOwner, 'suggest').length, 1);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('建议默认关闭；登录/CSRF/Origin/字段/外部身份/归档拒绝，UTF8原文不截断', async () => {
  const disabled = await webUiFixture(); try {
    await disabled.login(); assert.equal((await disabled.request('/api/work-routes', { requestId: randomUUID(), text: '不注册' })).status, 404);
    assert.equal(disabled.channel.snapshot().suggestions, undefined); assert.equal(disabled.payloads.length, 0);
  } finally { await disabled.close(); }
  const f = await fixture(); try {
    const input = f.input();
    for (const headers of [{ 'X-CSRF-Token': 'wrong' }, { Origin: 'http://other.invalid' }] as Record<string, string>[]) assert.equal((await f.request('/api/work-routes', body(input), headers)).status, 403);
    for (const value of [{ ...body(input), owner: 'other' }, { ...body(input), mode: 'chat' }, { ...body(input), selection: { channel: 'web' } },
      { ...body(input), selection: { object: { kind: 'memory', id: randomUUID() } } }, { ...body(input), selection: { object: [] } }, { ...body(input), selection: { object: { kind: ['task'], id: randomUUID() } } }, { ...body(input), selection: null }, { ...body(input), requestId: 'bad' }])
      assert.equal((await f.request('/api/work-routes', value)).status, 400);
    assert.equal((await f.request('/api/work-routes', { ...body(input), text: '中'.repeat(4780) })).status, 413);
    const foreign = f.store.workThreads.create({ owner: 'other', channel: JSON.stringify(webTarget) }, randomUUID(), '其他主题', now);
    assert.equal((await f.request('/api/work-routes', body(f.input('原文', { threadId: foreign.id })))).status, 404);
    const foreignTask = f.store.createTask('其他任务', now, now, { channel: 'console' });
    assert.equal((await f.request('/api/work-routes', body(f.input('原文', { object: { kind: 'task', id: foreignTask.id } })))).status, 404);
    f.channel.workThreads!.update(f.thread.id, { status: 'archived' }); assert.equal((await f.request('/api/work-routes', body(input))).status, 409);
    assert.equal(f.payloads.length, 0);
    await f.request('/api/logout', {}); assert.equal((await f.request('/api/work-routes', body(input))).status, 401);
  } finally { await f.close(); }
});

test('同ID跨mode/原文/选择409，selection键序规范化；重复/刷新/重开均不重调模型', async () => {
  const f = await fixture(); try {
    const input = f.input(); await submit(f, input); const completed = await settled(f, input.requestId); assert.equal(f.payloads.filter(routing).length, 1);
    assert.equal((await submit(f, input)).run.id, completed.run.id);
    assert.equal((await f.request('/api/chat', { requestId: input.requestId, text: input.text })).status, 409);
    for (const changed of [{ ...input, text: '修改原文' }, { ...input, selection: {} }, { ...input, selection: { object: { kind: 'task' as const, id: randomUUID() } } }])
      assert.equal((await f.request('/api/work-routes', body(changed))).status, 409);
    const chatId = randomUUID(); assert.equal((await f.request('/api/chat', { requestId: chatId, text: '普通讨论' })).status, 202); await f.channel.drain();
    assert.equal((await f.request('/api/work-routes', { ...body(input), requestId: chatId, text: '普通讨论' })).status, 409);
    const task = f.store.createTask('明确对象', now, now, webTarget); f.channel.workThreads!.link(f.thread.id, 'task', task.id);
    const exact = f.input('查询明确任务', { threadId: f.thread.id, object: { kind: 'task', id: task.id } }); await submit(f, exact); await settled(f, exact.requestId);
    assert.equal((await f.request('/api/work-routes', { requestId: exact.requestId, text: exact.text, selection: { object: { id: task.id, kind: 'task' }, threadId: f.thread.id } })).status, 202);
    const count = f.payloads.length; await f.restart(); await f.login(); const replay = await submit(f, input);
    assert.equal(replay.run.id, completed.run.id); assert.equal(f.payloads.length, count); assert.equal(f.channel.snapshot().chats.length, 1);
    assert.equal(f.channel.snapshot().suggestions?.length, 2); assert.equal(f.store.workJobs.list(f.channel.workThreads!.binding).length, 0);
  } finally { await f.close(); }
});

test('建议只形成技术Run；确认读取持久原文/同UUID，响应丢失重复/重启只一Job，后来归档仍回收据', async () => {
  const f = await fixture(); try {
    const input = f.input(); const accepted = await submit(f, input); const view = await settled(f, input.requestId);
    assert.equal(view.run.mode, 'suggest'); assert.equal(view.suggestion?.kind, 'work'); assert.equal(view.run.status, 'succeeded');
    assert.equal(f.store.workJobs.list(f.channel.workThreads!.binding).length, 0); assert.equal(f.memory.listForHost().length, 0);
    const events = f.store.events(accepted.run.id); assert.ok(!events.some(event => event.type === 'delivery_succeeded'));
    assert.equal((await f.request(`/api/runs/${accepted.run.id}/ack`, {})).status, 409); assert.deepEqual(f.store.events(accepted.run.id), events);
    for (const changed of [{ text: '篡改正文', selection: input.selection }, { text: input.text, selection: {} }, { ...expected(input), threadId: randomUUID() }])
      assert.ok([400, 409].includes((await f.request(`/api/work-routes/${input.requestId}/confirm`, changed)).status));
    const first = await f.request(`/api/work-routes/${input.requestId}/confirm`, expected(input)); assert.equal(first.status, 202); const job = await first.json() as WebWorkJob;
    const second = await f.request(`/api/work-routes/${input.requestId}/confirm`, expected(input)); assert.equal((await second.json() as WebWorkJob).id, job.id);
    assert.equal(job.requestId, input.requestId); assert.equal(job.instruction, input.text); assert.equal(job.status, 'queued'); assert.equal(job.runId, null);
    await f.restart(); await f.login(); f.channel.workThreads!.update(f.thread.id, { status: 'archived' });
    const replay = await f.request(`/api/work-routes/${input.requestId}/confirm`, expected(input)); assert.equal(replay.status, 202); assert.equal((await replay.json() as WebWorkJob).id, job.id);
    assert.equal(f.store.workJobs.list(f.channel.workThreads!.binding).length, 1); assert.equal(f.payloads.length, 1);
  } finally { await f.close(); }
});

test('首次确认重新核对归档/当前归属与对象关系；Job原文/主题冲突409', async () => {
  const f = await fixture(); try {
    const input = f.input(); await submit(f, input); await settled(f, input.requestId); f.channel.workThreads!.update(f.thread.id, { status: 'archived' });
    assert.equal((await f.request(`/api/work-routes/${input.requestId}/confirm`, expected(input))).status, 409);
    f.channel.workThreads!.update(f.thread.id, { status: 'active' });
    const task = f.store.createTask('明确关联对象', now, now, webTarget); f.channel.workThreads!.link(f.thread.id, 'task', task.id);
    const seeded = f.input('合成持久建议原文', { threadId: f.thread.id, object: { kind: 'task', id: task.id } });
    // 持久结果夹具只验证首次确认的现态检查，不冒充真实模型能越过B1生成此结构。
    const run = f.store.webUi.accept(webOwner, seeded.requestId, seeded.text, now, 'suggest', JSON.stringify(seeded.selection));
    f.store.event(run.id, 'work_route_suggested', JSON.stringify({ kind: 'work', threadId: f.thread.id, source: 'model' })); f.store.finishRun(run.id, 'succeeded', now, '夹具建议');
    f.channel.workThreads!.unlink(f.thread.id, 'task', task.id);
    assert.equal((await f.request(`/api/work-routes/${seeded.requestId}/confirm`, expected(seeded))).status, 409);
    f.store.workJobs.create(f.channel.workThreads!.binding, f.thread.id, input.requestId, '另一份正文', now);
    assert.equal((await f.request(`/api/work-routes/${input.requestId}/confirm`, expected(input))).status, 409);
  } finally { await f.close(); }
});

test('revoke先于接纳、完成后撤销、编辑期待值冲突和重开都不误建Job，不重调模型', async () => {
  const f = await fixture(); try {
    const early = f.input(); assert.equal((await f.request(`/api/work-routes/${early.requestId}/revoke`, expected(early))).status, 200);
    const replay = await submit(f, early); assert.equal(replay.revoked, true); assert.equal(replay.run.status, 'interrupted'); assert.equal(f.payloads.length, 0);
    assert.equal((await f.request(`/api/work-routes/${early.requestId}/confirm`, expected(early))).status, 409);
    const later = f.input(); await submit(f, later); await settled(f, later.requestId);
    assert.equal((await f.request(`/api/work-routes/${later.requestId}/revoke`, { ...expected(later), text: '改过原文' })).status, 409);
    assert.equal((await f.request(`/api/work-routes/${later.requestId}/revoke`, expected(later))).status, 200);
    assert.equal((await f.request(`/api/work-routes/${later.requestId}/confirm`, expected(later))).status, 409);
    await f.restart(); await f.login(); assert.equal((await submit(f, later)).revoked, true);
    assert.equal(f.store.workJobs.list(f.channel.workThreads!.binding).length, 0); assert.equal(f.payloads.length, 1);
  } finally { await f.close(); }
});

test('建议在途普通Chat仍可用；撤销中断建议，迟到响应/旧撤销不覆盖新请求', async t => {
  let unblock: () => void = () => {}, started: () => void = () => {};
  const gate = new Promise<void>(resolve => { unblock = resolve; }), seen = new Promise<void>(resolve => { started = resolve; });
  let first = true;
  const f = await fixture(async p => {
    if (routing(p) && first) { first = false; started(); await gate; return reply(JSON.stringify({ kind: 'chat', reason: '迟到的旧建议' })); }
    return reply(routing(p) ? JSON.stringify({ kind: 'chat', reason: '新的建议' }) : '独立普通聊天回答');
  }); try {
    const old = f.input(); await submit(f, old); await seen;
    assert.equal(f.channel.snapshot().capabilities.busy, false); assert.equal(f.channel.snapshot().capabilities.workRoutingBusy, true);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: '建议期间继续普通讨论' })).status, 202);
    for (let i = 0; i < 100 && f.channel.snapshot().chats[0]?.run.status === 'running'; i++) await delay(10);
    assert.equal(f.channel.snapshot().chats[0]?.run.status, 'succeeded');
    const revoked = await f.request(`/api/work-routes/${old.requestId}/revoke`, expected(old)); assert.equal(revoked.status, 200);
    const events = f.store.events((await revoked.json() as WebWorkRoute).run.id); unblock(); await delay(50);
    assert.deepEqual(f.store.events(f.store.webUi.find(webOwner, old.requestId)!.runId), events);
    const next = f.input('用户编辑后的新原文'); await submit(f, next); const view = await settled(f, next.requestId); assert.equal(view.text, next.text);
    assert.equal((await f.request(`/api/work-routes/${old.requestId}/revoke`, expected(old))).status, 200);
    assert.equal((await settled(f, next.requestId)).revoked, false); assert.equal(f.store.workJobs.list(f.channel.workThreads!.binding).length, 0);
    t.diagnostic('实际RouterHTTP=2，普通ChatHTTP=1；在途并存，撤销后旧结果无迟到写入'); assert.equal(f.payloads.filter(routing).length, 2); assert.equal(f.payloads.length, 3);
  } finally { unblock(); await f.close(); }
});

test('已接纳但未执行建议重启仅interrupted；超过100条建议不挤掉关闭后的原Chat历史', async () => {
  const f = await fixture(); try {
    const chatId = randomUUID(), chat = f.store.webUi.accept(webOwner, chatId, '应保留的旧聊天', now); f.store.finishRun(chat.id, 'succeeded', now, '旧回答');
    const pending = f.input(); f.store.webUi.accept(webOwner, pending.requestId, pending.text, now, 'suggest', JSON.stringify(pending.selection));
    for (let i = 0; i < 101; i++) { const run = f.store.webUi.accept(webOwner, randomUUID(), '历史建议'+i, now, 'suggest'); f.store.finishRun(run.id, 'failed', now, undefined, '合成历史失败'); }
    assert.equal(f.channel.snapshot().suggestions?.length, 100); assert.equal(f.channel.snapshot().chats[0]?.text, '应保留的旧聊天');
    await f.restart(); await f.login(); assert.equal((await submit(f, pending)).run.status, 'interrupted'); assert.equal(f.payloads.length, 0);
    f.config.workRoutingEnabled = false; await f.restart(); await f.login(); const snapshot = f.channel.snapshot();
    assert.equal(snapshot.suggestions, undefined); assert.equal(snapshot.chats.length, 1); assert.equal(snapshot.chats[0]?.text, '应保留的旧聊天');
    assert.equal((await f.request(`/api/work-routes/${pending.requestId}`)).status, 404); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('Goal/Task建议只定位不ACK/Grant或写Memory；原文回Chat仍由原入口处理，普通与2A无额外路由', async () => {
  const f = await fixture(); try {
    const task = f.store.createTask('原Task状态', now, now, webTarget);
    const goal = f.store.goals.create({ ownerId: 'local-user', target: webTarget }, f.store.beginRun(null, now).id, '原Goal目标', now);
    for (const [kind, object] of [['task', task], ['goal', goal]] as const) {
      f.channel.workThreads!.link(f.thread.id, kind, object.id);
      const input = f.input('只讨论这个对象，不执行控制', { object: { kind, id: object.id } }); await submit(f, input); const view = await settled(f, input.requestId);
      assert.equal(view.suggestion?.kind, `existing_${kind}`); assert.equal(view.run.usage.calls, 0);
      assert.equal((await f.request(`/api/work-routes/${input.requestId}/confirm`, expected(input))).status, 409);
      assert.equal((await f.request(`/api/runs/${view.run.id}/ack`, {})).status, 409);
      assert.ok(!f.store.events(view.run.id).some(event => event.type.includes('authorized') || event.type === 'delivery_succeeded'));
    }
    assert.equal(f.store.getTask(task.id)?.status, task.status); assert.equal(f.store.goals.get({ ownerId: 'local-user', target: webTarget }, goal.id).status, goal.status);
    assert.equal(f.memory.listForHost().length, 0); assert.equal(f.payloads.length, 0);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: '只讨论这个对象，不执行控制' })).status, 202); await f.channel.drain(); assert.equal(f.payloads.filter(routing).length, 0); assert.equal(f.payloads.length, 1);
    assert.equal((await f.request('/api/work-jobs', { requestId: randomUUID(), threadId: f.thread.id, text: '原显式后台' })).status, 202); assert.equal(f.payloads.length, 1);
    const timeline = chatTimeline(f.channel.snapshot()); assert.equal(timeline.filter(entry => entry.kind === 'suggestion').length, 2); assert.equal(timeline.filter(entry => entry.kind === 'chat').length, 1);
  } finally { await f.close(); }
});

test('14KiB ASCII建议和中文原文完整保存/恢复，回原Chat超10000字符清楚拒绝不截断', async () => {
  const f = await fixture(); try {
    const input = f.input('A'.repeat(14336)); await submit(f, input); const view = await settled(f, input.requestId); assert.equal(view.text, input.text);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: view.text })).status, 400); assert.equal(f.channel.snapshot().chats.length, 0);
    const chinese = f.input('中'.repeat(4700)); await submit(f, chinese); assert.equal((await settled(f, chinese.requestId)).text, chinese.text);
    const raw = await (await f.request(`/api/runs/${view.run.id}`)).json() as WebRun; assert.equal(raw.mode, 'suggest');
    assert.equal(f.store.workJobs.list(f.channel.workThreads!.binding).length, 0); assert.equal(f.payloads.length, 2);
  } finally { await f.close(); }
});
