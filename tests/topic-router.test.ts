import { formationHarness } from './helpers/formation.js';
import { fingerprint } from '../src/formation-types.js';
import { OperationGuard, businessReferenceFromMessage } from '../src/operation-guard.js';
import type { DialogueReferences } from '../src/operation-guard.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { GoalService } from '../src/goal-service.js';
import { webTarget } from '../src/web-ui-channel.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { routeTopic, parseTopicProposal } from '../src/topic-router.js';
import type { TopicRoutingInput } from '../src/topic-router.js';
import type { TopicRouteChoice, TopicCandidate } from '../src/topic-route-types.js';
import type { WorkThread } from '../src/work-thread-types.js';

const thread = (title: string, bound = true): WorkThread => ({ id: randomUUID(), title, description: '当前范围', chatContextKey: bound ? randomUUID() : null,
  status: 'active', createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z' });
const proposal = (choice: TopicRouteChoice, input: TopicRoutingInput) => parseTopicProposal(choice, input,
  input.threads.map(t => ({ id: t.id, title: t.title, description: t.description, bound: !!t.chatContextKey })));
async function routed(input: TopicRoutingInput, output: TopicRouteChoice) {
  let calls = 0, sent = ''; const result = await routeTopic(input, { signal: new AbortController().signal,
    complete: async (_system, text) => { calls++; sent = text; return JSON.stringify(output); } }); return { ...result, calls, sent };
}

test('未知模型入口：额外身份/path/action、非法ID、空/无界字段全部拒绝', () => {
  const t = thread('健身'), input = { text: '以后帮我健身', threads: [t] }, c: TopicCandidate[] = [{ id: t.id, title: t.title, description: t.description, bound: true }];
  for (const bad of [null, { kind: 'use', threadId: t.id, reason: 'a', owner: 'fake' }, { kind: 'use', threadId: t.id, reason: 'a', explicitThreadId: t.id },
    { kind: 'daily', reason: 'a', action: 'selection' }, { kind: 'daily', reason: 'a', path: '/tmp/fake' }, { kind: 'use', threadId: '../x', reason: 'a' },
    { kind: 'create', title: '', description: '', reason: 'a' }, { kind: 'create', title: '字'.repeat(121), description: '', reason: 'a' },
    { kind: 'create', title: 'x', description: '字'.repeat(481), reason: 'a' }, { kind: 'daily', reason: '字'.repeat(241) },
    { kind: 'clarify', question: '', reason: 'a' }]) assert.throws(() => parseTopicProposal(bad, input, c), /路由/);
  assert.throws(() => proposal({ kind: 'use', threadId: randomUUID(), reason: '伪造候选' }, input), /候选/);
});

for (const text of ['普通生日祝福', '他说“以后帮我健身”', '如果以后帮我健身可以吗？', '不要创建持续主题']) test('无本轮持续许可不能create：' + text, () => {
  assert.equal(proposal({ kind: 'create', title: '健身', description: '', reason: '模型自报持续' }, { text, threads: [] }).choice.kind, 'clarify');
});

test('旧未绑定仅当前明确持续选用或有效澄清选择绑定；引用不绑定', async () => {
  const t = thread('求职', false);
  assert.equal(proposal({ kind: 'use', threadId: t.id, reason: '模型相似' }, { text: '看看求职', threads: [t] }).choice.kind, 'clarify');
  const selected = proposal({ kind: 'use', threadId: t.id, reason: '当前原话' }, { text: '以后帮我持续跟进求职主题', threads: [t] });
  assert.equal(selected.decision.explicitThreadId, t.id);
  const c = { id: t.id, title: t.title, description: t.description, bound: false };
  const choice = await routed({ text: '第一个', threads: [t], clarification: { action: 'chat', purpose: 'persistent-use', candidates: [c] } }, { kind: 'daily', reason: '不会调用' });
  assert.equal(choice.calls, 0); assert.equal(choice.decision.action, 'selection'); assert.equal(choice.decision.explicitThreadId, t.id);
});

test('完整纯切换零模型，带新问题仍一次模型并完整保留原话', async () => {
  const t = thread('健身'), plain = await routed({ text: '切到健身', threads: [t] }, { kind: 'daily', reason: '不会调用' });
  assert.equal(plain.calls, 0); assert.equal(plain.decision.action, 'selection');
  const full = '切到健身，今天怎么练', mixed = await routed({ text: full, threads: [t] }, { kind: 'use', threadId: t.id, reason: '本次新问题' });
  assert.equal(mixed.calls, 1); assert.equal(mixed.decision.action, 'chat'); assert.equal(JSON.parse(mixed.sent).currentMessage, full);
});

test('一般历史跟进允许一次模型；裸审批无有效view澄清，不扫描其他Session', async () => {
  const t = thread('健身'), current = { contextKey: t.chatContextKey, references: { kinds: [], count: 0 } };
  const follow = await routed({ text: '那个训练动作怎么做', threads: [t], current }, { kind: 'use', threadId: t.id, reason: '延续当前主题' });
  assert.equal(follow.calls, 1); assert.equal(follow.choice.kind, 'use');
  const confirm = await routed({ text: '确认', threads: [t], current }, { kind: 'daily', reason: '不调用' });
  assert.equal(confirm.calls, 0); assert.equal(confirm.choice.kind, 'clarify');
});

test('21主题/8KiB不截断成唯一，明确全名能缩小；同名不擅选', async () => {
  const threads = Array.from({ length: 21 }, (_, i) => thread('项目' + i));
  const many = await routed({ text: '继续讨论', threads }, { kind: 'daily', reason: '不调用' }); assert.equal(many.calls, 0); assert.equal(many.choice.kind, 'clarify');
  const named = await routed({ text: '项目20继续', threads }, { kind: 'use', threadId: threads[20]!.id, reason: '明确本轮名称' }); assert.equal(named.calls, 1);
  const huge = Array.from({ length: 20 }, (_, i) => ({ ...thread('范围' + i), description: '字'.repeat(480) }));
  assert.equal((await routed({ text: '继续', threads: huge }, { kind: 'daily', reason: '不调用' })).calls, 0);
  const same = [{ ...thread('同名'), description: '项目甲' }, { ...thread('同名'), description: '项目乙' }];
  const result = await routed({ text: '切到同名', threads: same }, { kind: 'clarify', question: '模型任意问题', reason: '同名' });
  assert.equal(result.decision.action, 'answer'); assert.equal(result.decision.candidates.length, 2); assert.match(result.choice.kind === 'clarify' ? result.choice.question : '', /1.同名（项目甲）；2.同名（项目乙）/);
});

test('引用他主题保持当前，目录和路由请求不含contextKey/正文', async () => {
  const a = thread('资料A'), b = thread('项目B'); const result = await routed({ text: '在项目B继续，参考资料A那份报告', threads: [a,b],
    current: { contextKey: b.chatContextKey, references: { kinds: [], count: 0 } } }, { kind: 'use', threadId: a.id, reason: '误把引用当切换' });
  assert.equal(result.choice.kind === 'use' && result.choice.threadId, b.id); assert.ok(!result.sent.includes(a.chatContextKey!)); assert.ok(!result.sent.includes(b.chatContextKey!));
});


test('当前原话作用范围：引用材料不能建主题，无关能力否定不撤销持续意图', () => {
  const choice: TopicRouteChoice = { kind: 'create', title: '健身', description: '', reason: '模型自报' };
  assert.equal(proposal(choice, { text: '请总结以下文案：以后持续帮我健身', threads: [] }).choice.kind, 'clarify');
  for (const text of ['以后帮我健身，不用保存Memory/不要联网','以后帮我健身，不要创建提醒或Goal']) assert.equal(proposal(choice, { text, threads: [] }).choice.kind, 'create');
});

test('全文纯选择不得删除引号材料；长公共前缀候选显示可区分范围', async () => {
  const t = thread('健身');
  const mixed = await routed({ text: '切到健身 “今天怎么练”', threads: [t] }, { kind: 'use', threadId: t.id, reason: '当前问题' });
  assert.equal(mixed.decision.action, 'chat'); assert.equal(mixed.calls, 1); assert.match(mixed.sent, /今天怎么练/);
  const a = thread('Personal Agent项目甲'), b = thread('Personal Agent项目乙');
  const q = proposal({ kind: 'clarify', question: '模型任意', reason: '歧义' }, { text: '选择哪个项目', threads: [a,b] });
  assert.match(q.choice.kind === 'clarify' ? q.choice.question : '', /项目甲/); assert.match(q.choice.kind === 'clarify' ? q.choice.question : '', /项目乙/);
});

test('引用旧未绑定资料不索取绑定；通用澄清选项不产生旧绑定依据', async () => {
  const a = thread('旧资料A', false), b = thread('当前B');
  const reference = proposal({ kind: 'use', threadId: a.id, reason: '模型误路由' }, { text: '在当前B参考旧资料A的报告', threads: [a,b], current: { contextKey: b.chatContextKey, references: { kinds: [], count: 0 } } });
  assert.equal(reference.choice.kind === 'use' && reference.choice.threadId, b.id); assert.equal(reference.decision.explicitThreadId, undefined);
  const generic = await routed({ text: '第一个', threads: [a,b], clarification: { action: 'chat', candidates: [{ id: a.id, title: a.title, description: a.description, bound: false }] } }, { kind: 'daily', reason: '无有效持续用途' });
  assert.equal(generic.decision.explicitThreadId, undefined); assert.notEqual(generic.decision.action, 'selection');
});


test('澄清编号的全文含引号新问题时，不能被当成纯选择吞掉', async () => {
  const t = thread('健身'), c = { id: t.id, title: t.title, description: t.description, bound: true };
  const result = await routed({ text: '第一个 “今天怎么练”', threads: [t], clarification: { action: 'chat', candidates: [c] } }, { kind: 'use', threadId: t.id, reason: '本次新问题' });
  assert.equal(result.calls, 1); assert.equal(result.decision.action, 'chat'); assert.match(result.sent, /今天怎么练/);
});


test('同名项目即使模型代选也需当前唯一范围；第十二个对应宿主顺序', async () => {
  const a = { ...thread('同名'), description: '范围甲' }, b = { ...thread('同名'), description: '范围乙' };
  assert.equal(proposal({ kind: 'use', threadId: a.id, reason: '模型自选' }, { text: '继续同名', threads: [a,b] }).choice.kind, 'clarify');
  assert.equal(proposal({ kind: 'use', threadId: a.id, reason: '当前明确范围' }, { text: '继续同名范围甲', threads: [a,b] }).choice.kind, 'use');
  const threads = Array.from({ length: 12 }, (_, i) => thread('项' + i)), candidates = threads.map(t => ({ id:t.id,title:t.title,description:t.description,bound:true }));
  const selected = await routed({ text: '第十二个', threads, clarification: { action:'chat', candidates } }, { kind:'daily',reason:'不调用' });
  assert.equal(selected.calls, 0); assert.equal(selected.choice.kind === 'use' && selected.choice.threadId, threads[11]!.id);
});


const referenceCases = ['在求职B继续，参考资料A那份报告，今天怎么准备面试', '切到求职B，参考资料A报告帮我准备面试', '在求职B继续，不要引用资料A'];
test('R1-1入口：当前C明确B引用A，正确B和误选A都不允许退回C', () => {
  const a=thread('资料A'),b=thread('求职B'),c=thread('当前C');
  for(const text of referenceCases)for(const selected of [a,b]){
    const result=proposal({kind:'use',threadId:selected.id,reason:'模型建议'}, {text,threads:[a,b,c],current:{contextKey:c.chatContextKey,references:{kinds:[],count:0}}});
    assert.equal(result.choice.kind==='use'&&result.choice.threadId,b.id,text+' 模型'+selected.title);
  }
});
test('R1-1入口：明确去向不可核实只澄清，纯引用旧A保持当前且不索取绑定', () => {
  const a=thread('资料A',false),b=thread('求职B'),c=thread('当前C'),current={contextKey:c.chatContextKey,references:{kinds:[],count:0}};
  const unknown=proposal({kind:'use',threadId:a.id,reason:'误选资料'}, {text:'在未定位的项目继续，参考资料A报告',threads:[a,b,c],current});
  assert.equal(unknown.choice.kind,'clarify');assert.equal(unknown.decision.explicitThreadId,undefined);
  for(const text of ['参考资料A那份报告解释一下','不要引用资料A']){
    const result=proposal({kind:'use',threadId:a.id,reason:'误选资料'}, {text,threads:[a,b,c],current});
    assert.equal(result.choice.kind==='use'&&result.choice.threadId,c.id);assert.equal(result.decision.explicitThreadId,undefined);
  }
});


test('R2原业务指代识别覆盖Goal/Task/Memory/编号，普通跟进/具名新操作不冒充引用',()=>{
  for(const text of ['批准那个学习计划','继续那个目标','暂停那个松柏学习计划','调整刚才的目标','查看第二个目标'])assert.equal(businessReferenceFromMessage(text),'goal',text);
  for(const text of ['取消刚才那个提醒','取消第二个提醒','查看最新提醒'])assert.equal(businessReferenceFromMessage(text),'task',text);
  for(const text of ['忘记刚才那条记忆','更新第二条记忆'])assert.equal(businessReferenceFromMessage(text),'memory',text);
  assert.equal(businessReferenceFromMessage('更新刚才那个：新正文'),undefined,'含正文的复杂操作交原Chat，Guard实际选择处仍核对引用');
  for(const text of ['那个训练动作怎么做','刚才那个训练动作怎么做','第一个训练动作怎么做','查看第一个训练动作怎么做','以后持续跟进第一项目','他说“批准那个学习计划”','批准虚构学习目标乙计划'])assert.equal(businessReferenceFromMessage(text),undefined,text);
});

test('R2按原类型计算当前Goal完整view/Task last和choice，编号从多项选一；失效不借其他类型',async()=>{
  const store=new SqliteStore(':memory:'),clock=new Date('2026-11-03T00:00:00Z'),tasks=new TaskService(store,'UTC',()=>clock),goals=new GoalService(store,tasks,()=>{});
  const state:DialogueReferences={},guard=new OperationGuard(tasks,undefined,async()=>({}),state),a=thread('当前A'),b=thread('另一B');
  try{await tasks.withTarget(webTarget,async()=>{
    const ta=tasks.create('TASK甲','明天下午3点'),tb=tasks.create('TASK乙','明天下午3点');
    state.tasks=[ta.id,tb.id];state.taskViewExpires=clock.getTime()+300000;state.lastTask=ta.id;state.lastTaskExpires=state.taskViewExpires;
    const seed=store.beginRun(null,clock.toISOString()),ga={ownerId:'local-user',target:webTarget};
    const goal=store.goals.create(ga,seed.id,'虚构学习目标',clock.toISOString()),claimed=store.goals.claim(ga,goal.id,goal.revision,clock.toISOString())!;
    store.goals.commit(claimed.run.id,{stepOutcome:'complete',artifactText:'虚构待批计划',progressSummary:'待核对',question:'核对',proposedPlan:{changeReason:'虚构',steps:[{title:'练习',instruction:'写练习',deliverable:'文字',doneWhen:'核对'}]}},clock.toISOString());
    const current=store.goals.get(ga,goal.id),view=store.beginRun(null,clock.toISOString());store.finishRun(view.id,'succeeded',clock.toISOString(),'完整虚构Goal展示');store.event(view.id,'delivery_succeeded');
    state.goalView={items:[{id:current.id,revision:current.revision,draftHash:current.pendingAction!.hash}],expires:clock.getTime()+300000,displayRunId:view.id,details:true};
    const request=(prompt:string)=>({prompt,scope:'chat' as const,signal:new AbortController().signal,source:{channel:'web' as const,reference:seed.id},observer:store.observer(seed.id)});
    for(const [text,kind]of [['批准那个学习计划','goal'],['取消刚才那个提醒','task'],['取消第二个提醒','task']]as const){
      const refs=guard.routingReferences(request(text),goals);assert.equal(refs.reference?.kind,kind);assert.equal(refs.reference?.count,1,text);assert.ok(refs.count>1);
      const result=await routed({text,threads:[a,b],current:{contextKey:a.chatContextKey,references:refs}},useForTest(b.id));assert.equal(result.calls,0);assert.equal(result.choice.kind==='use'&&result.choice.threadId,a.id);
    }
    const refs=guard.routingReferences(request('批准那个学习计划'),goals);
    const conflict=await routed({text:'切到另一B，批准那个学习计划',threads:[a,b],current:{contextKey:a.chatContextKey,references:refs}},useForTest(b.id));assert.equal(conflict.choice.kind,'clarify');assert.equal(conflict.calls,0);
    state.lastTaskExpires=clock.getTime()-1;assert.equal(guard.routingReferences(request('取消刚才那个提醒'),goals).reference?.count,0);
    assert.equal(guard.routingReferences(request('取消第一百个提醒'),goals).reference?.count,0);
    state.goalView.items[0]!.revision++;assert.equal(guard.routingReferences(request('批准那个学习计划'),goals).reference?.count,0);state.goalView.items[0]!.revision--;
    state.goalShortConfirmationEnded=true;assert.equal(guard.routingReferences(request('批准那个学习计划'),goals).reference?.count,0);delete state.goalShortConfirmationEnded;
    state.goalView.expires=clock.getTime()-1;assert.equal(guard.routingReferences(request('继续那个目标'),goals).reference?.count,0);
    assert.equal(store.getTask(ta.id)!.status,'pending');assert.equal(store.getTask(tb.id)!.status,'pending');
  });}finally{store.close();}
});
function useForTest(threadId:string):TopicRouteChoice{return{kind:'use',threadId,reason:'固定错误模型建议'};}

for(const text of ['以后持续帮我健身；求职只是这次改写的一份短文','以后持续帮我健身，顺便解释求职这个词，不是要在求职长期讨论',
  '以后持续帮我健身并在求职只改写一次短文','以后持续帮我健身同时跟进求职但本次只是短文','以后持续帮我健身，资料：以后持续跟进求职','他说“以后长期跟进求职”','不要在求职长期讨论'])test('R2旧绑定目标自身范围拒绝：'+text,()=>{
  const old=thread('求职',false),result=proposal({kind:'use',threadId:old.id,reason:'固定错误建议'},{text,threads:[old]});assert.equal(result.decision.explicitThreadId,undefined);assert.equal(result.choice.kind,'clarify');
});
test('R2旧绑定自身肯定持续用途及无关能力否定保持正向，新create不硬配模型标题',()=>{
  const old=thread('求职',false);
  for(const text of ['以后持续跟进求职，不联网、不保存Memory','以后帮我持续跟进求职主题，不要联网','把求职选用为持续主题','以后在求职主题聊',`以后持续跟进${old.id}`]){
    assert.equal(proposal({kind:'use',threadId:old.id,reason:'当前目标自身用途'},{text,threads:[old]}).decision.explicitThreadId,old.id,text);
  }
  assert.equal(proposal({kind:'create',title:'模型概括的不同名称',description:'训练与饮食',reason:'当前肯定持续事项'},{text:'以后帮我持续记录训练和饮食',threads:[]}).choice.kind,'create');
});


test('R2无效候选编号不回退成有效引用；复用同次ACK/TTL/开关事实，投影不读Memory正文',async()=>{
  const h=formationHarness();try{
    await h.extract('我喜欢中文');const shown=h.formation.view(),run=h.store.beginRun(null,h.now().toISOString());h.store.finishRun(run.id,'succeeded',h.now().toISOString(),shown.text);
    const state:DialogueReferences={candidateReview:{...shown.view,displayRunId:run.id,displayHash:fingerprint(shown.text)}};
    const tasks=new TaskService(h.store,'UTC',h.now),guard=new OperationGuard(tasks,h.memory,async()=>({}),state),request={...h.request('批准第一个记忆候选'),source:{channel:'console' as const,reference:run.id}};
    const read=h.memory.listForHost.bind(h.memory);let reads=0;h.memory.listForHost=()=>{reads++;return read();};
    assert.equal(guard.routingReferences(request,undefined,h.formation).reference?.count,0);
    h.store.event(run.id,'delivery_succeeded');assert.equal(guard.routingReferences(request,undefined,h.formation).reference?.count,1);
    h.formation.options.enabled=false;assert.equal(guard.routingReferences(request,undefined,h.formation).reference?.count,0);h.formation.options.enabled=true;
    h.advance(300001);assert.equal(guard.routingReferences(request,undefined,h.formation).reference?.count,0);assert.equal(reads,0);
  }finally{await h.close();}
});


// 收尾复用原入口；普通问题不因历史对象词而成为业务请求。
test('N3收尾普通正文请求框架与整句绑定否定',async()=>{
  const a=thread('健身'),old=thread('求职',false);
  for(const text of ['继续刚才那个训练计划的解释','继续解释刚才那个训练计划','取消刚才那个提醒会有什么影响？','调整刚才那个计划是什么意思？','刚才那个训练计划里的深蹲动作怎么做','刚才那个训练计划应该怎么调整','解释一下如何取消刚才那个提醒','请解释刚才那个学习计划里的动作']){
    assert.equal(businessReferenceFromMessage(text),undefined,text);
    for(const references of [{kinds:[],count:0},{kinds:['goal'],count:1}] as const){
      const result=await routed({text,threads:[a],current:{contextKey:a.chatContextKey,references:{kinds:[...references.kinds],count:references.count}}},useForTest(a.id));
      assert.equal(result.calls,1);assert.equal(result.choice.kind,'use');assert.match(result.sent,new RegExp(text));
    }
  }
  for(const text of ['以后持续跟进求职，但不要绑定主题','以后持续跟进求职，不要选用为持续主题','不要绑定主题；以后持续跟进求职','不用选用为持续主题，但以后持续跟进求职']){
    const result=proposal(useForTest(old.id),{text,threads:[old]});assert.equal(result.decision.explicitThreadId,undefined,text);assert.equal(result.choice.kind,'clarify');
  }
  for(const text of ['以后持续跟进求职，不联网','以后持续跟进求职，不保存Memory','把求职选用为持续主题'])assert.equal(proposal(useForTest(old.id),{text,threads:[old]}).decision.explicitThreadId,old.id);
});


test('收尾C2否定动作按主题对象与省略范围判断，另一能力否定不撤销持续用途',()=>{
  const old=thread('求职',false),yes=useForTest(old.id),fresh={kind:'create',title:'模型自由命名',description:'虚构持续范围',reason:'固定建议'}as const;
  for(const text of ['以后持续跟进求职，但不要在这里绑定主题','以后持续跟进求职，但不要帮我绑定主题','以后持续跟进求职，但不需要绑定主题','以后持续跟进求职，暂时不必绑定主题','以后持续跟进求职，不打算绑定主题','以后持续跟进求职，不愿意再绑定主题','以后持续跟进求职，但不绑定任何主题','以后持续跟进求职，不要把求职绑定为任意主题','以后持续跟进求职，但不绑定主题','以后持续跟进求职，但不要绑定','不要选用，但以后持续跟进求职','不把求职绑定为主题，以后持续跟进求职','以后持续跟进求职，不要建立会话']){
    for(const choice of [yes,fresh]){const result=proposal(choice,{text,threads:[old]});assert.equal(result.choice.kind,'clarify',text);assert.equal(result.decision.explicitThreadId,undefined);}
  }
  for(const text of ['以后持续跟进求职，不要帮我绑定文件到Goal','以后持续跟进求职，不要在这里把含主题信息的文件绑定到主题','以后持续跟进求职，不需要绑定文件到Goal','以后持续跟进求职，不必把文件绑定到主题','以后持续跟进求职，不需要创建Goal','以后持续跟进求职，不要绑定任何文件到Goal','以后持续跟进求职，不要把含主题信息的文件绑定到主题','以后持续跟进求职，不要绑定文件到Goal','以后持续跟进求职，不要把文件绑定到主题','以后持续跟进求职，不创建Goal','以后持续跟进求职，不保存Memory','以后持续跟进求职，不联网','以后持续跟进求职，资料：“不要绑定主题”']){
    assert.equal(proposal(yes,{text,threads:[old]}).decision.explicitThreadId,old.id,text);
    assert.equal(proposal(fresh,{text,threads:[]}).choice.kind,'create',text);
  }
});
