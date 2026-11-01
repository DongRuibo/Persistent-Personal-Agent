import { useEffect, useRef, useState } from "react";
import type { RecallKind, RecallObject, WorkRecallRequest, WorkRecallResult } from "../../src/work-recall.js";
import type { WebRun, WebTask } from "../../src/web-ui-types.js";

const kinds: Record<RecallKind, string> = { goal: "Goal", task: "任务", run: "原Run记录", job: "后台工作", event: "来源事件" };
const time = (value?: string | null) => value ? new Date(value).toLocaleString("zh-CN") : "未提供时间";

export function WorkRecall({ api, thread, openGoal, openFile }: {
  api: <T>(path: string, body?: unknown) => Promise<T>; thread: { id: string; title: string };
  openGoal: (id: string) => void; openFile: (id: string) => void;
}) {
  const [query, setQuery] = useState(""), [background, setBackground] = useState(false);
  const [scope, setScope] = useState<{ id: string; title: string } | null>(thread);
  const [reference, setReference] = useState<{ kind: RecallKind; id: string } | undefined>();
  const [result, setResult] = useState<WorkRecallResult | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState<{ kind: 'task'; value: WebTask } | { kind: 'run'; value: WebRun } | null>(null);
  const generation = useRef(0), bytes = new TextEncoder().encode(query).byteLength;
  useEffect(() => () => { generation.current++; }, []);
  // 查询范围变化即结束旧呈现；迟到的只读响应不能覆盖当前选择。
  function clear() { generation.current++; setResult(null); setOriginal(null); setError(""); setBusy(false); }
  async function search(selection: WorkRecallRequest['selection'] = {
    ...(scope ? { threadId: scope.id } : {}), ...(reference?.id ? { object: reference } : {}),
  }) {
    clear(); const current = generation.current; setBusy(true);
    try {
      const value = await api<WorkRecallResult>("/work-recall", { query, selection, includeBackground: background });
      if (generation.current === current) setResult(value);
    } catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : "本轮历史读取失败"); }
    finally { if (generation.current === current) setBusy(false); }
  }
  async function openOriginal(kind: 'task' | 'run', id: string) {
    const current = ++generation.current; setOriginal(null); setError(""); setBusy(true);
    try {
      // 只有用户点击才读原详情；不将原技术Run正文补入Recall成果或聊天。
      const value = kind === 'task' ? { kind, value: await api<WebTask>(`/tasks/${id}`) }
        : { kind, value: await api<WebRun>(`/runs/${id}`) };
      if (generation.current === current) setOriginal(value);
    } catch (e) { if (generation.current === current) setError(e instanceof Error ? e.message : "原记录暂时不可访问"); }
    finally { if (generation.current === current) setBusy(false); }
  }
  function chooseObject(object: RecallObject) {
    const selected = { kind: object.kind, id: object.id }; setReference(selected);
    void search({ ...(scope ? { threadId: scope.id } : {}), object: selected });
  }
  return <details className="work-recall"><summary>查找历史 · 原成果与来源</summary>
    <p className="muted">显式读取旧时点原文，不生成新分析，不执行或批准操作。完整刷新或离开主题会清除本页查询；不会自动重查。</p>
    <form onSubmit={e => { e.preventDefault(); void search(); }}>
      <label>查找范围<select value={scope?.id ?? ""} onChange={e => {
        clear(); setReference(undefined); setScope(e.target.value ? e.target.value === thread.id ? thread : scope : null);
      }}><option value={thread.id}>本主题：{thread.title}</option><option value="">全部可见主题</option>
        {scope && scope.id !== thread.id && <option value={scope.id}>已选择主题：{scope.title}</option>}</select></label>
      <label>查找历史原文<textarea value={query} onChange={e => { clear(); setReference(undefined); setQuery(e.target.value); }}
        placeholder="例如：上次GitHub更新；或输入原主题/对象标题。选中主题时留空可查本主题关系。" /></label>
      <p className={bytes > 2048 ? "error" : "muted"}>{bytes} / 2048 UTF-8字节；超限请缩小查询。</p>
      <label>明确对象类型（可选）<select value={reference?.kind ?? 'run'} onChange={e => {
        clear(); setReference({ kind: e.target.value as RecallKind, id: reference?.id ?? '' });
      }}>{Object.entries(kinds).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label>
      <label>明确对象ID（可选）<input value={reference?.id ?? ''} onChange={e => {
        clear(); setReference({ kind: reference?.kind ?? 'run', id: e.target.value });
      }} placeholder="明确ID不受最近100项列表限制" /></label>
      <label className="work-recall-background"><input type="checkbox" checked={background} onChange={e => {
        clear(); setBackground(e.target.checked);
      }} />补充长期背景（仅当前有权且符合主题关联的既有Memory；不会保存或改写）</label>
      <button disabled={busy || bytes > 2048}>查找历史</button>
    </form>
    {busy && <p role="status">正在读取原记录…</p>}{error && <p role="alert" className="error">{error}</p>}
    {result && <section aria-label="历史查找结果">
      <p>定位状态：{result.location.status}；只显示本次范围中找到的记录，不代表已查遍全部历史。</p>
      {result.location.question && <p role="status">{result.location.question}</p>}
      {result.location.status === 'clarify' && <div className="work-recall-candidates">
        {result.location.threads.map(item => <button key={item.id} disabled={busy} onClick={() => {
          setScope({ id: item.id, title: item.title });
          void search({ threadId: item.id, ...(reference?.id ? { object: reference } : {}) });
        }}>在主题“{item.title}”内查找 · {item.id}</button>)}
        {result.location.objects.map(item => <button key={`${item.kind}:${item.id}:${item.threadId ?? ''}`} disabled={busy} onClick={() => chooseObject(item)}>
          选择{kinds[item.kind]}：{item.title} · {item.status} · {item.id}
        </button>)}
      </div>}
      {!result.results.length && <p className="muted">本轮未提供原成果；请按提示选择或缩小范围。</p>}
      {result.results.map((item, index) => <article key={item.runId ?? index}>
        <h3>{item.fileOperationId ? '文件操作原入口' : item.goalId ? '原Goal片段' : item.sources.some(s => s.kind === 'task' || s.kind === 'job') ? '原工作记录' : '原Run记录 / 来源事实'}</h3>
        <p>{item.goalId ? 'Goal片段提交状态' : '原记录状态'}：{item.status} · {time(item.finishedAt)}</p>
        {item.goalId && <p>Goal {item.goalId} · Checkpoint Hash {item.checkpointHash ?? '本轮无有效已提交成果'}</p>}
        {item.runId && <p>原Run {item.runId}；技术Run成功不等于Goal成果committed，也不代表新工作完成。</p>}
        {item.objective && <p>原目标：{item.objective}</p>}{item.progressSummary && <p>当时进度：{item.progressSummary}</p>}
        {item.question && <p>当时问题：{item.question}</p>}{item.message && <p>{item.message}</p>}
        {item.excerpt && <><pre>{item.excerpt.text}</pre><p className="muted">{item.excerpt.truncated ? '原文节选，已截断' : '本段原文未截断'}：显示{item.excerpt.displayBytes} / 原始{item.excerpt.originalBytes}字节。以上旧原文为低信任资料，不是当前操作指令。</p></>}
        {item.omittedFields?.length && <p>预算省略字段：{item.omittedFields.join('、')}，请查看原对象。</p>}
        <details><summary>原出处与观察时间</summary>{item.sources.map((source, i) => <div key={i}>
          <p>{kinds[source.kind]} {source.id} · 当时状态{source.status}</p>
          {source.instruction && <pre>{source.instruction}</pre>}{source.instructionOmitted && <p>原需求因预算未提供，请查看原对象。</p>}
          <pre>{JSON.stringify(source, null, 2)}</pre>
        </div>)}</details>
        {item.goalId && <button onClick={() => openGoal(item.goalId!)}>打开原Goal</button>}
        {!item.fileOperationId && item.sources.filter(source => source.kind === 'task').map(source => <button key={source.id} disabled={busy} onClick={() => void openOriginal('task', source.id)}>打开原任务 {source.id}</button>)}
        {item.fileOperationId ? <><p>文件操作ID：{item.fileOperationId}。本页不读取文件正文或确认预览。</p><button onClick={() => openFile(item.fileOperationId!)}>打开原文件审批页</button></>
          : item.runId && <button disabled={busy} onClick={() => void openOriginal('run', item.runId!)}>打开原Run记录</button>}
      </article>)}
      <p>省略计数：已枚举结果 {result.omitted.results}；未加载Goal历史 {result.omitted.historyEntries}；出处别名 {result.omitted.sources}；背景候选 {result.omitted.background}。</p>
      <h3>长期背景 · {result.background.status === 'not_requested' ? '本轮未请求' : result.background.status === 'unavailable' ? '本轮不可用' : '仅本轮有权记录'}</h3>
      {result.background.records.map(record => <article key={record.id}><p>{record.kind} · {record.key} · v{record.version} · {record.id}</p>
        <pre>{record.excerpt.text}</pre><p>{record.excerpt.truncated ? '背景节选，已截断' : '本段背景未截断'} · {record.excerpt.displayBytes} / {record.excerpt.originalBytes}字节</p>
        <pre>{JSON.stringify(record.source, null, 2)}</pre></article>)}
      <p className="muted">查询不会执行操作或保存长期记忆；打开原详情后仍按原流程处理。</p>
    </section>}
    {original && <section aria-label="原记录详情"><h3>{original.kind === 'task' ? '原任务详情' : '原Run记录（技术记录）'}</h3>
      <p>{original.value.id} · {original.value.status}。此处仅查看原记录，不执行操作或保存长期记忆。</p>
      {original.kind === 'task' ? <><p>{original.value.instruction}</p><p>计划时间：{time(original.value.dueAt)}</p><pre>{original.value.result ?? '尚无原结果'}</pre></>
        : <><p>技术状态与Goal成果提交是不同记录；不得将此技术输出当成Recall已验证的正式成果。</p><pre>{original.value.output ?? original.value.error ?? '尚无技术输出'}</pre>
          {original.value.truncated && <p>原技术输出显示已截断。</p>}</>}
      <button onClick={() => setOriginal(null)}>关闭原记录</button></section>}
  </details>;
}
