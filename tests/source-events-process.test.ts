import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createSocket } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../src/sqlite-store.js';
import { SourceEventService } from '../src/source-event-service.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { prepareWebUiData } from '../src/web-ui-server.js';

test('E1实际main：仅Web来源独立启动/停止、重启读取原事件、关闭0HTTP且0模型/Grant', { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'source-events-main-')); await prepareWebUiData(root);
  const sha = (n: number) => String(n).repeat(40), paths: string[] = []; let heads = [1];
  const github = createServer((req, res) => {
    paths.push(req.url!); res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(req.url!.includes('/compare/') ? { status: 'ahead', files: [] } : heads.map(n => ({ sha: sha(n), commit: { message: '虚构来源' } }))));
  });
  github.listen(0, '127.0.0.1'); await once(github, 'listening'); const endpoint = github.address(); assert.ok(endpoint && typeof endpoint === 'object');
  const socket = createSocket(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const address = socket.address(); assert.ok(address && typeof address === 'object');
  await new Promise<void>(done => socket.close(() => done()));
  const seed = new SqliteStore(join(root, 'agent.db'));
  const permission = new SourceEventService(seed.sourceEvents, { owner: webOwner, target: webTarget }, { enabled: true, pollIntervalMs: 10, reportError() {} });
  const source = permission.permit({ requestId: 'main-permission', watch: { kind: 'github', repository: 'fiction/agent', branch: 'main', intervalSeconds: 60 } });
  await permission.stop(); seed.close();
  const check = new DatabaseSync(join(root, 'agent.db'));
  const fetches: string[] = [];
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, TMPDIR: '/private/tmp',
    WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: 'fake-source-events-access-key-32bytes', WEB_UI_HOST: '127.0.0.1', WEB_UI_PORT: String(address.port), WEB_UI_DATA_DIR: root,
    LLM_API_KEY: 'fake-source-model-key', LLM_MODEL: 'local-stub', LLM_BASE_URL: 'http://127.0.0.1:1/v1',
    WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'false', WORK_ROUTING_ENABLED: 'false', WORK_EVENTS_ENABLED: 'true',
    WEB_SEARCH_ENABLED: 'false', GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false',
    LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false', POLL_INTERVAL_MS: '10' };
  const start = (enabled: boolean, web = true) => {
    // 只在测试进程将固定GitHub fetch传送到loopback；任何其它出站请求直接失败并记录。
    const code = `process.argv=['node','source-main-test',${web ? "'--web-ui'" : ''}];
      const localFetch=globalThis.fetch; globalThis.fetch=(url,options)=>{const value=String(url); process.send?.({kind:'fetch',url:value});
      if(!value.startsWith('https://api.github.com/')) throw new Error('测试拒绝外部请求');
      return localFetch(${JSON.stringify(`http://127.0.0.1:${endpoint.port}`)}+value.slice('https://api.github.com'.length),options);};
      process.on('message',()=>process.emit('SIGINT')); const {main}=await import('./src/main.ts');
      try{await main();process.disconnect();}catch(error){console.error(error.message);process.exit(1);}`;
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { env: { ...env, WORK_EVENTS_ENABLED: String(enabled) }, stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
    let output = ''; child.stdout!.on('data', data => { output += data; }); child.stderr!.on('data', data => { output += data; });
    child.on('message', message => { const item = message as { kind: string; url: string }; if (item.kind === 'fetch') fetches.push(item.url); });
    return { child, exited: once(child, 'exit'), output: () => output };
  };
  type Process = ReturnType<typeof start>;
  let active: Process | undefined;
  const ready = async (p: Process) => {
    for (let i = 0; i < 300 && !p.output().includes('模式=web-ui') && p.child.exitCode === null; i++) await delay(10);
    assert.match(p.output(), /模式=web-ui/);
  };
  const stop = async (p: Process) => { if (p.child.connected) p.child.send('stop'); assert.equal((await p.exited)[0], 0, p.output()); };
  try {
    active = start(true); await ready(active);
    for (let i = 0; i < 200 && check.prepare('SELECT head FROM event_sources WHERE id=?').get(source.id)?.head !== sha(1); i++) await delay(10);
    assert.equal(check.prepare('SELECT head FROM event_sources WHERE id=?').get(source.id)!.head, sha(1));
    await stop(active); active = undefined;
    assert.equal(paths.length, 1); assert.equal(check.prepare('SELECT count(*) AS n FROM source_events').get()!.n, 0);
    check.prepare('UPDATE event_sources SET nextAt=? WHERE id=?').run('2026-01-01T00:00:00.000Z', source.id);
    heads = [2, 1]; const before = fetches.length;
    active = start(false); await ready(active); await delay(80); await stop(active); active = undefined;
    assert.equal(fetches.length, before, '关闭后即使有到期来源也没有GET');
    active = start(true); await ready(active);
    for (let i = 0; i < 200 && !check.prepare('SELECT 1 FROM source_events').get(); i++) await delay(10);
    assert.equal(check.prepare('SELECT count(*) AS n FROM source_events').get()!.n, 1);
    const frozen = check.prepare('SELECT snapshotJson,snapshotHash FROM source_events').get();
    await stop(active); active = undefined; assert.equal(paths.length, 3);
    const reopened = new SqliteStore(join(root, 'agent.db'));
    try { assert.equal(reopened.sourceEvents.events({ owner: webOwner, channel: JSON.stringify(webTarget) }, source.id).length, 1); } finally { reopened.close(); }
    assert.deepEqual(check.prepare('SELECT snapshotJson,snapshotHash FROM source_events').get(), frozen); assert.equal(paths.length, 3);
    for (const table of ['model_calls', 'goal_grants', 'goal_triggers', 'goal_executions']) assert.equal(check.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
    assert.ok(fetches.every(url => url.startsWith('https://api.github.com/repos/fiction/agent/')));
    assert.ok(!existsSync(join(root, 'agent.db.lock'))); assert.ok(!existsSync(join(root, 'memory.lock')));
    active = start(true, false); assert.equal((await active.exited)[0], 1); assert.match(active.output(), /仅支持 --web-ui/); active = undefined;
    assert.equal(fetches.length, 3);
  } finally {
    if (active?.child.exitCode === null) await stop(active);
    check.close(); github.closeAllConnections(); await new Promise<void>(done => github.close(() => done())); rmSync(root, { recursive: true, force: true });
  }
});
