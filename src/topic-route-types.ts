// 路由只描述当前请求归属，不授予工具权限，也不接收模型提供的路径或Session key。
export type TopicRouteChoice = { kind: 'daily'; reason: string }
  | { kind: 'clarify'; question: string; reason: string }
  | { kind: 'use'; threadId: string; reason: string }
  | { kind: 'create'; title: string; description: string; reason: string };
export type FrozenTopicRoute = Extract<TopicRouteChoice, { kind: 'daily' | 'clarify' }>
  | { kind: 'topic'; threadId: string; contextKey: string; title: string; description: string; reason: string;
    selection: { kind: 'create' | 'use' } };

export class TopicRouteError extends Error {
  readonly status = 400;
}

export interface TopicCandidate { id: string; title: string; description: string; bound: boolean }
export interface TopicDecision { action: 'chat' | 'selection' | 'answer'; candidates: TopicCandidate[]; purpose?: 'persistent-use'; explicitThreadId?: string }
export interface PreparedTopicChat { route: FrozenTopicRoute; action: 'chat' | 'selection' | 'answer'; hasCandidates?: boolean }
export type BusinessReferenceKind = 'goal' | 'task' | 'memory' | 'work' | 'unknown';
export interface TopicReferences { kinds: ('goal' | 'file' | 'web' | 'task' | 'memory' | 'work')[]; count: number;
  reference?: { kind: BusinessReferenceKind; count: number } }

// 补答后的候选由宿主原样附在固定分隔之后，供原渲染ACK关联。
export const topicClarificationSeparator = '\n\n主题归属：\n';

// 未知模型数据在路由适配入口定型一次；存储/Session层只接收此类型。
export function parseTopicRouteChoice(input: unknown): TopicRouteChoice {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TopicRouteError('主题路由格式无效');
  const row = input as Record<string, unknown>;
  const fields = row.kind === 'daily' ? ['kind', 'reason'] : row.kind === 'clarify' ? ['kind', 'question', 'reason']
    : row.kind === 'use' ? ['kind', 'threadId', 'reason'] : row.kind === 'create' ? ['kind', 'title', 'description', 'reason'] : [];
  if (!fields.length || Object.keys(row).some(key => !fields.includes(key))) throw new TopicRouteError('主题路由字段无效');
  const text = (key: string, limit: number, empty = false) => {
    const value = row[key];
    if (typeof value !== 'string' || (!empty && !value.trim()) || value.trim().length > limit) throw new TopicRouteError('主题路由文字无效或过长');
    return value.trim();
  };
  const reason = text('reason', 240);
  if (row.kind === 'daily') return { kind: 'daily', reason };
  if (row.kind === 'clarify') return { kind: 'clarify', question: text('question', 240), reason };
  if (row.kind === 'create') return { kind: 'create', title: text('title', 120), description: text('description', 480, true), reason };
  if (typeof row.threadId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(row.threadId)) throw new TopicRouteError('主题路由ID或显式绑定标记无效');
  return { kind: 'use', threadId: row.threadId, reason };
}
