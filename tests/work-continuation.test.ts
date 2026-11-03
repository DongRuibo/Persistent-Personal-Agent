import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { workManageFixture, isWorkParse } from './helpers/work-manage-fixture.js';
import { content, reply, toolCall, type Payload } from './helpers/skills-fixture.js';
const count = (p: Payload) => p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
const handle = (raw: () => unknown) => (p: Payload) => isWorkParse(p) ? reply(JSON.stringify(raw())) : !p.tools?.some(t => t.function.name === 'work_manage') ? reply('旧成果RESULT_ONLY') : count(p) ? reply('收尾') : toolCall('work_manage', {});
const now = '2026-11-01T00:00:00.000Z';
test('历史超过20不挡新独立工作，也不按最近20截目录', async () => {
  const text = '整理新面试：材料NEW_ONLY。';
  const f = await workManageFixture(handle(() => ({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '新面试', quotes: [text] }] })));
  try {
    for (let i = 0; i < 12; i++) { const t = f.store.workThreads.create(f.actor, randomUUID(), '历史主题'+i, now); f.store.workJobs.create(f.actor, t.id, randomUUID(), '历史工作'+i, now); }
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'work'); assert.equal(f.store.workJobs.list(f.actor).length, 13);
  } finally { await f.close(); }
});
test('全库明确旧名称可越过WorkJobs.list的100项查询及取消', async () => {
  let raw: unknown = { action: 'query', mode: 'query', evidence: '老面试进度', keywords: ['老面试'] };
  const f = await workManageFixture(handle(() => raw));
  try {
    const thread = f.store.workThreads.create(f.actor, randomUUID(), '共用主题', now), old = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理老面试：OLD_ONLY。', now);
    for (let i = 0; i < 105; i++) f.store.workJobs.create(f.actor, thread.id, randomUUID(), '其他工作'+i, now);
    const r = await f.chat('老面试进度'); assert.equal(r.items[0]?.targetId, old.id);
    raw = { action: 'cancel', mode: 'request', evidence: '停下老面试', keywords: ['老面试'] };
    const cancelled = await f.chat('停下老面试'); assert.equal(cancelled.items[0]?.decision, 'cancel'); assert.equal(f.store.workJobs.get(f.actor, old.id).status, 'cancelled');
  } finally { await f.close(); }
});

function gate() { let open!: () => void; const promise = new Promise<void>(resolve => { open = resolve; }); return { promise, open }; }
const parsed = (action: string, text: string, keywords?: string[]) => ({ action, mode: action === 'query' ? 'query' : 'request', evidence: text, ...(keywords ? { keywords } : {}) });

test('同主题两工作各两轮，用户具名查询决定焦点；晚通知/轮询不抢指代或串成果', async t => {
  let raw: unknown;
  const workerHttp: Payload[] = [], calls = { A: 0, B: 0, C: 0 };
  const f = await workManageFixture(p => {
    if (isWorkParse(p)) return reply(JSON.stringify(raw));
    if (p.tools?.some(tool => tool.function.name === 'work_manage')) return count(p) ? reply('收尾') : toolCall('work_manage', {});
    workerHttp.push(p); const body = content(p.messages.findLast(message => message.role === 'user')?.content);
    const name = body.includes('A_MATERIAL') ? 'A' : body.includes('B_MATERIAL') ? 'B' : 'C';
    return reply(`${name}_RESULT_${++calls[name]}`);
  });
  try {
    const thread = f.store.workThreads.create(f.actor, randomUUID(), '共同主题', now);
    const a = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理面试甲：A_MATERIAL，不联网、不保存记忆。', now);
    const b = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理周报乙：B_MATERIAL。', now);
    const other = f.store.workThreads.create(f.actor, randomUUID(), '第三工作主题', now);
    const c = f.store.workJobs.create(f.actor, other.id, randomUUID(), '整理文章丙：C_MATERIAL。', now);
    const publish = f.channel.sendMessage.bind(f.channel);
    let late: Parameters<typeof f.channel.sendMessage>[0] | undefined;
    f.channel.sendMessage = async message => {
      if (message.runId === f.store.workJobs.get(f.actor, c.id).runId) { late = message; return; }
      await publish(message);
    };
    // 三个首轮均走原Runner真实HTTP，C仅延迟通知投递，不延迟或伪造成果提交。
    for (let i = 0; i < 3; i++) await f.runner.tick();
    assert.deepEqual(calls, { A: 1, B: 1, C: 1 }); assert.ok(late);
    assert.equal(f.store.workJobs.get(f.actor, a.id).threadId, f.store.workJobs.get(f.actor, b.id).threadId);
    assert.equal(f.store.workJobs.get(f.actor, c.id).status, 'succeeded');
    for (const [name, root, wanted, unwanted] of [['面试甲',a.id,'A_RESULT_1','B_RESULT_1'],['周报乙',b.id,'B_RESULT_1','A_RESULT_1']] as const) {
      const query = name+'进度'; raw = parsed('query', query, [name]); await f.chat(query);
      await f.api('/state'); if (late) { await publish({ ...late, text: '另一工作晚通知OTHER_NOTICE\n' + late.text }); late = undefined; }
      const text = '再简短一点，不联网不保存记忆。'; raw = parsed('revise', text); const receipt = await f.chat(text);
      assert.equal(receipt.items[0]?.decision, 'feedback'); assert.equal(receipt.items[0]?.targetId, root);
      assert.equal(f.store.workJobs.chain(f.actor, root).length, 1, '等待阶段不创建可暗改的queued后继');
      const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload);
      assert.equal(payload.tools, undefined); assert.ok(body.includes(wanted)); assert.ok(!body.includes(unwanted)); assert.ok(!body.includes('OTHER_NOTICE')); assert.ok(!body.includes('C_MATERIAL')); assert.ok(!body.includes('C_RESULT'));
      if (root === a.id) assert.ok(body.includes('不联网、不保存记忆'));
      const chain = f.store.workJobs.chain(f.actor, root); assert.equal(chain.length, 2); assert.equal(chain[1]!.previousJobId, root); assert.equal(chain[1]!.rootJobId, root);
      assert.equal(chain[0]!.instruction, root === a.id ? a.instruction : b.instruction); assert.equal(f.store.workCoordinator.items(f.actor, receipt.requestId)[0]?.consumedByJobId, chain[1]!.id);
      t.diagnostic(JSON.stringify({ root, receipt: f.store.workCoordinator.items(f.actor, receipt.requestId), job: chain[1], workerHttp: payload }));
    }
    assert.deepEqual(calls, { A: 2, B: 2, C: 1 }); assert.equal(workerHttp.length, 5);
    for (const payload of workerHttp) assert.ok(['A_MATERIAL','B_MATERIAL','C_MATERIAL'].filter(marker => JSON.stringify(payload).includes(marker)).length === 1);
    t.diagnostic(JSON.stringify({ sameThread: thread.id, roots: [a.id,b.id], lateNoticeRoot: c.id, actualWorkerHttp: workerHttp, calls }));
  } finally { await f.close(); }
});

