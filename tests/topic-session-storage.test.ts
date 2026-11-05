import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';
import { test } from 'node:test';
import { parseTopicRouteChoice } from '../src/topic-route-types.js';
import type { TopicRouteChoice } from '../src/topic-route-types.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';

const now = '2026-11-03T00:00:00.000Z', actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'topic-storage-')), path = join(root, 'app.db');
  const store = new SqliteStore(path), db = new DatabaseSync(path);
  return { root, path, store, db, close() { db.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}
const create: TopicRouteChoice = { kind: 'create', title: '健身', description: '训练、饮食与每周反馈', reason: '当前明确持续事项' };

test('旧库迁移保留原主题/链接/正文/状态/Run/Job，旧主题不自动绑定', () => {
  const f = fixture(); let reopened: SqliteStore | undefined;
  try {
    const thread = f.store.workThreads.create(actor, randomUUID(), '旧短文主题', now);
    const run = f.store.webUi.accept(actor.owner, randomUUID(), '旧正文\n中文', now);
    f.store.finishRun(run.id, 'succeeded', now, '原成果');
    f.store.workThreads.link(actor, thread.id, 'run', run.id, now);
    f.store.workJobs.create(actor, thread.id, randomUUID(), '旧后台工作', now);
    f.store.webUi.enqueue(actor.owner, randomUUID(), '旧等待消息', now);
    f.store.close();
    f.db.exec(`ALTER TABLE work_threads DROP COLUMN description; ALTER TABLE work_threads DROP COLUMN chatContextKey;
      ALTER TABLE web_ui_chats DROP COLUMN topicSessions; ALTER TABLE web_ui_chats DROP COLUMN topicRouteJson;`);
    const snapshot = () => ({ threads: f.db.prepare('SELECT id,owner,channel,title,status,createdAt,updatedAt FROM work_threads').all(),
      links: f.db.prepare('SELECT * FROM work_links').all(), chats: f.db.prepare('SELECT owner,requestId,runId,text,mode,selectionJson,status,createdAt,coordinator FROM web_ui_chats').all(),
      runs: f.db.prepare('SELECT * FROM runs').all(), jobs: f.db.prepare('SELECT * FROM work_jobs').all() });
    const before = snapshot(); reopened = new SqliteStore(f.path);
    assert.deepEqual(snapshot(), before);
    assert.equal(reopened.workThreads.get(actor, thread.id).description, '');
    assert.equal(reopened.workThreads.get(actor, thread.id).chatContextKey, null);
    assert.ok(reopened.webUi.requests(actor.owner).every(row => row.topicSessions === 0 && row.topicRoute === null));
    assert.equal(reopened.workThreads.create(actor, randomUUID(), '迁移后旧入口', now).chatContextKey, null);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { reopened?.close(); f.db.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('新主题与route同事务冻结，同UUID重投只回读；真实重开保留绑定与标题快照', () => {
  const f = fixture(); let reopened: SqliteStore | undefined;
  try {
    const id = randomUUID();
    const queued = f.store.webUi.enqueue(actor.owner, id, '以后在这里帮我健身', now, true);
    assert.equal(queued.topicSessions, 1); assert.equal(queued.topicRoute, null);
    const route = f.store.webUi.freezeTopicRoute(actor, id, create, now);
    assert.equal(route.kind, 'topic'); if (route.kind !== 'topic') throw new Error('topic');
    assert.match(route.contextKey, /^topic-[a-f0-9-]{36}$/u);
    assert.equal(f.store.workThreads.get(actor, route.threadId).chatContextKey, route.contextKey);
    assert.deepEqual(f.store.webUi.freezeTopicRoute(actor, id, create, now), route);
    assert.equal(f.store.workThreads.list(actor).length, 1); assert.equal(f.store.listRuns().length, 0);
    // 重启后开关变化不能把已接收模式视为冲突，正文变化仍然拒绝。
    assert.deepEqual(f.store.webUi.enqueue(actor.owner, id, queued.text, now, false), f.store.webUi.find(actor.owner, id));
    assert.throws(() => f.store.webUi.enqueue(actor.owner, id, '改变正文', now, true), /其他内容/);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, id, { ...create, title: '另一主题' }, now), /冻结/);
    f.store.workThreads.update(actor, route.threadId, { title: '已改名' }, now);
    assert.deepEqual(f.store.webUi.freezeTopicRoute(actor, id, create, now), route);
    f.store.close(); reopened = new SqliteStore(f.path);
    assert.deepEqual(reopened.webUi.find(actor.owner, id)?.topicRoute, route);
    assert.equal(reopened.workThreads.get(actor, route.threadId).chatContextKey, route.contextKey);
  } finally { reopened?.close(); f.db.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('日常与澄清不创建主题，领取按接收模式筛选而不降级；原队列仍执行', () => {
  const f = fixture(); try {
    const dailyId = randomUUID(), clarifyId = randomUUID(), oldId = randomUUID();
    f.store.webUi.enqueue(actor.owner, dailyId, '生日祝福', now, true);
    assert.deepEqual(f.store.webUi.freezeTopicRoute(actor, dailyId, { kind: 'daily', reason: '临时文字' }, now), { kind: 'daily', reason: '临时文字' });
    f.store.webUi.enqueue(actor.owner, clarifyId, '这个计划改一下', now, true);
    const clarify: TopicRouteChoice = { kind: 'clarify', question: '先处理哪个主题？', reason: '两个合理对象' };
    assert.deepEqual(f.store.webUi.freezeTopicRoute(actor, clarifyId, clarify, now), clarify);
    assert.equal(f.store.workThreads.list(actor).length, 0);
    f.store.webUi.enqueue(actor.owner, oldId, '旧模式消息', now);
    assert.equal(f.store.webUi.claim(actor.owner, now)?.requestId, oldId);
    assert.equal(f.store.webUi.claim(actor.owner, now), undefined);
    assert.equal(f.store.webUi.find(actor.owner, dailyId)?.status, 'queued');
    assert.equal(f.store.webUi.claim(actor.owner, now, 'all')?.requestId, dailyId);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, oldId, create, now), /主题模式/);
  } finally { f.close(); }
});

test('旧主题仅显式选用后绑定，已绑定key稳定；owner/channel/错误及归档ID拒绝', () => {
  const f = fixture(); try {
    const thread = f.store.workThreads.create(actor, randomUUID(), '求职', now);
    const use: TopicRouteChoice = { kind: 'use', threadId: thread.id, reason: '已有主题' };
    const accept = () => { const id = randomUUID(); f.store.webUi.enqueue(actor.owner, id, '当前消息', now, true); return id; };
    const first = accept(); assert.throws(() => f.store.webUi.freezeTopicRoute(actor, first, use, now), /明确选用/);
    assert.equal(f.store.workThreads.get(actor, thread.id).chatContextKey, null);
    const bound = f.store.webUi.freezeTopicRoute(actor, first, use, now, thread.id);
    assert.equal(bound.kind, 'topic'); if (bound.kind !== 'topic') throw new Error('topic');
    const second = f.store.webUi.freezeTopicRoute(actor, accept(), use, now);
    assert.equal(second.kind === 'topic' && second.contextKey, bound.contextKey);
    assert.equal(f.store.workThreads.list(actor).length, 1);
    for (const other of [{ ...actor, owner: 'foreign' }, { ...actor, channel: 'console' }]) {
      const foreign = f.store.workThreads.create(other, randomUUID(), '私有主题', now), id = accept();
      assert.throws(() => f.store.webUi.freezeTopicRoute(actor, id, { ...use, threadId: foreign.id }, now), /无权/);
      assert.equal(f.store.webUi.find(actor.owner, id)?.topicRoute, null);
      assert.equal(f.store.workThreads.get(other, foreign.id).chatContextKey, null);
    }
    assert.throws(() => f.store.webUi.freezeTopicRoute({ ...actor, owner: 'foreign' }, first, use, now), /不存在/);
    assert.throws(() => f.store.webUi.freezeTopicRoute({ ...actor, channel: 'console' }, first, use, now, thread.id), /无权/);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, accept(), { ...use, threadId: randomUUID() }, now), /无权/);
    f.store.workThreads.update(actor, thread.id, { status: 'archived' }, now);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, accept(), use, now), /归档/);
  } finally { f.close(); }
});

