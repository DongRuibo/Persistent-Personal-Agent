import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { inspectSkills } from './skill-tools.js';

export interface SkillApproval { id: string; hash: string; enabled: boolean; goalCompatible: boolean }
export interface SkillInfo extends SkillApproval { version: string; description: string; filePath: string; disableModelInvocation: boolean }
export interface SkillSnapshot { id: string; version: string; hash: string; text: string }
export interface SkillUsage { bytes: number; loaded: string[] }
export interface SkillCatalog { list(): SkillInfo[]; snapshot(id: string, hash?: string): SkillSnapshot }
export const skillHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 宿主仅校验文件边界/Hash；Skill发现和标准格式解析交给公开SDK。
export function safeSkillFile(root: string, path: string, max = 131072): Buffer {
  const base = resolve(root), target = resolve(path), rel = relative(base, target);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Skill 文件越界');
  for (let part = target; ; part = dirname(part)) {
    const stat = lstatSync(part);
    if (stat.isSymbolicLink() || key(realpathSync(part)) !== key(part)) throw new Error('Skill 禁止符号链接或junction');
    if (dirname(part) === part) break;
  }
  const before = lstatSync(target);
  if (!before.isFile() || before.nlink !== 1 || before.size > max) throw new Error('Skill 文件类型、硬链接或容量无效');
  const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink !== 1 || stat.size > max) throw new Error('Skill 文件读取竞争');
    const data = readFileSync(fd);
    if (data.length > max) throw new Error('Skill 文件超过容量');
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    return data;
  } finally { closeSync(fd); }
}

export function skillPackage(root: string, id: string, goalCompatible: boolean) {
  if (!idPattern.test(id) || id.length > 64) throw new Error('Skill ID无效');
  const base = join(root, id), files = new Map<string, Buffer>();
  function walk(dir: string, depth: number) {
    if (depth > 3) throw new Error('Skill 目录过深');
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || key(realpathSync(dir)) !== key(dir)) throw new Error('Skill 目录禁止链接');
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), rel = relative(base, path).split(sep).join('/');
      if (name.startsWith('.') || /[:\\\x00]/u.test(name)) throw new Error('Skill 资源名称无效');
      const child = lstatSync(path);
      if (child.isSymbolicLink()) throw new Error('Skill资源禁止符号链接或junction');
      if (child.isDirectory()) {
        if (!rel.startsWith('references')) throw new Error('S0只支持正文和references文本');
        walk(path, depth + 1);
      } else {
        if (rel !== 'SKILL.md' && !/^references\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.md$/u.test(rel)) throw new Error('S0不支持此Skill资源');
        files.set(path, safeSkillFile(root, path));
        if (files.size > 16 || [...files.values()].reduce((n, data) => n + data.length, 0) > 131072) throw new Error('Skill 包超过容量');
      }
    }
  }
  walk(base, 0);
  const path = join(base, 'SKILL.md'), text = files.get(path)?.toString('utf8');
  if (!text || goalCompatible && (Buffer.byteLength(text) > 4096 || files.size !== 1)) throw new Error('Goal Skill必须自包含且最多4096字节');
  const [native] = inspectSkills(root, [path]);
  if (!native || native.id !== id) throw new Error('Skill名称必须与目录一致');
  const hash = skillHash({ id, goalCompatible, files: [...files].map(([file, data]) => [relative(base, file).split(sep).join('/'), data.toString('utf8')]) });
  return { info: { ...native, hash, enabled: true, goalCompatible }, files, text };
}

export class SkillService {
  private readonly approved: SkillInfo[];
  constructor(readonly root: string) {
    const entries = this.readApprovals();
    this.approved = entries.filter(entry => entry.enabled).map(entry => {
      const pkg = skillPackage(root, entry.id, entry.goalCompatible);
      if (pkg.info.hash !== entry.hash) throw new Error('Skill批准Hash不匹配');
      return pkg.info;
    });
    if (Buffer.byteLength(JSON.stringify(this.approved.map(({ id, description }) => ({ id, description })))) > 2048) throw new Error('Skill目录超过2048字节');
  }
  private readApprovals(): SkillApproval[] {
    const raw: unknown = JSON.parse(safeSkillFile(this.root, join(this.root, 'approved.json'), 8192).toString('utf8'));
    if (!raw || typeof raw !== 'object' || !('schemaVersion' in raw) || raw.schemaVersion !== 1 || !('skills' in raw) || !Array.isArray(raw.skills) || raw.skills.length > 8) throw new Error('Skill批准清单无效');
    const entries = raw.skills as SkillApproval[];
    if (entries.some(entry => !entry || !idPattern.test(entry.id) || entry.id.length > 64 || !/^[a-f0-9]{64}$/.test(entry.hash) || typeof entry.enabled !== 'boolean' || typeof entry.goalCompatible !== 'boolean')
      || new Set(entries.map(entry => entry.id)).size !== entries.length) throw new Error('Skill批准条目无效或重复');
    return entries;
  }
  list(): SkillInfo[] { return structuredClone(this.approved); }
  current(id: string, hash?: string): ReturnType<typeof skillPackage> {
    const expected = this.approved.find(entry => entry.id === id);
    const approval = this.readApprovals().find(entry => entry.id === id && entry.enabled);
    if (!expected || !approval || approval.hash !== expected.hash || hash && hash !== expected.hash) throw new Error('Skill未批准、已禁用或版本变化；请停服核对');
    const pkg = skillPackage(this.root, id, approval.goalCompatible);
    if (pkg.info.hash !== expected.hash) throw new Error('Skill内容Hash变化，不能使用最新版本替代');
    return pkg;
  }
  snapshot(id: string, hash?: string): SkillSnapshot {
    const pkg = this.current(id, hash);
    if (!pkg.info.goalCompatible) throw new Error('Skill不兼容Goal text_only');
    return { id, hash: pkg.info.hash, version: pkg.info.version, text: pkg.text };
  }
  read(path: string): { info: SkillInfo; data: Buffer } {
    if (path.split(/[\\/]/u).some(part => part === '..') || !isAbsolute(path) || /^\\\\/u.test(path)) throw new Error('Skill读取路径无效');
    const entry = this.approved.find(info => key(path).startsWith(key(dirname(info.filePath)) + sep));
    if (!entry) throw new Error('Skill读取越界或未批准');
    const pkg = this.current(entry.id), data = [...pkg.files].find(([file]) => key(file) === key(path))?.[1];
    if (!data) throw new Error('Skill参考未批准');
    return { info: entry, data: Buffer.from(data) };
  }
}
