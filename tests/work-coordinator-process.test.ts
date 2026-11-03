import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { content, reply, toolCall, type Payload } from './helpers/skills-fixture.js';
import { isWorkParse } from './helpers/work-manage-fixture.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';

const coordinatorEnv = { WORK_COORDINATOR_ENABLED: 'true', WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true' };

test('真实main在Job已提交但Chat未finish时强杀：off可回读，on仅执行原Job一次，不重放Chat/解析', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'coordinator-committed-main-')), text = '整理面试：CRASH_AFTER_JOB_COMMIT_ONLY。';
  const http: { kind: string; payload: Payload }[] = [];
  let release!: () => void, entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; }), finalizing = new Promise<void>(resolve => { entered = resolve; });
  const model = httpServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const payload = JSON.parse(body) as Payload;
    const kind = isWorkParse(payload) ? 'parse' : payload.tools?.some(tool => tool.function.name === 'work_manage') ? 'chat' : 'worker';
    http.push({ kind, payload }); let response: string;
    if (kind === 'parse') response = reply(JSON.stringify({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试', quotes: [text] }] }));
    else if (kind === 'worker') response = reply('COMMITTED_JOB_RESULT_ONLY');
    else if (payload.messages.at(-1)?.role !== 'tool') response = toolCall('work_manage', {});
    else { entered(); await hold; response = reply('不应跨重启重放的Chat收尾'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response);
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const ma = model.address(); assert.ok(ma && typeof ma !== 'string'); const modelPort = ma.port;
  const socket = netServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const sa = socket.address(); assert.ok(sa && typeof sa !== 'string');
  const port = sa.port; assert.notEqual(port, 4318); await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://127.0.0.1:${port}`, key = 'fake-committed-process-key-at-least-32bytes';
  const children: { child: ChildProcess; output(): string; exited: Promise<unknown[]> }[] = [];
  function launch(enabled: boolean) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "process.argv=['node','committed-process.ts','--web-ui'];process.on('message',()=>process.emit('SIGINT'));const {main}=await import('./src/main.ts');try{await main();process.disconnect();}catch(e){console.error(e.message);process.exit(1);}"], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), ...coordinatorEnv,
        WORK_COORDINATOR_ENABLED: String(enabled), WORK_JOBS_ENABLED: String(enabled), WORK_ROUTING_ENABLED: 'false', WORK_EVENTS_ENABLED: 'false',
        WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: key, WEB_UI_PORT: String(port), WEB_UI_HOST: '127.0.0.1', WEB_UI_DATA_DIR: root,
        LLM_API_KEY: 'fake-committed-process-llm', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
        GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', POLL_INTERVAL_MS: '30', EXECUTION_TIMEOUT_MS: '15000',
        MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false', WEB_SEARCH_ENABLED: 'false',
        LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' },
    });
    let output = ''; child.stdout!.on('data', part => { output += String(part); }); child.stderr!.on('data', part => { output += String(part); });
    const result = { child, output: () => output, exited: once(child, 'exit') }; children.push(result); return result;
  }
  async function until(check: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 300; i++) { if (await check()) return; await delay(20); }
    assert.fail('提交后崩溃窗口等待超时：' + children.map(c => c.output()).join('\n'));
  }
  let cookie = '', csrf = '';
  const api = (path: string, body?: unknown) => fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function login() { const response = await api('/login', { key }); assert.equal(response.status, 200); cookie = response.headers.get('set-cookie')!.split(';')[0]!; csrf = (await response.json() as { csrf: string }).csrf; }
  async function receipt(id: string) { const response = await api(`/chat-requests/${id}`); assert.equal(response.status, 200); return response.json() as Promise<WebRequestReceipt>; }
  async function stop(child: ReturnType<typeof launch>) { child.child.send('stop'); assert.deepEqual(await child.exited, [0, null], child.output()); }
  try {
    const first = launch(true); await until(() => first.output().includes('模式=web-ui')); await login();
    const requestId = randomUUID(), accepted = await api('/chat', { requestId, text }); assert.equal(accepted.status, 202); await finalizing;
    const before = await receipt(requestId), item = before.items[0]!; assert.equal(before.run?.status, 'running'); assert.equal(item.permission, 'consumed'); assert.ok(item.consumedByJobId);
    const jobId = item.consumedByJobId!, db = new DatabaseSync(join(root, 'agent.db'), { readOnly: true });
    const committed = db.prepare('SELECT id,rootJobId,status,runId,sourceItemId FROM work_jobs WHERE id=?').get(jobId); db.close();
    assert.deepEqual({ ...committed }, { id: jobId, rootJobId: jobId, status: 'queued', runId: null, sourceItemId: item.itemId });
    assert.deepEqual(http.map(call => call.kind), ['chat', 'parse', 'chat']);
    first.child.kill('SIGKILL'); assert.deepEqual(await first.exited, [null, 'SIGKILL']); release();
    // 等原临时锁自然陈旧，不删除锁，也不把模拟终态当进程恢复。
    await delay(10500);
    // 同时关协调和后台Job执行，才能证明此阶段只回读；单关协调不停止已建普通Job。
    const off = launch(false); await until(() => off.output().includes('模式=web-ui')); await login();
    const recovered = await receipt(requestId); assert.equal(recovered.runId, before.runId); assert.equal(recovered.run?.status, 'interrupted');
    assert.equal(recovered.items[0]?.itemId, item.itemId); assert.equal(recovered.items[0]?.consumedByJobId, jobId); assert.equal(recovered.items[0]?.permission, 'consumed');
    const frozen = new DatabaseSync(join(root, 'agent.db'), { readOnly: true }); assert.equal(frozen.prepare('SELECT status FROM work_jobs WHERE id=?').get(jobId)?.status, 'queued'); frozen.close();
    await delay(100); assert.equal(http.length, 3); await stop(off);
    const on = launch(true); await until(() => on.output().includes('模式=web-ui')); await login();
    await until(async () => { const result = await api(`/work-jobs/${jobId}`); return (await result.json() as { status: string }).status === 'succeeded'; });
    const work = await (await api(`/work-jobs/${jobId}`)).json() as { id: string; runId: string; run: { output: string } };
    assert.equal(work.run.output, 'COMMITTED_JOB_RESULT_ONLY'); assert.deepEqual(http.map(call => call.kind), ['chat', 'parse', 'chat', 'worker']);
    assert.ok(JSON.stringify(http[3]!.payload).includes('CRASH_AFTER_JOB_COMMIT_ONLY')); assert.equal(http[3]!.payload.tools, undefined);
    const repeated = await api('/chat', { requestId, text }); assert.equal(repeated.status, 202); const old = await repeated.json() as WebRequestReceipt;
    assert.equal(old.runId, before.runId); assert.equal(old.run?.status, 'interrupted'); assert.equal(old.items[0]?.consumedByJobId, jobId); await stop(on);
    const final = launch(true); await until(() => final.output().includes('模式=web-ui')); await login(); await delay(100);
    assert.equal(http.length, 4); const last = await (await api(`/work-jobs/${jobId}`)).json() as { id: string; runId: string };
    assert.equal(last.runId, work.runId); assert.equal((await receipt(requestId)).items.length, 1);
    const end = new DatabaseSync(join(root, 'agent.db'), { readOnly: true }); assert.equal(end.prepare('SELECT count(*) AS n FROM work_jobs').get()?.n, 1); assert.equal(end.prepare('SELECT count(*) AS n FROM web_request_items').get()?.n, 1); end.close();
    await stop(final); assert.equal(existsSync(join(root, 'agent.db.lock')), false);
    t.diagnostic(JSON.stringify({ window: 'job_committed_chat_running', offSwitches: { coordinator: false, workJobs: false }, before, committed, recovered, rootJobId: jobId, workerRunId: work.runId, http, mainStarts: 4, childOutputs: children.map(child => child.output()), formalRequests: 0 }));
  } finally {
    release(); for (const child of children) if (child.child.exitCode === null && child.child.signalCode === null) { child.child.kill('SIGKILL'); await child.exited; }
    model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); rmSync(root, { recursive: true, force: true });
  }
});

