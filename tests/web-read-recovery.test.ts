import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/sqlite-store.js';
import { WebReadService } from '../src/web-read-service.js';
import { defaultWebResources, webHash } from '../src/web-read-types.js';
import type { WebPermit } from '../src/web-read-types.js';

const initial = '2026-10-23T01:00:00.000Z', actor = { owner: 'fictional-owner', channel: JSON.stringify({ channel: 'console' }) };
const resource = defaultWebResources[0]!;
function fixture() {
  const path = join(mkdtempSync(join(tmpdir(), 'web-ledger-')), 'db.sqlite');
  let store = new SqliteStore(path), now = initial;
  return { path, get store() { return store; }, clock: () => new Date(now), advance(ms: number) { now = new Date(Date.parse(now) + ms).toISOString(); },
    permit(): WebPermit { const run = store.beginRun(null, now); return { ...actor, id: webHash(run.id), runId: run.id, resourceId: resource.id, catalogHash: resource.hash, expires: Date.parse(now) + 300000 }; },
    restart() { store.close(); store = new SqliteStore(path); store.recoverInterrupted(now); }, close() { store.close(); },
  };
}
const signal = () => new AbortController().signal;
const addresses = async () => [{ address: '8.8.8.8', family: 4 }];

test('SQLite先预留再联网，网络等待不持事务；并发重复许可不发GET，成功只复用冻结快照', async () => {
  const f = fixture(); let gets = 0, release = () => {}, entered = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const service = new WebReadService(defaultWebResources, addresses, { get: async () => { gets++; entered(); await waiting; return Buffer.from('冻结的虚构正文'); } });
  const permit = f.permit(), other = new SqliteStore(f.path);
  try {
    const result = service.read(f.store.web, permit, signal(), f.clock); await started;
    assert.equal(other.web.calls()[0]!.status, 'reserved');
    other.beginRun(null, initial); // 网络仍在等待，另一连接可立即提交。
    await assert.rejects(service.read(other.web, permit, signal(), f.clock), /已消费/);
    release(); const snapshot = await result; assert.equal(gets, 1);
    assert.deepEqual(await service.read(other.web, permit, signal(), f.clock), snapshot); assert.equal(gets, 1);
    assert.equal(other.web.calls().length, 1); assert.equal(other.web.calls()[0]!.reservedBytes, 32768);
  } finally { release(); other.close(); f.close(); }
});

test('UTC日20次/640KiB预留跨重启保留，失败不退款，次日才恢复新额度', async () => {
  const f = fixture(); let gets = 0, dns = 0;
  const service = new WebReadService(defaultWebResources, async () => { dns++; return addresses(); }, { get: async () => { gets++; throw new Error('虚构网络失败'); } });
  try {
    for (let i = 0; i < 20; i++) await assert.rejects(service.read(f.store.web, f.permit(), signal(), f.clock), /虚构网络失败/);
    f.restart(); await assert.rejects(service.read(f.store.web, f.permit(), signal(), f.clock), /20次/);
    assert.equal(gets, 20); assert.equal(dns, 20); assert.equal(f.store.web.calls().length, 20);
    assert.equal(f.store.web.calls().reduce((sum, row) => sum + Number(row.reservedBytes), 0), 655360);
    f.advance(86400000); await assert.rejects(service.read(f.store.web, f.permit(), signal(), f.clock), /虚构网络失败/); assert.equal(gets, 21);
  } finally { f.close(); }
});

test('预留后中断恢复幂等，不将未知结果变回可执行许可；同许可跨Run仍拒绝', async () => {
  const f = fixture(), permit = f.permit();
  try {
    f.store.web.reserve(permit, initial); f.restart(); f.store.recoverInterrupted(initial);
    assert.equal(f.store.web.calls()[0]!.status, 'interrupted'); assert.equal(f.store.getRun(permit.runId)!.status, 'interrupted');
    assert.throws(() => f.store.web.reserve(permit, initial), /Run无效/);
    const next = f.permit(); next.id = permit.id;
    assert.throws(() => f.store.web.reserve(next, initial), /已消费/); assert.equal(f.store.web.calls().length, 1);
  } finally { f.close(); }
});

