import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { content, reply, toolCall, type Payload } from './helpers/skills-fixture.js';
import { isWorkParse } from './helpers/work-manage-fixture.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { TopicRouteChoice } from '../src/topic-route-types.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
const goalActor = { ownerId: 'local-user', target: webTarget };
const currentTools = (p: Payload) => p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
const system = (p: Payload) => content(p.messages.find(m => m.role === 'system')?.content);
const create = (title: string): TopicRouteChoice => ({ kind: 'create', title, description: 'N4虚构持续事项', reason: '当前明确持续交流' });
const use = (threadId: string): TopicRouteChoice => ({ kind: 'use', threadId, reason: '当前主题' });
const batch = (text: string, name: string) => ({ action: 'batch', mode: 'request', evidence: text, items: [{ name, quotes: [text] }] });
let serial = 0;
async function fixture() {
  let raw: unknown, tool: string | undefined, route: TopicRouteChoice = { kind: 'daily', reason: '一次交流' };
  const f = await webUiFixture(p => {
    if (system(p).includes('你是一次无工具主题归属解析器')) return reply(JSON.stringify(route));
    if (isWorkParse(p) || system(p).includes('隔离的当前用户意图解析器')) return reply(JSON.stringify(raw));
    if (!p.tools?.some(t => t.function.name === 'work_manage')) return reply('N4_WORK_RESULT:' + content(p.messages.findLast(m => m.role === 'user')?.content));
    return tool && !currentTools(p) ? toolCall(tool, {}) : reply('N4普通对话正文');
  }, undefined, true, true, false, false, undefined, true, undefined, true, true);
  await f.login();
  const responses: { path: string; status: number; requestId?: string }[] = [], number = ++serial;
  const close = f.close.bind(f);
  f.close = async () => {
    if (process.env.N4_EVIDENCE_DIR) {
      mkdirSync(process.env.N4_EVIDENCE_DIR, { recursive: true });
      writeFileSync(join(process.env.N4_EVIDENCE_DIR, `http-${number}.json`), JSON.stringify({ temporaryRoot: f.root, responses,
        requests: f.store.webUi.requests(actor.owner), threads: f.store.workThreads.list(actor), jobs: f.store.workJobs.list(actor), goals: f.store.goals.list(goalActor),
        modelHttp: f.rawPayloads.map(raw => ({ bytes: Buffer.byteLength(raw), payload: JSON.parse(raw) })),
        runs: f.store.listRuns().map(run => ({ ...run, events: f.store.events(run.id), calls: f.store.modelCalls(run.id) })) }, null, 2));
    }
    await close();
  };
  return { f, responses, configure(parsed: unknown, call?: string) { raw = parsed; tool = call; }, async send(text: string, choice: TopicRouteChoice, parsed?: unknown, call?: string, requestId: string = randomUUID()) {
    raw = parsed; tool = call; route = choice;
    const accepted = await f.request('/api/chat', { requestId, text }); responses.push({ path: '/api/chat', status: accepted.status, requestId }); assert.equal(accepted.status, 202);
    await f.channel.drain();
    const response = await f.request('/api/chat-requests/' + requestId); responses.push({ path: '/api/chat-requests/' + requestId, status: response.status }); assert.equal(response.status, 200);
    const receipt = await response.json() as WebRequestReceipt;
    assert.equal(receipt.run?.status, 'succeeded', f.store.getRun(receipt.runId!)?.error ?? JSON.stringify(receipt));
    const ack = await f.request('/api/runs/' + receipt.runId + '/ack', {}); responses.push({ path: '/api/runs/' + receipt.runId + '/ack', status: ack.status }); assert.equal(ack.status, 200);
    return receipt;
  } };
}

