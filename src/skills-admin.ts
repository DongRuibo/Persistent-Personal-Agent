import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { safeSkillFile, skillPackage, type SkillApproval } from './skill-service.js';

// 仅供停服后由宿主操作者批准已复制到专用目录的包，不注册为模型工具。
export function approveSkill(root: string, id: string, goalCompatible = true): SkillApproval {
  const pkg = skillPackage(root, id, goalCompatible), path = join(root, 'approved.json');
  let entries: SkillApproval[] = [];
  try { entries = JSON.parse(safeSkillFile(root, path, 8192).toString('utf8')).skills; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const approval = { id, hash: pkg.info.hash, enabled: true, goalCompatible };
  const next = { schemaVersion: 1, skills: [...entries.filter(entry => entry.id !== id), approval] };
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(path + '.tmp', JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' }); renameSync(path + '.tmp', path);
  return approval;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [root, id, profile] = process.argv.slice(2);
  if (!root || !id || profile && profile !== 'chat-only') throw new Error('停服后使用：node dist/skills-admin.js <专用目录> <Skill ID> [chat-only]');
  console.log(JSON.stringify(approveSkill(resolve(root), id, profile !== 'chat-only')));
}
