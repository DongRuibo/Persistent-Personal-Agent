import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PassThrough } from 'node:stream';
import { readConfig, redactor } from '../src/config.js';
import { approveSkill } from '../src/skills-admin.js';
import { SkillService, skillPackage, safeSkillFile } from '../src/skill-service.js';
import { WebReadService } from '../src/web-read-service.js';
import type { WebResolver, WebTransport, WebPhaseReporter } from '../src/web-read-service.js';
import { defaultWebResources } from '../src/web-read-types.js';
import { recordAcceptanceResponse } from './feishu-formation-acceptance.js';
import type { AcceptanceProfile } from './integrated-console-acceptance.js';
import { integratedWebLimit } from './integrated-console-acceptance.js';
import { stagedCases, stagedLimits, stageLimits, stagedModel } from './staged-console-cases.js';
import type { StagedCase } from './staged-console-cases.js';

type Profile = AcceptanceProfile & { casesHash: string; nodeVersion: string };
interface Attempt { caseId: StagedCase; at: string; bytes: number; output: number; reservedMicroCny: number; status?: number }
interface CaseRecord { id: StagedCase; at: string; finished?: string; statePass?: boolean }
interface Ledger { version: 1; scope: 'goal-skills-web-staged-console-v1'; identity: string; profile: Profile;
  limits: typeof stagedLimits; stages: typeof stageLimits; cases: CaseRecord[]; attempts: Attempt[];
  webLimit: typeof integratedWebLimit; webAttempts: { at: string; caseId: 'B1'; resourceId: string; url: string; catalogHash: string }[] }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const validTime = (value: string) => Number.isFinite(Date.parse(value));
const fresh = (p: Profile) => validTime(p.checkedAt) && Date.now() - Date.parse(p.checkedAt) <= 86400000 && Date.parse(p.checkedAt) <= Date.now() + 60000;
const price = (p: Profile, bytes: number, output: number) => Math.ceil((bytes + 512) * p.inputRate + output * p.outputRate);
const capacity = (bytes: number, output: number) => Number.isSafeInteger(bytes) && bytes > 0 && bytes <= stagedLimits.bodyBytes && Number.isSafeInteger(output) && output > 0 && output <= stagedLimits.outputTokens;

