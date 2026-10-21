import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import type { MemoryInput } from '../src/contracts.js';
import type { ExtractedCandidate } from '../src/formation-types.js';
import { fingerprint, memoryDigest } from '../src/formation-types.js';
import { formationHarness } from '../tests/helpers/formation.js';

// 只回放已保存的虚构提取输出；不创建 Pi Executor、不加载 .env、不联网。
export async function replayFormationLive() {
  const fixtureUrl = new URL('../tests/fixtures/memory-formation-live.json', import.meta.url);
  const rawUrl = new URL('../docs/evaluations/v2.1b-formation-live.json', import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as { cases: { id: string; text: string; expected: string; kind?: string; old?: MemoryInput; prefilter?: boolean }[] };
  const recorded = JSON.parse(readFileSync(rawUrl, 'utf8')) as {
    fixtureSha256: string; rows: { id: string; sourceRunId: string; initialMemories: { id: string }[] }[];
    wire: { caseId: string; phase: string; output: string }[];
  };
  assert.equal(fingerprint(readFileSync(fixtureUrl, 'utf8')), recorded.fixtureSha256, '冻结12窗不得改变');
  const rows = [];
  for (const sample of fixture.cases) {
    const h = formationHarness(); let calls = 0;
    try {
      const old = sample.old && h.write(sample.old);
      const before = memoryDigest(h.memory.listForHost());
      const source = h.enqueue(sample.text);
      const original = recorded.rows.find(row => row.id === sample.id)!;
      const wire = recorded.wire.find(item => item.caseId === sample.id && item.phase === 'extraction');
      assert.equal(!!wire, !sample.prefilter);
      const output = wire && JSON.parse(wire.output) as { candidates: ExtractedCandidate[] } | undefined;
      // 临时库的随机 ID 不同，只重绑 sourceRunId/targetId；语义字段、引文及模型错误均保留。
      const remapped = output?.candidates.map(proposal => {
        assert.equal(proposal.sourceRunId, original.sourceRunId); assert.equal(proposal.quote, sample.text);
        if (proposal.targetId) assert.equal(proposal.targetId, original.initialMemories[0]?.id);
        return { ...proposal, sourceRunId: source.source!.reference, ...(proposal.targetId ? { targetId: old!.id } : {}) };
      });
      h.setExtractor(async () => { calls++; assert.ok(remapped, '预滤窗口不得调用提取器'); return { candidates: remapped }; });
      const at = performance.now(); h.advance(10001); await h.formation.tick();
      const candidates = h.store.formation.candidates('single-user');
      const candidate = candidates[0];
      const jobs = h.store.formation.jobs();
      const actual = jobs.some(job => job.status === 'failed') ? 'failed' : candidate?.status === 'needs_clarification' ? 'clarify'
        : candidate?.target ? 'update' : candidate ? 'new' : sample.expected === 'duplicate' ? 'duplicate' : 'none';
      const unchanged = memoryDigest(h.memory.listForHost()) === before;
      assert.ok(unchanged); assert.equal(h.store.listTasks().length, 0);
      for (const current of candidates) {
        assert.equal(current.quote, sample.text); assert.equal(current.draft, sample.text);
        assert.equal(current.sourceHash, fingerprint(sample.text));
        const proposal = remapped!.find(item => item.property === current.property)!;
        assert.ok(proposal); assert.equal(current.value, proposal.value); assert.equal(current.subject, proposal.subject);
      }
      rows.push({ id: sample.id, expected: sample.expected, actual,
        passed: actual === sample.expected && (!candidate || !sample.kind || candidate.kind === sample.kind) &&
          (sample.expected !== 'update' || candidate?.target?.id === old?.id),
        sourceText: sample.text, rawOutputSha256: wire ? fingerprint(wire.output) : null, replayCalls: calls,
        candidate: candidate ? { kind: candidate.kind, subject: candidate.subject, property: candidate.property, value: candidate.value,
          draft: candidate.draft, quote: candidate.quote, sourceHash: candidate.sourceHash, status: candidate.status,
          target: candidate.target && { key: candidate.target.key, version: candidate.target.version, content: candidate.target.content } } : null,
        unchangedWithoutApproval: unchanged, tasksCreated: 0, elapsedMs: performance.now() - at });
    } finally { await h.close(); }
  }
  const worth = rows.filter(row => ['new', 'update'].includes(row.expected));
  const accepted = rows.filter(row => row.candidate);
  return { mode: 'offline-replay-recorded-real-extraction', createdAt: new Date().toISOString(),
    rawReportSha256: fingerprint(readFileSync(rawUrl, 'utf8')), fixtureSha256: recorded.fixtureSha256,
    sourceSha256: fingerprint(readFileSync(new URL('../src/formation-service.ts', import.meta.url), 'utf8')),
    actualApiRequests: 0, actualTokens: 0, actualCostCny: 0, approvalOrGenerationReplayed: false,
    boundary: '原模型输出不重算，仅重绑临时库随机ID；所有窗口不批准、不写Memory。不是新真实模型/生成/飞书验收。',
    metrics: { expectedOutcomes: `${rows.filter(row => row.passed).length}/${rows.length}`,
      retainedWorthKeeping: `${worth.filter(row => row.candidate).length}/${worth.length}`,
      acceptedValidCandidates: `${accepted.filter(row => row.passed).length}/${accepted.length}`,
      falseCandidates: accepted.filter(row => !['new', 'update'].includes(row.expected)).length,
      unauthorizedWrites: rows.filter(row => !row.unchangedWithoutApproval).length,
      replayCalls: rows.reduce((sum, row) => sum + row.replayCalls, 0) }, rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await replayFormationLive();
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
  // 必须显式给新路径；wx 禁止覆盖原始失败证据或已有回放报告。
  if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ mode: report.mode, metrics: report.metrics, failed: report.rows.filter(row => !row.passed).map(row => row.id) }, null, 2));
  if (report.rows.some(row => !row.passed)) process.exitCode = 1;
}
