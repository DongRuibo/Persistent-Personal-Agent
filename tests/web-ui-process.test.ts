import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { SqliteStore } from '../src/sqlite-store.js';
import { prepareWebUiData } from '../src/web-ui-server.js';
import { webTarget } from '../src/web-ui-channel.js';
import type { WorkThreadDetail } from '../src/work-thread-types.js';
import { setTimeout as delay } from 'node:timers/promises';

for (const workThreads of [false, true]) test(`实际--web-ui组装：独立数据、回环监听、同库锁与正常停止；工作主题=${workThreads}`, { timeout: 30000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address(); assert.ok(address && typeof address === 'object'); const port = address.port;
  await new Promise<void>(done => socket.close(() => done()));
  const root = mkdtempSync(join(tmpdir(), 'web-entrypoint-'));
  let taskId = '';
  if (workThreads) {
    await prepareWebUiData(root);
    const seed = new SqliteStore(join(root, 'agent.db'));
    try { taskId = seed.createTask('进程恢复关联的临时任务', '2100-01-01T00:00:00.000Z', new Date().toISOString(), webTarget).id; }
    finally { seed.close(); }
  }
  const env: NodeJS.ProcessEnv = { ...process.env, WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: 'fake-entrypoint-access-key-at-least-32bytes', WEB_UI_PORT: String(port), WEB_UI_HOST: '127.0.0.1',
    WEB_UI_DATA_DIR: root, LLM_API_KEY: 'fake-no-model-network', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'http://127.0.0.1:1/v1', DATABASE_PATH: undefined, SESSION_DIR: undefined, MEMORY_DIR: undefined,
    WORK_THREADS_ENABLED: String(workThreads), WEB_SEARCH_ENABLED: 'false', GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' };
  const start = () => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "process.argv=['node','web-test-entry.ts','--web-ui']; process.on('message',()=>process.emit('SIGINT')); const {main}=await import('./src/main.ts'); try{await main();process.disconnect();}catch(e){console.error(e.message);process.exit(1);}"],
    { env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let output = ''; child.stdout!.on('data', chunk => { output += String(chunk); }); child.stderr!.on('data', chunk => { output += String(chunk); });
    const exited = once(child, 'exit'); return { child, exited, output: () => output };
  };
  const first = start();
  const origin = `http://127.0.0.1:${port}`; let cookie = '', csrf = '';
  const login = async () => {
    const response = await fetch(origin + '/api/login', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ key: env.WEB_UI_ACCESS_KEY }) });
    assert.equal(response.status, 200); cookie = response.headers.get('set-cookie')!.split(';')[0]!; csrf = (await response.json() as { csrf: string }).csrf;
  };
  const api = (path: string, body?: unknown) => fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const threadId = randomUUID();
  try {
    for (let i = 0; i < 300 && !first.output().includes('模式=web-ui'); i++) { if (first.child.exitCode !== null) break; await delay(25); }
    assert.match(first.output(), /模式=web-ui/); assert.match(first.output(), /127\.0\.0\.1/);
    assert.ok(existsSync(join(root, 'agent.db'))); assert.ok(existsSync(join(root, 'sessions'))); assert.ok(existsSync(join(root, 'memory')));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/snapshot`)).status, 401);
    await login();
    assert.equal((await api('/api/work-threads')).status, workThreads ? 200 : 404);
    if (workThreads) {
      assert.equal((await api('/api/work-threads', { id: threadId, title: '跨进程工作主题' })).status, 200);
      assert.equal((await api(`/api/work-threads/${threadId}/links`, { kind: 'task', objectId: taskId, action: 'link' })).status, 200);
    }
    const second = start(); const [code] = await second.exited; assert.equal(code, 1); assert.match(second.output(), /lock|锁/iu);
    first.child.send('stop'); const [stopped] = await first.exited; assert.equal(stopped, 0, first.output());
    assert.ok(!existsSync(join(root, 'agent.db.lock'))); assert.ok(!existsSync(join(root, 'memory.lock')));
    if (workThreads) {
      const restarted = start();
      try {
        for (let i = 0; i < 300 && !restarted.output().includes('模式=web-ui'); i++) { if (restarted.child.exitCode !== null) break; await delay(25); }
        assert.match(restarted.output(), /模式=web-ui/); await login();
        const response = await api(`/api/work-threads/${threadId}`); assert.equal(response.status, 200);
        const detail = await response.json() as WorkThreadDetail;
        assert.equal(detail.title, '跨进程工作主题'); assert.equal(detail.links[0]?.objectId, taskId); assert.equal(detail.links[0]?.object?.status, 'pending');
      } finally { if (restarted.child.exitCode === null) { restarted.child.send('stop'); assert.equal((await restarted.exited)[0], 0); } }
    }
  } finally { if (first.child.exitCode === null) { first.child.send('stop'); await first.exited; } }
});
