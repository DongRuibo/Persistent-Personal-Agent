import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, redactor } from '../src/config.js';
import { recordAcceptanceResponse } from './feishu-formation-acceptance.js';

const limits = { requests: 16, microCny: 2000000, bodyBytes: 32768, outputTokens: 4096 } as const;
interface Attempt { bytes: number; outputLimit: number; reservedMicroCny: number; at: string; status?: number }
interface Ledger {
  version: 1; scope: 'v3.0.1-console-retest'; identity: string; limits: typeof limits;
  inputRate: number; outputRate: number; attempts: Attempt[];
}
const price = (bytes: number, output: number, inputRate: number, outputRate: number) => Math.ceil((bytes + 512) * inputRate + output * outputRate);
const capacity = (bytes: number, output: number) => Number.isSafeInteger(bytes) && bytes > 0 && bytes <= limits.bodyBytes
  && Number.isSafeInteger(output) && output > 0 && output <= limits.outputTokens;

// 只服务本轮16/2复验；重启后重算每条预留，不能信任被改大的限额或被改小的历史费用。
export class GoalConsoleRetestBudget {
  constructor(readonly ledger: Ledger) {
    if (ledger.version !== 1 || ledger.scope !== 'v3.0.1-console-retest' || !/^[a-f0-9]{64}$/u.test(ledger.identity)
      || JSON.stringify(ledger.limits) !== JSON.stringify(limits)
      || ![ledger.inputRate, ledger.outputRate].every(n => Number.isFinite(n) && n > 0 && n <= 10000)
      || !Array.isArray(ledger.attempts) || ledger.attempts.length > limits.requests
      || ledger.attempts.some(a => !capacity(a.bytes, a.outputLimit) || !Number.isFinite(Date.parse(a.at))
        || a.reservedMicroCny !== price(a.bytes, a.outputLimit, ledger.inputRate, ledger.outputRate)
        || a.status !== undefined && (!Number.isInteger(a.status) || a.status < 100 || a.status > 599))
      || this.reserved > limits.microCny) throw new Error('Console复验账本无效，拒绝沿用或扩大限额');
  }
  get reserved(): number { return this.ledger.attempts.reduce((sum, a) => sum + a.reservedMicroCny, 0); }
  reserve(bytes: number, outputLimit: number): Attempt {
    if (!capacity(bytes, outputLimit)) throw new Error('Console复验请求容量超过32768字节或4096输出Token');
    const reservedMicroCny = price(bytes, outputLimit, this.ledger.inputRate, this.ledger.outputRate);
    if (this.ledger.attempts.length >= limits.requests || this.reserved + reservedMicroCny > limits.microCny) throw new Error('已达16请求或2元保守预留上限');
    const attempt = { bytes, outputLimit, reservedMicroCny, at: new Date().toISOString() };
    this.ledger.attempts.push(attempt); return attempt;
  }
}

export function openConsoleRetest(root: string, endpoint: string, model: string, inputRate: number, outputRate: number, resume: boolean) {
  if (!isAbsolute(root)) throw new Error('Console复验目录必须是独立绝对路径');
  root = resolve(root);
  const budgetFile = join(root, 'v301-console-budget.json');
  if (resume ? !fs.existsSync(budgetFile) : fs.existsSync(root)) throw new Error('新轮必须新目录；续测只接受本轮账本，禁止重置或沿用旧账本');
  const identity = createHash('sha256').update(JSON.stringify([root, endpoint, model, inputRate, outputRate, 'console'])).digest('hex');
  process.umask(0o077);
  if (!resume) fs.mkdirSync(root, { mode: 0o700 });
  const lock = join(root, 'console-retest.lock');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600));
  let closed = false;
  const close = () => { if (!closed) { closed = true; fs.rmSync(lock); } };
  try {
    // 先独占再读账本，避免另一进程刚结束时带着旧快照获得锁。
    const ledger: Ledger = resume ? JSON.parse(fs.readFileSync(budgetFile, 'utf8'))
      : { version: 1, scope: 'v3.0.1-console-retest', identity, limits: { ...limits }, inputRate, outputRate, attempts: [] };
    const budget = new GoalConsoleRetestBudget(ledger);
    if (ledger.identity !== identity || ledger.inputRate !== inputRate || ledger.outputRate !== outputRate) throw new Error('续测根目录、模型、端点或费率已变化');
    const persist = () => {
      if (closed) throw new Error('复验账本已关闭');
      fs.writeFileSync(budgetFile + '.tmp', JSON.stringify(ledger, null, 2), { mode: 0o600 });
      fs.renameSync(budgetFile + '.tmp', budgetFile);
    };
    persist(); return { budget, persist, close };
  } catch (error) { close(); throw error; }
}

