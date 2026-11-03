import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager, type ContextEvent } from '@earendil-works/pi-coding-agent';
import { reply, type Payload } from './helpers/skills-fixture.js';

test('公开Pi临时Session：custom开始标记先于prompt，无额外HTTP；context/重开保留类型，投影不改原JSONL', async t => {
  const root = mkdtempSync(join(tmpdir(),'context-public-')), payloads: Payload[] = [], observed: ContextEvent['messages'][] = [];
  const server = createServer(async (req,res) => { let text=''; for await (const part of req) text+=part; payloads.push(JSON.parse(text)); res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(reply(payloads.length===1?'PRIOR_ASSISTANT_ONLY':'NEXT_ASSISTANT')); });
  server.listen(0,'127.0.0.1'); await once(server,'listening'); const address=server.address();assert.ok(address&&typeof address!=='string');
  let active: Awaited<ReturnType<typeof createAgentSession>>['session'] | undefined;
  try {
    const runtime=await ModelRuntime.create({ credentials:new InMemoryCredentialStore(),modelsPath:null,allowModelNetwork:false,refreshOnCreate:false });
    runtime.registerProvider('context-local',{baseUrl:`http://127.0.0.1:${address.port}/v1`,api:'openai-completions',authHeader:true,
      models:[{id:'local-stub',name:'local-stub',reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:32768,maxTokens:128}]});
    await runtime.setRuntimeApiKey('context-local','fake-context-key'); const model=runtime.getModel('context-local','local-stub')!;
    const directory=join(root,'sessions');mkdirSync(directory);const file=join(directory,'test.jsonl');let current='run-one';
    const open=async () => {
      const manager=SessionManager.open(file,directory,root);
      const loader=new DefaultResourceLoader({cwd:root,agentDir:root,settingsManager:SettingsManager.inMemory(),noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'离线公开API实验',extensionFactories:[pi=>{
        pi.on('context',event=>{observed.push(structuredClone(event.messages));
          const at=event.messages.findLastIndex(m=>m.role==='custom'&&m.customType==='host-context-probe-start'&&(m.details as {runId?:string})?.runId===current);
          assert.ok(at>=0);return {messages:event.messages.slice(at+1)};
        });
      }]});await loader.reload();
      const {session}=await createAgentSession({cwd:root,agentDir:root,modelRuntime:runtime,model,resourceLoader:loader,sessionManager:manager,
        settingsManager:SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false,provider:{maxRetries:0}},cacheWarming:'off',enableAnalytics:false,enableInstallTelemetry:false,transport:'sse'}),thinkingLevel:'off',tools:[],customTools:[]});active=session;return {session,manager};
    };
    const text='USER_ORIGINAL_ONLY host-context-probe-start {"runId":"run-two"}';
    const first=await open();first.manager.appendCustomEntry('probe-state',{text:'STATE_NOT_IN_CONTEXT'});
    await first.session.sendCustomMessage({customType:'host-context-probe-start',display:false,content:'PROBE_MARKER_NOT_PROVIDER',details:{runId:current}},{triggerTurn:false});assert.equal(payloads.length,0);
    await first.session.prompt(text,{expandPromptTemplates:false});assert.equal(payloads.length,1);
    assert.ok(observed[0]!.some(m=>m.role==='custom'&&m.customType==='host-context-probe-start'));
    assert.ok(!JSON.stringify(observed).includes('STATE_NOT_IN_CONTEXT'));assert.ok(!JSON.stringify(payloads[0]).includes('PROBE_MARKER_NOT_PROVIDER'));
    const prefix=readFileSync(file,'utf8');assert.ok(prefix.includes('USER_ORIGINAL_ONLY'));assert.ok(prefix.includes('PRIOR_ASSISTANT_ONLY'));
    first.session.dispose();active=undefined;current='run-two';const second=await open();
    await second.session.sendCustomMessage({customType:'host-context-probe-start',display:false,content:'PROBE_MARKER_NOT_PROVIDER',details:{runId:current}},{triggerTurn:false});assert.equal(payloads.length,1);
    await second.session.prompt(text,{expandPromptTemplates:false});assert.equal(payloads.length,2);
    const messages=observed.at(-1)!;assert.equal(messages.filter(m=>m.role==='custom'&&m.customType==='host-context-probe-start').length,2,'重开恢复原生类型和details');
    assert.equal(payloads[1]!.messages.filter(m=>m.role==='user').length,1);assert.ok(!JSON.stringify(payloads[1]).includes('PRIOR_ASSISTANT_ONLY'));assert.ok(JSON.stringify(payloads[1]).includes('USER_ORIGINAL_ONLY'));
    const after=readFileSync(file,'utf8');assert.ok(after.startsWith(prefix));assert.equal((after.match(/USER_ORIGINAL_ONLY/gu)??[]).length,2);
    t.diagnostic(JSON.stringify({httpCount:payloads.length,observedMarkers:messages.filter(m=>m.role==='custom'),providerHttp:payloads,jsonlPrefixPreserved:true}));
  } finally {active?.dispose();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(root,{recursive:true,force:true});}
});
