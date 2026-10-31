import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, sep, join, isAbsolute } from 'node:path';
import { once } from 'node:events';
import { WebUiChannel, WebUiError } from './web-ui-channel.js';
import { WorkThreadError } from './work-thread-store.js';
import type { WorkObjectKind } from './work-thread-types.js';

export interface WebUiConfig { key: string; port: number; dataDir: string }
export async function prepareWebUiData(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const marker = join(dataDir, 'web-ui-data.json');
  const entries = await readdir(dataDir);
  if (!entries.length) await writeFile(marker, '{"kind":"ppa-web-ui-v1"}\n', { flag: 'wx', mode: 0o600 });
  else {
    let valid = false;
    try { valid = JSON.parse(await readFile(marker, 'utf8')).kind === 'ppa-web-ui-v1'; } catch { /* 已有非Web目录不可接管。 */ }
    if (!valid) throw new Error('WEB_UI_DATA_DIR 不是 Web 专用目录；请选择新空目录，不能接管已有数据');
  }
}
export function readWebUiConfig(env: NodeJS.ProcessEnv = process.env): WebUiConfig {
  if (env.WEB_UI_ENABLED !== 'true') throw new Error('--web-ui 需要 WEB_UI_ENABLED=true');
  const key = env.WEB_UI_ACCESS_KEY ?? '';
  if (Buffer.byteLength(key) < 32 || key === env.LLM_API_KEY || key === '<REDACTED>') throw new Error('WEB_UI_ACCESS_KEY 需独立配置至少32字节的随机密钥');
  if (env.WEB_UI_HOST && env.WEB_UI_HOST !== '127.0.0.1') throw new Error('Web V1 只允许 127.0.0.1');
  const port = Number(env.WEB_UI_PORT ?? 4317);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('WEB_UI_PORT 无效');
  if (!env.WEB_UI_DATA_DIR || !isAbsolute(env.WEB_UI_DATA_DIR)) throw new Error('WEB_UI_DATA_DIR 需要新的独立绝对目录');
  const dataDir = resolve(env.WEB_UI_DATA_DIR);
  // 固定本模式的三个数据位置，拒绝沿用其他渠道的路径配置。
  for (const [name, path] of [['DATABASE_PATH', join(dataDir, 'agent.db')], ['SESSION_DIR', join(dataDir, 'sessions')], ['MEMORY_DIR', join(dataDir, 'memory')]]) {
    if (env[name!] && resolve(env[name!]!) !== path) throw new Error('Web 模式不能沿用其他数据路径；请移除 DATABASE_PATH/SESSION_DIR/MEMORY_DIR 或使用 Web 专用位置');
  }
  return { key, port, dataDir };
}
type Session = { csrf: string; expires: number };
const digest = (s: string) => createHash('sha256').update(s).digest();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const hashPattern = /^[a-f0-9]{64}$/u;

