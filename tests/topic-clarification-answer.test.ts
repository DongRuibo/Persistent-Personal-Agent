import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import type { ServerResponse } from 'node:http';
import type { TopicRouteChoice } from '../src/topic-route-types.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { response } from './helpers/topic-session-n0-fixture.js';
import { content, toolCall, type Payload } from './helpers/skills-fixture.js';

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
const synthetic = '我在准备应用开发面试，整理了三个虚构项目。如果需要，我稍后贴项目概述和简历。后面你能怎样辅助我的求职准备？';
const useful = '可以先核对岗位要求和三个项目的证据，再修改简历、准备项目追问并进行模拟面试。请先贴一个项目的目标、你的职责和已验证结果？';
const usefulBody = useful.split('请先贴')[0]!;
const create = (title: string): TopicRouteChoice => ({ kind: 'create', title, description: '虚构持续讨论', reason: '模型提议' });
const clarify: TopicRouteChoice = { kind: 'clarify', question: '你更需要简历分析还是项目面试练习？', reason: '主题归属待明确' };
const isRoute = (p: Payload) => content(p.messages[0]?.content).includes('你是一次无工具主题归属解析器');
let sequence = 0;
async function fixture(route: (text: string) => unknown = () => create('面试准备'), answer: (p: Payload, res: ServerResponse) => string | void = p => response(content(p.messages[0]?.content).includes('正文不要') ? usefulBody : useful)) {
  const f = await webUiFixture((p, res) => isRoute(p) ? response((output => typeof output === 'string' ? output : JSON.stringify(output))(route(JSON.parse(content(p.messages.at(-1)!.content)).currentMessage))) : answer(p, res),
    undefined, true, true, false, false, undefined, true, undefined, true, true);
  await f.login(); const close = f.close.bind(f), id = ++sequence;
  f.close = async () => {
    if (process.env.N2_EVIDENCE_DIR) {
      mkdirSync(process.env.N2_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.N2_EVIDENCE_DIR, `clarification-${id}.json`), JSON.stringify({ requests: f.rawPayloads.map(raw => ({ raw, bytes: Buffer.byteLength(raw) })),
        threads: f.store.workThreads.list(actor), jobs: f.store.workJobs.list(actor), memory: f.memory.listForHost(),
        goals: f.tasks.withTarget(webTarget, () => f.goals.list()), runs: f.store.listRuns().map(run => ({ ...run, events: f.store.events(run.id), calls: f.store.modelCalls(run.id) })) }, null, 2));
    }
    await close();
  };
  return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function send(f: Fixture, text: string, ack = true) {
  const requestId = randomUUID(); assert.equal((await f.request('/api/chat', { requestId, text })).status, 202);
  for (let i = 0; i < 1200; i++) {
    const row = await (await f.request('/api/chat-requests/' + requestId)).json() as WebRequestReceipt;
    if (row.run && row.run.status !== 'running') {
      if (ack && row.run.status === 'succeeded') assert.equal((await f.request('/api/runs/' + row.runId + '/ack', {})).status, 200);
      return row;
    }
    await setTimeout(5);
  }
  throw new Error('临时假模型回合没有结束');
}
function messages(root: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const file of readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.jsonl')) continue;
    const path = join(file.parentPath, file.name);
    result[path] = readFileSync(path, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => entry.type === 'message');
  }
  return result;
}

