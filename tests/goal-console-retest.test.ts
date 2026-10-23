import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { GoalConsoleRetestBudget, consoleRetestFetch, openConsoleRetest } from '../scripts/goal-console-retest.js';

const endpoint = 'https://model.invalid/v1/chat/completions', model = 'mock-model';
const fresh = (inputRate = 2, outputRate = 8) => new GoalConsoleRetestBudget({ version: 1, scope: 'v3.0.1-console-retest',
  identity: 'a'.repeat(64), limits: { requests: 16, microCny: 2000000, bodyBytes: 32768, outputTokens: 4096 }, inputRate, outputRate, attempts: [] });
const ledgerFile = (root: string) => join(root, 'v301-console-budget.json');

test('Console复验无授权/飞书参数/旧48次模式均在配置和网络前拒绝', () => {
  for (const args of [[], ['--authorized', '--feishu', '--root=C:/fake'], ['--authorized', '--model-only', '--root=C:/fake']]) {
    const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/goal-console-retest.ts', ...args], { env: {}, encoding: 'utf8' });
    assert.equal(child.status, 1); assert.match(child.stderr, /只支持Console/);
  }
});

test('16次累计闸：失败/未知不退额，JSON重载仍拒绝第17次', () => {
  const budget = fresh();
  for (let i = 0; i < 16; i++) { const attempt = budget.reserve(100, 1); if (i % 2) attempt.status = 500; }
  const resumed = new GoalConsoleRetestBudget(JSON.parse(JSON.stringify(budget.ledger)));
  assert.throws(() => resumed.reserve(1, 1), /16请求/); assert.equal(resumed.ledger.attempts.length, 16);
});

test('2元闸和容量闸：精确到微元，等于2元可完成但后续拒绝，最大16次容量预留不超2元', () => {
  const exact = fresh(500, 500); exact.reserve(3487, 1); assert.equal(exact.reserved, 2000000);
  const resumed = new GoalConsoleRetestBudget(JSON.parse(JSON.stringify(exact.ledger)));
  assert.throws(() => resumed.reserve(1, 1), /2元/);
  const over = fresh(1000, 1000); assert.throws(() => over.reserve(2000, 1), /2元/); assert.equal(over.ledger.attempts.length, 0);
  const budget = fresh();
  for (const [bytes, output] of [[32769, 1], [1, 4097], [0, 1], [1, 0], [NaN, 1]]) assert.throws(() => budget.reserve(bytes!, output!), /容量/);
  for (let i = 0; i < 16; i++) budget.reserve(32768, 4096);
  assert.equal(budget.reserved, 1589248);
});

