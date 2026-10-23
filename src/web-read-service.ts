import { lookup } from 'node:dns/promises';
import { Agent, request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { TLSSocket } from 'node:tls';
import { defaultWebResources, webResource } from './web-read-types.js';
import type { WebPermit, WebResource, WebSnapshot } from './web-read-types.js';
import type { WebReadStore } from './web-read-store.js';

export interface WebAddress { address: string; family: number }
export interface WebTarget { url: string; address: WebAddress }
export interface WebTransport { get(target: WebTarget, signal: AbortSignal): Promise<Buffer> }
export type WebResolver = (hostname: string) => Promise<WebAddress[]>;
const blocked = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.31.196.0', 24], ['192.52.193.0', 24], ['192.88.99.0', 24],
  ['192.168.0.0', 16], ['192.175.48.0', 24], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3]] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3ffe::', 16], ['3fff::', 20], ['2620:4f:8000::', 48]] as const) blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList(); globalV6.addSubnet('2000::', 3, 'ipv6');
export function publicWebAddress(value: WebAddress): boolean {
  const family = isIP(value.address);
  return family === value.family && (family === 4 ? !blocked.check(value.address, 'ipv4')
    : family === 6 && globalV6.check(value.address, 'ipv6') && !blocked.check(value.address, 'ipv6'));
}

// 仅接受服务已经校验的固定目标。测试可直接验证本机TLS，产品没有内网开关。
export class NodeWebTransport implements WebTransport {
  constructor(private readonly send: typeof request = request) {}
  async get(target: WebTarget, signal: AbortSignal): Promise<Buffer> {
    signal.throwIfAborted();
    const url = new URL(target.url), { address, family } = target.address;
    const agent = new Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} });
    const connect = agent.createConnection.bind(agent);
    // 通过公开异步Agent接口，TLS及实际IP通过前不把socket交给HTTP层，防止先发GET再拒绝。
    agent.createConnection = (options, callback) => {
      const socket = connect(options);
      if (!(socket instanceof TLSSocket) || !callback) { socket?.destroy(); throw new Error('Web TLS连接不可验证'); }
      let completed = false;
      const abort = () => done(signal.reason instanceof Error ? signal.reason : new Error('Web读取中断'));
      const done = (error?: Error) => {
        if (completed) return; completed = true; signal.removeEventListener('abort', abort);
        if (error) socket.destroy(); callback(error ?? null, socket);
      };
      socket.once('error', error => done(error));
      socket.once('secureConnect', () => {
        const allowed = new BlockList(); allowed.addAddress(address, family === 4 ? 'ipv4' : 'ipv6');
        const remote = socket.remoteAddress;
        if (!remote || !allowed.check(remote, isIP(remote) === 4 ? 'ipv4' : 'ipv6')) done(new Error('Web连接地址与已验证DNS不符'));
        else done();
      });
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      return undefined;
    };
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        // 固定family=4/6和唯一lookup结果，不使用自动地址族选择或DNS回退。
        const req = this.send(url, { agent, method: 'GET', signal, maxHeaderSize: 8192, family,
          servername: url.hostname, rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          lookup: (_host, _options, callback) => callback(null, address, family),
          headers: { Accept: 'text/plain, text/markdown', 'Accept-Encoding': 'identity', 'User-Agent': 'Personal-Agent-Readonly/1' } }, res => {
          const fail = (message: string) => { res.destroy(); req.destroy(); reject(new Error(message)); };
          const type = res.headers['content-type'] ?? '', encoding = res.headers['content-encoding'];
          if (res.statusCode !== 200 || !/^text\/(?:plain|markdown)(?:\s*;\s*charset=utf-8)?$/iu.test(type)
            || encoding !== undefined && encoding !== 'identity') { fail('Web状态、重定向、编码或内容类型不允许'); return; }
          const length = res.headers['content-length'];
          if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > 32768)) { fail('Web响应超过32768字节'); return; }
          const chunks: Buffer[] = []; let bytes = 0;
          res.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 32768) fail('Web响应超过32768字节'); else chunks.push(chunk); });
          res.on('error', reject); res.on('aborted', () => reject(new Error('Web响应未完整结束')));
          res.on('end', () => { if (res.complete) resolve(Buffer.concat(chunks)); else reject(new Error('Web响应未完整结束')); });
        });
        req.on('error', reject); req.end();
      });
    } finally { agent.destroy(); }
  }
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort: () => void = () => {};
  try { return await Promise.race([work, new Promise<never>((_resolve, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); })]); }
  finally { signal.removeEventListener('abort', abort); }
}

