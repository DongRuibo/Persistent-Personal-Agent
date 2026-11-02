import { Type } from 'typebox';
import type { WorkObject, WorkThread } from './work-thread-types.js';
import type { ExecutionObserver } from './contracts.js';

export interface WorkRouteRequest {
  mode: 'suggest'; requestId: string; text: string;
  // ID 来自本次明确选择；自然语言建议不能伪造 Guard 已展示或已确认的引用。
  selection: { threadId?: string; object?: { kind: 'task' | 'goal'; id: string } };
}
export type WorkRouteSuggestion =
  | { kind: 'chat'; reason: string }
  | { kind: 'existing_task'; taskId: string; threadId?: string; reason: string }
  | { kind: 'existing_goal'; goalId: string; threadId?: string; reason: string }
  | { kind: 'work'; threadId: string; reason: string }
  | { kind: 'clarify'; question: string };
export interface WorkRouteContext {
  threads: WorkThread[]; objects: WorkObject[];
}
export interface WorkRoutePreparation {
  context: WorkRouteContext;
  // null 表示尚需建议模型；其余仅是定位或澄清结果，不执行任何业务操作。
  suggestion: WorkRouteSuggestion | null;
}

export interface WorkRouteModelRequest {
  input: WorkRouteRequest; context: WorkRouteContext; signal: AbortSignal; observer: ExecutionObserver;
}
export type WorkRouteModel = (request: WorkRouteModelRequest) => Promise<WorkRouteSuggestion>;
const id = Type.String({ minLength: 1, maxLength: 100 });
const reason = Type.String({ minLength: 1, maxLength: 600, pattern: '\\S' });
export const workRouteSchema = Type.Union([
  Type.Object({ kind: Type.Literal('chat'), reason }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('existing_task'), taskId: id, threadId: Type.Optional(id), reason }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('existing_goal'), goalId: id, threadId: Type.Optional(id), reason }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('work'), threadId: id, reason }, { additionalProperties: false }),
  Type.Object({ kind: Type.Literal('clarify'), question: reason }, { additionalProperties: false }),
]);
