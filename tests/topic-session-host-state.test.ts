import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { TopicRouteChoice } from '../src/topic-route-types.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { content, reply, type Payload } from './helpers/skills-fixture.js';

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
const hostFact = '宿主事实：当前独立主题Session已经建立并完成持久化绑定';
const failures = JSON.parse(readFileSync(new URL('./fixtures/topic-host-state-failures.json', import.meta.url), 'utf8')) as
  { case_id: string; title: string; text: string; denial_answer: string }[];
const isRoute = (payload: Payload) => content(payload.messages[0]?.content).includes('你是一次无工具主题归属解析器');

async function send(f: Awaited<ReturnType<typeof webUiFixture>>, text: string) {
  const requestId = randomUUID();
  assert.equal((await f.request('/api/chat', { requestId, text })).status, 202);
  for (let i = 0; i < 400; i++) {
    const response = await f.request('/api/chat-requests/' + requestId);
    assert.equal(response.status, 200);
    const receipt = await response.json() as WebRequestReceipt;
    if (receipt.run && receipt.run.status !== 'running') {
      assert.equal(receipt.run.status, 'succeeded', receipt.run.error ?? undefined);
      assert.equal((await f.request('/api/runs/' + receipt.runId + '/ack', {})).status, 200);
      return receipt;
    }
    await setTimeout(5);
  }
  throw new Error('宿主状态测试回合未结束');
}

for (const sample of failures) test(`原失败${sample.case_id}：实际主请求收到已提交主题事实；复用/恢复仍保留旧否认原文`, async () => {
  let boundBeforeMain = false, first = true;
  const f = await webUiFixture(payload => {
    if (isRoute(payload)) {
      const existing = f.store.workThreads.list(actor)[0];
      const choice: TopicRouteChoice = existing ? { kind: 'use', threadId: existing.id, reason: '延续原主题' }
        : { kind: 'create', title: sample.title, description: '持续交流，不创建执行任务', reason: '当前明确创建持续主题' };
      return reply(JSON.stringify(choice));
    }
    const threads = f.store.workThreads.list(actor);
    boundBeforeMain = threads.length === 1 && !!threads[0]!.chatContextKey;
    // 固定回放旧模型错误，不用假模型声称修复后的真实语义已通过。
    const answer = first ? sample.denial_answer : '继续当前主题的讨论。'; first = false;
    return reply(answer);
  }, undefined, true, true, false, false, undefined, false, undefined, true, true);
  try {
    await f.login();
    const created = await send(f, sample.text);
    assert.equal(created.topicRoute?.kind, 'topic');
    assert.equal(created.topicRoute?.kind === 'topic' && created.topicRoute.selection.kind, 'create');
    assert.equal(boundBeforeMain, true, '宿主必须在主模型请求前完成主题绑定');
    assert.equal(created.run?.output, sample.denial_answer, '保留真实失败原文，不做回答后处理');
    const system = content(f.payloads.at(-1)!.messages[0]!.content);
    assert.ok(system.includes(hostFact), '已完成创建/绑定，但主模型缺少明确宿主事实');
    assert.match(system, /不表示已创建Job、Goal、提醒或Memory/);
    assert.match(system, /历史回答否认已建主题.*本轮宿主事实/);
    const binding = f.store.workThreads.list(actor)[0]!.chatContextKey;
    for (const restart of [false, true]) {
      if (restart) { const count = f.payloads.length; await f.restart(); await f.login(); assert.equal(f.payloads.length, count); }
      const reused = await send(f, '接着上次讨论，不创建任务或后台工作。');
      assert.equal(reused.topicRoute?.kind === 'topic' && reused.topicRoute.selection.kind, 'use');
      assert.equal(reused.topicRoute?.kind === 'topic' && reused.topicRoute.contextKey, binding);
      const payload = f.payloads.at(-1)!;
      assert.ok(content(payload.messages[0]!.content).includes(hostFact));
      assert.ok(payload.messages.some(message => message.role === 'assistant' && content(message.content) === sample.denial_answer), '旧错误历史应保留，由当前宿主事实纠正');
      assert.equal(reused.run?.usage.calls, 2, '宿主事实不增加模型调用');
    }
    assert.equal(f.store.workThreads.list(actor).length, 1);
    assert.equal(f.store.workJobs.list(actor).length, 0);
    assert.equal(f.store.listTasks().length, 0);
    assert.equal(f.memory.listForHost().length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('主题事实仅用于实际主题主Chat：切换后私有历史隔离，daily/clarify没有已建主题声明', async () => {
  let choice: TopicRouteChoice = { kind: 'create', title: '健身', description: '持续健身', reason: '当前明确持续用途' };
  const f = await webUiFixture(payload => isRoute(payload) ? reply(JSON.stringify(choice)) : reply('固定离线回答。'),
    undefined, true, true, false, false, undefined, false, undefined, true, true);
  try {
    await f.login();
    const a = await send(f, '请以后持续帮我健身，PRIVATE_FITNESS_ONLY只留在此主题。');
    if (a.topicRoute?.kind !== 'topic') throw new Error('健身主题未创建');
    choice = { kind: 'create', title: '求职', description: '持续求职', reason: '当前明确持续用途' };
    await send(f, '请以后持续帮我求职，PRIVATE_CAREER_ONLY只留在此主题。');
    choice = { kind: 'use', threadId: a.topicRoute.threadId, reason: '继续健身' };
    await send(f, '继续刚才的训练。');
    const back = f.payloads.at(-1)!;
    assert.ok(content(back.messages[0]!.content).includes(hostFact));
    assert.match(JSON.stringify(back), /PRIVATE_FITNESS_ONLY/);
    assert.doesNotMatch(JSON.stringify(back), /PRIVATE_CAREER_ONLY/);
    choice = { kind: 'daily', reason: '普通临时短文' };
    const daily = await send(f, '写一句生日祝福。');
    assert.equal(daily.topicRoute?.kind, 'daily');
    assert.ok(!content(f.payloads.at(-1)!.messages[0]!.content).includes(hostFact));
    choice = { kind: 'clarify', question: '继续哪个主题？', reason: '多个主题未定' };
    const unclear = await send(f, '健身还是求职我还没想好，先让我选。');
    assert.equal(unclear.topicRoute?.kind, 'clarify');
    assert.ok(!content(f.payloads.at(-1)!.messages[0]!.content).includes(hostFact));
    assert.equal(f.store.workThreads.list(actor).length, 2);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('关闭主题模式的旧Coordinator主Chat不注入主题已建立声明', async () => {
  const f = await webUiFixture(() => reply('普通回答。'),
    undefined, true, true, false, false, undefined, false, undefined, true, false);
  try {
    await f.login();
    const receipt = await send(f, '写一句生日祝福。');
    assert.equal(receipt.topicRoute, null);
    assert.ok(!JSON.stringify(f.payloads).includes(hostFact));
    assert.equal(f.payloads.length, 1);
  } finally { await f.close(); }
});
