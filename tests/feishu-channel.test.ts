import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { redactor } from '../src/config.js';
import type { AgentExecutor, MessageTarget } from '../src/contracts.js';
import type { FeishuTransport } from '../src/feishu-transport.js';
import { FeishuChannel, splitFeishuText } from '../src/feishu-channel.js';
import { ChannelRouter } from '../src/channel-router.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { TaskScheduler } from '../src/scheduler.js';

const config = { appId: 'cli_0123456789abcdef', appSecret: 'test-app-secret', allowedOpenId: 'ou_owner' };
const now = new Date('2026-10-20T00:00:00Z');
const target: MessageTarget = { channel: 'feishu', appId: config.appId, userOpenId: config.allowedOpenId, chatId: 'oc_original' };
const incoming = (id = 'message-1', text = '你好', user = 'ou_owner') => ({
  sender: { sender_type: 'user', sender_id: { open_id: user } },
  message: { message_id: id, chat_id: 'oc_original', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) },
});

class Transport implements FeishuTransport {
  sent: { chatId: string; text: string; uuid: string }[] = [];
  fail = false;
  receive?: (event: unknown) => void;
  async start(receive: (event: unknown) => void): Promise<void> { this.receive = receive; }
  stop(): void {}
  async sendText(chatId: string, text: string, uuid: string): Promise<void> {
    if (this.fail) throw new Error('消息发送失败');
    this.sent.push({ chatId, text, uuid });
  }
}

function setup(execute: (tasks: TaskService) => AgentExecutor['execute'], store = new SqliteStore(':memory:')) {
  const tasks = new TaskService(store, 'Asia/Taipei', () => now);
  const transport = new Transport();
  const errors: unknown[] = [];
  const executor: AgentExecutor = { execute: execute(tasks), close: async () => {} };
  const channel = new FeishuChannel(config, transport, executor, tasks, store, redactor(config.appSecret), (error) => errors.push(error));
  return { store, tasks, transport, executor, channel, errors };
}

test('只接受白名单用户文本私聊；非法/非文本事件不调用模型也不留下执行记录', async () => {
  let calls = 0;
  const { store, channel, transport } = setup(() => async () => { calls++; return { text: '你好' }; });
  try {
    channel.receive(incoming('same-id', '你好', 'ou_other'));
    channel.receive({ ...incoming(), sender: { sender_type: 'app' } });
    channel.receive({ ...incoming(), message: { ...incoming().message, chat_type: 'group' } });
    channel.receive({ ...incoming(), message: { ...incoming().message, message_type: 'image' } });
    channel.receive({ ...incoming(), message: { ...incoming().message, content: '{invalid' } });
    channel.receive(incoming('empty', ' '));
    channel.receive(incoming('large', 'a'.repeat(10001)));
    channel.receive(null);
    await channel.drain();
    assert.equal(calls, 0);
    assert.equal(store.listRuns().length, 0);
    await channel.start();
    transport.receive!(incoming('same-id'));
    await channel.drain();
    assert.equal(calls, 1, '未授权事件不能抢占合法事件的去重记录');
    assert.equal(transport.sent[0]!.chatId, 'oc_original');
  } finally { await channel.stop(); store.close(); }
});

test('接收立即返回，同一交互 Executor 串行执行；失败后下一消息仍可处理', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let active = 0;
  let maxActive = 0;
  let calls = 0;
  const { store, channel, transport } = setup(() => async (request) => {
    assert.equal(request.scope, 'chat');
    active++; maxActive = Math.max(maxActive, active); calls++;
    if (calls === 1) { await gate; active--; throw new Error('模拟模型失败'); }
    active--;
    return { text: '第二次成功' };
  });
  try {
    channel.receive(incoming('first'));
    channel.receive(incoming('second'));
    await delay(0);
    assert.equal(store.listRuns().length, 2, '模型未结束时第二条事件也已经接收落盘');
    assert.equal(calls, 1);
    release();
    await channel.drain();
    assert.equal(calls, 2);
    assert.equal(maxActive, 1);
    assert.equal(transport.sent.at(-1)!.text, '第二次成功');
    assert.deepEqual(store.listRuns().map((run) => run.status).sort(), ['failed', 'succeeded']);
  } finally { release(); await channel.stop(); store.close(); }
});