test('语义新建被拒仍实质回答当前求职问题：真实SDK两HTTP、零工具/主题/Job/Goal/Memory、零历史写入', async () => {
  const f = await fixture(); try {
    const before = messages(f.config.sessionDir), row = await send(f, synthetic);
    assert.equal(row.run?.status, 'succeeded'); assert.equal(row.topicRoute?.kind, 'clarify');
    assert.equal(row.run?.output, useful); assert.equal(f.store.webUi.topicDecision(row.runId!)?.action, 'answer');
    assert.equal(f.payloads.length, 2); const answer = f.payloads[1]!;
    assert.equal(answer.tools?.length ?? 0, 0); assert.equal(answer.messages.length, 2); assert.equal(content(answer.messages[1]!.content), synthetic);
    assert.match(content(answer.messages[0]!.content), /不能.*保存|没有.*工具/);
    assert.deepEqual(messages(f.config.sessionDir), before); assert.equal(f.store.workThreads.list(actor).length, 0);
    assert.equal(f.store.workJobs.list(actor).length, 0); assert.equal(f.memory.listForHost().length, 0); assert.equal(f.tasks.withTarget(webTarget, () => f.goals.list()).length, 0);
    const calls = f.store.modelCalls(row.runId!); assert.deepEqual(calls.map(call => call.purpose), ['topic_route', 'chat']);
    assert.equal(row.run?.usage.calls, 2); assert.equal(row.run?.usage.unknownCalls, 0);
  } finally { await f.close(); }
});

test('模型语义clarify无候选有具体追问；旧daily与另一主题历史不进入补答，也不追加当前消息', async () => {
  const f = await fixture(text => text === '日常旧消息' ? { kind: 'daily', reason: '日常' } : text.startsWith('以后') ? create('旧主题') : clarify,
    p => response(isRoute(p) ? '' : useful));
  try {
    const fresh = await send(f, '当前新问题：怎样组织项目讲述？'); assert.equal(fresh.run?.output, useful);
    await send(f, '日常旧消息'); await send(f, '以后持续帮我讨论旧主题；PRIVATE_OLD[不可带入补答]');
    const before = messages(f.config.sessionDir), row = await send(f, '当前新问题：怎样组织项目讲述？');
    assert.ok(row.run?.output?.startsWith(useful)); assert.equal(row.topicRoute?.kind, 'clarify');
    assert.ok(!JSON.stringify(f.payloads.at(-1)).includes('PRIVATE_OLD')); assert.deepEqual(messages(f.config.sessionDir), before);
  } finally { await f.close(); }
});

test('有候选补答原样附宿主问题；ACK编号零模型只选择、不重放；未ACK/过期/错误编号拒绝', async () => {
  const f = await fixture(text => text.startsWith('以后') ? create(text.includes('甲') ? '甲' : '乙') : clarify);
  try {
    await send(f, '以后持续帮我讨论甲'); await send(f, '以后持续帮我讨论乙');
    const q = await send(f, '对照两个方向，有哪些准备方法？'); assert.equal(q.topicRoute?.kind, 'clarify'); assert.match(q.topicRoute?.kind === 'clarify' ? q.topicRoute.question : '', /接下来想继续聊哪一个主题/);
    assert.ok(q.run?.output?.startsWith(usefulBody)); assert.ok(!q.run?.output?.includes('请先贴')); assert.ok(q.topicRoute?.kind === 'clarify' && q.run?.output?.endsWith('\n\n主题归属：\n' + q.topicRoute.question));
    const before = f.payloads.length, selected = await send(f, '第二个'); assert.equal(f.payloads.length, before); assert.match(selected.run!.output!, /只选择主题/);
    await send(f, '对照两个方向，有哪些准备方法？', false); const noAck = f.payloads.length; assert.equal((await send(f, '第二个')).topicRoute?.kind, 'clarify'); assert.equal(f.payloads.length, noAck);
    const expired = await send(f, '对照两个方向，有哪些准备方法？'); assert.equal(f.store.webUi.topicClarification(webOwner, 'future', Date.now() + 300001), undefined);
    await send(f, '对照两个方向，有哪些准备方法？'); const invalid = f.payloads.length; assert.equal((await send(f, '第九个')).topicRoute?.kind, 'clarify'); assert.equal(f.payloads.length, invalid);
  } finally { await f.close(); }
});

