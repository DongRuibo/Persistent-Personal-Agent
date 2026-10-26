import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { PassThrough } from 'node:stream';
import { redactor } from '../src/config.js';
import { approveSkill } from '../src/skills-admin.js';
import { safeSkillFile, SkillService, skillPackage } from '../src/skill-service.js';
import { recordAcceptanceResponse } from './feishu-formation-acceptance.js';
import { stagedAudit } from './staged-console-acceptance.js';
import { stagedModel } from './staged-console-cases.js';
import { CaseBlocked, GroupBudgetExhausted, digest, openIndependent, independentDefinition } from './independent-console-budget.js';
import type { IndependentProfile } from './independent-console-budget.js';
import { groupSkills } from './independent-console-cases.js';
import type { Group, IndependentCase } from './independent-console-cases.js';
import { naturalPauseCases, naturalPauseDefinition } from './natural-pause-console-cases.js';

type Session = ReturnType<typeof openIndependent>;
type Row = Record<string, unknown>;
const consoleKey = digest('console');
export function independentAudit(root: string) {
  const core = stagedAudit(root), file = join(root, 'agent.db');
  let runs: Row[] = [], counts: Record<string, number> = {}, integrity = 'ok', foreignKeys = 0;
  if (fs.existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      runs = db.prepare('SELECT * FROM runs ORDER BY rowid').all(); integrity = String(db.prepare('PRAGMA integrity_check').get()!.integrity_check);
      foreignKeys = db.prepare('PRAGMA foreign_key_check').all().length;
      for (const table of ['tasks', 'memory_candidates', 'memory_formation_jobs', 'goal_policies', 'goal_grants', 'goal_observations', 'goal_notifications', 'web_read_calls', 'feishu_messages']) {
        counts[table] = Number(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n);
      }
    } finally { db.close(); }
  }
  const fileSession = join(root, 'sessions', consoleKey, 'chat.session.jsonl');
  const entries: Row[] = fs.existsSync(fileSession) ? safeSkillFile(root, fileSession, 4194304).toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
  const references = entries.findLast(r => r.type === 'custom' && r.customType === 'host-dialogue-references-v2')?.data as { goalView?: {
    items: { id: string; revision: number; draftHash?: string }[]; details: boolean; displayRunId: string; expires: number;
  } } | undefined;
  return { ...core, runs, counts, integrity, foreignKeys, references, sessionHash: fs.existsSync(fileSession) ? digest(fs.readFileSync(fileSession)) : null,
    receipts: entries.filter(r => r.customType === 'host-goal-result-v1'),
    sessionUserCount: entries.filter(r => r.type === 'message' && (r.message as Row)?.role === 'user').length };
}
type Audit = ReturnType<typeof independentAudit>;
export function validIndependentView(a: Audit, now = Date.now(), expectedRun?: string): boolean {
  const g = a.goals[0], v = a.references?.goalView, item = v?.items[0];
  return a.goals.length === 1 && g?.ownerId === 'local-user' && g.targetJson === '{"channel":"console"}' && v?.details === true
    && v.items.length === 1 && Number.isSafeInteger(v.expires) && v.expires > now && v.expires <= now + 300000 && !!item && item.id === g.id && item.revision === g.revision
    && item.draftHash === (g.pendingActionJson ? JSON.parse(String(g.pendingActionJson)).hash : undefined)
    && (!expectedRun || v.displayRunId === expectedRun) && a.runs.some(r => r.id === v.displayRunId && r.status === 'succeeded')
    && a.events.some(e => e.runId === v.displayRunId && e.type === 'delivery_succeeded');
}
export function independentState(id: IndependentCase, a: Audit): boolean {
  if (id === 'S1') return a.goals.length === 0 && a.foreground.length === 1 && a.foreground[0]?.status === 'succeeded';
  const g = a.goals[0], last = a.executions.at(-1), cp = last?.checkpointJson ? JSON.parse(String(last.checkpointJson)) : null;
  if (a.goals.length !== 1 || !last || a.executions.some(e => e.status !== 'committed')) return false;
  const draft = g?.pendingActionJson ? JSON.parse(String(g.pendingActionJson)) : null;
  if (id === 'R2') return g?.planRevision === 1 && g.status === 'waiting_user' && a.executions.length === 2 && last.planRevision === 1
    && last.stepId !== a.executions[0]!.stepId && g.checkpointRunId === last.runId && cp?.stepOutcome === 'partial'
    && JSON.parse(String(last.inputJson)).skill?.id === 'interview-practice' && a.events.some(e => e.runId === last.runId && e.type === 'delivery_succeeded');
  return g?.planRevision === 0 && a.executions.length === 1 && last.planRevision === 0 && cp?.stepOutcome === 'complete'
    && !!draft?.spec?.steps?.length && (id === 'R1' ? draft.spec.steps.length === 1 && draft.spec.skillBindings?.[0]?.skillId === 'interview-practice' : !draft.spec.skillBindings?.length)
    && g.status === (id === 'P3' ? 'paused' : 'waiting_user')
    && (id !== 'P2' || validIndependentView(a, Date.now(), String(a.foreground.at(-1)?.id)))
    && (id !== 'R1' || validIndependentView(a));
}

