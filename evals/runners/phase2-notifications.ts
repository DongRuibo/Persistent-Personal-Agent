import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { notificationChild, notificationEnvironment, notificationEpoch } from '../environments/notifications.js';

export interface Phase2Context {
  root: string; target: string; trace: unknown[]; observations: Record<string, unknown>;
  check(name: string, passed: boolean, actual?: unknown, expected?: unknown): void;
}
type Accepted = { id: string; milliseconds: number; wallAt: number };
type Environment = Awaited<ReturnType<typeof notificationEnvironment>>;
async function using(c: Phase2Context, send: Parameters<typeof notificationEnvironment>[2], action: (f: Environment) => Promise<void>) {
  const f = await notificationEnvironment(c.root, c.target, send);
  try { await action(f); }
  finally { c.trace.push(f.snapshot()); await f.close(); }
}
function stages(c: Phase2Context, f: Environment, accepted: Accepted[], eligible = true, recovery = false) {
  const rows = f.rows(), sent = rows.some(row => row.status === 'sent') || !f.hasOutbox && f.store.listRuns().some(run => f.store.events(run.id).some(e => e.type === 'delivery_succeeded')),
    tasks = f.store.listTasks();
  c.observations = Object.assign(c.observations, { notification_eligible: eligible, task_succeeded: tasks.length > 0 && tasks.every(t => t.status === 'succeeded'),
    intent_persisted: rows.length > 0, local_sent: sent, external_acceptances: accepted.length,
    duplicates: accepted.length - new Set(accepted.map(item => item.id)).size,
    recovery_applicable: recovery, recovered: accepted.length > 0 && sent,
    first_acceptance_ms: accepted[0]?.milliseconds ?? null,
    first_acceptance_wall_ms: accepted.length && f.modelCompletedAt ? accepted[0]!.wallAt - f.modelCompletedAt : null, executions: f.executions, sends: f.attempts });
  c.trace.push({ external_acceptances: accepted });
}

