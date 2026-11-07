import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Channel, MessageTarget, NotificationTargetFilter, Run, Task } from './contracts.js';
import type { Goal, GoalExecution } from './goal-types.js';
import { ExecutionFailure } from './execution-failure.js';

export interface Notification {
  id: string; runId: string; goalId: string | null; taskId: string | null; ownerId: string; targetJson: string; goalRevision: number;
  text: string; status: 'pending' | 'sending' | 'sent' | 'dead' | 'cancelled'; attempts: number; nextAt: string;
  lastError: string | null; createdAt: string; leaseToken: string | null; leaseUntil: string | null;
  errorKind: string | null; uncertain: number; sentAt: string | null; manualRetries: number;
}

export class GoalNotificationStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T,
    private readonly redact: (value: unknown) => string = String) {
    db.exec(`CREATE TABLE IF NOT EXISTS goal_notifications (
      id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), goalId TEXT REFERENCES goals(id),
      ownerId TEXT NOT NULL, targetJson TEXT NOT NULL CHECK(json_valid(targetJson)), goalRevision INTEGER NOT NULL,
      text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','dead','cancelled')),
      attempts INTEGER NOT NULL, nextAt TEXT NOT NULL, lastError TEXT, createdAt TEXT NOT NULL,
      taskId TEXT REFERENCES tasks(id), leaseToken TEXT, leaseUntil TEXT, errorKind TEXT, uncertain INTEGER NOT NULL DEFAULT 0,
      sentAt TEXT, manualRetries INTEGER NOT NULL DEFAULT 0
    ) STRICT;`);
    if (!db.prepare('PRAGMA table_info(goal_notifications)').all().some(column => column.name === 'taskId')) {
      // 旧外键只允许Goal Run。事务内完整复制后更换表定义，旧ID/状态/重试计数不变。
      this.transaction(() => {
        db.exec(`CREATE TABLE goal_notifications_v2 (
          id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), goalId TEXT REFERENCES goals(id),
          ownerId TEXT NOT NULL, targetJson TEXT NOT NULL CHECK(json_valid(targetJson)), goalRevision INTEGER NOT NULL,
          text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','dead','cancelled')),
          attempts INTEGER NOT NULL, nextAt TEXT NOT NULL, lastError TEXT, createdAt TEXT NOT NULL,
          taskId TEXT REFERENCES tasks(id), leaseToken TEXT, leaseUntil TEXT, errorKind TEXT, uncertain INTEGER NOT NULL DEFAULT 0,
          sentAt TEXT, manualRetries INTEGER NOT NULL DEFAULT 0
        ) STRICT;
        INSERT INTO goal_notifications_v2(id,runId,goalId,ownerId,targetJson,goalRevision,text,status,attempts,nextAt,lastError,createdAt)
          SELECT id,runId,goalId,ownerId,targetJson,goalRevision,text,status,attempts,nextAt,lastError,createdAt FROM goal_notifications;
        DROP TABLE goal_notifications;
        ALTER TABLE goal_notifications_v2 RENAME TO goal_notifications;`);
      });
    }
    db.exec('CREATE INDEX IF NOT EXISTS notifications_due ON goal_notifications(ownerId,status,nextAt)');
  }
  // 只从 Goal 聚合事务调用；提交成功但进程退出，仍有待投递记录。
  enqueue(execution: GoalExecution, goal: Goal, now: string): void {
    if (!this.db.isTransaction) throw new Error('通知必须与执行结果同事务');
    if (execution.input.authorization.kind !== 'policy') return;
    const checkpoint = execution.checkpoint;
    const text = [`目标：${goal.objective}`, `执行：${execution.status}；状态快照：${goal.status}；版本：${goal.revision}`,
      checkpoint ? `本段成果：\n${checkpoint.artifactText}\n进度：${checkpoint.progressSummary}\n后续：${checkpoint.question}` : '本段未成为有效进度；旧Checkpoint保留，请查看目标核实。',
      '此为执行时状态快照，可能延迟或重复送达；批准计划或继续前请查看当前目标。'].join('\n');
    this.db.prepare("INSERT INTO goal_notifications(id,runId,goalId,ownerId,targetJson,goalRevision,text,status,attempts,nextAt,lastError,createdAt) VALUES (?,?,?,?,?,?,?,'pending',0,?,NULL,?) ON CONFLICT(runId) DO NOTHING")
      .run(randomUUID(), execution.runId, goal.id, goal.ownerId, JSON.stringify(goal.target), goal.revision, text, now, now);
  }
  enqueueTask(run: Run, task: Task, now: string): void {
    if (!this.db.isTransaction || run.taskId !== task.id || !['succeeded','failed','interrupted'].includes(run.status)) throw new Error('Task通知必须与执行终态同事务');
    const text = run.status === 'succeeded' ? run.output! : `任务 ${run.status}: ${run.error ?? '执行未完成'}`;
    this.db.prepare(`INSERT INTO goal_notifications(id,runId,goalId,ownerId,targetJson,goalRevision,text,status,attempts,nextAt,createdAt,taskId)
      VALUES (?,?,NULL,'local-user',?,0,?,'pending',0,?,?,?) ON CONFLICT(runId) DO NOTHING`)
      .run(randomUUID(), run.id, JSON.stringify(task.target), text, now, now, task.id);
  }
  recoverInTransaction(now: string): void {
    if (!this.db.isTransaction) throw new Error('通知恢复必须在恢复事务中');
    this.db.prepare("UPDATE goal_notifications SET status=CASE WHEN attempts>=3*(manualRetries+1) THEN 'dead' ELSE 'pending' END,nextAt=?,lastError='发送期间退出；可能已送达',errorKind='process_interrupted',uncertain=1,leaseToken=NULL,leaseUntil=NULL WHERE status='sending'").run(now);
  }
  async deliver(channel: Channel, ownerId: string, target: NotificationTargetFilter, now: string,
    options: { timeoutMs?: number; clock?: () => Date; taskOnly?: boolean } = {}): Promise<{ error?: string } | undefined> {
    // 可投递范围先进入SQL；运行期租约回收也只处理当前宿主和能力范围。
    const scope = "ownerId=? AND json_extract(targetJson,'$.channel')=?"
      + (target.channel === 'web' ? " AND json_extract(targetJson,'$.userId')=?"
        : target.channel === 'feishu' ? " AND json_extract(targetJson,'$.appId')=? AND json_extract(targetJson,'$.userOpenId')=?" : '')
      + (options.taskOnly ? ' AND taskId IS NOT NULL' : '');
    const parameters = [ownerId, target.channel, ...(target.channel === 'web' ? [target.userId]
      : target.channel === 'feishu' ? [target.appId, target.userOpenId] : [])];
    const row = this.transaction(() => {
      this.db.prepare(`UPDATE goal_notifications SET status=CASE WHEN attempts>=3*(manualRetries+1) THEN 'dead' ELSE 'pending' END,
        errorKind='lease_expired',uncertain=1,leaseToken=NULL,leaseUntil=NULL WHERE ${scope} AND status='sending' AND leaseUntil<=?`).run(...parameters, now);
      const item = this.db.prepare(`SELECT * FROM goal_notifications WHERE ${scope} AND status='pending' AND nextAt<=?
        ORDER BY createdAt,id LIMIT 1`).get(...parameters, now);
      if (!item) return undefined;
      if (item.taskId && this.db.prepare('SELECT status FROM tasks WHERE id=?').get(String(item.taskId))?.status === 'cancelled') {
        this.db.prepare("UPDATE goal_notifications SET status='cancelled',lastError='原任务已取消' WHERE id=?").run(String(item.id)); return undefined;
      }
      const token = randomUUID();
      if (this.db.prepare("UPDATE goal_notifications SET status='sending',attempts=attempts+1,leaseToken=?,leaseUntil=? WHERE id=? AND status='pending'")
        .run(token, new Date(Date.parse(now) + Math.max(30000, (options.timeoutMs ?? 10000) + 1000)).toISOString(), String(item.id)).changes !== 1) return undefined;
      return { ...item, leaseToken: token } as unknown as Notification;
    });
    if (!row) return;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([channel.sendMessage({ text: row.text, notificationId: row.id, taskId: row.taskId ?? undefined,
        goalId: row.goalId ?? undefined, runId: row.runId, target: JSON.parse(row.targetJson) as MessageTarget }),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new ExecutionFailure('timeout')), options.timeoutMs ?? 10000); })]);
      this.transaction(() => {
        const at = options.clock?.().toISOString() ?? now;
        if (this.db.prepare("UPDATE goal_notifications SET status='sent',lastError=NULL,sentAt=?,leaseToken=NULL,leaseUntil=NULL WHERE id=? AND status='sending' AND leaseToken=?")
          .run(at, row.id, row.leaseToken).changes !== 1) return;
        this.db.prepare('UPDATE runs SET deliveryError=NULL WHERE id=?').run(row.runId);
        this.db.prepare("INSERT INTO run_events (runId,at,type,details) VALUES (?,?,'delivery_succeeded',?)").run(row.runId, at, JSON.stringify({ notificationId: row.id }));
      });
      return {};
    } catch (error) {
      // 不保存渠道异常中的凭据；有限重试，不重新执行模型。发送成功而确认失败仍可能重复。
      this.transaction(() => {
        const attempts = row.attempts + 1, fault = error instanceof ExecutionFailure ? error : new ExecutionFailure('unknown');
        const detail = this.redact(error instanceof Error ? error.message : String(error));
        const permanent = fault.kind === 'permanent_error', uncertain = fault.kind === 'unknown' || fault.kind === 'timeout';
        const wait = Math.max(30000 * 2 ** ((attempts - 1) % 3), fault.retryAfterMs ?? 0), at = options.clock?.().toISOString() ?? now;
        const changed = this.db.prepare(`UPDATE goal_notifications SET status=?,nextAt=?,lastError=?,errorKind=?,uncertain=max(uncertain,?),
          leaseToken=NULL,leaseUntil=NULL WHERE id=? AND status='sending' AND leaseToken=?`)
          .run(permanent || attempts >= 3 * (row.manualRetries + 1) ? 'dead' : 'pending', new Date(Date.parse(at) + wait).toISOString(), detail,
            fault.kind, uncertain ? 1 : 0, row.id, row.leaseToken).changes;
        if (changed) {
          this.db.prepare('UPDATE runs SET deliveryError=? WHERE id=?').run(detail, row.runId);
          this.db.prepare("INSERT INTO run_events(runId,at,type,details) VALUES (?,?,'delivery_failed',?)")
            .run(row.runId, at, JSON.stringify({ notificationId: row.id, kind: fault.kind, attempts, uncertain }));
        }
      });
      return { error: this.redact(error instanceof Error ? error.message : String(error)) };
    } finally { clearTimeout(timeout); }
  }
  retryDead(id: string, ownerId: string, accepts: (target: MessageTarget) => boolean, now: string): void {
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM goal_notifications WHERE id=? AND ownerId=?').get(id, ownerId) as unknown as Notification | undefined;
      if (!row || !accepts(JSON.parse(row.targetJson) as MessageTarget) || row.status !== 'dead') throw new Error('通知不存在、无权访问或并非dead');
      if (row.taskId && this.db.prepare('SELECT status FROM tasks WHERE id=?').get(row.taskId)?.status === 'cancelled') throw new Error('已取消任务不能重发通知');
      this.db.prepare("UPDATE goal_notifications SET status='pending',nextAt=?,manualRetries=manualRetries+1 WHERE id=?").run(now, id);
      this.db.prepare("INSERT INTO run_events(runId,at,type,details) VALUES (?,?,'notification_manual_retry',?)").run(row.runId, now, id);
    });
  }
  listForHost(): Notification[] { return this.db.prepare('SELECT * FROM goal_notifications ORDER BY createdAt,id').all() as unknown as Notification[]; }
}
