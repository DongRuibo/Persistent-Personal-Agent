import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { SqliteStore } from '../src/sqlite-store.js';

async function until(predicate: () => boolean, description: string): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error(`等待超时：${description}`);
}

test('进程级：终端创建后重启 daemon，stdin 关闭不影响调度，拒绝双启动，SIGTERM 标记中断', { timeout: 30000 }, async () => {
  let blockedRequests = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += String(chunk);
    if (body.includes('SERVICE_BLOCK_MARKER')) {
      blockedRequests++;
      // 留下一个正在进行的 HTTP 调用，供 SIGTERM 测试使用。
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.flushHeaders();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const choice of [
      { index: 0, delta: { role: 'assistant', content: 'SERVICE_RESULT_MARKER' }, finish_reason: null },
      { index: 0, delta: {}, finish_reason: 'stop' },
    ]) res.write(`data: ${JSON.stringify({ id: 'service', model: 'local-stub', choices: [choice] })}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const directory = mkdtempSync(join(tmpdir(), 'personal-agent-service-'));
  const path = join(directory, 'agent.db');
  const store = new SqliteStore(path);
  interface Child { child: ChildProcessWithoutNullStreams; exited: Promise<unknown[]>; output(): string }
  const children: Child[] = [];
  function start(daemon = true): Child {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts', ...(daemon ? ['--daemon'] : [])], {
      cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env, LLM_API_KEY: 'local-test-key', LLM_MODEL: 'local-stub',
        LLM_BASE_URL: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`,
        DATABASE_PATH: path, USER_TIMEZONE: 'Asia/Taipei', POLL_INTERVAL_MS: '20', EXECUTION_TIMEOUT_MS: '10000',
      },
    });
    let output = '';
    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    const exited = once(child, 'exit');
    const item = { child, exited, output: () => output };
    children.push(item);
    return item;
  }
  try {
    const consoleProcess = start(false);
    await until(() => consoleProcess.output().includes('Personal Agent 已启动'), '终端启动');
    consoleProcess.child.stdin.write('/create 2秒后 | SERVICE_PENDING_MARKER\n');
    await until(() => store.listTasks().length === 1, '终端任务持久化');
    const pending = store.listTasks()[0]!;
    consoleProcess.child.stdin.write('/quit\n');
    assert.deepEqual(await consoleProcess.exited, [0, null]);
    assert.equal(store.getTask(pending.id)?.status, 'pending');
    const daemon = start();
    daemon.child.stdin.end();
    await until(() => daemon.output().includes('模式=daemon'), '独立 daemon 启动');
    const duplicate = start();
    assert.deepEqual(await duplicate.exited, [1, null]);
    assert.match(duplicate.output(), /already being held/);
    await until(() => store.getTask(pending.id)?.status === 'succeeded', '重启后到期执行');
    assert.equal(store.listRuns(pending.id).length, 1);
    await until(() => daemon.output().includes('SERVICE_RESULT_MARKER'), '主动控制台消息');
    const interrupted = store.createTask('SERVICE_BLOCK_MARKER', new Date(Date.now() - 1000).toISOString(), new Date().toISOString());
    await until(() => blockedRequests === 1, '模型请求进行中');
    daemon.child.kill('SIGTERM');
    assert.deepEqual(await daemon.exited, [0, null]);
    assert.equal(store.getTask(interrupted.id)?.status, 'interrupted');
    const run = store.listRuns(interrupted.id)[0]!;
    assert.ok(store.events(run.id).some((event) => event.type === 'agent_settled' && event.details?.includes('true')));
    const restarted = start();
    restarted.child.stdin.end();
    await until(() => restarted.output().includes('模式=daemon'), '中断后重启');
    await delay(100);
    assert.equal(blockedRequests, 1, '中断任务不能自动重试');
    assert.equal(store.getTask(interrupted.id)?.status, 'interrupted');
    restarted.child.kill('SIGTERM');
    assert.deepEqual(await restarted.exited, [0, null]);
  } finally {
    for (const item of children) {
      if (item.child.exitCode === null && item.child.signalCode === null) item.child.kill('SIGKILL');
    }
    await Promise.all(children.map((item) => item.exited));
    store.close(); rmSync(directory, { recursive: true, force: true });
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