test('两个合理同名对象澄清且清除旧焦点，不能挑最近执行', async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const thread = f.store.workThreads.create(f.actor, randomUUID(), '面试', now);
    f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理甲候选面试。', now); f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理乙候选面试。', now);
    raw = parsed('query', '甲候选进度', ['甲候选']); await f.chat('甲候选进度');
    raw = parsed('query', '面试进度', ['面试']); const ambiguous = await f.chat('面试进度'); assert.match(ambiguous.items[0]!.receipt, /多个/);
    raw = parsed('revise', '再简短一点'); const next = await f.chat('再简短一点'); assert.equal(next.items[0]?.decision, 'clarify'); assert.match(next.items[0]!.receipt, /名称/);
    assert.equal(f.store.workJobs.chain(f.actor, f.store.workJobs.list(f.actor)[0]!.id).length, 1);
  } finally { await f.close(); }
});

test('运行中前序收多条补充，领取前合并一次；领取后纯资料等下一许可，不改在途输入', { timeout: 15000 }, async t => {
  let raw: unknown, workCalls = 0; const entered = gate(), release = gate(), enteredNext = gate(), releaseNext = gate();
  const f = await workManageFixture(async p => {
    if (isWorkParse(p)) return reply(JSON.stringify(raw));
    if (p.tools?.some(tool => tool.function.name === 'work_manage')) return count(p) ? reply('收尾') : toolCall('work_manage', {});
    workCalls++; if (workCalls === 1) { entered.open(); await release.promise; return reply('ORIGINAL_RESULT'); }
    if (workCalls === 2) { enteredNext.open(); await releaseNext.promise; return reply('SECOND_RESULT'); }
    return reply('THIRD_RESULT');
  });
  let first: Promise<void> | undefined, second: Promise<void> | undefined;
  try {
    const initial = '整理面试：材料ORIGINAL_ONLY。'; raw = { action: 'batch', mode: 'request', evidence: initial, items: [{ name: '面试', quotes: [initial] }] };
    const rootReceipt = await f.chat(initial), root = rootReceipt.items[0]!.targetId!;
    const original = f.store.workJobs.get(f.actor, root); first = f.runner.tick(); await entered.promise;
    const messages = ['重点讲调度CHANGE_ONE。', '再简短一点CHANGE_TWO。', '补充资料：MATERIAL_BEFORE_CLAIM。'];
    const receipts = [];
    for (const [i,text] of messages.entries()) { raw = parsed(i === 2 ? 'feedback' : 'revise', text); receipts.push(await f.chat(text)); }
    assert.equal(f.store.workJobs.chain(f.actor, root).length, 1); assert.equal(f.store.workJobs.get(f.actor, root).instruction, original.instruction);
    release.open(); await first; const before = f.payloads.length; second = f.runner.tick(); await enteredNext.promise;
    const claimed = f.store.workJobs.latest(f.actor, root); assert.equal(claimed.status, 'running'); const frozen = claimed.instruction;
    const rawHttp = JSON.stringify(f.payloads[before]); for (const marker of ['ORIGINAL_RESULT','CHANGE_ONE','CHANGE_TWO','MATERIAL_BEFORE_CLAIM']) assert.ok(rawHttp.includes(marker));
    const itemRows = receipts.map(r => f.store.workCoordinator.items(f.actor, r.requestId)[0]!); assert.equal(new Set(itemRows.map(i => i.consumedByJobId)).size, 1); assert.equal(itemRows[0]!.permissionItemId, itemRows[1]!.permissionItemId);
    const lateText = '补充资料：AFTER_CLAIM_ONLY。'; raw = parsed('feedback', lateText); const late = await f.chat(lateText);
    assert.equal(f.store.workJobs.latest(f.actor, root).instruction, frozen); assert.ok(!frozen.includes('AFTER_CLAIM_ONLY'));
    releaseNext.open(); await second; const calls = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, calls); assert.equal(workCalls, 2);
    assert.equal(f.store.workCoordinator.items(f.actor, late.requestId)[0]?.consumedByJobId, null);
    const nextText = '再简短一点NEXT_PERMISSION。'; raw = parsed('revise', nextText); const next = await f.chat(nextText); await f.runner.tick(); assert.equal(workCalls, 3);
    const last = f.store.workJobs.latest(f.actor, root); assert.equal(last.previousJobId, claimed.id); assert.ok(last.instruction.includes('SECOND_RESULT')); assert.ok(last.instruction.includes('AFTER_CLAIM_ONLY')); assert.ok(last.instruction.includes('NEXT_PERMISSION'));
    assert.equal(f.store.workCoordinator.items(f.actor, late.requestId)[0]?.consumedByJobId, last.id); assert.equal(f.store.workCoordinator.items(f.actor, next.requestId)[0]?.consumedByJobId, last.id);
    await f.runner.tick(); assert.equal(workCalls, 3); t.diagnostic(JSON.stringify({ firstSuccessorHttp: f.payloads[before], pendingItems: itemRows, secondSuccessor: last }));
  } finally { release.open(); releaseNext.open(); await first; await second; await f.close(); }
});

