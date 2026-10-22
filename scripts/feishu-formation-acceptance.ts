import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { readConfig, readFeishuConfig, redactor } from '../src/config.js';

interface Attempt { at: string; bytes: number; outputLimit: number; reservedMicroCny: number; status?: number }
interface Ledger { version: 1; identity: string; requestLimit?: 40 | 48; attempts: Attempt[] }

// 本轮手机验收专用：全进程、跨重启累计预留；未知用量和失败请求不退额度。
export class FeishuAcceptanceBudget {
  get requestLimit(): 40 | 48 { return this.ledger.requestLimit ?? 40; }
  constructor(readonly ledger: Ledger) {
    if (ledger.version !== 1 || ![40, 48].includes(this.requestLimit) || !Array.isArray(ledger.attempts) || ledger.attempts.length > this.requestLimit ||
      ledger.attempts.some(a => !Number.isSafeInteger(a.reservedMicroCny) || a.reservedMicroCny < 1) || this.reservedMicroCny > 2_000_000) {
      throw new Error('验收预算账本无效，拒绝启动');
    }
  }
  get reservedMicroCny(): number { return this.ledger.attempts.reduce((sum, a) => sum + a.reservedMicroCny, 0); }
  reserve(payload: { model?: string; enable_thinking?: boolean; max_tokens?: number }, bytes: number): Attempt {
    if (payload.model !== 'deepseek-ai/DeepSeek-V4.1-Flash' || payload.enable_thinking !== false ||
      !Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(payload.max_tokens) || payload.max_tokens! < 1 || payload.max_tokens! > 4096) {
      throw new Error('验收模型或请求上限不符，未发送');
    }
    // 供应商峰时上界输入2元/输出8元每百万；输入按完整请求UTF-8字节加512保守预留。
    const reservedMicroCny = (bytes + 512) * 2 + payload.max_tokens! * 8;
    if (this.ledger.attempts.length >= this.requestLimit || this.reservedMicroCny + reservedMicroCny > 2_000_000) throw new Error(`本轮${this.requestLimit}请求或2元上限已到，未发送`);
    const attempt = { at: new Date().toISOString(), bytes, outputLimit: payload.max_tokens!, reservedMicroCny };
    this.ledger.attempts.push(attempt);
    return attempt;
  }
}

async function start(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some(a => !['--resume', '--fresh-session', '--extend-to-48'].includes(a)) ||
    (args.includes('--fresh-session') || args.includes('--extend-to-48')) && !args.includes('--resume')) throw new Error('新会话或已授权的48次扩额必须使用 --resume 保留累计账本');
  const config = readConfig(), feishu = readFeishuConfig();
  if (config.formation?.enabled || !config.apiKey || config.baseUrl !== 'https://api.siliconflow.cn/v1' || config.model !== 'deepseek-ai/DeepSeek-V4.1-Flash') throw new Error('需要正式Formation关闭及本轮已授权的硅基流动配置');
  process.umask(0o077);
  const root = resolve('data/acceptance/formation-feishu-20261022');
  const budgetFile = join(root, 'budget.json');
  const identity = createHash('sha256').update(JSON.stringify([config.model, feishu.appId, feishu.allowedOpenId])).digest('hex');
  if (!args.includes('--resume') && fs.existsSync(root)) throw new Error('本轮目录已存在；只能 --resume 累计额度，不能重置账本');
  if (args.includes('--resume') && !fs.existsSync(budgetFile)) throw new Error('续测缺少账本，拒绝创建新额度');
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = join(root, 'acceptance.lock');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600));
  process.once('exit', () => fs.rmSync(lock, { force: true }));
  const ledger: Ledger = args.includes('--resume') ? JSON.parse(fs.readFileSync(budgetFile, 'utf8')) : { version: 1, identity, attempts: [] };
  // 仅在用户明确批准本轮48次上限后使用此标记；费用仍2元，已有请求绝不重置。
  if (args.includes('--extend-to-48')) ledger.requestLimit = 48;
  // 修正尚未联网验收的示例身份不会增加额度；一旦发出模型请求则固定身份。
  if (ledger.identity !== identity && ledger.attempts.length === 0) ledger.identity = identity;
  if (ledger.identity !== identity) throw new Error('续测模型或飞书身份变化，拒绝启动');
  const budget = new FeishuAcceptanceBudget(ledger);
  const persist = () => {
    const tmp = budgetFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, budgetFile);
  };
  persist();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    // 官方飞书SDK的认证/消息请求不属于模型调用，继续使用现有凭据和渠道鉴权。
    if (url.origin === 'https://open.feishu.cn') return fetchOriginal(input, { ...init, redirect: 'error' });
    if (url.origin !== 'https://api.siliconflow.cn' || url.pathname !== '/v1/chat/completions') throw new Error('验收不允许其他fetch端点');
    try {
      if (typeof init?.body !== 'string' || init.body.includes(config.apiKey) || init.body.includes(feishu.appSecret)) throw new Error('验收请求体无效或含凭据，未发送');
      const attempt = budget.reserve(JSON.parse(init.body), Buffer.byteLength(init.body));
      // 必须先落账再联网；不自动重试或在重启后退还未完成请求额度。
      persist();
      console.log(`验收模型请求 ${ledger.attempts.length}/${budget.requestLimit}；累计保守预留 ${(budget.reservedMicroCny / 1e6).toFixed(6)}/2元`);
      const response = await fetchOriginal(input, { ...init, redirect: 'error' });
      attempt.status = response.status; persist();
      return response;
    } catch (error) {
      // 预算/配置失败关闭测试服务；网络失败同样保留预留，不隐式补测。
      setImmediate(() => process.emit('SIGTERM'));
      throw error;
    }
  };
  Object.assign(process.env, {
    DATABASE_PATH: join(root, 'agent.db'), MEMORY_DIR: join(root, 'memory'),
    SESSION_DIR: join(root, args.includes('--fresh-session') ? 'sessions-fresh' : 'sessions'),
    MEMORY_FORMATION_ENABLED: 'true', MEMORY_QUERY_REWRITE: 'false',
    MEMORY_FORMATION_INPUT_CNY_PER_MILLION: '2', MEMORY_FORMATION_OUTPUT_CNY_PER_MILLION: '8',
  });
  const controls = createInterface({ input: process.stdin });
  controls.on('line', line => { if (line.trim() === '/stop') process.emit('SIGTERM'); });
  process.once('SIGTERM', () => controls.close());
  process.once('SIGINT', () => controls.close());
  // main启动失败会设置exitCode；关闭测试控制台，避免stdin让失败进程悬挂。
  setInterval(() => { if (process.exitCode) controls.close(); }, 1000).unref();
  console.log(`隔离飞书验收：${root}；Formation仅测试进程开启；输入 /stop 正常停止`);
  process.argv = [process.argv[0]!, resolve('src/main.ts'), '--feishu'];
  await import('../src/main.js');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void start().catch(error => {
    console.error(redactor(process.env.LLM_API_KEY ?? '', process.env.FEISHU_APP_SECRET)(error));
    process.exitCode = 1;
  });
}
