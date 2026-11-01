import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Run, RunStatus } from './contracts.js';
import type { WorkThreadActor } from './work-thread-types.js';
import type { WorkThreadStore } from './work-thread-store.js';
import type { WorkJob } from './work-job-types.js';

export class WorkJobError extends Error {
  constructor(readonly status: 404 | 409, message: string) { super(message); }
}
const columns = 'id,threadId,requestId,instruction,status,runId,createdAt,updatedAt';

export class WorkJobStore {
  constructor(private readonly db: DatabaseSync, private readonly threads: WorkThreadStore,
    private readonly hooks: { transaction<T>(fn: () => T): T; begin(now: string): Run;
      finish(id: string, status: Exclude<RunStatus, 'running'>, now: string, output?: string, error?: string): void }) {
    db.exec(`CREATE TABLE IF NOT EXISTS work_jobs (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, channel TEXT NOT NULL,
      threadId TEXT NOT NULL REFERENCES work_threads(id), requestId TEXT NOT NULL, instruction TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','interrupted','cancelled')),
      runId TEXT UNIQUE REFERENCES runs(id), createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      UNIQUE(owner,channel,requestId)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS work_jobs_queue ON work_jobs(owner,channel,status,createdAt);
    CREATE INDEX IF NOT EXISTS work_jobs_thread ON work_jobs(threadId,createdAt);`);
  }
  get(actor: WorkThreadActor, id: string): WorkJob {
    const row = this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE id=? AND owner=? AND channel=?`)
      .get(id, actor.owner, actor.channel) as unknown as WorkJob | undefined;
    if (!row) throw new WorkJobError(404, '后台工作不存在或无权访问');
    return { ...row };
  }
  list(actor: WorkThreadActor, threadId?: string): WorkJob[] {
    if (threadId) this.threads.get(actor, threadId);
    return this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE owner=? AND channel=?${threadId ? ' AND threadId=?' : ''}
      ORDER BY createdAt DESC,rowid DESC LIMIT 100`).all(actor.owner, actor.channel, ...(threadId ? [threadId] : [])) as unknown as WorkJob[];
  }
  create(actor: WorkThreadActor, threadId: string, requestId: string, instruction: string, now: string): WorkJob {
    return this.hooks.transaction(() => {
      const old = this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE owner=? AND channel=? AND requestId=?`)
        .get(actor.owner, actor.channel, requestId) as unknown as WorkJob | undefined;
      if (old) {
        if (old.threadId !== threadId || old.instruction !== instruction) throw new WorkJobError(409, '此请求 ID 已用于其他内容或主题');
        return { ...old };
      }
      if (this.threads.get(actor, threadId).status !== 'active') throw new WorkJobError(409, '请先恢复主题，再创建后台工作');
      const id = randomUUID();
      this.db.prepare(`INSERT INTO work_jobs VALUES(?,?,?,?,?,?,'queued',NULL,?,?)`)
        .run(id, actor.owner, actor.channel, threadId, requestId, instruction, now, now);
      return this.get(actor, id);
    });
  }
  hasQueued(actor: WorkThreadActor): boolean {
    return !!this.db.prepare("SELECT 1 FROM work_jobs WHERE owner=? AND channel=? AND status='queued' LIMIT 1").get(actor.owner, actor.channel);
  }
  claim(actor: WorkThreadActor, now: string): { job: WorkJob; run: Run } | undefined {
    return this.hooks.transaction(() => {
      const next = this.db.prepare("SELECT id FROM work_jobs WHERE owner=? AND channel=? AND status='queued' ORDER BY createdAt,rowid LIMIT 1")
        .get(actor.owner, actor.channel);
      if (!next) return undefined;
      const run = this.hooks.begin(now);
      this.db.prepare("UPDATE work_jobs SET status='running',runId=?,updatedAt=? WHERE id=? AND status='queued'").run(run.id, now, String(next.id));
      return { job: this.get(actor, String(next.id)), run };
    });
  }
  finish(actor: WorkThreadActor, id: string, runId: string, status: 'succeeded' | 'failed' | 'interrupted', now: string, output?: string, error?: string): boolean {
    return this.hooks.transaction(() => {
      const job = this.get(actor, id);
      // 取消事务已撤销提交资格；迟到结果不能写成功输出，也不能改写技术 Run。
      if (job.status !== 'running' || job.runId !== runId) return false;
      this.hooks.finish(runId, status, now, output, error);
      this.db.prepare('UPDATE work_jobs SET status=?,updatedAt=? WHERE id=?').run(status, now, id);
      return true;
    });
  }
  cancel(actor: WorkThreadActor, id: string, now: string): WorkJob {
    return this.hooks.transaction(() => {
      const job = this.get(actor, id);
      if (job.status !== 'queued' && job.status !== 'running') return job;
      if (job.runId) this.hooks.finish(job.runId, 'interrupted', now, undefined, '用户已取消后台工作；不自动重试');
      this.db.prepare("UPDATE work_jobs SET status='cancelled',updatedAt=? WHERE id=?").run(now, id);
      return this.get(actor, id);
    });
  }
  recoverInTransaction(now: string): void {
    // 技术 Run 已由共同恢复事务结束；排队请求保留，运行中请求不重新领取。
    this.db.prepare("UPDATE work_jobs SET status='interrupted',updatedAt=? WHERE status='running'").run(now);
  }
}