async function completed(f: Awaited<ReturnType<typeof workManageFixture>>, instruction = '整理面试：ORIGINAL_ONLY。', output = 'FULL_RESULT') {
  const thread = f.store.workThreads.list(f.actor)[0] ?? f.store.workThreads.create(f.actor, randomUUID(), '面试', now);
  const job = f.store.workJobs.create(f.actor, thread.id, randomUUID(), instruction, now), claim = f.store.workJobs.claim(f.actor, now)!;
  f.store.workJobs.finish(f.actor, job.id, claim.run.id, 'succeeded', now, output); return f.store.workJobs.get(f.actor, job.id);
}

test('普通问答使省略指代焦点失效；明确点名仍可定位', async () => {
  let raw: unknown, plain = false;
  const f = await workManageFixture(p => plain ? reply('普通问题的回答PLAIN_ONLY') : handle(() => raw)(p));
  try {
    await completed(f); raw = parsed('query', '面试进度', ['面试']); await f.chat('面试进度');
    plain = true; await f.chat('解释一下排队'); plain = false;
    raw = parsed('revise', '再简短一点'); const ambiguous = await f.chat('再简短一点'); assert.equal(ambiguous.items[0]?.decision, 'clarify');
    raw = parsed('revise', '面试那份重点讲调度', ['面试']); const named = await f.chat('面试那份重点讲调度');
    assert.equal(named.items[0]?.decision, 'feedback');
    raw = parsed('revise', '请修改面试：更简短。', ['面试']); const next = await f.chat('请修改面试：更简短。'); assert.equal(next.items[0]?.decision, 'feedback');
  } finally { await f.close(); }
});

for (const text of ['补充资料：DATA_ONLY。', '不要修改这份面试。', '引用：“再简短一点”。', '假设再简短一点。']) test(`原成果和旧焦点不产生新许可：${text}`, async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); raw = parsed('query', '面试进度', ['面试']); await f.chat('面试进度'); raw = parsed(text.startsWith('补充') ? 'feedback' : 'revise', text);
    const receipt = await f.chat(text), countBefore = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, countBefore); assert.equal(f.store.workJobs.chain(f.actor, root.id).length, 1);
    if (text.startsWith('补充')) assert.equal(receipt.items[0]?.permission, 'none'); else assert.equal(receipt.items[0]?.decision, 'clarify');
  } finally { await f.close(); }
});

for (const stopped of ['failed','interrupted','cancelled'] as const) test(`前序${stopped}不自动后继，待续输入标需要用户处理`, async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const thread = f.store.workThreads.create(f.actor, randomUUID(), '面试', now), root = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理面试。', now);
    const claim = f.store.workJobs.claim(f.actor, now)!;
    const text = '请修改面试：重点讲调度。'; raw = parsed('revise', text, ['面试']); const pending = await f.chat(text); assert.equal(pending.items[0]?.permission, 'available');
    if (stopped === 'cancelled') f.store.workJobs.cancel(f.actor, root.id, now); else f.store.workJobs.finish(f.actor, root.id, claim.run.id, stopped, now, undefined, '合成停止');
    const calls = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, calls); assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'needs_user');
    assert.equal(f.store.workJobs.chain(f.actor, root.id).length, 1);
  } finally { await f.close(); }
});

test('停止根工作撤销成功前序的待消费许可及资料，不取消另一工作', async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); const text = '请修改面试：再简短。'; raw = parsed('revise', text, ['面试']); const pending = await f.chat(text);
    raw = parsed('cancel', '停下面试', ['面试']); const r = await f.chat('停下面试'); assert.equal(r.items[0]?.decision, 'cancel');
    assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'revoked'); const calls = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, calls);
    assert.equal(f.store.workJobs.get(f.actor, root.id).status, 'succeeded');
  } finally { await f.close(); }
});

for (const failure of ['changed','missing','budget','budget32','request-hash','input-hash'] as const) test(`全文来源${failure}阻止领取且0Worker HTTP，不改用节选`, async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f, '整理面试。', failure === 'budget' ? '大'.repeat(6000) : failure === 'budget32' ? '"'.repeat(6500) : 'FULL_RESULT');
    const text = '请修改面试：再简短。'; raw = parsed('revise', text, ['面试']); const pending = await f.chat(text);
    if (failure === 'changed') f.db.prepare('UPDATE runs SET output=? WHERE id=?').run('CHANGED_SECRET', root.runId!);
    if (failure === 'missing') f.db.prepare('UPDATE runs SET output=NULL WHERE id=?').run(root.runId!);
    if (failure === 'input-hash') f.db.prepare('UPDATE work_jobs SET instruction=? WHERE id=?').run('CHANGED_OBJECTIVE', root.id);
    if (failure === 'request-hash') f.db.prepare('UPDATE web_ui_chats SET text=? WHERE requestId=?').run('TAMPERED', pending.requestId);
    const before = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, before);
    const item = f.store.workCoordinator.items(f.actor, pending.requestId)[0]!; assert.equal(item.permission, 'needs_user'); assert.match(item.receipt, /变化|缺失|预算/);
    assert.equal(f.store.workJobs.chain(f.actor, root.id).length, 1);
  } finally { await f.close(); }
});

