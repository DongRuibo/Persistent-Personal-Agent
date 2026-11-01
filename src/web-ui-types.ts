import type { WorkRouteRequest, WorkRouteSuggestion } from './work-route-types.js';
import type { WorkJob } from './work-job-types.js';
import type { WebSearchCall, WebSearchSummary } from './web-search-types.js';

export interface WebRun {
  mode?: 'suggest';
  id: string; taskId: string | null; status: string; startedAt: string; finishedAt: string | null;
  output: string | null; error: string | null; viewed: boolean; truncated: boolean;
  fileOperationId?: string;
  deliveryError?: string | null;
  web?: WebSearchSummary;
  webCalls?: WebSearchCall[];
  usage: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number | null };
}
export interface WebWorkJob extends WorkJob { run: WebRun | null }
export interface WebWorkRoute {
  requestId: string; text: string; selection: WorkRouteRequest['selection']; run: WebRun;
  suggestion: WorkRouteSuggestion | null; revoked: boolean; job: WorkJob | null; error: string | null;
}
export interface WebChat { requestId: string; text: string; run: WebRun }
export interface WebTask { id: string; instruction: string; dueAt: string; status: string; updatedAt: string; result: string | null }
export interface WebGoal { id: string; objective: string; status: string; updatedAt: string; blockedReason: string | null }
export interface WebGoalDetail extends WebGoal {
  planRevision: number; steps: { id: string; title: string; instruction: string; deliverable: string; doneWhen: string; status: string }[];
  checkpoint: { artifactText: string; progressSummary: string; question: string } | null;
  pendingPlan: { title: string; instruction: string; deliverable: string; doneWhen: string }[] | null;
}
export interface WebFileSummary {
  id: string; runId: string; path: string; kind: string; hash: string; contentHash: string;
  createdAt: string; expires: number; status: string; acknowledged: boolean;
}
export interface WebFile extends WebFileSummary {
  run: WebRun;
  content: string; preview: string; diff: string;
}
export interface WebNotice { runId: string; text: string; at: string; viewedAt: string | null; taskId: string | null; goalId: string | null }
export interface WebSnapshot {
  suggestions?: WebWorkRoute[];
  chats: WebChat[]; tasks: WebTask[]; goals: WebGoal[]; files: WebFileSummary[]; activity: WebRun[]; inbox: WebNotice[];
  capabilities: { goal: boolean; skills: string[]; filesRead: boolean; filesWrite: boolean; webRead: boolean; webSearch?: boolean; workThreads?: boolean; workJobs?: boolean; workRouting?: boolean; workRoutingBusy?: boolean; workEvents?: boolean; workRecall?: boolean; busy: boolean; push: false };
}
