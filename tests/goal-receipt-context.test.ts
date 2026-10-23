import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import { AgentSession } from '@earendil-works/pi-coding-agent';
import { GoalRunner } from '../src/goal-runner.js';
import { BackgroundLane } from '../src/background-lane.js';

test('真实收据误解回放：用户和下一轮/重启Session都有宿主结果，不额外请求模型', async () => {
  const history = JSON.parse(readFileSync(new URL('../docs/evaluations/v3.0.1-live-retest.json', import.meta.url), 'utf8'));
  let followup = false;
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(message => message.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(content(payload.messages.at(-1)?.content));
      return reply(JSON.stringify({ action: 'goal_manage', mode: 'request', evidence: message, goalAction: 'create' }));
    }
    if (followup) {
      const all = JSON.stringify(payload.messages);
      assert.ok(all.includes('HOST_GOAL_RESULT_V1'));
      assert.ok(all.includes('已创建并排队'));
      return reply('依据宿主结果，目标已创建。');
    }
    const latestUser = payload.messages.findLastIndex(message => message.role === 'user');
    if (!payload.messages.slice(latestUser + 1).some(message => message.role === 'tool')) return toolCall('goal_manage', {});
    assert.ok(content(payload.messages.at(-1)?.content).includes('已创建并排队'), '工具必须提供真实收据而非仅数量');
    return reply(history.outcome.rawMainReplies.pause);
  });
  try {
    const result = await f.chat('帮我逐步建立银杏阅读计划');
    assert.match(result.text, /已创建并排队/); assert.ok(!result.text.includes('未实际保存成功'));
    assert.equal(f.payloads.length, 3, '主模型、解析、收尾；没有纠错模型调用');
    followup = true; await f.chat('当前状态呢'); await f.restart(); await f.chat('继续核对当前状态');
    const sessionRoot = join(f.config.sessionDir, readdirSync(f.config.sessionDir)[0]!);
    const session = readFileSync(join(sessionRoot, 'chat.session.jsonl'), 'utf8');
    assert.ok(session.includes('未实际保存成功'), '原始错误解释保留');
    assert.ok(session.includes('host-goal-result-v1'), '宿主纠正持久化');
    assert.equal(f.store.goals.list(f.goals.actor()).length, 1);
  } finally { await f.close(); }
});

test('Goal控制成功后模型收尾失败：返回真实宿主结果并留下上下文收据，不重试模型或操作', async () => {
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(m => m.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(content(payload.messages.at(-1)?.content));
      return reply(JSON.stringify({ action: 'goal_manage', mode: 'request', evidence: message, goalAction: 'create' }));
    }
    const index = payload.messages.findLastIndex(m => m.role === 'user');
    if (payload.messages.slice(index + 1).some(m => m.role === 'tool')) throw new Error('模拟模型收尾500');
    return toolCall('goal_manage', {});
  });
  try {
    const result = await f.chat('帮我逐步建立虚构学习目标');
    assert.match(result.text, /已创建并排队/); assert.equal(f.goals.list().length, 1); assert.equal(f.payloads.length, 3);
    assert.ok(f.store.events(result.run.id).some(e => e.type === 'goal_model_finalization_failed'));
  } finally { await f.close(); }
});

test('宿主收据持久化失败：原控制收据仍有效，同Run重入和重启不新增控制或重复Execution', async t => {
  let goalCalls = 0;
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(m => m.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(content(payload.messages.at(-1)?.content));
      return reply(JSON.stringify({ action: 'goal_manage', mode: 'request', evidence: message, goalAction: 'create' }));
    }
    if (system.includes('有界纯文本片段')) {
      goalCalls++; return reply(JSON.stringify({ stepOutcome: 'complete', artifactText: '虚构计划草稿', progressSummary: '待审批', question: '请批准',
        proposedPlan: { changeReason: '虚构安排', steps: [{ title: '练习', instruction: '只交付题目', deliverable: '题目', doneWhen: '用户核对' }] } }));
    }
    const index = payload.messages.findLastIndex(m => m.role === 'user');
    return payload.messages.slice(index + 1).some(m => m.role === 'tool') ? reply('模型收尾') : toolCall('goal_manage', {});
  });
  const original = AgentSession.prototype.sendCustomMessage;
  const fault = t.mock.method(AgentSession.prototype, 'sendCustomMessage', async function(this: AgentSession, ...args: Parameters<typeof original>) {
    if (args[0].customType === 'host-goal-result-v1') throw new Error('模拟宿主收据Session写入失败');
    return original.apply(this, args);
  });
  let runner: GoalRunner | undefined;
  try {
    const prompt = '帮我逐步建立虚构学习目标';
    await assert.rejects(f.chat(prompt), /宿主收据Session写入失败/); fault.mock.restore();
    const run = f.store.listRuns().find(run => run.status === 'failed')!, before = f.goals.list()[0]!;
    assert.ok(run); assert.equal(f.goals.list().length, 1); assert.equal(goalCalls, 0); assert.equal(f.payloads.length, 3);
    const receipt = f.store.goals.controlReceipt(f.goals.actor(), run.id); assert.ok(receipt);
    await f.restart();
    await f.executor.execute({ prompt, scope: 'chat', signal: new AbortController().signal,
      source: { channel: 'console', reference: run.id }, observer: f.store.observer(run.id) });
    assert.deepEqual(f.goals.get(before.id), before); assert.deepEqual(f.store.goals.controlReceipt(f.goals.actor(), run.id), receipt);
    assert.equal(f.goals.list().length, 1); assert.equal(goalCalls, 0);
    runner = new GoalRunner(f.store, f.executor, { sendMessage: async () => {} }, new BackgroundLane(), {
      ownerId: 'local-user', accepts: target => target.channel === 'console', pollIntervalMs: 10, reportError: error => { throw error; }, fatal: () => assert.fail('不应致命停止'),
    }, () => f.tasks.now());
    await runner.tick(); await runner.tick();
    assert.equal(goalCalls, 1, '只消费原始授权一次'); assert.equal(f.goals.plan(before.id).executions.length, 1);
    await runner.stop(); runner = undefined; await f.restart();
    assert.equal(f.goals.get(before.id).status, 'waiting_user'); assert.equal(goalCalls, 1);
  } finally { fault.mock.restore(); await runner?.stop(); await f.close(); }
});