test('超过Recall节选的完整结果尾部进入Worker且来源hash正确，指定旧版不替换最新', async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const full = 'a'.repeat(4400)+'TAIL_FULL_RESULT', root = await completed(f, '整理面试：ONLY_THIS_WORK。', full);
    const text = '请修改面试：再简短。'; raw = parsed('revise', text, ['面试']); await f.chat(text); await f.runner.tick(); const second = f.store.workJobs.latest(f.actor, root.id);
    const oldText = '请修改面试旧版 '+root.id+'：只改语气。'; raw = { ...parsed('revise', oldText, ['面试']), source: { kind: 'job', id: root.id } };
    const r = await f.chat(oldText); const n = f.payloads.length; await f.runner.tick(); const last = f.store.workJobs.latest(f.actor, root.id);
    assert.equal(last.previousJobId, root.id); assert.notEqual(last.previousJobId, second.id); assert.ok(last.instruction.includes('TAIL_FULL_RESULT')); assert.equal(last.inputReferences?.filter(r => r.kind === 'job_result').length, 1);
    t.diagnostic(JSON.stringify({ items: f.store.workCoordinator.items(f.actor, r.requestId), job: last, workerHttp: f.payloads[n] }));
    raw = parsed('revise', '请修改面试上一版：语气更轻。', ['面试']); const ambiguous = await f.chat('请修改面试上一版：语气更轻。'); assert.equal(ambiguous.items[0]?.decision, 'clarify');
  } finally { await f.close(); }
});

test('领取事务故障回滚Job+Run+消费，重复工具/消息只消费一次', async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); const text = '请修改面试：再简短。'; raw = parsed('revise', text, ['面试']); const pending = await f.chat(text);
    const runs = f.db.prepare('SELECT count(*) AS n FROM runs').get()?.n, calls = f.payloads.length;
    f.db.exec("CREATE TRIGGER fail_consume BEFORE UPDATE ON web_request_items WHEN NEW.consumedByJobId IS NOT NULL BEGIN SELECT RAISE(ABORT,'atomic fault'); END");
    await assert.rejects(f.runner.tick(), /atomic fault/); assert.equal(f.payloads.length, calls); assert.equal(f.db.prepare('SELECT count(*) AS n FROM runs').get()?.n, runs);
    assert.equal(f.store.workJobs.chain(f.actor, root.id).length, 1); assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'available');
    f.db.exec('DROP TRIGGER fail_consume'); await f.chat(text, pending.requestId); await f.runner.tick(); await f.runner.tick();
    assert.equal(f.store.workJobs.chain(f.actor, root.id).length, 2); assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'consumed');
  } finally { await f.close(); }
});

test('后继遵守due Task与checkReady，普通queued按许可时间比较', async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f), queued = f.store.workJobs.create(f.actor, root.threadId, randomUUID(), 'QUEUED_FIRST', now);
    const text = '请修改面试：再简短。'; raw = parsed('revise', text, [root.id]); // 当前原话必须包含完整具名条件。
    const named = '请修改面试 '+root.id+'：再简短。'; raw = parsed('revise', named, [root.id]); const pending = await f.chat(named);
    const original = f.executor.checkReady; f.executor.checkReady = () => { throw new Error('临时未就绪'); };
    const calls = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, calls); assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'available');
    f.executor.checkReady = original; const task = f.store.createTask('到期Task优先', now, now, { channel: 'web', userId: 'local-user' });
    await f.runner.tick(); assert.equal(f.payloads.length, calls); f.db.prepare("UPDATE tasks SET status='cancelled' WHERE id=?").run(task.id);
    await f.runner.tick(); assert.equal(f.store.workJobs.get(f.actor, queued.id).status, 'succeeded'); assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'available');
    await f.runner.tick(); assert.equal(f.store.workCoordinator.items(f.actor, pending.requestId)[0]?.permission, 'consumed');
  } finally { await f.close(); }
});