test('真实跨进程续账：两次启动累计16次，身份/费率/限额/费用篡改及并发启动不放行', () => {
  const parent = mkdtempSync(join(tmpdir(), 'goal-retest-')), root = join(parent, 'new');
  const module = pathToFileURL(join(process.cwd(), 'scripts/goal-console-retest.ts')).href;
  const child = (resume: boolean, count: number) => spawnSync(process.execPath, ['--import','tsx','--input-type=module','-e',
    `import {openConsoleRetest} from ${JSON.stringify(module)};const s=openConsoleRetest(${JSON.stringify(root)},${JSON.stringify(endpoint)},${JSON.stringify(model)},2,8,${resume});try{for(let i=0;i<${count};i++){s.budget.reserve(1000,512);s.persist();}}finally{s.close();}`], { encoding: 'utf8' });
  try {
    assert.equal(child(false, 8).status, 0); assert.equal(child(true, 8).status, 0);
    const denied = child(true, 1); assert.equal(denied.status, 1); assert.match(denied.stderr, /16请求/);
    const original = readFileSync(ledgerFile(root), 'utf8');
    const session = openConsoleRetest(root, endpoint, model, 2, 8, true);
    assert.throws(() => openConsoleRetest(root, endpoint, model, 2, 8, true), /EEXIST/); session.close();
    assert.throws(() => openConsoleRetest(root, endpoint, 'other-model', 2, 8, true), /变化/);
    assert.throws(() => openConsoleRetest(root, endpoint, model, 3, 8, true), /变化/);
    assert.throws(() => openConsoleRetest(root, endpoint, model, 2, 8, false), /新目录/);
    for (const mutate of [(x: any) => { x.limits.requests = 48; }, (x: any) => { x.attempts[0].reservedMicroCny = 1; },
      (x: any) => { delete x.scope; }, (x: any) => { x.limits.bodyBytes = 65536; }]) {
      const value = JSON.parse(original); mutate(value); writeFileSync(ledgerFile(root), JSON.stringify(value));
      assert.throws(() => openConsoleRetest(root, endpoint, model, 2, 8, true), /账本无效/);
      assert.equal(existsSync(join(root, 'console-retest.lock')), false);
    }
    writeFileSync(ledgerFile(root), original);
    assert.equal(JSON.parse(readFileSync(ledgerFile(root), 'utf8')).attempts.length, 16);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('真实fetch边界离线模拟：先持久化再发出，其他端点/飞书/大UTF8正文/多输出参数不联网', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'goal-retest-fetch-')), root = join(parent, 'new');
  const session = openConsoleRetest(root, endpoint, model, 2, 8, false); let calls = 0;
  const fetcher = consoleRetestFetch(session, root, endpoint, model, 'fake-secret', async (_input, init) => {
    calls++; assert.equal(init?.redirect, 'error');
    assert.equal(JSON.parse(readFileSync(ledgerFile(root), 'utf8')).attempts.length, calls);
    return new Response('data: [DONE]\n\n', { status: 200 });
  });
  const body = (extra = {}) => JSON.stringify({ model, max_tokens: 1000, messages: [], ...extra });
  try {
    for (const [url, payload] of [['https://open.feishu.cn/test', body()], [endpoint, body({ max_tokens: 4097 })],
      [endpoint, body({ messages: ['字'.repeat(12000)] })], [endpoint, body({ model: 'other' })],
      [endpoint, body({ max_completion_tokens: 4097 })], [endpoint, body({ messages: ['fake-secret'] })]]) {
      await assert.rejects(fetcher(url!, { method: 'POST', body: payload! }));
    }
    assert.equal(calls, 0); assert.equal(session.budget.ledger.attempts.length, 0);
    for (let i = 0; i < 16; i++) await (await fetcher(endpoint, { method: 'POST', body: body() })).text();
    await assert.rejects(fetcher(endpoint, { method: 'POST', body: body() }), /16请求/);
    assert.equal(calls, 16); assert.equal(existsSync(join(root, 'response-16.txt')), true);
  } finally { session.close(); rmSync(parent, { recursive: true, force: true }); }
});

test('传输失败不自动重试或退额，落盘失败在传输前停止，费用闸可跨文件重开', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'goal-retest-failure-')), root = join(parent, 'new');
  let session = openConsoleRetest(root, endpoint, model, 2, 8, false), calls = 0;
  const request = { method: 'POST', body: JSON.stringify({ model, max_tokens: 1 }) };
  try {
    const failed = consoleRetestFetch(session, root, endpoint, model, 'fake-key', async () => { calls++; throw new Error('模拟断网'); });
    await assert.rejects(failed(endpoint, request), /模拟断网/); assert.equal(calls, 1);
    assert.equal(JSON.parse(readFileSync(ledgerFile(root), 'utf8')).attempts.length, 1);
    session.close(); session = openConsoleRetest(root, endpoint, model, 2, 8, true);
    assert.equal(session.budget.ledger.attempts.length, 1);
    const broken = consoleRetestFetch({ ...session, persist() { throw new Error('模拟磁盘失败'); } }, root, endpoint, model, 'fake-key', async () => { calls++; return new Response(''); });
    await assert.rejects(broken(endpoint, request), /模拟磁盘失败/); assert.equal(calls, 1);
    session.close();
    const feeRoot = join(parent, 'fee'), fee = openConsoleRetest(feeRoot, endpoint, model, 500, 500, false);
    fee.budget.reserve(3487, 1); fee.persist(); fee.close();
    const resumed = openConsoleRetest(feeRoot, endpoint, model, 500, 500, true);
    try { assert.throws(() => resumed.budget.reserve(1, 1), /2元/); } finally { resumed.close(); }
  } finally { session.close(); rmSync(parent, { recursive: true, force: true }); }
});
