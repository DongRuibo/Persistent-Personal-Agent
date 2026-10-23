import { AsyncLocalStorage } from 'node:async_hooks';
import { GoalPlanQuantityError, validateQuantityApproval } from './goal-plan-quantity.js';
import { createHash } from 'node:crypto';
import { Type } from 'typebox';
import type { Static } from 'typebox';
import * as Value from 'typebox/value';
import type { ExecutionRequest, MemoryRecord, Task, WriteOperation } from './contracts.js';
import type { TaskService } from './task-service.js';
import type { FileMemoryService } from './memory-service.js';
import { parseTaskTime, taskTimeRange } from './time.js';
import type { FormationService } from './formation-service.js';
import type { CandidateView } from './formation-types.js';
import type { GoalService, GoalDisplay, GoalAction } from './goal-service.js';
import type { Goal } from './goal-types.js';
import type { WebReadService } from './web-read-service.js';
import type { WebReadStore } from './web-read-store.js';
import { webHash } from './web-read-types.js';
import type { WebView } from './web-read-types.js';
import { confirmsWebRequest, rejectsWebRequest, webPreview, webRequestSelection } from './web-read-authorization.js';

const text = Type.String({ maxLength: 12000 });
export const intentSchema = Type.Object({
  action: Type.Union([Type.Literal('none'), Type.Literal('create_task'), Type.Literal('cancel_task'), Type.Literal('memory_remember'), Type.Literal('memory_update'), Type.Literal('memory_forget'), Type.Literal('memory_review'), Type.Literal('goal_manage')]),
  mode: Type.Union([Type.Literal('request'), Type.Literal('query'), Type.Literal('negated'), Type.Literal('hypothetical'), Type.Literal('quoted'), Type.Literal('uncertain')]),
  evidence: text,
  confirmation: Type.Optional(Type.Boolean()),
  bodyEvidence: Type.Optional(text), body: Type.Optional(text), when: Type.Optional(text),
  kind: Type.Optional(Type.Union([Type.Literal('semantic'), Type.Literal('project'), Type.Literal('episodic'), Type.Literal('procedural')])),
  key: Type.Optional(Type.String({ maxLength: 100 })),
  review: Type.Optional(Type.Union([Type.Literal('list'), Type.Literal('approve'), Type.Literal('reject'), Type.Literal('reject_view'), Type.Literal('edit'), Type.Literal('clarify')])),
  goalAction: Type.Optional(Type.Union(['create', 'list', 'view', 'continue', 'pause', 'cancel', 'approve_plan', 'revise_plan', 'complete'].map(value => Type.Literal(value)))),
  executeNext: Type.Optional(Type.Boolean()), regenerate: Type.Optional(Type.Boolean()),
  revisionMode: Type.Optional(Type.Union([Type.Literal('prepend'), Type.Literal('replace')])),
  skillId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()])),
  planSteps: Type.Optional(Type.Array(Type.Object({ title: text, instruction: text, deliverable: text, doneWhen: text,
    skillId: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()])) }, { additionalProperties: false }), { minItems: 1, maxItems: 12 })),
  selector: Type.Optional(Type.Object({
    keywords: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 8 }),
    when: Type.Optional(text), reference: Type.Optional(Type.Union([Type.Literal('latest'), Type.Literal('last'), Type.Literal('choice')])),
    position: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
export type Intent = Static<typeof intentSchema>;
type Tool = WriteOperation['tool'];
interface Choices { tool: Tool; ids: string[]; expires: number }
export interface DialogueReferences {
  tasks?: string[]; lastTask?: string; lastMemory?: string;
  taskViewExpires?: number; lastTaskExpires?: number; lastMemoryExpires?: number;
  choices?: Choices; confirmation?: { operation: WriteOperation; expires: number };
  candidateReview?: CandidateView;
  goalView?: GoalDisplay;
  webView?: WebView;
}
interface Frame { request: ExecutionRequest; references: DialogueReferences; plan?: Promise<WriteOperation | string>; used: boolean; answer?: string }
export type Interpret = (message: string, pending: { tool?: Tool | 'memory_review' | 'goal_manage'; count?: number; confirmation?: boolean; goalAction?: GoalAction }, request: ExecutionRequest) => Promise<unknown>;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/gu, '');
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
function matches(text: string, term: string): boolean {
  if (normalize(text).includes(normalize(term))) return true;
  // 扩大候选而非擅选最相似项；否定词存在时不丢弃短词，以免反转筛选含义。
  if (/[不没非别无]/u.test(term)) return false;
  const words = [...segmenter.segment(term)].filter((part) => part.isWordLike && [...part.segment].length >= 2).map((part) => part.segment);
  return words.length > 0 && words.every((word) => normalize(text).includes(normalize(word)));
}
const ttl = 5 * 60_000;

function memorySaveRequest(message: string, fact: string): 'direct' | 'confirm' | 'none' {
  const marker = '[事实]';
  // 事实和引文里的“保存/记住”不是授权动作；只检查当前原话中事实之外的请求框架。
  const frame = message.normalize('NFKC').split(fact.normalize('NFKC')).join(marker)
    .replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'|`[^`]*`/gu, value => value.includes(marker) ? marker : ' ')
    .replace(/^(?:kind|key)=.+$/gmu, '').trim();
  if (!frame.includes(marker) || /如果|假设|假如|要是|引用|他说|她说|朋友说|不要|不用|无需|别|先不|[?？]/u.test(frame)) return 'none';
  const prefix = '(?:(?:请(?:帮我)?|帮我|麻烦你?|你(?:可以|要|帮我)?|我(?:想|希望)(?:让)?你|(?:以后|今后)你要)[，,\\s]*)*';
  const direct = new RegExp(`^${prefix}(?:记住|记一下|记下来|记得)[：:，,\\s]*\\[事实\\][。！!吧\\s]*$`, 'u');
  const storage = new RegExp(`^${prefix}把?\\[事实\\](?:保存|存入|记录)(?:为|到|在)长期记忆(?:里|中)?[。！!吧\\s]*$`, 'u');
  if (direct.test(frame) || storage.test(frame)) return 'direct';
  // 这只是有界的直接执行快路径；其他自然记忆请求仍可确认，不要求固定命令格式。
  return /记住|记一下|记下来|记得|长期记忆/u.test(frame) ? 'confirm' : 'none';
}

