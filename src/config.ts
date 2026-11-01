import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { Temporal } from '@js-temporal/polyfill';
import type { FormationOptions } from './formation-types.js';
import type { ProactiveOptions } from './goal-policy-types.js';

export interface Config {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  timeZone: string;
  databasePath: string;
  sessionDir: string;
  memoryDir: string;
  memoryContextTokens: number;
  memoryQueryRewrite?: boolean;
  goalEnabled?: boolean;
  skillsEnabled?: boolean;
  webReadEnabled?: boolean;
  webSearchEnabled?: boolean;
  workThreadsEnabled?: boolean;
  workJobsEnabled?: boolean;
  workRoutingEnabled?: boolean;
  skillsDir?: string;
  localFiles?: { enabled: boolean; workspace: string; searchEnabled?: boolean };
  localOutput?: { enabled: boolean; workspace: string };
  proactive?: ProactiveOptions;
  pollIntervalMs: number;
  executionTimeoutMs: number;
  formation?: FormationOptions;
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
  const sessionDir = resolve(env.SESSION_DIR || `${databasePath}.sessions`);
  const memoryDir = resolve(env.MEMORY_DIR || `${databasePath}.memory`);
  const contains = (parent: string, child: string) => parent === child || child.startsWith(parent + sep);
  if (memoryDir === dirname(memoryDir) || contains(memoryDir, process.cwd()) || [databasePath, sessionDir].some((path) => contains(memoryDir, path) || contains(path, memoryDir))) {
    throw new Error('MEMORY_DIR 必须是专用目录，不能与 Task 数据库、Session 目录或项目根目录重叠');
  }
  const memoryContextTokens = Number(env.MEMORY_CONTEXT_TOKENS ?? 2048);
  if (!Number.isSafeInteger(memoryContextTokens) || memoryContextTokens < 512 || memoryContextTokens > 8192) throw new Error('MEMORY_CONTEXT_TOKENS 必须为512至8192的整数');
  if (env.MEMORY_QUERY_REWRITE && !['true', 'false'].includes(env.MEMORY_QUERY_REWRITE)) throw new Error('MEMORY_QUERY_REWRITE 必须为 true 或 false');
  if (env.MEMORY_FORMATION_ENABLED && !['true', 'false'].includes(env.MEMORY_FORMATION_ENABLED)) throw new Error('MEMORY_FORMATION_ENABLED 必须为 true 或 false');
  if (env.GOAL_ENABLED !== undefined && !['true', 'false'].includes(env.GOAL_ENABLED)) throw new Error('GOAL_ENABLED 必须为 true 或 false');
  if (env.SKILLS_ENABLED !== undefined && !['true', 'false'].includes(env.SKILLS_ENABLED)) throw new Error('SKILLS_ENABLED 必须为 true 或 false');
  if (env.WEB_READ_ENABLED !== undefined && !['true', 'false'].includes(env.WEB_READ_ENABLED)) throw new Error('WEB_READ_ENABLED 必须为 true 或 false');
  if (env.WORK_THREADS_ENABLED !== undefined && !['true', 'false'].includes(env.WORK_THREADS_ENABLED)) throw new Error('WORK_THREADS_ENABLED 必须为 true 或 false');
  if (env.WEB_SEARCH_ENABLED !== undefined && !['true', 'false'].includes(env.WEB_SEARCH_ENABLED)) throw new Error('WEB_SEARCH_ENABLED 必须为 true 或 false');
  if (env.WORK_JOBS_ENABLED !== undefined && !['true', 'false'].includes(env.WORK_JOBS_ENABLED)) throw new Error('WORK_JOBS_ENABLED 必须为 true 或 false');
  if (env.WORK_JOBS_ENABLED === 'true' && env.WORK_THREADS_ENABLED !== 'true') throw new Error('后台工作需要 WORK_THREADS_ENABLED=true');
  if (env.WORK_ROUTING_ENABLED !== undefined && !['true', 'false'].includes(env.WORK_ROUTING_ENABLED)) throw new Error('WORK_ROUTING_ENABLED 必须为 true 或 false');
  if (env.WORK_ROUTING_ENABLED === 'true' && (env.WORK_THREADS_ENABLED !== 'true' || env.WORK_JOBS_ENABLED !== 'true')) throw new Error('路由建议需要 WORK_THREADS_ENABLED=true 和 WORK_JOBS_ENABLED=true');
  const skillsDir = resolve(env.SKILLS_DIR || `${databasePath}.skills`);
  if (env.SKILLS_ENABLED === 'true' && (skillsDir === dirname(skillsDir) || contains(skillsDir, process.cwd())
    || [databasePath, sessionDir, memoryDir].some(path => contains(skillsDir, path) || contains(path, skillsDir)))) throw new Error('SKILLS_DIR必须是独立受管目录');
  if (env.LOCAL_FILES_ENABLED !== undefined && !['true', 'false'].includes(env.LOCAL_FILES_ENABLED)) throw new Error('LOCAL_FILES_ENABLED 必须为 true 或 false');
  const localFilesEnabled = env.LOCAL_FILES_ENABLED === 'true', workspace = env.LOCAL_FILES_WORKSPACE ? resolve(env.LOCAL_FILES_WORKSPACE) : '';
  if (env.LOCAL_FILES_SEARCH_ENABLED !== undefined && !['true', 'false'].includes(env.LOCAL_FILES_SEARCH_ENABLED)) throw new Error('LOCAL_FILES_SEARCH_ENABLED 必须为 true 或 false');
  const searchEnabled = env.LOCAL_FILES_SEARCH_ENABLED === 'true';
  if (searchEnabled && !localFilesEnabled) throw new Error('文件搜索需要LOCAL_FILES_ENABLED=true和批准副本');
  const localContains = (a: string, b: string) => contains(process.platform === 'win32' ? a.toLowerCase() : a, process.platform === 'win32' ? b.toLowerCase() : b);
  if (localFilesEnabled && (!env.LOCAL_FILES_WORKSPACE || !isAbsolute(env.LOCAL_FILES_WORKSPACE) || /^(?:\\\\|\/\/)/u.test(env.LOCAL_FILES_WORKSPACE) || workspace === dirname(workspace)
    || localContains(workspace, homedir()) || localContains(workspace, process.cwd()) || localContains(process.cwd(), workspace)
    || [databasePath, sessionDir, memoryDir, skillsDir].some(p => localContains(workspace, p) || localContains(p, workspace)))) throw new Error('LOCAL_FILES_WORKSPACE 必须为独立的绝对资料副本目录，不能覆盖个人目录、代码或应用数据');
  if (localFilesEnabled) for (let parent = workspace; ; parent = dirname(parent)) {
    if (existsSync(resolve(parent, '.git'))) throw new Error('LOCAL_FILES_WORKSPACE 不能位于Git仓库内，请使用专用资料副本');
    if (parent === dirname(parent)) break;
  }
  if (env.LOCAL_FILES_WRITE_ENABLED !== undefined && !['true','false'].includes(env.LOCAL_FILES_WRITE_ENABLED)) throw new Error('LOCAL_FILES_WRITE_ENABLED 必须为 true 或 false');
  const outputEnabled=env.LOCAL_FILES_WRITE_ENABLED==='true', output=env.LOCAL_FILES_OUTPUT?resolve(env.LOCAL_FILES_OUTPUT):'';
  if(outputEnabled&&(!env.LOCAL_FILES_OUTPUT||!isAbsolute(env.LOCAL_FILES_OUTPUT)||/^(?:\\\\|\/\/)/u.test(env.LOCAL_FILES_OUTPUT)||output===dirname(output)
    ||localContains(output,homedir())||localContains(output,process.cwd())||localContains(process.cwd(),output)
    ||[databasePath,sessionDir,memoryDir,skillsDir,...(localFilesEnabled?[workspace]:[])].some(p=>localContains(output,p)||localContains(p,output))))throw new Error('LOCAL_FILES_OUTPUT 必须是与资料、代码和应用数据分离的绝对输出目录');
  if(outputEnabled)for(let parent=output;;parent=dirname(parent)){if(existsSync(resolve(parent,'.git')))throw new Error('LOCAL_FILES_OUTPUT 不能位于Git仓库内');if(parent===dirname(parent))break;}
  if (env.PROACTIVE_ENABLED !== undefined && !['true', 'false'].includes(env.PROACTIVE_ENABLED)) throw new Error('PROACTIVE_ENABLED 必须为 true 或 false');
  const proactiveEnabled = env.PROACTIVE_ENABLED === 'true';
  if (proactiveEnabled && env.GOAL_ENABLED !== 'true') throw new Error('主动执行还需要 GOAL_ENABLED=true');
  const proactiveNumber = (key: string, fallback: number, integral = false) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < 0 || value > 10000 || integral && !Number.isSafeInteger(value)) throw new Error(`${key} 必须是有限的非负${integral ? '整数' : '数值'}`);
    return value;
  };
  const formationEnabled = env.MEMORY_FORMATION_ENABLED === 'true';
  const rate = (key: string) => {
    const value = Number(env[key] ?? 0);
    if (!Number.isFinite(value) || value < 0 || value > 10000 || formationEnabled && value === 0) throw new Error('启用形成前需显式配置有效的模型输入/输出人民币费率上界');
    return value;
  };
  return {
    provider: env.LLM_PROVIDER || 'openai',
    model: env.LLM_MODEL || 'gpt-4.1-mini',
    apiKey: env.LLM_API_KEY || '',
    baseUrl: env.LLM_BASE_URL,
    timeZone,
    databasePath,
    sessionDir,
    memoryDir,
    memoryContextTokens,
    memoryQueryRewrite: env.MEMORY_QUERY_REWRITE === 'true',
    goalEnabled: env.GOAL_ENABLED === 'true',
    skillsEnabled: env.SKILLS_ENABLED === 'true', skillsDir,
    localFiles: { enabled: localFilesEnabled, workspace, searchEnabled },
    localOutput: { enabled: outputEnabled, workspace: output },
    webReadEnabled: env.WEB_READ_ENABLED === 'true',
    webSearchEnabled: env.WEB_SEARCH_ENABLED === 'true',
    workThreadsEnabled: env.WORK_THREADS_ENABLED === 'true',
    workJobsEnabled: env.WORK_JOBS_ENABLED === 'true',
    workRoutingEnabled: env.WORK_ROUTING_ENABLED === 'true',
    proactive: { enabled: proactiveEnabled, inputRate: proactiveNumber('PROACTIVE_INPUT_CNY_PER_MILLION', 0),
      outputRate: proactiveNumber('PROACTIVE_OUTPUT_CNY_PER_MILLION', 0), dailyCalls: proactiveNumber('PROACTIVE_DAILY_CALLS', 20, true),
      dailyExecutions: proactiveNumber('PROACTIVE_DAILY_EXECUTIONS', 20, true), dailyBudgetCny: proactiveNumber('PROACTIVE_DAILY_BUDGET_CNY', 1),
      totalExecutions: proactiveNumber('PROACTIVE_TOTAL_EXECUTIONS', 100, true), totalBudgetCny: proactiveNumber('PROACTIVE_TOTAL_BUDGET_CNY', 5) },
    pollIntervalMs: integer('POLL_INTERVAL_MS', 1000),
    executionTimeoutMs: integer('EXECUTION_TIMEOUT_MS', 120_000),
    formation: { enabled: formationEnabled, owner: 'single-user', inputRate: rate('MEMORY_FORMATION_INPUT_CNY_PER_MILLION'),
      outputRate: rate('MEMORY_FORMATION_OUTPUT_CNY_PER_MILLION'), dailyCalls: 20, dailyBudget: 0.2, idleMs: 10000 },
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
