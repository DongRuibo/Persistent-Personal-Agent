import { parseTaskTime } from './time.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ExecutionRequest, MessageTarget, Task, WriteOperation } from './contracts.js';
import { SqliteStore } from './sqlite-store.js';

export class TaskService {
  private readonly targets = new AsyncLocalStorage<MessageTarget>();
  private readonly requests = new AsyncLocalStorage<{ request: ExecutionRequest; used: boolean; permission?: WriteOperation | null }>();
  constructor(private readonly store: SqliteStore, readonly timeZone: string, private readonly clock = () => new Date()) {}

  // 由可信 Channel 绑定接收目标；工具参数和模型不能选择通知接收人。
  withTarget<T>(target: MessageTarget, action: () => T): T {
    return this.targets.run(target, action);
  }

  withRequest<T>(request: ExecutionRequest, action: () => T, permission?: WriteOperation | null): T {
    return this.requests.run({ request, used: false, permission }, action);
  }

  now(): Date { return this.clock(); }
  visibleTasks(): Task[] { return this.store.tasksForTarget(this.targets.getStore() ?? { channel: 'console' }); }

  private userCommand(): { input: string; context: { request: ExecutionRequest; used: boolean; permission?: WriteOperation | null } } {
    const context = this.requests.getStore();
    context?.request.signal.throwIfAborted();
    if (!context || context.request.scope !== 'chat' || context.used) throw new Error('任务写操作需要本轮用户明确授权；一轮最多执行一次，后台不能写入');
    return { input: context.request.prompt.trim().replace(/^(?:请帮我|帮我|请)/u, ''), context };
  }

  // 仅模型工具使用这些入口；Console 确定性命令仍直接调用 create/cancel。
  createFromAgent(instruction: string, when: string): Task {
    const { input, context } = this.userCommand();
    if (context.permission !== undefined) {
      if (context.permission?.tool !== 'create_task' || context.permission.args.instruction !== instruction || context.permission.args.when !== when) throw new Error('创建参数不在本轮宿主授权范围内');
      const task = this.create(instruction, when); context.used = true; return task;
    }
    const match = /^(?:在)?([^\n]{1,100}?)(?:提醒我|通知我|叫我)[：:，,\s]*([\s\S]+)$/u.exec(input)
      ?? /^创建任务[：:]([^\n]+)\n([\s\S]+)$/u.exec(input);
    if (!match || /[？?]$/u.test(input) || when.trim() !== match[1]!.trim() || instruction.trim() !== match[2]!.trim()) {
      throw new Error('创建任务需要本轮明确命令，且时间、内容须保留原文，例如“1分钟后提醒我喝水”或“创建任务：1分钟后\\n完整任务内容”');
    }
    const task = this.create(instruction, when);
    context.used = true;
    return task;
  }

  cancelFromAgent(id: string): Task {
    const { input, context } = this.userCommand();
    if (context.permission !== undefined) {
      if (context.permission?.tool !== 'cancel_task' || context.permission.args.id !== id || !this.visibleTasks().some((task) => task.id === id)) throw new Error('取消目标不在当前用户授权范围内');
      const task = this.cancel(id); context.used = true; return task;
    }
    const match = /^(?:取消任务|取消)[：:\s]*([a-f0-9-]{36})$/u.exec(input);
    if (!match || match[1] !== id) throw new Error('取消任务需要本轮指定完整 id，例如“取消任务：<id>”');
    const task = this.cancel(id);
    context.used = true;
    return task;
  }

  create(instruction: string, when: string): Task {
    instruction = instruction.trim();
    if (!instruction || instruction.length > 10_000) throw new Error('任务内容需要 1–10000 个字符');
    const now = this.clock();
    return this.store.createTask(instruction, parseTaskTime(when, this.timeZone, now), now.toISOString(), this.targets.getStore());
  }

  list(): Task[] { return this.store.listTasks(); }

  get(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new Error('任务不存在');
    return task;
  }

  cancel(id: string): Task {
    if (!this.store.cancelTask(id, this.clock().toISOString())) {
      throw new Error(`不能取消：${this.store.getTask(id)?.status ?? '任务不存在'}；只能取消 pending 任务`);
    }
    return this.get(id);
  }
}
