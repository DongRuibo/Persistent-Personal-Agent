import { createHash, randomUUID } from 'node:crypto';
import type { WorkJobStore } from './work-job-store.js';
import type { WorkThreadStore } from './work-thread-store.js';
import type { DatabaseSync } from 'node:sqlite';
import type { GoalStore } from './goal-store.js';
import type { FullWorkResult, WorkResultReference } from './work-recall.js';
import { workInputBytes, type WorkInputReference } from './work-job-types.js';
import type { WorkThreadActor } from './work-thread-types.js';

// 字符区间使用当前原话的UTF-16索引；解析入口负责验证，存储只保留宿主已核对的引用。
export interface WorkTextRange { start: number; end: number; role: 'instruction' | 'shared' }
export interface WorkRequestItem {
  itemId: string; requestId: string; ordinal: number; ranges: WorkTextRange[];
  decision: 'work' | 'feedback' | 'clarify' | 'query' | 'cancel' | 'unsupported';
  permission: 'none' | 'available' | 'consumed' | 'revoked' | 'needs_user';
  targetKind: 'job' | 'goal' | null; targetId: string | null; baseJobId: string | null;
  permissionItemId: string | null; consumedByJobId: string | null; sourceResult?: WorkResultReference; requestHash?: string | null; receipt: string; createdAt: string;
}
type ItemRow = Omit<WorkRequestItem, 'ranges' | 'sourceResult'> & { rangesJson: string; sourceJson: string | null };
function readItem({ rangesJson, sourceJson, ...row }: ItemRow): WorkRequestItem {
  return { ...row, ranges: JSON.parse(rangesJson) as WorkTextRange[], ...(sourceJson ? { sourceResult: JSON.parse(sourceJson) as WorkResultReference } : {}) };
}
const columns = 'itemId,requestId,ordinal,rangesJson,decision,permission,targetKind,targetId,baseJobId,permissionItemId,consumedByJobId,receipt,createdAt,sourceJson,requestHash';

