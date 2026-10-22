import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { readConfig, readFeishuConfig, redactor } from '../src/config.js';
import { recordAcceptanceResponse } from './feishu-formation-acceptance.js';

interface Attempt { bytes: number; outputLimit: number; reservedMicroCny: number; at: string; status?: number }
interface Ledger { version: 1; identity: string; inputRate: number; outputRate: number; attempts: Attempt[] }

// Batch5待批准方案：全进程48请求/5元先到即止；失败和未知用量不退额度。
export class GoalAcceptanceBudget {
  constructor(readonly ledger: Ledger) {
    if (ledger.version !== 1 || !Number.isFinite(ledger.inputRate) || !Number.isFinite(ledger.outputRate)
      || ledger.inputRate <= 0 || ledger.outputRate <= 0 || ledger.inputRate > 10000 || ledger.outputRate > 10000
      || !Array.isArray(ledger.attempts) || ledger.attempts.length > 48
      || ledger.attempts.some(item => !Number.isSafeInteger(item.reservedMicroCny) || item.reservedMicroCny < 1)
      || this.reserved > 5000000) throw new Error('Goal验收账本无效');
  }
  get reserved(): number { return this.ledger.attempts.reduce((sum, item) => sum + item.reservedMicroCny, 0); }
  reserve(bytes: number, outputLimit: number): Attempt {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > 4096) throw new Error('验收请求容量无效');
    const reservedMicroCny = Math.ceil((bytes + 512) * this.ledger.inputRate + outputLimit * this.ledger.outputRate);
    if (this.ledger.attempts.length >= 48 || this.reserved + reservedMicroCny > 5000000) throw new Error('已达48请求或5元预留上限，停止验收');
    const attempt = { bytes, outputLimit, reservedMicroCny, at: new Date().toISOString() };
    this.ledger.attempts.push(attempt); return attempt;
  }
}

async function start() {
  const args = process.argv.slice(2), rootArg = args.find(arg => arg.startsWith('--root='))?.slice(7);
  if (!args.includes('--authorized') || !rootArg || !isAbsolute(rootArg)
    || args.some(arg => !['--authorized', '--resume', '--fresh-session'].includes(arg) && !arg.startsWith('--root='))) throw new Error('仅另行授权后使用 --authorized --root=<新的隔离绝对路径>；本次默认不联网');
  const root = resolve(rootArg), budgetFile = join(root, 'budget.json');
  if (args.includes('--fresh-session') && !args.includes('--resume')) throw new Error('新Session必须续用原账本');
  if (args.includes('--resume') ? !fs.existsSync(budgetFile) : fs.existsSync(root)) throw new Error('新轮必须用新目录，续测必须保留账本');
  const inputRate = Number(process.env.GOAL_ACCEPTANCE_INPUT_RATE), outputRate = Number(process.env.GOAL_ACCEPTANCE_OUTPUT_RATE);
  const config = readConfig(), feishu = readFeishuConfig();
  if (!config.apiKey || config.apiKey === '<REDACTED>' || !config.baseUrl) throw new Error('验收仅支持已核对价格和权限的兼容端点');
  const endpoint = new URL(config.baseUrl.replace(/\/$/u, '') + '/chat/completions');
  const identity = createHash('sha256').update(JSON.stringify([endpoint.href, config.model, feishu.appId, feishu.allowedOpenId, root])).digest('hex');
  const ledger: Ledger = args.includes('--resume') ? JSON.parse(fs.readFileSync(budgetFile, 'utf8')) : { version: 1, identity, inputRate, outputRate, attempts: [] };
  const budget = new GoalAcceptanceBudget(ledger);
  if (ledger.identity !== identity || ledger.inputRate !== inputRate || ledger.outputRate !== outputRate) throw new Error('续测身份、模型或批准费率已变化，拒绝启动');
  process.umask(0o077); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, 'acceptance.lock'); fs.closeSync(fs.openSync(lock, 'wx', 0o600));
  process.once('exit', () => fs.rmSync(lock, { force: true }));
  const persist = () => { fs.writeFileSync(budgetFile + '.tmp', JSON.stringify(ledger, null, 2), { mode: 0o600 }); fs.renameSync(budgetFile + '.tmp', budgetFile); };
  persist();
  const original = globalThis.fetch, redact = redactor(config.apiKey, feishu.appSecret);
  globalThis.fetch = async (input, init) => {
    try {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (url.origin === 'https://open.feishu.cn') return original(input, { ...init, redirect: 'error' });
      if (url.href !== endpoint.href || typeof init?.body !== 'string' || init.body.includes(config.apiKey) || init.body.includes(feishu.appSecret)) throw new Error('验收拒绝其他端点或含凭据的请求体');
      const payload = JSON.parse(init.body);
      if (payload.model !== config.model || payload.enable_thinking === true) throw new Error('验收模型或推理设置不一致');
      const attempt = budget.reserve(Buffer.byteLength(init.body), payload.max_tokens ?? payload.max_completion_tokens); persist();
      const sequence = ledger.attempts.length;
      console.log(`Goal验收请求${sequence}/48，累计保守预留${(budget.reserved / 1e6).toFixed(6)}/5元`);
      const response = await original(input, { ...init, redirect: 'error' }); attempt.status = response.status; persist();
      return recordAcceptanceResponse(response, join(root, `response-${String(sequence).padStart(2, '0')}.txt`), redact);
    } catch (error) { setImmediate(() => process.emit('SIGTERM')); throw error; }
  };
  Object.assign(process.env, { DATABASE_PATH: join(root, 'agent.db'), MEMORY_DIR: join(root, 'memory'),
    SESSION_DIR: join(root, args.includes('--fresh-session') ? 'sessions-fresh' : 'sessions'), MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false' });
  const controls = createInterface({ input: process.stdin });
  controls.on('line', line => { if (line.trim() === '/stop') process.emit('SIGTERM'); });
  process.once('SIGTERM', () => controls.close()); process.once('SIGINT', () => controls.close());
  setInterval(() => { if (process.exitCode) controls.close(); }, 1000).unref();
  console.log(`隔离Goal验收：${root}；输入/stop停止；Formation关闭`);
  process.argv = [process.argv[0]!, resolve('src/main.ts'), '--feishu']; await import('../src/main.js');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void start().catch(error => {
  console.error(redactor(process.env.LLM_API_KEY ?? '', process.env.FEISHU_APP_SECRET)(error)); process.exitCode = 1;
});
