import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { AcceptanceProfile } from './integrated-console-acceptance.js';
import { groupLimits, independentCases, independentLimits } from './independent-console-cases.js';
import type { Group } from './independent-console-cases.js';

export const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export interface IndependentProfile extends AcceptanceProfile { casesHash: string; nodeVersion: string; cacheReadRate: number; extraFeesCny: 0 }
export interface IndependentDefinition {
  scope: 'independent-prs-console-v1' | 'natural-pause-console-v1' | 'manual-goal-console-v1' | 'manual-goal-console-v2';
  limits: { requests: number; microCny: number; bodyBytes: number; outputTokens: number; publicGets: 0 };
  groups: Partial<Record<Group, { requests: number; microCny: number }>>;
  cases: Record<string, { group: Group; expected: number; max: number; goal: boolean; prompt: string }>;
}
export const independentDefinition: IndependentDefinition = { scope: 'independent-prs-console-v1', limits: independentLimits, groups: groupLimits, cases: independentCases };
interface CaseRecord { id: string; at: string; finished?: string; statePass?: boolean; previousReviewedAt?: string }
interface Attempt { caseId: string; at: string; bytes: number; output: number; reservedMicroCny: number; status?: number }
interface Ledger { version: 1; scope: IndependentDefinition['scope']; identity: string; profile: IndependentProfile;
  limits: IndependentDefinition['limits']; groups: IndependentDefinition['groups']; cases: CaseRecord[]; attempts: Attempt[]; halted?: string }
const time = (s: string) => typeof s === 'string' && Number.isFinite(Date.parse(s));
const fresh = (p: IndependentProfile) => time(p.checkedAt) && Date.now() - Date.parse(p.checkedAt) <= 86400000 && Date.parse(p.checkedAt) <= Date.now() + 60000;
const capacity = (b: number, o: number, limits: IndependentDefinition['limits']) => Number.isSafeInteger(b) && b > 0 && b <= limits.bodyBytes && Number.isSafeInteger(o) && o > 0 && o <= limits.outputTokens;
const price = (p: IndependentProfile, b: number, o: number) => Math.ceil((b + 512) * p.inputRate + o * p.outputRate);
export class CaseBlocked extends Error {}
export class GroupBudgetExhausted extends Error {}

// 固定宿主方案共用预留/落盘；定义只由入口静态提供，不能来自模型或旧账本。
export class IndependentBudget {
  constructor(readonly ledger: Ledger, readonly definition: IndependentDefinition = independentDefinition) {
    const p = ledger.profile, { limits, groups, cases } = definition;
    if (ledger.version !== 1 || ledger.scope !== definition.scope || !/^[a-f0-9]{64}$/u.test(ledger.identity)
      || JSON.stringify(ledger.limits) !== JSON.stringify(limits) || JSON.stringify(ledger.groups) !== JSON.stringify(groups)
      || !p || !p.model || !p.endpoint || !p.nodeVersion || !time(p.checkedAt) || p.extraFeesCny !== 0
      || ![p.inputRate, p.outputRate].every(n => Number.isFinite(n) && n > 0 && n <= 10000)
      || !Number.isFinite(p.cacheReadRate) || p.cacheReadRate < 0 || p.cacheReadRate > p.inputRate
      || [p.planHash, p.entryHash, p.codeHash, p.casesHash].some(h => !/^[a-f0-9]{64}$/u.test(h))
      || ledger.halted !== undefined && (typeof ledger.halted !== 'string' || !/^[a-z_]{1,64}$/u.test(ledger.halted))
      || !Array.isArray(ledger.cases) || new Set(ledger.cases.map(c => c.id)).size !== ledger.cases.length
      || ledger.cases.some(c => !Object.hasOwn(cases, c.id) || !time(c.at) || c.finished !== undefined && (!time(c.finished) || typeof c.statePass !== 'boolean')
        || c.previousReviewedAt !== undefined && !time(c.previousReviewedAt))
      || !Array.isArray(ledger.attempts) || ledger.attempts.some(a => !Object.hasOwn(cases, a.caseId) || !ledger.cases.some(c => c.id === a.caseId)
        || !time(a.at) || !capacity(a.bytes, a.output, limits) || a.reservedMicroCny !== price(p, a.bytes, a.output)
        || a.status !== undefined && (!Number.isInteger(a.status) || a.status < 100 || a.status > 599))) throw new Error('独立复验账本损坏、旧scope或未知计费，拒绝联网');
    this.check();
  }
  get reserved(): number { return this.ledger.attempts.reduce((sum, a) => sum + a.reservedMicroCny, 0); }
  private check(): void {
    const { limits, groups, cases } = this.definition;
    if (this.ledger.attempts.length > limits.requests || this.reserved > limits.microCny) throw new Error('独立复验整轮限额超出');
    if (Object.entries(groups).some(([g, l]) => { const a = this.ledger.attempts.filter(a => cases[a.caseId]!.group === g); return a.length > l.requests || a.reduce((s, x) => s + x.reservedMicroCny, 0) > l.microCny; })
      || Object.entries(cases).some(([id, spec]) => this.ledger.attempts.filter(a => a.caseId === id).length > spec.max)) throw new Error('独立复验单步/组/整轮限额超出');
  }
  reserve(id: string, bytes: number, output: number): Attempt {
    const { limits } = this.definition;
    if (this.ledger.halted || !fresh(this.ledger.profile) || !capacity(bytes, output, limits)) throw new Error('共同停止、费率过期或请求超过64KiB/4096');
    if (!this.ledger.cases.some(c => c.id === id && !c.finished)) throw new Error('Case未开始或已消费');
    const a = { caseId: id, at: new Date().toISOString(), bytes, output, reservedMicroCny: price(this.ledger.profile, bytes, output) };
    this.ledger.attempts.push(a);
    try { this.check(); } catch (error) {
      const global = this.ledger.attempts.length > limits.requests || this.reserved > limits.microCny;
      this.ledger.attempts.pop();
      // 正常的本组额度不足不是共同账本损坏；没有发送的请求不消费，也不能借用其他组额度。
      if (!global) throw new GroupBudgetExhausted('本Case或组限额已用尽；停止本组，不借额');
      throw error;
    }
    return a;
  }
}

