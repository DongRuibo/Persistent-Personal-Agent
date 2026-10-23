import { createReadToolDefinition, defineTool, loadSkills, parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';
import type { SkillService, SkillUsage } from './skill-service.js';

export function inspectSkills(root: string, paths: string[]) {
  const result = loadSkills({ cwd: root, agentDir: root, skillPaths: paths, includeDefaults: false });
  if (result.diagnostics.length || result.skills.length !== paths.length) throw new Error('原生Skill校验失败或同名冲突');
  return result.skills.map(skill => {
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(readFileSync(skill.filePath, 'utf8'));
    if (frontmatter['allowed-tools']) throw new Error('S0 Skill不能声明执行工具');
    const metadata = frontmatter.metadata as Record<string, unknown> | undefined;
    return { id: skill.name, description: skill.description, filePath: skill.filePath,
      version: typeof metadata?.version === 'string' ? metadata.version.slice(0, 64) : 'unspecified', disableModelInvocation: skill.disableModelInvocation };
  });
}

function explicitlyInvokesSkill(message: string, id: string): boolean {
  const text = message.normalize('NFKC').trim(), name = id.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  // 特殊标志只接受完整、独立的调用句；不从提及、引文、条件或历史中猜授权。
  const target = `(?:(?:skill|技能)\\s+)?${name}`;
  return new RegExp(`^(?:(?:请(?:帮我)?|帮我|麻烦你?)\\s*)?(?:使用|调用|加载)\\s*${target}[。！!]?$`, 'iu').test(text)
    || new RegExp(`^(?:please\\s+)?(?:use|invoke|load)\\s+${target}[.!]?$`, 'iu').test(text)
    || text === `/skill:${id}`;
}

export function skillReadTool(service: SkillService, usage: SkillUsage, save: () => void,
  activated: (details: string) => void, currentText: () => string = () => '') {
  let reads = 0;
  const native = createReadToolDefinition(service.root, { autoResizeImages: false, operations: {
    access: async path => { service.read(path); }, readFile: async path => service.read(path).data, detectImageMimeType: async () => null,
  } });
  const tool = { ...native, description: '只读取宿主批准的Skill正文和references文本；其他文件、脚本和图片一律拒绝。',
    async execute(...args: Parameters<typeof native.execute>) {
      const [id, input, signal, update, ctx] = args;
      signal?.throwIfAborted();
      // SDK会先探测路径，所以必须在委托原生execute之前拦截；拒绝以普通文本收据返回，不破坏正常对话。
      try {
        if (++reads > 2) throw new Error('本轮Skill最多读取2次');
        const { info, data } = service.read(input.path);
        if (info.disableModelInvocation && !explicitlyInvokesSkill(currentText(), info.id)) {
          throw new Error(`此Skill需要用户明确指定；请单独发送“请使用 Skill ${info.id}”或 /skill:${info.id}`);
        }
        if (input.offset !== undefined || input.limit !== undefined) throw new Error('S0 Skill不支持分页，不能绕过累计额度');
        const token = `${info.id}:${info.hash}:${input.path}`;
        if (usage.bytes + data.length > 8192) throw new Error('本Session Skill累计8192字节已用尽；普通聊天仍可继续');
        // 先持久消费再返回正文，失败或中断不退额度，跨重启不能重复读取清空账本。
        usage.bytes += data.length; save();
        signal?.throwIfAborted();
        const result = await native.execute(id, input, signal, update, ctx);
        if (!usage.loaded.includes(token)) { usage.loaded.push(token); save(); }
        activated(JSON.stringify({ id: info.id, version: info.version, hash: info.hash, bytes: data.length }));
        return result;
      } catch (error) {
        signal?.throwIfAborted();
        return { content: [{ type: 'text' as const, text: `Skill读取拒绝：${error instanceof Error ? error.message : '校验失败'}` }], details: undefined };
      }
    },
  };
  return { tool: defineTool(tool), reset: () => { reads = 0; } };
}
