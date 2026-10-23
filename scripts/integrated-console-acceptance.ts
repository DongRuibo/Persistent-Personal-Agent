import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readConfig, redactor } from '../src/config.js';
import { approveSkill } from '../src/skills-admin.js';
import { SkillService } from '../src/skill-service.js';
import { WebReadService } from '../src/web-read-service.js';
import type { WebResolver, WebTransport } from '../src/web-read-service.js';
import { defaultWebResources } from '../src/web-read-types.js';
import { recordAcceptanceResponse } from './feishu-formation-acceptance.js';

export const integratedLimits = { requests: 32, microCny: 6000000, bodyBytes: 65536, outputTokens: 4096 } as const;
export const integratedWebLimit = { reservations: 1, resourceId: 'pi-skills-v1',
  url: 'https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md' } as const;
export interface AcceptanceProfile {
  endpoint: string; model: string; inputRate: number; outputRate: number; checkedAt: string;
  planHash: string; entryHash: string; codeHash: string;
}
interface Attempt { at: string; bytes: number; output: number; reservedMicroCny: number; status?: number }
interface WebAttempt { at: string; resourceId: string; url: string; catalogHash: string }
interface Ledger { version: 2; scope: 's0-s1b-v301-console-v2'; identity: string; limits: typeof integratedLimits; profile: AcceptanceProfile; attempts: Attempt[];
  webLimit: typeof integratedWebLimit; webAttempts: WebAttempt[] }
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const capacity = (bytes: number, output: number) => Number.isSafeInteger(bytes) && bytes > 0 && bytes <= integratedLimits.bodyBytes
  && Number.isSafeInteger(output) && output > 0 && output <= integratedLimits.outputTokens;
const price = (profile: AcceptanceProfile, bytes: number, output: number) => Math.ceil((bytes + 512) * profile.inputRate + output * profile.outputRate);
const freshPrice = (profile: AcceptanceProfile) => Number.isFinite(Date.parse(profile.checkedAt)) && Date.now() - Date.parse(profile.checkedAt) <= 86400000 && Date.parse(profile.checkedAt) <= Date.now() + 60000;

// 只服务本轮冻结Console方案；不接受旧账本、追加额度、收费重试或模型提供的费率。
export class IntegratedAcceptanceBudget {
  constructor(readonly ledger: Ledger) {
    const p = ledger.profile;
    if (ledger.version !== 2 || ledger.scope !== 's0-s1b-v301-console-v2' || !/^[a-f0-9]{64}$/u.test(ledger.identity)
      || JSON.stringify(ledger.limits) !== JSON.stringify(integratedLimits) || !p || !p.endpoint || !p.model
      || JSON.stringify(ledger.webLimit) !== JSON.stringify(integratedWebLimit) || !Array.isArray(ledger.webAttempts)
      || ledger.webAttempts.length > integratedWebLimit.reservations || ledger.webAttempts.some(a => !Number.isFinite(Date.parse(a.at))
        || a.resourceId !== integratedWebLimit.resourceId || a.url !== integratedWebLimit.url || !/^[a-f0-9]{64}$/u.test(a.catalogHash))
      || ![p.inputRate, p.outputRate].every(n => Number.isFinite(n) && n > 0 && n <= 10000)
      || !Number.isFinite(Date.parse(p.checkedAt)) || [p.planHash, p.entryHash, p.codeHash].some(h => !/^[a-f0-9]{64}$/u.test(h))
      || !Array.isArray(ledger.attempts) || ledger.attempts.length > integratedLimits.requests
      || ledger.attempts.some(a => !capacity(a.bytes, a.output) || !Number.isFinite(Date.parse(a.at))
        || a.reservedMicroCny !== price(p, a.bytes, a.output) || a.status !== undefined && (!Number.isInteger(a.status) || a.status < 100 || a.status > 599))
      || this.reserved > integratedLimits.microCny) throw new Error('统一验收账本损坏、费率未知或限额变化，拒绝联网');
  }
  get reserved(): number { return this.ledger.attempts.reduce((sum, item) => sum + item.reservedMicroCny, 0); }
  reserveWeb(resourceId: string, url: string, catalogHash: string): void {
    if (resourceId !== integratedWebLimit.resourceId || url !== integratedWebLimit.url || !/^[a-f0-9]{64}$/u.test(catalogHash)) throw new Error('统一验收仅允许固定Pi Skills资源及HTTPS地址');
    if (this.ledger.webAttempts.length >= integratedWebLimit.reservations) throw new Error('统一验收整轮最多一次Web GET预留，失败、中断或重启不退额');
    this.ledger.webAttempts.push({ at: new Date().toISOString(), resourceId, url, catalogHash });
  }
  reserve(bytes: number, output: number): Attempt {
    if (!freshPrice(this.ledger.profile)) throw new Error('统一验收费率核实已过期，拒绝继续联网');
    if (!capacity(bytes, output)) throw new Error('统一验收请求超过65536字节或4096输出Token');
    const reservedMicroCny = price(this.ledger.profile, bytes, output);
    if (this.ledger.attempts.length >= integratedLimits.requests || this.reserved + reservedMicroCny > integratedLimits.microCny) throw new Error('统一验收已达32请求或6元保守预留上限');
    const attempt = { at: new Date().toISOString(), bytes, output, reservedMicroCny }; this.ledger.attempts.push(attempt); return attempt;
  }
}

