import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as Value from 'typebox/value';
import { fingerprint, formationSchema, normalized } from '../src/formation-types.js';
import type { ExtractedCandidate, MemoryCandidate } from '../src/formation-types.js';
import type { MemoryRecord } from '../src/contracts.js';

// 只读已完成的V2.1b.2响应，断言实际证据；不重跑模型，不修改原始失败。
interface Wire {
  caseId: string; phase: string; output: string; bytes: number; outputLimit: number; reservedCny: number;
  elapsedMs: number; httpStatus: number; finishReason: string; messages: { role: string; content: unknown }[];
  reportedUsage: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number };
}
interface Row {
  id: string; text: string; expected: string; actual: string; mechanismPass: boolean;
  sourceRunId: string; candidatesBeforeApproval: MemoryCandidate[]; initialMemories: MemoryRecord[];
  unapprovedMemoryUnchanged: boolean; tasksCreated: number; currentMemories?: MemoryRecord[];
  applied?: MemoryCandidate; generationMemoryUnchanged?: boolean;
  generation?: { question: string; answer: string; newSession: boolean; tools: number; events: { type: string; details: string }[] };
}
const rawUrl = new URL('../docs/evaluations/v2.1b.2-formation-live.json', import.meta.url);
const rawText = readFileSync(rawUrl, 'utf8');
const report = JSON.parse(rawText) as { startedAt: string; completedAt: string; status: string; rows: Row[]; wire: Wire[];
  sourceHashes: Record<string, string>; fixtureSha256: string; actualNetworkRequests: number; reservedCny: number;
  formalFormationEnabledBefore: boolean; formalFormationEnabledAfter: boolean; formalDataWritten: boolean; feishuMessagesSent: number };
