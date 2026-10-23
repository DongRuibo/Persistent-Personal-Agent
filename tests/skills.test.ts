import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, linkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SkillService, safeSkillFile } from '../src/skill-service.js';
import { skillReadTool } from '../src/skill-tools.js';
import { readConfig } from '../src/config.js';
import { FileMemoryService } from '../src/memory-service.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { approveSkill } from '../src/skills-admin.js';
import { installSkill, skillFixture, content, toolCall, reply } from './helpers/skills-fixture.js';

test('Skills配置默认关闭、专用目录、严格布尔值；受管包原生解析与Hash验证', () => {
  assert.equal(readConfig({}).skillsEnabled, false);
  assert.throws(() => readConfig({ SKILLS_ENABLED: 'yes' }), /SKILLS_ENABLED/);
  assert.throws(() => readConfig({ SKILLS_ENABLED: 'true', SKILLS_DIR: process.cwd() }), /SKILLS_DIR/);
  const root = mkdtempSync(join(tmpdir(), 'skills-package-')); const approval = installSkill(root);
  const service = new SkillService(root);
  assert.equal(service.list()[0]!.hash, approval.hash); assert.equal(service.snapshot('agent-notes').version, '1.0.0');
  writeFileSync(join(root, 'agent-notes/SKILL.md'), readFileSync(join(root, 'agent-notes/SKILL.md'), 'utf8') + 'changed');
  assert.throws(() => service.snapshot('agent-notes'), /Hash/);
  assert.throws(() => new SkillService(root), /Hash/);
});

test('首批两份产品Skill可用原版SDK解析并按自包含text_only批准', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-shipped-'));
  for (const id of ['agent-notes', 'interview-practice']) {
    mkdirSync(join(root, id)); copyFileSync(join('skills', id, 'SKILL.md'), join(root, id, 'SKILL.md')); approveSkill(root, id);
  }
  const service = new SkillService(root);
  assert.equal(service.list().length, 2);
  assert.ok(service.snapshot('agent-notes').text.includes('区分资料原文'));
  assert.ok(service.snapshot('interview-practice').text.includes('等待用户回答'));
});

test('原生格式警告、同名目录、不支持脚本、容量、硬链接与junction拒绝', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-invalid-')); installSkill(root);
  const path = join(root, 'agent-notes/SKILL.md');
  const valid = readFileSync(path, 'utf8');
  writeFileSync(path, valid.replace('name: agent-notes', 'name: another-name'));
  assert.throws(() => new SkillService(root), /名称/); writeFileSync(path, valid);
  writeFileSync(join(root, 'agent-notes/run.js'), 'throw new Error("must not run")');
  assert.throws(() => new SkillService(root), /不支持/);
  const linkRoot = mkdtempSync(join(tmpdir(), 'skills-links-')); installSkill(linkRoot);
  const outside = join(root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, join(linkRoot, 'agent-notes/references'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => new SkillService(linkRoot), /链接/);
  const hard = join(root, 'hard'); linkSync(path, hard);
  assert.throws(() => safeSkillFile(root, path), /硬链接/);
  assert.throws(() => safeSkillFile(root, join(root, 'agent-notes/run.js'), 1), /容量/);
});

