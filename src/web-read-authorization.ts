import type { WebResource } from './web-read-types.js';

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
// 不从引文、条件或否定中抽出局部命令；不确定就展示来源后再确认。
export function rejectsWebRequest(text: string): boolean {
  text = text.normalize('NFKC');
  return text.length > 1000 || /[“”"'`「」『』‘’?？\x00-\x1f]|如果|假设|假如|要是|不要|不用|无需|不需要|先不|别|引用|他说|她说|示例|例子|这句话|这段话|https?:\/\/|www\.|file:|ftp:|\bif\b|\bwithout\b|\bnot\b|\bsuppose\b|\bhypothetical\b|\bimagine\b/iu.test(text);
}
export function confirmsWebRequest(text: string): boolean {
  return /^(?:确认读取|同意读取)(?:(?:这份|上述)(?:资料|文档))?[。！!]?$/u.test(text.normalize('NFKC').trim());
}
export function webRequestSelection(text: string, resources: WebResource[]): { ids: string[]; direct: boolean } {
  const normalized = normalize(text);
  const ids = resources.filter(resource => [resource.id, ...resource.aliases].some(alias => normalized.includes(normalize(alias)))).map(resource => resource.id);
  const names = resources.filter(resource => ids.includes(resource.id)).flatMap(resource => [resource.id, ...resource.aliases])
    .map(alias => normalize(alias).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|');
  // 用途后缀采用封闭短句，其他复合表达先展示确认，不能藏入撤销/演示等限定再直接发网。
  const purpose = '(?:(?:总结|概括|整理|说明|解释)(?:其|文档的)?(?:内容|要点|加载流程|原生加载流程|工具接口)|summarize(?:it|thecontent)|explaininterfaces)';
  const direct = ids.length === 1 && new RegExp(`^(?:(?:请帮我|请|帮我|麻烦你?)?(?:读取|读一下|读一读|获取|查阅|打开并读取|看看)|(?:please)?(?:read|fetch)(?:the)?)(?:${names})(?:(?:[，,](?:并|然后|and)?|并|然后|and)(?:请|帮我)?${purpose})?[。.!！]?$`, 'iu').test(normalized);
  return { ids, direct };
}
export function webPreview(resource: WebResource, purpose: string): string {
  return `是否读取这份公开文本？\n资源：${resource.title}\n来源：${resource.url}\n版本：${resource.version}\n目录Hash：${resource.hash}\n用途：${purpose}\n` +
    '范围：仅一次GET、最多32768字节；网站和DNS服务可见访问IP/时间，不发送提问、凭据或Cookie。正文将提供给模型，按低信任资料处理。\n' +
    '如同意，请在5分钟内单独回复“确认读取”；本轮尚未联网。';
}