for (const damage of ['valid','discarded','hash','inputhash','active','policy','off','alias'] as const) test(`Goal成果${damage}只接受有效committed全文，不回退技术Run或旁路Goal控制`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw), true, { goals: damage !== 'off' });
  try {
    const goalActor = { ownerId: 'local-user', target: { channel: 'web' as const, userId: 'local-user' } };
    const goal = f.store.goals.create(goalActor, f.store.beginRun(null, now).id, '研究总结', now), claim = f.store.goals.claim(goalActor, goal.id, goal.revision, now)!;
    if (damage === 'discarded') f.store.goals.control({ actor: goalActor, sourceRunId: f.store.beginRun(null, now).id, expectedRevision: claim.goal.revision, text: '暂停' }, goal.id, 'pause', now);
    f.store.goals.commit(claim.run.id, { stepOutcome: 'partial', artifactText: 'GOAL_COMMITTED_ONLY', progressSummary: '阶段完成', question: '继续吗？' }, now);
    if (damage === 'hash') { f.db.exec('DROP TRIGGER goal_execution_immutable'); f.db.prepare('UPDATE goal_executions SET checkpointHash=? WHERE runId=?').run('0'.repeat(64), claim.run.id); }
    if (damage === 'inputhash') { f.db.exec('DROP TRIGGER goal_execution_immutable'); f.db.prepare('UPDATE goal_executions SET inputHash=? WHERE runId=?').run('0'.repeat(64), claim.run.id); }
    if (damage === 'policy') f.db.prepare("INSERT INTO goal_policies(id,goalId,ownerId,accessKey,version,status,goalRevision,planRevision,specJson,createdAt,updatedAt) VALUES(?,?,?,?,1,'active',1,1,'{}',?,?)").run(randomUUID(), goal.id, goal.ownerId, goal.accessKey, now, now);
    if (damage === 'active') f.db.prepare("UPDATE goals SET status='running' WHERE id=?").run(goal.id);
    let keywords = ['研究总结'];
    if (damage === 'alias') {
      const root = await completed(f, '整理面试。'); f.db.prepare('UPDATE work_jobs SET runId=? WHERE id=?').run(claim.run.id, root.id); keywords = ['面试'];
    }
    const text = '请修改'+keywords[0]+'成果：更简短。'; raw = parsed('revise', text, keywords); const receipt = await f.chat(text); const n = f.payloads.length; await f.runner.tick();
    if (damage === 'valid') {
      assert.equal(receipt.items[0]?.targetKind, 'goal'); const payload = f.payloads[n]!; assert.ok(JSON.stringify(payload).includes('GOAL_COMMITTED_ONLY'));
      const job = f.store.workJobs.list(f.actor)[0]!; assert.equal(job.previousJobId, null); assert.ok(job.inputReferences?.some(r => r.kind === 'goal_result' && r.goalId === goal.id && r.runId === claim.run.id));
      t.diagnostic(JSON.stringify({ item: f.store.workCoordinator.items(f.actor, receipt.requestId), workerHttp: payload }));
      const follow = '再简短一点'; raw = parsed('revise', follow); await f.chat(follow); await f.runner.tick();
      const last = f.store.workJobs.latest(f.actor, job.id); assert.equal(last.previousJobId, job.id);
      assert.ok(!last.instruction.includes('GOAL_COMMITTED_ONLY'), '第二轮只保留一个主前序全文，不能重塞初始Goal正文');
      assert.ok(last.instruction.includes('更简短'), '初始Goal成果的修改约束仍保留');

    } else { assert.equal(f.payloads.length, n); assert.equal(receipt.items[0]?.decision, 'clarify'); }
    assert.notEqual(f.store.goals.get(goalActor, goal.id).status, 'ready');
  } finally { await f.close(); }
});

test('跨账号的source提议不能替换当前原文定位的主前序', async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const own = await completed(f), other = { ...f.actor, owner: 'different-owner' }, thread = f.store.workThreads.create(other, randomUUID(), '面试', now);
    const foreign = f.store.workJobs.create(other, thread.id, randomUUID(), 'PRIVATE_FOREIGN', now);
    const text = '请修改面试：再简短。'; raw = { ...parsed('revise', text, ['面试']), source: { kind: 'job', id: foreign.id } };
    const r = await f.chat(text); assert.equal(r.run?.status, 'failed'); assert.equal(r.items.length, 0); assert.equal(f.store.workJobs.chain(f.actor, own.id).length, 1);
    assert.ok(!JSON.stringify(f.payloads.filter(isWorkParse)).includes('PRIVATE_FOREIGN'));
  } finally { await f.close(); }
});


for (const action of ['revise','feedback']) test(`多工作原文不能错误标${action}合进单一旧工作`, async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); const text = '请修改面试：A_ONLY。\n整理周报：B_ONLY。'; raw = parsed(action, text, ['面试']);
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'clarify'); const calls = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, calls); assert.equal(f.store.workJobs.chain(f.actor, root.id).length, 1);
  } finally { await f.close(); }
});

test('21个名称候选保留歧义，目录不截最近20猜一个', async () => {
  const text = '公共工作进度'; const f = await workManageFixture(handle(() => parsed('query', text, ['公共工作'])));
  try {
    const thread = f.store.workThreads.create(f.actor, randomUUID(), '公共工作', now);
    for (let i = 0; i < 21; i++) f.store.workJobs.create(f.actor, thread.id, randomUUID(), '整理公共工作'+i, now);
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'clarify'); assert.match(r.items[0]!.receipt, /多个/);
    const parser = f.payloads.find(isWorkParse)!;
    const input = JSON.parse(content(parser.messages.find(m => m.role === 'user')?.content));
    assert.equal(input.catalog.narrowed, true); assert.equal(input.catalog.jobs.length, 0); assert.ok(Buffer.byteLength(JSON.stringify(input.catalog)) <= 8192);
  } finally { await f.close(); }
});