test('冻结route写入故障时新主题和旧主题绑定一起回滚，无半成品', () => {
  const f = fixture(); try {
    const thread = f.store.workThreads.create(actor, randomUUID(), '未绑定', now);
    const id = randomUUID(); f.store.webUi.enqueue(actor.owner, id, '持续事项', now, true);
    f.db.exec(`CREATE TRIGGER fail_route BEFORE UPDATE OF topicRouteJson ON web_ui_chats BEGIN SELECT RAISE(ABORT,'injected route failure'); END`);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, id, create, now), /injected/);
    assert.equal(f.store.workThreads.list(actor).length, 1);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, id, { kind: 'use', threadId: thread.id, reason: '明确持续选用' }, now, thread.id), /injected/);
    assert.equal(f.store.workThreads.get(actor, thread.id).chatContextKey, null);
    assert.equal(f.store.webUi.find(actor.owner, id)?.topicRoute, null);
    f.db.exec('DROP TRIGGER fail_route');
    assert.equal(f.store.webUi.freezeTopicRoute(actor, id, create, now).kind, 'topic');
    assert.equal(f.store.workThreads.list(actor).length, 2);
  } finally { f.close(); }
});

test('路由入口拒绝额外字段、路径key、非法ID和无界文字；撤回后不能新冻结', () => {
  const f = fixture(); try {
    const id = randomUUID(); f.store.webUi.enqueue(actor.owner, id, '持续事项', now, true);
    for (const bad of [null, { ...create, contextKey: '/tmp/model-path' }, { ...create, description: '字'.repeat(481) },
      { ...create, title: '' }, { ...create, reason: '字'.repeat(241) }, { kind: 'use', threadId: '../escape', reason: '伪造' },
      { kind: 'use', threadId: randomUUID(), bindUnbound: true, reason: '伪造' }, { kind: 'clarify', reason: '歧义', question: '' }]) {
      assert.throws(() => f.store.webUi.freezeTopicRoute(actor, id, parseTopicRouteChoice(bad), now), /路由/);
    }
    assert.equal(f.store.workThreads.list(actor).length, 0); assert.equal(f.store.webUi.find(actor.owner, id)?.topicRoute, null);
    f.store.webUi.cancelQueued(actor.owner, id);
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor, id, create, now), /撤回/);
  } finally { f.close(); }
});

