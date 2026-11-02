import type { WebWorkRoute } from "../../src/web-ui-types.js";
import type { WorkThread } from "../../src/work-thread-types.js";

export function WorkRouteCard({ view, threads, active, invalid, changing, onRevoke, onConfirm, onChat }: {
  view: WebWorkRoute; threads: WorkThread[]; active: boolean; invalid: boolean; changing: boolean;
  onRevoke: () => void; onConfirm: () => void; onChat: () => void;
}) {
  const result = view.suggestion, stale = view.revoked || invalid;
  const threadId = result && "threadId" in result ? result.threadId : view.selection.threadId;
  const thread = threads.find(item => item.id === threadId);
  const title = view.job ? "已提交后台工作" : view.revoked ? "建议已撤销" : invalid ? "本地已失效，撤销待确认" : !active ? "历史建议（只读）" : view.run.status === "running" ? "正在形成建议"
    : result ? "路由建议已形成" : "未形成建议";
  return <article className="work-route-card" aria-label="路由建议">
    <div className="work-job-heading"><strong>{title}</strong><span className={"badge " + (view.revoked ? "cancelled" : invalid ? "uncertain" : view.run.status)}>{view.job ? "已有工作收据" : invalid && !view.revoked ? "撤销待确认" : !active ? "只读历史" : "仅为建议"}</span></div>
    <details open><summary>本次完整原文</summary><div className="work-route-original">{view.text}</div></details>
    {threadId && <p className="muted">{thread ? `候选主题：${thread.title}` : `主题当前不可用：${threadId}`}</p>}
    {result && <p>{result.kind === "clarify" ? result.question : result.reason}</p>}
    {result?.kind === "existing_task" && <p className="muted">任务 {result.taskId}；操作仍由原聊天授权入口判断。</p>}
    {result?.kind === "existing_goal" && <p className="muted">目标 {result.goalId}；查看和建议不代表批准或继续。</p>}
    {view.error && <p className="error">{view.error}</p>}
    {stale && !view.revoked && <p className="muted">本地输入已变化，等待服务端撤销确认。</p>}
    {!active && !stale && !view.job && <p className="muted">历史建议只读；如需处理，可将原文放回输入框后重新请求建议。</p>}
    {view.job ? <p className="work-job-receipt" role="status">真实工作收据：{view.job.status} · 工作 {view.job.id} · 主题 {view.job.threadId}。进度和取消见后台工作列表。</p>
      : <div className="work-job-actions">
        {result?.kind === "work" && <button disabled={!active || stale || changing || view.run.status !== "succeeded"} onClick={onConfirm}>确认该原文后台处理</button>}
        {result && result.kind !== "clarify" && <button disabled={changing} onClick={onChat}>原文放回聊天输入框</button>}
        {!view.revoked && <button disabled={changing} onClick={onRevoke}>撤销建议</button>}
      </div>}
    <small className="run-meta">建议 {view.requestId} · 已记录 {view.run.usage.calls} 次路由模型响应；建议不授予任何任务或记忆操作权限。</small>
  </article>;
}
