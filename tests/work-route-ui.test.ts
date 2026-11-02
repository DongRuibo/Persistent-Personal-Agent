import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { transformSync } from 'esbuild';
import type { WebWorkRoute } from '../src/web-ui-types.js';

// 真实App与卡片处理器的Hook/fetch宿主；不是DOM或实际浏览器断网。
function view(revoked = false): WebWorkRoute {
  return { requestId: randomUUID(), text: '冻结原文'+randomUUID(), selection: {}, revoked, job: null, error: null,
    suggestion: { kind: 'work', threadId: randomUUID(), reason: '整理' },
    run: { id: randomUUID(), taskId: null, mode: 'suggest', status: 'succeeded', startedAt: '2026-11-02T00:00:00.000Z',
      finishedAt: null, output: '整理', error: null, viewed: false, truncated: false,
      usage: { calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cost: null } } };
}
function host(views: WebWorkRoute[], shared = { suggestions: structuredClone(views) }) {
  const snapshot: any = { chats: [], tasks: [], goals: [], files: [], activity: [], inbox: [],
    capabilities: { goal: false, skills: [], workThreads: true, workJobs: true, workRouting: true, busy: false } };
  const states: any[] = [], refs: any[] = [], calls: { path: string; body: any }[] = [];
  let cursor = 0, rootRender: any, fail: boolean | string[] = false, WorkRouteCard: any, chatTimeline: any;
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const sandbox: any = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, AbortSignal, TextEncoder,
    crypto: { randomUUID }, location: { hash: '#chat' }, window: { scrollTo() {} }, document: { getElementById: () => ({}), visibilityState: 'visible' },
    require(name: string) {
      if (name === 'react') return {
        useState(initial: unknown) { const i = cursor++; if (!(i in states)) states[i] = initial;
          return [states[i], (value: any) => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
        useRef(initial: unknown) { return refs[cursor++] ??= { current: initial }; }, useEffect() {}, useCallback: (fn: unknown) => fn,
      };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
      if (name === 'react-dom/client') return { createRoot: () => ({ render: (value: unknown) => { rootRender = value; } }) };
      if (name === './work-routes.js') return { WorkRouteCard };
      if (name === './chat-timeline.js') return { chatTimeline };
      return new Proxy({}, { get: () => function Stub() {} });
    },
    async fetch(path: string, options: any) {
      const body = options?.body ? JSON.parse(options.body) : null; calls.push({ path, body });
      let value: any = {};
      if (path === '/api/snapshot') value = { ...snapshot, suggestions: shared.suggestions };
      else if (path.endsWith('/revoke')) {
        if (fail === true || Array.isArray(fail) && fail.includes(path.split('/')[3]!)) throw new Error('模拟撤销网络失败');
        const target = shared.suggestions.find(v => v.requestId === path.split('/')[3]);
        if (target) target.revoked = true; value = target;
      } else if (path.endsWith('/confirm')) {
        const target = shared.suggestions.find(v => v.requestId === path.split('/')[3])!;
        assert.equal(target.revoked, false); value = target.job = { id: randomUUID(), threadId: target.suggestion!.kind === 'work' ? target.suggestion!.threadId : '',
          requestId: target.requestId, instruction: target.text, status: 'queued', createdAt: '2026-11-02T00:00:00.000Z' } as WebWorkRoute['job'];
      } else if (path === '/api/work-routes') {
        value = { ...view(), requestId: body.requestId, text: body.text, selection: body.selection }; shared.suggestions.push(value);
      }
      return { ok: true, json: async () => structuredClone(value) };
    },
  };
  vm.createContext(sandbox);
  function evaluate(path: string, source = readFileSync(path, 'utf8')) {
    sandbox.module = { exports: {} }; sandbox.exports = sandbox.module.exports;
    vm.runInContext(transformSync(source, { loader: path.endsWith('.tsx') ? 'tsx' : 'ts', format: 'cjs', jsx: 'automatic' }).code, sandbox);
    return sandbox.module.exports;
  }
  WorkRouteCard = evaluate('web/src/work-routes.tsx').WorkRouteCard;
  chatTimeline = evaluate('web/src/chat-timeline.ts').chatTimeline;
  const source = readFileSync('web/src/main.tsx', 'utf8');
  const instrumented = source.replace('  const filesPending =', `  globalThis.__handlers = { refresh, changeDraft, requestRoute, revokeRoute, routeToChat, currentRoute };
  globalThis.__state = { draft, revokeRetry, routeRetry };
  const filesPending =`);
  assert.notEqual(instrumented, source); evaluate('web/src/main.tsx', instrumented);
  const render = () => { cursor = 0; return rootRender.type(); };
  function nodes(value: any): any[] { return !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]; }
  const card = (tree: any, id: string) => nodes(tree).find(n => n.type === WorkRouteCard && n.props.view.requestId === id);
  const details = (tree: any, id: string) => nodes(WorkRouteCard(card(tree, id).props));
  const enabled = (tree: any, id: string) => {
    const button = details(tree, id).find(n => n.type === 'button' && n.props.children === '确认该原文后台处理');
    return !!button && !button.props.disabled;
  };
  render(); states[0] = true; states[6] = 'chat';
  return { render, nodes, card, details, enabled, calls, get handlers() { return sandbox.__handlers; }, get state() { return sandbox.__state; },
    get serverViews() { return structuredClone(shared.suggestions); }, fail(value: boolean | string[]) { fail = value; } };
}