// 只决定新暂停验收能否继续，不改变旧P1草稿指标或产品Guard的授权规则。
export function naturalPauseState(id: string, a: Audit): boolean {
  if (!Object.hasOwn(naturalPauseCases, id)) return false;
  const g = a.goals[0], e = a.executions[0], cp = e?.checkpointJson ? JSON.parse(String(e.checkpointJson)) : null;
  const input = e ? JSON.parse(String(e.inputJson)) : null;
  const draft = g?.pendingActionJson ? JSON.parse(String(g.pendingActionJson)) : null;
  const settled = a.goals.length === 1 && g?.ownerId === 'local-user' && g.targetJson === '{"channel":"console"}'
    && g.accessKey === digest(JSON.stringify(['local-user', ['console']])) && g.objective === naturalPauseCases.N1.prompt
    && g.planRevision === 0 && !g.controlRequested && !g.blockedReason && !g.readyInputJson
    && a.executions.length === 1 && e?.status === 'committed' && e.planRevision === 0 && e.goalId === g.id
    && g.checkpointRunId === e.runId && cp?.goalId === g.id && cp.executionRunId === e.runId && cp.stepId === e.stepId && cp.planRevision === 0
    && ['partial', 'complete'].includes(cp.stepOutcome) && input?.authorization.kind === 'create'
    && (cp.stepOutcome !== 'complete' || !!draft) && JSON.stringify(cp.proposedPlan ?? null) === JSON.stringify(draft)
    && a.runs.length > 0 && a.runs.every(r => r.status === 'succeeded');
  if (!settled || g.status !== (id === 'N3' ? 'paused' : 'waiting_user')) return false;
  return id !== 'N2' || validIndependentView(a, Date.now(), String(a.foreground.at(-1)?.id));
}

// 共同安全审计只读本轮当前组；语义判断仍由获批执行者单独完成。
function healthy(root: string, group: Group, a: Audit): void {
  const name = group === 'P' ? '青桐阅读计划' : '白桦练习计划';
  const invalidHash = a.plans.some(p => digest(String(p.specJson)) !== p.hash) || a.executions.some(e => digest(String(e.inputJson)) !== e.inputHash || e.checkpointJson !== null && digest(String(e.checkpointJson)) !== e.checkpointHash)
    || a.goals.some(g => { if (!g.pendingActionJson) return false; const { hash, ...draft } = JSON.parse(String(g.pendingActionJson)); return digest(JSON.stringify(draft)) !== hash; });
  if (a.integrity !== 'ok' || a.foreignKeys || Object.values(a.counts).some(n => n !== 0) || invalidHash
    || a.goals.length > (group === 'S' ? 0 : 1) || a.goals.some(g => g.ownerId !== 'local-user' || g.targetJson !== '{"channel":"console"}'
      || g.accessKey !== digest(JSON.stringify(['local-user', ['console']])) || !String(g.objective).includes(name) || g.blockedReason === 'checkpoint_commit_failed')
    || a.runs.some(r => r.status === 'running' || r.status === 'interrupted') || a.executions.some(e => ['running', 'uncertain', 'interrupted'].includes(String(e.status)))
    || fs.existsSync(join(root, 'agent.db.lock')) || fs.existsSync(join(root, 'memory.lock'))
    || fs.existsSync(join(root, 'memory')) && fs.readdirSync(join(root, 'memory'), { recursive: true }).some(p => String(p).endsWith('.md'))) throw new Error('共同持久化/身份/权限/进程安全审计失败');
}

