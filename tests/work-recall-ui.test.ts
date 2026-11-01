import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { transformSync } from 'esbuild';
import type { WorkRecallResult } from '../src/work-recall.js';

// 真实组件的Hook/JSX处理器验证；这里不是DOM、浏览器或真实网络验收。
type Node = { type: unknown; props: Record<string, any> };
const compiled = transformSync(readFileSync('web/src/work-recall.tsx', 'utf8'), { loader: 'tsx', format: 'cjs', jsx: 'automatic' }).code;
function host(api: (path: string, body?: any) => Promise<any>) {
  const values: any[] = [], cleanups: (() => void)[] = [], pending: (() => void)[] = [];
  let cursor = 0; const opened: string[] = [];
  const react = {
    useState(initial: unknown) { const i = cursor++; if (!(i in values)) values[i] = initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    useRef(initial: unknown) { const i = cursor++; return values[i] ??= { current: initial }; },
    useEffect(fn: () => () => void) { const i = cursor++; if (!(i in values)) { values[i] = true; pending.push(() => cleanups.push(fn())); } },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props }), exports = {};
  const sandbox = { exports, module: { exports }, TextEncoder, Date, require: (id: string) => id === 'react' ? react : { jsx, jsxs: jsx, Fragment: 'fragment' } };
  vm.runInNewContext(compiled, sandbox);
  return { opened, render() { cursor = 0; const tree = (sandbox.module.exports as any).WorkRecall({ api, thread: { id: 'thread-a', title: '当前主题' },
    openGoal: (id: string) => opened.push('goal:'+id), openFile: (id: string) => opened.push('file:'+id) }) as Node;
    while (pending.length) pending.shift()!(); return tree; }, close() { for (const cleanup of cleanups) cleanup(); } };
}
function nodes(value: any): Node[] { return !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)]; }
function text(value: any): string { return value == null ? '' : Array.isArray(value) ? value.map(text).join('') : typeof value === 'object' ? text(value.props?.children) : String(value); }
const button = (tree: Node, label: string) => nodes(tree).find(n => n.type === 'button' && text(n).includes(label))!;
const form = (tree: Node) => nodes(tree).find(n => n.type === 'form')!;
const checkbox = (tree: Node) => nodes(tree).find(n => n.type === 'input' && n.props.type === 'checkbox')!;
const query = (tree: Node) => nodes(tree).find(n => n.type === 'textarea')!;
const response = (value = '已验证旧原文'): WorkRecallResult => ({ location: { status: 'located', threads: [], objects: [] }, untrusted: true,
  results: [{ status: 'succeeded', runId: 'old-run', sources: [{ kind: 'run', id: 'old-run', status: 'succeeded' }], excerpt: { text: value, originalBytes: Buffer.byteLength(value), displayBytes: Buffer.byteLength(value), truncated: false } }],
  background: { status: 'not_requested', records: [] }, omitted: { results: 0, historyEntries: 0, sources: 0, background: 0 } });
async function submit(ui: ReturnType<typeof host>) { form(ui.render()).props.onSubmit({ preventDefault() {} }); await delay(5); }

test('R3组件切换query/背景/主题清旧结果，不自动请求；迟到响应及卸载不能覆盖当前范围', async () => {
  let resolveFirst!: (value: WorkRecallResult) => void; const calls: any[] = [];
  const ui = host(async (path, body) => { calls.push({ path, body }); return calls.length === 1 ? new Promise<WorkRecallResult>(done => { resolveFirst = done; }) : response('当前范围原文'); });
  try {
    assert.equal(checkbox(ui.render()).props.checked, false); await submit(ui); assert.equal(calls.length, 1);
    query(ui.render()).props.onChange({ target: { value: '新版查询' } }); assert.equal(text(ui.render()).includes('历史查找结果'), false);
    await submit(ui); resolveFirst(response('迟到旧原文')); await delay(5);
    assert.ok(text(ui.render()).includes('当前范围原文')); assert.ok(!text(ui.render()).includes('迟到旧原文'));
    checkbox(ui.render()).props.onChange({ target: { checked: true } }); assert.ok(!text(ui.render()).includes('当前范围原文')); assert.equal(calls.length, 2);
    await submit(ui); assert.equal(calls.at(-1).body.includeBackground, true);
    nodes(ui.render()).find(n => n.type === 'select')!.props.onChange({ target: { value: '' } }); assert.ok(!text(ui.render()).includes('当前范围原文'));
    query(ui.render()).props.onChange({ target: { value: '中'.repeat(683) } }); assert.equal(button(ui.render(), '查找历史').props.disabled, true);
    let resolveUnmounted!: (value: WorkRecallResult) => void;
    const removed = host(() => new Promise<WorkRecallResult>(done => { resolveUnmounted = done; }));
    await submit(removed); removed.close(); resolveUnmounted(response('卸载后的迟到原文')); await delay(5);
    assert.ok(!text(removed.render()).includes('卸载后的迟到原文'));
  } finally { ui.close(); }
});

