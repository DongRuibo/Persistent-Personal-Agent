import type { WebRun } from '../../src/web-ui-types.js';
import type { Goal } from '../../src/goal-types.js';
import type { GoalPolicy, WebPolicyRequest, WebPolicyReceipt } from '../../src/goal-policy-types.js';
import { useEffect, useRef, useState } from "react";
import type { EventSource, SourceEventDetail, WorkEventFeed, SubscriptionView } from "../../src/source-event-types.js";
import type { WorkThreadDetail } from "../../src/work-thread-types.js";

const reasons: Record<string, string> = {
  policy_dispatched: "已交原Goal执行链", busy: "原Goal忙碌，本事件不排队或重放", expired: "策略已过期", goal_changed: "Goal或Plan版本已变化",
  source_or_subscription_paused: "来源、订阅或主题已暂停", source_scope_mismatch: "批准范围与来源不一致", source_binding_invalid: "来源绑定无效",
  snapshot_hash_invalid: "快照Hash错误，已阻止执行", goal_not_eligible: "Goal当前需要用户处理", user_pause: "策略已暂停", user_revoke: "策略已撤销",
  budget_or_rate_unavailable: "费率或次数/预算限额不可用", execution_requires_user_or_stopped: "原执行需要用户反馈或已停止",
  no_policy: "仅观察，未授权执行", source_paused: "来源观察已暂停", thread_archived: "主题已归档",
  target_unavailable: "主题或Goal不可访问", goal_unlinked: "Goal关联已移除", subscription_changed: "订阅版本已变化",
  subscription_paused: "订阅已暂停", policy_not_enabled: "执行入口尚未开放", thread_unavailable: "主题不可用",
};

