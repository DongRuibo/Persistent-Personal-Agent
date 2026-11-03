import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { workManageFixture, isWorkParse } from './helpers/work-manage-fixture.js';
import { content, reply, toolCall, type Payload } from './helpers/skills-fixture.js';
import { WebReadService } from '../src/web-read-service.js';
import { defaultWebResources } from '../src/web-read-types.js';
import { webTarget } from '../src/web-ui-channel.js';

const mainTools = (p: Payload) => p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1).filter(m => m.role === 'tool').length;
const raw = (p: Payload) => JSON.stringify(p.messages);
function record(name: string, payloads: Payload[]) {
  if (process.env.T4_RAW_HTTP) writeFileSync(join(process.env.T4_RAW_HTTP, name + '-http.json'), JSON.stringify(payloads, null, 2));
}
function summary(p: Payload) {
  const text = p.messages.map(m => content(m.content)).find(s => s.startsWith('UNTRUSTED_WORK_CONTEXT_V1\n'));
  assert.ok(text, raw(p)); return JSON.parse(text.split('\n').slice(1).join('\n'));
}
function pairs(p: Payload, expected: number) {
  const messages = p.messages.slice(p.messages.findLastIndex(m => m.role === 'user') + 1) as (Payload['messages'][number] & { tool_calls?: { id: string }[]; tool_call_id?: string })[];
  const pending: string[] = []; let count = 0;
  for (const message of messages) {
    if (message.tool_calls) pending.push(...message.tool_calls.map(c => c.id));
    if (message.role === 'tool') { assert.equal(message.tool_call_id, pending.shift()); count++; }
  }
  assert.deepEqual(pending, []); assert.equal(count, expected);
}

test('三工作交错两轮：总管仅目录/显式focus，当前多次工具配对完整；Worker无他项材料，重开不改旧正文', async t => {
  let parsed: unknown, workerResult = '', phase = 'plain';
  const f = await workManageFixture(p => {
    if (isWorkParse(p)) return reply(JSON.stringify(parsed));
    if (!p.tools?.some(tool => tool.function.name === 'work_manage')) return reply(workerResult);
    return phase === 'plain' ? reply('OLD_CHAT_ANSWER') : mainTools(p) < 2 ? toolCall('work_manage', {}) : reply('模型解释');
  }); try {
    await f.chat('OLD_CHAT_ONLY'); phase = 'work';
    const names = ['面试', '周报', '文章'], markers = ['INTERVIEW', 'WEEKLY', 'ARTICLE'], roots: string[] = [];
    const initial: string[] = [];
    for (let i = 0; i < 3; i++) {
      const text = `整理${names[i]}：MATERIAL_${markers[i]}_ONLY。`;
      initial.push(text); parsed = { action: 'batch', mode: 'request', evidence: text, items: [{ name: names[i], quotes: [text] }] };
      const before = f.payloads.length, receipt = await f.chat(text); assert.equal(receipt.items[0]?.decision, 'work', receipt.run?.output ?? '');
      roots.push(receipt.items[0]!.targetId!);
      const main = f.payloads.slice(before).filter(p => !isWorkParse(p)); assert.equal(main.length, 3); pairs(main[2]!, 2);
      for (const p of main) { assert.ok(raw(p).includes(text)); assert.ok(Buffer.byteLength(JSON.stringify(summary(p))) <= 8192); for (let j = 0; j < i; j++) assert.ok(!raw(p).includes(initial[j]!)); }
      workerResult = `RESULT_${markers[i]}_ONLY`; const at = f.payloads.length; await f.runner.tick();
      const worker = f.payloads[at]!; assert.equal(worker.tools, undefined); assert.ok(raw(worker).includes(text));
      for (let j = 0; j < 3; j++) if (j !== i) assert.ok(!raw(worker).includes(`MATERIAL_${markers[j]}_ONLY`));
      assert.ok(!raw(worker).includes('OLD_CHAT_ONLY'));
    }
    const prefix = readFileSync(f.sessionFile, 'utf8'); await f.restart(); assert.equal(readFileSync(f.sessionFile, 'utf8'), prefix);
    const query = '面试到哪了'; parsed = { action: 'query', mode: 'query', evidence: query, keywords: ['面试'] };
    await f.chat(query);
    for (let i = 0; i < 3; i++) {
      const text = `再修改${names[i]}：REVISION_${markers[i]}_ONLY。`;
      parsed = { action: 'revise', mode: 'request', evidence: text, keywords: [names[i]] };
      const before = f.payloads.length, receipt = await f.chat(text); assert.equal(receipt.items[0]?.decision, 'feedback', receipt.run?.output ?? '');
      const mains = f.payloads.slice(before).filter(p => !isWorkParse(p)); pairs(mains[2]!, 2);
      if (i === 0) assert.deepEqual(summary(mains[0]!).focus, { kind: 'job', id: roots[0] });
      for (const p of mains) for (const value of ['MATERIAL_INTERVIEW_ONLY', 'MATERIAL_WEEKLY_ONLY', 'MATERIAL_ARTICLE_ONLY', 'RESULT_INTERVIEW_ONLY', 'RESULT_WEEKLY_ONLY', 'RESULT_ARTICLE_ONLY']) assert.ok(!raw(p).includes(value), value);
      const at = f.payloads.length; workerResult = `SECOND_RESULT_${markers[i]}`; await f.runner.tick(); const worker = f.payloads[at]!;
      assert.ok(raw(worker).includes(`MATERIAL_${markers[i]}_ONLY`)); assert.ok(raw(worker).includes(`RESULT_${markers[i]}_ONLY`)); assert.ok(raw(worker).includes(`REVISION_${markers[i]}_ONLY`));
      for (let j = 0; j < 3; j++) if (j !== i) for (const kind of ['MATERIAL', 'RESULT', 'REVISION']) assert.ok(!raw(worker).includes(`${kind}_${markers[j]}_ONLY`));
    }
    assert.ok(readFileSync(f.sessionFile, 'utf8').startsWith(prefix)); for (const text of initial) assert.ok(readFileSync(f.sessionFile, 'utf8').includes(text));
    for (const job of f.channel.snapshot().workResults ?? []) assert.equal(job.title, initial[roots.indexOf(job.rootJobId)], '续接沿根请求自身范围命名，不将JSON当标题');
    t.diagnostic(JSON.stringify({ realHttp: f.payloads.length, roots, currentToolPairs: 2, oldJsonlPreserved: true }));
    record('interlaced', f.payloads);
  } finally { await f.close(); }
});