for (const revoked of [false, true]) test(`历史建议回填（历史revoked=${revoked}）保留双方撤销重试，刷新双方不复活`, async () => {
  const previous = view(revoked), current = view(), h = host([previous, current]);
  await h.handlers.refresh(); let tree = h.render(); assert.equal(h.enabled(tree, current.requestId), true);
  h.fail(true); h.card(tree, previous.requestId).props.onChat(); await tick(); tree = h.render();
  assert.equal(h.state.draft, previous.text); assert.equal(h.enabled(tree, current.requestId), false);
  assert.equal(h.state.revokeRetry.requestId, current.requestId);
  const expected = revoked ? [current.requestId] : [current.requestId, previous.requestId];
  assert.deepEqual(h.calls.filter(c => c.path.endsWith('/revoke')).map(c => c.path), expected.map(id => `/api/work-routes/${id}/revoke`));
  h.fail(false); await h.handlers.revokeRoute(h.state.revokeRetry); h.render(); assert.equal(h.state.revokeRetry, null);
  if (!revoked) { const retry = h.nodes(h.render()).find(n => n.type === 'button' && n.props.children === '重试撤销历史建议'); assert.ok(retry); retry.props.onClick(); await tick(); }
  assert.equal(h.serverViews.find(v => v.requestId === current.requestId)?.revoked, true);
  const reload = host(h.serverViews); await reload.handlers.refresh(); tree = reload.render(); assert.equal(reload.enabled(tree, current.requestId), false);
  assert.equal(reload.enabled(tree, previous.requestId), false);
});

test('当前建议回填/改字改主题改对象仍只撤销原ID', async () => {
  for (const action of ['chat', 'edit', 'work-job-thread', 'work-route-object']) {
    const current = view(), h = host([current]); await h.handlers.refresh(); h.render();
    if (action === 'chat') h.handlers.routeToChat(current);
    else if (action === 'edit') h.handlers.changeDraft('改字');
    else h.nodes(h.render()).find(n => n.props?.id === action).props.onChange({ target: { value: randomUUID() } });
    await tick(); assert.equal(h.serverViews[0]?.revoked, true);
    assert.deepEqual(h.calls.filter(c => c.path.endsWith('/revoke')).map(c => c.path), [`/api/work-routes/${current.requestId}/revoke`]);
  }
});

test('双页面从空快照顺序完成A/B，无网络故障；历史A回填后刷新双方不可确认', async () => {
  const shared = { suggestions: [] as WebWorkRoute[] }, a = host([], shared), b = host([], shared);
  await a.handlers.refresh(); a.render(); await b.handlers.refresh(); b.render();
  a.handlers.changeDraft('页面一原文A'); a.render(); await a.handlers.requestRoute(); a.render(); const A = a.serverViews[0]!;
  await b.handlers.refresh(); b.render(); assert.equal(b.handlers.currentRoute.current, null);
  b.handlers.changeDraft('页面二原文B'); b.render(); await b.handlers.requestRoute(); let tree = b.render(); const B = b.serverViews[1]!;
  assert.equal(b.enabled(tree, A.requestId), false); assert.equal(b.enabled(tree, B.requestId), true);
  b.details(tree, A.requestId).find(n => n.type === 'button' && n.props.children === '原文放回聊天输入框')!.props.onClick(); await tick(); tree = b.render();
  assert.equal(b.state.draft, A.text); assert.ok(b.serverViews.every(v => v.revoked));
  assert.equal(b.calls.filter(c => c.path.endsWith('/revoke')).length, 2);
  const reload = host(b.serverViews); await reload.handlers.refresh(); tree = reload.render();
  for (const v of [A, B]) assert.equal(reload.enabled(tree, v.requestId), false);
  assert.equal(reload.calls.filter(c => c.path.endsWith('/confirm')).length, 0);
});

