import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { readConfig } from '../../src/config.js';
import type { WebRequestReceipt } from '../../src/web-ui-types.js';
import type { Snapshot } from '../router-session-types.js';
import { accessKey } from '../environments/router-session-runtime.js';
import { ConversationBudget, gradeConversationContext } from '../evaluators/router-conversation.js';
import type { ConversationPlan, ConversationCall } from '../evaluators/router-conversation.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export async function runConversation(mode: 'prepare' | 'live', output: string, configPath?: string, resume?: string, hostStateRetest = false) {
  const planPath = hostStateRetest ? 'evals/datasets/topic-host-state-retest-v1.json' : 'evals/datasets/router-conversation-v1.json';
  const planFile = join(project, planPath);
  const plan = JSON.parse(readFileSync(planFile, 'utf8')) as ConversationPlan;
  if (plan.model !== 'deepseek-ai/DeepSeek-V4.1-Flash' || plan.base_url !== 'https://api.siliconflow.cn/v1'
    || plan.limits.cny > 5 || plan.limits.requests > (hostStateRetest ? 16 : 40) || plan.turns.length !== (hostStateRetest ? 5 : 21)
    || (hostStateRetest && (plan.version !== 'topic-host-state-retest-v1' || resume))) throw new Error('冻结方案与本轮授权不一致');
  if (existsSync(output)) throw new Error('只允许全新输出目录，禁止覆盖旧结果');
  mkdirSync(output, { recursive: true, mode: 0o700 });
  const state = join(output, 'state');
  if (resume) {
    const previous = JSON.parse(readFileSync(join(resume, 'manifest.json'), 'utf8'));
    if (mode !== 'live' || previous.plan_sha256 !== hash(readFileSync(planFile))) throw new Error('补验必须沿用原冻结计划');
    // 补验使用原隔离持久化目录的副本，保留首轮失败和数据原件。
    cpSync(join(resume, 'state'), state, { recursive: true });
  } else { mkdirSync(state, { mode: 0o700 }); mkdirSync(join(state, 'home'), { mode: 0o700 }); }
  const supplied = mode === 'live' ? parseEnv(readFileSync(configPath!, 'utf8')) : {};
  if (mode === 'live' && (supplied.LLM_MODEL !== plan.model || supplied.LLM_BASE_URL?.replace(/\/$/u, '') !== plan.base_url || !supplied.LLM_API_KEY)) throw new Error('本机模型配置不匹配，未发HTTP');
  const key = supplied.LLM_API_KEY ?? '';
  const redact = (value: string) => key ? value.replaceAll(key, '<REDACTED>') : value;
  const calls: ConversationCall[] = [], results: Record<string, any>[] = [], lifecycle: unknown[] = [];
  const budget = new ConversationBudget(plan), ids: Record<string, string> = {}, titles: Record<string, string> = {};
  if (resume) {
    const previous = JSON.parse(readFileSync(join(resume, 'calls.json'), 'utf8')) as ConversationCall[];
    for (const call of previous) budget.reserve(call.bytes, JSON.parse(call.body).max_tokens);
  }
  const carriedBudget = { requests: budget.requests, input: budget.input, output: budget.output, cny: budget.cny };
  const turns = resume ? [{ ...plan.turns[8]!, id: 'R00' }, ...plan.turns.slice(13, 20)] : plan.turns;
  let operation = 'startup', fatal: string | null = null, restart: Record<string, unknown> | null = null;
  const ledger = (value: unknown) => appendFileSync(join(output, 'http-events.jsonl'), JSON.stringify(value) + '\n', { mode: 0o600 });
  // 本地中继保留实际正文、原始SSE及usage；不改动生产提示、工具、输出上限或自动重试策略。
  const relay = createServer(async (request, response) => {
    let call: ConversationCall | undefined;
    try {
      if (mode !== 'live' || fatal || request.method !== 'POST' || request.url !== '/model') throw new Error('当前禁止模型调用');
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body), first = JSON.stringify(payload.messages?.[0]);
      const stage = first.includes('你是一次无工具主题归属解析器') ? 'topic_route'
        : first.includes('你是当前问题的文字助手') ? 'clarification_answer' : payload.tools?.length ? 'chat' : 'helper';
      const bytes = Buffer.byteLength(body);
      if (payload.model !== plan.model || payload.enable_thinking !== false || (stage === 'topic_route' && (payload.max_tokens !== 512 || bytes > 32768))) throw new Error('实际请求偏离生产模型参数');
      const reservation = budget.reserve(bytes, payload.max_tokens);
      call = { index: calls.length, turn: operation, stage, body, bytes, reservation }; calls.push(call);
      ledger({ phase: 'dispatch', index: call.index, turn: operation, stage, bytes, reservation, total_reserved_cny: budget.cny });
      json(join(output, `http-${call.index}-request.json`), payload);
      const started = performance.now();
      const upstream = await fetch(plan.base_url + '/chat/completions', { method: 'POST', redirect: 'error',
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(90000) });
      call.status = upstream.status; call.response = redact(await upstream.text()); call.elapsed_ms = Math.round(performance.now() - started);
      const events = call.response.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
      call.usage = events.map(event => event.usage).filter(usage => typeof usage?.prompt_tokens === 'number' && typeof usage?.completion_tokens === 'number').at(-1) ?? null;
      if (call.usage && (call.usage.prompt_tokens > reservation.input || call.usage.completion_tokens > reservation.output)) throw new Error('实际Token超过预留，停止后续请求');
      writeFileSync(join(output, `http-${call.index}-response.sse`), call.response, { mode: 0o600 });
      ledger({ phase: 'result', index: call.index, status: call.status, usage: call.usage, elapsed_ms: call.elapsed_ms });
      if (!upstream.ok) fatal = `模型HTTP失败：${upstream.status}`;
      response.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'text/event-stream' }); response.end(call.response);
    } catch (error) {
      fatal = redact(String(error)); if (call) call.error = fatal;
      ledger({ phase: 'blocked_or_error', turn: operation, index: call?.index ?? null, error: fatal });
      response.writeHead(502, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: { message: fatal } }));
    }
  });
  relay.listen(0, '127.0.0.1'); await once(relay, 'listening');
  const address = relay.address(); if (!address || typeof address === 'string') throw new Error('本地中继端口无效');
  const config = readConfig({ DATABASE_PATH: join(state, 'app.db'), SESSION_DIR: join(state, 'sessions'), MEMORY_DIR: join(state, 'memory'),
    WORK_TOPIC_SESSIONS_ENABLED: 'true', WORK_COORDINATOR_ENABLED: 'true', WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true',
    GOAL_ENABLED: 'false', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false',
    WEB_SEARCH_ENABLED: 'false', WEB_READ_ENABLED: 'false', SKILLS_ENABLED: 'false', LOCAL_FILES_ENABLED: 'false',
    LLM_API_KEY: 'fake-conversation-key-only-parent-has-real-key', LLM_MODEL: plan.model, LLM_BASE_URL: plan.base_url, EXECUTION_TIMEOUT_MS: '120000' });
  const configuration = join(state, 'configuration.json');
  json(configuration, { config, relay: `http://127.0.0.1:${address.port}/model`, endpoint: plan.base_url + '/chat/completions' });
  const sourceFiles = execFileSync('git', ['ls-files', 'src', 'evals', 'package.json', 'package-lock.json'], { cwd: project, encoding: 'utf8' }).trim().split('\n');
  for (const file of ['evals/runners/router-conversation.ts', 'evals/fixtures/router-conversation-process.ts', 'evals/evaluators/router-conversation.ts', planPath]) if (!sourceFiles.includes(file)) sourceFiles.push(file);
  const manifest = { mode: mode === 'live' ? 'real_model_continuous_web_chat' : 'prepare_zero_model_http', created_at: new Date().toISOString(),
    profile: hostStateRetest ? 'topic_host_state_retest' : 'router_conversation',
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(), plan_sha256: hash(readFileSync(planFile)), plan,
    source_sha256: Object.fromEntries(sourceFiles.map(file => [file, hash(readFileSync(join(project, file)))])),
    isolation: { root: state, real_user_data_loaded: false, global_budget_survives_child_restart: true, transport_buffers_sse: true },
    continuation: resume ? { previous_output: resume, carried_budget: carriedBudget, turns: turns.map(turn => turn.id) } : null,
    cost_note: '5/20元每百万Token保守预留，官方中国站当前最高档2/8；不等于实际账单，实际花费null。' };
  json(join(output, 'manifest.json'), manifest);
  async function start() {
    const child = spawn(process.execPath, ['--import', 'tsx', 'evals/fixtures/router-conversation-process.ts', configuration], {
      cwd: project, env: { PATH: process.env.PATH, HOME: join(state, 'home'), TMPDIR: '/private/tmp' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let stderr = '', stdout = '', sequence = 0;
    child.stderr!.on('data', data => { stderr += data; }); child.stdout!.on('data', data => { stdout += data; });
    const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
    let ready!: (value: { origin: string; pid: number }) => void;
    const started = new Promise<{ origin: string; pid: number }>(resolve => { ready = resolve; });
    child.on('message', (value: { ready?: boolean; origin: string; pid: number; id: number; value?: unknown; error?: string }) => {
      if (value.ready) { ready(value); return; } const waiter = pending.get(value.id); if (!waiter) return;
      pending.delete(value.id); if (value.error) waiter.reject(new Error(value.error)); else waiter.resolve(value.value);
    });
    const done = once(child, 'exit').then(([code, signal]) => {
      lifecycle.push({ pid: child.pid, code, signal, stderr: redact(stderr), stdout: redact(stdout) });
      for (const waiter of pending.values()) waiter.reject(new Error('测试子进程退出')); pending.clear(); return { code, signal };
    });
    const info = await Promise.race([started, done.then(() => { throw new Error('子进程就绪前退出：' + redact(stderr)); }), setTimeout(20000, undefined, { ref: false }).then(() => { throw new Error('子进程启动超时'); })]);
    const command = (op: 'snapshot' | 'close') => new Promise<any>((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); child.send({ id, op }); });
    return { ...info, snapshot: async () => await command('snapshot') as Snapshot,
      kill: async () => { child.kill('SIGKILL'); const exit = await done; if (exit.signal !== 'SIGKILL') throw new Error('未观察到SIGKILL'); },
      close: async () => { if (child.exitCode === null && child.signalCode === null) { await command('close'); await done; } } };
  }
  let port: Awaited<ReturnType<typeof start>> | undefined, cookie = '', csrf = '', beforeRestart: Snapshot | null = null;
  async function request(path: string, body?: unknown) {
    return fetch(port!.origin + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: cookie, ...(body === undefined ? {} : { Origin: port!.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }) },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  }
  async function login() {
    const response = await request('/api/login', { key: accessKey });
    if (response.status !== 200) throw new Error('测试登录失败：' + response.status);
    cookie = response.headers.get('set-cookie')!.split(';')[0]!; csrf = (await response.json() as { csrf: string }).csrf;
  }
  async function chat(text: string) {
    const requestId = randomUUID(), response = await request('/api/chat', { requestId, text });
    if (response.status !== 202) throw new Error(`聊天接收失败：${response.status} ${await response.text()}`);
    const deadline = Date.now() + 130000;
    while (Date.now() < deadline) {
      const read = await request('/api/chat-requests/' + requestId);
      if (read.status !== 200) throw new Error('读取聊天收据失败：' + read.status);
      const receipt = await read.json() as WebRequestReceipt;
      if (receipt.run && receipt.run.status !== 'running') {
        if (receipt.run.status === 'succeeded') { const ack = await request('/api/runs/' + receipt.runId + '/ack', {}); if (ack.status !== 200) throw new Error('ACK失败：' + ack.status); }
        return receipt;
      }
      // 原Web入口每分钟最多600请求；每秒轮询避免评测客户端自触发限流。
      await setTimeout(1000);
    }
    throw new Error('聊天收据等待超时');
  }
  try {
    port = await start(); await login();
    const initial = await port.snapshot();
    json(join(output, 'initial-snapshot.json'), initial);
    if (resume) for (const row of JSON.parse(readFileSync(join(resume, 'results.json'), 'utf8'))) {
      if (row.expected.action === 'create' && row.route?.kind === 'topic') { ids[row.expected.target] = row.route.threadId; titles[row.expected.target] = row.route.title; }
    }
    for (const turn of mode === 'live' ? turns : []) {
      operation = turn.id;
      const text = turn.text.replace(/\{\{title:(\w+)\}\}/gu, (_, alias: string) => { if (!titles[alias]) throw new Error('前置主题未创建：' + alias); return titles[alias]!; });
      const startIndex = calls.length, before = await port.snapshot(), started = performance.now();
      let receipt: WebRequestReceipt | null = null, error: string | null = null;
      try { receipt = await chat(text); } catch (failure) { error = redact(String(failure)); }
      const after = await port.snapshot(), route = receipt?.topicRoute ?? null;
      const actualAction = route?.kind === 'topic' ? route.selection.kind === 'create' ? 'create' : 'reuse' : route?.kind ?? null;
      if (turn.action === 'create' && turn.target && route?.kind === 'topic' && route.selection.kind === 'create') {
        ids[turn.target] = route.threadId; titles[turn.target] = route.title;
      }
      const expectedId = turn.target ? ids[turn.target] : null;
      const routeCorrect = actualAction === turn.action && (turn.target ? route?.kind === 'topic' && route.threadId === expectedId
        && (turn.action !== 'create' || !before.threads.some(item => item.id === route.threadId)) : route?.kind === 'clarify');
      const sessionCorrect = routeCorrect && after.threads.length - before.threads.length === (turn.action === 'create' ? 1 : 0)
        && (route?.kind !== 'topic' || (turn.action === 'create' || before.threads.find(item => item.id === route.threadId)?.chatContextKey === route.contextKey));
      const turnCalls = calls.slice(startIndex), context = gradeConversationContext(plan, turn, turnCalls, text);
      const outputText = receipt?.run?.output ?? '', answerOwn = turn.target && !turn.selection ? outputText.includes(plan.topics[turn.target]!.canary) : null;
      const facts = (turn.facts ?? []).map(pattern => ({ pattern, present: new RegExp(pattern, 'iu').test(outputText) }));
      const recovered = turn.recovery && turn.own_required ? routeCorrect && sessionCorrect && context.own_present === true && !context.contaminated
        && !!beforeRestart && beforeRestart.sessions.every(old => after.sessions.some(item => item.path === old.path && item.session_id === old.session_id))
        && beforeRestart.threads.every(old => after.threads.some(item => item.id === old.id && item.chatContextKey === old.chatContextKey)) : null;
      const failureCategories = [!routeCorrect && 'routing', !sessionCorrect && 'session_binding', context.contaminated && 'context_contamination',
        context.own_required && context.own_present !== true && 'own_history_missing', answerOwn === false && 'answer_canary_missing',
        facts.some(item => !item.present) && 'answer_fact_missing', recovered === false && 'recovery',
        receipt?.run?.status !== 'succeeded' && 'run_not_succeeded', after.jobs !== 0 && 'unexpected_job', after.tasks !== 0 && 'unexpected_task', error && 'error'].filter(Boolean);
      const result = { id: turn.id, expected: turn, text, route_correct: routeCorrect, session_correct: sessionCorrect, actual_action: actualAction,
        route, run_status: receipt?.run?.status ?? null, answer: outputText, answer_own_canary: answerOwn, facts, context, recovery_passed: recovered,
        ...(hostStateRetest && !turn.selection ? { topic_denial_review: 'pending_text_review' } : {}),
        http_indexes: turnCalls.map(call => call.index), elapsed_ms: Math.round(performance.now() - started), error,
        result: failureCategories.length ? 'failed' : 'passed', failure_categories: failureCategories };
      results.push(result); json(join(output, `${turn.id}.json`), { result, receipt, before, after });
      json(join(output, 'results.json'), results);
      console.log(JSON.stringify({ turn: turn.id, result: result.result, route: actualAction, calls: turnCalls.length, failures: failureCategories, reserved_cny: Number(budget.cny.toFixed(6)) }));
      if (fatal) break;
      if (turn.restart_after) {
        beforeRestart = after; json(join(output, 'before-restart.json'), after);
        cpSync(config.sessionDir, join(output, 'sessions-before-restart'), { recursive: true });
        const oldPid = port.pid, startCalls = calls.length; await port.kill(); port = await start(); cookie = ''; csrf = ''; await login();
        const restored = await port.snapshot(); restart = { previous_pid: oldPid, pid: port.pid, observed_sigkill: true,
          automatic_http: calls.length - startCalls, snapshot_unchanged: JSON.stringify(after) === JSON.stringify(restored) };
        json(join(output, 'restart.json'), { ...restart, after: restored });
      }
    }
  } catch (error) { fatal = redact(String(error)); }
  finally {
    if (port) { json(join(output, 'final-snapshot.json'), await port.snapshot()); await port.close(); }
    relay.closeAllConnections(); await new Promise<void>(resolve => relay.close(() => resolve()));
  }
  json(join(output, 'lifecycle.json'), lifecycle); json(join(output, 'calls.json'), calls);
  const totalContext = results.reduce((sum, row) => sum + row.context.requests, 0), pollution = results.reduce((sum, row) => sum + row.context.contaminated_requests, 0);
  const reuse = results.filter(row => row.expected.action === 'reuse'), tp = reuse.filter(row => row.actual_action === 'reuse' && row.route_correct).length;
  const fp = results.filter(row => row.actual_action === 'reuse' && (row.expected.action !== 'reuse' || !row.route_correct)).length;
  const fn = reuse.length - tp, precision = tp + fp ? tp / (tp + fp) : null, recall = reuse.length ? tp / reuse.length : null;
  const recovery = results.filter(row => row.recovery_passed !== null), known = calls.filter(call => call.usage);
  const summary = { mode, model: plan.model, planned_turns: turns.length, evaluated_turns: results.length,
    ...(hostStateRetest ? { topic_denial_review: { status: 'pending_text_review', main_answers: results.filter(row => !row.expected.selection).length, denial_rate: null } } : {}),
    passed: results.filter(row => row.result === 'passed').length, failures: results.filter(row => row.result !== 'passed').map(row => ({ id: row.id, categories: row.failure_categories })),
    routing: { correct: results.filter(row => row.route_correct).length, total: results.length, accuracy: results.length ? results.filter(row => row.route_correct).length / results.length : null,
      semantic_turns: results.filter(row => row.http_indexes.some((index: number) => calls[index]?.stage === 'topic_route')).length,
      deterministic_selections: results.filter(row => row.expected.selection).length },
    reuse: { tp, fp, fn, precision, recall, f1: precision !== null && recall !== null ? precision + recall ? 2 * precision * recall / (precision + recall) : 0 : null },
    context: { actual_requests: totalContext, contaminated_requests: pollution, contamination_rate: totalContext ? pollution / totalContext : null,
      chat_requests: calls.filter(call => call.stage === 'chat').length, own_history_required: results.filter(row => row.context.own_required).length,
      own_history_present: results.filter(row => row.context.own_required && row.context.own_present).length },
    recovery: { correct: recovery.filter(row => row.recovery_passed).length, total: recovery.length, rate: recovery.length ? recovery.filter(row => row.recovery_passed).length / recovery.length : null, restart },
    budget: { requests: budget.requests, this_run_requests: calls.length, carried: carriedBudget, reserved_input: budget.input, reserved_output: budget.output, reserved_cny: budget.cny, cap_cny: plan.limits.cny,
      usage_known: known.length, input_tokens: known.reduce((sum, call) => sum + call.usage!.prompt_tokens, 0), output_tokens: known.reduce((sum, call) => sum + call.usage!.completion_tokens, 0),
      actual_cost_cny: null }, fatal, production_source_changed: Object.entries(manifest.source_sha256).some(([file, sha]) => file.startsWith('src/') && hash(readFileSync(join(project, file))) !== sha) };
  json(join(output, 'summary.json'), summary);
  const columns = ['id', 'result', 'actual_action', 'route_correct', 'session_correct', 'answer_own_canary', 'recovery_passed', 'http_indexes', 'failure_categories'];
  const cell = (value: unknown) => '"' + (typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replaceAll('"', '""') + '"';
  writeFileSync(join(output, 'results.csv'), [columns.join(','), ...results.map(row => columns.map(column => cell(row[column])).join(','))].join('\n') + '\n');
  console.log(JSON.stringify(summary));
  return { summary, exit: fatal || (mode === 'live' && (results.length !== turns.length || summary.passed !== results.length)) ? 1 : 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), mode = args.includes('--live') ? 'live' : 'prepare';
  const option = (name: string) => args[args.indexOf(name) + 1];
  const output = option('--output'); if (!args.includes('--output') || !output || (mode === 'live' && !args.includes('--config'))) throw new Error('需要--output全新目录；真实调用另需--live --config本机配置路径');
  process.exitCode = (await runConversation(mode, resolve(output), mode === 'live' ? option('--config') : undefined, args.includes('--resume') ? resolve(option('--resume')!) : undefined, args.includes('--host-state-retest'))).exit;
}
