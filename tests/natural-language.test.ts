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
    env.plan('第二个', { action: 'cancel_task', selector: { keywords: [], reference: 'choice', position: 2 } });
    assert.match((await env.run('第二个', 'cancel_task')).text, /没有找到/);
    assert.equal(env.tasks.get(second.id).status, 'pending');
  } finally { env.close(); }
});

test('宿主核对当前序号：解析器错号、漏掉编号、改用最新、引用文本或不确定选择均不写入', async () => {
  const env = setup();
  try {
    const first = env.tasks.create('带伞', '明天上午8点');
    const second = env.tasks.create('开会', '明天上午9点');
    await env.guard.withRequest(request('查看提醒'), async () => { env.guard.taskList(); return { text: '' }; });
    for (const [message, selector] of [
      ['第二个', { keywords: [], reference: 'choice', position: 1 }],
      ['取消2号', { keywords: [], reference: 'choice', position: 1 }],
      ['第十二个', { keywords: [], reference: 'choice', position: 2 }],
      ['第二个', { keywords: [], reference: 'latest' }],
      ['取消第二个带伞提醒', { keywords: ['带伞'] }],
      ['第一个还是第二个', { keywords: [], reference: 'choice', position: 1 }],
      ['倒数第二个', { keywords: [], reference: 'choice', position: 2 }],
      ['第0个', { keywords: [], reference: 'choice', position: 1 }],
      ['第一百零一个', { keywords: [], reference: 'choice', position: 1 }],
      ['你好', { keywords: [], reference: 'choice', position: 1 }],
      ['取消“第二个”这个提醒', { keywords: [], reference: 'choice', position: 2 }],
      ['取消第“二”个', { keywords: [], reference: 'choice', position: 2 }],
    ] as const) {
      env.plan(message, { action: 'cancel_task', selector: { ...selector, keywords: [...selector.keywords] } });
      assert.match((await env.run(message, 'cancel_task')).text, /序号|引用|选择/);
      assert.equal(env.tasks.get(first.id).status, 'pending', message);
      assert.equal(env.tasks.get(second.id).status, 'pending', message);
    }
  } finally { env.close(); }
});

test('常见中文、阿拉伯及全角序号与解析器一致时只操作宿主显示的对应项', async () => {
  for (const [message, position] of [['第二个', 2], ['取消2号', 2], ['取消第１项', 1], ['第十条', 10], ['十二号', 12], ['第二十个', 20], ['第一百项', 100]] as const) {
    const env = setup();
    try {
      for (let index = 0; index < position; index++) env.tasks.create(`虚构提醒${index + 1}`, '明天上午8点');
      let ids: string[] = [];
      await env.guard.withRequest(request('查看提醒'), async () => { ids = env.guard.taskList().map((task) => task.id); return { text: '' }; });
      env.plan(message, { action: 'cancel_task', selector: { keywords: [], reference: 'choice', position } });
      await env.run(message, 'cancel_task');
      for (const [index, id] of ids.entries()) assert.equal(env.tasks.get(id).status, index + 1 === position ? 'cancelled' : 'pending', message);
    } finally { env.close(); }
  }
});

