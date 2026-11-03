import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { content, reply, toolCall, type Payload } from './helpers/skills-fixture.js';
import { workManageFixture, isWorkParse } from './helpers/work-manage-fixture.js';

const parts = ['整理面试提纲：材料INTERVIEW_ONLY。', '整理项目周报：材料WEEKLY_ONLY。', '修改文章：材料ARTICLE_ONLY。'];
const shared = '不联网、不建Goal、不保存记忆；每项只用自己的材料。';
const prompt = shared + '\n' + parts.join('\n');
const batch = { action: 'batch', mode: 'request', evidence: prompt, shared: [shared], items: parts.map((q, i) => ({ name: ['面试提纲', '项目周报', '文章'][i], quotes: [q] })) };
const mainTools = (p: Payload) => p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
function handle(parsed: unknown = batch, repeat = false) {
  return (p: Payload) => !p.tools?.some(t => t.function.name === 'work_manage') && !isWorkParse(p) ? reply('隔离Worker成果') : isWorkParse(p) ? reply(JSON.stringify(parsed)) : mainTools(p) < (repeat ? 2 : 1) ? toolCall('work_manage', {}) : reply('模型声称都已完成（不可覆盖真实收据）');
}

test('真实Pi三项单Frame/一次消费，重复工具回同一收据；自动主题host来源，Worker材料逐项隔离', async t => {
  const f = await workManageFixture(handle(batch, true)); try {
    const receipt = await f.chat(prompt), jobs = f.store.workJobs.list(f.actor);
    assert.equal(receipt.run?.status, 'succeeded', f.store.getRun(receipt.runId!)?.error ?? '');
    assert.equal(receipt.items.length, 3); assert.equal(jobs.length, 3); assert.equal(f.payloads.filter(isWorkParse).length, 1);
    assert.match(receipt.run!.output!, /已排队/); assert.ok(!receipt.run!.output!.includes('都已完成'));
    assert.equal(f.store.workThreads.list(f.actor).length, 3); assert.equal(f.db.prepare('SELECT count(*) AS n FROM work_links').get()?.n, 0);
    for (const item of receipt.items) {
      assert.equal(item.permission, 'consumed'); const job = jobs.find(j => j.id === item.consumedByJobId)!;
      assert.equal(job.requestId, item.itemId); assert.equal(job.sourceItemId, item.itemId); assert.equal(job.rootJobId, job.id);
      assert.equal(job.inputReferences?.[0]?.hash, createHash('sha256').update(prompt).digest('hex'));
      assert.equal(job.inputHash, createHash('sha256').update(job.instruction).digest('hex'));
      assert.equal(item.ranges.length, 2); assert.ok(job.instruction.includes(shared));
    }
    const audit = f.store.events(receipt.runId!).filter(e => e.type === 'work_request_committed').map(e => JSON.parse(e.details!));
    assert.equal(audit.filter(a => a.organization === 'create' && a.source === 'host').length, 3);
    assert.equal((await f.chat(prompt, receipt.requestId)).runId, receipt.runId); assert.equal(f.store.workJobs.list(f.actor).length, 3);
    // 主对话结束后手动推进原WorkRunner；不添加新调度器或允许后台工具。
    for (let i = 0; i < 3; i++) {
      const before = f.payloads.length;
      // 后台没有管理工具，固定模型必须直接交付一次纯文本。
      const pending = f.store.workJobs.list(f.actor).filter(j => j.status === 'queued'); assert.ok(pending.length);
      const original = pending.at(-1)!;
      // 固定模型处理器在无work_manage白名单的请求下交付正文。
      await f.runner.tick();
      const payload = f.payloads[before]!;
      assert.equal(payload.tools, undefined);
      const raw = JSON.stringify(payload); assert.ok(raw.includes(original.instruction.split('\n').at(-1)!.slice(0, 5)));
      const contained = parts.filter(p => raw.includes(p)); assert.equal(contained.length, 1);
    }
    t.diagnostic(JSON.stringify({ batchItems: receipt.items.map(i => i.itemId), jobs: jobs.map(j => j.id), parserHttp: f.payloads.filter(isWorkParse).length, totalHttp: f.payloads.length }));
  } finally { await f.close(); }
});