test('宿主撤销、Run结束和过期时，迟到响应不提交正文或生成重取机会', async t => {
  for (const mode of ['interrupt', 'run-ended', 'expiry']) await t.test(mode, async () => {
    const f = fixture(), permit = f.permit(); let release = () => {}, entered = () => {}, gets = 0;
    const waiting = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
    const service = new WebReadService(defaultWebResources, addresses, { get: async () => { gets++; entered(); await waiting; return Buffer.from('LATE_BODY'); } });
    try {
      const pending = service.read(f.store.web, permit, signal(), f.clock); await started;
      if (mode === 'interrupt') f.store.web.interrupt(permit.runId, actor, initial);
      if (mode === 'run-ended') f.store.finishRun(permit.runId, 'failed', initial, undefined, '模拟停止');
      if (mode === 'expiry') f.advance(300001);
      release(); await assert.rejects(pending, /迟到|撤销/);
      assert.equal(f.store.web.calls()[0]!.status, 'interrupted'); assert.equal(f.store.web.calls()[0]!.snapshotJson, null);
      await assert.rejects(service.read(f.store.web, permit, signal(), f.clock)); assert.equal(gets, 1);
    } finally { release(); f.close(); }
  });
});

test('取消发生在DNS等待期间：保留消费记录，迟到DNS不能发HTTP', async () => {
  const f = fixture(), permit = f.permit(), controller = new AbortController(); let resolveDns: (value: Awaited<ReturnType<typeof addresses>>) => void = () => {}, gets = 0;
  const service = new WebReadService(defaultWebResources, () => new Promise(resolve => { resolveDns = resolve; }), { get: async () => { gets++; return Buffer.from('never'); } });
  try {
    const pending = service.read(f.store.web, permit, controller.signal, f.clock); controller.abort();
    await assert.rejects(pending); resolveDns(await addresses()); await new Promise<void>(done => setImmediate(done));
    assert.equal(gets, 0); assert.equal(f.store.web.calls()[0]!.status, 'interrupted');
    await assert.rejects(service.read(f.store.web, permit, signal(), f.clock), /已消费/);
  } finally { f.close(); }
});

test('事务预留失败零联网，结果提交失败不返回正文也不重取', async t => {
  for (const mode of ['reserve', 'finish']) await t.test(mode, async () => {
    const f = fixture(), db = new DatabaseSync(f.path), permit = f.permit(); let gets = 0;
    db.exec(mode === 'reserve' ? "CREATE TRIGGER fail_web BEFORE INSERT ON web_read_calls BEGIN SELECT RAISE(ABORT,'reserve_failure'); END;"
      : "CREATE TRIGGER fail_web BEFORE UPDATE ON web_read_calls WHEN NEW.status='succeeded' BEGIN SELECT RAISE(ABORT,'finish_failure'); END;");
    const service = new WebReadService(defaultWebResources, addresses, { get: async () => { gets++; return Buffer.from('MUST_NOT_RETURN'); } });
    try { await assert.rejects(service.read(f.store.web, permit, signal(), f.clock), /failure/);
      assert.equal(gets, mode === 'reserve' ? 0 : 1);
      if (mode === 'finish') { assert.equal(f.store.web.calls()[0]!.status, 'failed'); await assert.rejects(service.read(f.store.web, permit, signal(), f.clock), /已消费/); assert.equal(gets, 1); }
    } finally { db.close(); f.close(); }
  });
});

test('冻结快照损坏或来源Hash失配保守拒绝，不回退网络修复', async () => {
  const f = fixture(), db = new DatabaseSync(f.path), permit = f.permit(); let gets = 0;
  const service = new WebReadService(defaultWebResources, addresses, { get: async () => { gets++; return Buffer.from('正文'); } });
  try {
    await service.read(f.store.web, permit, signal(), f.clock);
    db.prepare("UPDATE web_read_calls SET snapshotJson=json_set(snapshotJson,'$.text','tampered')").run();
    await assert.rejects(service.read(f.store.web, permit, signal(), f.clock), /Hash/);
    await assert.rejects(service.read(f.store.web, { ...permit, catalogHash: 'a'.repeat(64) }, signal(), f.clock), /版本/);
    assert.equal(gets, 1);
  } finally { db.close(); f.close(); }
});

test('非法宿主时间与损坏的冻结元数据不能绕过许可/低信任标记', async () => {
  const f = fixture(), db = new DatabaseSync(f.path), permit = f.permit(); let gets = 0;
  const service = new WebReadService(defaultWebResources, addresses, { get: async () => { gets++; return Buffer.from('正文'); } });
  try {
    assert.throws(() => f.store.web.reserve(permit, 'bad-clock'), /时间/);
    await service.read(f.store.web, permit, signal(), f.clock);
    const original = JSON.parse(String(f.store.web.calls()[0]!.snapshotJson));
    for (const patch of [{ fetchedAt: 'bad-clock' }, { trust: 'trusted' }]) {
      db.prepare('UPDATE web_read_calls SET snapshotJson=?').run(JSON.stringify({ ...original, ...patch }));
      await assert.rejects(service.read(f.store.web, permit, signal(), f.clock), /损坏/);
    }
    assert.equal(gets, 1);
  } finally { db.close(); f.close(); }
});