for (const text of ['确认', '确认允许', '第二个', '批准那个学习计划']) test('纯业务/短确认不触发语义补答：' + text, async () => {
  const f = await fixture(() => clarify); try {
    const row = await send(f, text); assert.equal(row.topicRoute?.kind, 'clarify'); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

for (const mode of ['tool', 'empty', 'length', '500', 'disconnect', 'cancel', 'deadline', 'unknown'] as const) test('补答' + mode + '不重试/不执行；实际计量保留', async () => {
  let reached!: () => void; const started = new Promise<void>(resolve => { reached = resolve; });
  const f = await fixture(() => clarify, (_p, res) => {
    reached(); if (mode === '500') { res.writeHead(500); res.end('fake failure'); return; }
    if (mode === 'disconnect') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {'); res.destroy(); return; }
    if (mode === 'cancel' || mode === 'deadline') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': waiting\n\n'); return; }
    return mode === 'tool' ? toolCall('memory_remember', { body: '不能执行' }) : response(mode === 'empty' ? '' : useful, mode !== 'unknown').replace('\"finish_reason\":\"stop\"', '\"finish_reason\":\"' + (mode === 'length' ? 'length' : 'stop') + '\"');
  });
  try {
    if (mode === 'deadline') f.config.executionTimeoutMs = 700;
    const pending = send(f, '怎样准备应用开发面试？', false);
    if (mode === 'cancel') { await started; await f.channel.stop(); }
    const row = await pending; assert.equal(row.topicRoute?.kind, 'clarify');
    assert.equal(row.run?.status, mode === 'unknown' ? 'succeeded' : mode === 'cancel' || mode === 'deadline' ? 'interrupted' : 'failed');
    assert.ok(f.payloads.length <= 2); if (mode !== 'deadline') assert.equal(f.payloads.length, 2);
    assert.equal(f.store.workJobs.list(actor).length, 0); assert.equal(f.memory.listForHost().length, 0);
    if (mode === 'unknown') { assert.equal(row.run?.usage.calls, 2); assert.equal(row.run?.usage.unknownCalls, 1); assert.equal(f.store.modelCalls(row.runId!).length, 1); }
    else assert.equal(f.store.webUi.topicClarification(webOwner, 'next', Date.now()), undefined);
  } finally { await f.close(); }
});

test('补答大原话实际65536门前零发送；主题开关关闭沿原主Chat', async () => {
  const f = await fixture(() => clarify); try {
    const run = f.store.webUi.accept(webOwner, randomUUID(), '可信大输入探针', new Date().toISOString());
    await assert.rejects(f.tasks.withTarget(webTarget, () => f.executor.execute({ prompt: '长'.repeat(24000), scope: 'chat', source: { channel: 'web', reference: run.id },
      observer: f.store.observer(run.id), signal: new AbortController().signal, prepareChat: async () => ({ route: clarify, action: 'answer' }) })), /65536|上限/);
    assert.equal(f.payloads.length, 0);
    f.config.workTopicSessionsEnabled = false;
    const row = await send(f, '普通文字建议'); assert.equal(row.topicRoute, null); assert.equal(row.run?.status, 'succeeded'); assert.ok(f.payloads.at(-1)?.tools?.length);
  } finally { await f.close(); }
});


for (const bad of ['{broken', {kind:'use',threadId:'00000000-0000-0000-0000-000000000000',reason:'候选之外'}, {kind:'clarify',question:'问题',reason:'越权',action:'answer'}]) test('路由非法JSON/候选外ID/额外权限字段不补答：'+JSON.stringify(bad), async()=>{
  const f=await fixture(()=>bad);try {
    const row=await send(f,'当前需要一份普通文字建议');assert.equal(row.run?.status,'failed');assert.equal(row.topicRoute,null);assert.equal(f.payloads.length,1);
    assert.equal(f.store.workThreads.list(actor).length,0);assert.equal(f.store.workJobs.list(actor).length,0);assert.equal(f.memory.listForHost().length,0);
  }finally{await f.close();}
});
