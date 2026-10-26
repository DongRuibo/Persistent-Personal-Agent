import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, linkSync, renameSync, symlinkSync } from 'node:fs';
import { approveLocalFiles, LocalFileError, LocalFileService, localRelative } from '../src/local-file-service.js';
import { localFileTools } from '../src/local-file-tools.js';
import { readConfig } from '../src/config.js';

function fixture(body = 'ALLOWED_BODY\nsecond\nthird\n') {
  const root = mkdtempSync(join(tmpdir(), 'local-docs-'));
  mkdirSync(join(root, 'notes')); writeFileSync(join(root, 'notes/agent.md'), body);
  approveLocalFiles(root, ['notes/agent.md']); return { root, service: new LocalFileService(root) };
}

test('本地文件默认关闭，显式绝对副本目录且不与代码/数据/Skills重叠', () => {
  assert.equal(readConfig({}).localFiles?.enabled, false);
  for (const env of [{ LOCAL_FILES_ENABLED: 'yes' }, { LOCAL_FILES_ENABLED: 'true' },
    { LOCAL_FILES_ENABLED: 'true', LOCAL_FILES_WORKSPACE: '.' }, { LOCAL_FILES_ENABLED: 'true', LOCAL_FILES_WORKSPACE: process.cwd() }]) assert.throws(() => readConfig(env), /LOCAL_FILES/);
  const f = fixture(); assert.equal(readConfig({ LOCAL_FILES_ENABLED: 'true', LOCAL_FILES_WORKSPACE: f.root }).localFiles?.workspace, f.root);
  writeFileSync(join(f.root, '.git'), 'gitdir: offline-fixture');
  assert.throws(() => readConfig({ LOCAL_FILES_ENABLED: 'true', LOCAL_FILES_WORKSPACE: join(f.root, 'notes') }), /LOCAL_FILES/);
});

test('原生read/ls仅当前授权，目录只投影批准条目，分页遵守用户行范围，审计无正文', async () => {
  const f = fixture(); writeFileSync(join(f.root, 'unapproved.txt'), 'PRIVATE_UNAPPROVED');
  let text = '本次允许读取资料文件：notes/agent.md#L2-L2'; const audit: string[] = [];
  const tools = localFileTools(f.service, () => text, d => audit.push(d));
  const ctx = { cwd: tmpdir() } as Parameters<typeof tools.read.execute>[4];
  let result = JSON.stringify(await tools.read.execute('one', { path: 'notes/agent.md' }, undefined, undefined, ctx));
  assert.ok(result.includes('second')); assert.ok(!result.includes('ALLOWED_BODY')); assert.ok(result.includes('UNTRUSTED_LOCAL_FILE'));
  result = JSON.stringify(await tools.read.execute('range', { path: 'notes/agent.md', offset: 1 }, undefined, undefined, ctx)); assert.ok(result.includes('line_range_not_authorized'));
  tools.reset(); text = '本次允许列出资料目录：.';
  result = JSON.stringify(await tools.ls.execute('list', {}, undefined, undefined, ctx)); assert.ok(result.includes('notes/')); assert.ok(!result.includes('unapproved.txt')); assert.ok(!result.includes('approved-files.json'));
  tools.reset(); result = JSON.stringify(await tools.read.execute('no-read', { path: 'notes/agent.md' }, undefined, undefined, ctx)); assert.ok(!result.includes('ALLOWED_BODY'));
  assert.ok(audit.every(d => !d.includes('ALLOWED_BODY') && !d.includes('second'))); assert.equal(JSON.parse(audit[0]!).source, 'pi-1.3.0-native-read');
});

test('否定引用假设、越界、绝对路径、设备/ADS和敏感文件全部拒绝，不暴露正文', async () => {
  const f = fixture(), tools = localFileTools(f.service, () => message, () => {}); let message = '';
  const ctx = { cwd: f.root } as Parameters<typeof tools.read.execute>[4];
  for (const text of ['你好', '不要读取资料文件 notes/agent.md', '“本次允许读取资料文件：notes/agent.md”',
    '假设本次允许读取资料文件：notes/agent.md', '> 本次允许读取资料文件：notes/agent.md',
    '本次允许读取资料文件：notes/agent.md\n但不要读取资料']) {
    message = text; tools.reset(); const result = JSON.stringify(await tools.read.execute('no', { path: 'notes/agent.md' }, undefined, undefined, ctx)); assert.ok(!result.includes('ALLOWED_BODY'), text);
  }
  message = '本次允许读取资料文件：notes/agent.md';
  for (const path of ['../outside.txt', join(f.root, 'notes/agent.md'), 'C:notes/a.md', '//server/share/a.md', 'notes/../agent.md', 'notes/agent.md:stream', 'notes/.env', 'credentials.md', 'config.txt', 'NUL.txt', 'notes/agent.md.']) {
    tools.reset(); const result = JSON.stringify(await tools.read.execute('no', { path }, undefined, undefined, ctx)); assert.ok(result.includes('拒绝')); assert.ok(!result.includes('ALLOWED_BODY')); assert.throws(() => localRelative(path));
  }
});

