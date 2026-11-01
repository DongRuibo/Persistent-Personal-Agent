import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';
import { WorkThreadService } from '../src/work-thread-service.js';
import { WorkRecallService } from '../src/work-recall.js';
import { prepareWorkRoute } from '../src/work-router.js';
import type { MessageTarget } from '../src/contracts.js';

const now = '2026-11-02T00:00:00.000Z', target = { channel: 'web', userId: 'local-user' } as const;
const binding = { owner: 'web:local-user', channel: JSON.stringify(target) };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'recall-r1-')), store = new SqliteStore(join(root, 'app.db'));
  const db = new DatabaseSync(join(root, 'app.db')); let memoryReads = 0;
  const memory = { listForHost() { memoryReads++; throw new Error('不应读取Memory'); } };
  const threads = new WorkThreadService(store, memory, { owner: binding.owner, target }, true), recall = new WorkRecallService(threads);
  const thread = (title = '面试准备') => threads.create(randomUUID(), title);
  const task = (instruction = '面试计划', destination: MessageTarget = target) => store.createTask(instruction, now, now, destination);
  const eventSource = (threadId: string, repository = 'fiction/agent') => {
    const source = store.sourceEvents.permit(binding, { requestId: randomUUID(), watch: { kind: 'github', repository, branch: 'main', intervalSeconds: 60 } }, now);
    store.sourceEvents.subscribe(binding, { id: randomUUID(), sourceId: source.id, threadId }, now, threads);
    return source.id;
  };
  const publish = (sourceId: string, n: number, at = now) => {
    store.sourceEvents.record(binding, store.sourceEvents.get(binding, sourceId), { head: n.toString(16).padStart(40, '0'),
      commits: [{ sha: n.toString(16).padStart(40, '0'), message: 'SNAPSHOT_BODY_NEVER_READ', url: 'https://github.com/fiction/agent/commit/mock' }], changes: [] }, at, threads);
    return store.sourceEvents.events(binding, sourceId)[0];
  };
  return { root, store, db, threads, recall, thread, task, eventSource, publish, memoryReads: () => memoryReads,
    close() { db.close(); store.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('R1元数据定位零Memory/Run正文/snapshot读取与业务写入；旧B1不变', () => {
  const f = fixture(); try {
    const t = f.thread(), task = f.task(), goal = f.store.goals.create({ ownerId: 'local-user', target }, f.store.beginRun(null, now).id, '面试目标', now);
    f.threads.link(t.id, 'task', task.id); f.threads.link(t.id, 'goal', goal.id);
    const run = f.store.webUi.accept(binding.owner, randomUUID(), '合成对话', now);
    f.store.finishRun(run.id, 'succeeded', now, 'RUN_BODY_NEVER_READ'); f.threads.link(t.id, 'run', run.id);
    f.store.workThreads.link(binding, t.id, 'memory', randomUUID(), now);
    f.store.workJobs.create(binding, t.id, randomUUID(), '后台草稿', now);
    const source = f.eventSource(t.id); f.publish(source, 1); f.publish(source, 2);
    const tables = f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => String(row.name));
    const snapshot = () => JSON.stringify(tables.map(name => [name, f.db.prepare(`SELECT * FROM "${name}"`).all()]));
    const before = snapshot();
    f.store.getRun = () => { throw new Error('不应调用含正文的getRun'); };
    f.store.sourceEvents.event = () => { throw new Error('不应读取snapshot'); };
    const result = f.recall.locate({ query: '', selection: { threadId: t.id } });
    assert.deepEqual(result.objects.map(object => object.kind).sort(), ['event', 'goal', 'job', 'run', 'task']);
    assert.ok(!JSON.stringify(result).includes('BODY_NEVER_READ')); assert.equal(f.memoryReads(), 0);
    assert.equal(snapshot(), before);
    assert.deepEqual(prepareWorkRoute({ mode: 'suggest', requestId: randomUUID(), text: '', selection: { threadId: t.id } }, f.threads).context.objects.map(o => o.kind).sort(), ['goal', 'task']);
  } finally { f.close(); }
});

test('明确对象/主题优先，不被其他21主题或本主题21关联堵住；关系冲突准确', () => {
  const f = fixture(); try {
    const selected = f.thread(), task = f.task(); f.threads.link(selected.id, 'task', task.id);
    for (let i = 0; i < 21; i++) { f.thread(); f.threads.link(selected.id, 'task', f.task().id); }
    assert.equal(f.recall.locate({ query: '随意复杂表达', selection: { threadId: selected.id, object: { kind: 'task', id: task.id } } }).status, 'located');
    assert.equal(f.recall.locate({ query: '', selection: { threadId: selected.id } }).status, 'clarify');
    assert.deepEqual(f.recall.locate({ query: '' }).threads, []);
    const other = f.thread();
    assert.match(f.recall.locate({ query: '', selection: { threadId: other.id, object: { kind: 'task', id: task.id } } }).question!, /没有关联/);
    f.threads.link(other.id, 'task', task.id);
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'task', id: task.id } } }).status, 'clarify');
  } finally { f.close(); }
});