export function independentFetch(session: Session, id: string, key: string, transport: typeof fetch = globalThis.fetch): typeof fetch {
  return async (input, init) => {
    try {
      init?.signal?.throwIfAborted(); const p = session.budget.ledger.profile, spec = session.budget.definition.cases[id];
      if (!spec) throw new Error('Case不属于当前冻结方案');
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
      if (!key || url.href !== stagedModel.endpoint || p.endpoint !== url.href || init?.method !== 'POST' || typeof init.body !== 'string' || init.body.includes(key)) throw new Error('只允许固定模型POST；所有GET在DNS前拒绝');
      const body = JSON.parse(init.body), system = String(body.messages?.find((m: Row) => m.role === 'system')?.content ?? '');
      const raw = body.messages?.findLast((m: Row) => m.role === 'user')?.content;
      const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map(part => part.text ?? '').join('') : '';
      const goal = system.includes('有界纯文本片段'), intent = system.includes('隔离的当前用户意图解析器');
      const actual = goal ? JSON.parse(text.split('UNTRUSTED_GOAL_SNAPSHOT=')[1] ?? '{}').goal?.input?.text : intent ? JSON.parse(text).message : text.replace(/^\[当前用户时间：[^\n]+\]\n/u, '');
      const tools = (body.tools ?? []).map((t: { function: { name: string } }) => t.function.name);
      const allowed = ['create_task', 'list_tasks', 'cancel_task', 'memory_search', 'memory_get', 'memory_remember', 'memory_update', 'memory_forget', ...(spec.group === 'S' ? [] : ['goal_manage']), ...(spec.group === 'P' ? [] : ['read'])];
      if (p.model !== stagedModel.model || body.model !== p.model || body.enable_thinking === true || actual !== spec.prompt
        || body.max_tokens !== undefined && body.max_completion_tokens !== undefined || tools.some((n: string) => !allowed.includes(n))
        || goal && (!spec.goal || tools.length || Buffer.byteLength(init.body) > 32768)) throw new Error('冻结话术、工具或Goal执行边界不符');
      const a = session.budget.reserve(id, Buffer.byteLength(init.body), body.max_tokens ?? body.max_completion_tokens); session.persist();
      const seq = String(session.budget.ledger.attempts.length).padStart(2, '0'), root = join(session.root, spec.group);
      fs.writeFileSync(join(root, 'request-' + seq + '.json'), init.body, { flag: 'wx', mode: 0o600 });
      const response = await transport(input, { ...init, redirect: 'error' }); a.status = response.status; session.persist();
      const recorded = recordAcceptanceResponse(response, join(root, 'response-' + seq + '.txt'), redactor(key), 4194304);
      if (!response.ok || !response.body) { if (recorded.body) await recorded.text(); throw new Error('模型HTTP失败或无响应体，不重试'); }
      const reader = recorded.body!.getReader(); let cancelled = false;
      return new Response(new ReadableStream({ async pull(controller) {
        try { const part = await reader.read(); if (cancelled) return; if (part.done) controller.close(); else controller.enqueue(part.value); }
        catch (error) { if (!cancelled) { session.halt('response_recording_or_stream_failure'); controller.error(error); } }
        // Pi收到结束标记后会正常cancel流；不能把已取消controller的close竞争记作网络失败。
      }, cancel: reason => { cancelled = true; return reader.cancel(reason); } }), { status: response.status, headers: response.headers });
    } catch (error) { console.error('独立入口拒绝：' + redactor(key)(error)); if (!(error instanceof GroupBudgetExhausted)) session.halt('model_boundary_budget_or_transport_failure'); throw error; }
  };
}

