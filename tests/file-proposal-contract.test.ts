import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initializeOutput } from '../src/file-output-service.js';
import { content, reply, skillFixture, toolCall } from './helpers/skills-fixture.js';

const replay = JSON.parse(readFileSync(new URL('./fixtures/t3-file-text-preview.json', import.meta.url), 'utf8')) as {
  request: string; modelText: string; provenance: { modelTextSha256: string };
};
const missing = '宿主状态：本轮未登记待批准文件操作';

test('真实口头预览回放：未调用工具不能变为待批准操作；原文保留，状态收据跨重启，不追加纠错请求', async () => {
  assert.equal(createHash('sha256').update(replay.modelText).digest('hex'), replay.provenance.modelTextSha256);
  const f = await skillFixture((payload, call) => {
    if (call === 1) return reply(replay.modelText);
    assert.ok(JSON.stringify(payload.messages).includes(missing));
    return reply('未登记，仅为聊天草稿。');
  }, false);
  const output = join(f.root, 'output'); initializeOutput(output); f.config.localOutput = { enabled: true, workspace: output };
  try {
    await f.restart();
    const result = await f.chat(replay.request);
    assert.ok(result.text.startsWith(missing), result.text);
    assert.ok(result.text.includes(replay.modelText));
    assert.equal(f.payloads.length, 1);
    assert.ok(!existsSync(join(output, 'summary.md')));
    const db = new DatabaseSync(f.config.databasePath, { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM file_operations').get()!.n, 0); db.close();
    assert.ok(f.store.events(result.run.id).some(e => e.type === 'file_proposal_missing'));
    assert.equal(f.store.listRuns()[0]!.output, result.text);
    const sessionFile = readdirSync(f.config.sessionDir, { recursive: true }).map(String).find(p => p.endsWith('chat.session.jsonl'))!;
    const entries = readFileSync(join(f.config.sessionDir, sessionFile), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.ok(entries.some(e => e.message?.role === 'assistant' && content(e.message.content) === replay.modelText));
    const receipt = entries.find(e => e.customType === 'host-file-result-v1');
    assert.ok(receipt.content.includes(missing));
    assert.ok(!receipt.content.includes(replay.modelText));
    const invalid = await f.chat('确认文件操作 00000000-0000-0000-0000-000000000000 ' + '0'.repeat(64));
    assert.match(invalid.text, /拒绝/); assert.equal(f.payloads.length, 1);
    await f.restart(); await f.chat('当前是否已经有本轮可以确认的文件操作？');
    assert.equal(f.payloads.length, 2); assert.ok(!existsSync(join(output, 'summary.md')));
  } finally { await f.close(); }
});

test('真实Pi请求投影：整理Skill不改变批准包；不点名工具的创建请求可形成宿主提议，确认前无文件', async () => {
  const skillBody = readFileSync(new URL('../skills/agent-notes/SKILL.md', import.meta.url), 'utf8').split('---').slice(2).join('---');
  let managed = '';
  const f = await skillFixture((payload, call) => {
    const system = content(payload.messages[0]!.content);
    assert.ok(system.includes('文件提议与实际写入分为两个阶段'));
    assert.ok(system.includes('Skill整理与文件提议是独立阶段'));
    assert.ok(system.includes('不要求用户点名工具'));
    if (call === 1) return toolCall('read', { path: join(managed, 'agent-notes', 'SKILL.md') });
    if (call === 2) { assert.ok(JSON.stringify(payload.messages).includes('不调用Shell、网络或文件写入')); return reply('事实：宿主控制工具权限。'); }
    if (call === 3) { assert.ok(!replay.request.includes('write')); return toolCall('write', { path: 'summary.md', content: '# 虚构摘要\n用户负责确认。\n' }); }
    return reply('错误的原始模型回答：文件已经保存。');
  }, true, skillBody);
  managed = f.managed;
  const output = join(f.root, 'output'); initializeOutput(output); f.config.localOutput = { enabled: true, workspace: output };
  const skillFile = join(managed, 'agent-notes', 'SKILL.md'), approvals = join(managed, 'approved.json');
  const before = [readFileSync(skillFile, 'utf8'), readFileSync(approvals, 'utf8')];
  try {
    await f.restart(); await f.chat('请按agent-notes整理我提供的虚构资料：宿主控制工具权限。');
    const proposal = await f.chat(replay.request); f.store.event(proposal.run.id, 'delivery_succeeded');
    assert.match(proposal.text, /^待批准文件操作（未写入）/);
    assert.ok(!proposal.text.includes('错误的原始模型回答')); assert.ok(!existsSync(join(output, 'summary.md')));
    assert.ok(f.store.events(proposal.run.id).some(e => e.type === 'file_operation_proposed'));
    const confirmation = /确认文件操作 [a-f0-9-]{36} [a-f0-9]{64}/u.exec(proposal.text)![0];
    const calls = f.payloads.length; const result = await f.chat(confirmation);
    assert.match(result.text, /文件操作已提交/); assert.equal(f.payloads.length, calls);
    assert.equal(readFileSync(join(output, 'summary.md'), 'utf8'), '# 虚构摘要\n用户负责确认。\n');
    assert.deepEqual([readFileSync(skillFile, 'utf8'), readFileSync(approvals, 'utf8')], before);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test('未形成提议时保留必要澄清；单纯聊天草稿不被登记，关闭开关不投影文件流程', async () => {
  const clarification = '请先提供需要保存的正文。';
  const f = await skillFixture(() => reply(clarification), false);
  try {
    const plain = await f.chat('仅讨论如何整理摘要，不创建文件。');
    assert.equal(plain.text, clarification);
    assert.ok(!content(f.payloads[0]!.messages[0]!.content).includes('文件提议与实际写入分为两个阶段'));
    assert.ok(!f.payloads[0]!.tools!.some(t => t.function.name === 'write'));
    const output = join(f.root, 'output'); initializeOutput(output); f.config.localOutput = { enabled: true, workspace: output }; await f.restart();
    const answer = await f.chat('本次允许编辑输出文件：summary.md');
    assert.ok(answer.text.startsWith(missing)); assert.ok(answer.text.includes(clarification));
    assert.equal(f.payloads.length, 2); assert.ok(!existsSync(join(output, 'summary.md')));
    const ordinary = await f.chat('只在聊天里展示一个文字草稿，不登记文件操作。');
    assert.equal(ordinary.text, clarification);
    assert.ok(!f.store.events(ordinary.run.id).some(e => e.type === 'file_proposal_missing'));
  } finally { await f.close(); }
});
