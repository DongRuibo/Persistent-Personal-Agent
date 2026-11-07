import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareClaim, summarize } from '../evals/evaluators/metrics.js';
import type { CaseResult } from '../evals/evaluators/metrics.js';

test('评测器：完成、部分完成、等待、失败、未知和歧义不能混为成功', () => {
  for (const status of ['waiting_user', 'blocked', 'paused', 'running']) {
    assert.equal(compareClaim('completed', { status, readyInput: null }).false_completion, true);
  }
  assert.equal(compareClaim('completed', { status: 'completed', readyInput: null }).false_completion, false);
  assert.equal(compareClaim('queued', { status: 'waiting_user', readyInput: null }).consistent, false);
  assert.equal(compareClaim('queued', { status: 'ready', readyInput: {} }).consistent, true);
  assert.equal(compareClaim('ambiguous', { status: 'waiting_user', readyInput: null }).false_completion, null);
  assert.equal(compareClaim('completed', { status: 'unknown', readyInput: null }).false_completion, null);
});

test('指标：失败保留分母，跳过不充数，Mock不能产生模型准确率或pass^3', () => {
  const row = (evaluation_result: CaseResult['evaluation_result'], checks: CaseResult['checks']): CaseResult => ({
    case_id: 'synthetic', category: 'B', evaluation_result, latency_ms: 10, checks, observations: {},
    actual_tool_calls: [], actual_final_state: null, agent_response: null, failure_reason: null,
  });
  const result = summarize([row('passed', [{ name: 'host', passed: true, dimension: 'host' }]),
    row('failed', [{ name: 'delivery', passed: false, dimension: 'service' }]), row('skipped', []), row('error', [])]);
  assert.equal(result.scenario_contract_rate.denominator, 3);
  assert.equal(result.scenario_contract_rate.numerator, 1);
  assert.equal(result.delivery_assurance_rate.value, 0);
  assert.equal(result.task_success_rate, null); assert.equal(result.tool_call_accuracy, null);
  assert.equal(result.pass_power_3, null); assert.equal(result.restart_recovery_rate.value, null);
});

test('任务指标按真实终态行计数，保留多环境故障，pending和cancelled不算执行失败', () => {
  const summary = summarize([{ case_id: 'faults', category: 'F', evaluation_result: 'failed', latency_ms: 1, checks: [], observations: {},
    actual_tool_calls: [], agent_response: null, failure_reason: '合成故障', actual_final_state: { environments: [
      { tasks: [{ id: 'a', status: 'succeeded' }, { id: 'b', status: 'pending' }], runs: [{ taskId: 'a' }] },
      { tasks: [{ id: 'c', status: 'interrupted' }, { id: 'd', status: 'cancelled' }], runs: [{ taskId: 'c' }, { taskId: 'c' }] },
    ] } }]);
  assert.equal(summary.task_execution_success_rate.denominator, 2);
  assert.equal(summary.task_execution_success_rate.numerator, 1);
  assert.equal(summary.duplicate_execution_rate.numerator, 1);
  assert.equal(summary.duplicate_execution_rate.denominator, 2);
});