// 故意令隔离解析误报batch/create，验证宿主实际零业务副作用，不把固定分类当语义质量。
for (const [text, name, route] of [
  ['帮我写一段请假短信。', '请假短信', { kind: 'daily', reason: '普通短文' }],
  ['帮我写一段后台处理功能的介绍。', '后台处理功能的介绍', { kind: 'daily', reason: 'R1独立普通说明反例' }],
  ['帮我整理后台处理功能的介绍：下面的文字仅是虚构技术说明。', '后台处理功能的介绍', { kind: 'daily', reason: 'R1独立带材料反例' }],
  ['帮我写一段创建Goal的功能介绍。', '创建Goal的功能介绍', { kind: 'daily', reason: 'R1独立Goal宾语反例' }],
  ['帮我写一段持续修改功能的介绍。', '持续修改功能的介绍', { kind: 'daily', reason: '持续修饰宾语' }],
  ['请整理分阶段推进模块的说明：只有虚构模块资料。', '分阶段推进模块的说明', { kind: 'daily', reason: '分阶段修饰宾语' }],
  ['帮我把后台处理功能的介绍写得简短些。', '后台处理功能的介绍', { kind: 'daily', reason: '把字宾语不授权后台' }],
  ['帮我写一段如何创建长期目标的说明。', '创建长期目标的说明', { kind: 'daily', reason: 'Goal操作是写作宾语' }],
  ['请创建Goal的功能说明。', 'Goal的功能说明', { kind: 'daily', reason: 'Goal类别修饰说明宾语' }],

  ['解释一下什么是Agent。', 'Agent', { kind: 'daily', reason: '普通解释' }],
  ['翻译早上好。', '早上好', { kind: 'daily', reason: '普通翻译' }],
  ['改写请假短信：今天不能到场。', '请假短信', { kind: 'daily', reason: '临时改写' }],
  ['整理产品介绍：' + '虚构产品材料。'.repeat(120), '产品介绍', { kind: 'daily', reason: '一次长文' }],
  ['以后在这里帮我健身。', '健身', create('健身')],
  ['以后在这里帮我持续健身，不要安排跳跃。', '健身', create('健身')],
  ['整理报告，不要后台处理：虚构资料。', '报告', { kind: 'daily', reason: '直接回答' }],
  ['整理报告，参考措辞“后台处理”：虚构资料。', '报告', { kind: 'daily', reason: '引用不授权' }],
  ['以后在这里帮我持续求职。', '求职', create('求职')],
] as const) test('N4误报batch/create仍直接对话且零Job/Goal：' + text.slice(0, 32), async () => {
  const h = await fixture(), { f } = h;
  try {
    const received = await h.send(text, route, batch(text, name), 'work_manage');
    assert.equal(received.items.length, 0); assert.equal(received.run?.output, 'N4普通对话正文');
    assert.equal(f.store.workJobs.list(actor).length, 0); assert.equal(f.store.goals.list(goalActor).length, 0);
    assert.equal(f.store.workThreads.list(actor).length, route.kind === 'daily' ? 0 : 1);
    const secondRoute = received.topicRoute?.kind === 'topic' ? use(received.topicRoute.threadId) : route;
    const goal = await h.send(text, secondRoute, { action: 'goal_manage', goalAction: 'create', mode: 'request', evidence: text }, 'goal_manage');
    assert.equal(goal.items.length, 0); assert.equal(goal.run?.output, 'N4普通对话正文');
    assert.equal(f.store.workJobs.list(actor).length, 0); assert.equal(f.store.goals.list(goalActor).length, 0);
    assert.ok(f.rawPayloads.filter(raw => raw.includes('隔离的当前用户意图解析器')).every(raw => raw.includes('新主题模式')));
    const before = f.rawPayloads.length, snapshot = f.channel.snapshot();
    assert.equal(snapshot.requests?.find(row => row.requestId === received.requestId)?.topicRoute?.kind, route.kind === 'daily' ? 'daily' : 'topic');
    await f.restart(); await f.login(); assert.equal(f.rawPayloads.length, before);
    assert.deepEqual(f.channel.request(received.requestId).topicRoute, received.topicRoute);
  } finally { await f.close(); }
});

