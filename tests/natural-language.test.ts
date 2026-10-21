import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { OperationGuard } from '../src/operation-guard.js';
import type { DialogueReferences, Intent } from '../src/operation-guard.js';
import { FileMemoryService } from '../src/memory-service.js';
import { TaskService } from '../src/task-service.js';
import { SqliteStore } from '../src/sqlite-store.js';
import type { ExecutionRequest, WriteOperation } from '../src/contracts.js';

const request = (prompt: string): ExecutionRequest => ({ prompt, scope: 'chat', signal: new AbortController().signal,
  observer: { event() {}, modelCall() {} }, source: { channel: 'console', reference: 'natural-test-run' } });
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'agent-natural-'));
  const store = new SqliteStore(':memory:');
  let clock = new Date('2026-10-21T00:00:00Z');
  const tasks = new TaskService(store, 'Asia/Shanghai', () => clock);
  const memory = new FileMemoryService(directory);
  const plans = new Map<string, Intent>();
  let calls = 0;
  let persisted: DialogueReferences = {};
  const makeGuard = (state: DialogueReferences = {}) => new OperationGuard(tasks, memory, async (message) => {
    calls++; return plans.get(message) ?? { action: 'none', mode: 'query', evidence: message };
  }, state, (value) => { persisted = structuredClone(value); });
  let guard = makeGuard();
  const apply = (operation: WriteOperation, req: ExecutionRequest) => {
    switch (operation.tool) {
      case 'create_task': return tasks.withRequest(req, () => tasks.createFromAgent(operation.args.instruction, operation.args.when), operation);
      case 'cancel_task': return tasks.withRequest(req, () => tasks.cancelFromAgent(operation.args.id), operation);
      case 'memory_remember': return memory.withRequest(req, () => memory.remember(operation.args), operation);
      case 'memory_update': return memory.withRequest(req, () => memory.update(operation.args.id, operation.args.content, operation.args.expectedVersion), operation);
      case 'memory_forget': return memory.withRequest(req, () => { memory.forget(operation.args.id, operation.args.expectedVersion); return { id: operation.args.id }; }, operation);
    }
  };
  const run = (prompt: string, tool: WriteOperation['tool'], proposed: unknown = {}) => guard.withRequest(request(prompt), async () => {
    await guard.perform(tool, proposed, apply); return { text: '模型不能覆盖宿主的实际操作结果' };
  });
  const plan = (message: string, values: Partial<Intent>) => plans.set(message, { action: 'none', mode: 'request', evidence: message, ...values });
  return { tasks, memory, store, run, plan, get guard() { return guard; }, get calls() { return calls; },
    reopen: () => { guard = makeGuard(structuredClone(persisted)); },
    advance: (minutes: number) => { clock = new Date(clock.getTime() + minutes * 60000); },
    close: () => { memory.close(); store.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('不同自然表达经结构化解析后创建：宿主校验原时间证据，不执行主模型扩大的参数', async () => {
  const env = setup();
  try {
    for (const [message, when, body, due] of [
      ['2分钟后提醒我上厕所', '2分钟后', '上厕所', '2026-10-21T00:02:00.000Z'],
      ['过两分钟记得叫我去厕所', '过两分钟', '去厕所', '2026-10-21T00:02:00.000Z'],
      ['帮我设个提醒，明天上午9点开会', '明天上午9点', '开会', '2026-10-22T01:00:00.000Z'],
      ['晚上8点记得提醒我给朋友打电话', '晚上8点', '给朋友打电话', '2026-10-21T12:00:00.000Z'],
      ['两分钟之后叫我喝水', '两分钟之后', '喝水', '2026-10-21T00:02:00.000Z'],
    ]) {
      env.plan(message!, { action: 'create_task', when, body, bodyEvidence: body });
      assert.match((await env.run(message!, 'create_task', { when: '2099-01-01T00:00:00Z', instruction: '不应执行的模型篡改' })).text, /已创建/);
      assert.equal(env.tasks.visibleTasks()[0]!.dueAt, due);
      assert.equal(env.tasks.visibleTasks()[0]!.instruction, body);
    }
    assert.equal(env.calls, 5);
    for (const [message, when, body] of [['明天早上提醒我带伞', '明天早上', '带伞'], ['等我洗完澡再提醒我喝水', '洗完澡', '喝水']]) {
      env.plan(message!, { action: 'create_task', when, body, bodyEvidence: body });
      assert.match((await env.run(message!, 'create_task')).text, /具体|确定/);
    }
    assert.equal(env.tasks.list().length, 5);
    env.plan('两分钟后提醒我喝水', { action: 'create_task', when: '2026-10-21T00:02:00Z', body: '喝水', bodyEvidence: '喝水' });
    assert.match((await env.run('两分钟后提醒我喝水', 'create_task')).text, /具体时间/);
  } finally { env.close(); }
});

test('取消指代用真实任务与宿主编号：刚才、最新、时段唯一匹配、多目标澄清和重开后第二个', async () => {
  const env = setup();
  try {
    env.plan('两分钟后叫我喝水', { action: 'create_task', when: '两分钟后', body: '喝水', bodyEvidence: '喝水' });
    await env.run('两分钟后叫我喝水', 'create_task');
    const water = env.tasks.visibleTasks()[0]!;
    env.plan('刚才那个提醒不用了', { action: 'cancel_task', selector: { keywords: [], reference: 'last' } });
    env.reopen(); await env.run('刚才那个提醒不用了', 'cancel_task', { id: '模型随意指定的其他id' });
    assert.equal(env.tasks.get(water.id).status, 'cancelled');
    const meeting = env.tasks.create('开会', '明天上午9点');
    env.plan('明天早上开会那个提醒取消', { action: 'cancel_task', selector: { keywords: ['开会'], when: '明天早上' } });
    await env.run('明天早上开会那个提醒取消', 'cancel_task');
    assert.equal(env.tasks.get(meeting.id).status, 'cancelled');
    const first = env.tasks.create('开会', '明天上午8点');
    const second = env.tasks.create('开会', '明天上午10点');
    const clarify = await env.run('明天早上开会那个提醒取消', 'cancel_task');
    assert.match(clarify.text, /多个.*目标/);
    assert.equal(env.tasks.get(first.id).status, 'pending'); assert.equal(env.tasks.get(second.id).status, 'pending');
    env.plan('第二个', { action: 'cancel_task', selector: { keywords: [], reference: 'choice', position: 2 } });
    env.reopen(); await env.run('第二个', 'cancel_task');
    assert.equal(env.tasks.get(first.id).status, 'cancelled'); assert.equal(env.tasks.get(second.id).status, 'pending');
    env.plan('把最新创建的那个提醒取消', { action: 'cancel_task', selector: { keywords: [], reference: 'latest' } });
    await env.run('把最新创建的那个提醒取消', 'cancel_task');
    assert.equal(env.tasks.get(second.id).status, 'cancelled');
    assert.match((await env.run('把最新创建的那个提醒取消', 'cancel_task')).text, /不能取消/);
  } finally { env.close(); }
});

test('查询编号由宿主显示，不能继承不存在/过期选项；跨用户任务不参与取消', async () => {
  const env = setup();
  try {
    const first = env.tasks.create('带伞', '明天上午8点');
    const second = env.tasks.create('开会', '明天上午9点');
    const result = await env.guard.withRequest(request('我刚才创建了什么？'), async () => { env.guard.taskList(); return { text: '模型重排的错误列表' }; });
    assert.match(result.text, /^1\. 开会/);
    assert.equal(env.calls, 0, '查询不额外调用解析模型');
    env.plan('取消第二个', { action: 'cancel_task', selector: { keywords: [], reference: 'choice', position: 2 } });
    await env.run('取消第二个', 'cancel_task');
    assert.equal(env.tasks.get(first.id).status, 'cancelled'); assert.equal(env.tasks.get(second.id).status, 'pending');
    const foreign = env.tasks.withTarget({ channel: 'feishu', appId: 'other', chatId: 'other', userOpenId: 'other' }, () => env.tasks.create('秘密提醒', '明天上午10点'));
    env.plan('取消秘密提醒', { action: 'cancel_task', selector: { keywords: ['秘密'] } });
    assert.match((await env.run('取消秘密提醒', 'cancel_task', { id: foreign.id })).text, /没有找到/);
    assert.equal(env.tasks.get(foreign.id).status, 'pending');
    env.tasks.create('开会', '明天上午11点');
    env.plan('取消开会提醒', { action: 'cancel_task', selector: { keywords: ['开会'] } });
    await env.run('取消开会提醒', 'cancel_task'); env.advance(6);
    env.plan('第二个', { action: 'cancel_task', selector: { keywords: [], reference: 'choice', position: 99 } });
    assert.match((await env.run('第二个', 'cancel_task')).text, /没有找到/);
    assert.equal(env.tasks.get(second.id).status, 'pending');
  } finally { env.close(); }
});

test('真实失败回归：带“刚才”和具体内容的取消不能忽略内容而取消最后创建的其他提醒', async () => {
  const env = setup();
  try {
    const toilet = env.tasks.create('上厕所', '2分钟后');
    env.plan('两分钟后叫我喝水', { action: 'create_task', when: '两分钟后', body: '喝水', bodyEvidence: '喝水' });
    await env.run('两分钟后叫我喝水', 'create_task');
    const water = env.tasks.visibleTasks()[0]!;
    const prompt = '取消我刚才设的上厕所提醒';
    env.plan(prompt, { action: 'cancel_task', selector: { keywords: ['上厕所'], reference: 'last' } });
    await env.run(prompt, 'cancel_task');
    assert.equal(env.tasks.get(toilet.id).status, 'cancelled');
    assert.equal(env.tasks.get(water.id).status, 'pending');
    const newer = env.tasks.create('去厕所', '2分钟后');
    const other = env.tasks.create('上厕所', '2分钟后');
    assert.match((await env.run(prompt, 'cancel_task')).text, /多个.*目标/);
    assert.equal(env.tasks.get(newer.id).status, 'pending'); assert.equal(env.tasks.get(other.id).status, 'pending');
  } finally { env.close(); }
});

test('否定、假设、引用、查询及普通偏好不会因主模型调用写工具而获得权限', async () => {
  const env = setup();
  try {
    for (const [message, mode] of [['不要提醒我喝水', 'negated'], ['如果我说两分钟后提醒我，你会怎么做？', 'hypothetical'], ['朋友说“两分钟后提醒我喝水”', 'quoted'], ['我刚才创建了什么提醒？', 'query'], ['我喜欢中文回答', 'query']] as const) {
      env.plan(message, { action: 'none', mode });
      await assert.rejects(env.run(message, 'create_task'), /明确.*授权/);
      await assert.rejects(env.run(message, 'memory_remember'), /明确.*授权/);
    }
    assert.equal(env.tasks.list().length, 0); assert.deepEqual(env.memory.search('中文'), []);
    env.plan('你好', { action: 'create_task', when: '1分钟后', body: '喝水', bodyEvidence: '喝水' });
    assert.match((await env.run('你好', 'create_task')).text, /具体内容/);
    env.plan('喝水提醒记一下', { action: 'memory_remember', body: '喝水', bodyEvidence: '喝水' });
    await assert.rejects(env.run('喝水提醒记一下', 'create_task'), /超出/);
  } finally { env.close(); }
});

test('自然语言明确 Memory 保存、唯一目标更新/删除，实质改写确认及版本防覆盖', async () => {
  const env = setup();
  try {
    for (const [message, fact] of [['记住我比较喜欢中文回答', '我比较喜欢中文回答'], ['以后你要记得我偏好简洁的解释', '我偏好简洁的解释'], ['你可以记一下，我现在主要用 TypeScript 开发', '我现在主要用 TypeScript 开发']]) {
      env.plan(message!, { action: 'memory_remember', body: fact, bodyEvidence: fact, kind: 'semantic' });
      assert.match((await env.run(message!, 'memory_remember')).text, /已保存/);
    }
    env.plan('中文偏好改成我现在喜欢英文回答', { action: 'memory_update', body: '我现在喜欢英文回答', bodyEvidence: '我现在喜欢英文回答', selector: { keywords: ['中文'] } });
    await env.run('中文偏好改成我现在喜欢英文回答', 'memory_update');
    assert.equal(env.memory.search('英文')[0]?.version, 2);
    env.plan('忘掉我的英文回答偏好', { action: 'memory_forget', selector: { keywords: ['英文'] } });
    await env.run('忘掉我的英文回答偏好', 'memory_forget'); assert.deepEqual(env.memory.search('英文'), []);
    env.plan('记住我喜欢简短', { action: 'memory_remember', bodyEvidence: '我喜欢简短', body: '用户偏好简洁但完整的解释', kind: 'semantic' });
    assert.match((await env.run('记住我喜欢简短', 'memory_remember')).text, /请确认/);
    assert.deepEqual(env.memory.search('完整'), []);
    const calls = env.calls; env.reopen(); await env.run('确认', 'memory_remember');
    assert.equal(env.calls, calls, '对宿主待确认内容的确认不再增加解析调用');
    assert.equal(env.memory.search('完整')[0]?.content, '用户偏好简洁但完整的解释');
    env.plan('把 TypeScript 偏好改成我开始用Rust', { action: 'memory_update', bodyEvidence: '我开始用Rust', body: '用户主要使用 Rust 开发', selector: { keywords: ['TypeScript'] } });
    assert.match((await env.run('把 TypeScript 偏好改成我开始用Rust', 'memory_update')).text, /请确认/);
    const original = env.memory.search('TypeScript')[0]!;
    env.memory.withRequest(request(`更新记忆：用户已切换 Python\nid=${original.id}`), () => env.memory.update(original.id, '用户已切换 Python', original.version));
    await assert.rejects(env.run('确认', 'memory_update'), /版本已变化/);
    assert.equal(env.memory.get(original.id).content, '用户已切换 Python');
    await env.run('记住我喜欢简短', 'memory_remember');
    await env.guard.withRequest(request('你好'), async () => ({ text: '你好' }));
    await assert.rejects(env.run('确认', 'memory_remember'), /明确.*授权/);
    await env.run('记住我喜欢简短', 'memory_remember');
    const confirm = '可以，按你刚才整理的内容保存吧';
    env.plan(confirm, { action: 'memory_remember', confirmation: true });
    await env.run(confirm, 'memory_remember');
    assert.equal(env.memory.search('完整').length, 1, '自然语言确认不需要固定短句，重复事实仍去重');
  } finally { env.close(); }
});

test('一轮解析缓存和一次性授权、操作取消后无迟到写入、后台不能继承授权', async () => {
  const env = setup();
  try {
    const message = '1分钟后叫我喝水'; env.plan(message, { action: 'create_task', bodyEvidence: '喝水', body: '喝水', when: '1分钟后' });
    await env.guard.withRequest(request(message), async () => {
      await env.guard.perform('create_task', {}, (operation, req) => env.tasks.withRequest(req, () => env.tasks.createFromAgent(operation.args.instruction, operation.args.when), operation));
      await assert.rejects(env.guard.perform('create_task', {}, () => assert.fail('重复执行')), /已消费/); return { text: 'done' };
    });
    assert.equal(env.calls, 1); assert.equal(env.tasks.list().length, 1);
    await env.guard.withRequest(request(message), async () => {
      const both = await Promise.allSettled([0, 1].map(() => env.guard.perform('create_task', {}, (operation, req) => env.tasks.withRequest(req, () => env.tasks.createFromAgent(operation.args.instruction, operation.args.when), operation))));
      assert.equal(both.filter((item) => item.status === 'fulfilled').length, 1);
      return { text: 'done' };
    });
    assert.equal(env.tasks.list().length, 2, '并行工具请求也只能消费一次授权');
    const controller = new AbortController();
    const guard = new OperationGuard(env.tasks, env.memory, async () => { controller.abort(); return { action: 'create_task', mode: 'request', evidence: message, when: '1分钟后', body: '喝水', bodyEvidence: '喝水' }; }, {});
    await assert.rejects(guard.withRequest(request(message), async () => { await guard.perform('create_task', {}, () => assert.fail('取消后仍执行'), controller.signal); return { text: '' }; }));
    await assert.rejects(guard.withRequest({ ...request(message), scope: 'task' }, async () => { await guard.perform('create_task', {}, () => assert.fail('后台写入')); return { text: '' }; }), /后台/);
  } finally { env.close(); }
});