function noLinks(root: string): void {
  if (!fs.existsSync(root)) return;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('本轮目录禁止链接/junction');
  if (fs.statSync(root).isDirectory()) for (const p of fs.readdirSync(root)) noLinks(join(root, p));
}
export async function startIndependent(pauseOnly = false) {
  const definition = pauseOnly ? naturalPauseDefinition : independentDefinition, { cases, limits, groups } = definition;
  const args = process.argv.slice(2), root = args.find(a => a.startsWith('--root='))?.slice(7), id = args.find(a => a.startsWith('--case='))?.slice(7) ?? '';
  if (!args.includes('--authorized') || !args.includes('--rates-confirmed') || !root || !Object.hasOwn(cases, id)
    || args.some(a => !['--authorized', '--rates-confirmed', '--resume', '--previous-reviewed'].includes(a) && !a.startsWith('--root=') && !a.startsWith('--case='))) throw new Error(pauseOnly ? '仅准备未授权执行；须单独批准自然暂停N1/N2/N3、14请求/2.31元/零GET' : '仅准备未授权执行；须单独批准P/R/S六Case、30请求/5元/零GET');
  const key = process.env.LLM_API_KEY;
  if (!key || process.env.LLM_MODEL !== stagedModel.model || process.env.LLM_BASE_URL !== 'https://api.siliconflow.cn/v1' || process.env.LLM_PROVIDER !== 'personal-compatible'
    || process.env.ACCEPTANCE_EXTRA_FEES_CNY !== '0' || !process.env.ACCEPTANCE_CACHE_READ_RATE) throw new Error('模型、端点、账号价格及无附加费须重新确认并安全注入，不读.env');
  const plan = resolve(pauseOnly ? 'docs/evaluations/natural-pause-console-live-plan.md' : 'docs/evaluations/independent-console-live-plan.md');
  const entry = pauseOnly ? resolve('scripts/natural-pause-console-acceptance.ts') : fileURLToPath(import.meta.url);
  const paths = ['package-lock.json', ...['src', 'scripts'].flatMap(dir => fs.readdirSync(dir).filter(n => n.endsWith('.ts')).map(n => join(dir, n))), ...['agent-notes', 'interview-practice'].map(n => join('skills', n, 'SKILL.md'))].sort();
  const profile: IndependentProfile = { ...stagedModel, inputRate: Number(process.env.ACCEPTANCE_INPUT_RATE), outputRate: Number(process.env.ACCEPTANCE_OUTPUT_RATE),
    checkedAt: process.env.ACCEPTANCE_PRICE_CHECKED_AT ?? '', cacheReadRate: Number(process.env.ACCEPTANCE_CACHE_READ_RATE), extraFeesCny: 0,
    planHash: digest(fs.readFileSync(plan)), entryHash: digest(fs.readFileSync(entry)), codeHash: digest(JSON.stringify(paths.map(p => [p, digest(fs.readFileSync(p))]))), casesHash: digest(JSON.stringify(cases)), nodeVersion: process.version };
  process.umask(0o077); const session = openIndependent(root, profile, args.includes('--resume'), definition); process.once('exit', session.close);
  const spec = cases[id]!, group = spec.group, data = join(session.root, group), managed = join(data, 'approved-skills');
  const packages = () => groupSkills[group].map(id => { const p = skillPackage(resolve('skills'), id, true).info; if (id === 'agent-notes' && p.version !== '1.0.1') throw new Error('agent-notes版本未冻结为1.0.1'); return { id, hash: p.hash, version: p.version }; });
  try {
    noLinks(session.root);
    if (!args.includes('--resume')) {
      fs.copyFileSync(plan, join(session.root, 'frozen-plan.md'), fs.constants.COPYFILE_EXCL);
      fs.writeFileSync(join(session.root, 'authorization.json'), JSON.stringify({ profile, limits, groups, cases, identity: ['local-user', 'console'],
        skills: Object.fromEntries((Object.keys(groups) as Group[]).map(g => [g, groupSkills[g].map(id => skillPackage(resolve('skills'), id, true).info)])) }), { flag: 'wx', mode: 0o600 });
    }
    if (digest(safeSkillFile(session.root, join(session.root, 'frozen-plan.md'), 65536)) !== profile.planHash) throw new Error('冻结方案变化');
    const priorGroup = session.budget.ledger.cases.some(c => cases[c.id]!.group === group);
    if (!priorGroup && fs.existsSync(data) || priorGroup && !fs.existsSync(join(data, 'agent.db'))) throw new Error('首个组目录必须全新，已有业务库不能丢失或替换');
    if (!fs.existsSync(data)) {
      fs.mkdirSync(data, { mode: 0o700 });
      for (const id of groupSkills[group]) { fs.cpSync(join('skills', id), join(managed, id), { recursive: true }); approveSkill(managed, id, true); }
    }
    const installed = groupSkills[group].length ? new SkillService(managed).list().map(({ id, hash, version }) => ({ id, hash, version })) : [];
    const auth = JSON.parse(safeSkillFile(session.root, join(session.root, 'authorization.json'), 65536).toString('utf8'));
    if (JSON.stringify(auth.profile) !== JSON.stringify(profile) || JSON.stringify(auth.limits) !== JSON.stringify(limits)
      || JSON.stringify(auth.groups) !== JSON.stringify(groups) || JSON.stringify(auth.cases) !== JSON.stringify(cases)
      || JSON.stringify(auth.identity) !== JSON.stringify(['local-user', 'console'])) throw new Error('授权快照变化');
    if (JSON.stringify(installed) !== JSON.stringify(packages()) || JSON.stringify(installed) !== JSON.stringify(auth.skills[group].map(({ id, hash, version }: { id: string; hash: string; version: string }) => ({ id, hash, version })))) throw new Error('批准Skill版本/Hash变化');
    const before = independentAudit(data);
    healthy(data, group, before);
    const specs = [...before.plans.map(p => JSON.parse(String(p.specJson))), ...before.goals.filter(g => g.pendingActionJson).map(g => JSON.parse(String(g.pendingActionJson)).spec)];
    if (specs.some(s => s.webBindings?.length || (s.skillBindings ?? []).some((b: { skillId: string; packageHash: string; version: string }) => !installed.some(i => i.id === b.skillId && i.hash === b.packageHash && i.version === b.version)))) throw new Error('计划含未批准Skill版本/Hash或Web绑定');
    if (id === 'P3' && (!validIndependentView(before, Date.now(), String(before.foreground.at(-1)?.id)) || !independentState('P2', before))) throw new CaseBlocked('P2视图失效或超期，停止P组，不补发查看');
    if (id === 'P2' && !independentState('P1', before) || id === 'R2' && !independentState('R1', before)) throw new CaseBlocked('本组真实持久前置缺失');
    if (pauseOnly && (id === 'N2' && !naturalPauseState('N1', before) || id === 'N3' && !naturalPauseState('N2', before))) throw new CaseBlocked('自然暂停前置目标或N2有效视图缺失；不刷新、不补答');
    session.begin(id, args.includes('--previous-reviewed'));
    const input = new PassThrough(), nativeInput = Object.getOwnPropertyDescriptor(process, 'stdin')!;
    Object.defineProperty(process, 'stdin', { configurable: true, value: input });
    Object.assign(process.env, { DATABASE_PATH: join(data, 'agent.db'), MEMORY_DIR: join(data, 'memory'), SESSION_DIR: join(data, 'sessions'), SKILLS_DIR: managed,
      USER_TIMEZONE: 'Asia/Shanghai', GOAL_ENABLED: String(group !== 'S'), SKILLS_ENABLED: String(group !== 'P'), WEB_READ_ENABLED: 'false', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false', MEMORY_QUERY_REWRITE: 'false' });
    const guarded = independentFetch(session, id, key);
    globalThis.fetch = async (url, init) => { try { return await guarded(url, init); } catch (error) { if (!(error instanceof GroupBudgetExhausted)) setImmediate(() => process.emit('SIGTERM')); throw error; } };
    const { main } = await import('../src/main.js'); process.argv = [process.argv[0]!, resolve('src/main.ts')];
    const started = Date.now(); let quitting = false;
    const timer = setInterval(() => {
      try {
        const a = stagedAudit(data), current = a.foreground.slice(before.foreground.length), busy = a.goals.some(g => ['ready', 'running'].includes(String(g.status)));
        if (Date.now() - started > 240000 || session.budget.ledger.halted) { if (!session.budget.ledger.halted) session.halt('case_timeout'); process.emit('SIGTERM'); }
        else if (!quitting && current.length && current.every(r => r.status !== 'running') && !busy) { quitting = true; input.end('/quit\n'); }
      } catch { session.halt('audit_read_failure'); process.emit('SIGTERM'); }
    }, 100);
    try {
      console.log(`独立Console ${id}：本组${groups[group]!.requests}请求，整轮${limits.requests}请求/${limits.microCny / 1000000}元，零Web GET；仅一次冻结输入。`);
      input.write(spec.prompt + '\n'); await main();
      const after = independentAudit(data); healthy(data, group, after);
      if (process.exitCode || session.budget.ledger.halted) throw new Error('共同进程或传输安全故障，禁止继续');
      const statePass = pauseOnly ? naturalPauseState(id, after) : independentState(id as IndependentCase, after), routingObserved = after.events.some(e => e.runId === after.foreground.at(-1)?.id && e.type === 'skill_activated' && JSON.parse(String(e.details)).id === 'agent-notes');
      if ((id === 'P3' || pauseOnly && id !== 'N1') && JSON.stringify(before.executions) !== JSON.stringify(after.executions)) throw new Error('查看/暂停产生了额外执行');
      if (pauseOnly && id !== 'N1' && (JSON.stringify(before.plans) !== JSON.stringify(after.plans) || before.goals[0]?.checkpointRunId !== after.goals[0]?.checkpointRunId
        || before.goals[0]?.pendingActionJson !== after.goals[0]?.pendingActionJson || before.goals[0]?.id !== after.goals[0]?.id)) throw new Error('查看/暂停改写了计划、成果或目标归属');
      if (pauseOnly && id === 'N2' && JSON.stringify(before.goals) !== JSON.stringify(after.goals)) throw new Error('查看意外变更Goal状态');
      if (pauseOnly && id === 'N3' && JSON.stringify(before.goals) !== JSON.stringify(after.goals)
        && (!statePass || Number(after.goals[0]?.revision) !== Number(before.goals[0]?.revision) + 1)) throw new Error('暂停之外的状态或版本变更');
      fs.writeFileSync(join(data, id + '-audit.json'), JSON.stringify({ caseId: id, before, after, statePass, routingObserved,
        ...(pauseOnly ? { planGeneration: { outcome: after.executions[0]?.checkpointJson ? JSON.parse(String(after.executions[0].checkpointJson)).stepOutcome : null,
          pendingDraft: !!after.goals[0]?.pendingActionJson }, pauseResult: id === 'N3' ? statePass : null } : {}),
        note: pauseOnly ? '新自然暂停指标不依赖草稿；计划生成与暂停分别记录，机械状态不代替模型语义，不追改旧P1。' : '机械状态/读取指标不代替模型语义；S未read但正确完成用户任务须分别评分，其他组语义失败不影响本组' }, null, 2), { flag: 'wx', mode: 0o600 });
      session.finish(id, statePass); console.log(JSON.stringify({ caseId: id, statePass, routingObserved, modelHttp: session.budget.ledger.attempts.length, reservedMicroCny: session.budget.reserved, publicGets: 0 }));
      if (!statePass) process.exitCode = 1;
    } finally { clearInterval(timer); input.destroy(); Object.defineProperty(process, 'stdin', nativeInput); }
  } catch (error) {
    // 已消费Case异常不释放额度；未知写入/进程故障锁住整轮。TTL等发送前拒绝不触发重试。
    if (!(error instanceof CaseBlocked) && !session.budget.ledger.halted) session.halt('case_persistence_or_process_failure');
    throw error;
  } finally { session.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startIndependent().catch(error => { console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1; });
