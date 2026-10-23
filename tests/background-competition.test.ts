import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { BackgroundLane } from '../src/background-lane.js';
import { TaskScheduler } from '../src/scheduler.js';
import { GitHubObserver } from '../src/github-observer.js';
import { policyConsole } from '../src/goal-policy-console.js';
import type { ExecutionRequest } from '../src/contracts.js';
import { actor, approve, fixture, initialTime, proposal, seedGoal } from './helpers/proactive-fixture.js';

function gate() {
  let open!: () => void;
  const promise = new Promise<void>(resolve => { open = resolve; });
  return { promise, open };
}
const watch = { kind: 'github' as const, repository: 'fiction/competition', branch: 'main', intervalSeconds: 60 };
async function slowGitHub() {
  const entered = gate(), response = gate(); let requests = 0, baseline = true;
  const server = createServer(async (req, res) => {
    requests++;
    if (!baseline) { entered.open(); await response.promise; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url!.includes('/compare/') ? { status: 'ahead', files: [] }
      : (baseline ? [1] : [2, 1]).map(n => ({ sha: String(n).repeat(40), commit: { message: `虚构提交${n}` } }))));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { adapter: new GitHubObserver(`http://127.0.0.1:${address.port}`), entered, response,
    get requests() { return requests; }, changed() { baseline = false; },
    async close() { response.open(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
function scheduler(f: Awaited<ReturnType<typeof fixture>>, lane: BackgroundLane) {
  return new TaskScheduler(f.store, f.executor, { sendMessage: async () => {} }, 10,
    error => f.errors.push(error), () => f.now, lane);
}

test('慢Observer未返回时，到期Task使用同一后台门立即领取并经真实Pi完成', { timeout: 20000 }, async t => {
  const lane = new BackgroundLane(), f = await fixture({ lane }), g = await slowGitHub(), tasks = scheduler(f, lane);
  let pending: Promise<void> | undefined;
  try {
    f.store.policies.observer = g.adapter; const goal = seedGoal(f.store);
    const policy = approve(f.store, { ...proposal(goal), schedule: watch }); await f.runner.tick();
    const task = f.store.createTask('虚构一次性提醒', '2026-10-23T00:02:00.000Z', initialTime);
    g.changed(); f.time('2026-10-23T00:01:00.000Z'); pending = f.runner.tick(); await g.entered.promise;
    f.time('2026-10-23T00:02:00.000Z'); await tasks.tick();
    t.diagnostic(`Observer仍挂起；Task=${f.store.getTask(task.id)?.status}；模型请求=${f.calls}`);
    assert.equal(f.store.getTask(task.id)?.status, 'succeeded');
    assert.equal(f.store.policies.audit(actor, policy.id).grants.length, 0);
    assert.equal(f.calls, 1);
  } finally { g.response.open(); await pending; await tasks.stop(); await f.close(); await g.close(); }
});

test('Observer返回后重查Task优先级；延后消费的Grant不会被下一次观察误撤销', { timeout: 20000 }, async t => {
  const lane = new BackgroundLane(), f = await fixture({ lane }), g = await slowGitHub(), tasks = scheduler(f, lane);
  let pending: Promise<void> | undefined;
  try {
    f.store.policies.observer = g.adapter; const goal = seedGoal(f.store);
    const policy = approve(f.store, { ...proposal(goal), schedule: watch }); await f.runner.tick();
    const task = f.store.createTask('Task必须先于Goal', '2026-10-23T00:02:00.000Z', initialTime);
    g.changed(); f.time('2026-10-23T00:01:00.000Z'); pending = f.runner.tick(); await g.entered.promise;
    f.time('2026-10-23T00:02:00.000Z'); g.response.open(); await pending;
    t.diagnostic(`网络返回且Task已到期；Task=${f.store.getTask(task.id)?.status}；Goal模型请求=${f.calls}`);
    assert.equal(f.calls, 0); assert.equal(f.store.goals.get(actor, goal.id).status, 'ready');
    await tasks.tick(); assert.equal(f.store.getTask(task.id)?.status, 'succeeded');
    await f.runner.tick();
    const audit = f.store.policies.audit(actor, policy.id);
    assert.equal(audit.observations.length, 1); assert.equal(audit.grants.length, 1);
    assert.equal(f.store.goals.view(actor, goal.id).executions.length, 2);
    assert.equal(f.calls, 2);
  } finally { g.response.open(); await pending; await tasks.stop(); await f.close(); await g.close(); }
});

test('已签发但未领取的观察Grant跨下一轮到期扫描仍有效，不能误判为等待阻塞', async t => {
  const f = await fixture(), g = await slowGitHub();
  try {
    f.store.policies.observer = g.adapter; const goal = seedGoal(f.store);
    const policy = approve(f.store, { ...proposal(goal), schedule: watch }); await f.runner.tick();
    g.changed(); g.response.open();
    await f.store.policies.observe('2026-10-23T00:01:00.000Z', () => true, new AbortController().signal);
    f.time('2026-10-23T00:02:00.000Z'); await f.runner.tick();
    const audit = f.store.policies.audit(actor, policy.id);
    t.diagnostic(`延后领取；策略=${audit.policy.status}；Grant=${JSON.stringify(audit.grants)}；模型请求=${f.calls}`);
    assert.equal(f.calls, 1); assert.equal(audit.observations.length, 1); assert.equal(audit.grants.length, 1);
    assert.equal(f.store.goals.view(actor, goal.id).executions.length, 2);
  } finally { await f.close(); await g.close(); }
});

for (const when of ['before', 'after'] as const) {
  test(`慢Outbox在${when}执行阶段不占后台门，旧Task仍可执行`, { timeout: 20000 }, async t => {
    const lane = new BackgroundLane(), entered = gate(), response = gate(); let sends = 0;
    const f = await fixture({ lane, channel: { sendMessage: async () => {
      sends++; if (when === 'before' && sends === 1) throw new Error('预留待投递通知');
      entered.open(); await response.promise;
    } } }), tasks = scheduler(f, lane);
    let pending: Promise<void> | undefined;
    try {
      approve(f.store, proposal(seedGoal(f.store))); f.time('2026-10-23T01:00:00.000Z');
      if (when === 'before') { await f.runner.tick(); f.time('2026-10-23T01:00:30.000Z'); }
      const task = f.store.createTask('投递期间到期的旧Task', '2026-10-23T01:01:00.000Z', initialTime);
      pending = f.runner.tick(); await entered.promise;
      f.time('2026-10-23T01:01:00.000Z'); await tasks.tick();
      t.diagnostic(`Outbox仍挂起；Task=${f.store.getTask(task.id)?.status}；模型请求=${f.calls}`);
      assert.equal(f.store.getTask(task.id)?.status, 'succeeded'); assert.equal(f.calls, 2);
    } finally { response.open(); await pending; await tasks.stop(); await f.close(); }
  });
}

test('执行前同步检查跨过Task到期点时，再次检查优先级且不消费Goal预算', async t => {
  const lane = new BackgroundLane(), f = await fixture({ lane }), tasks = scheduler(f, lane);
  try {
    const policy = approve(f.store, proposal(seedGoal(f.store)));
    const task = f.store.createTask('检查过程中到期', '2026-10-23T01:00:01.000Z', initialTime);
    f.time('2026-10-23T01:00:00.000Z'); t.mock.method(f.executor, 'checkReady', () => f.time('2026-10-23T01:00:01.000Z'));
    await f.runner.tick();
    t.diagnostic(`检查后Task=${f.store.getTask(task.id)?.status}；Goal模型请求=${f.calls}`);
    assert.equal(f.calls, 0);
    assert.equal((f.store.policies.audit(actor, policy.id).grants[0] as { consumedAt: string | null }).consumedAt, null);
    await tasks.tick(); await f.runner.tick(); assert.equal(f.calls, 2);
  } finally { await tasks.stop(); await f.close(); }
});

test('Outbox返回不能二次释放正在被Task使用的门；并发tick仍只有一个模型和一次领取', { timeout: 20000 }, async t => {
  const lane = new BackgroundLane(), entered = gate(), sent = gate(), taskStarted = gate(), model = gate();
  const f = await fixture({ lane, channel: { sendMessage: async () => { entered.open(); await sent.promise; } } });
  const tasks = scheduler(f, lane); let goalWork: Promise<void> | undefined, taskWork: Promise<void> | undefined;
  let active = 0, maximum = 0;
  const execute = f.executor.execute.bind(f.executor);
  t.mock.method(f.executor, 'execute', async (request: ExecutionRequest) => {
    active++; maximum = Math.max(maximum, active);
    if (request.scope === 'task') taskStarted.open();
    try { return await execute(request); } finally { active--; }
  });
  try {
    approve(f.store, proposal(seedGoal(f.store))); f.time('2026-10-23T01:00:00.000Z');
    goalWork = f.runner.tick(); await entered.promise;
    const next = seedGoal(f.store), run = f.store.beginRun(null, initialTime);
    f.store.goals.continue({ actor, sourceRunId: run.id, text: '继续一段', expectedRevision: next.revision }, next.id, initialTime);
    f.store.finishRun(run.id, 'succeeded', initialTime, '用户授权');
    const task = f.store.createTask('慢Task仍占用模型门', f.now.toISOString(), initialTime);
    f.holdResponse(model.promise); taskWork = tasks.tick(); await taskStarted.promise;
    sent.open(); await goalWork;
    await Promise.all(Array.from({ length: 12 }, () => f.runner.tick()));
    await Promise.all(Array.from({ length: 12 }, () => tasks.tick()));
    const unexpectedRelease = lane.acquire(true); unexpectedRelease?.();
    assert.equal(unexpectedRelease, undefined); assert.equal(f.store.getTask(task.id)?.status, 'running');
    assert.equal(f.store.goals.get(actor, next.id).status, 'ready');
    assert.equal(f.store.listRuns(task.id).length, 1); assert.equal(maximum, 1);
    model.open(); await taskWork; await f.runner.tick();
    assert.equal(f.store.getTask(task.id)?.status, 'succeeded'); assert.equal(maximum, 1); assert.equal(f.calls, 3);
  } finally { sent.open(); model.open(); await goalWork; await taskWork; await tasks.stop(); await f.close(); }
});

test('时间Grant延后跨过下一周期仍只消费原授权一次；不会被扫描误撤销或重复签发', async () => {
  const f = await fixture();
  try {
    const goal = seedGoal(f.store), policy = approve(f.store, proposal(goal));
    f.store.policies.scan('2026-10-23T01:00:00.000Z', () => true);
    f.time('2026-10-24T01:00:00.000Z'); await Promise.all(Array.from({ length: 12 }, () => f.runner.tick()));
    const audit = f.store.policies.audit(actor, policy.id);
    assert.equal(audit.triggers.length, 1); assert.equal(audit.grants.length, 1); assert.equal(f.calls, 1);
    assert.equal((audit.grants[0] as { reserveCny: number }).reserveCny, 0.04096);
    assert.equal(f.store.goals.view(actor, goal.id).executions.length, 2);
  } finally { await f.close(); }
});

for (const action of ['stop', 'cancel', 'revoke', 'foreground'] as const) {
  test(`慢Observer期间${action}：迟到响应不越过停止/前台门，不产生意外执行`, { timeout: 20000 }, async () => {
    const lane = new BackgroundLane(), f = await fixture({ lane }), g = await slowGitHub();
    let pending: Promise<void> | undefined, foreground: (() => void) | undefined;
    try {
      f.store.policies.observer = g.adapter; const goal = seedGoal(f.store);
      const policy = approve(f.store, { ...proposal(goal), schedule: watch }); await f.runner.tick();
      g.changed(); f.time('2026-10-23T00:01:00.000Z'); pending = f.runner.tick(); await g.entered.promise;
      if (action === 'stop') await f.runner.stop();
      else if (action === 'foreground') foreground = lane.foreground();
      else if (action === 'revoke') policyConsole(f.store, actor, `/policy revoke ${JSON.stringify({ id: policy.id, version: 1 })}`, f.now.toISOString());
      else {
        const current = f.store.goals.get(actor, goal.id), run = f.store.beginRun(null, f.now.toISOString());
        f.store.goals.control({ actor, sourceRunId: run.id, text: '取消目标', expectedRevision: current.revision }, goal.id, 'cancel', f.now.toISOString());
        f.store.finishRun(run.id, 'succeeded', f.now.toISOString(), '已取消');
      }
      await Promise.all(Array.from({ length: 12 }, () => f.runner.tick()));
      assert.equal(g.requests, 2, '并发tick没有再发观察请求');
      g.response.open(); await pending;
      assert.equal(f.calls, 0);
      assert.equal(f.store.goals.view(actor, goal.id).executions.length, 1);
      const audit = f.store.policies.audit(actor, policy.id);
      assert.equal(audit.observations.length, action === 'foreground' ? 1 : 0);
      assert.equal(audit.grants.length, action === 'foreground' ? 1 : 0);
      if (action === 'foreground') {
        foreground!(); foreground = undefined; await f.runner.tick();
        assert.equal(f.calls, 1); assert.equal(f.store.policies.audit(actor, policy.id).grants.length, 1);
      }
    } finally { foreground?.(); g.response.open(); await pending; await f.close(); await g.close(); }
  });
}

for (const action of ['stop', 'cancel', 'revoke'] as const) {
  test(`等待Outbox期间${action}：完成投递后不新签发或消费执行授权`, { timeout: 20000 }, async () => {
    const lane = new BackgroundLane(), entered = gate(), response = gate(); let sends = 0;
    const f = await fixture({ lane, channel: { sendMessage: async () => {
      if (++sends === 1) throw new Error('模拟首发失败'); entered.open(); await response.promise;
    } } });
    let pending: Promise<void> | undefined, stopping: Promise<void> | undefined;
    try {
      approve(f.store, proposal(seedGoal(f.store))); f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick();
      const next = seedGoal(f.store), spec = proposal(next);
      spec.schedule = { kind: 'once', at: '2026-10-23T01:00:30.000Z', timeZone: 'Asia/Shanghai' };
      const policy = approve(f.store, spec); f.time('2026-10-23T01:00:30.000Z'); pending = f.runner.tick(); await entered.promise;
      if (action === 'stop') {
        let stopped = false; stopping = f.runner.stop().then(() => { stopped = true; });
        await Promise.resolve(); assert.equal(stopped, false, '等待在途投递，不遗留后台数据库写入');
      } else if (action === 'revoke') policyConsole(f.store, actor, `/policy revoke ${JSON.stringify({ id: policy.id, version: 1 })}`, f.now.toISOString());
      else {
        const run = f.store.beginRun(null, f.now.toISOString());
        f.store.goals.control({ actor, sourceRunId: run.id, text: '取消目标', expectedRevision: next.revision }, next.id, 'cancel', f.now.toISOString());
        f.store.finishRun(run.id, 'succeeded', f.now.toISOString(), '已取消');
      }
      response.open(); await pending; await stopping; await f.runner.tick();
      assert.equal(f.calls, 1); assert.equal(f.store.policies.audit(actor, policy.id).grants.length, 0);
      assert.equal(f.store.goals.view(actor, next.id).executions.length, 1);
      assert.equal((f.store.notifications.listForHost()[0] as { status: string }).status, 'sent');
    } finally { response.open(); await pending; await stopping; await f.close(); }
  });
}

test('未消费Observer Grant跨重启及下一观察时点恢复，仍只有一个Observation/Grant/Execution', async () => {
  const f = await fixture(), g = await slowGitHub();
  try {
    f.store.policies.observer = g.adapter; const goal = seedGoal(f.store);
    const policy = approve(f.store, { ...proposal(goal), schedule: watch }); await f.runner.tick();
    g.changed(); g.response.open();
    await f.store.policies.observe('2026-10-23T00:01:00.000Z', () => true, new AbortController().signal);
    const before = f.store.policies.audit(actor, policy.id), checkpoint = f.store.goals.get(actor, goal.id).checkpointRunId;
    await f.restart(); f.store.policies.observer = g.adapter; f.time('2026-10-23T00:03:00.000Z');
    assert.equal(f.calls, 0); assert.equal(f.store.goals.get(actor, goal.id).checkpointRunId, checkpoint);
    await f.runner.tick(); await f.runner.tick();
    const after = f.store.policies.audit(actor, policy.id);
    assert.equal(after.observations.length, 1); assert.equal(after.grants.length, 1); assert.equal(f.calls, 1);
    assert.equal((after.grants[0] as { id: string }).id, (before.grants[0] as { id: string }).id);
    assert.equal(f.store.goals.view(actor, goal.id).executions.length, 2);
  } finally { await f.close(); await g.close(); }
});

test('前台已排队时不启动新的主动扫描或改变Goal视图版本', async () => {
  const lane = new BackgroundLane(), f = await fixture({ lane }), release = lane.foreground();
  try {
    const goal = seedGoal(f.store), policy = approve(f.store, proposal(goal));
    f.time('2026-10-23T01:00:00.000Z'); await f.runner.tick();
    assert.equal(f.store.goals.get(actor, goal.id).revision, goal.revision);
    assert.equal(f.store.policies.audit(actor, policy.id).grants.length, 0); assert.equal(f.calls, 0);
  } finally { release(); await f.close(); }
});

test('因Task占门延后的Grant仍受暂停/取消/改计划/撤销/到期限制；不预留费用或提交Goal结果', { timeout: 20000 }, async t => {
  for (const action of ['pause', 'cancel', 'plan', 'revoke', 'expire'] as const) {
    const lane = new BackgroundLane(), f = await fixture({ lane }), g = await slowGitHub(), tasks = scheduler(f, lane);
    const taskStarted = gate(), response = gate(); let pending: Promise<void> | undefined;
    const execute = f.executor.execute.bind(f.executor);
    t.mock.method(f.executor, 'execute', async (request: ExecutionRequest) => { if (request.scope === 'task') taskStarted.open(); return execute(request); });
    try {
      f.store.policies.observer = g.adapter; const goal = seedGoal(f.store);
      const policy = approve(f.store, { ...proposal(goal), schedule: watch, expiresAt: '2026-10-23T00:03:00.000Z' }); await f.runner.tick();
      g.changed(); g.response.open(); await f.store.policies.observe('2026-10-23T00:01:00.000Z', () => true, new AbortController().signal);
      const checkpoint = f.store.goals.get(actor, goal.id).checkpointRunId;
      f.time('2026-10-23T00:02:00.000Z'); f.store.createTask('占门中的旧Task', f.now.toISOString(), initialTime);
      f.holdResponse(response.promise); pending = tasks.tick(); await taskStarted.promise;
      await f.runner.tick();
      assert.equal((f.store.policies.audit(actor, policy.id).grants[0] as { consumedAt: string | null }).consumedAt, null);
      if (action === 'expire') f.time('2026-10-23T00:04:00.000Z');
      else if (action === 'revoke') policyConsole(f.store, actor, `/policy revoke ${JSON.stringify({ id: policy.id, version: 1 })}`, f.now.toISOString());
      else {
        const current = f.store.goals.get(actor, goal.id), run = f.store.beginRun(null, f.now.toISOString());
        const command = { actor, sourceRunId: run.id, text: action, expectedRevision: current.revision };
        if (action === 'plan') f.store.goals.proposePlan(command, goal.id, { changeReason: '修改计划', steps: [{ title: '新步骤', instruction: '新内容', deliverable: '文本', doneWhen: '交付' }] }, f.now.toISOString());
        else f.store.goals.control(command, goal.id, action, f.now.toISOString());
        f.store.finishRun(run.id, 'succeeded', f.now.toISOString(), '控制已提交');
      }
      response.open(); await pending; await f.runner.tick();
      const audit = f.store.policies.audit(actor, policy.id), grant = audit.grants[0] as { status: string; reserveCny: number };
      assert.equal(grant.status, 'revoked'); assert.equal(grant.reserveCny, 0); assert.equal(audit.grants.length, 1);
      assert.equal(f.store.goals.get(actor, goal.id).checkpointRunId, checkpoint);
      assert.equal(f.store.goals.view(actor, goal.id).executions.length, 1); assert.equal(f.calls, 1);
    } finally { response.open(); await pending; await tasks.stop(); await f.close(); await g.close(); }
  }
});
