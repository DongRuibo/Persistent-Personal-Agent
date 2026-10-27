import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Markdown from "react-markdown";
import {
  ArrowUp,
  ArrowUpRight,
  ArrowLeft,
  Bell,
  Check,
  ChevronRight,
  Clock3,
  FileCheck2,
  FileText,
  House,
  LayoutList,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  X,
  Zap,
  Activity,
} from "lucide-react";
import type {
  WebSnapshot,
  WebFile,
  WebGoalDetail,
  WebRun,
} from "../../src/web-ui-types.js";
import "./style.css";

const pages = [
  { id: "home", label: "工作台", icon: House },
  { id: "chat", label: "对话", icon: MessageSquare },
  { id: "tasks", label: "任务", icon: LayoutList },
  { id: "goals", label: "目标", icon: Target },
  { id: "approvals", label: "审批", icon: FileCheck2 },
  { id: "activity", label: "动态", icon: Activity },
] as const;
type Page = (typeof pages)[number]["id"];
const labels: Record<string, string> = {
  pending: "待执行",
  running: "执行中",
  succeeded: "已完成",
  failed: "失败",
  interrupted: "已中断",
  cancelled: "已取消",
  ready: "待推进",
  waiting_user: "等待反馈",
  paused: "已暂停",
  blocked: "受阻",
  completed: "已完成",
  committed: "已提交",
  uncertain: "结果不确定",
  expired: "已过期",
  executing: "提交中",
};
const time = (s: string | number) =>
  new Date(s).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
