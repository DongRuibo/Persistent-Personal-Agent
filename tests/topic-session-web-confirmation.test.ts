import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readConfig } from '../src/config.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';
import { WorkCoordinatorService } from '../src/work-coordinator.js';
import { createPiExecutor } from '../src/pi-executor.js';
import { WebReadService } from '../src/web-read-service.js';
import { defaultWebResources } from '../src/web-read-types.js';
import { webOwner, webTarget, webChatKey } from '../src/web-ui-channel.js';
import type { TopicRouteChoice } from '../src/topic-route-types.js';
import { reply, toolCall } from './helpers/skills-fixture.js';

const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
const create = (title: string): TopicRouteChoice => ({ kind: 'create', title, description: '虚构持续主题', reason: '当前明确持续事项' });
const use = (threadId: string): TopicRouteChoice => ({ kind: 'use', threadId, reason: '当前明确选用' });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'n2-web-confirm-')), payloads: { raw: string; bytes: number }[] = [], turns: unknown[] = [];
  let gets = 0, clock = new Date('2026-11-03T00:00:00.000Z');
  const model = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part;
    const payload = JSON.parse(raw); payloads.push({ raw, bytes: Buffer.byteLength(raw) });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end(payload.messages.at(-1)?.role === 'tool' ? reply('转达宿主Web收据') : toolCall('web_get', { resourceId: 'pi-skills-v1' }));
  });
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); const address = model.address();
  if (!address || typeof address === 'string') throw new Error('临时模型端口无效');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), LLM_API_KEY: 'fake-web-confirm', LLM_MODEL: 'local-stub',
    LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1`, WORK_TOPIC_SESSIONS_ENABLED: 'true', WORK_COORDINATOR_ENABLED: 'true',
    WORK_THREADS_ENABLED: 'true', WORK_JOBS_ENABLED: 'true', WORK_RECALL_ENABLED: 'true', WEB_READ_ENABLED: 'true' });
  const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone, () => clock);
  const coordinator = new WorkCoordinatorService(store, actor, () => {}, false);
  const service = new WebReadService(defaultWebResources, async () => [{ address: '8.8.8.8', family: 4 }],
    { get: async () => { gets++; return Buffer.from('虚构公开文档正文'); } });
  const boot = () => createPiExecutor(config, tasks, webChatKey, undefined, undefined, undefined, undefined,
    { service, store: store.web }, undefined, undefined, coordinator, { previous: id => store.webUi.previousChatContext(webOwner, id) });
  let executor = await boot();
  return { store, config, root, get gets() { return gets; }, advance(ms: number) { clock = new Date(clock.getTime() + ms); },
    async restart() { await executor.close(); executor = await boot(); },
    async turn(prompt: string, choice?: TopicRouteChoice, delivered = true) {
      const requestId = randomUUID(), now = clock.toISOString();
      let route, runId: string;
      if (choice) {
        store.webUi.enqueue(webOwner, requestId, prompt, now, true); route = store.webUi.freezeTopicRoute(actor, requestId, choice, now);
        const row = store.webUi.claim(webOwner, now, 'frozen')!; assert.equal(row.requestId, requestId); runId = row.runId!;
      } else runId = store.webUi.accept(webOwner, requestId, prompt, now).id;
      const frozen = route;
      const result = await tasks.withTarget(webTarget, () => executor.execute({ prompt, scope: 'chat', source: { channel: 'web', reference: runId },
        observer: store.observer(runId), signal: new AbortController().signal, ...(frozen ? { prepareChat: async () => frozen } : {}) }));
      store.finishRun(runId, 'succeeded', now, result.text); if (delivered) store.event(runId, 'delivery_succeeded');
      turns.push({ prompt, route, result, runId, gets }); return { route, result, runId };
    },
    async close(name: string) {
      const destination = process.env.N2_EVIDENCE_DIR;
      if (destination) { mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, name + '.json'), JSON.stringify({ root, gets, payloads, turns,
        calls: store.web.calls(), runs: store.listRuns().map(run => ({ ...run, events: store.events(run.id) })) }, null, 2)); }
      await executor.close(); store.close(); model.closeAllConnections(); await new Promise<void>(resolve => model.close(() => resolve()));
    } };
}

for (const middle of ['topic', 'disabled-daily', 'clarify'] as const) test(`Web R1-1：A已投递预览→${middle}确认无预览→冷A确认零GET，明确具名新读取仍可用`, async () => {
  const f = await fixture(); try {
    const a = await f.turn('请介绍 Pi Skills 文档', create('Web甲'));
    assert.match(a.result.text, /确认读取/); assert.equal(f.gets, 0); if (a.route?.kind !== 'topic') throw new Error('主题甲');
    if (middle === 'disabled-daily') { f.config.workTopicSessionsEnabled = false; await f.restart(); await f.turn('确认读取'); f.config.workTopicSessionsEnabled = true; }
    else await f.turn('确认读取', middle === 'topic' ? create('Web乙') : { kind: 'clarify', question: '请明确一个主题', reason: '本轮未执行读取' });
    assert.equal(f.gets, 0); await f.restart();
    const denied = await f.turn('确认读取', use(a.route.threadId));
    assert.equal(f.gets, 0, '旧Web预览不能因跨Session确认文字复活'); assert.match(denied.result.text, /没有|重新/);
    const explicit = await f.turn('请读取 Pi Skills 文档，并总结加载流程', use(a.route.threadId));
    assert.equal(f.gets, 1); assert.ok(!explicit.result.text.includes('没有当前用户已成功收到'));
  } finally { await f.close('web-cross-' + middle); }
});

test('Web正向：同Session已投递预览冷重建后合法确认仍读取一次', async () => {
  const f = await fixture(); try {
    const a = await f.turn('请介绍 Pi Skills 文档', create('同主题'));
    assert.equal(f.gets, 0); if (a.route?.kind !== 'topic') throw new Error('主题'); await f.restart();
    await f.turn('确认读取', use(a.route.threadId)); assert.equal(f.gets, 1);
  } finally { await f.close('web-same-positive'); }
});

for (const reason of ['undelivered', 'expired'] as const) test(`Web原检查：${reason}预览冷重建后确认零GET`, async () => {
  const f = await fixture(); try {
    const a = await f.turn('请介绍 Pi Skills 文档', create('校验主题'), reason !== 'undelivered');
    if (a.route?.kind !== 'topic') throw new Error('主题'); if (reason === 'expired') f.advance(300001); await f.restart();
    await f.turn('确认读取', use(a.route.threadId)); assert.equal(f.gets, 0);
  } finally { await f.close('web-original-' + reason); }
});
