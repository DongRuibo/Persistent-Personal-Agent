import { createHash } from 'node:crypto';
import { Type, type Static } from 'typebox';
import * as Value from 'typebox/value';
import type { ExecutionRequest } from './contracts.js';
import type { SqliteStore } from './sqlite-store.js';
import type { WorkThreadActor } from './work-thread-types.js';
import type { PreparedWorkItem, WorkRequestItem, WorkTextRange } from './work-coordinator-store.js';
import { fullWorkResult } from './work-recall.js';
import { workInputBytes } from './work-job-types.js';

const quote = Type.String({ minLength: 1, maxLength: 10000 });
export const workManageSchema = Type.Object({
  action: Type.Union(['batch', 'query', 'cancel', 'revise', 'feedback', 'clarify', 'none'].map(v => Type.Literal(v))),
  mode: Type.Union(['request', 'query', 'negated', 'quoted', 'hypothetical', 'uncertain'].map(v => Type.Literal(v))),
  evidence: quote,
  shared: Type.Optional(Type.Array(quote, { maxItems: 8 })),
  items: Type.Optional(Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 120 }),
    quotes: Type.Array(quote, { minItems: 1, maxItems: 8 }), question: Type.Optional(Type.String({ minLength: 1, maxLength: 300 }))
  }, { additionalProperties: false }), { minItems: 1 })),
  source: Type.Optional(Type.Object({ kind: Type.Union([Type.Literal('job'), Type.Literal('goal')]), id: Type.String({ minLength: 1, maxLength: 128 }), runId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })) }, { additionalProperties: false })),
  keywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { minItems: 1, maxItems: 8 })),
  reason: Type.Optional(Type.Union(['mixed', 'overflow', 'dependencies', 'materials', 'goal', 'external', 'budget'].map(v => Type.Literal(v)))),
}, { additionalProperties: false });
type ParsedWork = Static<typeof workManageSchema>;
export interface WorkFocus { kind: 'job' | 'goal'; id: string; itemId?: string }
export interface WorkCatalog {
  untrusted: true;
  threads: { id: string; title: string }[];
  jobs: { id: string; rootJobId: string; title: string; status: string }[];
  goals?: { id: string; title: string; status: string; runId: string | null }[];
  focus?: WorkFocus; narrowed?: boolean;
}
export interface WorkManageReceipt { status: 'received' | 'not_applicable'; text: string; items: WorkRequestItem[]; focus?: WorkFocus | null }
export type WorkInterpret = (text: string, catalog: WorkCatalog, request: ExecutionRequest) => Promise<unknown>;


// 授权与原文目标提取共享动作头语法，不能在focus路径漏掉同一动作后的具名对象。
function workCommand(cancel = false): RegExp {
  const verbs = cancel ? '停下|停止|取消|终止|撤回' : '重点讲|突出|简短|补上|整理|修改|改写|润色|总结|归纳|汇总|提炼|撰写|编写|准备|生成|制作|翻译|分析|设计|比较|压缩|简化|缩短|检查|校对|列出|给出|拟定|写|做';
  return new RegExp('^\\s*(?:(?:请你?|麻烦你?|帮我|帮忙|替我|为我|给我|我(?:想|希望|需要|要)你?|需要|想要|先|只|仅|再|重新|继续|另外|此外|另请|第[一二三123]项工作|然后|并且|并|同时|现在|本次|本轮)\\s*)*(?:(?<prep>根据|基于|依据|按照|用|把|将|对|针对)(?<subject>[^:：\\n]{0,160}))?(?<verb>' + verbs + ')', 'u');
}