test('合法材料歧义项保存澄清，其他两项同事务排队；同名唯一主题复用', async () => {
  const raw = structuredClone(batch); raw.items[1] = { ...raw.items[1]!, question: '周报需要哪种格式？' } as typeof raw.items[number];
  const f = await workManageFixture(handle(raw)); try {
    const thread = f.store.workThreads.create(f.actor, randomUUID(), '面试提纲', new Date().toISOString());
    const result = await f.chat(prompt); assert.equal(result.items.length, 3); assert.equal(result.items[1]?.decision, 'clarify');
    assert.equal(result.items[1]?.consumedByJobId, null); assert.equal(f.store.workJobs.list(f.actor).length, 2);
    assert.equal(f.store.workJobs.get(f.actor, result.items[0]!.consumedByJobId!).threadId, thread.id);
  } finally { await f.close(); }
});

test('Job已经提交后主模型500，回读宿主收据且重复提交不再建批次', async () => {
  const f = await workManageFixture(p => isWorkParse(p) ? reply(JSON.stringify(batch)) : mainTools(p) ? 'HTTP_500' : toolCall('work_manage', {})); try {
    const result = await f.chat(prompt); assert.equal(result.items.length, 3); assert.equal(result.run?.status, 'succeeded'); assert.match(result.run!.output!, /排队/);
    assert.ok(f.store.events(result.runId!).some(e => e.type === 'work_model_finalization_failed'));
    const n = f.payloads.length; await f.chat(prompt, result.requestId); assert.equal(f.payloads.length, n); assert.equal(f.store.workJobs.list(f.actor).length, 3);
  } finally { await f.close(); }
});

for (const table of ['web_request_items', 'work_threads', 'work_jobs', 'run_events']) test(`批次${table}写入失败：三项/主题/Job/审计全部回滚`, async () => {
  const f = await workManageFixture(handle()); try {
    const when = table === 'run_events' ? "WHEN NEW.type='work_request_committed'" : table === 'web_request_items' ? 'WHEN NEW.ordinal=1' : '';
    f.db.exec(`CREATE TRIGGER fail_batch BEFORE INSERT ON ${table} ${when} BEGIN SELECT RAISE(ABORT,'injected batch failure'); END`);
    const result = await f.chat(prompt); assert.equal(result.run?.status, 'failed'); assert.match(f.store.getRun(result.runId!)?.error ?? '', /工具执行错误/);
    assert.equal(result.items.length, 0); assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.equal(f.store.workThreads.list(f.actor).length, 0);
    assert.equal(f.store.events(result.runId!).filter(e => e.type === 'work_request_committed').length, 0);
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { await f.close(); }
});

for (const mode of ['negated', 'quoted', 'hypothetical']) test(`当前${mode}意图不生成工作；none仍不释放本轮旧工具权限`, async () => {
  const f = await workManageFixture(handle({ ...batch, mode })); try {
    const r = await f.chat(prompt); assert.equal(r.items.length, 0); assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.equal(r.run?.status, 'succeeded');
  } finally { await f.close(); }
});

for (const reason of ['mixed', 'overflow', 'dependencies', 'goal']) test(`${reason}保存完整未启动收据，不截前三项或调用旧业务写入口`, async () => {
  const f = await workManageFixture(handle({ action: 'clarify', mode: 'uncertain', evidence: prompt, reason })); try {
    const r = await f.chat(prompt); assert.equal(r.items.length, 1); assert.equal(r.items[0]?.decision, 'clarify');
    assert.deepEqual(r.items[0]?.ranges, [{ start: 0, end: prompt.length, role: 'instruction' }]); assert.equal(f.store.workJobs.list(f.actor).length, 0);
    for (const table of ['tasks', 'goals', 'file_operations']) assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0);
    assert.equal(f.memory.listForHost().length, 0);
  } finally { await f.close(); }
});

