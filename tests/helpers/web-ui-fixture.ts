import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readConfig, redactor } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { GoalService } from '../../src/goal-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { WebUiChannel, webChatKey } from '../../src/web-ui-channel.js';
import { WebUiServer } from '../../src/web-ui-server.js';
import { initializeOutput } from '../../src/file-output-service.js';
import type { TavilyService } from '../../src/tavily-service.js';
import { WorkRunner } from '../../src/work-runner.js';
import { BackgroundLane } from '../../src/background-lane.js';
import { reply } from './skills-fixture.js';
import type { Payload } from './skills-fixture.js';

export async function webUiFixture(handle: (p: Payload) => string | Promise<string> = () => reply('真实 Pi 路径的模拟回答'), search?: TavilyService, workThreads = false, workJobs = false, workRouting = false) {
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
    WORK_ROUTING_ENABLED: String(workRouting), WORK_JOBS_ENABLED: String(workJobs), WORK_THREADS_ENABLED: String(workThreads), WEB_SEARCH_ENABLED: String(!!search), LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${a.port}/v1` });
  const output = join(root, 'output'); initializeOutput(output); config.localOutput = { enabled: true, workspace: output };
  const key = 'fake-web-access-key-with-32-bytes-for-tests';
  let store = new SqliteStore(config.databasePath, redactor(config.apiKey, key)), tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
  let goals = new GoalService(store, tasks, () => {}), lane = new BackgroundLane();
  let executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, lane, goals, undefined, store.files, search);
  let workRunner: WorkRunner | undefined;
  let channel = new WebUiChannel(store, tasks, executor, config, goals, lane, error => errors.push(error), memory, id => workRunner?.interrupt(id));
  let server = new WebUiServer(channel, key, join(process.cwd(), 'web-dist')), origin = await server.start(0), cookie = '', csrf = '';
  const makeRunner = () => channel.workRouter ? new WorkRunner(store, executor, channel, lane, {
    actor: channel.workRouter.actor, target: { channel: 'web', userId: 'local-user' }, pollIntervalMs: 25,
    goalReady: () => !!config.goalEnabled && store.goals.readyForHost().some(g => g.ownerId === 'local-user'
      && g.target.channel === 'web' && g.target.userId === 'local-user' && (g.readyInput?.kind !== 'policy' || !!config.proactive?.enabled)),
    reportError: error => errors.push(error), fatal: () => errors.push(new Error('WorkRunner停止领取')),
  }) : undefined;
  workRunner = makeRunner();
  const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, ...(body === undefined ? {} : {
      Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const login = async () => {
    const response = await request('/api/login', { key }); cookie = response.headers.get('set-cookie')!.split(';')[0]!;
    csrf = (await response.json() as { csrf: string }).csrf; return response;
  };
  return { root, output, config, payloads, errors, key, request, login, get origin() { return origin; },
    get store() { return store; }, get tasks() { return tasks; }, get goals() { return goals; }, get channel() { return channel; },
    get executor() { return executor; }, get workRunner() { return workRunner; }, get lane() { return lane; }, get memory() { return memory; },
    async pauseHttp() {
      // 只暂停测试HTTP传输，生产stop会清理会话和Channel，不适合模拟单纯断网。
      await new Promise<void>((done, reject) => {
        server.server.close(error => error ? reject(error) : done());
        server.server.closeAllConnections();
      });
    },
    async resumeHttp() { origin = await server.start(Number(new URL(origin).port)); return origin; },
    async restart() {
      await channel.stop(); await workRunner?.stop(); await server.stop(); await executor.close(); store.close(); memory.close();
      store = new SqliteStore(config.databasePath, redactor(config.apiKey, key)); store.recoverInterrupted(new Date().toISOString());
      tasks = new TaskService(store, config.timeZone); memory = new FileMemoryService(config.memoryDir);
      goals = new GoalService(store, tasks, () => {}); lane = new BackgroundLane();
      executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, lane, goals, undefined, store.files, search);
      channel = new WebUiChannel(store, tasks, executor, config, goals, lane, error => errors.push(error), memory, id => workRunner?.interrupt(id));
      workRunner = makeRunner();
      server = new WebUiServer(channel, key, join(process.cwd(), 'web-dist')); origin = await server.start(0); cookie = ''; csrf = '';
    },
    async close() { await channel.stop(); await workRunner?.stop(); await server.stop(); await executor.close(); store.close(); memory.close(); model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); },
  };
}
