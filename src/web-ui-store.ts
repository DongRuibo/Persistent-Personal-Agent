import type { DatabaseSync } from 'node:sqlite';
import type { Run } from './contracts.js';

export type WebRequestRow = { requestId: string; runId: string | null; text: string; mode: 'chat' | 'suggest' | 'policy';
  selectionJson: string; status: 'queued' | 'claimed' | 'cancelled'; createdAt: string; coordinator: number };
export class WebRequestError extends Error {
  constructor(readonly status: 404 | 409 | 429, message: string) { super(message); }
}
const requestColumns = 'requestId,runId,text,mode,selectionJson,status,createdAt,coordinator';

// Web接收、领取与收件箱投影；模型上下文仍由Pi原生Session管理。
export class WebUiStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T,
    private readonly begin: (now: string) => Run) {
    db.exec(`CREATE TABLE IF NOT EXISTS web_ui_chats (
      owner TEXT NOT NULL, requestId TEXT NOT NULL, runId TEXT UNIQUE REFERENCES runs(id), text TEXT NOT NULL,
      mode TEXT NOT NULL DEFAULT 'chat', selectionJson TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'claimed' CHECK(status IN ('queued','claimed','cancelled')),
      createdAt TEXT NOT NULL, coordinator INTEGER NOT NULL DEFAULT 0 CHECK(coordinator IN (0,1)),
      PRIMARY KEY(owner,requestId), CHECK((status='claimed' AND runId IS NOT NULL) OR (status!='claimed' AND runId IS NULL))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS web_ui_inbox (
      owner TEXT NOT NULL, runId TEXT NOT NULL REFERENCES runs(id), text TEXT NOT NULL, at TEXT NOT NULL,
      taskId TEXT, goalId TEXT, viewedAt TEXT, PRIMARY KEY(owner,runId)
    ) STRICT;`);
    const columns = db.prepare('PRAGMA table_info(web_ui_chats)').all();
    if (!columns.some(column => column.name === 'mode')) db.exec("ALTER TABLE web_ui_chats ADD COLUMN mode TEXT NOT NULL DEFAULT 'chat'");
    if (!columns.some(column => column.name === 'selectionJson')) db.exec("ALTER TABLE web_ui_chats ADD COLUMN selectionJson TEXT NOT NULL DEFAULT '{}'");
    if (!columns.some(column => column.name === 'status')) this.transaction(() => {
      // 原表没有下游外键；重建仅放宽runId，旧Run、正文与模式逐字保留。
      db.exec(`CREATE TABLE web_ui_chats_next (
        owner TEXT NOT NULL, requestId TEXT NOT NULL, runId TEXT UNIQUE REFERENCES runs(id), text TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'chat', selectionJson TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL CHECK(status IN ('queued','claimed','cancelled')), createdAt TEXT NOT NULL,
        coordinator INTEGER NOT NULL DEFAULT 0 CHECK(coordinator IN (0,1)), PRIMARY KEY(owner,requestId),
        CHECK((status='claimed' AND runId IS NOT NULL) OR (status!='claimed' AND runId IS NULL))
      ) STRICT;
      INSERT INTO web_ui_chats_next SELECT c.owner,c.requestId,c.runId,c.text,c.mode,c.selectionJson,'claimed',r.startedAt,0
        FROM web_ui_chats c JOIN runs r ON r.id=c.runId;
      DROP TABLE web_ui_chats;
      ALTER TABLE web_ui_chats_next RENAME TO web_ui_chats;`);
    });
  }
  find(owner: string, requestId: string) {
    return this.db.prepare(`SELECT ${requestColumns} FROM web_ui_chats WHERE owner=? AND requestId=?`).get(owner, requestId) as WebRequestRow | undefined;
  }
  coordinatorRequest(owner: string, runId: string): WebRequestRow | undefined {
    return this.db.prepare(`SELECT ${requestColumns} FROM web_ui_chats WHERE owner=? AND runId=? AND coordinator=1`).get(owner, runId) as WebRequestRow | undefined;
  }
  accept(owner: string, requestId: string, text: string, now: string, mode: WebRequestRow['mode'] = 'chat', selectionJson = '{}'): Run {
    return this.transaction(() => {
      const run = this.begin(now);
      this.db.prepare("INSERT INTO web_ui_chats(owner,requestId,runId,text,mode,selectionJson,status,createdAt) VALUES(?,?,?,?,?,?,'claimed',?)").run(owner, requestId, run.id, text, mode, selectionJson, now);
      return run;
    });
  }
  enqueue(owner: string, requestId: string, text: string, now: string): WebRequestRow {
    return this.transaction(() => {
      const old = this.find(owner, requestId);
      // 幂等先于容量；已接收请求的重投永远回读原收据。
      if (old) {
        if (old.mode !== 'chat' || old.selectionJson !== '{}' || old.text !== text || !old.coordinator) throw new WebRequestError(409, '此请求 ID 已用于其他内容或模式');
        return old;
      }
      const waiting = this.db.prepare("SELECT count(*) AS n FROM web_ui_chats WHERE owner=? AND coordinator=1 AND status='queued'").get(owner)!;
      if (Number(waiting.n) >= 8) throw new WebRequestError(429, '已有八条消息等待处理；本条未接收，请保留输入后稍后发送');
      this.db.prepare("INSERT INTO web_ui_chats(owner,requestId,text,mode,selectionJson,status,createdAt,coordinator) VALUES(?,?,?,'chat','{}','queued',?,1)")
        .run(owner, requestId, text, now);
      return this.find(owner, requestId)!;
    });
  }
  claim(owner: string, now: string): WebRequestRow | undefined {
    return this.transaction(() => {
      const next = this.db.prepare("SELECT requestId FROM web_ui_chats WHERE owner=? AND coordinator=1 AND status='queued' ORDER BY createdAt,rowid LIMIT 1").get(owner);
      if (!next) return undefined;
      const run = this.begin(now), requestId = String(next.requestId);
      this.db.prepare("UPDATE web_ui_chats SET status='claimed',runId=? WHERE owner=? AND requestId=? AND status='queued'").run(run.id, owner, requestId);
      return this.find(owner, requestId)!;
    });
  }
  cancelQueued(owner: string, requestId: string): WebRequestRow {
    return this.transaction(() => {
      const row = this.find(owner, requestId);
      if (!row || !row.coordinator) throw new WebRequestError(404, '待处理消息不存在');
      if (row.status === 'claimed') throw new WebRequestError(409, '消息已领取，不能撤回为未处理');
      this.db.prepare("UPDATE web_ui_chats SET status='cancelled' WHERE owner=? AND requestId=? AND status='queued'").run(owner, requestId);
      return this.find(owner, requestId)!;
    });
  }
  requests(owner: string): WebRequestRow[] {
    return this.db.prepare(`SELECT ${requestColumns} FROM web_ui_chats WHERE owner=? AND coordinator=1 ORDER BY createdAt DESC,rowid DESC LIMIT 100`).all(owner) as WebRequestRow[];
  }
  chats(owner: string, mode: WebRequestRow['mode'] = 'chat') {
    return this.db.prepare(`SELECT ${requestColumns} FROM web_ui_chats
      WHERE owner=? AND mode=? AND runId IS NOT NULL ORDER BY createdAt DESC,rowid DESC LIMIT 100`).all(owner, mode) as (WebRequestRow & { runId: string })[];
  }
  requestMode(owner: string, runId: string): WebRequestRow['mode'] | undefined {
    return this.db.prepare('SELECT mode FROM web_ui_chats WHERE owner=? AND runId=?').get(owner, runId)?.mode as WebRequestRow['mode'] | undefined;
  }
  ownsRun(owner: string, target: string, id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM runs r WHERE r.id=? AND (
      EXISTS(SELECT 1 FROM web_ui_chats c WHERE c.owner=? AND c.runId=r.id) OR
      EXISTS(SELECT 1 FROM tasks t WHERE t.id=r.taskId AND t.target=?) OR
      EXISTS(SELECT 1 FROM work_jobs j WHERE j.owner=? AND j.channel=? AND j.runId=r.id) OR
      EXISTS(SELECT 1 FROM goal_executions e JOIN goals g ON g.id=e.goalId WHERE e.runId=r.id AND g.ownerId='local-user' AND g.targetJson=?))`)
      .get(id, owner, target, owner, target, target);
  }
  // Recall仅取状态元数据；沿原归属证明，不读取成果、错误或模型记录。
  runMetadata(owner: string, target: string, id: string) {
    if (!this.ownsRun(owner, target, id)) return null;
    return this.db.prepare('SELECT id,taskId,status,startedAt,finishedAt FROM runs WHERE id=?').get(id) as unknown as
      { id: string; taskId: string | null; status: string; startedAt: string; finishedAt: string | null };
  }
  taskRunId(target: string, taskId: string): string | null {
    const row = this.db.prepare('SELECT r.id FROM runs r JOIN tasks t ON t.id=r.taskId WHERE t.id=? AND t.target=?').get(taskId, target);
    return row ? String(row.id) : null;
  }
  recallRun(owner: string, target: string, id: string) {
    if (!this.ownsRun(owner, target, id)) return { kind: 'unavailable' as const };
    const fileOperationId = this.fileForRun(owner, target, id);
    if (fileOperationId) return { kind: 'file' as const, fileOperationId };
    // 普通成果只读有限字符前缀与原字节数；文件路径不会进入此查询。
    const row = this.db.prepare(`SELECT status,finishedAt,
      CASE WHEN status='succeeded' THEN substr(output,1,4096) ELSE NULL END AS output,
      CASE WHEN status='succeeded' THEN length(CAST(output AS BLOB)) ELSE 0 END AS originalBytes FROM runs WHERE id=?`).get(id)!;
    return { kind: 'run' as const, status: String(row.status), finishedAt: row.finishedAt as string | null,
      output: row.output as string | null, originalBytes: Number(row.originalBytes ?? 0) };
  }
  runs(owner: string, target: string): string[] {
    return this.db.prepare(`SELECT r.id FROM runs r WHERE
      EXISTS(SELECT 1 FROM web_ui_chats c WHERE c.owner=? AND c.runId=r.id) OR
      EXISTS(SELECT 1 FROM tasks t WHERE t.id=r.taskId AND t.target=?) OR
      EXISTS(SELECT 1 FROM work_jobs j WHERE j.owner=? AND j.channel=? AND j.runId=r.id) OR
      EXISTS(SELECT 1 FROM goal_executions e JOIN goals g ON g.id=e.goalId WHERE e.runId=r.id AND g.ownerId='local-user' AND g.targetJson=?)
      ORDER BY r.startedAt DESC,r.rowid DESC LIMIT 100`).all(owner, target, owner, target, target).map(row => String(row.id));
  }
  fileIds(owner: string, target: string): string[] {
    return this.db.prepare('SELECT id FROM file_operations WHERE owner=? AND channel=? ORDER BY rowid DESC LIMIT 60')
      .all(owner, target).map(row => String(row.id));
  }
  fileForRun(owner: string, target: string, runId: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM file_operations WHERE owner=? AND channel=? AND runId=?').get(owner, target, runId);
    return row ? String(row.id) : undefined;
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