test('原三项批次的父原话Hash引用不把其他两项材料复制到后继Worker', async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const parts = ['整理面试：INTERVIEW_ONLY。', '整理周报：WEEKLY_ONLY。', '修改文章：ARTICLE_ONLY。'], shared = '不联网、不保存记忆。';
    const text = shared+'\n'+parts.join('\n'); raw = { action:'batch',mode:'request',evidence:text,shared:[shared],items:parts.map((q,i) => ({ name:['面试','周报','文章'][i],quotes:[q] })) };
    const batch = await f.chat(text); for (let i = 0; i < 3; i++) await f.runner.tick();
    const follow = '请修改面试：再简短。'; raw = parsed('revise',follow,['面试']); await f.chat(follow);
    const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, serialized = JSON.stringify(payload);
    assert.equal(payload.tools,undefined); assert.ok(serialized.includes('INTERVIEW_ONLY')); assert.ok(serialized.includes(shared)); assert.ok(!serialized.includes('WEEKLY_ONLY')); assert.ok(!serialized.includes('ARTICLE_ONLY'));
    const job = f.store.workJobs.latest(f.actor,batch.items[0]!.targetId!); assert.equal(job.inputReferences?.filter(r => r.kind === 'job_result').length,1);
    t.diagnostic(JSON.stringify({ job,workerHttp:payload }));
  } finally { await f.close(); }
});

const mixedFollowup = '面试那份重点讲调度 INTERVIEW_REVISION_ONLY。\n周报那份再简短一点 WEEKLY_REVISION_ONLY。';
for (const [action, explicit] of [['revise',true],['feedback',true],['revise',false]] as const) test(`R1双工作具名补充先澄清，${action}/具名条件${explicit}不能漏另一工作`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    f.store.workThreads.create(f.actor,randomUUID(),'共同主题',now);
    const a = await completed(f, '整理面试：INTERVIEW_ORIGINAL_ONLY。', 'INTERVIEW_RESULT_ONLY');
    const b = await completed(f, '整理周报：WEEKLY_ORIGINAL_ONLY。', 'WEEKLY_RESULT_ONLY');
    raw = parsed('query','面试进度',['面试']); await f.chat('面试进度');
    raw = parsed(action,mixedFollowup,explicit ? ['面试'] : undefined); const rejected = await f.chat(mixedFollowup);
    assert.equal(rejected.text,mixedFollowup); assert.equal(rejected.items[0]?.decision,'clarify');
    assert.equal(rejected.items[0]?.targetId,null); assert.equal(rejected.items[0]?.permission,'none');
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM web_request_items WHERE requestId=? AND decision='feedback'").get(rejected.requestId)?.n,0,'不能把拒绝混合材料留待后续许可消费');
    const before = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length,before);
    const acceptedText = '面试那份再简短一点 SAFE_REVISION_ONLY。'; raw = parsed('revise',acceptedText,['面试']);
    const accepted = await f.chat(acceptedText); assert.equal(accepted.items[0]?.decision,'feedback');
    const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload);
    assert.equal(payload.tools,undefined); assert.ok(body.includes('SAFE_REVISION_ONLY')); assert.ok(body.includes('INTERVIEW_RESULT_ONLY'));
    for (const marker of ['INTERVIEW_REVISION_ONLY','WEEKLY_REVISION_ONLY','WEEKLY_RESULT_ONLY','WEEKLY_ORIGINAL_ONLY']) assert.ok(!body.includes(marker),marker);
    assert.equal(f.store.workJobs.chain(f.actor,a.id).length,2); assert.equal(f.store.workJobs.chain(f.actor,b.id).length,1);
    t.diagnostic(JSON.stringify({ rejected:rejected.items,accepted:f.store.workCoordinator.items(f.actor,accepted.requestId),workerHttp:payload }));
  } finally { await f.close(); }
});

for (const explicit of [true,false]) test(`R1同工作多条修改不被当多工作，具名${explicit}；原约束不删除`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); raw = parsed('query','面试进度',['面试']); await f.chat('面试进度');
    const text = explicit ? '面试那份重点讲调度 CHANGE_ONE。\n面试那份再简短一点 CHANGE_TWO。\n补上完整结论 CHANGE_THREE，不联网，不保存记忆，不要编造经历。'
      : '重点讲调度 CHANGE_ONE。\n再简短一点 CHANGE_TWO。\n补上完整结论 CHANGE_THREE，不联网，不保存记忆，不要编造经历。';
    raw = parsed('revise',text,explicit ? ['面试'] : undefined); const accepted = await f.chat(text); assert.equal(accepted.items[0]?.decision,'feedback');
    const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload);
    for (const marker of ['CHANGE_ONE','CHANGE_TWO','CHANGE_THREE','不联网','不保存记忆','不要编造经历']) assert.ok(body.includes(marker),marker);
    assert.equal(f.store.workJobs.chain(f.actor,root.id).length,2); t.diagnostic(JSON.stringify({ workerHttp:payload }));
  } finally { await f.close(); }
});

test('R1资料中的另一具名补充引文不提供授权，也不撤销当前单工作修改', async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); const text = '面试那份重点讲调度：资料中引用“周报那份再简短一点 QUOTED_ONLY”，这里只处理文字；不联网，不保存记忆。';
    raw = parsed('revise',text,['面试']); const accepted = await f.chat(text); assert.equal(accepted.items[0]?.decision,'feedback');
    const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!; assert.ok(JSON.stringify(payload).includes('QUOTED_ONLY')); assert.equal(f.store.workJobs.chain(f.actor,root.id).length,2);
    t.diagnostic(JSON.stringify({ workerHttp:payload }));
  } finally { await f.close(); }
});

test('R1当前具名工作后置不执行仍保留全部约束并澄清', async () => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    const root = await completed(f); const text = '面试那份重点讲调度，但先不要执行这项工作。'; raw = parsed('revise',text,['面试']);
    const r = await f.chat(text); assert.equal(r.items[0]?.decision,'clarify'); assert.deepEqual(r.items[0]?.ranges,[{ start:0,end:text.length,role:'instruction' }]);
    const n = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length,n); assert.equal(f.store.workJobs.chain(f.actor,root.id).length,1);
  } finally { await f.close(); }
});

