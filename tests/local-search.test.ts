import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import childProcess from 'node:child_process';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { approveLocalFiles, LocalFileService } from '../src/local-file-service.js';
import { localFileTools } from '../src/local-file-tools.js';
import { skillFixture, reply, toolCall } from './helpers/skills-fixture.js';

function fixture(content = 'Agent literal.*\nsecond Agent line') {
  const root = mkdtempSync(join(tmpdir(), 'local-search-')); mkdirSync(join(root, 'notes'));
  writeFileSync(join(root, 'notes/a.md'), content); writeFileSync(join(root, 'notes/b.txt'), 'other text');
  writeFileSync(join(root, 'notes/unapproved.md'), 'HIDDEN_BODY'); approveLocalFiles(root, ['notes/a.md','notes/b.txt']);
  let text = '本次允许搜索资料目录：notes'; const audit: string[] = [];
  const tools = localFileTools(new LocalFileService(root), () => text, d => audit.push(d), true);
  const ctx = { cwd: tmpdir() } as Parameters<typeof tools.find.execute>[4];
  return { root, tools, ctx, audit, set: (s: string) => { text = s; tools.reset(); } };
}

test('原生find注入glob和宿主字面grep无子进程/网络；只搜索批准集合且有行号', async t => {
  const f = fixture(); let forbidden = 0;
  t.mock.method(childProcess, 'spawn', () => { forbidden++; throw new Error('spawn forbidden'); });
  t.mock.method(https, 'get', () => { forbidden++; throw new Error('https forbidden'); });
  t.mock.method(https, 'request', () => { forbidden++; throw new Error('https forbidden'); });
  syncBuiltinESMExports();
  try {
    const found = JSON.stringify(await f.tools.find.execute('find', { path: 'notes', pattern: '*.md' }, undefined, undefined, f.ctx));
    assert.ok(found.includes('a.md')); assert.ok(!found.includes('unapproved')); assert.ok(!found.includes('b.txt'));
    const got = JSON.stringify(await f.tools.grep.execute('grep', { path: 'notes', pattern: 'literal.*' }, undefined, undefined, f.ctx));
    assert.ok(got.includes('notes/a.md:1:')); assert.ok(got.includes('literal.*')); assert.ok(got.includes('UNTRUSTED_LOCAL_SEARCH'));
    assert.ok(!JSON.stringify(await f.tools.grep.execute('none', { path: 'notes', pattern: 'literal.+' }, undefined, undefined, f.ctx)).includes('notes/a.md:'));
    assert.equal(forbidden, 0); assert.ok(f.audit.every(d => !d.includes('second Agent line') && !d.includes('HIDDEN_BODY')));
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('搜索授权独立于read/ls，越界/引用/否定/假设/错误目录和复杂glob均拒绝', async () => {
  const f = fixture();
  for (const text of ['你好','本次允许列出资料目录：notes','本次允许读取资料文件：notes/a.md','“本次允许搜索资料目录：notes”','假设本次允许搜索资料目录：notes','不要搜索资料目录notes']) {
    f.set(text); assert.ok(!JSON.stringify(await f.tools.grep.execute('no', { path: 'notes', pattern: 'Agent' }, undefined, undefined, f.ctx)).includes('notes/a.md:'));
  }
  f.set('本次允许搜索资料目录：notes');
  for (const path of ['.', '../', f.root, 'notes/../notes']) assert.ok(JSON.stringify(await f.tools.find.execute('no', { path, pattern: '*.md' }, undefined, undefined, f.ctx)).includes('拒绝'));
  f.set('本次允许搜索资料目录：notes');
  assert.ok(JSON.stringify(await f.tools.find.execute('glob', { path: 'notes', pattern: '{a,b}.*' }, undefined, undefined, f.ctx)).includes('invalid_glob'));
  assert.ok(JSON.stringify(await f.tools.read.execute('read', { path: 'notes/a.md' }, undefined, undefined, f.ctx)).includes('current_user_authorization_required'));
});

test('搜索Hash/硬链接、结果/片段/调用/取消限制，与read/ls共用额度', async () => {
  const f = fixture('x'.repeat(3000) + 'Agent\nAgent\nAgent');
  const result = JSON.stringify(await f.tools.grep.execute('limited', { path: 'notes', pattern: 'Agent', limit: 1 }, undefined, undefined, f.ctx));
  assert.ok(result.includes('达到上限')); assert.ok(Buffer.byteLength(result) < 1600);
  await f.tools.find.execute('2', { path: 'notes', pattern: '*' }, undefined, undefined, f.ctx);
  await f.tools.ls.execute('3', { path: 'notes' }, undefined, undefined, f.ctx);
  await f.tools.read.execute('4', { path: 'notes/a.md' }, undefined, undefined, f.ctx);
  assert.ok(JSON.stringify(await f.tools.grep.execute('5', { path: 'notes', pattern: 'Agent' }, undefined, undefined, f.ctx)).includes('turn_call_limit'));
  f.set('本次允许搜索资料目录：notes'); writeFileSync(join(f.root, 'notes/a.md'), 'changed');
  assert.ok(JSON.stringify(await f.tools.find.execute('changed', { path: 'notes', pattern: '*.md' }, undefined, undefined, f.ctx)).includes('snapshot_changed'));
  const linked = fixture(); linkSync(join(linked.root, 'notes/a.md'), join(linked.root, 'another.md'));
  assert.ok(JSON.stringify(await linked.tools.grep.execute('link', { path: 'notes', pattern: 'Agent' }, undefined, undefined, f.ctx)).includes('hardlink'));
  const abort = new AbortController(); abort.abort(); await assert.rejects(linked.tools.grep.execute('abort', { pattern: 'Agent' }, abort.signal, undefined, linked.ctx));
});

test('真实Pi/SQLite：搜索工具仅前台显式开启、结果进入后续请求；后台无工具', async () => {
  let call = 0;
  const f = await skillFixture(payload => {
    if (JSON.stringify(payload.messages[0]).includes('有界纯文本片段')) { assert.deepEqual(payload.tools ?? [], []); return reply('后台纯文本'); }
    const names = payload.tools?.map(t => t.function.name) ?? []; assert.ok(names.includes('find') && names.includes('grep')); assert.ok(!names.includes('write') && !names.includes('edit'));
    if (++call === 1) return toolCall('grep', { path: 'notes', pattern: 'Agent' });
    assert.ok(JSON.stringify(payload).includes('notes/a.md:1:Agent')); return reply('有证据的搜索结果');
  }, false);
  try {
    const docs = join(f.root, 'docs'); mkdirSync(join(docs,'notes'), { recursive: true }); writeFileSync(join(docs,'notes/a.md'), 'Agent正文'); approveLocalFiles(docs,['notes/a.md']);
    f.config.localFiles = { enabled: true, workspace: docs, searchEnabled: true }; await f.restart();
    assert.equal((await f.chat('本次允许搜索资料目录：notes\n任务：找Agent')).text, '有证据的搜索结果');
    await f.executor.execute({ scope: 'goal', prompt: '后台', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } }); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
