import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import lockfile from 'proper-lockfile';
import { readConfig, redactor } from './config.js';
import { ConsoleChannel, consoleHelp } from './console-channel.js';
import { createPiExecutor } from './pi-executor.js';
import { TaskScheduler } from './scheduler.js';
import { SqliteStore } from './sqlite-store.js';
import { TaskService } from './task-service.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(consoleHelp); return; }
  if (args.some((arg) => arg !== '--daemon')) throw new Error('只支持 --daemon 或 --help');
  const config = readConfig();
  if (!config.apiKey || config.apiKey === '<REDACTED>') throw new Error('请先在本机 .env 或环境变量中设置 LLM_API_KEY');
  const redact = redactor(config.apiKey);
  const reportError = (error: unknown) => console.error(redact(error));
  // 数据库、WAL 和锁文件默认只允许当前 Unix 用户访问。
  process.umask(0o077);
  await mkdir(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  const release = await lockfile.lock(config.databasePath, {
    realpath: false, retries: 0, stale: 10000, update: 2000,
    onCompromised: (error) => { reportError(error); stop(); },
  });
  let store: SqliteStore | undefined;
  let executor: Awaited<ReturnType<typeof createPiExecutor>> | undefined;
  let scheduler: TaskScheduler | undefined;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    store = new SqliteStore(config.databasePath, redact);
    const tasks = new TaskService(store, config.timeZone);
    executor = await createPiExecutor(config, tasks);
    if (shutdown.signal.aborted) return;
    const recovered = store.recoverInterrupted(new Date().toISOString());
    const channel = new ConsoleChannel(redact);
    scheduler = new TaskScheduler(store, executor, channel, config.pollIntervalMs, reportError);
    scheduler.start();
    console.log(`Personal Agent 已启动；用户时区=${config.timeZone}；中断记录=${recovered}；模式=${args.includes('--daemon') ? 'daemon' : 'console'}`);
    if (args.includes('--daemon')) {
      if (!shutdown.signal.aborted) await once(shutdown.signal, 'abort');
    } else {
      await channel.run(executor, tasks, store, shutdown.signal);
    }
  } finally {
    stop();
    // 先中断并等待执行，再关闭存储；避免日志写入已关闭的数据库。
    try {
      await scheduler?.stop();
      await executor?.close();
    } finally {
      store?.close();
      await release();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}

main().catch((error: unknown) => {
  console.error(redactor(process.env.LLM_API_KEY || '')(error));
  process.exitCode = 1;
});
