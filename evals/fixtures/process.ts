import { join } from 'node:path';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskScheduler } from '../../src/scheduler.js';
import type { AgentExecutor } from '../../src/contracts.js';

// 独立OS进程使用真实Store/Scheduler；强杀发生在execute已进入后。
const [root, now, mode] = process.argv.slice(2);
if (!root || !now) throw new Error('缺少隔离进程参数');
const store = new SqliteStore(join(root, 'app.db'));
const recovered = store.recoverInterrupted(now);
const executor: AgentExecutor = { close: async () => {}, execute: async request => {
  process.send?.({ type: 'entered', pid: process.pid, prompt: request.prompt });
  if (mode === 'hold') await new Promise<void>(() => {});
  return { text: '离线提醒已执行' };
} };
const scheduler = new TaskScheduler(store, executor, { sendMessage: async message => {
  if (mode === 'commit-hold') { process.send?.({ type: 'before_delivery', message }); await new Promise<void>(() => {}); }
  process.send?.({ type: 'delivery', message });
} }, 10,
  error => process.send?.({ type: 'error', error: String(error) }), () => new Date(now));
process.on('message', async command => {
  if (command === 'tick') { await scheduler.tick(); process.send?.({ type: 'ticked', tasks: store.listTasks(), runs: store.listRuns() }); }
  if (command === 'stop') { await scheduler.stop(); store.close(); process.disconnect(); }
});
process.send?.({ type: 'ready', pid: process.pid, recovered, tasks: store.listTasks(), runs: store.listRuns() });
