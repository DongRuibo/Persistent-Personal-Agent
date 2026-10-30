// macOS日常入口：只复用模型连接字段，数据独立、密钥仅在内存、自动进入原登录流程。
import { createReadStream } from 'node:fs';
import { chmod, lstat, unlink } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createConnection, createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const codeRoot = fileURLToPath(new URL('../', import.meta.url));
process.chdir(codeRoot);
process.umask(0o077);
const mainRoot = dirname(execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim());
const dataDir = resolve(process.env.WEB_UI_DATA_DIR || join(mainRoot, 'data/web-ui'));
const socketPath = join(dataDir, 'launcher.sock');
const noOpen = process.argv.slice(2).includes('--no-open');
let control, input, key = '', serving;
let running = false;

async function openBrowser() {
  const origin = `http://127.0.0.1:${process.env.WEB_UI_PORT}`;
  const response = await fetch(origin + '/api/launch', {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
  });
  if (!response.ok) throw new Error('自动登录入口暂不可用，请检查服务状态。');
  const { url } = await response.json();
  const target = new URL(url);
  if (target.origin !== origin || !/^\/launch\/[a-f0-9]{64}$/u.test(target.pathname) || target.search || target.hash) throw new Error('自动登录地址无效。');
  // 浏览器打开器不继承启动进程中的模型和Web密钥。
  await promisify(execFile)('/usr/bin/open', [url], { env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' } });
}

try {
  if (process.platform !== 'darwin') throw new Error('此入口用于macOS；其他系统请参阅docs/web-app.md。');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 15) throw new Error('需要Node.js 24.15或更新版本。');

  // 再次启动只请求已运行的本机启动器打开页面，不启动第二个Agent或读取模型配置。
  const reused = await new Promise((done, reject) => {
    const socket = createConnection(socketPath);
    socket.setTimeout(10000, () => socket.destroy(new Error('原启动器没有响应，请在原终端核对服务。')));
    socket.once('connect', () => socket.write(noOpen ? 'check' : 'open'));
    socket.once('data', reply => { socket.destroy(); reply.toString() === 'ready' ? done(true) : reject(new Error('页面未能自动打开，请在原终端按回车重试。')); });
    socket.once('error', error => ['ENOENT', 'ECONNREFUSED'].includes(error.code) ? done(false) : reject(error));
  });
  if (reused) console.log('已连接现有Web服务' + (noOpen ? '。' : '并打开工作台。'));
  else {
    if (!process.env.LLM_API_KEY || !process.env.LLM_MODEL) {
      for await (const line of createInterface({ input: createReadStream(join(mainRoot, '.env'), { encoding: 'utf8' }), crlfDelay: Infinity })) {
        const match = /^\s*(?:export\s+)?(LLM_PROVIDER|LLM_MODEL|LLM_BASE_URL|LLM_API_KEY)\s*=\s*(.*)$/u.exec(line);
        if (!match || process.env[match[1]]) continue;
        let value = match[2].trim();
        if (value.length >= 2 && ['"', "'"].includes(value[0]) && value.at(-1) === value[0]) value = value.slice(1, -1);
        else value = value.split(/\s+#/u)[0].trimEnd();
        process.env[match[1]] = value;
      }
    }
    if (!process.env.LLM_API_KEY || !process.env.LLM_MODEL) throw new Error('本机模型配置缺少LLM_API_KEY或LLM_MODEL，请在本机配置，勿发到聊天中。');
    key = randomBytes(32).toString('hex');
    for (const name of ['DATABASE_PATH', 'SESSION_DIR', 'MEMORY_DIR']) delete process.env[name];
    Object.assign(process.env, {
      WEB_UI_ENABLED: 'true', WEB_UI_HOST: '127.0.0.1', WEB_UI_ACCESS_KEY: key, WEB_UI_DATA_DIR: dataDir,
      WEB_UI_PORT: process.env.WEB_UI_PORT || '4317', USER_TIMEZONE: process.env.USER_TIMEZONE || 'Asia/Shanghai',
      GOAL_ENABLED: process.env.GOAL_ENABLED ?? 'true', PROACTIVE_ENABLED: 'false', MEMORY_FORMATION_ENABLED: 'false',
      MEMORY_QUERY_REWRITE: 'false', SKILLS_ENABLED: 'false', WEB_READ_ENABLED: 'false',
      LOCAL_FILES_ENABLED: 'false', LOCAL_FILES_SEARCH_ENABLED: 'false', LOCAL_FILES_WRITE_ENABLED: 'false',
    });
    // import的入口名保持本脚本，避免dist/main.js的直接启动检测造成双启动。
    process.argv = [process.execPath, fileURLToPath(import.meta.url), '--web-ui'];
    const { main } = await import(pathToFileURL(join(codeRoot, 'dist/main.js')).href);
    let failed;
    running = true;
    serving = main().catch(error => { failed = error; }).finally(() => { running = false; });
    const origin = `http://127.0.0.1:${process.env.WEB_UI_PORT}`;
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (failed) throw failed;
      try { if ((await fetch(origin + '/api/session', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* 服务尚在启动。 */ }
      await new Promise(done => setTimeout(done, 100));
    }
    if (!ready) throw new Error('Web服务启动超时。');
    const old = await lstat(socketPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (old) { if (!old.isSocket()) throw new Error('启动器控制路径已有其他文件，不覆盖。'); await unlink(socketPath); }
    control = createServer(socket => {
      socket.setTimeout(10000, () => socket.destroy()); socket.on('error', () => {});
      socket.once('data', async command => {
        try {
          if (command.toString() === 'open') await openBrowser();
          else if (command.toString() !== 'check') { socket.destroy(); return; }
          socket.end('ready');
        } catch { socket.end('error'); }
      });
    });
    await new Promise((done, reject) => { control.once('error', reject); control.listen(socketPath, done); });
    await chmod(socketPath, 0o600);
    console.log(`日常Web工作空间：${dataDir}\n保持此终端运行；按回车重新打开并自动登录，Ctrl+C正常停止。`);
    if (!noOpen) await openBrowser().catch(() => console.error('自动打开浏览器失败；服务已启动，可在此终端按回车重试。'));
    input = createInterface({ input: process.stdin });
    input.on('line', () => { void openBrowser().catch(() => console.error('打开页面失败，请稍后按回车重试。')); });
    input.on('SIGINT', () => { process.emit('SIGINT'); });
    await serving;
    if (failed) throw failed;
  }
} catch (error) {
  let message = error instanceof Error ? error.message : '启动失败。';
  for (const secret of [process.env.LLM_API_KEY, key]) if (secret) message = message.split(secret).join('<REDACTED>');
  console.error(message); process.exitCode = 1;
} finally {
  if (running) { process.emit('SIGINT'); await serving; }
  input?.close();
  if (control) { await new Promise(done => control.close(done)); await unlink(socketPath).catch(() => {}); }
}
