import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { approveLocalFiles } from './local-file-service.js';

// 只供宿主操作者批准专用目录里的资料副本，不注册为Agent工具。
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, ...files] = process.argv.slice(2);
  if (!root || !files.length) throw new Error('使用：node dist/local-files-admin.js <资料副本专用目录> <相对文件路径...>');
  approveLocalFiles(resolve(root), files);
  console.log('已批准资料副本；修改内容需停服后重新批准，不会扩大工具权限。');
}
