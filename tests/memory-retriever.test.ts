import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryService } from '../src/memory-service.js';
import { parseRewrite, retrieve } from '../src/memory-retriever.js';
import type { ExecutionRequest, MemoryInput } from '../src/contracts.js';
const request = (prompt: string, scope: 'chat' | 'task' = 'chat'): ExecutionRequest => ({ prompt, scope, signal: new AbortController().signal, observer: { event() {}, modelCall() {} } });
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'retriever-test-'));
  const memory = new FileMemoryService(root);
  const save = (input: MemoryInput) => memory.withRequest(request(`记住：${input.content}`), () => memory.remember(input));
  return { memory, save, close: () => { memory.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('实体、字段、日期与排除约束排序，相关但无答案独立标记；不依赖最近更新时间', () => {
  const env = setup();
  try {
    env.save({ kind: 'project', key: 'nova.db', content: 'Nova 项目使用 MySQL 数据库。' });
    env.save({ kind: 'project', key: 'lumen.db', content: 'Lumen 项目使用 PostgreSQL 数据库。' });
    env.save({ kind: 'project', key: 'nova2.db', content: 'Nova2 项目使用 Redis 数据库。' });
    env.save({ kind: 'project', key: 'nova.backup', content: 'Nova 数据库架构评审讨论备份。' });
    env.save({ kind: 'episodic', key: 'nova.pass', content: '2026年6月8日 Nova 项目验收通过。' });
    env.save({ kind: 'episodic', key: 'nova.fail', content: '2026年6月7日 Nova 项目验收失败。' });
    assert.equal(env.memory.search('Nova 的数据库是什么？')[0]?.key, 'nova.db');
    assert.equal(env.memory.search('Nova2 的数据库是什么？')[0]?.key, 'nova2.db', '项目名称前缀不能误识别为另一实体');
    assert.ok(env.memory.search('Lumen 数据库，不是 Nova').every(record => !record.key.startsWith('nova.')));
    assert.equal(env.memory.search('Lumen 数据库，不要 Nova 的配置')[0]?.key, 'lumen.db');
    assert.deepEqual(new Set(env.memory.search('Nova 和 Lumen 分别用什么数据库？').slice(0, 2).map(record => record.key)), new Set(['nova.db', 'lumen.db']));
    assert.deepEqual(env.memory.search('Rigel 的数据库是什么？'), [], '未记录的具名项目不能偷用其他项目的配置');
    assert.equal(env.memory.search('6月8日 Nova 验收结果，别用7日失败记录')[0]?.key, 'nova.pass');
    assert.equal(env.memory.search('2026-06-08 Nova 验收结果')[0]?.key, 'nova.pass');
    assert.deepEqual(env.memory.search('2025年6月8日 Nova 验收结果'), []);
    const unknown = env.memory.retrieve('Nova 下次发布的确切日期是什么？');
    assert.ok(unknown.records.length > 0); assert.equal(unknown.evidence, 'insufficient');
    assert.equal(env.memory.retrieve('太平洋鲸鱼的迁徙路线').evidence, 'none');
  } finally { env.close(); }
});

test('只读改写每轮最多一次、只收到当前问题；高置信度跳过、失败降级、不继承到下一轮', async () => {
  const env = setup(); let calls = 0;
  try {
    env.save({ kind: 'semantic', key: 'user.coffee', content: '用户偏好不加糖的咖啡。' });
    const query = '我点拿铁需要放方糖吗？';
    await env.memory.withRequest(request(query), async () => {
      const rewrite = async (text: string) => { calls++; assert.equal(text, query); return { queries: ['咖啡 糖 偏好'] }; };
      await Promise.all([env.memory.prepareRetrieval(rewrite), env.memory.prepareRetrieval(rewrite)]);
      assert.equal(calls, 1); assert.equal(env.memory.search(query)[0]?.key, 'user.coffee');
      const a = env.memory.buildContext(900); const b = env.memory.buildContext(900);
      assert.deepEqual(a, b); assert.ok(Buffer.byteLength(a.text) <= 900);
      assert.throws(() => env.memory.remember({ kind: 'semantic', key: 'bad', content: '推断' }), /明确意图/);
    });
    await env.memory.withRequest(request('咖啡加糖偏好是什么？'), async () => {
      await env.memory.prepareRetrieval(async () => { calls++; throw new Error('should skip'); });
    });
    assert.equal(calls, 1);
    await env.memory.withRequest(request(query), async () => {
      await env.memory.prepareRetrieval(async () => { throw new Error('secret details must not be logged'); });
      assert.ok(env.memory.search(query).length <= 1);
      assert.equal(env.memory.currentRequest()?.prompt, query);
    });
    assert.throws(() => parseRewrite({ queries: [42] }), /格式/);
    assert.throws(() => parseRewrite({ queries: Array(4).fill('x') }), /格式/);
  } finally { env.close(); }
});

test('改写不能替换原始实体/日期约束；更新和删除后不从本轮计划或工具选择复活旧知识', async () => {
  const env = setup();
  try {
    const record = env.save({ kind: 'project', key: 'nova.db', content: 'Nova 项目使用 MySQL。' });
    env.save({ kind: 'project', key: 'lumen.db', content: 'Lumen 项目使用 PostgreSQL。' });
    const all = env.memory.listForHost();
    assert.ok(retrieve(all, 'Nova 数据库是什么？', undefined, { queries: ['Lumen PostgreSQL 数据库'] }).records.every(r => r.id === record.id));
    await env.memory.withRequest(request('Nova 的未知部署方案是什么？', 'task'), async () => {
      await env.memory.prepareRetrieval(async () => ({ queries: ['Nova 数据库 MySQL'] }));
      env.memory.select([record]);
      assert.ok(env.memory.buildContext(2048).text.includes('MySQL'));
      env.memory.withRequest(request('更新记忆：Nova 项目使用 SQLite。\nkey=nova.db'), () => env.memory.update(record.id, 'Nova 项目使用 SQLite。', 1));
      const current = env.memory.buildContext(2048).text;
      assert.ok(current.includes('SQLite')); assert.ok(!current.includes('MySQL')); assert.ok(current.includes('"version":2'));
      assert.throws(() => env.memory.forget(record.id, 2), /后台/);
      env.memory.withRequest(request('忘记：key=nova.db'), () => env.memory.forget(record.id, 2));
      assert.deepEqual(env.memory.buildContext(2048), { text: '', ids: [] });
    });
  } finally { env.close(); }
});

test('改写未响应时当前请求仍可中止；失败原因和正文不进入审计', async () => {
  const env = setup(); const logs: string[] = [];
  try {
    env.save({ kind: 'project', key: 'delta.database', content: 'Delta 项目使用 SQLite。' });
    const req = request('Delta 下次发布日期是什么？');
    req.observer.event = (_type, details) => { if (details) logs.push(details); };
    await env.memory.withRequest(req, async () => {
      await env.memory.prepareRetrieval(async () => { throw new Error('private-error-body'); });
      assert.ok(env.memory.buildContext(2048).text.includes('回退词法'));
    });
    assert.ok(!logs.join('').includes('private-error-body'));
    assert.ok(!logs.join('').includes('SQLite'));
    const controller = new AbortController(); req.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      await assert.rejects(env.memory.withRequest(req, () => env.memory.prepareRetrieval(async () => new Promise(() => {}))));
    } finally { clearTimeout(timer); }
  } finally { env.close(); }
});
