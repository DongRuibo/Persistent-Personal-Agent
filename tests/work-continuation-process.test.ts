import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { prepareWebUiData } from '../src/web-ui-server.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { content, reply, toolCall, type Payload } from './helpers/skills-fixture.js';
import { isWorkParse } from './helpers/work-manage-fixture.js';
import type { WebRequestReceipt } from '../src/web-ui-types.js';

test('真实main：持久焦点/有限许可，后继claim强杀不重放；off不消费，失败补充待用户，新明确许可才能再次执行', { timeout: 60000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'continuation-main-')), actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
  await prepareWebUiData(root);
  const store = new SqliteStore(join(root, 'agent.db')), now = '2026-11-01T00:00:00.000Z';
  const thread = store.workThreads.create(actor, randomUUID(), '面试', now), original = store.workJobs.create(actor, thread.id, randomUUID(), '整理面试：ORIGINAL_PROCESS_ONLY。', now);
  const claimed = store.workJobs.claim(actor, now)!; store.workJobs.finish(actor, original.id, claimed.run.id, 'succeeded', now, 'ORIGINAL_FULL_PROCESS_RESULT'); store.close();
  const db = new DatabaseSync(join(root, 'agent.db')), payloads: Payload[] = [], workerPayloads: Payload[] = [];
  let release!: () => void; const hold = new Promise<void>(resolve => { release = resolve; });
  const model = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const p = JSON.parse(raw) as Payload; payloads.push(p); let response: string;
    if (isWorkParse(p)) {
      const input = JSON.parse(content(p.messages.findLast(m => m.role === 'user')?.content)) as { text: string };
      response = reply(JSON.stringify(input.text.includes('进度') ? { action: 'query', mode: 'query', evidence: input.text, keywords: ['面试'] }
        : { action: 'revise', mode: 'request', evidence: input.text, ...(input.text.includes(original.id) ? { keywords: [original.id], source: { kind: 'job', id: original.id } } : {}) }));
    } else if (!p.tools?.some(tool => tool.function.name === 'work_manage')) {
      workerPayloads.push(p); if (workerPayloads.length === 1) await hold; response = reply('EXPLICIT_NEW_RESULT');
    } else {
      const count = p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
      response = count ? reply('主Chat收尾') : toolCall('work_manage', {});
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response);
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const ma = model.address(); assert.ok(ma && typeof ma !== 'string');
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening'); const pa = probe.address(); assert.ok(pa && typeof pa !== 'string');
  const port = pa.port; assert.notEqual(port, 4318); await new Promise<void>(done => probe.close(() => done()));
  const origin = `http://127.0.0.1:${port}`, key = 'fake-continuation-main-access-key-at-least32bytes';
  const children: { child: ChildProcess; output(): string; exited: Promise<unknown[]> }[] = [];
  function launch(enabled: boolean) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      "process.argv=['node','continuation-main.ts','--web-ui']; process.on('message',()=>process.emit('SIGINT')); const {main}=await import('./src/main.ts'); try{await main();process.disconnect();}catch(e){console.error(e.message);process.exit(1);}"], {
      stdio: ['pipe','pipe','pipe','ipc'], env: { PATH: process.env.PATH, HOME: root, TMPDIR: tmpdir(),
        WORK_COORDINATOR_ENABLED: String(enabled), WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true', WORK_ROUTING_ENABLED: 'false', WORK_EVENTS_ENABLED: 'false',
        WEB_UI_ENABLED: 'true', WEB_UI_ACCESS_KEY: key, WEB_UI_PORT: String(port), WEB_UI_HOST: '127.0.0.1', WEB_UI_DATA_DIR: root,
        LLM_API_KEY: 'fake-continuation-llm', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${ma && typeof ma !== 'string' ? ma.port : 0}/v1`,
        GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', POLL_INTERVAL_MS: '30', EXECUTION_TIMEOUT_MS: '15000', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false',
        SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false', WEB_SEARCH_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false' },
    });
    let output = ''; child.stdout!.on('data', p => { output += String(p); }); child.stderr!.on('data', p => { output += String(p); });
    const result = { child, output: () => output, exited: once(child,'exit') }; children.push(result); return result;
  }
  async function until(check: () => boolean | Promise<boolean>) { for (let i = 0; i < 300; i++) { if (await check()) return; await delay(20); } assert.fail('等待超时：'+children.map(c => c.output()).join('\n')); }
  let cookie = '', csrf = '';
  const api = (path: string, body?: unknown) => fetch(origin+'/api'+path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  async function login() { const r = await api('/login',{ key }); assert.equal(r.status,200); cookie = r.headers.get('set-cookie')!.split(';')[0]!; csrf = (await r.json() as { csrf: string }).csrf; }
  async function submit(text: string) {
    const requestId = randomUUID(), accepted = await api('/chat',{ requestId,text }); assert.equal(accepted.status,202);
    await until(async () => { const r = await (await api('/chat-requests/'+requestId)).json() as WebRequestReceipt; return !!r.run && r.run.status !== 'running'; });
    return await (await api('/chat-requests/'+requestId)).json() as WebRequestReceipt;
  }
  async function stop(c: ReturnType<typeof launch>) { c.child.send('stop'); assert.deepEqual(await c.exited,[0,null],c.output()); }
  try {
    const first = launch(true); await until(() => first.output().includes('模式=web-ui')); await login(); await submit('面试进度');
    const initial = await submit('再简短一点CRASH_PERMISSION'); await until(() => workerPayloads.length === 1);
    const consumed = db.prepare('SELECT consumedByJobId FROM web_request_items WHERE requestId=?').get(initial.requestId)!; assert.ok(consumed.consumedByJobId);
    const late = await submit('再简短一点LATE_PERMISSION'); assert.equal(late.items[0]?.baseJobId, consumed.consumedByJobId);
    first.child.kill('SIGKILL'); await first.exited; release(); await delay(10500);
    const off = launch(false); await until(() => off.output().includes('模式=web-ui')); await login(); await delay(100);
    assert.equal(workerPayloads.length,1); assert.equal(db.prepare('SELECT status FROM work_jobs WHERE id=?').get(consumed.consumedByJobId!)?.status,'interrupted');
    assert.equal(db.prepare('SELECT consumedByJobId FROM web_request_items WHERE requestId=?').get(late.requestId)?.consumedByJobId,null); await stop(off);
    const enabled = launch(true); await until(() => enabled.output().includes('模式=web-ui')); await login();
    await until(() => db.prepare('SELECT permission FROM web_request_items WHERE requestId=?').get(late.requestId)?.permission === 'needs_user'); assert.equal(workerPayloads.length,1);
    const check = await submit('再简短一点NO_REPLAY'); assert.equal(check.items[0]?.decision,'clarify');
    const lastParser = payloads.filter(isWorkParse).at(-1)!; assert.ok(JSON.stringify(lastParser).includes(original.id), '公开Session自定义引用恢复稳定根焦点');
    await submit('请修改面试 '+original.id+'：再简短FINAL_PERMISSION'); await until(() => workerPayloads.length === 2);
    await until(() => Number(db.prepare("SELECT count(*) AS n FROM work_jobs WHERE status='succeeded'").get()?.n) === 2); await delay(100); assert.equal(workerPayloads.length,2);
    assert.ok(JSON.stringify(workerPayloads[1]).includes('ORIGINAL_FULL_PROCESS_RESULT')); assert.ok(!JSON.stringify(workerPayloads[1]).includes('LATE_PERMISSION'));
    assert.equal(db.prepare('SELECT consumedByJobId FROM web_request_items WHERE requestId=?').get(late.requestId)?.consumedByJobId,null);
    await stop(enabled); t.diagnostic(JSON.stringify({ mainStarts:3, workerHttp:workerPayloads, interruptedJob:consumed.consumedByJobId, originalRoot:original.id, formalRequests:0 }));
  } finally { release(); for (const c of children) if (c.child.exitCode === null && c.child.signalCode === null) { c.child.kill('SIGKILL'); await c.exited; } db.close(); model.closeAllConnections(); await new Promise<void>(done => model.close(() => done())); rmSync(root,{ recursive:true,force:true }); }
});
