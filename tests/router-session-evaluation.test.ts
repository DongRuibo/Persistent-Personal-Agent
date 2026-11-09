import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeContext, summarize } from '../evals/evaluators/router-session.js';
import type { CaseResult, RouterCase, WireRecord } from '../evals/router-session-types.js';

const expected: RouterCase['expected'] = { route: 'reuse', target: 'a', session: 'reuse', new_topics: 0, own_context_required: true,
  allowed_cross_session_read: 'none', allowed_private_aliases: [], shared_memory_required: false, rationale: '测试分母' };
const row = (id: string, patch: Partial<CaseResult> = {}): CaseResult => ({ case_id: id, category: 'R', title: id, mode: 'offline_scripted_model_real_host',
  result: 'failed', route_correct: false, session_correct: false, expected, actual: null, context: null, recovery: [], failure_categories: [], error: null,
  deterministic: false, elapsed_ms: 0, evidence_path: '', evidence_sha256: '', ...patch });

test('错误目标复用同时计FP和FN；没有执行的应复用样例不能从Recall分母消失', () => {
  const actual = { route: null, target: 'b', session_action: 'reuse' as const, new_topics: 0, run_status: 'succeeded', run_id: 'run', output: '' };
  const result = summarize([row('wrong', { actual }), row('right', { actual: { ...actual, target: 'a' }, session_correct: true }), row('error', { result: 'error' })]);
  assert.deepEqual({ ...result.offline_mechanisms.session_reuse, scope: undefined }, { tp: 1, fp: 1, fn: 2, precision: .5, recall: 1 / 3, f1: .4, scope: undefined });
  assert.equal(result.real_semantic.routing_accuracy, null);
});
test('空分母返回null；零请求不能计作无污染成功样本', () => {
  const result = summarize([]); assert.equal(result.offline_mechanisms.context_contamination_rate.value, null);
  assert.equal(result.offline_mechanisms.session_recovery_rate.value, null);
  assert.equal(result.offline_mechanisms.session_reuse.f1, null);
});
test('实际请求区分自身历史、私有跨题、共享Memory和当前主动粘贴', () => {
  const spec = { expected, memory: 'off' } as RouterCase;
  const wire = (raw: string, stage = 'chat'): WireRecord[] => [{ index: 0, stage, operation: 'target', raw: JSON.stringify({ text: raw }), bytes: Buffer.byteLength(JSON.stringify({ text: raw })), response: 'fixed' }];
  const tokens = { a: 'CANARY_PRIVATE_A', b: 'CANARY_PRIVATE_B' }, shared = 'CANARY_SHARED_GLOBAL';
  assert.equal(gradeContext(wire(tokens.a), spec, tokens, shared, 1).contaminated, false);
  assert.equal(gradeContext(wire(tokens.b), spec, tokens, shared, 1).contaminated, true);
  assert.equal(gradeContext(wire(shared), { ...spec, memory: 'shared' }, tokens, shared, 1).contaminated, false);
  assert.equal(gradeContext(wire(shared, 'topic_route'), { ...spec, memory: 'shared' }, tokens, shared, 1).contaminated, true);
  assert.equal(gradeContext(wire(tokens.b), { ...spec, expected: { ...expected, allowed_private_aliases: ['b'] } }, tokens, shared, 1).contaminated, false);
  assert.equal(gradeContext(wire(tokens.a), spec, tokens, shared, 2).complete, false);
});
