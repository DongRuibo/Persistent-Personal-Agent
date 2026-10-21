import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fingerprint, formationSchema } from '../src/formation-types.js';
import * as Value from 'typebox/value';
import type { MemoryCandidate } from '../src/formation-types.js';
import type { MemoryRecord } from '../src/contracts.js';

// 离线复核已发生的请求；不得联网或重新生成候选来替换失败样本。
const rawUrl = new URL('../docs/evaluations/v2.1b-formation-live.json', import.meta.url);
interface Row {
  id: string; expected: string; actual: string; mechanismPass: boolean; unapprovedMemoryUnchanged: boolean; tasksCreated: number;
  sourceRunId: string; candidatesBeforeApproval: MemoryCandidate[]; initialMemories: MemoryRecord[]; currentMemories?: MemoryRecord[];
  approval?: { runId: string }; applied?: MemoryCandidate; generationMemoryUnchanged?: boolean;
  generation?: { answer: string; newSession: boolean; tools: number; events: { type: string; details: string }[] };
}
interface Wire { caseId: string; phase: string; output: string; bytes: number; outputLimit: number; reservedCny: number; elapsedMs: number; httpStatus: number; finishReason: string; reportedUsage: { prompt_tokens: number; completion_tokens: number; prompt_cache_hit_tokens?: number } }
const report = JSON.parse(readFileSync(rawUrl, 'utf8')) as {
  startedAt: string; completedAt: string; wire: Wire[]; rows: Row[]; sourceHashes: Record<string, string>; fixtureSha256: string;
  actualNetworkRequests: number; reservedCny: number; formalFormationEnabledBefore: boolean; formalFormationEnabledAfter: boolean;
  offlineReportRepair: { originalSha256: string };
};
assert.equal(report.rows.length, 12); assert.equal(report.wire.length, report.actualNetworkRequests);
assert.ok(report.wire.length <= 16 && report.reservedCny <= 1);
assert.equal(report.formalFormationEnabledBefore, false); assert.equal(report.formalFormationEnabledAfter, false);
assert.equal(fingerprint(readFileSync(new URL('../tests/fixtures/memory-formation-live.json', import.meta.url), 'utf8')), report.fixtureSha256);
assert.equal(fingerprint(readFileSync(new URL('../docs/evaluations/v2.1b-formation-live.redacted-original.txt', import.meta.url), 'utf8')), report.offlineReportRepair.originalSha256);
// 本轮运行源码各自使用 LF 或 CRLF；只容忍检出换行差异，不容忍内容变化。
for (const [file, hash] of Object.entries(report.sourceHashes)) if (file.startsWith('src/')) {
  const text = readFileSync(file, 'utf8'), lf = text.replace(/\r\n/gu, '\n');
  assert.ok([text, lf, lf.replace(/\n/gu, '\r\n')].some(value => fingerprint(value) === hash), `生产源码不得在验收后修改：${file}`);
}
for (const row of report.rows) { assert.equal(row.unapprovedMemoryUnchanged, true); assert.equal(row.tasksCreated, 0); }
for (const wire of report.wire) {
  assert.equal(wire.httpStatus, 200); assert.equal(wire.finishReason, 'stop');
  if (wire.phase === 'extraction') {
    const proposal = JSON.parse(wire.output) as { candidates: { sourceRunId: string }[] };
    assert.ok(Value.Check(formationSchema, proposal));
    assert.ok(proposal.candidates.every(candidate => candidate.sourceRunId === report.rows.find(row => row.id === wire.caseId)!.sourceRunId));
  }
}
assert.equal(report.wire.filter(wire => wire.caseId === 'F12').length, 0);
const updated = report.rows.find(row => row.id === 'F04')!;
assert.equal(updated.applied?.status, 'applied'); assert.equal(updated.currentMemories?.length, 1);
const record = updated.currentMemories![0]!;
assert.equal(record.id, updated.initialMemories[0]!.id); assert.equal(record.version, 2);
assert.equal(record.content, '我现在主要用TypeScript，Python已经用得少了。'); assert.equal(record.source.reference, updated.approval!.runId);
assert.equal(updated.generation?.tools, 0); assert.equal(updated.generation?.newSession, true); assert.equal(updated.generationMemoryUnchanged, true);
const projection = JSON.parse(updated.generation!.events.find(event => event.type === 'memory_context')!.details) as { hits: { id: string; version: number }[] };
assert.ok(projection.hits.some(hit => hit.id === record.id && hit.version === 2));
const inputTokens = report.wire.reduce((sum, wire) => sum + wire.reportedUsage.prompt_tokens, 0);
const outputTokens = report.wire.reduce((sum, wire) => sum + wire.reportedUsage.completion_tokens, 0);
const timing = report.wire.map(wire => wire.elapsedMs).sort((a, b) => a - b);
const worth = report.rows.filter(row => ['new', 'update'].includes(row.expected));
const accepted = report.rows.filter(row => row.candidatesBeforeApproval.length > 0);
const rawProposals = report.wire.filter(wire => wire.phase === 'extraction').flatMap(wire =>
  (JSON.parse(wire.output) as { candidates: { kind: string }[] }).candidates.map(candidate => ({ caseId: wire.caseId, candidate })));
