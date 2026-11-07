import { ratio } from './metrics.js';
export interface Phase2Result {
  case_id: string; title: string; evaluation_result: 'passed' | 'failed' | 'error' | 'skipped'; latency_ms: number;
  checks: { name: string; passed: boolean; actual?: unknown; expected?: unknown }[];
  observations: Record<string, unknown>; failure_reason: string | null; trace_path?: string; trace_sha256?: string;
}
export function phase2Metrics(results: Phase2Result[]) {
  const commonIds = ['N01','N03','N04','N05','N06','N07','N08','N10','N12','N13','N14'];
  const recoverIds = ['N03','N04','N05','N06','N07','N08'];
  const common = results.filter(r => commonIds.includes(r.case_id)), recover = results.filter(r => recoverIds.includes(r.case_id));
  const observed = common.filter(r => r.observations.notification_eligible === true), accepted = observed.filter(r => Number(r.observations.external_acceptances) > 0);
  const firstClassification = results.flatMap(r => (r.observations.classifications as { expected: string; actual: string }[] | undefined)?.slice(0, 1) ?? []);
  const goals = results.filter(r => typeof r.observations.goal_state_correct === 'boolean');
  const latency = (key: string) => {
    const values = accepted.map(r => r.observations[key]).filter((v): v is number => typeof v === 'number').sort((a,b) => a-b);
    return { samples: values.length, p50: values[Math.ceil(values.length * .5) - 1] ?? null, p95: values[Math.ceil(values.length * .95) - 1] ?? null };
  };
  return {
    counts: Object.fromEntries(['passed','failed','error','skipped'].map(status => [status, results.filter(r => r.evaluation_result === status).length])),
    notification_intent_persistence_rate: ratio(observed.filter(r => r.observations.intent_persisted === true).length, common.length, 'fixed_11_common_notification_cases'),
    notification_delivery_success_rate: ratio(accepted.length, common.length, 'external_acceptance_in_fixed_11_cases_including_permanent_faults'),
    local_sent_confirmation_rate: ratio(observed.filter(r => r.observations.local_sent === true).length, common.length, 'local_ack_in_fixed_11_cases'),
    notification_loss_rate: ratio(observed.filter(r => Number(r.observations.external_acceptances) === 0).length, common.length, 'no_external_acceptance_within_case_observation_window'),
    duplicate_notification_rate: ratio(accepted.filter(r => Number(r.observations.duplicates) > 0).length, accepted.length, 'cases_with_multiple_acceptances_per_accepted_case'),
    notification_recovery_rate: ratio(recover.filter(r => r.observations.recovered === true).length, recover.length, 'fixed_6_recoverable_fault_cases_require_external_and_local_confirmation'),
    recoverable_notification_loss_rate: ratio(recover.filter(r => r.observations.notification_eligible === true && Number(r.observations.external_acceptances) === 0).length, recover.length, 'fixed_6_recoverable_fault_cases'),
    task_state_consistency_rate: ratio(observed.filter(r => r.observations.task_succeeded === true && r.observations.executions === 1).length, common.length, 'fixed_11_cases_task_succeeded_and_one_model_execution'),
    retry_classification_accuracy: ratio(firstClassification.filter(c => c.expected === c.actual).length, firstClassification.length, 'first_failure_per_case_no_retry_attempt_weighting'),
    goal_state_accuracy: ratio(goals.filter(r => r.observations.goal_state_correct === true).length, goals.length, 'offline_host_goal_state_not_model_semantic_accuracy'),
    notification_delivery_latency_controlled_ms: latency('first_acceptance_ms'),
    notification_delivery_latency_wall_ms: latency('first_acceptance_wall_ms'),
    paid_model_calls: 0, cost_cny: 0,
  };
}
