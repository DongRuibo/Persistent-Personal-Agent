import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactor } from '../src/config.js';
import { startIndependent } from './independent-console-acceptance.js';

// 只为原Console接一条经核对的真实stdin；预算、运行和留证复用已有入口。
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void startIndependent('manual-goal').catch(error => {
  console.error(redactor(process.env.LLM_API_KEY ?? '')(error)); process.exitCode = 1;
});
