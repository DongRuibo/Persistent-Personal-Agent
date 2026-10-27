import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const localFileLimits = { files: 16, fileBytes: 32768, workspaceBytes: 131072, calls: 4, turnFiles: 2, responseBytes: 8192, turnBytes: 16384 };
export class LocalFileError extends Error {}
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const identity = (stat: BigIntStats) => `${stat.dev}:${stat.ino}`;
const key = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export interface ApprovedLocalFile { path: string; identity: string; bytes: number; hash: string }
interface Manifest { schemaVersion: 1; directories: Record<string, string>; files: ApprovedLocalFile[] }

// 相对名称既是用户授权对象，也是SDK输入；不接受设备路径、ADS、隐藏文件或平台别名。
export function localRelative(path: string, directory = false): string {
  if (directory && path === '.') return path;
  if (!path || Buffer.byteLength(path) > 240 || isAbsolute(path) || path.split('/').length > 4
    || path.split('/').some(part => !/^[\p{L}\p{N}_][\p{L}\p{N} _.-]*$/u.test(part) || /[. ]$/u.test(part)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new LocalFileError('invalid_path');
  if (path.split('/').some(part => /(?:^|[_. -])(?:secrets?|credentials?|password|passwd|tokens?|keys?|auth|config|settings|cookies?|id_rsa|id_ed25519|id_ecdsa|id_dsa)(?:[_. -]|$)|密钥|凭据|密码/iu.test(part))
    || /(?:^|\/)(?:AGENTS|CLAUDE|SKILL)\.md$/iu.test(path) || !directory && !/\.(?:md|txt)$/iu.test(path)) throw new LocalFileError('sensitive_or_unsupported_file');
  return path;
}

export function checked(root: string, rel: string): BigIntStats {
  const path = rel === '.' ? root : join(root, rel);
  for (let part = path; ; part = dirname(part)) {
    const stat = lstatSync(part, { bigint: true });
    if (stat.isSymbolicLink() || key(realpathSync(part)) !== key(part)) throw new LocalFileError('link_not_allowed');
    if (dirname(part) === part) break;
  }
  const stat = lstatSync(path, { bigint: true });
  if ((!stat.isFile() && !stat.isDirectory()) || stat.isFile() && stat.nlink !== 1n || stat.ino === 0n) throw new LocalFileError('file_type_or_hardlink');
  return stat;
}

// 有界FD读取只负责宿主边界；分页、行号、文本呈现全部交回Pi原生read。
export function bytes(root: string, file: Pick<ApprovedLocalFile, 'path' | 'identity' | 'bytes'>, observed?: (bytes: number) => void): Buffer {
  const before = checked(root, file.path);
  if (!before.isFile() || identity(before) !== file.identity || before.size !== BigInt(file.bytes) || before.size > BigInt(localFileLimits.fileBytes)) throw new LocalFileError('snapshot_changed');
  const fd = openSync(join(root, file.path), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (identity(opened) !== file.identity || !opened.isFile() || opened.nlink !== 1n || opened.size !== before.size) throw new LocalFileError('read_race');
    const buffer = Buffer.alloc(localFileLimits.fileBytes + 1); let size = 0, count: number;
    while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, size)) > 0) { size += count; observed?.(size); }
    const after = fstatSync(fd, { bigint: true }), current = checked(root, file.path);
    if (size !== file.bytes || identity(current) !== file.identity || after.nlink !== 1n || after.size !== opened.size
      || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) throw new LocalFileError('read_race');
    const data = buffer.subarray(0, size);
    new TextDecoder('utf-8', { fatal: true }).decode(data);
    if (/-----BEGIN [\w ]*PRIVATE KEY-----|\bsk-[\w-]{16,}|\bBearer\s+\S+|(?:api[_-]?key|password|app[_-]?secret|access[_-]?token|refresh[_-]?token)["']?\s*[=:]\s*["']?\S+/iu.test(data.toString('utf8'))) throw new LocalFileError('credential_content');
    return data;
  } finally { closeSync(fd); }
}

function manifestData(root: string): Buffer {
  const stat = checked(root, 'approved-files.json');
  if (!stat.isFile() || stat.size > 16384n) throw new LocalFileError('invalid_manifest');
  return bytes(root, { path: 'approved-files.json', identity: identity(stat), bytes: Number(stat.size) });
}

// 停服后操作者批准已复制的资料；文件ID和Hash固定，模型没有安装或更新入口。
export function approveLocalFiles(root: string, paths: string[]): void {
  root = resolve(root);
  if (!paths.length || paths.length > localFileLimits.files || new Set(paths).size !== paths.length) throw new LocalFileError('workspace_capacity');
  const manifest: Manifest = { schemaVersion: 1, directories: Object.create(null) as Record<string, string>, files: [] };
  for (const input of paths) {
    const path = localRelative(input), stat = checked(root, path);
    if (!stat.isFile() || stat.size > BigInt(localFileLimits.fileBytes)) throw new LocalFileError('file_capacity');
    const file = { path, identity: identity(stat), bytes: Number(stat.size) }; const data = bytes(root, file);
    manifest.files.push({ ...file, hash: hash(data) });
    for (let dir = dirname(path).split(sep).join('/'); ; dir = dirname(dir).split(sep).join('/')) {
      const current = checked(root, dir); if (!current.isDirectory()) throw new LocalFileError('directory_type');
      manifest.directories[dir] = identity(current); if (dir === '.') break;
    }
  }
  if (manifest.files.reduce((n, f) => n + f.bytes, 0) > localFileLimits.workspaceBytes) throw new LocalFileError('workspace_capacity');
  const encoded = JSON.stringify(manifest, null, 2) + '\n';
  if (Buffer.byteLength(encoded) > 16384) throw new LocalFileError('workspace_capacity');
  writeFileSync(join(root, 'approved-files.json'), encoded, { flag: 'wx', mode: 0o600 });
}

export class LocalFileService {
  private readonly manifest: Manifest;
  private readonly manifestHash: string;
  constructor(readonly root: string) {
    const data = manifestData(root);
    let value: Manifest;
    try { value = JSON.parse(data.toString('utf8')) as Manifest; } catch { throw new LocalFileError('invalid_manifest'); }
    if (!value || value.schemaVersion !== 1 || !Array.isArray(value.files) || !value.files.length || value.files.length > localFileLimits.files
      || new Set(value.files.map(f => f.path)).size !== value.files.length || !value.directories || Object.keys(value.directories).length > 49
      || value.files.some(f => localRelative(f.path) !== f.path || !/^\d+:\d+$/u.test(f.identity) || !/^[a-f0-9]{64}$/u.test(f.hash)
        || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > localFileLimits.fileBytes)
      || value.files.reduce((n, f) => n + f.bytes, 0) > localFileLimits.workspaceBytes
      || Object.entries(value.directories).some(([p, id]) => localRelative(p, true) !== p || !/^\d+:\d+$/u.test(id))) throw new LocalFileError('invalid_manifest');
    if (!Object.hasOwn(value.directories, '.') || value.files.some(f => {
      for (let p = dirname(f.path).split(sep).join('/'); p !== '.'; p = dirname(p).split(sep).join('/')) if (!Object.hasOwn(value.directories, p)) return true;
      return false;
    })) throw new LocalFileError('invalid_manifest');
    this.manifest = value; this.manifestHash = hash(data);
    this.verify();
  }
  verify(): void {
    if (hash(manifestData(this.root)) !== this.manifestHash) throw new LocalFileError('approval_changed');
    for (const [path, id] of Object.entries(this.manifest.directories)) {
      const stat = checked(this.root, path); if (!stat.isDirectory() || identity(stat) !== id) throw new LocalFileError('directory_changed');
    }
  }
  relative(path: string): string {
    const rel = relative(this.root, path).split(sep).join('/'); return localRelative(rel || '.', true);
  }
  file(path: string): ApprovedLocalFile {
    this.verify(); const file = this.manifest.files.find(f => f.path === path);
    if (!file) throw new LocalFileError('file_not_approved');
    const stat = checked(this.root, path);
    if (!stat.isFile() || identity(stat) !== file.identity || stat.size !== BigInt(file.bytes)) throw new LocalFileError('snapshot_changed');
    return file;
  }
  read(path: string, observed?: (bytes: number) => void): Buffer {
    const file = this.file(path), data = bytes(this.root, file, observed); this.verify();
    if (hash(data) !== file.hash) throw new LocalFileError('snapshot_changed');
    return data;
  }
  entries(path: string): { name: string; directory: boolean }[] {
    this.verify(); if (!Object.hasOwn(this.manifest.directories, path)) throw new LocalFileError('directory_not_approved');
    const prefix = path === '.' ? '' : path + '/', entries = new Map<string, boolean>();
    // 只投影已批准清单，不沿可变目录枚举未知文件名或目录外内容。
    for (const file of this.manifest.files) if (file.path.startsWith(prefix)) {
      const rest = file.path.slice(prefix.length), [name] = rest.split('/');
      if (!rest.includes('/')) {
        const stat = checked(this.root, file.path);
        if (!stat.isFile() || identity(stat) !== file.identity || stat.size !== BigInt(file.bytes)) throw new LocalFileError('snapshot_changed');
      }
      entries.set(name!, rest.includes('/'));
    }
    return [...entries].map(([name, directory]) => ({ name, directory }));
  }
  filesIn(path: string): string[] {
    this.verify(); if (!Object.hasOwn(this.manifest.directories, path)) throw new LocalFileError('directory_not_approved');
    const prefix = path === '.' ? '' : path + '/';
    return this.manifest.files.filter(file => file.path.startsWith(prefix)).map(file => file.path).sort();
  }
}
