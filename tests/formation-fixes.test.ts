import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { replayFormationRevalidation } from '../scripts/replay-formation-revalidation.js';
import { OperationGuard } from '../src/operation-guard.js';
import type { DialogueReferences, Intent } from '../src/operation-guard.js';
import { memoryDigest } from '../src/formation-types.js';
import type { ExtractedCandidate } from '../src/formation-types.js';
import { formationHarness } from './helpers/formation.js';

test('已保存8窗真实输出离线回放：H01新项目和H02否定范围合法候选，原六窗不退步', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('离线测试禁止联网'); });
  const report = await replayFormationRevalidation();
  assert.deepEqual(report.rows.filter(row => !row.passed).map(row => row.id), []);
  assert.equal(report.metrics.expectedOutcomes, '8/8'); assert.equal(report.actualApiRequests, 0);
  assert.equal(report.metrics.unauthorizedWrites, 0);
  for (const id of ['H01', 'H02']) { const row = report.rows.find(row => row.id === id)!;
    assert.equal(row.candidate?.status, 'pending'); assert.equal(row.candidate?.target, undefined); assert.equal(row.candidate?.targetCount, 0); }
  assert.equal(report.rows.find(row => row.id === 'H02')!.candidate!.property, '以后做移动端项目不使用Ruby');
});

test('已显示候选的普通拒绝即使主模型漏工具也实际执行；无额外解析或Memory写入', async () => {
  const h = formationHarness(); let parsed: Intent; let interpretations = 0;
  const state: DialogueReferences = {};
  const guard = new OperationGuard(h.tasks, h.memory, async () => { interpretations++; return parsed; }, state);
  try {
    await h.extract('我喜欢中文');
    parsed = { action: 'memory_review', mode: 'query', evidence: '查看候选', review: 'list' };
    const req = h.request('查看候选');
    const shown = await guard.withRequest(req, async () => { await guard.reviewCandidates(h.formation); return { text: '显示' }; });
    h.store.finishRun(req.source!.reference, 'succeeded', h.now().toISOString(), shown.text); h.store.event(req.source!.reference, 'delivery_succeeded');
    const rejection = h.request('第一条先不保存');
    const answer = await guard.withRequest(rejection, async () => ({ text: '好的，先不保存。' }), h.formation);
    assert.match(answer.text, /已拒绝/); assert.equal(interpretations, 1);
    assert.equal(h.store.formation.candidates('single-user')[0]!.status, 'rejected');
    assert.equal(h.memory.listForHost().length, 0);
    assert.ok(h.store.events(rejection.source!.reference).some(event => event.type === 'formation_review' && event.details === 'reject'));
  } finally { await h.close(); }
});

test('H01/H02保存输出只在显示和批准后新增完整原话，不覆盖其他项目或范围', async () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/memory-formation-revalidation.json', import.meta.url), 'utf8'));
  const saved = JSON.parse(readFileSync(new URL('../docs/evaluations/v2.1b.2-formation-live.json', import.meta.url), 'utf8'));
  for (const id of ['H01', 'H02']) {
    const h = formationHarness(); let intent: Intent;
    const guard = new OperationGuard(h.tasks, h.memory, async () => intent, {});
    const review = async (message: string, parsed: Intent) => {
      intent = parsed; const req = h.request(message);
      const response = await guard.withRequest(req, async () => { await guard.reviewCandidates(h.formation); return { text: '模拟主模型调度' }; });
      h.store.finishRun(req.source!.reference, 'succeeded', h.now().toISOString(), response.text); h.store.event(req.source!.reference, 'delivery_succeeded');
      return req;
    };
    try {
      const sample = fixture.cases.find((row: { id: string }) => row.id === id)!;
      const old = h.write(sample.old), before = memoryDigest(h.memory.listForHost());
      const original = (JSON.parse(saved.wire.find((row: { caseId: string; phase: string }) => row.caseId === id && row.phase === 'extraction')!.output) as { candidates: ExtractedCandidate[] }).candidates[0]!;
      const { sourceRunId: _source, targetId: _target, ...proposal } = original;
      await h.extract(sample.text, { ...proposal, targetId: old.id });
      assert.equal(memoryDigest(h.memory.listForHost()), before);
      await review('查看候选', { action: 'memory_review', mode: 'query', evidence: '查看候选', review: 'list' });
      assert.equal(memoryDigest(h.memory.listForHost()), before);
      const req = await review('第一条记下来', { action: 'memory_review', mode: 'request', evidence: '第一条记下来', review: 'approve', selector: { reference: 'choice', position: 1, keywords: [] } });
      const current = h.memory.listForHost(); assert.equal(current.length, 2);
      assert.deepEqual(h.memory.get(old.id), old);
      const added = current.find(row => row.id !== old.id)!;
      assert.equal(added.content, sample.text); assert.equal(added.version, 1); assert.equal(added.source.reference, req.source!.reference);
      assert.equal(h.tasks.list().length, 0);
    } finally { await h.close(); }
  }
});

