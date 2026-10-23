import { request } from 'node:http';
import { join } from 'node:path';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { WebReadService } from '../../src/web-read-service.js';
import { defaultWebResources } from '../../src/web-read-types.js';

// 子进程故障注入只接收测试父进程的临时根目录及两个loopback端点，不加载.env。
const [root, modelUrl, httpUrl] = process.argv.slice(2);
if (!root || !modelUrl || !httpUrl || [modelUrl, httpUrl].some(url => new URL(url).hostname !== '127.0.0.1')) throw new Error('仅允许本机隔离故障注入');
const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), LLM_API_KEY: 'fake-web-crash', LLM_MODEL: 'local-stub', LLM_BASE_URL: modelUrl, WEB_READ_ENABLED: 'true' });
const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone);
const service = new WebReadService(defaultWebResources, async () => [{ address: '8.8.8.8', family: 4 }], {
  get: async (_target, signal) => new Promise<Buffer>((resolve, reject) => {
    const req = request(httpUrl, { signal }, res => {
      const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)));
    }); req.on('error', reject); req.end();
  }),
});
const executor = await createPiExecutor(config, tasks, 'console', undefined, undefined, undefined, undefined, { service, store: store.web });
const run = store.beginRun(null, new Date().toISOString());
try {
  await executor.execute({ scope: 'chat', prompt: '请读取 Pi Skills 文档', signal: new AbortController().signal, source: { channel: 'console', reference: run.id }, observer: store.observer(run.id) });
} finally { await executor.close(); store.close(); }