const directMixedFollowup = '再修改面试：INTERVIEW_REVISION_ONLY。\n再修改周报：WEEKLY_REVISION_ONLY。';
for (const action of ['revise','feedback']) for (const keyword of [undefined,'面试','周报']) test(`R2同原文direct双工作/${action}/模型条件${keyword ?? '省略'}均在登记前澄清`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    f.store.workThreads.create(f.actor,randomUUID(),'共同主题',now);
    const a = await completed(f,'整理面试：INTERVIEW_ORIGINAL_ONLY。','INTERVIEW_RESULT_ONLY');
    const b = await completed(f,'整理周报：WEEKLY_ORIGINAL_ONLY。','WEEKLY_RESULT_ONLY');
    raw = parsed('query','面试进度',['面试']); const focused = await f.chat('面试进度'); assert.equal(focused.items[0]?.targetId,a.id);
    raw = parsed(action,directMixedFollowup,keyword ? [keyword] : undefined); const rejected = await f.chat(directMixedFollowup);
    assert.equal(rejected.text,directMixedFollowup); assert.equal(rejected.items[0]?.decision,'clarify'); assert.equal(rejected.items[0]?.permission,'none'); assert.equal(rejected.items[0]?.targetId,null);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM web_request_items WHERE requestId=? AND decision='feedback'").get(rejected.requestId)?.n,0);
    const before = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length,before);
    raw = parsed('query','周报进度',['周报']); const otherFocus = await f.chat('周报进度'); assert.equal(otherFocus.items[0]?.targetId,b.id);
    const single = '再修改面试：SAFE_DIRECT_ONLY。'; raw = parsed('revise',single); const accepted = await f.chat(single);
    assert.equal(accepted.items[0]?.decision,'feedback'); assert.equal(accepted.items[0]?.targetId,a.id,'显式面试不能被旧周报focus覆盖');
    const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload);
    assert.equal(payload.tools,undefined); assert.ok(body.includes('SAFE_DIRECT_ONLY')); assert.ok(body.includes('INTERVIEW_RESULT_ONLY'));
    for (const marker of ['INTERVIEW_REVISION_ONLY','WEEKLY_REVISION_ONLY','WEEKLY_RESULT_ONLY','WEEKLY_ORIGINAL_ONLY']) assert.ok(!body.includes(marker),marker);
    assert.equal(f.store.workJobs.chain(f.actor,a.id).length,2); assert.equal(f.store.workJobs.chain(f.actor,b.id).length,1);
    t.diagnostic(JSON.stringify({ proposedKeyword:keyword ?? null,rejected:rejected.items,accepted:f.store.workCoordinator.items(f.actor,accepted.requestId),workerHttp:payload }));
  } finally { await f.close(); }
});

test('R2显式同目标direct多句只合并一轮，省略模型条件不依赖旧focus', async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    f.store.workThreads.create(f.actor,randomUUID(),'共同主题',now);
    const a = await completed(f,'整理面试：INTERVIEW_ORIGINAL_ONLY。','INTERVIEW_RESULT_ONLY');
    const b = await completed(f,'整理周报：WEEKLY_ORIGINAL_ONLY。','WEEKLY_RESULT_ONLY');
    raw = parsed('query','周报进度',['周报']); await f.chat('周报进度');
    const text = '再修改面试：DIRECT_ONE，不联网。\n再修改面试：DIRECT_TWO，不保存记忆。'; raw = parsed('revise',text); const accepted = await f.chat(text);
    assert.equal(accepted.items[0]?.targetId,a.id); const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload);
    for (const marker of ['DIRECT_ONE','DIRECT_TWO','不联网','不保存记忆','INTERVIEW_RESULT_ONLY']) assert.ok(body.includes(marker),marker);
    assert.ok(!body.includes('WEEKLY_RESULT_ONLY')); assert.equal(f.store.workJobs.chain(f.actor,a.id).length,2); assert.equal(f.store.workJobs.chain(f.actor,b.id).length,1);
    t.diagnostic(JSON.stringify({ workerHttp:payload }));
  } finally { await f.close(); }
});

