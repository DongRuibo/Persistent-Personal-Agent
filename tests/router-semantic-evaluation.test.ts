import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SemanticBudget, gradeProposal, summarizeSemantic } from '../evals/evaluators/router-semantic.js';
import type { SemanticPlan, SemanticResult } from '../evals/evaluators/router-semantic.js';
import { semanticModel, PrepareOnly } from '../evals/environments/router-semantic-model.js';
import { semanticState } from '../evals/runners/router-semantic.js';
import { routeTopic } from '../src/topic-router.js';

const plan = JSON.parse(readFileSync(new URL('../evals/datasets/router-semantic-pilot-v1.json', import.meta.url), 'utf8')) as SemanticPlan;

test('费用/输入/请求在发送前预留；失败不返还请求额度，越界不增加计数', () => {
  const budget = new SemanticBudget({ ...plan, limits: { ...plan.limits, max_requests: 1 } });
  budget.reserve(100); const charged = budget.cny_reserved;
  assert.throws(() => budget.reserve(100), /预算/); assert.equal(budget.requests, 1); assert.equal(budget.cny_reserved, charged);
  assert.throws(() => new SemanticBudget({ ...plan, limits: { ...plan.limits, budget_cny: .0001 } }).reserve(100), /预算/);
  assert.throws(() => new SemanticBudget({ ...plan, limits: { ...plan.limits, max_input_token_reservation: 300 } }).reserve(100), /预算/);
});
test('同一真实格式提议：原始引用错题不得算模型正确，原宿主可纠正到明确目的主题', async () => {
  const spec = plan.cases.find(row => row.case_id === 'M04')!, state = semanticState(spec);
  try {
    const wrong = { kind: 'use' as const, threadId: spec.threads.find(t => t.alias === 'career')!.id, reason: '只引用求职' };
    assert.equal(gradeProposal(wrong, spec).correct, false);
    const proposal = await routeTopic({ text: spec.text, threads: state.threads, current: state.current }, {
      signal: new AbortController().signal, complete: async () => JSON.stringify(wrong) });
    assert.equal(gradeProposal(proposal.choice, spec).correct, true);
  } finally { state.store.close(); }
});
test('新主题范围缺词标待复核；未请求模型的确定性样例不能进入模型准确率分母', () => {
  const spec = plan.cases.find(row => row.case_id === 'N01')!;
  assert.equal(gradeProposal({ kind: 'create', title: '求职', description: '面试', reason: '错误' }, spec).needs_review, true);
  const deterministic = { case_id: 'T01', category: 'T', mode: 'live', model_requested: false, final_grade: { correct: true }, http: [] } as unknown as SemanticResult;
  const summary = summarizeSemantic([deterministic], plan, new SemanticBudget(plan));
  assert.equal(summary.model_raw_routing_accuracy.value, null); assert.equal(summary.deterministic_routing_accuracy.denominator, 1);
});
test('准备模式通过真实SDK序列化：不调用transport、不预留收费，保持生产请求参数且无gold', async () => {
  let actualFetch = 0;
  const model = await semanticModel(plan, 'fake-preflight', 'prepare', async () => { actualFetch++; throw new Error('不得发送'); });
  const events: Record<string, unknown>[] = [], spec = plan.cases[0]!, state = semanticState(spec);
  try {
    await assert.rejects(routeTopic({ text: spec.text, threads: state.threads, current: state.current }, {
      signal: new AbortController().signal, complete: (system, text) => model.complete(system, text, events) }), PrepareOnly);
    assert.equal(actualFetch, 0); assert.equal(model.budget.requests, 0);
    const body = events[0]!.body as { max_tokens: number; enable_thinking: boolean; tools?: unknown[]; messages: unknown[] };
    assert.equal(body.max_tokens, 512); assert.equal(body.enable_thinking, false); assert.equal(body.tools, undefined);
    assert.ok(!JSON.stringify(body.messages).includes('create_scope_terms')); assert.ok(!JSON.stringify(body.messages).includes('expected'));
  } finally { state.store.close(); }
});
