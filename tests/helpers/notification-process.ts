import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// 对照实验明确选择冻结源码目录；子进程只得到隔离路径和假数据，不继承模型或飞书配置。
const [root, target, mode, now] = process.argv.slice(2);
if (!root || !target || !mode || !now) throw new Error('缺少通知进程参数');
const { SqliteStore } = await import(pathToFileURL(join(target, 'src/sqlite-store.ts')).href) as typeof import('../../src/sqlite-store.js');
const { TaskScheduler } = await import(pathToFileURL(join(target, 'src/scheduler.ts')).href) as typeof import('../../src/scheduler.js');
const { existsSync } = await import('node:fs');
const workerFile = join(target, 'src/notification-worker.ts');
const Worker = existsSync(workerFile) ? (await import(pathToFileURL(workerFile).href) as typeof import('../../src/notification-worker.js')).NotificationWorker : undefined;
const store = new SqliteStore(join(root, 'app.db')); store.recoverInterrupted(now);
const window = (name: string) => { writeFileSync(join(root, 'window.json'), JSON.stringify({ name, pid: process.pid })); process.kill(process.pid, 'SIGSTOP'); };
const channel = { sendMessage: async (message: import('../../src/contracts.js').OutboundMessage) => {
  if (mode === 'before-send') window('committed-before-send');
  appendFileSync(join(root, 'accepted.jsonl'), JSON.stringify({ id: message.notificationId ?? message.runId, at: now, wallAt: Date.now() }) + '\n');
  if (mode === 'accepted-stop') window('accepted-before-sent');
} };
// accepts仅供固定旧源码对照；新Worker使用明确的targetFilter。
const workerOptions = { ownerId: 'local-user', targetFilter: { channel: 'console' as const }, accepts: () => true, pollIntervalMs: 10, reportError() {} };
const worker = Worker ? new Worker(store, channel, workerOptions, () => new Date(now)) : undefined;
let executions = 0;
const scheduler = new TaskScheduler(store, { close: async () => {}, execute: async () => {
  executions++; writeFileSync(join(root, 'model-finished.json'), JSON.stringify({ wallAt: Date.now() })); return { text: '合成持久通知' };
} },
  channel, 10, () => {}, () => new Date(now), undefined, worker);
if (mode === 'inside-transaction' && 'enqueueTask' in store.notifications) {
  const enqueue = store.notifications.enqueueTask.bind(store.notifications);
  store.notifications.enqueueTask = (...args) => { enqueue(...args); window('intent-in-uncommitted-transaction'); };
}
if (mode === 'inside-transaction' && !Worker) {
  const finish = store.finishRun.bind(store);
  store.finishRun = (...args) => { window('model-finished-before-legacy-commit'); return finish(...args); };
}
process.on('message', async command => {
  if (command === 'produce') {
    if (mode === 'goal-running') {
      const { GoalRunner } = await import(pathToFileURL(join(target, 'src/goal-runner.ts')).href) as typeof import('../../src/goal-runner.js');
      const { BackgroundLane } = await import(pathToFileURL(join(target, 'src/background-lane.ts')).href) as typeof import('../../src/background-lane.js');
      const actor = { ownerId: 'local-user', target: { channel: 'console' as const } }, source = store.beginRun(null, now);
      store.goals.create(actor, source.id, '合成Goal强杀', now); store.finishRun(source.id, 'succeeded', now);
      const goalRunner = new GoalRunner(store, { close: async () => {}, execute: async () => { window('goal-running'); return { text: '不可提交' }; } },
        channel, new BackgroundLane(), { ownerId: actor.ownerId, notificationTarget: actor.target, accepts: () => true, pollIntervalMs: 10, reportError() {}, fatal() {} }, () => new Date(now));
      await goalRunner.tick(); return;
    }
    store.createTask('合成进程任务', now, now); await scheduler.tick();
    process.send?.({ type: 'committed', pid: process.pid, tasks: store.listTasks(), notifications: store.notifications.listForHost(), executions });
  }
  if (command === 'deliver') {
    if (worker) await worker.tick(); else await scheduler.tick();
    process.send?.({ type: 'delivered', tasks: store.listTasks(), notifications: store.notifications.listForHost(), executions });
  }
  if (command === 'stop') { await scheduler.stop(); await worker?.stop(); store.close(); process.disconnect(); }
});
process.send?.({ type: 'ready', pid: process.pid, tasks: store.listTasks(), notifications: store.notifications.listForHost(),
  goals: store.goals.list({ ownerId: 'local-user', target: { channel: 'console' } }).map(goal => store.goals.view({ ownerId: goal.ownerId, target: goal.target }, goal.id)) });
