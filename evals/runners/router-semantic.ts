import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { routeTopic } from '../../src/topic-router.js';
import { parseTopicRouteChoice } from '../../src/topic-route-types.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { webOwner, webTarget } from '../../src/web-ui-channel.js';
import { semanticModel, PrepareOnly } from '../environments/router-semantic-model.js';
import { gradeProposal, summarizeSemantic } from '../evaluators/router-semantic.js';
import type { SemanticPlan, SemanticCase, SemanticResult } from '../evaluators/router-semantic.js';
import type { TopicProposal } from '../../src/topic-router.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

// 状态夹具只用原Store建立关系；不加载原始Session、Memory或标准答案到模型输入。
export function semanticState(spec: SemanticCase) {
  const store = new SqliteStore(':memory:'), actor = { owner: webOwner, channel: JSON.stringify(webTarget) }, now = '2026-11-09T00:00:00.000Z';
  for (const item of spec.threads) {
    store.workThreads.createInTransaction(actor, item.id, item.title, now, item.description);
    if (item.bound) store.workThreads.bindChatInTransaction(actor, item.id, now, true);
    if (item.status === 'archived') store.workThreads.update(actor, item.id, { status: 'archived' }, now);
  }
  store.webUi.enqueue(actor.owner, 'semantic-' + spec.case_id, spec.text, now, true);
  const request = store.webUi.claim(actor.owner, now, 'all')!;
  const selected = spec.threads.find(item => item.alias === spec.current_topic);
  const current = { contextKey: selected ? store.workThreads.get(actor, selected.id).chatContextKey : null, references: spec.references };
  return { store, actor, current, threads: store.workThreads.list(actor),
    freeze(proposal: TopicProposal) { return store.webUi.freezeTopicRoute(actor, request.requestId, proposal.choice, now, proposal.decision.explicitThreadId, proposal.decision); } };
}