// 模型的request标签不是许可；仅接受当前原话中可定位的肯定动作框架，材料/引文不能提供动作。
function actionAnchor(text: string, ranges: WorkTextRange[], terms: string[], cancel = false): number | undefined {
  const visible = text.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, value => ' '.repeat(value.length))
    .replace(/^\s*>[^\n]*/gmu, value => ' '.repeat(value.length));
  const command = workCommand(cancel);
  const framing = /^\s*(?:如果|假设|假如|要是|倘若|引用|引文|转述|他说|她说|有人说|朋友说|例如|比如|举例|示例|例子|只是讨论|讨论|探讨|以下.{0,8}(?:原文|引用|示例)|下面.{0,8}(?:原文|引用|示例))/u;
  let framedBlock = false, materialFromRequest = false;
  for (const sentence of visible.matchAll(/[^。！？!?；;\n，,]+/gu)) {
    const start = sentence.index, header = sentence[0].split(/[:：]/u)[0]!, original = text.slice(start, start + header.length);
    // 只有肯定工作自己的材料范围，才能由原话明确的另一项工作结束；引文/假设/禁止执行范围不能这样复活。
    if (materialFromRequest && /^\s*(?:另外|此外|另请|第[一二三123]项工作)/u.test(header)
      && ranges.some(range => range.start <= start && !text.slice(range.start, start).trim())) framedBlock = false;
    if (framing.test(header)) {
      framedBlock = true; materialFromRequest = false;
      continue;
    }
    const materialScope = framedBlock;
    // 冒号结尾引入的后续材料不能反过来提供授权；本行自己的肯定请求仍可核对。
    if (/[:：]\s*$/u.test(text.slice(start, start + sentence[0].length))) {
      framedBlock = true;
      materialFromRequest = (!materialScope || materialFromRequest) && header.split(/[，,]/u).some(clause => command.test(clause)) && !/(?:不要|禁止|别|暂不|先不)(?:执行|开始|启动)/u.test(header);
    }
    if (materialScope || !terms.every(term => original.includes(term))) continue;
    for (const clause of header.matchAll(/[^，,]+/gu)) {
      const match = command.exec(clause[0]);
      if (!match || !terms.every(term => text.slice(start + clause.index, start + clause.index + clause[0].length).includes(term))) continue;
      const verb = match.groups!.verb!;
      // 只检查该动作及启动/执行的否定；不把不联网、不保存等其他能力限制当作撤销工作。
      if (new RegExp('(?:不要|别|先不|暂不|不必|无需|不需要|不用|不允许|禁止|不能|不再|不)\\s*(?:(?:帮我|再|立即|马上|真的)\\s*)*(?:' + verb + '|执行|开始|启动)', 'u').test(clause[0])) continue;
      const actionStart = start + clause.index + match[0].length - verb.length;
      const local = text.slice(start + clause.index, start + clause.index + clause[0].length);
      const from = Math.min(actionStart, ...terms.map(term => start + clause.index + local.indexOf(term)));
      const to = Math.max(actionStart + verb.length, ...terms.map(term => start + clause.index + local.indexOf(term) + term.length));
      if (ranges.some(range => range.start <= from && range.end >= to)) return actionStart;
    }
  }
  return undefined;
}

// 具名补充的同一原文框架同时用于候选边界和许可核对，不依赖模型keywords枚举。
function namedFollowup(text: string): { name: string; frame: string } | undefined {
  const match = /^\s*([^。！？!?；;\n，,:：]{1,120}?)(?:那份|这份|那件|这件|那项|这项|的成果)([\s\S]*)$/u.exec(text)
    ?? /^\s*([^。！？!?；;\n，,:：]{1,120}?)((?:再)[\s\S]*)$/u.exec(text);
  return match?.[1]?.trim() ? { name: match[1].trim(), frame: match[2]!.trimStart() } : undefined;
}

