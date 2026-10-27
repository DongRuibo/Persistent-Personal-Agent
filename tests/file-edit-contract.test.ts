import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeOutput } from '../src/file-output-service.js';
import { approveLocalFiles } from '../src/local-file-service.js';
import { content, reply, skillFixture, toolCall, type Payload } from './helpers/skills-fixture.js';

const replay = JSON.parse(readFileSync(new URL('./fixtures/t3-edit-clarification.json', import.meta.url), 'utf8')) as {
  request: string; rawModelText: string; provenance: { rawModelTextSha256: string };
};
const beforeText = '原文声明：用户负责确认。\n';
const afterText = '原文声明：只有当前用户明确确认后，宿主才可以提交文件。\n';

async function fixture(inspect?: (payload: Payload) => void, reads = false) {
  let mode = 'write', call = 0;
  const f = await skillFixture(payload => {
    if (++call > 1) return reply('模型收尾');
    if (mode === 'oral') return reply(replay.rawModelText);
    if (mode === 'read') return toolCall('read', { path: 'summary.md' });
    if (mode === 'edit') inspect?.(payload);
    return toolCall(mode, mode === 'write' ? { path: 'summary.md', content: beforeText }
      : { path: 'summary.md', edits: [{ oldText: '用户负责确认。', newText: '只有当前用户明确确认后，宿主才可以提交文件。' }] });
  }, false);
  const output = join(f.root, 'output'); initializeOutput(output); f.config.localOutput = { enabled: true, workspace: output };
  if (reads) {
    const docs = join(f.root, 'documents'); mkdirSync(docs); writeFileSync(join(docs, 'note.md'), '虚构资料副本');
    approveLocalFiles(docs, ['note.md']); f.config.localFiles = { enabled: true, workspace: docs };
  }
  await f.restart();
  return { ...f, output,
    async request(next: string, prompt: string) { mode = next; call = 0; return f.chat(prompt); },
    async create() {
      mode = 'write'; call = 0; const proposal = await f.chat('本次允许创建输出文件：summary.md');
      f.store.event(proposal.run.id, 'delivery_succeeded');
      const id = /操作ID：([a-f0-9-]{36})/u.exec(proposal.text)![1]!;
      assert.match((await f.chat('确认允许')).text, /已提交/); return id;
    },
  };
}

test('真实Pi请求可见编辑契约：旧审批过期不影响已提交文件，edit有受限内部读取且不借资料read', async () => {
  const f = await fixture(payload => {
    const system = content(payload.messages[0]!.content);
    const edit = JSON.stringify(payload.tools!.find(t => t.function.name === 'edit'));
    assert.ok(system.includes('旧审批过期不影响已提交文件'));
    assert.ok(system.includes('不需要额外授权资料read'));
    assert.ok(system.includes('未知原文'));
    assert.ok(edit.includes('受限内部读取'));
    assert.ok(edit.includes('旧审批过期不影响已提交文件'));
    assert.ok(!payload.tools!.some(t => t.function.name === 'read'));
  });
  try { await f.create(); assert.match((await f.request('edit', replay.request)).text, /^待批准文件操作（未写入）：edit/); }
  finally { await f.close(); }
});

test('已提交文件跨TTL及重启后仍可原生精确编辑：无read工具、确认前不改文件、新审批独立计时', async t => {
  const f = await fixture(); let now = Date.now(); t.mock.method(f.tasks, 'now', () => new Date(now));
  try {
    const id = await f.create(), original = f.store.files.get(id).proposal;
    now += 360000; assert.ok(original.expires < now); await f.restart();
    const proposal = await f.request('edit', replay.request); f.store.event(proposal.run.id, 'delivery_succeeded');
    assert.match(proposal.text, /^待批准文件操作（未写入）：edit/); assert.match(proposal.text, /\-原文声明：用户负责确认/);
    const editId = /操作ID：([a-f0-9-]{36})/u.exec(proposal.text)![1]!;
    assert.ok(f.store.files.get(editId).proposal.expires > now);
    assert.deepEqual(f.store.files.get(id), { proposal: original, status: 'committed' });
    assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), beforeText);
    assert.ok(!f.store.events(proposal.run.id).some(e => e.type === 'tool_execution_start' && e.details === 'read'));
    const calls = f.payloads.length; assert.match((await f.chat('确认允许')).text, /已提交：edit/);
    assert.equal(f.payloads.length, calls); assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), afterText);
    assert.deepEqual(f.errors, []);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('内部快照不扩大资料read权限：编辑授权不授权read，完整资料授权也不能读取输出目录', async () => {
  const f = await fixture(undefined, true);
  try {
    await f.create();
    for (const [prompt, reason] of [[replay.request, 'current_user_authorization_required'], ['本次允许读取资料文件：summary.md', 'file_not_approved']]) {
      const result = await f.request('read', prompt!);
      assert.ok(f.store.events(result.run.id).some(e => e.type === 'local_file_access' && e.details?.includes(reason!)));
      assert.ok(!f.store.events(result.run.id).some(e => e.type === 'file_operation_proposed'));
      assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), beforeText);
    }
  } finally { await f.close(); }
});

test('真实错误澄清回放：保留原文与未登记状态，不自动补read、edit或纠错模型请求', async () => {
  assert.equal(createHash('sha256').update(replay.rawModelText).digest('hex'), replay.provenance.rawModelTextSha256);
  const f = await fixture();
  try {
    const id = await f.create(), calls = f.payloads.length; const result = await f.request('oral', replay.request);
    assert.match(result.text, /^宿主状态：本轮未登记待批准文件操作/); assert.ok(result.text.includes(replay.rawModelText));
    assert.equal(f.payloads.length, calls + 1);
    assert.ok(!f.store.events(result.run.id).some(e => e.type === 'tool_execution_start'));
    assert.equal(f.store.files.get(id).status, 'committed'); assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), beforeText);
  } finally { await f.close(); }
});
