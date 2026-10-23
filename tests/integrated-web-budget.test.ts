import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { integratedAcceptanceFetch, integratedAcceptanceWeb, integratedWebLimit, openIntegratedAcceptance } from '../scripts/integrated-console-acceptance.js';
import { defaultWebResources } from '../src/web-read-types.js';
import { webFixture } from './helpers/web-fixture.js';
import { reply, toolCall } from './helpers/skills-fixture.js';

const profile = () => ({ endpoint: 'https://model.invalid/v1/chat/completions', model: 'local-stub', inputRate: 2, outputRate: 8,
  checkedAt: new Date().toISOString(), planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64) });
const directory = () => join(mkdtempSync(join(tmpdir(), 'integrated-web-')), 'new-root');
const resource = defaultWebResources.find(item => item.id === integratedWebLimit.resourceId)!;
const signal = () => new AbortController().signal;

test('统一验收根目录跨Run和重启最多一次固定Web GET，模型额度不能替代Web限额', async () => {
  const nativeFetch = globalThis.fetch;
  const f = await webFixture((_payload, count) => count % 2 ? toolCall('web_get', { resourceId: 'pi-skills-v1' }) : reply('模型收尾'));
  const root = join(f.root, 'acceptance'), profile = { endpoint: f.config.baseUrl + '/chat/completions', model: 'local-stub',
    inputRate: 2, outputRate: 8, checkedAt: new Date().toISOString(), planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64) };
  let session = openIntegratedAcceptance(root, profile);
  let dns = 0;
  const service = () => integratedAcceptanceWeb(session, async () => { dns++; return [{ address: '8.8.8.8', family: 4 }]; }, {
    get: async (_target, signal) => new Promise<Buffer>((resolve, reject) => {
      const req = request(f.httpUrl + '/pi-skills-v1', { signal }, res => {
        const chunks: Buffer[] = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)));
      }); req.on('error', reject); req.end();
    }),
  });
  try {
    globalThis.fetch = integratedAcceptanceFetch(session, f.config.apiKey!, nativeFetch);
    await f.restart(service());
    await f.chat(); assert.equal(f.requests, 1); assert.equal(dns, 1);
    session.close(); session = openIntegratedAcceptance(root, profile, true);
    globalThis.fetch = integratedAcceptanceFetch(session, f.config.apiKey!, nativeFetch);
    f.config.sessionDir = join(f.root, 'another-session');
    await f.restart(service()); const denied = await f.chat();
    console.log(JSON.stringify({ mockWebGets: f.requests, mockDns: dns, modelHttp: session.budget.ledger.attempts.length,
      webRows: f.store.web.calls().map(row => ({ runId: row.runId, status: row.status })) }));
    assert.equal(f.requests, 1, '同一验收根目录的新Run不得发出第二次GET');
    assert.equal(dns, 1, '第二次读取必须在DNS之前拒绝'); assert.match(denied.text, /模型收尾/);
    assert.deepEqual(f.store.web.calls().map(row => row.status).sort(), ['failed', 'succeeded']);
    assert.equal(session.budget.ledger.webAttempts.length, 1);
    assert.equal(session.budget.ledger.attempts.length, 4);
  } finally { globalThis.fetch = nativeFetch; session.close(); await f.close(); }
});

test('固定资源和地址之外在DNS前拒绝，预留已落盘才开始DNS；并发只有一次', async () => {
  const session = openIntegratedAcceptance(directory(), profile()); let dns = 0, gets = 0;
  const service = integratedAcceptanceWeb(session, async () => {
    dns++; const ledger = JSON.parse(readFileSync(join(session.root, 'integrated-budget.json'), 'utf8'));
    assert.equal(ledger.webAttempts.length, 1); assert.equal(ledger.webAttempts[0].url, integratedWebLimit.url);
    return [{ address: '8.8.8.8', family: 4 }];
  }, { get: async target => { gets++; assert.equal(target.url, integratedWebLimit.url); return Buffer.from('虚构正文'); } });
  try {
    assert.deepEqual(service.list().map(item => item.id), ['pi-skills-v1']);
    for (const id of ['pi-sdk-v1', 'wrong-id', 'https://example.invalid']) await assert.rejects(service.fetch(id, resource.hash, signal()));
    for (const url of [integratedWebLimit.url + '?x=1', 'https://127.0.0.1/private', integratedWebLimit.url.replace('v1.3.0', 'main')])
      assert.throws(() => session.budget.reserveWeb(resource.id, url, resource.hash), /固定/);
    assert.equal(dns, 0); assert.equal(gets, 0); assert.equal(session.budget.ledger.webAttempts.length, 0);
    const results = await Promise.allSettled([service.fetch(resource.id, resource.hash, signal()), service.fetch(resource.id, resource.hash, signal())]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1); assert.equal(dns, 1); assert.equal(gets, 1);
    assert.equal(session.budget.ledger.attempts.length, 0, 'Web不消费或替代模型预算');
    for (let i = 0; i < 32; i++) session.budget.reserve(1000, 512); session.persist();
    assert.throws(() => session.budget.reserve(1, 1), /上限/);
    await assert.rejects(service.fetch(resource.id, resource.hash, signal()), /最多一次/); assert.equal(dns, 1);
  } finally { session.close(); }
});

