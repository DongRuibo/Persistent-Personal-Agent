import { useState } from 'react';
import type { WebRun } from '../../src/web-ui-types.js';

export function WebSources({ run, load }: { run: WebRun; load: () => Promise<WebRun> }) {
  const [detail, setDetail] = useState<WebRun | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  if (!run.web) return null;
  const summary = run.web;
  const sources = new Map(detail?.webCalls?.flatMap(call => call.sources.map(source => [source.url, { ...source, at: call.fetchedAt ?? call.at }] as const)) ?? []);
  async function readSources() {
    setBusy(true); setError('');
    try { setDetail(await load()); }
    catch { setError('暂时无法加载来源；可以重新展开，不会重发搜索。'); }
    finally { setBusy(false); }
  }
  return <div className="web-sources">
    <p className={summary.status === 'failed' ? 'error' : 'muted'} role="status">
      {summary.status === 'running' ? summary.kind === 'search' ? '正在搜索网页…' : '正在读取网页…'
        : summary.message ?? (run.status === 'running' ? '已取得网页资料，正在整理回答…'
          : `已搜索 ${summary.searches} 次 · 读取 ${summary.reads} 页 · ${summary.sources} 个来源`)}
    </p>
    {run.status !== 'running' && <details onToggle={event => {
      if (event.currentTarget.open && !detail && !busy) void readSources();
    }}>
      <summary>查看网页来源（{summary.sources}）</summary>
      {busy && <p className="muted">正在加载来源…</p>}
      {error && <p className="error">{error}</p>}
      {[...sources.values()].length > 0 && <ul>{[...sources.values()].map(source => <li key={source.url}>
        <a href={source.url} target="_blank" rel="noreferrer noopener">{source.title}</a>
        <small> · {new Date(source.at).toLocaleString()}</small>
      </li>)}</ul>}
      {detail?.webCalls?.filter(call => call.message).map(call => <p key={call.id} className={call.status === 'failed' ? 'error' : 'muted'}>{call.message}</p>)}
      {detail?.webCalls?.some(call => call.truncated) && <p className="muted">部分网页资料为节选，回答并未获得未显示的全文。</p>}
    </details>}
  </div>;
}
