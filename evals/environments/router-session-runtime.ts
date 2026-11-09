import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Config } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { WorkCoordinatorService } from '../../src/work-coordinator.js';
import { createPiExecutor } from '../../src/pi-executor.js';
import { WebUiChannel, webOwner, webTarget, webChatKey } from '../../src/web-ui-channel.js';
import { WebUiServer } from '../../src/web-ui-server.js';
import type { Snapshot } from '../router-session-types.js';

export const accessKey = 'fake-router-eval-access-key-32-bytes';
export const actor = { owner: webOwner, channel: JSON.stringify(webTarget) };
export const canaryPattern = /CANARY_(?:PRIVATE|SHARED)_[A-Za-z0-9_]+/gu;

// 只组装现有生产对象；模型、目录与身份均由隔离评测配置提供。
export async function openRuntime(config: Config) {
  const errors: string[] = [], store = new SqliteStore(config.databasePath);
  store.recoverInterrupted(new Date().toISOString());
  const tasks = new TaskService(store, config.timeZone), memory = new FileMemoryService(config.memoryDir);
  const coordinator = new WorkCoordinatorService(store, actor);
  const executor = await createPiExecutor(config, tasks, webChatKey, memory, undefined, undefined, undefined,
    undefined, undefined, undefined, coordinator, { previous: id => store.webUi.previousChatContext(webOwner, id) });
  const channel = new WebUiChannel(store, tasks, executor, config, undefined, undefined, error => errors.push(String(error)), memory);
  const server = new WebUiServer(channel, accessKey, join(process.cwd(), 'web-dist'));
  const origin = await server.start(0);
  return { origin, errors,
    snapshot(): Snapshot {
      const sessions = readdirSync(config.sessionDir, { recursive: true, withFileTypes: true })
        .filter(file => file.isFile() && file.name === 'chat.session.jsonl').map(file => {
          const path = join(file.parentPath, file.name), raw = readFileSync(path, 'utf8');
          const entries = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
          return { path: relative(config.sessionDir, path), session_id: String(entries.find(e => e.type === 'session')?.id ?? ''),
            messages: entries.filter(e => e.type === 'message').length, sha256: createHash('sha256').update(raw).digest('hex'),
            canaries: [...new Set(raw.match(canaryPattern) ?? [])], compactions: entries.filter(e => e.type === 'compaction').length };
        });
      return { threads: store.workThreads.list(actor), sessions, jobs: store.workJobs.list(actor).length, tasks: store.listTasks().length,
        runs: store.listRuns().map(run => ({ id: run.id, status: run.status, events: store.events(run.id) })) };
    },
    unbound(id: string, title: string, archived: boolean) {
      store.workThreads.create(actor, id, title, new Date().toISOString());
      if (archived) store.workThreads.update(actor, id, { status: 'archived' }, new Date().toISOString());
    },
    share(token: string) {
      const run = store.beginRun(null, new Date().toISOString()), prompt = '记住：用户偏好使用中文回答。共享验证标记 ' + token;
      memory.withRequest({ prompt, scope: 'chat', signal: new AbortController().signal, observer: store.observer(run.id),
        source: { channel: 'web', reference: run.id } }, () => memory.remember({ kind: 'semantic', key: 'user.language', content: '用户偏好使用中文回答。共享验证标记 ' + token }));
      store.finishRun(run.id, 'succeeded', new Date().toISOString(), '合成共享Memory种子');
    },
    async close() { await channel.stop(); await server.stop(); await executor.close(); memory.close(); store.close(); },
  };
}
