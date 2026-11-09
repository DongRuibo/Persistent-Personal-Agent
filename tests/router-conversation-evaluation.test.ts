import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ConversationBudget, gradeConversationContext } from '../evals/evaluators/router-conversation.js';
import type { ConversationPlan, ConversationCall } from '../evals/evaluators/router-conversation.js';

const plan = JSON.parse(readFileSync(new URL('../evals/datasets/router-conversation-v1.json', import.meta.url), 'utf8')) as ConversationPlan;
test('连续对话预算按原请求输出上限预留，超过金额前拒发且不重置已用预算', () => {
  const budget = new ConversationBudget({ ...plan, limits: { ...plan.limits, cny: 0.1 } });
  assert.equal(budget.reserve(100, 4096).output, 4096);
  assert.throws(() => budget.reserve(100, 4096), /预算不足/u);
  assert.equal(budget.requests, 1);
  assert.equal(budget.reserve(100, 512).output, 512);
  assert.equal(budget.requests, 2);
});
test('检查真实正文：自己历史允许、另一主题私有信息拒绝、用户本轮主动引用允许', () => {
  const turn = plan.turns[1]!, own = plan.topics.fitness!.canary, foreign = plan.topics.career!.canary;
  const call = (body: string, stage = 'chat'): ConversationCall => ({ index: 0, turn: turn.id, stage, body, bytes: 100, reservation: { input: 100, output: 512, cny: 0.01 } });
  assert.equal(gradeConversationContext(plan, turn, [call(own)], '').own_present, true);
  assert.equal(gradeConversationContext(plan, turn, [call(own + foreign)], '').contaminated_requests, 1);
  assert.equal(gradeConversationContext(plan, turn, [call(own + foreign)], foreign).contaminated, false);
  assert.equal(gradeConversationContext(plan, turn, [call(own, 'topic_route')], '').contaminated, true);
  assert.equal(gradeConversationContext(plan, turn, [], '').own_present, false);
});
test('冻结连续序列包含三个实际创建、六次纯切换和强杀后各主题探针', () => {
  assert.equal(plan.turns.length, 21);
  assert.equal(plan.turns.filter(turn => turn.action === 'create').length, 3);
  assert.equal(plan.turns.filter(turn => turn.selection).length, 6);
  const barrier = plan.turns.findIndex(turn => turn.restart_after);
  assert.ok(barrier > 0);
  assert.deepEqual(plan.turns.slice(barrier + 1).filter(turn => turn.recovery && turn.own_required).map(turn => turn.target), ['fitness', 'career', 'project']);
});
