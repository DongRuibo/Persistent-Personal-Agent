import { dirname } from 'node:path';
import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
// 只开临时测试文件；不发送prompt，验证真实进程恢复不重放模型或工具。
const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
const executeCompact = process.argv[2] === '--compact';
if (executeCompact) {
  runtime.registerProvider('n0-local', { baseUrl: process.argv[4], api: 'openai-completions', authHeader: true, models: [{ id: 'local-stub', name: 'local-stub', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32768, maxTokens: 512 }] });
  await runtime.setRuntimeApiKey('n0-local', 'fake-n0-only');
}
const files = executeCompact ? [process.argv[3]!] : process.argv.slice(2);
const result = { http: 0, tools: 0, sessions: [] as unknown[] };
for (const file of files) {
  const root = dirname(file), manager = SessionManager.open(file, root, root);
  const settings = SettingsManager.inMemory({ compaction: { enabled: false, reserveTokens: 1024, keepRecentTokens: 180 }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off', enableAnalytics: false, enableInstallTelemetry: false, transport: 'sse' });
  const loader = new DefaultResourceLoader({ cwd: root, agentDir: root, settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: '只恢复，不执行', extensionFactories: [pi => { pi.on('before_provider_request', () => { result.http++; }); pi.on('tool_execution_start', () => { result.tools++; }); }] });
  await loader.reload(); const { session } = await createAgentSession({ cwd: root, agentDir: root, modelRuntime: runtime, ...(executeCompact ? { model: runtime.getModel('n0-local', 'local-stub') } : {}), resourceLoader: loader, sessionManager: manager, settingsManager: settings, tools: [], customTools: [] });
  const entry = manager.getBranch().find(e => e.type === 'custom' && e.customType === 'n0-trusted-actor');
  result.sessions.push({ actor: entry?.type === 'custom' ? entry.data : undefined, history: JSON.stringify(manager.buildSessionContext()), entries: manager.getEntries().length });
  if (executeCompact) await session.compact();
  session.dispose();
}
process.stdout.write(JSON.stringify(result));
