import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from './contracts.js';
import type { GitHubSnapshot } from './github-observer.js';
import { WorkThreadError } from './work-thread-store.js';
import type { WorkThreadService } from './work-thread-service.js';
import type { ThreadSubscription, SubscriptionRequest, SubscriptionView, SubscriptionEvent, ThreadSourceEvent } from './source-event-types.js';
import type { WorkThreadActor } from './work-thread-types.js';
import type { EventSource, SourceEvent, SourceEventDetail, SourcePermission } from './source-event-types.js';

export class SourceEventError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string) { super(message); }
}
type ThreadAccess = Pick<WorkThreadService, 'get' | 'routingObject'>;
interface Transactions {
  transaction<T>(fn: () => T): T; begin(now: string): Run; finish(id: string, now: string): void;
  event(id: string, type: string, details: unknown, now: string): void; redact(value: unknown): string;
}

// 来源只保存明确许可与只读观察事实；没有 Policy、Grant 或业务执行写入口。
export class SourceEventStore {
  constructor(private readonly db: DatabaseSync, private readonly tx: Transactions) {
    db.exec(`CREATE TABLE IF NOT EXISTS event_sources (
      id TEXT PRIMARY KEY, owner TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind='github'),
      repository TEXT NOT NULL, branch TEXT NOT NULL, intervalSeconds INTEGER NOT NULL CHECK(intervalSeconds BETWEEN 60 AND 86400),
      requestId TEXT NOT NULL, sourceRunId TEXT NOT NULL UNIQUE REFERENCES runs(id),
      status TEXT NOT NULL CHECK(status IN ('active','paused')), revision INTEGER NOT NULL,
      head TEXT, nextAt TEXT NOT NULL, failures INTEGER NOT NULL DEFAULT 0, lastError TEXT,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      UNIQUE(owner,channel,requestId), UNIQUE(owner,channel,repository,branch,intervalSeconds)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS event_sources_due ON event_sources(owner,channel,status,nextAt);
    CREATE TABLE IF NOT EXISTS source_events (
      id TEXT PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES event_sources(id), previous TEXT NOT NULL, head TEXT NOT NULL,
      observedAt TEXT NOT NULL, snapshotJson TEXT NOT NULL CHECK(json_valid(snapshotJson) AND length(CAST(snapshotJson AS BLOB))<=10000),
      snapshotHash TEXT NOT NULL, legacyObservationId TEXT REFERENCES goal_observations(id), UNIQUE(sourceId,head)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS thread_subscriptions (
      id TEXT PRIMARY KEY, sourceId TEXT NOT NULL REFERENCES event_sources(id), threadId TEXT NOT NULL REFERENCES work_threads(id),
      goalId TEXT REFERENCES goals(id), policyId TEXT REFERENCES goal_policies(id), policyVersion INTEGER,
      status TEXT NOT NULL CHECK(status IN ('active','paused')), revision INTEGER NOT NULL,
      startAfterEvent TEXT REFERENCES source_events(id), createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL,
      CHECK((policyId IS NULL AND policyVersion IS NULL) OR (policyId IS NOT NULL AND policyVersion IS NOT NULL AND goalId IS NOT NULL))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS thread_subscription_topic ON thread_subscriptions(sourceId,threadId) WHERE goalId IS NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS thread_subscription_goal ON thread_subscriptions(sourceId,threadId,goalId) WHERE goalId IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS thread_subscription_policy ON thread_subscriptions(policyId) WHERE policyId IS NOT NULL;
    CREATE TABLE IF NOT EXISTS subscription_events (
      eventId TEXT NOT NULL REFERENCES source_events(id), subscriptionId TEXT NOT NULL REFERENCES thread_subscriptions(id),
      subscriptionRevision INTEGER NOT NULL, goalId TEXT REFERENCES goals(id), policyId TEXT REFERENCES goal_policies(id), policyVersion INTEGER,
      status TEXT NOT NULL CHECK(status IN ('pending','observed','dispatched','skipped')), reason TEXT,
      observationId TEXT REFERENCES goal_observations(id), triggerId TEXT REFERENCES goal_triggers(id), decidedAt TEXT,
      PRIMARY KEY(eventId,subscriptionId),
      CHECK((policyId IS NULL AND policyVersion IS NULL) OR (policyId IS NOT NULL AND policyVersion IS NOT NULL AND goalId IS NOT NULL))
    ) STRICT;`);
  }
  private read(row: Record<string, unknown>): EventSource {
    return { id: String(row.id), requestId: String(row.requestId), sourceRunId: String(row.sourceRunId),
      watch: { kind: 'github', repository: String(row.repository), branch: String(row.branch), intervalSeconds: Number(row.intervalSeconds) },
      status: row.status as EventSource['status'], revision: Number(row.revision), head: row.head as string | null,
      nextAt: String(row.nextAt), failures: Number(row.failures), lastError: row.lastError as string | null,
      createdAt: String(row.createdAt), updatedAt: String(row.updatedAt) };
  }
  get(actor: WorkThreadActor, id: string): EventSource {
    const row = this.db.prepare('SELECT * FROM event_sources WHERE id=? AND owner=? AND channel=?').get(id, actor.owner, actor.channel);
    if (!row) throw new SourceEventError(404, '来源不存在或无权访问');
    return this.read(row);
  }
  list(actor: WorkThreadActor): EventSource[] {
    return this.db.prepare('SELECT * FROM event_sources WHERE owner=? AND channel=? ORDER BY createdAt,id LIMIT 100')
      .all(actor.owner, actor.channel).map(row => this.read(row));
  }
  permit(actor: WorkThreadActor, permission: SourcePermission, now: string): EventSource {
    return this.tx.transaction(() => {
      const old = this.db.prepare('SELECT * FROM event_sources WHERE owner=? AND channel=? AND requestId=?')
        .get(actor.owner, actor.channel, permission.requestId);
      const { repository, branch, intervalSeconds } = permission.watch;
      if (old) {
        if (old.repository !== repository || old.branch !== branch || old.intervalSeconds !== intervalSeconds) throw new SourceEventError(409, '此请求已用于其他观察范围');
        return this.read(old);
      }
      if (this.db.prepare('SELECT 1 FROM event_sources WHERE owner=? AND channel=? AND repository=? AND branch=? AND intervalSeconds=?')
        .get(actor.owner, actor.channel, repository, branch, intervalSeconds)) throw new SourceEventError(409, '相同观察来源已存在，请使用原来源');
      if (this.list(actor).length >= 100) throw new SourceEventError(409, '当前工作空间最多保留100个观察来源');
      const id = randomUUID(), run = this.tx.begin(now);
      this.db.prepare("INSERT INTO event_sources VALUES(?,?,?,'github',?,?,?,?,?,'active',1,NULL,?,0,NULL,?,?)")
        .run(id, actor.owner, actor.channel, repository, branch, intervalSeconds, permission.requestId, run.id, now, now, now);
      this.tx.event(run.id, 'source_observation_permitted', { sourceId: id, owner: actor.owner, channel: actor.channel, ...permission }, now);
      this.tx.finish(run.id, now);
      return this.get(actor, id);
    });
  }
  setStatus(actor: WorkThreadActor, id: string, status: EventSource['status'], expectedRevision: number, now: string): EventSource {
    return this.tx.transaction(() => {
      const source = this.get(actor, id);
      if (source.revision !== expectedRevision) throw new SourceEventError(409, '来源版本已变化，请刷新');
      if (source.status !== status) {
        this.db.prepare('UPDATE event_sources SET status=?,revision=revision+1,updatedAt=? WHERE id=?').run(status, now, id);
        // 暂停时终结尚未交接的事件；恢复只能接收之后的新变化，不影响原已签发Grant。
        if (status === 'paused') this.db.prepare(`UPDATE subscription_events SET status='skipped',reason='source_paused',decidedAt=?
          WHERE status='pending' AND eventId IN (SELECT id FROM source_events WHERE sourceId=?)`).run(now, id);
      }
      return this.get(actor, id);
    });
  }
  due(actor: WorkThreadActor, now: string): EventSource[] {
    return this.db.prepare("SELECT * FROM event_sources WHERE owner=? AND channel=? AND status='active' AND nextAt<=? ORDER BY nextAt,id LIMIT 10")
      .all(actor.owner, actor.channel, now).map(row => this.read(row));
  }
  private current(actor: WorkThreadActor, source: EventSource): boolean {
    const current = this.get(actor, source.id);
    return current.status === 'active' && current.revision === source.revision && current.head === source.head && current.nextAt === source.nextAt;
  }
  record(actor: WorkThreadActor, source: EventSource, snapshot: GitHubSnapshot, now: string, threads?: ThreadAccess): void {
    this.tx.transaction(() => {
      if (!this.current(actor, source)) return;
      const nextAt = new Date(Date.parse(now) + source.watch.intervalSeconds * 1000).toISOString();
      this.db.prepare('UPDATE event_sources SET nextAt=?,failures=0,lastError=NULL,updatedAt=? WHERE id=?').run(nextAt, now, source.id);
      if (source.head === snapshot.head) return;
      if (source.head !== null) {
        const snapshotJson = JSON.stringify(snapshot), snapshotHash = createHash('sha256').update(snapshotJson).digest('hex');
        const eventId = randomUUID();
        this.db.prepare('INSERT INTO source_events VALUES(?,?,?,?,?,?,?,NULL)')
          .run(eventId, source.id, source.head, snapshot.head, now, snapshotJson, snapshotHash);
        // 以本次提交顺序捕获当时有效订阅；不按commit作者时间猜边界，不补发旧事件。
        const subscriptions = this.db.prepare("SELECT * FROM thread_subscriptions WHERE sourceId=? AND status='active' ORDER BY rowid").all(source.id) as unknown as ThreadSubscription[];
        for (const subscription of subscriptions) {
          if (this.unavailable(threads, subscription)) continue;
          this.db.prepare("INSERT INTO subscription_events VALUES(?,?,?,?,?,?,'pending',NULL,NULL,NULL,NULL)")
            .run(eventId, subscription.id, subscription.revision, subscription.goalId, subscription.policyId, subscription.policyVersion);
        }
        this.settleInTransaction(actor, threads, now);
      }
      this.db.prepare('UPDATE event_sources SET head=? WHERE id=?').run(snapshot.head, source.id);
    });
  }
  private unavailable(threads: ThreadAccess | undefined, subscription: Pick<ThreadSubscription, 'threadId' | 'goalId'>): string | null {
    if (!threads) return 'thread_unavailable';
    try {
      if (threads.get(subscription.threadId).status !== 'active') return 'thread_archived';
      if (subscription.goalId) {
        threads.routingObject('goal', subscription.goalId);
        if (!this.db.prepare("SELECT 1 FROM work_links WHERE threadId=? AND kind='goal' AND objectId=?").get(subscription.threadId, subscription.goalId)) return 'goal_unlinked';
      }
      return null;
    } catch (error) {
      if (error instanceof WorkThreadError && error.status === 404) return 'target_unavailable';
      throw error;
    }
  }
  private subscription(actor: WorkThreadActor, id: string, threads: ThreadAccess): ThreadSubscription {
    const row = this.db.prepare('SELECT * FROM thread_subscriptions WHERE id=?').get(id) as unknown as ThreadSubscription | undefined;
    if (!row) throw new SourceEventError(404, '订阅不存在或无权访问');
    this.get(actor, row.sourceId); threads.get(row.threadId);
    return { ...row };
  }
  policyContext(actor: WorkThreadActor, id: string, threads: ThreadAccess) {
    const subscription = this.subscription(actor, id, threads);
    return { subscription: this.subscriptionView(actor, subscription, threads), source: this.get(actor, subscription.sourceId) };
  }
  private subscriptionView(actor: WorkThreadActor, subscription: ThreadSubscription, threads: ThreadAccess): SubscriptionView {
    const reason = this.get(actor, subscription.sourceId).status === 'paused' ? 'source_paused' : this.unavailable(threads, subscription);
    return { ...subscription, available: !reason, unavailableReason: reason };
  }
  subscribe(actor: WorkThreadActor, input: SubscriptionRequest, now: string, threads: ThreadAccess): SubscriptionView {
    return this.tx.transaction(() => {
      const source = this.get(actor, input.sourceId); threads.get(input.threadId);
      const old = this.db.prepare('SELECT * FROM thread_subscriptions WHERE id=?').get(input.id) as unknown as ThreadSubscription | undefined;
      if (old) {
        this.subscription(actor, input.id, threads);
        if (old.sourceId !== input.sourceId || old.threadId !== input.threadId || old.goalId !== (input.goalId ?? null)) throw new SourceEventError(409, '订阅ID已用于其他来源或目标');
        return this.subscriptionView(actor, old, threads);
      }
      const reason = this.unavailable(threads, { threadId: input.threadId, goalId: input.goalId ?? null });
      if (reason) throw new SourceEventError(reason === 'target_unavailable' ? 404 : 409, '主题或已关联Goal不可用：' + reason);
      if (source.status !== 'active') throw new SourceEventError(409, '请先恢复来源观察');
      const duplicate = this.db.prepare('SELECT * FROM thread_subscriptions WHERE sourceId=? AND threadId=? AND goalId IS ?')
        .get(input.sourceId, input.threadId, input.goalId ?? null) as unknown as ThreadSubscription | undefined;
      if (duplicate) return this.subscriptionView(actor, duplicate, threads);
      if (Number(this.db.prepare('SELECT count(*) AS n FROM thread_subscriptions WHERE threadId=?').get(input.threadId)!.n) >= 100) throw new SourceEventError(409, '每个主题最多保留100个订阅');
      const after = this.db.prepare('SELECT id FROM source_events WHERE sourceId=? ORDER BY rowid DESC LIMIT 1').get(input.sourceId)?.id;
      this.db.prepare("INSERT INTO thread_subscriptions VALUES(?,?,?,?,NULL,NULL,'active',1,?,?,?)")
        .run(input.id, input.sourceId, input.threadId, input.goalId ?? null, after ?? null, now, now);
      return this.subscriptionView(actor, this.subscription(actor, input.id, threads), threads);
    });
  }
  subscriptions(actor: WorkThreadActor, threadId: string, threads: ThreadAccess): SubscriptionView[] {
    threads.get(threadId);
    return this.db.prepare('SELECT s.* FROM thread_subscriptions s JOIN event_sources e ON e.id=s.sourceId WHERE s.threadId=? AND e.owner=? AND e.channel=? ORDER BY s.createdAt,s.id LIMIT 100')
      .all(threadId, actor.owner, actor.channel).map(row => this.subscriptionView(actor, { ...row } as unknown as ThreadSubscription, threads));
  }
  setSubscriptionStatus(actor: WorkThreadActor, id: string, status: ThreadSubscription['status'], expectedRevision: number, now: string, threads: ThreadAccess): SubscriptionView {
    return this.tx.transaction(() => {
      const subscription = this.subscription(actor, id, threads);
      if (subscription.revision !== expectedRevision) throw new SourceEventError(409, '订阅版本已变化，请刷新');
      if (status === 'active') {
        const view = this.subscriptionView(actor, subscription, threads);
        if (!view.available) throw new SourceEventError(409, '来源或主题/Goal当前不可用：' + view.unavailableReason);
      }
      if (subscription.status !== status) {
        const after = this.db.prepare('SELECT id FROM source_events WHERE sourceId=? ORDER BY rowid DESC LIMIT 1').get(subscription.sourceId)?.id;
        this.db.prepare('UPDATE thread_subscriptions SET status=?,revision=revision+1,startAfterEvent=?,updatedAt=? WHERE id=?')
          .run(status, after ?? null, now, id);
      }
      return this.subscriptionView(actor, this.subscription(actor, id, threads), threads);
    });
  }
  private settleInTransaction(actor: WorkThreadActor, threads: ThreadAccess | undefined, now: string): void {
    const rows = this.db.prepare(`SELECT d.* FROM subscription_events d JOIN source_events v ON v.id=d.eventId
      JOIN event_sources e ON e.id=v.sourceId WHERE d.status='pending' AND e.owner=? AND e.channel=? ORDER BY v.rowid,d.subscriptionId LIMIT 100`)
      .all(actor.owner, actor.channel) as unknown as SubscriptionEvent[];
    for (const row of rows) {
      if (row.policyId) continue;
      const event = this.event(actor, row.eventId);
      const current = this.db.prepare('SELECT * FROM thread_subscriptions WHERE id=?').get(row.subscriptionId) as unknown as ThreadSubscription;
      const reason = current.revision !== row.subscriptionRevision ? 'subscription_changed' : current.status !== 'active' ? 'subscription_paused'
        : this.get(actor, event.sourceId).status !== 'active' ? 'source_paused' : this.unavailable(threads, current)
        ?? null;
      this.db.prepare("UPDATE subscription_events SET status=?,reason=?,decidedAt=? WHERE eventId=? AND subscriptionId=? AND status='pending'")
        .run(reason ? 'skipped' : 'observed', reason ?? 'no_policy', now, row.eventId, row.subscriptionId);
    }
  }
  settlePending(actor: WorkThreadActor, now: string, threads?: ThreadAccess): void {
    this.tx.transaction(() => this.settleInTransaction(actor, threads, now));
  }
  pendingPolicyEvents(actor: WorkThreadActor): Pick<SubscriptionEvent, 'eventId' | 'subscriptionId'>[] {
    return this.db.prepare(`SELECT d.eventId,d.subscriptionId FROM subscription_events d JOIN source_events v ON v.id=d.eventId
      JOIN event_sources e ON e.id=v.sourceId WHERE d.status='pending' AND d.policyId IS NOT NULL AND e.owner=? AND e.channel=?
      ORDER BY v.rowid,d.subscriptionId LIMIT 100`).all(actor.owner, actor.channel) as unknown as Pick<SubscriptionEvent, 'eventId' | 'subscriptionId'>[];
  }
  threadEvents(actor: WorkThreadActor, threadId: string, threads: ThreadAccess): ThreadSourceEvent[] {
    threads.get(threadId);
    return this.db.prepare(`SELECT d.*,g.executionRunId AS runId,x.status AS executionStatus FROM subscription_events d JOIN thread_subscriptions s ON s.id=d.subscriptionId
      JOIN event_sources e ON e.id=s.sourceId LEFT JOIN goal_grants g ON g.triggerId=d.triggerId AND g.segment=1
      LEFT JOIN goal_executions x ON x.runId=g.executionRunId WHERE s.threadId=? AND e.owner=? AND e.channel=? ORDER BY d.rowid DESC LIMIT 100`)
      .all(threadId, actor.owner, actor.channel).map(row => {
        const current = this.subscription(actor, String(row.subscriptionId), threads), view = this.subscriptionView(actor, current, threads);
        const event = this.db.prepare('SELECT id,sourceId,previous,head,observedAt,snapshotHash,legacyObservationId FROM source_events WHERE id=?').get(String(row.eventId)) as unknown as SourceEvent;
        return { ...row as unknown as SubscriptionEvent, runId: row.runId as string | null, executionStatus: row.executionStatus as ThreadSourceEvent['executionStatus'], event: { ...event }, source: this.get(actor, current.sourceId), available: view.available, unavailableReason: view.unavailableReason };
      });
  }
  failed(actor: WorkThreadActor, source: EventSource, error: unknown, now: string): void {
    this.tx.transaction(() => {
      if (!this.current(actor, source)) return;
      const failures = Math.min(source.failures + 1, 16), interval = source.watch.intervalSeconds;
      const nextAt = new Date(Date.parse(now) + Math.max(interval, Math.min(21600, interval * 2 ** Math.min(failures, 8))) * 1000).toISOString();
      this.db.prepare('UPDATE event_sources SET failures=?,lastError=?,nextAt=?,updatedAt=? WHERE id=?')
        .run(failures, this.tx.redact(error).slice(0, 1000), nextAt, now, source.id);
    });
  }
  events(actor: WorkThreadActor, sourceId: string): SourceEvent[] {
    this.get(actor, sourceId);
    return this.db.prepare('SELECT id,sourceId,previous,head,observedAt,snapshotHash,legacyObservationId FROM source_events WHERE sourceId=? ORDER BY rowid DESC LIMIT 100')
      .all(sourceId).map(row => ({ ...row } as unknown as SourceEvent));
  }
  event(actor: WorkThreadActor, id: string): SourceEventDetail {
    const row = this.db.prepare('SELECT * FROM source_events WHERE id=?').get(id);
    if (!row) throw new SourceEventError(404, '来源事件不存在');
    this.get(actor, String(row.sourceId));
    const { snapshotJson, ...event } = row;
    if (createHash('sha256').update(String(snapshotJson)).digest('hex') !== row.snapshotHash) throw new Error('来源事件快照Hash不一致，不能读取');
    return { ...event as unknown as SourceEvent, snapshot: JSON.parse(String(snapshotJson)) as GitHubSnapshot };
  }
}
