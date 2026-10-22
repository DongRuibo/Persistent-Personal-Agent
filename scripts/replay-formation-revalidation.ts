import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryInput, MemoryRecord } from '../src/contracts.js';
import type { ExtractedCandidate } from '../src/formation-types.js';
import { fingerprint, memoryDigest } from '../src/formation-types.js';
import { formationHarness } from '../tests/helpers/formation.js';

// 只回放保存的虚构真实输出；不加载.env、不创建模型、不覆盖原失败报告。
export async function replayFormationRevalidation() {
  const fixtureUrl = new URL('../tests/fixtures/memory-formation-revalidation.json', import.meta.url);
  const rawUrl = new URL('../docs/evaluations/v2.1b.2-formation-live.json', import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as { cases: { id: string; text: string; expected: string; old?: MemoryInput }[] };
  const report = JSON.parse(readFileSync(rawUrl, 'utf8')) as {
    fixtureSha256: string; rows: { id: string; sourceRunId: string; initialMemories: MemoryRecord[] }[];
    wire: { caseId: string; phase: string; output: string }[];
  };
  assert.equal(fingerprint(readFileSync(fixtureUrl, 'utf8')), report.fixtureSha256);
  const rows = [];
  for (const sample of fixture.cases) {
    const h = formationHarness();
    try {
      const old = sample.old && h.write(sample.old), before = memoryDigest(h.memory.listForHost());
      const source = h.enqueue(sample.text), original = report.rows.find(row => row.id === sample.id)!;
      const wire = report.wire.find(row => row.caseId === sample.id && row.phase === 'extraction')!;
      const parsed = JSON.parse(wire.output) as { candidates: ExtractedCandidate[] };
      const candidates = parsed.candidates.map(candidate => {
        assert.equal(candidate.sourceRunId, original.sourceRunId); assert.equal(candidate.quote, sample.text);
        if (candidate.targetId) assert.equal(candidate.targetId, original.initialMemories[0]?.id);
        return { ...candidate, sourceRunId: source.source!.reference, ...(candidate.targetId ? { targetId: old!.id } : {}) };
      });
      h.setExtractor(async () => ({ candidates })); h.advance(10001); await h.formation.tick();
      const current = h.store.formation.candidates('single-user')[0];
      const actual = current?.status === 'needs_clarification' ? 'clarify' : current?.target ? 'update' : current ? 'new' : sample.expected === 'duplicate' ? 'duplicate' : 'none';
      const unchanged = memoryDigest(h.memory.listForHost()) === before;
      assert.ok(unchanged); assert.equal(h.tasks.list().length, 0);
      if (current) { assert.equal(current.draft, sample.text); assert.equal(current.quote, sample.text); }
      rows.push({ id: sample.id, expected: sample.expected, actual,
        passed: actual === sample.expected && (sample.expected !== 'update' || current?.target?.id === old?.id),
        rawOutputSha256: fingerprint(wire.output), sourceText: sample.text, unchangedWithoutApproval: unchanged,
        candidate: current ? { subject: current.subject, property: current.property, value: current.value, draft: current.draft,
          status: current.status, target: current.target && { key: current.target.key, version: current.target.version, content: current.target.content }, targetCount: current.targetOptions.length } : null,
        events: h.store.events(source.source!.reference).filter(event => /formation_(?:property|target)/u.test(event.type)).map(event => event.type) });
    } finally { await h.close(); }
  }
  return { mode: 'offline-replay-v2.1b.2-recorded-output', createdAt: new Date().toISOString(),
    rawReportSha256: fingerprint(readFileSync(rawUrl, 'utf8')), fixtureSha256: report.fixtureSha256,
    sourceSha256: fingerprint(readFileSync(new URL('../src/formation-service.ts', import.meta.url), 'utf8')),
    actualApiRequests: 0, actualTokens: 0, actualCostCny: 0,
    boundary: '仅sourceRunId和targetId重绑临时库随机ID；原始模型语义输出不修改，不批准、不生成、不发送飞书。',
    metrics: { expectedOutcomes: `${rows.filter(row => row.passed).length}/${rows.length}`, unauthorizedWrites: rows.filter(row => !row.unchangedWithoutApproval).length }, rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await replayFormationRevalidation();
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice('--output='.length);
  if (output) writeFileSync(resolve(output), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ metrics: report.metrics, failed: report.rows.filter(row => !row.passed).map(row => row.id), apiRequests: 0 }));
  if (report.rows.some(row => !row.passed)) process.exitCode = 1;
}
