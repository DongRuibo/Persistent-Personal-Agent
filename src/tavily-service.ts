import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { publicWebAddress } from './web-read-service.js';
import type { WebResolver } from './web-read-service.js';
import type { WebSearchResult } from './web-search-types.js';

export class TavilyError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

// 用户网址和供应商返回的来源均在入口规范化；只把合格网址交给Tavily，不连接目标网站。
export function publicSearchUrl(input: string): string {
  const url = new URL(input), host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const family = isIP(host);
  if (input.length > 2048 || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || family && !publicWebAddress({ address: host, family })
    || !family && (!host.includes('.') || /(?:^|\.)(?:localhost|local|localdomain|internal|invalid|test)$/iu.test(host) || host.endsWith('.home.arpa'))) {
    throw new TavilyError('invalid_url', '只允许不含账号凭据的公网HTTP(S)网址');
  }
  url.hash = ''; return url.href;
}

export function webText(text: string, bytes: number): string {
  const raw = Buffer.from(text); let end = Math.max(0, Math.min(raw.length, bytes));
  while (end > 0 && end < raw.length && (raw[end]! & 0xc0) === 0x80) end--;
  return raw.subarray(0, end).toString('utf8');
}

// 仅裁剪新增工具自己的结果副本，包含JSON转义开销；原Session正文不变。
export function boundWebResult(result: WebSearchResult, bytes: number): WebSearchResult {
  const bounded = structuredClone(result);
  if (Buffer.byteLength(JSON.stringify(bounded)) <= bytes) return bounded;
  bounded.truncated = true;
  for (let i = bounded.sources.length - 1; i >= 0; i--) {
    const source = bounded.sources[i]!;
    const original = source.text; source.text = '';
    if (Buffer.byteLength(JSON.stringify(bounded)) > bytes) continue;
    let low = 0, high = Buffer.byteLength(original);
    while (low < high) {
      const mid = Math.ceil((low + high) / 2); source.text = webText(original, mid);
      if (Buffer.byteLength(JSON.stringify(bounded)) <= bytes) low = mid; else high = mid - 1;
    }
    source.text = webText(original, low); return bounded;
  }
  bounded.omitted = true;
  while (bounded.sources.length && Buffer.byteLength(JSON.stringify(bounded)) > bytes) bounded.sources.pop();
  return bounded;
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted(); let stop = () => {};
  try {
    return await Promise.race([work, new Promise<never>((_resolve, reject) => {
      stop = () => reject(signal.reason); signal.addEventListener('abort', stop, { once: true }); if (signal.aborted) stop();
    })]);
  } finally { signal.removeEventListener('abort', stop); }
}

export class TavilyService {
  constructor(private readonly send: typeof fetch = fetch,
    private readonly resolve: WebResolver = host => lookup(host, { all: true, verbatim: true }), private readonly timeoutMs = 15000) {}

  private async request(kind: 'search' | 'extract', body: object, signal: AbortSignal): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    const response = await abortable(this.send(`https://api.tavily.com/${kind}`, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'Content-Type': 'application/json', 'X-Tavily-Access-Mode': 'keyless' }, body: JSON.stringify(body),
    }), signal);
    if (!response.ok) {
      await response.body?.cancel();
      if ([429, 432, 433, 434].includes(response.status)) throw new TavilyError('rate_limited', 'Tavily免费服务暂时限流，请稍后再试；未切换收费方式。');
      throw new TavilyError('http_error', `Tavily暂时不可用（HTTP ${response.status}），未自动重试。`);
    }
    if (Number(response.headers.get('content-length')) > 1048576) {
      await response.body?.cancel(); throw new TavilyError('response_too_large', 'Tavily响应超过1 MiB上限');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new TavilyError('invalid_response', 'Tavily响应为空');
    const parts: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const part = await abortable(reader.read(), signal);
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > 1048576) throw new TavilyError('response_too_large', 'Tavily响应超过1 MiB上限');
        parts.push(part.value);
      }
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
      if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray((value as Record<string, unknown>).results)) throw new Error('schema');
      return value as Record<string, unknown>;
    } catch (error) {
      if (signal.aborted || error instanceof TavilyError) throw error;
      throw new TavilyError('invalid_response', 'Tavily响应格式无效，未将错误说明当作网页正文');
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  }

  private async run(kind: 'search' | 'fetch', input: string, parent: AbortSignal): Promise<WebSearchResult> {
    parent.throwIfAborted();
    const signal = AbortSignal.any([parent, AbortSignal.timeout(this.timeoutMs)]);
    try {
      let data: Record<string, unknown>;
      if (kind === 'search') {
        if (typeof input !== 'string' || !input.trim() || input.length > 400) throw new TavilyError('invalid_query', '搜索词须为1至400字符');
        data = await this.request('search', { query: input.trim(), max_results: 5, search_depth: 'basic',
          include_answer: false, include_raw_content: false, include_images: false, auto_parameters: false }, signal);
      } else {
        const url = new URL(input), host = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(this.resolve(host), signal);
        if (!addresses.length || addresses.length > 16 || addresses.some(address => !publicWebAddress(address))) throw new TavilyError('invalid_url', '网页域名未解析到允许的公网地址');
        data = await this.request('extract', { urls: [input], extract_depth: 'basic', format: 'markdown', include_images: false }, signal);
      }
      if (kind === 'fetch' && data.failed_results !== undefined) {
        if (!Array.isArray(data.failed_results)) throw new TavilyError('invalid_response', 'Tavily响应的提取失败清单格式无效');
        if (data.failed_results.length) throw new TavilyError('extract_failed', '网页提取失败：Tavily未成功读取所选网址。');
      }
      const rows = data.results as Record<string, unknown>[];
      const sources: WebSearchResult['sources'] = []; let truncated = rows.length > (kind === 'search' ? 5 : 1);
      for (const row of rows.slice(0, kind === 'search' ? 5 : 1)) {
        if (!row || typeof row !== 'object' || typeof row.url !== 'string' || typeof row[kind === 'search' ? 'content' : 'raw_content'] !== 'string'
          || row.title !== undefined && typeof row.title !== 'string') throw new TavilyError('invalid_response', 'Tavily响应缺少合法来源或正文');
        let url: string;
        try { url = publicSearchUrl(row.url); } catch { continue; }
        if (kind === 'fetch' && url !== input) continue;
        const original = row[kind === 'search' ? 'content' : 'raw_content'] as string;
        const text = webText(original, kind === 'search' ? 2048 : 16384); truncated ||= text !== original;
        if (!text.trim() && kind === 'fetch') continue;
        sources.push({ url, title: webText((row.title as string | undefined)?.trim() || new URL(url).hostname, 240), text });
      }
      if (kind === 'fetch' && !sources.length) throw new TavilyError('extract_failed', '网页提取失败：未取得可用正文，可能需要登录或站点不支持读取。');
      return { trust: 'UNTRUSTED_TAVILY_DATA_V1', kind, fetchedAt: new Date().toISOString(), sources, truncated };
    } catch (error) {
      if (parent.aborted) throw parent.reason;
      if (signal.aborted) throw new TavilyError('timeout', '网页请求超时，未自动重试。');
      if (error instanceof TavilyError) throw error;
      throw new TavilyError('network_error', '暂时无法连接Tavily，未自动重试。');
    }
  }

  search(query: string, signal: AbortSignal): Promise<WebSearchResult> { return this.run('search', query, signal); }
  extract(url: string, signal: AbortSignal): Promise<WebSearchResult> { return this.run('fetch', publicSearchUrl(url), signal); }
}