// 只服务此份分阶段方案；旧32/6入口和历史账本保持原样。
export class StagedAcceptanceBudget {
  constructor(readonly ledger: Ledger) {
    const p = ledger.profile;
    if (ledger.version !== 1 || ledger.scope !== 'goal-skills-web-staged-console-v1' || !/^[a-f0-9]{64}$/u.test(ledger.identity)
      || JSON.stringify(ledger.limits) !== JSON.stringify(stagedLimits) || JSON.stringify(ledger.stages) !== JSON.stringify(stageLimits)
      || JSON.stringify(ledger.webLimit) !== JSON.stringify(integratedWebLimit) || !p || !p.endpoint || !p.model || !p.nodeVersion
      || ![p.inputRate, p.outputRate].every(n => Number.isFinite(n) && n > 0 && n <= 10000) || !validTime(p.checkedAt)
      || [p.planHash, p.entryHash, p.codeHash, p.casesHash].some(h => !/^[a-f0-9]{64}$/u.test(h))
      || !Array.isArray(ledger.cases) || new Set(ledger.cases.map(c => c.id)).size !== ledger.cases.length
      || ledger.cases.some(c => !Object.hasOwn(stagedCases, c.id) || !validTime(c.at) || c.finished !== undefined && (!validTime(c.finished) || typeof c.statePass !== 'boolean'))
      || !Array.isArray(ledger.attempts) || ledger.attempts.some(a => !Object.hasOwn(stagedCases, a.caseId) || !ledger.cases.some(c => c.id === a.caseId)
        || !validTime(a.at) || !capacity(a.bytes, a.output) || a.reservedMicroCny !== price(p, a.bytes, a.output)
        || a.status !== undefined && (!Number.isInteger(a.status) || a.status < 100 || a.status > 599))
      || !Array.isArray(ledger.webAttempts) || ledger.webAttempts.length > 1 || ledger.webAttempts.some(w => w.caseId !== 'B1' || !ledger.cases.some(c => c.id === 'B1') || !validTime(w.at)
        || w.resourceId !== integratedWebLimit.resourceId || w.url !== integratedWebLimit.url || !/^[a-f0-9]{64}$/u.test(w.catalogHash))) throw new Error('分阶段账本损坏、旧轮格式或未知费率；拒绝联网');
    this.check();
  }
  get reserved(): number { return this.ledger.attempts.reduce((sum, a) => sum + a.reservedMicroCny, 0); }
  private check(): void {
    if (this.ledger.attempts.length > stagedLimits.requests || this.reserved > stagedLimits.microCny
      || Object.entries(stageLimits).some(([stage, limit]) => { const a = this.ledger.attempts.filter(a => stagedCases[a.caseId].stage === stage); return a.length > limit.requests || a.reduce((s, x) => s + x.reservedMicroCny, 0) > limit.microCny; })
      || Object.entries(stagedCases).some(([id, spec]) => this.ledger.attempts.filter(a => a.caseId === id).length > spec.max)) throw new Error('分阶段请求/费用/单步限额已超出');
  }
  reserve(caseId: StagedCase, bytes: number, output: number): Attempt {
    if (!fresh(this.ledger.profile) || !capacity(bytes, output)) throw new Error('费率过期、请求超过64KiB或输出超过4096');
    if (!this.ledger.cases.some(c => c.id === caseId && !c.finished)) throw new Error('当前步骤未开始或已结束');
    const a = this.ledger.attempts, spec = stagedCases[caseId], stage = stageLimits[spec.stage];
    const current = a.filter(x => stagedCases[x.caseId].stage === spec.stage), cost = price(this.ledger.profile, bytes, output);
    if (a.length >= stagedLimits.requests || this.reserved + cost > stagedLimits.microCny || current.length >= stage.requests
      || current.reduce((s, x) => s + x.reservedMicroCny, 0) + cost > stage.microCny || a.filter(x => x.caseId === caseId).length >= spec.max) throw new Error('当前步骤/阶段/整轮预算不足；不扩额或重试');
    const attempt = { caseId, at: new Date().toISOString(), bytes, output, reservedMicroCny: cost }; a.push(attempt); return attempt;
  }
  reserveWeb(caseId: StagedCase, id: string, url: string, hash: string): void {
    if (caseId !== 'B1' || !this.ledger.cases.some(c => c.id === caseId && !c.finished) || id !== integratedWebLimit.resourceId || url !== integratedWebLimit.url
      || !/^[a-f0-9]{64}$/u.test(hash) || this.ledger.webAttempts.length) throw new Error('只允许B1整轮一次固定Web预留；失败/重启不退额');
    this.ledger.webAttempts.push({ caseId: 'B1', at: new Date().toISOString(), resourceId: id, url, catalogHash: hash });
  }
}

