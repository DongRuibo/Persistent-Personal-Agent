import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { GoalAcceptanceBudget } from '../scripts/goal-feishu-acceptance.js';

test('Goal真实验收默认不联网；48请求/5元累计预算含失败，不能以重启退额或扩大输出', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/goal-feishu-acceptance.ts'], { encoding: 'utf8', env: {} });
  assert.equal(child.status, 1); assert.match(child.stderr, /另行授权/);
  const budget = new GoalAcceptanceBudget({ version: 1, identity: 'fake', inputRate: 2, outputRate: 8, attempts: [] });
  for (let index = 0; index < 48; index++) budget.reserve(1000, 512).status = 500;
  const resumed = new GoalAcceptanceBudget(JSON.parse(JSON.stringify(budget.ledger)));
  assert.equal(resumed.ledger.attempts.length, 48); assert.throws(() => resumed.reserve(1, 1), /上限/);
  const expensive = new GoalAcceptanceBudget({ version: 1, identity: 'fake', inputRate: 1000, outputRate: 1000, attempts: [] });
  assert.throws(() => expensive.reserve(10000, 4096), /上限/); assert.equal(expensive.ledger.attempts.length, 0);
  assert.throws(() => expensive.reserve(1, 4097), /容量/);
  assert.throws(() => new GoalAcceptanceBudget({ version: 1, identity: 'fake', inputRate: NaN, outputRate: 1, attempts: [] }), /无效/);
});
