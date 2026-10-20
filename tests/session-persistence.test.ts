import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { readConfig, redactor } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { FeishuChannel } from '../src/feishu-channel.js';
import { ChannelRouter } from '../src/channel-router.js';
import { TaskScheduler } from '../src/scheduler.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';

interface Payload { messages: { role: string; content?: unknown }[]; tools?: unknown[] }
const identity = { appId: 'cli_0123456789abcdef', appSecret: 'fake-feishu-secret', allowedOpenId: 'ou_owner' };
const chatKey = JSON.stringify(['feishu', identity.appId, identity.allowedOpenId]);

test('真实 Pi Session 文件：飞书上下文恢复、目标和去重跨重启、后台隔离、历史工具不重放', { timeout: 20000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-sessions-'));
  const requests: Payload[] = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    const payload = JSON.parse(body) as Payload;
    requests.push(payload);
    const lastUser = payload.messages.findLastIndex((message) => message.role === 'user');
    const user = JSON.stringify(payload.messages[lastUser]?.content);
    const callTool = user.includes('CREATE_ONCE_MARKER') && !payload.messages.slice(lastUser + 1).some((message) => message.role === 'tool');
    const text = user.includes('生成后台提醒') ? 'SCHEDULER_ONLY_RESULT_MARKER'
      : JSON.stringify(payload.messages).includes('PROJECT_PERSIST_MARKER') ? '你正在开发基于 Pi 的 Personal Agent' : '没有项目上下文';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const choice of [
      { index: 0, delta: callTool
        ? { role: 'assistant', tool_calls: [{ index: 0, id: 'create-once', type: 'function', function: { name: 'create_task', arguments: JSON.stringify({ instruction: '生成后台提醒', when: '1分钟后' }) } }] }
        : { role: 'assistant', content: text }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: callTool ? 'tool_calls' : 'stop' },
    ]) res.write(`data: ${JSON.stringify({ id: 'session-stub', model: 'local-stub', choices: [choice] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const config = readConfig({
    DATABASE_PATH: join(directory, 'agent.db'), SESSION_DIR: join(directory, 'sessions'),
    LLM_API_KEY: 'fake-model-secret', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
  });
  const file = join(config.sessionDir, createHash('sha256').update(chatKey).digest('hex'), 'chat.session.jsonl');
  const sent: { chatId: string; text: string }[] = [];
  const errors: unknown[] = [];
  let store = new SqliteStore(config.databasePath, redactor(config.apiKey));
  let tasks = new TaskService(store, config.timeZone, () => new Date('2026-10-20T00:00:00Z'));
  let executor = await createPiExecutor(config, tasks, chatKey);
  const channel = () => new FeishuChannel(identity, {
    start: async () => {}, stop: () => {}, sendText: async (chatId, text) => { sent.push({ chatId, text }); },
  }, executor, tasks, store, redactor(config.apiKey, identity.appSecret), (error) => errors.push(error));
  let feishu = channel();
  const receive = async (id: string, text: string) => {
    feishu.receive({ sender: { sender_type: 'user', sender_id: { open_id: identity.allowedOpenId } },
      message: { message_id: id, chat_id: 'oc_private', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } });
    await feishu.drain();
  };
  try {
    assert.equal(requests.length, 0, '创建 Session 不调用模型');
    const initialId = SessionManager.open(file).getSessionId();
    assert.equal(SessionManager.open(file).buildSessionContext().messages.length, 0);
    await receive('project', 'PROJECT_PERSIST_MARKER 我正在开发一个基于 Pi 的 Personal Agent');
    await receive('question', '我刚才说我在开发什么？');
    assert.equal(sent.at(-1)?.text, '你正在开发基于 Pi 的 Personal Agent');
    await receive('create', 'CREATE_ONCE_MARKER 创建一分钟后提醒');
    assert.equal(tasks.list().length, 1);
    const task = tasks.list()[0]!;
    assert.equal(task.target.channel, 'feishu');
    assert.equal(task.status, 'pending');
    const toolStarts = store.listRuns().flatMap((run) => store.events(run.id)).filter((event) => event.type === 'tool_execution_start').length;
    assert.equal(toolStarts, 1);
    await feishu.stop(); await executor.close(); store.close();

    store = new SqliteStore(config.databasePath, redactor(config.apiKey));
    tasks = new TaskService(store, config.timeZone);
    const beforeRestore = requests.length;
    executor = await createPiExecutor(config, tasks, chatKey);
    feishu = channel();
    assert.equal(requests.length, beforeRestore, '恢复 Session 不能继续执行历史请求');
    assert.equal(SessionManager.open(file).getSessionId(), initialId);
    assert.equal(tasks.list().length, 1, '恢复历史工具调用不重复创建任务');
    await receive('create', 'CREATE_ONCE_MARKER 重投');
    assert.equal(requests.length, beforeRestore, '已有去重记录跨重启生效');
    const scheduler = new TaskScheduler(store, executor, new ChannelRouter({ sendMessage: async () => assert.fail('错误投递到 Console') }, feishu), 10, (error) => errors.push(error), () => new Date('2026-10-20T00:02:00Z'));
    try { await scheduler.tick(); await scheduler.tick(); } finally { await scheduler.stop(); }
    assert.equal(tasks.get(task.id).status, 'succeeded');
    assert.equal(store.listRuns(task.id).length, 1);
    assert.deepEqual(sent.at(-1), { chatId: 'oc_private', text: 'SCHEDULER_ONLY_RESULT_MARKER' });
    const background = requests.at(-1)!;
    assert.equal(background.tools?.length ?? 0, 0);
    assert.ok(!JSON.stringify(background).includes('PROJECT_PERSIST_MARKER'));
    await receive('resumed', '我们刚才在讨论什么？');
    assert.equal(sent.at(-1)?.text, '你正在开发基于 Pi 的 Personal Agent');
    assert.ok(!JSON.stringify(requests.at(-1)).includes('SCHEDULER_ONLY_RESULT_MARKER'));
    assert.equal(store.listRuns().flatMap((run) => store.events(run.id)).filter((event) => event.type === 'tool_execution_start').length, toolStarts);
    const transcript = readFileSync(file, 'utf8');
    assert.ok(transcript.includes('PROJECT_PERSIST_MARKER'));
    assert.ok(transcript.includes('toolResult'));
    assert.ok(!transcript.includes('SCHEDULER_ONLY_RESULT_MARKER'));
    for (const secret of [config.apiKey, identity.appSecret]) assert.ok(!transcript.includes(secret));
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(file, '..')).mode & 0o777, 0o700);
    assert.equal(readdirSync(config.sessionDir).length, 1, '后台执行不创建持久化会话');
    assert.deepEqual(errors, []);

    // Console、不同应用及不同用户各有独立命名空间，不能读到该飞书对话。
    for (const key of ['console', JSON.stringify(['feishu', identity.appId, 'ou_other']), JSON.stringify(['feishu', 'cli_fedcba9876543210', identity.allowedOpenId])]) {
      const isolated = await createPiExecutor(config, tasks, key);
      try {
        const reply = await isolated.execute({ scope: 'chat', prompt: '我们讨论什么？', signal: new AbortController().signal, observer: { event: () => {}, modelCall: () => {} } });
        assert.equal(reply.text, '没有项目上下文');
      } finally { await isolated.close(); }
    }
  } finally {
    await feishu.stop(); await executor.close(); store.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('仅打开宿主指定文件；无关 Pi 会话不加载，权限收紧，无效文件拒绝覆盖', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-session-files-'));
  const config = readConfig({ LLM_API_KEY: 'fake-model-secret', SESSION_DIR: directory });
  const store = new SqliteStore(':memory:');
  const tasks = new TaskService(store, config.timeZone);
  let executor: Awaited<ReturnType<typeof createPiExecutor>> | undefined;
  try {
    const unrelated = SessionManager.create(process.cwd(), directory);
    unrelated.appendMessage({ role: 'user', content: 'UNRELATED_CLI_MARKER', timestamp: Date.now() });
    executor = await createPiExecutor(config, tasks);
    await executor.close();
    const file = join(directory, createHash('sha256').update('console').digest('hex'), 'chat.session.jsonl');
    assert.ok(!readFileSync(file, 'utf8').includes('UNRELATED_CLI_MARKER'));
    chmodSync(file, 0o644);
    chmodSync(join(file, '..'), 0o755);
    executor = await createPiExecutor(config, tasks);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(file, '..')).mode & 0o777, 0o700);
    await executor.close();
    const invalid = 'not a Pi session\n';
    writeFileSync(file, invalid);
    await assert.rejects(createPiExecutor(config, tasks), /not a valid/);
    assert.equal(readFileSync(file, 'utf8'), invalid, '恢复失败不能清空原始证据');
  } finally {
    await executor?.close(); store.close(); rmSync(directory, { recursive: true, force: true });
  }
});