export const notificationCases: Record<string, (c: Phase2Context) => Promise<void>> = {
  N01: async c => {
    const accepted: Accepted[] = [];
    await using(c, async (message, _attempt, milliseconds) => { accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() }); }, async f => {
      await f.produce(); c.check('执行终态与发送意图存在', f.store.listTasks()[0]?.status === 'succeeded' && f.rows().length === 1);
      await f.tick(); c.check('外部接受与本地sent分别确认', accepted.length === 1 && f.rows()[0]?.status === 'sent');
      stages(c, f, accepted);
    });
  },
  N02: async c => {
    const first = await notificationChild(c.root, c.target, 'inside-transaction', c.trace);
    try { first.child.send('produce'); await first.window(); }
    finally { c.check('未提交窗口真实SIGKILL', (await first.stop(true))[1] === 'SIGKILL'); }
    const second = await notificationChild(c.root, c.target, 'normal', c.trace);
    try {
      const ready = second.events.find(event => event.type === 'ready')!;
      const tasks = ready.tasks as { status: string }[], rows = ready.notifications as unknown[];
      c.check('结果与意图整体回滚后安全中断', tasks[0]?.status === 'interrupted' && rows.length === 0, ready);
      second.child.send('deliver'); const result = await second.wait('delivered');
      c.check('恢复不重跑模型', result.executions === 0);
      c.observations.notification_eligible = false;
    } finally { await second.stop(); }
  },
  N03: c => processDelivery(c, 'before-send'),
  N04: c => recoveringSend(c, 'timeout', 30000),
  N05: c => recoveringSend(c, 'rate_limited', 45000),
  N06: c => recoveringSend(c, 'transient_server_error', 30000),
  N07: c => recoveringSend(c, 'unknown', 30000, true),
  N08: c => processDelivery(c, 'accepted-stop'),
  N09: async c => {
    const accepted: Accepted[] = []; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    await using(c, async (message, _attempt, milliseconds) => { entered(); await gate; accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() }); }, async f => {
      if (!f.Worker) { c.check('独立通知Worker已实现', false); c.observations.comparison_supported = false; return; }
      await f.produce(); const work = f.tick(); await started;
      const otherStore = new f.Store(join(c.root, 'app.db')), other = new f.Worker(otherStore, f.channel, f.workerOptions, f.clock);
      try { await other.tick(); c.check('两个连接同刻只领取一次', f.attempts === 1 && f.rows()[0]?.status === 'sending'); }
      finally { release(); await work; await other.stop(); otherStore.close(); }
      c.check('唯一发送确认', accepted.length === 1 && f.rows()[0]?.status === 'sent'); stages(c, f, accepted);
    });
  },
  N10: async c => {
    const accepted: Accepted[] = [];
    await using(c, async (message, _attempt, milliseconds) => { accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() }); }, async f => {
      const task = await f.produce(), run = f.store.listRuns(task.id)[0]!; let rejected = false;
      try { if (f.hasOutbox) f.store.finishTaskRun(run.id, 'succeeded', notificationEpoch, '重复终态'); else f.store.finishRun(run.id, 'succeeded', notificationEpoch, '重复终态'); } catch { rejected = true; }
      await f.tick(); await f.tick();
      c.check('重复提交被拒绝且唯一通知', rejected && f.rows().length === 1 && accepted.length === 1 && f.executions === 1);
      stages(c, f, accepted);
    });
  },
  N11: async c => {
    await using(c, async () => { c.check('取消后不能发送', false); }, async f => {
      const task = f.store.createTask('已取消任务', notificationEpoch, notificationEpoch); f.store.cancelTask(task.id, notificationEpoch);
      const late = f.store.beginRun(task.id, notificationEpoch); let rejected = false;
      try { if (f.hasOutbox) f.store.finishTaskRun(late.id, 'succeeded', notificationEpoch, '迟到结果'); else f.store.finishRun(late.id, 'succeeded', notificationEpoch, '迟到结果'); } catch { rejected = true; }
      await f.tick(); c.check('pending取消后旧回调不得改变状态或入队', rejected && f.store.getTask(task.id)?.status === 'cancelled' && f.rows().length === 0 && f.attempts === 0);
      stages(c, f, [], false);
    });
  },
  N12: c => exhausted(c, false),
  N13: async c => {
    let f: Environment;
    await using(c, async () => { throw f.fault('permanent_error'); }, async env => {
      f = env;
      // 永久HTTP业务错误在入口归类，不依赖任意异常文本推测状态码。
      await f.produce(); await f.tick(); f.advance(90000); await f.tick();
      c.check('永久错误直接dead且不自动重试', f.rows()[0]?.status === 'dead' && f.rows()[0]?.attempts === 1);
      stages(c, f, []);
    });
  },
  N14: c => exhausted(c, true),
  N15: async c => {
    const f = await notificationEnvironment(c.root, c.target, async () => {}), actor = { ownerId: 'local-user', target: { channel: 'console' as const } };
    const source = f.store.beginRun(null, notificationEpoch), goal = f.store.goals.create(actor, source.id, '合成升级目标', notificationEpoch);
    f.store.finishRun(source.id, 'succeeded', notificationEpoch);
    const claim = f.store.goals.claim(actor, goal.id, goal.revision, notificationEpoch)!;
    f.store.goals.commit(claim.run.id, { stepOutcome: 'partial', artifactText: '旧成果', progressSummary: '等反馈', question: '继续吗？' }, notificationEpoch);
    await f.close();
    const db = new DatabaseSync(join(c.root, 'app.db'));
    db.exec(`DROP TABLE goal_notifications; CREATE TABLE goal_notifications (
      id TEXT PRIMARY KEY,runId TEXT NOT NULL UNIQUE REFERENCES goal_executions(runId),goalId TEXT NOT NULL REFERENCES goals(id),ownerId TEXT NOT NULL,
      targetJson TEXT NOT NULL CHECK(json_valid(targetJson)),goalRevision INTEGER NOT NULL,text TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('pending','sending','sent','dead')),
      attempts INTEGER NOT NULL,nextAt TEXT NOT NULL,lastError TEXT,createdAt TEXT NOT NULL) STRICT;`);
    db.prepare('INSERT INTO goal_notifications VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-notice', claim.run.id, goal.id, actor.ownerId,
      JSON.stringify(actor.target), 2, '旧持久通知', 'pending', 2, notificationEpoch, null, notificationEpoch); db.close();
    const migrated = new f.Store(join(c.root, 'app.db'));
    try {
      const row = migrated.notifications.listForHost()[0] as { id: string; attempts: number; status: string };
      c.check('旧ID状态次数和Checkpoint不变', row.id === 'legacy-notice' && row.attempts === 2 && row.status === 'pending'
        && migrated.goals.get(actor, goal.id).checkpointRunId === claim.run.id);
      const audit = new DatabaseSync(join(c.root, 'app.db')); c.check('迁移外键一致', audit.prepare('PRAGMA foreign_key_check').all().length === 0); audit.close();
      c.trace.push({ row, goal: migrated.goals.view(actor, goal.id) }); c.observations.notification_eligible = false;
    } finally { migrated.close(); }
  },
  N16: async c => {
    const accepted: Accepted[] = []; let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    await using(c, async (message, attempt, milliseconds) => { if (attempt === 1) { entered(); await gate; } accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() }); }, async f => {
      if (!f.Worker) { c.check('租约与fencing已实现', false); c.observations.comparison_supported = false; return; }
      await f.produce(); const old = f.tick(); await started; f.advance(31000);
      const otherStore = new f.Store(join(c.root, 'app.db')), other = new f.Worker(otherStore, f.channel, f.workerOptions, f.clock);
      try { await other.tick(); const token = f.rows()[0]?.leaseToken; release(); await old;
        c.check('旧租约回执不能覆盖新发送确认', token === null && f.rows()[0]?.status === 'sent' && f.rows()[0]?.attempts === 2 && f.rows()[0]?.uncertain === 1); }
      finally { release(); await old; await other.stop(); otherStore.close(); }
      c.check('租约过期可能重复，稳定ID不变', accepted.length === 2 && new Set(accepted.map(v => v.id)).size === 1); stages(c, f, accepted, true, true);
    });
  },
  N17: async c => {
    await using(c, async () => { c.check('入队事务失败不得投递', false); }, async f => {
      if (!f.hasOutbox) { c.check('Task聚合Outbox事务已实现', false); c.observations.comparison_supported = false; return; }
      const db = new DatabaseSync(join(c.root, 'app.db'));
      db.exec("CREATE TRIGGER fail_task_intent BEFORE INSERT ON goal_notifications BEGIN SELECT RAISE(ABORT,'synthetic_intent_failure'); END");
      let failed = false; try { await f.produce(); } catch { failed = true; }
      c.check('意图写入失败时Task与Run终态一起回滚', failed && f.store.listTasks()[0]?.status === 'running' && f.store.listRuns()[0]?.status === 'running' && f.rows().length === 0);
      db.exec('DROP TRIGGER fail_task_intent'); db.close(); f.store.recoverInterrupted(f.clock().toISOString()); await f.tick();
      c.check('核查中断，不重新执行模型补交', f.store.listTasks()[0]?.status === 'interrupted' && f.executions === 1 && f.attempts === 0);
      c.observations.notification_eligible = false;
    });
  },
  N18: async c => {
    const accepted: Accepted[] = [];
    await using(c, async (message, attempt, milliseconds) => {
      if (attempt === 1) await new Promise<void>(() => {});
      accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() });
    }, async f => {
      if (!f.hasOutbox) { c.check('独立Worker发送超时已实现', false); c.observations.comparison_supported = false; return; }
      f.workerOptions.timeoutMs = 5; await f.produce(); await f.tick();
      c.check('真正挂起的渠道被超时隔离', f.rows()[0]?.status === 'pending' && f.rows()[0]?.errorKind === 'timeout' && f.rows()[0]?.uncertain === 1);
      f.advance(30000); await f.tick(); c.check('超时后有界重发不重跑Task', accepted.length === 1 && f.rows()[0]?.status === 'sent' && f.executions === 1);
      stages(c, f, accepted, true, true);
    });
  },
};