for (const [name, raw] of [
  ['伪造范围', { ...batch, items: [{ name: '面试', quotes: ['伪造指令'] }] }],
  ['伪造父意图', { ...batch, evidence: '不属于原话' }],
  ['伪造候选ID/权限', { ...batch, targetId: 'foreign', permission: 'available' }],
  ['漏共享限制/其他原文', { ...batch, shared: [] }],
  ['跨项重复材料', { ...batch, items: [batch.items[0], batch.items[0]] }],
] as const) test(`${name}整批拒绝，未启动任何Job`, async () => {
  const f = await workManageFixture(handle(raw)); try {
    const r = await f.chat(prompt); assert.equal(r.run?.status, 'failed'); assert.equal(r.items.length, 0); assert.equal(f.store.workJobs.list(f.actor).length, 0);
  } finally { await f.close(); }
});

for (const next of ['create_task', 'memory_remember', 'goal_manage', 'write']) test(`文字批次后${next}不能再次消费当前Frame`, async () => {
  const f = await workManageFixture(p => {
    if (isWorkParse(p)) return reply(JSON.stringify(batch));
    const n = mainTools(p); if (n === 0) return toolCall('work_manage', {});
    if (n === 1) return toolCall(next, next === 'create_task' ? { instruction: '越权提醒', when: '明天上午9点' } : next === 'memory_remember' ? { kind: 'semantic', key: 'bad', content: '越权记忆' } : next === 'write' ? { path: 'bad.md', content: '越权文件' } : {});
    return reply('模型仍然声称成功');
  }, true, { files: next === 'write' }); try {
    const r = await f.chat(prompt); assert.equal(r.items.length, 3); assert.equal(f.store.workJobs.list(f.actor).length, 3);
    assert.equal(f.store.listTasks().length, 0); assert.equal(f.memory.listForHost().length, 0); assert.equal(f.db.prepare('SELECT count(*) AS n FROM goals').get()?.n, 0);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM file_operations').get()?.n, 0);
    assert.equal(f.payloads.filter(isWorkParse).length, 1, '旧写操作在独立解析前被消费门拒绝');
    assert.ok(!r.run!.output!.includes('模型仍然声称成功'));
  } finally { await f.close(); }
});

test('只开Coordinator而Skills/Web/File全关：新解析计入同轮8次，实际第9HTTP前拒绝', async t => {
  const f = await workManageFixture(p => isWorkParse(p) ? reply(JSON.stringify(batch)) : toolCall('work_manage', {}), true, { goals: false }); try {
    assert.equal(f.config.skillsEnabled, false); assert.equal(f.config.webReadEnabled, false); assert.equal(f.config.webSearchEnabled, false); assert.equal(f.config.localOutput?.enabled, false); assert.equal(f.config.localFiles?.enabled, false);
    const result = await f.chat(prompt); assert.equal(result.items.length, 3);
    assert.equal(f.payloads.length, 8); assert.equal(f.payloads.filter(isWorkParse).length, 1);
    assert.equal(f.store.modelCalls(result.runId!).filter(c => c.purpose === 'work_manage').length, 1);
    const event = f.store.events(result.runId!).find(e => e.type === 'work_model_finalization_failed'); assert.match(event?.details ?? '', /8次模型HTTP/);
    assert.equal(f.store.workJobs.list(f.actor).length, 3);
    t.diagnostic(JSON.stringify({ actualHttp: f.payloads.length, mainHttp: 7, parseHttp: 1, ninthBlocked: true, skills: false, web: false, file: false }));
  } finally { await f.close(); }
});