test('N4两Job继承冻结主题，歧义不选最新；跨聊天主题具名续接仍原链，结果/刷新不抢主题', async t => {
  const h = await fixture(), { f } = h;
  try {
    const start = await h.send('以后在这里帮我持续健身。', create('健身'));
    assert.equal(start.topicRoute?.kind, 'topic'); if (start.topicRoute?.kind !== 'topic') throw new Error('topic');
    const aId = start.topicRoute.threadId;
    const a = '整理训练安排，交给后台处理：A_ONLY_MATERIAL。', b = '整理饮食建议，交给后台处理：B_ONLY_MATERIAL。';
    const ar = await h.send(a, use(aId), batch(a, '训练安排'), 'work_manage');
    const br = await h.send(b, use(aId), batch(b, '饮食建议'), 'work_manage');
    const ja = f.store.workJobs.get(actor, ar.items[0]!.consumedByJobId!), jb = f.store.workJobs.get(actor, br.items[0]!.consumedByJobId!);
    assert.equal(ja.threadId, aId); assert.equal(jb.threadId, aId); assert.notEqual(ja.rootJobId, jb.rootJobId);
    assert.equal(f.store.workThreads.list(actor).length, 1);
    // 当前具名范围匹配两项工作，主题和旧focus均不能代选最近工作。
    const q = '查询健身工作进度'; const ambiguous = await h.send(q, use(aId), { action: 'query', mode: 'query', evidence: q, keywords: ['健身'] }, 'work_manage');
    assert.equal(ambiguous.items[0]?.decision, 'clarify'); assert.equal(f.store.workJobs.list(actor).length, 2);
    const other = await h.send('以后在这里帮我持续求职。', create('求职')); if (other.topicRoute?.kind !== 'topic') throw new Error('topic');
    const bId = other.topicRoute.threadId, contextBefore = f.store.webUi.previousChatContext(actor.owner, 'next');
    const mark = f.rawPayloads.length; await f.workRunner!.tick(); await f.workRunner!.tick();
    assert.equal(f.store.workJobs.get(actor, ja.id).status, 'succeeded'); assert.equal(f.store.workJobs.get(actor, jb.id).status, 'succeeded');
    assert.deepEqual(f.store.webUi.previousChatContext(actor.owner, 'next'), contextBefore);
    const workerPayloads = f.rawPayloads.slice(mark); assert.equal(workerPayloads.length, 2);
    assert.ok(workerPayloads.some(raw => raw.includes('A_ONLY_MATERIAL') && !raw.includes('B_ONLY_MATERIAL')));
    assert.ok(workerPayloads.some(raw => raw.includes('B_ONLY_MATERIAL') && !raw.includes('A_ONLY_MATERIAL')));
    const revise = '修改训练安排，重点讲膝盖限制。';
    const rr = await h.send(revise, use(bId), { action: 'revise', mode: 'request', evidence: revise, keywords: ['训练安排'] }, 'work_manage');
    assert.equal(rr.topicRoute?.kind === 'topic' && rr.topicRoute.threadId, bId);
    assert.equal(rr.items[0]?.targetId, ja.id); assert.equal(rr.items[0]?.decision, 'feedback');
    const before = f.rawPayloads.length; await f.workRunner!.tick();
    const successor = f.store.workJobs.latest(actor, ja.id); assert.notEqual(successor.id, ja.id); assert.equal(successor.rootJobId, ja.id); assert.equal(successor.previousJobId, ja.id); assert.equal(successor.threadId, aId);
    assert.equal(f.rawPayloads.length, before + 1); assert.ok(!f.rawPayloads.at(-1)!.includes('B_ONLY_MATERIAL'));
    const current = f.store.webUi.previousChatContext(actor.owner, 'next'); assert.equal(current?.contextKey, other.topicRoute.contextKey);
    const originalRoutes = f.channel.snapshot().requests?.map(row => ({ id: row.requestId, route: row.topicRoute }));
    const calls = f.rawPayloads.length; await f.restart(); await f.login(); const snapshot = f.channel.snapshot();
    assert.equal(f.rawPayloads.length, calls); assert.deepEqual(snapshot.requests?.map(row => ({ id: row.requestId, route: row.topicRoute })), originalRoutes);
    assert.equal(f.store.webUi.previousChatContext(actor.owner, 'next')?.contextKey, current?.contextKey);
    assert.ok(snapshot.workResults?.find(job => job.id === successor.id && job.threadId === aId));
    t.diagnostic(JSON.stringify({ topicA: aId, topicB: bId, jobs: [ja.id, jb.id], successor: successor.id, actualHttp: f.rawPayloads.length }));
  } finally { await f.close(); }
});

