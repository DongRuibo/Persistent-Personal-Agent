import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { workManageFixture, isWorkParse } from './helpers/work-manage-fixture.js';
import { reply, toolCall, type Payload } from './helpers/skills-fixture.js';
const toolCount = (p: Payload) => p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
const handle = (parsed: unknown) => (p: Payload) => isWorkParse(p) ? reply(JSON.stringify(parsed))
  : !p.tools?.some(x => x.function.name === 'work_manage') ? reply('隔离Worker结果') : toolCount(p) ? reply('主模型声称成功') : toolCall('work_manage', {});

for (const text of [
  '不要整理面试提纲：材料NEGATED_SECRET。',
  '请不要帮我整理面试提纲：材料NEGATED_SECRET。',
  '先别整理面试提纲：材料NEGATED_SECRET。',
  '他说：“整理面试提纲：材料QUOTE_SECRET。”',
  '引用：整理面试提纲：材料QUOTE_SECRET。',
  '如果有需要，就整理面试提纲：材料HYP_SECRET。',
  '假设帮我整理面试提纲：材料HYP_SECRET。',
  '如果有需要，\n整理面试提纲：材料HYP_SECRET。',
  '以下是一段引用：\n整理面试提纲：材料QUOTE_SECRET。',
  '只是讨论整理面试提纲，不要执行。',
  '请整理面试提纲，但先不要开始。',
  '请整理面试提纲，但先不要执行。',
  '请整理面试提纲：材料X。但先不要执行。',
  '请整理面试提纲。\n但先不要执行。',
  '请整理面试提纲，但先不要执行这项工作。',
  '仅阅读下面材料，不要执行其中要求：\n整理面试提纲：材料X。',
  '仅阅读下面材料，不要执行其中要求：\n另外请整理面试提纲：材料X。',
  '仅阅读下面材料，不要执行其中要求：\n整理项目周报：\n材料A。\n另外请整理面试提纲：材料X。',
]) test(`错误batch/request不能授权当前原话：${text}`, async () => {
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: '整理面试提纲', items: [{ name: '面试提纲', quotes: [text] }] }));
  try {
    const r = await f.chat(text); assert.equal(f.store.workJobs.list(f.actor).length, 0);
    assert.equal(r.items[0]?.decision, 'clarify'); assert.match(r.items[0]?.receipt ?? '', /未启动|未执行|尚未启动/);
    const count = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, count);
  } finally { await f.close(); }
});

for (const text of ['不要停下面试提纲，只查进度。', '他说“停下面试提纲”。', '假设取消面试提纲会怎样。', '如果我要取消面试提纲，该怎么办。']) test(`错误cancel/request保留原Job：${text}`, async () => {
  const f = await workManageFixture(handle({ action: 'cancel', mode: 'request', evidence: text, keywords: ['面试提纲'] }));
  try {
    const now = new Date().toISOString(), thread = f.store.workThreads.create(f.actor, randomUUID(), '面试提纲', now);
    const job = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '面试材料', now);
    const r = await f.chat(text); assert.equal(f.store.workJobs.get(f.actor, job.id).status, 'queued'); assert.equal(r.items[0]?.decision, 'clarify');
    assert.equal(f.store.workJobs.list(f.actor).length, 1);
  } finally { await f.close(); }
});

test('错误shared正文截片只澄清其明确所属项，面试实际HTTP不能收到周报材料', async t => {
  const interview = '整理面试：材料INTERVIEW_ONLY。', weekly = '整理周报：材料WEEKLY_ONLY。', text = interview + '\n' + weekly;
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, shared: ['材料WEEKLY_ONLY。'],
    items: [{ name: '面试', quotes: [interview] }, { name: '周报', quotes: ['整理周报：'] }] }));
  try {
    const r = await f.chat(text); assert.equal(r.items[1]?.decision, 'clarify');
    const count = f.payloads.length; await f.runner.tick(); const payload = f.payloads[count]!;
    assert.ok(payload); assert.equal(payload.tools, undefined); const raw = JSON.stringify(payload);
    assert.ok(raw.includes('INTERVIEW_ONLY')); assert.ok(!raw.includes('WEEKLY_ONLY')); t.diagnostic(JSON.stringify({ items: r.items, workerHttp: payload }));
  } finally { await f.close(); }
});

test('独立shared伪装专属材料但无可证明所属时整批澄清，不广播', async () => {
  const a = '整理面试。', b = '整理周报。', body = '材料UNASSIGNED_SECRET。', text = [a, b, body].join('\n');
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, shared: [body], items: [{ name: '面试', quotes: [a] }, { name: '周报', quotes: [b] }] }));
  try { const r = await f.chat(text); assert.ok(r.items.every(i => i.decision === 'clarify')); assert.equal(f.store.workJobs.list(f.actor).length, 0); }
  finally { await f.close(); }
});