type Row = Record<string, unknown>;
export function stagedAudit(root: string) {
  const path = join(root, 'agent.db'), empty = { goals: [] as Row[], plans: [] as Row[], steps: [] as Row[], executions: [] as Row[], web: [] as Row[], events: [] as Row[], modelCalls: [] as Row[], foreground: [] as Row[] };
  if (!fs.existsSync(path)) return empty;
  if (fs.lstatSync(path).isSymbolicLink()) throw new Error('隔离SQLite不能是链接');
  const db = new DatabaseSync(path, { readOnly: true });
  try { return { goals: db.prepare('SELECT * FROM goals ORDER BY rowid').all(), plans: db.prepare('SELECT * FROM goal_plans ORDER BY revision').all(),
    steps: db.prepare('SELECT * FROM goal_steps ORDER BY rowid').all(), executions: db.prepare('SELECT * FROM goal_executions ORDER BY rowid').all(), web: db.prepare('SELECT * FROM web_read_calls ORDER BY rowid').all(),
    modelCalls: db.prepare('SELECT * FROM model_calls ORDER BY rowid').all(),
    events: db.prepare('SELECT * FROM run_events ORDER BY id').all(), foreground: db.prepare('SELECT * FROM runs WHERE taskId IS NULL AND id NOT IN (SELECT runId FROM goal_executions) ORDER BY rowid').all() }; }
  finally { db.close(); }
}
type Audit = ReturnType<typeof stagedAudit>;
const goalFor = (audit: Audit, stage: 'A' | 'C') => audit.goals.filter(g => String(g.objective).includes(stage === 'A' ? '青桐阅读计划' : '杜鹃资料练习'));
export function stateMatches(id: StagedCase, audit: Audit): boolean {
  if (id === 'B1') {
    const row = audit.web[0], snapshot = row?.snapshotJson ? JSON.parse(String(row.snapshotJson)) : null;
    return audit.web.length === 1 && row?.status === 'succeeded' && row.resourceId === integratedWebLimit.resourceId
      && row.owner === sha('console') && row.channel === JSON.stringify({ channel: 'console' })
      && snapshot?.url === integratedWebLimit.url && snapshot.contentHash === sha(Buffer.from(snapshot.text, 'utf8'))
      && snapshot.bytes === Buffer.byteLength(snapshot.text) && snapshot.bytes > 0 && snapshot.bytes <= 32768
      && snapshot.version === defaultWebResources[0]!.version && snapshot.catalogHash === defaultWebResources[0]!.hash && row.catalogHash === snapshot.catalogHash
      && audit.foreground.some(r => r.id === row.runId && r.status === 'succeeded')
      && audit.events.some(e => e.runId === row.runId && e.type === 'delivery_succeeded')
      && audit.events.some(e => e.runId === row.runId && e.type === 'skill_activated' && JSON.parse(String(e.details)).id === 'agent-notes');
  }
  const stage = stagedCases[id].stage as 'A' | 'C', goals = goalFor(audit, stage);
  if (audit.plans.some(p => sha(String(p.specJson)) !== p.hash) || audit.executions.some(e => sha(String(e.inputJson)) !== e.inputHash
    || e.checkpointJson !== null && sha(String(e.checkpointJson)) !== e.checkpointHash)) return false;
  if (goals.length !== 1) return false;
  const g = goals[0]!, executions = audit.executions.filter(e => e.goalId === g.id), last = executions.at(-1), cp = last?.checkpointJson ? JSON.parse(String(last.checkpointJson)) : null;
  if (!last || executions.some(e => e.status !== 'committed')) return false;
  if (id === 'A1' || id === 'C1' || id === 'C2') {
    const draft = g.pendingActionJson ? JSON.parse(String(g.pendingActionJson)) : null, step = draft?.spec?.steps?.[0], binding = draft?.spec?.skillBindings?.[0];
    if (draft) { const { hash, ...body } = draft; if (sha(JSON.stringify(body)) !== hash) return false; }
    if (id === 'C2') {
      const b = draft?.spec?.webBindings?.[0], source = audit.web.find(w => w.id === b?.snapshotId), snapshot = source?.snapshotJson ? JSON.parse(String(source.snapshotJson)) : null;
      if (!b || !snapshot || !stateMatches('B1', audit)) return false;
      const parts = snapshot.text.split('\n'), selected = parts.slice(0, 8).join('\n');
      if (parts.length < 8 || !selected.trim() || Buffer.byteLength(selected) > 4096 || b.selectedHash !== sha(selected)
        || b.selectedBytes !== Buffer.byteLength(selected) || b.contentHash !== snapshot.contentHash || b.catalogHash !== snapshot.catalogHash) return false;
    }
    return g.status === 'waiting_user' && g.planRevision === 0 && executions.length === 1 && draft?.spec.steps.length === 1
      && /^[a-f0-9-]{36}$/u.test(step?.stepId ?? '') && step.stepId !== last.stepId && binding?.skillId === 'interview-practice'
      && (id !== 'C2' || draft.spec.webBindings?.length === 1 && draft.spec.webBindings[0].lines?.start === 1 && draft.spec.webBindings[0].lines?.end === 8);
  }
  const expectedCount = ['A6', 'A7'].includes(id) ? 3 : 2;
  if (g.planRevision !== 1 || executions.length !== expectedCount || g.checkpointRunId !== last.runId || !cp) return false;
  const input = JSON.parse(String(last.inputJson));
  if (input.skill?.id !== 'interview-practice' || stage === 'C' && !input.web) return false;
  return g.status === (id === 'A5' ? 'paused' : id === 'A7' ? 'cancelled' : 'waiting_user')
    && cp.stepOutcome === (['A6', 'A7'].includes(id) ? 'complete' : 'partial');
}

