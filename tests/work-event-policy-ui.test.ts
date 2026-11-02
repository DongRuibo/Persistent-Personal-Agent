import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { transformSync } from 'esbuild';
import { webUiFixture } from './helpers/web-ui-fixture.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import type { WebPolicyReceipt } from '../src/goal-policy-types.js';

// 运行真实组件源码的Hook/JSX和定时器处理器，API为真实loopback；这不是DOM/浏览器验收。
type Node = { type: unknown; props: Record<string, any> };
const source = readFileSync(join(process.cwd(), 'web/src/work-events.tsx'), 'utf8');
const compiled = transformSync(source + '\nexport { PolicyApproval as PolicyApprovalForTest };', { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
function host(name: string, initialProps: Record<string, any>) {
  const values: any[] = [], deps: unknown[][] = [], cleanups: any[] = [], effects: (() => void)[] = [], timers = new Map<number, { ms: number; fn: () => void }>();
  let cursor = 0, nextTimer = 0;
  const react = {
    useState(initial: unknown) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], (value: any) => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    useRef(initial: unknown) { const i = cursor++; return values[i] ??= { current: initial }; },
    useEffect(fn: () => any, keys: unknown[]) { const i = cursor++; if (!deps[i] || keys.some((value, n) => value !== deps[i]![n])) { deps[i] = keys; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props: props ?? {} }), exports = {};
  const sandbox = { crypto: { randomUUID }, exports, module: { exports }, require: (id: string) => id === 'react' ? react : { jsx, jsxs: jsx, Fragment: 'fragment' },
    setInterval(fn: () => void, ms: number) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; }, clearInterval(id: number) { timers.delete(id); } };
  vm.runInNewContext(compiled, sandbox);
  return { props: initialProps, render() { cursor = 0; return (sandbox.module.exports as any)[name](this.props) as Node; },
    async flush() { while (effects.length) effects.shift()!(); await delay(40); },
    advance5000() { assert.equal(timers.size, 1); for (const timer of [...timers.values()]) { assert.equal(timer.ms, 5000); timer.fn(); } },
    close() { for (const cleanup of cleanups) cleanup?.(); },
  };
}
function nodes(value: any): Node[] { return value == null || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]; }
function text(value: any): string { return value == null ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value); }
const button = (tree: Node, label: string) => nodes(tree).find(n => n.type === 'button' && text(n).includes(label));
const checkbox = (tree: Node) => nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox')!;
async function fixture() {
  const f = await webUiFixture(undefined, undefined, true, true, true, true); await f.login();
  f.config.proactive = { enabled: true, inputRate: 1, outputRate: 2, dailyCalls: 10, dailyExecutions: 10, dailyBudgetCny: 2, totalExecutions: 20, totalBudgetCny: 4 };
  f.store.policies.configure(f.config.proactive);
  const actor = { ownerId: 'local-user', target: webTarget }, now = () => new Date().toISOString();
  async function api(path: string, body?: any) { const r = await f.request('/api' + path, body); const data = await r.json() as any; if (r.status !== 200) throw Object.assign(new Error(data.error), { status: r.status }); return data; }
  const create = f.store.webUi.accept(webOwner, randomUUID(), '明确创建虚构目标', now());
  let goal = f.store.goals.create(actor, create.id, '按固定来源分析虚构变化', now()); f.store.finishRun(create.id, 'succeeded', now(), '已创建');
  const execution = f.store.goals.claim(actor, goal.id, goal.revision, now())!;
  f.store.goals.commit(execution.run.id, { stepOutcome: 'complete', artifactText: '草稿', progressSummary: '等待审批', question: '请批准', proposedPlan: {
    changeReason: '明确计划', steps: Array.from({ length: 3 }, (_, i) => ({ title: `分析${i}`, instruction: '分析冻结资料', deliverable: '文字', doneWhen: '提交' })),
  } }, now());
  goal = f.store.goals.get(actor, goal.id);
  const approve = f.store.webUi.accept(webOwner, randomUUID(), '批准计划', now());
  goal = f.store.goals.approvePlan({ actor, sourceRunId: approve.id, text: '批准计划', expectedRevision: goal.revision }, goal.id, goal.pendingAction!.hash, now()); f.store.finishRun(approve.id, 'succeeded', now(), '已批准');
  const threadId = randomUUID(); await api('/work-threads', { id: threadId, title: '虚构交互主题' }); await api(`/work-threads/${threadId}/links`, { kind: 'goal', objectId: goal.id, action: 'link' });
  const source = await api('/work-event-sources', { requestId: randomUUID(), watch: { kind: 'github', repository: 'fiction/agent', branch: 'main', intervalSeconds: 60 } });
  const sub = await api('/work-event-subscriptions', { id: randomUUID(), sourceId: source.id, threadId, goalId: goal.id });
  let loseAction = '', lost: WebPolicyReceipt | null = null, contextDelay = 0;
  const posts: any[] = [];
  const uiApi = async (path: string, body?: any) => { if (body) posts.push(JSON.parse(JSON.stringify(body))); const receipt = await api(path, body); if (!body && contextDelay) { const ms = contextDelay; contextDelay = 0; await delay(ms); } if (body?.action === loseAction) { loseAction = ''; lost = receipt; throw new Error('模拟HTTP200响应丢失'); } return receipt; };
  const parent = host('WorkEvents', { api: uiApi, thread: await api(`/work-threads/${threadId}`), openGoal() {} }); parent.render(); await parent.flush();
  let childNode = nodes(parent.render()).find(n => typeof n.type === 'function')!;
  const ui = host('PolicyApprovalForTest', childNode.props); ui.render(); await ui.flush();
  async function refresh5000() { parent.advance5000(); parent.render(); await parent.flush(); childNode = nodes(parent.render()).find(n => typeof n.type === 'function')!; ui.props = childNode.props; ui.render(); await ui.flush(); ui.render(); await ui.flush(); return ui.render(); }
  return { f, api, ui, posts, actor, source, sub, refresh5000, get goal() { return goal; }, get lost() { return lost; }, lose(action: string) { loseAction = action; }, delayNextContext(ms: number) { contextDelay = ms; },
    async revise() { const current = f.store.goals.get(actor, goal.id), run = f.store.webUi.accept(webOwner, randomUUID(), '明确改为新版计划', now());
      let next = f.store.goals.proposePlan({ actor, sourceRunId: run.id, text: '明确改为新版计划', expectedRevision: current.revision }, goal.id, { changeReason: '当前用户明确换版', steps: [{ title: '新版分析', instruction: '分析新版范围', deliverable: '文字', doneWhen: '提交' }] }, now()); f.store.finishRun(run.id, 'succeeded', now(), '草稿');
      const approved = f.store.webUi.accept(webOwner, randomUUID(), '明确批准新版', now()); next = f.store.goals.approvePlan({ actor, sourceRunId: approved.id, text: '批准新版计划', expectedRevision: next.revision }, next.id, next.pendingAction!.hash, now()); f.store.finishRun(approved.id, 'succeeded', now(), '已批准'); goal = next;
    },
    async close() { ui.close(); parent.close(); await f.close(); },
  };
}
async function fill(ui: ReturnType<typeof host>, expiry = '2026-12-01T00:00') {
  for (const input of nodes(ui.render()).filter(n => n.type === 'input' && n.props.type !== 'checkbox')) input.props.onChange({ target: { value: input.props.type === 'datetime-local' ? expiry : '5' } });
  nodes(ui.render()).find(n => n.type === 'form')!.props.onChange();
  ui.render(); await ui.flush();
  checkbox(ui.render()).props.onChange({ target: { checked: true }, stopPropagation() {} });
  ui.render(); await ui.flush();
}
// 处理器以void发起请求；等待可见的原请求按钮恢复，不能用固定延时冒充异步完成。
async function waitRequest(ui: ReturnType<typeof host>) {
  const deadline = Date.now() + 5000;
  while (button(ui.render(), '恢复原请求并查询结果')?.props.disabled) {
    assert.ok(Date.now() < deadline, '原请求处理未结束'); await delay(5);
  }
}
async function click(ui: ReturnType<typeof host>, label: string) { const b = button(ui.render(), label); assert.ok(b, label); assert.ok(!b.props.disabled, label + ' disabled'); await b.props.onClick(); await waitRequest(ui); }
async function submit(ui: ReturnType<typeof host>) { nodes(ui.render()).find(n => n.type === 'form')!.props.onSubmit({ preventDefault() {} }); await waitRequest(ui); }

