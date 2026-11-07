import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskScheduler } from '../src/scheduler.js';
import { WorkRunner } from '../src/work-runner.js';
import { NotificationWorker } from '../src/notification-worker.js';
import { BackgroundLane } from '../src/background-lane.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { AgentExecutor, Channel, OutboundMessage } from '../src/contracts.js';

const epoch = '2026-11-07T00:00:00.000Z', actor = { owner: webOwner, channel: JSON.stringify(webTarget) };

test('B07当前契约：立即与29999ms均不重发，30000ms恢复且Task只执行一次', async () => {
  const store = new SqliteStore(':memory:'); let now = new Date(epoch), executions = 0, attempts = 0;
  const delivered: OutboundMessage[] = [];
  const task = store.createTask('合成当前退避契约', epoch, epoch);
  const scheduler = new TaskScheduler(store, { close: async () => {}, execute: async () => { executions++; return { text: '唯一结果' }; } },
    { sendMessage: async message => { if (++attempts === 1) throw new Error('合成发送前失败'); delivered.push(message); } }, 10, () => {}, () => now);
  try {
    await scheduler.tick(); const id = store.notifications.listForHost()[0]!.id;
    assert.equal(store.getTask(task.id)?.status, 'succeeded'); assert.equal(store.notifications.listForHost()[0]!.status, 'pending');
    await scheduler.tick(); assert.equal(attempts, 1);
    now = new Date(Date.parse(epoch) + 29999); await scheduler.tick(); assert.equal(attempts, 1);
    now = new Date(Date.parse(epoch) + 30000); await scheduler.tick();
    assert.equal(attempts, 2); assert.equal(executions, 1); assert.equal(delivered.length, 1);
    assert.equal(delivered[0]?.notificationId, id); assert.equal(store.notifications.listForHost()[0]?.status, 'sent');
    assert.equal(store.getTask(task.id)?.status, 'succeeded'); assert.equal(store.listRuns(task.id).length, 1);
  } finally { await scheduler.stop(); store.close(); }
});

test('集成：慢Task通知不占模型门，WorkJob独立领取/回写/通知且不会进入Task Outbox', async () => {
  const store = new SqliteStore(':memory:'), lane = new BackgroundLane(), calls: string[] = [], sent: OutboundMessage[] = [];
  const thread = store.workThreads.create(actor, randomUUID(), '隔离主题', epoch);
  const job = store.workJobs.create(actor, thread.id, randomUUID(), '合成工作', epoch);
  const task = store.createTask('合成提醒', epoch, epoch, webTarget);
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const channel: Channel = { sendMessage: async message => { sent.push(message); if (message.taskId) { entered(); await hold; } } };
  const executor: AgentExecutor = { close: async () => {}, execute: async request => { calls.push(request.scope); return { text: request.scope + '唯一成果' }; } };
  const worker = new NotificationWorker(store, channel, { ownerId: 'local-user', accepts: t => t.channel === 'web', pollIntervalMs: 10, reportError: e => { throw e; } }, () => new Date(epoch));
  const scheduler = new TaskScheduler(store, executor, channel, 10, e => { throw e; }, () => new Date(epoch), lane, worker);
  const runner = new WorkRunner(store, executor, channel, lane, { actor, target: webTarget, pollIntervalMs: 10, goalReady: () => false,
    reportError: e => { throw e; }, fatal: () => assert.fail('聚合提交不应失败') }, () => new Date(epoch));
  let sending: Promise<void> | undefined;
  try {
    await Promise.all([runner.tick(), scheduler.tick()]);
    assert.equal(store.workJobs.get(actor, job.id).status, 'queued'); assert.deepEqual(calls, ['task']);
    sending = worker.tick(); await started;
    await Promise.all([worker.tick(), runner.tick(), runner.tick(), scheduler.tick()]);
    const done = store.workJobs.get(actor, job.id), taskRun = store.listRuns(task.id)[0]!;
    assert.equal(done.status, 'succeeded'); assert.deepEqual(calls, ['task', 'work']);
    assert.equal(store.notifications.listForHost().length, 1); assert.equal(store.notifications.listForHost()[0]?.runId, taskRun.id);
    assert.equal(store.notifications.listForHost()[0]?.status, 'sending');
    assert.throws(() => store.finishTaskRun(done.runId!, 'succeeded', epoch, '错误入口'), /Task Run/);
    assert.throws(() => store.finishRun(done.runId!, 'succeeded', epoch), /WorkJobStore/);
    assert.equal(store.getRun(done.runId!)?.taskId, null); assert.equal(sent.length, 2);
    assert.equal(sent.filter(m => m.notificationId).length, 1); assert.ok(sent.some(m => m.runId === done.runId && !m.notificationId));
    assert.equal(store.events(done.runId!).filter(e => e.type === 'delivery_succeeded').length, 1);
    release(); await sending; assert.equal(store.notifications.listForHost()[0]?.status, 'sent');
    assert.equal(store.getRun(done.runId!)?.output, 'work唯一成果'); assert.equal(store.getTask(task.id)?.status, 'succeeded');
    assert.equal(store.events(taskRun.id).filter(e => e.type === 'delivery_succeeded').length, 1);
  } finally { release(); await sending; await Promise.all([scheduler.stop(), runner.stop(), worker.stop()]); store.close(); }
});

