import { readFileSync } from 'node:fs';
import type { Config } from '../../src/config.js';
import { openRuntime } from '../environments/router-session-runtime.js';

const input = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as { config: Config; relay: string; endpoint: string };
const transport = globalThis.fetch;
// 只改变评测传输路径，正文逐字节转发。真实密钥只在父进程内存，不写入子进程配置。
globalThis.fetch = async (url, init) => {
  if (String(url) !== input.endpoint || typeof init?.body !== 'string') throw new Error('评测子进程拒绝未计量网络请求');
  return transport(input.relay, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: init.body, signal: init.signal, redirect: 'error' });
};
const runtime = await openRuntime(input.config);
process.send?.({ ready: true, origin: runtime.origin, pid: process.pid });
process.on('message', async (message: { id: number; op: 'snapshot' | 'close' }) => {
  try {
    const value = message.op === 'snapshot' ? runtime.snapshot() : await runtime.close();
    process.send?.({ id: message.id, value });
    if (message.op === 'close') process.disconnect();
  } catch (error) { process.send?.({ id: message.id, error: String(error) }); }
});
