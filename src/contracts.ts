export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';

export type MessageTarget = { channel: 'console' } | {
  channel: 'feishu'; appId: string; chatId: string; userOpenId: string;
};

export interface OutboundMessage {
  text: string;
  taskId?: string;
  runId?: string;
  target?: MessageTarget;
}

export interface Task {
  id: string;
  instruction: string;
  dueAt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  target: MessageTarget;
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
  source?: { channel: 'console' | 'feishu'; reference: string };
}

// 业务层不接触 Pi Session、事件或模型对象。
export interface AgentExecutor {
  execute(request: ExecutionRequest): Promise<{ text: string }>;
  close(): Promise<void>;
}

export class ExecutionInterrupted extends Error {}

export interface Channel {
  sendMessage(message: OutboundMessage): Promise<void>;
}

export interface Scheduler {
  start(): void;
  stop(): Promise<void>;
}

export type MemoryKind = 'semantic' | 'project' | 'episodic' | 'procedural';
export interface MemoryInput { kind: MemoryKind; key: string; content: string }
export interface MemoryRecord extends MemoryInput {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  hash: string;
  source: { type: 'user_explicit'; reference: string; channel: 'console' | 'feishu' | 'host' };
}
export interface MemoryService {
  search(query: string, kind?: MemoryKind): MemoryRecord[];
  get(id: string): MemoryRecord;
  remember(input: MemoryInput): MemoryRecord;
  update(id: string, content: string, expectedVersion: number): MemoryRecord;
  forget(id: string, expectedVersion: number): void;
}
