import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { MessageTarget } from '../src/contracts.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { prepareWorkRoute } from '../src/work-router.js';
import type { WorkRouteRequest } from '../src/work-router.js';
import { WorkThreadService } from '../src/work-thread-service.js';

const now = '2026-11-01T00:00:00.000Z';
const target = { channel: 'web', userId: 'local-user' } as const;
const actor = { owner: 'web:local-user', channel: JSON.stringify(target) };
const goalActor = { ownerId: 'local-user', target };
function fixture() {
  const store = new SqliteStore(':memory:'); let memoryReads = 0;
  const memory = { listForHost() { memoryReads++; throw new Error('不应读取 Memory 正文'); } };
  const service = new WorkThreadService(store, memory, { owner: actor.owner, target }, true);
  const input = (selection: WorkRouteRequest['selection'] = {}, text = '讨论本次工作'): WorkRouteRequest =>
    ({ mode: 'suggest', requestId: randomUUID(), text, selection });
  const thread = (title = '合成主题') => service.create(randomUUID(), title);
  const task = (instruction = '合成任务', destination: MessageTarget = target) => store.createTask(instruction, now, now, destination);
  const goal = (objective = '合成目标', destination: MessageTarget = target) =>
    store.goals.create({ ownerId: 'local-user', target: destination }, store.beginRun(null, now).id, objective, now);
  return { store, service, memory, input, thread, task, goal, memoryReads: () => memoryReads };
}

test('路由只读主题与Goal/Task元数据；有Memory关联也零正文读取，旧detail行为保留', () => {
  const f = fixture(); try {
    const thread = f.thread(), task = f.task(), goal = f.goal();
    f.service.link(thread.id, 'task', task.id); f.service.link(thread.id, 'goal', goal.id);
    f.store.workThreads.link(actor, thread.id, 'memory', randomUUID(), now);
    f.store.workThreads.link(actor, thread.id, 'run', f.store.beginRun(null, now).id, now);
    const before = [f.store.listTasks(), f.store.listRuns(), f.store.goals.list(goalActor), f.store.workJobs.list(actor), f.service.list()];
    const result = prepareWorkRoute(f.input({ threadId: thread.id }), f.service);
    assert.equal(result.suggestion, null);
    assert.deepEqual(result.context.objects.map(object => object.kind).sort(), ['goal', 'task']);
    assert.ok(result.context.objects.every(object => Object.keys(object).sort().join(',') === 'id,kind,status,title,updatedAt'));
    assert.equal(f.memoryReads(), 0);
    assert.deepEqual([f.store.listTasks(), f.store.listRuns(), f.store.goals.list(goalActor), f.store.workJobs.list(actor), f.service.list()], before);
    assert.throws(() => f.service.detail(thread.id), /不应读取 Memory/); assert.equal(f.memoryReads(), 1);
  } finally { f.store.close(); }
});

test('明确任务和Goal只定位建议，不制造原Guard引用或执行；对象状态每次重读', () => {
  const f = fixture(); try {
    const thread = f.thread(), task = f.task(), goal = f.goal();
    for (const [kind, object] of [['task', task], ['goal', goal]] as const) {
      f.service.link(thread.id, kind, object.id);
      const result = prepareWorkRoute(f.input({ object: { kind, id: object.id } }), f.service);
      assert.equal(result.suggestion?.kind, `existing_${kind}`);
      assert.equal(result.suggestion && 'threadId' in result.suggestion ? result.suggestion.threadId : undefined, thread.id);
      assert.equal(result.context.threads[0]?.id, thread.id);
      assert.ok(!JSON.stringify(result).includes('grant'));
    }
    f.store.cancelTask(task.id, now);
    const result = prepareWorkRoute(f.input({ threadId: thread.id, object: { kind: 'task', id: task.id } }), f.service);
    assert.equal(result.context.objects.find(object => object.id === task.id)?.status, 'cancelled');
    assert.equal(f.store.workJobs.list(actor).length, 0); assert.equal(f.memoryReads(), 0);
  } finally { f.store.close(); }
});

test('错误、不可见与归档主题拒绝，不改选其他主题；可信owner/channel均沿用', () => {
  const f = fixture(); try {
    for (const binding of [{ ...actor, owner: 'other' }, { ...actor, channel: '{"channel":"console"}' }]) {
      const foreign = f.store.workThreads.create(binding, randomUUID(), '不可见主题', now);
      assert.throws(() => prepareWorkRoute(f.input({ threadId: foreign.id }), f.service), /无权访问/);
    }
    for (const id of ['bad-id', randomUUID()]) assert.throws(() => prepareWorkRoute(f.input({ threadId: id }), f.service), /无权访问/);
    const archived = f.thread(); f.service.update(archived.id, { status: 'archived' });
    assert.throws(() => prepareWorkRoute(f.input({ threadId: archived.id }), f.service), /恢复主题/);
    assert.deepEqual(prepareWorkRoute(f.input(), f.service).context.threads, []);
  } finally { f.store.close(); }
});