test('Memory 更新和删除也核对宿主序号，错号不能改变正文、版本或索引', async () => {
  for (const tool of ['memory_update', 'memory_forget'] as const) {
    const env = setup();
    try {
      for (const content of ['我偏好简洁的开发解释', '我偏好中文的开发解释']) {
        env.memory.withRequest(request(`记住：${content}`), () => env.memory.remember({ kind: 'semantic', key: content.includes('简洁') ? 'test.concise' : 'test.language', content }));
      }
      const before = env.memory.listForHost();
      const fact = '我偏好更简短的开发解释';
      const message = tool === 'memory_update' ? `把开发解释偏好改成${fact}` : '忘掉我的开发解释偏好';
      const body = tool === 'memory_update' ? { body: fact, bodyEvidence: fact } : {};
      env.plan(message, { action: tool, ...body, selector: { keywords: ['开发解释'] } });
      assert.match((await env.run(message, tool)).text, /多个.*目标/);
      const selection = tool === 'memory_update' ? `把第二个改成${fact}` : '第二个';
      env.plan(selection, { action: tool, ...body, selector: { keywords: [], reference: 'choice', position: 1 } });
      assert.match((await env.run(selection, tool)).text, /序号|引用|选择/);
      for (const record of before) assert.deepEqual(env.memory.get(record.id), record);
      env.plan(selection, { action: tool, ...body, selector: { keywords: [], reference: 'choice', position: 2 } });
      await env.run(selection, tool);
      assert.deepEqual(env.memory.get(before[0]!.id), before[0]);
      if (tool === 'memory_update') {
        assert.equal(env.memory.get(before[1]!.id).content, fact);
        assert.equal(env.memory.get(before[1]!.id).version, before[1]!.version + 1);
      } else assert.ok(!env.memory.listForHost().some((record) => record.id === before[1]!.id));
    } finally { env.close(); }
  }
});

