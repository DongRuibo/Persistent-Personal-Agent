import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { once } from 'node:events';
import lockfile from 'proper-lockfile';
import { readConfig, readFeishuConfig, redactor } from './config.js';
import { ConsoleChannel, consoleHelp } from './console-channel.js';
import { createPiExecutor } from './pi-executor.js';
import { TaskScheduler } from './scheduler.js';
import { SqliteStore } from './sqlite-store.js';
import { TaskService } from './task-service.js';
import { ChannelRouter } from './channel-router.js';
import { FeishuChannel } from './feishu-channel.js';
import { FeishuSdkTransport } from './feishu-transport.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(consoleHelp); return; }
  if (args.some((arg) => !['--daemon', '--feishu'].includes(arg)) || (args.includes('--daemon') && args.includes('--feishu'))) {
    throw new Error('请选择 --daemon、--feishu 或默认终端模式；帮助使用 --help');
  }
  const config = readConfig();
  if (!config.apiKey || config.apiKey === '<REDACTED>') throw new Error('请先在本机 .env 或环境变量中设置 LLM_API_KEY');
  const feishuConfig = args.includes('--feishu') ? readFeishuConfig() : undefined;
  const redact = redactor(config.apiKey, feishuConfig?.appSecret, process.env.FEISHU_APP_SECRET);
  const reportError = (error: unknown) => console.error(redact(error));
  // 数据库、WAL 和锁文件默认只允许当前 Unix 用户访问。
  process.umask(0o077);
  await mkdir(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const shutdown = new AbortController();
  let feishu: FeishuChannel | undefined;
  const stop = () => {
    shutdown.abort();
    void feishu?.stop().catch(reportError);
  };
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
    if (!feishuConfig && store.hasPendingFeishuTasks()) {
      throw new Error('数据库中有待执行的飞书任务，请使用 --feishu 启动；Console 调试请使用独立 DATABASE_PATH');
    }
    const tasks = new TaskService(store, config.timeZone);
    const chatKey = feishuConfig ? JSON.stringify(['feishu', feishuConfig.appId, feishuConfig.allowedOpenId]) : 'console';
    executor = await createPiExecutor(config, tasks, chatKey);
    if (shutdown.signal.aborted) return;
    const recovered = store.recoverInterrupted(new Date().toISOString());
    const consoleChannel = new ConsoleChannel(redact);
    if (feishuConfig) {
      const transport = new FeishuSdkTransport(feishuConfig, reportError, () => { process.exitCode = 1; stop(); });
      feishu = new FeishuChannel(feishuConfig, transport, executor, tasks, store, redact, reportError);
      await feishu.start();
    }
    if (shutdown.signal.aborted) return;
    scheduler = new TaskScheduler(store, executor, new ChannelRouter(consoleChannel, feishu), config.pollIntervalMs, reportError);
    scheduler.start();
    console.log(`Personal Agent 已启动；用户时区=${config.timeZone}；中断记录=${recovered}；模式=${feishu ? 'feishu' : args.includes('--daemon') ? 'daemon' : 'console'}`);
    if (args.includes('--daemon') || feishu) {
      if (!shutdown.signal.aborted) await once(shutdown.signal, 'abort');
    } else {
      await consoleChannel.run(executor, tasks, store, shutdown.signal);
    }
  } finally {
    stop();
    // 先中断并等待执行，再关闭存储；避免日志写入已关闭的数据库。
    try {
      await Promise.all([scheduler?.stop(), feishu?.stop()]);
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
  console.error(redactor(process.env.LLM_API_KEY || '', process.env.FEISHU_APP_SECRET)(error));
  process.exitCode = 1;
});