export function openStagedAcceptance(root: string, profile: Profile, resume = false) {
  if (!isAbsolute(root) || !fresh(profile)) throw new Error('需要新绝对隔离目录及24小时内核实费率');
  root = resolve(root); const file = join(root, 'staged-budget.json'), pending = file + '.pending', lock = join(root, 'staged.lock');
  for (let p = root; ; p = dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error('验收目录及祖先禁止链接/junction');
    if (dirname(p) === p) break;
  }
  if (resume ? !fs.existsSync(file) : fs.existsSync(root)) throw new Error('必须新目录/新账本；不接受旧轮或重置');
  if (!resume) fs.mkdirSync(root, { mode: 0o700 });
  if (fs.lstatSync(root).isSymbolicLink() || fs.existsSync(pending) || resume && fs.lstatSync(file).isSymbolicLink()) throw new Error('链接或未完成写入，拒绝恢复');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600)); let closed = false, failed = false;
  const close = () => { if (!closed) { closed = true; fs.rmSync(lock); } };
  try {
    const identity = sha(JSON.stringify([root, profile, stagedLimits, stageLimits, stagedCases, integratedWebLimit]));
    const ledger: Ledger = resume ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, scope: 'goal-skills-web-staged-console-v1', identity, profile: structuredClone(profile),
      limits: { ...stagedLimits }, stages: structuredClone(stageLimits), cases: [], attempts: [], webLimit: { ...integratedWebLimit }, webAttempts: [] };
    const budget = new StagedAcceptanceBudget(ledger);
    if (ledger.identity !== identity || JSON.stringify(ledger.profile) !== JSON.stringify(profile)) throw new Error('根目录/配置/费率/方案/源码/Node已改变，拒绝续测');
    const persist = () => {
      if (closed || failed) throw new Error('账本已关闭或写入失败');
      try { const fd = fs.openSync(pending, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(ledger, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(pending, file); }
      catch (error) { failed = true; throw error; }
    };
    const begin = (id: StagedCase, reviewed = false) => {
      if (closed || failed || ledger.cases.some(c => c.id === id) || ledger.cases.some(c => !c.finished)) throw new Error('步骤已消费或上次未正常结束；禁止重发');
      const ids = Object.keys(stagedCases) as StagedCase[], stage = stagedCases[id].stage;
      const group = ids.filter(k => stagedCases[k].stage === stage), previous = group.slice(0, group.indexOf(id)).at(-1);
      if (id !== 'A1' && id !== 'B1' && id !== 'C1' && (!previous || !ledger.cases.some(c => c.id === previous && c.statePass && c.finished))) throw new Error('本阶段前置步骤未通过');
      if (stage === 'A' && ledger.cases.some(c => stagedCases[c.id].stage !== 'A') || stage === 'B' && ledger.cases.some(c => stagedCases[c.id].stage === 'C')) throw new Error('不能返回已结束阶段');
      const audit = stagedAudit(root);
      if (audit.foreground.some(r => r.status === 'running') || audit.executions.some(e => e.status === 'running')) throw new Error('存在未结束执行，需人工核对');
      if (id === 'C1' && (!reviewed || !ledger.cases.some(c => c.id === 'A7' && c.statePass) || !ledger.cases.some(c => c.id === 'B1' && c.statePass)
        || !stateMatches('A7', audit) || !stateMatches('B1', audit))) throw new Error('联合阶段需要A/B真实状态及操作者语义证据审阅通过');
      if (previous && !['A1', 'B1', 'C1'].includes(id) && !stateMatches(previous, audit)) throw new Error('前置SQLite状态已变化');
      if (stage !== 'B' && audit.goals.length) {
        const approved = JSON.parse(fs.readFileSync(join(root, 'authorization.json'), 'utf8')).skills as { id: string; hash: string }[];
        const specs = [...audit.plans.map(p => JSON.parse(String(p.specJson))), ...audit.goals.filter(g => g.pendingActionJson).map(g => JSON.parse(String(g.pendingActionJson)).spec)];
        if (specs.some(spec => (spec.skillBindings ?? []).some((b: { skillId: string; packageHash: string }) => !approved.some(s => s.id === b.skillId && s.hash === b.packageHash)))) throw new Error('已批准Skill绑定Hash不符');
      }
      ledger.cases.push({ id, at: new Date().toISOString() }); persist();
    };
    const finish = (id: StagedCase, statePass: boolean) => { const c = ledger.cases.find(c => c.id === id && !c.finished); if (!c) throw new Error('步骤不是在途'); c.finished = new Date().toISOString(); c.statePass = statePass; persist(); };
    persist(); return { root, budget, persist, begin, finish, close };
  } catch (error) { close(); throw error; }
}

