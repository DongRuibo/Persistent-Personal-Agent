import { createHash } from 'node:crypto';

export interface WebResource {
  id: string; title: string; aliases: string[]; url: string; version: string; enabled: boolean; hash: string;
}
export const webHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function webResource(input: Omit<WebResource, 'hash'>): WebResource {
  const url = new URL(input.url);
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(input.id) || !input.version || input.version.length > 64 || !input.title || input.title.length > 100
    || !Array.isArray(input.aliases) || !input.aliases.length || input.aliases.length > 8 || input.aliases.some(alias => !alias.trim() || alias.length > 100)
    || typeof input.enabled !== 'boolean' || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash
    || !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/u.test(url.hostname) || url.hostname.includes('..')
    || url.pathname.endsWith('/') || !/\.(?:md|txt)$/u.test(url.pathname) || url.href !== input.url) throw new Error('Web资源目录无效：仅固定HTTPS/443公开文本文件');
  const canonical = { id: input.id, title: input.title, aliases: [...input.aliases], url: input.url, version: input.version, enabled: input.enabled };
  return { ...canonical, hash: webHash(canonical) };
}
export const defaultWebResources: readonly WebResource[] = Object.freeze([
  webResource({ id: 'pi-skills-v1', title: 'Pi Skills 文档', aliases: ['Pi Skills 文档', 'Pi 技能文档', 'Pi 原生 Skills 文档'],
    url: 'https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md', version: 'pi-1.3.0', enabled: true }),
  webResource({ id: 'pi-sdk-v1', title: 'Pi SDK 文档', aliases: ['Pi SDK 文档', 'Pi SDK 接口文档'],
    url: 'https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/sdk.md', version: 'pi-1.3.0', enabled: true }),
]);
export interface WebSnapshot {
  resourceId: string; url: string; version: string; catalogHash: string; fetchedAt: string; contentHash: string; bytes: number; text: string;
}
export interface WebActor { owner: string; channel: string }
export interface WebPermit extends WebActor { id: string; runId: string; resourceId: string; catalogHash: string; expires: number }
export interface WebView extends WebActor { resourceId: string; catalogHash: string; expires: number; displayRunId: string; displayHash: string; purpose: string }
export interface WebUsage { bytes: number }
