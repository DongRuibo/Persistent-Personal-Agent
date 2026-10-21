import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPiExecutor } from '../src/pi-executor.js';
import { FeishuChannel } from '../src/feishu-channel.js';
import { formationHarness } from './helpers/formation.js';
import { sseText } from './helpers/intent-stub.js';

interface Payload { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[]; max_completion_tokens?: number }
const content = (value: unknown) => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => (part as { text?: string }).text ?? '').join('') : JSON.stringify(value);
const reply = (value: string) => new Response(sseText(value), { headers: { 'Content-Type': 'text/event-stream' } });

test('真实 Pi SDK+模拟模型/飞书：新聊天入队、隔离提取、候选审批、跨 Session 检索、更新删除隔离', async t => {
  const h = formationHarness(); let nextTool = false; let extractionCalls = 0; let projection = ''; let attack = false;
  const payloads: Payload[] = [], sent: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as Payload; payloads.push(payload);
    const system = content(payload.messages.find(message => message.role === 'system')?.content);
    if (system.includes('无工具的只读记忆候选提取器')) {
      extractionCalls++; assert.equal(payload.tools?.length ?? 0, 0); assert.equal(payload.max_completion_tokens, 512);
      const data = JSON.parse(content(payload.messages.find(message => message.role === 'user')?.content)) as { sources: { runId: string; text: string }[] };
      assert.equal(data.sources.length, 1); assert.equal(payload.messages.length, 2, '无历史、Session或工具结果');
      const source = data.sources[0]!;
      return reply(JSON.stringify({ candidates: [{ sourceRunId: source.runId, quote: source.text, kind: 'semantic', mode: 'asserted', durable: true, subject: '用户', property: '喜欢', value: '中文', content: '扩大后的候选正文不能执行' }] }));
    }
    if (system.includes('隔离的当前用户意图解析器')) {
      assert.ok(!JSON.stringify(payload).includes('扩大后的候选正文'));
      const { message } = JSON.parse(content(payload.messages.findLast(message => message.role === 'user')?.content)) as { message: string };
      if (message.includes('建议记住')) return reply(JSON.stringify({ action: 'memory_review', mode: 'query', evidence: message, review: 'list' }));
      if (message.includes('第一条')) return reply(JSON.stringify({ action: 'memory_review', mode: 'request', evidence: message, review: 'approve', selector: { reference: 'choice', position: 1, keywords: [] } }));
      return reply(JSON.stringify({ action: 'none', mode: 'query', evidence: message }));
    }
    const contexts = payload.messages.filter(message => content(message.content).includes('[UNTRUSTED_MEMORY_DATA_V2]'));
    projection = contexts.map(message => content(message.content)).join('');
    assert.ok(contexts.length <= 1);
    const lastUser = payload.messages.findLastIndex(message => message.role === 'user');
    const toolAlready = payload.messages.slice(lastUser + 1).some(message => message.role === 'tool');
    if ((nextTool || attack) && !toolAlready) {
      const name = attack ? 'memory_remember' : 'memory_review';
      const args = attack ? { kind: 'semantic', key: 'attack', content: '越权推断' } : {};
      const choice = { index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'review-tool', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' };
      return new Response(`data: ${JSON.stringify({ id: 'review', model: 'stub', choices: [choice] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
    }
    return reply(projection.includes('我喜欢中文回答') ? '本轮长期记忆记载你喜欢中文回答。' : '普通对话回复');
  });
  let executor = await createPiExecutor(h.config, h.tasks, 'feishu-test', h.memory, h.formation);
  let feishu = new FeishuChannel({ appId: 'cli_0123456789abcdef', appSecret: 'fake-secret', allowedOpenId: 'ou_owner' },
    { start: async () => {}, stop() {}, sendText: async (_chat, text) => { sent.push(text); } }, executor, h.tasks, h.store, String, error => { throw error; }, h.formation);
  const message = (id: string, text: string, owner = 'ou_owner') => ({ sender: { sender_type: 'user', sender_id: { open_id: owner } },
    message: { message_id: id, chat_id: 'oc_private', chat_type: 'p2p', message_type: 'text', content: JSON.stringify({ text }) } });
  try {
    feishu.receive(message('unauthorized', '我喜欢中文回答', 'ou_attacker')); await feishu.drain(); assert.equal(h.store.listRuns().length, 0);
    feishu.receive(message('source', '我喜欢中文回答')); feishu.receive(message('source', '我喜欢中文回答'));
    await feishu.drain(); assert.equal(sent.length, 1); assert.equal(h.store.formation.jobs().length, 1);
    h.advance(10001); await h.formation.tick(); assert.equal(extractionCalls, 1); assert.equal(h.memory.listForHost().length, 0);
    assert.ok(!projection.includes('我喜欢中文回答'), '未批准的内容不是 Memory Context');
    nextTool = true; feishu.receive(message('view', '有什么建议记住的吗？')); await feishu.drain();
    assert.match(sent.at(-1)!, /待审候选.*|我喜欢中文回答/s);
    const reviewPayload = payloads.findLast(payload => payload.messages.some(message => message.role === 'tool'))!;
    assert.ok(reviewPayload.messages.filter(message => message.role === 'tool').every(message => !content(message.content).includes('我喜欢中文回答')), '工具正文只含收据');
    feishu.receive(message('approve', '第一条记下来')); await feishu.drain(); assert.equal(h.memory.listForHost().length, 1);
    const record = h.memory.listForHost()[0]!; assert.equal(record.source.reference, h.store.listRuns().find(run => run.output?.includes('已按你批准'))?.id);
    assert.equal(record.content, '我喜欢中文回答'); assert.equal(record.version, 1);
    const sourceRun = h.store.formation.jobs()[0]!.runId;
    assert.ok(h.store.modelCalls(sourceRun).some(call => call.purpose === 'memory_formation' && call.jobId));
    await feishu.stop(); await executor.close(); nextTool = false;
    executor = await createPiExecutor(h.config, h.tasks, 'brand-new-session', h.memory, h.formation);
    assert.match((await executor.execute(h.request('我偏好什么回答语言？'))).text, /长期记忆/);
    assert.ok(projection.includes('我喜欢中文回答')); assert.ok(projection.includes('"version":1'));
    const task = h.request('我喜欢什么回答？'); task.scope = 'task';
    await executor.execute(task); assert.equal(payloads.at(-1)?.tools?.length ?? 0, 0);
    attack = true;
    await assert.rejects(executor.execute(h.request('你好，请介绍一下')), /工具执行错误/); attack = false;
    assert.equal(h.memory.listForHost().length, 1); assert.equal(h.tasks.list().length, 0);
    const req = h.request('测试明确更新');
    h.memory.withRequest(req, () => h.memory.update(record.id, '我喜欢德语回答', 1), { tool: 'memory_update', args: { id: record.id, content: '我喜欢德语回答', expectedVersion: 1 } });
    await executor.execute(h.request('我喜欢什么回答？')); assert.ok(!projection.includes('我喜欢中文回答'));
    h.memory.withRequest(req, () => h.memory.forget(record.id, 2), { tool: 'memory_forget', args: { id: record.id, expectedVersion: 2 } });
    await executor.execute(h.request('我喜欢什么回答？')); assert.ok(!projection.includes('我喜欢德语回答')); assert.ok(!projection.includes('我喜欢中文回答'));
    const sessionDirs = readdirSync(h.config.sessionDir);
    for (const directory of sessionDirs) {
      const session = readFileSync(join(h.config.sessionDir, directory, 'chat.session.jsonl'), 'utf8');
      assert.ok(!session.includes('[UNTRUSTED_MEMORY_DATA_V2]')); assert.ok(!session.includes('扩大后的候选正文'));
    }
  } finally { await feishu.stop(); await executor.close(); await h.close(); }
});
