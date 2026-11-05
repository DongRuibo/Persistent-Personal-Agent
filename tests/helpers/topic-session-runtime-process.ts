import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { Config } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { GoalService } from '../../src/goal-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { WorkCoordinatorService } from '../../src/work-coordinator.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { webOwner, webTarget, webChatKey } from '../../src/web-ui-channel.js';

const [configuration, mode, sourceRequestId, prompt] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configuration!, 'utf8')) as Config;
const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
store.recoverInterrupted(new Date().toISOString());
const actor = { owner: webOwner, channel: JSON.stringify(webTarget) }, goals = config.goalEnabled ? new GoalService(store, tasks, () => {}) : undefined;
const coordinator = new WorkCoordinatorService(store, actor, () => {}, config.goalEnabled);
const executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, undefined, goals, undefined, store.files, undefined, coordinator,
  { previous: runId => store.webUi.previousChatContext(webOwner, runId) });
try {
  if (mode === 'open') console.log(JSON.stringify({ phase: 'opened', runs: store.listRuns().length }));
  else {
    const source = store.webUi.find(actor.owner, sourceRequestId!)!.topicRoute!;
    if (source.kind !== 'topic') throw new Error('测试源不是冻结主题');
    const requestId = randomUUID(), now = new Date().toISOString();
    store.webUi.enqueue(actor.owner, requestId, prompt!, now, true);
    store.webUi.freezeTopicRoute(actor, requestId, { kind: 'use', threadId: source.threadId, reason: '子进程可信冻结选用' }, now);
    const request = store.webUi.claim(actor.owner, now, 'frozen')!;
    if (request.requestId !== requestId) throw new Error('测试进程不能领取其他请求');
    console.log(JSON.stringify({ phase: 'ready', runId: request.runId, requestId }));
    try {
      const result = await tasks.withTarget(webTarget, () => executor.execute({ prompt: prompt!, scope: 'chat', signal: new AbortController().signal,
        observer: store.observer(request.runId!), source: { channel: 'web', reference: request.runId! }, prepareChat: async () => request.topicRoute! }));
      store.finishRun(request.runId!, 'succeeded', new Date().toISOString(), result.text);
      console.log(JSON.stringify({ phase: 'finished', text: result.text, runId: request.runId }));
    } catch (error) {
      store.finishRun(request.runId!, 'failed', new Date().toISOString(), undefined, String(error)); throw error;
    }
  }
} finally { await executor.close(); memory.close(); store.close(); }
