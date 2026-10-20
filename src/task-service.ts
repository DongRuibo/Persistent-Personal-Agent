import { parseTaskTime } from './time.js';
import type { Task } from './contracts.js';
import { SqliteStore } from './sqlite-store.js';

export class TaskService {
  constructor(private readonly store: SqliteStore, readonly timeZone: string, private readonly clock = () => new Date()) {}

  create(instruction: string, when: string): Task {
    instruction = instruction.trim();
    if (!instruction || instruction.length > 10_000) throw new Error('任务内容需要 1–10000 个字符');
    const now = this.clock();
    return this.store.createTask(instruction, parseTaskTime(when, this.timeZone, now), now.toISOString());
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
