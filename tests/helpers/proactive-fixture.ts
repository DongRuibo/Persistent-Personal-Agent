import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { SqliteStore } from '../../src/sqlite-store.js';
import { readConfig } from '../../src/config.js';
import { TaskService } from '../../src/task-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { GoalRunner } from '../../src/goal-runner.js';
import { BackgroundLane } from '../../src/background-lane.js';
import type { GoalResult } from '../../src/goal-types.js';
import type { PolicyProposal, ProactiveOptions } from '../../src/goal-policy-types.js';
import { sseText } from './intent-stub.js';

export const actor = { ownerId: 'local-user', target: { channel: 'console' as const } };
export const hostOptions: ProactiveOptions = { enabled: true, inputRate: 1, outputRate: 2,
  dailyCalls: 10, dailyExecutions: 10, dailyBudgetCny: 1, totalExecutions: 20, totalBudgetCny: 2 };
export const initialTime = '2026-10-23T00:00:00.000Z';
export function seedGoal(store: SqliteStore, now = initialTime, count = 5) {
  const run = store.beginRun(null, now);
  let goal = store.goals.create(actor, run.id, '虚构学习目标，按批准计划交付练习', now);
  store.finishRun(run.id, 'succeeded', now, '已创建');
  const execution = store.goals.claim(actor, goal.id, goal.revision, now)!;
  store.goals.commit(execution.run.id, { stepOutcome: 'complete', artifactText: '计划草稿', progressSummary: '待审批', question: '是否批准',
    proposedPlan: { changeReason: '测试计划', steps: Array.from({ length: count }, (_, i) => ({ title: `练习${i + 1}`, instruction: '生成虚构题目', deliverable: '题目文本', doneWhen: '文本已提交' })) } }, now);
  goal = store.goals.get(actor, goal.id);
  const approval = store.beginRun(null, now);
  goal = store.goals.approvePlan({ actor, sourceRunId: approval.id, text: '批准计划', expectedRevision: goal.revision }, goal.id, goal.pendingAction!.hash, now);
  store.finishRun(approval.id, 'succeeded', now, '已批准');
  return goal;
}
export function proposal(goal: ReturnType<typeof seedGoal>): PolicyProposal {
  return { goalId: goal.id, expectedGoalRevision: goal.revision, planRevision: goal.planRevision,
    capability: 'text_only', expiresAt: '2027-01-01T00:00:00.000Z', schedule: { kind: 'daily', timeZone: 'Asia/Shanghai', time: '09:00' },
    limits: { segmentsPerTrigger: 1, dailyExecutions: 5, dailyModelCalls: 5, totalExecutions: 10, dailyBudgetCny: 1, totalBudgetCny: 2 } };
}
export function approve(store: SqliteStore, spec: PolicyProposal, now = initialTime) {
  const run = store.beginRun(null, now);
  const policy = store.policies.approve({ actor, sourceRunId: run.id, text: '/policy approve ' + JSON.stringify(spec) }, spec, now);
  store.finishRun(run.id, 'succeeded', now, '策略已批准');
  return policy;
}
export async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'proactive-'));
  let now = initialTime;
  let result: GoalResult = { stepOutcome: 'complete', artifactText: '虚构练习题', progressSummary: '交付一题', question: '请回答后继续', needsUserFeedback: true };
  let calls = 0;
  let responseGate: Promise<void> | undefined, deliveryFailures = 0;
  const payloads: unknown[] = [], sent: string[] = [], errors: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += String(chunk);
    calls++; payloads.push(JSON.parse(body));
    await responseGate;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(sseText(JSON.stringify(result)));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('模拟端口不存在');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), LLM_API_KEY: 'fake-proactive', LLM_MODEL: 'local-stub',
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, GOAL_ENABLED: 'true' });
  let store = new SqliteStore(config.databasePath); store.policies.configure(hostOptions);
  let executor = await createPiExecutor(config, new TaskService(store, config.timeZone));
  let runner = makeRunner();
  function makeRunner() { return new GoalRunner(store, executor, { sendMessage: async value => { sent.push(value.text); if (deliveryFailures-- > 0) throw new Error('模拟已发送但确认丢失'); } }, new BackgroundLane(), {
    ownerId: actor.ownerId, accepts: value => value.channel === 'console', pollIntervalMs: 10, proactiveEnabled: true,
    reportError: error => errors.push(error), fatal: () => errors.push('fatal'),
  }, () => new Date(now)); }
  return { root, get store() { return store; }, get runner() { return runner; }, get executor() { return executor; }, get calls() { return calls; }, payloads, sent, errors,
    time(value: string) { now = value; }, result(value: GoalResult) { result = value; },
    holdResponse(gate: Promise<void> | undefined) { responseGate = gate; }, failDelivery(count: number) { deliveryFailures = count; },
    async restart() { await runner.stop(); await executor.close(); store.close();
      store = new SqliteStore(config.databasePath); store.policies.configure(hostOptions); store.recoverInterrupted(now);
      executor = await createPiExecutor(config, new TaskService(store, config.timeZone)); runner = makeRunner(); },
    async close() { await runner.stop(); await executor.close(); store.close(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve())); rmSync(root, { recursive: true, force: true }); },
  };
}
