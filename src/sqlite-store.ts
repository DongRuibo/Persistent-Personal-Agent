import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { ExecutionObserver, MessageTarget, ModelCall, Run, RunStatus, Task } from './contracts.js';
import { FormationStore } from './formation-store.js';
import { GoalStore } from './goal-store.js';
import { GoalPolicyStore } from './goal-policy-store.js';
import { GoalNotificationStore } from './goal-notification-store.js';
import { WebReadStore } from './web-read-store.js';
import { FileOperationStore } from './file-operation-store.js';
import { WebUiStore } from './web-ui-store.js';
import { WorkThreadStore } from './work-thread-store.js';
import { WorkJobStore } from './work-job-store.js';
import { SourceEventStore } from './source-event-store.js';

export class SqliteStore {
  private readonly db: DatabaseSync;
  readonly formation: FormationStore;
  readonly goals: GoalStore;
  readonly policies: GoalPolicyStore;
  readonly notifications: GoalNotificationStore;
  readonly web: WebReadStore;
  readonly files: FileOperationStore;
  readonly webUi: WebUiStore;
  readonly workThreads: WorkThreadStore;
  readonly workJobs: WorkJobStore;
  readonly sourceEvents: SourceEventStore;

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
    this.formation = new FormationStore(this.db);
    this.goals = new GoalStore(this.db, {
      transaction: fn => this.transaction(fn),
      begin: now => this.beginRunInTransaction(null, now),
      finish: (id, status, now, output, error) => this.finishRunInTransaction(id, status, now, output, error),
      event: (id, type, details, now) => this.event(id, type, details, now),
      redact: value => this.redact(value),
    });
    this.policies = new GoalPolicyStore(this.db, { transaction: fn => this.transaction(fn),
      begin: now => this.beginRunInTransaction(null, now), finish: (id, now) => { this.finishRunInTransaction(id, 'succeeded', now, '宿主策略触发审计，非聊天授权'); } },
    (actor, id) => this.goals.get(actor, id));
    this.notifications = new GoalNotificationStore(this.db, fn => this.transaction(fn));
    this.web = new WebReadStore(this.db, fn => this.transaction(fn));
    this.files = new FileOperationStore(this.db, fn => this.transaction(fn));
    this.webUi = new WebUiStore(this.db, fn => this.transaction(fn), now => this.beginRunInTransaction(null, now));
    this.workThreads = new WorkThreadStore(this.db, fn => this.transaction(fn));
    this.workJobs = new WorkJobStore(this.db, this.workThreads, {
      transaction: fn => this.transaction(fn), begin: now => this.beginRunInTransaction(null, now),
      finish: (id, status, now, output, error) => { this.finishRunInTransaction(id, status, now, output, error); },
    });
    this.sourceEvents = new SourceEventStore(this.db, { transaction: fn => this.transaction(fn),
      begin: now => this.beginRunInTransaction(null, now),
      finish: (id, now) => { this.finishRunInTransaction(id, 'succeeded', now, '用户明确许可固定GitHub只读观察，非执行授权'); },
      event: (id, type, details, now) => this.event(id, type, JSON.stringify(details), now), redact: value => this.redact(value),
    });
    this.goals.web = this.web;
    this.goals.policy = {
      consume: (goal, auth, now) => this.policies.consume(goal, auth, now),
      current: (execution, now) => this.policies.current(execution, now),
      settled: (execution, goal, now) => {
        this.policies.settled(execution, goal, now);
        this.notifications.enqueue(execution, this.goals.get({ ownerId: goal.ownerId, target: goal.target }, goal.id), now);
      },
    };
  }

  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      // COMMIT 错误可能已终止事务；不要用二次 ROLLBACK 错误覆盖原始故障。
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
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
      : target.channel === 'web' ? "json_extract(target, '$.channel') = 'web' AND json_extract(target, '$.userId') = ?"
      : "json_extract(target, '$.channel') = 'feishu' AND json_extract(target, '$.appId') = ? AND json_extract(target, '$.userOpenId') = ? AND json_extract(target, '$.chatId') = ?";
    const params = target.channel === 'console' ? [] : target.channel === 'web' ? [target.userId] : [target.appId, target.userOpenId, target.chatId];
    return this.db.prepare(`SELECT * FROM tasks WHERE ${owner} ORDER BY createdAt DESC, rowid DESC LIMIT 101`).all(...params).map((row) => this.readTask(row)!);
  }

  hasPendingFeishuTasks(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE status = 'pending' AND json_extract(target, '$.channel') = 'feishu' LIMIT 1").get());
  }

  hasForeignTasks(target: MessageTarget): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE status='pending' AND target<>? LIMIT 1").get(JSON.stringify(target)));
  }

  hasPendingWebTasks(): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE status='pending' AND json_extract(target,'$.channel')='web' LIMIT 1").get());
  }

  cancelTask(id: string, now: string): boolean {
    return this.db.prepare("UPDATE tasks SET status = 'cancelled', updatedAt = ? WHERE id = ? AND status = 'pending'")
      .run(now, id).changes === 1;
  }

  beginRun(taskId: string | null, now: string): Run {
    return this.transaction(() => this.beginRunInTransaction(taskId, now));
  }

  private beginRunInTransaction(taskId: string | null, now: string): Run {
    const id = randomUUID();
    this.db.prepare("INSERT INTO runs (id, taskId, status, startedAt) VALUES (?, ?, 'running', ?)").run(id, taskId, now);
    this.event(id, 'run_started', undefined, now);
    return this.getRun(id)!;
  }

  // 收到即持久化去重记录和 Run，随后才安排模型执行。崩溃后不自动重放。
  acceptFeishuMessage(appId: string, messageId: string, now: string): Run | undefined {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM feishu_messages WHERE appId = ? AND messageId = ?').get(appId, messageId)) return undefined;
      const run = this.beginRunInTransaction(null, now);
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
      return { task: { ...task, status: 'running', updatedAt: now }, run: this.beginRunInTransaction(task.id, now) };
    });
  }

  finishRun(id: string, status: Exclude<RunStatus, 'running'>, now: string, output?: string, error?: string, enqueue?: () => void): void {
    this.transaction(() => {
      // Goal和后台工作必须聚合提交，不能走普通聊天/Task 的独立结束入口。
      if (this.db.prepare('SELECT 1 FROM goal_executions WHERE runId=?').get(id)) throw new Error('Goal Run 必须经 GoalStore 聚合提交');
      if (this.db.prepare('SELECT 1 FROM work_jobs WHERE runId=?').get(id)) throw new Error('后台工作 Run 必须经 WorkJobStore 聚合提交');
      const run = this.finishRunInTransaction(id, status, now, output, error);
      if (enqueue && status === 'succeeded' && !run.taskId) {
        // 队列故障只回滚自身，不将已经完成的聊天改成失败；成功时与 Run 原子提交。
        this.db.exec('SAVEPOINT formation_admission');
        try { enqueue(); this.db.exec('RELEASE formation_admission'); }
        catch {
          this.db.exec('ROLLBACK TO formation_admission'); this.db.exec('RELEASE formation_admission');
          this.event(id, 'formation_enqueue_failed', '聊天成功；候选入队失败，未自动重试', now);
        }
      }
    });
  }

  private finishRunInTransaction(id: string, status: Exclude<RunStatus, 'running'>, now: string, output?: string, error?: string): Run {
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
    return run;
  }

  // 只能在主进程获得独占锁后调用，恢复逻辑绝不将运行中任务放回队列。
  recoverInterrupted(now: string): number {
    return this.transaction(() => {
      const runs = this.db.prepare("SELECT id FROM runs WHERE status = 'running'").all();
      for (const run of runs) this.event(String(run.id), 'run_interrupted', '服务在执行完成前退出', now);
      this.db.prepare("UPDATE runs SET status = 'interrupted', finishedAt = ?, error = ? WHERE status = 'running'")
        .run(now, '服务在执行完成前退出；可能已产生副作用，请人工核实');
      this.db.prepare("UPDATE tasks SET status = 'interrupted', updatedAt = ? WHERE status = 'running'").run(now);
      this.workJobs.recoverInTransaction(now);
      this.goals.recoverInTransaction(now);
      this.notifications.recoverInTransaction(now);
      this.web.recoverInTransaction(now);
      this.files.recoverInTransaction();
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
    // 新来源事件是结构化JSON；逐字段脱敏后再序列化，避免凭据样式吃掉闭合引号。
    const stored = details === undefined ? null : type === 'tavily_call' || type === 'source_observation_permitted'
      ? JSON.stringify(JSON.parse(details), (_key, value: unknown) => typeof value === 'string' ? this.redact(value) : value)
      : this.redact(details);
    this.db.prepare('INSERT INTO run_events (runId, at, type, details) VALUES (?, ?, ?, ?)')
      .run(runId, now, type, stored);
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