export function consoleRetestFetch(session: ReturnType<typeof openConsoleRetest>, root: string, endpoint: string,
  model: string, apiKey: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  const redact = redactor(apiKey);
  return async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.href !== endpoint || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string'
      || init.body.includes(apiKey)) throw new Error('Console复验拒绝非模型端点、非POST或含凭据的请求体');
    const payload = JSON.parse(init.body);
    if (payload.model !== model || payload.enable_thinking === true) throw new Error('Console复验模型或推理设置不一致');
    if (payload.max_tokens !== undefined && payload.max_completion_tokens !== undefined) throw new Error('Console复验拒绝重复输出上限参数');
    const attempt = session.budget.reserve(Buffer.byteLength(init.body), payload.max_tokens ?? payload.max_completion_tokens);
    session.persist();
    const sequence = session.budget.ledger.attempts.length;
    console.log(`Console复验请求${sequence}/16，累计保守预留${(session.budget.reserved / 1e6).toFixed(6)}/2元`);
    const response = await transport(input, { ...init, redirect: 'error' });
    attempt.status = response.status; session.persist();
    return recordAcceptanceResponse(response, join(root, `response-${String(sequence).padStart(2, '0')}.txt`), redact, 4194304);
  };
}

async function start(): Promise<void> {
  const args = process.argv.slice(2), root = args.find(a => a.startsWith('--root='))?.slice(7);
  if (!args.includes('--authorized') || !root || !isAbsolute(root)
    || args.some(a => !['--authorized', '--resume'].includes(a) && !a.startsWith('--root='))) throw new Error('仅另行授权后使用 --authorized --root=<新的隔离绝对路径>；只支持Console');
  const directory = resolve(root);
  Object.assign(process.env, { DATABASE_PATH: join(directory, 'agent.db'), MEMORY_DIR: join(directory, 'memory'),
    SESSION_DIR: join(directory, 'sessions'), GOAL_ENABLED: 'true', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false' });
  // 本入口不加载.env，不读取飞书配置；只接收已注入的模型环境变量。
  const config = readConfig(), inputRate = Number(process.env.GOAL_RETEST_INPUT_RATE), outputRate = Number(process.env.GOAL_RETEST_OUTPUT_RATE);
  const endpoint = config.baseUrl && new URL(config.baseUrl.replace(/\/$/u, '') + '/chat/completions');
  if (!config.apiKey || config.apiKey === '<REDACTED>' || !endpoint || endpoint.href !== 'https://api.siliconflow.cn/v1/chat/completions'
    || config.model !== 'deepseek-ai/DeepSeek-V4.1-Flash' || inputRate !== 2 || outputRate !== 8) throw new Error('当前模型配置或已核对费率不符合本轮批准方案，未联网');
  const session = openConsoleRetest(directory, endpoint.href, config.model, inputRate, outputRate, args.includes('--resume'));
  process.once('exit', session.close);
  const planFile = resolve('docs/evaluations/v3.0.1-live-retest-plan.md'), frozenPlan = join(directory, 'frozen-plan.md');
  const fingerprint = (path: string) => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  if (args.includes('--resume')) {
    if (fingerprint(planFile) !== fingerprint(frozenPlan)) throw new Error('冻结方案已变化，拒绝续测');
  } else {
    fs.copyFileSync(planFile, frozenPlan, fs.constants.COPYFILE_EXCL);
    fs.writeFileSync(join(directory, 'authorization.json'), JSON.stringify({ scope: session.budget.ledger.scope,
      authorizedAt: new Date().toISOString(), model: config.model, endpoint: endpoint.href, inputRate, outputRate, limits,
      planSha256: fingerprint(planFile), entrySha256: fingerprint(fileURLToPath(import.meta.url)), consoleOnly: true }, null, 2), { flag: 'wx', mode: 0o600 });
  }
  const guarded = consoleRetestFetch(session, directory, endpoint.href, config.model, config.apiKey);
  globalThis.fetch = async (input, init) => {
    try { return await guarded(input, init); }
    catch (error) { process.exitCode = 1; setImmediate(() => process.emit('SIGTERM')); throw error; }
  };
  console.log(`隔离Console复验：${directory}；16请求/2元/32768字节；Formation关闭；输入/quit停止`);
  process.argv = [process.argv[0]!, resolve('src/main.ts')];
  await import('../src/main.js');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void start().catch(error => {
  console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1;
});
