import { randomUUID } from 'node:crypto';
import * as Value from 'typebox/value';
import type { ExecutionRequest, MemoryRecord, WriteOperation } from './contracts.js';
import type { FileMemoryService } from './memory-service.js';
import type { SqliteStore } from './sqlite-store.js';
import { excludedSource, fingerprint, formationPrompt, formationSchema, memoryDigest, normalized, sensitive } from './formation-types.js';
import type { CandidateView, FormationExtractor, FormationOptions, FormationSource, MemoryCandidate } from './formation-types.js';

type ReadMemory = Pick<FileMemoryService, 'listForHost'>;
const pending = (candidate: MemoryCandidate) => ['pending', 'needs_clarification'].includes(candidate.status);
const body = (record: Pick<MemoryRecord, 'content'>) => normalized(record.content);
const canonical = (text: string) => normalized(text).replace(/^(?:我|本人)/u, '用户');
const withoutTime = (text: string) => text.replace(/^(?:现在|以后|今后|平时|长期|工作时|学习时|目前)/u, '');
function sourceProperty(text: string, property: string): string {
  const clause = /^(?:我|本人)([^，。；,;！!\n]+)/u.exec(text.trim())?.[1];
  if (!clause) return property;
  // 只恢复原话首个自述子句中恰好漏掉的否定；时间/适用范围及其余字词必须逐字可核对。
  const proposed = withoutTime(normalized(property));
  for (let end = 1; end <= Math.min(clause.length, 60); end++) {
    const prefix = clause.slice(0, end), field = withoutTime(normalized(prefix));
    const negatives = [...field.matchAll(/并不|不|未|没/gu)];
    if (negatives.length === 1 && field.replace(/并不|不|未|没/u, '') === proposed) return prefix.trim();
  }
  return property;
}
function owns(record: Pick<MemoryRecord, 'content'>, kind: string, subject: string, property: string): boolean {
  const text = body(record), field = normalized(property);
  // 写入目标比只读召回更保守：不借“用户的同事”或包含另一个项目名的句子转移归属。
  if (kind === 'semantic') return ['用户', '我', '本人'].some(owner => ['', '的', '不', '没', '未', '并不'].some(prefix => text.startsWith(owner + prefix + field)));
  const name = normalized(subject).replace(/项目$/u, '');
  return [name + '项目', name + '的', name + '的项目'].some(prefix => text.startsWith(prefix) && text.includes(field));
}

// Worker 仅持有只读 Memory 端口。唯一写入通过审批回调回到 OperationGuard。
export class FormationService {
  private extractor?: FormationExtractor;
  private active?: AbortController;
  private work?: Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private foregroundCount = 0;
  private idleAt: number;
  private stopped = false;
  private faultReported = false;

  constructor(readonly options: FormationOptions, private readonly store: SqliteStore, private readonly memory: ReadMemory,
    private readonly secrets: string[] = [], private readonly now: () => Date = () => new Date()) {
    this.idleAt = now().getTime();
  }

  setExtractor(extractor: FormationExtractor): void { this.extractor = extractor; }

