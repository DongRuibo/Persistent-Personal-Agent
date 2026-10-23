import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { StagedAcceptanceBudget, openStagedAcceptance, stagedAcceptanceFetch, stagedAcceptanceWeb } from '../scripts/staged-console-acceptance.js';
import { stagedCases, stagedLimits, stageLimits } from '../scripts/staged-console-cases.js';
import type { StagedCase } from '../scripts/staged-console-cases.js';
import { defaultWebResources } from '../src/web-read-types.js';
import { integratedWebLimit } from '../scripts/integrated-console-acceptance.js';

const profile = () => ({ endpoint: 'https://model.invalid/v1/chat/completions', model: 'local-stub', inputRate: 2, outputRate: 8, checkedAt: new Date().toISOString(),
  planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64), casesHash: '4'.repeat(64), nodeVersion: process.version });
const directory = () => join(mkdtempSync(join(tmpdir(), 'staged-console-')), 'new');
const signal = () => new AbortController().signal;
type Ledger = ConstructorParameters<typeof StagedAcceptanceBudget>[0];
const ledger = (): Ledger => ({ version: 1, scope: 'goal-skills-web-staged-console-v1', identity: 'a'.repeat(64), profile: profile(), limits: { ...stagedLimits }, stages: structuredClone(stageLimits),
  cases: [], attempts: [], webLimit: { ...integratedWebLimit }, webAttempts: [] });

test('分阶段入口默认不执行；冻结话术与阶段/单步限额完整覆盖且不改旧方案', () => {
  const child = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/staged-console-acceptance.ts'], { encoding: 'utf8', windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
  assert.equal(child.status, 1); assert.match(child.stderr, /另行批准/);
  const plan = readFileSync('docs/evaluations/staged-console-live-plan.md', 'utf8');
  for (const spec of Object.values(stagedCases)) if (spec.prompt) assert.ok(plan.includes(spec.prompt));
  assert.ok(!stagedCases.A1.prompt.includes('学习计划')); assert.equal(stagedCases.A5.prompt, '暂停那个学习计划');
  assert.equal(Object.values(stagedCases).reduce((s, x) => s + x.expected, 0), 35);
  assert.equal(Object.values(stagedCases).reduce((s, x) => s + x.max, 0), 46);
  assert.equal(stagedCases.A3.max, 0); assert.equal(stagedCases.C4.max, 0);
  for (const [stage, limit] of Object.entries(stageLimits)) assert.equal(Object.values(stagedCases).filter(x => x.stage === stage).reduce((s, x) => s + x.max, 0), limit.requests);
});

test('46/8与各阶段/单步同时限额；失败不退、64KiB/4096和未知/过期费率均保守拒绝', () => {
  const b = new StagedAcceptanceBudget(ledger());
  for (const [id, spec] of Object.entries(stagedCases) as [StagedCase, typeof stagedCases[StagedCase]][]) {
    const c = { id, at: new Date().toISOString(), finished: undefined as string | undefined, statePass: true }; b.ledger.cases.push(c);
    for (let i = 0; i < spec.max; i++) b.reserve(id, 65536, 4096).status = 500;
    assert.throws(() => b.reserve(id, 1, 1), /预算/); c.finished = new Date().toISOString();
  }
  assert.equal(b.ledger.attempts.length, 46); assert.equal(b.reserved, 7583744);
  assert.equal(new StagedAcceptanceBudget(JSON.parse(JSON.stringify(b.ledger))).reserved, b.reserved);
  const over = JSON.parse(JSON.stringify(b.ledger)) as Ledger; over.attempts.push(over.attempts[0]!); assert.throws(() => new StagedAcceptanceBudget(over), /超出/);
  for (const rate of [0, NaN, Infinity, -1]) { const l = ledger(); l.profile.inputRate = rate; assert.throws(() => new StagedAcceptanceBudget(l), /费率/); }
  const l = ledger(); l.cases.push({ id: 'A1', at: new Date().toISOString() }); const fresh = new StagedAcceptanceBudget(l);
  for (const [bytes, output] of [[0, 1], [65537, 1], [1, 4097]]) assert.throws(() => fresh.reserve('A1', bytes!, output!), /64KiB/);
  l.profile.checkedAt = '2000-01-01T00:00:00.000Z'; assert.throws(() => fresh.reserve('A1', 1, 1), /费率/);
  const expensive = ledger(); expensive.profile.inputRate = 1000; expensive.profile.outputRate = 1000; expensive.cases.push({ id: 'A1', at: new Date().toISOString() });
  assert.throws(() => new StagedAcceptanceBudget(expensive).reserve('A1', 65536, 4096), /预算/); assert.equal(expensive.attempts.length, 0);
});

