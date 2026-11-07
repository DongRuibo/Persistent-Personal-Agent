import { fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentExecutor, OutboundMessage } from '../../src/contracts.js';
import type { Notification } from '../../src/goal-notification-store.js';
export const notificationEpoch = '2026-11-07T00:00:00.000Z';

export async function notificationEnvironment(root: string, target: string,
  send: (message: OutboundMessage, attempt: number, milliseconds: number) => Promise<void>) {
  const Store = (await import(pathToFileURL(join(target, 'src/sqlite-store.ts')).href) as typeof import('../../src/sqlite-store.js')).SqliteStore;
  const Scheduler = (await import(pathToFileURL(join(target, 'src/scheduler.ts')).href) as typeof import('../../src/scheduler.js')).TaskScheduler;
  const file = join(target, 'src/notification-worker.ts');
  const Worker = existsSync(file) ? (await import(pathToFileURL(file).href) as typeof import('../../src/notification-worker.js')).NotificationWorker : undefined;
  const faults = existsSync(join(target, 'src/execution-failure.ts'))
    ? await import(pathToFileURL(join(target, 'src/execution-failure.ts')).href) as typeof import('../../src/execution-failure.js') : undefined;
  let milliseconds = 0, executions = 0, attempts = 0, modelCompletedAt = 0;
  const store = new Store(join(root, 'app.db')), errors: string[] = [];
  const channel = { sendMessage: async (message: OutboundMessage) => { attempts++; await send(message, attempts, milliseconds); } };
  const clock = () => new Date(Date.parse(notificationEpoch) + milliseconds);
  const workerOptions = { ownerId: 'local-user', targetFilter: { channel: 'console' as const }, accepts: () => true, pollIntervalMs: 10, timeoutMs: 1000, reportError: (error: unknown) => { errors.push(String(error)); } };
  const worker = Worker ? new Worker(store, channel, workerOptions, clock) : undefined;
  const executor: AgentExecutor = { close: async () => {}, execute: async () => { executions++; modelCompletedAt = Date.now(); return { text: '合成任务成果' }; } };
  const scheduler = new Scheduler(store, executor, channel, 10, error => errors.push(String(error)), clock, undefined, worker);
  return { store, Worker, Store, workerOptions, channel, clock, errors, root, target,
    get executions() { return executions; }, get attempts() { return attempts; }, get hasOutbox() { return !!Worker; },
    get modelCompletedAt() { return modelCompletedAt; },
    advance(ms: number) { milliseconds = ms; },
    fault(kind: 'timeout' | 'unknown' | 'rate_limited' | 'transient_server_error' | 'permanent_error', retryAfterMs?: number) {
      return faults ? new faults.ExecutionFailure(kind, kind === 'rate_limited' ? 429 : kind === 'transient_server_error' ? 500 : undefined, retryAfterMs)
        : Object.assign(new Error(kind), { kind, retryAfterMs });
    },
    async produce() { const task = store.createTask('合成通知任务', clock().toISOString(), clock().toISOString()); await scheduler.tick(); return task; },
    async tick() { if (worker) await worker.tick(); else await scheduler.tick(); },
    rows() { return store.notifications.listForHost() as Notification[]; },
    snapshot() { return { tasks: store.listTasks(), runs: store.listRuns().map(run => ({ ...run, events: store.events(run.id) })), notifications: store.notifications.listForHost(), attempts, executions }; },
    async close() { await scheduler.stop(); await worker?.stop(); store.close(); },
  };
}

export async function notificationChild(root: string, target: string, mode: string, trace: unknown[], now = notificationEpoch) {
  const child = fork(new URL('../../tests/helpers/notification-process.ts', import.meta.url), [root, target, mode, now], {
    execArgv: ['--import', 'tsx'], env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR, LANG: 'en_US.UTF-8' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const events: { type: string; [key: string]: unknown }[] = []; let stderr = '';
  child.on('message', event => events.push(event as typeof events[number])); child.stderr!.on('data', value => { stderr += String(value); });
  const exited = once(child, 'exit');
  async function wait(type: string) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const event = events.find(event => event.type === type); if (event) return event;
      if (child.exitCode !== null || child.signalCode) throw new Error(`通知子进程提前退出：${stderr}`);
      await delay(10);
    }
    throw new Error(`等待通知进程${type}超时`);
  }
  try { await wait('ready'); } catch (error) { child.kill('SIGKILL'); await exited; throw error; }
  return { child, events, wait,
    async window() {
      const end = Date.now() + 10000;
      while (Date.now() < end) { if (existsSync(join(root, 'window.json'))) return JSON.parse(readFileSync(join(root, 'window.json'), 'utf8')); await delay(10); }
      throw new Error('等待真实SIGSTOP窗口超时');
    },
    async stop(kill = false) {
      if (kill) child.kill('SIGKILL'); else child.send('stop');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000), exit = await exited; clearTimeout(timer);
      trace.push({ pid: child.pid, events, exit, stderr }); return exit;
    },
  };
}
