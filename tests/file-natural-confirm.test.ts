import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FileOutputService, initializeOutput } from '../src/file-output-service.js';
import { OperationGuard, type DialogueReferences } from '../src/operation-guard.js';
import { reply, skillFixture, toolCall } from './helpers/skills-fixture.js';

async function fixture() {
  let call = 0, kind = 'write', path = 'summary.md';
  const f = await skillFixture(() => ++call === 1 ? toolCall(kind, kind === 'write'
    ? { path, content: '用户负责确认。\n' }
    : { path, edits: [{ oldText: '用户负责确认。', newText: '当前用户明确确认后宿主才提交。' }] }) : reply('模型口头解释'), false);
  const output = join(f.root, 'output'); initializeOutput(output); f.config.localOutput = { enabled: true, workspace: output }; await f.restart();
  return { ...f, output,
    async propose(nextKind = 'write', nextPath = 'summary.md', delivered = true) {
      kind = nextKind; path = nextPath; call = 0;
      const result = await f.chat(`本次允许${kind === 'write' ? '创建' : '编辑'}输出文件：${path}`);
      if (delivered) f.store.event(result.run.id, 'delivery_succeeded');
      const m = /确认文件操作 ([a-f0-9-]{36}) ([a-f0-9]{64})/u.exec(result.text)!;
      return { ...result, id: m[1]!, hash: m[2]!, command: m[0] };
    },
  };
}

test('自然确认创建与编辑：唯一有效预览、零模型请求、一次提交、跨重启与重复确认', async () => {
  const f = await fixture();
  try {
    const p = await f.propose(), before = f.payloads.length;
    const result = await f.chat('确认允许');
    assert.match(result.text, /文件操作已提交：write/);
    assert.match(p.text, /回复“确认允许”/);
    assert.equal(f.payloads.length, before);
    assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), '用户负责确认。\n');
    assert.equal(f.store.files.get(p.id).status, 'committed');
    const db = new DatabaseSync(f.config.databasePath, { readOnly: true });
    assert.equal(db.prepare('SELECT approvalHash FROM file_operations WHERE id=?').get(p.id)!.approvalHash, createHash('sha256').update('确认允许').digest('hex')); db.close();
    await f.restart(); assert.match((await f.chat('确认允许')).text, /拒绝/); assert.equal(f.payloads.length, before);
    const edit = await f.propose('edit'); const calls = f.payloads.length;
    assert.match((await f.chat('确认创建')).text, /拒绝/); assert.equal(f.store.files.get(edit.id).status, 'pending');
    await f.restart(); const done = await f.chat('按这个修改。');
    assert.match(done.text, /文件操作已提交：edit/); assert.equal(f.payloads.length, calls);
    assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), '当前用户明确确认后宿主才提交。\n');
    assert.equal(f.tasks.list().length, 0); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('自然确认仍要求完整成功投递、源Run状态、有效期及审批后文件Hash不变', async t => {
  for (const fault of ['undelivered', 'partial_preview', 'failed_source', 'expired', 'file_changed']) await t.test(fault, async () => {
    const f = await fixture();
    try {
      if (fault === 'file_changed') await f.chat((await f.propose()).command);
      const p = await f.propose(fault === 'file_changed' ? 'edit' : 'write', 'summary.md', fault !== 'undelivered');
      if (fault === 'partial_preview' || fault === 'failed_source') {
        const db = new DatabaseSync(f.config.databasePath);
        if (fault === 'partial_preview') db.prepare('UPDATE runs SET output=? WHERE id=?').run('只有部分预览', p.run.id);
        else db.prepare("UPDATE runs SET status='failed' WHERE id=?").run(p.run.id);
        db.close();
      }
      if (fault === 'expired') t.mock.method(f.tasks, 'now', () => new Date(Date.now() + 360000));
      if (fault === 'file_changed') writeFileSync(join(f.output, 'summary.md'), '外部修改必须保留');
      const calls = f.payloads.length; const result = await f.chat('确认保存');
      assert.match(result.text, /拒绝/); assert.equal(f.payloads.length, calls);
      if (fault === 'file_changed') assert.equal(readFileSync(join(f.output, 'summary.md'), 'utf8'), '外部修改必须保留');
      else assert.ok(!existsSync(join(f.output, 'summary.md')));
    } finally { t.mock.restoreAll(); await f.close(); }
  });
});

test('多项有效文件提议必须澄清，不能把短确认自动绑定最近一项；精确命令保留兼容', async () => {
  const f = await fixture();
  try {
    const first = await f.propose('write', 'one.md'), second = await f.propose('write', 'two.md');
    const calls = f.payloads.length; const result = await f.chat('确认允许');
    assert.match(result.text, /多个|歧义/); assert.equal(f.payloads.length, calls);
    assert.equal(f.store.files.get(first.id).status, 'pending'); assert.equal(f.store.files.get(second.id).status, 'pending');
    assert.ok(!existsSync(join(f.output, 'one.md')) && !existsSync(join(f.output, 'two.md')));
    await f.chat(first.command.replace('确认文件操作', '取消文件操作'));
    assert.match((await f.chat(second.command)).text, /已提交/); assert.equal(f.payloads.length, calls);
  } finally { await f.close(); }
});