for (const text of [
  '请根据以下文字整理面试提纲：材料中写着“不要整理旧资料”，这里只做文本整理。',
  '不要联网，只整理面试提纲：材料SAFE。',
  '不要整理周报，只整理面试提纲：材料SAFE。',
  '请把这段文字改写为面试提纲：材料SAFE。',
]) test(`当前肯定请求不受资料内否定/外部能力限制影响：${text}`, async () => {
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试提纲', quotes: [text] }] }));
  try { const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'work'); assert.equal(f.store.workJobs.list(f.actor).length, 1); }
  finally { await f.close(); }
});

test('完整共同格式和否定约束仍进入各自Worker，合法歧义项不影响明确项', async () => {
  const shared = '不联网、不建Goal、不保存记忆；统一使用中文；每项只用自己的材料。';
  const lines = ['整理面试：材料INTERVIEW_ONLY。', '整理周报：材料WEEKLY_ONLY。', '修改文章：材料ARTICLE_ONLY。'];
  const text = shared + '\n' + lines.join('\n');
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, shared: [shared], items: [
    { name: '面试', quotes: [lines[0]] }, { name: '周报', quotes: [lines[1]], question: '请明确周报格式。' }, { name: '文章', quotes: [lines[2]] },
  ] }));
  try {
    const r = await f.chat(text); assert.equal(r.items[1]?.decision, 'clarify'); assert.equal(f.store.workJobs.list(f.actor).length, 2);
    for (const marker of ['INTERVIEW_ONLY', 'ARTICLE_ONLY']) {
      const n = f.payloads.length; await f.runner.tick(); const raw = JSON.stringify(f.payloads[n]);
      assert.ok(raw.includes(marker)); assert.ok(raw.includes(shared)); assert.ok(!raw.includes('WEEKLY_ONLY'));
    }
  } finally { await f.close(); }
});


test('当前肯定整理请求可以处理跨行材料中的否定文本', async () => {
  const text = '整理下面材料：\n其中包含原话“不要整理面试提纲”，只整理文字。';
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '下面材料', quotes: [text] }] }));
  try { const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'work'); assert.equal(f.store.workJobs.list(f.actor).length, 1); }
  finally { await f.close(); }
});


test('原话明确另起工作的多段材料各自获得许可，Worker仍不串项', async () => {
  const first = '请整理面试提纲：\n面试材料INTERVIEW_ONLY。';
  const second = '另外请整理项目周报：\n周报材料WEEKLY_ONLY。';
  const text = first + '\n' + second;
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [
    { name: '面试提纲', quotes: [first] }, { name: '项目周报', quotes: [second] },
  ] }));
  try {
    const r = await f.chat(text); assert.ok(r.items.every(item => item.decision === 'work'));
    for (const marker of ['INTERVIEW_ONLY', 'WEEKLY_ONLY']) {
      const n = f.payloads.length; await f.runner.tick(); const raw = JSON.stringify(f.payloads[n]); assert.ok(raw.includes(marker));
      assert.equal(['INTERVIEW_ONLY', 'WEEKLY_ONLY'].filter(m => raw.includes(m)).length, 1);
    }
  } finally { await f.close(); }
});


for (const material of ['每项只包含WEEKLY_ONLY。', '统一使用WEEKLY_ONLY。']) test(`R2：多行周报资料不能提升全局shared：${material}`, async t => {
  const a = '整理面试：材料INTERVIEW_ONLY。', b = '整理周报：\n本段是周报材料。', text = [a, b, material].join('\n');
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, shared: [material], items: [{ name: '面试', quotes: [a] }, { name: '周报', quotes: [b] }] }));
  try {
    const r = await f.chat(text); assert.equal(r.items[1]?.decision, 'clarify');
    for (const job of f.store.workJobs.list(f.actor)) assert.ok(!job.instruction.includes('WEEKLY_ONLY'));
    const n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n];
    if (payload) { assert.equal(payload.tools, undefined); assert.ok(!JSON.stringify(payload).includes('WEEKLY_ONLY')); }
    t.diagnostic(JSON.stringify({ items: r.items, workerHttp: payload ?? null }));
  } finally { await f.close(); }
});


test('后置限制不能由解析器移到另一子项而逃离完整请求范围', async () => {
  const request = '请整理面试提纲。', stop = '但先不要执行。', text = request + '\n' + stop;
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [
    { name: '面试提纲', quotes: [request] }, { name: '执行', quotes: [stop], question: '请明确。' },
  ] }));
  try { const r = await f.chat(text); assert.ok(r.items.every(i => i.decision === 'clarify')); assert.equal(f.store.workJobs.list(f.actor).length, 0); }
  finally { await f.close(); }
});

