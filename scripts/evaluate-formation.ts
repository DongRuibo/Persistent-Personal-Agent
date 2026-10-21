import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { formationHarness } from '../tests/helpers/formation.js';

interface Window {
  id: string; split: string; category: string; text: string; kind: 'semantic' | 'project' | 'episodic' | 'procedural';
  subject: string; property: string; value: string; old?: string; old2?: string; mode?: string; wrongQuote?: boolean;
  expected: 'new' | 'update' | 'duplicate' | 'reject' | 'clarify';
}
export async function evaluateFormation() {
  const fixtureUrl = new URL('../tests/fixtures/memory-formation-windows.json', import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as { windows: Window[] };
  const rows: { id: string; split: string; category: string; expected: string; actual: string; passed: boolean; candidate: boolean; expectedCandidate: boolean; kindCorrect: boolean | null; unauthorizedWrites: number; modelCalls: number; admissionMs: number; simulatedElapsedMs: number; inputBytes: number; reservedCny: number }[] = [];
  for (const sample of fixture.windows) {
    const h = formationHarness(); let calls = 0; let inputBytes = 0;
    try {
      for (const [index, content] of [sample.old, sample.old2].filter((value): value is string => !!value).entries()) h.write({ kind: sample.kind, key: `fixture.${index}`, content });
      const before = h.memory.listForHost().length, at = performance.now();
      const req = h.enqueue(sample.text);
      const admissionMs = performance.now() - at;
      h.setExtractor(async ({ systemPrompt, data }) => {
        calls++;
        inputBytes = Buffer.byteLength(systemPrompt + data);
        return { candidates: [{ sourceRunId: req.source!.reference, quote: sample.wrongQuote ? '伪造引文' : sample.text, kind: sample.kind,
          mode: sample.mode ?? 'asserted', durable: true, subject: sample.subject, property: sample.property, value: sample.value, content: '模型改写不应被直接采纳' }] };
      });
      h.advance(10001); await h.formation.tick();
      const candidate = h.store.formation.candidates('single-user')[0];
      const expectedCandidate = ['new', 'update', 'clarify'].includes(sample.expected);
      const actual = candidate?.status === 'needs_clarification' ? 'clarify' : candidate?.target ? 'update' : candidate ? 'new' : sample.expected === 'duplicate' ? 'duplicate' : 'reject';
      rows.push({ id: sample.id, split: sample.split, category: sample.category, expected: sample.expected, actual,
        passed: actual === sample.expected, candidate: !!candidate, expectedCandidate,
        kindCorrect: candidate ? candidate.kind === sample.kind : null, unauthorizedWrites: h.memory.listForHost().length - before,
        modelCalls: calls, admissionMs: Number(admissionMs.toFixed(2)), inputBytes,
        reservedCny: h.store.formation.jobs().reduce((sum, job) => sum + (job.reserved ?? 0), 0), simulatedElapsedMs: Number((performance.now() - at).toFixed(2)) });
    } finally { await h.close(); }
  }
  const metrics = (split: string) => {
    const group = rows.filter(row => row.split === split), good = group.filter(row => row.candidate && row.expectedCandidate).length;
    return { windows: group.length, passed: group.filter(row => row.passed).length,
      validationPrecision: good / Math.max(1, group.filter(row => row.candidate).length),
      fixtureRecall: good / Math.max(1, group.filter(row => row.expectedCandidate).length),
      falseCandidateCount: group.filter(row => row.candidate && !row.expectedCandidate).length,
      kindCorrect: group.filter(row => row.kindCorrect === true).length, unauthorizedWrites: group.reduce((sum, row) => sum + row.unauthorizedWrites, 0),
      calls: group.reduce((sum, row) => sum + row.modelCalls, 0) };
  };
  const admissions = rows.map(row => row.admissionMs).sort((a, b) => a - b);
  return { mode: 'offline-scripted-proposals', fixture: fileURLToPath(fixtureUrl).split('tests').at(-1),
    fixtureSha256: createHash('sha256').update(readFileSync(fixtureUrl)).digest('hex'),
    limitation: '仅验证固定模拟提议的过滤/归属/冲突机制；真实模型提取正确率、漏提率、kind分类质量、Token和交互确认负担均未测量。候选为原话整句；不把模拟100%当语义达标。',
    actualApiRequests: 0, actualTokens: 0, actualCostCny: 0, semanticPrecision: null, semanticMissRate: null,
    approvalBurden: '新增/更新至少查看一次+逐条批准；改写或多目标再确认。未运行用户体验测量。',
    performance: { admissionP50Ms: admissions[Math.floor(admissions.length / 2)], admissionP95Ms: admissions[Math.floor(admissions.length * .95)],
      inputBytesMax: Math.max(...rows.map(row => row.inputBytes)), mockElapsedMaxMs: Math.max(...rows.map(row => row.simulatedElapsedMs)),
      note: '每窗0–2条已有事实，小样本本地宿主开销，非真实模型延迟/吞吐；reservedCny按示例10/20费率预留，非消费。' },
    development: metrics('development'), holdout: metrics('holdout'), rows };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const report = await evaluateFormation();
  writeFileSync(new URL('../docs/evaluations/v2.1b-formation-offline.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ development: report.development, holdout: report.holdout, apiRequests: 0 }, null, 2));
  if (report.rows.some(row => !row.passed || row.unauthorizedWrites !== 0)) process.exitCode = 1;
}
