import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import type { WebRun } from '../src/web-ui-types.js';

const prompt = '仅整理这份虚构周报并列三条待办，不联网、不建提醒或Goal、不保存记忆：完成草稿、核对材料、确认排版。';
const answer = '虚构周报已整理。待办：1. 完成草稿；2. 核对材料；3. 确认排版。未联网、未创建提醒或Goal、未保存记忆。';
const none = { action: 'none', mode: 'query', evidence: prompt };
type Fixture = Awaited<ReturnType<typeof webUiFixture>>;

// 使用真实Web/Guard/Pi与临时SQLite，只向localhost固定模型发送合成材料。
async function chat(f: Fixture) {
  await f.login(); const response = await f.request('/api/chat', { requestId: randomUUID(), text: prompt });
  assert.equal(response.status, 202); const accepted = await response.json() as WebRun; await f.channel.drain();
  const original = await f.request(`/api/runs/${accepted.id}`); assert.equal(original.status, 200);
  return await original.json() as WebRun;
}
function session(f: Fixture) {
  const directory = join(f.config.sessionDir, readdirSync(f.config.sessionDir)[0]!);
  return readFileSync(join(directory, 'chat.session.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
}
function noOperations(f: Fixture, run: WebRun) {
  const db = new DatabaseSync(f.config.databasePath, { readOnly: true });
  try {
    for (const table of ['goals', 'goal_plans', 'goal_steps', 'goal_executions', 'tasks', 'work_jobs']) {
      assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
    }
  } finally { db.close(); }
  assert.equal(f.memory.listForHost().length, 0);
  assert.ok(!f.store.events(run.id).some(event => ['operation_authorized', 'operation_committed', 'goal_control', 'delivery_succeeded'].includes(event.type)));
}

test('有效none是非执行工具结果，真实Pi继续普通Chat并保留正文，不写Goal宿主收据', async () => {
  const f = await webUiFixture(payload => {
    if (content(payload.messages.find(message => message.role === 'system')?.content).includes('隔离的当前用户意图解析器')) return reply(JSON.stringify(none));
    const user = payload.messages.findLastIndex(message => message.role === 'user');
    return payload.messages.slice(user + 1).some(message => message.role === 'tool') ? reply(answer) : toolCall('goal_manage', {});
  });
  try {
    const run = await chat(f); assert.equal(run.status, 'succeeded', run.error ?? ''); assert.equal(run.output, answer); assert.equal(run.error, null);
    assert.equal(f.payloads.length, 3); assert.equal(f.store.modelCalls(run.id).length, 3); noOperations(f, run);
    const entries = session(f), result = entries.find(entry => entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'goal_manage')!.message;
    assert.equal(result.isError, false); const receipt = JSON.parse(content(result.content));
    assert.equal(receipt.status, 'not_applicable'); assert.equal(receipt.executed, false);
    assert.ok(!entries.some(entry => entry.customType === 'host-goal-result-v1'));
  } finally { await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const next of ['create_task', 'memory_remember', 'goal_manage']) test(`none后仍消费本轮操作权，后续${next}被拒绝且Run失败`, async () => {
  let main = 0;
  const f = await webUiFixture(payload => {
    if (content(payload.messages.find(message => message.role === 'system')?.content).includes('隔离的当前用户意图解析器')) return reply(JSON.stringify(none));
    main++;
    if (main === 1) return toolCall('goal_manage', {});
    if (main === 2) return toolCall(next, next === 'create_task' ? { instruction: '不应创建', when: '明天上午9点' }
      : next === 'memory_remember' ? { kind: 'semantic', key: 'forbidden', content: '不应保存' } : {});
    return reply(answer);
  });
  try {
    const run = await chat(f); assert.equal(run.status, 'failed'); assert.match(f.store.getRun(run.id)?.error ?? '', /工具执行错误/); noOperations(f, run);
    assert.equal(f.payloads.length, 4, '第二个写提议在解析前即被拒绝，不重开本轮权限');
    const entries = session(f), results = entries.filter(entry => entry.type === 'message' && entry.message.role === 'toolResult').map(entry => entry.message);
    assert.equal(results[0].isError, false); assert.equal(JSON.parse(content(results[0].content)).executed, false);
    assert.equal(results[1].isError, true); assert.match(content(results[1].content), /消费/);
    assert.ok(!entries.some(entry => entry.customType === 'host-goal-result-v1'), '未执行Goal不能生成Goal成功或失败收据');
  } finally { await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});

for (const [name, intent, error] of [
  ['schema无效的none', { ...none, mode: 'invalid' }, 'Goal意图格式无效'],
  ['Goal缺操作类型', { action: 'goal_manage', mode: 'request', evidence: prompt }, '没有当前Goal操作意图'],
  ['Goal证据不属于原话', { action: 'goal_manage', goalAction: 'create', mode: 'request', evidence: '伪造证据' }, '没有当前Goal操作意图'],
  ['其他action不扩大正常返回范围', { action: 'create_task', mode: 'request', evidence: prompt }, '没有当前Goal操作意图'],
] as const) test(`${name}仍失败，不因模型最终有文本而放行`, async () => {
  const f = await webUiFixture(payload => {
    if (content(payload.messages.find(message => message.role === 'system')?.content).includes('隔离的当前用户意图解析器')) return reply(JSON.stringify(intent));
    const user = payload.messages.findLastIndex(message => message.role === 'user');
    return payload.messages.slice(user + 1).some(message => message.role === 'tool') ? reply(answer) : toolCall('goal_manage', {});
  });
  try {
    const run = await chat(f); assert.equal(run.status, 'failed'); assert.match(f.store.getRun(run.id)?.error ?? '', /工具执行错误/); noOperations(f, run);
    const result = session(f).find(entry => entry.type === 'message' && entry.message.role === 'toolResult')!.message;
    assert.equal(result.isError, true); assert.ok(content(result.content).includes(error));
  } finally { await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('有效none后模型真实500仍失败，不被Goal收据兜底改成成功', async () => {
  const f = await webUiFixture(payload => {
    if (content(payload.messages.find(message => message.role === 'system')?.content).includes('隔离的当前用户意图解析器')) return reply(JSON.stringify(none));
    const user = payload.messages.findLastIndex(message => message.role === 'user');
    if (payload.messages.slice(user + 1).some(message => message.role === 'tool')) throw new Error('合成模型500');
    return toolCall('goal_manage', {});
  });
  try {
    const run = await chat(f); assert.equal(run.status, 'failed'); assert.equal(run.output, null); assert.match(f.store.getRun(run.id)?.error ?? '', /500/); noOperations(f, run);
    assert.equal(f.payloads.length, 3); assert.ok(!session(f).some(entry => entry.customType === 'host-goal-result-v1'));
    assert.ok(!f.store.events(run.id).some(event => event.type === 'goal_model_finalization_failed'));
  } finally { await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});

test('原Goal服务读取异常仍为真实工具错误，不能作为not_applicable吞掉', async t => {
  const f = await webUiFixture(payload => {
    const user = payload.messages.findLastIndex(message => message.role === 'user');
    return payload.messages.slice(user + 1).some(message => message.role === 'tool') ? reply(answer) : toolCall('goal_manage', {});
  });
  t.mock.method(f.goals, 'receipt', () => { throw new Error('合成Goal存储故障'); });
  try {
    const run = await chat(f); assert.equal(run.status, 'failed'); assert.match(f.store.getRun(run.id)?.error ?? '', /工具执行错误/); noOperations(f, run);
    assert.equal(f.payloads.length, 2); const result = session(f).find(entry => entry.type === 'message' && entry.message.role === 'toolResult')!.message;
    assert.equal(result.isError, true); assert.match(content(result.content), /合成Goal存储故障/);
  } finally { await f.close(); rmSync(f.root, { recursive: true, force: true }); }
});