test('重复事件跨重启去重；Pending 任务目标持久化，无新消息也能主动通知原会话', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-feishu-'));
  const path = join(directory, 'agent.db');
  let calls = 0;
  const first = setup((tasks) => async () => { calls++; tasks.create('提醒喝水', '1分钟后'); return { text: '已创建' }; }, new SqliteStore(path));
  let second: ReturnType<typeof setup> | undefined;
  let scheduler: TaskScheduler | undefined;
  try {
    first.channel.receive(incoming()); first.channel.receive(incoming());
    await first.channel.drain();
    assert.equal(calls, 1);
    assert.equal(first.tasks.list().length, 1);
    assert.deepEqual(first.tasks.list()[0]!.target, target);
    const taskId = first.tasks.list()[0]!.id;
    // 飞书上下文结束后，普通 Console 创建仍默认 Console。
    assert.deepEqual(first.tasks.create('控制台任务', '1小时后').target, { channel: 'console' });
    await first.channel.stop(); first.store.close();
    second = setup(() => async (request) => {
      assert.equal(request.scope, 'task'); calls++;
      return { text: '该喝水了' };
    }, new SqliteStore(path));
    second.store.recoverInterrupted(now.toISOString());
    second.channel.receive(incoming());
    await second.channel.drain();
    assert.equal(calls, 1, '重投消息不能重新调用模型或创建任务');
    const router = new ChannelRouter({ sendMessage: async () => { throw new Error('不应路由到 Console'); } }, second.channel);
    scheduler = new TaskScheduler(second.store, second.executor, router, 10, (error) => { throw error; }, () => new Date('2026-10-20T00:02:00Z'));
    await scheduler.tick(); await scheduler.tick();
    assert.equal(calls, 2);
    assert.equal(second.store.getTask(taskId)?.status, 'succeeded');
    assert.equal(second.transport.sent.length, 1);
    assert.deepEqual(second.transport.sent[0], { chatId: 'oc_original', text: '该喝水了', uuid: second.transport.sent[0]!.uuid });
  } finally {
    await scheduler?.stop();
    if (second) { await second.channel.stop(); second.store.close(); }
    else { await first.channel.stop(); first.store.close(); }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('飞书发送失败只记录 deliveryError，不重复创建或执行任务', async () => {
  let calls = 0;
  const { store, tasks, channel, transport, executor } = setup((tasks) => async (request) => {
    calls++;
    if (request.scope === 'chat') tasks.create('喝水', '1分钟后');
    return { text: '结果' };
  });
  transport.fail = true;
  const scheduler = new TaskScheduler(store, executor, new ChannelRouter({ sendMessage: async () => { throw new Error('不应路由到 Console'); } }, channel), 10, () => {}, () => new Date('2026-10-20T00:02:00Z'));
  try {
    channel.receive(incoming()); await channel.drain();
    channel.receive(incoming()); await channel.drain();
    assert.equal(calls, 1);
    assert.equal(store.listRuns()[0]!.status, 'succeeded');
    assert.equal(store.listRuns()[0]!.deliveryError, '消息发送失败');
    await scheduler.tick(); await scheduler.tick();
    assert.equal(calls, 2);
    assert.equal(tasks.list()[0]!.status, 'succeeded');
    assert.equal(store.listRuns(tasks.list()[0]!.id)[0]!.deliveryError, '消息发送失败');
  } finally { await scheduler.stop(); await channel.stop(); store.close(); }
});

test('入站崩溃窗口保守去重，停止时中断排队消息；不自动重放已接收事件', async () => {
  let calls = 0;
  const { store, channel } = setup(() => async () => { calls++; return { text: '不应执行' }; });
  try {
    store.acceptFeishuMessage(config.appId, 'crashed', now.toISOString());
    store.recoverInterrupted(now.toISOString());
    channel.receive(incoming('crashed'));
    channel.receive(incoming('queued'));
    await channel.stop();
    assert.equal(calls, 0);
    assert.ok(store.listRuns().every((run) => run.status === 'interrupted'));
  } finally { store.close(); }
});

test('发送目标与应用、用户白名单绑定；没有飞书渠道时禁止回退；长消息安全分片', async () => {
  const { store, channel, transport } = setup(() => async () => ({ text: 'unused' }));
  try {
    const message = { text: '结果', runId: 'run-test', target };
    await assert.rejects(channel.sendMessage({ ...message, target: { ...target, userOpenId: 'ou_other' } }), /拒绝发送/);
    await assert.rejects(channel.sendMessage({ ...message, target: { ...target, appId: 'different-app' } }), /拒绝发送/);
    const router = new ChannelRouter({ sendMessage: async () => { throw new Error('不能回退'); } });
    await assert.rejects(router.sendMessage(message), /--feishu/);
    const text = ('中文😀\u0000"\\\n').repeat(4000);
    const parts = splitFeishuText(text);
    assert.equal(parts.join(''), text);
    assert.ok(parts.every((part) => Buffer.byteLength(JSON.stringify({ text: part })) <= 16000));
    await channel.sendMessage({ ...message, text });
    assert.equal(transport.sent.length, parts.length);
    assert.equal(new Set(transport.sent.map((sent) => sent.uuid)).size, parts.length);
    assert.ok(transport.sent.every((sent) => sent.uuid.length === 32));
  } finally { await channel.stop(); store.close(); }
});

test('V0 SQLite 增量迁移保留旧任务，目标默认 Console，可重复打开', () => {
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-migration-'));
  const path = join(directory, 'old.db');
  const legacy = new DatabaseSync(path);
  legacy.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, instruction TEXT NOT NULL, dueAt TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL) STRICT`);
  legacy.prepare('INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?)').run('legacy', '旧任务', '2026-10-20T00:01:00.000Z', 'pending', now.toISOString(), now.toISOString());
  legacy.close();
  try {
    for (let i = 0; i < 2; i++) {
      const store = new SqliteStore(path);
      assert.equal(store.getTask('legacy')?.instruction, '旧任务');
      assert.equal(store.getTask('legacy')?.status, 'pending');
      assert.deepEqual(store.getTask('legacy')?.target, { channel: 'console' });
      store.close();
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