export function openIntegratedAcceptance(root: string, profile: AcceptanceProfile, resume = false) {
  if (!isAbsolute(root) || !Number.isFinite(Date.parse(profile.checkedAt)) || Date.now() - Date.parse(profile.checkedAt) > 86400000
    || Date.parse(profile.checkedAt) > Date.now() + 60000) throw new Error('需要新的绝对隔离目录及24小时内人工确认的费率');
  root = resolve(root);
  const file = join(root, 'integrated-budget.json'), pending = file + '.pending', lock = join(root, 'integrated.lock');
  if (resume ? !fs.existsSync(file) : fs.existsSync(root)) throw new Error('新验收必须新目录，续测不得重置或沿用历史账本');
  if (!resume) fs.mkdirSync(root, { mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink() || fs.existsSync(pending) || resume && fs.lstatSync(file).isSymbolicLink()) throw new Error('验收目录/账本链接或未完成原子写入需要人工核对');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600));
  let closed = false, failed = false;
  const close = () => { if (!closed) { closed = true; fs.rmSync(lock); } };
  try {
    const identity = digest(JSON.stringify([root, profile, integratedLimits, integratedWebLimit]));
    const ledger: Ledger = resume ? JSON.parse(fs.readFileSync(file, 'utf8')) : {
      version: 2, scope: 's0-s1b-v301-console-v2', identity, limits: { ...integratedLimits }, profile: structuredClone(profile), attempts: [],
      webLimit: { ...integratedWebLimit }, webAttempts: [],
    };
    const budget = new IntegratedAcceptanceBudget(ledger);
    if (ledger.identity !== identity || JSON.stringify(profile) !== JSON.stringify(ledger.profile)) throw new Error('根目录、端点、模型、费率、方案或源码已改变，拒绝续测');
    const persist = () => {
      if (closed || failed) throw new Error('统一验收账本已关闭或写入失败');
      try {
        const fd = fs.openSync(pending, 'wx', 0o600);
        try { fs.writeFileSync(fd, JSON.stringify(ledger, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(pending, file);
      } catch (error) { failed = true; throw error; }
    };
    persist(); return { root, budget, persist, close };
  } catch (error) { close(); throw error; }
}

// 验收专用子类仅在DNS之前加整轮预留；产品服务的许可、SQLite及HTTPS校验原样复用。
export function integratedAcceptanceWeb(session: ReturnType<typeof openIntegratedAcceptance>, resolver?: WebResolver, transport?: WebTransport): WebReadService {
  const resource = defaultWebResources.find(item => item.id === integratedWebLimit.resourceId);
  if (!resource || resource.url !== integratedWebLimit.url) throw new Error('统一验收固定Web目录已改变，需要重新审查方案');
  return new class extends WebReadService {
    override async fetch(id: string, hash: string, signal: AbortSignal) {
      signal.throwIfAborted();
      const approved = this.current(id, hash);
      session.budget.reserveWeb(approved.id, approved.url, approved.hash);
      session.persist(); // 同步落盘完成前不得调用父类；失败、取消和未知结果不释放预留。
      return super.fetch(id, hash, signal);
    }
  }([resource], resolver, transport);
}

export function integratedAcceptanceFetch(session: ReturnType<typeof openIntegratedAcceptance>, apiKey: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  const profile = session.budget.ledger.profile, redact = redactor(apiKey);
  return async (input, init) => {
    init?.signal?.throwIfAborted();
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!apiKey || url.href !== profile.endpoint || init?.method?.toUpperCase() !== 'POST' || typeof init.body !== 'string' || init.body.includes(apiKey)) throw new Error('统一验收拒绝非固定模型POST或含密钥的请求体');
    const payload = JSON.parse(init.body);
    if (payload.model !== profile.model || payload.enable_thinking === true || payload.max_tokens !== undefined && payload.max_completion_tokens !== undefined) throw new Error('统一验收模型、推理或输出限制不符');
    const attempt = session.budget.reserve(Buffer.byteLength(init.body), payload.max_tokens ?? payload.max_completion_tokens);
    session.persist(); // 必须在任何实际发送及等待之前持久化；失败和退出不退额。
    const sequence = String(session.budget.ledger.attempts.length).padStart(2, '0');
    fs.writeFileSync(join(session.root, 'request-' + sequence + '.json'), init.body, { flag: 'wx', mode: 0o600 });
    const response = await transport(input, { ...init, redirect: 'error' });
    attempt.status = response.status; session.persist();
    return recordAcceptanceResponse(response, join(session.root, 'response-' + sequence + '.txt'), redact, 4194304);
  };
}

async function start() {
  const args = process.argv.slice(2), root = args.find(a => a.startsWith('--root='))?.slice(7);
  if (!args.includes('--authorized') || !args.includes('--rates-confirmed') || !args.includes('--web-authorized') || !root
    || args.some(a => !['--authorized', '--rates-confirmed', '--web-authorized', '--resume', '--baseline'].includes(a) && !a.startsWith('--root='))) throw new Error('本轮须另行批准32次/6元及一次固定Web访问；注入已核对模型配置后使用 --authorized --rates-confirmed --web-authorized --root=<新绝对目录>');
  const base = process.env.LLM_BASE_URL, model = process.env.LLM_MODEL, key = process.env.LLM_API_KEY;
  if (!base || !model || !key || process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== 'personal-compatible') throw new Error('仅使用已注入的兼容模型配置，不读取.env或账号配置');
  const endpoint = new URL(base.replace(/\/$/u, '') + '/chat/completions');
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('模型端点必须是已批准的HTTPS固定地址');
  const planFile = resolve('docs/evaluations/integrated-console-live-plan.md');
  const source = fs.readdirSync('src').filter(name => name.endsWith('.ts')).sort().map(name => [name, digest(fs.readFileSync(join('src', name)))]);
  const profile: AcceptanceProfile = { endpoint: endpoint.href, model, inputRate: Number(process.env.ACCEPTANCE_INPUT_RATE), outputRate: Number(process.env.ACCEPTANCE_OUTPUT_RATE),
    checkedAt: process.env.ACCEPTANCE_PRICE_CHECKED_AT ?? '', planHash: digest(fs.readFileSync(planFile)), entryHash: digest(fs.readFileSync(fileURLToPath(import.meta.url))),
    codeHash: digest(JSON.stringify([...source, ['package-lock.json', digest(fs.readFileSync('package-lock.json'))], ...['agent-notes', 'interview-practice'].map(id => [id, digest(fs.readFileSync(join('skills', id, 'SKILL.md')))])])) };
  process.umask(0o077);
  const session = openIntegratedAcceptance(root, profile, args.includes('--resume')); process.once('exit', session.close);
  const managed = join(session.root, 'approved-skills'), baseline = args.includes('--baseline');
  if (!args.includes('--resume')) {
    fs.copyFileSync(planFile, join(session.root, 'frozen-plan.md'), fs.constants.COPYFILE_EXCL);
    for (const id of ['agent-notes', 'interview-practice']) { fs.cpSync(join('skills', id), join(managed, id), { recursive: true }); approveSkill(managed, id, true); }
    fs.writeFileSync(join(session.root, 'authorization.json'), JSON.stringify({ scope: session.budget.ledger.scope, profile, limits: integratedLimits,
      skills: new SkillService(managed).list().map(({ id, hash }) => ({ id, hash })), consoleOnly: true, webLimit: integratedWebLimit }, null, 2), { flag: 'wx', mode: 0o600 });
  } else {
    const frozen = JSON.parse(fs.readFileSync(join(session.root, 'authorization.json'), 'utf8'));
    if (digest(fs.readFileSync(join(session.root, 'frozen-plan.md'))) !== profile.planHash
      || JSON.stringify(new SkillService(managed).list().map(({ id, hash }) => ({ id, hash }))) !== JSON.stringify(frozen.skills)) throw new Error('冻结方案或已安装Skill变化，拒绝续测');
  }
  Object.assign(process.env, { DATABASE_PATH: join(session.root, 'agent.db'), MEMORY_DIR: join(session.root, 'memory'), SESSION_DIR: join(session.root, baseline ? 'sessions-baseline' : 'sessions'),
    SKILLS_DIR: managed, SKILLS_ENABLED: String(!baseline), WEB_READ_ENABLED: String(!baseline), GOAL_ENABLED: String(!baseline),
    PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', LLM_PROVIDER: 'personal-compatible' });
  readConfig();
  const guarded = integratedAcceptanceFetch(session, key);
  globalThis.fetch = async (input, init) => {
    try { return await guarded(input, init); }
    catch (error) { process.exitCode = 1; setImmediate(() => process.emit('SIGTERM')); throw error; }
  };
  console.log('统一隔离Console验收；32模型请求/6元/65536字节及整轮一次固定Web GET预留；不重试、不扩额。/quit停止；所有原始文件只留新目录。');
  const { main } = await import('../src/main.js');
  process.argv = [process.argv[0]!, resolve('src/main.ts')]; await main(integratedAcceptanceWeb(session));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void start().catch(error => {
  console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1;
});
