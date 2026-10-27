import type { DatabaseSync } from 'node:sqlite';
import type { Run } from './contracts.js';

// 仅为 Web 展示和收件箱投影；模型上下文仍由 Pi 原生 Session 管理。
export class WebUiStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T,
    private readonly begin: (now: string) => Run) {
    db.exec(`CREATE TABLE IF NOT EXISTS web_ui_chats (
      owner TEXT NOT NULL, requestId TEXT NOT NULL, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), text TEXT NOT NULL,
      PRIMARY KEY(owner,requestId)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS web_ui_inbox (
      owner TEXT NOT NULL, runId TEXT NOT NULL REFERENCES runs(id), text TEXT NOT NULL, at TEXT NOT NULL,
      taskId TEXT, goalId TEXT, viewedAt TEXT, PRIMARY KEY(owner,runId)
    ) STRICT;`);
  }
  find(owner: string, requestId: string) {
    return this.db.prepare('SELECT requestId,runId,text FROM web_ui_chats WHERE owner=? AND requestId=?').get(owner, requestId) as
      { requestId: string; runId: string; text: string } | undefined;
  }
  accept(owner: string, requestId: string, text: string, now: string): Run {
    return this.transaction(() => {
      const run = this.begin(now);
      this.db.prepare('INSERT INTO web_ui_chats VALUES(?,?,?,?)').run(owner, requestId, run.id, text);
      return run;
    });
  }
  chats(owner: string) {
    return this.db.prepare(`SELECT c.requestId,c.runId,c.text FROM web_ui_chats c JOIN runs r ON r.id=c.runId
      WHERE c.owner=? ORDER BY r.startedAt DESC,c.rowid DESC LIMIT 100`).all(owner) as { requestId: string; runId: string; text: string }[];
  }
  ownsRun(owner: string, target: string, id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM runs r WHERE r.id=? AND (
      EXISTS(SELECT 1 FROM web_ui_chats c WHERE c.owner=? AND c.runId=r.id) OR
      EXISTS(SELECT 1 FROM tasks t WHERE t.id=r.taskId AND t.target=?) OR
      EXISTS(SELECT 1 FROM goal_executions e JOIN goals g ON g.id=e.goalId WHERE e.runId=r.id AND g.ownerId='local-user' AND g.targetJson=?))`)
      .get(id, owner, target, target);
  }
  runs(owner: string, target: string): string[] {
    return this.db.prepare(`SELECT r.id FROM runs r WHERE
      EXISTS(SELECT 1 FROM web_ui_chats c WHERE c.owner=? AND c.runId=r.id) OR
      EXISTS(SELECT 1 FROM tasks t WHERE t.id=r.taskId AND t.target=?) OR
      EXISTS(SELECT 1 FROM goal_executions e JOIN goals g ON g.id=e.goalId WHERE e.runId=r.id AND g.ownerId='local-user' AND g.targetJson=?)
      ORDER BY r.startedAt DESC,r.rowid DESC LIMIT 100`).all(owner, target, target).map(row => String(row.id));
  }
  fileIds(owner: string, target: string): string[] {
    return this.db.prepare('SELECT id FROM file_operations WHERE owner=? AND channel=? ORDER BY rowid DESC LIMIT 60')
      .all(owner, target).map(row => String(row.id));
  }
  taskResult(target: string, id: string): string | null {
    const row = this.db.prepare('SELECT r.output,r.error FROM runs r JOIN tasks t ON t.id=r.taskId WHERE t.id=? AND t.target=?').get(id, target);
    return row?.output ? String(row.output).slice(0, 32768) : row?.error ? '任务失败或中断；请查看活动中的执行状态。' : null;
  }
  putNotice(owner: string, runId: string, text: string, taskId?: string, goalId?: string): void {
    this.db.prepare('INSERT OR IGNORE INTO web_ui_inbox(owner,runId,text,at,taskId,goalId) VALUES(?,?,?,?,?,?)')
      .run(owner, runId, text.slice(0, 32768), new Date().toISOString(), taskId ?? null, goalId ?? null);
  }
  inbox(owner: string) {
    return this.db.prepare('SELECT runId,text,at,viewedAt,taskId,goalId FROM web_ui_inbox WHERE owner=? ORDER BY at DESC,rowid DESC LIMIT 100')
      .all(owner) as { runId: string; text: string; at: string; viewedAt: string | null; taskId: string | null; goalId: string | null }[];
  }
  viewNotice(owner: string, id: string): void {
    this.db.prepare('UPDATE web_ui_inbox SET viewedAt=COALESCE(viewedAt,?) WHERE owner=? AND runId=?')
      .run(new Date().toISOString(), owner, id);
  }
}