test('A/B单方或双方失败，各重试顺序均保留另一待确认提示，恢复后双方持久失效', async () => {
  for (const failures of ['A', 'B', 'AB']) for (const order of ['AB', 'BA']) {
    const A = view(), B = view(), h = host([A, B]); await h.handlers.refresh(); let tree = h.render();
    h.fail([...(failures.includes('A') ? [A.requestId] : []), ...(failures.includes('B') ? [B.requestId] : [])]);
    h.details(tree, A.requestId).find(n => n.type === 'button' && n.props.children === '原文放回聊天输入框')!.props.onClick(); await tick(); tree = h.render();
    const label = { A: '重试撤销历史建议', B: '重试撤销建议' }, button = (name: 'A' | 'B') => h.nodes(h.render()).find(n => n.type === 'button' && n.props.children === label[name]);
    for (const name of ['A', 'B'] as const) assert.equal(!!button(name), failures.includes(name));
    assert.ok(h.nodes(tree).find(n => n.type === 'button' && n.props.children === '路由建议')!.props.disabled);
    assert.ok(h.details(tree, A.requestId).filter(n => n.type === 'button').every(n => n.props.disabled));
    for (const name of order as Iterable<'A' | 'B'>) {
      if (!button(name)) continue;
      h.fail(false); button(name)!.props.onClick(); await tick(); h.render(); assert.ok(!button(name));
      const other = name === 'A' ? 'B' : 'A';
      if (failures === 'AB' && !h.serverViews.find(v => v.requestId === (other === 'A' ? A.requestId : B.requestId))!.revoked) assert.ok(button(other), '一个成功不得清除另一个待重试入口');
    }
    assert.ok(h.serverViews.every(v => v.revoked)); const reload = host(h.serverViews); await reload.handlers.refresh(); tree = reload.render();
    assert.equal(reload.enabled(tree, A.requestId), false); assert.equal(reload.enabled(tree, B.requestId), false);
  }
});

test('当前空的历史A仍持久撤销；真实已确认Job历史无回填按钮且不取消Job', async () => {
  const shared = { suggestions: [] as WebWorkRoute[] }, h = host([], shared); await h.handlers.refresh(); h.render();
  const A = view(); shared.suggestions.push(A); await h.handlers.refresh(); let tree = h.render(); assert.equal(h.handlers.currentRoute.current, null);
  h.details(tree, A.requestId).find(n => n.type === 'button' && n.props.children === '原文放回聊天输入框')!.props.onClick(); await tick();
  assert.equal(h.serverViews[0]?.revoked, true);
  const current = view(), j = host([current]); await j.handlers.refresh(); tree = j.render();
  j.details(tree, current.requestId).find(n => n.type === 'button' && n.props.children === '确认该原文后台处理')!.props.onClick(); await tick(); tree = j.render();
  const job = j.serverViews[0]?.job; assert.ok(job);
  assert.ok(!j.details(tree, current.requestId).some(n => n.type === 'button' && n.props.children === '原文放回聊天输入框'));
  j.handlers.changeDraft('新聊天输入'); j.render(); await j.handlers.requestRoute(); j.render();
  j.handlers.changeDraft('再次改字'); await tick(); j.render(); assert.deepEqual(j.serverViews[0]?.job, job);
  assert.ok(!j.calls.some(c => c.path.includes(`/work-routes/${current.requestId}/revoke`) || c.path.includes('/cancel')));
});

