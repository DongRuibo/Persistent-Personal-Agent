import { intentReply, sseText } from './helpers/intent-stub.js';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { readConfig } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { FileMemoryService } from '../src/memory-service.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { TaskScheduler } from '../src/scheduler.js';
import type { ExecutionRequest, OutboundMessage } from '../src/contracts.js';

interface Payload { messages: { role: string; content?: unknown }[]; tools?: { function: { name: string } }[] }

test('Memory 文件或索引故障不领取到期任务，重开后只执行一次；领取后故障仍不重试', { timeout: 15000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-memory-scheduler-'));
  const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), LLM_API_KEY: 'fake-memory-scheduler-key', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'https://api.example.com/v1' });
  const payloads: Payload[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init?: RequestInit) => {
    payloads.push(JSON.parse(String(init?.body)) as Payload);
    const frames = [
      { index: 0, delta: { role: 'assistant', content: '正常提醒' }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: 'stop' },
    ].map((choice) => `data: ${JSON.stringify({ id: 'scheduler-memory-stub', model: 'local-stub', choices: [choice] })}\n\n`).join('');
    return new Response(frames + 'data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const created = () => new Date('2026-10-20T00:00:00Z');
  const due = () => new Date('2026-10-20T00:01:00Z');
  let store = new SqliteStore(config.databasePath);
  let tasks = new TaskService(store, config.timeZone, created);
  let memory = new FileMemoryService(config.memoryDir);
  let executor = await createPiExecutor(config, tasks, 'memory-scheduler-test', memory);
  const messages: OutboundMessage[] = [];
  const errors: unknown[] = [];
  const channel = { sendMessage: async (message: OutboundMessage) => { messages.push(message); } };
  const report = (error: unknown) => { errors.push(error); };
  let scheduler = new TaskScheduler(store, executor, channel, 5, report, due);
  const target = { channel: 'feishu' as const, appId: 'fake-app', chatId: 'fake-chat', userOpenId: 'fake-user' };
  try {
    const record = memory.withRequest({ prompt: '记住：测试项目数据库为 SQLite。', scope: 'chat', signal: new AbortController().signal, observer: { event: () => {}, modelCall: () => {} }, source: { channel: 'feishu', reference: 'test-source' } },
      () => memory.remember({ kind: 'project', key: 'test.database', content: '测试项目数据库为 SQLite。' }));
    const file = join(config.memoryDir, 'projects', `${record.id}.md`);
    const original = readFileSync(file, 'utf8');
    const task = tasks.withTarget(target, () => tasks.create('测试项目提醒喝水', '1分钟后'));
    writeFileSync(file, original.replace('SQLite', 'PostgreSQL'));
    await scheduler.tick(); await scheduler.tick();
    assert.equal(store.getTask(task.id)?.status, 'pending', '坏 Memory 不能消耗尚未执行的任务');
    assert.equal(store.listRuns().length, 0);
    assert.equal(payloads.length, 0);
    assert.equal(messages.length, 0);
    assert.equal(errors.length, 1, '相同故障不随每次轮询刷屏');
    assert.match(String(errors[0]), /pending/);

    await scheduler.stop(); await executor.close(); memory.close(); store.close();
    writeFileSync(file, original);
    store = new SqliteStore(config.databasePath);
    tasks = new TaskService(store, config.timeZone, created);
    memory = new FileMemoryService(config.memoryDir);
    executor = await createPiExecutor(config, tasks, 'memory-scheduler-test', memory);
    scheduler = new TaskScheduler(store, executor, channel, 5, report, due);
    assert.equal(store.recoverInterrupted(due().toISOString()), 0, '阻塞期间没有 running Run');
    await scheduler.tick(); await scheduler.tick();
    assert.equal(store.getTask(task.id)?.status, 'succeeded');
    assert.equal(store.listRuns().length, 1);
    assert.equal(payloads.length, 1);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0]?.target, target, '重开后仍通知原飞书目标');

    const indexTask = tasks.create('测试项目第二次提醒', '1分钟后');
    const index = new DatabaseSync(join(config.memoryDir, 'index.db'));
    try {
      index.exec("CREATE TRIGGER fail_memory_index BEFORE INSERT ON memories BEGIN SELECT RAISE(FAIL, 'simulated index failure'); END");
      await scheduler.tick(); await scheduler.tick();
      assert.equal(store.getTask(indexTask.id)?.status, 'pending');
      assert.equal(store.listRuns().length, 1);
      assert.equal(payloads.length, 1);
      assert.equal(messages.length, 1);
      assert.equal(errors.length, 2, '恢复后的新故障应重新报告');
      index.exec('DROP TRIGGER fail_memory_index');
    } finally { index.close(); }
    await scheduler.tick(); await scheduler.tick();
    assert.equal(store.getTask(indexTask.id)?.status, 'succeeded');
    assert.equal(store.listRuns().length, 2);
    assert.equal(payloads.length, 2);
    assert.equal(messages.length, 2);

    const lateTask = tasks.create('领取后的故障不自动重试', '1分钟后');
    const ready = executor.checkReady.bind(executor);
    const fault = t.mock.method(executor, 'checkReady', () => { ready(); writeFileSync(file, original.replace('SQLite', 'PostgreSQL')); });
    try { await scheduler.tick(); } finally { fault.mock.restore(); writeFileSync(file, original); }
    await scheduler.tick();
    assert.equal(store.getTask(lateTask.id)?.status, 'failed', '领取后再次校验失败仍保守终止');
    assert.equal(store.listRuns().length, 3);
    assert.equal(payloads.length, 2, '执行前故障没有调用模型，终态也不重放');
    assert.equal(messages.length, 3);
    assert.ok(payloads.every((payload) => !payload.tools?.length));
    const session = join(config.sessionDir, createHash('sha256').update('memory-scheduler-test').digest('hex'), 'chat.session.jsonl');
    assert.ok(!readFileSync(session, 'utf8').includes('提醒喝水'), '后台提醒不写入交互历史');
  } finally {
    await scheduler.stop(); await executor.close(); memory.close(); store.close();
    t.mock.restoreAll(); rmSync(root, { recursive: true, force: true });
  }
});