test('明确Job/Run/事件ID均可读取100项以外历史，归档不阻止历史；B1仍拒绝归档', () => {
  const f = fixture(); try {
    const t = f.thread(), oldJob = f.store.workJobs.create(binding, t.id, randomUUID(), '最早工作', now);
    const run = f.store.webUi.accept(binding.owner, randomUUID(), '最早Run', now); f.threads.link(t.id, 'run', run.id);
    const source = f.eventSource(t.id); f.publish(source, 1); const oldEvent = f.publish(source, 2)!;
    for (let i = 0; i < 105; i++) {
      f.store.workJobs.create(binding, t.id, randomUUID(), `新工作${i}`, now);
      f.store.webUi.accept(binding.owner, randomUUID(), `新Run${i}`, now); f.publish(source, i + 3);
    }
    assert.ok(!f.store.workJobs.list(binding, t.id).some(job => job.id === oldJob.id));
    assert.ok(!f.store.webUi.runs(binding.owner, binding.channel).includes(run.id));
    assert.ok(!f.store.sourceEvents.events(binding, source).some(event => event.id === oldEvent.id));
    f.threads.update(t.id, { status: 'archived' });
    for (const [kind, id] of [['job', oldJob.id], ['run', run.id], ['event', oldEvent.id]] as const) {
      const result = f.recall.locate({ query: '刚才那个', selection: { threadId: t.id, object: { kind, id } } });
      assert.equal(result.status, 'located'); assert.equal(result.objects[0]?.id, id);
    }
    assert.throws(() => prepareWorkRoute({ mode: 'suggest', requestId: randomUUID(), text: '', selection: { threadId: t.id } }, f.threads), /恢复主题/);
  } finally { f.close(); }
});

test('跨Web身份、Console/飞书与伪造link均不赋权；删除和错ID不误报成功', () => {
  const f = fixture(); try {
    const t = f.thread();
    for (const target of [{ channel: 'console' }, { channel: 'web', userId: 'other' }, { channel: 'feishu', appId: 'a', userOpenId: 'u', chatId: 'c' }] as const) {
      const task = f.task('不应访问', target); f.store.workThreads.link(binding, t.id, 'task', task.id, now);
      assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'task', id: task.id } } }).status, 'unavailable');
    }
    const foreignRun = f.store.beginRun(null, now); f.store.workThreads.link(binding, t.id, 'run', foreignRun.id, now);
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'run', id: foreignRun.id } } }).status, 'unavailable');
    const foreign = { ...binding, owner: 'other' }, hidden = f.store.workThreads.create(foreign, randomUUID(), '不可见', now);
    const job = f.store.workJobs.create(foreign, hidden.id, randomUUID(), '他人工作', now);
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'job', id: job.id } } }).status, 'unavailable');
    assert.equal(f.recall.locate({ query: '', selection: { threadId: hidden.id } }).status, 'unavailable');
    const deleted = f.task(); f.threads.link(t.id, 'task', deleted.id); f.db.prepare('DELETE FROM tasks WHERE id=?').run(deleted.id);
    for (const id of [deleted.id, randomUUID()]) assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'task', id } } }).status, 'unavailable');
    assert.deepEqual(f.recall.locate({ query: '', selection: { threadId: t.id } }).objects, []);
  } finally { f.close(); }
});

