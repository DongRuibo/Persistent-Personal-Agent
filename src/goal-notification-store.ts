import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Channel, MessageTarget } from './contracts.js';
import type { Goal, GoalExecution } from './goal-types.js';

export class GoalNotificationStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T) {
    db.exec(`CREATE TABLE IF NOT EXISTS goal_notifications (
      id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES goal_executions(runId), goalId TEXT NOT NULL REFERENCES goals(id),
      ownerId TEXT NOT NULL, targetJson TEXT NOT NULL CHECK(json_valid(targetJson)), goalRevision INTEGER NOT NULL,
      text TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','dead')),
      attempts INTEGER NOT NULL, nextAt TEXT NOT NULL, lastError TEXT, createdAt TEXT NOT NULL
    ) STRICT;`);
  }
  // 只从 Goal 聚合事务调用；提交成功但进程退出，仍有待投递记录。
  enqueue(execution: GoalExecution, goal: Goal, now: string): void {
    if (!this.db.isTransaction) throw new Error('通知必须与执行结果同事务');
    if (execution.input.authorization.kind !== 'policy') return;
    const checkpoint = execution.checkpoint;
    const text = [`目标：${goal.objective}`, `执行：${execution.status}；状态快照：${goal.status}；版本：${goal.revision}`,
      checkpoint ? `本段成果：\n${checkpoint.artifactText}\n进度：${checkpoint.progressSummary}\n后续：${checkpoint.question}` : '本段未成为有效进度；旧Checkpoint保留，请查看目标核实。',
      '此为执行时状态快照，可能延迟或重复送达；批准计划或继续前请查看当前目标。'].join('\n');
    this.db.prepare("INSERT INTO goal_notifications VALUES (?,?,?,?,?,?,?,'pending',0,?,NULL,?) ON CONFLICT(runId) DO NOTHING")
      .run(randomUUID(), execution.runId, goal.id, goal.ownerId, JSON.stringify(goal.target), goal.revision, text, now, now);
  }
  recoverInTransaction(now: string): void {
    if (!this.db.isTransaction) throw new Error('通知恢复必须在恢复事务中');
    this.db.prepare("UPDATE goal_notifications SET status=CASE WHEN attempts>=3 THEN 'dead' ELSE 'pending' END,nextAt=?,lastError='发送期间退出；可能已送达' WHERE status='sending'").run(now);
  }
  async deliver(channel: Channel, ownerId: string, accepts: (target: MessageTarget) => boolean, now: string): Promise<void> {
    const row = this.transaction(() => {
      const candidates = this.db.prepare("SELECT * FROM goal_notifications WHERE ownerId=? AND status='pending' AND nextAt<=? ORDER BY createdAt,id LIMIT 100").all(ownerId, now);
      const item = candidates.find(item => accepts(JSON.parse(String(item.targetJson)) as MessageTarget));
      if (!item) return undefined;
      if (this.db.prepare("UPDATE goal_notifications SET status='sending',attempts=attempts+1 WHERE id=? AND status='pending'").run(String(item.id)).changes !== 1) return undefined;
      return item;
    });
    if (!row) return;
    try {
      await channel.sendMessage({ text: String(row.text), goalId: String(row.goalId), runId: String(row.runId), target: JSON.parse(String(row.targetJson)) as MessageTarget });
      this.transaction(() => {
        this.db.prepare("UPDATE goal_notifications SET status='sent',lastError=NULL WHERE id=? AND status='sending'").run(String(row.id));
        this.db.prepare("INSERT INTO run_events (runId,at,type,details) VALUES (?,?,'delivery_succeeded',?)").run(String(row.runId), now, JSON.stringify({ notificationId: row.id }));
      });
    } catch {
      // 不保存渠道异常中的凭据；有限重试，不重新执行模型。发送成功而确认失败仍可能重复。
      this.transaction(() => {
        const attempts = Number(row.attempts) + 1;
        this.db.prepare("UPDATE goal_notifications SET status=?,nextAt=?,lastError='通知发送或确认失败；不重跑模型' WHERE id=? AND status='sending'")
          .run(attempts >= 3 ? 'dead' : 'pending', new Date(Date.parse(now) + 30000 * 2 ** (attempts - 1)).toISOString(), String(row.id));
      });
    }
  }
  listForHost(): unknown[] { return this.db.prepare('SELECT * FROM goal_notifications ORDER BY createdAt,id').all(); }
}