export class WebReadService {
  private readonly resources: WebResource[];
  constructor(resources: readonly WebResource[] = defaultWebResources,
    private readonly resolver: WebResolver = host => lookup(host, { all: true, verbatim: true }),
    private readonly transport: WebTransport = new NodeWebTransport(), private readonly timeoutMs = 10000) {
    if (!resources.length || resources.length > 8 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000) throw new Error('Web目录或超时无效');
    this.resources = resources.map(resource => { const { hash, ...input } = resource; const checked = webResource(input); if (hash !== checked.hash) throw new Error('Web目录Hash不匹配'); return checked; });
    if (new Set(this.resources.map(resource => resource.id)).size !== this.resources.length) throw new Error('Web资源ID冲突');
  }
  list(): WebResource[] { return structuredClone(this.resources.filter(resource => resource.enabled)); }
  current(id: string, hash?: string): WebResource {
    const resource = this.resources.find(item => item.id === id && item.enabled);
    if (!resource || hash && resource.hash !== hash) throw new Error('Web资源未批准、已禁用或版本变化');
    return structuredClone(resource);
  }
  async read(store: WebReadStore, permit: WebPermit, signal: AbortSignal, clock: () => Date): Promise<WebSnapshot> {
    signal.throwIfAborted(); const resource = this.current(permit.resourceId, permit.catalogHash);
    // 先完成短事务预留，再进行DNS/TLS；重复许可只可读取同一冻结结果。
    const call = store.reserve(permit, clock().toISOString());
    if (call.snapshot) {
      if (call.snapshot.url !== resource.url || call.snapshot.version !== resource.version) throw new Error('Web冻结来源与批准目录不一致');
      return call.snapshot;
    }
    try {
      const snapshot = await this.fetch(permit.resourceId, permit.catalogHash, signal);
      signal.throwIfAborted(); this.current(permit.resourceId, permit.catalogHash);
      store.finish(call.id, snapshot, clock().toISOString()); return snapshot;
    } catch (error) {
      store.fail(call.id, error instanceof Error ? error.name : 'Web读取失败', clock().toISOString(), signal.aborted);
      throw error;
    }
  }
  async fetch(id: string, hash: string, parent: AbortSignal): Promise<WebSnapshot> {
    parent.throwIfAborted();
    const resource = this.current(id, hash), signal = AbortSignal.any([parent, AbortSignal.timeout(this.timeoutMs)]);
    const addresses = await abortable(this.resolver(new URL(resource.url).hostname), signal);
    signal.throwIfAborted();
    if (!addresses.length || addresses.length > 16 || addresses.some(address => !publicWebAddress(address))) throw new Error('Web DNS包含非公网或无效地址');
    const bytes = await abortable(this.transport.get({ url: resource.url, address: addresses[0]! }, signal), signal);
    signal.throwIfAborted();
    if (!bytes.length || bytes.length > 32768) throw new Error('Web响应为空或超过32768字节');
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(text)) throw new Error('Web响应不是允许的纯文本');
    return { resourceId: id, url: resource.url, version: resource.version, catalogHash: resource.hash, fetchedAt: new Date().toISOString(),
      bytes: bytes.length, contentHash: createHash('sha256').update(bytes).digest('hex'), text };
  }
}
