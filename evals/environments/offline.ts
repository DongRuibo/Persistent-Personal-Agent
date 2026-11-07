import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { GoalService } from '../../src/goal-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import type { ExecutionRequest, MessageTarget } from '../../src/contracts.js';
import { content, reply, toolCall as scriptedToolCall } from '../../tests/helpers/skills-fixture.js';
export { content, reply };
let toolSequence = 0;
export const toolCall = (name: string, args: unknown) => scriptedToolCall(name, args).replaceAll('skill-tool', `eval-tool-${++toolSequence}`);
export type { Payload } from '../../tests/helpers/skills-fixture.js';
import type { Payload } from '../../tests/helpers/skills-fixture.js';

export const epoch = '2026-11-07T00:00:00.000Z';
export type ModelReply = string | { status?: number; hang?: boolean };

// 仅使用新临时目录、固定假凭据与本机HTTP；不加载.env或正式渠道。
export async function offline(root: string, handle: (payload: Payload, index: number) => ModelReply | Promise<ModelReply>, memoryOn = true) {
  const payloads: Payload[] = [], wire: { request: Payload; response: ModelReply }[] = [];
  const failures: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const part of req) raw += part;
      const payload = JSON.parse(raw) as Payload; payloads.push(payload);
      const response = await handle(payload, payloads.length); wire.push({ request: payload, response });
      if (typeof response !== 'string') {
        if (response.hang) return;
        res.writeHead(response.status ?? 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: '离线注入故障', type: 'eval_fault' } })); return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response);
    } catch (error) { failures.push(String(error)); res.writeHead(500); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('离线模型端口不可用');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), SESSION_DIR: join(root, 'sessions'), MEMORY_DIR: join(root, 'memory'),
    LLM_API_KEY: 'fake-offline-evaluation', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
    GOAL_ENABLED: 'true', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', WEB_SEARCH_ENABLED: 'false',
    WEB_READ_ENABLED: 'false', SKILLS_ENABLED: 'false', PROACTIVE_ENABLED: 'false', EXECUTION_TIMEOUT_MS: '1000' });
  const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, 'Asia/Shanghai', () => new Date(epoch));
  const memory = new FileMemoryService(config.memoryDir), goals = new GoalService(store, tasks, () => {});
  let executor = await createPiExecutor(config, tasks, 'console', memoryOn ? memory : undefined, undefined, undefined, goals);
  return { root, config, store, tasks, memory, goals, payloads, wire, failures, get executor() { return executor; },
    async reopen(key = 'console', inject = memoryOn) {
      await executor.close(); executor = await createPiExecutor(config, tasks, key, inject ? memory : undefined, undefined, undefined, goals);
    },
    async chat(prompt: string, target: MessageTarget = { channel: 'console' }) {
      const run = store.beginRun(null, epoch);
      const request: ExecutionRequest = { prompt, scope: 'chat', signal: new AbortController().signal, source: { channel: target.channel, reference: run.id }, observer: store.observer(run.id) };
      try {
        const result = await tasks.withTarget(target, () => executor.execute(request));
        store.finishRun(run.id, 'succeeded', epoch, result.text); store.event(run.id, 'delivery_succeeded');
        return { runId: run.id, text: result.text, error: null };
      } catch (error) {
        store.finishRun(run.id, 'failed', epoch, undefined, String(error)); return { runId: run.id, text: null, error: String(error) };
      }
    },
    async close() { await executor.close(); memory.close(); store.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
  };
}

// 从真实Pi持久消息取参数，并与Runtime开始/结束事件关联，不能把桩的提议算执行。
export function evidence(store: SqliteStore, root: string) {
  const runs = store.listRuns().map(run => ({ ...run, events: store.events(run.id), model_calls: store.modelCalls(run.id) }));
  const messages = readdirSync(join(root, 'sessions'), { recursive: true, withFileTypes: true })
    .filter(file => file.isFile() && file.name === 'chat.session.jsonl')
    .flatMap(file => readFileSync(join(file.parentPath, file.name), 'utf8').trim().split('\n').map(line => JSON.parse(line)))
    .filter(entry => entry.type === 'message').map(entry => entry.message);
  const proposed = messages.filter(m => m.role === 'assistant').flatMap(m => m.content ?? []).filter(c => c.type === 'toolCall');
  const results = messages.filter(m => m.role === 'toolResult');
  const starts = runs.flatMap(run => run.events.filter(event => event.type === 'tool_execution_start'));
  const actual_tool_calls = proposed.flatMap(call => {
    const result = results.find(m => m.toolCallId === call.id && m.toolName === call.name);
    if (!result || !starts.some(event => event.details === call.name)) return [];
    return [{ id: call.id, name: call.name, arguments: call.arguments, result: result.content, isError: result.isError }];
  });
  return { tasks: store.listTasks(), runs, messages, actual_tool_calls };
}