export class WebUiServer {
  private readonly sessions = new Map<string, Session>();
  private launchTicket?: { hash: Buffer; expires: number };
  private window = Date.now();
  private requests = 0;
  private logins = 0;
  private mutations = 0;
  private origin = '';
  readonly server = createServer({ maxHeaderSize: 8192, requestTimeout: 15000, headersTimeout: 10000 }, (req, res) => {
    void this.handle(req, res).catch(error => {
      if (!res.headersSent) this.json(res, error instanceof WebUiError || error instanceof WorkThreadError ? error.status : 500,
        { error: error instanceof WebUiError || error instanceof WorkThreadError ? error.message : '本机服务暂时无法完成请求，请检查本地日志。' });
      else res.end();
    });
  });
  constructor(private readonly channel: WebUiChannel, private readonly key: string, private readonly staticDir: string) {}
  async start(port: number): Promise<string> {
    this.server.listen(port, '127.0.0.1'); await once(this.server, 'listening');
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('Web 监听失败');
    this.origin = `http://127.0.0.1:${address.port}`;
    return this.origin;
  }
  private json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data));
  }
  private createSession(res: ServerResponse, previous?: string): string {
    for (const [id, s] of this.sessions) if (s.expires <= Date.now()) this.sessions.delete(id);
    if (previous) this.sessions.delete(previous);
    if (this.sessions.size >= 4) this.sessions.delete(this.sessions.keys().next().value!);
    const id = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex');
    this.sessions.set(id, { csrf, expires: Date.now() + 12 * 3600000 });
    res.setHeader('Set-Cookie', `ppa_web=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`);
    return csrf;
  }
  private async body(req: IncomingMessage, keys: string[]): Promise<Record<string, unknown>> {
    if (req.headers['content-type'] !== 'application/json') throw new WebUiError(415, '请使用 JSON 请求');
    if (Number(req.headers['content-length'] ?? 0) > 32768) throw new WebUiError(413, '请求过大');
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length; if (bytes > 32768) throw new WebUiError(413, '请求过大'); chunks.push(Buffer.from(chunk));
    }
    let data: unknown;
    try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new WebUiError(400, 'JSON 无效'); }
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !keys.includes(k))) throw new WebUiError(400, '请求字段无效');
    return data as Record<string, unknown>;
  }
  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (req.headers.host !== new URL(this.origin).host || req.socket.remoteAddress !== '127.0.0.1') throw new WebUiError(403, '仅限本机可信地址');
    if (Date.now() - this.window > 60000) { this.window = Date.now(); this.requests = 0; this.logins = 0; this.mutations = 0; }
    if (++this.requests > 600) throw new WebUiError(429, '访问过于频繁，请稍后重试');
    const url = new URL(req.url ?? '/', this.origin), path = url.pathname;
    if (url.search || !['GET', 'POST'].includes(req.method ?? '')) throw new WebUiError(400, '请求不支持');
    const token = /(?:^|;\s*)ppa_web=([a-f0-9]{64})(?:;|$)/u.exec(req.headers.cookie ?? '')?.[1];
    const session = token && this.sessions.get(token);
    const authenticated = !!session && session.expires > Date.now();
    if (req.method === 'POST') {
      if (req.headers.origin !== this.origin) throw new WebUiError(403, '请求来源不匹配');
      if (++this.mutations > 90) throw new WebUiError(429, '操作过于频繁，请稍后重试');
    }
    if ((path === '/api/login' || path === '/api/launch') && req.method === 'POST') {
      if (++this.logins > 10) throw new WebUiError(429, '登录尝试过多，请一分钟后重试');
      const data = await this.body(req, ['key']);
      if (typeof data.key !== 'string' || !timingSafeEqual(digest(data.key), digest(this.key))) throw new WebUiError(401, '访问密钥不正确');
      if (path === '/api/launch') {
        // 启动器持有密钥；浏览器只接收60秒内有效、用后即失效的登录入口。
        const ticket = randomBytes(32).toString('hex');
        this.launchTicket = { hash: digest(ticket), expires: Date.now() + 60000 };
        return this.json(res, 200, { url: `${this.origin}/launch/${ticket}` });
      }
      const csrf = this.createSession(res, token);
      return this.json(res, 200, { authenticated: true, csrf });
    }
    if (path.startsWith('/launch/') && req.method === 'GET') {
      const ticket = path.slice('/launch/'.length), pending = this.launchTicket;
      if (!hashPattern.test(ticket) || !pending || pending.expires <= Date.now()
        || !timingSafeEqual(digest(ticket), pending.hash)) throw new WebUiError(401, '登录入口已失效，请重新双击本机启动器。');
      this.launchTicket = undefined;
      this.createSession(res, token);
      res.writeHead(303, { Location: '/#chat' }); res.end(); return;
    }
    if (path === '/api/session' && req.method === 'GET') return this.json(res, 200, { authenticated, ...(authenticated ? { csrf: session!.csrf } : {}) });
    if (path.startsWith('/api/')) {
      if (!authenticated) throw new WebUiError(401, '请先登录');
      if (req.method === 'POST' && req.headers['x-csrf-token'] !== session!.csrf) throw new WebUiError(403, '会话校验失败，请刷新登录状态');
      if (path === '/api/logout' && req.method === 'POST') {
        await this.body(req, []); this.sessions.delete(token!);
        res.setHeader('Set-Cookie', 'ppa_web=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return this.json(res, 200, { authenticated: false });
      }
      if (path.startsWith('/api/work-')) {
        const threads = this.channel.workThreads;
        if (!threads) throw new WebUiError(404, '接口不存在');
        const objects = /^\/api\/work-objects\/(goal|task|run|memory)$/u.exec(path);
        if (objects && req.method === 'GET') return this.json(res, 200, threads.candidates(objects[1] as WorkObjectKind));
        if (path === '/api/work-threads') {
          if (req.method === 'GET') return this.json(res, 200, threads.list());
          const data = await this.body(req, ['id', 'title']);
          if (typeof data.id !== 'string' || !uuid.test(data.id) || typeof data.title !== 'string'
            || !data.title.trim() || data.title.trim().length > 120) throw new WebUiError(400, '主题 ID 或名称无效（名称限120字）');
          return this.json(res, 200, threads.create(data.id, data.title.trim()));
        }
        const thread = /^\/api\/work-threads\/([a-f0-9-]{36})(\/links)?$/u.exec(path);
        if (thread && uuid.test(thread[1]!)) {
          if (!thread[2] && req.method === 'GET') return this.json(res, 200, threads.detail(thread[1]!));
          if (!thread[2] && req.method === 'POST') {
            const data = await this.body(req, ['title', 'status']);
            if (!Object.keys(data).length || (data.title !== undefined && (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 120))
              || (data.status !== undefined && data.status !== 'active' && data.status !== 'archived')) throw new WebUiError(400, '主题名称或状态无效');
            return this.json(res, 200, threads.update(thread[1]!, {
              ...(data.title !== undefined ? { title: (data.title as string).trim() } : {}),
              ...(data.status !== undefined ? { status: data.status as 'active' | 'archived' } : {}),
            }));
          }
          if (thread[2] && req.method === 'POST') {
            const data = await this.body(req, ['kind', 'objectId', 'action']);
            if (typeof data.kind !== 'string' || !['goal', 'task', 'run', 'memory'].includes(data.kind) || typeof data.objectId !== 'string' || !uuid.test(data.objectId)
              || (data.action !== 'link' && data.action !== 'unlink')) throw new WebUiError(400, '关联参数无效');
            if (data.action === 'link') threads.link(thread[1]!, data.kind as WorkObjectKind, data.objectId);
            else threads.unlink(thread[1]!, data.kind as WorkObjectKind, data.objectId);
            return this.json(res, 200, { changed: true });
          }
        }
        throw new WebUiError(404, '接口不存在');
      }
      if (path === '/api/snapshot' && req.method === 'GET') return this.json(res, 200, this.channel.snapshot());
      if (path === '/api/chat' && req.method === 'POST') {
        const data = await this.body(req, ['requestId', 'text']);
        if (typeof data.requestId !== 'string' || !uuid.test(data.requestId) || typeof data.text !== 'string' || !data.text.trim() || data.text.length > 10000) throw new WebUiError(400, '消息或请求 ID 无效');
        return this.json(res, 202, this.channel.submit(data.requestId, data.text.trim()));
      }
      const run = /^\/api\/runs\/([a-f0-9-]{36})(\/ack)?$/u.exec(path);
      if (run && uuid.test(run[1]!)) {
        if (!run[2] && req.method === 'GET') return this.json(res, 200, this.channel.run(run[1]!));
        if (run[2] && req.method === 'POST') {
          const data = await this.body(req, ['hash']);
          if (data.hash !== undefined && (typeof data.hash !== 'string' || !hashPattern.test(data.hash))) throw new WebUiError(400, 'Hash 无效');
          this.channel.acknowledge(run[1]!, data.hash as string | undefined); return this.json(res, 200, { acknowledged: true });
        }
      }
      const file = /^\/api\/files\/([a-f0-9-]{36})(\/decision)?$/u.exec(path);
      if (file && uuid.test(file[1]!)) {
        if (!file[2] && req.method === 'GET') return this.json(res, 200, this.channel.file(file[1]!));
        if (file[2] && req.method === 'POST') {
          const data = await this.body(req, ['hash', 'action', 'requestId']);
          if (typeof data.hash !== 'string' || !hashPattern.test(data.hash) || !['confirm', 'reject'].includes(String(data.action)) || typeof data.requestId !== 'string' || !uuid.test(data.requestId)) throw new WebUiError(400, '审批参数无效');
          return this.json(res, 202, this.channel.decide(file[1]!, data.hash, data.action as 'confirm' | 'reject', data.requestId));
        }
      }
      const goal = /^\/api\/goals\/([a-f0-9-]{36})$/u.exec(path);
      if (goal && uuid.test(goal[1]!) && req.method === 'GET') return this.json(res, 200, this.channel.goal(goal[1]!));
      const notice = /^\/api\/inbox\/([a-f0-9-]{36})\/view$/u.exec(path);
      if (notice && uuid.test(notice[1]!) && req.method === 'POST') {
        await this.body(req, []); this.channel.viewNotice(notice[1]!); return this.json(res, 200, { viewed: true });
      }
      throw new WebUiError(404, '接口不存在');
    }
    if (req.method !== 'GET') throw new WebUiError(404, '页面不存在');
    const allowed = path === '/' || path === '/index.html' || /^\/assets\/[A-Za-z0-9_.-]+$/u.test(path)
      || ['/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(path);
    if (!allowed) throw new WebUiError(404, '页面不存在');
    const name = path === '/' ? 'index.html' : path.slice(1), full = resolve(this.staticDir, name);
    if (!full.startsWith(resolve(this.staticDir) + sep)) throw new WebUiError(404, '页面不存在');
    let content: Buffer;
    try { content = await readFile(full); } catch { throw new WebUiError(404, '前端资源不存在，请先执行 npm run web:build'); }
    const ext = name.split('.').pop()!;
    const mime: Record<string, string> = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', webmanifest: 'application/manifest+json' };
    res.writeHead(200, { 'Content-Type': `${mime[ext] ?? 'application/octet-stream'}; charset=utf-8` }); res.end(content);
  }
  async stop(): Promise<void> {
    this.launchTicket = undefined;
    this.sessions.clear(); this.server.closeAllConnections();
    if (this.server.listening) await new Promise<void>(done => this.server.close(() => done()));
    await this.channel.stop();
  }
}
