import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { FileMemoryService } from '../src/memory-service.js';

// 只生成临时虚构 Markdown；不包含种子生成的时间，不读取环境变量或正式目录。
const results = [];
for (const count of [100, 1000]) {
  const root = mkdtempSync(join(tmpdir(), 'retrieval-benchmark-'));
  mkdirSync(join(root, 'projects'), { mode: 0o700 });
  for (let i = 0; i < count; i++) {
    const content = `Project${i} 项目使用 SQLite 保存业务数据，当前在本地测试。`;
    const metadata = { id: randomUUID(), kind: 'project', key: `project${i}.database`, version: 1,
      hash: createHash('sha256').update(content.normalize('NFKC').toLowerCase()).digest('hex'),
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', source: { type: 'user_explicit', channel: 'host', reference: 'fictional-benchmark' } };
    writeFileSync(join(root, 'projects', `${metadata.id}.md`), '# Personal Agent Memory\n\n<!-- personal-agent-memory ' + JSON.stringify(metadata) + ' -->\n## ' + metadata.key + '\n\n' + content + '\n', { mode: 0o600 });
  }
  const before = process.memoryUsage(); const cpu = process.cpuUsage(); const start = performance.now();
  const memory = new FileMemoryService(root); const coldMs = performance.now() - start;
  try {
    const measure = (run: () => unknown) => {
      const times = Array.from({ length: 12 }, () => { const at = performance.now(); run(); return performance.now() - at; }).sort((a, b) => a - b);
      return { p50Ms: times[5], p95Ms: times[11] };
    };
    assert.equal(memory.search(`Project${count - 1} 数据库是什么？`)[0]?.key, `project${count - 1}.database`, '性能测量必须同时验证召回正确');
    const search = measure(() => memory.search(`Project${count - 1} 数据库是什么？`));
    const context = measure(() => memory.withRequest({ prompt: `Project${count - 1} 数据库是什么？`, scope: 'task', signal: new AbortController().signal, observer: { event() {}, modelCall() {} } }, () => memory.buildContext(2048)));
    const after = process.memoryUsage(); const used = process.cpuUsage(cpu);
    results.push({ count, coldMs, search, context, cpuMs: (used.user + used.system) / 1000,
      rssDeltaMiB: (after.rss - before.rss) / 1048576, heapDeltaMiB: (after.heapUsed - before.heapUsed) / 1048576,
      rssMiB: after.rss / 1048576, maxRssKiB: process.resourceUsage().maxRSS });
  } finally { memory.close(); rmSync(root, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, iterations: 12, modelCalls: 0, results }, null, 2));