test('R3组件明确候选后请求原选择；原Run只在点击后读原接口，正文不补入Recall', async () => {
  const calls: any[] = []; const original = response('受控原摘录');
  const ui = host(async (path, body) => {
    calls.push({ path, body });
    if (path === '/runs/old-run') return { id: 'old-run', status: 'succeeded', output: '单独技术输出', truncated: false };
    if (!body.selection.object) return { ...response(), location: { status: 'clarify', question: '请选择具体记录', threads: [], objects: [{ kind: 'run', id: 'old-run', title: '旧记录', status: 'succeeded', updatedAt: '2026-11-02T00:00:00.000Z' }] }, results: [] };
    return original;
  });
  try { await submit(ui); assert.ok(text(ui.render()).includes('请选择具体记录'));
    button(ui.render(), '选择原Run记录').props.onClick(); await delay(5);
    assert.equal(calls.length, 2); assert.equal(calls[1].body.selection.object.kind, 'run'); assert.equal(calls[1].body.selection.object.id, 'old-run');
    assert.ok(text(ui.render()).includes('原Run记录')); assert.ok(!text(ui.render()).includes('单独技术输出'));
    button(ui.render(), '打开原Run记录').props.onClick(); await delay(5);
    assert.equal(calls.at(-1).path, '/runs/old-run'); assert.ok(text(ui.render()).includes('单独技术输出')); assert.equal(original.results[0]?.excerpt?.text, '受控原摘录');
    assert.ok(text(ui.render()).includes('技术记录')); assert.ok(calls.every(c => c.path === '/work-recall' || c.path === '/runs/old-run'));
  } finally { ui.close(); }
});

test('R3文件结果只显式原审批页入口；Goal/Task原详情分别跳转，0ACK/聊天/控制调用', async () => {
  const calls: any[] = []; let data = response(); data.results = [{ status: 'file_reference', fileOperationId: 'file-id', runId: 'file-run', sources: [{ kind: 'run', id: 'file-run', status: 'succeeded' }] }];
  const ui = host(async (path, body) => { calls.push({ path, body }); return path.startsWith('/tasks/') ? { id: 'old-task', instruction: '最早任务', status: 'succeeded', result: '原任务结果' } : data; });
  try {
    await submit(ui); assert.ok(!button(ui.render(), '打开原Run记录'));
    button(ui.render(), '打开原文件审批页').props.onClick(); assert.deepEqual(ui.opened, ['file:file-id']); assert.equal(calls.length, 1);
    data = response(); data.results[0]!.goalId = 'original-goal'; data.results[0]!.status = 'committed'; data.results[0]!.sources = [{ kind: 'task', id: 'old-task', status: 'succeeded' }];
    await submit(ui); button(ui.render(), '打开原Goal').props.onClick(); assert.equal(ui.opened.at(-1), 'goal:original-goal');
    button(ui.render(), '打开原任务').props.onClick(); await delay(5); assert.equal(calls.at(-1).path, '/tasks/old-task'); assert.ok(text(ui.render()).includes('原任务详情'));
    assert.ok(calls.every(c => c.path === '/work-recall' || c.path === '/tasks/old-task')); assert.ok(text(ui.render()).includes('不执行操作或保存长期记忆'));
  } finally { ui.close(); }
});