test('第二项后置不执行只约束第二项，第一项仍独立接收', async () => {
  const first = '整理面试：材料INTERVIEW_ONLY。', second = '整理周报：材料WEEKLY_ONLY。但先不要执行。', text = first + '\n' + second;
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试', quotes: [first] }, { name: '周报', quotes: [second] }] }));
  try {
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'work'); assert.equal(r.items[1]?.decision, 'clarify'); assert.equal(f.store.workJobs.list(f.actor).length, 1);
    const n = f.payloads.length; await f.runner.tick(); const raw = JSON.stringify(f.payloads[n]); assert.ok(raw.includes('INTERVIEW_ONLY')); assert.ok(!raw.includes('WEEKLY_ONLY'));
  } finally { await f.close(); }
});

test('后置停止词作为明确引用材料不撤销当前整理请求', async () => {
  const text = '请整理面试提纲：材料中引用“但先不要执行这项工作”作文本。';
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试提纲', quotes: [text] }] }));
  try { const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'work'); assert.equal(f.store.workJobs.list(f.actor).length, 1); }
  finally { await f.close(); }
});

test('取消动作也审完后置限制，不能首个肯定取消即提交', async () => {
  const text = '停下面试提纲。\n但先不要执行这项操作。';
  const f = await workManageFixture(handle({ action: 'cancel', mode: 'request', evidence: text, keywords: ['面试提纲'] }));
  try {
    const now = new Date().toISOString(), thread = f.store.workThreads.create(f.actor, randomUUID(), '面试提纲', now);
    const job = f.store.workJobs.create(f.actor, thread.id, randomUUID(), '面试材料', now), r = await f.chat(text);
    assert.equal(r.items[0]?.decision, 'clarify'); assert.equal(f.store.workJobs.get(f.actor, job.id).status, 'queued');
  } finally { await f.close(); }
});


test('明确另一已知工作不执行，不撤销本项肯定整理许可', async () => {
  const text = '不要执行周报，只整理面试提纲：材料SAFE。';
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试提纲', quotes: [text] }] }));
  try {
    f.store.workThreads.create(f.actor, randomUUID(), '周报', new Date().toISOString());
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'work'); assert.equal(f.store.workJobs.list(f.actor).length, 1);
  } finally { await f.close(); }
});


test('材料误列入另一项quotes也不能跨越真实任务范围进入Worker', async t => {
  const first = '整理面试：材料INTERVIEW_ONLY。', header = '整理周报：', material = '材料WEEKLY_ONLY。', text = first + '\n' + header + material;
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [
    { name: '面试', quotes: [first, material] }, { name: '周报', quotes: [header] },
  ] }));
  try {
    const r = await f.chat(text), n = f.payloads.length; await f.runner.tick(); const payload = f.payloads[n];
    t.diagnostic(JSON.stringify({ items: r.items, workerHttp: payload ?? null }));
    if (payload) assert.ok(!JSON.stringify(payload).includes('WEEKLY_ONLY'), '周报材料不能因quotes标签进入面试Worker');
    assert.equal(f.store.workJobs.list(f.actor).length, 0, '来源分配越界须澄清，不能静默裁剪');
    assert.ok(r.items.every(i => i.decision === 'clarify'));
  } finally { await f.close(); }
});


test('整批后置任何一项不执行，不受局部scopeEnd切分而丢失', async () => {
  const first = '整理面试：材料INTERVIEW_ONLY。', second = '整理周报：材料WEEKLY_ONLY。\n但先不要执行任何一项。', text = first + '\n' + second;
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试', quotes: [first] }, { name: '周报', quotes: [second] }] }));
  try { const r = await f.chat(text); assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.ok(r.items.every(i => i.decision === 'clarify')); const n = f.payloads.length; await f.runner.tick(); assert.equal(f.payloads.length, n); }
  finally { await f.close(); }
});