test('接收时主题标记冻结；N3关闭后旧收据仍可查看/撤回，不能降级执行', async () => {
  const f = await webUiFixture(undefined, undefined, true, true, false, false, undefined, false, undefined, true);
  try {
    await f.login(); f.config.workTopicSessionsEnabled = true;
    const id = randomUUID(), text = '以后在这里帮我健身';
    // N3开启时已可执行；此用例从宿主已接收queued事实验证关闭后的原收据兼容。
    f.store.webUi.enqueue(actor.owner, id, text, new Date().toISOString(), true);
    const first = f.channel.request(id);
    assert.equal(first.topicSessions, 1); assert.equal(first.status, 'queued'); assert.equal(first.run, null);
    assert.equal(f.payloads.length, 0);
    f.config.workTopicSessionsEnabled = false;
    const retry = await f.request('/api/chat', { requestId: id, text });
    assert.equal(retry.status, 202); assert.deepEqual(await retry.json(), first);
    assert.throws(() => f.channel.submit(id, text), /主题模式/);
    await f.restart(); await f.login();
    assert.deepEqual(await (await f.request(`/api/chat-requests/${id}`)).json(), first);
    assert.equal(f.payloads.length, 0);
    const old = await f.request('/api/chat', { requestId: randomUUID(), text: '日常旧模式' }); assert.equal(old.status, 202);
    for (let i = 0; i < 100 && f.payloads.length < 1; i++) await setTimeout(10);
    await f.channel.drain(); assert.equal(f.payloads.length, 1);
    assert.equal(f.store.webUi.find(actor.owner, id)?.status, 'queued');
    f.config.workCoordinatorEnabled = false;
    const disabledRetry = await f.request('/api/chat', { requestId: id, text });
    assert.equal(disabledRetry.status, 202); assert.deepEqual(await disabledRetry.json(), first);
    assert.ok(f.channel.snapshot().requests?.some(row => row.requestId === id));
    assert.equal((await f.request(`/api/chat-requests/${id}`)).status, 200);
    const cancel = await f.request(`/api/chat-requests/${id}/cancel`, {}); assert.equal(cancel.status, 200);
    assert.equal((await cancel.json() as WebRequestReceipt).status, 'cancelled');
    assert.throws(() => f.channel.submit(id, text), /主题模式/);
    assert.equal(f.payloads.length, 1); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});


test('新旧模式共用原八条容量；重投保留首次模式，撤回释放容量', () => {
  const f = fixture(); try {
    const old = f.store.webUi.enqueue(actor.owner, randomUUID(), '旧模式', now);
    assert.deepEqual(f.store.webUi.enqueue(actor.owner, old.requestId, old.text, now, true), old);
    for (let i = 0; i < 7; i++) f.store.webUi.enqueue(actor.owner, randomUUID(), `主题消息${i}`, now, true);
    const ninth = randomUUID(); assert.throws(() => f.store.webUi.enqueue(actor.owner, ninth, '超额', now), /八条/);
    assert.equal(f.store.webUi.find(actor.owner, ninth), undefined);
    assert.deepEqual(f.store.webUi.enqueue(actor.owner, old.requestId, old.text, now, true), old);
    f.store.webUi.cancelQueued(actor.owner, old.requestId);
    assert.equal(f.store.webUi.enqueue(actor.owner, ninth, '容量已释放', now).topicSessions, 0);
  } finally { f.close(); }
});


test('N3宿主决定与route同事务；事件故障回滚主题，失败选择不算实际context', () => {
  const f = fixture(); try {
    const id = randomUUID(); f.store.webUi.enqueue(actor.owner,id,'持续事项',now,true); const claimed = f.store.webUi.claim(actor.owner,now,'all')!;
    f.db.exec("CREATE TRIGGER fail_topic_decision BEFORE INSERT ON run_events WHEN NEW.type='topic_route_frozen' BEGIN SELECT RAISE(ABORT,'decision failure'); END");
    assert.throws(() => f.store.webUi.freezeTopicRoute(actor,id,create,now,undefined,{ action:'chat', candidates:[] }), /decision failure/);
    assert.equal(f.store.workThreads.list(actor).length,0); assert.equal(f.store.webUi.find(actor.owner,id)!.topicRoute,null);
    assert.equal(f.store.webUi.topicDecision(claimed.runId!),undefined); f.db.exec('DROP TRIGGER fail_topic_decision');
    const route = f.store.webUi.freezeTopicRoute(actor,id,create,now,undefined,{ action:'selection',candidates:[] });
    if(route.kind!=='topic')throw new Error('topic');
    f.store.event(claimed.runId!,'topic_context_selected',JSON.stringify({contextKey:route.contextKey}));
    assert.equal(f.store.webUi.previousChatContext(actor.owner,'another'),undefined);
    f.store.finishRun(claimed.runId!,'interrupted',now); assert.equal(f.store.webUi.previousChatContext(actor.owner,'another'),undefined);
    const next = randomUUID(); f.store.webUi.enqueue(actor.owner,next,'切到健身',now,true);const r=f.store.webUi.claim(actor.owner,now,'all')!;
    f.store.webUi.freezeTopicRoute(actor,next,{kind:'use',threadId:route.threadId,reason:'明确选用'},now,undefined,{action:'selection',candidates:[]});
    f.store.event(r.runId!,'topic_context_selected',JSON.stringify({contextKey:route.contextKey}));f.store.finishRun(r.runId!,'succeeded',now,'已切换');
    assert.equal(f.store.webUi.previousChatContext(actor.owner,'another')!.contextKey,route.contextKey);
  } finally { f.close(); }
});

test('主题澄清仅原question完整输出成功ACK/五分钟内/最近普通回合可选择', () => {
  const f=fixture();try {
    const id=randomUUID();f.store.webUi.enqueue(actor.owner,id,'同名',now,true);const row=f.store.webUi.claim(actor.owner,now,'all')!;
    const choice:TopicRouteChoice={kind:'clarify',question:'只选择主题：1.甲',reason:'歧义'};
    f.store.webUi.freezeTopicRoute(actor,id,choice,now,undefined,{action:'chat',candidates:[{id:randomUUID(),title:'甲',description:'范围',bound:true}]});
    f.store.finishRun(row.runId!,'succeeded',now,choice.question);assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)),undefined);
    f.store.event(row.runId!,'delivery_succeeded');assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now))!.candidates.length,1);
    assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)+300001),undefined);
    f.db.prepare('UPDATE runs SET output=? WHERE id=?').run('模型换过的问题',row.runId!);assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)),undefined);
  }finally{f.close();}
});