test('DNS失败、发送失败或发送中取消不退Web预留，重启后再次尝试均零DNS/GET', async t => {
  for (const kind of ['dns', 'transport', 'abort'] as const) await t.test(kind, async () => {
    const root = directory(), p = profile(); let session = openIntegratedAcceptance(root, p), dns = 0, gets = 0;
    const controller = new AbortController();
    const service = integratedAcceptanceWeb(session, async () => {
      dns++; if (kind === 'dns') throw new Error('模拟DNS失败'); return [{ address: '8.8.8.8', family: 4 }];
    }, { get: async () => { gets++; await Promise.resolve(); if (kind === 'abort') controller.abort(new Error('模拟发送中取消')); throw new Error('模拟响应不确定'); } });
    try {
      await assert.rejects(service.fetch(resource.id, resource.hash, controller.signal));
      assert.equal(session.budget.ledger.webAttempts.length, 1); assert.equal(dns, 1); assert.equal(gets, kind === 'dns' ? 0 : 1);
      session.close(); session = openIntegratedAcceptance(root, p, true);
      const resumed = integratedAcceptanceWeb(session, async () => { dns++; throw new Error('不应到达DNS'); }, { get: async () => { gets++; throw new Error('不应到达GET'); } });
      await assert.rejects(resumed.fetch(resource.id, resource.hash, signal()), /最多一次/);
      assert.equal(dns, 1); assert.equal(gets, kind === 'dns' ? 0 : 1);
    } finally { session.close(); }
  });
});

test('独立新进程续测仍拒绝第二次Web，退出后残留锁保守拒绝；不借新Run或Session重置', async () => {
  const root = directory(), p = profile(), session = openIntegratedAcceptance(root, p);
  session.budget.reserveWeb(resource.id, resource.url, resource.hash); session.persist(); session.close();
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
    import fs from 'node:fs'; import { join } from 'node:path';
    import { integratedAcceptanceWeb, openIntegratedAcceptance } from './scripts/integrated-console-acceptance.ts';
    const root=process.argv[1], p=JSON.parse(fs.readFileSync(join(root,'integrated-budget.json'),'utf8')).profile;
    const session=openIntegratedAcceptance(root,p,true); let dns=0;
    const service=integratedAcceptanceWeb(session,async()=>{dns++;throw new Error('DNS不应发生');});
    try { await service.fetch('pi-skills-v1',service.current('pi-skills-v1').hash,new AbortController().signal); process.exitCode=2; }
    catch(error) { console.log(JSON.stringify({dns,error:error.message,web:session.budget.ledger.webAttempts.length})); }
    // 故意模拟进程退出，没有close；保留锁，宿主不得自动清锁继续。
  `, root], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot }, windowsHide: true });
  assert.equal(child.status, 0, child.stderr); const result = JSON.parse(child.stdout);
  assert.equal(result.dns, 0); assert.equal(result.web, 1); assert.match(result.error, /最多一次/);
  assert.throws(() => openIntegratedAcceptance(root, p, true), /exist|EEXIST/);
});

test('Web预留写入失败、关闭账本、旧格式或损坏账本均禁止DNS，不能默认恢复零额度', async () => {
  const root = directory(), p = profile(); let session = openIntegratedAcceptance(root, p), dns = 0;
  const service = integratedAcceptanceWeb(session, async () => { dns++; return [{ address: '8.8.8.8', family: 4 }]; });
  try {
    mkdirSync(join(root, 'integrated-budget.json.pending'));
    await assert.rejects(service.fetch(resource.id, resource.hash, signal()));
    await assert.rejects(service.fetch(resource.id, resource.hash, signal())); assert.equal(dns, 0);
  } finally { session.close(); }
  assert.throws(() => openIntegratedAcceptance(root, p, true), /人工核对/);
  const closed = openIntegratedAcceptance(directory(), p); closed.close();
  await assert.rejects(integratedAcceptanceWeb(closed, async () => { dns++; throw new Error('不应DNS'); }).fetch(resource.id, resource.hash, signal()), /已关闭/);
  assert.equal(dns, 0);
  const cleanRoot = directory(); session = openIntegratedAcceptance(cleanRoot, p); session.close();
  const file = join(cleanRoot, 'integrated-budget.json'), original = readFileSync(file, 'utf8');
  for (const mutate of [(v: any) => { delete v.webAttempts; }, (v: any) => { v.version = 1; }, (v: any) => { v.webLimit.reservations = 2; },
    (v: any) => { v.webAttempts = [{ at: new Date().toISOString(), resourceId: 'pi-sdk-v1', url: resource.url, catalogHash: resource.hash }]; }]) {
    const value = JSON.parse(original); mutate(value); writeFileSync(file, JSON.stringify(value)); assert.throws(() => openIntegratedAcceptance(cleanRoot, p, true), /损坏/);
  }
});
