import { createServer } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { reply, toolCall } from '../../tests/helpers/skills-fixture.js';
import { notificationEpoch } from './notifications.js';
export { toolCall };
export type RecoveryReply = { status: number; retryAfter?: string } | 'success' | 'plan' | 'hang' | 'tool';

export async function goalRecoveryEnvironment(root: string, target: string, respond: (attempt: number) => RecoveryReply, attempts: 1 | 2 | 3 = 3) {
  const { SqliteStore } = await import(pathToFileURL(join(target, 'src/sqlite-store.ts')).href) as typeof import('../../src/sqlite-store.js');
  const { TaskService } = await import(pathToFileURL(join(target, 'src/task-service.ts')).href) as typeof import('../../src/task-service.js');
  const { GoalRunner } = await import(pathToFileURL(join(target, 'src/goal-runner.ts')).href) as typeof import('../../src/goal-runner.js');
  const { BackgroundLane } = await import(pathToFileURL(join(target, 'src/background-lane.ts')).href) as typeof import('../../src/background-lane.js');
  const { readConfig } = await import(pathToFileURL(join(target, 'src/config.ts')).href) as typeof import('../../src/config.js');
  const { createPiExecutor } = await import(pathToFileURL(join(target, 'src/pi-executor.ts')).href) as typeof import('../../src/pi-executor.js');
  const calls: { at_ms: number; response: RecoveryReply; payload: unknown }[] = [], origin = performance.now();
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const response = respond(calls.length + 1); calls.push({ at_ms: performance.now() - origin, response, payload: JSON.parse(body) });
    if (response === 'hang') return;
    if (typeof response === 'object') { res.writeHead(response.status, { 'Content-Type': 'application/json', ...(response.retryAfter ? { 'Retry-After': response.retryAfter } : {}) }); res.end(JSON.stringify({ error: { message: '合成HTTP故障' } })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(response === 'tool' ? toolCall('create_task', { when: '1分钟后', instruction: '禁止外部副作用' }) : reply(JSON.stringify({
      stepOutcome: response === 'plan' ? 'complete' : 'partial', artifactText: '合成恢复成果', progressSummary: '已提交', question: '等待用户',
      ...(response === 'plan' ? { proposedPlan: { changeReason: '初始化', steps: [{ title: '一项文本练习', instruction: '根据已给资料出题', deliverable: '题目', doneWhen: '用户核对' }] } } : {}),
    })));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address();
  if (!address || typeof address === 'string') throw new Error('本机Goal桩端口不可用');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), SESSION_DIR: join(root, 'sessions'), MEMORY_DIR: join(root, 'memory'),
    LLM_API_KEY: 'fake-recovery', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, GOAL_ENABLED: 'true', EXECUTION_TIMEOUT_MS: '1000' });
  const store = new SqliteStore(config.databasePath), executor = await createPiExecutor(config, new TaskService(store, 'Asia/Shanghai'));
  const actor = { ownerId: 'local-user', target: { channel: 'console' as const } }, errors: string[] = [];
  const runner = new GoalRunner(store, executor, { sendMessage: async () => {} }, new BackgroundLane(), {
    ownerId: actor.ownerId, notificationTarget: actor.target, accepts: () => true, pollIntervalMs: 10, modelAttempts: attempts, reportError: error => errors.push(String(error)), fatal: () => errors.push('fatal'),
  }, () => new Date(notificationEpoch));
  const source = store.beginRun(null, notificationEpoch), goal = store.goals.create(actor, source.id, '合成手动Goal恢复', notificationEpoch);
  store.finishRun(source.id, 'succeeded', notificationEpoch);
  return { store, runner, actor, goal, calls, errors,
    view: () => store.goals.view(actor, goal.id),
    control(action: 'pause' | 'cancel') {
      const current = store.goals.get(actor, goal.id), source = store.beginRun(null, notificationEpoch);
      store.goals.control({ actor, sourceRunId: source.id, expectedRevision: current.revision, text: action }, goal.id, action, notificationEpoch);
      store.finishRun(source.id, 'succeeded', notificationEpoch); runner.interrupt(goal.id);
    },
    snapshot() { return { view: store.goals.view(actor, goal.id), calls, errors,
      events: store.listRuns().flatMap(run => store.events(run.id).map(event => ({ runId: run.id, ...event }))) }; },
    async close() { await runner.stop(); await executor.close(); store.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
  };
}