assert.equal(report.status, 'completed'); assert.equal(report.rows.length, 8); assert.equal(report.wire.length, 12);
assert.equal(report.wire.length, report.actualNetworkRequests); assert.ok(report.reservedCny <= .87968);
assert.equal(report.formalFormationEnabledBefore, false); assert.equal(report.formalFormationEnabledAfter, false);
assert.equal(report.formalDataWritten, false); assert.equal(report.feishuMessagesSent, 0);
assert.equal(fingerprint(readFileSync(new URL('../tests/fixtures/memory-formation-revalidation.json', import.meta.url), 'utf8')), report.fixtureSha256);
for (const [file, hash] of Object.entries(report.sourceHashes)) {
  const text = readFileSync(file, 'utf8'), lf = text.replace(/\r\n/gu, '\n');
  assert.ok([text, lf, lf.replace(/\n/gu, '\r\n')].some(value => fingerprint(value) === hash), file);
}
const phaseLimits = { extraction: [8, 3072, 512], approval: [2, 6144, 1000], generation: [2, 8192, 4096] };
for (const [phase, [count, bytes, tokens]] of Object.entries(phaseLimits)) {
  const calls = report.wire.filter(w => w.phase === phase); assert.equal(calls.length, count);
  assert.ok(calls.every(w => w.bytes <= bytes! && w.outputLimit <= tokens!));
}
for (const call of report.wire) { assert.equal(call.httpStatus, 200); assert.equal(call.finishReason, 'stop'); }
for (const row of report.rows) { assert.equal(row.unapprovedMemoryUnchanged, true); assert.equal(row.tasksCreated, 0); }
const proposals = report.wire.filter(w => w.phase === 'extraction').flatMap(w => {
  const parsed = JSON.parse(w.output) as { candidates: ExtractedCandidate[] };
  assert.ok(Value.Check(formationSchema, parsed));
  assert.ok(parsed.candidates.every(c => c.sourceRunId === report.rows.find(r => r.id === w.caseId)!.sourceRunId && c.quote === report.rows.find(r => r.id === w.caseId)!.text));
  return parsed.candidates.map(candidate => ({ caseId: w.caseId, candidate }));
});
const row = (id: string) => report.rows.find(r => r.id === id)!;
assert.deepEqual(report.rows.filter(r => !r.mechanismPass).map(r => r.id), ['H01', 'H02']);
assert.equal(row('F02').candidatesBeforeApproval[0]!.property, '以后做 Agent 项目主要使用');
assert.equal(row('F08').candidatesBeforeApproval[0]!.draft, '我不希望回答省略错误原因。');
assert.equal(row('F05').candidatesBeforeApproval.length, 0); assert.equal(row('F06').candidatesBeforeApproval.length, 0);
assert.equal(proposals.find(p => p.caseId === 'F06')!.candidate.targetId, row('F06').initialMemories[0]!.id);
assert.equal(row('H01').actual, 'clarify'); assert.equal(row('H01').candidatesBeforeApproval[0]!.target, undefined);
assert.equal(row('H01').candidatesBeforeApproval[0]!.status, 'needs_clarification');
assert.ok(proposals.filter(p => p.caseId === 'H01').every(p => p.candidate.targetId === row('H01').initialMemories[0]!.id));
assert.equal(row('H02').actual, 'none');
assert.equal(normalized(row('H02').text).includes(normalized(proposals.find(p => p.caseId === 'H02')!.candidate.property)), false);
const approved = ['F01', 'F04'].map(id => {
  const r = row(id), current = r.currentMemories![0]!, projection = JSON.parse(r.generation!.events[0]!.details) as { hits: { id: string; version: number }[]; bytes: number; budget: number };
  assert.equal(r.applied?.status, 'applied'); assert.equal(r.currentMemories!.length, 1);
  assert.equal(current.content, r.text); assert.equal(current.source.reference, r.applied!.approvalRunId);
  assert.equal(current.version, id === 'F04' ? 2 : 1);
  if (id === 'F04') assert.equal(current.id, r.initialMemories[0]!.id);
  assert.equal(r.generation!.newSession, true); assert.equal(r.generation!.tools, 0); assert.equal(r.generationMemoryUnchanged, true);
  assert.ok(projection.hits.some(h => h.id === current.id && h.version === current.version)); assert.ok(projection.bytes <= projection.budget);
  const generation = report.wire.find(w => w.caseId === id && w.phase === 'generation')!;
  assert.ok(!generation.messages.some(m => m.role === 'tool')); assert.ok(JSON.stringify(generation.messages).includes(current.id));
  if (id === 'F04') assert.ok(!JSON.stringify(generation.messages).includes(r.initialMemories[0]!.content));
  return { caseId: id, memoryId: current.id, version: current.version, approvalRunId: r.applied!.approvalRunId, content: current.content, question: r.generation!.question, answer: r.generation!.answer, contextBytes: projection.bytes, contextBudget: projection.budget };
});
const input = report.wire.reduce((sum, w) => sum + w.reportedUsage.prompt_tokens, 0);
const output = report.wire.reduce((sum, w) => sum + w.reportedUsage.completion_tokens, 0);
const cached = report.wire.reduce((sum, w) => sum + (w.reportedUsage.prompt_cache_hit_tokens ?? 0), 0);
const timing = report.wire.map(w => w.elapsedMs).sort((a,b) => a-b);
const worth = report.rows.filter(r => ['new', 'update'].includes(r.expected));
const original = report.rows.filter(r => r.id.startsWith('F')), holdout = report.rows.filter(r => r.id.startsWith('H'));
const review = { reviewedAt: new Date().toISOString(), startedAt: report.startedAt, completedAt: report.completedAt,
  baselineCommit: 'f79a8b8858b66b2c8f839dd3d2f00e03f2dc1d5b', rawReportSha256: fingerprint(rawText), fixtureSha256: report.fixtureSha256,
  requests: { total: 12, extraction: 8, approval: 2, generation: 2, allHttp200AndStop: true, reservedCny: report.reservedCny },
  tokens: { inputIncludingCached: input, output, cachedInput: cached, uncachedInput: input - cached },
  pricing: { source: 'https://www.siliconflow.cn/pricing', verifiedDate: '2026-10-22', peakRatesCnyPerMillion: { uncachedInput: 2, cachedInput: .04, output: 8 },
    estimatedPeakCny: ((input-cached)*2 + cached*.04 + output*8)/1e6, billingVerified: false },
  timing: { p50Ms: timing[Math.floor(timing.length/2)], maxMs: Math.max(...timing) },
  metrics: { expectedOutcomes: `${report.rows.filter(r => r.mechanismPass).length}/${report.rows.length}`,
    originalSix: `${original.filter(r => r.mechanismPass).length}/${original.length}`, newHoldoutTwo: `${holdout.filter(r => r.mechanismPass).length}/${holdout.length}`,
    readyWorthKeeping: `${worth.filter(r => r.candidatesBeforeApproval[0]?.status === 'pending').length}/${worth.length}`,
    retainedIncludingClarification: `${worth.filter(r => r.candidatesBeforeApproval.length > 0).length}/${worth.length}`,
    unauthorizedWrites: report.rows.filter(r => !r.unapprovedMemoryUnchanged).length, appliedMemories: approved.length, correctFreshSessionAnswers: '2/2', rawProposals: proposals.length,
    note: 'H01保留了完整且正确的新项目原话，但错误模型target使其需澄清，不计作可直接批准成功；H02无候选。不是总体语义成功率或手机验收。' },
  humanReview: [
    { id: 'F01', result: 'PASS', reason: '完整平时偏好被接受；真实审批新增v1，新Session回答简洁中文，当前Memory证据一致。' },
    { id: 'F02', result: 'PASS', reason: '以后做Agent项目范围保留为pending候选；未批准无写入。' },
    { id: 'F04', result: 'PASS', reason: '正确旧ID原地v2、当前审批Run；新Session保留Python用得少的限定，没有加载旧v1正文。' },
    { id: 'F05', result: 'PASS_HOST_DEDUPE', reason: '模型仍提重复记录，宿主去重；不是模型主动去重成功。' },
    { id: 'F06', result: 'PASS_HOST_BLOCK_RAW_SCOPE_ERROR', reason: '模型再次给小岚的事实引用用户记录targetId，宿主因主体拒绝，没有覆盖用户偏好。' },
    { id: 'F08', result: 'PASS', reason: '不希望省略错误原因完整保留，无否定反转。' },
    { id: 'H01', result: 'FAIL_READY_NEEDS_CLARIFICATION', reason: '模型把Beryl两个字段都指向Cedar旧ID，并违反每来源最多一提议；宿主只保留第一条完整原话为needs_clarification，无更新目标、不覆盖Cedar。安全拦截有效，直接形成候选目标未达。' },
    { id: 'H02', result: 'FAIL_NO_CANDIDATE', reason: 'property=做移动端项目使用Ruby丢了不字，并非来源连续片段，且target指向服务端旧事实；宿主在来源字段校验处拒绝。content虽保留否定，不能补足无效property。' },
  ], approved,
  unverified: ['真实主Agent工具选择/清单送达/手机体验仍模拟','未做第二轮和Mac/Linux平台补测','没有开启正式Formation或分析正式历史','H01/H02未修复或重跑，不能宣称质量目标全面达标'] };
writeFileSync(new URL('../docs/evaluations/v2.1b.2-formation-live-review.json', import.meta.url), JSON.stringify(review, null, 2) + '\n');
console.log(JSON.stringify({ requests: review.requests, tokens: review.tokens, metrics: review.metrics, pricing: review.pricing, timing: review.timing }, null, 2));
