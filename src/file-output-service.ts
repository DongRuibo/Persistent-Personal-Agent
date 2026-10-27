import { closeSync, constants, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytes, checked, LocalFileError, localRelative } from './local-file-service.js';
import { fileHash } from './file-operation-store.js';
import type { FileActor, FileOperationStore, FileProposal } from './file-operation-store.js';

const marker = '.agent-output-root.json';
const identity = (stat: {dev: bigint; ino: bigint}) => `${stat.dev}:${stat.ino}`;
export function initializeOutput(root: string): void {
  if(!isAbsolute(root)||/^(?:\\\\|\/\/)/u.test(root))throw new LocalFileError('output_absolute_local_root_required');
  root=resolve(root);checked(dirname(root),'.');
  for(let parent=root;;parent=dirname(parent)){if(existsSync(join(parent,'.git')))throw new LocalFileError('output_git_root_forbidden');if(parent===dirname(parent))break;}
  mkdirSync(root, {mode:0o700}); const stat = checked(root,'.');
  writeFileSync(join(root,marker),JSON.stringify({schemaVersion:1,identity:identity(stat),nonce:randomUUID()}),{flag:'wx',mode:0o600});
}
export class FileOutputService {
  readonly key: string;
  private readonly rootIdentity: string;
  private readonly markerHash: string;
  constructor(readonly root: string, readonly store: FileOperationStore) {
    this.rootIdentity = identity(checked(root,'.'));
    const text = this.markerData(), parsed = JSON.parse(text.toString('utf8')) as {schemaVersion:number;identity:string;nonce:string};
    if (parsed.schemaVersion !== 1 || parsed.identity !== this.rootIdentity || !/^[a-f0-9-]{36}$/u.test(parsed.nonce)) throw new LocalFileError('output_root_unapproved');
    this.markerHash=fileHash(text);this.key=fileHash(JSON.stringify([process.platform==='win32'?resolve(root).toLowerCase():resolve(root),parsed]));
    // 崩溃恢复由宿主持锁后处理；启动只核对目录身份，首个实际操作仍完整检查账本与目录。
    if(!checked(root,'.').isDirectory())throw new LocalFileError('output_root_unapproved');
  }
  private markerData(): Buffer {
    const stat=checked(this.root,marker);if(!stat.isFile()||stat.size>1024n)throw new LocalFileError('output_root_unapproved');
    return bytes(this.root,{path:marker,identity:identity(stat),bytes:Number(stat.size)});
  }
  verify(): void {
    if(identity(checked(this.root,'.'))!==this.rootIdentity||fileHash(this.markerData())!==this.markerHash)throw new LocalFileError('output_root_changed');
    if(this.store.blocked(this.key))throw new LocalFileError('output_uncertain');
    const known = new Set([marker,...this.store.files(this.key).map(file=>file.path)]);
    if(readdirSync(this.root).some(name=>!known.has(name)))throw new LocalFileError('output_unknown_entry');
  }
  path(input: string): string {
    const path=localRelative(input);if(path.includes('/'))throw new LocalFileError('output_flat_names_only');return path;
  }
  content(text: string): void {
    if(!text||Buffer.byteLength(text)>8192||text.includes('\0')||/-----BEGIN [\w ]*PRIVATE KEY-----|\bsk-[\w-]{16,}|\bBearer\s+\S+|(?:api[_-]?key|password|app[_-]?secret|access[_-]?token|refresh[_-]?token)["']?\s*[=:]\s*["']?\S+/iu.test(text))throw new LocalFileError('output_content_rejected');
    if(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(text))!==text)throw new LocalFileError('output_invalid_utf8');
  }
  newFile(path: string): void {
    this.path(path);this.verify();
    if(existsSync(join(this.root,path)))throw new LocalFileError('output_exists');
    // dangling symlink也必须拒绝，不能只依赖exists。
    try{lstatSync(join(this.root,path));throw new LocalFileError('output_exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(this.store.files(this.key).length>=16)throw new LocalFileError('output_file_limit');
  }
  snapshot(actor: FileActor,path: string): {content:string;identity:string;hash:string} {
    this.path(path);this.verify();const owned=this.store.owned(actor,this.key,path);
    const data=bytes(this.root,{path,identity:owned.identity,bytes:owned.bytes});
    if(fileHash(data)!==owned.hash)throw new LocalFileError('output_changed');
    return {content:data.toString('utf8'),identity:owned.identity,hash:owned.hash};
  }
  apply(p: FileProposal, actor: FileActor, signal: AbortSignal, mutating:()=>void): string {
    signal.throwIfAborted();this.path(p.path);this.content(p.content);
    // executing已在发送前持久化；这里不使用会拒绝自身预留的verify。
    if(identity(checked(this.root,'.'))!==this.rootIdentity||fileHash(this.markerData())!==this.markerHash)throw new LocalFileError('output_root_changed');
    const known=new Set([marker,...this.store.files(this.key).map(file=>file.path)]);
    if(readdirSync(this.root).some(name=>!known.has(name)))throw new LocalFileError('output_unknown_entry');
    const size=Buffer.byteLength(p.content), files=this.store.files(this.key);
    if(files.reduce((n,f)=>n+(f.path===p.path?0:f.bytes),0)+size>131072)throw new LocalFileError('output_byte_limit');
    const target=join(this.root,p.path);
    if(p.kind==='write') {
      if(files.length>=16)throw new LocalFileError('output_file_limit');
      const tempPath=join(this.root,`.agent-create-${randomUUID()}.tmp`);let fd:number|undefined;
      try {
        fd=openSync(tempPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);mutating();
        writeFileSync(fd,p.content,'utf8');fsyncSync(fd);closeSync(fd);fd=undefined;signal.throwIfAborted();
        if(identity(checked(this.root,'.'))!==this.rootIdentity)throw new LocalFileError('output_root_changed');
        // 同目录完整临时文件原子发布；link遇到既有目标必失败，不存在覆盖窗口。
        linkSync(tempPath,target);
      } finally {if(fd!==undefined)closeSync(fd);if(existsSync(tempPath))unlinkSync(tempPath);}
    } else {
      const owned=this.store.owned(actor,this.key,p.path);
      const old=bytes(this.root,{path:p.path,identity:owned.identity,bytes:owned.bytes});
      if(owned.identity!==p.oldIdentity||fileHash(old)!==p.oldHash)throw new LocalFileError('output_changed');
      const temp=`.agent-edit-${randomUUID()}.tmp`, tempPath=join(this.root,temp);let fd: number|undefined;
      try {
        fd=openSync(tempPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);writeFileSync(fd,p.content,'utf8');fsyncSync(fd);closeSync(fd);fd=undefined;
        signal.throwIfAborted();
        if(identity(checked(this.root,'.'))!==this.rootIdentity)throw new LocalFileError('output_root_changed');
        const current=bytes(this.root,{path:p.path,identity:p.oldIdentity!,bytes:owned.bytes});
        if(fileHash(current)!==p.oldHash)throw new LocalFileError('output_changed');
        mutating();renameSync(tempPath,target);
      } finally {if(fd!==undefined)closeSync(fd);if(existsSync(tempPath))unlinkSync(tempPath);}
    }
    const stat=checked(this.root,p.path), result=bytes(this.root,{path:p.path,identity:identity(stat),bytes:size});
    if(fileHash(result)!==p.contentHash)throw new LocalFileError('output_result_unknown');
    return identity(stat);
  }
}
