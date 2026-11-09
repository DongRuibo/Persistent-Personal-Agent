import type { CaseResult, ContextGrade, RouterCase, WireRecord } from '../router-session-types.js';

export const ratio = (n: number, d: number, scope: string) => ({ numerator: n, denominator: d, value: d ? n / d : null, scope });

// 检查真实HTTP正文；标记来源由夹具登记，不从最终回答推断是否泄漏。
export function gradeContext(wire: WireRecord[], spec: RouterCase, canaries: Record<string, string>, sharedToken: string,
  dispatched: number): ContextGrade {
  const contamination: ContextGrade['contamination'] = [], stageCounts: Record<string, number> = {};
  for (const call of wire) {
    stageCounts[call.stage] = (stageCounts[call.stage] ?? 0) + 1;
    for (const [alias, token] of Object.entries(canaries)) {
      const provided = spec.expected.allowed_private_aliases.includes(alias);
      const own = alias === spec.expected.target && ['chat', 'compaction'].includes(call.stage);
      if (call.raw.includes(token) && !provided && !own) contamination.push({ request: call.index, stage: call.stage, token, reason: '未允许的主题私有历史' });
    }
    if (call.raw.includes(sharedToken) && !(spec.memory === 'shared' && call.stage === 'chat')) {
      contamination.push({ request: call.index, stage: call.stage, token: sharedToken, reason: '共享Memory出现在未允许阶段或关闭对照中' });
    }
  }
  const main = wire.filter(call => call.stage === 'chat'), target = spec.expected.target && canaries[spec.expected.target];
  return { applicable: wire.length > 0, complete: wire.length === dispatched && wire.every(call => call.bytes === Buffer.byteLength(call.raw) && !!JSON.parse(call.raw)),
    contaminated: contamination.length > 0, contamination, own_required: spec.expected.own_context_required,
    own_present: spec.expected.own_context_required ? !!target && main.some(call => call.raw.includes(target)) : null,
    shared_required: spec.expected.shared_memory_required, shared_present: spec.expected.shared_memory_required ? main.some(call => call.raw.includes(sharedToken)) : null,
    requests: wire.length, stage_counts: stageCounts };
}

export function summarize(results: CaseResult[]) {
  const reuse = results.filter(row => row.expected.session === 'reuse');
  const attempts = results.filter(row => row.actual?.session_action === 'reuse');
  const tp = reuse.filter(row => row.session_correct).length;
  const fp = attempts.filter(row => !row.session_correct).length, fn = reuse.length - tp;
  const precision = tp + fp ? tp / (tp + fp) : null, recall = tp + fn ? tp / (tp + fn) : null;
  const create = results.filter(row => row.expected.session === 'create');
  const contexts = results.filter(row => row.context?.applicable && row.context.complete);
  const contaminated = contexts.filter(row => row.context!.contaminated);
  const selected = contexts.filter(row => typeof row.selected_context_contaminated === 'boolean');
  const correctlyRouted = contexts.filter(row => row.route_correct);
  const own = results.filter(row => row.expected.own_context_required), shared = results.filter(row => row.expected.shared_memory_required);
  const recovery = results.flatMap(row => row.recovery);
  const by = (get: (row: CaseResult) => string) => Object.fromEntries([...new Set(results.map(get))].map(key => {
    const rows = results.filter(row => get(row) === key); return [key, ratio(rows.filter(row => row.route_correct).length, rows.length, 'scripted_mock_host_contract_not_semantic_accuracy')];
  }));
  return {
    counts: { total: results.length, passed: results.filter(row => row.result === 'passed').length,
      failed: results.filter(row => row.result === 'failed').length, error: results.filter(row => row.result === 'error').length },
    real_semantic: { routing_accuracy: null, session_create_accuracy: null, session_reuse_precision: null, session_reuse_recall: null,
      session_reuse_f1: null, context_contamination_rate: null, session_recovery_rate: null, status: 'not_run', reason: '仅使用固定localhost模型；没有独立真实模型语义预测' },
    offline_mechanisms: {
      mock_route_contract_accuracy: ratio(results.filter(row => row.route_correct).length, results.length, 'scripted_mock_host_contract_not_semantic_accuracy'),
      deterministic_route_contract_accuracy: ratio(results.filter(row => row.deterministic && row.route_correct).length,
        results.filter(row => row.deterministic).length, 'production_deterministic_branches_only'),
      session_create_accuracy: ratio(create.filter(row => row.session_correct).length, create.length, 'scripted_decisions_real_sqlite_and_pi_jsonl'),
      session_reuse: { tp, fp, fn, precision, recall, f1: precision !== null && recall !== null ? precision + recall ? 2 * precision * recall / (precision + recall) : 0 : null,
        scope: 'correct_target_reuse_under_fixed_mock_decisions_wrong_target_counts_fp_and_fn' },
      unintended_session_creation: results.filter(row => row.actual?.session_action === 'create' && row.expected.session !== 'create').length,
      context_contamination_rate: ratio(contaminated.length, contexts.length, 'case_with_any_forbidden_canary_in_captured_model_http'),
      selected_session_contamination_rate: ratio(selected.filter(row => row.selected_context_contaminated).length, selected.length, 'conditioned_on_actual_selected_topic_not_gold_routing'),
      correctly_routed_contamination_rate: ratio(correctlyRouted.filter(row => row.context!.contaminated).length, correctlyRouted.length, 'gold_route_correct_subset'),
      contaminated_requests: contexts.flatMap(row => row.context!.contamination.map(hit => row.case_id + ':' + hit.request)).filter((key, i, all) => all.indexOf(key) === i).length,
      context_capture_coverage: ratio(results.filter(row => row.context?.complete).length, results.length, 'all_planned_cases_zero_http_cases_recorded_separately'),
      context_applicable_cases: contexts.length, zero_http_cases: results.filter(row => row.context && !row.context.applicable).length,
      own_context_presence: ratio(own.filter(row => row.context?.own_present).length, own.length, 'all_gold_required_history_cases_including_route_and_execution_failures'),
      shared_memory_presence: ratio(shared.filter(row => row.context?.shared_present).length, shared.length, 'explicitly_required_shared_memory_cases'),
      session_recovery_rate: ratio(recovery.filter(row => row.passed).length, recovery.length, 'planned_case_x_topic_after_real_sigkill_then_router_reentry'),
    },
    by_category: by(row => row.category), by_topic: by(row => row.expected.target ?? row.expected.route),
    errors: results.filter(row => row.result !== 'passed').map(row => ({ case_id: row.case_id, failure_categories: row.failure_categories,
      expected: row.expected, actual: row.actual, error: row.error })),
  };
}
