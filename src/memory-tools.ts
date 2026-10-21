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
      description: '仅本轮“记住：完整正文”命令可写，content 必须逐字等于冒号后的正文，不能概括。kind/key 可由用户用独占行 kind=project、key=agent.database 指定，指定后必须匹配；这些元数据行不属于正文。不确定时请用户重述，不要尝试写入。不得保存推断或凭据。同 key 冲突须明确更新。',
      parameters: Type.Object({ kind, key: Type.String({ minLength: 1, maxLength: 100 }), content }),
      execute: async (_id, args, signal) => { signal?.throwIfAborted(); const record = memory.remember(args); memory.select([record]); return result(receipt(record)); },
    }),
    defineTool({
      name: 'memory_update', label: '更新长期记忆', description: '仅本轮“更新记忆：完整新正文”并另起一行指定 key=… 或 id=… 才可用，必要时加 kind=… 消除同 key 歧义。content 必须逐字保留完整新正文（去除元数据行），禁止概括。先读当前 expectedVersion，原 id/key/kind 保留。不符合格式请用户重述。',
      parameters: Type.Object({ id, content, expectedVersion: version }),
      execute: async (_id, args, signal) => { signal?.throwIfAborted(); const record = memory.update(args.id, args.content, args.expectedVersion); memory.select([record]); return result(receipt(record)); },
    }),
    defineTool({
      name: 'memory_forget', label: '删除长期记忆', description: '仅本轮“忘记：key=…”或“忘记：id=…”明确指定目标时使用，元数据独占一行，不加描述正文。同 key 歧义须 kind=… 或完整 id，先读当前 expectedVersion。仅删 Memory 当前条目及索引；历史 Session、日志和备份不随之删除。',
      parameters: Type.Object({ id, expectedVersion: version }),
      execute: async (_id, args, signal) => { signal?.throwIfAborted(); memory.forget(args.id, args.expectedVersion); return result({ id: args.id, deleted: true, historicalCopiesRemoved: false }); },
    }),
  ];
}
