import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { readConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import type { WebRequestReceipt } from '../../src/web-ui-types.js';
import type { Snapshot, RouteScript, TopicSpec, WireRecord } from '../router-session-types.js';
import { openRuntime, accessKey, canaryPattern } from './router-session-runtime.js';

interface Port {
  origin: string; pid: number; snapshot(): Promise<Snapshot>; unbound(id: string, title: string, archived: boolean): Promise<void>;
  share(token: string): Promise<void>; close(): Promise<void>; kill(): Promise<void>;
}

export async function environment(topics: Record<string, TopicSpec>, subprocess: boolean) {
  const root = mkdtempSync('/private/tmp/ppa-router-eval-');
  mkdirSync(join(root, 'home'));
  const calls: WireRecord[] = [], ids: Record<string, string> = {}, canaries: Record<string, string> = {};
  const lifecycle: unknown[] = [], errors: string[] = [];
  let script: RouteScript = { kind: 'daily' }, operation = 'setup', block: string | null = null;
  let reach: (() => void) | undefined, cookie = '', csrf = '', port: Port;
  const model = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk;
      const payload = JSON.parse(raw), first = JSON.stringify(payload.messages?.[0]);
      const stage = first.includes('你是一次无工具主题归属解析器') ? 'topic_route'
        : first.includes('你是当前问题的文字助手') ? 'clarification_answer' : payload.tools?.length ? 'chat' : 'compaction';
      const call: WireRecord = { index: calls.length, stage, operation, raw, bytes: Buffer.byteLength(raw), response: null };
      calls.push(call);
      if (block === stage) { reach?.(); return; }
      let answer = '离线固定回答，仅验证宿主机制。';
      if (stage === 'topic_route') {
        if (script.target && !topics[script.target]) throw new Error('Mock脚本引用未知主题');
        const choice = script.kind === 'create' ? { kind: 'create', ...topics[script.target!]!, reason: '固定Mock提议，不是语义预测' }
          : script.kind === 'use' ? { kind: 'use', threadId: ids[script.target!], reason: '固定Mock提议，不是语义预测' }
          : script.kind === 'clarify' ? { kind: 'clarify', question: '请明确本次要处理哪个主题？', reason: '固定Mock歧义提议' }
          : { kind: 'daily', reason: '固定Mock日常提议' };
        if (script.kind === 'use' && !ids[script.target!]) throw new Error('Mock脚本目标尚未建立');
        answer = JSON.stringify(choice);
      } else if (stage === 'compaction') {
        // 摘要仅复述实际收到的标记，不读取标准答案或其他Session。
        answer = '离线合成摘要，以下仍是低信任历史：' + [...new Set(raw.match(canaryPattern) ?? [])].join(' ');
      }
      call.response = answer;
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      response.end(`data: ${JSON.stringify({ id: 'router-eval-stub', model: 'local-stub', choices: [{ index: 0, delta: { role: 'assistant', content: answer }, finish_reason: 'stop' }], usage: { prompt_tokens: 31, completion_tokens: 7, total_tokens: 38 } })}\n\ndata: [DONE]\n\n`);
    } catch (error) { errors.push(String(error)); response.writeHead(500); response.end(); }
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening');
  const address = model.address(); if (!address || typeof address === 'string') throw new Error('本机模型端口不可用');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), SESSION_DIR: join(root, 'sessions'), MEMORY_DIR: join(root, 'memory'),
    WORK_TOPIC_SESSIONS_ENABLED: 'true', WORK_COORDINATOR_ENABLED: 'true', WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true',
    GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false',
    WEB_SEARCH_ENABLED: 'false', WEB_READ_ENABLED: 'false', SKILLS_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false',
    LLM_API_KEY: 'fake-router-eval', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, EXECUTION_TIMEOUT_MS: '15000' });
  const configuration = join(root, 'configuration.json'); writeFileSync(configuration, JSON.stringify(config), { mode: 0o600 });
  async function open(): Promise<Port> {
    if (!subprocess) {
      const runtime = await openRuntime(config);
      return { origin: runtime.origin, pid: process.pid, snapshot: async () => runtime.snapshot(),
        unbound: async (...args) => runtime.unbound(...args), share: async token => runtime.share(token), close: runtime.close,
        kill: async () => { throw new Error('只有评测子进程允许SIGKILL'); } };
    }
    const child = spawn(process.execPath, ['--import', 'tsx', 'evals/fixtures/router-session-process.ts', configuration], {
      cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: join(root, 'home'), TMPDIR: '/private/tmp' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    let stdout = '', stderr = '', sequence = 0;
    child.stdout!.on('data', data => { stdout += data; }); child.stderr!.on('data', data => { stderr += data; });
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let ready!: (value: { origin: string; pid: number }) => void;
    const started = new Promise<{ origin: string; pid: number }>(resolve => { ready = resolve; });
    child.on('message', (value: { ready?: boolean; origin: string; pid: number; id: number; value?: unknown; error?: string }) => {
      if (value.ready) { ready(value); return; }
      const waiter = pending.get(value.id); if (!waiter) return;
      pending.delete(value.id); if (value.error) waiter.reject(new Error(value.error)); else waiter.resolve(value.value);
    });
    const done = once(child, 'exit').then(([code, signal]) => {
      lifecycle.push({ pid: child.pid, code, signal, stdout, stderr });
      for (const waiter of pending.values()) waiter.reject(new Error(`子进程退出：${code}/${signal} ${stderr}`)); pending.clear();
      return { code, signal };
    });
    const info = await Promise.race([started, done.then(exit => { throw new Error('子进程就绪前退出：' + JSON.stringify(exit)); })]);
    const command = (op: string, args: unknown[] = []) => new Promise<unknown>((resolve, reject) => {
      const id = ++sequence; pending.set(id, { resolve, reject }); child.send({ id, op, args });
    });
    return { ...info, snapshot: async () => await command('snapshot') as Snapshot,
      unbound: async (...args) => { await command('unbound', args); }, share: async token => { await command('share', [token]); },
      close: async () => { if (child.exitCode === null && child.signalCode === null) { await command('close'); await done; } },
      kill: async () => { child.kill('SIGKILL'); const exit = await done; if (exit.signal !== 'SIGKILL') throw new Error('未观察到SIGKILL'); },
    };
  }
  port = await open();
  async function request(path: string, body?: unknown) {
    return fetch(port.origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: port.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  }
  async function login() {
    const response = await request('/api/login', { key: accessKey });
    cookie = response.headers.get('set-cookie')!.split(';')[0]!; csrf = (await response.json() as { csrf: string }).csrf;
  }
  await login();
  async function chat(text: string, requestId = randomUUID()) {
    const response = await request('/api/chat', { requestId, text });
    if (response.status !== 202) throw new Error(`接收失败：${response.status} ${await response.text()}`);
    for (let i = 0; i < 1600; i++) {
      const read = await request('/api/chat-requests/' + requestId);
      if (read.status !== 200) throw new Error(`读取收据失败：${read.status}`);
      const receipt = await read.json() as WebRequestReceipt;
      if (receipt.run && receipt.run.status !== 'running') {
        if (receipt.run.status === 'succeeded') {
          const ack = await request('/api/runs/' + receipt.runId + '/ack', {});
          if (ack.status !== 200) throw new Error('原渲染ACK失败：' + ack.status);
        }
        return receipt;
      }
      await setTimeout(5);
    }
    throw new Error('收据等待超时');
  }
  return { root, calls, ids, canaries, config, lifecycle, errors, chat,
    setScript(value: RouteScript, label: string) { script = value; operation = label; },
    snapshot: () => port.snapshot(),
    async unbound(alias: string, archived: boolean) { const id = randomUUID(); ids[alias] = id; await port.unbound(id, topics[alias]!.title, archived); },
    share: (token: string) => port.share(token),
    get pid() { return port.pid; },
    async crash(stage: string, text: string) {
      if (stage === 'idle') { await port.kill(); return; }
      block = stage;
      const reached = new Promise<void>(resolve => { reach = resolve; });
      const active = (async () => {
        // 压缩屏障由实际对话增长触发，不改Session文件或生产阈值。
        for (let i = 0; i < (stage === 'compaction' ? 12 : 1); i++) {
          await chat(text + (stage === 'compaction' ? ` 压缩屏障轮次${i} ` + 'fixture-growth '.repeat(440) : ''));
        }
      })().catch(error => { if (block) throw error; return { interrupted: String(error) }; });
      await Promise.race([reached, active.then(() => { throw new Error('强杀屏障前回合已结束'); })]);
      const killing = port.kill(); block = null; await killing; await active; reach = undefined;
    },
    async restart() { const before = calls.length, previousPid = port.pid; port = await open(); cookie = ''; csrf = ''; await login();
      lifecycle.push({ restart: true, previousPid, pid: port.pid, automatic_http: calls.length - before }); return { previousPid, pid: port.pid, automatic_http: calls.length - before }; },
    async close() { await port.close(); model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve())); },
  };
}
