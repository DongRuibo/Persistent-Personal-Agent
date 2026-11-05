import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { content } from './helpers/skills-fixture.js';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { assistant, user } from './helpers/topic-session-n0-fixture.js';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { response, factSummary } from './helpers/topic-session-n0-fixture.js';
import { toolCall, type Payload } from './helpers/skills-fixture.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { TopicCandidate, TopicRouteChoice } from '../src/topic-route-types.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
interface Routing { currentMessage: string; candidates: TopicCandidate[]; currentThreadId: string | null }
const routing = (p: Payload): Routing | undefined => JSON.stringify(p.messages[0]).includes('你是一次无工具主题归属解析器') ? JSON.parse(String(p.messages.at(-1)?.content)) as Routing : undefined;
const create = (title: string): TopicRouteChoice => ({ kind: 'create', title, description: '虚构持续范围', reason: '当前持续请求' });
const use = (id: string): TopicRouteChoice => ({ kind: 'use', threadId: id, reason: '当前已绑定事项' });
let sequence = 0;
async function fixture(route: (r: Routing) => TopicRouteChoice, main: (p: Payload) => string = p => response(factSummary(p)), options: { goals?: boolean; transport?: (res: ServerResponse) => boolean | void } = {}) {
  const f = await webUiFixture((p, res) => { const r = routing(p); if (r && options.transport && options.transport(res) !== false) return; return r ? response(JSON.stringify(route(r))) : main(p); }, undefined, true, true, false, false, undefined, !!options.goals, undefined, true, true);
  await f.login(); const close = f.close.bind(f), number = ++sequence;
  f.close = async () => {
    const dest = process.env.N2_EVIDENCE_DIR;
    if (dest) { mkdirSync(dest, { recursive: true }); writeFileSync(join(dest, 'routing-' + number + '.json'), JSON.stringify({ root: f.root,
      requests: f.rawPayloads.map(raw => ({ raw, bytes: Buffer.byteLength(raw) })), threads: f.store.workThreads.list(actor),
      files: f.store.webUi.fileIds(actor.owner, actor.channel).map(id => f.store.files.get(id)),
      runs: f.store.listRuns().map(run => ({ ...run, events: f.store.events(run.id), calls: f.store.modelCalls(run.id) })) }, null, 2)); }
    await close();
  }; return f;
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function send(f: Fixture, text: string, ack = true, requestId: string = randomUUID()) {
  const res = await f.request('/api/chat', { requestId, text }); assert.equal(res.status, 202);
  for (let i = 0; i < 1200; i++) {
    const row = await (await f.request('/api/chat-requests/' + requestId)).json() as WebRequestReceipt;
    if (row.run && row.run.status !== 'running') {
      if (ack && row.run.status === 'succeeded') { const ids = f.store.webUi.fileIds(actor.owner, actor.channel), file = ids.map(id => f.channel.file(id)).find(x => x.runId === row.runId);
        assert.equal((await f.request('/api/runs/' + row.runId + '/ack', file ? { hash: file.hash } : {})).status, 200); }
      return row;
    }
    await setTimeout(5);
  }
  throw new Error('N3真实Web未完成');
}

test('N3真实Web/Pi：daily零主题，持续A6→B3→A保留早期约束，同UUID不重复', async () => {
  const f = await fixture(r => r.currentMessage.startsWith('以后') ? create(r.currentMessage.includes('求职') ? '求职B' : '健身A')
    : r.currentMessage.includes('生日') ? { kind: 'daily', reason: '一次文字' }
    : use(r.candidates.find(x => x.title === (r.currentMessage.includes('求职') ? '求职B' : '健身A'))!.id));
  try {
    const daily = await send(f, '写一句生日祝福'); assert.equal(daily.topicRoute?.kind, 'daily'); assert.equal(f.store.workThreads.list(actor).length, 0);
    const first = await send(f, '以后帮我健身；EARLY_FACT[健身膝盖不跳跃]'); assert.equal(first.run?.status, 'succeeded'); assert.equal(first.topicRoute?.kind, 'topic');
    const requestId = first.requestId, calls = f.payloads.length; await send(f, first.text, true, requestId); assert.equal(f.payloads.length, calls);
    for (let i = 1; i < 6; i++) await send(f, '健身反馈' + i);
    for (let i = 0; i < 3; i++) await send(f, i ? '求职反馈' + i : '以后帮我求职；EARLY_FACT[求职项目独立]');
    const last = await send(f, '健身早期约束是什么'); assert.match(last.run!.output!, /健身膝盖不跳跃/); assert.ok(!last.run!.output!.includes('求职项目独立'));
    assert.equal(f.store.workThreads.list(actor).length, 2);
    const messages = f.payloads.filter(p => routing(p)); assert.ok(messages.every(p => !JSON.stringify(p).includes('EARLY_FACT[' + '健身膝盖不跳跃]') || routing(p)!.currentMessage.includes('EARLY_FACT[')));
    assert.ok(f.rawPayloads.every(raw => Buffer.byteLength(raw) <= 65536));
  } finally { await f.close(); }
});

test('纯切换实际context跨冷重建；带新问题全文进主Chat；一般“那个”跟进不被审批澄清', async () => {
  const f = await fixture(r => r.currentMessage.startsWith('以后') ? create(r.currentMessage.includes('健身') ? '健身' : '求职')
    : use(r.candidates.find(x => x.title === (r.currentMessage.includes('健身') ? '健身' : r.currentMessage.includes('求职') ? '求职' : r.candidates.find(x => x.id === r.currentThreadId)!.title))!.id));
  try {
    const a = await send(f, '以后帮我健身'), b = await send(f, '以后帮我求职');
    const before = f.payloads.length, select = await send(f, '切到健身'); assert.equal(f.payloads.length, before); assert.match(select.run!.output!, /只选择主题/);
    assert.equal(f.store.webUi.previousChatContext(webOwner, 'not-current')?.contextKey, a.topicRoute?.kind === 'topic' && a.topicRoute.contextKey);
    await f.restart(); await f.login(); assert.equal(f.payloads.length, before);
    const follow = await send(f, '那个训练动作怎么做'); assert.equal(follow.topicRoute?.kind === 'topic' && follow.topicRoute.threadId, a.topicRoute?.kind === 'topic' && a.topicRoute.threadId);
    const mixed = '切到求职，今天怎么准备面试', answer = await send(f, mixed); assert.equal(answer.run?.status, 'succeeded');
    assert.ok(f.payloads.filter(p => !routing(p)).some(p => JSON.stringify(p).includes(mixed)));
    assert.equal(answer.topicRoute?.kind === 'topic' && answer.topicRoute.threadId, b.topicRoute?.kind === 'topic' && b.topicRoute.threadId);
  } finally { await f.close(); }
});

test('同名澄清已ACK后纯第二个只选择、不重放；未ACK/中间回合不得消费候选', async () => {
  const f = await fixture(r => r.currentMessage.startsWith('以后') ? { ...create('同名'), description: r.currentMessage.includes('第一') ? '第一项目' : '第二项目' } : r.currentMessage === '普通问题' ? { kind: 'daily', reason: '一次问答' }
    : { kind: 'clarify', question: '模型不控制宿主选项', reason: '同名歧义' });
  try {
    await send(f, '以后帮我持续跟进第一项目'); await send(f, '以后帮我持续跟进第二项目');
    const q = await send(f, '继续同名项目'), before = f.payloads.length; assert.match(q.run!.output!, /1.同名（/);
    const s = await send(f, '第二个'); assert.equal(f.payloads.length, before); assert.match(s.run!.output!, /未执行上一条/);
    const chosen = f.store.webUi.topicDecision(q.runId!)!.candidates[1]!.id; assert.equal(s.topicRoute?.kind === 'topic' && s.topicRoute.threadId, chosen);
    await send(f, '继续同名项目', false); const unacked = await send(f, '第二个'); assert.equal(unacked.topicRoute?.kind, 'clarify');
    await send(f, '继续同名项目'); await send(f, '普通问题'); const ended = await send(f, '第二个'); assert.equal(ended.topicRoute?.kind, 'clarify');
  } finally { await f.close(); }
});

test('旧未绑定不语义升级，明确持续用途澄清选择才绑定；仅引用他主题不搬全文', async () => {
  let legacy = '';
  const f = await fixture(r => r.currentMessage.startsWith('以后') ? create('当前B') : use(legacy));
  try {
    const thread = f.channel.workThreads!.create(randomUUID(), '旧资料A'); legacy = thread.id;
    const q = await send(f, '看看旧资料A'); assert.equal(q.topicRoute?.kind, 'clarify'); assert.equal(f.channel.workThreads!.get(legacy).chatContextKey, null);
    const bound = await send(f, '第一个'); assert.equal(bound.topicRoute?.kind, 'topic'); assert.ok(f.channel.workThreads!.get(legacy).chatContextKey);
    await send(f, '旧资料A EARLY_FACT[只在A存在的私有材料]');
    const b = await send(f, '以后帮我持续跟进当前B');
    const akey = f.channel.workThreads!.get(legacy).chatContextKey!;
    const afile = join(f.config.sessionDir,webOwner,'topics',createHash('sha256').update(akey).digest('hex'),'chat.session.jsonl');
    const originalA = readFileSync(afile,'utf8');
    const reference = await send(f, '在当前B继续，参考旧资料A那份报告');
    assert.equal(reference.topicRoute?.kind === 'topic' && reference.topicRoute.threadId, b.topicRoute?.kind === 'topic' && b.topicRoute.threadId);
    assert.ok(!f.rawPayloads.at(-1)!.includes('只在A存在的私有材料'));
    assert.equal(readFileSync(afile,'utf8'),originalA);
  } finally { await f.close(); }
});

test('文件待批→主题澄清→纯选择→冷恢复裸确认零写；重新预览ACK同Session可确认', async () => {
  let writing = false;
  const f = await fixture(r => r.currentMessage.startsWith('以后') ? create(r.currentMessage.includes('甲') ? '甲' : '乙')
    : r.currentMessage === '主题不明' ? { kind: 'clarify', question: '无效模型选项', reason: '歧义' } : use(r.candidates.find(x => x.title === '甲')!.id),
    p => writing && p.messages.at(-1)?.role !== 'tool' ? toolCall('write', { path: 'n3.md', content: '虚构N3输出' }) : response('普通说明'));
  try {
    await send(f, '以后帮我持续跟进甲主题'); writing = false; await send(f, '以后帮我持续跟进乙主题'); writing = true;
    const preview = await send(f, '本次允许创建输出文件：n3.md'); assert.match(f.store.getRun(preview.runId!)!.output!, /待批准文件/); assert.equal(existsSync(join(f.output, 'n3.md')), false);
    writing = false; const q = await send(f, '主题不明'); assert.equal(q.topicRoute?.kind, 'clarify');
    const selection = await send(f, '第一个'); assert.match(selection.run!.output!, /只选择/); await f.restart(); await f.login();
    await send(f, '确认允许'); assert.equal(existsSync(join(f.output, 'n3.md')), false);
    const old = f.store.webUi.fileIds(actor.owner, actor.channel).map(id => f.store.files.get(id).proposal)[0]!;
    await send(f, `取消文件操作 ${old.id} ${old.hash}`);
    writing = true; const again = await send(f, '本次允许创建输出文件：n3.md'); assert.match(f.store.getRun(again.runId!)!.output!, /待批准文件/);
    writing = false; await send(f, '确认允许'); assert.equal(readFileSync(join(f.output, 'n3.md'), 'utf8'), '虚构N3输出');
  } finally { await f.close(); }
});

test('路由坏JSON/500等失败不降级daily，已接收关闭仍可撤回，真实FIFO旧新不分队列', async () => {
  const f = await fixture(r => { if (r.currentMessage === '坏模型') return { kind: 'daily', reason: '伪造', path: '/tmp/no' } as unknown as TopicRouteChoice;
    return { kind: 'daily', reason: '原话一次问答' }; });
  try {
    const bad = await send(f, '坏模型'); assert.equal(bad.run!.status, 'failed'); assert.equal(bad.topicRoute, null); assert.equal(f.payloads.length, 1);
    f.config.workTopicSessionsEnabled = false;
    const now = new Date().toISOString(), old = randomUUID(), pending = randomUUID(), last = randomUUID();
    f.store.webUi.enqueue(webOwner, old, '旧第一', now); f.store.webUi.enqueue(webOwner, pending, '新第二', now, true); f.store.webUi.enqueue(webOwner, last, '旧第三', now);
    f.channel.start(); await f.channel.drain(); assert.equal(f.store.webUi.find(webOwner, pending)!.status, 'queued');
    assert.equal((await f.request('/api/chat-requests/' + pending + '/cancel', {})).status, 200);
    const ids = f.store.listRuns().filter(x => x.status === 'succeeded').map(x => x.id); assert.equal(ids.length, 2);
    assert.equal(f.store.workThreads.list(actor).length, 0);
  } finally { await f.close(); }
});


test('真实N3 route+主工具链共享8次，物理第9次零发送，purpose/unknown不双计', async () => {
  const f = await fixture(() => ({ kind: 'daily', reason: '临时预算探针' }), () => toolCall('memory_search', { query: '无匹配资料' }));
  try {
    const row = await send(f, '循环读取预算探针'); assert.equal(row.run?.status, 'failed'); assert.equal(f.payloads.length, 8);
    const events = f.store.events(row.runId!).filter(e => e.type === 'topic_model_http').map(e => JSON.parse(e.details!));
    assert.equal(events.filter(e => e.phase === 'dispatch' && e.purpose === 'topic_route').length, 1);
    assert.equal(events.filter(e => e.phase === 'dispatch').length, 8); assert.equal(events.filter(e => e.phase === 'blocked').length, 1);
    assert.equal(f.store.modelCalls(row.runId!).filter(c => c.purpose === 'topic_route').length, 1);
    assert.ok(events.some(e => e.usageStatus === 'unknown')); assert.ok(f.rawPayloads.every(raw => Buffer.byteLength(raw) <= 65536));
  } finally { await f.close(); }
});

for (const mode of ['500', 'disconnect', 'deadline', 'cancel'] as const) test('真实N3路由' + mode + '不冻结/不建主题/不运行主Chat，不自动重试', async () => {
  let reached!: () => void; const start = new Promise<void>(resolve => { reached = resolve; });
  const f = await fixture(() => create('不应出现'), () => response('不应运行'), { transport: res => {
    reached(); if (mode === '500') { res.writeHead(500); res.end('fake failure'); }
    else if (mode === 'disconnect') { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {'); res.destroy(); }
    else { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': waiting\n\n'); }
  } });
  try {
    if (mode === 'deadline') f.config.executionTimeoutMs = 1000;
    const pending = send(f, '以后帮我持续跟进失败探针');
    // deadline在服务收到请求之前也可能先到；不能反过来无限等待接收屏障。
    if (mode === 'cancel') await start;
    if (mode === 'cancel') await f.channel.stop();
    const row = await pending; assert.ok(['failed','interrupted'].includes(row.run!.status)); assert.equal(row.topicRoute, null);
    assert.equal(f.store.workThreads.list(actor).length, 0); const sent = f.payloads.length;
    assert.ok(sent <= 1); if (mode !== 'deadline') assert.equal(sent, 1);
    if (mode === 'deadline') assert.equal(row.run!.status, 'interrupted');
    await f.restart(); await f.login(); assert.equal(f.payloads.length, sent);
    await send(f, row.text, false, row.requestId); assert.equal(f.payloads.length, sent);
    const event = f.store.events(row.runId!).filter(e => e.type === 'topic_model_http').map(e => JSON.parse(e.details!));
    assert.equal(event.filter(e => e.phase === 'dispatch').length, sent);
    if (sent) assert.ok(event.some(e => e.usageStatus === 'unknown')); else assert.equal(f.store.modelCalls(row.runId!).length, 0);
  } finally { await f.close(); }
});

test('N3 Goal当前展示原ACK/revision正向；A→B→纯选A冷恢复不能批准旧计划，重展示可批', async () => {
  const f = await fixture(r => r.currentMessage.startsWith('帮我持续') ? create(r.currentMessage.includes('甲') ? 'Goal甲' : 'Goal乙')
    : use(r.candidates.find(x => x.title === (r.currentMessage.includes('乙') ? 'Goal乙' : 'Goal甲'))!.id), p => {
      if (JSON.stringify(p.messages[0]).includes('隔离的当前用户意图解析器')) {
        const data = JSON.parse(content(p.messages.findLast(m => m.role === 'user')!.content));
        return response(JSON.stringify({ action: 'goal_manage', mode: data.message.startsWith('查看') ? 'query' : 'request', evidence: data.message,
          goalAction: data.message.startsWith('查看') ? 'view' : 'create', ...(data.message.startsWith('查看') ? { selector: { keywords: [data.message.includes('乙') ? '乙' : '甲'] } } : {}) }));
      }
      if (!p.tools?.length) return response(factSummary(p));
      return p.messages.at(-1)?.role === 'tool' ? response('转达本轮Goal收据') : toolCall('goal_manage', {});
    }, { goals: true });
  try {
    const ga = { ownerId: 'local-user', target: webTarget }, ids: string[] = [];
    for (const name of ['甲','乙']) {
      await send(f, '帮我持续创建长期目标虚构学习目标' + name);
      const goal = f.store.goals.list(ga).find(g => g.objective.includes(name))!; ids.push(goal.id);
      const claim = f.store.goals.claim(ga, goal.id, goal.revision, new Date().toISOString())!;
      f.store.goals.commit(claim.run.id, { stepOutcome: 'complete', artifactText: '虚构待批', progressSummary: '待核对', question: '核对', proposedPlan: { changeReason: '虚构测试',
        steps: [{ title: '练习', instruction: '只输出练习', deliverable: '一道题', doneWhen: '核对' }] } }, new Date().toISOString());
      await send(f, '查看虚构学习目标' + name);
    }
    const before = f.payloads.length; await send(f, '切到Goal甲'); assert.equal(f.payloads.length, before);
    await f.restart(); await f.login(); await send(f, '确认'); assert.equal(f.store.goals.get(ga, ids[0]!).planRevision, 0); assert.equal(f.store.goals.get(ga, ids[1]!).planRevision, 0);
    await send(f, '查看虚构学习目标甲'); await f.restart(); await f.login();
    const confirmed = await send(f, '确认'); assert.equal(confirmed.run?.status, 'succeeded'); assert.equal(f.store.goals.get(ga, ids[0]!).planRevision, 1);
  } finally { await f.close(); }
});


for (const mode of ['500','cancel'] as const) test('A文件ACK→普通新请求路由' + mode + '→冷裸确认不可恢复原入口已结束引用', async () => {
  let write = false, block = false, reached!: () => void; const start = new Promise<void>(resolve => { reached = resolve; });
  const f = await fixture(r => r.candidates.length ? use(r.candidates[0]!.id) : create('文件主题'),
    p => write && p.messages.at(-1)?.role !== 'tool' ? toolCall('write', { path: 'failure.md', content: '虚构失败路径' }) : response('普通回答'),
    { transport: res => { if (!block) return false; reached(); if (mode === '500') { res.writeHead(500); res.end('fake route failure'); }
      else { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': waiting\n\n'); } } });
  try {
    await send(f, '以后帮我持续跟进文件主题'); write = true; const p = await send(f, '本次允许创建输出文件：failure.md');
    assert.match(f.store.getRun(p.runId!)!.output!, /待批准文件/); write = false;
    block = true; const pending = send(f, '解释一个普通新问题'); await start;
    if (mode === 'cancel') await f.channel.stop();
    const failed = await pending; assert.ok(['failed','interrupted'].includes(failed.run!.status));
    block = false; await f.restart(); await f.login(); await send(f, '确认允许');
    assert.equal(existsSync(join(f.output, 'failure.md')), false, '普通回合入口应已结束旧文件短确认，即使路由尚未选Session就失败');
  } finally { await f.close(); }
});


test('真实自动route→主题前置compact→主Chat共用原账本和发送门，原summary/早期约束保留', async () => {
  const f=await fixture(r=>r.candidates.length?use(r.candidates[0]!.id):create('压缩主题'));
  try{
    const first=await send(f,'以后帮我持续跟进压缩主题');if(first.topicRoute?.kind!=='topic')throw new Error('topic');
    await f.restart();await f.login();const before=f.payloads.length;
    const key=first.topicRoute.contextKey, path=join(f.config.sessionDir,webOwner,'topics',createHash('sha256').update(key).digest('hex'),'chat.session.jsonl');
    const manager=SessionManager.open(path,path.slice(0,path.lastIndexOf('/')),process.cwd());
    for(let i=0;i<15;i++){manager.appendMessage(user(`EARLY_FACT[自动路由保留早期约束${i}] `+'历史中文'.repeat(140)));manager.appendMessage(assistant('历史回答。'));}
    const result=await send(f,'继续压缩主题');assert.equal(result.run?.status,'succeeded');assert.match(result.run!.output!,/自动路由保留早期约束0/);
    const calls=f.store.modelCalls(result.runId!);assert.ok(calls.some(c=>c.purpose==='topic_route'));assert.ok(calls.some(c=>c.purpose==='compaction'));assert.ok(calls.some(c=>c.purpose==='chat'));
    assert.ok(f.payloads.length-before>=3);assert.ok(f.rawPayloads.every(raw=>Buffer.byteLength(raw)<=65536));
    const entries=SessionManager.open(path,path.slice(0,path.lastIndexOf('/')),process.cwd()).getBranch();
    assert.ok(entries.some(e=>e.type==='compaction'&&e.summary.includes('UNTRUSTED_HISTORY_SUMMARY_V1')));
  }finally{await f.close();}
});


for(const wrong of [false,true])test('R1-1真实Web：当前C明确B引用A，模型'+(wrong?'误选A':'正确B')+'实际主HTTP仅有B历史',async()=>{
  const f=await fixture(r=>r.currentMessage.startsWith('以后')?create(r.currentMessage.includes('资料A')?'资料A':r.currentMessage.includes('求职B')?'求职B':'当前C')
    :use(r.candidates.find(x=>x.title===(wrong?'资料A':'求职B'))!.id),()=>response('普通说明，不复述其他历史'));
  try{
    await send(f,'以后持续帮我资料A；EARLY_FACT[A_PRIVATE]');const b=await send(f,'以后持续帮我求职B；EARLY_FACT[B_PRIVATE]');
    await send(f,'以后持续帮我当前C；EARLY_FACT[C_PRIVATE]');
    for(const text of ['在求职B继续，参考资料A那份报告，今天怎么准备面试','切到求职B，参考资料A报告帮我准备面试','在求职B继续，不要引用资料A']){
      await send(f,'切到当前C');const before=f.payloads.length,result=await send(f,text);
      assert.equal(result.run?.status,'succeeded');assert.equal(result.topicRoute?.kind==='topic'&&result.topicRoute.threadId,b.topicRoute?.kind==='topic'&&b.topicRoute.threadId);
      const requests=f.payloads.slice(before),main=requests.filter(p=>!routing(p));assert.equal(requests.length,2);assert.equal(main.length,1);
      const body=JSON.stringify(main[0]);assert.ok(body.includes(text));assert.ok(body.includes('B_PRIVATE'));assert.ok(!body.includes('C_PRIVATE'));assert.ok(!body.includes('A_PRIVATE'));
    }
  }finally{await f.close();}
});

test('R1-1真实Web：错误模型A但未知明确去向仅文字补答、不选题；仅引用未绑定A不创建Session或索绑定',async()=>{
  let a='';const f=await fixture(r=>r.currentMessage.startsWith('以后')?create('当前C'):use(a),()=>response('只回答本次普通问题'));
  try{
    a=f.channel.workThreads!.create(randomUUID(),'资料A').id;const c=await send(f,'以后持续帮我当前C；EARLY_FACT[C_PRIVATE]');
    const before=f.payloads.length,q=await send(f,'在未定位的项目继续，参考资料A报告');assert.equal(q.topicRoute?.kind,'clarify');assert.equal(f.payloads.length-before,2);assert.ok(!f.payloads.at(-1)!.tools?.length);assert.match(q.run!.output!,/只回答本次普通问题/);
    const pure=await send(f,'参考资料A那份报告解释一下');assert.equal(pure.topicRoute?.kind==='topic'&&pure.topicRoute.threadId,c.topicRoute?.kind==='topic'&&c.topicRoute.threadId);
    assert.equal(f.channel.workThreads!.get(a).chatContextKey,null);assert.ok(!f.store.webUi.topicDecision(pure.runId!)!.explicitThreadId);
    assert.ok(!f.rawPayloads.at(-1)!.includes('A_PRIVATE'));assert.equal(f.store.workThreads.list(actor).length,2);
  }finally{await f.close();}
});


for(const canContinue of [false,true])test('R2当前甲Goal指代不消费乙；甲'+(canContinue?'合法continue真实授权归甲':'待批continue保留原Guard具体拒绝'),async()=>{
  let prompt='';
  const f=await fixture(r=>r.currentMessage.startsWith('帮我持续')?create(r.currentMessage.includes('甲')?'业务甲':'业务乙')
    :use(r.candidates.find(t=>t.title===(r.currentMessage.includes('甲')?'业务甲':'业务乙'))!.id),p=>{
      if(JSON.stringify(p.messages[0]).includes('隔离的当前用户意图解析器')){
        const x=JSON.parse(content(p.messages.findLast(m=>m.role==='user')!.content));
        const action=prompt.startsWith('帮我持续')?'create':prompt.startsWith('查看')?'view':prompt.startsWith('批准虚构')?'approve_plan':prompt.startsWith('暂停虚构')?'pause':'continue';
        return response(JSON.stringify({action:'goal_manage',goalAction:action,mode:action==='view'?'query':'request',evidence:x.message,
          ...(action==='create'?{}:{selector:prompt.includes('甲')||prompt.includes('乙')?{keywords:[prompt.includes('甲')?'甲':'乙']}:{keywords:[],reference:'last'}})}));
      }
      if(!p.tools?.length)return response(factSummary(p));
      return p.messages.at(-1)?.role==='tool'?response('只转达本轮原Goal收据'):toolCall('goal_manage',{});
    },{goals:true});
  const perform=async(text:string)=>{prompt=text;return send(f,text);};
  try{
    const ga={ownerId:'local-user',target:webTarget},ids:string[]=[];
    for(const name of ['乙','甲']){
      await perform('帮我持续创建长期目标虚构学习目标'+name+' EARLY_FACT[业务_'+name+']');const goal=f.store.goals.list(ga).find(g=>g.objective.includes(name))!;ids.push(goal.id);
      const claimed=f.store.goals.claim(ga,goal.id,goal.revision,new Date().toISOString())!;
      f.store.goals.commit(claimed.run.id,{stepOutcome:'complete',artifactText:'虚构待批',progressSummary:'待核对',question:'核对',proposedPlan:{changeReason:'虚构测试',steps:[{title:'练习',instruction:'输出练习',deliverable:'文字',doneWhen:'核对'}]}},new Date().toISOString());
      await perform('查看虚构学习目标'+name);
      if(name==='乙'||canContinue){await perform('批准虚构学习目标'+name+'计划');await perform('暂停虚构学习目标'+name);await perform('查看虚构学习目标'+name);}
    }
    const before={a:f.store.goals.get(ga,ids[1]!),b:f.store.goals.get(ga,ids[0]!)},start=f.rawPayloads.length;
    const actual=await perform('继续那个目标'),after={a:f.store.goals.get(ga,ids[1]!),b:f.store.goals.get(ga,ids[0]!)},http=f.rawPayloads.slice(start);
    assert.equal(actual.topicRoute?.kind==='topic'&&actual.topicRoute.title,'业务甲');assert.deepEqual(after.b,before.b);
    assert.ok(http.some(raw=>raw.includes('业务_甲')));assert.ok(http.every(raw=>!raw.includes('业务_乙')));
    assert.ok(f.store.events(actual.runId!).some(e=>e.type==='topic_context_entered'&&JSON.parse(e.details!).contextKey===(actual.topicRoute?.kind==='topic'&&actual.topicRoute.contextKey)));
    if(canContinue){assert.equal(actual.run?.status,'succeeded');assert.equal(after.a.status,'ready');assert.equal(after.a.readyInput?.triggerRunId,actual.runId);}
    else{assert.equal(actual.run?.status,'failed');assert.equal(after.a.readyInput,null);assert.deepEqual(after.a,before.a);assert.ok(http.some(raw=>raw.includes('Goal 当前不能继续；需先处理计划或确认完成')));}
    const dest=process.env.N2_EVIDENCE_DIR;if(dest)writeFileSync(join(dest,'r2-goal-'+canContinue+'.json'),JSON.stringify({before,after,actual,http,events:f.store.events(actual.runId!)},null,2));
  }finally{await f.close();}
});

test('R2真实Task last/choice固定当前甲，多项编号不按总数误拒；显式换乙冲突澄清，具名新操作可去乙',async()=>{
  let prompt='';
  const f=await fixture(r=>r.currentMessage.startsWith('以后')?create(r.currentMessage.includes('甲')?'提醒甲':'提醒乙')
    :use(r.candidates.find(t=>t.title===(r.currentMessage.includes('甲')?'提醒甲':'提醒乙'))!.id),p=>{
      if(JSON.stringify(p.messages[0]).includes('隔离的当前用户意图解析器')){
        const x=JSON.parse(content(p.messages.findLast(m=>m.role==='user')!.content));
        if(prompt.startsWith('明天')){const body=prompt.slice(prompt.indexOf('TASK'));return response(JSON.stringify({action:'create_task',mode:'request',evidence:x.message,bodyEvidence:body,body,when:'明天下午3点'}));}
        const selector=prompt.includes('第二')?{keywords:[],reference:'choice',position:2}:prompt.includes('BETA')?{keywords:['BETA']}:{keywords:[],reference:'last'};
        return response(JSON.stringify({action:'cancel_task',mode:prompt.startsWith('不要')?'negated':'request',evidence:x.message,selector}));
      }
      if(prompt.startsWith('以后'))return response('仅建立持续对话');
      if(p.messages.at(-1)?.role==='tool')return response('只转达本轮Task收据');
      if(prompt.startsWith('查看'))return toolCall('list_tasks',{keywords:['TASK甲']});
      return prompt.startsWith('明天')?toolCall('create_task',{instruction:prompt.slice(prompt.indexOf('TASK')),when:'明天下午3点'}):toolCall('cancel_task',{});
    });
  const perform=async(text:string)=>{prompt=text;return send(f,text);};
  try{
    await perform('以后持续跟进提醒主题乙');await perform('明天下午3点提醒我TASK乙BETA');
    await perform('以后持续跟进提醒主题甲');await perform('明天下午3点提醒我TASK甲一');await perform('明天下午3点提醒我TASK甲二');
    const viewed=await perform('查看TASK甲提醒列表'),second=f.store.getRun(viewed.runId!)!.output!.split('\n')[1]!.match(/TASK甲[一二]/u)![0];
    const count=f.payloads.length,conflict=await perform('切到提醒乙，取消第二个提醒');assert.equal(conflict.topicRoute?.kind,'clarify');assert.equal(f.payloads.length,count);assert.ok(f.store.listTasks().every(t=>t.status==='pending'));
    await perform('查看TASK甲提醒列表');const result=await perform('取消第二个提醒');assert.equal(result.run?.status,'succeeded');assert.equal(result.topicRoute?.kind==='topic'&&result.topicRoute.title,'提醒甲');
    assert.equal(f.store.listTasks().find(t=>t.instruction===second)!.status,'cancelled');assert.equal(f.store.listTasks().find(t=>t.instruction==='TASK乙BETA')!.status,'pending');
    const named=await perform('取消BETA提醒');assert.equal(named.run?.status,'succeeded');assert.equal(named.topicRoute?.kind==='topic'&&named.topicRoute.title,'提醒乙');assert.equal(f.store.listTasks().find(t=>t.instruction==='TASK乙BETA')!.status,'cancelled');
  }finally{await f.close();}
});
