export type WorkJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';

export type WorkInputReference = { kind: 'request'; requestId: string; itemId: string; hash: string }
  | { kind: 'job_result'; jobId: string; runId: string; hash: string; inputHash?: string; rootInputHash?: string }
  | { kind: 'goal_result'; goalId: string; runId: string; hash: string; checkpointHash: string; objectiveHash?: string; inputHash?: string };

// 结果、错误、执行起止时间和用量仍从原Run读取，不在Job中复制。
export interface WorkJob {
  id: string; threadId: string; requestId: string; instruction: string; status: WorkJobStatus;
  runId: string | null; createdAt: string; updatedAt: string;
  rootJobId: string; previousJobId: string | null; sourceItemId: string | null;
  inputReferences: WorkInputReference[] | null; inputHash: string | null;
}
export const workInputBytes = 14336;
