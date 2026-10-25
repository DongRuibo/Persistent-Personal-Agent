import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { independentAudit, validIndependentView } from '../scripts/independent-console-acceptance.js';
import { independentCases } from '../scripts/independent-console-cases.js';
import type { IndependentCase } from '../scripts/independent-console-cases.js';
import { stagedModel } from '../scripts/staged-console-cases.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import type { Payload } from './helpers/skills-fixture.js';

test('独立Console实际进程：P自然创建/唯一视图/泛称暂停，R异步Skill片段，S新Session自动read；零GET共用总闸', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'independent-flow-')), root = join(parent, 'round'), preload = join(parent, 'mock-fetch.mjs');
  const payloads: Payload[] = [], errors: unknown[] = []; let mode: 'normal' | 'no-read' | 'http500' | 'no-create' | 'quota' = 'normal';
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); let raw = ''; for await (const part of req) raw += part;
      const p = JSON.parse(raw) as Payload; payloads.push(p);
      if (mode === 'http500') { res.writeHead(500); res.end('offline HTTP 500'); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (mode === 'no-create') { res.end(reply('这里只提出口头阅读安排，没有保存Goal。')); return; }
      const system = content(p.messages.find(m => m.role === 'system')?.content), user = content(p.messages.findLast(m => m.role === 'user')?.content);
      if (mode === 'quota') {
        const path = system.match(/<name>interview-practice<\/name>[\s\S]*?<location>(.*?)<\/location>/u)?.[1]; assert.ok(path);
        res.end(toolCall('read', { path })); return;
      }
      if (system.includes('隔离的当前用户意图解析器')) {
        const { message } = JSON.parse(user), action = message.startsWith('查看') ? 'view' : message.startsWith('暂停') ? 'pause' : message.startsWith('批准') ? 'approve_plan' : 'create';
        res.end(reply(JSON.stringify({ action: 'goal_manage', mode: action === 'view' ? 'query' : 'request', evidence: message, goalAction: action,
          ...(action === 'create' ? {} : { selector: { keywords: action === 'pause' ? ['学习计划'] : [message.includes('白桦') ? '白桦' : '青桐'] } }) }))); return;
      }
      if (system.includes('有界纯文本片段')) {
        assert.equal(p.tools?.length ?? 0, 0);
        const snapshot = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
        if (snapshot.plan.revision === 0) {
          assert.equal(snapshot.plan.currentStep.stepId, undefined);
          res.end(reply(JSON.stringify({ stepOutcome: 'complete', artifactText: '虚构待批准阅读/练习安排', progressSummary: '初始化完成', question: '请批准计划',
            proposedPlan: { changeReason: '依据用户原话', steps: [{ title: '阅读资料并练习', instruction: '只根据虚构资料出题，partial等反馈', deliverable: '题目和考察点', doneWhen: '回答后点评',
              ...(snapshot.goal.objective.includes('白桦') ? { skillId: 'interview-practice' } : {}) }] } }))); return;
        }
        assert.ok(user.includes('<skill name="interview-practice"')); assert.equal(snapshot.checkpoint.runId, snapshot.goal.input.kind === 'approve' ? snapshot.checkpoint.runId : 'unexpected');
        res.end(reply(JSON.stringify({ stepOutcome: 'partial', artifactText: '正式片段：白名单外工具是否可自行调用？', progressSummary: '已出题', question: '等待回答', needsUserFeedback: true }))); return;
      }
      const index = p.messages.findLastIndex(m => m.role === 'user'), tools = p.messages.slice(index + 1).filter(m => m.role === 'tool');
      const s = user.includes(independentCases.S1.prompt);
      if (s) {
        assert.ok(!JSON.stringify(p.messages).includes('青桐')); assert.ok(!JSON.stringify(p.messages).includes('白桦'));
        assert.ok(!system.includes('<name>interview-practice</name>')); assert.ok(!p.tools?.some(t => ['goal_manage', 'web_get'].includes(t.function.name)));
        if (!tools.length && mode !== 'no-read') {
          const path = system.match(/<name>agent-notes<\/name>[\s\S]*?<location>(.*?)<\/location>/u)?.[1]; assert.ok(path);
          res.end(toolCall('read', { path })); return;
        }
        if (tools.length) assert.ok(JSON.stringify(p.messages).includes('区分资料原文'));
        res.end(reply('资料说明宿主、Pi和白名单的职责；没有测试结果，不能声称已验证。')); return;
      }
      if (user.includes('青桐') || user === independentCases.P3.prompt) assert.ok(!p.tools?.some(t => ['read', 'web_get'].includes(t.function.name)));
      if (!tools.length) { res.end(toolCall('goal_manage', {})); return; }
      if (user.includes(independentCases.R2.prompt)) {
        const receipt = content(tools.at(-1)?.content); assert.match(receipt, /历史Checkpoint/); assert.match(receipt, /Plan v0/); assert.match(receipt, /未领取/);
        res.end(reply('正式Plan已批准并排队，v0 Checkpoint属于初始化；正式片段尚未提交，不能编造题目。')); return;
      }
      res.end(reply('以宿主当前状态和持久收据为准。'));
    } catch (error) { errors.push(error); res.end(reply('offline fixture assertion failed')); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const addr = server.address(); assert.ok(addr && typeof addr !== 'string');
  // 官方端点仅作被检验的元数据；测试传输严格改投127.0.0.1，不执行DNS/公网请求。
  writeFileSync(preload, `const native=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!==${JSON.stringify(stagedModel.endpoint)})throw new Error('unexpected URL');return native(${JSON.stringify(`http://127.0.0.1:${addr.port}/model`)},init)};`);
  const checkedAt = new Date().toISOString();
  async function cli(id: IndependentCase, target = root, resume = true, expectedCode = 0) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, 'scripts/independent-console-acceptance.ts', '--authorized', '--rates-confirmed', '--case=' + id, '--root=' + target,
      ...(resume ? ['--resume'] : []), ...(['P2', 'P3', 'R2'].includes(id) ? ['--previous-reviewed'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LLM_API_KEY: 'offline-only-fixture-key', LLM_MODEL: stagedModel.model, LLM_BASE_URL: 'https://api.siliconflow.cn/v1', LLM_PROVIDER: 'personal-compatible',
      ACCEPTANCE_INPUT_RATE: '2', ACCEPTANCE_OUTPUT_RATE: '8', ACCEPTANCE_CACHE_READ_RATE: '0.04', ACCEPTANCE_EXTRA_FEES_CNY: '0', ACCEPTANCE_PRICE_CHECKED_AT: checkedAt } });
    let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; }); child.stdin.end('不应消费这条额外stdin\n');
    const [code] = await once(child, 'exit'); assert.equal(code, expectedCode, id + '\n' + out); return out;
  }
  try {
    await cli('P1', root, false); await cli('P2');
    const view = independentAudit(join(root, 'P')); assert.equal(validIndependentView(view), true);
    for (const cause of ['expired', 'revision', 'multiple', 'foreign', 'channel', 'delivery', 'draft', 'old-run']) {
      const a = structuredClone(view), v = a.references!.goalView!;
      if (cause === 'expired') v.expires = Date.now() - 1;
      if (cause === 'revision') a.goals[0]!.revision = Number(a.goals[0]!.revision) + 1;
      if (cause === 'multiple') v.items.push(v.items[0]!);
      if (cause === 'foreign') a.goals[0]!.ownerId = 'foreign';
      if (cause === 'channel') a.goals[0]!.targetJson = '{"channel":"feishu"}';
      if (cause === 'delivery') a.events = a.events.filter(e => e.runId !== v.displayRunId);
      if (cause === 'draft') v.items[0]!.draftHash = '0'.repeat(64);
      if (cause === 'old-run') v.displayRunId = String(a.foreground[0]!.id);
      assert.equal(validIndependentView(a, Date.now(), String(view.foreground.at(-1)!.id)), false, cause);
    }
    await cli('P3'); const p = independentAudit(join(root, 'P')); assert.equal(p.goals[0]!.status, 'paused'); assert.equal(p.executions.length, 1); assert.equal(p.sessionUserCount, 3);
    await cli('R1'); await cli('R2'); const r = independentAudit(join(root, 'R'));
    assert.equal(r.goals[0]!.status, 'waiting_user'); assert.equal(r.executions.length, 2); assert.equal(r.sessionUserCount, 2);
    const input = JSON.parse(String(r.executions[1]!.inputJson)); assert.equal(input.previousCheckpoint.executionRunId, r.executions[0]!.runId);
    assert.equal(input.skill.id, 'interview-practice'); assert.equal(r.receipts.length, 2);
    await cli('S1'); const s = independentAudit(join(root, 'S')); assert.equal(s.sessionUserCount, 1); assert.equal(s.goals.length, 0);
    assert.ok(s.events.some(e => e.type === 'skill_activated' && JSON.parse(String(e.details)).version === '1.0.1'));
    assert.deepEqual(independentAudit(join(root, 'P')), p, 'R/S不能改P业务或Session');
    const ledger = JSON.parse(readFileSync(join(root, 'independent-budget.json'), 'utf8')); assert.equal(ledger.attempts.length, 20); assert.equal(ledger.cases.length, 6);
    assert.equal(payloads.length, 20); assert.ok(!ledger.halted); assert.equal(ledger.limits.publicGets, 0);
    const n = payloads.length; await cli('P1', root, true, 1); assert.equal(payloads.length, n, '已消费Case不重发');
    mode = 'no-read'; const separate = join(parent, 's-no-read'); const out = await cli('S1', separate, false);
    assert.match(out, /"statePass":true/); assert.match(out, /"routingObserved":false/);
    mode = 'no-create'; const semantic = join(parent, 'p-semantic-failure'); await cli('P1', semantic, false, 1);
    assert.ok(!JSON.parse(readFileSync(join(semantic, 'independent-budget.json'), 'utf8')).halted);
    mode = 'normal'; await cli('S1', semantic, true); assert.equal(independentAudit(join(semantic, 'S')).goals.length, 0);
    mode = 'quota'; const quota = join(parent, 'group-quota'); const previousCount = payloads.length;
    await cli('R1', quota, false, 1); assert.equal(payloads.length - previousCount, 7, '第8次在发送前拒绝');
    assert.ok(!JSON.parse(readFileSync(join(quota, 'independent-budget.json'), 'utf8')).halted);
    mode = 'normal'; await cli('P1', quota, true); assert.equal(independentAudit(join(quota, 'P')).goals.length, 1);
    mode = 'http500'; const bad = join(parent, 'bad'); await cli('P1', bad, false, 1); const count = payloads.length;
    await cli('S1', bad, true, 1); assert.equal(payloads.length, count, '共同HTTP失败后其他组不再发送');
    assert.ok(JSON.parse(readFileSync(join(bad, 'independent-budget.json'), 'utf8')).halted);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mockModelHttp: payloads.length, successfulRoundHttp: 20, mockPublicGets: 0, cases: 6, root }));
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
