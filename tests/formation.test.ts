import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../src/config.js';
import { FormationService } from '../src/formation-service.js';
import { OperationGuard } from '../src/operation-guard.js';
import type { DialogueReferences, Intent } from '../src/operation-guard.js';
import { fingerprint, memoryDigest } from '../src/formation-types.js';
import { retrieve } from '../src/memory-retriever.js';
import { formationHarness } from './helpers/formation.js';

test('形成默认关闭，开启必须提供费率上界；失败/后台/旧 Run 不得入队，队列故障不影响成功聊天', async () => {
  assert.equal(readConfig({}).formation?.enabled, false);
  assert.throws(() => readConfig({ MEMORY_FORMATION_ENABLED: 'true' }), /费率/);
  const h = formationHarness({ enabled: false });
  try {
    h.enqueue('我喜欢中文'); assert.equal(h.store.formation.jobs().length, 0);
    const req = h.request('source');
    assert.throws(() => h.store.formation.enqueue({ owner: 'single-user', runId: req.source!.reference, text: 'source', channel: 'console', at: h.now().toISOString() }, 'hash'), /已成功/);
    h.store.finishRun(req.source!.reference, 'succeeded', h.now().toISOString(), 'OK', undefined, () => { throw new Error('模拟存储故障'); });
    assert.equal(h.store.getRun(req.source!.reference)?.status, 'succeeded');
    assert.ok(h.store.events(req.source!.reference).some(event => event.type === 'formation_enqueue_failed'));
  } finally { await h.close(); }
});

test('窗口最多3条/一次调用/2000字节；未批准写入零，空闲前不提取，同 Run 不重复收费', async () => {
  const h = formationHarness(); let calls = 0;
  try {
    const reqs = ['我喜欢中文', '我喜欢短句', '我喜欢图解', '我喜欢示例'].map(h.enqueue);
    h.setExtractor(async ({ systemPrompt, data }) => {
      calls++; assert.ok(Buffer.byteLength(systemPrompt + data) <= 2000);
      const parsed = JSON.parse(data) as { sources: { runId: string; text: string }[] };
      assert.equal(parsed.sources.length, 3);
      return { candidates: parsed.sources.map(source => ({ sourceRunId: source.runId, quote: source.text, kind: 'semantic', mode: 'asserted', durable: true, subject: '用户', property: '喜欢', value: source.text.slice(3), content: '恶意概括：完全不用英文' })) };
    });
    await h.formation.tick(); assert.equal(calls, 0);
    h.advance(10001); await h.formation.tick();
    assert.equal(calls, 1); assert.equal(h.memory.listForHost().length, 0);
    assert.equal(h.store.formation.candidates('single-user').filter(candidate => ['pending', 'needs_clarification'].includes(candidate.status)).length, 1, '同属性冲突候选失效，只保留最新待澄清项，但审计记录保留');
    const source = reqs[0]!;
    h.store.formation.enqueue({ owner: 'single-user', runId: source.source!.reference, text: source.prompt, channel: 'feishu', at: h.now().toISOString() }, memoryDigest([]));
    assert.equal(h.store.formation.jobs().length, 4);
  } finally { await h.close(); }
});

test('前台到来立即中断 Worker，不等待模型；迟到输出不生成候选；已领取重启不重试', async () => {
  const h = formationHarness(); let calls = 0; let finish!: (value: unknown) => void;
  try {
    h.enqueue('我喜欢中文'); h.advance(10001);
    h.setExtractor(async () => { calls++; return new Promise(resolve => { finish = resolve; }); });
    const work = h.formation.tick(); const release = h.formation.foreground();
    await work; assert.equal(h.store.formation.jobs()[0]!.status, 'failed');
    finish({ candidates: [] }); release();
    h.advance(10001); await h.formation.tick(); assert.equal(calls, 1);
    const req = h.enqueue('我喜欢简洁'); h.advance(10001);
    const jobs = h.store.formation.jobs('queued');
    assert.equal(h.store.formation.claim(jobs, h.now().toISOString(), .01, 20, .2), true);
    h.store.formation.recover(); assert.equal(h.store.formation.jobs().find(job => job.runId === req.source!.reference)?.status, 'failed');
    await h.formation.tick(); assert.equal(calls, 1);
  } finally { await h.close(); }
});

