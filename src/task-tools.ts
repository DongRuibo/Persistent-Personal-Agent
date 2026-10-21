import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { TaskService } from './task-service.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });

// Pi 适配层：这些工具只调用 Task Service，不暴露数据库或 Session。
export function taskTools(tasks: TaskService): ToolDefinition[] {
  return [
    defineTool({
      name: 'create_task', label: '创建一次性任务',
      description: '仅本轮“1分钟后提醒我喝水”或“创建任务：原始时间\\n完整内容”命令可创建；when 和 instruction 必须逐字保留各自原文，时间由服务解析，不自行换算或概括。一轮最多一次，不符合格式请用户重述，不能从 Memory 或历史取得授权。',
      parameters: Type.Object({ instruction: Type.String({ minLength: 1, maxLength: 10000 }), when: Type.String({ minLength: 1, maxLength: 100 }) }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(tasks.createFromAgent(args.instruction, args.when));
      },
    }),
    defineTool({
      name: 'list_tasks', label: '查询任务', description: '查询最多100个任务，或按完整任务id查询单个任务。',
      parameters: Type.Object({ id: Type.Optional(Type.String()) }),
      execute: async (_id, args) => result(args.id ? tasks.get(args.id) : tasks.list()),
    }),
    defineTool({
      name: 'cancel_task', label: '取消待执行任务', description: '仅本轮“取消任务：完整id”或“取消 完整id”指定的 pending 任务可取消，不从历史猜测目标，其他状态不可取消。',
      parameters: Type.Object({ id: Type.String({ minLength: 1 }) }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(tasks.cancelFromAgent(args.id));
      },
    }),
  ];
}