export function WorkEvents({ api, thread, openGoal }: {
  api: <T>(path: string, body?: unknown) => Promise<T>; thread: WorkThreadDetail; openGoal: (id: string) => void;
}) {
  const [sources, setSources] = useState<EventSource[]>([]), [feed, setFeed] = useState<WorkEventFeed>({ subscriptions: [], events: [] });
  const [repository, setRepository] = useState(""), [branch, setBranch] = useState("main"), [interval, setIntervalSeconds] = useState("300"), [consent, setConsent] = useState(false);
  const [sourceId, setSourceId] = useState(""), [goalId, setGoalId] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<SourceEventDetail | null>(null), [run, setRun] = useState<WebRun | null>(null);
  const permitId = useRef<string | undefined>(undefined), subscriptionId = useRef<string | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void Promise.all([api<EventSource[]>("/work-event-sources"), api<WorkEventFeed>(`/work-threads/${thread.id}/events`)])
      .then(([list, view]) => { if (current) { setSources(list); setFeed(view); } })
      .catch((e: Error) => { if (current) setError(e.message); });
    const timer = setInterval(() => setRevision(value => value + 1), 5000);
    return () => { current = false; clearInterval(timer); };
  }, [api, thread.id, revision]);
  async function change(path: string, body: unknown) {
    setBusy(true); setError("");
    try { await api(path, body); setRevision(value => value + 1); return true; }
    catch (e) { setError(e instanceof Error ? e.message : "操作失败"); return false; }
    finally { setBusy(false); }
  }
  const goals = thread.links.filter(link => link.kind === "goal" && link.object);
  return <section className="work-events" aria-label="来源观察与订阅">
    <h2>来源观察与订阅</h2>
    <p className="muted">只观察固定GitHub公开仓库/分支。订阅接收之后观察到的新变化，不补收之前或暂停期间的事件，仅观察不调用分析模型；执行须在下方另行明确批准Policy。</p>
    {error && <p className="error" role="alert">{error}</p>}
    <details><summary>明确许可一个新观察来源</summary>
      <form onSubmit={e => {
        e.preventDefault(); permitId.current ??= crypto.randomUUID();
        void change("/work-event-sources", { requestId: permitId.current, watch: { kind: "github", repository, branch, intervalSeconds: Number(interval) } })
          .then(ok => { if (ok) { permitId.current = undefined; setConsent(false); } });
      }} onChange={() => { permitId.current = undefined; }}>
        <label>公开仓库 owner/repo<input value={repository} onChange={e => setRepository(e.target.value)} placeholder="owner/repo" required disabled={busy} /></label>
        <label>固定分支<input value={branch} onChange={e => setBranch(e.target.value)} required disabled={busy} /></label>
        <label>观察间隔（秒）<input type="number" min="60" max="86400" value={interval} onChange={e => setIntervalSeconds(e.target.value)} required disabled={busy} /></label>
        <label className="work-event-consent"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy} required />
          我明确许可周期只读观察以上固定范围；首轮仅建基线，不授权分析或执行。</label>
        <button className="primary" disabled={busy || !consent || !repository || !branch}>许可并启用来源观察</button>
      </form>
    </details>
    <div className="work-event-sources">
      {!sources.length && <p className="muted">尚无明确许可的来源。</p>}
      {sources.map(source => <article key={source.id}>
        <strong>{source.watch.repository} · {source.watch.branch}</strong>
        <p>{source.watch.intervalSeconds}秒 · {source.status === "active" ? "观察中" : "观察已暂停"} · {source.head ? `head ${source.head}` : "等待首轮基线"}</p>
        <small>许可来源 {source.id} · {new Date(source.createdAt).toLocaleString("zh-CN")}</small>
        {source.lastError && <p className="error">{source.lastError}；保留原游标，需核对；不会自动跳过缺口。</p>}
        <button disabled={busy} onClick={() => void change(`/work-event-sources/${source.id}`, { status: source.status === "active" ? "paused" : "active", expectedRevision: source.revision })}>
          {source.status === "active" ? "暂停观察" : "恢复观察"}</button>
      </article>)}
    </div>
    {thread.status === "active" && <form onSubmit={e => {
      e.preventDefault(); subscriptionId.current ??= crypto.randomUUID();
      void change("/work-event-subscriptions", { id: subscriptionId.current, sourceId, threadId: thread.id, goalId: goalId || null })
        .then(ok => { if (ok) subscriptionId.current = undefined; });
    }} onChange={() => { subscriptionId.current = undefined; }}>
      <label>订阅已有来源<select value={sourceId} onChange={e => setSourceId(e.target.value)} disabled={busy} required>
        <option value="">选择来源</option>{sources.filter(source => source.status === "active").map(source => <option key={source.id} value={source.id}>{source.watch.repository} · {source.watch.branch} · {source.watch.intervalSeconds}秒</option>)}
      </select></label>
      <label>订阅目标<select value={goalId} onChange={e => setGoalId(e.target.value)} disabled={busy}>
        <option value="">仅本主题</option>{goals.map(link => <option key={link.objectId} value={link.objectId}>本主题已关联Goal：{link.object!.title}</option>)}
      </select></label>
      <button disabled={busy || !sourceId}>订阅之后观察到的新变化</button>
    </form>}
    <h3>本主题订阅</h3>
    {!feed.subscriptions.length && <p className="muted">尚无订阅。来源存在不等于已经投递给本主题。</p>}
    {feed.subscriptions.map(subscription => <article key={subscription.id}>
      <p>{sources.find(source => source.id === subscription.sourceId)?.watch.repository ?? subscription.sourceId} · {subscription.goalId ? `Goal ${subscription.goalId}` : "仅本主题"} · {subscription.status === "active" ? "订阅启用" : "订阅暂停"}</p>
      {!subscription.available && <p className="muted">当前不可投递：{reasons[subscription.unavailableReason!] ?? subscription.unavailableReason}</p>}
      <button disabled={busy || (subscription.status === "paused" && !subscription.available)} onClick={() => void change(`/work-event-subscriptions/${subscription.id}`, { status: subscription.status === "active" ? "paused" : "active", expectedRevision: subscription.revision })}>
        {subscription.status === "active" ? "暂停订阅" : "恢复订阅"}</button>
      {subscription.goalId && <PolicyApproval api={api} subscription={subscription} refreshKey={revision} refresh={() => setRevision(value => value + 1)} />}
    </article>)}
    <p className="muted">暂停观察/订阅只影响后续观察和投递，不表示停止已签发的Goal执行；停止原执行须走原Goal暂停或Policy撤销。已签发的ready或running片段保留原资格；繁忙时新事件不积压、不重放。</p>
    <h3>实际收到的事件（最近100项）</h3>
    {!feed.events.length && <p className="muted">尚未收到事件；订阅前或暂停期间的来源变化不会补投。</p>}
    {feed.events.map(item => <article key={`${item.eventId}:${item.subscriptionId}`}>
      <strong>{item.source.watch.repository} · {item.source.watch.branch}</strong>
      <p>{new Date(item.event.observedAt).toLocaleString("zh-CN")} · {item.event.previous} → {item.event.head}</p>
      <p>{item.status === "pending" ? "等待本地判定" : reasons[item.reason!] ?? item.reason} · 订阅版本 {item.subscriptionRevision}</p>
      {!item.available && <small>当前关联不可用：{reasons[item.unavailableReason!] ?? item.unavailableReason}</small>}
      {item.goalId && <button onClick={() => openGoal(item.goalId!)}>查看原Goal {item.goalId.slice(0, 8)}</button>}{item.triggerId && <small>Trigger {item.triggerId} </small>}
      {item.executionStatus && <small>原Goal片段提交状态：{item.executionStatus} </small>}
      {item.runId && <button disabled={busy} onClick={() => { setError(""); void api<WebRun>(`/runs/${item.runId}`).then(setRun).catch((e: Error) => setError(e.message)); }}>查看原执行Run</button>}
      <a href={`https://github.com/${item.source.watch.repository}/compare/${item.event.previous}...${item.event.head}`} target="_blank" rel="noreferrer">GitHub出处</a>{" "}
      <button disabled={busy} onClick={() => { setError(""); void api<SourceEventDetail>(`/work-source-events/${item.eventId}`).then(setDetail).catch((e: Error) => setError(e.message)); }}>查看冻结原件</button>
    </article>)}
    {run && <details open><summary>原技术Run {run.id} · {run.status} · {run.usage.calls}次模型响应</summary><pre>{run.output ?? run.error ?? "尚无技术结果"}</pre>
      <p className="muted">技术Run状态与Goal成果提交是不同记录；读取不表示已批准或已查看Goal成果。</p><button onClick={() => setRun(null)}>关闭执行记录</button></details>}
    {detail && <details open><summary>冻结事件 {detail.id} · Hash {detail.snapshotHash}</summary><pre>{JSON.stringify(detail.snapshot, null, 2)}</pre>
      <button onClick={() => setDetail(null)}>关闭原件</button></details>}
  </section>;
}