test('保守预算、每日次数、格式无效和超长消息均不重试；可观测失败', async () => {
  const h = formationHarness({ dailyCalls: 1 }); let calls = 0;
  try {
    h.setExtractor(async () => { calls++; return { candidates: [{ impossible: true }] }; });
    h.enqueue('我喜欢中文'); h.advance(10001); await h.formation.tick();
    h.enqueue('我喜欢短句'); h.advance(10001); await h.formation.tick();
    assert.equal(calls, 1); assert.equal(h.store.formation.jobs('failed').length, 1); assert.equal(h.store.formation.jobs('queued').length, 1);
    h.advance(86400000); await h.formation.tick(); assert.equal(calls, 2);
    h.enqueue('我喜欢' + '文'.repeat(2000)); assert.equal(h.store.formation.jobs().length, 2);
    assert.ok(h.store.events(h.store.formation.jobs()[0]!.runId).some(event => event.type === 'formation_failed'));
  } finally { await h.close(); }
  const low = formationHarness({ dailyBudget: .000001 });
  try { low.setExtractor(async () => { throw new Error('不能调用'); }); low.enqueue('我喜欢中文'); low.advance(10001); await low.formation.tick(); assert.equal(low.store.formation.jobs('queued').length, 1); }
  finally { await low.close(); }
});

test('来源/原话/属性/类型严格校验；敏感、假设、引用、临时信息不产生候选', async () => {
  const h = formationHarness();
  try {
    for (const text of ['如果我喜欢中文呢', '朋友说我喜欢中文', '我临时喜欢中文', '我的密码是 password=fake-secret', '我的邮箱是 fixture@example.invalid']) h.enqueue(text);
    assert.equal(h.store.formation.jobs().length, 0);
    for (const patch of [{ sourceRunId: 'forged' }, { quote: '我永远不用英文' }, { property: '不能找到' }, { kind: 'procedural' }, { kind: 'episodic' }, { mode: 'hypothetical' }, { subject: '阿青' }]) await h.extract('我喜欢中文', patch);
    assert.equal(h.store.formation.candidates('single-user').length, 0); assert.equal(h.memory.listForHost().length, 0);
  } finally { await h.close(); }
});

test('旧事实更新保留限定词，目标必须同主体和项目；重复、拒绝不会反复推荐', async () => {
  const h = formationHarness();
  try {
    const old = h.write({ kind: 'semantic', key: 'user.language', content: '用户主要使用 Python' });
    h.write({ kind: 'semantic', key: 'other.language', content: '阿青主要使用 TypeScript' });
    const text = '我现在主要用 TypeScript，Python 已经用得少了。';
    await h.extract(text, { property: '主要用', value: 'TypeScript', targetId: old.id });
    let candidate = h.store.formation.candidates('single-user')[0]!;
    assert.equal(candidate.target?.id, old.id); assert.equal(candidate.draft, text); assert.ok(!candidate.draft.includes('完全不用'));
    h.formation.reject(h.formation.view().view, 1);
    await h.extract(text, { property: '主要用', value: 'TypeScript' });
    assert.equal(h.store.formation.candidates('single-user').length, 1);
    await h.extract('ProjectC 项目的数据库使用 SQLite', { kind: 'project', subject: 'ProjectC', property: '数据库', value: 'SQLite', targetId: old.id });
    candidate = h.store.formation.candidates('single-user').at(-1)!;
    assert.equal(candidate.status, 'needs_clarification'); assert.equal(candidate.target, undefined);
  } finally { await h.close(); }
});

