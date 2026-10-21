import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentExecutor, Channel } from '../src/contracts.js';
import { ExecutionInterrupted } from '../src/contracts.js';
import { TaskScheduler } from '../src/scheduler.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';

function setup(execute: AgentExecutor['execute'], channel: Channel = { sendMessage: async () => {} }) {
  const store = new SqliteStore(':memory:');
  const tasks = new TaskService(store, 'Asia/Taipei', () => new Date('2026-10-20T00:00:00Z'));
  const task = tasks.create('运行任务', '1分钟后');
  const errors: unknown[] = [];
  const scheduler = new TaskScheduler(store, { execute, close: async () => {} }, channel, 5, (error) => errors.push(error), () => new Date('2026-10-20T00:01:00Z'));
  return { store, task, scheduler, errors };
}

test('没有到期任务不检查 Memory，故障阻塞中的 pending 仍可取消', async () => {
  const store = new SqliteStore(':memory:');
  const tasks = new TaskService(store, 'Asia/Taipei', () => new Date('2026-10-20T00:00:00Z'));
  const task = tasks.create('运行任务', '1分钟后');
  let now = new Date('2026-10-20T00:00:00Z');
  let checks = 0, calls = 0;
  const errors: unknown[] = [];
  const executor: AgentExecutor = {
    checkReady: () => { checks++; throw new Error('Memory 暂不可用'); },
    execute: async () => { calls++; return { text: '不应执行' }; }, close: async () => {},
  };
  const scheduler = new TaskScheduler(store, executor, { sendMessage: async () => { throw new Error('不应发送'); } }, 5, (error) => errors.push(error), () => now);
  try {
    await scheduler.tick();
    assert.equal(checks, 0, '未来任务不触发全量 Memory 检查');
    now = new Date('2026-10-20T00:01:00Z');
    await scheduler.tick();
    assert.equal(store.getTask(task.id)?.status, 'pending');
    assert.equal(tasks.cancel(task.id).status, 'cancelled');
    await scheduler.tick();
    assert.equal(checks, 1, '取消后不再检查或领取');
    assert.equal(calls, 0);
    assert.equal(store.listRuns().length, 0);
    assert.equal(errors.length, 1);
  } finally { await scheduler.stop(); store.close(); }
});

test('无需 Console，调度器独立循环；并发 tick 不重复执行', async () => {
  let calls = 0;
  const messages: string[] = [];
  const { store, task, scheduler } = setup(async (request) => {
    calls++;
    assert.equal(request.scope, 'task');
    await delay(10);
    return { text: '结果' };
  }, { sendMessage: async (message) => { messages.push(message.text); } });
  try {
    scheduler.start();
    await scheduler.tick();
    for (let i = 0; i < 100 && store.getTask(task.id)?.status === 'running'; i++) await delay(5);
    assert.equal(store.getTask(task.id)?.status, 'succeeded');
    assert.equal(calls, 1);
    assert.deepEqual(messages, ['结果']);
    assert.ok(store.events(store.listRuns()[0]!.id).some((event) => event.type === 'delivery_succeeded'));
  } finally { await scheduler.stop(); store.close(); }
});

test('模型失败保存错误，无自动重试', async () => {
  let calls = 0;
  const { store, task, scheduler } = setup(async () => { calls++; throw new Error('模型不可用'); });
  try {
    await scheduler.tick(); await scheduler.tick();
    assert.equal(store.getTask(task.id)?.status, 'failed');
    assert.match(store.listRuns()[0]!.error!, /模型不可用/);
    assert.equal(calls, 1);
  } finally { await scheduler.stop(); store.close(); }
});

test('投递失败保存 deliveryError，保持任务成功，不重新执行', async () => {
  let calls = 0;
  const { store, task, scheduler, errors } = setup(async () => { calls++; return { text: '已生成' }; }, {
    sendMessage: async () => { throw new Error('消息渠道不可用'); },
  });
  try {
    await scheduler.tick(); await scheduler.tick();
    assert.equal(store.getTask(task.id)?.status, 'succeeded');
    assert.equal(store.listRuns()[0]!.output, '已生成');
    assert.equal(store.listRuns()[0]!.deliveryError, '消息渠道不可用');
    assert.equal(errors.length, 1);
    assert.equal(calls, 1);
  } finally { await scheduler.stop(); store.close(); }
});

test('关闭后台服务会中断当前任务，不放回 pending', async () => {
  const { store, task, scheduler } = setup(async (request) => {
    await new Promise<void>((resolve) => request.signal.addEventListener('abort', () => resolve(), { once: true }));
    throw new ExecutionInterrupted('服务停止');
  });
  try {
    scheduler.start();
    await scheduler.stop();
    assert.equal(store.getTask(task.id)?.status, 'interrupted');
    assert.equal(store.claimDue('2099-01-01T00:00:00.000Z'), undefined);
  } finally { store.close(); }
});
