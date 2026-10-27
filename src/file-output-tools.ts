import { createEditToolDefinition, createWriteToolDefinition, defineTool } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import { fileHash } from './file-operation-store.js';
import type { OperationGuard } from './operation-guard.js';
import type { FileOutputService } from './file-output-service.js';

export function fileOutputTools(service: FileOutputService, guard: OperationGuard) {
  const writeNative=createWriteToolDefinition(service.root), editNative=createEditToolDefinition(service.root);
  const write=defineTool({...writeNative,description:'仅提议新建专用输出目录内的md/txt，不覆盖。用户当前首行须“本次允许创建输出文件：a.md”；宿主完整展示并要求一次性确认，调用本工具绝不立即写入。',
    promptSnippet:'Propose a new output file; never write before host confirmation',promptGuidelines:['只能报告待批准，不能声称文件已经创建；不可自行确认。'],
    async execute(...args:Parameters<typeof writeNative.execute>){
      const [id,input,signal,update,ctx]=args;
      return guard.proposeFile('write',input.path,async out=>{
        signal?.throwIfAborted();out.newFile(input.path);out.content(input.content);let content:string|undefined;
        const target=join(out.root,input.path), native=createWriteToolDefinition(out.root,{operations:{
          mkdir:async dir=>{if(dir!==out.root)throw new Error('output_path_mismatch');out.verify();},
          writeFile:async(path,text)=>{signal?.throwIfAborted();if(path!==target)throw new Error('output_path_mismatch');content=text;},
        }});
        await native.execute(id,input,signal,update,{...ctx,cwd:out.root});
        if(content===undefined)throw new Error('output_preview_missing');
        return {content,oldIdentity:null,oldHash:null,modificationHash:fileHash(JSON.stringify(input)),diff:''};
      }).then(value=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:undefined,structuredContent:JSON.stringify(value)}));
    },
  });
  const edit=defineTool({...editNative,description:'仅提议精确编辑当前用户已创建的输出md/txt；首行须“本次允许编辑输出文件：a.md”。展示原生Diff并经用户确认后才提交；不能编辑资料副本或扩大权限。',
    promptSnippet:'Propose exact output edits and preview native Diff; user confirmation is required',promptGuidelines:['只提议并等待宿主确认；不得声称已修改。'],
    async execute(...args:Parameters<typeof editNative.execute>){
      const [id,input,signal,update,ctx]=args;
      return guard.proposeFile('edit',input.path,async(out,actor)=>{
        signal?.throwIfAborted();const snapshot=out.snapshot(actor,input.path), base=snapshot.content.replace(/^\uFEFF/u,'').replace(/\r\n/g,'\n');
        if(!Array.isArray(input.edits)||input.edits.length<1||input.edits.length>4||Buffer.byteLength(JSON.stringify(input))>16384)throw new Error('output_edit_limit');
        // SDK内部支持宽松匹配；入口要求原文唯一精确命中，实际替换/重叠校验/Diff仍由SDK完成。
        for(const e of input.edits){const old=e.oldText.replace(/\r\n/g,'\n');if(!old||base.indexOf(old)<0||base.indexOf(old)!==base.lastIndexOf(old))throw new Error('output_edit_not_exact');}
        let content:string|undefined;const target=join(out.root,input.path);
        const native=createEditToolDefinition(out.root,{operations:{
          access:async path=>{signal?.throwIfAborted();if(path!==target)throw new Error('output_path_mismatch');out.snapshot(actor,input.path);},
          readFile:async path=>{if(path!==target)throw new Error('output_path_mismatch');return Buffer.from(snapshot.content);},
          writeFile:async(path,text)=>{signal?.throwIfAborted();if(path!==target)throw new Error('output_path_mismatch');content=text;},
        }});
        const result=await native.execute(id,input,signal,update,{...ctx,cwd:out.root});
        if(content===undefined||content===snapshot.content||!result.details)throw new Error('output_preview_missing');out.content(content);
        return {content,oldIdentity:snapshot.identity,oldHash:snapshot.hash,modificationHash:fileHash(JSON.stringify(input)),diff:result.details.patch};
      }).then(value=>({content:[{type:'text' as const,text:JSON.stringify(value)}],details:undefined,structuredContent:JSON.stringify(value)}));
    },
  });
  return [write,edit];
}