test('可见标题唯一/同名/多个合理对象确定性澄清；不把最近updatedAt当刚才', () => {
  const f = fixture(); try {
    const t = f.thread(); const task = f.task(); f.threads.link(t.id, 'task', task.id);
    assert.equal(f.recall.locate({ query: '之前准备的面试计划' }).status, 'located');
    for (const query of ['刚才那个', '刚刚', '那个面试计划']) {
      assert.equal(f.recall.locate({ query, selection: { threadId: t.id } }).status, 'clarify');
    }
    assert.equal(f.recall.locate({ query: '刚才那个', selection: { object: { kind: 'task', id: task.id } } }).status, 'located');
    f.threads.link(t.id, 'task', f.task().id);
    assert.equal(f.recall.locate({ query: '之前准备的面试计划' }).status, 'clarify');
    assert.equal(f.recall.locate({ query: '请分析以前可能做过的所有事情' }).status, 'clarify');
    const b = f.thread(); f.threads.link(b.id, 'task', task.id);
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'task', id: task.id } } }).status, 'clarify');
  } finally { f.close(); }
});

test('上次GitHub须明确主题及唯一来源，仅按observedAt；同时间及多来源澄清', () => {
  const f = fixture(); try {
    const t = f.thread(), source = f.eventSource(t.id); f.publish(source, 1); const a = f.publish(source, 2)!;
    const b = f.publish(source, 3, '2026-11-02T00:01:00.000Z')!;
    f.threads.update(t.id, { title: '最后修改的标题' });
    const input = { query: '上次GitHub更新', selection: { threadId: t.id } };
    assert.equal(f.recall.locate(input).objects[0]?.id, b.id);
    const c = f.publish(source, 4, '2026-11-02T00:01:00.000Z')!;
    assert.equal(f.recall.locate(input).status, 'clarify');
    assert.deepEqual(new Set(f.recall.locate(input).objects.map(event => event.id)), new Set([b.id, c.id]));
    const other = f.eventSource(t.id, 'fiction/other'); f.publish(other, 1); f.publish(other, 2);
    assert.match(f.recall.locate(input).question!, /选择具体事件/);
    f.thread('另一个主题'); assert.match(f.recall.locate({ query: '上次GitHub更新' }).question!, /明确GitHub更新所属/);
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'event', id: a.id } } }).status, 'located');
  } finally { f.close(); }
});

test('事件明确ID逐级关系/身份校验；源事实不因伪造或无关主题被暴露', () => {
  const f = fixture(); try {
    const a = f.thread(), b = f.thread(), source = f.eventSource(a.id); f.publish(source, 1); const event = f.publish(source, 2)!;
    assert.match(f.recall.locate({ query: '', selection: { threadId: b.id, object: { kind: 'event', id: event.id } } }).question!, /没有关联/);
    const other = new WorkThreadService(f.store, { listForHost() { throw new Error('Memory'); } }, { owner: 'other', target: { channel: 'web', userId: 'other' } }, true);
    assert.equal(new WorkRecallService(other).locate({ query: '', selection: { object: { kind: 'event', id: event.id } } }).status, 'unavailable');
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'event', id: randomUUID() } } }).status, 'unavailable');
    f.store.sourceEvents.subscribe(binding, { id: randomUUID(), sourceId: source, threadId: b.id }, now, f.threads);
    const later = f.publish(source, 3)!;
    assert.equal(f.recall.locate({ query: '', selection: { object: { kind: 'event', id: later.id } } }).status, 'clarify');
  } finally { f.close(); }
});

test('查询2KiB及入口字段一次校验，中文emoji真实字节；不接受身份和扩展字段', () => {
  const f = fixture(); try {
    const t = f.thread();
    for (const query of ['x'.repeat(2048), '中'.repeat(682) + 'xx', '😀'.repeat(512)]) assert.doesNotThrow(() => f.recall.locate({ query, selection: { threadId: t.id } }));
    for (const query of ['x'.repeat(2049), '中'.repeat(683), '😀'.repeat(512) + 'x']) assert.throws(() => f.recall.locate({ query }), /2 KiB/);
    for (const input of [null, [], { query: 1 }, { query: '', owner: 'other' }, { query: '', selection: { object: { kind: 'memory', id: 'x' } } }, { query: '', selection: { threadId: '' } }, { query: '', selection: { object: { kind: 'task', id: 'x', extra: true } } }]) assert.throws(() => f.recall.locate(input));
  } finally { f.close(); }
});

