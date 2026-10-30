import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatTimeline } from '../web/src/chat-timeline.js';
import type { WebChat, WebNotice, WebTask } from '../src/web-ui-types.js';

const chat = (id: string, at: string): WebChat => ({ requestId: id, text: '用户消息', run: {
  id, taskId: null, status: 'succeeded', startedAt: at, finishedAt: at, output: '回复', error: null,
  viewed: false, truncated: false, usage: { calls: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cost: null },
} });
const notice = (runId: string, at: string): WebNotice => ({
  runId, at, text: '任务原始结果', viewedAt: null, taskId: 'task-1', goalId: null,
});

test('Task入箱结果按到达时间插入对话，保留来源、原文与查看状态，重复轮询不追加重复消息', () => {
  const task: WebTask = { id: 'task-1', instruction: '煮玉米当晚饭', dueAt: '2026-10-28T09:50:01Z', status: 'succeeded', updatedAt: '2026-10-28T09:50:04Z', result: '任务原始结果' };
  const data = { chats: [chat('first', '2026-10-28T09:47:00Z'), chat('last', '2026-10-28T09:51:00Z')],
    inbox: [notice('background', '2026-10-28T09:50:04Z')], tasks: [task] };
  const before = JSON.stringify(data), timeline = chatTimeline(data);
  assert.deepEqual(timeline.map(item => item.id), ['chat:first', 'task:background', 'chat:last']);
  const reminder = timeline[1]!; assert.equal(reminder.kind, 'task');
  if (reminder.kind !== 'task') assert.fail('缺少主动提醒');
  assert.equal(reminder.notice, data.inbox[0]); assert.equal(reminder.task, task);
  assert.equal(reminder.notice.viewedAt, null); assert.equal(reminder.notice.text, '任务原始结果');
  assert.deepEqual(chatTimeline(data), timeline); assert.equal(JSON.stringify(data), before);
  data.inbox[0]!.viewedAt = '2026-10-28T09:52:00Z';
  assert.equal(chatTimeline(data).filter(item => item.kind === 'task').length, 1);
});

test('没有前台聊天仍展示Task提醒，任务不在最近列表时也保留持久通知', () => {
  const entry = chatTimeline({ chats: [], tasks: [], inbox: [notice('background', '2026-10-28T09:50:04Z')] })[0]!;
  assert.equal(entry.kind, 'task');
  if (entry.kind !== 'task') assert.fail('空聊天不应隐藏提醒');
  assert.equal(entry.task, undefined); assert.equal(entry.notice.runId, 'background');
});

test('文件提议仍走原聊天展示入口；Goal收件箱不借Task投影建立计划展示ACK', () => {
  const fileChat = chat('file', '2026-10-28T09:47:00Z');
  fileChat.run.fileOperationId = 'file-operation'; fileChat.run.output = null;
  const goalNotice = { ...notice('goal-run', '2026-10-28T09:50:04Z'), taskId: null, goalId: 'goal' };
  const timeline = chatTimeline({ chats: [fileChat], tasks: [], inbox: [goalNotice] });
  assert.equal(timeline.length, 1); const entry = timeline[0]!;
  assert.equal(entry.kind, 'chat');
  if (entry.kind !== 'chat') assert.fail('文件提议不应转为普通后台消息');
  assert.equal(entry.chat, fileChat); assert.equal(entry.chat.run.viewed, false);
  assert.equal(goalNotice.viewedAt, null);
});
