import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { ExecutionRequest, MemoryInput, ModelCall } from '../src/contracts.js';
import type { AgentExecutor } from '../src/contracts.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { redactor } from '../src/config.js';
import { fingerprint, memoryDigest } from '../src/formation-types.js';
import { formationHarness } from '../tests/helpers/formation.js';
import { sseText } from '../tests/helpers/intent-stub.js';
import { FormationLiveBudget, safeReportJson } from './formation-live-budget.js';
import type { LivePayload, LivePhase } from './formation-live-budget.js';

if (!process.argv.includes('--allow-paid')) throw new Error('需要本轮16请求/1元明确授权，再使用 --allow-paid；默认不联网');
if (process.env.LLM_BASE_URL !== 'https://api.siliconflow.cn/v1' || process.env.LLM_MODEL !== 'deepseek-ai/DeepSeek-V4.1-Flash' || !process.env.LLM_API_KEY || process.env.LLM_API_KEY === '<REDACTED>') throw new Error('需在本机配置硅基流动模型/端点和有效Key；没有发送请求');

interface Sample { id: string; category: string; text: string; expected: string; kind?: string; old?: MemoryInput; approve?: boolean; question?: string; prefilter?: boolean }
interface Payload extends LivePayload { messages: { role: string; content: unknown }[] }
const content = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => (part as { text?: string }).text ?? '').join('') : '';
const fixtureUrl = new URL('../tests/fixtures/memory-formation-live.json', import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as { cases: Sample[] };
const outputUrl = new URL('../docs/evaluations/v2.1b-formation-live.json', import.meta.url);
// 已有报告也是跨进程的消费闸；不提供自动覆盖/重跑开关。
if (existsSync(outputUrl)) throw new Error('本轮验收报告已存在；不能重跑或重复消费预算，请先人工核对');
const key = process.env.LLM_API_KEY;
const redact = redactor(key);
const budget = new FormationLiveBudget();
const nativeFetch = globalThis.fetch;
const wire: Record<string, unknown>[] = [], rows: Record<string, unknown>[] = [], captures: Promise<void>[] = [];
const sourceFiles = ['src/formation-service.ts', 'src/formation-types.ts', 'src/formation-store.ts', 'src/pi-executor.ts', 'src/operation-guard.ts', 'src/memory-service.ts', 'src/memory-retriever.ts', 'scripts/check-formation-live.ts'];
const hashes = Object.fromEntries(sourceFiles.map(file => [file, fingerprint(readFileSync(file, 'utf8'))]));
const startedAt = new Date().toISOString();
const formalEnabled = process.env.MEMORY_FORMATION_ENABLED === 'true';
let completedAt: string | undefined, active: { caseId: string; mode: 'extraction' | 'list' | 'approval' | 'generation' } | undefined;
const save = (initial = false) => writeFileSync(outputUrl, safeReportJson({
  mode: 'real-formation-and-intent-and-readonly-generation', status: completedAt ? 'completed' : 'running-or-interrupted', startedAt, completedAt,
  model: process.env.LLM_MODEL, providerOrigin: 'https://api.siliconflow.cn', maxRequests: 16, budgetCny: 1,
  reservedCny: budget.reservedCny, actualNetworkRequests: budget.attempts.length, budgetRatesCnyPerMillion: { input: 10, output: 20 },
  fixtureSha256: fingerprint(readFileSync(fixtureUrl, 'utf8')), sourceHashes: hashes,
  formalFormationEnabledBefore: formalEnabled, formalFormationEnabledAfter: process.env.MEMORY_FORMATION_ENABLED === 'true',
  privateDataRead: false, formalDataWritten: false, feishuMessagesSent: 0,
  boundary: '12个虚构来源窗。成功chat Run由验收宿主构造，不是真人聊天；列表显示与主Agent审批调度模拟，仅候选提取、审批隔离解析和新Session只读生成联网。敏感输入由原宿主预滤，可能少于16请求；无重试、不填满剩余额度。',
  wire, rows,
}, redact) + '\n', { flag: initial ? 'wx' : 'w', mode: 0o600 });
save(true);

function simulatedTool(): Response {
  const choice = { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'review-live', type: 'function', function: { name: 'memory_review', arguments: '{}' } }] }, finish_reason: 'tool_calls' };
  return new Response(`data: ${JSON.stringify({ id: 'local-dispatch-stub', model: 'stub', choices: [choice] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!active || url.href !== 'https://api.siliconflow.cn/v1/chat/completions') throw new Error('隔离验收禁止此网络目标');
  const body = String(init?.body ?? '');
  if (body.includes(key)) throw new Error('请求正文意外包含凭据，未发送');
  const payload = JSON.parse(body) as Payload;
  const system = payload.messages.filter(message => message.role === 'system').map(message => content(message.content)).join('');
  const parser = system.includes('隔离的当前用户意图解析器');
  if (active.mode === 'list' && parser) {
    const data = JSON.parse(content(payload.messages.findLast(message => message.role === 'user')?.content)) as { message: string };
    return new Response(sseText(JSON.stringify({ action: 'memory_review', mode: 'query', evidence: data.message, review: 'list' })), { headers: { 'Content-Type': 'text/event-stream' } });
  }
  if ((active.mode === 'list' || active.mode === 'approval') && !parser) {
    const lastUser = payload.messages.findLastIndex(message => message.role === 'user');
    return payload.messages.slice(lastUser + 1).some(message => message.role === 'tool')
      ? new Response(sseText('模拟主Agent调度完成，最终文本由宿主决定。'), { headers: { 'Content-Type': 'text/event-stream' } }) : simulatedTool();
  }
  const phase: LivePhase = active.mode === 'approval' && parser ? 'approval' : active.mode === 'extraction' && system.includes('无工具的只读记忆候选提取器') ? 'extraction' : active.mode === 'generation' ? 'generation' : (() => { throw new Error('请求阶段不符，未发送'); })();
  if (wire.some(attempt => attempt.caseId === active!.caseId && attempt.phase === phase)) throw new Error('该窗口/阶段已经预留请求，不允许重复付费');
  if (fixture.cases.filter(sample => sample.prefilter).some(sample => body.includes(sample.text))) throw new Error('敏感预滤样本不得发送');
  budget.reserve(phase, payload, Buffer.byteLength(body));
  const attempt: Record<string, unknown> = { number: budget.attempts.length, caseId: active.caseId, phase,
    ...budget.attempts.at(-1), requestHash: fingerprint(body), messages: payload.messages, startedAt: new Date().toISOString() };
  wire.push(attempt); save(); // 发出前持久化预留；异常退出也不能自动再次调用。
  const at = performance.now();
  try {
    const response = await nativeFetch(input, { ...init, redirect: 'error' });
    attempt.httpStatus = response.status;
    const capture = response.clone().text().then(text => {
      const frames = text.split('\n').filter(line => line.startsWith('data: ') && !line.includes('[DONE]')).flatMap(line => {
        try { return [JSON.parse(line.slice(6)) as { choices?: { delta?: { content?: string }; finish_reason?: string }[]; usage?: unknown; model?: string }]; } catch { return []; }
      });
      attempt.output = frames.flatMap(frame => frame.choices?.map(choice => choice.delta?.content ?? '') ?? []).join('');
      attempt.reportedUsage = frames.findLast(frame => frame.usage)?.usage;
      attempt.responseModel = frames.find(frame => frame.model)?.model;
      attempt.finishReason = frames.flatMap(frame => frame.choices ?? []).findLast(choice => choice.finish_reason)?.finish_reason;
      attempt.elapsedMs = performance.now() - at; save();
    }).catch(() => { attempt.responseIncomplete = true; attempt.elapsedMs = performance.now() - at; save(); });
    captures.push(capture); return response;
  } catch {
    attempt.networkError = '请求失败/中断，用量可能未知；未重试'; attempt.elapsedMs = performance.now() - at; save(); throw new Error('验收网络失败或中断');
  }
};

async function chat(h: ReturnType<typeof formationHarness>, executor: AgentExecutor, text: string) {
  const request = h.request(text);
  try {
    const result = await executor.execute(request);
    h.store.finishRun(request.source!.reference, 'succeeded', h.now().toISOString(), result.text);
    h.store.event(request.source!.reference, 'delivery_succeeded', '仅验收模拟显示；没有发送飞书');
    return { runId: request.source!.reference, text: result.text };
  } catch {
    h.store.finishRun(request.source!.reference, 'failed', h.now().toISOString(), undefined, '隔离审批未完成，不重试');
    throw new Error('隔离审批未完成，不重试');
  }
}

try {
  for (const sample of fixture.cases) {
    const h = formationHarness({ dailyCalls: 12, dailyBudget: 1 });
    const config = { ...h.config, model: process.env.LLM_MODEL!, apiKey: key, baseUrl: process.env.LLM_BASE_URL, memoryQueryRewrite: false, executionTimeoutMs: 30000 };
    const observer = h.store.observer.bind(h.store);
    h.store.observer = (runId: string) => {
      const base = observer(runId);
      return { event: (type, detail) => base.event(type, detail === undefined ? undefined : redact(detail)), modelCall: call => base.modelCall({ ...call, error: call.error === undefined ? undefined : redact(call.error) }) };
    };
    let executor: AgentExecutor | undefined;
    const result: Record<string, unknown> = { ...sample };
    rows.push(result);
    try {
      if (sample.old) h.write(sample.old);
      const initial = h.memory.listForHost(), before = memoryDigest(initial); result.initialMemories = initial;
      executor = await createPiExecutor(config, h.tasks, 'isolated-live-extraction', h.memory, h.formation);
      const source = h.enqueue(sample.text); result.sourceRunId = source.source!.reference;
      active = { caseId: sample.id, mode: 'extraction' };
      const at = performance.now(); h.advance(10001); await h.formation.tick(); result.extractionElapsedMs = performance.now() - at;
      result.jobs = h.store.formation.jobs();
      const candidates = h.store.formation.candidates('single-user'); result.candidatesBeforeApproval = candidates;
      result.usageBeforeApproval = h.store.modelCalls(source.source!.reference).filter(call => call.purpose === 'memory_formation');
      result.unapprovedMemoryUnchanged = memoryDigest(h.memory.listForHost()) === before;
      if (result.unapprovedMemoryUnchanged !== true || h.store.listTasks().length) throw new Error('未批准写入或意外Task，终止验收');
      const candidate = candidates[0];
      const failed = h.store.formation.jobs().some(job => job.status === 'failed');
      result.actual = failed ? 'extraction_failed' : candidate?.status === 'needs_clarification' ? 'clarify' : candidate?.target ? 'update' : candidate ? 'new' : sample.expected === 'duplicate' ? 'duplicate_or_skip' : 'none';
      result.mechanismPass = (sample.expected === 'duplicate' ? !candidate && !failed : result.actual === sample.expected) && (!candidate || !sample.kind || candidate.kind === sample.kind) &&
        (sample.expected !== 'update' || candidate?.target?.id === initial[0]?.id) && (sample.category !== 'other-project' || !candidate?.target);
      if (sample.approve && candidate && candidate.status === 'pending' && result.mechanismPass) {
        active = { caseId: sample.id, mode: 'list' }; result.display = await chat(h, executor, '有什么建议记住的吗？');
        active = { caseId: sample.id, mode: 'approval' };
        try {
          result.approval = await chat(h, executor, '第一条记下来');
          const approved = h.memory.listForHost(); result.currentMemories = approved;
          const applied = h.store.formation.get(candidate.id); result.applied = applied;
          if (applied?.status !== 'applied' || !approved.some(record => record.id === applied.resultId && record.source.reference === applied.approvalRunId)) throw new Error('审批未落盘，不进行有记忆生成');
          await executor.close(); executor = await createPiExecutor(config, h.tasks, 'brand-new-readonly-session', h.memory);
          const usage: ModelCall[] = [], events: { type: string; details?: string }[] = [];
          const request: ExecutionRequest = { prompt: sample.question!, scope: 'task', signal: new AbortController().signal,
            observer: { modelCall: call => usage.push({ ...call, error: call.error && redact(call.error) }), event: (type, details) => { if (type === 'memory_context') events.push({ type, details }); } } };
          active = { caseId: sample.id, mode: 'generation' }; const generated = await executor.execute(request);
          result.generation = { question: sample.question, answer: redact(generated.text), usage, events, newSession: true, tools: 0 };
          result.generationMemoryUnchanged = memoryDigest(approved) === memoryDigest(h.memory.listForHost());
        } catch { result.approvalOrGenerationError = '审批或生成未正常结束，未重试；参见请求及实际状态'; result.currentMemories = h.memory.listForHost(); }
      } else if (sample.approve) result.approvalSkipped = '预定候选未通过，不换样本或手动造候选来冒充端到端成功';
      result.tasksCreated = h.store.listTasks().length;
    } catch { result.error = '隔离验收步骤失败，保留当前证据；未自动重试'; }
    finally { active = undefined; await executor?.close(); await h.close(); await Promise.all(captures); save(); }
    process.stderr.write(`Formation真实验收 ${sample.id}；请求=${budget.attempts.length}/16；预留=${budget.reservedCny.toFixed(6)}元\n`);
  }
  completedAt = new Date().toISOString();
} finally { active = undefined; await Promise.all(captures); globalThis.fetch = nativeFetch; save(); }
console.log(JSON.stringify({ completedAt, cases: rows.length, requests: budget.attempts.length, reservedCny: budget.reservedCny, report: 'docs/evaluations/v2.1b-formation-live.json', note: '必须人工核对真实输出；退出0不表示语义验收全部通过' }));
