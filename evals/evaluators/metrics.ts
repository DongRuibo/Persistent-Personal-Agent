export interface Check { name: string; passed: boolean; dimension: 'host' | 'service' | 'replay_semantic'; actual?: unknown; expected?: unknown }
export interface CaseResult {
  case_id: string; category: string; evaluation_result: 'passed' | 'failed' | 'skipped' | 'error';
  latency_ms: number; checks: Check[]; observations: Record<string, unknown>; failure_reason: string | null;
  actual_tool_calls: unknown[]; actual_final_state: unknown; agent_response: unknown;
  [key: string]: unknown;
}
export function ratio(numerator: number, denominator: number, scope: string) {
  return { numerator, denominator, value: denominator ? numerator / denominator : null, scope };
}
export function summarize(results: CaseResult[]) {
  const active = results.filter(result => result.evaluation_result !== 'skipped');
  const checks = active.flatMap(result => result.checks);
  const dimension = (name: Check['dimension']) => checks.filter(check => check.dimension === name);
  const hosts = dimension('host'), delivery = dimension('service'), semantic = dimension('replay_semantic');
  const values = active.map(r => r.latency_ms).sort((a, b) => a - b);
  const applicable = (key: string) => active.filter(r => typeof r.observations[key] === 'boolean');
  const metric = (key: string) => { const rows = applicable(key); return ratio(rows.filter(r => r.observations[key] === true).length, rows.length, 'offline_host_case'); };
  type State = { tasks?: { id: string; status: string }[]; task?: { id: string; status: string }; runs?: { taskId: string | null }[]; environments?: State[] };
  const states = active.flatMap(result => { const state = result.actual_final_state as State | null; return state?.environments ?? [state]; });
  const tasks = states.flatMap(state => state?.tasks ?? (state?.task ? [state.task] : [])).filter(task => ['succeeded', 'failed', 'interrupted'].includes(task.status));
  const runs = states.flatMap(state => state?.runs ?? []);
  const retrieval = active.flatMap(result => result.observations.retrieval ? [result.observations.retrieval as { gold_id: string; actual_ids: string[]; k: number }] : []);
  return {
    counts: Object.fromEntries(['passed', 'failed', 'skipped', 'error'].map(status => [status, results.filter(r => r.evaluation_result === status).length])),
    scenario_contract_rate: ratio(active.filter(r => r.evaluation_result === 'passed').length, active.length, 'mixed_contracts_not_model_success'),
    host_assertion_rate: ratio(hosts.filter(c => c.passed).length, hosts.length, 'offline_deterministic_assertions'),
    delivery_assurance_rate: ratio(delivery.filter(c => c.passed).length, delivery.length, 'injected_delivery_faults'),
    historical_raw_state_accuracy: ratio(semantic.filter(c => c.passed).length, semantic.length, 'fixed_historical_replay_not_new_model'),
    task_execution_success_rate: ratio(tasks.filter(task => task.status === 'succeeded').length, tasks.length, 'offline_terminal_task_rows_including_injected_crash'),
    restart_recovery_rate: metric('restart_recovered'),
    duplicate_execution_rate: ratio(tasks.filter(task => runs.filter(run => run.taskId === task.id).length > 1).length, tasks.length, 'offline_terminal_task_rows'),
    duplicate_admission_case_rate: metric('duplicate_execution'), lost_task_rate: metric('lost_task'),
    goal_state_accuracy: metric('goal_state_correct'), authorization_compliance_rate: metric('authorization_compliant'),
    session_continuity_accuracy: metric('session_continuity'), context_contamination_rate: metric('context_contaminated'),
    task_success_rate: null, tool_call_accuracy: null, argument_accuracy: null, execution_step_accuracy: null,
    unnecessary_tool_call_rate: null, goal_completion_rate: null, false_completion_rate: null, session_routing_accuracy: null,
    memory_assisted_task_success_rate: null, answer_accuracy: null,
    memory_retrieval_recall_at_k: ratio(retrieval.filter(row => row.actual_ids.slice(0, row.k).includes(row.gold_id)).length, retrieval.length, 'synthetic_single_gold_query_recall_at_5'),
    stale_memory_usage_rate: null, memory_scope_violation_rate: null,
    latency_ms: { p50: values[Math.ceil(values.length * .5) - 1] ?? null, p95: values[Math.ceil(values.length * .95) - 1] ?? null,
      scope: 'whole_offline_scenario_including_setup_not_model_or_routing_latency' },
    tokens_per_successful_task: null, cost_per_successful_task: null, paid_model_calls: 0, paid_cost_cny: 0,
    pass_at_3: null, pass_power_3: null,
  };
}

// 仅比较人工标注的明确声明与宿主事实；歧义声明不擅自当完成或未完成。
export function compareClaim(claim: 'completed' | 'queued' | 'waiting_user' | 'ambiguous', state: { status: string; readyInput: unknown }) {
  if (claim === 'ambiguous') return { consistent: null, false_completion: null, outcome: 'needs_review' };
  if (state.status === 'unknown') return { consistent: null, false_completion: null, outcome: 'state_unknown' };
  return { consistent: claim === 'completed' ? state.status === 'completed' : claim === 'queued' ? state.status === 'ready' && !!state.readyInput : state.status === 'waiting_user',
    false_completion: claim === 'completed' ? state.status !== 'completed' : null, outcome: state.status };
}
