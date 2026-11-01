import { useEffect, useState } from "react";
import type { WorkJob } from "../../src/work-job-types.js";
import type { WebWorkJob } from "../../src/web-ui-types.js";

export function WorkJobs({ api, labels, threadId, revision = 0 }: {
  api: <T>(path: string, body?: unknown) => Promise<T>;
  labels: Record<string, string>; threadId?: string; revision?: number;
}) {
  const [jobs, setJobs] = useState<WorkJob[]>([]), [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<WebWorkJob | null>(null), [error, setError] = useState("");
  const [changing, setChanging] = useState(false), [changed, setChanged] = useState(0);
  useEffect(() => {
    let current = true;
    const load = async () => {
      try {
        const [list, result] = await Promise.all([
          api<WorkJob[]>(threadId ? `/work-threads/${threadId}/jobs` : "/work-jobs"),
          selected ? api<WebWorkJob>(`/work-jobs/${selected}`) : Promise.resolve(null),
        ]);
        if (current) { setJobs(list); setDetail(result); setError(""); }
      } catch (e) { if (current) setError(e instanceof Error ? e.message : "后台工作暂时无法读取"); }
    };
    void load();
    const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 3000);
    return () => { current = false; clearInterval(timer); };
  }, [api, threadId, selected, revision, changed]);
  const view = detail?.id === selected && (!threadId || detail.threadId === threadId) ? detail : null;
  return <section className="work-jobs" aria-label="后台工作">
    <h2>后台工作 <small className="muted">最近 100 项</small></h2>
    {error && <p role="alert" className="error">{error}</p>}
    {!jobs.length && <p className="muted">选择主题并提交“后台处理”后，可在这里查看进度和结果。</p>}
    {jobs.filter(job => !threadId || job.threadId === threadId).map(job => <article key={job.id}>
      <div className="work-job-heading"><strong>{job.instruction.slice(0, 120)}</strong>
        <span className={"badge " + job.status}>{labels[job.status] ?? job.status}</span></div>
      <p className="muted">工作 {job.id.slice(0, 8)} · {new Date(job.createdAt).toLocaleString("zh-CN")}</p>
      <div className="work-job-actions">
        <button onClick={() => setSelected(selected === job.id ? "" : job.id)}>{selected === job.id ? "收起结果" : "查看结果"}</button>
        {(job.status === "queued" || job.status === "running") && <button disabled={changing} onClick={() => {
          setChanging(true); setError("");
          void api(`/work-jobs/${job.id}/cancel`, {}).then(() => setChanged(v => v + 1))
            .catch((e: Error) => setError(e.message)).finally(() => setChanging(false));
        }}>取消工作</button>}
      </div>
      {selected === job.id && (view ? <div className="work-job-result">
        <p className="muted">主题 {view.threadId.slice(0, 8)} · 工作 ID：{view.id}</p>
        <p>本次输入：{view.instruction}</p>
        {view.run ? <>
          <p className="muted">Run {view.run.id.slice(0, 8)} · {view.run.usage.calls} 次模型响应</p>
          <div className="work-job-output">{view.run.output ?? view.run.error ?? "正在处理本次文字…"}</div>
          {view.run.deliveryError && <p className="error">{view.run.deliveryError}</p>}
        </> : <p className="muted">{view.status === "cancelled" ? "已在执行前取消。" : "已排队，等待执行。"}</p>}
      </div> : <p className="muted">正在读取…</p>)}
    </article>)}
  </section>;
}