test('查询和取消用当前原话定位同owner/channel真实Job；越权/多目标不旁路选中', async () => {
  let parsed: unknown = batch;
  const f = await workManageFixture(p => isWorkParse(p) ? reply(JSON.stringify(parsed)) : mainTools(p) ? reply('模型解释') : toolCall('work_manage', {})); try {
    const first = await f.chat(prompt), root = first.items[0]!.targetId!;
    const foreignActor = { ...f.actor, owner: 'other-owner' }, foreignThread = f.store.workThreads.create(foreignActor, randomUUID(), '私有面试', new Date().toISOString());
    const foreign = f.store.workJobs.create(foreignActor, foreignThread.id, randomUUID(), 'FOREIGN_ONLY', new Date().toISOString());
    parsed = { action: 'query', mode: 'query', evidence: '面试提纲到哪了', keywords: ['面试提纲'] };
    const query = await f.chat('面试提纲到哪了'); assert.equal(query.items[0]?.targetId, root); assert.match(query.items[0]?.receipt ?? '', /queued/);
    const parserInput = JSON.stringify(f.payloads.filter(isWorkParse).at(-1)); assert.ok(!parserInput.includes('FOREIGN_ONLY')); assert.ok(!parserInput.includes(foreign.id));
    // 在临时库模拟尚未消费的补充许可；这里只验证取消时撤销，不执行T3续接。
    f.db.prepare(`INSERT INTO web_request_items(itemId,owner,channel,requestId,ordinal,rangesJson,decision,permission,targetKind,targetId,receipt,createdAt)
      VALUES(?,?,?, ?,1,'[]','feedback','available','job',?,'待采纳',?)`).run(randomUUID(), f.actor.owner, f.actor.channel, query.requestId, root, new Date().toISOString());
    parsed = { action: 'cancel', mode: 'request', evidence: '停下面试提纲', keywords: ['面试提纲'] };
    const cancel = await f.chat('停下面试提纲'); assert.equal(cancel.items[0]?.decision, 'cancel'); assert.equal(f.store.workJobs.get(f.actor, root).status, 'cancelled');
    assert.equal(f.store.workJobs.get(f.actor, first.items[1]!.targetId!).status, 'queued'); assert.equal(f.store.workJobs.get(foreignActor, foreign.id).status, 'queued');
    assert.equal(f.db.prepare("SELECT permission FROM web_request_items WHERE decision='feedback'").get()?.permission, 'revoked');
    parsed = { action: 'cancel', mode: 'request', evidence: '取消FOREIGN_ONLY', keywords: ['FOREIGN_ONLY'] };
    const denied = await f.chat('取消FOREIGN_ONLY'); assert.equal(denied.items[0]?.decision, 'clarify'); assert.equal(f.store.workJobs.get(foreignActor, foreign.id).status, 'queued');
  } finally { await f.close(); }
});

test('解析列出四项时宿主明确保存全部未启动的超项收据，不截前三项', async () => {
  const f = await workManageFixture(handle({ ...batch, items: [...batch.items, batch.items[0]] })); try {
    const r = await f.chat(prompt); assert.equal(r.items.length, 1); assert.match(r.items[0]!.receipt, /全部尚未启动/); assert.equal(f.store.workJobs.list(f.actor).length, 0);
  } finally { await f.close(); }
});

test('重复证据仅让该项澄清，不伪造字符偏移；另外两项仍排队', async () => {
  const q = '整理面试：相同材料。\n整理周报：相同材料。\n整理文章。';
  const parsed = { action: 'batch', mode: 'request', evidence: q, items: [
    { name: '面试', quotes: ['整理面试：', '相同材料。'] }, { name: '周报', quotes: ['整理周报：相同材料。'] }, { name: '文章', quotes: ['整理文章。'] },
  ] };
  const f = await workManageFixture(handle(parsed)); try {
    const r = await f.chat(q); assert.equal(r.items[0]?.decision, 'clarify'); assert.match(r.items[0]!.receipt, /出现多次/);
    assert.equal(f.store.workJobs.list(f.actor).length, 2); assert.equal(r.items[0]?.ranges.length, 3);
  } finally { await f.close(); }
});

