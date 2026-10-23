import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { webFixture } from './helpers/web-fixture.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import { GoalRunner } from '../src/goal-runner.js';
import { BackgroundLane } from '../src/background-lane.js';
import type { GoalResult } from '../src/goal-types.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/integrated-live-g1.json', import.meta.url), 'utf8'));
for (const mode of ['approved', 'invalid'] as const) test(`本机原版Pi/SQLite综合回归 ${mode}：宿主状态、收据、Skill/Web冻结及重启一致`, async () => {
  let goalCalls = 0, topic = 'web';
  const f = await webFixture(payload => {
    const system = content(payload.messages.find(m => m.role === 'system')?.content);
    const user = content(payload.messages.findLast(m => m.role === 'user')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(user);
      return reply(JSON.stringify({ action: 'goal_manage', mode: message.includes('查看') ? 'query' : 'request', evidence: message,
        goalAction: message.includes('逐步') ? 'create' : message.includes('绑定') ? 'revise_plan' : message.includes('批准') ? 'approve_plan' : 'view',
        ...(message.includes('逐步') ? {} : { selector: { keywords: ['银杏'] } }) }));
    }
    if (system.includes('有界纯文本片段')) {
      goalCalls++; assert.equal(payload.tools?.length ?? 0, 0);
      const snapshot = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
      if (snapshot.plan.revision === 0) {
        assert.equal(snapshot.plan.currentStep.stepId, undefined);
        const result = structuredClone(live.result) as GoalResult;
        // 模拟旧模型复制bootstrap的真实失败形态；测试宿主取数不属于模型授权。
        result.proposedPlan!.steps[0]!.stepId = mode === 'invalid' ? 'forged-foreign-step' : f.goals.list()[0]!.currentStepId!;
        return reply(JSON.stringify(result));
      }
      assert.ok(user.includes('OFFLINE_WEB_BODY')); assert.ok(user.includes('<skill name="interview-practice"'));
      return reply(JSON.stringify({ stepOutcome: 'partial', artifactText: '只依据冻结资料的一道虚构题', progressSummary: '已出题待回答', question: '请回答', needsUserFeedback: true }));
    }
    const index = payload.messages.findLastIndex(m => m.role === 'user'), tools = payload.messages.slice(index + 1).filter(m => m.role === 'tool');
    if (topic === 'web') {
      if (!tools.length) return toolCall('read', { path: f.executor.skills!.list().find(s => s.id === 'agent-notes')!.filePath });
      if (tools.length === 1) { assert.ok(JSON.stringify(payload).includes('区分资料原文')); return toolCall('web_get', { resourceId: 'pi-skills-v1' }); }
      assert.ok(JSON.stringify(payload).includes('UNTRUSTED_WEB_DATA_V1')); return reply('资料事实有来源，未知事项不推断。');
    }
    if (!tools.length) return toolCall('goal_manage', {});
    return reply('模型错误口述：已批准正式计划且已经提交Checkpoint。');
  }, { productSkills: true, body: 'OFFLINE_WEB_BODY：宿主保存授权与Checkpoint，Pi执行当前片段。' });
  let runner: GoalRunner;
  const boot = () => runner = new GoalRunner(f.store, f.executor, { sendMessage: async () => {} }, new BackgroundLane(), {
    ownerId: 'local-user', accepts: () => true, pollIntervalMs: 10, reportError: error => { throw error; }, fatal: () => assert.fail('不应停机'),
    delivered: (goal, run) => f.goals.displayed(goal, run),
  }, () => f.tasks.now());
  boot();
  try {
    await f.chat(); assert.equal(f.payloads.length, 3); assert.equal(f.requests, 1);
    topic = 'goal';
    const create = await f.chat('帮我逐步制定银杏阅读计划，正式计划最多1个Step，使用Skill interview-practice。现在先给出待批准计划。');
    assert.match(create.text, /初始化占位.*待批准草稿：无.*Checkpoint：无/);
    assert.equal(f.goals.list()[0]!.pendingAction, null); assert.equal(goalCalls, 0);
    await runner!.tick(); await runner!.tick();
    const goal = f.goals.list()[0]!;
    if (mode === 'approved') {
      assert.equal(goal.status, 'waiting_user'); assert.ok(goal.pendingAction); assert.equal(goalCalls, 1);
      assert.equal(f.goals.plan(goal.id).executions[0]!.execution.input.skill, undefined);
      await f.chat('将已获取的 Pi Skills 文档全文绑定到银杏阅读计划第1步');
      const draft = f.goals.get(goal.id).pendingAction!;
      assert.equal(draft.spec.skillBindings!.length, 1); assert.equal(draft.spec.webBindings!.length, 1);
      await runner!.tick(); assert.equal(goalCalls, 1, '绑定和展示不能自动执行');
      await f.chat('批准银杏阅读计划并继续一段'); await runner!.tick();
      const view = f.goals.plan(goal.id), execution = view.executions[1]!.execution;
      assert.equal(view.goal.planRevision, 1); assert.equal(execution.status, 'committed'); assert.equal(view.goal.status, 'waiting_user');
      assert.equal(execution.input.skill!.hash, draft.spec.skillBindings![0]!.packageHash);
      assert.equal(execution.input.web!.binding.selectedHash, draft.spec.webBindings![0]!.selectedHash);
      assert.equal(view.checkpoint!.executionRunId, execution.runId);
      const count = f.payloads.length;
      await runner!.stop(); await f.restart(); f.store.recoverInterrupted(f.tasks.now().toISOString()); boot(); await runner!.tick();
      assert.equal(f.payloads.length, count); assert.equal(goalCalls, 2); assert.equal(f.requests, 1);
      assert.deepEqual(f.goals.plan(goal.id), view);
    } else {
      assert.equal(goal.status, 'blocked'); assert.equal(goal.checkpointRunId, null);
      const before = f.goals.plan(goal.id), rendered = await f.chat('查看银杏阅读计划进度');
      assert.match(rendered.text, /goal_plan_step_identity/); assert.match(rendered.text, /Checkpoint：无/);
      assert.ok(!rendered.text.includes('模型错误口述'));
      const sessionFile = join(f.config.sessionDir, readdirSync(f.config.sessionDir)[0]!, 'chat.session.jsonl');
      const records = readFileSync(sessionFile, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.ok(records.some(r => r.customType === 'host-goal-result-v1' && r.content.includes('阻塞原因：goal_plan_step_identity') && r.content.includes('Checkpoint：无')));
      await runner!.stop(); await f.restart(); f.store.recoverInterrupted(f.tasks.now().toISOString()); boot();
      const next = await f.chat('查看银杏阅读计划进度'); await runner!.tick();
      assert.match(next.text, /goal_plan_step_identity/); assert.deepEqual(f.goals.plan(goal.id), before); assert.equal(goalCalls, 1);
    }
    assert.deepEqual(f.errors, []); assert.equal(f.memory.listForHost().length, 0); assert.equal(f.store.listTasks().length, 0);
  } finally { await runner!.stop(); await f.close(); }
});