test('集成恢复：同库Task/Goal/WorkJob各自中断，queued保留，仅已完成Task的意图恢复投递', async () => {
  const root = mkdtempSync(join(tmpdir(), 'phase3-mixed-')), path = join(root, 'mixed.db'); let store = new SqliteStore(path);
  try {
    const thread = store.workThreads.create(actor, randomUUID(), '重启合成主题', epoch);
    const runningJob = store.workJobs.create(actor, thread.id, randomUUID(), '运行中工作', epoch); store.workJobs.claim(actor, epoch);
    const queued = store.workJobs.create(actor, thread.id, randomUUID(), '保留排队', epoch);
    const completed = store.createTask('已完成等待通知', epoch, epoch), claim = store.claimDue(epoch)!;
    store.finishTaskRun(claim.run.id, 'succeeded', epoch, '已完成成果'); const noticeId = store.notifications.listForHost()[0]!.id;
    const runningTask = store.createTask('运行中提醒', epoch, epoch); store.claimDue(epoch);
    const ga = { ownerId: 'local-user', target: { channel: 'console' as const } }, source = store.beginRun(null, epoch);
    const goal = store.goals.create(ga, source.id, '合成目标', epoch); store.finishRun(source.id, 'succeeded', epoch);
    store.goals.claim(ga, goal.id, goal.revision, epoch);
    store.close(); store = new SqliteStore(path); assert.equal(store.recoverInterrupted(epoch), 3);
    assert.equal(store.getTask(completed.id)?.status, 'succeeded'); assert.equal(store.getTask(runningTask.id)?.status, 'interrupted');
    assert.equal(store.workJobs.get(actor, runningJob.id).status, 'interrupted'); assert.equal(store.workJobs.get(actor, queued.id).status, 'queued');
    assert.equal(store.goals.get(ga, goal.id).status, 'blocked'); assert.equal(store.notifications.listForHost().length, 1);
    const sent: OutboundMessage[] = [];
    const worker = new NotificationWorker(store, { sendMessage: async m => { sent.push(m); } }, {
      ownerId: 'local-user', accepts: () => true, pollIntervalMs: 10, reportError: e => { throw e; } }, () => new Date(epoch));
    try { await worker.tick(); await worker.tick(); } finally { await worker.stop(); }
    assert.equal(sent.length, 1); assert.equal(sent[0]?.notificationId, noticeId); assert.equal(sent[0]?.taskId, completed.id);
    assert.equal(store.workJobs.get(actor, queued.id).runId, null); assert.equal(store.recoverInterrupted(epoch), 0);
    assert.equal(store.notifications.listForHost()[0]?.status, 'sent');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