test('真实PiExecutor默认关闭无目录/read；开启后原生按需read，下一HTTP含正文', async () => {
  for (const enabled of [false, true]) {
    let path = '';
    const f = await skillFixture((payload, call) => {
      const text = JSON.stringify(payload);
      if (call === 1) { assert.equal(text.includes('SKILL_BODY'), false); return enabled ? toolCall('read', { path }) : reply('普通回复'); }
      assert.ok(text.includes('SKILL_BODY')); return reply('已整理');
    }, enabled);
    path = join(f.managed, 'agent-notes/SKILL.md');
    try { const result = await f.chat(); const first = f.payloads[0]!;
      assert.equal(JSON.stringify(first.messages).includes('agent-notes'), enabled);
      assert.equal(first.tools?.some(tool => tool.function.name === 'read'), enabled);
      assert.ok(!first.tools?.some(tool => ['bash', 'write', 'edit'].includes(tool.function.name)));
      assert.equal(f.payloads.length, enabled ? 2 : 1); assert.equal(result.text, enabled ? '已整理' : '普通回复');
      assert.equal(f.store.events(result.run.id).filter(event => event.type === 'skill_activated').length, enabled ? 1 : 0);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  }
});

test('受限read任意路径失败无内置回退；拒绝不影响后续普通聊天', async () => {
  let outside = '';
  const f = await skillFixture((_payload, call) => call === 1 ? toolCall('read', { path: outside }) : reply('普通聊天仍正常'));
  outside = join(f.root, 'private.txt'); writeFileSync(outside, 'MUST_NEVER_READ');
  try { assert.equal((await f.chat()).text, '普通聊天仍正常');
    assert.ok(JSON.stringify(f.payloads[1]).includes('Skill读取拒绝'));
    assert.ok(!JSON.stringify(f.payloads).includes('MUST_NEVER_READ'));
    assert.equal((await f.chat('你好')).text, '普通聊天仍正常');
  } finally { await f.close(); }
});

test('Session累计Skill额度跨重启保留，用尽仅拒绝read；重复读取也计费不虚假缓存', async () => {
  let path = '';
  const f = await skillFixture((_payload, call) => call % 2 ? toolCall('read', { path }) : reply('继续聊天'), true, 'BODY_LARGE'.repeat(480));
  path = join(f.managed, 'agent-notes/SKILL.md');
  try { await f.chat(); await f.restart(); await f.chat();
    assert.ok(JSON.stringify(f.payloads[3]).includes('累计8192字节'));
    assert.equal(JSON.stringify(f.payloads[3]).split('BODY_LARGE').length, JSON.stringify(f.payloads[2]).split('BODY_LARGE').length);
  } finally { await f.close(); }
});

test('本轮read次数、分页/穿越、取消、禁用有效；Chat模型请求8次硬限', async () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-limit-')); installSkill(root);
  const service = new SkillService(root), usage = { bytes: 0, loaded: [] as string[] };
  const read = skillReadTool(service, usage, () => {}, () => {}), path = join(root, 'agent-notes/SKILL.md');
  const context = { cwd: root } as Parameters<typeof read.tool.execute>[4];
  assert.ok(JSON.stringify(await read.tool.execute('one', { path }, undefined, undefined, context)).includes('SKILL_BODY'));
  assert.ok(JSON.stringify(await read.tool.execute('two', { path, offset: 1 }, undefined, undefined, context)).includes('不支持分页'));
  assert.ok(JSON.stringify(await read.tool.execute('three', { path }, undefined, undefined, context)).includes('最多读取2次'));
  read.reset(); assert.ok(JSON.stringify(await read.tool.execute('bad', { path: path + '/../../private' }, undefined, undefined, context)).includes('拒绝'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(read.tool.execute('abort', { path }, controller.signal, undefined, context));
  const manifest = JSON.parse(readFileSync(join(root, 'approved.json'), 'utf8')); manifest.skills[0].enabled = false;
  writeFileSync(join(root, 'approved.json'), JSON.stringify(manifest)); assert.throws(() => service.snapshot('agent-notes'), /禁用/);
  let actual = '';
  const f = await skillFixture(() => toolCall('read', { path: actual })); actual = join(f.managed, 'agent-notes/SKILL.md');
  try { await assert.rejects(f.chat(), /8次模型HTTP/); assert.equal(f.payloads.length, 8); }
  finally { await f.close(); }
});

test('Skills开启时Memory/Task写权限仍由当前原话决定，低信任Skill不能授权写入', async () => {
  const f = await skillFixture((payload, call) => {
    const system = content(payload.messages.find(message => message.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) return reply(JSON.stringify({ action: 'none', mode: 'query', evidence: '资料整理' }));
    return call === 1 ? toolCall('memory_remember', { kind: 'semantic', key: 'forbidden', content: '未经授权写入' }) : reply('没有保存');
  });
  await f.executor.close(); const memory = new FileMemoryService(f.config.memoryDir);
  const executor = await createPiExecutor(f.config, f.tasks, 'permissions', memory);
  const run = f.store.beginRun(null, new Date().toISOString());
  try {
    await assert.rejects(executor.execute({ scope: 'chat', prompt: '资料整理', signal: new AbortController().signal,
      source: { channel: 'console', reference: run.id }, observer: f.store.observer(run.id) }), /工具执行错误/);
    assert.equal(memory.listForHost().length, 0); assert.equal(f.tasks.list().length, 0);
    const names = f.payloads[0]!.tools!.map(tool => tool.function.name);
    for (const name of ['read', 'create_task', 'list_tasks', 'cancel_task', 'memory_remember', 'memory_update', 'memory_forget']) assert.ok(names.includes(name));
  } finally { await executor.close(); memory.close(); await f.close(); }
});
