import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileMemoryService } from '../src/memory-service.js';
import { retrieve } from '../src/memory-retriever.js';
import type { ExecutionRequest, MemoryInput } from '../src/contracts.js';
const request = (prompt: string): ExecutionRequest => ({ prompt, scope: 'chat', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } });
const fixture = JSON.parse(readFileSync(new URL('./fixtures/memory-retrieval-holdout.json', import.meta.url), 'utf8')) as { memories: MemoryInput[] };
function setup() {
  const root = mkdtempSync(join(tmpdir(), 'memory-evidence-'));
  const memory = new FileMemoryService(root);
  const save = (input: MemoryInput) => memory.withRequest(request(`记住：${input.content}`), () => memory.remember(input));
  for (const item of fixture.memories) save(item);
  return { memory, save, close() { memory.close(); rmSync(root, { recursive: true, force: true }); } };
}

test('费用不得跨主体支持；联系方式不当作设备操作方法，正确候选进入Context', async () => {
  const env = setup();
  try {
    for (const rewrite of [undefined, { queries: ['阿青 每月 电话费 金额', '阿青 电话费用 月租'] }]) {
      const query = '阿青每个月电话费用多少钱？';
      await env.memory.withRequest(request(query), async () => {
        if (rewrite) await env.memory.prepareRetrieval(async () => rewrite);
        const found = env.memory.retrieve(query);
        assert.equal(found.evidence, 'insufficient');
        assert.equal(found.records[0]?.key, 'aqing.contact');
        assert.ok(!found.supportIds.length);
        const context = env.memory.buildContext(2048);
        assert.ok(context.text.includes('证据状态=insufficient'));
        assert.ok(!context.text.includes('99元'));
      });
    }
    const query = '阿青喜欢哪种联系方法，不是阿白？';
    const result = env.memory.retrieve(query);
    assert.equal(result.records[0]?.key, 'aqing.contact');
    assert.equal(result.evidence, 'supported');
    assert.ok(!result.records.some(r => r.key === 'abai.contact'));
    const context = env.memory.withRequest(request(query), () => env.memory.buildContext(2048));
    assert.ok(context.ids.includes(result.records[0]!.id));
    assert.ok(!context.text.includes('恢复出厂'));
  } finally { env.close(); }
});

test('界面和开发语言分别绑定原始问题，不由错误改写切换字段或主体', () => {
  const env = setup();
  try {
    const all = env.memory.listForHost();
    for (const query of ['Nacre UI language 是什么？', 'Nacre 的开发语言是什么？']) {
      const found = retrieve(all, query, undefined, { queries: ['Quartz 数据库价格99元'] });
      assert.equal(found.records[0]?.key, 'nacre.language');
      assert.equal(found.evidence, 'supported');
      const quotes = found.evidenceById.find(p => p.id === found.records[0]!.id)!.proofs.map(p => p.quote).join('');
      assert.ok(quotes.includes(query.includes('UI') ? '日语' : 'Kotlin'));
      assert.ok(!quotes.includes(query.includes('UI') ? 'Kotlin' : '日语'));
      const context = env.memory.withRequest(request(query), () => env.memory.buildContext(2048));
      assert.ok(context.ids.includes(found.records[0]!.id));
    }
    const onlyDevelopment = all.filter(r => r.key !== 'nacre.language');
    onlyDevelopment.push({ ...all.find(r => r.key === 'nacre.language')!, content: 'Nacre 项目的开发语言为 Kotlin。' });
    assert.equal(retrieve(onlyDevelopment, 'Nacre 的界面语言是什么？').evidence, 'insufficient');
    const onlyTheme = onlyDevelopment.map(r => r.key === 'nacre.language' ? { ...r, content: 'Nacre 项目的界面使用暗色主题。' } : r);
    assert.notEqual(retrieve(onlyTheme, 'Nacre 的界面语言是什么？').evidence, 'supported');
  } finally { env.close(); }
});

