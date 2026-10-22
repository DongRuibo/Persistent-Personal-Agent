import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';
import { sseText } from './helpers/intent-stub.js';

test('真实main子进程：授权跨启动领取、Checkpoint跨退出恢复、无授权不请求；全新Session继续不重复bootstrap', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'goal-process-')), path = join(root, 'app.db');
  const store = new SqliteStore(path), actor = { ownerId: 'local-user', target: { channel: 'console' as const } };
  const now = () => new Date().toISOString();
  const source = store.beginRun(null, now()), goal = store.goals.create(actor, source.id, '虚构面试目标', now());
  store.finishRun(source.id, 'succeeded', now(), '已创建');
  let calls = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* 接收完整请求后才回复，HTTP仅监听本机。 */ }
    calls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(sseText(JSON.stringify({ stepOutcome: 'complete', artifactText: `PROCESS_ARTIFACT_${calls}`, progressSummary: '本段已交付', question: '请核对',
      ...(calls === 1 ? { proposedPlan: { changeReason: '初始计划', steps: [{ title: '问答', instruction: '出题', deliverable: '一道题', doneWhen: '已交付' }] } } : {}) })));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const children: ReturnType<typeof launch>[] = [];
  function launch(index: number) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], { stdio: ['pipe', 'pipe', 'pipe'], env: {
      ...process.env, DATABASE_PATH: path, MEMORY_DIR: `${path}.memory`, SESSION_DIR: join(root, `sessions-${index}`), LLM_API_KEY: 'fake-process-key',
      LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`,
      POLL_INTERVAL_MS: '20', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', EXECUTION_TIMEOUT_MS: '3000',
    } });
    let output = ''; child.stdout.on('data', value => { output += String(value); }); child.stderr.on('data', value => { output += String(value); });
    return { child, exited: once(child, 'exit'), output: () => output };
  }
  async function until(predicate: () => boolean) {
    for (let i = 0; i < 400; i++) { if (predicate()) return; await delay(15); }
    assert.fail(`等待超时：${children.map(item => item.output()).join('\n')}`);
  }
  try {
    const first = launch(1); children.push(first);
    await until(() => first.output().includes('PROCESS_ARTIFACT_1'));
    first.child.stdin.write('/quit\n'); assert.deepEqual(await first.exited, [0, null]);
    const checkpoint = store.goals.get(actor, goal.id).checkpointRunId;
    const second = launch(2); children.push(second); await until(() => second.output().includes('已启动'));
    await delay(100); assert.equal(calls, 1); assert.equal(store.goals.get(actor, goal.id).checkpointRunId, checkpoint);
    second.child.stdin.write('/quit\n'); assert.deepEqual(await second.exited, [0, null]);
    const current = store.goals.get(actor, goal.id), approval = store.beginRun(null, now());
    store.goals.approvePlan({ actor, sourceRunId: approval.id, expectedRevision: current.revision, text: '批准并继续一段' }, goal.id, current.pendingAction!.hash, now(), true);
    store.finishRun(approval.id, 'succeeded', now(), '批准');
    const third = launch(3); children.push(third); await until(() => third.output().includes('PROCESS_ARTIFACT_2'));
    third.child.stdin.write('/quit\n'); assert.deepEqual(await third.exited, [0, null]);
    const view = store.goals.view(actor, goal.id);
    assert.equal(calls, 2); assert.equal(view.executions.length, 2); assert.equal(view.goal.currentStepId, null);
    assert.equal(view.checkpoint?.previousCheckpointRunId, checkpoint); assert.equal(view.goal.status, 'waiting_user');
  } finally {
    for (const item of children) if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL');
    await Promise.all(children.map(item => item.exited)); store.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});