let csrf = "";
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers:
      body === undefined
        ? {}
        : { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error ?? "请求失败", response.status);
  return data as T;
}
function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span className={"badge " + status}>
      <span />
      {label ?? labels[status] ?? status}
    </span>
  );
}
function Empty({
  icon: Icon = Sparkles,
  title,
  children,
}: {
  icon?: typeof Sparkles;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Prose({ text }: { text: string }) {
  return (
    <div className="prose">
      <Markdown
        skipHtml
        components={{
          img: ({ alt }) => <span>[图片：{alt}]</span>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </Markdown>
    </div>
  );
}
// DOM进入可见区域并完成绘制后才ACK；刷新只恢复视图，不发送业务操作。
function Viewed({
  run,
  file,
  onAck,
  children,
}: {
  run: WebRun;
  file?: WebFile;
  onAck: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    sending = useRef(false);
  useEffect(() => {
    if (
      run.viewed ||
      run.status !== "succeeded" ||
      run.truncated ||
      !ref.current
    )
      return;
    let disposed = false;
    const observer = new IntersectionObserver((entries) => {
      if (
        !entries.some((e) => e.isIntersecting) ||
        document.visibilityState !== "visible" ||
        sending.current
      )
        return;
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (disposed || document.visibilityState !== "visible") return;
          sending.current = true;
          void api(`/runs/${run.id}/ack`, file ? { hash: file.hash } : {})
            .then(onAck)
            .catch(() => {})
            .finally(() => {
              sending.current = false;
            });
        }),
      );
    });
    observer.observe(ref.current);
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [run.id, run.viewed, run.status, run.truncated, file?.hash, onAck]);
  return <div ref={ref}>{children}</div>;
}
function App() {
  const [auth, setAuth] = useState<boolean | null>(null),
    [key, setKey] = useState(""),
    [loginBusy, setLoginBusy] = useState(false);
  const [data, setData] = useState<WebSnapshot | null>(null),
    [error, setError] = useState(""),
    [online, setOnline] = useState(navigator.onLine);
  const [page, setPage] = useState<Page>("home"),
    [draft, setDraft] = useState(""),
    [sending, setSending] = useState(false);
  const [retry, setRetry] = useState<{
      requestId: string;
      text: string;
    } | null>(null),
    [filter, setFilter] = useState("all");
  const [selectedFile, setSelectedFile] = useState<string | null>(null),
    [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [fileDetail, setFileDetail] = useState<WebFile | null>(null),
    [fileBusy, setFileBusy] = useState(false),
    [fileError, setFileError] = useState(""),
    [fileRetry, setFileRetry] = useState(0);
  const [goal, setGoal] = useState<WebGoalDetail | null>(null),
    [goalBusy, setGoalBusy] = useState(false);
  const [decision, setDecision] = useState<{
    id: string;
    hash: string;
    action: "confirm" | "reject";
    requestId: string;
  } | null>(null);
  const [decisionError, setDecisionError] = useState(""),
    [decisionBusy, setDecisionBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null),
    textarea = useRef<HTMLTextAreaElement>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await api<WebSnapshot>("/snapshot"));
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setAuth(false);
        setData(null);
        csrf = "";
      } else setError(e instanceof Error ? e.message : "暂时无法连接本机服务");
    }
  }, []);
  useEffect(() => {
    void api<{ authenticated: boolean; csrf?: string }>("/session")
      .then((s) => {
        csrf = s.csrf ?? "";
        setAuth(s.authenticated);
      })
      .catch(() => {
        setAuth(false);
        setError("无法连接本机服务");
      });
    const network = () => setOnline(navigator.onLine),
      route = () => {
        const value = location.hash.slice(1);
        setPage(pages.some((p) => p.id === value) ? (value as Page) : "home");
        window.scrollTo(0, 0);
        setFilter("all");
      };
    route();
    window.addEventListener("hashchange", route);
    window.addEventListener("online", network);
    window.addEventListener("offline", network);
    return () => {
      window.removeEventListener("hashchange", route);
      window.removeEventListener("online", network);
      window.removeEventListener("offline", network);
    };
  }, []);
  useEffect(() => {
    if (!auth) return;
    void refresh();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => clearInterval(id);
  }, [auth, refresh]);
  useEffect(() => {
    if (page === "chat")
      chatEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [page, data?.chats.length, data?.capabilities.busy]);
  const fileSummary = data?.files.find((f) => f.id === selectedFile);
  useEffect(() => {
    if (!auth || !selectedFile || page !== "approvals") {
      setFileDetail(null);
      return;
    }
    let disposed = false;
    setFileBusy(true);
    setFileDetail(null);
    setFileError("");
    // 只在进入详情或切换操作时获取冻结内容，轮询继续只同步状态和展示ACK。
    void api<WebFile>(`/files/${selectedFile}`)
      .then((detail) => {
        if (!disposed) setFileDetail(detail);
      })
      .catch((e) => {
        if (!disposed) setFileError(e.message);
      })
      .finally(() => {
        if (!disposed) setFileBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [auth, page, selectedFile, fileSummary?.hash, fileRetry]);
  useEffect(() => {
    if (!auth || !selectedGoal || page !== "goals") return;
    let disposed = false;
    setGoalBusy(true);
    setGoal(null);
    void api<WebGoalDetail>(`/goals/${selectedGoal}`)
      .then((g) => {
        if (!disposed) setGoal(g);
      })
      .catch((e) => setError(e.message))
      .finally(() => {
        if (!disposed) setGoalBusy(false);
      });
    return () => {
      disposed = true;
    };
  }, [
    auth,
    selectedGoal,
    page,
    data?.goals.find((g) => g.id === selectedGoal)?.updatedAt,
  ]);
  useEffect(() => {
    if (!decision) return;
    const previous = document.activeElement as HTMLElement | null;
    const keys = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !decisionBusy) {
        setDecision(null);
        setDecisionError("");
      }
      if (e.key !== "Tab") return;
      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>(
          ".modal button:not(:disabled)",
        ),
      ];
      const first = buttons[0],
        last = buttons.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [decision, decisionBusy]);
  const navigate = (next: Page) => {
    location.hash = next;
  };
  const openFile = (id: string) => {
    setSelectedFile(id);
    navigate("approvals");
  };
  const login = async (event: FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setError("");
    try {
      const result = await api<{ csrf: string }>("/login", { key });
      csrf = result.csrf;
      setKey("");
      setAuth(true);
    } catch (e) {
      setKey("");
      setError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  };
  const logout = async () => {
    try {
      await api("/logout", {});
      csrf = "";
      setAuth(false);
      setData(null);
      setDraft("");
      setRetry(null);
      setGoal(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const send = async (existing?: { requestId: string; text: string }) => {
    if (
      sending ||
      !online ||
      (!existing && (!draft.trim() || data?.capabilities.busy))
    )
      return;
    const body = existing ?? {
      requestId: crypto.randomUUID(),
      text: draft.trim(),
    };
    setSending(true);
    setRetry(body);
    setError("");
    try {
      await api("/chat", body);
      setDraft("");
      setRetry(null);
      await refresh();
    } catch (e) {
      setError((e as Error).message + "。可重试同一请求，或刷新核对执行记录。");
    } finally {
      setSending(false);
    }
  };
  const decide = async (item: NonNullable<typeof decision>) => {
    setDecisionBusy(true);
    setDecisionError("");
    try {
      await api(`/files/${item.id}/decision`, {
        hash: item.hash,
        action: item.action,
        requestId: item.requestId,
      });
      setDecision(null);
      await refresh();
    } catch (e) {
      setDecisionError((e as Error).message);
    } finally {
      setDecisionBusy(false);
    }
  };
  const ask = (text: string) => {
    setDraft(text);
    navigate("chat");
    setTimeout(() => textarea.current?.focus(), 50);
  };
  const filesPending =
    data?.files.filter((f) => f.status === "pending").length ?? 0;
  const unread = data?.inbox.filter((n) => !n.viewedAt).length ?? 0;
  const file =
    fileDetail?.id === selectedFile
      ? {
          ...fileDetail,
          ...fileSummary,
          run: {
            ...fileDetail.run,
            viewed: fileSummary?.acknowledged ?? fileDetail.run.viewed,
          },
        }
      : null;
  const title = pages.find((p) => p.id === page)!.label;
  if (auth === null)
    return (
      <div className="boot">
        <LoaderCircle className="spin" size={28} />
        <p>连接你的 Agent…</p>
      </div>
    );
  if (!auth)
    return (
      <main className="login-page">
        <div className="login-art">
          <div className="brand-mark">
            A<span />
          </div>
          <span className="eyebrow">PERSONAL AGENT / LOCAL WORKSPACE</span>
          <h1>
            把想法交给对话，
            <br />
            让行动有迹可循。
          </h1>
          <p>
            一个属于你的工作空间。聊天、安排任务、推进目标，
            <br className="desktop-only" />
            每一次重要操作都由你掌握。
          </p>
          <div className="login-note">
            <ShieldCheck size={18} /> 仅在本机运行 · 单用户私有空间
          </div>
        </div>
        <form className="login-card" onSubmit={login} autoComplete="off">
          <div className="mini-logo">
            <Sparkles size={21} />
          </div>
          <h2>欢迎回来</h2>
          <p>输入本机配置的 Web 访问密钥。</p>
          <label htmlFor="access-key">访问密钥</label>
          <input
            id="access-key"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoComplete="off"
            required
            placeholder="输入你的访问密钥"
            maxLength={4096}
          />
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary" disabled={loginBusy || !key || !online}>
            {loginBusy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <ArrowUpRight size={17} />
            )}
            进入工作台
          </button>
          <small>
            应用不会主动保存访问密钥；浏览器或密码管理器仍可能提示保存，请按需选择。
          </small>
        </form>
        <span className="login-foot">PERSONAL AGENT · WEB APP V1</span>
      </main>
    );
  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <a href="#home" className="brand">
          <div className="brand-mark">
            A<span />
          </div>
          <div>
            Personal Agent<small>你的个人工作空间</small>
          </div>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav aria-label="主导航">
          {pages.map((p) => (
            <a
              href={"#" + p.id}
              key={p.id}
              className={page === p.id ? "active" : ""}
              aria-current={page === p.id ? "page" : undefined}
            >
              <p.icon size={19} />
              <span>{p.label}</span>
              {p.id === "approvals" && filesPending > 0 && (
                <b>{filesPending}</b>
              )}
              {p.id === "activity" && unread > 0 && (
                <i className="unread-dot" />
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-status">
            <span
              className={online && !error ? "status-dot" : "status-dot offline"}
            />
            <div>
              本机工作空间
              <small>
                {online ? "127.0.0.1 · 私有访问" : "当前处于离线状态"}
              </small>
            </div>
          </div>
          <div className="profile">
            <div className="avatar">我</div>
            <div>
              个人账户<small>单用户 · Web V1</small>
            </div>
            <button
              className="icon-button"
              onClick={() => void logout()}
              aria-label="退出登录"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="breadcrumb">我的空间</span>
            <ChevronRight size={14} />
            <span>{title}</span>
          </div>
          <div>
            <span className="local-pill">
              <ShieldCheck size={13} /> 本机私有
            </span>
            <button
              className="icon-button"
              aria-label="查看收件箱"
              onClick={() => navigate("activity")}
            >
              <Bell size={19} />
              {unread > 0 && <i className="unread-dot" />}
            </button>
            <button
              className="icon-button mobile-only"
              aria-label="退出登录"
              onClick={() => void logout()}
            >
              <LogOut size={18} />
            </button>
            <div className="avatar small desktop-only">我</div>
          </div>
        </header>
        <main id="main" className={"main page-" + page} tabIndex={-1}>
          {(!online || error) && (
            <div className="banner" role="alert">
              <span>
                {!online
                  ? "当前离线。历史内容仅保留在此页面；连接恢复后刷新，不会自动重发操作。"
                  : error}
              </span>
              <button onClick={() => void refresh()} disabled={!online}>
                <RefreshCw size={14} />
                刷新
              </button>
            </div>
          )}
          {!data ? (
            <div className="boot">
              <LoaderCircle className="spin" />
              <p>正在加载工作空间…</p>
              <button onClick={() => void refresh()}>重新加载</button>
            </div>
          ) : (
            <>
              {page === "home" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">YOUR PERSONAL WORKSPACE</span>
                      <h1>你好，今天想推进什么？</h1>
                      <p>从一句对话开始，安排你的下一步。</p>
                    </div>
                    <button
                      className="primary"
                      onClick={() => navigate("chat")}
                    >
                      <Plus size={17} />
                      开始对话
                    </button>
                  </div>
                  <section className="stat-grid" aria-label="工作空间概况">
                    {[
                      {
                        label: "待办任务",
                        value: data.tasks.filter((t) =>
                          ["pending", "running"].includes(t.status),
                        ).length,
                        hint: "最近任务中的待执行与执行中",
                        icon: LayoutList,
                        to: "tasks" as Page,
                        color: "blue",
                      },
                      {
                        label: "进行中的目标",
                        value: data.goals.filter(
                          (g) => !["completed", "cancelled"].includes(g.status),
                        ).length,
                        hint: data.capabilities.goal
                          ? "在对话中推进下一段"
                          : "Goal 当前未启用",
                        icon: Target,
                        to: "goals" as Page,
                        color: "purple",
                      },
                      {
                        label: "等待你确认",
                        value: filesPending,
                        hint: "文件修改需要你的明确批准",
                        icon: FileCheck2,
                        to: "approvals" as Page,
                        color: "amber",
                      },
                      {
                        label: "未读通知",
                        value: unread,
                        hint: "已存入收件箱 · 尚无手机推送",
                        icon: Bell,
                        to: "activity" as Page,
                        color: "green",
                      },
                    ].map((s) => (
                      <button
                        className="stat-card"
                        key={s.label}
                        onClick={() => navigate(s.to)}
                      >
                        <div>
                          <span className={"stat-icon " + s.color}>
                            <s.icon size={19} />
                          </span>
                          <ArrowUpRight size={16} />
                        </div>
                        <span>{s.label}</span>
                        <strong>{s.value.toString().padStart(2, "0")}</strong>
                        <small>{s.hint}</small>
                      </button>
                    ))}
                  </section>
                  <section className="start-card">
                    <div className="start-orbit">
                      <Sparkles size={26} />
                    </div>
                    <div>
                      <span className="eyebrow">
                        THINK IT. TALK IT. MOVE IT.
                      </span>
                      <h2>不止回答，也陪你推进。</h2>
                      <p>聊一个问题、安排一次提醒，或把想做的事拆成目标。</p>
                      <div className="quick-actions">
                        <button
                          onClick={() => ask("帮我梳理一下今天要做的事情。")}
                        >
                          梳理我的想法
                          <ArrowUpRight size={14} />
                        </button>
                        <button onClick={() => ask("10分钟后提醒我休息一下")}>
                          安排一个提醒
                          <ArrowUpRight size={14} />
                        </button>
                        <button
                          onClick={() =>
                            ask(
                              "我想分阶段准备面试，请帮我创建长期目标，先拟计划。",
                            )
                          }
                        >
                          开始一个目标
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </div>
                    <span className="start-decoration" aria-hidden="true">
                      ✳
                    </span>
                  </section>
                  <div className="home-columns">
                    <section className="panel">
                      <div className="section-head">
                        <h2>
                          最近执行<span>RECENT RUNS</span>
                        </h2>
                        <button
                          className="text-button"
                          onClick={() => navigate("activity")}
                        >
                          全部动态
                          <ArrowUpRight size={14} />
                        </button>
                      </div>
                      {data.activity.length ? (
                        data.activity.slice(0, 5).map((r) => (
                          <div className="list-row" key={r.id}>
                            <div className="row-icon">
                              <MessageSquare size={17} />
                            </div>
                            <div className="row-body">
                              <strong>
                                {r.taskId ? "后台任务" : "Agent 执行"}
                              </strong>
                              <small>{time(r.startedAt)}</small>
                            </div>
                            <Badge status={r.status} />
                          </div>
                        ))
                      ) : (
                        <Empty title="还没有执行记录">
                          发送第一条消息，Agent 的工作会记录在这里。
                        </Empty>
                      )}
                    </section>
                    <section className="panel">
                      <div className="section-head">
                        <h2>
                          当前可用能力<span>CAPABILITIES</span>
                        </h2>
                        <span
                          className={
                            "running-indicator " +
                            (data.capabilities.busy ? "busy" : "")
                          }
                        >
                          <span />
                          {data.capabilities.busy ? "执行中" : "就绪"}
                        </span>
                      </div>
                      <div className="capability-list">
                        {[
                          ["自然对话与任务", "Pi Session · 历史可恢复", true],
                          [
                            "长期目标",
                            "计划、步骤与阶段成果",
                            data.capabilities.goal,
                          ],
                          [
                            "受控文件输出",
                            "先预览，再由你确认",
                            data.capabilities.filesWrite,
                          ],
                          [
                            "批准的 Skills",
                            data.capabilities.skills.join("、") ||
                              "尚未安装或启用",
                            data.capabilities.skills.length > 0,
                          ],
                          [
                            "本地资料 / 网页读取",
                            "仅使用既有受控能力",
                            data.capabilities.filesRead ||
                              data.capabilities.webRead,
                          ],
                        ].map(([name, desc, enabled]) => (
                          <div key={String(name)}>
                            <div
                              className={
                                "capability-icon " + (enabled ? "enabled" : "")
                              }
                            >
                              <Zap size={16} />
                            </div>
                            <div>
                              <strong>{name}</strong>
                              <small>{desc}</small>
                            </div>
                            <span
                              className={enabled ? "enabled-text" : "muted"}
                            >
                              {enabled ? "已启用" : "未启用"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                  <p className="footnote">
                    数据仅来自当前 Web 身份，列表最多显示最近 100
                    项，文件操作最多 60 项。
                  </p>
                </>
              )}
              {page === "chat" && (
                <div className="chat-layout">
                  <div className="chat-heading">
                    <div className="agent-avatar">
                      <Sparkles size={22} />
                    </div>
                    <div>
                      <h1>和你的 Agent 对话</h1>
                      <p>
                        <span className="status-dot" />
                        {data.capabilities.busy
                          ? "正在执行 · 可在动态中查看结果"
                          : "随时就绪 · 重要操作由你确认"}
                      </p>
                    </div>
                  </div>
                  <div className="messages" aria-live="polite">
                    {data.chats.length === 0 && (
                      <div className="chat-welcome">
                        <div className="welcome-symbol">
                          <Sparkles size={34} />
                        </div>
                        <h2>把你想做的，告诉我。</h2>
                        <p>
                          我们可以一起理清问题，也可以安排任务、推进长期目标。
                          <br />
                          文件操作会先给出完整预览，等待你批准。
                        </p>
                        <div className="suggestion-grid">
                          <button
                            onClick={() =>
                              setDraft("帮我梳理一下今天要做的事情。")
                            }
                          >
                            <MessageSquare size={19} />
                            <strong>一起想一想</strong>
                            <span>把零散的想法整理清楚</span>
                            <ArrowUpRight size={14} />
                          </button>
                          <button
                            onClick={() => setDraft("10分钟后提醒我休息一下")}
                          >
                            <Clock3 size={19} />
                            <strong>安排一个提醒</strong>
                            <span>到时把结果放入收件箱</span>
                            <ArrowUpRight size={14} />
                          </button>
                        </div>
                      </div>
                    )}
                    {data.chats.map((c) => (
                      <div key={c.run.id} className="chat-turn">
                        <div className="message user">
                          <div className="message-content">
                            <p>{c.text}</p>
                            <small>你 · {time(c.run.startedAt)}</small>
                          </div>
                          <div className="avatar small">我</div>
                        </div>
                        <div className="message assistant">
                          <div className="agent-avatar small">
                            <Sparkles size={17} />
                          </div>
                          <div className="message-content">
                            <div className="assistant-label">
                              Personal Agent <Badge status={c.run.status} />
                            </div>
                            {c.run.fileOperationId ? (
                              <button
                                onClick={() => openFile(c.run.fileOperationId!)}
                              >
                                查看完整文件预览
                                <FileText size={15} />
                              </button>
                            ) : c.run.output ? (
                              <Viewed run={c.run} onAck={() => void refresh()}>
                                <Prose text={c.run.output} />
                              </Viewed>
                            ) : c.run.status === "running" ? (
                              <div className="thinking">
                                <LoaderCircle className="spin" size={15} />
                                Agent 正在处理…
                              </div>
                            ) : (
                              <p className="error">
                                {c.run.error ??
                                  "没有最终回复，请核对执行状态。"}
                              </p>
                            )}
                            {c.run.truncated && (
                              <p className="muted">
                                内容过长，当前显示节选；不自动标记完整投递。
                              </p>
                            )}
                            <small className="run-meta">
                              Run {c.run.id.slice(0, 8)} · {c.run.usage.calls}{" "}
                              次模型响应
                            </small>
                          </div>
                        </div>
                      </div>
                    ))}
                    <div ref={chatEnd} />
                  </div>
                  <div className="composer-area">
                    {retry && !sending && (
                      <div className="retry-bar">
                        上次提交尚未确认。
                        <button
                          onClick={() => void send(retry)}
                          disabled={!online}
                        >
                          重试同一请求
                        </button>
                        <button
                          onClick={() => {
                            setRetry(null);
                            void refresh();
                          }}
                        >
                          核对记录后放弃重试
                        </button>
                      </div>
                    )}
                    <form
                      className="composer"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!retry) void send();
                      }}
                    >
                      <textarea
                        ref={textarea}
                        aria-label="消息"
                        placeholder="告诉 Agent 你想做什么…"
                        value={draft}
                        maxLength={10000}
                        rows={2}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.shiftKey &&
                            !e.nativeEvent.isComposing
                          ) {
                            e.preventDefault();
                            if (!retry) void send();
                          }
                        }}
                      />
                      <div className="composer-toolbar">
                        <span>
                          <ShieldCheck size={13} />
                          重要操作需宿主授权
                        </span>
                        <button
                          className="send-button"
                          aria-label="发送消息"
                          disabled={
                            !draft.trim() ||
                            sending ||
                            data.capabilities.busy ||
                            !online ||
                            !!retry
                          }
                        >
                          {sending ? (
                            <LoaderCircle className="spin" size={18} />
                          ) : (
                            <ArrowUp size={20} />
                          )}
                        </button>
                      </div>
                    </form>
                    <p className="composer-hint">
                      Enter 发送，Shift + Enter 换行 ·
                      页面断开不会取消执行，请先核对结果。
                    </p>
                  </div>
                </div>
              )}
              {page === "tasks" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">TASKS</span>
                      <h1>让每件事按时发生</h1>
                      <p>一次性任务与提醒，执行结果会存入应用收件箱。</p>
                    </div>
                    <button
                      className="primary"
                      onClick={() => ask("请帮我创建一个提醒：")}
                    >
                      <Plus size={17} />
                      在对话中创建
                    </button>
                  </div>
                  <div className="filters" aria-label="任务筛选">
                    {[
                      ["all", "全部"],
                      ["pending", "待执行"],
                      ["succeeded", "已完成"],
                      ["failed", "失败 / 中断"],
                      ["cancelled", "已取消"],
                    ].map(([id, text]) => (
                      <button
                        className={filter === id ? "active" : ""}
                        onClick={() => setFilter(id!)}
                        key={id}
                      >
                        {text}
                      </button>
                    ))}
                  </div>
                  <section className="panel task-list">
                    {data.tasks
                      .filter(
                        (t) =>
                          filter === "all" ||
                          (filter === "failed"
                            ? ["failed", "interrupted"].includes(t.status)
                            : t.status === filter),
                      )
                      .map((t) => (
                        <article className="task-item" key={t.id}>
                          <div className="task-icon">
                            <Clock3 size={20} />
                          </div>
                          <div className="task-info">
                            <div>
                              <h3>{t.instruction}</h3>
                              <Badge status={t.status} />
                            </div>
                            <p>
                              计划时间 {time(t.dueAt)} <span>·</span>{" "}
                              {t.id.slice(0, 8)}
                            </p>
                            {t.result && (
                              <details>
                                <summary>查看最近结果</summary>
                                <Prose text={t.result} />
                              </details>
                            )}
                            {t.status === "pending" && (
                              <button
                                className="text-button"
                                onClick={() => ask(`取消任务：${t.id}`)}
                              >
                                在对话中取消
                                <ArrowUpRight size={13} />
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    {!data.tasks.some(
                      (t) =>
                        filter === "all" ||
                        (filter === "failed"
                          ? ["failed", "interrupted"].includes(t.status)
                          : t.status === filter),
                    ) && (
                      <Empty icon={Clock3} title="这里还没有任务">
                        试着对 Agent 说：“10分钟后提醒我休息一下”。
                      </Empty>
                    )}
                  </section>
                </>
              )}
              {page === "goals" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">GOALS</span>
                      <h1>一步一步，走向你的目标</h1>
                      <p>
                        查看计划、当前步骤和
                        Checkpoint，通过对话给出反馈与控制。
                      </p>
                    </div>
                    <button
                      className="primary"
                      disabled={!data.capabilities.goal}
                      onClick={() => ask("我想分阶段完成一个长期目标：")}
                    >
                      <Plus size={17} />
                      在对话中创建
                    </button>
                  </div>
                  {!data.capabilities.goal ? (
                    <section className="panel">
                      <Empty icon={Target} title="Goal 尚未启用">
                        在独立 Web 配置中设置 GOAL_ENABLED=true 后启动。
                      </Empty>
                    </section>
                  ) : selectedGoal ? (
                    <section className="panel goal-detail">
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelectedGoal(null);
                          setGoal(null);
                        }}
                      >
                        <ArrowLeft size={15} />
                        返回目标列表
                      </button>
                      {goalBusy ? (
                        <p className="thinking">
                          <LoaderCircle className="spin" size={16} />
                          加载计划…
                        </p>
                      ) : goal ? (
                        <>
                          <div className="detail-heading">
                            <h2>{goal.objective}</h2>
                            <Badge status={goal.status} />
                          </div>
                          <p className="muted">
                            计划版本 {goal.planRevision} · 更新于{" "}
                            {time(goal.updatedAt)}
                          </p>
                          {goal.blockedReason && (
                            <p className="banner">{goal.blockedReason}</p>
                          )}
                          <div className="step-list">
                            {goal.steps.map((s, i) => (
                              <article key={s.id}>
                                <span className="step-number">{i + 1}</span>
                                <div>
                                  <h3>
                                    {s.title}
                                    <Badge status={s.status} />
                                  </h3>
                                  <p>{s.instruction}</p>
                                  <small>
                                    交付：{s.deliverable}
                                    <br />
                                    完成条件：{s.doneWhen}
                                  </small>
                                </div>
                              </article>
                            ))}
                          </div>
                          {goal.pendingPlan && (
                            <div className="pending-plan">
                              <h3>待批准计划</h3>
                              {goal.pendingPlan.map((s, i) => (
                                <div key={i}>
                                  <strong>
                                    {i + 1}. {s.title}
                                  </strong>
                                  <p>{s.instruction}</p>
                                  <small>
                                    交付：{s.deliverable} · 完成条件：
                                    {s.doneWhen}
                                  </small>
                                </div>
                              ))}
                              <p className="muted">
                                此处只读。在对话中重新查看并明确批准，不自动授权。
                              </p>
                            </div>
                          )}
                          {goal.checkpoint && (
                            <div className="checkpoint">
                              <span className="eyebrow">LATEST CHECKPOINT</span>
                              <h3>{goal.checkpoint.progressSummary}</h3>
                              <Prose text={goal.checkpoint.artifactText} />
                              {goal.checkpoint.question && (
                                <p className="question">
                                  等待你的反馈：{goal.checkpoint.question}
                                </p>
                              )}
                            </div>
                          )}
                          <button
                            className="primary"
                            onClick={() => ask(`查看目标：${goal.objective}`)}
                          >
                            在对话中查看并继续
                            <MessageSquare size={16} />
                          </button>
                        </>
                      ) : (
                        <p>暂时无法读取目标，请返回列表后重试。</p>
                      )}
                    </section>
                  ) : (
                    <div className="goal-grid">
                      {data.goals.map((g) => (
                        <button
                          className="panel goal-card"
                          key={g.id}
                          onClick={() => setSelectedGoal(g.id)}
                        >
                          <div>
                            <span className="stat-icon purple">
                              <Target size={20} />
                            </span>
                            <Badge status={g.status} />
                          </div>
                          <h2>{g.objective}</h2>
                          <p>
                            {g.blockedReason ??
                              (g.status === "waiting_user"
                                ? "等待你的反馈或计划批准"
                                : "查看当前计划与执行进展")}
                          </p>
                          <footer>
                            更新于 {time(g.updatedAt)}
                            <ArrowUpRight size={17} />
                          </footer>
                        </button>
                      ))}
                      {data.goals.length === 0 && (
                        <section className="panel wide">
                          <Empty icon={Target} title="给重要的事，一个长期目标">
                            在对话中描述你想持续推进的事情，Agent 会先拟定计划。
                          </Empty>
                        </section>
                      )}
                    </div>
                  )}
                </>
              )}
              {page === "approvals" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">APPROVAL CENTER</span>
                      <h1>每一次修改，由你决定</h1>
                      <p>
                        完整内容来自 T3 宿主账本。预览展示和执行授权是两件事。
                      </p>
                    </div>
                    <span className="approval-count">
                      <ShieldCheck size={16} />
                      {filesPending} 项待确认
                    </span>
                  </div>
                  <div className="approval-layout">
                    <section className="panel approval-list">
                      {data.files.map((f) => (
                        <button
                          key={f.id}
                          className={selectedFile === f.id ? "selected" : ""}
                          onClick={() => {
                            setSelectedFile(f.id);
                            setDecision(null);
                            setDecisionError("");
                          }}
                        >
                          <div className="row-icon">
                            <FileText size={19} />
                          </div>
                          <div>
                            <strong>{f.path}</strong>
                            <small>
                              {f.kind === "write" ? "创建文件" : "精确编辑"} ·{" "}
                              {time(f.expires)}
                            </small>
                            <Badge
                              status={f.status}
                              label={
                                f.status === "pending" ? "待批准" : undefined
                              }
                            />
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                      {data.files.length === 0 && (
                        <Empty icon={FileCheck2} title="暂无文件审批">
                          Agent 提出文件修改后，完整预览会出现在这里。
                        </Empty>
                      )}
                    </section>
                    {selectedFile && (fileBusy || fileError) ? (
                      <section
                        className="panel approval-detail"
                        aria-live="polite"
                      >
                        {fileBusy ? (
                          <p className="thinking">
                            <LoaderCircle className="spin" size={16} />
                            加载完整文件预览…
                          </p>
                        ) : (
                          <>
                            <p className="error" role="alert">
                              {fileError}
                            </p>
                            <button
                              disabled={!online}
                              onClick={() => setFileRetry((n) => n + 1)}
                            >
                              重新加载预览
                            </button>
                          </>
                        )}
                      </section>
                    ) : file ? (
                      <section className="panel approval-detail">
                        <div className="detail-heading">
                          <div>
                            <span className="eyebrow">
                              {file.kind === "write" ? "NEW FILE" : "FILE DIFF"}
                            </span>
                            <h2>{file.path}</h2>
                          </div>
                          <Badge
                            status={file.status}
                            label={
                              file.status === "pending" ? "待批准" : undefined
                            }
                          />
                        </div>
                        <div className="file-meta">
                          <span>
                            类型
                            <strong>
                              {file.kind === "write" ? "创建文件" : "精确编辑"}
                            </strong>
                          </span>
                          <span>
                            到期时间<strong>{time(file.expires)}</strong>
                          </span>
                        </div>
                        <p className="hash">
                          操作 {file.id}
                          <br />
                          操作 Hash {file.hash}
                          <br />
                          内容 Hash {file.contentHash}
                        </p>
                        <h3>
                          {file.kind === "write"
                            ? "待创建的完整正文"
                            : "宿主生成的真实 Diff"}
                        </h3>
                        <Viewed
                          run={file.run}
                          file={file}
                          onAck={() => void refresh()}
                        >
                          <pre
                            className={
                              file.kind === "edit" ? "diff" : "frozen-preview"
                            }
                          >
                            {file.kind === "edit"
                              ? file.diff.split("\n").map((line, i) => (
                                  <span
                                    key={i}
                                    className={
                                      /^\+|^\s*\d*\s*\+/u.test(line)
                                        ? "added"
                                        : /^-|^\s*\d*\s*-/u.test(line)
                                          ? "removed"
                                          : ""
                                    }
                                  >
                                    {line}
                                    {"\n"}
                                  </span>
                                ))
                              : file.content}
                          </pre>
                          <details className="ledger-preview" open>
                            <summary>完整宿主预览与确认信息</summary>
                            <pre className="frozen-preview">{file.preview}</pre>
                          </details>
                        </Viewed>
                        {file.kind === "edit" && (
                          <details>
                            <summary>修改后完整正文</summary>
                            <pre className="frozen-preview">{file.content}</pre>
                          </details>
                        )}
                        <div className="approval-footer">
                          <p>
                            <ShieldCheck size={15} />
                            {file.acknowledged
                              ? "预览已确认展示；尚不代表授权执行。"
                              : "预览展示确认中，请保持页面可见。"}
                          </p>
                          <div>
                            <button
                              disabled={
                                file.status !== "pending" ||
                                !file.acknowledged ||
                                data.capabilities.busy ||
                                !online
                              }
                              onClick={() => {
                                const d = {
                                  id: file.id,
                                  hash: file.hash,
                                  action: "reject" as const,
                                  requestId: crypto.randomUUID(),
                                };
                                setDecision(d);
                              }}
                            >
                              <X size={16} />
                              拒绝
                            </button>
                            <button
                              className="primary"
                              disabled={
                                file.status !== "pending" ||
                                !file.acknowledged ||
                                data.capabilities.busy ||
                                !online
                              }
                              onClick={() =>
                                setDecision({
                                  id: file.id,
                                  hash: file.hash,
                                  action: "confirm",
                                  requestId: crypto.randomUUID(),
                                })
                              }
                            >
                              <Check size={16} />
                              确认执行
                            </button>
                          </div>
                        </div>
                        {file.status !== "pending" && (
                          <p className="muted">
                            宿主状态：{labels[file.status] ?? file.status}
                            。该操作不可再次批准。
                          </p>
                        )}
                      </section>
                    ) : (
                      data.files.length > 0 && (
                        <section className="panel approval-placeholder">
                          <Empty icon={FileCheck2} title="选择一项查看完整内容">
                            核对文件、正文或 Diff，再决定是否执行。
                          </Empty>
                        </section>
                      )
                    )}
                  </div>
                </>
              )}
              {page === "activity" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">ACTIVITY & INBOX</span>
                      <h1>发生了什么，一目了然</h1>
                      <p>
                        宿主执行记录与持久收件箱。没有确认费用时不会估算金额。
                      </p>
                    </div>
                    <button onClick={() => void refresh()}>
                      <RefreshCw size={16} />
                      刷新记录
                    </button>
                  </div>
                  <section className="panel inbox-panel">
                    <div className="section-head">
                      <h2>
                        应用收件箱<span>{unread} 条未读</span>
                      </h2>
                      <span className="muted">手机推送尚未实现</span>
                    </div>
                    {data.inbox.length ? (
                      data.inbox.map((n) => (
                        <article
                          className={"notice " + (!n.viewedAt ? "unread" : "")}
                          key={n.runId}
                        >
                          <Bell size={18} />
                          <div>
                            <div>
                              <strong>
                                {n.goalId ? "目标执行结果" : "任务执行结果"}
                              </strong>
                              <small>{time(n.at)}</small>
                            </div>
                            <Prose text={n.text} />
                            <footer>
                              <span>
                                已存入应用收件箱 ·{" "}
                                {n.viewedAt ? "用户已查看" : "尚未查看"}
                              </span>
                              {!n.viewedAt && (
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    void api(`/inbox/${n.runId}/view`, {})
                                      .then(refresh)
                                      .catch((e) => setError(e.message))
                                  }
                                >
                                  <Check size={14} />
                                  标为已查看
                                </button>
                              )}
                            </footer>
                          </div>
                        </article>
                      ))
                    ) : (
                      <Empty icon={Bell} title="收件箱很安静">
                        后台 Task 与 Goal 的结果会存到这里，刷新后仍然保留。
                      </Empty>
                    )}
                  </section>
                  <section className="panel activity-panel">
                    <div className="section-head">
                      <h2>
                        最近执行<span>最多 100 条</span>
                      </h2>
                      <span className="muted">模型记录不等同于供应商账单</span>
                    </div>
                    {data.activity.map((r) => (
                      <details className="run-item" key={r.id}>
                        <summary>
                          <span className="row-icon">
                            <Activity size={17} />
                          </span>
                          <span>
                            <strong>
                              {r.taskId ? "后台任务" : "Agent 执行"}{" "}
                              <code>{r.id.slice(0, 8)}</code>
                            </strong>
                            <small>
                              {time(r.startedAt)} · {r.usage.calls} 次模型响应 ·
                              费用未确认
                            </small>
                          </span>
                          <Badge status={r.status} />
                          <ChevronRight size={15} />
                        </summary>
                        <div className="run-detail">
                          <p>
                            输入 {r.usage.inputTokens} · 输出{" "}
                            {r.usage.outputTokens} · 缓存读取{" "}
                            {r.usage.cacheReadTokens} · 缓存写入{" "}
                            {r.usage.cacheWriteTokens} Token
                          </p>
                          <small>
                            仅统计供应商已报告的调用，缺失用量不代表零消耗。
                          </small>
                          {r.output && <Prose text={r.output} />}
                          {r.fileOperationId && (
                            <button
                              onClick={() => openFile(r.fileOperationId!)}
                            >
                              查看完整文件预览
                              <FileText size={15} />
                            </button>
                          )}
                          {r.error && <p className="error">{r.error}</p>}
                        </div>
                      </details>
                    ))}
                    {!data.activity.length && (
                      <Empty icon={Activity} title="还没有执行记录">
                        开始一次对话或创建任务后，在这里查看真实状态。
                      </Empty>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </main>
      </div>
      {decision && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="decision-title"
          >
            <div className="stat-icon amber">
              <FileCheck2 size={23} />
            </div>
            <h2 id="decision-title">
              {decision.action === "confirm"
                ? "确认执行这一次文件修改？"
                : "拒绝这项文件操作？"}
            </h2>
            <p>
              {decision.action === "confirm"
                ? "仅提交账本冻结的内容。执行后请核对宿主状态。"
                : "取消这项提议，不修改文件。"}
              刷新或网络重试不会自动批准。
            </p>
            <code>{data?.files.find((f) => f.id === decision.id)?.path}</code>
            {decisionError && (
              <p className="error" role="alert">
                {decisionError} 可使用下方按钮重试同一审批请求。
              </p>
            )}
            <div className="modal-actions">
              <button
                disabled={decisionBusy}
                autoFocus
                onClick={() => {
                  setDecision(null);
                  setDecisionError("");
                }}
              >
                返回预览
              </button>
              <button
                className="primary"
                disabled={decisionBusy || !online}
                onClick={() => void decide(decision)}
              >
                {decisionBusy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Check size={16} />
                )}
                {decision.action === "confirm" ? "授权本次执行" : "确定拒绝"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
