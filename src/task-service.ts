import { parseTaskTime } from './time.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { MessageTarget, Task } from './contracts.js';
import { SqliteStore } from './sqlite-store.js';

export class TaskService {
  private readonly targets = new AsyncLocalStorage<MessageTarget>();
  constructor(private readonly store: SqliteStore, readonly timeZone: string, private readonly clock = () => new Date()) {}

  // 由可信 Channel 绑定接收目标；工具参数和模型不能选择通知接收人。
  withTarget<T>(target: MessageTarget, action: () => T): T {
    return this.targets.run(target, action);
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