export async function runSemanticEvaluation(mode: 'prepare' | 'live', output?: string, configPath?: string) {
  const planPath = join(project, 'evals/datasets/router-semantic-pilot-v1.json'), plan = JSON.parse(readFileSync(planPath, 'utf8')) as SemanticPlan;
  if (plan.cases.length !== 20 || new Set(plan.cases.map(row => row.case_id)).size !== 20
    || plan.limits.max_requests !== 20 || plan.limits.max_output_tokens_per_request !== 512 || plan.limits.max_input_token_reservation !== 60000
    || plan.limits.budget_cny !== 5 || plan.limits.max_retries !== 0 || plan.model !== 'deepseek-ai/DeepSeek-V4.1-Flash'
    || plan.base_url !== 'https://api.siliconflow.cn/v1') throw new Error('冻结小样本或预算与本轮授权不一致');
  const baseline = 'ead27a7e19fa99ac7413fceec81e603681192870';
  const productionDiff = execFileSync('git', ['diff', '--name-only', baseline, '--', 'src', 'web', 'package-lock.json'], { cwd: project, encoding: 'utf8' }).trim();
  if (productionDiff) throw new Error('生产文件偏离被测基线，未启动请求：' + productionDiff);
  let apiKey = 'fake-semantic-preflight';
  if (mode === 'live') {
    if (!configPath) throw new Error('真实模式必须显式给出本机模型配置文件路径');
    const env = parseEnv(readFileSync(configPath, 'utf8'));
    if (env.LLM_BASE_URL?.replace(/\/$/u, '') !== plan.base_url || env.LLM_MODEL !== plan.model || !env.LLM_API_KEY) throw new Error('本机模型配置与已批准模型不一致或缺少Key');
    apiKey = env.LLM_API_KEY;
  }
  const model = await semanticModel(plan, apiKey, mode), rows: SemanticResult[] = [];
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-'), directory = output ? resolve(output) : join(project, 'evals/reports/router-session', 'semantic-' + mode + '-' + runId);
  mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'manifest.json'), '{}\n', { flag: 'wx' }); mkdirSync(join(directory, 'cases'));
  const sourceFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'tests', 'evals', 'package.json', 'package-lock.json'],
    { cwd: project, encoding: 'utf8' }).trim().split('\n').filter(path => path && !path.startsWith('evals/reports/')).sort();
  const fingerprints = Object.fromEntries(sourceFiles.map(path => [path, hash(readFileSync(join(project, path)))]));
  const manifest = { started_at: new Date().toISOString(), mode, model: plan.model, base_url: plan.base_url, source_baseline: baseline,
    evaluation_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(),
    plan_sha256: hash(readFileSync(planPath)), source_sha256: hash(JSON.stringify(fingerprints)), files: fingerprints, limits: plan.limits,
    reservation_rates: plan.reservation_rates, price_sources: plan.price_sources,
    authorization: mode === 'live' ? '用户确认：使用现有硅基流动DeepSeek-V4.1-Flash，首批20条，最多20HTTP，每次512输出Token，输入保守预算60000Token，费用预算5元，不自动重试' : '准备模式，不调用网络',
    scope: '只测Router：不调用主回答、压缩、Worker、Memory检索或真实Session历史；K类只用离线重启后的冻结路由状态' };
  json(join(directory, 'manifest.json'), manifest);
  let stopped = false;
  for (const spec of plan.cases) {
    if (stopped) break;
    const started = performance.now(), state = semanticState(spec);
    const row: SemanticResult = { case_id: spec.case_id, category: spec.category, mode, model_requested: false, prepared_http: false,
      raw_text: null, raw_choice: null, final_choice: null, raw_grade: null, final_grade: null, logical_session_action: null, error: null, elapsed_ms: 0, http: [] };
    try {
      const proposal = await routeTopic({ text: spec.text, threads: state.threads, current: state.current }, {
        signal: AbortSignal.timeout(plan.limits.timeout_ms), current: state.current,
        complete: async (system, text) => {
          const output = await model.complete(system, text, row.http as Record<string, unknown>[], event => {
            // 收费发送前先落原文及预留账本；异常退出后也能辨认已发起请求。
            appendFileSync(join(directory, 'http-events.jsonl'), model.redact(JSON.stringify({ case_id: spec.case_id, ...event })) + '\n');
          }); row.raw_text = output;
          // 原始模型提议先按原Schema独立计分；不先套宿主纠正再称模型正确。
          row.raw_choice = parseTopicRouteChoice(JSON.parse(output));
          row.raw_grade = gradeProposal(row.raw_choice, spec);
          return output;
        } });
      row.final_choice = proposal.choice; row.final_grade = gradeProposal(proposal.choice, spec);
      const frozen = state.freeze(proposal);
      row.logical_session_action = frozen.kind !== 'topic' ? 'none' : state.threads.find(t => t.id === frozen.threadId)?.chatContextKey ? 'reuse' : 'create';
    } catch (error) {
      if (!(error instanceof PrepareOnly)) row.error = model.redact(error instanceof Error ? error.message : String(error));
    } finally {
      row.model_requested = (row.http as { phase: string; reservation?: unknown }[]).some(event => event.phase === 'dispatch' && !!event.reservation);
      row.prepared_http = (row.http as { phase: string }[]).some(event => event.phase === 'prepared');
      row.elapsed_ms = Math.round(performance.now() - started);
      state.store.close();
      const serialized = model.redact(JSON.stringify({ spec, result: row }, null, 2));
      writeFileSync(join(directory, 'cases', spec.case_id + '.json'), serialized + '\n'); rows.push(row);
      json(join(directory, 'results.json'), { manifest, summary: summarizeSemantic(rows, plan, model.budget), results: rows });
      console.log(`${spec.case_id} ${mode} ${row.prepared_http ? 'prepared' : row.model_requested ? 'model' : 'deterministic'} raw=${row.raw_grade?.correct ?? '-'} final=${row.final_grade?.correct ?? '-'} ${row.error ?? ''}`);
      const events = row.http as { http_status?: number }[];
      if (row.error?.includes('预算') || row.error?.includes('超批准上限') || events.some(event => [401, 402, 403, 429].includes(event.http_status ?? 0))) stopped = true;
    }
  }
  const summary = summarizeSemantic(rows, plan, model.budget);
  const usages = rows.flatMap(row => (row.http as { phase: string; usage?: { input_tokens: number; output_tokens: number } | null }[])
    .filter(event => event.phase === 'result').map(event => event.usage));
  const usage = { known_responses: usages.filter(Boolean).length, unknown_responses: usages.filter(item => !item).length,
    input_tokens: usages.reduce((sum, item) => sum + (item?.input_tokens ?? 0), 0), output_tokens: usages.reduce((sum, item) => sum + (item?.output_tokens ?? 0), 0),
    cost_cny: null, scope: '只累加供应商已报告用量，未知不当0；费用未按.cn账单确认' };
  json(join(directory, 'results.json'), { manifest, summary, usage, stopped_early: stopped, results: rows });
  const cell = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"';
  writeFileSync(join(directory, 'results.csv'), 'case_id,category,mode,model_requested,raw_correct,final_correct,raw_action,final_action,logical_session_action,error\n' +
    rows.map(row => [row.case_id, row.category, mode, row.model_requested, row.raw_grade?.correct, row.final_grade?.correct, row.raw_grade?.action,
      row.final_grade?.action, row.logical_session_action, row.error].map(cell).join(',')).join('\n') + '\n');
  writeFileSync(join(directory, 'report.md'), '# Router语义小样本\n\n' + (mode === 'live' ? '真实模型，仅Router语义；固定状态，不是全产品端到端。' : '准备模式，零网络，不存在真实模型成绩。') +
    '\n\n```json\n' + JSON.stringify({ summary, usage }, null, 2) + '\n```\n\n' +
    '| Case | 实际模型调用 | 原始提议正确 | 宿主最终正确 | 错误 |\n| --- | --- | --- | --- | --- |\n' + rows.map(row =>
      `| ${row.case_id} | ${row.model_requested} | ${row.raw_grade?.correct ?? 'NA'} | ${row.final_grade?.correct ?? 'NA'} | ${row.error ?? ''} |`).join('\n') + '\n');
  console.log('REPORT ' + directory);
  return { directory, summary, results: rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const mode = args.includes('--live') ? 'live' : 'prepare';
  const result = await runSemanticEvaluation(mode, value('--out'), value('--config'));
  if (result.results.some(row => !!row.error) || mode === 'live' && (result.results.length !== 20 || result.results.some(row => !row.final_grade?.correct))) process.exitCode = 1;
}
