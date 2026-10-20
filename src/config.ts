import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';

export interface Config {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeZone: string;
  databasePath: string;
  pollIntervalMs: number;
  executionTimeoutMs: number;
}

export function validateTimeZone(zone: string): void {
  // 拒绝固定偏移，要求命名时区，夏令时由 IANA 规则处理。
  if (/^[+-]/.test(zone)) throw new Error('USER_TIMEZONE 必须是 IANA 时区，如 Asia/Taipei');
  Temporal.Now.zonedDateTimeISO(zone);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const timeZone = env.USER_TIMEZONE || 'Asia/Taipei';
  validateTimeZone(timeZone);
  const integer = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
      throw new Error(`${name} 必须是有效的正整数毫秒值`);
    }
    return value;
  };
  if (env.LLM_BASE_URL) {
    const url = new URL(env.LLM_BASE_URL);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('LLM_BASE_URL 必须是无凭据、查询参数或片段的 HTTP(S) 地址');
    }
  }
  return {
    provider: env.LLM_PROVIDER || 'openai',
    model: env.LLM_MODEL || 'gpt-4.1-mini',
    apiKey: env.LLM_API_KEY || '',
    baseUrl: env.LLM_BASE_URL,
    timeZone,
    databasePath: resolve(env.DATABASE_PATH || './data/agent.db'),
    pollIntervalMs: integer('POLL_INTERVAL_MS', 1000),
    executionTimeoutMs: integer('EXECUTION_TIMEOUT_MS', 120_000),
  };
}

export function redactor(secret: string): (value: unknown) => string {
  return (value) => {
    let text = value instanceof Error ? value.message : String(value);
    if (secret) text = text.split(secret).join('<REDACTED>');
    return text
      .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer <REDACTED>')
      .replace(/((?:api[_-]?key|token|password)\s*[=:]\s*)[^\s,;}]+/gi, '$1<REDACTED>');
  };
}
