// 仅离线浏览器检查：临时SQLite、原版Pi和本机模拟模型，不读取.env或正式数据。
import { webUiFixture } from '../tests/helpers/web-ui-fixture.js';
import { reply, toolCall, content } from '../tests/helpers/skills-fixture.js';
import { intentReply } from '../tests/helpers/intent-stub.js';
let last = '', sent = false;
const f = await webUiFixture(payload => {
  const intent = intentReply(payload); if (intent) return reply(intent);
  const prompt = content(payload.messages.findLast(m => m.role === 'user')?.content);
  if (last !== prompt) { last = prompt; sent = false; }
  if (!sent && prompt.includes('本次允许创建输出文件：')) {
    sent = true; return toolCall('write', { path: 'answer.md', content: '# 离线检查\n\n这份文件需要用户确认后才会写入。\n' });
  }
  if (!sent && prompt.includes('提醒我')) { sent = true; return toolCall('create_task', { instruction: '休息一下', when: '10分钟后' }); }
  return reply('这是**离线模拟模型**通过原版 Pi SDK 返回的回复。\n\n- Chat、Run 和历史使用真实本地后端。\n- 此预览不连接收费模型。\n\n```ts\nconst status = "ready";\n```\n\n<script>window.untrustedHtmlRan = true</script>');
});
console.log(`离线模拟预览：${f.origin}\n仅使用临时数据；登录使用测试密钥 fake-web-access-key-with-32-bytes-for-tests\nCtrl+C正常停止。`);
await new Promise<void>(done => {
  process.once('SIGINT', done); process.once('SIGTERM', done);
});
await f.close();
