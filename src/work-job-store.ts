import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Run, RunStatus } from './contracts.js';
import type { WorkThreadActor } from './work-thread-types.js';
import type { WorkThreadStore } from './work-thread-store.js';
import type { WorkJob } from './work-job-types.js';

export class WorkJobError extends Error {
  constructor(readonly status: 404 | 409, message: string) { super(message); }
}
const columns = 'id,threadId,requestId,instruction,status,runId,createdAt,updatedAt,COALESCE(rootJobId,id) AS rootJobId,previousJobId,sourceItemId,inputReferencesJson,inputHash';
type JobRow = Omit<WorkJob, 'inputReferences'> & { inputReferencesJson: string | null };
function readJob({ inputReferencesJson, ...row }: JobRow): WorkJob {
  return { ...row, inputReferences: inputReferencesJson ? JSON.parse(inputReferencesJson) as WorkJob['inputReferences'] : null };
}

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
    const existing = db.prepare('PRAGMA table_info(work_jobs)').all();
    for (const [name, type] of [['rootJobId', 'TEXT REFERENCES work_jobs(id)'], ['previousJobId', 'TEXT REFERENCES work_jobs(id)'],
      ['sourceItemId', 'TEXT REFERENCES web_request_items(itemId)'], ['inputReferencesJson', 'TEXT'], ['inputHash', 'TEXT']]) {
      if (!existing.some(column => column.name === name)) db.exec(`ALTER TABLE work_jobs ADD COLUMN ${name} ${type}`);
    }
  }
  get(actor: WorkThreadActor, id: string): WorkJob {
    const row = this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE id=? AND owner=? AND channel=?`)
      .get(id, actor.owner, actor.channel) as unknown as JobRow | undefined;
    if (!row) throw new WorkJobError(404, '后台工作不存在或无权访问');
    return readJob(row);
  }
  findRequest(actor: WorkThreadActor, requestId: string): WorkJob | undefined {
    const row = this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE owner=? AND channel=? AND requestId=?`)
      .get(actor.owner, actor.channel, requestId) as unknown as JobRow | undefined;
    return row ? readJob(row) : undefined;
  }
  list(actor: WorkThreadActor, threadId?: string): WorkJob[] {
    if (threadId) this.threads.get(actor, threadId);
    const rows = this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE owner=? AND channel=?${threadId ? ' AND threadId=?' : ''}
      ORDER BY createdAt DESC,rowid DESC LIMIT 100`).all(actor.owner, actor.channel, ...(threadId ? [threadId] : [])) as unknown as JobRow[];
    return rows.map(readJob);
  }
  // 明确名称查询整个拥有范围，返回21项以辨认超限；不截取最近100次执行。
  locate(actor: WorkThreadActor, keywords: string[], text?: string): WorkJob[] {
    const clause = text !== undefined ? '(instr(?,t.title)>0 OR instr(?,r.id)>0 OR EXISTS(SELECT 1 FROM work_jobs v WHERE COALESCE(v.rootJobId,v.id)=r.id AND instr(?,v.id)>0))'
      : keywords.map(() => '(instr(r.instruction,?)>0 OR instr(t.title,?)>0 OR instr(r.id,?)>0 OR EXISTS(SELECT 1 FROM work_jobs v WHERE COALESCE(v.rootJobId,v.id)=r.id AND instr(v.id,?)>0))').join(' AND ');
    if (!clause) return [];
    const ids = this.db.prepare(`SELECT j.id FROM work_jobs j JOIN work_jobs r ON r.id=COALESCE(j.rootJobId,j.id)
      JOIN work_threads t ON t.id=r.threadId WHERE j.owner=? AND j.channel=? AND r.owner=j.owner AND r.channel=j.channel
      AND NOT EXISTS(SELECT 1 FROM work_jobs n WHERE n.owner=j.owner AND n.channel=j.channel
        AND COALESCE(n.rootJobId,n.id)=r.id AND n.rowid>j.rowid) AND ${clause} ORDER BY r.rowid LIMIT 21`)
      .all(actor.owner, actor.channel, ...(text !== undefined ? [text, text, text] : keywords.flatMap(k => [k,k,k,k])));
    return ids.map(row => this.get(actor, String(row.id)));
  }
  latest(actor: WorkThreadActor, rootId: string): WorkJob {
    const root = this.get(actor, rootId);
    const row = this.db.prepare('SELECT id FROM work_jobs WHERE owner=? AND channel=? AND COALESCE(rootJobId,id)=? ORDER BY rowid DESC LIMIT 1')
      .get(actor.owner, actor.channel, root.rootJobId)!;
    return this.get(actor, String(row.id));
  }
  chain(actor: WorkThreadActor, rootId: string): WorkJob[] {
    const root = this.get(actor, rootId);
    return this.db.prepare('SELECT id FROM work_jobs WHERE owner=? AND channel=? AND COALESCE(rootJobId,id)=? ORDER BY rowid')
      .all(actor.owner, actor.channel, root.rootJobId).map(row => this.get(actor, String(row.id)));
  }
  nextQueued(actor: WorkThreadActor): WorkJob | undefined {
    const row = this.db.prepare("SELECT id FROM work_jobs WHERE owner=? AND channel=? AND status='queued' ORDER BY createdAt,rowid LIMIT 1")
      .get(actor.owner, actor.channel);
    return row ? this.get(actor, String(row.id)) : undefined;
  }
  create(actor: WorkThreadActor, threadId: string, requestId: string, instruction: string, now: string): WorkJob {
    return this.hooks.transaction(() => this.createInTransaction(actor, threadId, requestId, instruction, now));
  }
  createInTransaction(actor: WorkThreadActor, threadId: string, requestId: string, instruction: string, now: string, input?: Pick<WorkJob, 'sourceItemId' | 'inputReferences' | 'inputHash'> & Partial<Pick<WorkJob, 'rootJobId' | 'previousJobId'>>): WorkJob {
    const old = this.db.prepare(`SELECT ${columns} FROM work_jobs WHERE owner=? AND channel=? AND requestId=?`)
      .get(actor.owner, actor.channel, requestId) as unknown as JobRow | undefined;
    if (old) {
      if (old.threadId !== threadId || old.instruction !== instruction) throw new WorkJobError(409, '此请求 ID 已用于其他内容或主题');
      return readJob(old);
    }
    if (this.threads.get(actor, threadId).status !== 'active') throw new WorkJobError(409, '请先恢复主题，再创建后台工作');
    const id = randomUUID();
    this.db.prepare(`INSERT INTO work_jobs(id,owner,channel,threadId,requestId,instruction,status,runId,createdAt,updatedAt,rootJobId,sourceItemId,inputReferencesJson,inputHash,previousJobId) VALUES(?,?,?,?,?,?,'queued',NULL,?,?,?,?,?,?,?)`)
      .run(id, actor.owner, actor.channel, threadId, requestId, instruction, now, now, input?.rootJobId ?? id, input?.sourceItemId ?? null, input?.inputReferences ? JSON.stringify(input.inputReferences) : null, input?.inputHash ?? null, input?.previousJobId ?? null);
    return this.get(actor, id);
  }
  hasQueued(actor: WorkThreadActor): boolean {
    return !!this.db.prepare("SELECT 1 FROM work_jobs WHERE owner=? AND channel=? AND status='queued' LIMIT 1").get(actor.owner, actor.channel);
  }
  claim(actor: WorkThreadActor, now: string): { job: WorkJob; run: Run } | undefined {
    return this.hooks.transaction(() => this.claimInTransaction(actor, now));
  }
  claimInTransaction(actor: WorkThreadActor, now: string, id?: string): { job: WorkJob; run: Run } | undefined {
    const next = id ? this.get(actor, id) : this.nextQueued(actor);
    if (!next || next.status !== 'queued') return undefined;
    const run = this.hooks.begin(now);
    this.db.prepare("UPDATE work_jobs SET status='running',runId=?,updatedAt=? WHERE id=? AND status='queued'").run(run.id, now, next.id);
    return { job: this.get(actor, next.id), run };
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
    return this.hooks.transaction(() => this.cancelInTransaction(actor, id, now));
  }
  cancelInTransaction(actor: WorkThreadActor, id: string, now: string): WorkJob {
    const job = this.get(actor, id);
    if (job.status !== 'queued' && job.status !== 'running') return job;
    if (job.runId) this.hooks.finish(job.runId, 'interrupted', now, undefined, '用户已取消后台工作；不自动重试');
    this.db.prepare("UPDATE work_jobs SET status='cancelled',updatedAt=? WHERE id=?").run(now, id);
    return this.get(actor, id);
  }
  recoverInTransaction(now: string): void {
    // 技术 Run 已由共同恢复事务结束；排队请求保留，运行中请求不重新领取。
    this.db.prepare("UPDATE work_jobs SET status='interrupted',updatedAt=? WHERE status='running'").run(now);
  }
}