for (const failures of ['', 'A', 'B', 'AB']) for (const order of ['AB', 'BA']) test(`手动撤销历史A后编辑当前B：失败=${failures || '无'}，重试顺序=${order}，刷新双方不复活`, async () => {
  const shared = { suggestions: [] as WebWorkRoute[] }, first = host([], shared), h = host([], shared);
  await first.handlers.refresh(); first.render(); await h.handlers.refresh(); h.render();
  first.handlers.changeDraft('另一页面的A'); first.render(); await first.handlers.requestRoute(); first.render(); const A = first.serverViews[0]!;
  await h.handlers.refresh(); h.render(); assert.equal(h.handlers.currentRoute.current, null);
  h.handlers.changeDraft('当前页面的B'); h.render(); await h.handlers.requestRoute(); let tree = h.render(); const B = h.serverViews[1]!;
  h.fail([...(failures.includes('A') ? [A.requestId] : []), ...(failures.includes('B') ? [B.requestId] : [])]);
  const revoke = h.details(tree, A.requestId).find(n => n.type === 'button' && n.props.children === '撤销建议')!;
  assert.equal(!!revoke.props.disabled, false); revoke.props.onClick(); await tick(); tree = h.render();
  const textarea = h.nodes(tree).find(n => n.type === 'textarea')!; assert.equal(!!textarea.props.disabled, false);
  textarea.props.onChange({ target: { value: '转去普通聊天的新文字' } }); await tick(); tree = h.render();
  const label = { A: '重试撤销历史建议', B: '重试撤销建议' }, button = (name: 'A' | 'B') => h.nodes(h.render()).find(n => n.type === 'button' && n.props.children === label[name]);
  for (const name of ['A', 'B'] as const) assert.equal(!!button(name), failures.includes(name), name+'的失败必须保留对应重试按钮');
  const sendChat = failures === 'AB' && order === 'BA';
  if (sendChat) {
    const submit = h.nodes(tree).find(n => n.type === 'button' && n.props['aria-label'] === '发送消息')!;
    assert.equal(!!submit.props.disabled, false);
    h.nodes(tree).find(n => n.type === 'form' && n.props.className === 'composer')!.props.onSubmit({ preventDefault() {} }); await tick(); tree = h.render();
    assert.equal(h.calls.filter(c => c.path === '/api/chat' && c.body.text === '转去普通聊天的新文字').length, 1);
    assert.ok(button('A')); assert.ok(button('B'));
  }
  for (const name of order as Iterable<'A' | 'B'>) {
    if (!button(name)) continue;
    h.fail(false); assert.equal(!!button(name)!.props.disabled, false); button(name)!.props.onClick(); await tick(); tree = h.render();
    assert.ok(!button(name));
    const other = name === 'A' ? 'B' : 'A', otherId = other === 'A' ? A.requestId : B.requestId;
    if (failures.includes(other) && !h.serverViews.find(v => v.requestId === otherId)!.revoked) {
      assert.ok(button(other)); assert.ok(h.nodes(tree).some(n => n.type === 'p' && n.props.children === (other === 'A' ? '历史建议撤销尚未确认。' : '当前建议撤销尚未确认。')));
    }
  }
  assert.equal(h.state.draft, sendChat ? '' : '转去普通聊天的新文字'); assert.ok(h.serverViews.every(v => v.revoked));
  for (const v of [A, B]) {
    const requests = h.calls.filter(c => c.path === `/api/work-routes/${v.requestId}/revoke`);
    assert.equal(requests.length, failures.includes(v === A ? 'A' : 'B') ? 2 : 1);
    assert.ok(requests.every(c => c.body.text === v.text && JSON.stringify(c.body.selection) === JSON.stringify(v.selection)));
  }
  const reload = host(h.serverViews); await reload.handlers.refresh(); tree = reload.render();
  assert.equal(reload.enabled(tree, A.requestId), false); assert.equal(reload.enabled(tree, B.requestId), false);
  assert.equal(h.calls.filter(c => c.path.endsWith('/confirm')).length, 0);
});

test('手动撤销当前卡片保持当前重试槽，当前空的历史卡片使用历史槽', async () => {
  for (const current of [true, false]) {
    const A = view(), shared = { suggestions: current ? [A] : [] as WebWorkRoute[] }, h = host([], shared);
    await h.handlers.refresh(); h.render(); if (!current) { shared.suggestions.push(A); await h.handlers.refresh(); }
    let tree = h.render(); h.fail(true);
    const revoke = h.details(tree, A.requestId).find(n => n.type === 'button' && n.props.children === '撤销建议')!;
    assert.equal(!!revoke.props.disabled, false); revoke.props.onClick(); await tick(); tree = h.render();
    const input = h.nodes(tree).find(n => n.type === 'textarea')!; assert.equal(!!input.props.disabled, false);
    input.props.onChange({ target: { value: '正常编辑' } }); await tick(); tree = h.render();
    assert.equal(h.calls.filter(c => c.path.endsWith('/revoke')).length, 1);
    const retries = h.nodes(tree).filter(n => n.type === 'button' && ['重试撤销建议', '重试撤销历史建议'].includes(n.props.children));
    assert.equal(retries.length, 1); assert.equal(retries[0]!.props.children, current ? '重试撤销建议' : '重试撤销历史建议');
    h.fail(false); retries[0]!.props.onClick(); await tick(); assert.equal(h.serverViews[0]?.revoked, true);
    const reload = host(h.serverViews); await reload.handlers.refresh(); assert.equal(reload.enabled(reload.render(), A.requestId), false);
  }
});