test('引用、假设、否定、混合修改、错误具名与泛泛答应都不构成自然文件确认', async () => {
  for (const message of ['“确认允许”', '如果我说确认允许会怎样？', '不要保存', '确认允许，但把标题改掉', '确认创建other.md', '好的']) {
    const f = await fixture();
    try {
      const p = await f.propose(); await f.chat(message);
      assert.ok(!existsSync(join(f.output, 'summary.md')), message);
      assert.equal(f.store.files.get(p.id).status, 'pending', message);
    } finally { await f.close(); }
  }
});

test('歧义拒绝终止短确认引用，其他提议过期后重复同一句也不能自动选择剩余文件', async t => {
  const f = await fixture(); let now = Date.now();
  t.mock.method(f.tasks, 'now', () => new Date(now));
  try {
    const first = await f.propose('write', 'one.md'); now += 60000;
    const second = await f.propose('write', 'two.md');
    assert.match((await f.chat('确认允许')).text, /多个/);
    now += 250000; await f.restart(); await f.chat('确认允许');
    assert.equal(f.store.files.get(first.id).status, 'pending'); assert.equal(f.store.files.get(second.id).status, 'pending');
    assert.ok(!existsSync(join(f.output, 'one.md')) && !existsSync(join(f.output, 'two.md')));
  } finally { t.mock.restoreAll(); await f.close(); }
});

test('短确认不能跨身份、渠道、输出根或其他审批视图借权', async () => {
  const f = await fixture();
  try {
    const p = await f.propose(); const other = join(f.root, 'other-output'); initializeOutput(other);
    for (const fault of ['owner', 'channel', 'root', 'goal_view', 'choices_view']) {
      const state: DialogueReferences = { fileView: { id: p.id, hash: p.hash } };
      const run = f.store.beginRun(null, new Date().toISOString());
      if (fault === 'goal_view') state.goalView = { items: [], details: true, displayRunId: run.id, expires: Date.now() + 300000 };
      if (fault === 'choices_view') state.choices = { tool: 'cancel_task', ids: ['fixture-task'], expires: Date.now() + 300000 };
      const service = new FileOutputService(fault === 'root' ? other : f.output, f.store.files);
      const guard = new OperationGuard(f.tasks, undefined, async () => { throw new Error('不得调用意图模型'); }, state, () => {}, undefined,
        { service, owner: fault === 'owner' ? 'wrong-owner' : createHash('sha256').update('console').digest('hex') });
      let modelCalled = false;
      const action = () => guard.withRequest({ scope: 'chat', prompt: '确认允许', signal: new AbortController().signal,
        source: { channel: fault === 'channel' ? 'feishu' : 'console', reference: run.id }, observer: f.store.observer(run.id) },
      async () => { modelCalled = true; return { text: '模型口头解释' }; });
      const answer = fault === 'channel' ? await f.tasks.withTarget({ channel: 'feishu', appId: 'cli_fixture', chatId: 'oc_fixture', userOpenId: 'ou_fixture' }, action) : await action();
      f.store.finishRun(run.id, 'succeeded', new Date().toISOString(), answer.text);
      assert.match(answer.text, /拒绝|多个|歧义/); assert.equal(modelCalled, false);
      assert.ok(!existsSync(join(f.output, 'summary.md'))); assert.equal(f.store.files.get(p.id).status, 'pending');
      if (fault === 'choices_view') {
        const repeat = f.store.beginRun(null, new Date().toISOString());
        const result = await guard.withRequest({ scope: 'chat', prompt: '确认允许', signal: new AbortController().signal,
          source: { channel: 'console', reference: repeat.id }, observer: f.store.observer(repeat.id) }, async () => ({ text: '需要明确对象' }));
        f.store.finishRun(repeat.id, 'succeeded', new Date().toISOString(), result.text);
        assert.ok(!existsSync(join(f.output, 'summary.md')), '歧义拒绝后重复短确认不能自动改为批准文件');
        assert.equal(f.store.files.get(p.id).status, 'pending');
      }
    }
  } finally { await f.close(); }
});

test('其他用户请求结束短确认焦点，重启后不凭旧聊天或旧预览恢复授权', async () => {
  const f = await fixture();
  try {
    const p = await f.propose(); await f.chat('先讨论另一件事情。'); await f.restart(); await f.chat('确认允许');
    assert.equal(f.store.files.get(p.id).status, 'pending'); assert.ok(!existsSync(join(f.output, 'summary.md')));
  } finally { await f.close(); }
});
