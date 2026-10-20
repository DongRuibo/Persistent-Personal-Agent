import { resolve } from 'node:path';
import { Temporal } from '@js-temporal/polyfill';

export interface Config {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeZone: string;
  databasePath: string;
  sessionDir: string;
  pollIntervalMs: number;
  executionTimeoutMs: number;
}

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  allowedOpenId: string;
}

export function readFeishuConfig(env: NodeJS.ProcessEnv = process.env): FeishuConfig {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value || value === '<REDACTED>') throw new Error(`飞书模式需要在本机配置 ${name}`);
    return value;
  };
  const appId = required('FEISHU_APP_ID');
  const appSecret = required('FEISHU_APP_SECRET');
  const allowedOpenId = required('FEISHU_ALLOWED_OPEN_ID');
  if (!/^cli_[0-9a-fA-F]{16}$/.test(appId)) throw new Error('FEISHU_APP_ID 格式不正确，请填写企业自建应用的 App ID');
  if (!/^ou_[A-Za-z0-9_-]+$/.test(allowedOpenId)) throw new Error('FEISHU_ALLOWED_OPEN_ID 必须是该应用下的用户 open_id（ou_ 开头）');
  return { appId, appSecret, allowedOpenId };
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
  const databasePath = resolve(env.DATABASE_PATH || './data/agent.db');
  return {
    provider: env.LLM_PROVIDER || 'openai',
    model: env.LLM_MODEL || 'gpt-4.1-mini',
    apiKey: env.LLM_API_KEY || '',
    baseUrl: env.LLM_BASE_URL,
    timeZone,
    databasePath,
    sessionDir: resolve(env.SESSION_DIR || `${databasePath}.sessions`),
    pollIntervalMs: integer('POLL_INTERVAL_MS', 1000),
    executionTimeoutMs: integer('EXECUTION_TIMEOUT_MS', 120_000),
  };
}

export function redactor(secret: string, ...additionalSecrets: (string | undefined)[]): (value: unknown) => string {
  return (value) => {
    let text = value instanceof Error ? value.message : String(value);
    for (const value of [secret, ...additionalSecrets]) {
      if (value) text = text.split(value).join('<REDACTED>');
    }
    return text
      .replace(/Bearer\s+[^\s"',}]+/gi, 'Bearer <REDACTED>')
      .replace(/((?:api[_-]?key|app[_-]?secret|token|password)\s*[=:]\s*)[^\s,;}]+/gi, '$1<REDACTED>');
  };
}