test('明确对象逐个验证原归属；关联不授权，Goal关闭也不能定位', () => {
  const f = fixture(); try {
    const thread = f.thread();
    for (const destination of [{ channel: 'console' }, { channel: 'feishu', appId: 'a', userOpenId: 'u', chatId: 'c' },
      { channel: 'web', userId: 'other' }] as const) {
      for (const [kind, object] of [['task', f.task('不可见任务', destination)], ['goal', f.goal('不可见目标', destination)]] as const) {
        f.store.workThreads.link(actor, thread.id, kind, object.id, now);
        assert.throws(() => prepareWorkRoute(f.input({ object: { kind, id: object.id } }), f.service), /无权访问/);
      }
    }
    for (const kind of ['task', 'goal'] as const) for (const id of ['bad-id', randomUUID()])
      assert.throws(() => prepareWorkRoute(f.input({ object: { kind, id } }), f.service), /无权访问/);
    assert.deepEqual(prepareWorkRoute(f.input({ threadId: thread.id }), f.service).context.objects, []);
    const ownGoal = f.goal(); f.service.link(thread.id, 'goal', ownGoal.id);
    const off = new WorkThreadService(f.store, f.memory, { owner: actor.owner, target }, false);
    assert.throws(() => prepareWorkRoute(f.input({ object: { kind: 'goal', id: ownGoal.id } }), off), /无权访问/);
    assert.deepEqual(prepareWorkRoute(f.input({ threadId: thread.id }), off).context.objects, []);
    assert.equal(f.memoryReads(), 0);
  } finally { f.store.close(); }
});

test('显式主题/对象冲突及多个关联主题只澄清；不按同名或相似度擅选', () => {
  const f = fixture(); try {
    const a = f.thread('面试准备'), b = f.thread('面试准备'), task = f.task('面试准备');
    f.service.link(a.id, 'task', task.id);
    assert.equal(prepareWorkRoute(f.input({ threadId: b.id, object: { kind: 'task', id: task.id } }), f.service).suggestion?.kind, 'clarify');
    f.service.link(b.id, 'task', task.id);
    const multiple = prepareWorkRoute(f.input({ object: { kind: 'task', id: task.id } }), f.service);
    assert.equal(multiple.suggestion?.kind, 'clarify'); assert.equal(multiple.context.threads.length, 2);
    const selected = prepareWorkRoute(f.input({ threadId: a.id, object: { kind: 'task', id: task.id } }), f.service);
    assert.equal(selected.suggestion?.kind, 'existing_task'); assert.equal(selected.context.threads[0]?.id, a.id);
    f.service.unlink(a.id, 'task', task.id);
    assert.equal(prepareWorkRoute(f.input({ threadId: a.id, object: { kind: 'task', id: task.id } }), f.service).suggestion?.kind, 'clarify');
    const unlinked = f.task('无主题任务');
    const located = prepareWorkRoute(f.input({ object: { kind: 'task', id: unlinked.id } }), f.service);
    assert.equal(located.suggestion?.kind, 'existing_task'); assert.deepEqual(located.context.threads, []);
    assert.equal(f.store.workJobs.list(actor).length, 0);
  } finally { f.store.close(); }
});

test('20主题可供建议，21主题要求缩小而不截断；明确选择优先，归档不混入', () => {
  const f = fixture(); try {
    for (let i = 0; i < 20; i++) f.thread();
    const bounded = prepareWorkRoute(f.input(), f.service);
    assert.equal(bounded.suggestion, null); assert.equal(bounded.context.threads.length, 20);
    const selected = f.thread();
    const over = prepareWorkRoute(f.input(), f.service); assert.equal(over.suggestion?.kind, 'clarify'); assert.deepEqual(over.context.threads, []);
    assert.equal(prepareWorkRoute(f.input({ threadId: selected.id }), f.service).context.threads.length, 1);
    f.service.update(selected.id, { status: 'archived' });
    assert.equal(prepareWorkRoute(f.input(), f.service).context.threads.length, 20);
  } finally { f.store.close(); }
});

test('所选主题Goal/Task合计20项可用，21项要求缩小；不把截断当作完整候选', () => {
  const f = fixture(); try {
    const thread = f.thread();
    for (let i = 0; i < 10; i++) {
      f.service.link(thread.id, 'task', f.task().id); f.service.link(thread.id, 'goal', f.goal().id);
    }
    assert.equal(prepareWorkRoute(f.input({ threadId: thread.id }), f.service).context.objects.length, 20);
    f.service.link(thread.id, 'task', f.task().id);
    const result = prepareWorkRoute(f.input({ threadId: thread.id }), f.service);
    assert.equal(result.suggestion?.kind, 'clarify'); assert.deepEqual(result.context, { threads: [], objects: [] });
    assert.equal(f.memoryReads(), 0);
  } finally { f.store.close(); }
});

test('候选8KiB及输入14KiB按UTF8字节计算，超量只澄清且不静默裁剪', () => {
  const f = fixture(); try {
    const thread = f.thread();
    for (let i = 0; i < 12; i++) f.service.link(thread.id, 'task', f.task('中'.repeat(240)).id);
    assert.equal(prepareWorkRoute(f.input({ threadId: thread.id }), f.service).suggestion?.kind, 'clarify');
    const empty = f.thread();
    assert.equal(prepareWorkRoute(f.input({ threadId: empty.id }, 'x'.repeat(14 * 1024)), f.service).suggestion, null);
    assert.equal(prepareWorkRoute(f.input({ threadId: empty.id }, '中'.repeat(4780)), f.service).suggestion?.kind, 'clarify');
    assert.equal(f.store.workJobs.list(actor).length, 0); assert.equal(f.memoryReads(), 0);
  } finally { f.store.close(); }
});
