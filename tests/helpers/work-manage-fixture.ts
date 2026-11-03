import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { GoalService } from '../../src/goal-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { WorkCoordinatorService } from '../../src/work-coordinator.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { WebUiChannel, webChatKey, webOwner, webTarget } from '../../src/web-ui-channel.js';
import { WebUiServer } from '../../src/web-ui-server.js';
import { initializeOutput } from '../../src/file-output-service.js';
import { WorkRunner } from '../../src/work-runner.js';
import type { WebReadService } from '../../src/web-read-service.js';
import { BackgroundLane } from '../../src/background-lane.js';
import { content, type Payload } from './skills-fixture.js';
import type { WebRequestReceipt } from '../../src/web-ui-types.js';

export const isWorkParse = (p: Payload) => content(p.messages.find(m => m.role === 'system')?.content).includes('隔离的当前文字工作意图解析器');
export async function workManageFixture(handle: (p: Payload, call: number) => string | Promise<string>, enabled = true, options: { files?: boolean; goals?: boolean; web?: WebReadService } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'work-manage-')), payloads: Payload[] = [], errors: unknown[] = [];
  const model = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const payload = JSON.parse(raw) as Payload; payloads.push(payload);
    const result = await handle(payload, payloads.length);
    if (result === 'HTTP_500') { res.writeHead(500); res.end('fake failure'); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(result);
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const address = model.address();
  if (!address || typeof address === 'string') throw new Error('fixture port');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), LLM_API_KEY: 'fake-work-manage', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    GOAL_ENABLED: String(options.goals ?? true), WORK_COORDINATOR_ENABLED: String(enabled), WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true',
    SKILLS_ENABLED: 'false', WEB_READ_ENABLED: String(!!options.web), WEB_SEARCH_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' });
  if (options.files) { const output = join(root, 'output'); initializeOutput(output); config.localOutput = { enabled: true, workspace: output }; }
  const store = new SqliteStore(config.databasePath), db = new DatabaseSync(config.databasePath), tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
  const goals = new GoalService(store, tasks, () => {}), lane = new BackgroundLane(), actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
  let runner: WorkRunner;
  const coordinator = new WorkCoordinatorService(store, actor, id => runner?.interrupt(id), config.goalEnabled);
  let executor: Awaited<ReturnType<typeof createPiExecutor>>, channel: WebUiChannel, server: WebUiServer, origin: string;
  async function boot() {
    executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, lane, goals, options.web ? { service: options.web, store: store.web } : undefined, store.files, undefined, config.workCoordinatorEnabled ? coordinator : undefined);
    channel = new WebUiChannel(store, tasks, executor, config, goals, lane, e => errors.push(e), memory, id => runner?.interrupt(id));
    runner = new WorkRunner(store, executor, channel, lane, { actor, target: webTarget, pollIntervalMs: 25, coordinatorEnabled: config.workCoordinatorEnabled, goalsEnabled: config.goalEnabled, goalReady: () => false, reportError: e => errors.push(e), fatal: () => errors.push('fatal') });
    server = new WebUiServer(channel, 'fake-work-manage-access-key-at-least-32bytes', root); origin = await server.start(0);
  }
  await boot();
  let cookie = '', csrf = '';
  const api = (path: string, body?: unknown) => fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function login() { const response = await api('/login', { key: 'fake-work-manage-access-key-at-least-32bytes' }); cookie = response.headers.get('set-cookie')!.split(';')[0]!; csrf = (await response.json() as { csrf: string }).csrf; }
  await login();
  return { root, payloads, errors, config, store, db, actor, tasks, memory, goals, lane, get executor() { return executor; }, get channel() { return channel; }, get runner() { return runner; }, coordinator, api,
    sessionFile: join(config.sessionDir, createHash('sha256').update(webChatKey).digest('hex'), 'chat.session.jsonl'),
    async restart(prepare?: (file: string) => void, coordinatorEnabled = config.workCoordinatorEnabled) {
      await channel.stop(); await server.stop(); await runner.stop(); await executor.close();
      config.workCoordinatorEnabled = coordinatorEnabled; prepare?.(join(config.sessionDir, createHash('sha256').update(webChatKey).digest('hex'), 'chat.session.jsonl'));
      await boot(); await login();
    },
    async chat(text: string, requestId: string = randomUUID()) {
      const accepted = await api('/chat', { text, requestId });
      if (accepted.status !== 202) throw new Error(await accepted.text());
      await channel.drain();
      return channel.request(requestId);
    },
    async receipt(id: string) { return await (await api(`/chat-requests/${id}`)).json() as WebRequestReceipt; },
    async close() { await server.stop(); await runner.stop(); await executor.close(); db.close(); store.close(); memory.close(); model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); rmSync(root, { recursive: true, force: true }); },
  };
}