export function openIndependent(root: string, profile: IndependentProfile, resume = false, definition = independentDefinition) {
  if (!isAbsolute(root) || !fresh(profile)) throw new Error('需要全新绝对隔离根及24小时内核实费率');
  root = resolve(root); const file = join(root, 'independent-budget.json'), pending = file + '.pending', lock = join(root, 'independent.lock');
  for (let p = root; ; p = dirname(p)) {
    if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error('根目录及祖先禁止链接/junction');
    if (dirname(p) === p) break;
  }
  if (resume ? !fs.existsSync(file) : fs.existsSync(root)) throw new Error('需要新目录/新账本，不能重置或沿用旧轮');
  if (!resume) fs.mkdirSync(root, { mode: 0o700 });
  if (fs.existsSync(pending) || resume && fs.lstatSync(file).isSymbolicLink()) throw new Error('未完成写入或账本链接，拒绝续测');
  fs.closeSync(fs.openSync(lock, 'wx', 0o600)); let closed = false, failed = false;
  const close = () => { if (!closed) { closed = true; fs.rmSync(lock); } };
  try {
    const { limits, groups, cases } = definition;
    const identity = digest(JSON.stringify([root, profile, limits, groups, cases]));
    const ledger: Ledger = resume ? JSON.parse(fs.readFileSync(file, 'utf8')) : { version: 1, scope: definition.scope, identity,
      profile: structuredClone(profile), limits: { ...limits }, groups: structuredClone(groups), cases: [], attempts: [] };
    const budget = new IndependentBudget(ledger, definition);
    const persist = () => {
      if (closed || failed) throw new Error('账本已关闭或写入失败');
      try { const fd = fs.openSync(pending, 'wx', 0o600); try { fs.writeFileSync(fd, JSON.stringify(ledger, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } fs.renameSync(pending, file); }
      catch (error) { failed = true; throw error; }
    };
    const halt = (reason: string) => { ledger.halted ??= reason; persist(); };
    if (ledger.identity !== identity || JSON.stringify(ledger.profile) !== JSON.stringify(profile)) { halt('identity_or_configuration_changed'); throw new Error('身份/根/费率/源码/方案/Node变化，拒绝续测'); }
    if (ledger.halted || ledger.cases.some(c => !c.finished)) throw new Error('共同安全故障或未完成Case，须人工审计，不能续跑');
    const begin = (id: string, previousReviewed = false) => {
      if (closed || failed || ledger.halted) throw new Error('共同停止或写入失败');
      if (!Object.hasOwn(cases, id)) throw new CaseBlocked('Case不属于当前冻结方案');
      if (ledger.cases.some(c => !c.finished || c.id === id)) throw new CaseBlocked('Case已消费或未完成，禁止重发');
      const ids = Object.keys(cases).filter(k => cases[k]!.group === cases[id]!.group);
      const previous = ids[ids.indexOf(id) - 1], prior = ledger.cases.find(c => c.id === previous);
      if (previous && (!previousReviewed || !prior?.finished || !prior.statePass)) throw new CaseBlocked('本组前置失败或未审阅模型语义；其他组不受语义失败影响');
      if (previous) prior!.previousReviewedAt = new Date().toISOString();
      ledger.cases.push({ id, at: new Date().toISOString() }); persist();
    };
    const finish = (id: string, statePass: boolean) => {
      const c = ledger.cases.find(c => c.id === id && !c.finished); if (!c) throw new Error('Case不是在途');
      c.finished = new Date().toISOString(); c.statePass = statePass; persist();
    };
    persist(); return { root, budget, persist, halt, begin, finish, close };
  } catch (error) { close(); throw error; }
}
