import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { GoalService } from '../../src/goal-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { WebUiChannel, webChatKey } from '../../src/web-ui-channel.js';
import { WebUiServer } from '../../src/web-ui-server.js';
import { initializeOutput } from '../../src/file-output-service.js';
import { BackgroundLane } from '../../src/background-lane.js';
import { reply } from './skills-fixture.js';
import type { Payload } from './skills-fixture.js';

export async function webUiFixture(handle: (p: Payload) => string | Promise<string> = () => reply('真实 Pi 路径的模拟回答')) {
  const root = mkdtempSync(join(tmpdir(), 'ppa-web-ui-')), payloads: Payload[] = [], errors: unknown[] = [];
  const model = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const part of req) raw += part;
      const p = JSON.parse(raw) as Payload; payloads.push(p);
      const response = await handle(p); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response);
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const a = model.address();
  if (!a || typeof a === 'string') throw new Error('fixture port');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), GOAL_ENABLED: 'true', LLM_API_KEY: 'fake-web-llm',
    LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${a.port}/v1` });
  const output = join(root, 'output'); initializeOutput(output); config.localOutput = { enabled: true, workspace: output };
  const key = 'fake-web-access-key-with-32-bytes-for-tests';
  let store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
  let goals = new GoalService(store, tasks, () => {}), lane = new BackgroundLane();
  let executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, lane, goals, undefined, store.files);
  let channel = new WebUiChannel(store, tasks, executor, config, goals, lane, error => errors.push(error));
  let server = new WebUiServer(channel, key, join(process.cwd(), 'web-dist')), origin = await server.start(0), cookie = '', csrf = '';
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(body === undefined ? {} : {
      Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async () => {
    const response = await request('/api/login', { key }); cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    csrf = (await response.json() as { csrf: string }).csrf; return response;
  };
  return { root, output, config, payloads, errors, key, request, login, get origin() { return origin; },
    get store() { return store; }, get tasks() { return tasks; }, get goals() { return goals; }, get channel() { return channel; },
    get executor() { return executor; }, get lane() { return lane; }, get memory() { return memory; },
    async restart() {
      await server.stop(); await executor.close(); store.close(); memory.close();
      store = new SqliteStore(config.databasePath); store.recoverInterrupted(new Date().toISOString());
      tasks = new TaskService(store, config.timeZone); memory = new FileMemoryService(config.memoryDir);
      goals = new GoalService(store, tasks, () => {}); lane = new BackgroundLane();
      executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, lane, goals, undefined, store.files);
      channel = new WebUiChannel(store, tasks, executor, config, goals, lane, error => errors.push(error));
      server = new WebUiServer(channel, key, join(process.cwd(), 'web-dist')); origin = await server.start(0); cookie = ''; csrf = '';
    },
    async close() { await server.stop(); await executor.close(); store.close(); memory.close(); model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); },
  };
}
