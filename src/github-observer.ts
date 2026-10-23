export interface GitHubWatch { kind: 'github'; repository: string; branch: string; intervalSeconds: number }
export interface GitHubSnapshot {
  head: string; commits: { sha: string; message: string; url: string }[];
  changes: { filename: string; status: string; additions: number; deletions: number; patch?: string }[];
}
export function validateWatch(watch: GitHubWatch): void {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(watch.repository)
    || typeof watch.branch !== 'string' || !watch.branch.trim() || Buffer.byteLength(watch.branch) > 200 || /[\s\x00-\x1f]/u.test(watch.branch)
    || !Number.isSafeInteger(watch.intervalSeconds) || watch.intervalSeconds < 60 || watch.intervalSeconds > 86400) throw new Error('GitHub需明确仓库/分支，观察间隔60至86400秒');
}
// 固定只读 GitHub API；本机服务注入仅供隔离测试，不接收模型或用户提供的任意 URL。
export class GitHubObserver {
  constructor(private readonly base = 'https://api.github.com') {
    const url = new URL(base);
    if (base !== 'https://api.github.com' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname) && url.pathname === '/'
      && !url.username && !url.password && !url.search && !url.hash)) throw new Error('Observer仅允许GitHub或显式本机测试服务');
  }
  private async read(path: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(this.base.replace(/\/$/u, '') + path, { method: 'GET', redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Personal-Agent-Observer' } });
    if (!response.ok || !response.body) throw new Error(`GitHub观察失败HTTP${response.status}`);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
        if (size > 65536) throw new Error('GitHub观察响应超过64KiB'); chunks.push(item.value); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally { await reader.cancel().catch(() => {}); }
  }
  async poll(watch: GitHubWatch, previous: string | null, signal: AbortSignal): Promise<GitHubSnapshot> {
    validateWatch(watch);
    const prefix = '/repos/' + watch.repository;
    const data = await this.read(`${prefix}/commits?sha=${encodeURIComponent(watch.branch)}&per_page=20`, signal);
    if (!Array.isArray(data) || data.length < 1 || data.length > 20) throw new Error('GitHub提交列表无效');
    const commits = data.map(item => {
      if (!item || !/^[a-f0-9]{40}$/u.test(item.sha) || typeof item.commit?.message !== 'string' || Buffer.byteLength(item.commit.message) > 4096) throw new Error('GitHub提交字段无效');
      return { sha: item.sha as string, message: item.commit.message as string, url: `https://github.com/${watch.repository}/commit/${item.sha}` };
    });
    if (new Set(commits.map(item => item.sha)).size !== commits.length) throw new Error('GitHub列表有重复SHA');
    const head = commits[0]!.sha;
    const changes: GitHubSnapshot['changes'] = [];
    if (previous && previous !== head) {
      const offset = commits.findIndex(item => item.sha === previous);
      if (offset < 0) throw new Error('提交窗口无法衔接旧游标，需用户核对；不猜测或回放');
      const compare = await this.read(`${prefix}/compare/${previous}...${head}`, signal) as { status?: unknown; files?: unknown };
      if (!['ahead', 'identical'].includes(String(compare?.status)) || !Array.isArray(compare.files) || compare.files.length > 100) throw new Error('提交比较无法核对或过大');
      for (const item of compare.files) {
        if (typeof item.filename !== 'string' || Buffer.byteLength(item.filename) > 512 || typeof item.status !== 'string'
          || !Number.isSafeInteger(item.additions) || item.additions < 0 || !Number.isSafeInteger(item.deletions) || item.deletions < 0
          || item.patch !== undefined && (typeof item.patch !== 'string' || Buffer.byteLength(item.patch) > 8192)) throw new Error('GitHub差异字段无效或超限');
        changes.push({ filename: item.filename, status: item.status, additions: item.additions, deletions: item.deletions, ...(item.patch ? { patch: item.patch } : {}) });
      }
      commits.splice(offset);
    }
    const snapshot = { head, commits, changes };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 10000) throw new Error('GitHub变化快照超过10KiB；需缩小观察范围');
    return snapshot;
  }
}
