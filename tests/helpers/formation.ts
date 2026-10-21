import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readConfig } from '../../src/config.js';
import { FormationService } from '../../src/formation-service.js';
import { FileMemoryService } from '../../src/memory-service.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import type { ExecutionRequest, MemoryInput, MemoryRecord, WriteOperation } from '../../src/contracts.js';
import type { FormationExtractor, FormationOptions } from '../../src/formation-types.js';

export function formationHarness(options: Partial<FormationOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'agent-formation-'));
  const config = readConfig({ DATABASE_PATH: join(root, 'agent.db'), LLM_API_KEY: 'fake-formation-key', LLM_MODEL: 'stub', LLM_BASE_URL: 'https://mock.example/v1' });
  const store = new SqliteStore(config.databasePath), memory = new FileMemoryService(config.memoryDir), tasks = new TaskService(store, 'Asia/Shanghai');
  let time = Date.parse('2026-10-21T00:00:00Z');
  const now = () => new Date(time);
  const formation = new FormationService({ enabled: true, owner: 'single-user', inputRate: 10, outputRate: 20, dailyCalls: 20, dailyBudget: .2, idleMs: 10000, ...options }, store, { listForHost: () => memory.listForHost() }, [], now);
  const request = (prompt: string): ExecutionRequest => {
    const run = store.beginRun(null, now().toISOString());
    return { prompt, scope: 'chat', signal: new AbortController().signal, observer: store.observer(run.id), source: { channel: 'feishu', reference: run.id } };
  };
  const write = (input: MemoryInput): MemoryRecord => {
    const req = request('测试宿主明确保存'); const operation: WriteOperation = { tool: 'memory_remember', args: input };
    return memory.withRequest(req, () => memory.remember(input), operation);
  };
  const enqueue = (text: string) => {
    const req = request(text), at = now().toISOString();
    store.finishRun(req.source!.reference, 'succeeded', at, '模拟前台正常回复', undefined, () => formation.enqueue({ owner: 'single-user', runId: req.source!.reference, text, channel: 'feishu', at }));
    return req;
  };
  const extract = async (text: string, proposal: Record<string, unknown> = {}) => {
    const req = enqueue(text);
    formation.setExtractor(async () => ({ candidates: [{ sourceRunId: req.source!.reference, quote: text, kind: 'semantic', mode: 'asserted', durable: true, subject: '用户', property: '喜欢', value: '中文', content: text, ...proposal }] }));
    time += 10001; await formation.tick();
    return req;
  };
  return { root, config, store, memory, tasks, formation, request, write, enqueue, extract, now,
    advance: (ms: number) => { time += ms; },
    setExtractor: (extractor: FormationExtractor) => formation.setExtractor(extractor),
    close: async () => {
      await formation.stop(); memory.close(); store.close();
      // 只删除本测试创建且解析后仍位于临时根目录的目录。
      if (!resolve(root).startsWith(resolve(tmpdir()) + sep) || !root.includes('agent-formation-')) throw new Error('测试清理路径异常');
      rmSync(root, { recursive: true, force: true });
    },
  };
}
