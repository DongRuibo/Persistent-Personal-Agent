import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
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
import type { WorkJob } from '../src/work-job-types.js';
import { reply } from './helpers/skills-fixture.js';

test('实际main：强杀运行中Job后统一恢复、关闭保留queued、重开只领queued、结果/聊天不重跑', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'work-jobs-main-'));
  let release!: () => void, entered!: () => void, calls = 0;
  const hold = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const model = httpServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    calls++; if (raw.includes('CRASH_RUNNING')) { entered(); await hold; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(reply('本机合成模型结果'));
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const ma = model.address(); assert.ok(ma && typeof ma !== 'string');
  const socket = netServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const sa = socket.address(); assert.ok(sa && typeof sa !== 'string');
  const port = sa.port; await new Promise<void>(done => socket.close(() => done()));
  const origin = `http://127.0.0.1:${port}`, key = 'fake-process-work-access-at-least-32bytes';
  const children: { child: ChildProcess; output(): string; exited: Promise<unknown[]> }[] = [];
  function launch(enabled: boolean) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "process.argv=['node','work-process.ts','--web-ui']; process.on('message',()=>process.emit('SIGINT')); const {main}=await import('./src/main.ts'); try{await main();process.disconnect();}catch(e){console.error(e.message);process.exit(1);}"], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'], env: { ...process.env, WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: key, WEB_UI_PORT: String(port), WEB_UI_HOST: '127.0.0.1', WEB_UI_DATA_DIR: root,
        DATABASE_PATH: undefined, MEMORY_DIR: undefined, SESSION_DIR: undefined, LLM_API_KEY: 'fake-work-process-llm', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${ma && typeof ma !== 'string' ? ma.port : 0}/v1`,
        WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: String(enabled), GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', POLL_INTERVAL_MS: '30', EXECUTION_TIMEOUT_MS: '15000',
        MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false', WEB_SEARCH_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' },
    });
    let output = ''; child.stdout!.on('data', p => { output += String(p); }); child.stderr!.on('data', p => { output += String(p); });
    const result = { child, output: () => output, exited: once(child, 'exit') }; children.push(result); return result;
  }
  let cookie = '', csrf = '';
  async function until(check: () => boolean | Promise<boolean>) {
    for (let i = 0; i < 250; i++) { if (await check()) return; await delay(20); }
    assert.fail('进程等待超时：' + children.map(c => c.output()).join('\n'));
  }
  const api = (path: string, body?: unknown) => fetch(origin + '/api' + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function login() {
    const res = await api('/login', { key }); assert.equal(res.status, 200); cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    csrf = (await res.json() as { csrf: string }).csrf;
  }
  const read = async (id: string) => { const r = await api(`/work-jobs/${id}`); assert.equal(r.status, 200); return r.json() as Promise<WorkJob>; };
  async function submit(threadId: string, text: string, requestId: string = randomUUID()) {
    const r = await api('/work-jobs', { threadId, text, requestId }); assert.equal(r.status, 202); return r.json() as Promise<WorkJob>;
  }
  async function stop(c: ReturnType<typeof launch>) { c.child.send('stop'); assert.deepEqual(await c.exited, [0, null], c.output()); }
  try {
    const first = launch(true); await until(() => first.output().includes('模式=web-ui')); await login();
    const threadId = randomUUID(); assert.equal((await api('/work-threads', { id: threadId, title: '进程合成主题' })).status, 200);
    const done = await submit(threadId, 'COMPLETED_ONCE'); await until(async () => (await read(done.id)).status === 'succeeded');
    const doneRun = (await read(done.id)).runId;
    const chat = await api('/chat', { requestId: randomUUID(), text: 'CHAT_NOT_REPLAYED' }); assert.equal(chat.status, 202);
    const chatRun = (await chat.json() as { id: string }).id;
    await until(async () => (await (await api(`/runs/${chatRun}`)).json() as { status: string }).status === 'succeeded');
    const running = await submit(threadId, 'CRASH_RUNNING'); await started;
    const queued = await submit(threadId, 'QUEUED_SURVIVES'); assert.equal(queued.runId, null);
    first.child.kill('SIGKILL'); await first.exited; release();
    // 不改锁或业务数据；等待临时测试进程的原10秒陈旧锁自然失效。
    await delay(10500);
    const disabled = launch(false); await until(() => disabled.output().includes('模式=web-ui')); await login();
    assert.equal((await api('/work-jobs')).status, 404); assert.equal(calls, 3);
    const db = new DatabaseSync(join(root, 'agent.db'), { readOnly: true });
    try {
      assert.equal(db.prepare('SELECT status FROM work_jobs WHERE id=?').get(running.id)?.status, 'interrupted');
      assert.equal(db.prepare('SELECT status FROM work_jobs WHERE id=?').get(queued.id)?.status, 'queued');
      assert.equal(db.prepare('SELECT output FROM runs WHERE id=?').get(doneRun!)?.output, '本机合成模型结果');
      assert.equal(db.prepare("SELECT count(*) AS n FROM work_jobs WHERE status='running'").get()?.n, 0);
    } finally { db.close(); }
    await stop(disabled);
    const enabled = launch(true); await until(() => enabled.output().includes('模式=web-ui')); await login();
    await until(async () => (await read(queued.id)).status === 'succeeded'); assert.equal(calls, 4);
    assert.equal((await read(running.id)).status, 'interrupted'); assert.equal((await read(done.id)).runId, doneRun);
    assert.equal((await submit(threadId, 'QUEUED_SURVIVES', queued.requestId)).id, queued.id);
    await stop(enabled);
    const final = launch(true); await until(() => final.output().includes('模式=web-ui')); await login(); await delay(100);
    assert.equal(calls, 4); assert.equal((await read(done.id)).status, 'succeeded'); assert.equal((await read(queued.id)).status, 'succeeded');
    await stop(final); assert.equal(existsSync(join(root, 'agent.db.lock')), false); assert.equal(existsSync(join(root, 'memory.lock')), false);
    t.diagnostic('4次真实main启动；模拟HTTP共4次（3个工作尝试+1次Chat），强杀的工作未重跑；正式/收费请求0。');
  } finally {
    release(); for (const c of children) if (c.child.exitCode === null && c.child.signalCode === null) { c.child.kill('SIGKILL'); await c.exited; }
    model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); rmSync(root, { recursive: true, force: true });
  }
});
