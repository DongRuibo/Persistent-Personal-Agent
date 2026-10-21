import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { replayFormationLive } from '../scripts/replay-formation-live.js';
import { memoryDigest } from '../src/formation-types.js';
import type { ExtractedCandidate } from '../src/formation-types.js';
import type { MemoryInput } from '../src/contracts.js';
import { OperationGuard } from '../src/operation-guard.js';
import type { Intent } from '../src/operation-guard.js';
import { formationHarness } from './helpers/formation.js';

test('冻结真实模型输出离线回放：F01/F02合法候选、旧更新/去重/主体/否定和未批准零写入', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('离线回放禁止联网'); });
  const report = await replayFormationLive();
  assert.deepEqual(report.rows.filter(row => !row.passed).map(row => row.id), []);
  assert.equal(report.metrics.expectedOutcomes, '12/12');
  assert.equal(report.metrics.retainedWorthKeeping, '6/6');
  assert.equal(report.metrics.unauthorizedWrites, 0); assert.equal(report.actualApiRequests, 0);
  assert.ok(report.rows.every(row => row.unchangedWithoutApproval && row.tasksCreated === 0));
  assert.equal(report.rows.find(row => row.id === 'F01')!.candidate!.property, '平时偏好');
  assert.equal(report.rows.find(row => row.id === 'F02')!.candidate!.property, '以后做 Agent 项目主要使用');
  assert.equal(report.rows.find(row => row.id === 'F04')!.candidate!.target!.key, 'fixture.language');
  assert.equal(report.rows.find(row => row.id === 'F05')!.candidate, null);
  assert.equal(report.rows.find(row => row.id === 'F06')!.candidate, null);
  assert.equal(report.rows.find(row => row.id === 'F08')!.candidate!.draft, '我不希望回答省略错误原因。');
});

test('F01/F02/F04原输出经清单与明确批准后才落盘，完整时间/范围/限定及原ID版本保留', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('离线审批禁止联网'); });
  const saved = JSON.parse(readFileSync(new URL('../docs/evaluations/v2.1b-formation-live.json', import.meta.url), 'utf8')) as { wire: { caseId: string; phase: string; output: string }[] };
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/memory-formation-live.json', import.meta.url), 'utf8')) as { cases: { id: string; text: string; old?: MemoryInput }[] };
  for (const id of ['F01', 'F02', 'F04']) {
    const h = formationHarness();
    let parsed: Intent;
    const guard = new OperationGuard(h.tasks, h.memory, async () => parsed, {});
    const review = async (message: string, intent: Intent) => {
      parsed = intent; const request = h.request(message);
      const result = await guard.withRequest(request, async () => { await guard.reviewCandidates(h.formation); return { text: '模拟调度' }; });
      h.store.finishRun(request.source!.reference, 'succeeded', h.now().toISOString(), result.text);
      h.store.event(request.source!.reference, 'delivery_succeeded', '模拟显示，不发送飞书');
      return request;
    };
    try {
      const sample = fixture.cases.find(item => item.id === id)!;
      const old = sample.old && h.write(sample.old), before = memoryDigest(h.memory.listForHost());
      const { sourceRunId: _source, targetId: _target, ...proposal } = (JSON.parse(saved.wire.find(w => w.caseId === id && w.phase === 'extraction')!.output) as { candidates: ExtractedCandidate[] }).candidates[0]!;
      await h.extract(sample.text, { ...proposal, ...(old ? { targetId: old.id } : {}) });
      assert.equal(memoryDigest(h.memory.listForHost()), before);
      await review('有什么建议记住的吗？', { action: 'memory_review', mode: 'query', evidence: '有什么建议记住的吗？', review: 'list' });
      assert.equal(memoryDigest(h.memory.listForHost()), before, '只查看不得写入');
      const approval = await review('第一条记下来', JSON.parse(saved.wire.find(w => w.phase === 'approval')!.output) as Intent);
      const records = h.memory.listForHost(); assert.equal(records.length, 1);
      assert.equal(records[0]!.content, sample.text); assert.equal(records[0]!.version, old ? 2 : 1);
      if (old) assert.equal(records[0]!.id, old.id);
      assert.equal(records[0]!.source.reference, approval.source!.reference);
      assert.equal(h.store.formation.candidates('single-user')[0]!.status, 'applied');
      assert.equal(h.tasks.list().length, 0);
    } finally { await h.close(); }
  }
});

