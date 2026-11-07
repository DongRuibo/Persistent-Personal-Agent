import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { notificationCases } from './phase2-notifications.js';
import { goalRecoveryCases } from './phase2-goals.js';
import { phase2Metrics } from '../evaluators/phase2.js';
import type { Phase2Result } from '../evaluators/phase2.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const target = resolve(option('--target') ?? project), output = resolve(option('--out') ?? join(project, 'evals/reports', `phase2-${Date.now()}`));
const datasetFile = join(project, 'evals/datasets/phase2-v1.json'), dataset = JSON.parse(readFileSync(datasetFile, 'utf8')) as { cases: { case_id: string; title: string; [key: string]: unknown }[] };
const scenarios = { ...notificationCases, ...goalRecoveryCases };
if (dataset.cases.length !== 30 || dataset.cases.some(c => !scenarios[c.case_id]) || new Set(dataset.cases.map(c => c.case_id)).size !== dataset.cases.length) throw new Error('第二轮数据集不完整');
mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'run.json'), '{}', { flag: 'wx' });
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const files = execFileSync('rg', ['--files', 'src'], { cwd: target, encoding: 'utf8' }).trim().split('\n').sort();
const metadata = { label: option('--label') ?? 'after', target, runner_head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project, encoding: 'utf8' }).trim(),
  production_source: Object.fromEntries(files.map(file => [file, hash(readFileSync(join(target, file)))])), dataset_sha256: hash(readFileSync(datasetFile)),
  runner_files: Object.fromEntries(['evals/runners/phase2.ts','evals/runners/phase2-notifications.ts','evals/runners/phase2-goals.ts',
    'evals/environments/notifications.ts','evals/environments/goal-recovery.ts','evals/evaluators/phase2.ts','tests/helpers/notification-process.ts']
    .map(file => [file, hash(readFileSync(join(project, file)))])), environment: 'isolated_real_host_loopback_model_mock_channels', paid_budget_cny: 0 };
writeFileSync(join(output, 'run.json'), JSON.stringify(metadata, null, 2) + '\n');
const results: Phase2Result[] = [];
for (const spec of dataset.cases) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `ppa-p2-${spec.case_id}-`))), trace: unknown[] = [];
  const result: Phase2Result = { ...spec, case_id: spec.case_id, title: spec.title, evaluation_result: 'passed', checks: [], observations: {}, failure_reason: null, latency_ms: 0 };
  const start = performance.now();
  try {
    if (process.platform === 'win32' && ['N02','N03','N08','G11'].includes(spec.case_id)) { result.evaluation_result = 'skipped'; result.failure_reason = '真实SIGSTOP/SIGKILL场景需POSIX'; }
    else await scenarios[spec.case_id]!({ root, target, trace, observations: result.observations, check(name, passed, actual, expected) { result.checks.push({ name, passed, actual, expected }); } });
    if (result.checks.some(check => !check.passed)) { result.evaluation_result = 'failed'; result.failure_reason = result.checks.filter(check => !check.passed).map(c => c.name).join('；'); }
    if (result.evaluation_result === 'passed' && result.checks.length === 0) throw new Error('未执行断言');
  } catch (error) { result.evaluation_result = 'error'; result.failure_reason = error instanceof Error ? error.stack ?? error.message : String(error); }
  finally {
    result.latency_ms = Math.round((performance.now() - start) * 1000) / 1000;
    const path = join(output, `${spec.case_id}.trace.json`); writeFileSync(path, JSON.stringify({ ...result, trace }, null, 2) + '\n');
    result.trace_path = path; result.trace_sha256 = hash(readFileSync(path)); results.push(result); rmSync(root, { recursive: true, force: true });
    writeFileSync(join(output, 'results.json'), JSON.stringify({ metadata, metrics: phase2Metrics(results), results }, null, 2) + '\n');
    console.log(`${spec.case_id} ${result.evaluation_result}: ${result.failure_reason ?? `${result.checks.length} checks`}`);
  }
}
writeFileSync(join(output, 'results.md'), '# 第二轮离线评测\n\n| Case | 场景 | 结果 | 原因 |\n| --- | --- | --- | --- |\n' + results.map(r => `| ${r.case_id} | ${r.title} | ${r.evaluation_result} | ${(r.failure_reason ?? '').replaceAll('\n',' ')} |`).join('\n') + '\n');
console.log(`REPORT ${output}`);
if (results.some(r => r.evaluation_result === 'failed' || r.evaluation_result === 'error')) process.exitCode = 1;