// 先从完整原文保留工作边界，再校验模型分配；候选头只限制材料传播，不产生许可。
function sourceWorkBlocks(text: string, followups = false): { start: number; end: number; headEnd: number; certain: boolean; names?: string[]; followup?: boolean }[] {
  const visible = text.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, value => ' '.repeat(value.length))
    .replace(/^\s*>[^\n]*/gmu, value => ' '.repeat(value.length));
  const command = /^\s*(?:(?:请你?|麻烦你?|帮我|帮忙|替我|为我|给我|我(?:想|希望|需要|要)你?|需要|想要|先|只|仅|再|重新|继续|另外|此外|另请|第[一二三123]项工作|然后|并且|并|同时|现在|本次|本轮)\s*)*(?:(?:不要|别|先不|暂不|禁止)\s*)?(?:(?:根据|基于|依据|按照|用|把|将|对|针对)[^:：\n]{0,160})?(?:整理|修改|改写|润色|总结|归纳|汇总|提炼|撰写|编写|准备|生成|制作|翻译|分析|设计|比较|压缩|简化|缩短|检查|校对|列出|给出|拟定|写|做).+/u;
  const blocks: { start: number; end: number; headEnd: number; certain: boolean; names?: string[]; followup?: boolean }[] = [];
  let framed = false, multiline = false;
  for (const part of visible.matchAll(/[^。！？!?；;\n，,]+/gu)) {
    const header = part[0].split(/[:：]/u)[0]!, explicit = /^\s*(?:另外|此外|另请|第[一二三123]项工作)/u.test(header);
    if (/^\s*(?:如果|假设|假如|要是|倘若|引用|引文|转述|他说|她说|有人说|朋友说|例如|比如|举例|示例|例子|只是讨论|讨论|探讨|以下.{0,8}(?:原文|引用|示例)|下面.{0,8}(?:原文|引用|示例)|(?:只|仅)(?:阅读|看))/u.test(header)) framed = true;
    const ordinary = command.test(header);
    const direct = followups && actionAnchor(header, [{ start: 0, end: header.length, role: 'instruction' }], []) !== undefined;
    const named = followups && !direct ? namedFollowup(header) : undefined;
    const names: string[] = named ? [named.name] : [];
    let implicit = false;
    if (direct) {
      const originalHeader = text.slice(part.index, part.index + header.length);
      const head = workCommand().exec(originalHeader)!;
      // 所有动作先保留明确前置对象；动词本身不能把具名要求降成旧focus。
      const subject = ['把', '将', '对', '针对'].includes(head.groups?.prep ?? '')
        ? head.groups?.subject?.replace(/(?:再|重新|继续)\s*$/u, '').trim() : undefined;
      const explicitSubject = subject && !/^(?:这段文字|这些文字|下面材料|以下材料|这些材料|这份|那份|它)$/u.test(subject) ? subject : undefined;
      if (!explicitSubject && ['重点讲', '突出', '简短', '补上'].includes(head.groups!.verb!)) implicit = true;
      else {
        const tail = originalHeader.slice(head[0].length).trim();
        const objectText = explicitSubject ?? tail;
        const ids = objectText.match(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/giu) ?? [];
        const object = objectText.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/giu, '')
          .replace(/^(?:一下|这份|那份|这件|那件|这项|那项|为)\s*/u, '')
          .replace(/(?:旧版|上一版|第[一二三123]版|成果)\s*$/u, '').trim();
        if (object && !/^(?:原稿|原成果|当前工作|该工作|工作|它)$/u.test(object)) names.push(object);
        names.push(...ids);
        implicit = !names.length;
      }
    }

    if (!ordinary && !direct && !named) continue;
    // 无材料的否定前置句属于限制；多行材料中的逗号续句不另立工作头。
    if (!/[:：]/u.test(part[0]) && (/^\s*(?:请)?(?:不要|别|先不|暂不|禁止)/u.test(header)
      || multiline && !explicit && /[，,]/u.test(visible[part.index - 1] ?? ''))) continue;
    // 多行材料中没有明确另起标志的命令形文本，不能作为新授权或被静默切走。
    const certain = !framed && (!multiline || explicit);
    if (multiline && !explicit && blocks.length) blocks.at(-1)!.certain = false;
    const before = visible.slice(0, part.index), sentenceStart = Math.max(...['\n', '。', '！', '？', '!', '?', '；', ';'].map(mark => before.lastIndexOf(mark))) + 1;
    const start = blocks.some(block => block.start >= sentenceStart) ? part.index : sentenceStart;
    if (blocks.length) blocks.at(-1)!.end = start;
    blocks.push({ start, end: text.length, headEnd: part.index + header.length, certain, ...(names.length ? { names } : {}), ...(implicit ? { followup: true } : {}) });
    multiline = /[:：]\s*$/u.test(part[0]);
  }
  return blocks;
}

// 一次抽取完整原文中的否定执行子句，局部与整批作用域使用同一结果；引文不参与权限。
function executionDenials(text: string, cancel = false): { at: number; action: string; target: string }[] {
  const visible = text.replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』|"[^"\n]*"|'[^'\n]*'/gu, value => ' '.repeat(value.length))
    .replace(/^\s*>[^\n]*/gmu, value => ' '.repeat(value.length));
  const actions = cancel ? '停下|停止|取消|终止|撤回' : '重点讲|突出|简短|补上|整理|修改|改写|润色|总结|归纳|汇总|提炼|撰写|编写|准备|生成|制作|翻译|分析|设计|比较|压缩|简化|缩短|检查|校对|列出|给出|拟定|写|做';
  const denied = new RegExp('(?:^|[:：]|但|不过|可是|而且|同时|并且|并|且)\\s*(?:(?:先|暂时|暂|现在|目前|本次|本轮)\\s*)*(?:不要|别|先不|暂不|不必|无需|不需要|不用|不允许|禁止|不能|不再|不)\\s*(?:(?:帮我|再|立即|马上|真的)\\s*)*(执行|开始|启动|' + actions + ')(.*)$', 'u');
  const result: { at: number; action: string; target: string }[] = [];
  for (const clause of visible.matchAll(/[^。！？!?；;\n，,]+/gu)) {
    const match = denied.exec(clause[0]);
    if (match) result.push({ at: clause.index + match.index, action: match[1]!, target: match[2]!.trim().replace(/^(?:了|吧|啊|呀|哦)$/u, '') });
  }
  return result;
}

// 肯定动作只是候选；审完对应请求范围后才允许执行，标点或换行不能提前结束启动限制。
function affirmativeAction(text: string, ranges: WorkTextRange[], terms: string[], cancel = false, scopeEnd = text.length, otherTargets: string[] = []): boolean {
  if (actionAnchor(text, ranges, terms, cancel) === undefined) return false;
  const start = Math.min(...ranges.map(range => range.start));
  for (const denial of executionDenials(text, cancel)) {
    if (denial.at < start || denial.at >= scopeEnd) continue;
    const target = denial.target;
    const generic = !target || /^(?:这|那|本|该|当前|上述|所有|全部|任何|一切|工作|任务|操作|它)/u.test(target);
    const sameTarget = terms.some(term => target.includes(term) || term.includes(target) || term.length >= 2 && target.includes(term.slice(0, 2)));
    if (generic || sameTarget) return false;
    // 泛指执行/启动的否定不能默认忽略；只有能明确绑定另一工作名称才不约束本项。
    if (['执行', '开始', '启动'].includes(denial.action) && !otherTargets.includes(target)) return false;
  }
  return true;
}

