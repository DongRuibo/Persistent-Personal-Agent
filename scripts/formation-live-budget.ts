export type LivePhase = 'extraction' | 'approval' | 'generation';
export interface LivePayload { model: string; enable_thinking?: boolean; max_tokens: number; tools?: unknown[] }
export const safeReportJson = (value: unknown, redact: (value: unknown) => string): string => JSON.stringify(value, (_key, item: unknown) => typeof item === 'string' ? redact(item) : item, 2);

// 仅用于这轮隔离验收；预留按请求字节和输出上限，不把失败的未知消费退回。
export class FormationLiveBudget {
  readonly attempts: { phase: LivePhase; bytes: number; outputLimit: number; reservedCny: number }[] = [];
  get reservedCny(): number { return this.attempts.reduce((sum, attempt) => sum + attempt.reservedCny, 0); }
  reserve(phase: LivePhase, payload: LivePayload, bytes: number): void {
    const countLimit = { extraction: 12, approval: 2, generation: 2 };
    const outputLimit = { extraction: 512, approval: 1000, generation: 4096 };
    if (payload.model !== 'deepseek-ai/DeepSeek-V4.1-Flash' || payload.enable_thinking !== false || payload.tools?.length ||
      !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 16384 || !Number.isSafeInteger(payload.max_tokens) || payload.max_tokens < 1 || payload.max_tokens > outputLimit[phase]) throw new Error('验收模型/请求体/工具/Token上限不符，未发送');
    if (this.attempts.length >= 16 || this.attempts.filter(attempt => attempt.phase === phase).length >= countLimit[phase]) throw new Error('16次或阶段请求上限已到，未发送');
    const reservedCny = ((bytes + 512) * 10 + payload.max_tokens * 20) / 1_000_000;
    if (this.reservedCny + reservedCny > 1) throw new Error('1元保守预算不足，未发送');
    this.attempts.push({ phase, bytes, outputLimit: payload.max_tokens, reservedCny });
  }
}
