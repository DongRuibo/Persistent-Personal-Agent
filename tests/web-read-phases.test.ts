import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebReadService } from '../src/web-read-service.js';
import { defaultWebResources } from '../src/web-read-types.js';
import type { WebReadPhase } from '../src/web-read-service.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../src/sqlite-store.js';
import { webHash } from '../src/web-read-types.js';
import { integratedAcceptanceWeb, openIntegratedAcceptance } from '../scripts/integrated-console-acceptance.js';

const resource = defaultWebResources[0]!;
test('DNS超时留下准确的本地阶段，不推断已经发出GET', async () => {
  const phases: string[] = []; let gets = 0;
  const service = new WebReadService([resource], () => new Promise(() => {}), { get: async () => { gets++; return Buffer.from('never'); } }, 15);
  const alive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(service.fetch(resource.id, resource.hash, new AbortController().signal, (phase: string) => phases.push(phase)), { name: 'TimeoutError' });
    assert.deepEqual(phases, ['dns_started', 'timeout']); assert.equal(gets, 0);
  } finally { clearTimeout(alive); }
});

test('连接/TLS/本地发送/响应阶段分别超时，仅记录确实发生的阶段；迟到事件不能补写成功', async t => {
  const stages: WebReadPhase[] = ['connection_started', 'tcp_connected', 'tls_verified', 'request_created', 'request_finished_local', 'response_headers', 'response_body_started'];
  for (const last of stages) await t.test(last, async () => {
    const phases: WebReadPhase[] = []; let late: (() => void) | undefined;
    const service = new WebReadService([resource], async () => [{ address: '8.8.8.8', family: 4 }], {
      get: async (_target, _signal, report) => {
        for (const phase of stages.slice(0, stages.indexOf(last) + 1)) report?.(phase);
        late = () => report?.('response_complete'); return new Promise(() => {});
      },
    }, 15);
    const alive = setTimeout(() => {}, 1000);
    try {
      await assert.rejects(service.fetch(resource.id, resource.hash, new AbortController().signal, phase => phases.push(phase)), { name: 'TimeoutError' });
      assert.deepEqual(phases, ['dns_started', 'dns_resolved', ...stages.slice(0, stages.indexOf(last) + 1), 'timeout']);
      late?.(); assert.ok(!phases.includes('response_complete'));
    } finally { clearTimeout(alive); }
  });
});

test('连接失败与响应中断保留failed而非完整响应，不泄露原始异常', async t => {
  for (const last of ['connection_started', 'response_headers', 'response_body_started'] as const) await t.test(last, async () => {
    const phases: string[] = [];
    const service = new WebReadService([resource], async () => [{ address: '8.8.8.8', family: 4 }], {
      get: async (_target, _signal, report) => { report?.(last); throw new Error('PRIVATE_NETWORK_ERROR'); },
    });
    await assert.rejects(service.fetch(resource.id, resource.hash, new AbortController().signal, phase => phases.push(phase)));
    assert.deepEqual(phases, ['dns_started', 'dns_resolved', last, 'failed']);
    assert.ok(!phases.join('').includes('PRIVATE_NETWORK_ERROR'));
  });
});

test('阶段写入复用Run Events；整轮预留在DNS前落盘，失败/跨Run/重启仍只能一次', async () => {
  const root = mkdtempSync(join(tmpdir(), 'web-phase-ledger-')), path = join(root, 'app.db'), ledgerRoot = join(root, 'ledger');
  let store = new SqliteStore(path), dns = 0;
  const profile = { endpoint: 'https://model.invalid/v1/chat/completions', model: 'local-stub', inputRate: 2, outputRate: 8,
    checkedAt: new Date().toISOString(), planHash: '1'.repeat(64), entryHash: '2'.repeat(64), codeHash: '3'.repeat(64) };
  let session = openIntegratedAcceptance(ledgerRoot, profile);
  const clock = () => new Date(), signal = new AbortController().signal;
  const makePermit = () => { const run = store.beginRun(null, clock().toISOString()); return { id: webHash(run.id), runId: run.id, owner: 'fake', channel: 'console', resourceId: resource.id, catalogHash: resource.hash, expires: Date.now() + 300000 }; };
  const service = () => integratedAcceptanceWeb(session, async () => {
    dns++; assert.equal(JSON.parse(readFileSync(join(ledgerRoot, 'integrated-budget.json'), 'utf8')).webAttempts.length, 1);
    throw new Error('MOCK_DNS_FAILURE');
  }, { get: async () => assert.fail('DNS失败不得调用GET') });
  try {
    const permit = makePermit(); await assert.rejects(service().read(store.web, permit, signal, clock));
    assert.deepEqual(store.events(permit.runId).filter(e => e.type === 'web_read_phase').map(e => JSON.parse(e.details!).phase), ['dns_started', 'failed']);
    assert.equal(store.web.calls()[0]!.status, 'failed');
    session.close(); store.close(); session = openIntegratedAcceptance(ledgerRoot, profile, true); store = new SqliteStore(path); store.recoverInterrupted(clock().toISOString());
    await assert.rejects(service().read(store.web, makePermit(), signal, clock), /最多一次/);
    assert.equal(dns, 1); assert.equal(session.budget.ledger.webAttempts.length, 1); assert.equal(session.budget.ledger.attempts.length, 0);
  } finally { session.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('DNS阶段审计持久化失败时保守停止，不能先联网再补审计', async t => {
  const root = mkdtempSync(join(tmpdir(), 'web-phase-fault-')), store = new SqliteStore(join(root, 'app.db'));
  let dns = 0;
  t.mock.method(store.web, 'phase', () => { throw new Error('模拟SQLite审计失败'); });
  const service = new WebReadService([resource], async () => { dns++; return [{ address: '8.8.8.8', family: 4 }]; });
  const run = store.beginRun(null, new Date().toISOString());
  try {
    await assert.rejects(service.read(store.web, { id: webHash(run.id), runId: run.id, owner: 'fake', channel: 'console', resourceId: resource.id,
      catalogHash: resource.hash, expires: Date.now() + 300000 }, new AbortController().signal, () => new Date()));
    assert.equal(dns, 0); assert.equal(store.web.calls()[0]!.status, 'failed');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
