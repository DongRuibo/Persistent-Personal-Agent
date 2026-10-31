import type { DatabaseSync } from 'node:sqlite';

import type { WorkObjectKind, WorkThreadActor, WorkThread, WorkLink } from './work-thread-types.js';

export class WorkThreadError extends Error {
  constructor(readonly status: 404 | 409, message: string) { super(message); }
}

// 只保存组织关系；原对象的正文、状态、权限与执行记录仍由原服务管理。
export class WorkThreadStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T) {
    db.exec(`CREATE TABLE IF NOT EXISTS work_threads (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, channel TEXT NOT NULL, title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','archived')), createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
    ) STRICT;
    CREATE INDEX IF NOT EXISTS work_threads_owner ON work_threads(owner,channel,updatedAt);
    CREATE TABLE IF NOT EXISTS work_links (
      threadId TEXT NOT NULL REFERENCES work_threads(id), kind TEXT NOT NULL CHECK(kind IN ('goal','task','run','memory')),
      objectId TEXT NOT NULL, source TEXT NOT NULL CHECK(source='user'), createdAt TEXT NOT NULL,
      PRIMARY KEY(threadId,kind,objectId)
    ) STRICT;`);
  }
  get(actor: WorkThreadActor, id: string): WorkThread {
    const row = this.db.prepare('SELECT id,title,status,createdAt,updatedAt FROM work_threads WHERE id=? AND owner=? AND channel=?')
      .get(id, actor.owner, actor.channel) as WorkThread | undefined;
    if (!row) throw new WorkThreadError(404, '工作主题不存在或无权访问');
    return { ...row };
  }
  list(actor: WorkThreadActor): WorkThread[] {
    return this.db.prepare('SELECT id,title,status,createdAt,updatedAt FROM work_threads WHERE owner=? AND channel=? ORDER BY updatedAt DESC,id')
      .all(actor.owner, actor.channel).map(row => ({ ...row } as unknown as WorkThread));
  }
  create(actor: WorkThreadActor, id: string, title: string, now: string): WorkThread {
    return this.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM work_threads WHERE id=?').get(id)) {
        const old = this.get(actor, id);
        if (old.title !== title) throw new WorkThreadError(409, '此主题 ID 已用于其他名称');
        return old;
      }
      if (this.list(actor).length >= 100) throw new WorkThreadError(409, '当前工作空间最多保留100个主题');
      this.db.prepare("INSERT INTO work_threads VALUES(?,?,?,?,'active',?,?)").run(id, actor.owner, actor.channel, title, now, now);
      return this.get(actor, id);
    });
  }
  update(actor: WorkThreadActor, id: string, change: { title?: string; status?: WorkThread['status'] }, now: string): WorkThread {
    const old = this.get(actor, id);
    this.db.prepare('UPDATE work_threads SET title=?,status=?,updatedAt=? WHERE id=?')
      .run(change.title ?? old.title, change.status ?? old.status, now, id);
    return this.get(actor, id);
  }
  links(actor: WorkThreadActor, id: string): WorkLink[] {
    this.get(actor, id);
    return this.db.prepare('SELECT kind,objectId,source,createdAt FROM work_links WHERE threadId=? ORDER BY createdAt,kind,objectId')
      .all(id).map(row => ({ ...row } as unknown as WorkLink));
  }
  link(actor: WorkThreadActor, id: string, kind: WorkObjectKind, objectId: string, now: string): void {
    this.transaction(() => {
      const thread = this.get(actor, id);
      if (thread.status === 'archived') throw new WorkThreadError(409, '请先恢复主题，再添加关联');
      if (this.db.prepare('SELECT 1 FROM work_links WHERE threadId=? AND kind=? AND objectId=?').get(id, kind, objectId)) return;
      if (Number(this.db.prepare('SELECT count(*) AS n FROM work_links WHERE threadId=?').get(id)!.n) >= 100) {
        throw new WorkThreadError(409, '每个主题最多保留100条关联，请先移除不再需要的关系');
      }
      this.db.prepare("INSERT INTO work_links VALUES(?,?,?,'user',?)").run(id, kind, objectId, now);
      this.db.prepare('UPDATE work_threads SET updatedAt=? WHERE id=?').run(now, id);
    });
  }
  unlink(actor: WorkThreadActor, id: string, kind: WorkObjectKind, objectId: string, now: string): void {
    this.transaction(() => {
      this.get(actor, id);
      const result = this.db.prepare('DELETE FROM work_links WHERE threadId=? AND kind=? AND objectId=?').run(id, kind, objectId);
      if (result.changes) this.db.prepare('UPDATE work_threads SET updatedAt=? WHERE id=?').run(now, id);
    });
  }
}
