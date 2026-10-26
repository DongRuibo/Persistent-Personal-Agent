import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactor } from '../src/config.js';
import { startIndependent } from './independent-console-acceptance.js';

// 仍走原Console与预算入口；只有新scope的评分及继续标准不同。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startIndependent('manual-goal-v2').catch(error => {
  console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1;
});
