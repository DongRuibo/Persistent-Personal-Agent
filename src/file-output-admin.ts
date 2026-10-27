import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { initializeOutput } from './file-output-service.js';

// 人工初始化此前不存在的专用输出目录；不作为模型工具，也不启动Agent。
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==3)throw new Error('使用：node dist/file-output-admin.js <此前不存在的绝对输出目录>');
  initializeOutput(process.argv[2]!);console.log('已初始化专用输出目录，未启用Agent写入。');
}
