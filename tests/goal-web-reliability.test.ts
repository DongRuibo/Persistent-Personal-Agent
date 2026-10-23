import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { goalWebFixture } from './helpers/goal-web-fixture.js';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import { policyConsole } from '../src/goal-policy-console.js';
import { proposal } from './helpers/proactive-fixture.js';
import type { GoalPolicy } from '../src/goal-policy-types.js';
import { WebReadService } from '../src/web-read-service.js';
import { defaultWebResources } from '../src/web-read-types.js';

test('技术资料整理场景：原生自动选择agent-notes→受限read→明确Web读取→下一模型含方法和低信任来源', async () => {
  const f = await webFixture(payload => {
    const index = payload.messages.findLastIndex(m => m.role === 'user'), tools = payload.messages.slice(index + 1).filter(m => m.role === 'tool');
    if (!tools.length) return toolCall('read', { path: f.executor.skills!.list().find(s => s.id === 'agent-notes')!.filePath });
    if (tools.length === 1) {
      assert.ok(JSON.stringify(payload).includes('区分资料原文'));
      return toolCall('web_get', { resourceId: 'pi-skills-v1' });
    }
    const text = content(tools.at(-1)!.content);
    assert.ok(text.includes('UNTRUSTED_WEB_DATA_V1') && text.includes('MOCK_WEB_BODY'));
    return reply('事实：资料介绍原生加载。来源：本次固定快照。未知：真实模型质量尚未验证。');
  }, { productSkills: true });
  try {
    const result = await f.chat(); assert.match(result.text, /事实.*来源.*未知/);
    assert.equal(f.payloads.length, 3); assert.equal(f.requests, 1); assert.equal(f.dns, 1);
    assert.equal(f.memory.listForHost().length, 0); assert.equal(f.goals.list().length, 0); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

async function prepare(execute = false) {
  const f = await goalWebFixture(); await f.seed();
  await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步');
  await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第2步');
  await f.web.chat(execute ? '批准银杏计划并继续一段' : '批准银杏计划'); return f;
}
function policy(f: Awaited<ReturnType<typeof prepare>>, max = 2, daily = 5) {
  const spec = proposal(f.goal); spec.schedule = { kind: 'once', timeZone: 'Asia/Shanghai', at: new Date(f.web.tasks.now().getTime() + 1000).toISOString() };
  spec.limits.segmentsPerTrigger = max; spec.limits.dailyExecutions = daily; spec.limits.dailyModelCalls = daily;
  const result = policyConsole(f.web.store, f.web.goals.actor(), '/policy approve ' + JSON.stringify(spec), f.web.tasks.now().toISOString()) as GoalPolicy;
  f.web.advance(1001); return result;
}

test('有界主动场景：已绑定Skill/资料的策略执行，反馈或预算使后续Grant停止；通知失败只重投消息', async t => {
  for (const kind of ['feedback', 'budget', 'notification'] as const) await t.test(kind, async () => {
    const f = await prepare();
    try {
      if (kind !== 'feedback') f.result({ stepOutcome: 'complete', artifactText: 'ACTIVE_FROZEN_EXERCISE', progressSummary: '已完成', question: '等待下一步', needsUserFeedback: false });
      const p = policy(f, 2, kind === 'budget' ? 1 : 5);
      if (kind === 'notification') f.failNotification();
      await f.runner.tick(); const first = f.view.executions.at(-1)!.execution;
      assert.ok(first.input.web && first.input.skill); assert.equal(first.input.authorization.kind, 'policy');
      const count = f.calls; await f.runner.tick();
      if (kind === 'feedback' || kind === 'budget') assert.equal(f.calls, count);
      if (kind === 'budget') assert.equal(f.web.store.policies.get(f.web.goals.actor(), p.id).status, 'blocked');
      if (kind === 'notification') {
        const finalCount = f.calls; assert.equal(finalCount, 3, '初始化及两段，通知失败不增加模型调用');
        f.web.advance(60001); await f.restart(); await f.runner.tick(); assert.equal(f.calls, finalCount);
      }
      await f.restart(); await f.runner.tick();
      assert.equal(f.web.requests, 1); assert.equal(new Set(f.view.executions.map(e => e.execution.triggerRunId)).size, f.view.executions.length);
    } finally { await f.close(); }
  });
});

test('暂停/撤销与迟到结果竞争：冻结输入不变，Checkpoint不增长，恢复没有新有效授权', async t => {
  for (const kind of ['pause', 'revoke'] as const) await t.test(kind, async () => {
    const f = await prepare(), p = policy(f); let release = () => {};
    try {
      const oldCheckpoint = f.goal.checkpointRunId;
      f.hold(new Promise<void>(done => { release = done; })); const started = f.started(), running = f.runner.tick(); await started;
      if (kind === 'pause') { await f.web.chat('查看银杏进度'); await f.web.chat('暂停那个学习计划'); }
      else policyConsole(f.web.store, f.web.goals.actor(), '/policy revoke ' + JSON.stringify({ id: p.id, version: p.version }), f.web.tasks.now().toISOString());
      release(); await running; const calls = f.calls;
      assert.equal(f.goal.checkpointRunId, oldCheckpoint); assert.notEqual(f.view.executions.at(-1)!.execution.status, 'committed');
      await f.restart(); await f.runner.tick(); assert.equal(f.calls, calls); assert.equal(f.goal.checkpointRunId, oldCheckpoint); assert.equal(f.web.requests, 1);
    } finally { release(); await f.close(); }
  });
});

test('快照运行中损坏或SQLite聚合提交失败：原Checkpoint保留，失败不重取/不重复模型', async t => {
  for (const kind of ['snapshot', 'sqlite'] as const) await t.test(kind, async () => {
    const f = await prepare(true); let release = () => {}, db: DatabaseSync | undefined;
    try {
      const old = f.goal.checkpointRunId; db = new DatabaseSync(f.web.config.databasePath);
      f.hold(new Promise<void>(done => { release = done; })); const started = f.started(), running = f.runner.tick(); await started;
      if (kind === 'snapshot') db.exec("UPDATE web_read_calls SET snapshotJson=json_set(snapshotJson,'$.text','CORRUPTED')");
      else db.exec("CREATE TRIGGER fail_web_checkpoint BEFORE UPDATE ON goal_executions WHEN NEW.status='committed' AND NEW.planRevision>0 BEGIN SELECT RAISE(ABORT,'frozen fixture commit failure'); END");
      release(); await running;
      assert.equal(f.goal.status, 'blocked'); assert.equal(f.goal.checkpointRunId, old);
      const calls = f.calls; await f.restart(); await f.runner.tick(); assert.equal(f.calls, calls); assert.equal(f.web.requests, 1);
    } finally { release(); db?.close(); await f.close(); }
  });
});

test('Skill版本变化阻止Web绑定Goal降级执行', async () => {
  const f = await prepare(true);
  try {
    appendFileSync(join(f.web.config.skillsDir!, 'interview-practice', 'SKILL.md'), '\nHOST_VERSION_CHANGED\n');
    await f.runner.tick(); assert.equal(f.goal.status, 'blocked'); assert.equal(f.goal.blockedReason, 'skill_unavailable');
    assert.equal(f.calls, 1); assert.equal(f.web.requests, 1); assert.equal(f.view.executions.length, 1);
  } finally { await f.close(); }
});

test('Web失败不能绑定不存在的资料；绑定草稿变化使旧审批视图失效，不跨模块借确认', async () => {
  const f = await goalWebFixture();
  try {
    await f.restart(new WebReadService(defaultWebResources, async () => [{ address: '127.0.0.1', family: 4 }]));
    await f.web.chat('请读取 Pi Skills 文档，并总结加载流程');
    assert.equal(f.web.store.web.calls()[0]!.status, 'failed'); assert.equal(f.web.requests, 0);
    await f.web.chat('帮我逐步建立银杏Agent学习目标，使用Skill interview-practice，计划最多两步。');
    await f.runner.tick(); const before = f.goal;
    await f.web.chat('将已获取的 Pi Skills 文档全文绑定到银杏学习目标第1步').catch(() => {});
    assert.deepEqual(f.goal, before); assert.ok(!f.goal.pendingAction!.spec.webBindings);
  } finally { await f.close(); }
  const g = await prepare();
  try {
    const shown = await g.web.chat('查看银杏进度');
    const oldDisplay = { items: [{ id: g.goal.id, revision: g.goal.revision, draftHash: g.goal.pendingAction?.hash }], details: true,
      expires: g.web.tasks.now().getTime() + 300000, displayRunId: shown.run.id };
    await g.web.chat('将已获取的 Pi Skills 文档第1至1行绑定到银杏学习目标第2步');
    assert.throws(() => g.web.goals.validateDisplay(oldDisplay), /版本/);
    const before = g.goal;
    await g.web.chat('请介绍 Pi Skills 文档');
    await g.web.chat('确认').catch(() => {});
    assert.deepEqual(g.goal, before); assert.equal(g.web.requests, 1);
  } finally { await g.close(); }
});

test('强杀已绑定资料的真实Pi Goal进程：冻结输入已落盘，重启保守阻塞、不重放Web或已提交片段', async () => {
  const f = await prepare(true); let release = () => {}, child: ReturnType<typeof spawn> | undefined;
  try {
    f.hold(new Promise<void>(done => { release = done; })); const started = f.started();
    child = spawn(process.execPath, ['--import', 'tsx', 'tests/helpers/goal-web-crash-client.ts', f.web.root, f.web.config.baseUrl!], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exit = once(child, 'exit'); await started;
    const execution = f.view.executions.at(-1)!.execution; assert.equal(execution.status, 'running'); assert.ok(execution.input.web && execution.input.skill);
    child.kill('SIGKILL'); await exit; release();
    const old = f.goal.checkpointRunId, calls = f.calls;
    await f.restart(); await f.runner.tick(); assert.equal(f.goal.status, 'blocked'); assert.equal(f.goal.checkpointRunId, old);
    assert.equal(f.calls, calls); assert.equal(f.web.requests, 1); assert.equal(f.view.executions.at(-1)!.execution.status, 'interrupted');
  } finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); release(); await f.close(); }
});