// 仅保存请求子项与有限许可收据；Job/Run仍是执行及成果事实源。
export class WorkCoordinatorStore {
  constructor(private readonly db: DatabaseSync, private readonly hooks: { transaction<T>(fn: () => T): T; jobs: WorkJobStore; threads: WorkThreadStore; goals: GoalStore; result(actor: WorkThreadActor, source: { kind: 'job' | 'goal'; id: string; runId?: string }, enabled: boolean): FullWorkResult | undefined; event(runId: string, details: string, now: string): void }) {
    db.exec(`CREATE TABLE IF NOT EXISTS web_request_items (
      itemId TEXT PRIMARY KEY, owner TEXT NOT NULL, channel TEXT NOT NULL, requestId TEXT NOT NULL,
      ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 2), rangesJson TEXT NOT NULL,
      decision TEXT NOT NULL CHECK(decision IN ('work','feedback','clarify','query','cancel','unsupported')),
      permission TEXT NOT NULL CHECK(permission IN ('none','available','consumed','revoked','needs_user')),
      targetKind TEXT CHECK(targetKind IN ('job','goal')), targetId TEXT,
      baseJobId TEXT REFERENCES work_jobs(id), permissionItemId TEXT REFERENCES web_request_items(itemId),
      consumedByJobId TEXT REFERENCES work_jobs(id), receipt TEXT NOT NULL, createdAt TEXT NOT NULL,
      UNIQUE(owner,channel,requestId,ordinal), FOREIGN KEY(owner,requestId) REFERENCES web_ui_chats(owner,requestId),
      CHECK((targetKind IS NULL)=(targetId IS NULL))
    ) STRICT;`);
    const existing = db.prepare('PRAGMA table_info(web_request_items)').all();
    for (const name of ['sourceJson', 'requestHash']) if (!existing.some(column => column.name === name)) db.exec(`ALTER TABLE web_request_items ADD COLUMN ${name} TEXT`);
  }
  commitBatch(actor: WorkThreadActor, requestId: string, runId: string, input: PreparedWorkItem[], now: string): { items: WorkRequestItem[]; cancelled: string[] } {
    return this.hooks.transaction(() => {
      const old = this.items(actor, requestId);
      if (old.length) return { items: old, cancelled: [] };
      const parent = this.db.prepare('SELECT text FROM web_ui_chats WHERE owner=? AND requestId=? AND runId=? AND coordinator=1').get(actor.owner, requestId, runId)!;
      const sourceHash = createHash('sha256').update(String(parent.text)).digest('hex');
      const cancelled: string[] = [];
      for (const [ordinal, prepared] of input.entries()) {
        const itemId = randomUUID();
        this.db.prepare(`INSERT INTO web_request_items(itemId,owner,channel,requestId,ordinal,rangesJson,decision,permission,targetKind,targetId,receipt,createdAt)
          VALUES(?,?,?,?,?,?,?,'none',?,?,?,?)`).run(itemId, actor.owner, actor.channel, requestId, ordinal, JSON.stringify(prepared.ranges),
          prepared.decision, prepared.targetId ? prepared.targetKind ?? 'job' : null, prepared.targetId ?? null, prepared.receipt, now);
        if (prepared.continuation) {
          const pending = prepared.continuation;
          const earliest = this.db.prepare(`SELECT itemId FROM web_request_items WHERE owner=? AND channel=? AND targetKind=? AND targetId=?
            AND baseJobId IS ? AND permission='available' AND consumedByJobId IS NULL ORDER BY createdAt,rowid LIMIT 1`)
            .get(actor.owner, actor.channel, prepared.targetKind ?? 'job', prepared.targetId!, pending.baseJobId);
          this.db.prepare(`UPDATE web_request_items SET baseJobId=?,sourceJson=?,requestHash=?,permission=?,permissionItemId=?,receipt=? WHERE itemId=?`)
            .run(pending.baseJobId, pending.source ? JSON.stringify(pending.source) : null, sourceHash, pending.permit ? 'available' : 'none',
              earliest?.itemId ?? (pending.permit ? itemId : null), pending.permit ? '修改要求已收到，等待成功前序及执行门；尚未采纳。' : '补充资料已收到；没有新的执行许可，尚未采纳。', itemId);
          if (earliest || pending.permit) this.db.prepare(`UPDATE web_request_items SET permissionItemId=? WHERE owner=? AND channel=? AND targetKind=? AND targetId=?
            AND baseJobId IS ? AND consumedByJobId IS NULL AND permission IN ('none','available')`).run(earliest?.itemId ?? itemId, actor.owner, actor.channel, prepared.targetKind ?? 'job', prepared.targetId!, pending.baseJobId);
        } else if (prepared.instruction !== undefined) {
          const matched = this.hooks.threads.list(actor).filter(t => t.status === 'active' && t.title === prepared.name);
          if (matched.length > 1) {
            this.db.prepare("UPDATE web_request_items SET decision='clarify',permission='needs_user',receipt=? WHERE itemId=?")
              .run(`同名主题不唯一，请明确“${prepared.name}”的范围；本项未启动。`, itemId);
            continue;
          }
          const thread = matched[0] ?? this.hooks.threads.createInTransaction(actor, randomUUID(), prepared.name!, now);
          const job = this.hooks.jobs.createInTransaction(actor, thread.id, itemId, prepared.instruction, now, {
            sourceItemId: itemId, inputHash: prepared.inputHash!, inputReferences: [{ kind: 'request', requestId, itemId,
              hash: sourceHash }],
          });
          this.db.prepare("UPDATE web_request_items SET permission='consumed',targetKind='job',targetId=?,consumedByJobId=?,receipt=? WHERE itemId=?")
            .run(job.id, job.id, `“${prepared.name}”已排队；尚未开始执行。`, itemId);
          this.hooks.event(runId, JSON.stringify({ source: 'host', itemId, threadId: thread.id, jobId: job.id, organization: matched.length ? 'reuse' : 'create' }), now);
        } else if (prepared.decision === 'cancel' && prepared.targetId) {
          const target = this.hooks.jobs.get(actor, prepared.targetId);
          for (const job of this.hooks.jobs.chain(actor, target.rootJobId).filter(j => ['queued', 'running'].includes(j.status))) {
            this.hooks.jobs.cancelInTransaction(actor, job.id, now); cancelled.push(job.id);
          }
          this.db.prepare("UPDATE web_request_items SET permission='revoked' WHERE owner=? AND channel=? AND targetKind='job' AND targetId=? AND consumedByJobId IS NULL AND decision='feedback' AND permission IN ('available','none','needs_user')")
            .run(actor.owner, actor.channel, target.rootJobId);
          this.db.prepare('UPDATE web_request_items SET receipt=? WHERE itemId=?')
            .run(cancelled.length ? '该工作的可取消执行已停止，尚未消费的续接许可已撤销；不承诺从中断位置恢复。' : '该工作当前没有可取消的执行；未重跑或重开终态。', itemId);
        } else if (prepared.decision === 'query' && prepared.targetId) {
          const job = this.hooks.jobs.get(actor, prepared.targetId);
          this.db.prepare('UPDATE web_request_items SET receipt=? WHERE itemId=?')
            .run(`工作状态：${job.status}；执行记录：${job.runId ?? '尚未领取'}。`, itemId);
        }
      }
      const items = this.items(actor, requestId);
      this.hooks.event(runId, JSON.stringify({ source: 'host', requestId, itemIds: items.map(i => i.itemId), jobIds: items.flatMap(i => i.consumedByJobId ? [i.consumedByJobId] : []), cancelled }), now);
      return { items, cancelled };
    });
  }
  // 只查当前原话具名范围；模型目录不加载全历史，也不把根工作拆成多次执行候选。
  goalCandidates(actor: WorkThreadActor, keywords: string[], text?: string) {
    const clause = text === undefined ? keywords.map(() => '(instr(objective,?)>0 OR instr(id,?)>0)').join(' AND ') : '(instr(?,objective)>0 OR instr(?,id)>0)';
    if (!clause) return [];
    const rows = this.db.prepare(`SELECT id FROM goals WHERE ownerId='local-user' AND targetJson=? AND ${clause} ORDER BY rowid LIMIT 21`)
      .all(actor.channel, ...(text === undefined ? keywords.flatMap(k => [k,k]) : [text,text]));
    return rows.map(row => this.hooks.goals.get({ ownerId: 'local-user', target: JSON.parse(actor.channel) }, String(row.id)));
  }
  hasPending(actor: WorkThreadActor): boolean {
    return !!this.db.prepare(`SELECT 1 FROM web_request_items i WHERE owner=? AND channel=? AND decision='feedback' AND consumedByJobId IS NULL
      AND (permission='available' OR permission='none' AND baseJobId IN (SELECT id FROM work_jobs WHERE status IN ('failed','interrupted','cancelled'))) LIMIT 1`)
      .get(actor.owner, actor.channel);
  }
  claimNext(actor: WorkThreadActor, now: string, goalsEnabled: boolean) {
    return this.hooks.transaction(() => {
      this.db.prepare(`UPDATE web_request_items SET permission='needs_user',receipt='前序失败、中断或取消；补充待用户处理，不自动重试。'
        WHERE owner=? AND channel=? AND decision='feedback' AND consumedByJobId IS NULL AND permission IN ('none','available')
        AND baseJobId IN (SELECT id FROM work_jobs WHERE status IN ('failed','interrupted','cancelled'))`).run(actor.owner, actor.channel);
      const queued = this.hooks.jobs.nextQueued(actor);
      const permits = this.db.prepare(`SELECT ${columns} FROM web_request_items WHERE owner=? AND channel=? AND decision='feedback' AND permission='available'
        AND consumedByJobId IS NULL AND (baseJobId IS NULL OR baseJobId IN (SELECT id FROM work_jobs WHERE status NOT IN ('queued','running')))
        ORDER BY createdAt,rowid`).all(actor.owner, actor.channel) as unknown as ItemRow[];
      for (const row of permits) {
        const permit = readItem(row);
        if (queued && queued.createdAt <= permit.createdAt) return this.hooks.jobs.claimInTransaction(actor, now, queued.id);
        const source = this.hooks.result(actor, { kind: permit.targetKind!, id: permit.baseJobId ?? permit.targetId!,
          ...(permit.sourceResult ? { runId: permit.sourceResult.runId } : {}) }, goalsEnabled);
        const pending = (this.db.prepare(`SELECT ${columns} FROM web_request_items WHERE owner=? AND channel=? AND targetKind=? AND targetId=? AND baseJobId IS ?
          AND decision='feedback' AND consumedByJobId IS NULL AND permission IN ('none','available') ORDER BY createdAt,rowid`)
          .all(actor.owner, actor.channel, permit.targetKind!, permit.targetId!, permit.baseJobId) as unknown as ItemRow[]).map(readItem);
        const fail = (reason: string) => {
          for (const item of pending) this.db.prepare("UPDATE web_request_items SET permission='needs_user',receipt=? WHERE itemId=?").run(reason, item.itemId);
        };
        if (!source || pending.some(item => item.sourceResult && JSON.stringify(item.sourceResult) !== JSON.stringify(source.reference))) {
          fail('指定前序成果缺失、变化或未有效提交；尚未采纳，请核对原成果。'); continue;
        }
        const base = permit.baseJobId ? this.hooks.jobs.get(actor, permit.baseJobId) : undefined;
        const root = base ? this.hooks.jobs.get(actor, base.rootJobId) : undefined;
        const goalOrigin = !!root?.inputReferences?.some(reference => reference.kind === 'goal_result');
        const originalInput = goalOrigin ? (JSON.parse(root!.instruction) as { objectiveAndOriginalInput: string }).objectiveAndOriginalInput : root?.instruction;
        if (root && this.hooks.threads.get(actor, root.threadId).status !== 'active') { fail('所属主题已归档；尚未采纳，请先明确恢复工作范围。'); continue; }
        const previous = base?.inputReferences?.filter((r): r is Extract<WorkInputReference, { kind: 'request' }> => r.kind === 'request') ?? [];
        const references: WorkInputReference[] = [];
        const earlier: string[] = [], current: string[] = [];
        let missing = !!root?.inputHash && createHash('sha256').update(root.instruction).digest('hex') !== root.inputHash;
        for (const reference of previous) {
          const parent = this.db.prepare('SELECT text FROM web_ui_chats WHERE owner=? AND requestId=?').get(actor.owner, reference.requestId);
          const item = this.items(actor, reference.requestId).find(i => i.itemId === reference.itemId);
          if (!parent || !item || createHash('sha256').update(String(parent.text)).digest('hex') !== reference.hash) { missing = true; break; }
          references.push(reference);
          if (goalOrigin || reference.itemId !== root?.sourceItemId) earlier.push(item.ranges.map(range => String(parent.text).slice(range.start, range.end)).join('\n'));
        }
        for (const item of pending) {
          const parent = this.db.prepare('SELECT text FROM web_ui_chats WHERE owner=? AND requestId=?').get(actor.owner, item.requestId);
          if (!parent || !item.requestHash || createHash('sha256').update(String(parent.text)).digest('hex') !== item.requestHash) { missing = true; break; }
          current.push(item.ranges.map(range => String(parent.text).slice(range.start, range.end)).join('\n'));
          references.push({ kind: 'request', requestId: item.requestId, itemId: item.itemId, hash: item.requestHash });
        }
        if (missing) { fail('本工作原始约束或补充来源缺失/变化；尚未采纳，请核对原话。'); continue; }
        references.push(source.reference);
        const instruction = JSON.stringify({ objectiveAndOriginalInput: originalInput ?? source.originalInput ?? source.objective,
          previousResult: { source: source.reference, text: source.text }, earlierRequests: earlier, currentRequests: current });
        // 为原Pi零工具请求保留8 KiB宿主元数据；实际HTTP仍由原provider边界再次计量。
        if (Buffer.byteLength(instruction) > workInputBytes || Buffer.byteLength(JSON.stringify(instruction)) + 8192 > 32768) {
          fail('完整成果与有效约束超过14 KiB输入或32 KiB请求预算；未节选、尚未采纳，请缩小范围。'); continue;
        }
        const matched = root ? [] : this.hooks.threads.list(actor).filter(t => t.title === source.objective.slice(0,120) && t.status === 'active');
        if (matched.length > 1) { fail('原成果对应多个同名主题，请明确范围；尚未采纳。'); continue; }
        const threadId = root?.threadId ?? (matched[0] ?? this.hooks.threads.createInTransaction(actor, randomUUID(), source.objective.slice(0,120), now)).id;
        const job = this.hooks.jobs.createInTransaction(actor, threadId, permit.itemId, instruction, now, {
          sourceItemId: permit.itemId, rootJobId: root?.id, previousJobId: base?.id, inputReferences: references,
          inputHash: createHash('sha256').update(instruction).digest('hex') });
        const claimed = this.hooks.jobs.claimInTransaction(actor, now, job.id)!;
        for (const item of pending) this.db.prepare(`UPDATE web_request_items SET consumedByJobId=?,permissionItemId=?,permission=CASE WHEN permission='available' THEN 'consumed' ELSE permission END,
          receipt=? WHERE itemId=?`).run(job.id, permit.itemId, `补充已采纳于新执行${job.id}；原执行及其输入未改变。`, item.itemId);
        const parent = this.db.prepare('SELECT runId FROM web_ui_chats WHERE owner=? AND requestId=?').get(actor.owner, permit.requestId)!;
        this.hooks.event(String(parent.runId), JSON.stringify({ source: 'host', successor: job.id, previous: base?.id, permissionItemId: permit.itemId,
          consumedItemIds: pending.map(item => item.itemId), inputHash: job.inputHash, references }), now);
        return claimed;
      }
      return queued ? this.hooks.jobs.claimInTransaction(actor, now, queued.id) : undefined;
    });
  }
  item(actor: WorkThreadActor, itemId: string): WorkRequestItem | undefined {
    const row = this.db.prepare(`SELECT ${columns} FROM web_request_items WHERE owner=? AND channel=? AND itemId=?`)
      .get(actor.owner, actor.channel, itemId) as unknown as ItemRow | undefined;
    return row ? readItem(row) : undefined;
  }
  items(actor: WorkThreadActor, requestId: string): WorkRequestItem[] {
    const rows = this.db.prepare(`SELECT ${columns} FROM web_request_items WHERE owner=? AND channel=? AND requestId=? ORDER BY ordinal`)
      .all(actor.owner, actor.channel, requestId) as unknown as ItemRow[];
    return rows.map(readItem);
  }
}

export interface PreparedWorkItem {
  ranges: WorkTextRange[]; decision: WorkRequestItem['decision']; receipt: string;
  name?: string; instruction?: string; inputHash?: string; targetId?: string; targetKind?: 'job' | 'goal';
  continuation?: { baseJobId: string | null; source?: WorkResultReference; permit: boolean };
}