test('E3-R1-01：合法Plan换版与5秒真实组件轮询清除旧同意，提交处理器也拒绝沿用；新版须重勾选', async () => {
  const x = await fixture();
  try { await fill(x.ui); assert.equal(checkbox(x.ui.render()).props.checked, true); await x.revise(); await x.refresh5000();
    assert.equal(x.goal.planRevision, 2); assert.equal(checkbox(x.ui.render()).props.checked, false);
    assert.equal(button(x.ui.render(), '独立批准此执行Policy')!.props.disabled, true);
    await submit(x.ui); assert.equal(x.posts.length, 0, '即使调用当前提交处理器也不能借旧同意批准');
    checkbox(x.ui.render()).props.onChange({ target: { checked: true }, stopPropagation() {} });
    assert.equal(checkbox(x.ui.render()).props.checked, true);
    const pausedSource = await x.api(`/work-event-sources/${x.source.id}`, { status: 'paused', expectedRevision: 1 });
    await x.api(`/work-event-sources/${x.source.id}`, { status: 'active', expectedRevision: pausedSource.revision }); await x.refresh5000();
    assert.equal(checkbox(x.ui.render()).props.checked, false, '来源版本变化也使旧同意失效');
    checkbox(x.ui.render()).props.onChange({ target: { checked: true }, stopPropagation() {} });
    assert.equal(checkbox(x.ui.render()).props.checked, true);
    const pausedSub = await x.api(`/work-event-subscriptions/${x.sub.id}`, { status: 'paused', expectedRevision: 1 });
    await x.api(`/work-event-subscriptions/${x.sub.id}`, { status: 'active', expectedRevision: pausedSub.revision }); await x.refresh5000();
    assert.equal(checkbox(x.ui.render()).props.checked, false, '订阅版本变化也使旧同意失效');
    await submit(x.ui); assert.equal(x.posts.length, 0);
    checkbox(x.ui.render()).props.onChange({ target: { checked: true }, stopPropagation() {} }); await submit(x.ui);
    assert.equal(x.posts.length, 1); assert.equal(x.posts[0].proposal.planRevision, 2); assert.equal(x.f.payloads.length, 0);
  } finally { await x.close(); }
});