function confirmsMemorySave(message: string): boolean {
  const text = message.normalize('NFKC').replace(/[，,。！!\s]/gu, '');
  // 短确认已由resolve处理；长确认必须指向宿主刚展示的内容，不能只信模型的confirmation标签。
  return /^(?:可以|好的|同意|确认|行|没问题)(?:就)?按你?(?:刚才|上面)(?:整理|展示)?的?(?:内容|草稿)保存吧?$/u.test(text);
}

// 只校验可确定的选择标记，不代替自然语言意图解析；引号里的标题/示例不授予引用能力。
function referenceFromMessage(message: string): { reference: 'choice' | 'last' | 'latest'; position?: number } | 'ambiguous' | undefined {
  const text = message.normalize('NFKC').replace(/\s+/gu, '').replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'|`[^`]*`/gu, ' ');
  const positions = [...text.matchAll(/第([0-9零〇一二两三四五六七八九十百]+)(?:个|项|条|号)|([0-9零〇一二两三四五六七八九十百]+)号/gu)].map((match) => {
    const value = match[1] ?? match[2]!;
    if (/^\d+$/u.test(value)) return Number(value);
    if (value === '一百') return 100;
    const digits = '零一二三四五六七八九';
    if (value === '两') return 2;
    if (/^[一二三四五六七八九]$/u.test(value)) return digits.indexOf(value);
    if (/^[一二三四五六七八九]?十[一二三四五六七八九]?$/u.test(value)) {
      const [tens, units] = value.split('十');
      return (tens ? digits.indexOf(tens) : 1) * 10 + (units ? digits.indexOf(units) : 0);
    }
    return NaN;
  });
  if (positions.length) {
    if (/倒数|从后/u.test(text) || positions.some((value) => !Number.isInteger(value) || value < 1 || value > 100) || new Set(positions).size !== 1) return 'ambiguous';
    return { reference: 'choice', position: positions[0]! };
  }
  if (/最新|最近(?:一次)?(?:创建|新建|设置|保存)|最后(?:一次|一个|一条)?(?:创建|新建|设置|保存)/u.test(text)) return { reference: 'latest' };
  if (/刚才|刚刚|刚(?:创建|新建|设置|设|保存)|上一(?:个|条|次)|上次/u.test(text)) return { reference: 'last' };
  return undefined;
}

function candidateRejection(message: string): Intent | undefined {
  const text = message.normalize('NFKC').replace(/\s+/gu, '');
  const item = '(?:第[0-9零〇一二两三四五六七八九十百]+(?:条|个|项)|[0-9零〇一二两三四五六七八九十百]+号)(?:记忆候选|候选|记忆)?';
  const decline = '(?:先|暂时)?(?:不保存|不要保存|不用保存|不记下来|拒绝)';
  const single = new RegExp(`^(?:请)?(?:(?:把)?${item}${decline}|${decline}${item})[。！!吧]?$`, 'u');
  const all = /^(?:请)?(?:这些|全部)(?:记忆候选|候选|记忆)?(?:先|暂时)?(?:不保存|不要保存|不用保存|拒绝)[。！!吧]?$/u;
  const reference = referenceFromMessage(message);
  if (single.test(text) && reference && reference !== 'ambiguous' && reference.reference === 'choice') return {
    action: 'memory_review', mode: 'request', evidence: message, review: 'reject', selector: { ...reference, keywords: [] },
  };
  if (all.test(text)) return { action: 'memory_review', mode: 'request', evidence: message, review: 'reject_view' };
  return undefined;
}

// 唯一能将隔离解析结果变为本轮能力的宿主边界；主 Agent/Memory 无法写入该状态。
export class OperationGuard {
  private readonly context = new AsyncLocalStorage<Frame>();
  constructor(private readonly tasks: TaskService, private readonly memory: FileMemoryService | undefined,
    private readonly interpret: Interpret, private readonly state: DialogueReferences,
    private readonly saveState: (value: DialogueReferences) => void = () => {},
    private readonly web?: { service: WebReadService; store: WebReadStore; owner: string }) {}

  async withRequest<T extends { text: string }>(request: ExecutionRequest, action: () => Promise<T>, formation?: FormationService): Promise<T> {
    if (request.scope !== 'chat') return action();
    if (this.web && this.state.webView && !confirmsWebRequest(request.prompt)) { delete this.state.webView; this.saveState(this.state); }
    const frame: Frame = { request, references: structuredClone(this.state), used: false };
    return this.context.run(frame, async () => {
      try {
        const result = await action();
        // 主模型可能只口头答应拒绝；仅对当前原话中的有界拒绝补执行，仍走原显示/序号/版本校验。
        if (!frame.plan && formation?.options.enabled && frame.references.candidateReview && candidateRejection(request.prompt)) await this.reviewCandidates(formation);
        return frame.answer ? { ...result, text: frame.answer } : result;
      } finally {
        if (!frame.plan && (this.state.choices || this.state.confirmation || this.state.candidateReview)) { delete this.state.choices; delete this.state.confirmation; delete this.state.candidateReview; this.saveState(this.state); }
      }
    });
  }

