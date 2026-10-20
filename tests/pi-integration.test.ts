import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { readConfig, redactor } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import type { ExecutionRequest } from '../src/contracts.js';

interface Payload {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
}

test('真实 Pi SDK + 本地模拟 API：工具白名单、任务创建、Session 隔离、settled、HTTP 不重试', { timeout: 15000 }, async () => {
  const requests: Payload[] = [];
  let httpError = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const payload = JSON.parse(body) as Payload;
    requests.push(payload);
    if (httpError) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'simulated provider failure' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const user = JSON.stringify(payload.messages.filter((message) => message.role === 'user').at(-1)?.content);
    const callTool = user.includes('CHAT_CREATE_MARKER') && !payload.messages.some((message) => message.role === 'tool');
    const chunk = (delta: unknown, finish: string | null, usage?: unknown) => {
      res.write(`data: ${JSON.stringify({ id: 'mock-completion', object: 'chat.completion.chunk', created: 1, model: 'local-stub', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`);
    };
    chunk(callTool
      ? { role: 'assistant', tool_calls: [{ index: 0, id: 'call_create', type: 'function', function: { name: 'create_task', arguments: JSON.stringify({ instruction: '问候', when: '明天上午9点' }) } }] }
      : { role: 'assistant', content: '模拟结果' }, null);
    chunk({}, callTool ? 'tool_calls' : 'stop', { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 });
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const store = new SqliteStore(':memory:', redactor('local-test-key'));
  const tasks = new TaskService(store, 'Asia/Taipei', () => new Date('2026-10-20T00:00:00Z'));
  const executor = await createPiExecutor(readConfig({
    LLM_API_KEY: 'local-test-key', LLM_MODEL: 'local-stub',
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, EXECUTION_TIMEOUT_MS: '5000',
  }), tasks);
  const execute = async (scope: 'chat' | 'task', prompt: string) => {
    const run = store.beginRun(null, new Date().toISOString());
    const request: ExecutionRequest = { scope, prompt, signal: new AbortController().signal, observer: store.observer(run.id) };
    return { run, result: await executor.execute(request) };
  };
  try {
    const chat = await execute('chat', 'CHAT_CREATE_MARKER 请明天上午9点问候我');
    assert.equal(chat.result.text, '模拟结果');
    assert.equal(tasks.list().length, 1);
    assert.equal(tasks.list()[0]!.dueAt, '2026-10-21T01:00:00.000Z');
    assert.deepEqual(requests[0]!.tools?.map((tool) => tool.function.name).sort(), ['cancel_task', 'create_task', 'list_tasks']);
    assert.equal(store.modelCalls(chat.run.id).length, 2);
    assert.equal(store.modelCalls(chat.run.id)[0]!.inputTokens, 21);
    assert.equal(store.modelCalls(chat.run.id)[0]!.cost, null);
    const events = store.events(chat.run.id);
    assert.ok(events.some((event) => event.type === 'tool_execution_start'));
    assert.ok(events.findIndex((event) => event.type === 'agent_end') < events.findIndex((event) => event.type === 'agent_settled'));
    const task = await execute('task', 'TASK_PRIVATE_MARKER 独立执行');
    assert.equal(task.result.text, '模拟结果');
    const background = requests.at(-1)!;
    assert.equal(background.tools?.length ?? 0, 0);
    assert.ok(!JSON.stringify(background.messages).includes('CHAT_CREATE_MARKER'));
    await execute('chat', 'CHAT_SECOND_MARKER');
    const continued = requests.at(-1)!;
    assert.ok(JSON.stringify(continued.messages).includes('CHAT_CREATE_MARKER'));
    assert.ok(!JSON.stringify(continued.messages).includes('TASK_PRIVATE_MARKER'));
    httpError = true;
    const before = requests.length;
    await assert.rejects(execute('task', '模拟 API 错误'), /simulated provider failure|500/);
    assert.equal(requests.length - before, 1, 'HTTP 500 不应触发隐式重试');
  } finally {
    await executor.close(); store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