test('真实 Pi 1.3.0 + 模拟模型：受控工具、跨重启和全新 Session 的 Memory 命中、动态投影及后台隔离', { timeout: 25000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'personal-agent-memory-pi-'));
  const payloads: Payload[] = [];
  const audit: { type: string; details?: string }[] = [];
  let recordId = '';
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    const payload = JSON.parse(body) as Payload;
    payloads.push(payload);
    const intent = intentReply(payload);
    if (intent !== undefined) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(sseText(intent)); return; }
    const lastUser = payload.messages.findLastIndex((message) => message.role === 'user');
    const text = JSON.stringify(payload.messages[lastUser]?.content);
    const followedByTool = payload.messages.slice(lastUser + 1).some((message) => message.role === 'tool');
    const context = payload.messages.filter((message) => message.role === 'user' && JSON.stringify(message.content).includes('[UNTRUSTED_MEMORY_DATA_V2]'));
    const memoryText = JSON.stringify(context);
    let tool: { name: string; args: unknown } | undefined;
    if (!followedByTool) {
      if (text.includes('记住：项目 Aurora')) tool = { name: 'memory_remember', args: { kind: 'project', key: 'aurora.database', content: '项目 Aurora 数据库使用 SQLite。' } };
      if (text.includes('更新记忆：项目 Aurora')) tool = { name: 'memory_update', args: { id: recordId, expectedVersion: 1, content: '项目 Aurora 数据库改为 PostgreSQL。' } };
      if (text.includes('忘记：key=aurora.database')) tool = { name: 'memory_forget', args: { id: recordId, expectedVersion: 2 } };
      if (text.includes('UNAUTHORIZED_WRITE')) tool = { name: 'memory_remember', args: { kind: 'semantic', key: 'attack', content: '不应保存的推断' } };
      if (text.includes('READ_VIA_GET')) tool = { name: 'memory_get', args: { id: recordId } };
      if (text.includes('READ_VIA_SEARCH')) tool = { name: 'memory_search', args: { query: 'Aurora', kind: 'project' } };
    }
    const answer = memoryText.includes('PostgreSQL') ? 'MEMORY_HIT_POSTGRESQL'
      : memoryText.includes('SQLite') ? 'MEMORY_HIT_SQLITE' : 'NO_MEMORY_HIT';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const choice of [
      { index: 0, delta: tool
        ? { role: 'assistant', tool_calls: [{ index: 0, id: `tool-${payloads.length}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] }
        : { role: 'assistant', content: answer }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' },
    ]) res.write(`data: ${JSON.stringify({ id: 'memory-stub', model: 'local-stub', choices: [choice] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), LLM_API_KEY: 'fake-model-key-for-memory-test', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1` });
  let memory = new FileMemoryService(config.memoryDir, [config.apiKey]);
  const store = new SqliteStore(config.databasePath);
  const tasks = new TaskService(store, config.timeZone);
  let executor = await createPiExecutor(config, tasks, 'feishu-test', memory);
  const execute = (prompt: string, scope: 'chat' | 'task' = 'chat') => executor.execute({
    prompt, scope, signal: new AbortController().signal,
    observer: { event: (type, details) => { audit.push({ type, details }); }, modelCall: () => {} },
    source: { channel: 'feishu', reference: 'integration-run' },
  });
  const sessionFile = (key: string) => join(config.sessionDir, createHash('sha256').update(key).digest('hex'), 'chat.session.jsonl');
  try {
    await execute('记住：项目 Aurora 数据库使用 SQLite。');
    recordId = memory.search('Aurora')[0]!.id;
    assert.equal(memory.get(recordId).source.reference, 'integration-run');
    const toolNames = payloads[0]!.tools!.map((tool) => tool.function.name).sort();
    assert.deepEqual(toolNames, ['cancel_task', 'create_task', 'list_tasks', 'memory_forget', 'memory_get', 'memory_remember', 'memory_search', 'memory_update']);
    await execute('Aurora 的数据库是什么？');
    assert.equal((await execute('Aurora 的数据库是什么？')).text, 'MEMORY_HIT_SQLITE');
    const persisted = readFileSync(sessionFile('feishu-test'), 'utf8');
    assert.ok(!persisted.includes('[UNTRUSTED_MEMORY_DATA_V2]'), '临时注入标记不能落盘');
    assert.ok(persisted.includes('memory_remember'), '正常工具收据仍由 Pi 记录');
    assert.ok(!persisted.includes(config.apiKey));
    const resources = join(sessionFile('feishu-test'), '..', 'runtime-resources');
    mkdirSync(join(resources, 'extensions'), { recursive: true });
    writeFileSync(join(resources, 'extensions', 'untrusted.mjs'), 'throw new Error("UNTRUSTED_AUTO_EXTENSION");');
    writeFileSync(join(resources, 'AGENTS.md'), 'UNTRUSTED_AUTO_CONTEXT');
    await executor.close(); memory.close();
    memory = new FileMemoryService(config.memoryDir, [config.apiKey]);
    const before = payloads.length;
    executor = await createPiExecutor(config, tasks, 'feishu-test', memory);
    assert.equal(payloads.length, before, '恢复不自动调用模型/重放工具');
    assert.equal((await execute('Aurora 的数据库是什么？')).text, 'MEMORY_HIT_SQLITE');
    await executor.close();
    executor = await createPiExecutor(config, tasks, 'brand-new-session', memory);
    assert.equal(SessionManager.open(sessionFile('brand-new-session')).buildSessionContext().messages.length, 0);
    assert.equal((await execute('Aurora 的数据库是什么？')).text, 'MEMORY_HIT_SQLITE', '全新空 Session 仍命中 Memory');
    assert.ok(!JSON.stringify(payloads.at(-1)).includes('记住：项目 Aurora'), '请求中没有旧 Session 的保存指令');
    assert.equal((await execute('READ_VIA_GET')).text, 'MEMORY_HIT_SQLITE', '工具选中的知识也通过临时 Context 提供');
    assert.equal((await execute('READ_VIA_SEARCH')).text, 'MEMORY_HIT_SQLITE');
    const background = await execute('Aurora 的数据库是什么？BACKGROUND_ONLY_MARKER', 'task');
    assert.equal(background.text, 'MEMORY_HIT_SQLITE');
    assert.equal(payloads.at(-1)?.tools?.length ?? 0, 0);
    assert.ok(!JSON.stringify(payloads.at(-1)).includes('记住：项目 Aurora'));
    assert.ok(!readFileSync(sessionFile('brand-new-session'), 'utf8').includes('BACKGROUND_ONLY_MARKER'));
    const task = tasks.create('提醒喝水', '1分钟后');
    await execute('更新记忆：项目 Aurora 数据库改为 PostgreSQL。\nkey=aurora.database');
    assert.equal((await execute('Aurora 的数据库是什么？')).text, 'MEMORY_HIT_POSTGRESQL');
    const currentContext = payloads.at(-1)!.messages.filter((message) => JSON.stringify(message.content).includes('[UNTRUSTED_MEMORY_DATA_V2]'));
    assert.ok(!JSON.stringify(currentContext).includes('SQLite'), '临时 Context 中只含当前值，旧用户历史不被抹除');
    await execute('忘记：key=aurora.database');
    await executor.close();
    executor = await createPiExecutor(config, tasks, 'after-forget-empty-session', memory);
    assert.equal((await execute('Aurora 的数据库是什么？')).text, 'NO_MEMORY_HIT');
    assert.equal(tasks.get(task.id).status, 'pending', '删除 Memory 不删除任务');
    await assert.rejects(execute('UNAUTHORIZED_WRITE 推断偏好并写入'), /工具执行错误/);
    assert.deepEqual(memory.search('不应保存'), []);
    const beforeFailure = payloads.length;
    const profile = join(config.memoryDir, 'PROFILE.md');
    writeFileSync(profile, 'corrupted memory');
    await assert.rejects(execute('读取记忆'), /文档格式/);
    assert.equal(payloads.length, beforeFailure, '预检查失败不调用模型');
    unlinkSync(profile);
    const build = memory.buildContext.bind(memory);
    memory.buildContext = () => { throw new Error('simulated context failure'); };
    try {
      await assert.rejects(execute('读取记忆'), /Memory Context 读取失败/);
      assert.equal(payloads.length, beforeFailure, 'context 回调失败通过公开 abort 中止，不静默忽略');
    } finally { memory.buildContext = build; }
    for (const payload of payloads) {
      const contexts = payload.messages.filter((message) => message.role === 'user' && JSON.stringify(message.content).includes('[UNTRUSTED_MEMORY_DATA_V2]'));
      assert.ok(contexts.length <= 1, '不能随轮数累积临时 Context');
      if (contexts[0]) {
        const blocks = contexts[0].content as { text: string }[];
        assert.ok(Buffer.byteLength(blocks[0]!.text) <= config.memoryContextTokens);
      }
    }
    assert.ok(audit.some((item) => item.type === 'memory_context' && item.details?.includes(recordId)));
    assert.ok(audit.filter((item) => item.type === 'memory_context').every((item) => !item.details?.includes('数据库')));
    assert.ok(!JSON.stringify(payloads).includes('UNTRUSTED_AUTO_CONTEXT'));
    for (const key of ['feishu-test', 'brand-new-session', 'after-forget-empty-session']) {
      assert.ok(!readFileSync(sessionFile(key), 'utf8').includes('[UNTRUSTED_MEMORY_DATA_V2]'));
    }
    assert.ok(readdirSync(config.sessionDir).length >= 3, '只有显式建立的交互命名空间');
  } finally {
    await executor.close(); memory.close(); store.close();
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