  start(): void {
    if (!this.options.enabled) return;
    this.store.formation.recover(); this.refresh(); this.reconcile();
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        if (this.faultReported) return;
        this.faultReported = true;
        try {
          const job = this.store.formation.jobs('queued').find(job => job.owner === this.options.owner);
          if (job) this.store.event(job.runId, 'formation_storage_failed', '形成存储校验失败；保留队列，本次未调用模型');
        } catch { /* 数据库本身不可写时无法补记；不影响前台的既有错误策略。 */ }
      });
    }, 1000);
    this.timer.unref();
  }

  foreground(): () => void {
    this.foregroundCount++; this.active?.abort();
    let released = false;
    return () => { if (!released) { released = true; this.foregroundCount--; this.idleAt = this.now().getTime(); } };
  }

  enqueue(source: FormationSource): void {
    if (!this.options.enabled || source.owner !== this.options.owner || sensitive(source.text, this.secrets) || excludedSource(source.text)) return;
    // 明确记忆操作已经提交时不再自动建议；不从历史输出反推事实。
    if (this.store.events(source.runId).some(event => event.type === 'formation_review' || event.type === 'operation_committed' && event.details?.includes('memory_'))) return;
    if (Buffer.byteLength(source.text) > 1400) { this.store.event(source.runId, 'formation_skipped', '原话超出窗口预算'); return; }
    this.store.formation.enqueue(source, memoryDigest(this.memory.listForHost()));
    this.store.event(source.runId, 'formation_queued');
  }

  async tick(): Promise<void> {
    if (!this.options.enabled || this.stopped || this.work || !this.extractor || this.foregroundCount || this.now().getTime() - this.idleAt < this.options.idleMs) return;
    this.work = this.extract().finally(() => { this.work = undefined; this.active = undefined; });
    return this.work;
  }

  private async extract(): Promise<void> {
    this.store.formation.cleanup(this.now().toISOString());
    const queued = this.store.formation.jobs('queued').filter(job => job.owner === this.options.owner);
    if (!queued.length) return; // 无工作时不每秒扫描完整 Memory。
    this.refresh();
    const records = this.memory.listForHost(), digest = memoryDigest(records);
    this.faultReported = false;
    for (const job of queued.filter(job => job.digest !== digest)) this.store.formation.finish([job], 'cancelled', '来源之后 Memory 已变化，需新的用户陈述');
    const jobs = queued.filter(job => job.digest === digest).slice(0, 3);
    if (!jobs.length) return;
    // 总输入按 UTF-8 字节上限保守限制，不声称精确 Token 计数。
    const terms = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(jobs.map(job => job.text).join(' '))]
      .filter(part => part.isWordLike && part.segment.length >= 2).map(part => normalized(part.segment));
    let references = records.filter(record => !sensitive(record.content, this.secrets) && terms.some(term => body(record).includes(term)))
      .slice(0, 5).map(record => ({ id: record.id, kind: record.kind, content: record.content.slice(0, 80) }));
    const data = () => JSON.stringify({ sources: jobs.map(job => ({ runId: job.runId, text: job.text })), references });
    while (Buffer.byteLength(formationPrompt + data()) > 2000 && references.length) references.pop();
    while (Buffer.byteLength(formationPrompt + data()) > 2000 && jobs.length > 1) jobs.pop();
    if (Buffer.byteLength(formationPrompt + data()) > 2000) { this.store.formation.finish(jobs, 'failed', '完整原话超出输入预算；不截断事实'); return; }
    const input = data(), at = this.now().toISOString();
    const reserve = ((Buffer.byteLength(formationPrompt + input) + 512) * this.options.inputRate + 512 * this.options.outputRate) / 1_000_000;
    if (!this.store.formation.claim(jobs, at, Math.max(reserve, 0.000001), this.options.dailyCalls, this.options.dailyBudget)) return;
    const leader = jobs[0]!;
    const controller = this.active = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    const observer = this.store.observer(leader.runId);
    observer.event('formation_started', JSON.stringify({ jobId: leader.id, sourceCount: jobs.length, inputBytes: Buffer.byteLength(formationPrompt + input), reservedCny: reserve, queueMs: Date.parse(at) - Date.parse(leader.createdAt) }));
    try {
      // extractor 不一定正确响应取消，因此同时限制等待时间并禁止迟到结果入库。
      const request: ExecutionRequest = { prompt: input, scope: 'task', signal, observer };
      const raw = await new Promise<unknown>((resolve, reject) => {
        const abort = () => reject(new Error('提取中断或超时；不自动重试'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) { abort(); return; }
        void this.extractor!({ systemPrompt: formationPrompt, data: input, jobId: leader.id, request }, signal)
          .then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      });
      signal.throwIfAborted();
      if (!Value.Check(formationSchema, raw)) throw new Error('候选 Schema 无效');
      if (memoryDigest(this.memory.listForHost()) !== digest) throw new Error('提取期间 Memory 已变化');
      const seen = new Set<string>();
      for (const proposal of raw.candidates) {
        const job = jobs.find(job => job.runId === proposal.sourceRunId);
        if (!job || seen.has(job.id) || proposal.quote !== job.text || fingerprint(proposal.quote) !== job.sourceHash || !proposal.durable || proposal.mode !== 'asserted' ||
          !['semantic', 'project'].includes(proposal.kind) || excludedSource(job.text) || sensitive(job.text, this.secrets) ||
          !normalized(job.text).includes(normalized(proposal.value))) continue;
        const property = proposal.kind === 'semantic' && proposal.subject === '用户' ? sourceProperty(job.text, proposal.property) : proposal.property;
        if (!normalized(job.text).includes(normalized(property))) continue;
        const selfText = normalized(job.text).replace(/^(我|本人)(?:现在|以后|今后|平时|长期|工作时|学习时|目前)/u, '$1');
        // 属性可能包含时间/适用范围，先核对完整原话；仅为省略时间前缀的旧提议保留兼容判定。
        if (proposal.kind === 'semantic' && (proposal.subject !== '用户' ||
          !owns({ content: job.text }, 'semantic', '用户', property) && !owns({ content: selfText }, 'semantic', '用户', property))) continue;
        if (proposal.kind === 'project' && (!job.text.includes(proposal.subject) || !owns({ content: job.text }, 'project', proposal.subject, property) || /^(?:项目|这个项目|那个项目|我们)$/u.test(proposal.subject))) continue;
        seen.add(job.id);
        const hash = fingerprint([proposal.kind, normalized(proposal.subject), normalized(property), canonical(job.text)].join(':'));
        if (this.store.formation.suppressed(job.owner, hash)) continue;
        // 恢复否定后，仍检查同一范围的相反旧值；只用于找目标，不改草稿中的否定/时间。
        const fields = property === proposal.property ? [property] : [property, withoutTime(property).replace(/并不|不|未|没/u, '')];
        const candidates = records.filter(record => record.kind === proposal.kind && fields.some(field => owns(record, proposal.kind, proposal.subject, field)));
        if (records.some(record => canonical(record.content) === canonical(job.text))) continue;
        // 模型 targetId 只是提示，必须落在宿主按主体和属性找到的集合内。
        const invalidTarget = !!proposal.targetId && !candidates.some(record => record.id === proposal.targetId);
        // 明确的另一项目或可逐字恢复的否定范围不能强绑模型ID；无法证明新事实边界时仍澄清。
        const hinted = records.find(record => record.id === proposal.targetId);
        const separateProject = proposal.kind === 'project' && hinted?.kind === 'project' && !owns(hinted, 'project', proposal.subject, '');
        const safeNew = candidates.length === 0 && (separateProject || property !== proposal.property);
        const clarifyTarget = invalidTarget && !safeNew;
        if (property !== proposal.property) observer.event('formation_property_recovered', JSON.stringify({ sourceRunId: job.runId }));
        if (invalidTarget) observer.event('formation_target_ignored', JSON.stringify({ sourceRunId: job.runId, matchingTargets: candidates.length }));
        const target = candidates.length === 1 && !invalidTarget ? candidates[0] : undefined;
        const candidate: MemoryCandidate = {
          id: randomUUID(), owner: job.owner, jobId: job.id, kind: proposal.kind as 'semantic' | 'project', subject: proposal.subject,
          property, value: proposal.value, draft: job.text, quote: job.text, sourceHash: job.sourceHash,
          digest, revision: 1, hash: fingerprint(job.text), fingerprint: hash,
          status: clarifyTarget || candidates.length > 1 ? 'needs_clarification' : 'pending', createdAt: at, expiresAt: job.expiresAt,
          target: target && { id: target.id, key: target.key, version: target.version, hash: target.hash, content: target.content },
          targetOptions: candidates.map(record => record.id), reason: clarifyTarget ? '模型目标与主体/属性不符，需澄清' : candidates.length > 1 ? '存在多个旧事实，请先选要更新的记录' : undefined,
        };
        const conflicts = this.store.formation.candidates(job.owner).filter(old => pending(old) && old.kind === candidate.kind && normalized(old.subject) === normalized(candidate.subject) && normalized(old.property) === normalized(candidate.property));
        if (conflicts.length) {
          for (const old of conflicts) { old.status = 'stale'; this.store.formation.put(old); }
          candidate.status = 'needs_clarification'; candidate.reason = '新旧陈述有冲突，请编辑明确最终事实后再批准';
        }
        this.store.formation.put(candidate);
      }
      this.store.formation.finish(jobs, 'done');
      observer.event('formation_completed', JSON.stringify({ jobId: leader.id, elapsedMs: this.now().getTime() - Date.parse(at) }));
    } catch {
      this.store.formation.finish(jobs, 'failed', '提取失败/中断/格式或快照无效；不自动重试');
      observer.event('formation_failed', JSON.stringify({ jobId: leader.id, aborted: signal.aborted }));
    }
  }

  private refresh(): string {
    this.store.formation.cleanup(this.now().toISOString());
    const digest = memoryDigest(this.memory.listForHost());
    for (const candidate of this.store.formation.candidates(this.options.owner)) {
      if (pending(candidate) && candidate.digest !== digest) { candidate.status = 'stale'; this.store.formation.put(candidate); }
    }
    return digest;
  }

  view(): { view: CandidateView; text: string } {
    const digest = this.refresh();
    const candidates = this.store.formation.candidates(this.options.owner).filter(pending).slice(0, 3);
    return { view: { items: candidates.map(({ id, revision, hash }) => ({ id, revision, hash })), digest, expires: this.now().getTime() + 300000 },
      text: candidates.length ? '待审候选（未写入长期 Memory，每次只批准一条）：\n' + candidates.map((candidate, index) => `${index + 1}. [${candidate.kind}] ${candidate.draft}\n来源 Run=${this.store.formation.jobs().find(job => job.id === candidate.jobId)?.runId}；${candidate.target ? `更新旧值：${candidate.target.content}（v${candidate.target.version}）` : '拟新增'}${candidate.reason ? `；需澄清：${candidate.reason}` : ''}`).join('\n') : '目前没有待审候选；未保存任何新记忆。' };
  }

  private checked(view: CandidateView, position: number): MemoryCandidate {
    if (!this.options.enabled || view.expires <= this.now().getTime() || view.digest !== this.refresh()) throw new Error('候选视图过期或 Memory 已变化，请重新查看');
    const item = view.items[position - 1], candidate = item && this.store.formation.get(item.id);
    if (!candidate || candidate.owner !== this.options.owner || !pending(candidate) || candidate.revision !== item!.revision || candidate.hash !== item!.hash || fingerprint(candidate.draft) !== candidate.hash) throw new Error('候选不属于当前列表、已变化或已经处理，请重新查看');
    const job = this.store.formation.jobs().find(job => job.id === candidate.jobId);
    if (!job || job.sourceHash !== candidate.sourceHash || fingerprint(candidate.quote) !== job.sourceHash) throw new Error('候选来源无效');
    return candidate;
  }

  validateDisplay(view: CandidateView): void {
    const run = view.displayRunId && this.store.getRun(view.displayRunId);
    if (!run || run.status !== 'succeeded' || run.taskId || !run.output || fingerprint(run.output) !== view.displayHash ||
      !this.store.events(run.id).some(event => event.type === 'delivery_succeeded')) throw new Error('该候选清单没有成功发送的记录，请重新查看后再审批');
  }

  reject(view: CandidateView, position?: number): void {
    const candidates = position === undefined ? view.items.map((_, index) => this.checked(view, index + 1)) : [this.checked(view, position)];
    for (const candidate of candidates) { candidate.status = 'rejected'; this.store.formation.put(candidate); }
  }

  edit(view: CandidateView, position: number, draft: string): { view: CandidateView; text: string } {
    const candidate = this.checked(view, position);
    if (!draft.trim() || Buffer.byteLength(draft) > 1400 || sensitive(draft, this.secrets)) throw new Error('草稿为空、过长或包含敏感信息');
    if (candidate.targetOptions.length > 1) throw new Error('请先澄清要更新哪一条旧记忆');
    if (candidate.kind === 'project' && !draft.includes(candidate.subject)) throw new Error('新草稿必须保留原项目主体；更换项目请使用独立的明确记忆请求');
    if (candidate.reason?.startsWith('模型目标')) throw new Error('目标缺乏依据，请用明确记忆请求澄清；不能通过编辑绕过目标校验');
    candidate.draft = draft.trim(); candidate.hash = fingerprint(candidate.draft); candidate.revision++;
    candidate.status = 'pending'; delete candidate.reason; this.store.formation.put(candidate);
    return { view: { items: [{ id: candidate.id, revision: candidate.revision, hash: candidate.hash }], digest: view.digest, expires: this.now().getTime() + 300000, confirm: true }, text: `待确认新草稿：${candidate.draft}\n尚未写入，请明确确认；也可继续修改或拒绝。` };
  }

  clarify(view: CandidateView, position: number, targetPosition?: number): { view: CandidateView; text: string } {
    const candidate = this.checked(view, position);
    const records = this.memory.listForHost();
    if (!targetPosition) return { view: { ...view, items: [view.items[position - 1]!], targets: candidate.targetOptions }, text: '请选择要更新的旧记忆序号，选后还需确认草稿：\n' + candidate.targetOptions.map((id, index) => `${index + 1}. ${records.find(record => record.id === id)?.content}`).join('\n') };
    const id = view.targets?.[targetPosition - 1], target = records.find(record => record.id === id && candidate.targetOptions.includes(id!));
    if (!target) throw new Error('澄清目标不在已展示的旧记忆列表中');
    candidate.target = { id: target.id, key: target.key, version: target.version, hash: target.hash, content: target.content };
    candidate.targetOptions = [target.id]; candidate.status = 'pending'; candidate.revision++; this.store.formation.put(candidate);
    return { view: { items: [{ id: candidate.id, revision: candidate.revision, hash: candidate.hash }], digest: view.digest, expires: this.now().getTime() + 300000, confirm: true }, text: `将更新旧值：${target.content}\n新草稿：${candidate.draft}\n请明确确认后才保存。` };
  }

  approve(view: CandidateView, position: number, request: ExecutionRequest, write: (operation: WriteOperation) => MemoryRecord): MemoryCandidate {
    const candidate = this.checked(view, position);
    if (request.scope !== 'chat' || !request.source || !this.store.getRun(request.source.reference) || this.store.getRun(request.source.reference)?.status !== 'running') throw new Error('审批必须关联当前已鉴权交互 Run');
    request.signal.throwIfAborted();
    if (candidate.status !== 'pending') throw new Error('候选尚需澄清，不能直接保存');
    if (this.memory.listForHost().some(record => canonical(record.content) === canonical(candidate.draft))) {
      candidate.status = 'rejected'; candidate.reason = '当前已有相同事实，无需重复保存'; this.store.formation.put(candidate);
      throw new Error('当前已有相同事实，没有重复写入；请重新查看其他候选');
    }
    if (candidate.target) {
      const target = this.memory.listForHost().find(record => record.id === candidate.target!.id);
      if (!target || target.hash !== candidate.target.hash || target.version !== candidate.target.version) throw new Error('旧 Memory 版本已变化');
    }
    const operation: WriteOperation = candidate.target ? { tool: 'memory_update', args: { id: candidate.target.id, content: candidate.draft, expectedVersion: candidate.target.version } }
      : { tool: 'memory_remember', args: { kind: candidate.kind, key: `formed.${fingerprint(candidate.kind + ':' + normalized(candidate.subject) + ':' + normalized(candidate.property)).slice(0, 24)}`, content: candidate.draft } };
    this.store.formation.beginApply(candidate, request.source.reference);
    request.observer.event('formation_approval', JSON.stringify({ candidateId: candidate.id, revision: candidate.revision, hash: candidate.hash, tool: operation.tool }));
    try {
      const record = write(operation);
      candidate.status = 'applied'; candidate.resultId = record.id; candidate.resultVersion = record.version; this.store.formation.put(candidate);
      request.observer.event('operation_committed', JSON.stringify({ tool: operation.tool, id: record.id, candidateId: candidate.id, version: record.version }));
      return candidate;
    } catch (error) { candidate.status = 'blocked'; this.store.formation.put(candidate); throw error; }
  }

  private reconcile(): void {
    const records = this.memory.listForHost();
    for (const candidate of this.store.formation.candidates(this.options.owner).filter(candidate => candidate.status === 'applying')) {
      const key = candidate.target?.key ?? `formed.${fingerprint(candidate.kind + ':' + normalized(candidate.subject) + ':' + normalized(candidate.property)).slice(0, 24)}`;
      const record = records.find(record => record.key === key && record.kind === candidate.kind && record.content === candidate.draft && record.source.reference === candidate.approvalRunId && record.version === (candidate.target ? candidate.target.version + 1 : 1));
      candidate.status = record ? 'applied' : 'blocked'; candidate.resultId = record?.id; candidate.resultVersion = record?.version; this.store.formation.put(candidate);
    }
  }

  hint(): string {
    try {
      if (!this.store.formation.candidates(this.options.owner).some(pending)) return '';
      this.refresh(); return this.store.formation.takeHint(this.options.owner, this.now().toISOString().slice(0, 10)) ? '\n有待审的记忆建议，可问“有什么建议记住的吗？”；未经批准不会保存。' : '';
    }
    catch { return ''; }
  }

  async stop(): Promise<void> { this.stopped = true; if (this.timer) clearInterval(this.timer); this.active?.abort(); await this.work; }
}
