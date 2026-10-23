import { randomUUID, createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { webHash } from './web-read-types.js';
import type { WebActor, WebPermit, WebSnapshot, WebView } from './web-read-types.js';

export class WebReadStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T) {
    db.exec(`CREATE TABLE IF NOT EXISTS web_read_calls (
      id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), permitId TEXT NOT NULL UNIQUE,
      owner TEXT NOT NULL, channel TEXT NOT NULL, resourceId TEXT NOT NULL, catalogHash TEXT NOT NULL,
      requestHash TEXT NOT NULL, expires INTEGER NOT NULL, reservedBytes INTEGER NOT NULL CHECK(reservedBytes=32768),
      status TEXT NOT NULL CHECK(status IN ('reserved','succeeded','failed','interrupted')),
      createdAt TEXT NOT NULL, finishedAt TEXT, snapshotJson TEXT, error TEXT,
      CHECK((status='succeeded')=(snapshotJson IS NOT NULL)), CHECK(snapshotJson IS NULL OR json_valid(snapshotJson))
    ) STRICT;
    CREATE INDEX IF NOT EXISTS web_read_daily ON web_read_calls(createdAt);`);
  }
  private snapshot(json: string): WebSnapshot {
    if (Buffer.byteLength(json) > 262144) throw new Error('Web冻结元数据容量损坏');
    const value = JSON.parse(json) as WebSnapshot;
    const fields = ['resourceId', 'url', 'version', 'catalogHash', 'fetchedAt', 'contentHash', 'bytes', 'text'];
    if (!value || typeof value !== 'object' || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))
      || typeof value.text !== 'string' || typeof value.resourceId !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.resourceId)
      || typeof value.url !== 'string' || value.url.length > 2048 || typeof value.version !== 'string' || !value.version || value.version.length > 64
      || !/^[a-f0-9]{64}$/u.test(value.catalogHash) || !/^[a-f0-9]{64}$/u.test(value.contentHash)
      || !Number.isFinite(Date.parse(value.fetchedAt)) || !Number.isSafeInteger(value.bytes)) throw new Error('Web冻结元数据损坏');
    const bytes = Buffer.from(value.text, 'utf8');
    if (!bytes.length || bytes.length > 32768 || bytes.length !== value.bytes
      || createHash('sha256').update(bytes).digest('hex') !== value.contentHash) throw new Error('Web快照Hash或容量损坏');
    return value;
  }
  reserve(permit: WebPermit, now: string): { id: string; snapshot?: WebSnapshot } {
    if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw new Error('Web宿主时间无效');
    return this.transaction(() => {
      if (!permit.owner || permit.owner.length > 200 || !permit.channel || permit.channel.length > 1000
        || !permit.id || permit.id.length > 200 || !/^[a-f0-9]{64}$/u.test(permit.catalogHash)
        || !Number.isSafeInteger(permit.expires) || permit.expires <= Date.parse(now) || permit.expires > Date.parse(now) + 300000
        || !this.db.prepare("SELECT 1 FROM runs WHERE id=? AND status='running' AND taskId IS NULL AND NOT EXISTS (SELECT 1 FROM goal_executions WHERE runId=?)").get(permit.runId, permit.runId)) throw new Error('Web许可身份、期限或当前Chat Run无效');
      const requestHash = webHash(permit);
      const existing = this.db.prepare('SELECT * FROM web_read_calls WHERE runId=? OR permitId=?').get(permit.runId, permit.id);
      if (existing) {
        if (existing.requestHash !== requestHash || existing.runId !== permit.runId || existing.status !== 'succeeded') throw new Error('Web许可已消费或结果不确定，不重取');
        const snapshot = this.snapshot(String(existing.snapshotJson));
        if (snapshot.resourceId !== permit.resourceId || snapshot.catalogHash !== permit.catalogHash) throw new Error('Web许可与冻结快照不一致');
        return { id: String(existing.id), snapshot };
      }
      const day = now.slice(0, 10);
      const count = this.db.prepare('SELECT count(*) AS n,coalesce(sum(reservedBytes),0) AS bytes FROM web_read_calls WHERE substr(createdAt,1,10)=?').get(day)!;
      if (Number(count.n) >= 20 || Number(count.bytes) + 32768 > 655360) throw new Error('Web宿主UTC日20次/640KiB预留上限已用尽');
      const id = randomUUID();
      this.db.prepare("INSERT INTO web_read_calls (id,runId,permitId,owner,channel,resourceId,catalogHash,requestHash,expires,reservedBytes,status,createdAt) VALUES (?,?,?,?,?,?,?,?,?,32768,'reserved',?)")
        .run(id, permit.runId, permit.id, permit.owner, permit.channel, permit.resourceId, permit.catalogHash, requestHash, permit.expires, now);
      this.db.prepare('INSERT INTO run_events(runId,at,type,details) VALUES (?,?,?,?)').run(permit.runId, now, 'web_read_reserved', JSON.stringify({ id, resourceId: permit.resourceId, reservedBytes: 32768 }));
      return { id };
    });
  }
  finish(id: string, snapshot: WebSnapshot, now: string): void {
    if (!Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw new Error('Web宿主时间无效');
    const accepted = this.transaction(() => {
      const row = this.db.prepare("SELECT w.*,r.status AS runStatus FROM web_read_calls w JOIN runs r ON r.id=w.runId WHERE w.id=?").get(id);
      if (!row || row.status !== 'reserved') return false;
      if (row.runStatus !== 'running' || Number(row.expires) <= Date.parse(now)) {
        this.db.prepare("UPDATE web_read_calls SET status='interrupted',finishedAt=?,error='late_result' WHERE id=?").run(now, id); return false;
      }
      const checked = this.snapshot(JSON.stringify(snapshot));
      if (checked.resourceId !== row.resourceId || checked.catalogHash !== row.catalogHash) throw new Error('Web结果不属于预留资源');
      this.db.prepare("UPDATE web_read_calls SET status='succeeded',finishedAt=?,snapshotJson=? WHERE id=?").run(now, JSON.stringify(checked), id);
      this.db.prepare('INSERT INTO run_events(runId,at,type,details) VALUES (?,?,?,?)').run(String(row.runId), now, 'web_read_succeeded', JSON.stringify({ id, contentHash: checked.contentHash, bytes: checked.bytes }));
      return true;
    });
    if (!accepted) throw new Error('Web结果迟到、许可已撤销或Run结束，拒绝提交');
  }
  fail(id: string, error: string, now: string, interrupted = false): void {
    this.db.prepare("UPDATE web_read_calls SET status=?,finishedAt=?,error=? WHERE id=? AND status='reserved'")
      .run(interrupted ? 'interrupted' : 'failed', now, error.slice(0, 200), id);
  }
  interrupt(runId: string, actor: WebActor, now: string): void {
    this.db.prepare("UPDATE web_read_calls SET status='interrupted',finishedAt=?,error='host_cancelled' WHERE runId=? AND owner=? AND channel=? AND status='reserved'")
      .run(now, runId, actor.owner, actor.channel);
  }
  recoverInTransaction(now: string): void {
    this.db.prepare("UPDATE web_read_calls SET status='interrupted',finishedAt=?,error='process_interrupted_no_retry' WHERE status='reserved'").run(now);
  }
  displayed(view: WebView, actor: WebActor, now: number): boolean {
    if (!Number.isFinite(now) || !Number.isSafeInteger(view.expires) || view.owner !== actor.owner || view.channel !== actor.channel || view.expires <= now || view.expires > now + 300000) return false;
    const run = this.db.prepare("SELECT output FROM runs WHERE id=? AND status='succeeded' AND deliveryError IS NULL").get(view.displayRunId);
    return !!run && webHash(run.output) === view.displayHash
      && !!this.db.prepare("SELECT 1 FROM run_events WHERE runId=? AND type='web_read_preview' AND details=?").get(view.displayRunId, webHash(view))
      && !!this.db.prepare("SELECT 1 FROM run_events WHERE runId=? AND type='delivery_succeeded'").get(view.displayRunId);
  }
  calls(): Record<string, unknown>[] { return this.db.prepare('SELECT * FROM web_read_calls ORDER BY createdAt,id LIMIT 1000').all(); }
}
