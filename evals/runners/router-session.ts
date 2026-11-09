import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { environment } from '../environments/router-session.js';
import { gradeContext, summarize } from '../evaluators/router-session.js';
import type { RouterDataset, RouterCase, RouteScript, CaseResult, Snapshot, RecoveryProbe } from '../router-session-types.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const git = (...args: string[]) => execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
const json = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const session = (snapshot: Snapshot, key: string | null | undefined) => key ? snapshot.sessions.find(item => item.path.includes('/topics/' + hash(key) + '/')) : undefined;
const csvCell = (value: unknown) => '"' + String(value ?? '').replaceAll('"', '""') + '"';

export async function runEvaluation(output?: string, only?: string[]) {
  const datasetPath = join(project, 'evals/datasets/router-session-v1.json'), mockPath = join(project, 'evals/datasets/router-session-mock-v1.json');
  const dataset = JSON.parse(readFileSync(datasetPath, 'utf8')) as RouterDataset;
  const mock = JSON.parse(readFileSync(mockPath, 'utf8')) as { cases: Record<string, RouteScript> };
  if (dataset.cases.length !== 80 || new Set(dataset.cases.map(row => row.case_id)).size !== 80
    || Object.keys(dataset.categories).some(key => dataset.cases.filter(row => row.category === key).length !== 8)
    || dataset.cases.some(row => !mock.cases[row.case_id] || row.expected.target && !dataset.topics[row.expected.target])) throw new Error('80条数据集、类别或独立Mock脚本不完整');
  const specs = only ? dataset.cases.filter(row => only.includes(row.case_id)) : dataset.cases;
  if (!specs.length || only && specs.length !== only.length) throw new Error('未知Case选择');
  const productionBaseline = 'ead27a7e19fa99ac7413fceec81e603681192870';
  // 评测提交可以前进；被测生产文件仍必须与授权基线一致。
  execFileSync('git', ['merge-base', '--is-ancestor', productionBaseline, 'HEAD'], { cwd: project });
  const baseline = git('ls-tree', '-r', productionBaseline, 'src', 'tests', 'web', 'package-lock.json').split('\n').filter(Boolean)
    .map(line => { const [identity, path] = line.split('\t'); return { path: path!, blob: identity!.split(' ')[2]! }; });
  // 仓库checkout会转换CRLF；用Git本身的clean规则核对blob，同时另存实际执行字节Hash。
  const changed = baseline.filter(({ path, blob }) => git('hash-object', '--path=' + path, path) !== blob).map(item => item.path);
  if (changed.length) throw new Error('生产/既有测试/依赖与基线不一致：' + changed.join(','));
  const files = git('ls-files', '--cached', '--others', '--exclude-standard', 'src', 'tests', 'evals', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json')
    .split('\n').filter(path => path && !path.startsWith('evals/reports/')).sort();
  const fingerprints = Object.fromEntries(files.map(path => [path, hash(readFileSync(join(project, path)))]));
  const runId = new Date().toISOString().replaceAll(/[:.]/g, '-'), directory = output ? resolve(output) : join(project, 'evals/reports/router-session', runId);
  mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'manifest.json'), '{}\n', { flag: 'wx' });
  mkdirSync(join(directory, 'cases'));
  const metadata = { run_id: runId, started_at: new Date().toISOString(), baseline: productionBaseline,
    evaluation_commit: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    git_status: git('status', '--porcelain'), node: process.version, platform: process.platform,
    dataset_sha256: hash(readFileSync(datasetPath)), mock_sha256: hash(readFileSync(mockPath)), source_sha256: hash(JSON.stringify(fingerprints)), files: fingerprints,
    mode: 'offline_scripted_model_real_host', full_dataset: specs.length === 80, planned_cases: specs.map(row => row.case_id),
    real_semantic_status: 'not_run', paid_model_calls: 0, production_data_access: false, external_api_dependencies_added: 0,
    summarizer: 'fixed_canary_extraction_from_actual_compaction_http_not_semantic_summary_evaluation',
    prior_evaluations: JSON.parse(readFileSync(join(project, 'evals/baselines/prior-evaluations.json'), 'utf8')) };
  json(join(directory, 'manifest.json'), metadata);
  const results: CaseResult[] = [];
  for (const spec of specs) {
    const started = performance.now(), label = spec.case_id;
    const result: CaseResult = { case_id: label, category: spec.category, title: spec.title, mode: 'offline_scripted_model_real_host',
      result: 'error', route_correct: false, session_correct: false, expected: spec.expected, actual: null, context: null,
      recovery: spec.restart ? spec.initial_state.topics.map(alias => ({ alias, passed: false, same_binding: false, same_session_id: false, own_present: false, contaminated: false })) : [],
      failure_categories: [], error: null, deterministic: false, elapsed_ms: 0, evidence_path: 'cases/' + label + '.json', evidence_sha256: '' };
    let f: Awaited<ReturnType<typeof environment>> | undefined;
    const evidence: Record<string, unknown> = { spec, fixed_mock_script: mock.cases[label], primary: null, recovery: [] };
    try {
      f = await environment(dataset.topics, !!spec.restart);
      const fixture = f;
      const ordered = spec.initial_state.topics.filter(alias => alias !== spec.initial_state.current_topic);
      if (spec.initial_state.current_topic && spec.initial_state.topics.includes(spec.initial_state.current_topic)) ordered.push(spec.initial_state.current_topic);
      for (const alias of ordered) {
        const topic = dataset.topics[alias]!, token = `CANARY_PRIVATE_${alias}_${randomUUID().replaceAll('-', '')}`;
        f.canaries[alias] = token;
        f.setScript({ kind: 'create', target: alias }, 'setup:' + alias);
        const history = spec.initial_state.history[alias]!;
        const receipt = await f.chat(history[0]!.replaceAll(`{{canary:${alias}}}`, token));
        if (receipt.run?.status !== 'succeeded' || receipt.topicRoute?.kind !== 'topic') throw new Error('主题种子未成功：' + alias + ' ' + JSON.stringify(receipt));
        f.ids[alias] = receipt.topicRoute.threadId;
        f.setScript({ kind: 'use', target: alias }, 'setup:' + alias);
        for (const message of history.slice(1)) {
          const turn = await f.chat(message.replaceAll(`{{canary:${alias}}}`, token));
          if (turn.run?.status !== 'succeeded' || turn.topicRoute?.kind !== 'topic' || turn.topicRoute.threadId !== f.ids[alias]) throw new Error('前置历史错误：' + alias);
        }
      }
      for (const alias of spec.initial_state.unbound_topics) await f.unbound(alias, false);
      for (const alias of spec.initial_state.archived_topics) await f.unbound(alias, true);
      if (!spec.initial_state.current_topic) { f.setScript({ kind: 'daily' }, 'setup:daily'); await f.chat('解释一个日常词语。'); }
      const sharedToken = 'CANARY_SHARED_GLOBAL_' + randomUUID().replaceAll('-', '');
      if (spec.memory === 'shared') await f.share(sharedToken);
      let recoveryBefore: Snapshot | undefined;
      if (spec.restart) {
        const alias = mock.cases[label]!.target!, topic = dataset.topics[alias]!;
        f.setScript({ kind: 'use', target: alias }, 'precrash:history');
        if (spec.restart.compact_before) {
          for (let i = 0; i < 9; i++) {
            const receipt = await f.chat(`${topic.title}，扩展历史第${i}轮。` + 'history-fixture '.repeat(410));
            if (receipt.run?.status !== 'succeeded') throw new Error('压缩前历史增长失败：' + JSON.stringify(receipt));
          }
        }
        recoveryBefore = await f.snapshot();
        if (spec.restart.compact_before && !recoveryBefore.sessions.some(item => item.compactions > 0)) throw new Error('要求压缩后的恢复，但没有发生真实压缩');
        f.setScript({ kind: 'use', target: alias }, 'crash:' + spec.restart.phase);
        await f.crash(spec.restart.phase, `${topic.title}，进程中断探针，继续本主题讨论。`);
        const restart = await f.restart();
        evidence.restart = restart;
        if (restart.automatic_http || restart.pid === restart.previousPid) throw new Error('重启自动HTTP或未更换真实PID');
        const recovered = await f.snapshot();
        evidence.recovered_idle = recovered;
        const previousRuns = new Set(recoveryBefore.runs.map(item => item.id));
        const interrupted = recovered.runs.filter(item => !previousRuns.has(item.id) && item.status === 'interrupted');
        evidence.interrupted_run_check = { expected: spec.restart.phase === 'idle' ? 0 : 1, actual: interrupted.map(item => item.id) };
        if (interrupted.length !== (spec.restart.phase === 'idle' ? 0 : 1)) throw new Error('强杀后的Run未按原策略恢复interrupted');
      }
      const before = await f.snapshot(), start = f.calls.length;
      const input = spec.user_input.replace(/\{\{id:([^}]+)\}\}/gu, (_all, alias: string) => f!.ids[alias]!)
        .replace(/\{\{canary:([^}]+)\}\}/gu, (_all, alias: string) => f!.canaries[alias]!);
      f.setScript(mock.cases[label]!, 'target');
      const receipt = await f.chat(input), after = await f.snapshot(), wire = f.calls.slice(start);
      const route = receipt.topicRoute ?? null;
      if (route?.kind === 'topic' && route.selection.kind === 'create' && mock.cases[label]!.target) f.ids[mock.cases[label]!.target!] = route.threadId;
      const actualTarget = route?.kind === 'topic' ? Object.keys(f.ids).find(alias => f!.ids[alias] === route.threadId) ?? null : null;
      const oldThread = route?.kind === 'topic' ? before.threads.find(item => item.id === route.threadId) : undefined;
      const action = route?.kind === 'topic' ? oldThread?.chatContextKey ? 'reuse' : 'create' : 'none';
      result.actual = { route, target: actualTarget, session_action: action, new_topics: after.threads.length - before.threads.length,
        run_status: receipt.run?.status ?? null, run_id: receipt.runId, output: receipt.run?.output ?? null };
      const normalized = route?.kind === 'topic' ? route.selection.kind === 'create' ? 'create' : 'reuse' : route?.kind;
      result.route_correct = receipt.run?.status === 'succeeded' && normalized === spec.expected.route && actualTarget === spec.expected.target;
      const oldSession = session(before, oldThread?.chatContextKey), newSession = session(after, route?.kind === 'topic' ? route.contextKey : null);
      result.session_correct = result.actual.new_topics === spec.expected.new_topics && action === spec.expected.session
        && (action === 'none' || actualTarget === spec.expected.target && !!newSession?.session_id
          && (action !== 'reuse' || oldSession?.session_id === newSession.session_id));
      const run = after.runs.find(item => item.id === receipt.runId);
      const dispatched = (run?.events as { type: string; details: string | null }[] | undefined)?.filter(item => item.type === 'topic_model_http' && item.details && JSON.parse(item.details).phase === 'dispatch').length ?? 0;
      result.context = gradeContext(wire, spec, f.canaries, sharedToken, dispatched);
      const purposes = (run?.events as { type: string; details: string | null }[] | undefined)?.flatMap(item =>
        item.type === 'topic_model_http' && item.details && JSON.parse(item.details).phase === 'dispatch' ? [JSON.parse(item.details).purpose as string] : []) ?? [];
      result.context.complete &&= wire.every((call, index) => (call.stage === 'clarification_answer' ? 'chat' : call.stage) === purposes[index]);
      result.deterministic = !wire.some(call => call.stage === 'topic_route');
      if (!result.route_correct) {
        result.failure_categories.push('route_gold_mismatch');
        result.failure_categories.push(route?.kind === 'clarify' && spec.expected.route !== 'clarify' ? 'overclarification'
          : route?.kind === 'topic' && actualTarget !== spec.expected.target ? 'wrong_topic'
          : route?.kind === 'topic' && route.selection.kind === 'create' ? 'unnecessary_topic_creation' : 'route_action_mismatch');
      }
      if (!result.session_correct) result.failure_categories.push('session_action_or_identity_mismatch');
      if (!result.context.complete) result.failure_categories.push('incomplete_context_capture');
      if (result.context.contaminated) result.failure_categories.push('private_context_contamination');
      if (result.context.own_required && !result.context.own_present) result.failure_categories.push('missing_own_context');
      if (result.context.shared_required && !result.context.shared_present) result.failure_categories.push('missing_allowed_shared_memory');
      if (after.jobs !== before.jobs || after.tasks !== before.tasks) result.failure_categories.push('unexpected_business_execution');
      if (f.errors.length) result.failure_categories.push('model_fixture_error');
      const selectedContext = actualTarget ? gradeContext(wire, { ...spec, expected: { ...spec.expected, target: actualTarget } }, f.canaries, sharedToken, dispatched) : null;
      result.selected_context_contaminated = selectedContext?.contaminated ?? null;
      evidence.primary = { input, receipt, before, after, calls: wire, dispatched, selected_session_context: selectedContext };
      if (recoveryBefore) {
        const check = (alias: string, snap: Snapshot, records: typeof wire): RecoveryProbe => {
          const old = recoveryBefore!.threads.find(item => item.id === fixture.ids[alias]), current = snap.threads.find(item => item.id === fixture.ids[alias]);
          const grade = gradeContext(records, { ...spec, expected: { ...spec.expected, target: alias, own_context_required: true } }, fixture.canaries, sharedToken, records.length);
          const binding = !!old?.chatContextKey && old.chatContextKey === current?.chatContextKey;
          const identity = !!session(recoveryBefore!, old?.chatContextKey)?.session_id
            && session(recoveryBefore!, old?.chatContextKey)?.session_id === session(snap, current?.chatContextKey)?.session_id;
          return { alias, same_binding: binding, same_session_id: identity, own_present: !!grade.own_present, contaminated: grade.contaminated,
            passed: binding && identity && !!grade.own_present && !grade.contaminated };
        };
        for (const alias of spec.initial_state.topics) {
          let probe: RecoveryProbe;
          // 原目标首次重入失败不能被后续额外探针的成功覆盖。
          if (alias === spec.expected.target) {
            probe = check(alias, after, wire);
            if (!result.route_correct || actualTarget !== alias) probe.passed = false;
          }
          else {
            const begin = f.calls.length; f.setScript({ kind: 'use', target: alias }, 'recovery:' + alias);
            const restored = await f.chat(`继续${dataset.topics[alias]!.title}，恢复本主题先前的信息。`);
            const snap = await f.snapshot(); probe = check(alias, snap, f.calls.slice(begin));
            if (restored.run?.status !== 'succeeded' || restored.topicRoute?.kind !== 'topic' || restored.topicRoute.threadId !== f.ids[alias]) probe.passed = false;
          }
          result.recovery[result.recovery.findIndex(item => item.alias === alias)] = probe;
        }
        if (result.recovery.some(probe => !probe.passed)) result.failure_categories.push('session_recovery_failed');
      }
      result.result = result.failure_categories.length ? 'failed' : 'passed';
    } catch (error) {
      result.result = 'error'; result.error = error instanceof Error ? error.stack ?? error.message : String(error);
      result.failure_categories.push('execution_or_fixture_error');
    } finally {
      if (f) {
        evidence.canary_registry = f.canaries; evidence.ids = f.ids; evidence.calls = f.calls;
        evidence.lifecycle = f.lifecycle; evidence.fixture_errors = f.errors;
        try {
          const final = await f.snapshot(); evidence.final_snapshot = final;
          for (const item of final.sessions) {
            const destination = join(directory, 'session-files', label, item.path); mkdirSync(dirname(destination), { recursive: true });
            copyFileSync(join(f.config.sessionDir, item.path), destination);
          }
        } catch (error) { evidence.final_snapshot_error = String(error); }
        try { await f.close(); } catch (error) { result.result = 'error'; result.error = (result.error ?? '') + '\n清理错误：' + String(error); }
        // 子进程退出证据可能在close之后新增，必须在close后序列化。
        evidence.lifecycle = f.lifecycle;
        rmSync(f.root, { recursive: true, force: true });
      }
      result.elapsed_ms = Math.round(performance.now() - started);
      const path = join(directory, result.evidence_path); json(path, { result, evidence }); result.evidence_sha256 = hash(readFileSync(path));
      results.push(result); json(join(directory, 'results.json'), { metadata, summary: summarize(results), results });
      console.log(`${label} ${result.result} ${result.failure_categories.join(',')} ${result.error?.split('\n')[0] ?? ''}`);
    }
  }
  const summary = summarize(results);
  const columns = ['case_id', 'category', 'result', 'route_correct', 'session_correct', 'expected_target', 'actual_target', 'expected_session', 'actual_session', 'contaminated', 'own_present', 'recovery_passed', 'recovery_total', 'failure_categories', 'evidence_path'];
  writeFileSync(join(directory, 'results.csv'), columns.join(',') + '\n' + results.map(row => [row.case_id, row.category, row.result, row.route_correct, row.session_correct,
    row.expected.target, row.actual?.target, row.expected.session, row.actual?.session_action, row.context?.contaminated, row.context?.own_present,
    row.recovery.filter(probe => probe.passed).length, row.recovery.length, row.failure_categories.join(';'), row.evidence_path].map(csvCell).join(',')).join('\n') + '\n');
  writeFileSync(join(directory, 'contexts.jsonl'), results.flatMap(row => {
    const saved = JSON.parse(readFileSync(join(directory, row.evidence_path), 'utf8'));
    return saved.evidence.calls?.map((call: unknown) => JSON.stringify({ case_id: row.case_id, call })) ?? [];
  }).join('\n') + '\n');
  writeFileSync(join(directory, 'report.md'), `# Router与多Session离线评测\n\n基线：${metadata.baseline}。固定Mock+真实宿主，收费调用0。真实语义Routing Accuracy及真实语义复用指标均未测。\n\n` +
    `总数${results.length}，通过${summary.counts.passed}，失败${summary.counts.failed}，执行错误${summary.counts.error}。\n\n` +
    '## 离线宿主指标\n\n```json\n' + JSON.stringify(summary.offline_mechanisms, null, 2) + '\n```\n\n' +
    '## 逐题结果\n\n| Case | 结果 | 失败分类 |\n| --- | --- | --- |\n' + results.map(row => `| ${row.case_id} | ${row.result} | ${row.failure_categories.join(';')} |`).join('\n') +
    '\n\n固定Mock提议的gold不一致不自动等于生产缺陷。完整预期、Mock输出、实际路由和HTTP见逐Case原件。来源Manifest、独立Mock脚本及数据集Hash已冻结；旧通知30/30、恢复6/6、HTTP分类8/8只作其他基线的历史引用，不进入本次分母。\n');
  json(join(directory, 'results.json'), { metadata, summary, results });
  console.log('REPORT ' + directory);
  return { directory, summary, results };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv.indexOf('--out'), select = process.argv.indexOf('--cases');
  const result = await runEvaluation(out >= 0 ? process.argv[out + 1] : undefined, select >= 0 ? process.argv[select + 1]!.split(',') : undefined);
  if (result.results.some(row => row.result !== 'passed')) process.exitCode = 1;
}