test('Memory 更新/删除使旧候选失效；候选过期清除正文，正常检索没有候选', async () => {
  for (const change of ['update', 'delete', 'expire']) {
    const h = formationHarness();
    try {
      const old = h.write({ kind: 'semantic', key: 'old', content: '用户喜欢英文' });
      await h.extract('我喜欢中文'); const view = h.formation.view().view;
      assert.equal(h.memory.search('中文').length, 0);
      if (change === 'expire') h.advance(8 * 86400000);
      else {
        const req = h.request('测试宿主修改');
        const op = change === 'update' ? { tool: 'memory_update' as const, args: { id: old.id, content: '用户喜欢德语', expectedVersion: 1 } } : { tool: 'memory_forget' as const, args: { id: old.id, expectedVersion: 1 } };
        h.memory.withRequest(req, () => op.tool === 'memory_update' ? h.memory.update(old.id, op.args.content, 1) : h.memory.forget(old.id, 1), op);
      }
      assert.throws(() => h.formation.reject(view, 1), /过期|变化/);
      h.formation.view(); const candidate = h.store.formation.candidates('single-user')[0]!;
      assert.equal(candidate.status, change === 'expire' ? 'expired' : 'stale');
      if (change === 'expire') { assert.equal(candidate.draft, ''); assert.equal(h.store.formation.jobs()[0]!.text, ''); }
    } finally { await h.close(); }
  }
});

test('候选列表固定序号、错误解析/过期/改后再确认、重复与并发审批、与原写工具互斥', async () => {
  const h = formationHarness(); const state: DialogueReferences = {}; let parsed: Intent;
  const guard = new OperationGuard(h.tasks, h.memory, async () => parsed, state);
  const review = async (message: string, intent: Partial<Intent>) => {
    parsed = { action: 'memory_review', mode: 'request', evidence: message, ...intent };
    const req = h.request(message);
    const result = await guard.withRequest(req, async () => { await guard.reviewCandidates(h.formation); return { text: 'stub' }; });
    h.store.finishRun(req.source!.reference, 'succeeded', h.now().toISOString(), result.text); h.store.event(req.source!.reference, 'delivery_succeeded');
    return result;
  };
  try {
    await h.extract('我喜欢中文');
    assert.match((await review('有什么建议记住的吗？', { mode: 'query', review: 'list' })).text, /我喜欢中文/);
    await assert.rejects(review('第二条记下来', { review: 'approve', selector: { reference: 'choice', position: 1, keywords: [] } }), /序号/);
    assert.equal(h.memory.listForHost().length, 0);
    await review('有什么建议记住的吗？', { mode: 'query', review: 'list' });
    await review('把第一条改成“我喜欢中文和图解”再记', { review: 'edit', body: '我喜欢中文和图解', bodyEvidence: '我喜欢中文和图解', selector: { reference: 'choice', position: 1, keywords: [] } });
    assert.equal(h.memory.listForHost().length, 0); assert.equal(state.candidateReview?.confirm, true);
    parsed = { action: 'memory_review', mode: 'request', evidence: '确认', review: 'approve' };
    const approval = h.request('确认');
    const results = await guard.withRequest(approval, async () => {
      const results = await Promise.allSettled([guard.reviewCandidates(h.formation), guard.reviewCandidates(h.formation), guard.perform('memory_remember', {}, () => { throw new Error('越权'); })]);
      assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); return { text: 'stub' };
    });
    assert.match(results.text, /已按你批准/); const record = h.memory.listForHost()[0]!;
    assert.equal(record.content, '我喜欢中文和图解'); assert.equal(record.source.reference, approval.source!.reference);
    assert.equal(record.source.type, 'user_explicit');
    await assert.rejects(review('确认', { review: 'approve' }), /需要先查看/);
    assert.equal(h.memory.listForHost().length, 1);
    await h.extract('我喜欢短句'); await review('查看候选', { review: 'list' }); h.advance(300001);
    await assert.rejects(review('第一条记下来', { review: 'approve', selector: { reference: 'choice', position: 1, keywords: [] } }), /过期/);
  } finally { await h.close(); }
});

