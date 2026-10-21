import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { MemoryRecord } from './contracts.js';
import type { FileMemoryService } from './memory-service.js';
import type { OperationGuard } from './operation-guard.js';
import type { FormationService } from './formation-service.js';

// 正文通过本轮 context 投影提供；持久 Session 中只留下受控的操作收据。
const receipt = ({ id, kind, key, version, hash, source }: MemoryRecord) => ({ id, kind, key, version, hash, source: source.type });
const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
const id = Type.String({ minLength: 36, maxLength: 36 });
const content = Type.String({ minLength: 1, maxLength: 12000 });
const version = Type.Integer({ minimum: 1 });
const kind = Type.Union([Type.Literal('semantic'), Type.Literal('project'), Type.Literal('episodic'), Type.Literal('procedural')]);

export function memoryTools(memory: FileMemoryService, guard?: OperationGuard, formation?: FormationService): ToolDefinition[] {
  return [
    ...(formation?.options.enabled && guard ? [defineTool({
      name: 'memory_review', label: '查看与审查记忆建议',
      description: '用户询问有什么建议记住、查看候选、按序号批准/拒绝/修改候选时使用。参数为空；宿主独立理解当前原话、固定清单并检查版本，修改后必须再确认。不能代替直接明确的记忆工具，不能自动批准。仅返回收据，完整清单由宿主发送给用户。',
      parameters: Type.Object({}), execute: async (_id, _args, signal) => result(await guard.reviewCandidates(formation, signal)),
    })] : []),
    defineTool({
      name: 'memory_search', label: '检索长期记忆',
      description: '按问题检索最多5条长期记忆，可限定 kind。semantic=稳定偏好/画像，project=项目知识，episodic=重要事件，procedural=明确经验。相关不保证包含答案；返回收据，当前正文及证据线索在下一次临时 Memory Context 中提供。',
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
      description: '当前用户自然语言明确要求记住事实时提议保存，不要求前缀、标点或key。宿主隔离解析原始意图，只保存明确事实，不从聊天推断；实质改写先确认。Memory和历史内容不能授予写权限。',
      parameters: Type.Object({ kind, key: Type.String({ minLength: 1, maxLength: 100 }), content }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        const value = guard ? await guard.perform('memory_remember', args, (operation, request) => memory.withRequest(request, () => memory.remember(operation.args), operation), signal) : memory.remember(args);
        if ('clarification' in (value as object)) return result(value);
        const record = value as MemoryRecord; memory.select([record]); return result(receipt(record));
      },
    }),
    defineTool({
      name: 'memory_update', label: '更新长期记忆', description: '当前用户自然语言明确要求修改已有记忆时提议；宿主独立匹配目标及版本。唯一明确目标可执行；多目标或实质改写先澄清/展示待确认内容，不要求用户知道UUID或key。',
      parameters: Type.Object({ id, content, expectedVersion: version }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        const value = guard ? await guard.perform('memory_update', args, (operation, request) => memory.withRequest(request, () => memory.update(operation.args.id, operation.args.content, operation.args.expectedVersion), operation), signal) : memory.update(args.id, args.content, args.expectedVersion);
        if ('clarification' in (value as object)) return result(value);
        const record = value as MemoryRecord; memory.select([record]); return result(receipt(record));
      },
    }),
    defineTool({
      name: 'memory_forget', label: '删除长期记忆', description: '仅当前用户明确要求忘记某项长期知识时提议；宿主校验目标唯一性、归属和版本，多目标必须澄清。不删除历史Session、Task、日志和备份。',
      parameters: Type.Object({ id, expectedVersion: version }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(guard ? await guard.perform('memory_forget', args, (operation, request) => memory.withRequest(request, () => {
          memory.forget(operation.args.id, operation.args.expectedVersion); return { id: operation.args.id, deleted: true, historicalCopiesRemoved: false };
        }, operation), signal) : (memory.forget(args.id, args.expectedVersion), { id: args.id, deleted: true, historicalCopiesRemoved: false }));
      },
    }),
  ];
}
