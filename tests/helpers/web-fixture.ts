import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { GoalService } from '../../src/goal-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { WebReadService } from '../../src/web-read-service.js';
import { defaultWebResources } from '../../src/web-read-types.js';
import type { MessageTarget } from '../../src/contracts.js';
import { installSkill } from './skills-fixture.js';
import type { Payload } from './skills-fixture.js';

export async function webFixture(handle: (payload: Payload, count: number) => string | Promise<string>, options: { enabled?: boolean; skills?: boolean; body?: string; hold?: Promise<void> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'web-e2e-')); const payloads: Payload[] = [], errors: unknown[] = [], fetched: string[] = [];
  let dns = 0, requests = 0, now = Date.now();
  const http = createServer(async (req, res) => { requests++; fetched.push(req.url!); await options.hold;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(options.body ?? 'MOCK_WEB_BODY：这是虚构文档，整理原生加载流程。'); });
  http.listen(0, '127.0.0.1'); await once(http, 'listening'); const httpAddress = http.address(); if (!httpAddress || typeof httpAddress === 'string') throw new Error('本机HTTP端口不可用');
  const model = createServer(async (req, res) => {
    try { let raw = ''; for await (const chunk of req) raw += chunk; const payload = JSON.parse(raw) as Payload; payloads.push(payload);
      const response = await handle(payload, payloads.length); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response);
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const modelAddress = model.address(); if (!modelAddress || typeof modelAddress === 'string') throw new Error('模拟模型端口不可用');
  const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), WEB_READ_ENABLED: String(options.enabled ?? true),
    SKILLS_ENABLED: String(options.skills ?? false), GOAL_ENABLED: 'true',
    LLM_API_KEY: 'fake-web', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${modelAddress.port}/v1` });
  if (options.skills) installSkill(config.skillsDir!);
  let store: SqliteStore, tasks: TaskService, memory: FileMemoryService, goals: GoalService, executor: Awaited<ReturnType<typeof createPiExecutor>>;
  const service = new WebReadService(defaultWebResources, async () => { dns++; return [{ address: '8.8.8.8', family: 4 }]; }, {
    get: async (target, signal) => {
      const id = defaultWebResources.find(item => item.url === target.url)?.id; if (!id || target.address.address !== '8.8.8.8') throw new Error('测试Transport收到非批准目标');
      return new Promise<Buffer>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${httpAddress.port}/${id}`, { signal }, res => {
          const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)));
        }); req.on('error', reject); req.end();
      });
    },
  });
  async function boot() {
    store = new SqliteStore(config.databasePath); tasks = new TaskService(store, config.timeZone, () => new Date(now)); memory = new FileMemoryService(config.memoryDir);
    goals = new GoalService(store, tasks, () => {});
    executor = await createPiExecutor(config, tasks, 'console', memory, undefined, undefined, goals, { service, store: store.web });
  }
  await boot();
  return { root, config, service, payloads, errors, fetched, get store() { return store; }, get executor() { return executor; }, get tasks() { return tasks; }, get memory() { return memory; }, get goals() { return goals; },
    get dns() { return dns; }, get requests() { return requests; }, advance(ms: number) { now += ms; },
    async chat(prompt = '请读取 Pi Skills 文档，并总结加载流程', delivered = true, target: MessageTarget = { channel: 'console' }) {
      const run = store.beginRun(null, new Date(now).toISOString());
      try { const result = await tasks.withTarget(target, () => executor.execute({ prompt, scope: 'chat', signal: new AbortController().signal,
        source: { channel: target.channel, reference: run.id }, observer: store.observer(run.id) }));
        store.finishRun(run.id, 'succeeded', new Date(now).toISOString(), result.text);
        if (delivered) store.event(run.id, 'delivery_succeeded'); else store.deliveryFailed(run.id, '模拟发送失败');
        return { ...result, run };
      } catch (error) { store.finishRun(run.id, 'failed', new Date(now).toISOString(), undefined, String(error)); throw error; }
    },
    async restart() { await executor.close(); memory.close(); store.close(); await boot(); },
    async close() { await executor.close(); memory.close(); store.close(); http.closeAllConnections(); model.closeAllConnections(); await Promise.all([
      new Promise<void>(done => http.close(() => done())), new Promise<void>(done => model.close(() => done())),
    ]); },
  };
}
