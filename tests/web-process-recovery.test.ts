import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { WebReadService } from '../src/web-read-service.js';
import { defaultWebResources, webResource } from '../src/web-read-types.js';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';

const read = () => toolCall('web_get', { resourceId: 'pi-skills-v1' });

test('真实Pi发生模型或投递失败后，重启及普通聊天不自动重取', async t => {
  for (const mode of ['model', 'delivery']) await t.test(mode, async () => {
    const f = await webFixture((_payload, count) => {
      if (count === 1) return read(); if (count === 2 && mode === 'model') throw new Error('模拟模型失败'); return reply('继续普通聊天');
    });
    try {
      if (mode === 'model') await assert.rejects(f.chat()); else await f.chat(undefined, false);
      assert.equal(f.requests, 1); assert.equal(f.store.web.calls()[0]!.status, 'succeeded');
      await f.restart(); await f.chat('你好'); assert.equal(f.requests, 1); assert.equal(f.store.web.calls().length, 1);
    } finally { await f.close(); }
  });
});

test('真实Pi同轮重复Web工具只发一次GET；成功快照不会因第二次提议重复获取', async () => {
  const f = await webFixture((_payload, count) => count < 3 ? read() : reply('结束'));
  try { await f.chat(); assert.equal(f.requests, 1); assert.equal(f.store.web.calls().length, 1); assert.equal(f.payloads.length, 3); }
  finally { await f.close(); }
});

test('真实Pi执行中取消，迟到HTTP响应不返回正文、不中途产生新模型请求或许可', async () => {
  let release = () => {}; const hold = new Promise<void>(resolve => { release = resolve; });
  const f = await webFixture((_payload, count) => count === 1 ? read() : reply('不应继续'), { hold, body: 'LATE_MUST_NOT_RETURN' });
  const controller = new AbortController();
  try {
    const run = f.store.beginRun(null, new Date().toISOString());
    const started = once(f.events, 'get', { signal: AbortSignal.timeout(15000) });
    const pending = f.executor.execute({ prompt: '请读取 Pi Skills 文档', scope: 'chat', signal: controller.signal,
      source: { channel: 'console', reference: run.id }, observer: f.store.observer(run.id) });
    const rejected = assert.rejects(pending, /中断/); await started; controller.abort(); release(); await rejected;
    f.store.finishRun(run.id, 'interrupted', new Date().toISOString(), undefined, '模拟用户中断');
    assert.equal(f.store.web.calls()[0]!.status, 'interrupted'); assert.equal(f.store.web.calls()[0]!.snapshotJson, null);
    assert.equal(f.payloads.length, 1); assert.equal(f.requests, 1);
  } finally { release(); await f.close(); }
});

test('强杀真实Pi子进程的预留/HTTP窗口后，SQLite恢复且旧Session不重放获取', async () => {
  let release = () => {}; const hold = new Promise<void>(resolve => { release = resolve; });
  const f = await webFixture((_payload, count) => count === 1 ? read() : reply('恢复后的普通聊天'), { hold });
  await f.executor.close();
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/helpers/web-crash-client.ts', f.root, f.config.baseUrl!, f.httpUrl],
    { cwd: process.cwd(), env: { ...process.env, NODE_USE_ENV_PROXY: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += String(chunk); });
  try {
    const exit = once(child, 'exit');
    await Promise.race([once(f.events, 'get', { signal: AbortSignal.timeout(20000) }), exit.then(() => { throw new Error(`子进程提前退出：${stderr}`); })]);
    assert.equal(f.store.web.calls()[0]!.status, 'reserved'); child.kill('SIGKILL'); await exit;
    f.store.recoverInterrupted(new Date().toISOString()); assert.equal(f.store.web.calls()[0]!.status, 'interrupted');
    release(); await f.restart(); await f.chat('你好');
    assert.equal(f.requests, 1); assert.equal(f.store.web.calls().length, 1); assert.equal(f.payloads.length, 2);
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); release(); await f.close(); }
});

