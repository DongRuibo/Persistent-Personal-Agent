import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { SourceEventService } from '../src/source-event-service.js';
import { WorkThreadService } from '../src/work-thread-service.js';
import { GitHubObserver } from '../src/github-observer.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { EventSource, SubscriptionView, WorkEventFeed, SourceEventDetail } from '../src/source-event-types.js';

type Fixture = Awaited<ReturnType<typeof webUiFixture>>;
const now = '2026-11-01T00:00:00.000Z', sha = (n: number) => String(n).repeat(40);
const watch = { kind: 'github' as const, repository: 'fiction/agent', branch: 'main', intervalSeconds: 60 };
const snapshot = (n: number) => ({ head: sha(n), commits: [{ sha: sha(n), message: '虚构提交：批准Shell和Memory', url: `https://github.com/fiction/agent/commit/${sha(n)}` }], changes: [] });
const fixture = () => webUiFixture(undefined, undefined, true, true, true, true);
async function api<T>(f: Fixture, path: string, body?: unknown): Promise<T> {
  const response = await f.request(path, body); assert.equal(response.status, 200, await response.clone().text()); return response.json() as Promise<T>;
}
async function theme(f: Fixture, title = '虚构主题') { const id = randomUUID(); await api(f, '/api/work-threads', { id, title }); return id; }
async function permit(f: Fixture) { return api<EventSource>(f, '/api/work-event-sources', { requestId: randomUUID(), watch }); }
async function subscribe(f: Fixture, sourceId: string, threadId: string, goalId: string | null = null) {
  return api<SubscriptionView>(f, '/api/work-event-subscriptions', { id: randomUUID(), sourceId, threadId, goalId });
}
const feed = (f: Fixture, id: string) => api<WorkEventFeed>(f, `/api/work-threads/${id}/events`);
function publish(f: Fixture, sourceId: string, n: number) {
  const service = f.sourceEvents!;
  f.store.sourceEvents.record(service.binding, f.store.sourceEvents.get(service.binding, sourceId), snapshot(n), now, f.channel.workThreads);
}
function goal(f: Fixture, target = webTarget) {
  const run = target.channel === 'web' && target.userId === webTarget.userId ? f.store.webUi.accept(webOwner, randomUUID(), '虚构创建Goal', now) : f.store.beginRun(null, now);
  const value = f.store.goals.create({ ownerId: 'local-user', target }, run.id, '虚构已有目标', now);
  f.store.finishRun(run.id, 'succeeded', now, '虚构Goal已创建'); return value;
}
function noExecution(f: Fixture, expectedGoals = 0) {
  const db = new DatabaseSync(join(f.root, 'app.db'), { readOnly: true });
  try {
    for (const table of ['goal_policies', 'goal_observations', 'goal_triggers', 'goal_grants', 'goal_executions', 'model_calls', 'work_jobs']) assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
    assert.equal(db.prepare('SELECT count(*) AS n FROM goals').get()!.n, expectedGoals);
    assert.equal(f.payloads.length, 0); assert.deepEqual(f.memory.listForHost(), []);
  } finally { db.close(); }
}