test('新scope/独占锁/原子写入/跨进程续账及已消费Case保护；A失败仍可独立B，C不能借审阅参数越过状态', () => {
  const root = directory(), p = profile(); let s = openStagedAcceptance(root, p);
  try {
    assert.throws(() => openStagedAcceptance(root, p), /新目录/); assert.throws(() => openStagedAcceptance(root, p, true), /EEXIST/);
    s.begin('A1'); s.budget.reserve('A1', 1000, 512).status = 500; s.persist(); s.finish('A1', false); s.close();
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `import { openStagedAcceptance } from './scripts/staged-console-acceptance.ts'; const s=openStagedAcceptance(${JSON.stringify(root)},${JSON.stringify(p)},true);console.log(s.budget.ledger.attempts.length);s.close();`], { encoding: 'utf8', windowsHide: true });
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), '1');
    s = openStagedAcceptance(root, p, true); assert.throws(() => s.begin('A1'), /消费/); assert.throws(() => s.begin('A2'), /前置/);
    assert.throws(() => s.begin('C1', true), /A\/B/); s.begin('B1'); s.finish('B1', false); assert.throws(() => s.begin('A2'), /前置|返回/);
    s.close(); assert.throws(() => openStagedAcceptance(root, { ...p, codeHash: '5'.repeat(64) }, true), /已改变/);
    const file = join(root, 'staged-budget.json'), raw = readFileSync(file, 'utf8'); const old = JSON.parse(raw); old.scope = 's0-s1b-v301-console-v2'; writeFileSync(file, JSON.stringify(old));
    assert.throws(() => openStagedAcceptance(root, p, true), /旧轮/); writeFileSync(file, raw); mkdirSync(file + '.pending'); assert.throws(() => openStagedAcceptance(root, p, true), /未完成/);
  } finally { s.close(); }
});

test('每次物理请求先落盘；冻结话术/范围不符和写失败零发送，网络失败不退额', async () => {
  const s = openStagedAcceptance(directory(), profile()); let sends = 0; s.begin('A1');
  const call = stagedAcceptanceFetch(s, 'A1', 'fixture-not-a-key', async (_input, init) => {
    sends++; assert.equal(JSON.parse(readFileSync(join(s.root, 'staged-budget.json'), 'utf8')).attempts.length, sends);
    assert.equal(init?.redirect, 'error'); throw new Error('模拟断连');
  });
  const payload = { model: 'local-stub', max_tokens: 4096, messages: [{ role: 'system', content: 'chat' }, { role: 'user', content: stagedCases.A1.prompt }] };
  const init = { method: 'POST', body: JSON.stringify(payload) };
  try {
    for (const body of [{ ...payload, model: 'wrong' }, { ...payload, messages: [{ role: 'user', content: '更换话术' }] }, { ...payload, tools: [{ function: { name: 'web_get' } }] }]) await assert.rejects(call(s.budget.ledger.profile.endpoint, { ...init, body: JSON.stringify(body) }));
    assert.equal(sends, 0); await assert.rejects(call(s.budget.ledger.profile.endpoint, init), /模拟断连/); assert.equal(s.budget.ledger.attempts.length, 1);
    mkdirSync(join(s.root, 'staged-budget.json.pending')); await assert.rejects(call(s.budget.ledger.profile.endpoint, init)); assert.equal(sends, 1);
    await assert.rejects(call(s.budget.ledger.profile.endpoint, init)); assert.equal(sends, 1);
  } finally { s.close(); }
});

test('仅B1固定GET，DNS前持久预留；失败/重启/新Run/其他Case均不释放或重取', async () => {
  const root = directory(), p = profile(); let s = openStagedAcceptance(root, p), dns = 0, gets = 0;
  const resource = defaultWebResources[0]!;
  const service = (id: StagedCase) => stagedAcceptanceWeb(s, id, async () => {
    dns++; assert.equal(JSON.parse(readFileSync(join(root, 'staged-budget.json'), 'utf8')).webAttempts.length, 1); throw new Error('模拟DNS失败');
  }, { get: async () => { gets++; return Buffer.from('never'); } });
  try {
    s.begin('A1'); await assert.rejects(service('A1').fetch(resource.id, resource.hash, signal()), /B1/); assert.equal(dns, 0); s.finish('A1', false); s.begin('B1');
    const phases: string[] = []; await assert.rejects(service('B1').fetch(resource.id, resource.hash, signal(), phase => phases.push(phase)), /DNS失败/);
    assert.deepEqual(phases, ['dns_started', 'failed']); assert.equal(dns, 1); assert.equal(gets, 0); s.close(); s = openStagedAcceptance(root, p, true);
    await assert.rejects(service('B1').fetch(resource.id, resource.hash, signal()), /一次/);
    await assert.rejects(service('B1').fetch('pi-sdk-v1', resource.hash, signal()));
    await assert.rejects(service('C1').fetch(resource.id, resource.hash, signal()));
    assert.equal(dns, 1); assert.equal(gets, 0); assert.equal(s.budget.ledger.webAttempts.length, 1); assert.equal(s.budget.ledger.attempts.length, 0);
  } finally { s.close(); }
});
