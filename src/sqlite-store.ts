import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ExecutionObserver, MessageTarget, ModelCall, Run, RunStatus, Task } from './contracts.js';

export class SqliteStore {
  private readonly db: DatabaseSync;

  constructor(path: string, private readonly redact: (value: unknown) => string = String) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY, instruction TEXT NOT NULL, dueAt TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','interrupted','cancelled')),
        createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS tasks_due ON tasks(status, dueAt);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, taskId TEXT UNIQUE REFERENCES tasks(id),
        status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed','interrupted')),
        startedAt TEXT NOT NULL, finishedAt TEXT, output TEXT, error TEXT, deliveryError TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS model_calls (
        id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id),
        at TEXT NOT NULL, details TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS run_events (
        id INTEGER PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id),
        at TEXT NOT NULL, type TEXT NOT NULL, details TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS feishu_messages (
        appId TEXT NOT NULL, messageId TEXT NOT NULL, runId TEXT NOT NULL REFERENCES runs(id),
        PRIMARY KEY (appId, messageId)
      ) STRICT;
    `);
    // 兼容已有 V0 数据库：增量加列，旧任务继续投递到 Console。
    if (!this.db.prepare('PRAGMA table_info(tasks)').all().some((column) => column.name === 'target')) {
      this.db.exec(`ALTER TABLE tasks ADD COLUMN target TEXT NOT NULL DEFAULT '{"channel":"console"}'`);
    }
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private readTask(row: Record<string, unknown> | undefined): Task | undefined {
    if (!row) return undefined;
    return { ...row, target: JSON.parse(String(row.target)) as MessageTarget } as unknown as Task;
  }

  createTask(instruction: string, dueAt: string, now: string, target: MessageTarget = { channel: 'console' }): Task {
    const task: Task = { id: randomUUID(), instruction: this.redact(instruction), dueAt, status: 'pending', createdAt: now, updatedAt: now, target };
    this.db.prepare('INSERT INTO tasks (id, instruction, dueAt, status, createdAt, updatedAt, target) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(task.id, task.instruction, task.dueAt, task.status, now, now, JSON.stringify(target));
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.readTask(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id));
  }

  listTasks(): Task[] {
    return this.db.prepare('SELECT * FROM tasks ORDER BY dueAt, id LIMIT 100').all().map((row) => this.readTask(row)!);
  }

  tasksForTarget(target: MessageTarget): Task[] {
    const owner = target.channel === 'console' ? "json_extract(target, '$.channel') = 'console'"
      : "json_extract(target, '$.channel') = 'feishu' AND json_extract(target, '$.appId') = ? AND json_extract(target, '$.userOpenId') = ? AND json_extract(target, '$.chatId') = ?";
    const params = target.channel === 'console' ? [] : [target.appId, target.userOpenId, target.chatId];
    return this.db.prepare(`SELECT * FROM tasks WHERE ${owner} ORDER BY createdAt DESC, rowid DESC LIMIT 101`).all(...params).map((row) => this.readTask(row)!);
  }

  hasPendingFeishuTasks(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE status = 'pending' AND json_extract(target, '$.channel') = 'feishu' LIMIT 1").get());
  }

  cancelTask(id: string, now: string): boolean {
    return this.db.prepare("UPDATE tasks SET status = 'cancelled', updatedAt = ? WHERE id = ? AND status = 'pending'")
      .run(now, id).changes === 1;
  }

  beginRun(taskId: string | null, now: string): Run {
    const id = randomUUID();
    this.db.prepare("INSERT INTO runs (id, taskId, status, startedAt) VALUES (?, ?, 'running', ?)").run(id, taskId, now);
    this.event(id, 'run_started', undefined, now);
    return this.getRun(id)!;
  }

  // 收到即持久化去重记录和 Run，随后才安排模型执行。崩溃后不自动重放。
  acceptFeishuMessage(appId: string, messageId: string, now: string): Run | undefined {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM feishu_messages WHERE appId = ? AND messageId = ?').get(appId, messageId)) return undefined;
      const run = this.beginRun(null, now);
      this.db.prepare('INSERT INTO feishu_messages VALUES (?, ?, ?)').run(appId, messageId, run.id);
      return run;
    });
  }

  hasDueTasks(now: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE status = 'pending' AND dueAt <= ? LIMIT 1").get(now));
  }

  // 领取与执行记录在同一事务提交；UNIQUE(taskId) 是一次性执行的第二道约束。
  claimDue(now: string): { task: Task; run: Run } | undefined {
    return this.transaction(() => {
      const task = this.readTask(this.db.prepare("SELECT * FROM tasks WHERE status = 'pending' AND dueAt <= ? ORDER BY dueAt, id LIMIT 1")
        .get(now));
      if (!task) return undefined;
      const changed = this.db.prepare("UPDATE tasks SET status = 'running', updatedAt = ? WHERE id = ? AND status = 'pending'")
        .run(now, task.id).changes;
      if (changed !== 1) return undefined;
      return { task: { ...task, status: 'running', updatedAt: now }, run: this.beginRun(task.id, now) };
    });
  }

  finishRun(id: string, status: Exclude<RunStatus, 'running'>, now: string, output?: string, error?: string): void {
    this.transaction(() => {
      const run = this.getRun(id);
      if (!run || run.status !== 'running') throw new Error('执行记录已结束或不存在');
      this.db.prepare('UPDATE runs SET status = ?, finishedAt = ?, output = ?, error = ? WHERE id = ?')
        .run(status, now, output === undefined ? null : this.redact(output), error === undefined ? null : this.redact(error), id);
      if (run.taskId) {
        const result = this.db.prepare("UPDATE tasks SET status = ?, updatedAt = ? WHERE id = ? AND status = 'running'")
          .run(status, now, run.taskId);
        if (result.changes !== 1) throw new Error('任务状态与执行记录不一致');
      }
      this.event(id, `run_${status}`, error, now);
    });
  }

  // 只能在主进程获得独占锁后调用，恢复逻辑绝不将运行中任务放回队列。
  recoverInterrupted(now: string): number {
    return this.transaction(() => {
      const runs = this.db.prepare("SELECT id FROM runs WHERE status = 'running'").all();
      for (const run of runs) this.event(String(run.id), 'run_interrupted', '服务在执行完成前退出', now);
      this.db.prepare("UPDATE runs SET status = 'interrupted', finishedAt = ?, error = ? WHERE status = 'running'")
        .run(now, '服务在执行完成前退出；可能已产生副作用，请人工核实');
      this.db.prepare("UPDATE tasks SET status = 'interrupted', updatedAt = ? WHERE status = 'running'").run(now);
      return runs.length;
    });
  }

  getRun(id: string): Run | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as unknown as Run | undefined;
  }

  listRuns(taskId?: string): Run[] {
    return (taskId
      ? this.db.prepare('SELECT * FROM runs WHERE taskId = ? ORDER BY startedAt DESC LIMIT 100').all(taskId)
      : this.db.prepare('SELECT * FROM runs ORDER BY startedAt DESC LIMIT 100').all()) as unknown as Run[];
  }

  event(runId: string, type: string, details?: string, now = new Date().toISOString()): void {
    this.db.prepare('INSERT INTO run_events (runId, at, type, details) VALUES (?, ?, ?, ?)')
      .run(runId, now, type, details === undefined ? null : this.redact(details));
  }

  observer(runId: string): ExecutionObserver {
    return {
      event: (type, details) => this.event(runId, type, details),
      modelCall: (call) => {
        const safe = { ...call, error: call.error === undefined ? undefined : this.redact(call.error) };
        this.db.prepare('INSERT INTO model_calls (runId, at, details) VALUES (?, ?, ?)')
          .run(runId, new Date().toISOString(), JSON.stringify(safe));
      },
    };
  }

  modelCalls(runId: string): ModelCall[] {
    return this.db.prepare('SELECT details FROM model_calls WHERE runId = ? ORDER BY id').all(runId)
      .map((row) => JSON.parse(String(row.details)) as ModelCall);
  }

  events(runId: string): { type: string; details: string | null }[] {
    return this.db.prepare('SELECT type, details FROM run_events WHERE runId = ? ORDER BY id').all(runId) as unknown as { type: string; details: string | null }[];
  }

  deliveryFailed(runId: string, error: string): void {
    this.transaction(() => {
      this.db.prepare('UPDATE runs SET deliveryError = ? WHERE id = ?').run(this.redact(error), runId);
      this.event(runId, 'delivery_failed', error);
    });
  }

  close(): void { this.db.close(); }
}
