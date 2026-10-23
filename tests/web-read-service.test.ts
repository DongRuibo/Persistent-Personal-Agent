import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createServer, request } from 'node:https';
import type { RequestOptions } from 'node:https';
import { createServer as createHttpServer, setGlobalProxyFromEnv } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { readConfig } from '../src/config.js';
import { webResource } from '../src/web-read-types.js';
import { NodeWebTransport, publicWebAddress, WebReadService } from '../src/web-read-service.js';

const resource = webResource({ id: 'test-doc', title: '虚构文档', aliases: ['虚构文档'], url: 'https://docs.example.test/ok.md', version: '1', enabled: true });
const signal = () => new AbortController().signal;

test('固定Web目录验证HTTPS、URL权限、ID/Hash/禁用/重复与副本隔离', async () => {
  assert.equal(readConfig({}).webReadEnabled, false); assert.throws(() => readConfig({ WEB_READ_ENABLED: 'yes' }), /WEB_READ_ENABLED/);
  for (const url of ['http://docs.example.test/a.md', 'https://127.0.0.1/a.md', 'https://localhost/a.md', 'https://docs.example.test:444/a.md',
    'https://u:p@docs.example.test/a.md', 'https://docs.example.test/a.md?q=private', 'https://docs.example.test/a.md#x', 'https://docs.example.test/a.html']) {
    assert.throws(() => webResource({ ...resource, url }), /Web资源/);
  }
  assert.throws(() => new WebReadService([{ ...resource, hash: '0'.repeat(64) }]), /Hash/);
  assert.throws(() => new WebReadService([resource, resource]), /冲突/);
  const service = new WebReadService([resource]); const list = service.list(); list[0]!.enabled = false;
  assert.equal(service.current(resource.id).enabled, true);
  assert.throws(() => service.current('unknown'), /未批准/);
  assert.throws(() => service.current(resource.id, 'bad'), /版本/);
  const disabled = webResource({ ...resource, enabled: false });
  assert.throws(() => new WebReadService([disabled]).current(resource.id), /禁用/);
});

test('DNS分类拒绝特殊IPv4/IPv6、编码、映射和混合结果，公网必须全部有效', async t => {
  for (const address of ['0.0.0.0', '10.0.0.1', '100.64.0.1', '127.1.1.1', '169.254.169.254', '172.31.0.1', '192.168.1.1', '192.0.0.9',
    '192.0.2.1', '198.19.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '2130706433', '0177.0.0.1',
    '::', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:8.8.8.8', '64:ff9b::808:808', '2001:db8::1', '2002::1', '3fff::1']) {
    await t.test(address, () => assert.equal(publicWebAddress({ address, family: address.includes(':') ? 6 : 4 }), false));
  }
  assert.equal(publicWebAddress({ address: '8.8.8.8', family: 4 }), true);
  assert.equal(publicWebAddress({ address: '2606:4700:4700::1111', family: 6 }), true);
  assert.equal(publicWebAddress({ address: '8.8.8.8', family: 6 }), false);
  let requests = 0;
  for (const addresses of [[], [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]]) {
    const service = new WebReadService([resource], async () => addresses, { get: async () => { requests++; return Buffer.from('never'); } });
    await assert.rejects(service.fetch(resource.id, resource.hash, signal()), /DNS/);
  }
  assert.equal(requests, 0);
});

test('DNS只解析一次并固定连接地址；取消/超时/无效正文保守失败', async () => {
  let resolutions = 0, gets = 0;
  const service = new WebReadService([resource], async () => ++resolutions === 1 ? [{ address: '8.8.8.8', family: 4 }] : [{ address: '127.0.0.1', family: 4 }], {
    get: async target => { gets++; assert.equal(target.address.address, '8.8.8.8'); assert.equal(target.url, resource.url); return Buffer.from('虚构正文'); },
  });
  const snapshot = await service.fetch(resource.id, resource.hash, signal());
  assert.equal(resolutions, 1); assert.equal(gets, 1); assert.equal(snapshot.bytes, Buffer.byteLength(snapshot.text)); assert.equal(snapshot.contentHash.length, 64);
  for (const body of [Buffer.from([0xff]), Buffer.alloc(32769), Buffer.from('bad\u0000text'), Buffer.alloc(0)]) {
    await assert.rejects(new WebReadService([resource], async () => [{ address: '8.8.8.8', family: 4 }], { get: async () => body }).fetch(resource.id, resource.hash, signal()));
  }
  let calls = 0;
  const slow = new WebReadService([resource], () => new Promise(() => {}), { get: async () => { calls++; return Buffer.from('never'); } }, 15);
  // AbortSignal.timeout不会独自维持进程；本机测试保持一个有界计时器。
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(slow.fetch(resource.id, resource.hash, signal())); assert.equal(calls, 0); }
  finally { clearTimeout(keepAlive); }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(service.fetch(resource.id, resource.hash, controller.signal)); assert.equal(gets, 1);
});