test('真实main在非Web模式拒绝协调开关，尚未打开业务数据', () => {
  const root = mkdtempSync(join(tmpdir(), 'coordinator-reject-'));
  try {
    const r = spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts', '--daemon'], {
      env: { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), ...coordinatorEnv, DATABASE_PATH: join(root, 'never-created.db') }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(r.status, 1); assert.match(r.stderr, /WORK_COORDINATOR_ENABLED 仅支持 --web-ui/);
    assert.equal(existsSync(join(root, 'never-created.db')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('真实main强杀/关闭/重开：只有queued跨重启领取，claimed中断不重放；收据与取消保留', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'coordinator-main-')), inputs: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const model = httpServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const payload = JSON.parse(raw) as Payload, current = content(payload.messages.findLast(m => m.role === 'user')?.content);
    const label = current.match(/COORDINATOR_[A-Z_]+/u)?.[0] ?? current;
    inputs.push(label);
    if (label === 'COORDINATOR_CRASH_CLAIMED') await hold;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(reply('离线进程合成回复'));
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const ma = model.address(); assert.ok(ma && typeof ma !== 'string');
  const socket = netServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const sa = socket.address(); assert.ok(sa && typeof sa !== 'string');
  const port = sa.port; assert.notEqual(port, 4318); await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://127.0.0.1:${port}`, key = 'fake-coordinator-process-key-at-least-32bytes';
  const children: { child: ChildProcess; output(): string; exited: Promise<unknown[]> }[] = [];
  function launch(enabled: boolean) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "process.argv=['node','coordinator-process.ts','--web-ui']; process.on('message',()=>process.emit('SIGINT')); const {main}=await import('./src/main.ts'); try{await main();process.disconnect();}catch(e){console.error(e.message);process.exit(1);}"], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(), ...coordinatorEnv,
        WORK_COORDINATOR_ENABLED: String(enabled), WORK_ROUTING_ENABLED: 'false', WORK_EVENTS_ENABLED: 'false',
        WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: key, WEB_UI_PORT: String(port), WEB_UI_HOST: '127.0.0.1', WEB_UI_DATA_DIR: root,
        LLM_API_KEY: 'fake-coordinator-process-llm', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${ma && typeof ma !== 'string' ? ma.port : 0}/v1`,
        GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', POLL_INTERVAL_MS: '30', EXECUTION_TIMEOUT_MS: '15000',
        MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false', WEB_SEARCH_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' },
    });
    let output = ''; child.stdout!.on('data', p => { output += String(p); }); child.stderr!.on('data', p => { output += String(p); });
    const result = { child, output: () => output, exited: once(child, 'exit') }; children.push(result); return result;
  }
  async function until(check: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 300; i++) { if (await check()) return; await delay(20); }
    assert.fail('等待超时：' + children.map(c => c.output()).join('\n'));
  }
  let cookie = '', csrf = '';
  const api = (path: string, body?: unknown) => fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function login() {
    const r = await api('/login', { key }); assert.equal(r.status, 200); cookie = r.headers.get('set-cookie')!.split(';')[0]!; csrf = (await r.json() as { csrf: string }).csrf;
  }
  async function submit(text: string, requestId: string = randomUUID()) {
    const r = await api('/chat', { text, requestId }); assert.equal(r.status, 202); return r.json() as Promise<WebRequestReceipt>;
  }
  async function receipt(id: string) { const r = await api(`/chat-requests/${id}`); assert.equal(r.status, 200); return r.json() as Promise<WebRequestReceipt>; }
  async function stop(c: ReturnType<typeof launch>) { c.child.send('stop'); assert.deepEqual(await c.exited, [0, null], c.output()); }
  try {
    const first = launch(true); await until(() => first.output().includes('模式=web-ui')); await login();
    const done = await submit('COORDINATOR_DONE_ONCE'); await until(async () => (await receipt(done.requestId)).run?.status === 'succeeded');
    const running = await submit('COORDINATOR_CRASH_CLAIMED'); await until(() => inputs.length === 2);
    const claimed = await receipt(running.requestId); assert.equal(claimed.status, 'claimed'); assert.ok(claimed.runId);
    const queued = await submit('COORDINATOR_QUEUED_SURVIVES'), cancelled = await submit('COORDINATOR_CANCELLED_NEVER_EXECUTE');
    assert.equal(queued.runId, null); assert.equal(queued.status, 'queued');
    const cancel = await api(`/chat-requests/${cancelled.requestId}/cancel`, {}); assert.equal(cancel.status, 200);
    first.child.kill('SIGKILL'); await first.exited; release();
    // 仅等待临时进程锁自然过期；不改锁与业务数据。
    await delay(10500);
    const disabled = launch(false); await until(() => disabled.output().includes('模式=web-ui')); await login(); await delay(100);
    assert.equal(inputs.length, 2); assert.equal((await receipt(running.requestId)).run?.status, 'interrupted');
    assert.equal((await receipt(queued.requestId)).status, 'queued'); assert.equal((await receipt(cancelled.requestId)).status, 'cancelled');
    assert.equal((await api('/chat', { requestId: queued.requestId, text: queued.text })).status, 409);
    const db = new DatabaseSync(join(root, 'agent.db'), { readOnly: true });
    try { assert.equal(db.prepare('SELECT count(*) AS n FROM runs').get()?.n, 2); assert.equal(db.prepare('SELECT runId FROM web_ui_chats WHERE requestId=?').get(queued.requestId)?.runId, null); }
    finally { db.close(); }
    await stop(disabled);
    const enabled = launch(true); await until(() => enabled.output().includes('模式=web-ui')); await login();
    await until(async () => (await receipt(queued.requestId)).run?.status === 'succeeded');
    assert.equal(inputs.length, 3); assert.equal((await receipt(running.requestId)).runId, claimed.runId);
    assert.equal((await submit(queued.text, queued.requestId)).runId, (await receipt(queued.requestId)).runId);
    assert.equal((await submit(cancelled.text, cancelled.requestId)).status, 'cancelled'); await stop(enabled);
    const final = launch(true); await until(() => final.output().includes('模式=web-ui')); await login(); await delay(100);
    assert.equal(inputs.length, 3); assert.equal((await receipt(running.requestId)).run?.status, 'interrupted'); await stop(final);
    assert.deepEqual(inputs, ['COORDINATOR_DONE_ONCE', 'COORDINATOR_CRASH_CLAIMED', 'COORDINATOR_QUEUED_SURVIVES']);
    assert.equal(existsSync(join(root, 'agent.db.lock')), false); assert.equal(existsSync(join(root, 'memory.lock')), false);
    t.diagnostic(JSON.stringify({ mainStarts: 4, fakeHttpInputs: inputs, formalRequests: 0, restarts: 'queued领取；claimed中断；取消未执行；完成不重跑', childOutputs: children.map(c => c.output()) }));
  } finally {
    release(); for (const c of children) if (c.child.exitCode === null && c.child.signalCode === null) { c.child.kill('SIGKILL'); await c.exited; }
    model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); rmSync(root, { recursive: true, force: true });
  }
});