test('刚才与最新必须有当前消息依据且不能互换，历史引用过期不操作', async () => {
  const env = setup();
  try {
    const earlier = env.tasks.create('开会', '明天上午8点');
    const latest = env.tasks.create('开会', '明天上午9点');
    await env.guard.withRequest(request('查看之前的提醒'), async () => { env.guard.taskList(earlier.id); return { text: '' }; });
    for (const [message, reference] of [['刚才那个提醒不用了', 'latest'], ['取消最新创建的那个提醒', 'last'], ['取消开会提醒', 'latest'], ['取消开会提醒', 'last'], ['取消“最新”这个提醒', 'latest']] as const) {
      env.plan(message, { action: 'cancel_task', selector: { keywords: [], reference } });
      assert.match((await env.run(message, 'cancel_task')).text, /序号|引用|选择/);
      assert.equal(env.tasks.get(earlier.id).status, 'pending'); assert.equal(env.tasks.get(latest.id).status, 'pending');
    }
    const recent = '取消最新创建的那个提醒';
    env.plan(recent, { action: 'cancel_task', selector: { keywords: [], reference: 'latest' } });
    await env.run(recent, 'cancel_task');
    assert.equal(env.tasks.get(latest.id).status, 'cancelled'); assert.equal(env.tasks.get(earlier.id).status, 'pending');
    env.advance(6); env.reopen();
    env.plan('刚才那个提醒不用了', { action: 'cancel_task', selector: { keywords: [], reference: 'last' } });
    assert.match((await env.run('刚才那个提醒不用了', 'cancel_task')).text, /没有找到/);
    assert.equal(env.tasks.get(earlier.id).status, 'pending');
    const delayed = new OperationGuard(env.tasks, env.memory, async () => {
      env.advance(0.1);
      return { action: 'cancel_task', mode: 'request', evidence: '第二个', selector: { keywords: [], reference: 'choice', position: 2 } };
    }, { tasks: [latest.id, earlier.id], taskViewExpires: env.tasks.now().getTime() + 1000 });
    const expiredDuringParse = await delayed.withRequest(request('第二个'), async () => {
      await delayed.perform('cancel_task', {}, (operation, req) => env.tasks.withRequest(req, () => env.tasks.cancelFromAgent(operation.args.id), operation));
      return { text: '' };
    });
    assert.match(expiredDuringParse.text, /没有找到/);
    assert.equal(env.tasks.get(earlier.id).status, 'pending', '解析等待期间过期的历史编号不得执行');
    const confirmation = '可以，按刚才展示的内容保存吧';
    const delayedConfirmation = new OperationGuard(env.tasks, env.memory, async () => {
      env.advance(0.1);
      return { action: 'memory_remember', mode: 'request', evidence: confirmation, confirmation: true };
    }, { confirmation: { operation: { tool: 'memory_remember', args: { kind: 'semantic', key: 'test.expired', content: '虚构偏好' } }, expires: env.tasks.now().getTime() + 1000 } });
    const expiredConfirmation = await delayedConfirmation.withRequest(request(confirmation), async () => {
      await delayedConfirmation.perform('memory_remember', {}, () => assert.fail('解析期间过期的确认不得执行'));
      return { text: '' };
    });
    assert.match(expiredConfirmation.text, /没有对应/);
    assert.deepEqual(env.memory.listForHost(), []);
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

test('解析器误把普通事实标为保存请求，宿主仍不直接写入或遗留确认权限', async () => {
  const env = setup();
  try {
    for (const [message, fact] of [
      ['星帆验收项目使用 SQLite 保存本地数据', '星帆验收项目使用 SQLite 保存本地数据'],
      ['Tundra 项目使用 JSON 保存配置', 'JSON'],
      ['我喜欢中文回答', '我喜欢中文回答'],
      ['设备日志记录故障码', '故障码'],
    ]) {
      env.plan(message!, { action: 'memory_remember', mode: 'request', evidence: message, bodyEvidence: fact, body: fact, kind: 'project' });
      assert.match((await env.run(message!, 'memory_remember')).text, /未.*保存|没有.*保存/);
      assert.deepEqual(env.memory.listForHost(), []);
    }
    // 普通陈述被拒绝后，下一轮“确认”不能凭空获得写入能力。
    env.plan('确认', { action: 'memory_remember', confirmation: true });
    await env.run('确认', 'memory_remember');
    assert.deepEqual(env.memory.listForHost(), []);
  } finally { env.close(); }
});

test('强制错误request不能让否定、假设或引用中的记忆指令保存', async () => {
  const env = setup();
  try {
    for (const message of ['不要记住我喜欢甜咖啡', '如果我说记住我喜欢甜咖啡，你会怎么做？', '朋友说“请记住我喜欢甜咖啡”', '这只是引用：记住我喜欢甜咖啡']) {
      env.plan(message, { action: 'memory_remember', mode: 'request', bodyEvidence: '我喜欢甜咖啡', body: '我喜欢甜咖啡' });
      await env.run(message, 'memory_remember');
      assert.deepEqual(env.memory.listForHost(), []);
    }
  } finally { env.close(); }
});

test('未识别的自然保存请求先确认，错误confirmation不能代替用户同意', async () => {
  const env = setup();
  try {
    const message = '关于长期记忆，我希望以后能查到这条：我喜欢温水';
    env.plan(message, { action: 'memory_remember', bodyEvidence: '我喜欢温水', body: '我喜欢温水' });
    assert.match((await env.run(message, 'memory_remember')).text, /确认/);
    assert.deepEqual(env.memory.listForHost(), []);
    env.plan('先不要保存', { action: 'memory_remember', confirmation: true });
    await env.run('先不要保存', 'memory_remember');
    assert.deepEqual(env.memory.listForHost(), []);
    // 重新展示待确认草稿，真正的当前确认仍可保存。
    await env.run(message, 'memory_remember');
    await env.run('确认', 'memory_remember');
    assert.equal(env.memory.listForHost().length, 1);
  } finally { env.close(); }
});

test('自然语言明确 Memory 保存、唯一目标更新/删除，实质改写确认及版本防覆盖', async () => {
  const env = setup();
  try {
    for (const [message, fact] of [['记住我比较喜欢中文回答', '我比较喜欢中文回答'], ['以后你要记得我偏好简洁的解释', '我偏好简洁的解释'], ['你可以记一下，我现在主要用 TypeScript 开发', '我现在主要用 TypeScript 开发'], ['请记住“我不喜欢甜咖啡”', '我不喜欢甜咖啡'], ['请把我喜欢温水保存为长期记忆', '我喜欢温水']]) {
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
