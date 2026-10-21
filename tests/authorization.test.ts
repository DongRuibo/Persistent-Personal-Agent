import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ExecutionRequest } from '../src/contracts.js';
import { FileMemoryService, memoryIntent } from '../src/memory-service.js';
import { SqliteStore } from '../src/sqlite-store.js';
import { TaskService } from '../src/task-service.js';

const request = (prompt: string): ExecutionRequest => ({ prompt, scope: 'chat', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } });

test('写授权不接受提问式前缀、模型改写或未指定的 Memory 目标', () => {
  const root = mkdtempSync(join(tmpdir(), 'agent-authorization-'));
  const memory = new FileMemoryService(root);
  try {
    for (const prompt of ['记住这些内容需要付费吗？', '记住这些内容会不会占用内存？', '记住：这个需要付费吗？', '“记住：偏好中文”', '不要记住：偏好中文']) {
      assert.equal(memoryIntent(prompt), undefined, prompt);
    }
    const original = '用户偏好中文。';
    assert.throws(() => memory.withRequest(request(`记住：${original}`), () => memory.remember({ kind: 'semantic', key: 'user.language', content: '用户偏好英文。' })), /原文/);
    assert.throws(() => memory.withRequest(request(`记住：${original}\nkind=semantic\nkey=user.language`), () => memory.remember({ kind: 'project', key: 'other', content: original })), /指定/);
    const record = memory.withRequest(request(`记住：${original}\nkind=semantic\nkey=user.language`), () => memory.remember({ kind: 'semantic', key: 'user.language', content: original }));
    const next = '用户偏好英文。';
    assert.throws(() => memory.withRequest(request(`更新记忆：${next}`), () => memory.update(record.id, next, 1)), /指定/);
    assert.throws(() => memory.withRequest(request(`更新记忆：${next}\nkey=other`), () => memory.update(record.id, next, 1)), /指定/);
    const updated = memory.withRequest(request(`更新记忆：${next}\nkey=user.language`), () => memory.update(record.id, next, 1));
    assert.equal(updated.version, 2);
    assert.throws(() => memory.withRequest(request('忘记：\nkey=other'), () => memory.forget(record.id, 2)), /指定/);
    assert.equal(memory.get(record.id).content, next);
    memory.withRequest(request(`忘记：\nid=${record.id}`), () => memory.forget(record.id, 2));
    assert.deepEqual(memory.search('偏好'), []);
    for (const kind of ['semantic', 'project'] as const) {
      const content = `${kind} 的数据库决策`;
      memory.withRequest(request(`记住：${content}`), () => memory.remember({ kind, key: 'shared.database', content }));
    }
    const project = memory.search('数据库', 'project')[0]!;
    assert.throws(() => memory.withRequest(request('忘记：key=shared.database'), () => memory.forget(project.id, 1)), /不唯一/);
    memory.withRequest(request('忘记：key=shared.database\nkind=project'), () => memory.forget(project.id, 1));
    assert.equal(memory.search('数据库', 'semantic').length, 1);
  } finally { memory.close(); rmSync(root, { recursive: true, force: true }); }
});

test('任务工具授权绑定本轮原文与目标，后台/历史/低信任命令不能写入，一轮不重复创建', async () => {
  const store = new SqliteStore(':memory:');
  const tasks = new TaskService(store, 'Asia/Shanghai', () => new Date('2026-10-21T00:00:00Z'));
  try {
    for (const prompt of ['你好', '不要1分钟后提醒我喝水', '“1分钟后提醒我喝水”', '1分钟后提醒我喝水可以吗？', '记住：1分钟后提醒我喝水']) {
      assert.throws(() => tasks.withRequest(request(prompt), () => tasks.createFromAgent('喝水', '1分钟后')));
    }
    const valid = request('请1分钟后提醒我喝水');
    const task = tasks.withRequest(valid, () => {
      assert.throws(() => tasks.createFromAgent('改变后的任务', '1分钟后'), /原文/);
      const created = tasks.createFromAgent('喝水', '1分钟后');
      assert.throws(() => tasks.createFromAgent('喝水', '1分钟后'), /最多/);
      return created;
    });
    assert.throws(() => tasks.createFromAgent('喝水', '1分钟后'), /授权/);
    assert.throws(() => tasks.withRequest({ ...valid, scope: 'task' }, () => tasks.createFromAgent('喝水', '1分钟后')), /后台/);
    assert.throws(() => tasks.withRequest(request('取消刚才的任务'), () => tasks.cancelFromAgent(task.id)), /完整/);
    assert.throws(() => tasks.withRequest(request(`取消任务：${'a'.repeat(36)}`), () => tasks.cancelFromAgent(task.id)), /完整/);
    const cancelled = tasks.withRequest(request(`取消任务：${task.id}`), () => tasks.cancelFromAgent(task.id));
    assert.equal(cancelled.status, 'cancelled');
    assert.throws(() => tasks.withRequest({ ...valid, signal: AbortSignal.abort() }, () => tasks.createFromAgent('喝水', '1分钟后')));
    await Promise.all([
      tasks.withRequest(valid, async () => { await Promise.resolve(); tasks.createFromAgent('喝水', '1分钟后'); }),
      tasks.withRequest(request('你好'), async () => { await Promise.resolve(); assert.throws(() => tasks.createFromAgent('喝水', '1分钟后')); }),
    ]);
    assert.equal(tasks.list().length, 2);
  } finally { store.close(); }
});
