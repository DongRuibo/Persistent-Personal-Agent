import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TavilyService, publicSearchUrl, boundWebResult } from '../src/tavily-service.js';
import { readConfig } from '../src/config.js';

const signal = () => new AbortController().signal;
const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const searchData = { results: [{ title: '官方说明', url: 'https://example.com/docs', content: '资料摘要' }] };

test('Tavily：固定免Key请求；仅发送查询或网址；basic搜索和Markdown提取', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const service = new TavilyService(async (url, init) => {
    calls.push({ url: String(url), init: init! });
    return response(String(url).endsWith('/search') ? searchData : { results: [{ url: 'https://example.com/docs', raw_content: '# 完整正文' }], failed_results: [] });
  }, resolver);
  const found = await service.search('官方文档', signal());
  const page = await service.extract(found.sources[0]!.url, signal());
  assert.equal(page.sources[0]!.text, '# 完整正文');
  assert.equal(page.sources[0]!.title, 'example.com');
  assert.deepEqual(calls.map(c => c.url), ['https://api.tavily.com/search', 'https://api.tavily.com/extract']);
  for (const call of calls) {
    assert.deepEqual(call.init.headers, { 'Content-Type': 'application/json', 'X-Tavily-Access-Mode': 'keyless' });
    assert.equal(call.init.redirect, 'error');
  }
  const query = JSON.parse(calls[0]!.init.body as string);
  assert.equal(query.query, '官方文档'); assert.equal(query.max_results, 5);
  assert.equal(query.search_depth, 'basic'); assert.equal(query.include_answer, false);
  assert.equal(query.include_raw_content, false); assert.equal(query.auto_parameters, false);
  assert.deepEqual(JSON.parse(calls[1]!.init.body as string), { urls: ['https://example.com/docs'], extract_depth: 'basic', format: 'markdown', include_images: false });
});

test('Tavily：拒绝危险地址、非公开DNS和未知查询参数，不向目标网址直接请求', async () => {
  for (const url of ['file:///tmp/a', 'https://a:b@example.com', 'http://localhost/a', 'http://x.local/a', 'http://127.1/a', 'http://169.254.169.254/a', 'http://[::1]/', 'https://10.0.0.1/', 'https://[::ffff:7f00:1]/']) assert.throws(() => publicSearchUrl(url));
  let calls = 0;
  const service = new TavilyService(async () => { calls++; return response(searchData); }, async () => [{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(service.extract('https://example.com', signal()), /公网/);
  await assert.rejects(service.search(' ', signal()));
  await assert.rejects(service.search('x'.repeat(401), signal()));
  assert.equal(calls, 0);
  assert.equal(publicSearchUrl('https://example.com/a#part'), 'https://example.com/a');
});

test('Tavily：结果上限及UTF-8正文/整体工具预算真实截断，保留来源', async () => {
  const service = new TavilyService(async url => response(String(url).endsWith('/search')
    ? { results: Array.from({ length: 9 }, (_, i) => ({ title: `来源${i}`, url: `https://example.com/${i}`, content: '中'.repeat(4000) })) }
    : { results: [{ url: 'https://example.com/', raw_content: '中'.repeat(18000) }], failed_results: [] }), resolver);
  const found = await service.search('资料', signal()); assert.equal(found.sources.length, 5); assert.equal(found.truncated, true);
  const page = await service.extract('https://example.com/', signal());
  assert.ok(Buffer.byteLength(page.sources[0]!.text) <= 16384); assert.ok(!page.sources[0]!.text.includes('\ufffd'));
  const bounded = boundWebResult(page, 3000);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded)) <= 3000);
  assert.equal(bounded.sources[0]!.url, 'https://example.com/'); assert.equal(bounded.truncated, true);
  assert.equal(page.sources[0]!.text.length > bounded.sources[0]!.text.length, true);
});

test('Tavily：HTTP200仍检查空结果、提取失败和响应结构，不拿错误说明充当正文', async () => {
  const empty = new TavilyService(async () => response({ results: [] }), resolver);
  assert.equal((await empty.search('不存在的资料', signal())).sources.length, 0);
  const failed = new TavilyService(async () => response({ results: [], failed_results: [{ url: 'https://example.com/', error: 'failed' }] }), resolver);
  await assert.rejects(failed.extract('https://example.com', signal()), /提取失败/);
  for (const body of [
    { results: [{ url: 'https://example.com/other', raw_content: '其他网址正文' }], failed_results: [] },
    { results: [{ url: 'https://example.com/', raw_content: '冲突正文' }], failed_results: [{ url: 'https://example.com/', error: 'failed' }] },
  ]) await assert.rejects(new TavilyService(async () => response(body), resolver).extract('https://example.com', signal()), /提取失败/);
  for (const body of [{ answer: '伪结果' }, { results: [{ title: '没有正文', url: 'https://example.com' }] }]) {
    const service = new TavilyService(async () => response(body), resolver);
    await assert.rejects(service.search('资料', signal()), /响应/);
  }
});

test('Tavily：限流不重试，超时及取消中止等待，响应体有1MiB上限', async () => {
  let calls = 0;
  const limited = new TavilyService(async () => { calls++; return response({ instructions: '请购买付费Key' }, 429); }, resolver);
  await assert.rejects(limited.search('资料', signal()), error => (error as { code: string }).code === 'rate_limited');
  assert.equal(calls, 1);
  const slow = new TavilyService(async () => new Promise<Response>(() => {}), resolver, 10);
  await assert.rejects(slow.search('资料', signal()), /超时/);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(limited.search('资料', abort.signal)); assert.equal(calls, 1);
  const oversized = new TavilyService(async () => new Response('x'.repeat(1048577)), resolver);
  await assert.rejects(oversized.search('资料', signal()), /1 MiB/);
});

test('搜索开关默认关闭，Web启动入口显式设置默认开启值；拒绝含糊值', () => {
  assert.equal(readConfig({}).webSearchEnabled, false);
  assert.equal(readConfig({ WEB_SEARCH_ENABLED: 'true' }).webSearchEnabled, true);
  assert.equal(readConfig({ WEB_SEARCH_ENABLED: 'false' }).webSearchEnabled, false);
  assert.throws(() => readConfig({ WEB_SEARCH_ENABLED: 'yes' }), /WEB_SEARCH_ENABLED/);
});
