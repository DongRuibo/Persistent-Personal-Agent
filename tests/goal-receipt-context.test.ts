import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';

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