type Session = ReturnType<typeof openStagedAcceptance>;
export function stagedAcceptanceFetch(session: Session, caseId: StagedCase, key: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    init?.signal?.throwIfAborted(); const p = session.budget.ledger.profile;
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!key || url.href !== p.endpoint || init?.method !== 'POST' || typeof init.body !== 'string' || init.body.includes(key)) throw new Error('拒绝非固定模型POST或含密钥正文');
    const payload = JSON.parse(init.body), system = String(payload.messages?.find((m: { role: string }) => m.role === 'system')?.content ?? '');
    const content = payload.messages?.findLast((m: { role: string }) => m.role === 'user')?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => part.text ?? '').join('') : '';
    const goal = system.includes('有界纯文本片段'), intent = system.includes('隔离的当前用户意图解析器');
    const actual = goal ? JSON.parse(text.split('UNTRUSTED_GOAL_SNAPSHOT=')[1] ?? '{}')?.goal?.input?.text : intent ? JSON.parse(text)?.message : text.replace(/^\[当前用户时间：[^\n]+\]\n/u, '');
    if (payload.model !== p.model || payload.enable_thinking === true || payload.max_tokens !== undefined && payload.max_completion_tokens !== undefined
      || actual !== stagedCases[caseId].prompt || goal && (!stagedCases[caseId].goal || payload.tools?.length || Buffer.byteLength(init.body) > 32768)
      || (payload.tools ?? []).some((t: { function: { name: string } }) => t.function.name === (stagedCases[caseId].stage === 'B' ? 'goal_manage' : 'web_get'))) throw new Error('模型/冻结话术/执行范围不符；不发送');
    const a = session.budget.reserve(caseId, Buffer.byteLength(init.body), payload.max_tokens ?? payload.max_completion_tokens); session.persist();
    const seq = String(session.budget.ledger.attempts.length).padStart(2, '0'); fs.writeFileSync(join(session.root, 'request-' + seq + '.json'), init.body, { flag: 'wx', mode: 0o600 });
    const response = await transport(input, { ...init, redirect: 'error' }); a.status = response.status; session.persist();
    return recordAcceptanceResponse(response, join(session.root, 'response-' + seq + '.txt'), redactor(key), 4194304);
  };
}
export function stagedAcceptanceWeb(session: Session, caseId: StagedCase, resolver?: WebResolver, transport?: WebTransport) {
  const resource = defaultWebResources.find(r => r.id === integratedWebLimit.resourceId)!;
  if (resource.url !== integratedWebLimit.url) throw new Error('固定资源变化');
  return new class extends WebReadService {
    override async fetch(id: string, hash: string, signal: AbortSignal, report?: WebPhaseReporter) {
      signal.throwIfAborted(); const approved = this.current(id, hash); session.budget.reserveWeb(caseId, id, approved.url, approved.hash); session.persist();
      return super.fetch(id, hash, signal, report);
    }
  }([resource], resolver, transport);
}