test('使用时拒绝硬链接、junction/符号链接、替换及同ID内容改写；批准不可由模型更新', () => {
  const hard = fixture(); linkSync(join(hard.root, 'notes/agent.md'), join(hard.root, 'hard-copy.md')); assert.throws(() => hard.service.read('notes/agent.md'), /hardlink/);
  const changed = fixture(); writeFileSync(join(changed.root, 'notes/agent.md'), 'CHANGED_BODY\nsecond\nthird\n'); assert.throws(() => changed.service.read('notes/agent.md'), /snapshot_changed/);
  const replaced = fixture(); renameSync(join(replaced.root, 'notes/agent.md'), join(replaced.root, 'previous.md')); writeFileSync(join(replaced.root, 'notes/agent.md'), 'ALLOWED_BODY\nsecond\nthird\n'); assert.throws(() => replaced.service.read('notes/agent.md'), /snapshot_changed/);
  const swap = fixture(); swap.service.file('notes/agent.md');
  renameSync(join(swap.root, 'notes'), join(swap.root, 'original-notes'));
  const external = mkdtempSync(join(tmpdir(), 'external-docs-')); writeFileSync(join(external, 'agent.md'), 'OUTSIDE_BODY');
  symlinkSync(external, join(swap.root, 'notes'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => swap.service.read('notes/agent.md'), /link_not_allowed|directory_changed/);
  const manifest = fixture(); writeFileSync(join(manifest.root, 'approved-files.json'), '{}'); assert.throws(() => manifest.service.read('notes/agent.md'), /approval_changed/);
});

test('数量、容量、凭据正文、调用与响应额度有效，拒绝不破坏下一轮聊天，取消不返回正文', async () => {
  const f = fixture(), audit: string[] = []; let text = '本次允许读取资料文件：notes/agent.md';
  const tools = localFileTools(f.service, () => text, d => audit.push(d)), ctx = { cwd: f.root } as Parameters<typeof tools.read.execute>[4];
  for (let i = 0; i < 4; i++) await tools.read.execute(String(i), { path: 'notes/agent.md' }, undefined, undefined, ctx);
  assert.ok(JSON.stringify(await tools.read.execute('limit', { path: 'notes/agent.md' }, undefined, undefined, ctx)).includes('turn_call_limit'));
  tools.reset(); assert.ok(JSON.stringify(await tools.read.execute('next', { path: 'notes/agent.md' }, undefined, undefined, ctx)).includes('ALLOWED_BODY'));
  const big = fixture('x'.repeat(9000)), bigTools = localFileTools(big.service, () => text, () => {});
  assert.ok(JSON.stringify(await bigTools.read.execute('big', { path: 'notes/agent.md' }, undefined, undefined, ctx)).includes('response_byte_limit'));
  const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(tools.read.execute('abort', { path: 'notes/agent.md' }, cancelled.signal, undefined, ctx)); assert.equal(JSON.parse(audit.at(-1)!).reason, 'cancelled');
  for (const body of ['x'.repeat(32769), 'LLM_API_KEY=private-fixture-value', '-----BEGIN RSA PRIVATE KEY-----']) {
    const root = mkdtempSync(join(tmpdir(), 'unsafe-docs-')); writeFileSync(join(root, 'a.md'), body); assert.throws(() => approveLocalFiles(root, ['a.md']), /capacity|credential/);
  }
  text = '本次允许读取资料文件：a.md、b.md、c.md'; tools.reset(); assert.ok(JSON.stringify(await tools.read.execute('many', { path: 'notes/agent.md' }, undefined, undefined, ctx)).includes('authorization_capacity'));
  assert.ok(readFileSync(join(f.root, 'approved-files.json'), 'utf8').includes('identity'));
});

test('读取中取消不交付正文；原生ls期间出现链接也拒绝，累计返回字节含拒绝收据', async t => {
  const f = fixture(); let text = '本次允许读取资料文件：notes/agent.md'; const events: string[] = [];
  const tools = localFileTools(f.service, () => text, d => events.push(d)), ctx = { cwd: f.root } as Parameters<typeof tools.read.execute>[4];
  const abort = new AbortController(), original = f.service.read.bind(f.service);
  t.mock.method(f.service, 'read', (p: string, observed?: (bytes: number) => void) => { const data = original(p, observed); abort.abort(); return data; });
  await assert.rejects(tools.read.execute('cancel', { path: 'notes/agent.md' }, abort.signal, undefined, ctx));
  assert.equal(JSON.parse(events.at(-1)!).reason, 'cancelled'); assert.ok(JSON.parse(events.at(-1)!).bytes > 0);
  t.mock.restoreAll(); tools.reset(); text = '本次允许列出资料目录：notes';
  linkSync(join(f.root, 'notes/agent.md'), join(f.root, 'outside-link.md'));
  assert.ok(JSON.stringify(await tools.ls.execute('ls-link', { path: 'notes' }, undefined, undefined, ctx)).includes('file_type_or_hardlink'));
  tools.reset(); text = '你好'; events.length = 0;
  for (let i = 0; i < 240; i++) await tools.read.execute(String(i), { path: 'notes/agent.md' }, undefined, undefined, ctx);
  assert.ok(events.reduce((n, e) => n + JSON.parse(e).responseBytes, 0) <= 16384);
  const raced = fixture(), listing = localFileTools(raced.service, () => '本次允许列出资料目录：notes', () => {});
  t.mock.method(raced.service, 'file', () => { throw new LocalFileError('read_race'); });
  assert.ok(JSON.stringify(await listing.ls.execute('race', { path: 'notes' }, undefined, undefined, ctx)).includes('read_race'));
});
