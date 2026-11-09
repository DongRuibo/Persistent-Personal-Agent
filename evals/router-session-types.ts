import type { FrozenTopicRoute } from '../src/topic-route-types.js';

export interface TopicSpec { title: string; description: string }
export interface RouteScript { kind: 'create' | 'use' | 'daily' | 'clarify'; target?: string }
export interface RouterCase {
  case_id: string; category: string; title: string; user_input: string;
  initial_state: { topics: string[]; current_topic: string | null; unbound_topics: string[]; archived_topics: string[];
    history_rounds: number; history: Record<string, string[]> };
  expected: { route: 'create' | 'reuse' | 'daily' | 'clarify'; target: string | null; session: 'create' | 'reuse' | 'none';
    new_topics: number; own_context_required: boolean; allowed_cross_session_read: 'none' | 'shared_memory' | 'user_provided';
    allowed_private_aliases: string[]; shared_memory_required: boolean; rationale: string };
  restart: null | { phase: 'idle' | 'topic_route' | 'chat' | 'compaction'; compact_before: boolean };
  memory: 'off' | 'shared';
}
export interface RouterDataset { schema_version: number; version: string; categories: Record<string, string>; topics: Record<string, TopicSpec>; cases: RouterCase[] }
export interface SessionSnapshot { path: string; session_id: string; messages: number; sha256: string; canaries: string[]; compactions: number }
export interface Snapshot {
  threads: { id: string; title: string; description: string; chatContextKey: string | null; status: string }[];
  sessions: SessionSnapshot[]; runs: { id: string; status: string; events: unknown[] }[]; jobs: number; tasks: number;
}
export interface WireRecord { index: number; stage: string; operation: string; raw: string; bytes: number; response: string | null }
export interface Observation {
  route: FrozenTopicRoute | null; target: string | null; session_action: 'create' | 'reuse' | 'none';
  new_topics: number; run_status: string | null; run_id: string | null; output: string | null;
}
export interface ContextGrade {
  applicable: boolean; complete: boolean; contaminated: boolean; contamination: { request: number; stage: string; token: string; reason: string }[];
  own_required: boolean; own_present: boolean | null; shared_required: boolean; shared_present: boolean | null;
  requests: number; stage_counts: Record<string, number>;
}
export interface RecoveryProbe { alias: string; passed: boolean; same_binding: boolean; same_session_id: boolean; own_present: boolean; contaminated: boolean; error?: string }
export interface CaseResult {
  case_id: string; category: string; title: string; mode: 'offline_scripted_model_real_host';
  result: 'passed' | 'failed' | 'error'; route_correct: boolean; session_correct: boolean;
  expected: RouterCase['expected']; actual: Observation | null; context: ContextGrade | null;
  recovery: RecoveryProbe[]; failure_categories: string[]; error: string | null; deterministic: boolean;
  elapsed_ms: number; evidence_path: string; evidence_sha256: string; selected_context_contaminated?: boolean | null;
}
