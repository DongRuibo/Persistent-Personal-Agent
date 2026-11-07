import { setTimeout as delay } from 'node:timers/promises';
import type { Phase2Context } from './phase2-notifications.js';
import { goalRecoveryEnvironment } from '../environments/goal-recovery.js';
import type { RecoveryReply } from '../environments/goal-recovery.js';
import { notificationChild } from '../environments/notifications.js';

type Environment = Awaited<ReturnType<typeof goalRecoveryEnvironment>>;
async function using(c: Phase2Context, handle: (attempt: number) => RecoveryReply, attempts: 1 | 2 | 3, action: (f: Environment) => Promise<void>) {
  const f = await goalRecoveryEnvironment(c.root, c.target, handle, attempts);
  try { await action(f); }
  finally {
    const snapshot = f.snapshot(); c.trace.push(snapshot);
    c.observations.goal_status = snapshot.view.goal.status;
    const event = snapshot.events.filter(event => event.type === 'goal_attempt_failed');
    c.observations.classifications = snapshot.calls.filter(call => typeof call.response === 'object').map((call, index) => ({
      expected: typeof call.response === 'object' && call.response.status === 429 ? 'rate_limited' : typeof call.response === 'object' && call.response.status >= 500 ? 'transient_server_error' : 'permanent_error',
      actual: event[index]?.details ? JSON.parse(event[index].details!).kind : snapshot.view.executions.at(-1)?.execution.reasonCode ?? 'unclassified',
    }));
    c.observations.http_calls = snapshot.calls.length; await f.close();
  }
}
export const goalRecoveryCases: Record<string, (c: Phase2Context) => Promise<void>> = {
  G01: c => using(c, () => ({ status: 429, retryAfter: '2' }), 1, async f => {
    await f.runner.tick(); const view = f.view();
    c.check('429是failed而非进程中断', view.executions[0]?.execution.status === 'failed' && view.executions[0]?.execution.reasonCode === 'rate_limited');
    const event = f.snapshot().events.find(e => e.type === 'goal_attempt_failed');
    c.check('保留Retry-After且不擅自重试', f.calls.length === 1 && !!event?.details && JSON.parse(event.details).retryAfterMs === 2000);
    c.observations.goal_state_correct = view.goal.status === 'blocked';
  }),
  G02: c => using(c, attempt => attempt === 1 ? { status: 429, retryAfter: '1' } : 'success', 3, async f => {
    await f.runner.tick();
    c.check('429到Retry-After后才重试并提交', f.calls.length === 2 && f.calls[1]!.at_ms - f.calls[0]!.at_ms >= 1000 && f.view().executions[0]?.execution.status === 'committed');
    c.observations.goal_state_correct = f.view().goal.status === 'waiting_user';
  }),
  G03: c => using(c, attempt => attempt === 1 ? { status: 500 } : 'success', 3, async f => {
    await f.runner.tick();
    c.check('500有限退避后提交唯一Checkpoint', f.calls.length === 2 && f.calls[1]!.at_ms - f.calls[0]!.at_ms >= 1000
      && f.view().executions.length === 1 && f.view().executions[0]?.execution.status === 'committed');
    c.observations.goal_state_correct = f.view().goal.status === 'waiting_user';
  }),
  G04: c => using(c, () => ({ status: 400 }), 3, async f => {
    await f.runner.tick(); await f.runner.tick();
    c.check('永久错误不重试且明确原因', f.calls.length === 1 && f.view().executions[0]?.execution.reasonCode === 'permanent_error');
    c.observations.goal_state_correct = f.view().goal.status === 'blocked';
  }),
  G05: c => using(c, () => ({ status: 500 }), 3, async f => {
    await f.runner.tick(); await f.runner.tick();
    c.check('三次耗尽后failed和blocked，旧进度不伪造', f.calls.length === 3 && f.view().executions[0]?.execution.status === 'failed'
      && f.view().goal.status === 'blocked' && f.view().checkpoint === null);
    c.observations.goal_state_correct = f.view().goal.status === 'blocked';
  }),
  G06: c => using(c, () => ({ status: 500 }), 3, async f => {
    const work = f.runner.tick();
    for (let i = 0; i < 200 && !f.snapshot().events.some(e => e.type === 'goal_retry_scheduled') && f.calls.length === 0; i++) await delay(10);
    // 等待错误已经交给宿主，取消发生在重试等待期间。
    for (let i = 0; i < 100 && !f.snapshot().events.some(e => e.type === 'goal_retry_scheduled') && f.view().goal.status === 'running'; i++) await delay(5);
    f.control('cancel'); await work; await f.runner.tick();
    c.check('用户取消撤销等待中的重试', f.calls.length === 1 && f.view().goal.status === 'cancelled'
      && f.view().executions[0]?.execution.reasonCode === 'user_cancelled');
    c.observations.goal_state_correct = f.view().goal.status === 'cancelled';
  }),
  G07: c => using(c, () => 'plan', 3, async f => {
    await f.runner.tick(); await f.runner.tick();
    c.check('等待审批不是失败或自动执行许可', f.calls.length === 1 && f.view().goal.status === 'waiting_user' && !!f.view().goal.pendingAction);
    c.observations.goal_state_correct = f.view().goal.status === 'waiting_user'; c.observations.outcome = 'waiting_for_approval';
  }),
  G08: c => using(c, () => 'plan', 3, async f => {
    await f.runner.tick(); f.control('cancel'); await f.runner.tick();
    c.check('用户拒绝待批计划不触发正式执行', f.calls.length === 1 && f.view().goal.status === 'cancelled' && f.view().executions.length === 1);
    c.observations.goal_state_correct = f.view().goal.status === 'cancelled';
  }),
  G09: c => using(c, () => 'tool', 3, async f => {
    await f.runner.tick(); await f.runner.tick();
    c.check('非幂等外部工具提议不得执行或自动重试', f.calls.length === 1 && f.store.listTasks().length === 0 && f.view().checkpoint === null && f.view().goal.status === 'blocked');
    c.observations.goal_state_correct = f.view().goal.status === 'blocked';
  }),
  G10: c => using(c, () => 'hang', 3, async f => {
    await f.runner.tick(); await f.runner.tick();
    c.check('超时不当已知500重试，保留中断和timeout原因', f.calls.length === 1 && f.view().executions[0]?.execution.status === 'interrupted'
      && f.view().executions[0]?.execution.reasonCode === 'timeout');
    c.observations.goal_state_correct = f.view().goal.status === 'blocked';
  }),
  G11: async c => {
    const first = await notificationChild(c.root, c.target, 'goal-running', c.trace);
    try { first.child.send('produce'); await first.window(); }
    finally { c.check('Goal执行中真实SIGKILL', (await first.stop(true))[1] === 'SIGKILL'); }
    const second = await notificationChild(c.root, c.target, 'normal', c.trace);
    try {
      const ready = second.events.find(e => e.type === 'ready')!, goals = ready.goals as { goal: { status: string }; checkpoint: unknown; executions: { execution: { status: string; reasonCode: string } }[] }[];
      c.check('真实进程中断保守恢复且不伪造Checkpoint', goals[0]?.goal.status === 'blocked' && goals[0]?.checkpoint === null && goals[0]?.executions[0]?.execution.status === 'interrupted');
      c.check('中断原因明确为process_interrupted', goals[0]?.executions[0]?.execution.reasonCode === 'process_interrupted');
      c.observations.goal_state_correct = goals[0]?.goal.status === 'blocked'; c.trace.push({ goals });
    } finally { await second.stop(); }
  },
  G12: c => using(c, () => ({ status: 429, retryAfter: '120' }), 3, async f => {
    await f.runner.tick();
    const event = f.snapshot().events.find(e => e.type === 'goal_attempt_failed');
    c.check('长Retry-After不截短为提前请求', f.calls.length === 1 && !!event?.details && JSON.parse(event.details).retryAfterMs === 120000
      && f.view().goal.status === 'blocked');
    c.observations.goal_state_correct = f.view().goal.status === 'blocked';
  }),
};