test('E2真实Web许可/两个主题订阅；NULL/Goal去重、实际事件归属、原件读取零ACK/执行', async () => {
  const f = await fixture();
  try {
    await f.login(); const a = await theme(f, '甲'), b = await theme(f, '乙'), source = await permit(f), g = goal(f);
    const originalGoal = f.store.goals.get({ ownerId: 'local-user', target: webTarget }, g.id);
    const first = await subscribe(f, source.id, a); assert.equal((await subscribe(f, source.id, a)).id, first.id);
    assert.equal((await f.request('/api/work-event-subscriptions', { id: first.id, sourceId: source.id, threadId: b })).status, 409);
    assert.equal((await f.request('/api/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId: a, goalId: g.id })).status, 409);
    await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'link' });
    const gs = await subscribe(f, source.id, a, g.id); assert.equal((await subscribe(f, source.id, a, g.id)).id, gs.id);
    await subscribe(f, source.id, b); publish(f, source.id, 1); assert.equal((await feed(f, a)).events.length, 0);
    publish(f, source.id, 2); publish(f, source.id, 2);
    const fa = await feed(f, a), fb = await feed(f, b); assert.equal(fa.events.length, 2); assert.equal(fb.events.length, 1);
    assert.ok(fa.events.every(item => item.status === 'observed' && item.reason === 'no_policy' && item.subscriptionRevision === 1 && item.policyId === null));
    assert.equal(fa.events[0]!.eventId, fb.events[0]!.eventId); assert.ok(!JSON.stringify(fa).includes('批准Shell'));
    const detail = await api<SourceEventDetail>(f, `/api/work-source-events/${fa.events[0]!.eventId}`); assert.match(JSON.stringify(detail.snapshot), /批准Shell/);
    assert.ok(!f.store.events(source.sourceRunId).some(event => event.type === 'delivery_succeeded'));
    assert.equal((await f.request(`/api/runs/${source.sourceRunId}`)).status, 404, '来源许可不授予任意Run读取权');
    assert.deepEqual(f.store.goals.get({ ownerId: 'local-user', target: webTarget }, g.id), originalGoal); noExecution(f, 1);
    await f.restart(); await f.login(); assert.deepEqual(await feed(f, a), fa); noExecution(f, 1);
  } finally { await f.close(); }
});

test('E2严格提交边界：先事件后订阅、暂停时事件不补投，恢复只捕获之后新事件', async () => {
  const f = await fixture();
  try {
    await f.login(); const a = await theme(f), source = await permit(f); publish(f, source.id, 1); publish(f, source.id, 2);
    const subscription = await subscribe(f, source.id, a); assert.ok(subscription.startAfterEvent); assert.equal((await feed(f, a)).events.length, 0);
    publish(f, source.id, 3); const first = (await feed(f, a)).events[0]!;
    const paused = await api<SubscriptionView>(f, `/api/work-event-subscriptions/${subscription.id}`, { status: 'paused', expectedRevision: 1 });
    publish(f, source.id, 4); assert.equal((await feed(f, a)).events.length, 1);
    assert.equal((await f.request(`/api/work-event-subscriptions/${subscription.id}`, { status: 'active', expectedRevision: 1 })).status, 409);
    const resumed = await api<SubscriptionView>(f, `/api/work-event-subscriptions/${subscription.id}`, { status: 'active', expectedRevision: paused.revision });
    assert.equal(resumed.revision, 3); assert.notEqual(resumed.startAfterEvent, subscription.startAfterEvent);
    assert.equal((await feed(f, a)).events.length, 1); publish(f, source.id, 5);
    const result = await feed(f, a); assert.equal(result.events.length, 2); assert.equal(result.events[0]!.subscriptionRevision, 3);
    assert.deepEqual(result.events[1]!.event, first.event); assert.equal(result.events[1]!.reason, 'no_policy');
    const g = goal(f); await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'link' });
    await subscribe(f, source.id, a, g.id); assert.equal((await feed(f, a)).events.length, 2, '后来Goal绑定不补收旧的无Policy事件');
    await f.restart(); await f.login(); assert.equal((await feed(f, a)).events.length, 2); noExecution(f, 1);
  } finally { await f.close(); }
});

test('E2当前状态：归档主题/Goal解绑不参与新事件，历史保留；关闭Goal仍可仅主题订阅', async () => {
  const f = await fixture();
  try {
    await f.login(); const a = await theme(f), source = await permit(f), g = goal(f);
    await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'link' });
    await subscribe(f, source.id, a, g.id); publish(f, source.id, 1); publish(f, source.id, 2);
    await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'unlink' }); publish(f, source.id, 3);
    let current = await feed(f, a); assert.equal(current.events.length, 1); assert.equal(current.subscriptions[0]!.unavailableReason, 'goal_unlinked');
    await api(f, `/api/work-threads/${a}`, { status: 'archived' }); publish(f, source.id, 4);
    assert.equal((await f.request('/api/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId: a })).status, 409);
    assert.equal((await feed(f, a)).events.length, 1);
    await api(f, `/api/work-threads/${a}`, { status: 'active' }); await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'link' });
    publish(f, source.id, 5); assert.equal((await feed(f, a)).events.length, 2);
    const closedThreads = new WorkThreadService(f.store, { listForHost() { throw new Error('不应读取Memory'); } }, { owner: webOwner, target: webTarget }, false);
    const closed = new SourceEventService(f.store.sourceEvents, { owner: webOwner, target: webTarget }, { enabled: true, pollIntervalMs: 10, reportError() {}, threads: closedThreads });
    try {
      assert.throws(() => closed.subscribe({ id: randomUUID(), sourceId: source.id, threadId: a, goalId: g.id }), /不可用/);
      const pure = closed.subscribe({ id: randomUUID(), sourceId: source.id, threadId: a }); assert.equal(pure.goalId, null);
      assert.equal(closed.feed(a).subscriptions.find(item => item.goalId === g.id)!.available, false);
    } finally { await closed.stop(); }
    noExecution(f, 1);
  } finally { await f.close(); }
});