test('N4日常显式后台只建原组织主题、不绑定Session；逐项后台许可不传播普通项', async () => {
  const h = await fixture(), { f } = h;
  try {
    const a = '整理后台报告，交给后台处理：DAILY_ONLY。', b = '另外写请假短信：今天身体不适。', text = a + '\n' + b;
    const row = await h.send(text, { kind: 'daily', reason: '一次明确后台' }, { action: 'batch', mode: 'request', evidence: text,
      items: [{ name: '后台报告', quotes: [a] }, { name: '请假短信', quotes: [b] }] }, 'work_manage');
    assert.equal(row.items[0]?.decision, 'work'); assert.equal(row.items[1]?.decision, 'clarify');
    assert.equal(f.store.workJobs.list(actor).length, 1); const threads = f.store.workThreads.list(actor); assert.equal(threads.length, 1); assert.equal(threads[0]?.chatContextKey, null);
    assert.equal(row.topicRoute?.kind, 'daily');
  } finally { await f.close(); }
});

test('N4已接收旧请求在开关开启后仍旧规则与旧提示；新请求逐轮使用主题提示', async () => {
  const h = await fixture(), { f } = h;
  try {
    await h.send('解释普通新问题', { kind: 'daily', reason: '普通交流' });
    assert.ok(system(f.payloads.at(-1)!).includes('当前为持续主题模式'));
    const oldText = '整理旧排队稿件：OLD_QUEUE。', id = randomUUID();
    // 新模式daily回合后仍可接收旧模式队列；其模式与提示不能残留上轮新解释。
    h.configure(batch(oldText, '旧排队稿件'), 'work_manage');
    f.store.webUi.enqueue(actor.owner, id, oldText, new Date().toISOString(), false);
    f.channel.start(); await f.channel.drain();
    const old = f.channel.request(id); assert.equal(old.run?.status, 'succeeded'); assert.equal(old.topicSessions, 0); assert.equal(old.topicRoute, null); assert.equal(old.items[0]?.decision, 'work');
    const oldMain = f.payloads.find(p => p.tools?.some(tool => tool.function.name === 'work_manage') && content(p.messages.at(-1)?.content).includes(oldText));
    assert.ok(oldMain); assert.ok(!system(oldMain).includes('当前为持续主题模式'));
    const oldGoalText = '帮我逐步准备ALPHA目标', oldGoalId = randomUUID();
    h.configure({ action: 'goal_manage', goalAction: 'create', mode: 'request', evidence: oldGoalText }, 'goal_manage');
    f.store.webUi.enqueue(actor.owner, oldGoalId, oldGoalText, new Date().toISOString(), false);
    f.channel.start(); await f.channel.drain(); assert.equal(f.channel.request(oldGoalId).run?.status, 'succeeded'); assert.equal(f.store.goals.list(goalActor).length, 1);
    const latest = await h.send('解释普通问题', { kind: 'daily', reason: '普通交流' }); assert.equal(latest.run?.status, 'succeeded');
    assert.ok(system(f.payloads.at(-1)!).includes('当前为持续主题模式'));
  } finally { await f.close(); }
});


