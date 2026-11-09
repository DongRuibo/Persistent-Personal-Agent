import { readFileSync } from 'node:fs';
import { openRuntime } from '../environments/router-session-runtime.js';
import type { Config } from '../../src/config.js';

const config = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as Config;
const runtime = await openRuntime(config);
process.send?.({ ready: true, origin: runtime.origin, pid: process.pid });
process.on('message', async (input: { id: number; op: string; args: [string, string, boolean] }) => {
  try {
    const value = input.op === 'snapshot' ? runtime.snapshot() : input.op === 'unbound' ? runtime.unbound(...input.args)
      : input.op === 'share' ? runtime.share(input.args[0]) : input.op === 'close' ? await runtime.close() : undefined;
    process.send?.({ id: input.id, value });
    if (input.op === 'close') process.disconnect();
  } catch (error) { process.send?.({ id: input.id, error: String(error) }); }
});
