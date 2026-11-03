import type { WebChat, WebNotice, WebSnapshot, WebTask, WebWorkRoute, WebRequestReceipt, WebWorkJob } from "../../src/web-ui-types.js";

type ChatEntry = { id: string; at: string } & (
  | { kind: "chat"; chat: WebChat }
  | { kind: "suggestion"; suggestion: WebWorkRoute }
  | { kind: "request"; request: WebRequestReceipt }
  | { kind: "work"; job: WebWorkJob }
  | { kind: "goal"; notice: WebNotice }
  | { kind: "task"; notice: WebNotice; task: WebTask | undefined }
);

export function chatTimeline(data: Pick<WebSnapshot, "chats" | "inbox" | "tasks" | "suggestions" | "requests" | "workResults">): ChatEntry[] {
  const requests = new Set(data.requests?.map(request => request.requestId));
  const entries = data.chats.filter(chat => !requests.has(chat.requestId)).map<ChatEntry>(chat => ({
    kind: "chat", id: `chat:${chat.run.id}`, at: chat.run.startedAt, chat,
  }));
  for (const request of data.requests ?? []) entries.push({ kind: "request", id: `request:${request.requestId}`, at: request.createdAt, request });
  const results = new Set<string>();
  for (const job of data.workResults ?? []) if (!results.has(job.runId ?? job.id)) {
    results.add(job.runId ?? job.id);
    entries.push({ kind: "work", id: `work:${job.runId ?? job.id}`, at: job.run?.finishedAt ?? job.createdAt, job });
  }
  // Goal通知仅投影已存在的结果，不建立计划展示或控制许可。
  for (const notice of data.inbox) if (data.requests && notice.goalId && !results.has(notice.runId)) {
    results.add(notice.runId); entries.push({ kind: "goal", id: `goal:${notice.runId}`, at: notice.at, notice });
  }
  for (const suggestion of data.suggestions ?? []) entries.push({
    kind: "suggestion", id: `suggestion:${suggestion.run.id}`, at: suggestion.run.startedAt, suggestion,
  });
  // 只投影同一收件箱中的Task结果；不创建聊天Run，也不把Goal计划当作已展示。
  for (const notice of data.inbox) if (notice.taskId && !notice.goalId) entries.push({
    kind: "task", id: `task:${notice.runId}`, at: notice.at, notice,
    task: data.tasks.find(task => task.id === notice.taskId),
  });
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