  private frame(): Frame {
    const frame = this.context.getStore(); frame?.request.signal.throwIfAborted();
    if (!frame || frame.request.scope !== 'chat') throw new Error('写工具需要当前已鉴权的交互请求，后台不能写入');
    return frame;
  }

  async readWeb(resourceId: string, remainingBytes: number, signal?: AbortSignal) {
    const frame = this.frame(), web = this.web;
    if (!web || frame.used || frame.plan) throw new Error('本轮没有可用的独立Web读取许可');
    frame.used = true;
    const request = frame.request, target = this.tasks.currentTarget();
    const actor = { owner: web.owner, channel: JSON.stringify(target) }, now = this.tasks.now();
    const reject = (message: string) => { delete this.state.webView; this.saveState(this.state); frame.answer = message; return { message }; };
    if (!request.source || request.source.channel !== target.channel || rejectsWebRequest(request.prompt)) return reject('本轮没有明确Web读取授权；未联网。');
    const resource = web.service.current(resourceId), selection = webRequestSelection(request.prompt, web.service.list());
    if (!confirmsWebRequest(request.prompt) && !selection.ids.length && !/文档|资料|网页|查阅|documentation|web/iu.test(request.prompt)) return reject('当前未提出读取公开资料的需求；未联网。');
    if (selection.ids.length > 1 || selection.ids.length === 1 && selection.ids[0] !== resourceId) return reject('资源不唯一或模型提议与当前原话不符；请明确一份文档，未联网。');
    let permitId = webHash(['direct', request.source.reference, actor, resource.hash]);
    if (confirmsWebRequest(request.prompt)) {
      const view = frame.references.webView;
      if (!view || view.resourceId !== resourceId || view.catalogHash !== resource.hash || !web.store.displayed(view, actor, now.getTime())) return reject('没有当前用户已成功收到且仍有效的Web确认清单；请重新说明读取需求，未联网。');
      permitId = webHash(['confirmed', view.displayRunId, actor, view.catalogHash]);
    } else if (!selection.direct || selection.ids.length !== 1) {
      const text = webPreview(resource, request.prompt);
      const view: WebView = { ...actor, resourceId, catalogHash: resource.hash, expires: now.getTime() + ttl,
        displayRunId: request.source.reference, displayHash: webHash(text), purpose: request.prompt };
      this.state.webView = view; this.saveState(this.state); request.observer.event('web_read_preview', webHash(view)); frame.answer = text;
      return { message: text };
    }
    if (!Number.isSafeInteger(remainingBytes) || remainingBytes <= 0) return reject('本Session Web正文额度已用尽；未联网，普通聊天仍可继续。');
    delete this.state.webView; this.saveState(this.state);
    request.observer.event('operation_authorized', JSON.stringify({ tool: 'web_get', resourceId, catalogHash: resource.hash }));
    return web.service.read(web.store, { ...actor, id: permitId, runId: request.source.reference, resourceId, catalogHash: resource.hash, expires: now.getTime() + ttl },
      signal ? AbortSignal.any([request.signal, signal]) : request.signal, () => this.tasks.now());
  }

  // 查询的显示顺序由宿主固定，防止模型重排后“第二个”对应了错误任务。
  taskList(id?: string, when?: string, keywords: string[] = [], pendingOnly = false): Task[] {
    const frame = this.frame();
    delete this.state.goalView;
    delete this.state.candidateReview;
    const visible = this.tasks.visibleTasks();
    if ((when && !frame.request.prompt.includes(when)) || keywords.some((term) => !frame.request.prompt.includes(term))) throw new Error('查询条件必须来自当前用户消息');
    let records = id ? visible.filter((record) => record.id === id) : visible.slice(0, 100);
    if (when) { const [start, end] = taskTimeRange(when, this.tasks.timeZone, this.tasks.now()); records = records.filter((record) => record.dueAt >= start && record.dueAt < end); }
    records = records.filter((record) => (!pendingOnly || record.status === 'pending') && keywords.every((term) => normalize(record.instruction).includes(normalize(term))));
    if (id && !records.length) throw new Error('任务不属于当前用户或不在可查询范围内');
    this.state.tasks = records.map((record) => record.id);
    this.state.taskViewExpires = this.tasks.now().getTime() + ttl;
    if (records.length === 1) { this.state.lastTask = records[0]!.id; this.state.lastTaskExpires = this.state.taskViewExpires; } else delete this.state.lastTask;
    this.saveState(this.state);
    frame.answer = records.length ? records.map((record, index) => `${index + 1}. ${record.instruction}；${this.local(record.dueAt)}；${record.status}`).join('\n') : '当前没有匹配的提醒。';
    return records;
  }

  private local(time: string): string { return new Date(time).toLocaleString('zh-CN', { timeZone: this.tasks.timeZone, hour12: false }); }

