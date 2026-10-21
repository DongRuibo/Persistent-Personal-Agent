import { intentReply, sseText } from './helpers/intent-stub.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readConfig, redactor } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import type { ExecutionRequest } from '../src/contracts.js';
import * as lark from '@larksuiteoapi/node-sdk';
import { FeishuChannel } from '../src/feishu-channel.js';
import { ChannelRouter } from '../src/channel-router.js';
import { TaskScheduler } from '../src/scheduler.js';

interface Payload {
  messages: { role: string; content: unknown }[];
  tools?: { function: { name: string } }[];
  enable_thinking?: boolean;
  max_tokens?: number;
  max_completion_tokens?: number;
}

test('硅基流动显式关闭推理并使用 max_tokens，其他兼容端点保留通用参数', async (t) => {
  const requests: Payload[] = [];
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-thinking-'));
  const store = new SqliteStore(':memory:');
  const tasks = new TaskService(store, 'Asia/Shanghai');
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    requests.push(JSON.parse(String(init?.body)) as Payload);
    const frames = [
      { choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    ].map((value) => `data: ${JSON.stringify({ id: 'thinking-stub', model: 'local-stub', ...value })}\n\n`).join('');
    return new Response(frames + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  try {
    for (const [index, baseUrl] of ['https://api.siliconflow.cn/v1', 'https://api.example.com/v1'].entries()) {
      const executor = await createPiExecutor(readConfig({ LLM_API_KEY: 'fake-thinking-key', LLM_MODEL: 'local-stub', LLM_BASE_URL: baseUrl, SESSION_DIR: join(directory, String(index)) }), tasks);
      try {
        await executor.execute({ prompt: '只回复 OK', scope: 'chat', signal: new AbortController().signal, observer: { event: () => {}, modelCall: () => {} } });
      } finally { await executor.close(); }
    }
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.enable_thinking, false);
    assert.equal(requests[0]?.max_tokens, 4096);
    assert.ok(!Object.hasOwn(requests[0]!, 'max_completion_tokens'));
    assert.ok(!Object.hasOwn(requests[1]!, 'enable_thinking'));
    assert.equal(requests[1]?.max_completion_tokens, 4096);
  } finally { t.mock.restoreAll(); store.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('真实 Pi SDK + 本地模拟 API：工具白名单、任务创建、Session 隔离、settled、HTTP 不重试', { timeout: 15000 }, async () => {
  const requests: Payload[] = [];
  let httpError = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const payload = JSON.parse(body) as Payload;
    requests.push(payload);
    const intent = intentReply(payload);
    if (intent !== undefined) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(sseText(intent)); return; }
    if (httpError) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'simulated provider failure' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const user = JSON.stringify(payload.messages.filter((message) => message.role === 'user').at(-1)?.content);
    const lastUser = payload.messages.findLastIndex((message) => message.role === 'user');
    const callTool = user.includes('明天上午9点提醒我问候') && !payload.messages.slice(lastUser + 1).some((message) => message.role === 'tool');
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
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-pi-'));
  const tasks = new TaskService(store, 'Asia/Taipei', () => new Date('2026-10-20T00:00:00Z'));
  const executor = await createPiExecutor(readConfig({
    LLM_API_KEY: 'local-test-key', LLM_MODEL: 'local-stub',
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, EXECUTION_TIMEOUT_MS: '5000',
    SESSION_DIR: directory,
  }), tasks);
  const execute = async (scope: 'chat' | 'task', prompt: string) => {
    const run = store.beginRun(null, new Date().toISOString());
    const request: ExecutionRequest = { scope, prompt, signal: new AbortController().signal, observer: store.observer(run.id) };
    return { run, result: await executor.execute(request) };
  };
  try {
    const chat = await execute('chat', '明天上午9点提醒我问候');
    assert.match(chat.result.text, /已创建提醒/);
    assert.equal(tasks.list().length, 1);
    assert.equal(tasks.list()[0]!.dueAt, '2026-10-21T01:00:00.000Z');
    assert.deepEqual(requests[0]!.tools?.map((tool) => tool.function.name).sort(), ['cancel_task', 'create_task', 'list_tasks']);
    assert.equal(store.modelCalls(chat.run.id).length, 3);
    assert.equal(store.modelCalls(chat.run.id)[0]!.inputTokens, 21);
    assert.equal(store.modelCalls(chat.run.id)[0]!.cost, null);
    const events = store.events(chat.run.id);
    assert.ok(events.some((event) => event.type === 'tool_execution_start'));
    assert.ok(events.findIndex((event) => event.type === 'agent_end') < events.findIndex((event) => event.type === 'agent_settled'));
    const task = await execute('task', 'TASK_PRIVATE_MARKER 独立执行');
    assert.equal(task.result.text, '模拟结果');
    const background = requests.at(-1)!;
    assert.equal(background.tools?.length ?? 0, 0);
    assert.ok(!JSON.stringify(background.messages).includes('明天上午9点提醒我问候'));
    await execute('chat', 'CHAT_SECOND_MARKER');
    const continued = requests.at(-1)!;
    assert.ok(JSON.stringify(continued.messages).includes('明天上午9点提醒我问候'));
    assert.ok(!JSON.stringify(continued.messages).includes('TASK_PRIVATE_MARKER'));
    // 真实飞书事件 Dispatcher → Channel → 真实 Pi 工具调用，模型 HTTP 和飞书发送均模拟。
    tasks.cancel(tasks.list()[0]!.id);
    const sent: { chatId: string; text: string }[] = [];
    const feishu = new FeishuChannel(
      { appId: 'cli_0123456789abcdef', appSecret: 'fake-app-secret', allowedOpenId: 'ou_owner' },
      { start: async () => {}, stop: () => {}, sendText: async (chatId, text) => { sent.push({ chatId, text }); } },
      executor, tasks, store, redactor('local-test-key'), () => {},
    );
    const dispatcher = new lark.EventDispatcher({ loggerLevel: lark.LoggerLevel.fatal }).register({
      'im.message.receive_v1': async (event) => { feishu.receive(event); },
    });
    const scheduler = new TaskScheduler(store, executor, new ChannelRouter({ sendMessage: async () => { throw new Error('不应投递 Console'); } }, feishu), 10, () => {}, () => new Date('2026-10-22T00:00:00Z'));
    try {
      for (const eventId of ['event-one', 'event-redelivered']) {
        await dispatcher.invoke({ schema: '2.0', header: { event_id: eventId, event_type: 'im.message.receive_v1' }, event: {
          sender: { sender_type: 'user', sender_id: { open_id: 'ou_owner' } },
          message: { message_id: 'persistent-feishu-message', chat_id: 'oc_private', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text: '明天上午9点提醒我问候' }) },
        } }, { needCheck: false });
      }
      await feishu.drain();
      const created = tasks.list().filter((item) => item.target.channel === 'feishu');
      assert.equal(created.length, 1);
      assert.deepEqual(created[0]!.target, { channel: 'feishu', appId: 'cli_0123456789abcdef', chatId: 'oc_private', userOpenId: 'ou_owner' });
      assert.equal(sent.length, 1, '重投事件不能多回复或多创建任务');
      await scheduler.tick();
      assert.equal(tasks.get(created[0]!.id).status, 'succeeded');
      assert.equal(sent.length, 2, '无需新入站消息即可主动通知');
      assert.ok(sent.every((message) => message.chatId === 'oc_private'));
    } finally { await scheduler.stop(); await feishu.stop(); }
    httpError = true;
    const before = requests.length;
    await assert.rejects(execute('task', '模拟 API 错误'), /simulated provider failure|500/);
    assert.equal(requests.length - before, 1, 'HTTP 500 不应触发隐式重试');
  } finally {
    await executor.close(); store.close();
    rmSync(directory, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