test('20/21主题与20/21对象；完整JSON8KiB含引号反斜线控制符和emoji，不静默裁剪', () => {
  const f = fixture(); try {
    for (let i = 0; i < 20; i++) f.thread(`主题${i}`);
    assert.equal(f.recall.locate({ query: '' }).threads.length, 20);
    const t = f.thread(); assert.deepEqual(f.recall.locate({ query: '' }).threads, []);
    for (let i = 0; i < 20; i++) f.threads.link(t.id, 'task', f.task(`任务${i}`).id);
    assert.equal(f.recall.locate({ query: '', selection: { threadId: t.id } }).objects.length, 20);
    f.threads.link(t.id, 'task', f.task().id);
    assert.deepEqual(f.recall.locate({ query: '', selection: { threadId: t.id } }).objects, []);
    const rich = f.thread('中文😀"\\\n');
    for (let i = 0; i < 15; i++) f.threads.link(rich.id, 'task', f.task('中😀"\\\n'.repeat(40)).id);
    const result = f.recall.locate({ query: '', selection: { threadId: rich.id } });
    assert.deepEqual(result.objects, []); assert.match(result.question!, /8 KiB/);
    assert.ok(Buffer.byteLength(JSON.stringify(result), 'utf8') <= 8192);
  } finally { f.close(); }
});


test('完整序列化候选JSON恰好8191/8192字节通过，8193只要求缩小且不保留截断子集', () => {
  const f = fixture(); try {
    const t = f.thread('x'); f.threads.link(t.id, 'task', f.task().id);
    const input = { query: '', selection: { threadId: t.id } };
    const base = Buffer.byteLength(JSON.stringify(f.recall.locate(input)), 'utf8');
    for (const bytes of [8191, 8192, 8193]) {
      f.threads.update(t.id, { title: 'x'.repeat(bytes - base + 1) });
      const result = f.recall.locate(input);
      if (bytes <= 8192) {
        assert.equal(result.objects.length, 1); assert.equal(Buffer.byteLength(JSON.stringify(result), 'utf8'), bytes);
      } else { assert.deepEqual(result.threads, []); assert.deepEqual(result.objects, []); assert.match(result.question!, /8 KiB/); }
    }
  } finally { f.close(); }
});

test('事件关联超过20主题时明确主题优先直查，不被全空间LIMIT21误报冲突', () => {
  const f = fixture(); try {
    const first = f.thread(), source = f.eventSource(first.id); f.publish(source, 1);
    let last = first;
    for (let i = 0; i < 24; i++) {
      last = f.thread(`主题${i}`);
      f.store.sourceEvents.subscribe(binding, { id: randomUUID(), sourceId: source, threadId: last.id }, now, f.threads);
    }
    const event = f.publish(source, 2)!;
    for (const threadId of [first.id, last.id]) {
      const result = f.recall.locate({ query: '', selection: { threadId, object: { kind: 'event', id: event.id } } });
      assert.equal(result.status, 'located'); assert.equal(result.objects[0]?.id, event.id); assert.equal(result.threads[0]?.id, threadId);
    }
    const multiple = f.recall.locate({ query: '', selection: { object: { kind: 'event', id: event.id } } });
    assert.equal(multiple.status, 'clarify'); assert.deepEqual(multiple.objects, []);
  } finally { f.close(); }
});

test('唯一历史主题仍不能替代上次GitHub的明确范围；选择主题后类型查询保持当前范围', () => {
  const f = fixture(); try {
    const a = f.thread('面试主题'), source = f.eventSource(a.id); f.publish(source, 1); f.publish(source, 2);
    assert.equal(f.recall.locate({ query: '上次GitHub更新' }).status, 'clarify');
    assert.equal(f.recall.locate({ query: '面试主题上次GitHub更新' }).status, 'located');
    const task = f.task(); f.threads.link(a.id, 'task', task.id); const b = f.thread('第二主题'); f.threads.link(b.id, 'task', task.id);
    const result = f.recall.locate({ query: '任务', selection: { threadId: a.id } });
    assert.equal(result.status, 'located'); assert.deepEqual(result.threads.map(t => t.id), [a.id]);
  } finally { f.close(); }
});

test('上次GitHub的唯一来源按真实订阅判定；第二来源尚无事件也不能擅选', () => {
  const f = fixture(); try {
    const t = f.thread(), source = f.eventSource(t.id);
    assert.match(f.recall.locate({ query: '上次GitHub更新', selection: { threadId: t.id } }).question!, /尚无可选事件/);
    f.publish(source, 1); f.publish(source, 2);
    f.eventSource(t.id, 'fiction/not-yet-observed');
    const result = f.recall.locate({ query: '上次GitHub更新', selection: { threadId: t.id } });
    assert.equal(result.status, 'clarify'); assert.match(result.question!, /选择具体事件/);
  } finally { f.close(); }
});
