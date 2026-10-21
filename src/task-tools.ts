import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { TaskService } from './task-service.js';
import type { OperationGuard } from './operation-guard.js';

const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });

// Pi 适配层：这些工具只调用 Task Service，不暴露数据库或 Session。
export function taskTools(tasks: TaskService, guard?: OperationGuard): ToolDefinition[] {
  return [
    defineTool({
      name: 'create_task', label: '创建一次性任务',
      description: '用户用自然语言明确请求提醒时提议创建。when 保留用户时间表达，宿主解析时间并独立验证当前意图；不需要命令格式。参数只是提议，实际内容以宿主验证结果为准。澄清时将宿主选项原样转达，不猜时间或目标。',
      parameters: Type.Object({ instruction: Type.String({ minLength: 1, maxLength: 10000 }), when: Type.String({ minLength: 1, maxLength: 100 }) }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(guard ? await guard.perform('create_task', args, (operation, request) => tasks.withRequest(request,
          () => tasks.createFromAgent(operation.args.instruction, operation.args.when), operation), signal) : tasks.createFromAgent(args.instruction, args.when));
      },
    }),
    defineTool({
      name: 'list_tasks', label: '查询任务', description: '查询当前用户最多100个任务，或提议id查询。可按用户原话when（如明天）、keywords、pendingOnly筛选；不要换算UTC。宿主固定展示编号，查询不创建任务。',
      parameters: Type.Object({ id: Type.Optional(Type.String()), when: Type.Optional(Type.String()), keywords: Type.Optional(Type.Array(Type.String())), pendingOnly: Type.Optional(Type.Boolean()) }),
      execute: async (_id, args) => result(guard ? guard.taskList(args.id, args.when, args.keywords, args.pendingOnly) : args.id ? tasks.get(args.id) : tasks.list()),
    }),
    defineTool({
      name: 'cancel_task', label: '取消待执行任务', description: '用户说“刚才那个”“明天开会的”“第二个”等取消请求时调用，不要自己编选项或要求UUID。id可省略，宿主会独立查SQLite筛选目标、归属和pending状态，有多个目标时返回可信编号澄清。',
      parameters: Type.Object({ id: Type.Optional(Type.String({ minLength: 1 })) }),
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        return result(guard ? await guard.perform('cancel_task', args, (operation, request) => tasks.withRequest(request,
          () => tasks.cancelFromAgent(operation.args.id), operation), signal) : tasks.cancelFromAgent(args.id ?? ''));
      },
    }),
  ];
}