test('同条Memory多个主体不能拼接字段；未知主体、用户自身、日期和多主体对比分离', () => {
  const env = setup();
  try {
    env.save({ kind: 'semantic', key: 'mixed.contact', content: '林晚喜欢邮件沟通，柏舟的电话费用为每月88元。' });
    assert.notEqual(env.memory.retrieve('林晚每个月电话费用多少钱？').evidence, 'supported');
    assert.equal(env.memory.retrieve('柏舟每个月电话费用多少钱？').evidence, 'supported');
    assert.equal(env.memory.retrieve('未登记的孟雨的电话费用是多少？').evidence, 'none');
    assert.notEqual(env.memory.retrieve('我的电话费用是多少？').evidence, 'supported');
    assert.equal(env.memory.search('9月3日 Nacre 发布结果，别用2日取消记录')[0]?.key, 'nacre.release');
    assert.notEqual(env.memory.retrieve('Nacre 下一次正式发布日期是什么？').evidence, 'supported');
    const both = env.memory.search('Nacre 和 Quartz 分别用什么数据库？');
    assert.deepEqual(new Set(both.slice(0, 2).map(r => r.key)), new Set(['nacre.storage', 'quartz.storage']));
  } finally { env.close(); }
});

test('当前版本更新/删除不遗留证据或工具选中的旧正文；预算不扩大', () => {
  const env = setup();
  try {
    const original = env.memory.search('阿青 联系方式')[0]!;
    env.memory.withRequest(request('阿青的联系方式是什么？'), () => {
      env.memory.select([original]);
      env.memory.withRequest(request('更新记忆：阿青喜欢短信联系。\nkey=aqing.contact'), () => env.memory.update(original.id, '阿青喜欢短信联系。', 1));
      const text = env.memory.buildContext(2048).text;
      assert.ok(text.includes('短信')); assert.ok(!text.includes('电话沟通'));
      env.memory.withRequest(request('忘记：key=aqing.contact'), () => env.memory.forget(original.id, 2));
      assert.deepEqual(env.memory.buildContext(2048), { text: '', ids: [] });
    });
    for (const budget of [512, 900, 2048]) {
      const context = env.memory.withRequest(request('Nacre 的界面语言是什么？'), () => env.memory.buildContext(budget));
      assert.ok(Buffer.byteLength(context.text) <= budget);
    }
  } finally { env.close(); }
});

test('有supported时仍保留相关参考候选；截断不能声称完整证据', () => {
  const env = setup();
  try {
    const reference = env.save({ kind: 'project', key: 'nacre.audit', content: 'Nacre 项目的数据库评审尚未决定备份周期。' });
    const context = env.memory.withRequest(request('Nacre 的数据库是什么？'), () => env.memory.buildContext(2048));
    assert.ok(context.ids.includes(reference.id), '合法的参考候选不能因supportIds存在而被直接丢弃');
    const long = env.save({ kind: 'project', key: 'long.ui', content: 'Aster 项目的背景介绍：' + '这是项目背景。'.repeat(120) + 'Aster 项目的界面语言为意大利语。' });
    const result = env.memory.retrieve('Aster 的界面语言是什么？');
    assert.ok(result.supportIds.includes(long.id));
    const projected = env.memory.withRequest(request('Aster 的界面语言是什么？'), () => env.memory.buildContext(900));
    assert.ok(!projected.text.includes('证据状态=supported'));
    assert.ok(!projected.text.includes('"evidence":"supported"'));
    assert.ok(Buffer.byteLength(projected.text) <= 900);
  } finally { env.close(); }
});

test('界面不是语言字段的同义词：未知属性保守返回，不升级为supported', () => {
  const env = setup();
  try { assert.notEqual(env.memory.retrieve('Nacre 的界面颜色是什么？').evidence, 'supported'); }
  finally { env.close(); }
});