async function start() {
  const args = process.argv.slice(2), root = args.find(a => a.startsWith('--root='))?.slice(7), id = args.find(a => a.startsWith('--case='))?.slice(7) as StagedCase;
  if (!args.includes('--authorized') || !args.includes('--rates-confirmed') || !root || !Object.hasOwn(stagedCases, id)
    || args.some(a => !['--authorized', '--rates-confirmed', '--web-authorized', '--prerequisites-confirmed', '--resume'].includes(a) && !a.startsWith('--root=') && !a.startsWith('--case='))) throw new Error('须另行批准46请求/8元及范围；准备不授权执行，使用固定--case和新--root');
  if (id === 'B1' && !args.includes('--web-authorized')) throw new Error('B1须另行批准一次固定Web访问');
  const config = { model: process.env.LLM_MODEL, endpoint: (process.env.LLM_BASE_URL ?? '').replace(/\/$/u, '') + '/chat/completions' }, key = process.env.LLM_API_KEY;
  if (!key || config.model !== stagedModel.model || config.endpoint !== stagedModel.endpoint || process.env.LLM_PROVIDER && process.env.LLM_PROVIDER !== 'personal-compatible') throw new Error('只使用已注入的指定模型/兼容端点，不读取.env');
  const plan = resolve('docs/evaluations/staged-console-live-plan.md'), entry = fileURLToPath(import.meta.url);
  const source = [...fs.readdirSync('src').filter(n => n.endsWith('.ts')).map(n => join('src', n)), 'package-lock.json', 'scripts/staged-console-cases.ts', 'scripts/feishu-formation-acceptance.ts', 'scripts/integrated-console-acceptance.ts',
    ...['agent-notes', 'interview-practice'].map(id => join('skills', id, 'SKILL.md'))].sort().map(p => [p, sha(fs.readFileSync(p))]);
  const profile: Profile = { ...stagedModel, inputRate: Number(process.env.ACCEPTANCE_INPUT_RATE), outputRate: Number(process.env.ACCEPTANCE_OUTPUT_RATE), checkedAt: process.env.ACCEPTANCE_PRICE_CHECKED_AT ?? '',
    planHash: sha(fs.readFileSync(plan)), entryHash: sha(fs.readFileSync(entry)), casesHash: sha(JSON.stringify(stagedCases)), codeHash: sha(JSON.stringify(source)), nodeVersion: process.version };
  process.umask(0o077); const session = openStagedAcceptance(root, profile, args.includes('--resume')); process.once('exit', session.close);
  const managed = join(session.root, 'approved-skills'), skills = () => new SkillService(managed).list().map(({ id, hash }) => ({ id, hash }));
  try {
    if (!args.includes('--resume')) {
      fs.copyFileSync(plan, join(session.root, 'frozen-plan.md'), fs.constants.COPYFILE_EXCL);
      for (const id of ['agent-notes', 'interview-practice']) { fs.cpSync(join('skills', id), join(managed, id), { recursive: true }); approveSkill(managed, id, true); }
      fs.writeFileSync(join(session.root, 'authorization.json'), JSON.stringify({ profile, limits: stagedLimits, stages: stageLimits, cases: stagedCases, skills: skills(), webLimit: integratedWebLimit }), { flag: 'wx', mode: 0o600 });
    }
    const expectedSkills = ['agent-notes', 'interview-practice'].map(id => ({ id, hash: skillPackage(resolve('skills'), id, true).info.hash }));
    if (sha(safeSkillFile(session.root, join(session.root, 'frozen-plan.md'), 65536)) !== profile.planHash
      || JSON.stringify(skills()) !== JSON.stringify(expectedSkills)
      || JSON.stringify(JSON.parse(safeSkillFile(session.root, join(session.root, 'authorization.json'), 65536).toString('utf8')).skills) !== JSON.stringify(expectedSkills)) throw new Error('冻结方案/Skill变化');
    session.begin(id, args.includes('--prerequisites-confirmed'));
    const before = stagedAudit(session.root), input = new PassThrough(), nativeInput = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    const sessionHashes = () => fs.existsSync(join(session.root, 'sessions')) ? fs.readdirSync(join(session.root, 'sessions')).sort()
      .map(dir => { const file = join(session.root, 'sessions', dir, 'chat.session.jsonl'); return [dir, fs.existsSync(file) ? sha(fs.readFileSync(file)) : null]; }) : [];
    const sessionsBefore = sessionHashes();
    Object.defineProperty(process, 'stdin', { configurable: true, value: input });
    Object.assign(process.env, { DATABASE_PATH: join(session.root, 'agent.db'), MEMORY_DIR: join(session.root, 'memory'), SESSION_DIR: join(session.root, 'sessions'), SKILLS_DIR: managed,
      SKILLS_ENABLED: 'true', GOAL_ENABLED: String(stagedCases[id].stage !== 'B'), WEB_READ_ENABLED: String(id === 'B1'), PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false', LLM_PROVIDER: 'personal-compatible' });
    readConfig(); const guarded = stagedAcceptanceFetch(session, id, key); let transportFailed = false;
    globalThis.fetch = async (url, init) => { try { return await guarded(url, init); } catch (error) { transportFailed = true; setImmediate(() => process.emit('SIGTERM')); throw error; } };
    const { main } = await import('../src/main.js'); process.argv = [process.argv[0]!, resolve('src/main.ts')];
    let quitting = false;
    const started = Date.now(), timer = setInterval(() => {
      try {
        const a = stagedAudit(session.root), current = a.foreground.slice(before.foreground.length), goalBusy = stagedCases[id].stage !== 'B' && a.goals.some(g => ['ready', 'running'].includes(String(g.status)));
        if (Date.now() - started > 240000) { transportFailed = true; process.emit('SIGTERM'); }
        else if (!quitting && (stagedCases[id].prompt ? current.length > 0 && current.every(r => r.status !== 'running') && !goalBusy : Date.now() - started > 1500)) { quitting = true; input.end('/quit\n'); }
      } catch { transportFailed = true; process.emit('SIGTERM'); }
    }, 100);
    try {
      console.log(`分阶段Console ${id}：仅发送一次冻结话术，步骤最多${stagedCases[id].max}次模型HTTP；额度不足即停。`);
      if (stagedCases[id].prompt) input.write(stagedCases[id].prompt + '\n');
      await main(id === 'B1' ? stagedAcceptanceWeb(session, id) : undefined);
      const after = stagedAudit(session.root), sessionsAfter = sessionHashes();
      const stableRestart = !!stagedCases[id].prompt || JSON.stringify([before, sessionsBefore]) === JSON.stringify([after, sessionsAfter]);
      const stopped = { runningRuns: after.foreground.filter(r => r.status === 'running').length, runningExecutions: after.executions.filter(e => e.status === 'running').length,
        databaseLock: fs.existsSync(join(session.root, 'agent.db.lock')), memoryLock: fs.existsSync(join(session.root, 'memory.lock')), pendingBudget: fs.existsSync(join(session.root, 'staged-budget.json.pending')) };
      const statePass = !transportFailed && stableRestart && Object.values(stopped).every(v => !v) && stateMatches(id, after);
      fs.writeFileSync(join(session.root, id + '-audit.json'), JSON.stringify({ before, after, sessionsBefore, sessionsAfter, stableRestart, stopped, statePass, note: '仅机械状态检查；原始模型语义与收据解释须操作者独立审阅' }, null, 2), { flag: 'wx', mode: 0o600 }); session.finish(id, statePass);
      console.log(JSON.stringify({ caseId: id, statePass, modelHttp: session.budget.ledger.attempts.length, reservedMicroCny: session.budget.reserved, webReservations: session.budget.ledger.webAttempts.length }));
      if (!statePass) process.exitCode = 1;
    } finally { clearInterval(timer); input.destroy(); Object.defineProperty(process, 'stdin', nativeInput); }
  } finally { session.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void start().catch(error => { console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1; });
