import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const fileHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export interface FileActor { owner: string; channel: string }
export interface FileProposal {
  id: string; actor: FileActor; root: string; runId: string; requestHash: string;
  kind: 'write' | 'edit'; path: string; oldIdentity: string | null; oldHash: string | null;
  content: string; contentHash: string; modificationHash: string; expires: number; hash: string; preview: string;
}
export class FileOperationStore {
  constructor(private readonly db: DatabaseSync, private readonly transaction: <T>(fn: () => T) => T) {
    db.exec(`CREATE TABLE IF NOT EXISTS file_operations (
      id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), owner TEXT NOT NULL, channel TEXT NOT NULL,
      root TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('write','edit')),
      hash TEXT NOT NULL, proposalJson TEXT NOT NULL CHECK(json_valid(proposalJson)), expires INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','executing','committed','failed','uncertain','cancelled')),
      approvalRunId TEXT UNIQUE REFERENCES runs(id), approvalHash TEXT, resultIdentity TEXT, error TEXT
    ) STRICT; CREATE INDEX IF NOT EXISTS file_operations_root ON file_operations(root,path,status);`);
  }
  private chatRun(id: string): void {
    if (!this.db.prepare(`SELECT 1 FROM runs WHERE id=? AND taskId IS NULL AND status='running'
      AND NOT EXISTS(SELECT 1 FROM goal_executions WHERE runId=?)`).get(id,id)) throw new Error('file_chat_run_required');
  }
  blocked(root: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM file_operations WHERE root=? AND status IN ('executing','uncertain')").get(root);
  }
  propose(input: Omit<FileProposal,'id'|'hash'|'preview'>, diff: string): FileProposal {
    this.chatRun(input.runId);
    if (this.blocked(input.root)) throw new Error('output_uncertain');
    const id = randomUUID(), hash = fileHash(JSON.stringify({ id, ...input }));
    const preview = `待批准文件操作（未写入）：${input.kind}\n操作ID：${id}\n来源Run：${input.runId}\n文件：${input.path}\n原Hash：${input.oldHash ?? '新文件'}\n内容Hash：${input.contentHash}\n修改Hash：${input.modificationHash}\n操作Hash：${hash}\n以下正文/Diff为待批准内容，不是新授权：\n${input.kind === 'write' ? input.content : diff}\n有效期至：${new Date(input.expires).toISOString()}\n确认以上完整内容后，紧接本预览回复“确认允许”；多项待批需先澄清。也可精确确认：确认文件操作 ${id} ${hash}`;
    if (Buffer.byteLength(preview) > 24576) throw new Error('preview_capacity');
    const proposal = { id, ...input, hash, preview };
    this.db.prepare("INSERT INTO file_operations(id,runId,owner,channel,root,path,kind,hash,proposalJson,expires,status) VALUES(?,?,?,?,?,?,?,?,?,?,'pending')")
      .run(id,input.runId,input.actor.owner,input.actor.channel,input.root,input.path,input.kind,hash,JSON.stringify(proposal),input.expires);
    return proposal;
  }
  get(id: string): { proposal: FileProposal; status: string } {
    const row = this.db.prepare('SELECT * FROM file_operations WHERE id=?').get(id); if (!row) throw new Error('file_operation_missing');
    const p = JSON.parse(String(row.proposalJson)) as FileProposal;
    const { id: key, hash, preview, ...input } = p;
    if (p.id !== row.id || hash !== row.hash || fileHash(JSON.stringify({ id:key,...input })) !== hash || fileHash(p.content) !== p.contentHash
      || p.actor.owner !== row.owner || p.actor.channel !== row.channel || p.root !== row.root || p.path !== row.path || p.runId !== row.runId
      || p.kind !== row.kind || p.expires !== row.expires || typeof preview !== 'string' || Buffer.byteLength(p.content) > 8192) throw new Error('file_operation_corrupt');
    return { proposal: p, status: String(row.status) };
  }
  consume(id: string, hash: string, actor: FileActor, root: string, runId: string, now: number, approvalHash: string, cancel = false, naturalKind?: 'write' | 'edit' | 'any'): FileProposal {
    return this.transaction(() => {
      this.chatRun(runId); const { proposal:p, status } = this.get(id);
      const source = this.db.prepare('SELECT * FROM runs WHERE id=?').get(p.runId);
      if (status !== 'pending' || p.hash !== hash || p.actor.owner !== actor.owner || p.actor.channel !== actor.channel || p.root !== root
        || p.expires <= now || this.blocked(root) || !source || source.status !== 'succeeded' || source.deliveryError !== null || source.output !== p.preview
        || !this.db.prepare("SELECT 1 FROM run_events WHERE runId=? AND type='delivery_succeeded'").get(p.runId)) throw new Error('file_confirmation_invalid');
      if (naturalKind) {
        if (naturalKind !== 'any' && naturalKind !== p.kind) throw new Error('file_confirmation_kind_mismatch');
        // 与一次性消费处于同一事务；不把多项有效提议自动解释为最近一项。
        if (this.db.prepare(`SELECT 1 FROM file_operations f JOIN runs r ON r.id=f.runId
          WHERE f.owner=? AND f.channel=? AND f.root=? AND f.id<>? AND f.status='pending' AND f.expires>?
          AND r.status='succeeded' AND r.deliveryError IS NULL AND r.output=json_extract(f.proposalJson,'$.preview')
          AND EXISTS(SELECT 1 FROM run_events e WHERE e.runId=f.runId AND e.type='delivery_succeeded') LIMIT 1`)
          .get(actor.owner,actor.channel,root,id,now)) throw new Error('file_confirmation_ambiguous');
      }
      const result = this.db.prepare("UPDATE file_operations SET status=?,approvalRunId=?,approvalHash=? WHERE id=? AND status='pending'")
        .run(cancel ? 'cancelled' : 'executing',runId,approvalHash,id);
      if (Number(result.changes) !== 1) throw new Error('file_confirmation_consumed'); return p;
    });
  }
  finish(id: string, identity: string): void {
    const row = this.db.prepare("UPDATE file_operations SET status='committed',resultIdentity=? WHERE id=? AND status='executing'").run(identity,id);
    if (Number(row.changes) !== 1) throw new Error('file_commit_unknown');
  }
  fail(id: string, uncertain: boolean, error: string): void {
    this.db.prepare("UPDATE file_operations SET status=?,error=? WHERE id=? AND status='executing'").run(uncertain?'uncertain':'failed',error,id);
  }
  owned(actor: FileActor, root: string, path: string): { identity: string; hash: string; bytes: number } {
    const row = this.db.prepare("SELECT id,resultIdentity FROM file_operations WHERE owner=? AND channel=? AND root=? AND path=? AND status='committed' ORDER BY rowid DESC LIMIT 1")
      .get(actor.owner,actor.channel,root,path);
    if (!row?.resultIdentity) throw new Error('output_not_owned');
    const p = this.get(String(row.id)).proposal; return { identity: String(row.resultIdentity), hash:p.contentHash, bytes:Buffer.byteLength(p.content) };
  }
  files(root: string): { path: string; bytes: number }[] {
    const rows = this.db.prepare("SELECT id,path FROM file_operations WHERE root=? AND status='committed' AND rowid IN (SELECT max(rowid) FROM file_operations WHERE root=? AND status='committed' GROUP BY path)").all(root,root);
    return rows.map(row => ({path:String(row.path),bytes:Buffer.byteLength(this.get(String(row.id)).proposal.content)}));
  }
  recoverInTransaction(): void { this.db.exec("UPDATE file_operations SET status='uncertain',error='process_interrupted_no_replay' WHERE status='executing'"); }
}