test('运行中取消提交后才abort，原Run中断且迟到回复不能覆盖，其他工作继续排队', async () => {
  let raw: unknown = batch, release!: () => void, entered!: () => void;
  const hold = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const f = await workManageFixture(async p => {
    if (isWorkParse(p)) return reply(JSON.stringify(raw));
    if (!p.tools?.some(t => t.function.name === 'work_manage')) { entered(); await hold; return reply('迟到的后台成功'); }
    return mainTools(p) ? reply('主模型解释') : toolCall('work_manage', {});
  }); try {
    const receipt = await f.chat(prompt), id = receipt.items[0]!.targetId!, work = f.runner.tick(); await started;
    assert.equal(f.store.workJobs.get(f.actor, id).status, 'running');
    raw = { action: 'cancel', mode: 'request', evidence: '停下面试提纲', keywords: ['面试提纲'] };
    const cancelled = await f.chat('停下面试提纲'); assert.equal(cancelled.items[0]?.decision, 'cancel');
    await work; release(); const job = f.store.workJobs.get(f.actor, id);
    assert.equal(job.status, 'cancelled'); assert.equal(f.store.getRun(job.runId!)?.status, 'interrupted'); assert.equal(f.store.getRun(job.runId!)?.output, null);
    assert.equal(f.store.workJobs.get(f.actor, receipt.items[1]!.targetId!).status, 'queued');
  } finally { release(); await f.close(); }
});

test('取消许可写入故障：Job/Run/许可/当前取消收据共同回滚', async () => {
  const f = await workManageFixture(handle({ action: 'cancel', mode: 'request', evidence: '停下面试提纲', keywords: ['面试提纲'] })); try {
    const now = new Date().toISOString(), thread = f.store.workThreads.create(f.actor, randomUUID(), '面试提纲', now);
    const job = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '面试提纲原指令', now), run = f.store.workJobs.claim(f.actor, now)!.run;
    const parent = f.store.webUi.enqueue(f.actor.owner, randomUUID(), '合成原许可', now);
    f.db.prepare(`INSERT INTO web_request_items(itemId,owner,channel,requestId,ordinal,rangesJson,decision,permission,targetKind,targetId,receipt,createdAt)
      VALUES(?,?,?, ?,0,'[]','feedback','available','job',?,'待采纳',?)`).run(randomUUID(), f.actor.owner, f.actor.channel, parent.requestId, job.id, now);
    // 保持合成旧许可未领取，不让它进入本例的主Chat执行队列。
    f.store.webUi.cancelQueued(f.actor.owner, parent.requestId);
    f.db.exec("CREATE TRIGGER fail_revoke BEFORE UPDATE ON web_request_items WHEN NEW.permission='revoked' BEGIN SELECT RAISE(ABORT,'injected revoke failure'); END");
    const result = await f.chat('停下面试提纲'); assert.equal(result.run?.status, 'failed'); assert.equal(result.items.length, 0);
    assert.equal(f.store.workJobs.get(f.actor, job.id).status, 'running'); assert.equal(f.store.getRun(run.id)?.status, 'running');
    assert.equal(f.db.prepare("SELECT permission FROM web_request_items WHERE decision='feedback'").get()?.permission, 'available');
  } finally { await f.close(); }
});

test('短问答不自动调用解析；主模型遗漏work_manage不会制造承接记录；关闭时不暴露工具', async () => {
  const f = await workManageFixture(() => reply('直接回答')); try {
    const result = await f.chat('简单解释排队的意思'); assert.equal(result.items.length, 0); assert.equal(f.payloads.length, 1); assert.equal(f.store.workJobs.list(f.actor).length, 0);
  } finally { await f.close(); }
  const off = await workManageFixture(p => { assert.ok(!p.tools?.some(t => t.function.name === 'work_manage')); return reply('旧模式回答'); }, false); try {
    const response = await off.api('/chat', { requestId: randomUUID(), text: '旧模式短问答' }); assert.equal(response.status, 202); await off.channel.drain(); assert.equal(off.payloads.length, 1);
  } finally { await off.close(); }
});