// shared必须是完整独立的共同约束；正文冒号之后的截片没有共同作用域。
function sharedConstraint(text: string, range: WorkTextRange, firstItem: number): boolean {
  const before = text.slice(0, range.start), after = text.slice(range.end);
  const left = before.slice(Math.max(...['\n', '。', '！', '？', '!', '?', '；', ';'].map(mark => before.lastIndexOf(mark))) + 1);
  const right = after.split(/[\n。！？!?；;]/u)[0]!;
  // 共同要求必须先在原文顶层成立；任务头之后属于工作范围，不能靠‘每项’等字面提升。
  if (range.end > firstItem || left.trim() || right.trim() || /[:：]\s*$/u.test(before)) return false;
  return text.slice(range.start, range.end).split(/[\n。！？!?；;，,、]/u).every(part => {
    const clause = part.trim();
    if (!clause) return true;
    if (/^(?:不|不要|不用|禁止|不得)(?:联网|上网|搜索|建Goal|创建Goal|建提醒|创建提醒|保存记忆|保存长期记忆|读文件|读取文件|写文件)$/iu.test(clause)) return true;
    if (/^(?:每项|各项|每份|各份|全部|所有|统一|共同|均|都|分别|各自)(?:请|须|需|必须|要求|要|只|仅|都|均|使用|采用|保持|输出|包含|按照|按|以|用|写|不超过|最多|至少|不要|不|不得)/u.test(clause)) return true;
    return range.end <= firstItem && /^(?:请)?(?:用|使用|采用|输出(?:用|为)?|以)(?:中文|英文|简体中文|繁体中文|Markdown|纯文本)(?:输出|回答|格式)?$/iu.test(clause);
  });
}