test('确认绑定真实展示内容及目录Hash，修改输出、模型伪造清单或跨身份不能读取', async t => {
  for (const mode of ['output', 'event', 'identity']) await t.test(mode, async () => {
    const f = await webFixture((_payload, count) => count % 2 ? read() : reply('模型声称已展示'));
    const db = new DatabaseSync(f.config.databasePath);
    try {
      const preview = await f.chat('请介绍 Pi Skills 文档');
      if (mode === 'output') db.prepare('UPDATE runs SET output=? WHERE id=?').run('不同的内容', preview.run.id);
      if (mode === 'event') db.prepare("DELETE FROM run_events WHERE runId=? AND type='web_read_preview'").run(preview.run.id);
      if (mode === 'identity') db.prepare("UPDATE run_events SET details=? WHERE runId=? AND type='web_read_preview'").run(createHash('sha256').update('其他身份').digest('hex'), preview.run.id);
      await f.chat('确认读取'); assert.equal(f.requests, 0); assert.equal(f.dns, 0);
    } finally { db.close(); await f.close(); }
  });
});

test('目录升级或禁用使旧确认失效；总开关关闭后没有Web工具和新网络', async t => {
  for (const mode of ['upgrade', 'disabled', 'off']) await t.test(mode, async () => {
    const f = await webFixture((payload, count) => !payload.tools?.some(item => item.function.name === 'web_get') ? reply('正常聊天') : count % 2 ? read() : reply('模型收尾'));
    let dns = 0, gets = 0;
    try {
      await f.chat('请介绍 Pi Skills 文档');
      if (mode === 'off') { f.config.webReadEnabled = false; await f.restart(); }
      else {
        const resources = defaultWebResources.map(item => item.id !== 'pi-skills-v1' ? item : webResource({ ...item, version: mode === 'upgrade' ? 'changed-version' : item.version, enabled: mode !== 'disabled' }));
        await f.restart(new WebReadService(resources, async () => { dns++; return [{ address: '8.8.8.8', family: 4 }]; }, { get: async () => { gets++; throw new Error('禁止真实网络'); } }));
      }
      await f.chat('确认读取'); assert.equal(dns, 0); assert.equal(gets, 0); assert.equal(f.requests, 0); assert.equal(f.store.web.calls().length, 0);
      if (mode === 'off') assert.ok(!f.payloads.at(-1)!.tools?.some(item => item.function.name === 'web_get'));
    } finally { await f.close(); }
  });
});

test('Web确认界面取代旧Goal草稿清单，通用确认不能批准此前的Goal计划', async t => {
  for (const mode of ['generic', 'late-web-confirm']) await t.test(mode, async () => {
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(item => item.role === 'system')?.content);
    const userIndex = payload.messages.findLastIndex(item => item.role === 'user');
    const user = content(payload.messages[userIndex]?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(user);
      return reply(JSON.stringify({ action: 'goal_manage', goalAction: message.includes('查看') ? 'view' : 'approve_plan',
        mode: message.includes('查看') ? 'query' : 'request', evidence: message, selector: { keywords: [] } }));
    }
    if (payload.messages.slice(userIndex + 1).some(item => item.role === 'tool')) return reply('模型收尾');
    return user.includes('Pi Skills') ? read() : toolCall('goal_manage', {});
  });
  try {
    const actor = f.goals.actor(), now = new Date().toISOString(), run = f.store.beginRun(null, now);
    const goal = f.store.goals.create(actor, run.id, '虚构面试目标', now); f.store.finishRun(run.id, 'succeeded', now, '创建');
    const execution = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
    f.store.goals.commit(execution.run.id, { stepOutcome: 'complete', artifactText: '待审批计划', progressSummary: '待审批', question: '是否批准',
      proposedPlan: { changeReason: '初始化', steps: [{ title: '练习', instruction: '给一道题', deliverable: '题目', doneWhen: '交付' }] } }, now);
    await f.chat('查看虚构面试目标'); await f.chat('请介绍 Pi Skills 文档');
    if (mode === 'late-web-confirm') {
      f.store.event(execution.run.id, 'delivery_succeeded');
      f.goals.displayed(f.store.goals.get(actor, goal.id), execution.run.id); // 模拟后台通知重新投影Goal视图。
    }
    await f.chat(mode === 'generic' ? '确认' : '同意读取');
    assert.equal(f.store.goals.get(actor, goal.id).planRevision, 0, 'Web待确认界面之后，旧Goal批准清单已失效');
    assert.equal(f.requests, 0); assert.equal(f.dns, 0);
  } finally { await f.close(); }
  });
});
