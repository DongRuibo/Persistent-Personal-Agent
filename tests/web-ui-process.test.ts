import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

test('实际--web-ui组装：独立数据、回环监听、同库锁与正常停止；无模型请求', { timeout: 30000 }, async () => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address(); assert.ok(address && typeof address === 'object'); const port = address.port;
  await new Promise<void>(done => socket.close(() => done()));
  const root = mkdtempSync(join(tmpdir(), 'web-entrypoint-'));
  const env: NodeJS.ProcessEnv = { ...process.env, WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: 'fake-entrypoint-access-key-at-least-32bytes', WEB_UI_PORT: String(port), WEB_UI_HOST: '127.0.0.1',
    WEB_UI_DATA_DIR: root, LLM_API_KEY: 'fake-no-model-network', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'http://127.0.0.1:1/v1', DATABASE_PATH: undefined, SESSION_DIR: undefined, MEMORY_DIR: undefined,
    GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' };
  const start = () => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "process.argv=['node','web-test-entry.ts','--web-ui']; process.on('message',()=>process.emit('SIGINT')); const {main}=await import('./src/main.ts'); try{await main();process.disconnect();}catch(e){console.error(e.message);process.exit(1);}"],
    { env, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let output = ''; child.stdout!.on('data', chunk => { output += String(chunk); }); child.stderr!.on('data', chunk => { output += String(chunk); });
    const exited = once(child, 'exit'); return { child, exited, output: () => output };
  };
  const first = start();
  try {
    for (let i = 0; i < 300 && !first.output().includes('模式=web-ui'); i++) { if (first.child.exitCode !== null) break; await delay(25); }
    assert.match(first.output(), /模式=web-ui/); assert.match(first.output(), /127\.0\.0\.1/);
    assert.ok(existsSync(join(root, 'agent.db'))); assert.ok(existsSync(join(root, 'sessions'))); assert.ok(existsSync(join(root, 'memory')));
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/snapshot`)).status, 401);
    const second = start(); const [code] = await second.exited; assert.equal(code, 1); assert.match(second.output(), /lock|锁/iu);
    first.child.send('stop'); const [stopped] = await first.exited; assert.equal(stopped, 0, first.output());
    assert.ok(!existsSync(join(root, 'agent.db.lock'))); assert.ok(!existsSync(join(root, 'memory.lock')));
  } finally { if (first.child.exitCode === null) { first.child.send('stop'); await first.exited; } }
});
