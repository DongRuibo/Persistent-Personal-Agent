// 仅离线浏览器检查：临时SQLite、原版Pi和本机模拟模型，不读取.env或正式数据。
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { webUiFixture } from '../tests/helpers/web-ui-fixture.js';
import { reply, toolCall, content } from '../tests/helpers/skills-fixture.js';
import { intentReply } from '../tests/helpers/intent-stub.js';
import type { WorkRouteContext, WorkRouteRequest } from '../src/work-route-types.js';
let last = '', sent = false;
const counts = { router: 0, chat: 0, work: 0, intent: 0 };
const evidence = process.env.PREVIEW_EVIDENCE_DIR;
if (evidence) mkdirSync(evidence, { recursive: true });
const f = await webUiFixture(async payload => {
  const prompt = content(payload.messages.findLast(m => m.role === 'user')?.content);
  const system = JSON.stringify(payload.messages[0]?.content);
  if (system.includes('你是隔离的工作路由建议器')) {
    counts.router++; publish();
    const input = JSON.parse(prompt) as { text: string; selection: WorkRouteRequest['selection']; candidates: WorkRouteContext };
    if (input.text.includes('慢建议')) await delay(4000);
    const threadId = input.selection.threadId ?? (input.candidates.threads.length === 1 ? input.candidates.threads[0]?.id : undefined);
    return reply(JSON.stringify(input.text.includes('上次那个') || !threadId
      ? { kind: 'clarify', question: '离线固定样例：有多个可能主题，请明确选择。' }
      : { kind: 'work', threadId, reason: '离线固定样例：建议整理本次原文，确认后才创建工作。' }));
  }
  if (system.includes('你正在处理用户明确提交的一次纯文本后台工作')) {
    counts.work++; publish(); await delay(prompt.includes('慢工作') ? 4000 : 800);
    return reply('B4离线工作成果：本次材料已整理为结构清单。此为本机固定模拟响应，未联网、未写文件或Memory。');
  }
  const intent = intentReply(payload); if (intent) { counts.intent++; publish(); return reply(intent); }
  counts.chat++; publish();
  if (last !== prompt) { last = prompt; sent = false; }
  if (!sent && prompt.includes('本次允许创建输出文件：')) {
    sent = true; return toolCall('write', { path: 'answer.md', content: '# 离线检查\n\n这份文件需要用户确认后才会写入。\n' });
  }
  if (!sent && prompt.includes('提醒我')) { sent = true; return toolCall('create_task', { instruction: '休息一下', when: '10分钟后' }); }
  return reply('这是**离线模拟模型**通过原版 Pi SDK 返回的回复。\n\n- Chat、Run 和历史使用真实本地后端。\n- 此预览不连接收费模型。\n\n<script>window.untrustedHtmlRan = true</script>');
}, undefined, process.env.WORK_THREADS_ENABLED === 'true', process.env.WORK_JOBS_ENABLED === 'true', process.env.WORK_ROUTING_ENABLED === 'true');
if (process.env.PREVIEW_SEED === 'true' && f.channel.workThreads) {
  const a = f.channel.workThreads.create(randomUUID(), 'B4 主题甲'), b = f.channel.workThreads.create(randomUUID(), 'B4 主题乙');
  const task = f.store.createTask('B4测试提醒（2100年，仅元数据）', '2100-01-01T00:00:00.000Z', new Date().toISOString(), { channel: 'web', userId: 'local-user' });
  f.channel.workThreads.link(a.id, 'task', task.id);
  console.log(JSON.stringify({ seeded: { threads: [a, b], taskId: task.id } }));
}
function publish() {
  if (evidence) writeFileSync(join(evidence, 'fixture-state.json'), JSON.stringify({ origin: f.origin, root: f.root, counts, errors: f.errors.map(String), snapshot: f.channel.snapshot() }, null, 2) + '\n');
}
f.workRunner?.start(); publish();
console.log(`离线模拟预览：${f.origin}\n临时数据：${f.root}\n登录测试密钥 fake-web-access-key-with-32-bytes-for-tests\n命令status/pause/resume/routing-off，Ctrl+C停止。`);
const commands = createInterface({ input: process.stdin });
commands.on('line', line => {
  void (async () => {
    if (line === 'pause') { await f.pauseHttp(); console.log('HTTP_PAUSED'); }
    else if (line === 'resume') console.log('HTTP_RESUMED ' + await f.resumeHttp());
    else if (line === 'routing-off') { f.config.workRoutingEnabled = false; await f.restart(); f.workRunner?.start(); console.log('ROUTING_OFF ' + f.origin); }
    else if (line !== 'status') return;
    publish(); console.log(JSON.stringify({ origin: f.origin, root: f.root, counts }));
  })().catch(error => console.error('预览控制失败：', error));
});
await new Promise<void>(done => { process.once('SIGINT', done); process.once('SIGTERM', done); });
commands.close(); publish(); await f.close();