// 固定响应仅验证实际Pi工具链的none回退，不代表模型能正确识别这些自然语言意图。
for (const text of ['帮我写一段请假短信。', '解释一下什么是Agent。', '翻译：Good morning.', '把这句临时改得礼貌些：明天把报告给我。', '根据下面材料一次写成详细介绍，直接在这里回答：' + '这是已提供的产品材料。'.repeat(120)]) test(`误调work_manage后none回普通Chat且零工作/主题：${text.slice(0, 26)}`, async () => {
  const answer = '当前请求的普通Chat回答';
  const f = await workManageFixture(p => isWorkParse(p)
    ? reply(JSON.stringify({ action: 'none', mode: 'request', evidence: text }))
    : mainTools(p) ? reply(answer) : toolCall('work_manage', {})); try {
    const result = await f.chat(text);
    assert.equal(result.run?.status, 'succeeded'); assert.equal(result.run?.output, answer);
    assert.equal(result.items.length, 0); assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.equal(f.store.workThreads.list(f.actor).length, 0);
    assert.equal(f.payloads.filter(isWorkParse).length, 1); assert.equal(f.payloads.length, 3);
    const final = f.payloads.at(-1)!;
    assert.ok(final.messages.some(message => message.role === 'tool' && content(message.content).includes('not_applicable')));
    assert.equal(f.store.events(result.runId!).filter(event => event.type === 'work_request_committed').length, 0);
  } finally { await f.close(); }
});

test('新解析实际HTTP不带旧普通对话正文和Memory正文', async () => {
  let phase = 0;
  const single = { action: 'batch', mode: 'request', evidence: parts[0], items: [batch.items[0]] };
  const f = await workManageFixture(p => {
    if (isWorkParse(p)) return reply(JSON.stringify(single));
    if (phase === 0) return reply('HISTORY_PRIVATE_MARKER');
    return mainTools(p) ? reply('完成口头解释') : toolCall('work_manage', {});
  }); try {
    await f.chat('旧普通讨论HISTORY_PRIVATE_MARKER'); phase = 1;
    // Memory仍走宿主既有服务；不通过新工具写入，验证辅助解析没有正文入口。
    f.memory.withRequest({ prompt: '记住：MEMORY_PRIVATE_MARKER', scope: 'chat', signal: new AbortController().signal,
      source: { channel: 'web', reference: 'fixture-source' }, observer: { event() {}, modelCall() {} } },
      () => f.memory.remember({ kind: 'semantic', key: 'isolated-parser', content: 'MEMORY_PRIVATE_MARKER' }));
    const r = await f.chat(parts[0]!); assert.equal(r.items.length, 1);
    const parser = JSON.stringify(f.payloads.find(isWorkParse)); assert.ok(!parser.includes('HISTORY_PRIVATE_MARKER')); assert.ok(!parser.includes('MEMORY_PRIVATE_MARKER'));
  } finally { await f.close(); }
});

test('正向联网/读取文件请求误调用work_manage时明确未启动，否定约束仍可承接纯文本', async () => {
  const text = '请联网查最新资料并读取电脑上的文件。';
  const f = await workManageFixture(handle({ action: 'clarify', mode: 'request', evidence: text, reason: 'external' })); try {
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'clarify'); assert.match(r.items[0]?.receipt ?? '', /尚未启动/); assert.equal(f.store.workJobs.list(f.actor).length, 0);
    assert.ok(!r.run!.output!.includes('都已完成'));
  } finally { await f.close(); }
});

test('新解析在实际32KiB HTTP体之前阻止超限，完整消息保留且明确全部未启动', async () => {
  const text = '整理面试：' + '材'.repeat(9980);
  const f = await workManageFixture(p => isWorkParse(p) ? reply('{}') : mainTools(p) ? reply('模型解释') : toolCall('work_manage', {}), true, { goals: false }); try {
    const r = await f.chat(text); assert.equal(r.items.length, 1); assert.match(r.items[0]!.receipt, /32 KiB/); assert.match(r.items[0]!.receipt, /全部尚未启动/);
    assert.equal(f.payloads.filter(isWorkParse).length, 0); assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.equal(r.text, text);
    const blocked = f.store.events(r.runId!).find(e => e.type === 'work_parse_http' && JSON.parse(e.details!).phase === 'blocked'); assert.ok(blocked);
  } finally { await f.close(); }
});