test('候选 Hash/用户篡改不批准；applying 重启只核对落盘结果，不重放写入', async () => {
  const h = formationHarness();
  try {
    await h.extract('我喜欢中文'); const shown = h.formation.view(); const candidate = h.store.formation.candidates('single-user')[0]!;
    const other = { ...shown.view, items: [{ id: candidate.id, revision: 1, hash: fingerprint('错误正文') }] };
    assert.throws(() => h.formation.reject(other, 1), /变化/);
    const db = new DatabaseSync(h.config.databasePath);
    try { db.prepare("UPDATE memory_candidates SET data=json_set(data,'$.owner','another-user') WHERE id=?").run(candidate.id); }
    finally { db.close(); }
    assert.throws(() => h.formation.reject(shown.view, 1), /列表/);
    candidate.owner = 'single-user'; candidate.status = 'applying'; candidate.approvalRunId = h.request('确认').source!.reference; h.store.formation.put(candidate);
    const restarted = new FormationService(h.formation.options, h.store, h.memory, [], h.now);
    restarted.start(); await restarted.stop();
    assert.equal(h.store.formation.get(candidate.id)?.status, 'blocked'); assert.equal(h.memory.listForHost().length, 0);
  } finally { await h.close(); }
});

test('提示每天最多一次且只是回复附言；拒绝整个可见清单不写 Memory', async () => {
  const h = formationHarness();
  try {
    await h.extract('我喜欢中文'); assert.match(h.formation.hint(), /待审/); assert.equal(h.formation.hint(), '');
    h.advance(86400000); assert.match(h.formation.hint(), /待审/);
    h.formation.reject(h.formation.view().view); assert.equal(h.formation.hint(), ''); assert.equal(h.memory.listForHost().length, 0);
  } finally { await h.close(); }
});

test('多目标澄清后先展示旧值与新草稿，再批准原地更新；application 写后崩溃仅对账', async () => {
  const h = formationHarness();
  try {
    const old = h.write({ kind: 'semantic', key: 'user.first', content: '用户喜欢英文' });
    const second = h.write({ kind: 'semantic', key: 'user.second', content: '用户喜欢法语' });
    await h.extract('我喜欢中文'); const view = h.formation.view().view;
    assert.throws(() => h.formation.approve(view, 1, h.request('第一条记下来'), () => { throw new Error('不能写'); }), /澄清/);
    const targets = h.formation.clarify(view, 1); assert.match(targets.text, /用户喜欢英文/); assert.match(targets.text, /用户喜欢法语/);
    const chosenId = targets.view.targets![1]!;
    const confirmed = h.formation.clarify(targets.view, 1, 2); assert.equal(confirmed.view.confirm, true);
    const req = h.request('确认');
    const applied = h.formation.approve(confirmed.view, 1, req, op => {
      assert.equal(op.tool, 'memory_update'); if (op.tool !== 'memory_update') throw new Error('类型错误');
      assert.equal(op.args.id, chosenId);
      return h.memory.withRequest(req, () => h.memory.update(op.args.id, op.args.content, op.args.expectedVersion), op);
    });
    assert.equal(h.memory.get(chosenId).version, 2);
    assert.equal(h.memory.get(chosenId === old.id ? second.id : old.id).version, 1);
    applied.status = 'applying'; delete applied.resultId; delete applied.resultVersion; h.store.formation.put(applied);
    const restarted = new FormationService(h.formation.options, h.store, h.memory, [], h.now);
    restarted.start(); await restarted.stop();
    assert.equal(h.store.formation.get(applied.id)?.status, 'applied'); assert.equal(h.memory.get(chosenId).version, 2);
  } finally { await h.close(); }
});

