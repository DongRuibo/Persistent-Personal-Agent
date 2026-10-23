import type { SqliteStore } from './sqlite-store.js';
import type { GoalActor } from './goal-types.js';
import type { PolicyProposal } from './goal-policy-types.js';

// 结构化 Console 原话直接审批；不注册为模型工具，也不从模型、Memory、历史视图中恢复授权。
export function policyConsole(store: SqliteStore, actor: GoalActor, text: string, now: string): unknown {
  if (actor.target.channel !== 'console') throw new Error('策略控制目前仅支持可信 Console');
  if (text === '/policies') return store.policies.list(actor);
  if (text.startsWith('/policy show ')) return store.policies.audit(actor, text.slice(13).trim());
  const match = /^\/policy (approve|pause|revoke) (.+)$/u.exec(text);
  if (!match || Buffer.byteLength(text) > 16000) throw new Error('用法：/policies 或 /policy show ID 或 /policy approve JSON 或 /policy pause|revoke {"id":"...","version":1}');
  const value: unknown = JSON.parse(match[2]!);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('策略参数必须是对象');
  const run = store.beginRun(null, now);
  try {
    const command = { actor, sourceRunId: run.id, text };
    const output = match[1] === 'approve' ? store.policies.approve(command, value as PolicyProposal, now)
      : store.policies.control(command, String((value as { id: unknown }).id), Number((value as { version: unknown }).version), match[1] as 'pause' | 'revoke', now);
    store.finishRun(run.id, 'succeeded', now, JSON.stringify(output));
    return output;
  } catch (error) { store.finishRun(run.id, 'failed', now, undefined, String(error)); throw error; }
}
