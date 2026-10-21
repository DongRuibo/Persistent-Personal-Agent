import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FormationJob, FormationSource, MemoryCandidate } from './formation-types.js';
import { fingerprint } from './formation-types.js';

// 与 Run 共用连接；只有领取使用短事务，模型请求期间不持有数据库事务。
export class FormationStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS memory_formation_jobs (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, runId TEXT NOT NULL UNIQUE REFERENCES runs(id),
        status TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL,
        text TEXT NOT NULL, sourceHash TEXT NOT NULL, digest TEXT NOT NULL, channel TEXT NOT NULL,
        windowId TEXT, reserved REAL NOT NULL DEFAULT 0, day TEXT, hintDay TEXT, error TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS formation_queue ON memory_formation_jobs(status, createdAt);
      CREATE TABLE IF NOT EXISTS memory_candidates (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, jobId TEXT NOT NULL REFERENCES memory_formation_jobs(id),
        status TEXT NOT NULL, fingerprint TEXT NOT NULL, expiresAt TEXT NOT NULL,
        approvalRunId TEXT UNIQUE REFERENCES runs(id), data TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS formation_candidates ON memory_candidates(owner, status);
    `);
    if (!db.prepare('PRAGMA table_info(memory_formation_jobs)').all().some(column => column.name === 'channel')) {
      db.exec("ALTER TABLE memory_formation_jobs ADD COLUMN channel TEXT NOT NULL DEFAULT 'console'");
    }
  }

  enqueue(source: FormationSource, digest: string): void {
    const run = this.db.prepare('SELECT status, taskId FROM runs WHERE id = ?').get(source.runId);
    if (!run || run.status !== 'succeeded' || run.taskId !== null) throw new Error('候选来源必须是已成功的交互 Run');
    this.db.prepare(`INSERT OR IGNORE INTO memory_formation_jobs
      (id,owner,runId,status,createdAt,expiresAt,text,sourceHash,digest,channel) VALUES (?,?,?,'queued',?,?,?,?,?,?)`)
      .run(randomUUID(), source.owner, source.runId, source.at, new Date(Date.parse(source.at) + 7 * 86400000).toISOString(), source.text, fingerprint(source.text), digest, source.channel);
  }

  jobs(status?: string): FormationJob[] {
    return (status ? this.db.prepare('SELECT * FROM memory_formation_jobs WHERE status=? ORDER BY createdAt,rowid').all(status)
      : this.db.prepare('SELECT * FROM memory_formation_jobs ORDER BY createdAt,rowid').all()) as unknown as FormationJob[];
  }

  claim(jobs: FormationJob[], now: string, reserve: number, calls: number, budget: number): boolean {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const day = now.slice(0, 10);
      // 单用户应用总预算跨 Console/飞书共享，不因切换审批命名空间获得额外额度。
      const spent = this.db.prepare('SELECT count(*) AS calls, coalesce(sum(reserved),0) AS cost FROM memory_formation_jobs WHERE day=? AND reserved>0').get(day)!;
      if (Number(spent.calls) >= calls || Number(spent.cost) + reserve > budget) { this.db.exec('ROLLBACK'); return false; }
      for (const [index, job] of jobs.entries()) {
        const result = this.db.prepare("UPDATE memory_formation_jobs SET status='extracting',windowId=?,reserved=?,day=? WHERE id=? AND status='queued'")
          .run(jobs[0]!.id, index === 0 ? reserve : 0, day, job.id);
        if (result.changes !== 1) throw new Error('候选窗口已领取');
      }
      this.db.exec('COMMIT'); return true;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  finish(jobs: FormationJob[], status: string, error?: string): void {
    for (const job of jobs) this.db.prepare('UPDATE memory_formation_jobs SET status=?,error=? WHERE id=?').run(status, error ?? null, job.id);
  }

  put(candidate: MemoryCandidate): void {
    this.db.prepare(`INSERT INTO memory_candidates (id,owner,jobId,status,fingerprint,expiresAt,approvalRunId,data) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET status=excluded.status,approvalRunId=excluded.approvalRunId,data=excluded.data`)
      .run(candidate.id, candidate.owner, candidate.jobId, candidate.status, candidate.fingerprint, candidate.expiresAt, candidate.approvalRunId ?? null, JSON.stringify(candidate));
  }

  get(id: string): MemoryCandidate | undefined {
    const row = this.db.prepare('SELECT data FROM memory_candidates WHERE id=?').get(id);
    return row ? JSON.parse(String(row.data)) as MemoryCandidate : undefined;
  }

  candidates(owner: string): MemoryCandidate[] {
    return this.db.prepare('SELECT data FROM memory_candidates WHERE owner=? ORDER BY rowid').all(owner).map(row => JSON.parse(String(row.data)) as MemoryCandidate);
  }

  suppressed(owner: string, hash: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM memory_candidates WHERE owner=? AND fingerprint=? AND status IN ('pending','needs_clarification','applying','applied','rejected','blocked','expired') LIMIT 1").get(owner, hash);
  }

  beginApply(candidate: MemoryCandidate, runId: string): void {
    const previous = this.get(candidate.id);
    if (!previous || previous.status !== 'pending' || previous.revision !== candidate.revision || previous.hash !== candidate.hash) throw new Error('候选已变化或已经审批');
    candidate.status = 'applying'; candidate.approvalRunId = runId;
    this.put(candidate);
  }

  recover(): void {
    this.db.prepare("UPDATE memory_formation_jobs SET status='failed',error='进程在提取期间退出；不自动付费重试' WHERE status='extracting'").run();
  }

  cleanup(now: string): void {
    this.db.prepare("UPDATE memory_formation_jobs SET text='',status=CASE WHEN status='queued' THEN 'expired' ELSE status END WHERE expiresAt<=?").run(now);
    const rows = this.db.prepare("SELECT data FROM memory_candidates WHERE expiresAt<=? AND status!='expired'").all(now);
    for (const row of rows) {
      const candidate = JSON.parse(String(row.data)) as MemoryCandidate;
      candidate.status = 'expired'; candidate.draft = ''; candidate.quote = ''; candidate.subject = ''; candidate.property = ''; candidate.value = '';
      delete candidate.target; candidate.targetOptions = []; delete candidate.reason;
      this.put(candidate);
    }
  }

  takeHint(owner: string, day: string): boolean {
    if (this.db.prepare('SELECT 1 FROM memory_formation_jobs WHERE owner=? AND hintDay=?').get(owner, day)) return false;
    const row = this.db.prepare("SELECT jobId FROM memory_candidates WHERE owner=? AND status IN ('pending','needs_clarification') LIMIT 1").get(owner);
    if (!row) return false;
    this.db.prepare('UPDATE memory_formation_jobs SET hintDay=? WHERE id=?').run(day, String(row.jobId)); return true;
  }
}