test('真实本机TLS：证书链/主机名、固定请求头、重定向、类型/压缩、慢流及容量', async () => {
  const cert = readFileSync('tests/fixtures/web-tls/test-cert.pem'), key = readFileSync('tests/fixtures/web-tls/test-key.pem');
  let requests = 0;
  const server = createServer({ cert, key }, (req, res) => {
    requests++; assert.equal(req.method, 'GET'); assert.equal(req.headers.authorization, undefined); assert.equal(req.headers.cookie, undefined);
    assert.equal(req.headers['accept-encoding'], 'identity');
    if (req.url === '/redirect.md') { res.writeHead(302, { Location: 'https://127.0.0.1/private' }); res.end(); return; }
    if (req.url === '/large.md') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('x'.repeat(32769)); return; }
    if (req.url === '/length.md') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': '32769' }); res.end(); return; }
    if (req.url === '/html.md') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('html'); return; }
    if (req.url === '/gzip.md') { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' }); res.end('not supported'); return; }
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' }); res.write('虚构');
    if (req.url !== '/slow.md') res.end('正文');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = (path: string, host = 'docs.example.test') => `https://${host}:${address.port}/${path}.md`;
  const target = (path: string, host?: string) => ({ url: url(path, host), address: { address: '127.0.0.1', family: 4 } });
  const trustedRequest = ((input: URL, options: RequestOptions, callback: (res: IncomingMessage) => void) => request(input, { ...options, ca: cert }, callback)) as typeof request;
  const transport = new NodeWebTransport(trustedRequest);
  let proxies = 0;
  const proxy = createHttpServer((_req, res) => { proxies++; res.writeHead(403); res.end(); });
  proxy.on('connect', (_req, socket) => { proxies++; socket.destroy(); });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening'); const proxyAddress = proxy.address(); assert.ok(proxyAddress && typeof proxyAddress !== 'string');
  const restoreProxy = setGlobalProxyFromEnv({ HTTP_PROXY: `http://127.0.0.1:${proxyAddress.port}`, HTTPS_PROXY: `http://127.0.0.1:${proxyAddress.port}` });
  try {
    assert.equal((await transport.get(target('ok'), signal())).toString(), '虚构正文');
    await assert.rejects(new NodeWebTransport().get(target('ok'), signal()), /self.signed|certificate/iu);
    await assert.rejects(transport.get(target('ok', 'other.example.test'), signal()), /hostname|altname|certificate/iu);
    for (const path of ['redirect', 'html', 'gzip', 'large', 'length']) await assert.rejects(transport.get(target(path), signal()), /Web/);
    await assert.rejects(transport.get(target('slow'), AbortSignal.timeout(35)));
    assert.equal(requests, 7, 'TLS失败不发送GET，重定向不跟随，其他每次仅一个GET');
    assert.equal(proxies, 0, '自有Agent不继承环境或全局代理');
  } finally { restoreProxy(); server.closeAllConnections(); proxy.closeAllConnections(); await Promise.all([
    new Promise<void>(done => server.close(() => done())), new Promise<void>(done => proxy.close(() => done())),
  ]); }
});
