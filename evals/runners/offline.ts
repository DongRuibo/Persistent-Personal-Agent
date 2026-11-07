import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { scenarios } from './scenarios.js';
import { summarize } from '../evaluators/metrics.js';
import type { CaseResult, Check } from '../evaluators/metrics.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export async function runEvaluation(output?: string) {
  const datasetPath = join(project, 'evals/datasets/personal-agent-v1.json');
  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as { version: string; model_budget_cny: number; cases: { case_id: string; category: string; [key: string]: unknown }[] };
  if (dataset.model_budget_cny !== 0 || dataset.cases.length !== 20 || new Set(dataset.cases.map(c => c.case_id)).size !== dataset.cases.length
    || dataset.cases.some(c => !scenarios[c.case_id])) throw new Error('评测入口数据无效或场景缺少实现');
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const reportDir = output ? resolve(output) : join(project, 'evals/reports', runId);
  const traceDir = join(project, 'evals/traces', runId);
  // 禁止覆盖既有运行，原始失败轨迹必须保留。
  mkdirSync(reportDir, { recursive: true }); mkdirSync(traceDir, { recursive: true });
  const claim = join(reportDir, 'run.json'); writeFileSync(claim, '{}\n', { flag: 'wx' });
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', 'src', 'tests', 'scripts', 'web', 'package.json', 'package-lock.json',
    'tsconfig.json', 'tsconfig.test.json', 'evals/datasets', 'evals/environments', 'evals/evaluators', 'evals/fixtures', 'evals/runners').split('\n').filter(Boolean).sort();
  const hashes = Object.fromEntries(files.map(file => [file, sha256(readFileSync(join(project, file)))]));
  const metadata = { run_id: runId, started_at: new Date().toISOString(), head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    git_status: git('status', '--porcelain'), source_fingerprint: sha256(JSON.stringify(hashes)), files: hashes,
    node: process.version, platform: process.platform, dataset_version: dataset.version, dataset_sha256: sha256(readFileSync(datasetPath)),
    environment: 'offline_real_host_scripted_model_loopback_only', paid_model_budget_cny: 0, model: 'local-stub', repeats: 1,
    production_data_access: false, external_channel_messages: 0 };
  json(claim, metadata);
  const results: CaseResult[] = [];
  for (const spec of dataset.cases) {
    const root = realpathSync(mkdtempSync(join(tmpdir(), `ppa-eval-${spec.case_id}-`))), trace: unknown[] = [];
    const result: CaseResult = { ...spec, case_id: spec.case_id, category: spec.category, evaluation_result: 'passed', latency_ms: 0,
      checks: [], observations: {}, actual_tool_calls: [], actual_final_state: null, agent_response: null, failure_reason: null };
    const start = performance.now();
    try {
      await scenarios[spec.case_id]!({ root, result, trace, check(name, passed, actual, expected, dimension: Check['dimension'] = 'host') {
        result.checks.push({ name, passed, actual, expected, dimension });
      } });
      if (result.evaluation_result !== 'skipped' && result.checks.some(check => !check.passed)) {
        result.evaluation_result = 'failed'; result.failure_reason = result.checks.filter(check => !check.passed).map(check => check.name).join('；');
      }
      if (result.evaluation_result === 'passed' && !result.checks.length) throw new Error('没有执行任何断言，不能计通过');
    } catch (error) {
      result.evaluation_result = 'error'; result.failure_reason = error instanceof Error ? error.stack ?? error.message : String(error);
    } finally {
      result.latency_ms = Math.round((performance.now() - start) * 1000) / 1000;
      const tracePath = join(traceDir, `${spec.case_id}.json`); json(tracePath, { ...result, trace });
      result.trace_path = tracePath.slice(project.length); result.trace_sha256 = sha256(readFileSync(tracePath));
      results.push(result); rmSync(root, { recursive: true, force: true });
      console.log(`${result.case_id} ${result.evaluation_result}: ${result.failure_reason ?? `${result.checks.length} checks`}`);
      // 每条结束落盘，进程异常也不会丢掉此前失败。
      json(join(reportDir, 'results.json'), { metadata, summary: summarize(results), results });
    }
  }
  const summary = summarize(results), report = { metadata, summary, results }; json(join(reportDir, 'results.json'), report);
  writeFileSync(join(reportDir, 'results.md'), `# Personal Agent离线评测\n\n基线：${metadata.head} / ${metadata.branch}；模型费用0。\n\n` +
    `通过${summary.counts.passed}，失败${summary.counts.failed}，跳过${summary.counts.skipped}，执行错误${summary.counts.error}。\n\n` +
    `这包含宿主确定性断言、交付保障要求及历史语义回放，不能称为模型任务成功率。\n\n` +
    `| Case | 场景 | 结果 | 原因 |\n| --- | --- | --- | --- |\n` + results.map(r => `| ${r.case_id} | ${r.title} | ${r.evaluation_result} | ${(r.failure_reason ?? '').replaceAll('\n', ' ')} |`).join('\n') +
    `\n\n完整指标、分母及逐条状态见[JSON](results.json)；定义见[计划](../../../docs/EVAL_PLAN.md)。\n`);
  console.log(`REPORT ${reportDir}`);
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputIndex = process.argv.indexOf('--out');
  const report = await runEvaluation(outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined);
  // 验收失败必须保留非零退出码，已知失败也不自动改绿。
  if (report.results.some(result => ['failed', 'error'].includes(result.evaluation_result))) process.exitCode = 1;
}
