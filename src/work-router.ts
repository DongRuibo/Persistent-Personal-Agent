import type { WorkJobStore } from './work-job-store.js';
import type { WorkJob } from './work-job-types.js';
import type { WorkThreadActor } from './work-thread-types.js';
import type { WebRun } from './web-ui-types.js';

type ChatInput = { mode: 'chat'; requestId: string; text: string };
type WorkInput = { mode: 'work'; requestId: string; text: string; threadId: string };

// 显式分派，不猜测文字意图，也不请求 Router 模型；原 Chat 和 Guard 继续负责自然语言操作。
export class WorkRouter {
  constructor(private readonly jobs: WorkJobStore, readonly actor: WorkThreadActor,
    private readonly chat: (requestId: string, text: string) => WebRun, private readonly interrupt: (id: string) => void) {}
  route(input: ChatInput): WebRun;
  route(input: WorkInput): WorkJob;
  route(input: ChatInput | WorkInput): WebRun | WorkJob {
    return input.mode === 'chat' ? this.chat(input.requestId, input.text)
      : this.jobs.create(this.actor, input.threadId, input.requestId, input.text, new Date().toISOString());
  }
  list(threadId?: string): WorkJob[] { return this.jobs.list(this.actor, threadId); }
  get(id: string): WorkJob { return this.jobs.get(this.actor, id); }
  cancel(id: string): WorkJob {
    const job = this.jobs.cancel(this.actor, id, new Date().toISOString());
    if (job.status === 'cancelled') this.interrupt(id);
    return job;
  }
}