  async manageGoals(goals: GoalService, signal?: AbortSignal): Promise<unknown> {
    const frame = this.frame();
    if (frame.used || frame.plan) throw new Error('本轮操作已经消费，不能同时控制Goal和Task/Memory');
    frame.used = true; frame.plan = Promise.resolve('goal_manage');
    if (signal) frame.request = { ...frame.request, signal: AbortSignal.any([frame.request.signal, signal]) };
    const request = frame.request;
    request.observer.event('goal_review');
    const priorReceipt = goals.receipt(request);
    const show = (records: Goal[], action?: GoalAction, prefix = '') => {
      if (!request.source) throw new Error('Goal显示需要可信来源Run');
      const text = records.length === 1 ? goals.render(records[0]!.id) : records.length
        ? records.map((goal, index) => `${index + 1}. ${goal.objective}；${goal.status}；版本${goal.revision}`).join('\n') : '当前没有匹配的长期目标。';
      this.state.goalView = { items: records.map(goal => ({ id: goal.id, revision: goal.revision, draftHash: goal.pendingAction?.hash })),
        expires: this.tasks.now().getTime() + ttl, displayRunId: request.source.reference, action, details: records.length === 1 };
      delete this.state.choices; delete this.state.confirmation; delete this.state.candidateReview;
      this.saveState(this.state); frame.answer = prefix + text;
      return { status: 'displayed', count: records.length };
    };
    if (priorReceipt) return show([priorReceipt], undefined, '此请求已有控制收据，以下为当前状态：\n');
    const display = frame.references.goalView;
    const shortConfirm = /^(?:确认|同意|就这样|好的，就这样)[。！!]?$/u.test(request.prompt.trim());
    let raw: unknown;
    if (shortConfirm && display?.items.length === 1 && display.items[0]?.draftHash) {
      raw = { action: 'goal_manage', goalAction: 'approve_plan', mode: 'request', evidence: request.prompt,
        selector: { keywords: [] } };
    } else raw = await this.interpret(request.prompt, { tool: 'goal_manage', count: display?.items.length,
      confirmation: display?.items.length === 1 && !!display.items[0]?.draftHash, goalAction: display?.action }, request);
    request.signal.throwIfAborted();
    if (!Value.Check(intentSchema, raw)) throw new Error('Goal意图格式无效');
    const intent = raw as Intent, action = intent.goalAction as GoalAction | undefined;
    if (intent.action !== 'goal_manage' || !action || !intent.evidence.trim() || !request.prompt.includes(intent.evidence)) throw new Error('没有当前Goal操作意图');
    const query = action === 'list' || action === 'view';
    if (query ? !['query', 'request'].includes(intent.mode) : intent.mode !== 'request') throw new Error('否定、假设、引用或不确定消息不能控制Goal');
    const message = request.prompt.normalize('NFKC');
    const activeText = message.replace(/「[^」]*」|『[^』]*』|“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'|`[^`]*`/gu, ' ');
    // 仅创建时区分完整的产物真实性约束与操作否定；原话仍完整保存，混合或未知子句不放行。
    const authorizationText = action === 'create' ? activeText.replace(/(?:^|[。；;，,])\s*不要(?:替我|擅自)?(?:假设(?:我)?(?:已经|已)?掌握(?:相关)?(?:知识|技能)|虚构(?:任何|我的)?(?:经历|事实|能力))(?=[。；;，,]|$)/gu, ' ') : activeText;
    if (!query && /如果|假设|假如|要是|他说|她说|引用|不要|不用|无需|先不|别|[?？]/u.test(action === 'cancel' ? authorizationText.replace('不用做了', '') : authorizationText)) throw new Error('当前请求没有明确执行授权');
    if (action === 'create') {
      if (!/(?:创建|新建|建立|保存).{0,15}(?:长期目标|长期任务|学习计划)|(?:帮我|和我|跟我).{0,8}(?:逐步|持续|分阶段)|(?:长期目标|长期任务).{0,8}(?:创建|建立)/u.test(activeText)
        || /自动|定时|每[天周月]|无人/u.test(activeText)) { frame.answer = '请明确是否保存为可手动继续的长期目标；每次只执行一段，暂不支持自动或定时推进。'; return { status: 'clarification' }; }
      const created = goals.apply(request, action);
      request.observer.event('operation_committed', JSON.stringify({ tool: 'goal_manage', id: created.id }));
      return show([created], undefined, '已创建并排队，最多执行一个初始化片段。\n');
    }
    const selector = intent.selector ?? { keywords: [] };
    if (selector.when || selector.keywords.some(term => !request.prompt.includes(term))) throw new Error('目标筛选条件必须来自当前原话；Goal没有时间筛选');
    let reference = referenceFromMessage(request.prompt);
    const pointing = [...activeText.matchAll(/那个|这个/gu)];
    if (pointing.length && (pointing.length > 1 || /还是|或者|另一个|其他|别的|它们|这两个|那两个/u.test(activeText)
      || /暂停|先停|停一下/u.test(activeText) && /取消|终止|放弃/u.test(activeText))) {
      frame.answer = '指代存在歧义，请明确一个目标或重新查看并选择编号；本轮未操作。'; return { status: 'clarification' };
    }
    // “那个计划”只指向宿主刚完整展示的唯一Goal；不能仅凭模型last标签选择数据库记录。
    const demonstrative = reference === undefined && /(?:那个|这个)(?:学习计划|长期目标|长期任务|目标|计划)/u.test(activeText);
    if (demonstrative) {
      if (!display?.details || display.items.length !== 1) {
        frame.answer = '没有唯一的完整目标视图，请先查看并明确选择目标；本轮未操作。'; return { status: 'clarification' };
      }
      goals.validateDisplay(display);
      reference = { reference: 'last' };
    }
    if (reference === 'ambiguous' || selector.reference && selector.reference !== reference?.reference
      || reference?.reference === 'choice' && (selector.reference !== 'choice' || selector.position !== reference.position)
      || selector.position !== undefined && selector.reference !== 'choice') {
      frame.answer = '序号或引用与原话不一致，请重新查看并选择目标。'; return { status: 'clarification' };
    }
    let records = goals.list();
    if (records.length > 100) { frame.answer = '目标较多，请先归档或使用更具体的范围；本轮未操作。'; return { status: 'clarification' }; }
    const hasFilters = selector.keywords.length > 0;
    if (selector.reference === 'choice' || shortConfirm || selector.reference === 'last' || demonstrative) {
      if (!display) { frame.answer = '没有有效目标清单，请先查看进度。'; return { status: 'clarification' }; }
      goals.validateDisplay(display);
      const item = selector.reference === 'choice' ? display.items[(selector.position ?? 0) - 1] : display.items.length === 1 ? display.items[0] : undefined;
      records = records.filter(goal => goal.id === item?.id);
    }
    records = records.filter(goal => selector.keywords.every(term => matches(goal.objective, term)));
    if (selector.reference === 'latest') records = records.slice(0, 1);
    if (!query && !selector.reference && !hasFilters && !shortConfirm) {
      if (display?.items.length === 1) { goals.validateDisplay(display); records = records.filter(goal => goal.id === display.items[0]!.id); }
      else return show(records, action, '请明确要操作的目标或选择清单编号；本轮未操作。\n');
    }
    if (query) return show(records);
    if (records.length !== 1) return show(records, action, records.length > 1 ? '有多个可能目标，请选择第几个；本轮未操作。\n' : '未找到目标；本轮未操作。\n');
    const goal = records[0]!;
    const verbs: Partial<Record<GoalAction, RegExp>> = { continue: /继续|接着|推进|重新生成/u, pause: /暂停|先停|停一下/u,
      cancel: /取消|终止|放弃|不用做了/u, complete: /(?:确认|确定).{0,25}(?:完成|达成)/u, revise_plan: /调整|改成|改为|先补|增加|新增|替换|重排/u };
    // 待选操作只能由纯选择短句延续；“查看刚才/第二个”不能被模型变成暂停或取消。
    const selectionOnly = /^(?:第[0-9零〇一二两三四五六七八九十百]+(?:个|项|条|号)|[0-9零〇一二两三四五六七八九十百]+号|刚才那个|上一个)[。！!]?$/u.test(activeText.trim());
    const bindingRequest = action === 'revise_plan' && intent.skillId !== undefined && /当前步骤|这一步/u.test(activeText)
      && /(?:使用|改用|绑定|移除|停用).{0,30}(?:Skill|技能)/iu.test(activeText);
    if (verbs[action] && !verbs[action]!.test(activeText) && !bindingRequest && !(selectionOnly && reference && display?.action === action)) throw new Error('原话中没有对应操作依据');
    const options: Parameters<GoalService['apply']>[3] = {};
    if (action === 'approve_plan' || action === 'complete') {
      if (!display?.details || !display.items.some(item => item.id === goal.id)) return show([goal], action, '请先核对下面当前内容，再明确确认。\n');
      goals.validateDisplay(display, true);
      if (action === 'approve_plan' && goal.pendingAction) {
        try { validateQuantityApproval(goal.objective, goal.pendingAction.spec.steps.length, request.prompt); }
        catch (error) {
          if (!(error instanceof GoalPlanQuantityError)) throw error;
          return show([goal], action, `${error.message}\n本轮未批准或执行。\n`);
        }
      }
      if (action === 'approve_plan' && !shortConfirm && !/批准|同意|按.{0,12}计划/u.test(activeText)) throw new Error('继续不能代替计划批准');
      options.executeNext = !shortConfirm && /继续|执行.{0,3}(?:一段|一步|下一)/u.test(activeText);
      if (intent.executeNext && !options.executeNext) throw new Error('模型不能扩大为批准并执行');
    }
    if (action === 'continue') {
      options.regenerate = /重新生成|重新执行.{0,4}(?:文本|片段)/u.test(activeText);
      if (intent.regenerate && !options.regenerate) throw new Error('重新生成必须明确授权');
    }
    if (action === 'revise_plan') {
      const evidence = intent.bodyEvidence?.trim();
      if (intent.skillId !== undefined && /当前步骤|这一步/u.test(activeText)) {
        if (intent.skillId === null ? !/(?:移除|停用).{0,20}(?:Skill|技能)/iu.test(activeText)
          : !activeText.includes(intent.skillId) || !/(?:使用|改用|绑定).{0,30}(?:Skill|技能)/iu.test(activeText)) throw new Error('Skill绑定变更必须来自当前原话');
        options.skillId = intent.skillId;
      } else if (!evidence || !request.prompt.includes(evidence)) throw new Error('计划调整必须保留本轮原文');
      else if (intent.revisionMode === 'prepend' && /先补|增加|新增/u.test(activeText)) options.prepend = evidence;
      else if (intent.revisionMode === 'replace' && intent.planSteps?.length) {
        if (intent.planSteps.some(step => Object.values(step).some(value => value !== null && (!evidence.includes(value) || !value.trim())))) throw new Error('完整计划字段须逐字来自当前用户输入，不允许模型扩写');
        options.steps = intent.planSteps;
      } else { frame.answer = '可说“先补某项内容”，或给出完整的新步骤、说明、产物和验收条件；调整只生成待批准草稿。'; return { status: 'clarification' }; }
    }
    request.observer.event('operation_authorized', JSON.stringify({ tool: 'goal_manage', action, id: goal.id, revision: goal.revision }));
    const updated = goals.apply(request, action, goal, options);
    request.observer.event('operation_committed', JSON.stringify({ tool: 'goal_manage', action, id: updated.id, revision: updated.revision }));
    return show([updated], undefined, '控制已保存。\n');
  }

  async reviewCandidates(formation: FormationService, signal?: AbortSignal): Promise<unknown> {
    const frame = this.frame();
    if (signal) frame.request = { ...frame.request, signal: AbortSignal.any([frame.request.signal, signal]) };
    if (frame.used || frame.plan) throw new Error('本轮操作已经消费或正在解析；不能同时批准候选和执行其他写入');
    // 先占用同一个 Frame，防止并发工具在等待隔离解析时另获授权。
    frame.used = true; frame.plan = Promise.resolve('candidate_review');
    delete this.state.goalView;
    const request = frame.request, view = frame.references.candidateReview;
    const raw = (view && candidateRejection(request.prompt)) ?? await this.interpret(request.prompt, { tool: 'memory_review', count: view?.items.length, confirmation: view?.confirm }, request);
    request.signal.throwIfAborted();
    if (!Value.Check(intentSchema, raw)) throw new Error('候选审批意图格式无效');
    const intent = raw as Intent;
    if (intent.action !== 'memory_review' || !intent.evidence.trim() || !request.prompt.includes(intent.evidence) || !intent.review) throw new Error('当前消息没有候选审查意图');
    request.observer.event('formation_review', intent.review);
    delete this.state.choices; delete this.state.confirmation; delete this.state.tasks; delete this.state.lastTask;
    const show = (result: { view: CandidateView; text: string }) => {
      this.state.candidateReview = { ...result.view, displayRunId: request.source?.reference, displayHash: createHash('sha256').update(result.text).digest('hex') };
      frame.answer = result.text; this.saveState(this.state);
    };
    if (intent.review === 'list' && ['query', 'request'].includes(intent.mode)) { show(formation.view()); return { status: 'displayed' }; }
    if (!view || intent.mode !== 'request' || /如果|假设|假如|他说|她说|引用|[?？]/u.test(request.prompt)) throw new Error('需要先查看当前候选，再明确批准或拒绝');
    formation.validateDisplay(view);
    const reference = referenceFromMessage(request.prompt);
    const confirming = view.confirm && /^(?:确认|同意|就这样|好的，就这样)[。！!]?$/u.test(request.prompt.trim());
    const position = confirming ? 1 : reference && reference !== 'ambiguous' && reference.reference === 'choice' ? reference.position : undefined;
    if (!confirming && intent.review !== 'reject_view' && (position === undefined || intent.selector?.reference !== 'choice' || intent.selector.position !== position)) throw new Error('候选序号与当前原话不一致，请重新查看并选择');
    if (intent.review === 'reject_view') {
      if (!/这些|全部|都/u.test(request.prompt) || !/不(?:用|要)?(?:保存|记)|不保存|不记|拒绝/u.test(request.prompt)) throw new Error('没有明确拒绝当前清单的依据');
      formation.reject(view); frame.answer = '当前展示的候选已拒绝；没有写入长期 Memory。';
    } else if (intent.review === 'reject') {
      if (!/不要|不用|不记|不存|不保存|拒绝|先不/u.test(request.prompt)) throw new Error('没有明确拒绝依据');
      formation.reject(view, position!); frame.answer = '这条候选已拒绝；没有写入长期 Memory。';
    } else if (intent.review === 'edit') {
      const draft = intent.bodyEvidence?.trim();
      if (!draft || !request.prompt.includes(draft) || intent.body !== draft) throw new Error('新草稿必须是本轮用户原话，不允许模型扩写');
      show(formation.edit(view, position!, draft)); return { status: 'confirmation_required' };
    } else if (intent.review === 'clarify' || view.targets) {
      show(formation.clarify(view, view.targets ? 1 : position!, view.targets ? position : undefined)); return { status: 'clarification' };
    } else if (intent.review === 'approve') {
      if (!confirming && (!/记|保存|收下|批准|同意/u.test(request.prompt) || /不|别|暂缓/u.test(request.prompt))) throw new Error('当前没有明确批准');
      const candidate = formation.approve(view, position!, request, operation => {
        if (!this.memory) throw new Error('Memory 不可用');
        this.validateCurrent(operation);
        request.observer.event('operation_authorized', JSON.stringify({ tool: operation.tool, candidate: true }));
        return this.memory.withRequest(request, () => {
          if (operation.tool === 'memory_remember') return this.memory!.remember(operation.args);
          if (operation.tool === 'memory_update') return this.memory!.update(operation.args.id, operation.args.content, operation.args.expectedVersion);
          throw new Error('候选只能新增或更新 Memory');
        }, operation);
      });
      frame.answer = `已按你批准的草稿保存长期记忆：${candidate.draft}\n版本：${candidate.resultVersion}`;
    } else throw new Error('不支持的候选操作');
    delete this.state.candidateReview; this.saveState(this.state);
    // 持久 Session 仅保留状态收据，不将未批准草稿作为模型工具正文。
    return { status: intent.review === 'approve' ? 'applied' : 'rejected' };
  }

  async perform<K extends Tool>(tool: K, proposed: unknown, execute: (operation: Extract<WriteOperation, { tool: K }>, request: ExecutionRequest) => unknown, signal?: AbortSignal): Promise<unknown> {
    const frame = this.frame();
    if (signal) frame.request = { ...frame.request, signal: AbortSignal.any([frame.request.signal, signal]) };
    frame.request.signal.throwIfAborted();
    if (frame.used) throw new Error('本轮写操作已消费，不重复执行；请先核对结果');
    frame.request.observer.event('operation_proposed', tool); // 不记录正文或可能混入的凭据。
    const operation = await (frame.plan ??= this.resolve(frame, tool));
    frame.request.signal.throwIfAborted();
    if (typeof operation === 'string') { frame.answer = operation; return { executed: false, clarification: operation }; }
    if (operation.tool !== tool) throw new Error('工具操作超出本轮用户意图，未执行');
    if (frame.used) throw new Error('本轮写操作已消费，不重复执行；请先核对结果');
    // 工具参数只是提议。实际执行只使用宿主从隔离解析和真实存储核对过的值。
    void proposed;
    frame.used = true;
    delete this.state.goalView;
    delete this.state.candidateReview;
    frame.request.observer.event('operation_authorized', JSON.stringify({ tool, id: 'id' in operation.args ? operation.args.id : undefined }));
    this.validateCurrent(operation);
    const value = execute(operation as Extract<WriteOperation, { tool: K }>, frame.request);
    const record = value as Partial<Task & MemoryRecord>;
    frame.request.observer.event('operation_committed', JSON.stringify({ tool, id: record?.id ?? ('id' in operation.args ? operation.args.id : undefined), version: record?.version }));
    delete this.state.choices; delete this.state.confirmation;
    if (tool === 'create_task') { this.state.lastTask = record.id; this.state.lastTaskExpires = this.tasks.now().getTime() + ttl; }
    if (tool.startsWith('memory_') && record?.id) { this.state.lastMemory = record.id; this.state.lastMemoryExpires = this.tasks.now().getTime() + ttl; }
    this.saveState(this.state);
    frame.answer = tool === 'create_task' ? `已创建提醒：${record.instruction}\n时间：${this.local(record.dueAt!)}`
      : tool === 'cancel_task' ? `已取消提醒：${record.instruction}`
        : tool === 'memory_forget' ? '已删除这条长期记忆；历史对话、日志和备份中的副本不会自动删除。'
          : `已${tool === 'memory_update' ? '更新' : '保存'}长期记忆：${record.content}\n版本：${record.version}`;
    return value;
  }

  private async resolve(frame: Frame, proposedTool: Tool): Promise<WriteOperation | string> {
    const { request, references } = frame;
    let now = this.tasks.now().getTime();
    const pending = references.confirmation;
    if (pending && pending.expires > now && /^(?:确认|同意|就这样|好的，就这样)[。！!]?$/u.test(request.prompt.trim())) {
      this.validateCurrent(pending.operation);
      return pending.operation;
    }
    delete this.state.confirmation;
    if (pending) this.saveState(this.state);
    let choices = references.choices?.expires && references.choices.expires > now ? references.choices : undefined;
    let confirming = pending && pending.expires > now ? pending : undefined;
    const raw = await this.interpret(request.prompt, { tool: choices?.tool ?? confirming?.operation.tool, count: choices?.ids.length, confirmation: confirming ? true : undefined }, request);
    // 模型解析可能较慢，选择或确认权限必须在解析完成后仍有效。
    now = this.tasks.now().getTime();
    if (choices && choices.expires <= now) choices = undefined;
    if (confirming && confirming.expires <= now) confirming = undefined;
    if (!Value.Check(intentSchema, raw)) throw new Error('意图解析格式无效，本轮没有执行写操作');
    const intent = raw as Intent;
    if (intent.action === 'goal_manage') return '请通过长期目标工具操作；没有执行Task或Memory写入。';
    if (intent.action === 'memory_review') return '请通过候选审查工具查看并审批；没有执行其他写操作。';
    if (intent.mode === 'uncertain') return '我还不能确定你希望执行什么操作，请补充要处理的提醒或记忆；本轮没有修改。';
    if (intent.mode !== 'request' || intent.action === 'none' || !intent.evidence.trim() || !request.prompt.includes(intent.evidence)) throw new Error('当前消息没有明确的写入授权，未执行');
    if (intent.confirmation) {
      if (!confirming || intent.action !== confirming.operation.tool || intent.bodyEvidence) return '没有对应的有效待确认内容，请重新说明本次操作。';
      if (intent.action === 'memory_remember' && !confirmsMemorySave(request.prompt)) return '当前消息没有明确同意保存刚展示的内容；本轮未保存长期记忆。';
      this.validateCurrent(confirming.operation); return confirming.operation;
    }
    const fact = intent.bodyEvidence?.trim();
    const isCreate = intent.action === 'create_task';
    if (isCreate || intent.action === 'memory_remember' || intent.action === 'memory_update') {
      if (!fact || !request.prompt.includes(fact) || !intent.body?.trim()) return '请说明要提醒或记住的具体内容。';
    }
    if (isCreate) {
      if (!intent.when?.trim() || !request.prompt.includes(intent.when)) return '请提供具体时间；目前不能观察“洗完澡”等外部触发条件。';
      try { parseTaskTime(intent.when, this.tasks.timeZone, this.tasks.now()); }
      catch { return '这个时间还不能确定。请补充具体几点（例如明天上午9点）；不会猜测执行时间。'; }
      const operation: WriteOperation = { tool: 'create_task', args: { instruction: intent.body!.trim(), when: intent.when } };
      return this.confirmRewrite(operation, fact!, frame);
    }
    if (intent.action === 'memory_remember') {
      if (proposedTool !== 'memory_remember') throw new Error('工具操作超出本轮用户意图，未执行');
      const body = intent.body!.trim();
      const consent = memorySaveRequest(request.prompt, fact!);
      if (consent === 'none') return '已了解这项信息；本轮没有直接保存为长期记忆。';
      const operation: WriteOperation = { tool: 'memory_remember', args: { kind: intent.kind ?? 'semantic', key: intent.key ?? `explicit.${createHash('sha256').update(body).digest('hex').slice(0, 16)}`, content: body } };
      return this.confirmRewrite(operation, fact!, frame, consent === 'confirm');
    }
    const selector = intent.selector;
    if (!selector) return '请说明要操作哪条提醒或记忆。';
    if (selector.keywords.some((term) => !request.prompt.includes(term)) || selector.when && !request.prompt.includes(selector.when)) throw new Error('目标筛选依据不来自当前用户消息，未执行');
    const reference = referenceFromMessage(request.prompt);
    if (reference === 'ambiguous' || (selector.reference && selector.reference !== reference?.reference) ||
      (reference?.reference === 'choice' && (selector.reference !== 'choice' || selector.position !== reference.position)) ||
      (selector.position !== undefined && selector.reference !== 'choice')) return '选择的序号或引用与当前消息不一致，或无法唯一确定。请重新说明要选第几个或哪条记录；本轮没有操作。';
    const taskOperation = intent.action === 'cancel_task';
    const all: (Task | MemoryRecord)[] = taskOperation ? this.tasks.visibleTasks() : this.memory?.listForHost() ?? [];
    let records = all;
    const hasFilters = selector.keywords.length > 0 || !!selector.when;
    if (selector.reference === 'choice') {
      const ids = choices?.tool === intent.action ? choices.ids : taskOperation && (references.taskViewExpires ?? 0) > now ? references.tasks : undefined;
      const id = ids?.[(selector.position ?? 0) - 1];
      records = id ? all.filter((item) => item.id === id) : [];
    } else if (selector.reference === 'last' && !hasFilters) {
      const id = taskOperation ? (references.lastTaskExpires ?? 0) > now ? references.lastTask : undefined : (references.lastMemoryExpires ?? 0) > now ? references.lastMemory : undefined;
      records = all.filter((item) => item.id === id);
    } else if (selector.reference === 'latest') records = all;
    else {
      if (!selector.keywords.length && !selector.when) return '请补充提醒内容或时间，以便确定目标。';
      if (all.length > 100) return '候选记录较多，请补充更具体的内容；本轮没有操作。';
    }
    // 命名/时间约束始终是交集，不能被“刚才/最新/第二个”等指代覆盖。
    records = records.filter((item) => selector.keywords.every((term) => matches('instruction' in item ? item.instruction : `${item.key} ${item.content}`, term)));
    if (selector.when && taskOperation) {
      try {
        const [start, end] = taskTimeRange(selector.when, this.tasks.timeZone, this.tasks.now());
        records = records.filter((item) => 'dueAt' in item && item.dueAt >= start && item.dueAt < end);
      } catch { return '筛选时间不明确，请补充日期或具体时段。'; }
    }
    if (selector.reference === 'latest') records = records.slice(0, 1);
    if (taskOperation && (!selector.reference || selector.reference === 'last' && hasFilters)) {
      const pendingTasks = records.filter((item) => 'status' in item && item.status === 'pending');
      if (pendingTasks.length) records = pendingTasks;
    }
    if (!records.length) return '没有找到符合条件的当前记录；本轮没有操作。';
    if (records.length > 1) {
      this.state.choices = { tool: intent.action, ids: records.map((item) => item.id), expires: now + ttl }; this.saveState(this.state);
      return '有多个可能目标，请告诉我是第几个：\n' + records.map((item, index) => `${index + 1}. ${'instruction' in item ? `${item.instruction}；${this.local(item.dueAt)}` : item.content}`).join('\n');
    }
    const record = records[0]!;
    if (taskOperation) {
      if (!('status' in record) || record.status !== 'pending') return `该提醒已经${'status' in record ? record.status : '不可用'}，不能取消；本轮没有操作。`;
      return { tool: 'cancel_task', args: { id: record.id } };
    }
    if (!('version' in record)) throw new Error('Memory 目标类型无效');
    if (intent.action === 'memory_forget') return { tool: 'memory_forget', args: { id: record.id, expectedVersion: record.version } };
    return this.confirmRewrite({ tool: 'memory_update', args: { id: record.id, content: intent.body!.trim(), expectedVersion: record.version } }, fact!, frame);
  }

  private confirmRewrite(operation: WriteOperation, evidence: string, frame: Frame, memoryConsent = false): WriteOperation | string {
    const body = 'instruction' in operation.args ? operation.args.instruction : 'content' in operation.args ? operation.args.content : '';
    if (!memoryConsent && body === evidence) return operation;
    if (operation.tool === 'create_task' && normalize(evidence.replace(operation.args.when, '').replace(/^[，,:：\s]+|[，,:：\s]+$/gu, '')) === normalize(body)) return operation;
    this.state.confirmation = { operation, expires: this.tasks.now().getTime() + ttl }; this.saveState(this.state);
    frame.request.observer.event('operation_confirmation_required', operation.tool);
    return `拟保存的内容为：${body}\n${memoryConsent ? '我还不能确定你是否要求保存为长期记忆' : '这包含改写'}，请确认是否按这个内容执行；也可以直接告诉我应怎样改。`;
  }

  private validateCurrent(operation: WriteOperation): void {
    if (operation.tool === 'memory_update' || operation.tool === 'memory_forget') {
      if (this.memory?.get(operation.args.id).version !== operation.args.expectedVersion) throw new Error('确认期间记忆版本已变化，请重新核对');
    }
    if (operation.tool === 'create_task') parseTaskTime(operation.args.when, this.tasks.timeZone, this.tasks.now());
  }
}