test('时间与范围只能用于原话校验：不扩大更新目标，不截掉否定或把同事/项目变成本人', async () => {
  const samples = [
    { text: '我以后做 Agent 项目主要使用 TypeScript。', property: '以后做 Agent 项目主要使用', subject: '用户', expected: 'needs_clarification' },
    { text: '我以后做 Agent 项目主要使用 TypeScript。', property: '主要使用', subject: '用户', expected: 'none' },
    { text: '我以后做 Agent 项目主要使用 TypeScript。', property: '做 Agent 项目主要使用', subject: '用户', expected: 'needs_clarification' },
    { text: '我以后同事主要使用 TypeScript。', property: '主要使用', subject: '用户', expected: 'none' },
    { text: '我平时偏好简洁的中文解释。', property: '平时偏好', subject: '同事', value: '中文', expected: 'none' },
    { text: '我以后做 Agent 项目不使用 TypeScript。', property: '以后做 Agent 项目不使用', subject: '用户', expected: 'needs_clarification' },
    { text: 'Beryl项目以后不使用TypeScript。', property: '以后不使用', subject: 'Beryl', kind: 'project', expected: 'needs_clarification' },
    { text: 'Beryl项目以后不使用TypeScript。', property: '以后不使用', subject: 'Cedar', kind: 'project', expected: 'none' },
  ];
  for (const sample of samples) {
    const h = formationHarness();
    try {
      const old = h.write({ kind: sample.kind === 'project' ? 'project' : 'semantic', key: 'old.scope',
        content: sample.kind === 'project' ? 'Cedar项目以后不使用Java。' : '用户主要使用Python。' });
      const before = memoryDigest(h.memory.listForHost());
      await h.extract(sample.text, { kind: sample.kind ?? 'semantic', subject: sample.subject, property: sample.property,
        value: sample.value ?? 'TypeScript', targetId: old.id });
      const candidate = h.store.formation.candidates('single-user')[0];
      assert.equal(candidate?.status ?? 'none', sample.expected, sample.text + ' / ' + sample.property);
      if (candidate) {
        assert.equal(candidate.target, undefined, '范围不同或跨项目不能绑定旧记录');
        assert.deepEqual(candidate.targetOptions, []); assert.equal(candidate.property, sample.property);
        assert.equal(candidate.draft, sample.text); assert.equal(candidate.quote, sample.text);
        let wrote = false;
        assert.throws(() => h.formation.approve(h.formation.view().view, 1, h.request('第一条记下来'), () => { wrote = true; return old; }), /澄清/);
        assert.equal(wrote, false);
      }
      assert.equal(memoryDigest(h.memory.listForHost()), before);
    } finally { await h.close(); }
  }
});

test('时间前缀修复不绕过假设/引用/敏感与来源校验：恶意提议也不获得写入权限', async () => {
  const samples = [
    { text: '如果我以后偏好中文', property: '以后偏好', value: '中文' },
    { text: '朋友说我平时偏好中文', property: '平时偏好', value: '中文' },
    { text: '我平时偏好中文，password=fictional-fixture-only', property: '平时偏好', value: '中文' },
    { text: '我平时偏好中文', property: '平时偏好', value: '中文', mode: 'hypothetical' },
    { text: '我平时偏好中文', property: '平时偏好', value: '中文', mode: 'quoted' },
    { text: '我平时偏好中文', property: '平时偏好', value: '中文', quote: '我平时偏好英文' },
    { text: '我平时偏好中文', property: '平时偏好', value: '中文', sourceRunId: 'forged-source' },
    { text: '我以后做 Agent 项目主要使用 TypeScript。', property: '以后做 Web 项目主要使用', value: 'TypeScript' },
  ];
  for (const { text, ...proposal } of samples) {
    const h = formationHarness();
    try {
      await h.extract(text, proposal);
      assert.equal(h.store.formation.candidates('single-user').length, 0, text);
      assert.equal(h.memory.listForHost().length, 0);
    } finally { await h.close(); }
  }
});
