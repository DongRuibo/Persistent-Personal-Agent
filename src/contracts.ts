import type { WorkRouteModel } from './work-route-types.js';
import type { SkillCatalog, SkillSnapshot } from './skill-service.js';
export type TaskStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'interrupted' | 'cancelled';
export type RunStatus = 'running' | 'succeeded' | 'failed' | 'interrupted';

export type MessageTarget = { channel: 'console' } | { channel: 'web'; userId: string } | {
  channel: 'feishu'; appId: string; chatId: string; userOpenId: string;
};

export interface OutboundMessage {
  text: string;
  taskId?: string;
  goalId?: string;
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
  purpose?: 'memory_formation' | 'work_route';
  jobId?: string;
}

export interface ExecutionObserver {
  event(type: string, details?: string): void;
  modelCall(call: ModelCall): void;
}

export interface ExecutionRequest {
  prompt: string;
  scope: 'chat' | 'task' | 'goal' | 'work';
  // Goal 的检索词由宿主独立构造，不把整个进度快照当检索问题。
  memoryQuery?: string;
  // 仅可信 GoalRunner 从已消费的宿主策略授权设置，不是模型工具参数。
  policyExecution?: boolean;
  // 仅宿主从已批准Plan绑定和领取事务冻结，绝不是模型工具参数。
  skill?: SkillSnapshot;
  signal: AbortSignal;
  observer: ExecutionObserver;
  source?: { channel: 'console' | 'feishu' | 'web'; reference: string };
}

// 业务层不接触 Pi Session、事件或模型对象。
export interface AgentExecutor {
  readonly suggestWorkRoute?: WorkRouteModel;
  readonly skills?: SkillCatalog;
  // 只检查执行条件，不调用模型或产生业务副作用；失败时尚未领取任务。
  checkReady?(): void;
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
  source: { type: 'user_explicit'; reference: string; channel: 'console' | 'feishu' | 'web' | 'host' };
}
export interface MemoryService {
  search(query: string, kind?: MemoryKind): MemoryRecord[];
  get(id: string): MemoryRecord;
  remember(input: MemoryInput): MemoryRecord;
  update(id: string, content: string, expectedVersion: number): MemoryRecord;
  forget(id: string, expectedVersion: number): void;
}

// 只由宿主验证后在异步请求上下文中传递；不是模型可填写的工具参数。
export type WriteOperation =
  | { tool: 'create_task'; args: { instruction: string; when: string } }
  | { tool: 'cancel_task'; args: { id: string } }
  | { tool: 'memory_remember'; args: MemoryInput }
  | { tool: 'memory_update'; args: { id: string; content: string; expectedVersion: number } }
  | { tool: 'memory_forget'; args: { id: string; expectedVersion: number } };