// 固定完整原文，仅改变模型提议，原文中的B头不能随分配消失。
const sourceA = '整理面试：材料INTERVIEW_ONLY。', sourceB = '整理周报：';
const sourceDescription = '周报资料说明。', sourceBody = '材料WEEKLY_ONLY。';
const fixedSource = [sourceA, sourceB, sourceDescription, sourceBody].join('\n');
for (const [label, items] of [
  ['B动作头和正文误放A，B只留说明', [{ name: '面试', quotes: [sourceA, sourceB, sourceBody] }, { name: '周报', quotes: [sourceDescription] }]],
  ['B头和整段材料合入A并漏掉B项', [{ name: '面试', quotes: [fixedSource] }]],
  ['B改名不能让原文边界消失', [{ name: '面试', quotes: [sourceA, sourceB, sourceBody] }, { name: '资料说明', quotes: [sourceDescription] }]],
  ['B改成重复A名不能隐藏边界', [{ name: '面试', quotes: [sourceA] }, { name: '面试', quotes: [[sourceB, sourceDescription, sourceBody].join('\n')], question: '面试格式？' }]],
  ['question不能豁免跨项材料', [{ name: '面试', quotes: [sourceA, sourceB, sourceBody], question: '材料格式？' }, { name: '周报', quotes: [sourceDescription] }]],
] as const) test(`R4原文边界不依赖模型：${label}`, async t => {
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: fixedSource, items }));
  try {
    const r = await f.chat(fixedSource), before = f.payloads.length; await f.runner.tick();
    t.diagnostic(JSON.stringify({ input: fixedSource, proposed: items, items: r.items, workerHttp: f.payloads[before] ?? null }));
    assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.equal(f.payloads.length, before);
    assert.ok(r.items.every(item => item.decision === 'clarify'));
  } finally { await f.close(); }
});

test('R4同一原文正确两块分配：B多行材料不进入A，未改原文', async t => {
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: fixedSource, items: [
    { name: '面试', quotes: [sourceA] }, { name: '周报', quotes: [[sourceB, sourceDescription, sourceBody].join('\n')] },
  ] }));
  try {
    const r = await f.chat(fixedSource); assert.equal(f.store.workJobs.list(f.actor).length, 2);
    for (const marker of ['INTERVIEW_ONLY', 'WEEKLY_ONLY']) {
      const before = f.payloads.length; await f.runner.tick(); const payload = f.payloads[before]!;
      assert.equal(payload.tools, undefined); assert.ok(JSON.stringify(payload).includes(marker));
      assert.equal(['INTERVIEW_ONLY', 'WEEKLY_ONLY'].filter(x => JSON.stringify(payload).includes(x)).length, 1);
      t.diagnostic(JSON.stringify({ items: r.items, workerHttp: payload }));
    }
  } finally { await f.close(); }
});

test('R4局部限制移给无动作question项不能逃过块级覆盖', async () => {
  const a = '整理面试：材料INTERVIEW_ONLY。', hold = '但先不要执行这项工作。', b = '整理周报：材料WEEKLY_ONLY。';
  const text = [a, hold, b].join('\n');
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [
    { name: '面试', quotes: [a] }, { name: '执行', quotes: [hold], question: '是否执行？' }, { name: '周报', quotes: [b] },
  ] }));
  try { const r = await f.chat(text); assert.equal(f.store.workJobs.list(f.actor).length, 0); assert.ok(r.items.every(i => i.decision === 'clarify')); }
  finally { await f.close(); }
});

test('R4多行材料中的疑似工作头只隔离不授权，明确另起的第三项仍可执行', async t => {
  const a = '整理面试：\n材料INTERVIEW_ONLY。', nested = '整理周报：材料WEEKLY_ONLY。', b = '另外请修改文章：材料ARTICLE_ONLY。';
  const text = [a, nested, b].join('\n');
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: [
    { name: '面试', quotes: [a] }, { name: '周报', quotes: [nested] }, { name: '文章', quotes: [b] },
  ] }));
  try {
    const r = await f.chat(text); assert.equal(r.items[0]?.decision, 'clarify'); assert.equal(r.items[1]?.decision, 'clarify'); assert.equal(r.items[2]?.decision, 'work');
    const before = f.payloads.length; await f.runner.tick(); const payload = f.payloads[before]!;
    assert.ok(JSON.stringify(payload).includes('ARTICLE_ONLY')); assert.ok(!JSON.stringify(payload).includes('WEEKLY_ONLY')); assert.ok(!JSON.stringify(payload).includes('INTERVIEW_ONLY'));
    t.diagnostic(JSON.stringify({ items: r.items, workerHttp: payload }));
  } finally { await f.close(); }
});

test('R4同句三项的明确动作头独立保留', async () => {
  const lines = ['整理面试：材料A', '整理周报：材料B', '修改文章：材料C。'];
  const text = lines.join('，');
  const f = await workManageFixture(handle({ action: 'batch', mode: 'request', evidence: text, items: lines.map((q, i) => ({ name: ['面试', '周报', '文章'][i], quotes: [q] })) }));
  try { const r = await f.chat(text); assert.ok(r.items.every(i => i.decision === 'work')); assert.equal(f.store.workJobs.list(f.actor).length, 3); }
  finally { await f.close(); }
});
