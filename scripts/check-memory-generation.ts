import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readConfig, redactor } from '../src/config.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { FileMemoryService } from '../src/memory-service.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import type { ExecutionRequest, MemoryInput, ModelCall } from '../src/contracts.js';

// 必须获得用户对此轮预算与虚构正文发送的明确授权，才可传入此参数联网。
if (!process.argv.includes('--allow-paid')) throw new Error('需要用户另行授权真实生成测试，再显式使用 --allow-paid；未读取密钥或创建数据');
const baseUrl = process.env.LLM_BASE_URL;
if (!baseUrl || new URL(baseUrl).origin !== 'https://api.siliconflow.cn' || process.env.LLM_MODEL !== 'deepseek-ai/DeepSeek-V4.1-Flash') throw new Error('此验收预算仅覆盖硅基流动 DeepSeek-V4.1-Flash');
const root = mkdtempSync(join(tmpdir(), 'memory-generation-'));
const config = readConfig({ DATABASE_PATH: join(root, 'task.db'), SESSION_DIR: join(root, 'sessions'), MEMORY_DIR: join(root, 'memory'),
  LLM_PROVIDER: process.env.LLM_PROVIDER, LLM_MODEL: process.env.LLM_MODEL, LLM_API_KEY: process.env.LLM_API_KEY, LLM_BASE_URL: baseUrl });
const redact = redactor(config.apiKey);
const memory = new FileMemoryService(config.memoryDir, [config.apiKey]);
const store = new SqliteStore(config.databasePath); const tasks = new TaskService(store, config.timeZone);
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/memory-retrieval-holdout.json', import.meta.url), 'utf8')) as { memories: MemoryInput[] };
const questions = ['阿青每个月电话费用多少钱？', 'Nacre 下一次正式发布日期是什么？', '阿青喜欢哪种联系方法，不是阿白？', 'Nacre 的界面语言是什么？'];
const calls: ModelCall[] = []; const outcomes: unknown[] = [];
const request = (prompt: string): ExecutionRequest => ({ prompt, scope: 'task', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } });
const startedAt = new Date().toISOString();
const network: { question: string; rewrite: boolean; phase: 'generation' | 'rewrite'; bodyBytes: number; maxOutputTokens: number; context: string[]; reservedCNY: number }[] = [];
let active: { question: string; rewrite: boolean } | undefined;
const nativeFetch = globalThis.fetch; let reservedCNY = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (!active || url.origin !== 'https://api.siliconflow.cn' || !url.pathname.endsWith('/chat/completions') || network.length >= 12) throw new Error('生成验收端点或12请求预算超限');
  const body = String(init?.body ?? '');
  const payload = JSON.parse(body) as { model: string; max_tokens: number; enable_thinking?: boolean; tools?: unknown[]; messages: { role: string; content: string | { type: string; text?: string }[] }[] };
  const phase = JSON.stringify(payload.messages.filter(m => m.role === 'system')).includes('只读检索查询改写器') ? 'rewrite' : 'generation';
  const limit = phase === 'rewrite' ? 512 : 4096;
  const bodyBytes = Buffer.byteLength(body);
  if (payload.model !== config.model || payload.enable_thinking !== false || payload.tools?.length || bodyBytes > 16384 ||
    !Number.isSafeInteger(payload.max_tokens) || payload.max_tokens < 1 || payload.max_tokens > limit ||
    network.filter(call => call.phase === phase).length >= (phase === 'rewrite' ? 4 : 8)) throw new Error('生成验收请求格式或Token预算超限');
  // 按UTF-8字节+512作为保守输入预算，输出按实际请求上限，使用当前核对的高峰单价。
  const reservation = ((bodyBytes + 512) * 2 + payload.max_tokens * 8) / 1_000_000;
  if (reservedCNY + reservation > 1) throw new Error('生成验收1元预算超限');
  reservedCNY += reservation;
  const context = payload.messages.filter(m => m.role === 'user').flatMap(m => typeof m.content === 'string' ? [m.content] : m.content.filter(p => p.type === 'text').map(p => p.text ?? ''))
    .filter(text => text.startsWith('[UNTRUSTED_MEMORY_DATA_V2]'));
  network.push({ ...active, phase, bodyBytes, maxOutputTokens: payload.max_tokens, context, reservedCNY: reservation });
  return nativeFetch(input, init);
};
try {
  for (const item of fixture.memories) memory.withRequest({ ...request(`记住：${item.content}`), scope: 'chat' }, () => memory.remember(item));
  const fictionalMemories = memory.listForHost();
  const digest = () => createHash('sha256').update(JSON.stringify(memory.listForHost().map(r => [r.id, r.version, r.hash]).sort())).digest('hex');
  const beforeHash = digest();
  for (const rewrite of [false, true]) {
    const executor = await createPiExecutor({ ...config, memoryQueryRewrite: rewrite }, tasks, `isolated-${rewrite}`, memory);
    try {
      for (const question of questions) {
        const events: { type: string; details?: string }[] = []; const usage: ModelCall[] = [];
        const started = performance.now(); active = { question, rewrite };
        const current = request(question);
        current.observer = { event(type, details) { if (['memory_context', 'memory_rewrite'].includes(type)) events.push({ type, details }); }, modelCall(call) { calls.push(call); usage.push(call); } };
        // task scope每次创建全新临时Pi Session，工具列表为空；不用真实Task或交互历史。
        try { const answer = await executor.execute(current); outcomes.push({ question, rewrite, answer: redact(answer.text), events, usage, elapsedMs: performance.now() - started }); }
        catch { outcomes.push({ question, rewrite, error: '模型或执行中断，详情省略', events, usage, elapsedMs: performance.now() - started }); }
        finally { active = undefined; }
        process.stderr.write(`已完成虚构生成验收 ${outcomes.length}/8；请求=${network.length}/12\n`);
      }
    } finally { await executor.close(); }
  }
  if (store.listTasks().length || memory.listForHost().length !== fixture.memories.length || digest() !== beforeHash) throw new Error('只读验收出现意外写入');
  console.log(JSON.stringify({ startedAt, completedAt: new Date().toISOString(), model: config.model, providerOrigin: 'https://api.siliconflow.cn', mode: 'real-readonly-pi-generation', networkCalls: network.length,
    reservedCNY, budgetCNY: 1, fictionalMemories, memoryUnchanged: true, tasksCreated: 0, network,
    inputTokens: calls.reduce((sum, c) => sum + c.inputTokens, 0), outputTokens: calls.reduce((sum, c) => sum + c.outputTokens, 0), outcomes,
    note: '固定虚构Memory正文已发送给真实模型；需要人工核对回答的主体/字段/未知表达，不是飞书验收。失败用量可能缺失。' }, null, 2));
} finally { globalThis.fetch = nativeFetch; memory.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