function PolicyApproval({ api, subscription, refresh, refreshKey }: { refreshKey: number; api: <T>(path: string, body?: unknown) => Promise<T>; subscription: SubscriptionView; refresh: () => void }) {
  const [context, setContext] = useState<{ goal: Goal | null; policy: GoalPolicy | null; source: EventSource; proactiveEnabled: boolean; subscription: SubscriptionView } | null>(null);
  const [expiry, setExpiry] = useState(""), [daily, setDaily] = useState(""), [calls, setCalls] = useState(""), [total, setTotal] = useState("");
  const [dailyBudget, setDailyBudget] = useState(""), [totalBudget, setTotalBudget] = useState(""), [consentScope, setConsentScope] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<{ action: string; body: object; requestId: string; path: string; scope: string; receipt?: WebPolicyReceipt } | null>(null);
  const approvalScope = context?.goal ? JSON.stringify({ goal: { id: context.goal.id, revision: context.goal.revision, planRevision: context.goal.planRevision, status: context.goal.status },
    source: { id: context.source.id, revision: context.source.revision, status: context.source.status, watch: context.source.watch },
    subscription: { id: subscription.id, revision: subscription.revision, status: subscription.status, goalId: subscription.goalId,
      sourceId: subscription.sourceId, policyId: subscription.policyId, policyVersion: subscription.policyVersion, available: subscription.available },
    policy: context.policy ? { id: context.policy.id, version: context.policy.version, status: context.policy.status } : null,
    expiry, daily, calls, total, dailyBudget, totalBudget }) : '';
  const fresh = context?.subscription.id === subscription.id && context.subscription.revision === subscription.revision;
  const consent = !!approvalScope && fresh && consentScope === approvalScope;
  useEffect(() => { setConsentScope(null); }, [approvalScope]);
  const path = `/work-event-subscriptions/${subscription.id}/policy`;
  useEffect(() => {
    let current = true;
    void api<NonNullable<typeof context>>(path).then(value => { if (current) setContext(value); }).catch((e: Error) => { if (current) setMessage(e.message); });
    return () => { current = false; };
  }, [api, path, subscription.revision, subscription.policyId, refreshKey]);
  async function submit(action?: 'approve' | 'pause' | 'revoke') {
    if (action && !fresh) { setMessage('请等待当前订阅版本刷新后再操作；原请求仍可独立恢复并查询结果。'); return; }
    if (action && pending) { setMessage('请先恢复并处理原请求结果；新表单不会复用旧请求。'); return; }
    if (action === 'approve' && (!consent || consentScope !== approvalScope || !subscription.available || subscription.status !== 'active')) {
      setMessage('审批范围或输入已变化，请核对当前版本并重新明确勾选。'); return;
    }
    let request = pending;
    if (action) {
      if (!context?.goal || action !== 'approve' && !context.policy) return;
      const body = action === 'approve' ? { action, expectedSubscriptionRevision: subscription.revision, proposal: {
        goalId: context.goal.id, expectedGoalRevision: context.goal.revision, planRevision: context.goal.planRevision,
        capability: 'text_only', expiresAt: new Date(expiry).toISOString(), schedule: { ...context.source.watch },
        limits: { segmentsPerTrigger: 1, dailyExecutions: Number(daily), dailyModelCalls: Number(calls), totalExecutions: Number(total),
          dailyBudgetCny: Number(dailyBudget), totalBudgetCny: Number(totalBudget) },
      } } : { action, expectedSubscriptionRevision: subscription.revision, policyId: context.policy!.id, expectedVersion: context.policy!.version };
      request = { action, body, requestId: crypto.randomUUID(), path, scope: approvalScope };
      setPending(request);
    }
    if (!request) return;
    // 恢复时提交原冻结请求；服务器已接纳则只读原收据，不因刷新或新表单更换payload和requestId。
    const original = request;
    setBusy(true); setMessage(''); setConsentScope(null);
    try {
      const receipt = await api<WebPolicyReceipt>(original.path, { ...original.body, requestId: original.requestId } as Omit<WebPolicyRequest, 'subscriptionId'>);
      setPending({ ...original, receipt }); setMessage(receipt.message); refresh();
      setContext(await api<NonNullable<typeof context>>(path));
    } catch (error) { setMessage(error instanceof Error ? error.message : '原请求结果未确认，请恢复原请求并查询结果或核对当前策略状态。'); }
    finally { setBusy(false); }
  }
  return <details><summary>独立Policy执行许可 {context?.policy ? `· ${context.policy.status}` : '· 尚未批准'}</summary>
    {message && <p role="status">{message}</p>}
    {pending && <aside aria-label="原策略请求收据">
      <p>原操作 {pending.action} · 请求 {pending.requestId}。若服务器尚未接纳，将提交上方原冻结请求；已接纳则只读原收据，不采用当前新表单。</p>
      <details><summary>原请求冻结范围与提交内容</summary><pre>{pending.scope}</pre><pre>{JSON.stringify(pending.body, null, 2)}</pre></details>
      {pending.receipt ? <p>原收据：{pending.receipt.status} · 技术Run {pending.receipt.runId} · {pending.receipt.message}</p>
        : <p>结果尚未确认；当前策略状态不能代替原请求收据。</p>}
      <button disabled={busy} onClick={() => void submit()}>恢复原请求并查询结果</button>{' '}
      <button disabled={busy} onClick={() => {
        setMessage(pending.receipt ? '原收据已核对；新审批仍须重新明确勾选当前范围。' : '已结束本页跟踪；不代表取消或撤销服务器操作，请核对当前策略状态。');
        setPending(null); setConsentScope(null); refresh();
      }}>{pending.receipt ? '已核对原收据，结束此请求' : '结束跟踪（不代表取消或撤销服务器操作）'}</button>
    </aside>}
    {context && <>
      <p>Goal {context.goal?.id} · 当前状态 {context.goal?.status} · Goal版本 {context.goal?.revision} · 已批准Plan版本 {context.goal?.planRevision}</p>
      <p>固定来源：{context.source.watch.repository} / {context.source.watch.branch} / {context.source.watch.intervalSeconds}秒。订阅版本 {subscription.revision}。</p>
      <p className="muted">仅允许每事件1个无工具纯文本片段，继续同一个Goal；需要反馈、Plan结束或超限仍会停止。仅之后观察到的新变化可触发。宿主主动执行总开关：{context.proactiveEnabled ? '已开' : '未开启'}；本表单不会更改宿主开关、费率或预算。</p>
      {context.policy && <>
        <p>Policy {context.policy.id} · 版本 {context.policy.version} · {context.policy.reason && (reasons[context.policy.reason] ?? context.policy.reason)}</p>
        <p>有效期 {context.policy.expiresAt} · 每触发 {context.policy.limits.segmentsPerTrigger}片段 · 每日执行 {context.policy.limits.dailyExecutions}次 / 模型 {context.policy.limits.dailyModelCalls}次 · 总执行 {context.policy.limits.totalExecutions}次 · 每日人民币 {context.policy.limits.dailyBudgetCny}元 / 总人民币 {context.policy.limits.totalBudgetCny}元</p>
        {context.policy.status !== 'revoked' && <>
          <button disabled={busy || !!pending || !fresh} onClick={() => void submit('pause')}>暂停Policy及原执行许可</button>{' '}
          <button disabled={busy || !!pending || !fresh} onClick={() => void submit('revoke')}>撤销Policy及原执行许可</button>
        </>}
      </>}
      {context.policy?.status !== 'active' && <form onSubmit={event => { event.preventDefault(); void submit('approve'); }} onChange={() => { setConsentScope(null); }}>
        <label>明确有效期（本地时间）<input type="datetime-local" required value={expiry} onChange={e => setExpiry(e.target.value)} disabled={busy} /></label>
        <label>每日最多执行次数<input type="number" min="1" max="100" required value={daily} onChange={e => setDaily(e.target.value)} disabled={busy} /></label>
        <label>每日最多模型调用次数<input type="number" min="1" max="100" required value={calls} onChange={e => setCalls(e.target.value)} disabled={busy} /></label>
        <label>总执行次数<input type="number" min="1" max="100" required value={total} onChange={e => setTotal(e.target.value)} disabled={busy} /></label>
        <label>每日预算（人民币元）<input type="number" min="0.000001" max="100" step="any" required value={dailyBudget} onChange={e => setDailyBudget(e.target.value)} disabled={busy} /></label>
        <label>总预算（人民币元）<input type="number" min="0.000001" max="100" step="any" required value={totalBudget} onChange={e => setTotalBudget(e.target.value)} disabled={busy} /></label>
        <label className="work-event-consent"><input type="checkbox" checked={consent} onChange={e => { e.stopPropagation(); if (!pending && fresh) setConsentScope(e.target.checked ? approvalScope : null); }} required disabled={busy || !!pending || !fresh} />我明确批准以上当前Goal/Plan版本、固定来源、每事件1片段及全部期限/次数/人民币预算。</label>
        <button className="primary" disabled={busy || !!pending || !consent || !subscription.available || subscription.status !== 'active'}>独立批准此执行Policy</button>
      </form>}
    </>}
  </details>;
}
