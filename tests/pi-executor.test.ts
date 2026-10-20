import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { ExecutionInterrupted } from '../src/contracts.js';
import type { ExecutionRequest } from '../src/contracts.js';
import { PiExecutor, runPiSession } from '../src/pi-executor.js';

const usage = { input: 10, output: 5, cacheRead: 2, cacheWrite: 0, totalTokens: 17, cost: { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 } };
const message = (stopReason: 'stop' | 'error' | 'aborted' | 'length' = 'stop'): AgentSessionEvent => ({
  type: 'message_end', message: {
    role: 'assistant', api: 'openai-completions', provider: 'unit-test', model: 'stub', content: [{ type: 'text', text: '结果' }],
    usage, stopReason, timestamp: Date.now(), ...(stopReason === 'error' ? { errorMessage: 'API 故障' } : {}),
  },
});

function fakeSession(action: (emit: (event: AgentSessionEvent) => void) => Promise<void>) {
  let listener: (event: AgentSessionEvent) => void = () => {};
  let disposed = false;
  let aborts = 0;
  return {
    prompt: async () => action((event) => listener(event)),
    subscribe: (callback: (event: AgentSessionEvent) => void) => { listener = callback; return () => { listener = () => {}; }; },
    abort: async () => { aborts++; listener({ type: 'agent_settled', aborted: true }); },
    dispose: () => { disposed = true; },
    getLastAssistantText: () => '结果',
    get disposed() { return disposed; }, get aborts() { return aborts; },
  };
}

function request(scope: 'chat' | 'task' = 'task'): ExecutionRequest & { events: string[]; calls: unknown[] } {
  const events: string[] = [];
  const calls: unknown[] = [];
  return { prompt: '测试', scope, signal: new AbortController().signal, observer: { event: (type) => { events.push(type); }, modelCall: (call) => { calls.push(call); } }, events, calls };
}

test('agent_end 不够，必须 agent_settled；模型用量来自 message_end', async () => {
  const req = request();
  const session = fakeSession(async (emit) => {
    emit({ type: 'agent_start' }); emit(message());
    emit({ type: 'agent_end', messages: [], willRetry: false });
    await delay(5);
    emit({ type: 'agent_settled', aborted: false });
  });
  assert.deepEqual(await runPiSession(session, req, 1000), { text: '结果' });
  assert.deepEqual(req.events, ['agent_start', 'agent_end', 'agent_settled']);
  assert.equal(req.calls.length, 1);
  assert.equal((req.calls[0] as { inputTokens: number }).inputTokens, 10);
  const incomplete = fakeSession(async (emit) => { emit(message()); emit({ type: 'agent_end', messages: [], willRetry: false }); });
  await assert.rejects(runPiSession(incomplete, request(), 1000), /agent_settled/);
});

test('agent_settled 不是成功标志：模型错误、截断和 aborted 分别处理', async () => {
  for (const reason of ['error', 'length', 'aborted'] as const) {
    const session = fakeSession(async (emit) => { emit(message(reason)); emit({ type: 'agent_settled', aborted: reason === 'aborted' }); });
    await assert.rejects(runPiSession(session, request(), 1000), reason === 'aborted' ? ExecutionInterrupted : Error);
  }
});

test('超时、外部取消触发 abort；写日志失败不能报告成功', async () => {
  const timeout = fakeSession(async (emit) => { await delay(30); emit(message()); emit({ type: 'agent_settled', aborted: false }); });
  await assert.rejects(runPiSession(timeout, request(), 5), ExecutionInterrupted);
  assert.equal(timeout.aborts, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runPiSession(timeout, { ...request(), signal: controller.signal }, 100), ExecutionInterrupted);
  const req = request();
  req.observer.modelCall = () => { throw new Error('磁盘写入失败'); };
  const session = fakeSession(async (emit) => { emit(message()); emit({ type: 'agent_settled', aborted: false }); });
  await assert.rejects(runPiSession(session, req, 1000), /日志写入失败/);
  const eventFailure = request();
  eventFailure.observer.event = () => { throw new Error('事件写入失败'); };
  const eventSession = fakeSession(async (emit) => { emit({ type: 'agent_start' }); });
  await assert.rejects(runPiSession(eventSession, eventFailure, 1000), /日志写入失败/);
  assert.equal(eventSession.aborts, 1, '日志失败后的 abort 不可递归触发');
});

test('交互复用一个 Session，每次后台任务使用新 Session 并 dispose', async () => {
  const created: { scope: string; session: ReturnType<typeof fakeSession> }[] = [];
  const executor = new PiExecutor(async (scope) => {
    const session = fakeSession(async (emit) => { emit(message()); emit({ type: 'agent_settled', aborted: false }); });
    created.push({ scope, session });
    return session;
  }, 1000);
  try {
    await executor.execute(request('chat'));
    await executor.execute(request('task'));
    await executor.execute(request('task'));
    await executor.execute(request('chat'));
    assert.deepEqual(created.map((item) => item.scope), ['chat', 'task', 'task']);
    assert.equal(created[0]!.session.disposed, false);
    assert.equal(created[1]!.session.disposed, true);
    assert.equal(created[2]!.session.disposed, true);
  } finally { await executor.close(); }
  assert.equal(created[0]!.session.disposed, true);
});