test('语义补答候选仅answer固定宿主后缀完整成功ACK后有效，旧chat不能借后缀放宽', () => {
  const f=fixture();try {
    const id=randomUUID();f.store.webUi.enqueue(actor.owner,id,'同名补答',now,true);const row=f.store.webUi.claim(actor.owner,now,'all')!;
    const choice:TopicRouteChoice={kind:'clarify',question:'只选择主题：1.甲',reason:'歧义'};
    const decision={action:'answer' as const,candidates:[{id:randomUUID(),title:'甲',description:'范围',bound:true}]};
    f.store.webUi.freezeTopicRoute(actor,id,choice,now,undefined,decision);
    const output='先给实质文字建议。\n\n主题归属：\n'+choice.question;
    f.store.finishRun(row.runId!,'succeeded',now,output);
    assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)),undefined);
    f.store.event(row.runId!,'delivery_succeeded');assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now))!.action,'answer');
    assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)+300001),undefined);
    for(const changed of ['正文'+choice.question,output+'正文',output.replace('1.甲','1.乙')]) {
      f.db.prepare('UPDATE runs SET output=? WHERE id=?').run(changed,row.runId!);
      assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)),undefined);
    }
    f.db.prepare('UPDATE runs SET output=? WHERE id=?').run(output,row.runId!);
    f.db.prepare("UPDATE run_events SET details=? WHERE runId=? AND type='topic_route_frozen'").run(JSON.stringify({...decision,action:'chat'}),row.runId!);
    assert.equal(f.store.webUi.topicClarification(actor.owner,'current',Date.parse(now)),undefined);
  }finally{f.close();}
});
