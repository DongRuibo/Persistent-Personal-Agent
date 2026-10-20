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
      description: '创建未来的一次性任务。when 必须保留用户原始时间表达，如“明天上午9点”，由服务按用户时区解析；不要自行换算。instruction 是任务内容。',
      parameters: Type.Object({ instruction: Type.String({ minLength: 1, maxLength: 10000 }), when: Type.String({ minLength: 1, maxLength: 100 }) }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(tasks.create(args.instruction, args.when));
      },
    }),
    defineTool({
      name: 'list_tasks', label: '查询任务', description: '查询最多100个任务，或按完整任务id查询单个任务。',
      parameters: Type.Object({ id: Type.Optional(Type.String()) }),
      execute: async (_id, args) => result(args.id ? tasks.get(args.id) : tasks.list()),
    }),
    defineTool({
      name: 'cancel_task', label: '取消待执行任务', description: '按完整任务id取消 pending 任务，其他状态不可取消。',
      parameters: Type.Object({ id: Type.String({ minLength: 1 }) }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(tasks.cancel(args.id));
      },
    }),
  ];
}