const useful = rawProposals.filter(proposal => worth.some(row => row.id === proposal.caseId));
const review = {
  reviewedAt: new Date().toISOString(), startedAt: report.startedAt, completedAt: report.completedAt,
  rawReportSha256: fingerprint(readFileSync(rawUrl, 'utf8')), fixtureSha256: report.fixtureSha256,
  network: { requests: report.wire.length, extraction: report.wire.filter(wire => wire.phase === 'extraction').length,
    approval: report.wire.filter(wire => wire.phase === 'approval').length, generation: report.wire.filter(wire => wire.phase === 'generation').length, allHttp200AndStop: true, reservedCny: report.reservedCny,
    inputTokens, outputTokens, cacheReadTokens: report.wire.reduce((sum, wire) => sum + (wire.reportedUsage.prompt_cache_hit_tokens ?? 0), 0),
    estimatedPeakCny: (inputTokens * 2 + outputTokens * 8) / 1_000_000, pricingSource: 'https://www.siliconflow.cn/pricing', ratesCnyPerMillion: { input: 2, output: 8 },
    billingVerified: false, elapsedP50Ms: timing[Math.floor(timing.length / 2)], elapsedMaxMs: Math.max(...timing) },
  metrics: { hostExpectedOutcomes: `${report.rows.filter(row => row.mechanismPass).length}/${report.rows.length}`,
    hostAcceptedValidCandidates: `${accepted.filter(row => row.mechanismPass).length}/${accepted.length}`,
    hostRecallWorthKeeping: `${worth.filter(row => row.candidatesBeforeApproval.length > 0).length}/${worth.length}`,
    rawActionableProposals: rawProposals.length, rawUsefulNovelProposals: `${useful.length}/${rawProposals.length}`,
    rawRecallWorthKeeping: `${worth.filter(row => useful.some(proposal => proposal.caseId === row.id)).length}/${worth.length}`,
    rawInScopeKindCorrect: `${useful.filter(proposal => proposal.candidate.kind === (report.rows.find(row => row.id === proposal.caseId) as Row & { kind: string }).kind).length}/${useful.length}`,
    unauthorizedWrites: 0, intendedApprovedUpdates: 1, prefilteredWithoutNetwork: 1, semanticThresholdMet: false,
    caveat: '8项原始提议包括1项重复和1项第三人称越界；这些是提议策略误差，不把它们都说成虚构事实。样本很小、仅一轮，不估计稳定成功率。' },
  humanReview: [
    { id: 'F01', result: 'FAIL_HOST', reason: '模型正确提取平时偏好；property=平时偏好，宿主只从selfText去掉平时，未对property同步处理，合法事实被拒绝；预定审批/生成不执行。' },
    { id: 'F02', result: 'FAIL_HOST', reason: '模型保留以后做Agent项目的范围；宿主只从selfText剥离以后，property仍含以后，同一归属校验不一致造成漏提。' },
    { id: 'F03', result: 'PASS', reason: '保留Cedar使用Pi SDK且不用LangGraph，Project候选未批准不写入。' },
    { id: 'F04', result: 'PASS', reason: '正确更新候选绑定原ID/v1；模拟显示后真实审批解析授权，原地成为v2，来源为审批Run。新Session回答主要TypeScript、Python用得少，保留限定；回答用了第一人称，表达角度仍可改进。' },
    { id: 'F05', result: 'PASS_HOST_DEDUPE', reason: '模型仍提议重复事实；宿主全文归一化去重，无重复候选或写入。' },
    { id: 'F06', result: 'PASS_HOST_BLOCK_RAW_SCOPE_ERROR', reason: '模型提议小岚的语音偏好，并错误引用用户文字偏好的targetId；宿主因subject非用户拒绝，原用户事实没有被覆盖。' },
    { id: 'F07', result: 'PASS', reason: 'Juniper的SQLite为新项目候选，未引用Cedar记录为更新目标；Cedar原事实未改。' },
    { id: 'F08', result: 'PASS', reason: '否定偏好完整保留，未反转成允许省略错误原因。' },
    { id: 'F09', result: 'PASS', reason: '模型返回空数组，未把设想当决定。' },
    { id: 'F10', result: 'PASS', reason: '模型返回空数组，未保存引用他人的英文偏好。' },
    { id: 'F11', result: 'PASS', reason: '模型返回空数组，未把今天借用Ruby当长期语言偏好。' },
    { id: 'F12', result: 'PASS_HOST_PREFILTER', reason: '虚构密码在宿主预滤，未入队、未发送模型；不能算模型识别敏感信息通过。' },
  ],
  unverified: ['F01的新Session链路未执行，不能手造候选补通过', '没有第二轮、真实飞书、正式用户数据或长期运行', '尚未达到真实precision90%/recall80%门槛', '生产代码保持eabc01d，已发现漏提与模型错误目标均未在本轮修复'],
  reportRepair: '仅修复验收脚本的按值脱敏JSON序列化，原损坏文件Hash保留，付费测试没有重跑；报告中的运行时脚本Hash对应修复前版本。',
};
writeFileSync(new URL('../docs/evaluations/v2.1b-formation-live-review.json', import.meta.url), JSON.stringify(review, null, 2) + '\n');
console.log(JSON.stringify({ network: review.network, metrics: review.metrics }, null, 2));