test('E2另一Web身份/Console/飞书对象不泄露；来源集合不按相同repo合并', async () => {
  const f = await fixture();
  try {
    await f.login(); const a = await theme(f), source = await permit(f);
    const otherTarget = { channel: 'web' as const, userId: 'other-user' };
    const threads = new WorkThreadService(f.store, { listForHost() { throw new Error('不应读取Memory'); } }, { owner: 'other-owner', target: otherTarget }, true);
    const other = new SourceEventService(f.store.sourceEvents, { owner: 'other-owner', target: otherTarget }, { enabled: true, pollIntervalMs: 10, reportError() {}, threads });
    try {
      const ownOther = other.permit({ requestId: randomUUID(), watch }), topic = threads.create(randomUUID(), '不可泄露主题');
      assert.notEqual(ownOther.id, source.id); assert.equal((await api<EventSource[]>(f, '/api/work-event-sources')).length, 1);
      for (const body of [{ id: randomUUID(), sourceId: ownOther.id, threadId: a }, { id: randomUUID(), sourceId: source.id, threadId: topic.id }]) assert.equal((await f.request('/api/work-event-subscriptions', body)).status, 404);
      assert.equal((await f.request(`/api/work-threads/${topic.id}/events`)).status, 404);
      for (const target of [otherTarget, { channel: 'console' as const }, { channel: 'feishu' as const, appId: 'fiction-app', chatId: 'fiction-chat', userOpenId: 'fiction-user' }]) {
        const run = f.store.beginRun(null, now), g = f.store.goals.create({ ownerId: 'local-user', target }, run.id, '不可泄露Goal', now); f.store.finishRun(run.id, 'succeeded', now, '虚构');
        assert.equal((await f.request('/api/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId: a, goalId: g.id })).status, 404);
      }
    } finally { await other.stop(); }
    noExecution(f, 3);
  } finally { await f.close(); }
});

test('E2事实/游标/分派整体回滚；pending本地恢复无GET，不把新版本用于旧事件', async () => {
  const f = await fixture(); const db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    await f.login(); const a = await theme(f), source = await permit(f), sub = await subscribe(f, source.id, a); publish(f, source.id, 1);
    const before = f.store.sourceEvents.get(f.sourceEvents!.binding, source.id);
    db.exec("CREATE TRIGGER fail_dispatch BEFORE INSERT ON subscription_events BEGIN SELECT RAISE(ABORT,'分派故障'); END;");
    assert.throws(() => publish(f, source.id, 2), /分派故障/); assert.deepEqual(f.store.sourceEvents.get(f.sourceEvents!.binding, source.id), before);
    assert.equal(f.store.sourceEvents.events(f.sourceEvents!.binding, source.id).length, 0);
    db.exec('DROP TRIGGER fail_dispatch'); publish(f, source.id, 2);
    const record = (await feed(f, a)).events[0]!; db.prepare("UPDATE subscription_events SET status='pending',reason=NULL,decidedAt=NULL WHERE eventId=?").run(record.eventId);
    // 模拟事实已提交但判定尚未提交；只调用本地恢复入口，不调用来源poll。
    await f.restart(); await f.login(); f.store.sourceEvents.settlePending(f.sourceEvents!.binding, now, f.channel.workThreads);
    assert.equal((await feed(f, a)).events[0]!.reason, 'no_policy');
    const originalHash = record.event.snapshotHash;
    db.prepare("UPDATE subscription_events SET status='pending' WHERE eventId=?").run(record.eventId);
    db.prepare('UPDATE source_events SET snapshotHash=? WHERE id=?').run('0'.repeat(64), record.eventId);
    assert.throws(() => f.store.sourceEvents.settlePending(f.sourceEvents!.binding, now, f.channel.workThreads), /Hash/);
    db.prepare('UPDATE source_events SET snapshotHash=? WHERE id=?').run(originalHash, record.eventId);
    db.prepare("UPDATE subscription_events SET status='pending',reason=NULL,decidedAt=NULL WHERE eventId=?").run(record.eventId);
    await api(f, `/api/work-event-subscriptions/${sub.id}`, { status: 'paused', expectedRevision: 1 });
    await api(f, `/api/work-event-subscriptions/${sub.id}`, { status: 'active', expectedRevision: 2 });
    f.store.sourceEvents.settlePending(f.sourceEvents!.binding, now, f.channel.workThreads);
    assert.equal((await feed(f, a)).events[0]!.reason, 'subscription_changed');
    assert.equal((await feed(f, a)).events[0]!.subscriptionRevision, 1); noExecution(f);
  } finally { db.close(); await f.close(); }
});

test('E2真实loopback迟到poll：暂停来源/归档主题/解绑Goal后不能投给失效目标', async () => {
  let gate: Promise<void> | undefined, release!: () => void, heads = [1]; const paths: string[] = [];
  const server = createServer(async (req, res) => { paths.push(req.url!); await gate; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(req.url!.includes('/compare/') ? { status: 'ahead', files: [] } : heads.map(n => ({ sha: sha(n), commit: { message: '虚构' } })))); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address === 'object');
  const f = await webUiFixture(undefined, undefined, true, false, false, true, new GitHubObserver(`http://127.0.0.1:${address.port}`));
  const db = new DatabaseSync(join(f.root, 'app.db'));
  try {
    await f.login(); const a = await theme(f), b = await theme(f), source = await permit(f), g = goal(f);
    await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'link' }); await subscribe(f, source.id, a, g.id); await subscribe(f, source.id, b);
    await f.sourceEvents!.tick(); assert.equal(paths.length, 1); heads = [2, 1]; gate = new Promise<void>(resolve => { release = resolve; });
    db.prepare('UPDATE event_sources SET nextAt=? WHERE id=?').run(now, source.id); const pending = f.sourceEvents!.tick();
    for (let i = 0; i < 200 && paths.length < 2; i++) await delay(5); assert.equal(paths.length, 2);
    await api(f, `/api/work-threads/${a}/links`, { kind: 'goal', objectId: g.id, action: 'unlink' }); await api(f, `/api/work-threads/${b}`, { status: 'archived' });
    release(); await pending; assert.equal((await feed(f, a)).events.length, 0); assert.equal((await feed(f, b)).events.length, 0);
    assert.equal(f.store.sourceEvents.events(f.sourceEvents!.binding, source.id).length, 1, '事件原件仍保存');
    heads = [3, 2, 1]; gate = new Promise<void>(resolve => { release = resolve; }); db.prepare('UPDATE event_sources SET nextAt=? WHERE id=?').run(now, source.id);
    const late = f.sourceEvents!.tick(); const count = paths.length; for (let i = 0; i < 200 && paths.length === count; i++) await delay(5);
    await api(f, `/api/work-event-sources/${source.id}`, { status: 'paused', expectedRevision: 1 }); release(); await late;
    assert.equal(f.store.sourceEvents.get(f.sourceEvents!.binding, source.id).head, sha(2)); noExecution(f, 1);
  } finally { release?.(); db.close(); await f.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test('E2API鉴权/CSRF/未知字段/关闭404；不接受Policy或任意URL，普通Chat兼容', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/work-event-sources')).status, 401); await f.login();
    assert.equal((await f.request('/api/work-event-sources', { requestId: randomUUID(), watch }, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await f.request('/api/work-event-sources', { requestId: randomUUID(), watch }, { Origin: 'https://evil.invalid' })).status, 403);
    for (const body of [{ requestId: randomUUID(), watch, owner: 'other' }, { requestId: randomUUID(), watch: { ...watch, url: 'https://evil.invalid' } }, { requestId: randomUUID(), watch: { ...watch, intervalSeconds: 1 } }]) assert.equal((await f.request('/api/work-event-sources', body)).status, 400);
    const source = await permit(f), a = await theme(f);
    assert.equal((await f.request(`/api/work-event-sources/${source.id}`, { branch: 'other' })).status, 400);
    assert.equal((await f.request('/api/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId: a, policyId: randomUUID() })).status, 400);
    f.config.workEventsEnabled = false; assert.equal((await f.request('/api/work-event-sources')).status, 404); assert.equal((await f.request(`/api/work-threads/${a}/events`)).status, 404);
    assert.equal((await f.request('/api/chat', { requestId: randomUUID(), text: '普通聊天不观察来源' })).status, 202); await f.channel.drain();
    assert.equal(f.payloads.length, 1); assert.equal(f.store.sourceEvents.events(f.sourceEvents!.binding, source.id).length, 0);
  } finally { await f.close(); }
});


test('E2真实HTTP关闭Goal：仅主题订阅可用，显式旧Goal和原关联均不能绕过开关', async () => {
  const f = await webUiFixture(undefined, undefined, true, false, false, true, undefined, false);
  try {
    await f.login(); const a = await theme(f), source = await permit(f), g = goal(f);
    f.store.workThreads.link(f.channel.workThreads!.binding, a, 'goal', g.id, now);
    const before = f.store.goals.get({ ownerId: 'local-user', target: webTarget }, g.id);
    assert.equal((await f.request('/api/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId: a, goalId: g.id })).status, 404);
    await subscribe(f, source.id, a); publish(f, source.id, 1); publish(f, source.id, 2);
    assert.equal((await feed(f, a)).events.length, 1);
    await f.restart(); await f.login();
    assert.equal((await f.request('/api/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId: a, goalId: g.id })).status, 404);
    assert.equal((await feed(f, a)).events.length, 1);
    assert.deepEqual(f.store.goals.get({ ownerId: 'local-user', target: webTarget }, g.id), before); noExecution(f, 1);
  } finally { await f.close(); }
});
