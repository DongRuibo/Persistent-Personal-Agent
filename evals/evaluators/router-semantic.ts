import type { TopicReferences, TopicRouteChoice } from '../../src/topic-route-types.js';
import type { RouterCase } from '../router-session-types.js';

export interface SemanticCase {
  case_id: string; category: string; title: string; text: string;
  threads: { alias: string; id: string; title: string; description: string; bound: boolean; status: 'active' | 'archived' }[];
  current_topic: string | null; references: TopicReferences; expected: RouterCase['expected']; create_scope_terms: string[]; snapshot_note: string;
}
export interface SemanticPlan {
  version: string; source_dataset_sha256: string; model: string; base_url: string;
  limits: { max_requests: number; max_output_tokens_per_request: number; max_input_token_reservation: number; budget_cny: number; max_retries: number; timeout_ms: number };
  reservation_rates: { input_cny_per_million: number; output_cny_per_million: number; meaning: string };
  price_sources: { url: string; observed: string }[]; cases: SemanticCase[];
}
export interface SemanticGrade { correct: boolean; needs_review: boolean; action: string | null; target: string | null; reason: string }

// 新建主题名称可以改写；缺少预先冻结的范围词时留待复核，不能默认为正确。
export function gradeProposal(choice: TopicRouteChoice | null, spec: SemanticCase): SemanticGrade {
  if (!choice) return { correct: false, needs_review: false, action: null, target: null, reason: '没有合法路由提议' };
  const action = choice.kind === 'use' ? 'reuse' : choice.kind;
  const target = choice.kind === 'use' ? spec.threads.find(t => t.id === choice.threadId)?.alias ?? 'outside_candidates' : null;
  if (action !== spec.expected.route || choice.kind === 'use' && target !== spec.expected.target) {
    return { correct: false, needs_review: false, action, target, reason: action !== spec.expected.route ? '动作不匹配' : '主题不匹配' };
  }
  if (choice.kind === 'create') {
    const scoped = spec.create_scope_terms.some(term => (choice.title + ' ' + choice.description).includes(term));
    return { correct: scoped, needs_review: !scoped, action, target: scoped ? spec.expected.target : null,
      reason: scoped ? '动作及冻结范围词匹配' : '新主题范围需人工复核，不能只按create动作判正确' };
  }
  return { correct: true, needs_review: false, action, target, reason: '动作及目标匹配' };
}

export class SemanticBudget {
  requests = 0;
  input_reserved = 0;
  output_reserved = 0;
  cny_reserved = 0;
  constructor(readonly plan: Pick<SemanticPlan, 'limits' | 'reservation_rates'>) {}
  reserve(bodyBytes: number) {
    // 实际序列化字节加固定协议余量作为保守输入Token上界近似，不按字符/4估中文。
    const input = bodyBytes + 256, output = this.plan.limits.max_output_tokens_per_request;
    const cny = (input * this.plan.reservation_rates.input_cny_per_million + output * this.plan.reservation_rates.output_cny_per_million) / 1e6;
    if (this.requests + 1 > this.plan.limits.max_requests || this.input_reserved + input > this.plan.limits.max_input_token_reservation
      || this.cny_reserved + cny > this.plan.limits.budget_cny) throw new Error('真实路由请求/输入Token预留/费用预留预算已到上限');
    this.requests++; this.input_reserved += input; this.output_reserved += output; this.cny_reserved += cny;
    return { ordinal: this.requests, input_token_reservation: input, output_token_limit: output, cny_reservation: cny };
  }
}

export interface SemanticResult {
  case_id: string; category: string; mode: 'live' | 'prepare'; model_requested: boolean; prepared_http: boolean;
  raw_text: string | null; raw_choice: TopicRouteChoice | null; final_choice: TopicRouteChoice | null;
  raw_grade: SemanticGrade | null; final_grade: SemanticGrade | null; logical_session_action: string | null;
  error: string | null; elapsed_ms: number; http: unknown[];
}
export function summarizeSemantic(rows: SemanticResult[], plan: SemanticPlan, budget: SemanticBudget) {
  const ratio = (n: number, d: number) => ({ numerator: n, denominator: d, value: d ? n / d : null });
  const live = rows.filter(row => row.mode === 'live'), model = live.filter(row => row.model_requested), deterministic = live.filter(row => !row.model_requested);
  const metric = (subset: SemanticResult[], field: 'raw_grade' | 'final_grade') => {
    const needs = subset.filter(row => row[field]?.needs_review).length;
    const base = ratio(subset.filter(row => row[field]?.correct).length, subset.length);
    return { ...base, value: needs ? null : base.value, needs_review: needs, observed_lower_bound: base.value };
  };
  return { planned_cases: plan.cases.length, completed_cases: rows.length, mode: rows[0]?.mode ?? null,
    not_run_cases: plan.cases.filter(spec => !rows.some(row => row.case_id === spec.case_id)).map(spec => spec.case_id),
    model_raw_routing_accuracy: metric(model, 'raw_grade'), host_final_routing_accuracy: metric(live, 'final_grade'),
    deterministic_routing_accuracy: metric(deterministic, 'final_grade'),
    api_errors: live.filter(row => row.model_requested && !!row.error).length,
    wrong_raw_cases: model.filter(row => !row.raw_grade?.correct).map(row => row.case_id),
    wrong_final_cases: live.filter(row => !row.final_grade?.correct).map(row => row.case_id),
    by_category: Object.fromEntries([...new Set(plan.cases.map(row => row.category))].map(category => {
      const selected = live.filter(row => row.category === category); return [category, { raw: metric(selected.filter(row => row.model_requested), 'raw_grade'), final: metric(selected, 'final_grade') }];
    })),
    budget: { requests: budget.requests, input_token_reservation: budget.input_reserved, output_token_reservation: budget.output_reserved,
      reserved_cny: budget.cny_reserved, cost_cny: null, note: '预留系数不是供应商单价，不能把SDK兼容模型的零cost当真实费用；账单未确认则null' },
    real_session_reuse_rate: null, real_context_contamination_rate: null, real_session_recovery_rate: null,
    scope: '独立冻结状态上的真实Router语义；未运行主回答/Worker/实际Session重启，不是完整产品端到端质量' };
}