for (const label of ['长期目标', 'Goal']) test('N4明确创建' + label + '、查看计划并批准/继续保留原审批执行链', async () => {
  const h = await fixture(), { f } = h;
  try {
    const text = `帮我创建${label}，逐步准备虚构面试。`;
    const topic = await h.send('以后帮我持续求职。', create('Goal主题')); if (topic.topicRoute?.kind !== 'topic') throw new Error('topic');
    const created = await h.send(text, use(topic.topicRoute.threadId), { action: 'goal_manage', goalAction: 'create', mode: 'request', evidence: text }, 'goal_manage');
    if (created.topicRoute?.kind !== 'topic') throw new Error('topic'); const id = created.topicRoute.threadId;
    const goal = f.store.goals.list(goalActor)[0]!; assert.ok(goal); assert.equal(goal.status, 'ready');
    const claimed = f.store.goals.claim(goalActor, goal.id, goal.revision, new Date().toISOString())!;
    f.store.goals.commit(claimed.run.id, { stepOutcome: 'complete', artifactText: '虚构待批计划', progressSummary: '等待用户核对', question: '是否批准',
      proposedPlan: { changeReason: 'N4夹具', steps: [{ title: '练习', instruction: '输出虚构文字', deliverable: '文字', doneWhen: '用户核对' }] } }, new Date().toISOString());
    for (const [prompt, action] of [['查看虚构面试目标', 'view'], ['批准虚构面试计划', 'approve_plan'], ['继续虚构面试目标', 'continue']] as const) {
      const row = await h.send(prompt, use(id), { action: 'goal_manage', goalAction: action, mode: action === 'view' ? 'query' : 'request', evidence: prompt, selector: { keywords: ['虚构面试'] } }, 'goal_manage');
      if (action === 'view') assert.ok(f.store.goals.get(goalActor, goal.id).pendingAction);
      if (action === 'approve_plan') assert.equal(f.store.goals.get(goalActor, goal.id).planRevision, 1);
      if (action === 'continue') assert.equal(f.store.goals.get(goalActor, goal.id).readyInput?.triggerRunId, row.runId);
    }
    assert.equal(f.store.goals.list(goalActor).length, 1); assert.equal(f.store.workJobs.list(actor).length, 0);
  } finally { await f.close(); }
});

test('N4 Goal已提交成果首次文字修改继承请求主题，之后跨题续接仍原根链', async () => {
  const h = await fixture(), { f } = h;
  try {
    const a = await h.send('以后帮我持续整理项目。', create('当前项目')); if (a.topicRoute?.kind !== 'topic') throw new Error('topic');
    const now = new Date().toISOString(), goal = f.store.goals.create(goalActor, f.store.beginRun(null, now).id, '研究总结', now);
    const claimed = f.store.goals.claim(goalActor, goal.id, goal.revision, now)!;
    f.store.goals.commit(claimed.run.id, { stepOutcome: 'partial', artifactText: 'GOAL_N4_ORIGINAL', progressSummary: '阶段已提交', question: '是否继续' }, now);
    const text = '请修改研究总结成果：更简短。';
    const received = await h.send(text, use(a.topicRoute.threadId), { action: 'revise', mode: 'request', evidence: text, keywords: ['研究总结'] }, 'work_manage');
    assert.equal(received.items[0]?.targetKind, 'goal'); await f.workRunner!.tick();
    const root = f.store.workJobs.list(actor)[0]!; assert.equal(root.threadId, a.topicRoute.threadId); assert.equal(root.previousJobId, null);
    assert.ok(root.inputReferences?.some(ref => ref.kind === 'goal_result' && ref.goalId === goal.id));
    assert.equal(f.store.workThreads.list(actor).length, 1);
    await h.send('以后帮我持续求职。', create('求职'));
    // 显式原工作ID保证在另一个聊天主题中仍引用既有根链。
    const identified = `请修改研究总结成果 ${root.id}：保留核心结论。`;
    const current = f.store.webUi.previousChatContext(actor.owner, 'next')!;
    const topic = f.store.workThreads.list(actor).find(thread => thread.chatContextKey === current.contextKey)!;
    await h.send(identified, use(topic.id), { action: 'revise', mode: 'request', evidence: identified, keywords: ['研究总结'], source: { kind: 'job', id: root.id } }, 'work_manage');
    await f.workRunner!.tick(); const next = f.store.workJobs.latest(actor, root.id);
    assert.notEqual(next.id, root.id); assert.equal(next.previousJobId, root.id); assert.equal(next.threadId, a.topicRoute.threadId);
    assert.equal(f.store.goals.get(goalActor, goal.id).status, 'waiting_user');
  } finally { await f.close(); }
});


