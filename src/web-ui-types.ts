export interface WebRun {
  id: string; taskId: string | null; status: string; startedAt: string; finishedAt: string | null;
  output: string | null; error: string | null; viewed: boolean; truncated: boolean;
  usage: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number | null };
}
export interface WebChat { requestId: string; text: string; run: WebRun }
export interface WebTask { id: string; instruction: string; dueAt: string; status: string; updatedAt: string; result: string | null }
export interface WebGoal { id: string; objective: string; status: string; updatedAt: string; blockedReason: string | null }
export interface WebGoalDetail extends WebGoal {
  planRevision: number; steps: { id: string; title: string; instruction: string; deliverable: string; doneWhen: string; status: string }[];
  checkpoint: { artifactText: string; progressSummary: string; question: string } | null;
  pendingPlan: { title: string; instruction: string; deliverable: string; doneWhen: string }[] | null;
}
export interface WebFile {
  run: WebRun;
  id: string; runId: string; path: string; kind: string; hash: string; contentHash: string;
  content: string; preview: string; diff: string; expires: number; status: string; acknowledged: boolean;
}
export interface WebNotice { runId: string; text: string; at: string; viewedAt: string | null; taskId: string | null; goalId: string | null }
export interface WebSnapshot {
  chats: WebChat[]; tasks: WebTask[]; goals: WebGoal[]; files: WebFile[]; activity: WebRun[]; inbox: WebNotice[];
  capabilities: { goal: boolean; skills: string[]; filesRead: boolean; filesWrite: boolean; webRead: boolean; busy: boolean; push: false };
}