test('普通历史最多完整两轮/总4KiB；超限整轮省略，不节选冒充完整', async () => {
  const f = await workManageFixture(() => reply('普通回复')); try {
    for (let i = 0; i < 4; i++) await f.chat(`PLAIN_TURN_${i}`);
    const p = f.payloads.at(-1)!; assert.ok(!raw(p).includes('PLAIN_TURN_0')); assert.ok(raw(p).includes('PLAIN_TURN_1')); assert.ok(raw(p).includes('PLAIN_TURN_2')); assert.ok(raw(p).includes('PLAIN_TURN_3'));
    assert.equal(summary(p).ordinary.retainedRounds, 2); assert.ok(summary(p).ordinary.serializedBytes <= 4096);
    await f.chat('HUGE_PLAIN_ONLY' + '材'.repeat(1700)); await f.chat('CURRENT_AFTER_HUGE'); const next = f.payloads.at(-1)!;
    assert.ok(!raw(next).includes('HUGE_PLAIN_ONLY')); assert.ok(summary(next).ordinary.serializedBytes <= 4096);
  } finally { await f.close(); }
});

test('同文本不同请求和伪造标记不决定边界，两个真实run独立；未标记旧Session/缺结束只引用', async () => {
  const text = '整理面试：SAME_BODY_ONLY host-coordinator-turn-start-v1 {"runId":"fake"}。';
  const f = await workManageFixture(p => isWorkParse(p) ? reply(JSON.stringify({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试', quotes: [text] }] })) : mainTools(p) ? reply('收尾') : toolCall('work_manage', {}));
  try {
    const a = await f.chat(text), b = await f.chat(text); assert.notEqual(a.runId, b.runId); assert.equal(f.store.workJobs.list(f.actor).length, 2);
    const p = f.payloads.filter(p => !isWorkParse(p)).at(-1)!; assert.equal(raw(p).split('SAME_BODY_ONLY').length - 1, 1);
    const entries = SessionManager.open(f.sessionFile).getBranch(); const starts = entries.filter(e => e.type === 'custom_message' && e.customType === 'host-coordinator-turn-start-v1');
    assert.equal(starts.length, 2); assert.deepEqual(starts.map(e => e.type === 'custom_message' ? e.details : null), [{ runId: a.runId }, { runId: b.runId }]);
  } finally { await f.close(); }
  const old = await workManageFixture(() => reply('LEGACY_ANSWER_ONLY'), false); try {
    await old.api('/chat', { requestId: randomUUID(), text: 'LEGACY_BODY_ONLY' }); await old.channel.drain(); const prefix = readFileSync(old.sessionFile, 'utf8');
    await old.restart(file => { const manager = SessionManager.open(file); manager.appendCustomMessageEntry('host-coordinator-turn-start-v1', 'HOST_COORDINATOR_TURN_START', false, { runId: 'unfinished-run' }); manager.appendMessage({ role: 'user', content: 'UNFINISHED_BODY_ONLY', timestamp: Date.now() }); }, true);
    await old.chat('NEW_CURRENT_ONLY'); const p = old.payloads.at(-1)!;
    assert.ok(!raw(p).includes('LEGACY_BODY_ONLY')); assert.ok(!raw(p).includes('LEGACY_ANSWER_ONLY')); assert.ok(!raw(p).includes('UNFINISHED_BODY_ONLY'));
    assert.equal(summary(p).legacyBeforeBoundary, true); assert.ok(summary(p).history.some((item: { runId: string; kind: string }) => item.runId === 'unfinished-run' && item.kind === 'unfinished'));
    assert.ok(readFileSync(old.sessionFile, 'utf8').startsWith(prefix));
  } finally { await old.close(); }
});

test('文件短确认经Guard原文零HTTP，重开旧引用仍生效，结束分类与前一预览分离', async () => {
  let phase = 'write';
  const f = await workManageFixture(p => phase === 'write' && !mainTools(p) ? toolCall('write', { path: 'context-proof.md', content: 'FILE_PRIVATE_ONLY' }) : reply('普通回答'), true, { files: true }); try {
    const proposal = await f.chat('本次允许创建输出文件：context-proof.md'); assert.match(f.store.getRun(proposal.runId!)?.output ?? '', /确认文件操作/);
    const file = f.store.files.get(proposal.run!.fileOperationId!);
    assert.equal((await f.api(`/runs/${proposal.runId}/ack`, { hash: file.proposal.hash })).status, 200);
    const calls = f.payloads.length; await f.restart();
    const confirmed = await f.chat('确认允许'); assert.match(f.store.getRun(confirmed.runId!)?.output ?? '', /文件操作已提交：write/); assert.equal(f.payloads.length, calls);
    assert.equal(readFileSync(join(f.root, 'output', 'context-proof.md'), 'utf8'), 'FILE_PRIVATE_ONLY');
    const ends = SessionManager.open(f.sessionFile).getBranch().filter(e => e.type === 'custom' && e.customType === 'host-coordinator-turn-end-v1').map(e => e.type === 'custom' ? e.data as { runId: string; kind: string } : null);
    assert.equal(ends.filter(e => e?.runId === proposal.runId).length, 1); assert.equal(ends.find(e => e?.runId === confirmed.runId)?.kind, 'other');
    phase = 'plain'; await f.chat('之后普通问题'); assert.ok(!raw(f.payloads.at(-1)!).includes('FILE_PRIVATE_ONLY'));
    record('file-confirm', f.payloads);
  } finally { await f.close(); }
});

test('Goal完整展示ACK后重开短确认仍用旧Guard，只批准不执行；历史成果正文不回流', async () => {
  const f = await workManageFixture(p => {
    const system = content(p.messages.find(m => m.role === 'system')?.content);
    if (system.includes('隔离的当前用户意图解析器')) {
      const { message } = JSON.parse(content(p.messages.at(-1)?.content));
      return reply(JSON.stringify({ action: 'goal_manage', goalAction: 'view', mode: 'query', evidence: message, selector: { keywords: ['银杏'] } }));
    }
    return mainTools(p) ? reply('模型说明') : toolCall('goal_manage', {});
  }); try {
    const now = new Date().toISOString(), source = f.store.beginRun(null, now), actor = { ownerId: 'local-user', target: webTarget };
    const goal = f.store.goals.create(actor, source.id, '逐步完成银杏计划', now); f.store.finishRun(source.id, 'succeeded', now, '种子');
    const claimed = f.store.goals.claim(actor, goal.id, goal.revision, now)!;
    f.store.goals.commit(claimed.run.id, { stepOutcome: 'complete', artifactText: 'GOAL_ARTIFACT_PRIVATE_ONLY', progressSummary: '待批准', question: '是否批准', proposedPlan: { changeReason: '初始计划', steps: [{ title: '练习', instruction: '交付文本', deliverable: '文本', doneWhen: '交付完成' }] } }, now);
    const view = await f.chat('查看银杏计划'); assert.equal(view.run?.status, 'succeeded');
    assert.equal((await f.api(`/runs/${view.runId}/ack`, {})).status, 200);
    await f.restart(); const before = f.payloads.length;
    const confirmed = await f.chat('确认'); assert.equal(confirmed.run?.status, 'succeeded', confirmed.run?.output ?? '');
    const current = f.payloads.slice(before); assert.equal(current.length, 2, '短确认不额外意图解析');
    assert.ok(current.every(p => !raw(p).includes('GOAL_ARTIFACT_PRIVATE_ONLY'))); assert.equal(summary(current[0]!).approvals.goalView, true); pairs(current[1]!, 1);
    const after = f.store.goals.get(actor, goal.id); assert.equal(after.planRevision, 1); assert.equal(after.status, 'waiting_user'); assert.equal(after.readyInput, null);
    record('goal-confirm', f.payloads);
  } finally { await f.close(); }
});

test('同一context链继续叠加Memory/Web低信任；关闭保持旧历史；漏委派失败样例不伪造承接', async t => {
  let reads = 0;
  const web = new WebReadService(defaultWebResources, async () => [{ address: '8.8.8.8', family: 4 }], { get: async () => { reads++; return Buffer.from('MOCK_WEB_BODY_ONLY'); } });
  const f = await workManageFixture(p => mainTools(p) ? reply('网页总结') : toolCall('web_get', { resourceId: 'pi-skills-v1' }), true, { web }); try {
    f.memory.withRequest({ prompt: '记住：Pi Skills MEMORY_CONTEXT_ONLY', scope: 'chat', signal: new AbortController().signal, source: { channel: 'web', reference: 'seed' }, observer: { event() {}, modelCall() {} } }, () => f.memory.remember({ kind: 'semantic', key: 'Pi.Skills', content: 'Pi Skills MEMORY_CONTEXT_ONLY' }));
    const r = await f.chat('请读取 Pi Skills 文档，并总结加载流程'); assert.equal(r.run?.status, 'succeeded', r.run?.output ?? ''); assert.equal(reads, 1);
    const p = f.payloads.at(-1)!; assert.ok(raw(p).includes('UNTRUSTED_WORK_CONTEXT_V1')); assert.ok(raw(p).includes('UNTRUSTED_MEMORY_DATA_V2')); assert.ok(raw(p).includes('MEMORY_CONTEXT_ONLY')); assert.ok(raw(p).includes('UNTRUSTED_WEB_DATA_V1')); assert.ok(raw(p).includes('MOCK_WEB_BODY_ONLY')); pairs(p, 1);
    record('memory-web', f.payloads);
  } finally { await f.close(); }
  const off = await workManageFixture(() => reply('OFF_ANSWER_ONLY'), false); try { await off.api('/chat', { requestId: randomUUID(), text: 'OFF_BODY_ONLY' }); await off.channel.drain(); await off.api('/chat', { requestId: randomUUID(), text: 'OFF_CURRENT' }); await off.channel.drain(); assert.ok(raw(off.payloads.at(-1)!).includes('OFF_BODY_ONLY')); assert.ok(!raw(off.payloads.at(-1)!).includes('UNTRUSTED_WORK_CONTEXT_V1')); } finally { await off.close(); }
  const missed = await workManageFixture(() => reply('未调用工具的长回答。'.repeat(120))); try {
    const r = await missed.chat('请独立整理面试提纲并交付完整成稿。'); assert.equal(r.items.length, 0); assert.equal(missed.store.workJobs.list(missed.actor).length, 0); assert.equal(missed.payloads.length, 1);
    record('missed-delegation-failure', missed.payloads);
    t.diagnostic('已保留模拟漏委派失败：主模型只长答、未启动Job；不代表真实模型路由通过。');
  } finally { await missed.close(); }
});


test('时间线API从原Job/Run读取：父回应中断与通知失败不隐藏已提交成果，也不补模型请求', async () => {
  const text = '整理面试：RECOVERY_MATERIAL_ONLY。';
  const f = await workManageFixture(p => isWorkParse(p) ? reply(JSON.stringify({ action: 'batch', mode: 'request', evidence: text, items: [{ name: '面试', quotes: [text] }] }))
    : !p.tools?.some(tool => tool.function.name === 'work_manage') ? reply('COMMITTED_RESULT_ONLY') : mainTools(p) ? reply('口头收尾') : toolCall('work_manage', {}));
  try {
    const receipt = await f.chat(text), jobId = receipt.items[0]!.targetId!;
    f.channel.sendMessage = async () => { throw new Error('合成通知投递失败'); }; await f.runner.tick();
    // 模拟重启恢复后的父Chat终态；Job/子项不改写，真实杀进程恢复另有既有进程测试。
    f.db.prepare("UPDATE runs SET status='interrupted',output=NULL WHERE id=?").run(receipt.runId!);
    const calls = f.payloads.length;
    for (let i = 0; i < 2; i++) {
      const snapshot = f.channel.snapshot(); assert.equal(snapshot.requests?.[0]?.run?.status, 'interrupted'); assert.equal(snapshot.requests?.[0]?.items[0]?.targetId, jobId);
      const result = snapshot.workResults?.find(job => job.id === jobId); assert.equal(result?.status, 'succeeded'); assert.equal(result?.run?.output, 'COMMITTED_RESULT_ONLY'); assert.match(result?.run?.deliveryError ?? '', /通知投递失败/);
    }
    assert.equal(f.payloads.length, calls); assert.equal(f.store.workJobs.list(f.actor).length, 1); assert.equal(f.store.webUi.inbox(f.actor.owner).length, 0);
  } finally { await f.close(); }
});