test('N4冻结主题归档后提交事务回滚，不能改按工作名另建主题', () => {
  const store = new SqliteStore(':memory:'), now = new Date().toISOString();
  try {
    store.webUi.enqueue(actor.owner, 'n4-archived', '整理训练安排，交给后台处理：虚构材料。', now, true);
    const row = store.webUi.claim(actor.owner, now, 'all')!;
    const route = store.webUi.freezeTopicRoute(actor, row.requestId, create('健身'), now); if (route.kind !== 'topic') throw new Error('topic');
    store.workThreads.update(actor, route.threadId, { status: 'archived' }, now);
    assert.throws(() => store.workCoordinator.commitBatch(actor, row.requestId, row.runId!, [{ ranges: [{ start: 0, end: row.text.length, role: 'instruction' }], decision: 'work', name: '训练安排', instruction: row.text, inputHash: 'test-only', receipt: '未提交' }], now), /归档/);
    assert.equal(store.workCoordinator.items(actor, row.requestId).length, 0); assert.equal(store.workJobs.list(actor).length, 0); assert.equal(store.workThreads.list(actor).length, 1);
  } finally { store.close(); }
});


test('N4明确在后台的自然动作头沿原范围校验，分阶段文字交付仍可承接', async () => {
  const h = await fixture(), { f } = h;
  try {
    const topic = await h.send('以后在这里帮我持续健身。', create('健身')); if (topic.topicRoute?.kind !== 'topic') throw new Error('topic');
    for (const [text, name] of [['请在后台整理训练安排：N4训练材料。', '训练安排'], ['帮我持续修改饮食建议：N4饮食材料。', '饮食建议'], ['请在后台整理后台处理功能的介绍：N4模块说明。', '后台处理功能的介绍'], ['请分阶段整理面试提纲：N4提纲材料。', '面试提纲']]) {
      const received = await h.send(text!, use(topic.topicRoute.threadId), batch(text!, name!), 'work_manage');
      assert.equal(received.items[0]?.decision, 'work'); assert.equal(f.store.workJobs.get(actor, received.items[0]!.consumedByJobId!).threadId, topic.topicRoute.threadId);
    }
    assert.equal(f.store.workJobs.list(actor).length, 4); assert.equal(f.store.workThreads.list(actor).length, 1);
  } finally { await f.close(); }
});

for (const text of ['请根据虚构材料在后台整理报告：虚构材料。', '请把报告在后台整理好：虚构材料。']) test('N4 R3介词/把字句中紧邻实际动作的后台修饰仍可承接：' + text, async () => {
  const h = await fixture(), { f } = h;
  try {
    const received = await h.send(text, { kind: 'daily', reason: '一次明确后台委托' }, batch(text, '报告'), 'work_manage');
    assert.equal(received.items[0]?.decision, 'work');
    const jobs = f.store.workJobs.list(actor); assert.equal(jobs.length, 1); assert.equal(jobs[0]?.status, 'queued');
    assert.equal(f.store.workThreads.get(actor, jobs[0]!.threadId).chatContextKey, null); assert.equal(f.store.goals.list(goalActor).length, 0);
  } finally { await f.close(); }
});
