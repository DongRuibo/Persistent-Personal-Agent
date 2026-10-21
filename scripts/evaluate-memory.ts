import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { FileMemoryService } from '../src/memory-service.js';
import { parseRewrite, rewritePrompt } from '../src/memory-retriever.js';
import type { ExecutionRequest, MemoryInput } from '../src/contracts.js';

type Sample = { group: string; query: string; expectedKey: string | null };
interface Fixture { version: number; memories: MemoryInput[]; queries: Sample[] }
const live = process.argv.includes('--live');
if (live && !process.argv.includes('--allow-paid')) throw new Error('真实收费评测必须先获用户授权，再显式添加 --allow-paid');
const replayPath = process.argv.find(arg => arg.startsWith('--replay='))?.slice('--replay='.length);
const replay = replayPath ? JSON.parse(readFileSync(replayPath, 'utf8')) as { rewrites: Record<string, unknown> } : undefined;
const rewrites: Record<string, unknown> = {};
const usage = { calls: 0, failures: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, elapsedMs: 0 };
async function rewrite(query: string, signal: AbortSignal): Promise<unknown> {
  if (replay) return parseRewrite(replay.rewrites[query]);
  if (!live) throw new Error('没有启用查询改写');
  if (++usage.calls > 40) throw new Error('本轮最多40次虚构问题改写');
  const started = performance.now();
  try {
    const base = process.env.LLM_BASE_URL;
    const key = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL;
    if (!base || !key || !model || new URL(base).protocol !== 'https:') throw new Error('需要当前 HTTPS 模型环境配置');
    // 只发送固定虚构问题，绝不实例化正式配置中的数据库/Session/Memory。
    const response = await fetch(base.replace(/\/$/u, '') + '/chat/completions', {
      method: 'POST', signal, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: rewritePrompt }, { role: 'user', content: JSON.stringify({ query }) }],
        temperature: 0, max_tokens: 512, enable_thinking: false, stream: false }),
    });
    if (!response.ok) throw new Error('模型改写请求失败（详情省略）');
    const body = await response.json() as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } } };
    usage.inputTokens += body.usage?.prompt_tokens ?? 0;
    usage.outputTokens += body.usage?.completion_tokens ?? 0;
    usage.cacheReadTokens += body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const value = parseRewrite(JSON.parse(body.choices[0]!.message.content)); rewrites[query] = value; return value;
  } catch { usage.failures++; throw new Error('查询改写失败，回退词法'); }
  finally { usage.elapsedMs += performance.now() - started; }
}
async function evaluate(filename: string) {
  const fixture = JSON.parse(readFileSync(new URL(`../tests/fixtures/${filename}`, import.meta.url), 'utf8')) as Fixture;
  const directory = mkdtempSync(join(tmpdir(), 'agent-memory-eval-'));
  const memory = new FileMemoryService(directory);
  const request = (prompt: string): ExecutionRequest => ({ prompt, scope: 'chat', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } });
  try {
    for (const item of fixture.memories) { memory.withRequest(request(`记住：${item.content}`), () => memory.remember(item)); await delay(2); }
    const cases: (Sample & { retrievedKeys: string[]; top1: boolean; recall5: boolean; reciprocalRank: number; evidence: string; evidenceCorrect: boolean; contextHit: boolean; contextKeys: (string | undefined)[]; contextBytes: number; latencyMs: number })[] = [];
    for (const sample of fixture.queries) {
      const started = performance.now();
      const result = await memory.withRequest(request(sample.query), async () => {
        if (live || replay) await memory.prepareRetrieval(rewrite);
        const found = memory.retrieve(sample.query);
        const context = memory.buildContext(2048);
        return { found, context };
      });
      const keys = result.found.records.map(record => record.key);
      const rank = sample.expectedKey === null ? 0 : keys.indexOf(sample.expectedKey) + 1;
      const expected = result.found.records.find(record => record.key === sample.expectedKey);
      cases.push({ ...sample, retrievedKeys: keys, top1: (keys[0] ?? null) === sample.expectedKey,
        recall5: sample.expectedKey === null ? keys.length === 0 : rank > 0,
        reciprocalRank: rank ? 1 / rank : 0, evidence: result.found.evidence,
        evidenceCorrect: sample.expectedKey === null ? result.found.evidence !== 'supported' : result.found.evidence === 'supported' && keys[0] === sample.expectedKey,
        contextHit: sample.expectedKey === null ? !result.context.ids.length : !!expected && result.context.ids.includes(expected.id),
        contextKeys: result.context.ids.map(id => result.found.records.find(record => record.id === id)?.key),
        contextBytes: Buffer.byteLength(result.context.text), latencyMs: performance.now() - started });
    }
    const answerable = cases.filter(c => c.expectedKey !== null); const negative = cases.filter(c => c.expectedKey === null);
    const latency = cases.map(c => c.latencyMs).sort((a, b) => a - b);
    const contextCount = answerable.reduce((sum, c) => sum + c.contextKeys.length, 0);
    const summary = { answerable: answerable.length, top1: answerable.filter(c => c.top1).length / answerable.length,
      recall5: answerable.filter(c => c.recall5).length / answerable.length,
      mrr: answerable.reduce((sum, c) => sum + c.reciprocalRank, 0) / answerable.length,
      negativeCount: negative.length, insufficientEvidenceCorrect: negative.filter(c => c.evidenceCorrect).length,
      supportedCorrect: answerable.filter(c => c.evidenceCorrect).length,
      strictExpectedKeyContextPrecision: contextCount ? answerable.filter(c => c.contextHit).length / contextCount : 0,
      latencyP50Ms: latency[Math.floor(latency.length / 2)], latencyP95Ms: latency[Math.floor(latency.length * 0.95)] };
    const groups = Object.fromEntries([...new Set(cases.map(c => c.group))].map(group => {
      const subset = cases.filter(c => c.group === group);
      return [group, { count: subset.length, top1: subset.filter(c => c.top1).length, recall5: subset.filter(c => c.recall5).length, contextHit: subset.filter(c => c.contextHit).length }];
    }));
    return { fixtureVersion: fixture.version, budgetBytes: 2048, memoryCount: fixture.memories.length, summary, groups, cases };
  } finally { memory.close(); rmSync(directory, { recursive: true, force: true }); }
}
const original = await evaluate('memory-retrieval-eval.json');
const holdout = await evaluate('memory-retrieval-holdout.json');
console.log(JSON.stringify({ mode: live ? 'live-query-rewrite-only' : replay ? 'replay-recorded-query-rewrites' : 'offline-lexical', ...original, holdout,
  usage, rewrites, note: '证据状态是字段启发式，不是生成答案/真实飞书验收；Context precision只计唯一预期key，相关但不含答案的记录会被保守计为非命中。' }, null, 2));
