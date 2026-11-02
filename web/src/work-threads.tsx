import { useEffect, useRef, useState } from "react";
import { FolderOpen, Plus, RefreshCw } from "lucide-react";
import type { WorkObject, WorkObjectKind, WorkThread, WorkThreadDetail } from "../../src/work-thread-types.js";

import { WorkRecall } from "./work-recall.js";
import { WorkEvents } from "./work-events.js";
import { WorkJobs } from "./work-jobs.js";

const kinds: Record<WorkObjectKind, string> = { task: "任务", goal: "目标", run: "执行记录", memory: "记忆" };

export function WorkThreads({ api, labels, workJobs = false, workEvents = false, workRecall = false, openGoal, openFile }: {
  api: <T>(path: string, body?: unknown) => Promise<T>;
  labels: Record<string, string>; workJobs?: boolean; workEvents?: boolean; workRecall?: boolean; openGoal: (id: string) => void; openFile?: (id: string) => void;
}) {
  const [threads, setThreads] = useState<WorkThread[]>([]);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<WorkThreadDetail | null>(null);
  const [newTitle, setNewTitle] = useState(""), [title, setTitle] = useState("");
  const [kind, setKind] = useState<WorkObjectKind>("task");
  const [objects, setObjects] = useState<WorkObject[]>([]), [objectId, setObjectId] = useState("");
  const [revision, setRevision] = useState(0), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const createId = useRef<string | undefined>(undefined);

  useEffect(() => {
    let current = true;
    setBusy(true); setError("");
    void Promise.all([
      api<WorkThread[]>("/work-threads"),
      selected ? api<WorkThreadDetail>(`/work-threads/${selected}`) : Promise.resolve(null),
      selected ? api<WorkObject[]>(`/work-objects/${kind}`) : Promise.resolve([]),
    ]).then(([list, view, candidates]) => {
      if (!current) return;
      setThreads(list); setDetail(view); setTitle(view?.title ?? ""); setObjects(candidates); setObjectId("");
    }).catch((e: Error) => { if (current) setError(e.message); })
      .finally(() => { if (current) setBusy(false); });
    return () => { current = false; };
  }, [api, selected, kind, revision]);

  async function change(path: string, body: unknown, createdId?: string) {
    setBusy(true); setError("");
    try {
      await api(path, body);
      if (createdId) { setSelected(createdId); setNewTitle(""); createId.current = undefined; }
      setRevision(v => v + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "操作失败"); setBusy(false); }
  }
  const view = detail?.id === selected ? detail : null;
  const available = objects.filter(o => !view?.links.some(link => link.kind === kind && link.objectId === o.id));

  return <>
    <div className="page-heading">
      <div><span className="eyebrow">WORK THREADS</span><h1>围绕一个主题，找到相关工作</h1>
        <p>手动整理当前工作空间的目标、任务、执行记录与记忆。</p></div>
      <button disabled={busy} onClick={() => setRevision(v => v + 1)}><RefreshCw size={16} />刷新主题</button>
    </div>
    {error && <p className="error work-thread-error" role="alert">{error}</p>}
    <div className="work-thread-layout" aria-busy={busy}>
      <section className="panel work-thread-list" aria-label="工作主题列表">
        <form className="work-thread-create" onSubmit={e => {
          e.preventDefault(); createId.current ??= crypto.randomUUID();
          void change("/work-threads", { id: createId.current, title: newTitle.trim() }, createId.current);
        }}>
          <label htmlFor="thread-new-title">新建工作主题</label>
          <input id="thread-new-title" value={newTitle} maxLength={120} placeholder="例如：准备下一次产品发布"
            onChange={e => { setNewTitle(e.target.value); createId.current = undefined; }} disabled={busy} required />
          <button className="primary" disabled={busy || !newTitle.trim()}><Plus size={16} />创建主题</button>
        </form>
        <div className="work-thread-items">
          {threads.map(thread => <button key={thread.id} disabled={busy} aria-pressed={thread.id === selected}
            onClick={() => setSelected(thread.id)} className={thread.id === selected ? "selected" : ""}>
            <FolderOpen size={17} /><span><strong>{thread.title}</strong><small>{thread.status === "active" ? "进行中" : "已归档"}</small></span>
          </button>)}
          {!busy && !threads.length && <p className="muted">还没有工作主题。创建后，可把相关工作放在一起。</p>}
        </div>
      </section>
      <section className="panel work-thread-detail" aria-label="工作主题详情">
        {!view ? <div className="empty"><FolderOpen size={28} /><h3>{busy ? "正在加载主题…" : "选择一个工作主题"}</h3>
          <p>关联只用于整理和查找，不会执行或修改原对象。</p></div> : <>
          <form className="work-thread-title" onSubmit={e => { e.preventDefault(); void change(`/work-threads/${view.id}`, { title: title.trim() }); }}>
            <label htmlFor="thread-title">主题名称</label>
            <div><input id="thread-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} disabled={busy} required />
              <button disabled={busy || !title.trim() || title.trim() === view.title}>保存名称</button></div>
          </form>
          <div className="work-thread-meta"><span>{view.status === "active" ? "进行中" : "已归档"} · 更新于 {new Date(view.updatedAt).toLocaleString("zh-CN")}</span>
            <button disabled={busy} onClick={() => void change(`/work-threads/${view.id}`, { status: view.status === "active" ? "archived" : "active" })}>
              {view.status === "active" ? "归档主题" : "恢复主题"}</button></div>
          <p className="muted work-thread-id">主题 ID：{view.id}</p>
          <p className="muted">归档主题不会暂停任务或目标；移除关联不会删除原对象。</p>
          {view.status === "active" && <form className="work-thread-link" onSubmit={e => {
            e.preventDefault(); void change(`/work-threads/${view.id}/links`, { kind, objectId, action: "link" });
          }}>
            <h2>添加关联</h2>
            <div><label>对象类型<select value={kind} disabled={busy} onChange={e => { setKind(e.target.value as WorkObjectKind); setObjectId(""); }}>
              {Object.entries(kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
              <label className="work-thread-object">选择已有对象<select value={objectId} disabled={busy} onChange={e => setObjectId(e.target.value)} required>
                <option value="">{available.length ? "请选择关联对象" : "暂无可关联的对象"}</option>
                {available.map(object => <option key={object.id} value={object.id}>{object.title} · {object.id.slice(0, 8)}</option>)}
              </select></label>
              <button disabled={busy || !objectId}>添加关联</button></div>
            <p className="muted">每类展示至多 100 项。记忆仅包含来源可确认属于本工作空间的条目。</p>
          </form>}
          {workRecall && openFile && <WorkRecall key={`recall:${view.id}`} api={api} thread={view} openGoal={openGoal} openFile={openFile} />}
          {workEvents && <WorkEvents key={`events:${view.id}`} api={api} thread={view} openGoal={openGoal} />}
          {workJobs && <WorkJobs api={api} labels={labels} threadId={view.id} />}
          <div className="work-thread-links"><h2>关联对象 <span className="muted">{view.links.length}</span></h2>
            {!view.links.length && <p className="muted">尚无关联。选择一个已有对象开始整理。</p>}
            {view.links.map(link => <article key={`${link.kind}:${link.objectId}`}>
              <div><small>{kinds[link.kind]} · {link.object ? labels[link.object.status] ?? link.object.status : "不可用"}</small>
                <h3>{link.object?.title ?? "对象已删除、停用或不再可访问"}</h3><p className="muted">{link.objectId}</p></div>
              <button disabled={busy} aria-label={`移除关联：${link.object?.title ?? link.objectId}`} onClick={() => void change(`/work-threads/${view.id}/links`,
                { kind: link.kind, objectId: link.objectId, action: "unlink" })}>移除关联</button>
            </article>)}
          </div>
        </>}
      </section>
    </div>
  </>;
}
