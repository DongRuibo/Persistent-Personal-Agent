import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { independentAudit, independentState, naturalPauseState } from '../scripts/independent-console-acceptance.js';
import { digest } from '../scripts/independent-console-budget.js';
import { stagedModel } from '../scripts/staged-console-cases.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import type { Payload } from './helpers/skills-fixture.js';

const partial = JSON.parse(readFileSync('tests/fixtures/natural-pause-bootstrap-partial.json', 'utf8')).result;

for (const outcome of ['partial', 'complete'] as const) test(`自然暂停实际Console：bootstrap ${outcome}与草稿生成解耦，三次自然语言且不新建Execution/Checkpoint`, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'natural-pause-')), root = join(parent, 'round'), preload = join(parent, 'mock-fetch.mjs');
  console.log(JSON.stringify({ offlineFixtureRoot: root, outcome }));
  const payloads: Payload[] = [], errors: unknown[] = []; let wrongTarget = false;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); let raw = ''; for await (const part of req) raw += part;
      const p = JSON.parse(raw) as Payload; payloads.push(p); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const system = content(p.messages.find(m => m.role === 'system')?.content), user = content(p.messages.findLast(m => m.role === 'user')?.content);
      assert.ok(!p.tools?.some(t => ['read', 'web_get'].includes(t.function.name)));
      if (system.includes('隔离的当前用户意图解析器')) {
        const { message } = JSON.parse(user), action = message.startsWith('查看') ? 'view' : message.startsWith('暂停') ? 'pause' : 'create';
        res.end(reply(JSON.stringify({ action: 'goal_manage', mode: action === 'view' ? 'query' : 'request', evidence: message, goalAction: action,
          ...(action === 'create' ? {} : { selector: { keywords: action === 'pause' ? [wrongTarget ? '错误具名目标' : '学习计划'] : ['青桐'] } }) }))); return;
      }
      if (system.includes('有界纯文本片段')) {
        assert.equal(p.tools?.length ?? 0, 0);
        const snapshot = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!); assert.equal(snapshot.plan.revision, 0);
        res.end(reply(JSON.stringify(outcome === 'partial' ? partial : { stepOutcome: 'complete', artifactText: '仅依据已提供资料的待批准阅读安排', progressSummary: '提出初步草稿', question: '请确认初步安排',
          proposedPlan: { changeReason: '依据本轮有限资料，不虚构篇目或时间', steps: [{ title: '阅读并梳理职责', instruction: '阅读用户提供的虚构资料，区分宿主和Pi职责；具体时间待用户另行确定', deliverable: '职责梳理', doneWhen: '文字梳理交付，等待用户核对' }] } }))); return;
      }
      const index = p.messages.findLastIndex(m => m.role === 'user'), tools = p.messages.slice(index + 1).filter(m => m.role === 'tool');
      if (!tools.length) { res.end(toolCall('goal_manage', {})); return; }
      res.end(reply('仅以宿主本次真实操作结果为准；未执行时不声称已经暂停。'));
    } catch (error) { errors.push(error); res.end(reply('offline fixture assertion failed')); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  // 模拟模型只连接本机；固定官方地址是待检验元数据，不进行公网DNS或HTTP。
  writeFileSync(preload, `const native=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!==${JSON.stringify(stagedModel.endpoint)})throw new Error('unexpected URL');return native(${JSON.stringify(`http://127.0.0.1:${addr.port}/model`)},init)};`);
  const checkedAt = new Date().toISOString(), baseline = process.env.NATURAL_PAUSE_BASELINE === '1';
  async function cli(id: 'N1' | 'N2' | 'N3', target = root, expectedCode = 0) {
    const entry = baseline ? 'scripts/independent-console-acceptance.ts' : 'scripts/natural-pause-console-acceptance.ts';
    const mapped = baseline ? id.replace('N', 'P') : id, resume = id !== 'N1';
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, entry, '--authorized', '--rates-confirmed', '--case=' + mapped, '--root=' + target,
      ...(resume ? ['--resume', '--previous-reviewed'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LLM_API_KEY: 'offline-only-fixture-key', LLM_MODEL: stagedModel.model, LLM_BASE_URL: 'https://api.siliconflow.cn/v1', LLM_PROVIDER: 'personal-compatible',
      ACCEPTANCE_INPUT_RATE: '2', ACCEPTANCE_OUTPUT_RATE: '8', ACCEPTANCE_CACHE_READ_RATE: '0.04', ACCEPTANCE_EXTRA_FEES_CNY: '0', ACCEPTANCE_PRICE_CHECKED_AT: checkedAt } });
    let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; }); child.stdin.end('不应消费这条额外stdin\n');
    const [code] = await once(child, 'exit'); assert.equal(code, expectedCode, id + '\n' + out); return out;
  }
  try {
    await cli('N1'); const initial = independentAudit(join(root, 'P'));
    assert.equal(initial.goals.length, 1); assert.equal(initial.goals[0]!.status, 'waiting_user'); assert.equal(initial.executions.length, 1);
    assert.equal(JSON.parse(String(initial.executions[0]!.checkpointJson)).stepOutcome, outcome);
    assert.equal(!!initial.goals[0]!.pendingActionJson, outcome === 'complete');
    if (outcome === 'partial') assert.equal(independentState('P1', initial), false, '旧P1草稿指标继续失败，不追改历史预期');
    await cli('N2'); const viewed = independentAudit(join(root, 'P')); assert.equal(viewed.references!.goalView!.items.length, 1);
    assert.equal(viewed.references!.goalView!.displayRunId, viewed.foreground.at(-1)!.id);
    if (outcome === 'partial') for (const cause of ['expired', 'delivery', 'foreign', 'channel', 'revision', 'multiple', 'cancelled', 'completed', 'old-run', 'draft', 'uncertain', 'control', 'checkpoint-plan']) {
      const a = structuredClone(viewed), v = a.references!.goalView!, goal = a.goals[0]!;
      if (cause === 'expired') v.expires = Date.now() - 1;
      if (cause === 'delivery') a.events = a.events.filter(e => e.runId !== v.displayRunId);
      if (cause === 'foreign') goal.ownerId = 'foreign';
      if (cause === 'channel') goal.targetJson = '{"channel":"feishu"}';
      if (cause === 'revision') goal.revision = Number(goal.revision) + 1;
      if (cause === 'multiple') a.goals.push({ ...goal, id: 'another-goal' });
      if (cause === 'cancelled' || cause === 'completed') goal.status = cause;
      if (cause === 'old-run') v.displayRunId = String(a.foreground[0]!.id);
      if (cause === 'draft') v.items[0]!.draftHash = '0'.repeat(64);
      if (cause === 'uncertain') a.executions[0]!.status = 'uncertain';
      if (cause === 'control') goal.controlRequested = 'cancel';
      if (cause === 'checkpoint-plan') {
        const cp = JSON.parse(String(a.executions[0]!.checkpointJson)); cp.stepOutcome = 'complete';
        a.executions[0]!.checkpointJson = JSON.stringify(cp); a.executions[0]!.checkpointHash = digest(JSON.stringify(cp));
      }
      assert.equal(naturalPauseState('N2', a), false, cause);
    }
    await cli('N3'); const paused = independentAudit(join(root, 'P'));
    assert.equal(paused.goals[0]!.status, 'paused'); assert.deepEqual(paused.executions, initial.executions); assert.deepEqual(paused.plans, initial.plans);
    assert.equal(paused.goals[0]!.revision, Number(viewed.goals[0]!.revision) + 1);
    assert.equal(paused.goals[0]!.pendingActionJson, initial.goals[0]!.pendingActionJson); assert.equal(paused.sessionUserCount, 3);
    assert.deepEqual(Object.values(paused.counts), Object.values(paused.counts).map(() => 0));
    assert.equal(payloads.length, 10); const n = payloads.length;
    await cli('N3', root, 1); assert.equal(payloads.length, n, '同一Case不能重发');
    if (outcome === 'partial') {
      const other = join(parent, 'wrong-target'); await cli('N1', other); await cli('N2', other); wrongTarget = true;
      await cli('N3', other, 1); const rejected = independentAudit(join(other, 'P'));
      assert.equal(rejected.goals[0]!.status, 'waiting_user'); assert.equal(rejected.executions.length, 1); assert.equal(rejected.sessionUserCount, 3);
      assert.ok(!JSON.parse(readFileSync(join(other, 'independent-budget.json'), 'utf8')).halted, '模型错误选择是业务拒绝，不伪造操作成功');
      wrongTarget = false; const expired = join(parent, 'expired'); await cli('N1', expired); await cli('N2', expired);
      const file = join(expired, 'P', 'sessions', digest('console'), 'chat.session.jsonl');
      const entries = readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
      entries.findLast(e => e.type === 'custom' && e.customType === 'host-dialogue-references-v2').data.goalView.expires = Date.now() - 1;
      writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
      const before = payloads.length; await cli('N3', expired, 1); assert.equal(payloads.length, before, '过期视图在模型发送前拒绝，不刷新');
      assert.equal(JSON.parse(readFileSync(join(expired, 'independent-budget.json'), 'utf8')).cases.length, 2);
    }
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ outcome, root, successfulRoundHttp: 10, mockModelHttp: payloads.length, publicGets: 0 }));
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
