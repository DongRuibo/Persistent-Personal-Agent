import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import { GoalRunner } from '../../src/goal-runner.js';
import { BackgroundLane } from '../../src/background-lane.js';
import type { GoalResult } from '../../src/goal-types.js';
import { hostOptions } from './proactive-fixture.js';
import type { WebReadService } from '../../src/web-read-service.js';
import { webFixture } from './web-fixture.js';
import { content, reply, toolCall } from './skills-fixture.js';

export async function goalWebFixture(body = 'PI_SNAPSHOT_ONLY：原生Skill按需加载。\n第二行：工具不产生授权。\n第三行：未知事实应保留未知。') {
  const lane = new BackgroundLane(), events = new EventEmitter(), sent: string[] = [], errors: unknown[] = [];
  let goalCalls = 0, failNotifications = 0, gate: Promise<void> | undefined;
  let selector: string[] | undefined;
  let result: GoalResult = { stepOutcome: 'complete', artifactText: 'FROZEN_EXERCISE：依据已批准资料给出一道虚构问题。', progressSummary: '已提交一道题', question: '请回答后再继续', needsUserFeedback: true };
  const f = await webFixture(async payload => {
    const system = content(payload.messages.find(message => message.role === 'system')?.content);
    const user = content(payload.messages.findLast(message => message.role === 'user')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(user);
      const goalAction = message.includes('逐步') ? 'create' : /绑定|用于|移除/.test(message) ? 'revise_plan' : message.includes('批准') ? 'approve_plan'
        : message.includes('查看') ? 'view' : message.includes('暂停') ? 'pause' : message.includes('取消') ? 'cancel' : 'continue';
      return reply(JSON.stringify({ action: 'goal_manage', mode: goalAction === 'view' ? 'query' : 'request', evidence: message, goalAction,
        ...(goalAction === 'create' ? {} : { selector: { keywords: selector ?? (message.includes('那个学习计划') ? ['学习计划'] : ['银杏']) } }) }));
    }
    if (system.includes('有界纯文本片段')) {
      goalCalls++; assert.equal(payload.tools?.length ?? 0, 0); events.emit('goal'); await gate;
      const input = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
      if (input.plan.revision === 0) return reply(JSON.stringify({ stepOutcome: 'complete', artifactText: '待批准两步练习', progressSummary: '计划待批准', question: '是否批准',
        proposedPlan: { changeReason: '虚构学习安排', steps: [1, 2].map(i => ({ title: `练习${i}`, instruction: '只根据批准资料提问', deliverable: '一道虚构题目', doneWhen: '用户核对题目', skillId: 'interview-practice' })) } }));
      return reply(JSON.stringify(result));
    }
    const index = payload.messages.findLastIndex(message => message.role === 'user');
    const toolResults = payload.messages.slice(index + 1).filter(message => message.role === 'tool');
    if (toolResults.length) return reply('模型收尾不得代替真实收据。');
    return /绑定|用于|移除/.test(user) ? toolCall('goal_manage', {}) : /读取|介绍/.test(user) ? toolCall('web_get', { resourceId: 'pi-skills-v1' }) : toolCall('goal_manage', {});
  }, { productSkills: true, body, lane });
  let runner: GoalRunner;
  function boot() {
    f.store.policies.configure(hostOptions);
    runner = new GoalRunner(f.store, f.executor, { sendMessage: async message => { sent.push(message.text); if (failNotifications-- > 0) throw new Error('模拟通知确认丢失'); } }, lane, {
      ownerId: 'local-user', accepts: target => target.channel === 'console', pollIntervalMs: 10, proactiveEnabled: true,
      reportError: error => errors.push(error), fatal: () => errors.push('fatal'), delivered: (goal, run) => f.goals.displayed(goal, run),
    }, () => f.tasks.now());
    f.setInterrupt(id => runner.interrupt(id)); f.store.policies.interrupt = id => runner.interrupt(id);
  }
  boot();
  return { web: f, sent, errors, events, get runner() { return runner; }, get calls() { return goalCalls; },
    get goal() { return f.goals.list()[0]!; }, get view() { return f.goals.plan(f.goals.list()[0]!.id); },
    result(value: GoalResult) { result = value; }, selector(value?: string[]) { selector = value; }, hold(value?: Promise<void>) { gate = value; }, started() { return once(events, 'goal'); }, failNotification() { failNotifications++; },
    async seed() { await f.chat('请读取 Pi Skills 文档，并总结加载流程'); await f.chat('帮我逐步建立银杏Agent学习目标，使用Skill interview-practice，计划最多两步。'); await runner.tick(); },
    async restart(service?: WebReadService) { await runner.stop(); await f.restart(service); f.store.recoverInterrupted(f.tasks.now().toISOString()); boot(); },
    async close() { gate = undefined; await runner.stop(); await f.close(); },
  };
}