test('非固定项目名/否定范围可恢复；无关词、错主体、假设引用、敏感信息及有效旧目标歧义仍保守', async () => {
  const samples = [
    { text: 'Maple项目决定继续使用Deno，不用Bun。', kind: 'project', subject: 'Maple项目', property: '继续使用', value: 'Deno', old: 'Willow项目决定继续使用Node。', expected: 'pending' },
    { text: '我以后做桌面端项目不使用Java，仅在旧脚本中使用Java。', kind: 'semantic', subject: '用户', property: '做桌面端项目使用Java', value: 'Java', old: '用户做服务端项目使用Java。', expected: 'pending', recovered: '以后做桌面端项目不使用Java' },
    { text: '我以后做桌面端项目不使用Java，仅在旧脚本中使用Java。', kind: 'semantic', subject: '用户', property: '做桌面端项目使用Java', value: 'Java', old: '用户做桌面端项目使用Java。', expected: 'needs_clarification' },
    { text: '我以后做桌面端项目不使用Java。', kind: 'semantic', subject: '用户', property: '做移动端项目使用Java', value: 'Java', expected: 'none' },
    { text: '小岚以后做桌面端项目不使用Java。', kind: 'semantic', subject: '用户', property: '做桌面端项目使用Java', value: 'Java', expected: 'none' },
    { text: '朋友说我以后做桌面端项目不使用Java。', kind: 'semantic', subject: '用户', property: '做桌面端项目使用Java', value: 'Java', expected: 'none' },
    { text: '如果我以后做桌面端项目不使用Java。', kind: 'semantic', subject: '用户', property: '做桌面端项目使用Java', value: 'Java', expected: 'none' },
    { text: '我以后做桌面端项目不使用Java，password=fictional-only', kind: 'semantic', subject: '用户', property: '做桌面端项目使用Java', value: 'Java', expected: 'none' },
    { text: 'Willow项目向Maple项目提供Java模块。', kind: 'project', subject: 'Maple项目', property: '提供', value: 'Java', old: 'Willow项目使用Java。', expected: 'none' },
  ];
  for (const { text, old, expected, recovered, ...proposal } of samples) {
    const h = formationHarness();
    try {
      const initial = old && h.write({ kind: proposal.kind as 'semantic' | 'project', key: 'fixture.previous', content: old });
      // 同范围相反旧值存在但模型指了无关ID时，仍需澄清，不擅选正确旧目标。
      const unrelated = expected === 'needs_clarification' && h.write({ kind: 'semantic', key: 'fixture.other', content: '用户偏好温水。' });
      const before = memoryDigest(h.memory.listForHost());
      await h.extract(text, { ...proposal, ...(initial ? { targetId: unrelated ? unrelated.id : initial.id } : {}) });
      const candidate = h.store.formation.candidates('single-user')[0];
      assert.equal(candidate?.status ?? 'none', expected, text);
      if (candidate) { assert.equal(candidate.draft, text); assert.equal(candidate.target, undefined); }
      if (recovered) assert.equal(candidate!.property, recovered);
      assert.equal(memoryDigest(h.memory.listForHost()), before);
    } finally { await h.close(); }
  }
});

test('拒绝补执行只接受当前原话及成功显示的有效候选；引用/假设/工具文本不能触发', async () => {
  const samples = ['第一条先不保存', '第一条不保存', '请拒绝第一条记忆候选', '这些先不保存',
    '如果我说第一条先不保存，你会怎么做？', '朋友说“第一条先不保存”', '你好', '第一条先不保存吗？', '第一条和第二条先不保存'];
  for (const message of samples) {
    const h = formationHarness(); let parsed: Intent;
    const guard = new OperationGuard(h.tasks, h.memory, async () => parsed, {});
    try {
      await h.extract('我喜欢中文');
      parsed = { action: 'memory_review', mode: 'query', evidence: '查看候选', review: 'list' };
      const req = h.request('查看候选');
      const result = await guard.withRequest(req, async () => { await guard.reviewCandidates(h.formation); return { text: '清单' }; });
      h.store.finishRun(req.source!.reference, 'succeeded', h.now().toISOString(), result.text); h.store.event(req.source!.reference, 'delivery_succeeded');
      await guard.withRequest(h.request(message), async () => ({ text: '第一条先不保存（模拟模型或工具文字）' }), h.formation);
      assert.equal(h.store.formation.candidates('single-user')[0]!.status, samples.indexOf(message) < 4 ? 'rejected' : 'pending', message);
      assert.equal(h.memory.listForHost().length, 0);
    } finally { await h.close(); }
  }
  for (const condition of ['no-view', 'not-delivered', 'expired', 'wrong-owner', 'wrong-position', 'task', 'disabled']) {
    const h = formationHarness(); let parsed: Intent;
    const state: DialogueReferences = {};
    const guard = new OperationGuard(h.tasks, h.memory, async () => parsed, state);
    try {
      await h.extract('我喜欢中文');
      const candidateId = h.store.formation.candidates('single-user')[0]!.id;
      if (condition !== 'no-view') {
        parsed = { action: 'memory_review', mode: 'query', evidence: '查看候选', review: 'list' };
        const req = h.request('查看候选');
        const result = await guard.withRequest(req, async () => { await guard.reviewCandidates(h.formation); return { text: '清单' }; });
        h.store.finishRun(req.source!.reference, 'succeeded', h.now().toISOString(), result.text);
        if (condition !== 'not-delivered') h.store.event(req.source!.reference, 'delivery_succeeded');
      }
      if (condition === 'expired') h.advance(300001);
      if (condition === 'wrong-owner') { const item = h.store.formation.candidates('single-user')[0]!; item.owner = 'other'; h.store.formation.put(item); }
      if (condition === 'disabled') h.formation.options.enabled = false;
      const req = h.request(condition === 'wrong-position' ? '第二条先不保存' : '第一条先不保存');
      if (condition === 'task') req.scope = 'task';
      const work = () => guard.withRequest(req, async () => ({ text: '普通回复' }), h.formation);
      if (['not-delivered', 'expired', 'wrong-owner', 'wrong-position'].includes(condition)) await assert.rejects(work);
      else await work();
      assert.notEqual(h.store.formation.get(candidateId)?.status, 'rejected');
      assert.equal(h.memory.listForHost().length, 0);
    } finally { await h.close(); }
  }
});