async function recoveringSend(c: Phase2Context, kind: 'timeout' | 'rate_limited' | 'transient_server_error' | 'unknown', readyAt: number, ackLost = false) {
  const accepted: Accepted[] = []; let f: Environment;
  await using(c, async (message, attempt, milliseconds) => {
    if (attempt === 1) { if (ackLost) accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() }); throw f.fault(kind, kind === 'rate_limited' ? readyAt : undefined); }
    accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() });
  }, async env => {
    f = env; await f.produce(); await f.tick();
    c.check('失败不改变Task成功终态', f.store.listTasks()[0]?.status === 'succeeded' && f.executions === 1);
    f.advance(readyAt - 1); await f.tick(); c.check('未到退避期限不重发', f.attempts === 1);
    f.advance(readyAt); await f.tick();
    c.check('故障恢复后确认sent且不重跑Task', f.rows()[0]?.status === 'sent' && f.executions === 1 && f.attempts === 2);
    if (ackLost || kind === 'timeout') c.check('不确定性显式保留', f.rows()[0]?.uncertain === 1);
    const failures = f.store.listRuns().flatMap(run => f.store.events(run.id)).filter(e => e.type === 'delivery_failed');
    c.observations.classifications = [{ expected: kind, actual: failures[0]?.details?.startsWith('{') ? JSON.parse(failures[0].details).kind : 'unclassified' }];
    stages(c, f, accepted, true, true);
  });
}
async function exhausted(c: Phase2Context, manual: boolean) {
  const accepted: Accepted[] = []; let recover = false, f: Environment;
  await using(c, async (message, _attempt, milliseconds) => {
    if (!recover) throw f.fault('transient_server_error'); accepted.push({ id: message.notificationId ?? message.runId!, milliseconds, wallAt: Date.now() });
  }, async env => {
    f = env; await f.produce(); await f.tick(); f.advance(30000); await f.tick(); f.advance(90000); await f.tick(); f.advance(300000); await f.tick();
    c.check('三次上限进入dead且无第四次', f.rows()[0]?.status === 'dead' && f.attempts === 3);
    if (manual && f.hasOutbox) {
      const row = f.rows()[0]!; recover = true; f.store.notifications.retryDead(row.id, 'local-user', target => target.channel === 'console', f.clock().toISOString()); await f.tick();
      c.check('明确人工重发沿用ID且Task不重跑', f.rows()[0]?.id === row.id && f.rows()[0]?.status === 'sent' && f.rows()[0]?.manualRetries === 1 && f.executions === 1);
    } else if (manual) c.check('人工重发入口已实现', false);
    stages(c, f, accepted, true, manual);
  });
}
async function processDelivery(c: Phase2Context, mode: 'before-send' | 'accepted-stop') {
  const hasOutbox = existsSync(join(c.target, 'src/notification-worker.ts'));
  const first = await notificationChild(c.root, c.target, mode, c.trace);
  try { first.child.send('produce'); if (hasOutbox) { await first.wait('committed'); first.child.send('deliver'); } await first.window(); }
  finally { c.check('真实发送窗口SIGKILL', (await first.stop(true))[1] === 'SIGKILL'); }
  const second = await notificationChild(c.root, c.target, 'normal', c.trace);
  try {
    second.child.send('deliver'); const result = await second.wait('delivered');
    const rows = result.notifications as { status: string; uncertain?: number; attempts: number }[], tasks = result.tasks as { status: string }[];
    const file = join(c.root, 'accepted.jsonl'), accepted = existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    c.check('重启只恢复通知，不重跑Task', result.executions === 0 && tasks[0]?.status === 'succeeded');
    c.check('持久意图重启后确认sent', rows.length === 1 && rows[0]?.status === 'sent');
    if (mode === 'accepted-stop') c.check('已接受未确认允许重复且标不确定', accepted.length === 2 && rows[0]?.uncertain === 1);
    const completed = JSON.parse(readFileSync(join(c.root, 'model-finished.json'), 'utf8'));
    Object.assign(c.observations, { notification_eligible: true, task_succeeded: tasks[0]?.status === 'succeeded', intent_persisted: rows.length === 1,
      local_sent: rows[0]?.status === 'sent', external_acceptances: accepted.length, duplicates: accepted.length - new Set(accepted.map(v => v.id)).size,
      recovery_applicable: true, recovered: rows[0]?.status === 'sent', first_acceptance_ms: accepted.length ? 0 : null,
      first_acceptance_wall_ms: accepted.length ? accepted[0].wallAt - completed.wallAt : null, executions: 1 });
    c.trace.push({ accepted, recovered: result });
  } finally { await second.stop(); }
}
