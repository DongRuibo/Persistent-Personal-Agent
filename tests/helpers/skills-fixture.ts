import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { approveSkill } from '../../src/skills-admin.js';
import { readConfig } from '../../src/config.js';
import { SqliteStore } from '../../src/sqlite-store.js';
import { TaskService } from '../../src/task-service.js';
import { createPiExecutor } from '../../src/pi-executor.js';

export function installSkill(root: string, id = 'agent-notes', body = 'SKILL_BODY：只整理已提供的资料，不写Memory。', goal = true) {
  const dir = join(root, id); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ndescription: 虚构资料整理与练习\nmetadata:\n  version: "1.0.0"\n---\n${body}\n`);
  return approveSkill(root, id, goal);
}
export interface Payload { messages: { role: string; content: unknown }[]; tools?: { function: { name: string } }[] }
export const content = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(part => part.text ?? '').join('') : '';
export function reply(text: string): string {
  return `data: ${JSON.stringify({ id: 'skills-stub', model: 'local-stub', choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`;
}
export function toolCall(name: string, args: unknown): string {
  return `data: ${JSON.stringify({ id: 'skills-stub', model: 'local-stub', choices: [{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'skill-tool', type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`;
}
export async function skillFixture(handle: (payload: Payload, call: number) => string | Promise<string>, enabled = true, body?: string) {
  const root = mkdtempSync(join(tmpdir(), 'skills-integration-')), managed = join(root, 'approved');
  installSkill(managed, 'agent-notes', body, !body || Buffer.byteLength(body) < 3500);
  const payloads: Payload[] = [], errors: unknown[] = [];
  const server = createServer(async (req, res) => {
    try { let raw = ''; for await (const chunk of req) raw += chunk; const payload = JSON.parse(raw) as Payload;
      payloads.push(payload); const response = await handle(payload, payloads.length); res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end(response);
    } catch (error) { errors.push(error); res.writeHead(500); res.end(); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address();
  if (!address || typeof address === 'string') throw new Error('模拟端口不存在');
  const config = readConfig({ DATABASE_PATH: join(root, 'app.db'), SKILLS_ENABLED: String(enabled), SKILLS_DIR: managed,
    GOAL_ENABLED: 'true', LLM_API_KEY: 'fake-skills', LLM_MODEL: 'local-stub', LLM_BASE_URL: `http://127.0.0.1:${address.port}/v1` });
  const store = new SqliteStore(config.databasePath), tasks = new TaskService(store, config.timeZone);
  let executor = await createPiExecutor(config, tasks,'console',undefined,undefined,undefined,undefined,undefined,store.files);
  return { root, managed, config, store, tasks, payloads, errors, get executor() { return executor; },
    async chat(prompt = '整理资料') {
      const run = store.beginRun(null, new Date().toISOString());
      try { const result = await executor.execute({ prompt, scope: 'chat', signal: new AbortController().signal,
        source: { channel: 'console', reference: run.id }, observer: store.observer(run.id) });
        store.finishRun(run.id, 'succeeded', new Date().toISOString(), result.text); return { run, ...result };
      } catch (error) { store.finishRun(run.id, 'failed', new Date().toISOString(), undefined, String(error)); throw error; }
    },
    async restart() { await executor.close(); executor = await createPiExecutor(config, tasks,'console',undefined,undefined,undefined,undefined,undefined,store.files); },
    async close() { await executor.close(); store.close(); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); },
  };
}
