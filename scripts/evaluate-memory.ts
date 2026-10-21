import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { FileMemoryService } from '../src/memory-service.js';
import type { ExecutionRequest, MemoryInput } from '../src/contracts.js';

// 固定、虚构样本；不读取 .env 或用户存储，不调用模型。输出同时保留失败问题。
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/memory-retrieval-eval.json', import.meta.url), 'utf8')) as {
  version: number; memories: MemoryInput[]; queries: { group: string; query: string; expectedKey: string | null }[];
};
const directory = mkdtempSync(join(tmpdir(), 'agent-memory-eval-'));
const memory = new FileMemoryService(directory);
const request = (prompt: string): ExecutionRequest => ({ prompt, scope: 'chat', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } });
try {
  for (const item of fixture.memories) {
    memory.withRequest(request(`记住：${item.content}`), () => memory.remember(item));
    await delay(2); // 区分更新时间，固定现有检索器的同分排序，不依赖随机 UUID。
  }
  const cases = fixture.queries.map((sample) => {
    const found = memory.search(sample.query);
    const context = memory.withRequest(request(sample.query), () => memory.buildContext(2048));
    const expected = found.find((record) => record.key === sample.expectedKey);
    return { ...sample, retrievedKeys: found.map((record) => record.key),
      top1: (found[0]?.key ?? null) === sample.expectedKey,
      recall5: sample.expectedKey === null ? found.length === 0 : !!expected,
      contextHit: sample.expectedKey === null ? !context.ids.length : !!expected && context.ids.includes(expected.id),
      contextBytes: Buffer.byteLength(context.text) };
  });
  const groups = Object.fromEntries(['literal', 'paraphrase', 'distractor', 'negative'].map((group) => {
    const subset = cases.filter((item) => item.group === group);
    return [group, { count: subset.length, top1: subset.filter((item) => item.top1).length, recall5: subset.filter((item) => item.recall5).length, contextHit: subset.filter((item) => item.contextHit).length }];
  }));
  console.log(JSON.stringify({ fixtureVersion: fixture.version, budgetBytes: 2048, memoryCount: fixture.memories.length, groups, cases }, null, 2));
} finally { memory.close(); rmSync(directory, { recursive: true, force: true }); }
