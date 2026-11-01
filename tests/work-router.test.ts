import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { WorkJob } from '../src/work-job-types.js';
import type { WebWorkJob } from '../src/web-ui-types.js';
import { webOwner, webTarget } from '../src/web-ui-channel.js';
import { webUiFixture } from './helpers/web-ui-fixture.js';

async function enqueue(f: Awaited<ReturnType<typeof webUiFixture>>, threadId: string, text = '本次明确的后台文字', requestId = randomUUID()) {
  const res = await f.request('/api/work-jobs', { requestId, threadId, text });
  assert.equal(res.status, 202, await res.clone().text()); return res.json() as Promise<WorkJob>;
}

test('显式路由普通文字仍走Chat；零Router调用，后台只排队且不占Chat busy', async () => {
  const f = await webUiFixture(undefined, undefined, true, true); try {
    await f.login(); const thread = f.channel.workThreads!.create(randomUUID(), '主题甲');
    const job = await enqueue(f, thread.id);
    assert.equal(job.status, 'queued'); assert.equal(job.runId, null); assert.equal(f.payloads.length, 0);
    assert.equal(f.channel.snapshot().capabilities.busy, false);
    const res = await f.request('/api/chat', { requestId: randomUUID(), text: '讨论一下后台处理、提醒和长期目标的区别' });
    assert.equal(res.status, 202); await f.channel.drain(); assert.equal(f.payloads.length, 1);
    assert.equal(f.channel.workRouter!.list().length, 1); assert.equal(f.store.listTasks().length, 0);
  } finally { await f.close(); }
});

test('入队响应丢失后同ID重试、刷新和重开不重复；主题或文字冲突409', async () => {
  const f = await webUiFixture(undefined, undefined, true, true); try {
    await f.login(); const a = f.channel.workThreads!.create(randomUUID(), '甲'), b = f.channel.workThreads!.create(randomUUID(), '乙');
    const id = randomUUID(), job = await enqueue(f, a.id, '固定输入', id);
    assert.deepEqual(await enqueue(f, a.id, '固定输入', id), job);
    for (const [threadId, text] of [[b.id, '固定输入'], [a.id, '不同输入']]) assert.equal((await f.request('/api/work-jobs', { requestId: id, threadId, text })).status, 409);
    await f.restart(); await f.login(); assert.deepEqual(await enqueue(f, a.id, '固定输入', id), job);
    assert.equal((await f.request('/api/work-jobs')).status, 200); assert.equal(f.store.listRuns().length, 0); assert.equal(f.payloads.length, 0);
  } finally { await f.close(); }
});

test('认证/CSRF/Origin、字段、UTF8字节、归属/归档只在HTTP入口拒绝', async () => {
  const f = await webUiFixture(undefined, undefined, true, true); try {
    assert.equal((await f.request('/api/work-jobs')).status, 401); await f.login();
    const thread = f.channel.workThreads!.create(randomUUID(), '权限主题'), base = { requestId: randomUUID(), threadId: thread.id, text: '输入' };
    assert.equal((await f.request('/api/work-jobs', base, { 'X-CSRF-Token': 'wrong' })).status, 403);
    assert.equal((await f.request('/api/work-jobs', base, { Origin: 'http://other.invalid' })).status, 403);
    for (const body of [{ ...base, owner: 'other' }, { ...base, scope: 'chat' }, { ...base, target: webTarget }, { ...base, text: ' ' }, { requestId: base.requestId, text: '无主题' }])
      assert.equal((await f.request('/api/work-jobs', body)).status, 400);
    assert.equal((await f.request('/api/work-jobs', { ...base, text: '中'.repeat(4780) })).status, 413);
    assert.equal((await f.request('/api/work-jobs', { ...base, threadId: randomUUID() })).status, 404);
    const foreignActor = { owner: 'other', channel: JSON.stringify(webTarget) }, other = f.store.workThreads.create(foreignActor, randomUUID(), '其他身份', new Date().toISOString());
    const foreign = f.store.workJobs.create(foreignActor, other.id, randomUUID(), '其他工作', new Date().toISOString());
    assert.equal((await f.request('/api/work-jobs', { ...base, threadId: other.id })).status, 404);
    for (const path of [`/api/work-jobs/${foreign.id}`, `/api/work-threads/${other.id}/jobs`]) assert.equal((await f.request(path)).status, 404);
    assert.equal((await f.request(`/api/work-jobs/${foreign.id}/cancel`, {})).status, 404);
    f.channel.workThreads!.update(thread.id, { status: 'archived' }); assert.equal((await f.request('/api/work-jobs', base)).status, 409);
    assert.equal(f.payloads.length, 0); assert.equal(f.store.listRuns().length, 0);
  } finally { await f.close(); }
});

test('关闭时API不可用、不组装Runner；重新开启保留原queued请求', async () => {
  const f = await webUiFixture(undefined, undefined, true, true); try {
    await f.login(); const thread = f.channel.workThreads!.create(randomUUID(), '开关主题'), job = await enqueue(f, thread.id);
    f.config.workJobsEnabled = false; await f.restart(); await f.login();
    assert.equal(f.workRunner, undefined); assert.equal(f.channel.snapshot().capabilities.workJobs, false);
    for (const [path, body] of [['/api/work-jobs', undefined], [`/api/work-jobs/${job.id}`, undefined], [`/api/work-jobs/${job.id}/cancel`, {}], [`/api/work-threads/${thread.id}/jobs`, undefined]] as const)
      assert.equal((await f.request(path, body)).status, 404);
    f.config.workJobsEnabled = true; await f.restart(); await f.login();
    assert.equal((await f.channel.job(job.id)).status, 'queued'); assert.equal(f.payloads.length, 0);
    await f.workRunner!.tick(); const detail = await (await f.request(`/api/work-jobs/${job.id}`)).json() as WebWorkJob;
    assert.equal(detail.status, 'succeeded'); assert.equal(detail.run?.usage.calls, 1);
    const events = f.store.events(detail.runId!); await f.request(`/api/work-jobs/${job.id}`);
    assert.deepEqual(f.store.events(detail.runId!), events); assert.ok(!events.some(e => e.details === 'web_render_ack'));
    assert.equal(f.store.webUi.inbox(webOwner).length, 1);
  } finally { await f.close(); }
});