const prefixedChanges = [['重点讲','本周进展'],['突出','关键结论'],['简短','一点'],['补上','完整结论']] as const;
for (const [verb, details] of prefixedChanges) for (const action of ['revise','feedback']) test(`追加R3：${verb}/${action}的前置周报对象优先于面试focus`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    f.store.workThreads.create(f.actor,randomUUID(),'共同主题',now);
    const a = await completed(f,'整理面试：INTERVIEW_ORIGINAL_ONLY。','INTERVIEW_RESULT_ONLY');
    const b = await completed(f,'整理周报：WEEKLY_ORIGINAL_ONLY。','WEEKLY_RESULT_ONLY');
    raw = parsed('query','面试进度',['面试']); const focused = await f.chat('面试进度'); assert.equal(focused.items[0]?.targetId,a.id);
    const text = `针对周报${verb}${details} WEEKLY_PREFIX_ONLY。`; raw = parsed(action,text); const accepted = await f.chat(text);
    assert.equal(accepted.items[0]?.decision,'feedback'); assert.equal(accepted.items[0]?.targetId,b.id); assert.equal(accepted.text,text);
    if (action === 'revise') {
      const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload);
      assert.equal(payload.tools,undefined); assert.ok(body.includes('WEEKLY_RESULT_ONLY')); assert.ok(body.includes('WEEKLY_PREFIX_ONLY')); assert.ok(!body.includes('INTERVIEW_RESULT_ONLY'));
      assert.equal(f.store.workJobs.chain(f.actor,a.id).length,1); assert.equal(f.store.workJobs.chain(f.actor,b.id).length,2);
      t.diagnostic(JSON.stringify({ accepted:accepted.items,workerHttp:payload }));
    } else {
      const n = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length,n); assert.equal(accepted.items[0]?.permission,'none');
      const permitA = '针对面试重点讲合法内容 SAFE_INTERVIEW_ONLY。'; raw = parsed('revise',permitA); await f.chat(permitA);
      const before = f.payloads.length; await f.runner.tick(); const payload = f.payloads[before]!, body = JSON.stringify(payload);
      assert.ok(body.includes('INTERVIEW_RESULT_ONLY')); assert.ok(body.includes('SAFE_INTERVIEW_ONLY')); assert.ok(!body.includes('WEEKLY_PREFIX_ONLY')); assert.ok(!body.includes('WEEKLY_RESULT_ONLY'));
      assert.equal(f.store.workCoordinator.items(f.actor,accepted.requestId)[0]?.consumedByJobId,null);
      const permitB = '针对周报重点讲下一版 SAFE_WEEKLY_ONLY。'; raw = parsed('revise',permitB); await f.chat(permitB);
      const beforeB = f.payloads.length; await f.runner.tick(); const payloadB = f.payloads[beforeB]!, bodyB = JSON.stringify(payloadB);
      assert.ok(bodyB.includes('WEEKLY_PREFIX_ONLY')); assert.ok(bodyB.includes('SAFE_WEEKLY_ONLY')); assert.ok(!bodyB.includes('INTERVIEW_RESULT_ONLY')); assert.ok(!bodyB.includes('SAFE_INTERVIEW_ONLY'));
      assert.equal(f.store.workCoordinator.items(f.actor,accepted.requestId)[0]?.consumedByJobId,f.store.workJobs.latest(f.actor,b.id).id);
      t.diagnostic(JSON.stringify({ accepted:accepted.items,otherWorkerHttp:payload,ownWorkerHttp:payloadB }));
    }
  } finally { await f.close(); }
});

for (const action of ['revise','feedback']) for (const text of [
  '针对未知工作重点讲 REJECT_UNKNOWN_ONLY。',
  '针对面试重点讲 REJECT_INTERVIEW_ONLY。\n针对周报补上 REJECT_WEEKLY_ONLY。',
]) test(`追加R3：未知/多目标${action}不回退focus、不登记混合材料`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    f.store.workThreads.create(f.actor,randomUUID(),'共同主题',now);
    const a = await completed(f,'整理面试：INTERVIEW_ORIGINAL_ONLY。','INTERVIEW_RESULT_ONLY'); await completed(f,'整理周报：WEEKLY_ORIGINAL_ONLY。','WEEKLY_RESULT_ONLY');
    raw = parsed('query','面试进度',['面试']); await f.chat('面试进度'); raw = parsed(action,text); const rejected = await f.chat(text);
    assert.equal(rejected.items[0]?.decision,'clarify'); assert.equal(rejected.items[0]?.targetId,null); assert.equal(rejected.text,text);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM web_request_items WHERE requestId=? AND decision='feedback'").get(rejected.requestId)?.n,0);
    const n = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length,n);
    const permit = '针对面试重点讲许可内容 SAFE_AFTER_REJECTION。'; raw = parsed('revise',permit); await f.chat(permit);
    const before = f.payloads.length; await f.runner.tick(); const payload = f.payloads[before]!, body = JSON.stringify(payload);
    for (const marker of ['REJECT_UNKNOWN_ONLY','REJECT_INTERVIEW_ONLY','REJECT_WEEKLY_ONLY','WEEKLY_RESULT_ONLY']) assert.ok(!body.includes(marker),marker);
    assert.ok(body.includes('INTERVIEW_RESULT_ONLY')); assert.ok(body.includes('SAFE_AFTER_REJECTION')); assert.equal(f.store.workJobs.chain(f.actor,a.id).length,2);
    t.diagnostic(JSON.stringify({ rejected:rejected.items,workerHttp:payload }));
  } finally { await f.close(); }
});

for (const [verb,details] of prefixedChanges) test(`追加R3：${verb}的无名前置和纯focus保留正向`, async t => {
  let raw: unknown; const f = await workManageFixture(handle(() => raw));
  try {
    f.store.workThreads.create(f.actor,randomUUID(),'共同主题',now);
    const a = await completed(f,'整理面试：INTERVIEW_ORIGINAL_ONLY。','INTERVIEW_RESULT_ONLY'); const b = await completed(f,'整理周报：WEEKLY_ORIGINAL_ONLY。','WEEKLY_RESULT_ONLY');
    raw = parsed('query','面试进度',['面试']); await f.chat('面试进度');
    for (const text of [`针对这份${verb}${details} DEICTIC_ONLY。`,`${verb}${details} FOCUS_ONLY。`]) {
      raw = parsed('revise',text); const accepted = await f.chat(text); assert.equal(accepted.items[0]?.targetId,a.id); assert.equal(accepted.items[0]?.decision,'feedback');
      const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n]!, body = JSON.stringify(payload); assert.equal(payload.tools,undefined); assert.ok(body.includes(text)); assert.ok(!body.includes('WEEKLY_RESULT_ONLY'));
      t.diagnostic(JSON.stringify({ accepted:accepted.items,workerHttp:payload }));
    }
    assert.equal(f.store.workJobs.chain(f.actor,a.id).length,3); assert.equal(f.store.workJobs.chain(f.actor,b.id).length,1);
  } finally { await f.close(); }
});
