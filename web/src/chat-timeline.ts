import type { WebChat, WebNotice, WebSnapshot, WebTask } from "../../src/web-ui-types.js";

type ChatEntry = { id: string; at: string } & (
  | { kind: "chat"; chat: WebChat }
  | { kind: "task"; notice: WebNotice; task: WebTask | undefined }
);

export function chatTimeline(data: Pick<WebSnapshot, "chats" | "inbox" | "tasks">): ChatEntry[] {
  const entries = data.chats.map<ChatEntry>(chat => ({
    kind: "chat", id: `chat:${chat.run.id}`, at: chat.run.startedAt, chat,
  }));
  // 只投影同一收件箱中的Task结果；不创建聊天Run，也不把Goal计划当作已展示。
  for (const notice of data.inbox) if (notice.taskId && !notice.goalId) entries.push({
    kind: "task", id: `task:${notice.runId}`, at: notice.at, notice,
    task: data.tasks.find(task => task.id === notice.taskId),
  });
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}
