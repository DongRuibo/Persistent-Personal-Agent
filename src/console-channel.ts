import { createInterface } from 'node:readline';
import type { Interface } from 'node:readline';
import type { AgentExecutor, Channel } from './contracts.js';
import { ExecutionInterrupted } from './contracts.js';
import { SqliteStore } from './sqlite-store.js';
import { TaskService } from './task-service.js';

export const consoleHelp = `Personal Agent
  普通文本                         与 Agent 对话（支持自然语言任务管理）
  /create 明天上午9点 | 写一段早安问候  直接创建一次性任务
  /tasks                           列出最多100个任务（dueAt 为 UTC）
  /task <完整ID>                    查看任务、执行、用量及事件
  /cancel <完整ID>                  取消 pending 任务
  /runs                            查看最近100次执行（含对话）
  /quit                            停止服务
  --daemon                         无终端后台运行；SIGTERM/SIGINT 停止
  --feishu                         飞书私聊与主动通知；需配置应用及用户白名单
  --help                           显示说明，不读取 Key 或启动数据库`;

export class ConsoleChannel implements Channel {
  private reader?: Interface;
  constructor(private readonly redact: (value: unknown) => string) {}

  async sendMessage(message: { text: string; taskId?: string; runId?: string }): Promise<void> {
    console.log(this.redact(`${message.taskId ? `[task ${message.taskId}] ` : ''}${message.runId ? `[run ${message.runId}] ` : ''}${message.text}`));
    if (process.stdin.isTTY) this.reader?.prompt(true);
  }

  async run(executor: AgentExecutor, tasks: TaskService, store: SqliteStore, signal: AbortSignal): Promise<void> {
    const reader = this.reader = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const close = () => reader.close();
    signal.addEventListener('abort', close, { once: true });
    if (signal.aborted) close();
    console.log(consoleHelp);
    reader.setPrompt('you> ');
    if (process.stdin.isTTY) reader.prompt();
    try {
      for await (const raw of reader) {
        if (signal.aborted) break;
        const text = raw.trim();
        if (text === '/quit') break;
        try {
          if (!text) continue;
          let output: unknown;
          if (text === '/help') output = consoleHelp;
          else if (text === '/tasks') output = tasks.list();
          else if (text.startsWith('/task ')) {
            const id = text.slice(6).trim();
            output = { task: tasks.get(id), runs: store.listRuns(id).map((run) => ({ ...run, modelCalls: store.modelCalls(run.id), events: store.events(run.id) })) };
          } else if (text === '/runs') {
            output = store.listRuns().map((run) => ({ ...run, modelCalls: store.modelCalls(run.id), events: store.events(run.id) }));
          } else if (text.startsWith('/cancel ')) output = tasks.cancel(text.slice(8).trim());
          else if (text.startsWith('/create ')) {
            const delimiter = text.indexOf('|');
            if (delimiter < 0) throw new Error('用法：/create 明天上午9点 | 任务内容');
            output = tasks.create(text.slice(delimiter + 1), text.slice(8, delimiter));
          } else if (text.startsWith('/')) throw new Error('未知命令；输入 /help 查看用法');
          else {
            const run = store.beginRun(null, new Date().toISOString());
            try {
              const result = await executor.execute({ prompt: text, scope: 'chat', signal, observer: store.observer(run.id), source: { channel: 'console', reference: run.id } });
              store.finishRun(run.id, 'succeeded', new Date().toISOString(), result.text);
              output = result.text;
            } catch (error) {
              store.finishRun(run.id, error instanceof ExecutionInterrupted || signal.aborted ? 'interrupted' : 'failed', new Date().toISOString(), undefined, this.redact(error));
              throw error;
            }
          }
          await this.sendMessage({ text: typeof output === 'string' ? output : JSON.stringify(output, null, 2) });
        } catch (error) {
          await this.sendMessage({ text: `错误：${this.redact(error)}` });
        }
      }
    } finally {
      signal.removeEventListener('abort', close);
      close();
      this.reader = undefined;
    }
  }
}
