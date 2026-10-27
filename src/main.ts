import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import lockfile from 'proper-lockfile';
import { readConfig, readFeishuConfig, redactor } from './config.js';
import { ConsoleChannel, consoleHelp } from './console-channel.js';
import { createPiExecutor } from './pi-executor.js';
import { WebReadService } from './web-read-service.js';
import { TaskScheduler } from './scheduler.js';
import { SqliteStore } from './sqlite-store.js';
import { TaskService } from './task-service.js';
import { ChannelRouter } from './channel-router.js';
import { FeishuChannel } from './feishu-channel.js';
import { FeishuSdkTransport } from './feishu-transport.js';
import { FileMemoryService } from './memory-service.js';
import { FormationService } from './formation-service.js';
import { BackgroundLane } from './background-lane.js';
import { GoalRunner } from './goal-runner.js';
import { GoalService } from './goal-service.js';
import { GitHubObserver } from './github-observer.js';

export async function main(webService?: WebReadService): Promise<void> {
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
  let goalRunner: GoalRunner | undefined;
  const lane = new BackgroundLane();
  let memory: FileMemoryService | undefined;
  let formation: FormationService | undefined;
  let releaseMemory: (() => Promise<void>) | undefined;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    store = new SqliteStore(config.databasePath, redact);
    if (config.proactive) store.policies.configure(config.proactive);
    if (config.proactive?.enabled) store.policies.observer = new GitHubObserver();
    if (!feishuConfig && store.hasPendingFeishuTasks()) {
      throw new Error('数据库中有待执行的飞书任务，请使用 --feishu 启动；Console 调试请使用独立 DATABASE_PATH');
    }
    const tasks = new TaskService(store, config.timeZone);
    await mkdir(config.memoryDir, { recursive: true, mode: 0o700 });
    releaseMemory = await lockfile.lock(config.memoryDir, {
      realpath: false, retries: 0, stale: 10000, update: 2000,
      onCompromised: (error) => { reportError(error); stop(); },
    });
    memory = new FileMemoryService(config.memoryDir, [config.apiKey, process.env.FEISHU_APP_SECRET ?? '']);
    const chatKey = feishuConfig ? JSON.stringify(['feishu', feishuConfig.appId, feishuConfig.allowedOpenId]) : 'console';
    if (config.formation?.enabled) formation = new FormationService({ ...config.formation, owner: createHash('sha256').update(chatKey).digest('hex') }, store, { listForHost: () => memory!.listForHost() }, [config.apiKey, process.env.FEISHU_APP_SECRET ?? '']);
    const goals = config.goalEnabled ? new GoalService(store, tasks, id => goalRunner?.interrupt(id)) : undefined;
    executor = await createPiExecutor(config, tasks, chatKey, memory, formation, lane, goals,
      config.webReadEnabled ? { service: webService ?? new WebReadService(), store: store.web } : undefined,store.files);
    if (shutdown.signal.aborted) return;
    const recovered = store.recoverInterrupted(new Date().toISOString());
    const otherGoals = config.goalEnabled ? store.goals.readyForHost().filter(goal => goal.ownerId !== 'local-user' || (feishuConfig
      ? goal.target.channel !== 'feishu' || goal.target.appId !== feishuConfig.appId || goal.target.userOpenId !== feishuConfig.allowedOpenId
      : goal.target.channel !== 'console')) : [];
    if (otherGoals.length) console.error(`有${otherGoals.length}个其他身份或渠道的Goal等待原绑定启动；本进程不会领取或改发。`);
    const consoleChannel = new ConsoleChannel(redact, config.proactive?.enabled);
    if (feishuConfig) {
      const transport = new FeishuSdkTransport(feishuConfig, reportError, () => { process.exitCode = 1; stop(); });
      feishu = new FeishuChannel(feishuConfig, transport, executor, tasks, store, redact, reportError, formation, lane);
      await feishu.start();
    }
    if (shutdown.signal.aborted) return;
    const channels = new ChannelRouter(consoleChannel, feishu);
    scheduler = new TaskScheduler(store, executor, channels, config.pollIntervalMs, reportError, () => new Date(), lane);
    if (goals) goalRunner = new GoalRunner(store, executor, channels, lane, { ownerId: 'local-user', pollIntervalMs: config.pollIntervalMs,
      accepts: target => feishuConfig ? target.channel === 'feishu' && target.appId === feishuConfig.appId && target.userOpenId === feishuConfig.allowedOpenId : target.channel === 'console',
      reportError, proactiveEnabled: config.proactive?.enabled, fatal: () => { process.exitCode = 1; stop(); }, delivered: (goal, runId) => goals.displayed(goal, runId) });
    store.policies.interrupt = id => goalRunner?.interrupt(id);
    scheduler.start();
    goalRunner?.start();
    formation?.start();
    console.log(`Personal Agent 已启动；用户时区=${config.timeZone}；中断记录=${recovered}；模式=${feishu ? 'feishu' : args.includes('--daemon') ? 'daemon' : 'console'}；Goal=${config.goalEnabled ? 'enabled' : 'disabled'}`);
    if (args.includes('--daemon') || feishu) {
      if (!shutdown.signal.aborted) await once(shutdown.signal, 'abort');
    } else {
      await consoleChannel.run(executor, tasks, store, shutdown.signal, formation);
    }
  } finally {
    stop();
    // 先中断并等待执行，再关闭存储；避免日志写入已关闭的数据库。
    try {
      await formation?.stop();
      await Promise.all([scheduler?.stop(), goalRunner?.stop(), feishu?.stop()]);
      await executor?.close();
    } finally {
      store?.close();
      memory?.close();
      await releaseMemory?.();
      await release();
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch((error: unknown) => {
  console.error(redactor(process.env.LLM_API_KEY || '', process.env.FEISHU_APP_SECRET)(error));
  process.exitCode = 1;
});
