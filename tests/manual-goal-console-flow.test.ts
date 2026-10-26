import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { manualGoalCases } from '../scripts/manual-goal-console-cases.js';
import { independentAudit, manualGoalState } from '../scripts/independent-console-acceptance.js';
import { stagedModel } from '../scripts/staged-console-cases.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import type { Payload } from './helpers/skills-fixture.js';
import { digest } from '../scripts/independent-console-budget.js';

for (const version of [1, 2, 3]) test(`M ${version === 3 ? 'v2停止' : 'v' + version}普通stdin→原Console/Pi/SQLite：完整生命周期、重启及评分边界`, async () => {
  const parent = mkdtempSync(join(tmpdir(), 'manual-console-')), root = join(parent, 'round');
  const preload = join(parent, 'mock-fetch.mjs'), expired = join(parent, 'clock-expired.mjs');
  const payloads: Payload[] = [], errors: unknown[] = [];
  let mode = 'normal', extra: (() => void) | undefined;
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.method, 'POST'); let raw = ''; for await (const part of req) raw += part;
      const p = JSON.parse(raw) as Payload; payloads.push(p);
      if (mode === 'disconnect') { req.socket.destroy(); return; }
      if (extra) { const send = extra; extra = undefined; send(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const system = content(p.messages.find(m => m.role === 'system')?.content), user = content(p.messages.findLast(m => m.role === 'user')?.content);
      assert.ok(!p.tools?.some(t => ['read', 'web_get'].includes(t.function.name)));
      if (system.includes('隔离的当前用户意图解析器')) {
        const { message } = JSON.parse(user), action = message.startsWith('查看') ? 'view' : message.startsWith('暂停') ? 'pause'
          : message.startsWith('继续') ? 'continue' : message.startsWith('确认') ? 'complete' : 'create';
        res.end(reply(JSON.stringify({ action: 'goal_manage', mode: action === 'view' ? 'query' : 'request', evidence: message,
          goalAction: action, selector: { keywords: ['澄川'] } }))); return;
      }
      if (system.includes('有界纯文本片段')) {
        assert.equal(p.tools?.length ?? 0, 0);
        const snapshot = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
        if (snapshot.plan.revision === 0) {
          res.end(reply(JSON.stringify(mode === 'partial' ? { stepOutcome: 'partial', artifactText: '尚需澄清，未生成待批准草稿', progressSummary: '合法partial', question: '请说明必要信息' } : {
            stepOutcome: 'complete', artifactText: '依据给定职责资料拟定一项练习', progressSummary: '计划草稿已提出', question: '请批准',
            proposedPlan: { changeReason: '保留一个正式Step及等待反馈', steps: [{ title: '职责练习', instruction: '先出题partial等回答，再点评complete', deliverable: '一道练习题及反馈点评', doneWhen: '点评回答并complete' }] },
          }))); return;
        }
        const feedback = snapshot.goal.input.text === manualGoalCases.M7.prompt;
        assert.equal(snapshot.goal.input.text, feedback ? manualGoalCases.M7.prompt : manualGoalCases.M4.prompt);
        assert.ok(snapshot.checkpoint.runId);
        if (feedback) assert.equal(snapshot.checkpoint.question, '宿主与Pi的职责如何区分？');
        res.end(reply(JSON.stringify({ stepOutcome: feedback ? 'complete' : 'partial', artifactText: feedback
          ? '根据用户回答点评：授权和Checkpoint由宿主保存，Pi只执行当前片段，回答正确。' : '题目：宿主与Pi的职责如何区分？考察授权与执行分离。',
        progressSummary: feedback ? '用户回答已点评，当前Step完成' : '已出题，等待回答', question: feedback ? '请确认Goal达成' : '宿主与Pi的职责如何区分？' }))); return;
      }
      const at = p.messages.findLastIndex(m => m.role === 'user');
      if (version !== 1 && p.messages.slice(at + 1).some(m => m.role === 'tool') && user.endsWith('\n确认')) {
        const wrong = JSON.parse(readFileSync('tests/fixtures/manual-m3-approved-not-queued.json', 'utf8')).wrongChatReply;
        res.end(reply(wrong)); return;
      }
      if (version !== 1 && user.endsWith(manualGoalCases.M4.prompt)) {
        assert.ok(JSON.stringify(p.messages).includes('正式步骤还在排队等待执行'), '保留原始错误上下文以继续观察');
        assert.ok(JSON.stringify(p.messages).includes('当前Step尚未排队或执行'), '同一Session有权威纠正，不复制后台Session');
      }
      res.end(p.messages.slice(at + 1).some(m => m.role === 'tool') ? reply('仅解释本次宿主状态，不编造后台成果。') : toolCall('goal_manage', {}));
    } catch (error) { errors.push(error); res.end(reply('offline fixture failed')); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  // 正式地址只是冻结元数据；所有实际模型HTTP转到127.0.0.1，不解析公网DNS。
  writeFileSync(preload, `const native=globalThis.fetch;globalThis.fetch=(url,init)=>{if(String(url)!==${JSON.stringify(stagedModel.endpoint)})throw new Error('unexpected URL');return native(${JSON.stringify(`http://127.0.0.1:${address.port}/model`)},init)};`);
  // 模拟测试者等到视图过期才输入；不改原Session、不补查刷新。
  writeFileSync(expired, `const write=process.stdout.write.bind(process.stdout),now=Date.now;process.stdout.write=(chunk,...args)=>{if(String(chunk).includes('请仅输入以下冻结消息'))Date.now=()=>now()+301000;return write(chunk,...args)};`);
  const checkedAt = new Date().toISOString();
  async function cli(id: keyof typeof manualGoalCases, target = root, code = 0, input = manualGoalCases[id].prompt + '\n', clock = false, late = false) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, ...(clock ? ['--import', pathToFileURL(expired).href] : []),
      version !== 1 ? 'scripts/manual-goal-console-v2-acceptance.ts' : 'scripts/manual-goal-console-acceptance.ts', '--authorized', '--rates-confirmed', '--case=' + id, '--root=' + target,
      ...(id !== 'M1' ? ['--resume', '--previous-reviewed'] : [])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, LLM_API_KEY: 'offline-manual-only-key', LLM_MODEL: stagedModel.model,
      LLM_BASE_URL: 'https://api.siliconflow.cn/v1', LLM_PROVIDER: 'personal-compatible', ACCEPTANCE_INPUT_RATE: '2', ACCEPTANCE_OUTPUT_RATE: '8',
      ACCEPTANCE_CACHE_READ_RATE: '0.04', ACCEPTANCE_EXTRA_FEES_CNY: '0', ACCEPTANCE_PRICE_CHECKED_AT: checkedAt,
    } });
    let output = ''; child.stdout.on('data', c => { output += c; }); child.stderr.on('data', c => { output += c; });
    if (late) { extra = () => child.stdin.end('额外消息不能进入Console\n'); child.stdin.write(input); } else child.stdin.end(input);
    const [actual] = await once(child, 'exit'); assert.equal(actual, code, id + '\n' + output);
    assert.equal(existsSync(join(target, 'independent.lock')), false, id + '\n' + output);
    return output;
  }
  try {
    console.log(JSON.stringify({ offlineManualRoot: root }));
    let previous: ReturnType<typeof independentAudit> | undefined;
    for (const id of Object.keys(manualGoalCases) as (keyof typeof manualGoalCases)[]) {
      if (version !== 1 && id !== 'M1') {
        const priorId = 'M' + (Number(id.slice(1)) - 1), file = join(root, 'P', priorId + '-audit.json');
        if (id === 'M4') {
          const n = payloads.length; const output = await cli(id, root, 1);
          assert.match(output, /尚无人工五维评分/); assert.equal(payloads.length, n, '未评审不发送下一条');
        }
        const audit = JSON.parse(readFileSync(file, 'utf8'));
        writeFileSync(join(root, 'P', priorId + '-review.json'), JSON.stringify({ caseId: priorId,
          foregroundRunId: audit.after.foreground.at(-1).id, auditHash: digest(readFileSync(file)), humanReviewed: true,
          modelSemanticPass: priorId !== 'M3', hostAuthorizationPass: true, userVisibleResultPass: true, persistencePass: true, safetyPass: true }));
      }
      await cli(id); const a = independentAudit(join(root, 'P'));
      assert.equal(manualGoalState(id, a), true, id); assert.equal(a.receipts.length, Number(id.slice(1)));
      assert.deepEqual(Object.values(a.counts), Object.values(a.counts).map(() => 0));
      if (id === 'M3') { assert.equal(a.executions.length, 1); assert.equal(a.goals[0]!.planRevision, 1); }
      if (id === 'M5') { assert.deepEqual(a.executions, previous!.executions); assert.deepEqual(a.plans, previous!.plans); }
      if (['M6', 'M9'].includes(id)) { assert.deepEqual(a.executions, previous!.executions); assert.deepEqual(a.steps, previous!.steps); }
      if (id === 'M7') assert.equal(JSON.parse(String(a.executions[2]!.inputJson)).authorization.text, manualGoalCases.M7.prompt);
      if (version === 3 && id === 'M3') {
        const file = join(root, 'P/M3-audit.json'), n = payloads.length;
        writeFileSync(join(root, 'P/M3-review.json'), JSON.stringify({ caseId: 'M3', foregroundRunId: a.foreground.at(-1)!.id,
          auditHash: digest(readFileSync(file)), humanReviewed: true, modelSemanticPass: false, hostAuthorizationPass: true,
          userVisibleResultPass: false, persistencePass: true, safetyPass: true }));
        const output = await cli('M4', root, 1); assert.match(output, /评分失败/); assert.equal(payloads.length, n);
        assert.deepEqual(independentAudit(join(root, 'P')), a, '用户可见结果评分失败不改变业务状态或Session');
        assert.equal(JSON.parse(readFileSync(join(root, 'independent-budget.json'), 'utf8')).halted, 'manual_review_failed');
        assert.deepEqual(errors, []); return;
      }
      if (['M2', 'M5', 'M8'].includes(id)) {
        const stale = structuredClone(a); stale.references!.goalView!.expires = Date.now() - 1; assert.equal(manualGoalState(id, stale), false);
      }
      previous = a;
    }
    assert.equal(payloads.length, 29); const finished = independentAudit(join(root, 'P')); assert.equal(finished.goals[0]!.status, 'completed');
    assert.equal(finished.executions.length, 3); assert.equal(finished.sessionUserCount, 9);
    const ledger = JSON.parse(readFileSync(join(root, 'independent-budget.json'), 'utf8')); assert.equal(ledger.cases.length, 9); assert.equal(ledger.attempts.length, 29);
    if (version === 2) {
      const review = JSON.parse(readFileSync(join(root, 'P/M3-review.json'), 'utf8'));
      assert.equal(review.modelSemanticPass, false, '不把模型失败自动改判');
      const continued = JSON.parse(readFileSync(join(root, 'P/M4-audit.json'), 'utf8'));
      assert.equal(continued.previousReview.overallPass, false); assert.equal(continued.previousReview.mayContinue, true);
      assert.equal(continued.foregroundDelivered, true); assert.equal(ledger.scope, 'manual-goal-console-v2');
      assert.deepEqual(errors, []); return;
    }
    const n = payloads.length; await cli('M9', root, 1); assert.equal(payloads.length, n, '已消费操作不重发');

    mode = 'partial'; const partial = join(parent, 'partial'); await cli('M1', partial, 1);
    const p = independentAudit(join(partial, 'P')); assert.equal(p.goals[0]!.status, 'waiting_user'); assert.equal(p.goals[0]!.pendingActionJson, null);
    const count = payloads.length; await cli('M2', partial, 1); assert.equal(payloads.length, count, 'partial无草稿不冒充计划通过');

    mode = 'normal'; const ttl = join(parent, 'ttl'); await cli('M1', ttl); await cli('M2', ttl); const beforeTtl = payloads.length;
    const expiredOutput = await cli('M3', ttl, 1, manualGoalCases.M3.prompt + '\n', true);
    assert.match(expiredOutput, /5分钟视图失效/); assert.equal(payloads.length, beforeTtl); assert.equal(JSON.parse(readFileSync(join(ttl, 'independent-budget.json'), 'utf8')).cases.length, 2);

    for (const [name, input] of [['extra', manualGoalCases.M1.prompt + '\n额外消息\n'], ['wrong', '不是冻结消息\n'], ['eof', '']] as const) {
      const target = join(parent, name), count: number = payloads.length; await cli('M1', target, 1, input);
      assert.equal(payloads.length, count); assert.ok(JSON.parse(readFileSync(join(target, 'independent-budget.json'), 'utf8')).halted);
    }
    const late = join(parent, 'late-extra'), prior = payloads.length; await cli('M1', late, 1, manualGoalCases.M1.prompt + '\n', false, true);
    assert.equal(payloads.length, prior + 1, '在途额外输入不发送第二条或退预留');
    assert.ok(JSON.parse(readFileSync(join(late, 'independent-budget.json'), 'utf8')).halted);

    mode = 'disconnect'; const disconnected = join(parent, 'disconnect'), sent = payloads.length; await cli('M1', disconnected, 1);
    const broken = JSON.parse(readFileSync(join(disconnected, 'independent-budget.json'), 'utf8')); assert.equal(payloads.length, sent + 1);
    assert.equal(broken.attempts.length, 1); assert.ok(broken.attempts[0].reservedMicroCny > 0); assert.ok(broken.halted);
    await cli('M2', disconnected, 1); assert.equal(payloads.length, sent + 1, '断连后重启不重发');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ successfulRoundHttp: 29, allLocalMockHttp: payloads.length, publicGets: 0 }));
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