// 当前原话是唯一意图来源；目录仅为低信任定位资料，不带旧成果或其他渠道内容。
export class WorkCoordinatorService {
  constructor(private readonly store: SqliteStore, readonly actor: WorkThreadActor, private readonly interrupt: (id: string) => void = () => {}, private readonly goalsEnabled = false) {}
  // 仅投影当前会话已引用工作的元数据；不返回指令/成果，不改变焦点或业务收据。
  projection(runIds: string[], focus?: WorkFocus) {
    const receipts = runIds.slice(-20).flatMap(runId => {
      const parent = this.store.webUi.coordinatorRequest(this.actor.owner, runId);
      return parent ? this.store.workCoordinator.items(this.actor, parent.requestId).map(item => ({ runId, itemId: item.itemId,
        decision: item.decision, permission: item.permission, targetKind: item.targetKind, targetId: item.targetId, consumedByJobId: item.consumedByJobId })) : [];
    });
    const targets = new Map<string, WorkFocus>();
    const add = (ref: WorkFocus) => {
      if (ref.itemId) {
        const item = this.store.workCoordinator.item(this.actor, ref.itemId);
        if (item?.consumedByJobId) ref = { kind: 'job', id: item.consumedByJobId };
      }
      if (ref.kind === 'job') ref = { kind: 'job', id: this.store.workJobs.get(this.actor, ref.id).rootJobId };
      targets.set(ref.kind + ':' + ref.id, ref);
    };
    if (focus) add(focus);
    for (const item of receipts) if (item.targetKind && item.targetId) add({ kind: item.targetKind, id: item.targetId });
    // 超限时保留明确focus并声明省略，定位仍走T3按当前原话的全库有界查询。
    const refs = targets.size > 20 ? focus ? [targets.values().next().value!] : [] : [...targets.values()];
    const directory = refs.flatMap<WorkFocus & { title: string; titleOmitted?: boolean; status: string; executionId?: string }>(ref => {
      if (ref.kind === 'job') {
        const root = this.store.workJobs.get(this.actor, ref.id), latest = this.store.workJobs.latest(this.actor, ref.id);
        return [{ ...ref, title: this.store.workThreads.get(this.actor, root.threadId).title, status: latest.status, executionId: latest.id }];
      }
      if (!this.goalsEnabled) return [];
      const goal = this.store.goals.get({ ownerId: 'local-user', target: JSON.parse(this.actor.channel) }, ref.id);
      return [{ ...ref, title: goal.objective.slice(0,120), titleOmitted: goal.objective.length > 120, status: goal.status, executionId: goal.checkpointRunId ?? undefined }];
    });
    const focused = focus ? targets.values().next().value : undefined;
    const currentFocus = focused && directory.some(item => item.kind === focused.kind && item.id === focused.id) ? { kind: focused.kind, id: focused.id } : null;
    return { untrusted: true as const, focus: currentFocus, directory, receipts, omitted: { requests: Math.max(0, runIds.length - 20), objects: targets.size - directory.length } };
  }
  async manage(request: ExecutionRequest, interpret: WorkInterpret, focus?: WorkFocus): Promise<WorkManageReceipt> {
    if (request.scope !== 'chat' || request.source?.channel !== 'web') throw new Error('工作管理只支持当前已鉴权Web消息');
    const parent = this.store.webUi.coordinatorRequest(this.actor.owner, request.source.reference);
    if (!parent || parent.text !== request.prompt || this.actor.channel !== JSON.stringify({ channel: 'web', userId: 'local-user' })) throw new Error('工作请求来源与当前Web原话不一致');
    const previous = this.store.workCoordinator.items(this.actor, parent.requestId);
    if (previous.length) return { status: 'received', text: previous.map(i => `${i.ordinal + 1}. ${i.receipt}`).join('\n'), items: previous };
    // Goal成果首次文字修改尚无Job；后续用户回合才沿自己已接收子项的消费事实解析根引用。
    if (focus?.itemId) {
      const item = this.store.workCoordinator.item(this.actor, focus.itemId);
      if (item?.consumedByJobId) focus = { kind: 'job', id: this.store.workJobs.get(this.actor, item.consumedByJobId).rootJobId };
    }
    const namedThreads = this.store.workThreads.list(this.actor).filter(thread => request.prompt.includes(thread.title));
    const matches = this.store.workJobs.locate(this.actor, [], request.prompt);
    const goals = this.goalsEnabled ? this.store.workCoordinator.goalCandidates(this.actor, [], request.prompt) : [];
    const focused = focus?.kind === 'job' ? this.store.workJobs.latest(this.actor, focus.id) : undefined;
    const jobScope = matches.length ? matches : focused ? [focused] : [];
    const catalog: WorkCatalog = { untrusted: true, threads: [], jobs: jobScope.map(job => ({ id: job.id, rootJobId: job.rootJobId,
      title: this.store.workJobs.get(this.actor, job.rootJobId).instruction.slice(0,180), status: job.status })),
      goals: goals.map(goal => ({ id: goal.id, title: goal.objective.slice(0,180), status: goal.status, runId: goal.checkpointRunId })), ...(focus ? { focus } : {}) };
    if (catalog.jobs.length + (catalog.goals?.length ?? 0) > 20 || Buffer.byteLength(JSON.stringify(catalog)) > 8192) {
      catalog.jobs = []; catalog.goals = []; catalog.narrowed = true;
    }
    let prepared: PreparedWorkItem[];
    let focusResult: WorkFocus | null | undefined;
    const whole: WorkTextRange[] = [{ start: 0, end: request.prompt.length, role: 'instruction' }];
    {
      const value = await interpret(request.prompt, catalog, request); request.signal.throwIfAborted();
      if (!Value.Check(workManageSchema, value)) throw new Error('工作解析格式无效；未提交批次');
      const raw = value as ParsedWork;
      if (!request.prompt.includes(raw.evidence)) throw new Error('工作意图证据不属于当前原话');
      if (raw.action === 'none' || ['negated', 'quoted', 'hypothetical'].includes(raw.mode)) {
        return { status: 'not_applicable', text: '当前原话没有可执行的文字工作管理请求；未创建或取消工作。', items: [] };
      }
      if (raw.action === 'batch' && (raw.items?.length ?? 0) > 3) {
        prepared = [{ ranges: whole, decision: 'clarify', receipt: '一次最多三项独立文字工作；当前完整消息已保留，全部尚未启动，请明确分批。' }];
      } else if (raw.action === 'batch' && raw.mode === 'request') {
        if (!raw.items?.length || raw.keywords || raw.source || raw.reason) throw new Error('文字批次范围无效');
        if (raw.items.length > 1) focusResult = null;
        // 只定位逐字证据，不接受模型给出的偏移或改写后的Worker指令。
        const locate = (text: string, role: WorkTextRange['role']): WorkTextRange[] => {
          const ranges: WorkTextRange[] = [];
          for (let start = request.prompt.indexOf(text); start >= 0; start = request.prompt.indexOf(text, start + 1)) ranges.push({ start, end: start + text.length, role });
          if (!ranges.length) throw new Error('子项证据不属于当前原话');
          return ranges;
        };
        const sharedQuotes = (raw.shared ?? []).map(q => locate(q, 'shared'));
        const shared = sharedQuotes.flat();
        const itemQuotes = raw.items.map(item => item.quotes.map(q => locate(q, 'instruction')));
        const itemRanges = itemQuotes.map(quotes => quotes.flat());
        const ambiguous = itemQuotes.map(quotes => quotes.some(ranges => ranges.length > 1));
        const all = [...shared, ...itemRanges.flat()].sort((a, b) => a.start - b.start);
        const resolved = [...shared, ...itemRanges.filter((_, i) => !ambiguous[i]).flat()].sort((a, b) => a.start - b.start);
        if (resolved.some((r, i) => i && r.start < resolved[i - 1]!.end)) throw new Error('子项或共享证据范围重叠；未提交批次');
        const covered = new Uint8Array(request.prompt.length); for (const r of all) covered.fill(1, r.start, r.end);
        for (let i = 0; i < request.prompt.length; i++) if (!covered[i] && !/[\s，,；;。.!！?？:：、]/u.test(request.prompt[i]!)) throw new Error('解析没有覆盖完整原话，不能遗漏需求或材料；未提交批次');
        const blocks = sourceWorkBlocks(request.prompt);
        // 名称和question只参与分配核对；不能增删原文块或改变其范围。
        const assignments = raw.items.map((item, index) => blocks.flatMap((block, blockIndex) => {
          const header = request.prompt.slice(block.start, block.headEnd);
          return header.includes(item.name) && itemRanges[index]!.some(range => range.start <= block.start && range.end >= block.headEnd)
            ? [blockIndex] : [];
        }));
        const firstItem = blocks[0]?.start ?? Infinity;
        const scopeEnds = assignments.map(indices => indices.length === 1 ? blocks[indices[0]!]!.end : request.prompt.length);
        const anchors = assignments.map(indices => indices.length === 1 ? blocks[indices[0]!]!.start : undefined);
        const misbound = raw.items.some((item, index) => {
          if (ambiguous[index]) return false;
          const indices = assignments[index]!;
          if (indices.length !== 1) return true;
          const block = blocks[indices[0]!]!;
          return itemRanges[index]!.some(range => range.start < (block.start === firstItem ? 0 : block.start) || range.end > block.end);
        });
        const globalHold = executionDenials(request.prompt).some(denial => ['执行', '开始', '启动', '做'].includes(denial.action)
          && /^(?:任何|所有|全部|每|一切)/u.test(denial.target));
        const knownTargets = [...namedThreads.map(thread => thread.title), ...raw.items.filter((_, index) => anchors[index] !== undefined).map(item => item.name)];
        const goodShared = shared.filter(range => Number.isFinite(firstItem) && sharedConstraint(request.prompt, range, firstItem));
        const unclearItems = new Set<number>(), localMaterial = raw.items.map(() => [] as WorkTextRange[]);
        let unclearShared = false;
        for (const range of shared.filter(range => !goodShared.includes(range))) {
          const owners = raw.items.flatMap((item, index) => {
            const anchor = anchors[index];
            if (anchor === undefined || range.start <= anchor || range.end > scopeEnds[index]!) return [];
            const header = request.prompt.slice(anchor, scopeEnds[index]).split(/[\n。！？!?；;]/u)[0]!;
            // 任务头明确引入的材料一直归属本项，后续资料行出现‘每项’也不改变归属。
            return /[:：]/u.test(header) && affirmativeAction(request.prompt, itemRanges[index]!, [item.name], false, scopeEnds[index], knownTargets) ? [index] : [];
          });
          if (owners.length !== 1) unclearShared = true;
          else { unclearItems.add(owners[0]!); localMaterial[owners[0]!]!.push({ ...range, role: 'instruction' }); }
        }
        // 每个原文块必须唯一认领且覆盖完整；歧义片段可留待问，但不能替别项藏起限制。
        const blockFault = blocks.length > 3 || blocks.some((block, blockIndex) => {
          const owners = assignments.flatMap((indices, index) => indices.includes(blockIndex) ? [index] : []);
          if (owners.length !== 1) return true;
          const owner = owners[0]!;
          const coveredHere = [...itemRanges[owner]!, ...localMaterial[owner]!];
          for (let pos = block.start; pos < block.end; pos++) {
            if (!/[\s，,；;。.!！?？:：、]/u.test(request.prompt[pos]!) && !coveredHere.some(range => range.start <= pos && range.end > pos)) return true;
          }
          return false;
        });
        prepared = raw.items.map((item, index) => {
          const ranges = [...goodShared, ...itemRanges[index]!, ...localMaterial[index]!].sort((a, b) => a.start - b.start);
          if (!item.quotes.some(q => q.includes(item.name))) throw new Error('工作名称必须来自该项当前原话');
          if (globalHold) return { ranges: whole, decision: 'clarify', receipt: '当前原话限制整批暂不执行；全部子项尚未启动，请明确本次范围。' };
          if (misbound || blockFault) return { ranges: whole, decision: 'clarify', receipt: '子项材料越过原文中的工作范围；本批尚未启动，请明确材料所属，未裁剪或广播资料。' };
          const instruction = ranges.map(r => request.prompt.slice(r.start, r.end)).join('\n');
          if (ambiguous[index] || sharedQuotes.some(r => r.length > 1)) return { ranges, decision: 'clarify', receipt: `“${item.name}”引用片段在原话中出现多次，尚未启动；请用完整句子明确材料范围。` };
          if (unclearShared || unclearItems.has(index)) return { ranges, decision: 'clarify', receipt: `“${item.name}”有无法证明为共同约束的材料范围，尚未启动；请明确这段资料的所属。` };
          if (assignments[index]!.length !== 1 || !blocks[assignments[index]![0]!]!.certain) return { ranges, decision: 'clarify', receipt: `“${item.name}”的原文工作与材料边界不明确，尚未启动；请明确本次范围。` };
          if (item.question) return { ranges, decision: 'clarify', receipt: `“${item.name}”待澄清，尚未启动：${item.question}` };
          if (!affirmativeAction(request.prompt, itemRanges[index]!, [item.name], false, scopeEnds[index], knownTargets)) return { ranges, decision: 'clarify', receipt: `当前原话不能证明肯定要求执行“${item.name}”；本项未启动，请明确本次要求。` };
          if (Buffer.byteLength(instruction) > workInputBytes) return { ranges, decision: 'clarify', receipt: `“${item.name}”材料超过14 KiB，未委派；请缩小该项范围。` };
          return { ranges, decision: 'work', name: item.name, instruction, inputHash: createHash('sha256').update(instruction).digest('hex'), receipt: '文字工作已接收。' };
        });
      } else if (['query', 'cancel', 'revise', 'feedback'].includes(raw.action) && ['query', 'request'].includes(raw.mode)) {
        if (raw.items || raw.shared || raw.reason || raw.keywords?.some(k => !request.prompt.includes(k))) throw new Error('工作定位条件不属于当前原话');
        const keywords = raw.keywords ?? [];
        const followup = ['revise', 'feedback'].includes(raw.action);
        const followupBlocks = followup ? sourceWorkBlocks(request.prompt, true) : [];
        const sourceNames = [...new Set(followupBlocks.flatMap(block => block.names ?? []))];
        const resolved = followupBlocks.filter(block => block.names?.length).map(block => {
          // 同一动作头内名称与明确ID取交集，不让共用主题名抹去明确执行引用。
          const names = block.names!;
          const jobs = this.store.workJobs.locate(this.actor, names);
          const goals = this.goalsEnabled ? this.store.workCoordinator.goalCandidates(this.actor, names) : [];
          const targets: WorkFocus[] = [...jobs.map(job => ({ kind: 'job' as const, id: job.rootJobId })), ...goals.map(goal => ({ kind: 'goal' as const, id: goal.id }))];
          return { names, target: targets.length === 1 ? targets[0] : undefined };
        });
        const explicitTargets = [...new Map(resolved.flatMap(item => item.target ? [[item.target.kind + ':' + item.target.id, item.target] as const] : [])).values()];
        const explicitJobIds = [...new Set(resolved.flatMap(item => item.target?.kind === 'job' ? item.names.filter(name => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(name)) : []))];
        const mixedScope = followupBlocks.some(block => !block.certain || !block.names?.length && !block.followup)
          || resolved.some(item => !item.target) || explicitTargets.length > 1 || explicitJobIds.length > 1;
        // 显式原文目标优先；真正无具名的动作才使用focus。模型keywords不决定是否漏检另一工作。
        const current = followup && sourceNames.length ? explicitTargets.length === 1 && !mixedScope ? explicitTargets[0] : undefined
          : followup && followupBlocks.length ? focus : undefined;
        const selected = current?.kind === 'job' ? [this.store.workJobs.latest(this.actor, current.id)]
          : current || followup && (sourceNames.length || followupBlocks.length) ? []
          : keywords.length ? this.store.workJobs.locate(this.actor, keywords) : focus?.kind === 'job' ? [this.store.workJobs.latest(this.actor, focus.id)] : [];
        const selectedGoals = followup && this.goalsEnabled ? current?.kind === 'goal'
          ? [this.store.goals.get({ ownerId: 'local-user', target: JSON.parse(this.actor.channel) }, current.id)]
          : current || sourceNames.length || followupBlocks.length ? []
          : keywords.length ? this.store.workCoordinator.goalCandidates(this.actor, keywords) : focus?.kind === 'goal'
            ? [this.store.goals.get({ ownerId: 'local-user', target: JSON.parse(this.actor.channel) }, focus.id)] : [] : [];
        const metadata = [...selected.map(job => ({ kind: 'job' as const, id: job.rootJobId })), ...selectedGoals.map(goal => ({ kind: 'goal' as const, id: goal.id }))];
        if (metadata.length !== 1 || Buffer.byteLength(JSON.stringify(metadata)) > 8192) {
          focusResult = null;
          prepared = [{ ranges: whole, decision: 'clarify', receipt: mixedScope ? '当前原话的补充目标不唯一或无法证明归属；原话已保留，未登记待续资料。' : metadata.length ? '有多个符合名称的工作，请说明哪一件的名称或明确执行ID；本轮未执行。' : '没有定位到唯一工作，请说明工作名称；本轮未执行。' }];
        } else {
          const target = metadata[0]!;
          if (raw.source && (raw.source.kind !== target.kind || raw.source.id !== target.id && !request.prompt.includes(raw.source.id))) throw new Error('指定成果与当前工作范围不一致');
          if (raw.action === 'cancel') {
            prepared = raw.mode !== 'request' || !affirmativeAction(request.prompt, whole, keywords, true, request.prompt.length)
              ? [{ ranges: whole, decision: 'clarify', receipt: '当前原话不能证明肯定取消该工作；未执行取消，请明确本次要求。' }]
              : [{ ranges: whole, decision: 'cancel', targetId: selected[0]!.id, receipt: '已定位当前工作。' }];
          } else if (raw.action === 'query') {
            prepared = [{ ranges: whole, decision: 'query', targetId: selected[0]!.id, receipt: '已定位当前工作。' }]; focusResult = target;
          } else {
            const permit = raw.action === 'revise';
            const explicitId = explicitJobIds[0] ?? (raw.source?.id && request.prompt.includes(raw.source.id) ? raw.source.id : undefined);
            const explicitVersion = !!explicitId;
            const base = target.kind === 'job' ? explicitVersion ? this.store.workJobs.get(this.actor, explicitId!) : selected[0]! : undefined;
            if (base && base.rootJobId !== target.id) throw new Error('指定旧执行不属于当前根工作');
            const sourceRequest = { kind: target.kind, id: base?.id ?? target.id, ...(raw.source?.runId ? { runId: raw.source.runId } : {}) };
            const source = target.kind === 'goal' || base?.status === 'succeeded' ? fullWorkResult(this.store, this.actor, sourceRequest, this.goalsEnabled) : undefined;
            const unclearVersion = /(?:上一版|旧版|第[一二三123]版|之前.{0,6}版)/u.test(request.prompt) && !explicitVersion && !(raw.source?.runId && request.prompt.includes(raw.source.runId));
            let authorized = affirmativeAction(request.prompt, whole, [], false, request.prompt.length);
            const named = namedFollowup(request.prompt);
            if (!authorized && !executionDenials(request.prompt).length && named && sourceNames.includes(named.name) && !mixedScope) {
              authorized = affirmativeAction(named.frame, [{ start: 0, end: named.frame.length, role: 'instruction' }], []);
            }
            const blocked = mixedScope || permit && (raw.mode !== 'request' || !authorized)
              || sourceRequest.runId && !request.prompt.includes(sourceRequest.runId) || unclearVersion
              || base && ['failed','interrupted','cancelled'].includes(base.status) || (target.kind === 'goal' || base?.status === 'succeeded') && !source;
            if (blocked) prepared = [{ ranges: whole, decision: 'clarify', receipt: '当前修改许可、指定版本或完整已提交成果不能确定；原话已保留，尚未启动，请核对工作与成果。' }];
            else {
              prepared = [{ ranges: whole, decision: 'feedback', targetKind: target.kind, targetId: target.id, receipt: '补充已收到，尚未采纳。',
                continuation: { baseJobId: base?.id ?? null, ...(source ? { source: source.reference } : {}), permit } }]; focusResult = target;
            }
          }
        }
      } else {
        const reasons = { budget: '本次完整文字与目录超过32 KiB解析请求预算；原消息已保留，全部尚未启动，请缩小本次范围。', external: '本轮只承接已提供材料的纯文本工作；联网、读文件或外部写入尚未启动，请通过原受控入口单独提出。', mixed: '当前消息混合文字工作与提醒、Goal、Memory或文件操作，请分开授权；未启动任何子项。',
          overflow: '一次最多三项独立文字工作，请明确分批；未截取前三项。', dependencies: '这些工作存在先后依赖，请明确分批或使用既有Goal流程；本轮未启动。',
          materials: '本轮工作范围或材料仍需明确，原消息已保留；未启动。', goal: '该请求涉及已有长期目标，请通过原Goal管理流程核对；未通过文字工作旁路执行。' };
        prepared = [{ ranges: whole, decision: 'clarify', receipt: reasons[raw.reason ?? 'materials'] }];
      }
    }
    request.signal.throwIfAborted();
    const committed = this.store.workCoordinator.commitBatch(this.actor, parent.requestId, request.source.reference, prepared, new Date().toISOString());
    for (const id of committed.cancelled) this.interrupt(id);
    if (focusResult?.kind === 'goal' && committed.items.length === 1 && committed.items[0]!.decision === 'feedback') focusResult = { ...focusResult, itemId: committed.items[0]!.itemId };
    if (focusResult === undefined && committed.items.some(item => item.decision === 'work')) {
      const roots = [...new Set(committed.items.filter(item => item.decision === 'work').map(item => item.targetId!))];
      focusResult = roots.length === 1 ? { kind: 'job', id: roots[0]! } : null;
    }
    return { status: 'received', ...(focusResult === undefined ? {} : { focus: focusResult }), text: committed.items.map(i => `${i.ordinal + 1}. ${i.receipt}`).join('\n'), items: committed.items };
  }
}