test('批准写入故障保留 blocked，不盲重试；Worker 只读端口不能保存推断；第一人称可检索', async () => {
  const h = formationHarness();
  try {
    await h.extract('我喜欢中文'); const view = h.formation.view().view;
    assert.throws(() => h.formation.approve(view, 1, h.request('第一条记下来'), () => { throw new Error('模拟写入故障'); }), /模拟写入故障/);
    assert.equal(h.store.formation.candidates('single-user')[0]!.status, 'blocked');
    assert.throws(() => h.formation.approve(view, 1, h.request('第一条记下来'), () => { throw new Error('不能重试'); }), /已经处理/);
    h.setExtractor(async ({ request }) => {
      assert.throws(() => h.memory.withRequest(request, () => h.memory.remember({ kind: 'semantic', key: 'attack', content: '模型推断' })), /后台|明确/);
      return { candidates: [] };
    });
    h.enqueue('我喜欢短句'); h.advance(10001); await h.formation.tick(); assert.equal(h.memory.listForHost().length, 0);
    h.write({ kind: 'semantic', key: 'self', content: '我喜欢中文回答' });
    assert.equal(h.memory.search('我偏好什么回答语言？')[0]?.key, 'self');
    assert.notEqual(retrieve(h.memory.listForHost(), '阿青喜欢什么语言？').evidence, 'supported', '相关候选不能冒充其他主体的答案');
  } finally { await h.close(); }
});

test('否定和限定不能被去重吃掉；提及用户的其他主体不能成为自动更新目标', async () => {
  const h = formationHarness();
  try {
    const old = h.write({ kind: 'semantic', key: 'user.sugar', content: '用户不喜欢加糖' });
    const other = h.write({ kind: 'semantic', key: 'colleague', content: '用户的同事小林喜欢邮件' });
    await h.extract('我喜欢加糖', { value: '加糖' });
    const candidate = h.store.formation.candidates('single-user')[0]!;
    assert.equal(candidate.target?.id, old.id); assert.equal(candidate.draft, '我喜欢加糖');
    await h.extract('我喜欢邮件', { value: '邮件', targetId: other.id });
    assert.equal(h.store.formation.candidates('single-user').at(-1)?.target, undefined);
    assert.equal(h.memory.get(other.id).content, '用户的同事小林喜欢邮件');
    const before = h.store.formation.candidates('single-user').length;
    await h.extract('我同事喜欢短信', { value: '短信' });
    assert.equal(h.store.formation.candidates('single-user').length, before, '不能因为含“我”就接受其他主体的事实');
  } finally { await h.close(); }
});

test('清单模型失败或发送失败不能获得审批，不能批准用户未看到的草稿', async () => {
  const h = formationHarness(); const state: DialogueReferences = {};
  try {
    await h.extract('我喜欢中文');
    const guard = new OperationGuard(h.tasks, h.memory, async message => ({ action: 'memory_review', mode: message.includes('查看') ? 'query' : 'request', evidence: message,
      review: message.includes('查看') ? 'list' : 'approve', selector: { reference: 'choice', position: 1, keywords: [] } }), state);
    const viewRequest = h.request('查看候选');
    const shown = await guard.withRequest(viewRequest, async () => { await guard.reviewCandidates(h.formation); return { text: 'stub' }; });
    const approve = () => guard.withRequest(h.request('第一条记下来'), async () => { await guard.reviewCandidates(h.formation); return { text: 'stub' }; });
    await assert.rejects(approve(), /发送/);
    h.store.finishRun(viewRequest.source!.reference, 'succeeded', h.now().toISOString(), shown.text);
    await assert.rejects(approve(), /发送/);
    h.store.event(viewRequest.source!.reference, 'delivery_succeeded');
    await approve(); assert.equal(h.memory.listForHost().length, 1);
  } finally { await h.close(); }
});
