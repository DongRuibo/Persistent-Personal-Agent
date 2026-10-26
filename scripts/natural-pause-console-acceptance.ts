import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { redactor } from '../src/config.js';
import { startIndependent } from './independent-console-acceptance.js';

// 仅新增固定模式入口；运行、隔离、预算、审计及停服仍复用independent-console。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startIndependent(true).catch(error => {
  console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1;
});
