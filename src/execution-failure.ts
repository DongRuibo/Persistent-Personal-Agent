export type FailureKind = 'rate_limited' | 'transient_server_error' | 'permanent_error' | 'timeout' | 'unknown';

// 只保存宿主定义的分类和HTTP元数据，不保留外部响应正文、请求头或凭据。
export class ExecutionFailure extends Error {
  constructor(readonly kind: FailureKind, readonly httpStatus?: number, readonly retryAfterMs?: number, message?: string) {
    super(message ?? `${kind}${httpStatus === undefined ? '' : ` (HTTP ${httpStatus})`}`);
  }
}

export function httpFailure(status: number, retryAfter?: string | null, now = Date.now()): ExecutionFailure {
  let wait: number | undefined;
  if (retryAfter) {
    if (/^\d+$/u.test(retryAfter.trim())) wait = Number(retryAfter) * 1000;
    else { const date = Date.parse(retryAfter); if (Number.isFinite(date)) wait = Math.max(0, date - now); }
    if (wait !== undefined && !Number.isSafeInteger(wait)) wait = undefined;
  }
  return new ExecutionFailure(status === 429 ? 'rate_limited' : status >= 500 ? 'transient_server_error' : 'permanent_error', status, wait);
}