test('E3-R1-02：批准/撤销响应丢失后5秒刷新仍独立恢复原收据；新Plan表单不复用旧pending', async () => {
  const x = await fixture();
  try {
    await fill(x.ui); x.lose('approve'); await submit(x.ui); const approved = x.lost!; const original = structuredClone(x.posts[0]);
    await x.refresh5000(); assert.ok(button(x.ui.render(), '恢复原请求并查询结果'), 'active时原请求入口仍可达');
    const path = `/work-event-subscriptions/${x.sub.id}/policy`, context = await x.api(path);
    await x.api(path, { requestId: randomUUID(), expectedSubscriptionRevision: context.subscription.revision, action: 'revoke', policyId: context.policy.id, expectedVersion: context.policy.version });
    await x.revise(); await x.refresh5000();
    await fill(x.ui); await submit(x.ui); assert.equal(x.posts.length, 1, '新表单不能发送或替换旧pending');
    await click(x.ui, '恢复原请求并查询结果'); assert.deepEqual(x.posts[1], original); assert.ok(text(x.ui.render()).includes(approved.runId));
    assert.equal(x.f.store.policies.audit(x.actor, approved.policy!.id).events.filter(e => (e as any).action === 'approved').length, 1);
    await click(x.ui, '已核对原收据'); assert.equal(checkbox(x.ui.render()).props.checked, false);
    x.delayNextContext(180);
    await fill(x.ui); await submit(x.ui); const next = x.posts.at(-1); assert.notEqual(next.requestId, original.requestId); assert.equal(next.proposal.planRevision, 2);
    await click(x.ui, '已核对原收据'); await x.refresh5000(); x.lose('revoke'); await click(x.ui, '撤销Policy'); const revoked = x.lost!; const revokeRequest = structuredClone(x.posts.at(-1));
    await x.refresh5000(); assert.ok(button(x.ui.render(), '恢复原请求并查询结果'), 'revoked时原请求入口仍可达');
    await click(x.ui, '恢复原请求并查询结果'); assert.deepEqual(x.posts.at(-1), revokeRequest); assert.ok(text(x.ui.render()).includes(revoked.runId));
    assert.equal(x.f.store.policies.audit(x.actor, revoked.policy!.id).events.filter(e => (e as any).action === 'revoke').length, 1);
    await click(x.ui, '已核对原收据'); assert.equal(x.f.payloads.length, 0);
  } finally { await x.close(); }
});

test('E3-R2明确校验拒绝可结束本页跟踪，编辑不会静默删除未确认请求，新明确同意使用新requestId', async () => {
  const x = await fixture();
  try { await fill(x.ui, '2020-01-01T00:00'); await submit(x.ui); assert.equal(x.posts.length, 1);
    assert.ok(button(x.ui.render(), '结束跟踪')); await fill(x.ui); assert.ok(button(x.ui.render(), '恢复原请求并查询结果'), '编辑不能丢弃原请求');
    await click(x.ui, '结束跟踪'); assert.match(text(x.ui.render()), /不代表取消或撤销服务器操作/); assert.equal(checkbox(x.ui.render()).props.checked, false);
    await fill(x.ui); await submit(x.ui); assert.equal(x.posts.length, 2); assert.notEqual(x.posts[1].requestId, x.posts[0].requestId); assert.equal(x.f.payloads.length, 0);
  } finally { await x.close(); }
});
