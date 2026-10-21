import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { retrieve } from '../src/memory-retriever.js';
import type { MemoryRecord } from '../src/contracts.js';

function record(content: string): MemoryRecord {
  return { id: randomUUID(), kind: 'semantic', key: 'fictional.clauses', content, version: 1,
    hash: createHash('sha256').update(content).digest('hex'), createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    source: { type: 'user_explicit', channel: 'host', reference: 'fictional-closeout' } };
}

test('未知新主体不能继承用户owner，也不能在下一省略句恢复成用户事实', () => {
  for (const content of [
    '用户喜欢邮件沟通，另一位同事电话费用每月88元。',
    '用户喜欢邮件沟通，Teammate B 电话费用每月73元。',
    '用户喜欢邮件沟通，他电话费用每月61元。',
    '用户喜欢邮件沟通，最后一位访客电话费用每月67元。',
    '用户喜欢邮件沟通，喜欢电话的同事电话费用每月52元。',
    '用户喜欢中文回答，外部访客电话费用每月79元，也喜欢简短解释。',
  ]) {
    const found = retrieve([record(content)], '我的电话费用每个月多少钱？');
    assert.notEqual(found.evidence, 'supported', content);
    assert.deepEqual(found.supportIds, []);
    assert.ok(!found.evidenceById.flatMap(p => p.proofs).some(p => p.field === 'phone_cost'));
  }
  const uncertain = record('用户喜欢中文回答，外部访客电话费用每月79元，也喜欢简短解释。');
  assert.notEqual(retrieve([uncertain], '我的解释风格是什么？').evidence, 'supported');
  assert.notEqual(retrieve([uncertain], '电话费用多少钱？').evidence, 'supported');
  const ambiguous = record('用户喜欢中文回答，也喜欢简短的解释。');
  assert.equal(retrieve([ambiguous], '我的解释风格是什么？').records[0]?.id, ambiguous.id, '归属保守不能抹去相关候选');
  assert.notEqual(retrieve([ambiguous], '我的解释风格是什么？').evidence, 'supported');
});

test('清楚的同主体省略和属性声明继续有效，多主体事实分别归属', () => {
  for (const continuation of ['也喜欢简短解释', '并且喜欢简短解释', '喜欢简短解释']) {
    const r = record(`用户喜欢中文回答，${continuation}。`);
    const found = retrieve([r], '我的解释风格是什么？');
    assert.equal(found.evidence, 'supported', continuation);
    assert.ok(found.evidenceById[0]?.proofs.some(p => p.subject === '用户' && p.field === 'style' && p.quote.includes('简短解释')));
  }
  const project = { ...record('Orion 项目的界面使用韩语，开发语言为 Elixir。'), kind: 'project' as const };
  assert.equal(retrieve([project], 'Orion 的开发语言是什么？').evidence, 'supported');
  const mixed = record('用户喜欢邮件沟通，柏舟的电话费用每月83元。');
  assert.notEqual(retrieve([mixed], '我的电话费用多少钱？').evidence, 'supported');
  assert.equal(retrieve([mixed], '柏舟的电话费用多少钱？').evidence, 'supported');
});
