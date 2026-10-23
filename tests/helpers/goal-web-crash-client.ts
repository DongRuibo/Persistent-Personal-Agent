import { join } from 'node:path';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { GoalRunner } from '../../src/goal-runner.js';
import { BackgroundLane } from '../../src/background-lane.js';

// 仅用于新临时目录与本机模型的真实子进程故障测试，不加载.env或真实网络配置。
const [root, base] = process.argv.slice(2);
if (!root || !base || !/^http:\/\/127\.0\.0\.1:\d+\/v1$/u.test(base)) throw new Error('仅接受本机模拟测试参数');
const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), GOAL_ENABLED: 'true', SKILLS_ENABLED: 'true',
  LLM_API_KEY: 'fake-crash', LLM_MODEL: 'local-stub', LLM_BASE_URL: base });
const store = new SqliteStore(config.databasePath), executor = await createPiExecutor(config, new TaskService(store, config.timeZone));
const runner = new GoalRunner(store, executor, { sendMessage: async () => {} }, new BackgroundLane(), {
  ownerId: 'local-user', accepts: target => target.channel === 'console', pollIntervalMs: 1000, reportError: error => { throw error; }, fatal: () => { throw new Error('测试不应停机'); },
});
try { await runner.tick(); } finally { await runner.stop(); await executor.close(); store.close(); }
