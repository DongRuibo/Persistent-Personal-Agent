export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';

export interface Task {
  id: string;
  instruction: string;
  dueAt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  output: string | null;
  error: string | null;
  deliveryError: string | null;
}

export interface ModelCall {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number | null;
  stopReason: string;
  error?: string;
}

export interface ExecutionObserver {
  event(type: string, details?: string): void;
  modelCall(call: ModelCall): void;
}

export interface ExecutionRequest {
  prompt: string;
  scope: 'chat' | 'task';
  signal: AbortSignal;
  observer: ExecutionObserver;
}

// 业务层不接触 Pi Session、事件或模型对象。
export interface AgentExecutor {
  execute(request: ExecutionRequest): Promise<{ text: string }>;
  close(): Promise<void>;
}

export class ExecutionInterrupted extends Error {}

export interface Channel {
  sendMessage(message: { text: string; taskId?: string; runId?: string }): Promise<void>;
}

export interface Scheduler {
  start(): void;
  stop(): Promise<void>;
}

// 只预留接口，V0 不接入或实现 Memory。
export interface MemoryService {
  search(query: string): Promise<string[]>;
  remember(content: string): Promise<void>;
}
