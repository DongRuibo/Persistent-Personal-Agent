export type WorkJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';

// 结果、错误、执行起止时间和用量仍从原Run读取，不在Job中复制。
export interface WorkJob {
  id: string; threadId: string; requestId: string; instruction: string; status: WorkJobStatus;
  runId: string | null; createdAt: string; updatedAt: string;
}
export const workInputBytes = 14336;
