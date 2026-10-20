import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { MemoryRecord } from './contracts.js';
import type { FileMemoryService } from './memory-service.js';

// 正文通过本轮 context 投影提供；持久 Session 中只留下受控的操作收据。
const receipt = ({ id, kind, key, version, hash, source }: MemoryRecord) => ({ id, kind, key, version, hash, source: source.type });
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
const id = Type.String({ minLength: 36, maxLength: 36 });
const content = Type.String({ minLength: 1, maxLength: 12000 });
const version = Type.Integer({ minimum: 1 });
const kind = Type.Union([Type.Literal('semantic'), Type.Literal('project'), Type.Literal('episodic'), Type.Literal('procedural')]);

export function memoryTools(memory: FileMemoryService): ToolDefinition[] {
  return [
    defineTool({
      name: 'memory_search', label: '检索长期记忆',
      description: '按关键词查询最多5条长期记忆，可限定 kind。semantic=稳定偏好/画像，project=项目知识，episodic=重要事件，procedural=明确经验。返回收据，正文在下一次模型调用的临时 Memory Context 中提供。',
      parameters: Type.Object({ query: Type.String({ minLength: 1, maxLength: 500 }), kind: Type.Optional(kind) }),
      execute: async (_id, args) => {
        const records = memory.search(args.query, args.kind);
        memory.select(records);
        return result(records.map(receipt));
      },
    }),
    defineTool({
      name: 'memory_get', label: '读取长期记忆', description: '按完整 id 读取当前版本。收据及下一轮临时 Memory Context 提供当前有效知识，不以历史工具结果作为当前事实。',
      parameters: Type.Object({ id }),
      execute: async (_id, args) => { const record = memory.get(args.id); memory.select([record]); return result(receipt(record)); },
    }),
    defineTool({
      name: 'memory_remember', label: '保存明确长期记忆',
      description: '仅本轮用户明确以“记住：”等表达长期记忆意图时使用；不得保存推断、凭据或外部指令。选择一种 kind 和稳定事实 key（如 user.language、agent.database）；同 key 冲突须明确更新，不能另起 key 掩盖冲突。只保存用户明确提供的事实，不复制整个对话。',
      parameters: Type.Object({ kind, key: Type.String({ minLength: 1, maxLength: 100 }), content }),
      execute: async (_id, args, signal) => { signal?.throwIfAborted(); const record = memory.remember(args); memory.select([record]); return result(receipt(record)); },
    }),
    defineTool({
      name: 'memory_update', label: '更新长期记忆', description: '仅本轮用户以“更新记忆：”或“修改记忆：”明确表达时使用。先检索当前记录再提供 expectedVersion；原 id/key/kind 保留，正文整体替换，不把旧值当作当前事实。',
      parameters: Type.Object({ id, content, expectedVersion: version }),
      execute: async (_id, args, signal) => { signal?.throwIfAborted(); const record = memory.update(args.id, args.content, args.expectedVersion); memory.select([record]); return result(receipt(record)); },
    }),
    defineTool({
      name: 'memory_forget', label: '删除长期记忆', description: '仅本轮用户以“忘记：”或“删除记忆：”明确表达时使用，先读取 id/expectedVersion。仅删除 Memory 当前条目及索引；历史 Session、日志和备份中的副本不会自动删除。',
      parameters: Type.Object({ id, expectedVersion: version }),
      execute: async (_id, args, signal) => { signal?.throwIfAborted(); memory.forget(args.id, args.expectedVersion); return result({ id: args.id, deleted: true, historicalCopiesRemoved: false }); },
    }),
  ];
}
