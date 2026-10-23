import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer, request } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readConfig } from '../src/config.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { GoalService } from '../src/goal-service.js';
import { FileMemoryService } from '../src/memory-service.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { GoalRunner } from '../src/goal-runner.js';
import { BackgroundLane } from '../src/background-lane.js';
import { openStagedAcceptance, stagedAcceptanceFetch, stagedAcceptanceWeb, stagedAudit, stateMatches } from '../scripts/staged-console-acceptance.js';
import { stagedCases, stagedModel } from '../scripts/staged-console-cases.js';
import type { StagedCase } from '../scripts/staged-console-cases.js';
import { content, reply, toolCall } from './helpers/skills-fixture.js';
import type { Payload } from './helpers/skills-fixture.js';

test('全新SQLite/原版Pi/模拟模型：真实Console进程A闭环→隔离B→条件C→零请求重启，共用新账本', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'staged-flow-')), root = join(parent, 'round'), preload = join(parent, 'mock-fetch.mjs');
  const payloads: Payload[] = [], errors: unknown[] = []; let webGets = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/doc') { webGets++; res.end(Array.from({ length: 10 }, (_, i) => `第${i + 1}行：虚构原生Skills资料`).join('\n')); return; }
    try {
      let body = ''; for await (const c of req) body += c;
      const p = JSON.parse(body) as Payload; payloads.push(p);
      const system = content(p.messages.find(m => m.role === 'system')?.content), user = content(p.messages.findLast(m => m.role === 'user')?.content);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (system.includes('隔离的当前用户意图解析器')) {
        const { message } = JSON.parse(user), create = message.includes('逐步制定'), name = message.includes('杜鹃') ? '杜鹃' : '青桐';
        const action = create ? 'create' : message.includes('将已获取') ? 'revise_plan' : message.startsWith('批准') ? 'approve_plan'
          : message.startsWith('暂停') ? 'pause' : message.startsWith('取消') ? 'cancel' : message.startsWith('继续') ? 'continue' : 'view';
        res.end(reply(JSON.stringify({ action: 'goal_manage', mode: action === 'view' ? 'query' : 'request', evidence: message, goalAction: action,
          ...(create ? {} : { selector: { keywords: message.includes('那个学习计划') ? ['学习计划'] : [name] } }) }))); return;
      }
      if (system.includes('有界纯文本片段')) {
        assert.equal(p.tools?.length ?? 0, 0);
        const s = JSON.parse(user.split('UNTRUSTED_GOAL_SNAPSHOT=')[1]!);
        if (s.plan.revision === 0) {
          assert.equal(s.plan.currentStep.stepId, undefined);
          res.end(reply(JSON.stringify({ stepOutcome: 'complete', artifactText: '虚构的一步计划', progressSummary: '待批准', question: '请批准', proposedPlan: { changeReason: '按用户原话',
            steps: [{ title: '出题与点评', instruction: '依据资料出题，首次partial等回答，回答后点评并complete', deliverable: '题目及点评', doneWhen: '收到回答并点评', skillId: 'interview-practice' }] } }))); return;
        }
        assert.ok(user.includes('<skill name="interview-practice"'));
        if (s.goal.objective.includes('杜鹃')) assert.ok(user.includes('第8行：虚构原生Skills资料'));
        const complete = s.goal.input.text.includes('我的虚构回答');
        res.end(reply(JSON.stringify({ stepOutcome: complete ? 'complete' : 'partial', artifactText: complete ? '仅对虚构回答的点评' : '一道虚构题及考察点', progressSummary: '单片段结果', question: '等待用户决定', needsUserFeedback: true }))); return;
      }
      const index = p.messages.findLastIndex(m => m.role === 'user'), tools = p.messages.slice(index + 1).filter(m => m.role === 'tool');
      const web = user.includes(stagedCases.B1.prompt), skillId = web ? 'agent-notes' : 'interview-practice';
      if (!tools.length && (web || user.includes(stagedCases.A1.prompt))) {
        const path = system.match(new RegExp(`<name>${skillId}</name>[\\s\\S]*?<location>(.*?)</location>`))?.[1]; assert.ok(path);
        res.end(toolCall('read', { path })); return;
      }
      if (web && tools.length === 1) { res.end(toolCall('web_get', { resourceId: 'pi-skills-v1' })); return; }
      if (!web && (!tools.length || tools.length === 1 && !content(tools[0]!.content).includes('"status"'))) { res.end(toolCall('goal_manage', {})); return; }
      res.end(reply(web ? '本次提供的文档事实有来源，未知事项保留。' : '依据宿主当前状态报告操作结果。'));
    } catch (error) { errors.push(error); res.end(reply('模拟端点断言失败')); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const local = `http://127.0.0.1:${address.port}`, nativeFetch = globalThis.fetch;
  // 只存在于本机测试预载器：官方URL只是被检查的请求元数据，传输全部改投127.0.0.1。
  writeFileSync(preload, `const native=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!==${JSON.stringify(stagedModel.endpoint)})throw new Error('unexpected URL');return native(${JSON.stringify(local+'/model')},init)};`);
  const checkedAt = new Date().toISOString();
  async function cli(id: StagedCase, resume = true) {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href,
      'scripts/staged-console-acceptance.ts', '--authorized', '--rates-confirmed', '--case=' + id, '--root=' + root, ...(resume ? ['--resume'] : [])], {
      windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        LLM_PROVIDER: 'personal-compatible', LLM_API_KEY: 'mock-only-key', LLM_MODEL: stagedModel.model, LLM_BASE_URL: 'https://api.siliconflow.cn/v1',
        ACCEPTANCE_INPUT_RATE: '2', ACCEPTANCE_OUTPUT_RATE: '8', ACCEPTANCE_PRICE_CHECKED_AT: checkedAt },
    });
    let out = '', err = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { err += c; });
    child.stdin.end('不要处理这条额外输入\n');
    const [code] = await once(child, 'exit'); assert.equal(code, 0, id + '\n' + out + '\n' + err); assert.ok(out.includes('"statePass":true'), out);
  }
  let session: ReturnType<typeof openStagedAcceptance> | undefined;
  try {
    for (const id of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7'] as const) await cli(id, id !== 'A1');
    const frozenA = stagedAudit(root).goals[0]; assert.equal(frozenA!.status, 'cancelled');
    const p = JSON.parse(readFileSync(join(root, 'staged-budget.json'), 'utf8')).profile;
    session = openStagedAcceptance(root, p, true); session.begin('B1');
    const webService = stagedAcceptanceWeb(session, 'B1', async () => [{ address: '8.8.8.8', family: 4 }], {
      get: async (_target, signal) => new Promise<Buffer>((resolve, reject) => { const req = request(local + '/doc', { signal }, res => {
        const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('error', reject); res.on('end', () => resolve(Buffer.concat(chunks)));
      }); req.on('error', reject); req.end(); }),
    });
    for (const id of ['B1', 'C1', 'C2', 'C3'] as const) {
      if (id === 'C1') {
        const audit = stagedAudit(root), source = audit.web[0]!, original = String(source.snapshotJson);
        const caseCount: number = session.budget.ledger.cases.length;
        const snapshot = JSON.parse(original), db = new DatabaseSync(join(root, 'agent.db'));
        try {
          // 仅破坏本次临时夹具，证明审阅参数不能越过缺失、损坏、错版本及跨身份来源。
          for (const value of ['null', JSON.stringify({ ...snapshot, contentHash: '0'.repeat(64) }), JSON.stringify({ ...snapshot, version: 'wrong' })]) {
            db.prepare('UPDATE web_read_calls SET snapshotJson = ? WHERE id = ?').run(value, String(source.id));
            assert.throws(() => session!.begin('C1', true), /A\/B/);
          }
          db.prepare('UPDATE web_read_calls SET snapshotJson = ?, owner = ? WHERE id = ?').run(original, 'foreign', String(source.id));
          assert.throws(() => session!.begin('C1', true), /A\/B/);
        } finally { db.prepare('UPDATE web_read_calls SET snapshotJson = ?, owner = ? WHERE id = ?').run(original, String(source.owner), String(source.id)); db.close(); }
        const authFile = join(root, 'authorization.json'), authRaw = readFileSync(authFile, 'utf8'), auth = JSON.parse(authRaw);
        try {
          auth.skills.find((s: { id: string }) => s.id === 'interview-practice').hash = '0'.repeat(64); writeFileSync(authFile, JSON.stringify(auth));
          assert.throws(() => session!.begin('C1', true), /Skill绑定Hash/);
        } finally { writeFileSync(authFile, authRaw); }
        assert.equal(session.budget.ledger.cases.length, caseCount, '拒绝前不登记Case或消耗新授权');
        for (const field of ['specJson', 'inputJson', 'checkpointJson'] as const) {
          const altered = structuredClone(audit);
          if (field === 'specJson') altered.plans[0]![field] += ' ';
          else altered.executions[0]![field] += ' ';
          assert.equal(stateMatches('A7', altered), false, field);
        }
      }
      if (id !== 'B1') session.begin(id, id === 'C1');
      globalThis.fetch = stagedAcceptanceFetch(session, id, 'mock-only-key', async (_url, init) => nativeFetch(local + '/model', init));
      const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), MEMORY_DIR: join(root, 'memory'), SESSION_DIR: join(root, 'sessions'), SKILLS_DIR: join(root, 'approved-skills'),
        SKILLS_ENABLED: 'true', GOAL_ENABLED: String(id !== 'B1'), WEB_READ_ENABLED: String(id === 'B1'), LLM_API_KEY: 'mock-only-key', LLM_MODEL: stagedModel.model, LLM_BASE_URL: 'https://api.siliconflow.cn/v1' });
      const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
      let runner: GoalRunner | undefined;
      const goals = id === 'B1' ? undefined : new GoalService(store, tasks, goalId => runner?.interrupt(goalId));
      const executor = await createPiExecutor(config, tasks, 'console', memory, undefined, undefined, goals, id === 'B1' ? { service: webService, store: store.web } : undefined);
      if (goals) runner = new GoalRunner(store, executor, { sendMessage: async () => {} }, new BackgroundLane(), { ownerId: 'local-user', accepts: () => true,
        pollIntervalMs: 10, reportError: error => { throw error; }, fatal: () => assert.fail('不应停机'), delivered: (goal, run) => goals.displayed(goal, run) });
      try {
        const run = store.beginRun(null, new Date().toISOString());
        const result = await tasks.withTarget({ channel: 'console' }, () => executor.execute({ prompt: stagedCases[id].prompt, scope: 'chat', signal: new AbortController().signal,
          source: { channel: 'console', reference: run.id }, observer: store.observer(run.id) }));
        store.finishRun(run.id, 'succeeded', new Date().toISOString(), result.text); store.event(run.id, 'delivery_succeeded'); await runner?.tick();
        assert.equal(stateMatches(id, stagedAudit(root)), true, id); session.finish(id, true);
        assert.deepEqual(stagedAudit(root).goals[0], frozenA, 'B/C不能改写A结果');
      } finally { await runner?.stop(); await executor.close(); memory.close(); store.close(); }
    }
    session.close(); session = undefined; await cli('C4');
    const final = JSON.parse(readFileSync(join(root, 'staged-budget.json'), 'utf8'));
    assert.equal(final.attempts.length, payloads.length); assert.equal(final.webAttempts.length, 1); assert.equal(webGets, 1);
    assert.equal(final.cases.length, 12); assert.ok(final.cases.every((c: { statePass: boolean }) => c.statePass));
    assert.equal(final.attempts.filter((a: { caseId: string }) => a.caseId === 'A3' || a.caseId === 'C4').length, 0);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mockModelHttp: payloads.length, mockWebGets: webGets, cases: final.cases.length, root }));
  } finally { session?.close(); globalThis.fetch = nativeFetch; server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test('实际Console模拟500只请求一次、正常停服并保留失败消费，重启不能重发同Case', async () => {
  const parent = mkdtempSync(join(tmpdir(), 'staged-failure-')), root = join(parent, 'round'), preload = join(parent, 'mock-fetch.mjs');
  let requests = 0;
  const server = createServer(async (req, res) => {
    for await (const _chunk of req) { /* 只消费本机模拟请求，不记录凭据请求头。 */ }
    requests++; res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'offline fixture failure' } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  writeFileSync(preload, `const native=globalThis.fetch;globalThis.fetch=async(url,init)=>{if(String(url)!==${JSON.stringify(stagedModel.endpoint)})throw new Error('unexpected URL');return native(${JSON.stringify(`http://127.0.0.1:${address.port}`)},init)};`);
  const checkedAt = new Date().toISOString();
  const run = async (resume: boolean) => {
    const child = spawn(process.execPath, ['--import', 'tsx', '--import', pathToFileURL(preload).href, 'scripts/staged-console-acceptance.ts',
      '--authorized', '--rates-confirmed', '--case=A1', '--root=' + root, ...(resume ? ['--resume'] : [])], {
      windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        LLM_API_KEY: 'mock-only-key', LLM_MODEL: stagedModel.model, LLM_BASE_URL: 'https://api.siliconflow.cn/v1',
        ACCEPTANCE_INPUT_RATE: '2', ACCEPTANCE_OUTPUT_RATE: '8', ACCEPTANCE_PRICE_CHECKED_AT: checkedAt },
    });
    let out = ''; child.stdout.on('data', c => { out += c; }); child.stderr.on('data', c => { out += c; });
    const [code] = await once(child, 'exit'); assert.equal(code, 1, out); return out;
  };
  try {
    assert.match(await run(false), /"statePass":false/); assert.equal(requests, 1);
    const before = readFileSync(join(root, 'staged-budget.json'), 'utf8'), ledger = JSON.parse(before);
    assert.equal(ledger.attempts.length, 1); assert.equal(ledger.attempts[0].status, 500); assert.ok(ledger.attempts[0].reservedMicroCny > 0);
    assert.equal(ledger.cases[0].statePass, false); assert.ok(ledger.cases[0].finished);
    assert.match(await run(true), /已消费/); assert.equal(requests, 1);
    assert.equal(readFileSync(join(root, 'staged-budget.json'), 'utf8'), before);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});
