import type { MemoryRecord } from './contracts.js';
import { WorkJobError } from './work-job-store.js';
import { WorkThreadError } from './work-thread-store.js';
import type { WorkThreadService } from './work-thread-service.js';
import type { WorkThread } from './work-thread-types.js';

export type RecallKind = 'goal' | 'task' | 'run' | 'job' | 'event';
export interface WorkRecallRequest {
  query: string; includeBackground?: boolean;
  selection?: { threadId?: string; object?: { kind: RecallKind; id: string } };
}
export interface RecallObject {
  kind: RecallKind; id: string; title: string; status: string; updatedAt: string; threadId?: string;
  sourceId?: string; observedAt?: string; repository?: string; branch?: string; previous?: string; head?: string; snapshotHash?: string;
}
export interface WorkRecallLocation {
  status: 'located' | 'clarify' | 'unavailable'; question?: string; threads: WorkThread[]; objects: RecallObject[];
}
export interface RecallSource {
  kind: RecallKind; id: string; status: string; threadId?: string; sourceId?: string; instruction?: string; instructionOmitted?: true;
  repository?: string; branch?: string; previous?: string; head?: string; observedAt?: string; snapshotHash?: string;
  subscriptionId?: string; observationId?: string | null; triggerId?: string | null; reason?: string | null;
}
export interface RecallExcerpt { text: string; originalBytes: number; displayBytes: number; truncated: boolean }
export interface RecallResultItem {
  status: string; sources: RecallSource[]; runId?: string; goalId?: string; finishedAt?: string | null;
  fileOperationId?: string; objective?: string; progressSummary?: string; question?: string; checkpointHash?: string;
  excerpt?: RecallExcerpt; message?: string; omittedFields?: string[];
}
export interface WorkRecallResult {
  location: WorkRecallLocation; untrusted: true; results: RecallResultItem[];
  background: { status: 'not_requested' | 'available' | 'unavailable'; records: (Pick<MemoryRecord, 'id' | 'kind' | 'key' | 'version' | 'source'> & { excerpt: RecallExcerpt })[] };
  omitted: { results: number; historyEntries: number; sources: number; background: number };
}
export class WorkRecallError extends Error { readonly status = 400; }

// 外部字段只在此入口校验；本卡仅接受明确查询与当前选择，不接受身份或隐式授权。
function request(value: unknown): WorkRecallRequest {
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === 'object' && !Array.isArray(item);
  const id = (item: unknown): item is string => typeof item === 'string' && item.length > 0 && item.length <= 128 && !/[\s\x00-\x1f]/u.test(item);
  if (!record(value) || Object.keys(value).some(key => !['query', 'selection', 'includeBackground'].includes(key))
    || value.includeBackground !== undefined && typeof value.includeBackground !== 'boolean'
    || typeof value.query !== 'string' || Buffer.byteLength(value.query, 'utf8') > 2048) {
    throw new WorkRecallError('查询格式无效或超过2 KiB，请缩小查询。');
  }
  if (value.selection !== undefined) {
    const selection = value.selection;
    if (!record(selection) || Object.keys(selection).some(key => !['threadId', 'object'].includes(key))
      || selection.threadId !== undefined && !id(selection.threadId)) throw new WorkRecallError('当前选择格式无效。');
    if (selection.object !== undefined) {
      const object = selection.object;
      if (!record(object) || Object.keys(object).some(key => !['kind', 'id'].includes(key))
        || typeof object.kind !== 'string' || !['goal', 'task', 'run', 'job', 'event'].includes(object.kind) || !id(object.id)) {
        throw new WorkRecallError('当前对象选择格式无效。');
      }
    }
  }
  return value as unknown as WorkRecallRequest;
}

export class WorkRecallService {
  constructor(private readonly threads: WorkThreadService) {}
  locate(value: unknown): WorkRecallLocation { return this.locateRequest(request(value)); }
  read(value: unknown): WorkRecallResult {
    const input = request(value), location = this.locateRequest(input);
    const response: WorkRecallResult = { location, untrusted: true, results: [],
      background: { status: 'not_requested', records: [] }, omitted: { results: 0, historyEntries: 0, sources: 0, background: 0 } };
    const scopeOnly = input.selection?.threadId && !input.selection.object && !input.query.trim() && location.threads.length === 1;
    if (location.status === 'unavailable' || location.status === 'clarify' && !scopeOnly) {
      if (Buffer.byteLength(JSON.stringify(response), 'utf8') > 8192) response.location = { status: 'clarify', threads: [], objects: [], question: '完整元数据超出8 KiB，请明确选择对象。' };
      return response;
    }
    const entries = new Map<string, { runId?: string; status: string; sources: RecallSource[]; expectedGoals: Set<string>; blocked: boolean }>();
    const add = (key: string, source: RecallSource, runId?: string, expectedGoal?: string) => {
      const entry = entries.get(key) ?? { runId, status: source.status, sources: [], expectedGoals: new Set<string>(), blocked: false };
      if (!entry.sources.some(item => JSON.stringify(item) === JSON.stringify(source))) entry.sources.push(source);
      if (expectedGoal) entry.expectedGoals.add(expectedGoal);
      if ((source.kind === 'job' || source.kind === 'task') && source.status !== 'succeeded') entry.blocked = true;
      entries.set(key, entry);
    };
    for (const object of location.objects) {
      const source: RecallSource = { kind: object.kind, id: object.id, status: object.status,
        ...(location.threads.length === 1 ? { threadId: location.threads[0]!.id } : {}) };
      if (object.kind === 'goal') {
        const history = this.threads.recallHistory(object.id); response.omitted.historyEntries += history.omitted;
        for (const runId of history.runIds) add(runId, source, runId, object.id);
        if (!history.runIds.length) add(`goal:${object.id}`, source);
      } else if (object.kind === 'task' || object.kind === 'job') {
        const original = this.threads.recallObjectRun(object.kind, object.id), runId = original?.runId;
        add(runId ?? `${object.kind}:${object.id}`, { ...source, instruction: original?.instruction }, runId ?? undefined);
      } else if (object.kind === 'run') add(object.id, source, object.id);
      else {
        const event = this.threads.recallEventEvidence(object.threadId!, object.id);
        if (event.kind !== 'event') { add(`event:${object.id}`, { ...source, status: event.kind }); continue; }
        response.omitted.sources += event.omitted;
        for (const link of event.links) {
          const origin: RecallSource = { ...source, status: link.invalid ? 'invalid' : link.status,
            sourceId: object.sourceId, repository: object.repository, branch: object.branch, previous: object.previous,
            head: object.head, observedAt: object.observedAt, snapshotHash: event.snapshotHash,
            subscriptionId: link.subscriptionId, observationId: link.observationId, triggerId: link.triggerId, reason: link.reason };
          add(link.runId ?? `event:${object.id}`, origin, link.runId ?? undefined, link.goalId ?? undefined);
        }
      }
    }
    let remaining = 16384;
    // 同时约束原UTF-8及JSON转义后的字节；按码点截取，不拆开有效代理对。
    const excerpt = (text: string, originalBytes = Buffer.byteLength(text, 'utf8')): RecallExcerpt => {
      let shown = '', raw = 0, encoded = 0;
      for (const character of text) {
        const bytes = Buffer.byteLength(character, 'utf8'), jsonBytes = Buffer.byteLength(JSON.stringify(character), 'utf8') - 2;
        if (raw + bytes > 4096 || encoded + jsonBytes > 4094 || encoded + jsonBytes > remaining) break;
        shown += character; raw += bytes; encoded += jsonBytes;
      }
      remaining -= encoded;
      return { text: shown, originalBytes, displayBytes: raw, truncated: raw !== originalBytes };
    };
    for (const entry of entries.values()) {
      if (response.results.length >= 5) { response.omitted.results++; continue; }
      // 元数据需要省略别名时，先保留事件到原执行的证据链。
      entry.sources.sort((a, b) => Number(b.kind === 'event') - Number(a.kind === 'event'));
      const item: RecallResultItem = { status: entry.status, sources: entry.sources, ...(entry.runId ? { runId: entry.runId } : {}) };
      if (!entry.runId) {
        item.message = entry.sources.some(source => source.kind === 'event')
          ? entry.status === 'invalid' || entry.status === 'unavailable' ? '来源不可用，本轮未提供成果。' : '仅观察，尚无分析成果。'
          : '当前对象尚无可提供的执行成果。';
      } else {
        // 所有别名在同一处先辨认GoalExecution；任何失败关闭都不回退Run正文。
        const execution = this.threads.recallExecution(entry.runId);
        if (execution.kind === 'unavailable' || execution.kind === 'invalid') {
          item.status = execution.kind; item.message = 'Goal成果不可用，本轮未提供正文。';
        } else if (entry.expectedGoals.size && (execution.kind !== 'goal' || [...entry.expectedGoals].some(id => id !== execution.goalId))) {
          item.status = 'invalid'; item.message = '原执行关系不一致，本轮未提供正文。';
        } else if (execution.kind === 'goal') {
          item.status = execution.status; item.goalId = execution.goalId; item.finishedAt = execution.finishedAt;
          item.objective = execution.objective;
          if (execution.checkpoint) {
            item.checkpointHash = execution.checkpointHash!;
            item.progressSummary = execution.checkpoint.progressSummary; item.question = execution.checkpoint.question;
            item.excerpt = excerpt(execution.checkpoint.artifactText);
          } else item.message = '此Goal执行未提交有效成果，仅提供原状态与出处。';
        } else {
          const run = this.threads.recallRun(entry.runId);
          if (run.kind === 'file') {
            item.status = 'file_reference'; item.fileOperationId = run.fileOperationId;
            item.message = '文件操作只提供原入口；请在原详情完整查看并确认。';
          } else if (run.kind === 'unavailable') { item.status = 'unavailable'; item.message = '执行不存在或无权访问。'; }
          else {
            item.status = run.status; item.finishedAt = run.finishedAt;
            if (!entry.blocked && run.status === 'succeeded' && run.output !== null) item.excerpt = excerpt(run.output, run.originalBytes);
            else item.message = '当前执行或原对象无成功成果，仅提供状态与出处。';
          }
        }
      }
      response.results.push(item);
    }
    if (input.includeBackground) {
      try {
        const records = this.threads.recallBackground(input.query, location.threads.length === 1 ? location.threads[0]!.id : undefined);
        response.background.status = 'available';
        for (const record of records) {
          if (response.results.length + response.background.records.length >= 5) { response.omitted.background++; continue; }
          response.background.records.push({ id: record.id, kind: record.kind, key: record.key, version: record.version,
            source: record.source, excerpt: excerpt(record.content) });
        }
      } catch { response.background.status = 'unavailable'; response.background.records = []; }
    }
    const metadataBytes = () => Buffer.byteLength(JSON.stringify(response, (key, value: unknown) => key === 'text' ? '' : value), 'utf8');
    // 目标、反馈与问题整体提供或明确省略；不为预算偷偷改写含义。
    for (const field of ['objective', 'progressSummary', 'question'] as const) {
      for (const item of [...response.results].reverse()) {
        if (metadataBytes() <= 8192) break;
        if (item[field] !== undefined) { delete item[field]; (item.omittedFields ??= []).push(field); }
      }
    }
    for (const item of [...response.results].reverse()) {
      for (const source of item.sources) {
        if (metadataBytes() <= 8192) break;
        if (source.instruction !== undefined) { delete source.instruction; source.instructionOmitted = true; }
      }
      while (metadataBytes() > 8192 && item.sources.length > 1) { item.sources.pop(); response.omitted.sources++; }
    }
    while (metadataBytes() > 8192 && response.background.records.length) { response.background.records.pop(); response.omitted.background++; }
    while (metadataBytes() > 8192 && response.results.length) { response.results.pop(); response.omitted.results++; }
    if (metadataBytes() > 8192) response.location = { status: 'clarify', threads: [], objects: [], question: '完整来源元数据超出8 KiB，请明确选择对象以缩小范围。' };
    return response;
  }
  private locateRequest(input: WorkRecallRequest): WorkRecallLocation {
    const selection = input.selection, reference = selection?.object;
    const result = (status: WorkRecallLocation['status'], threads: WorkThread[], objects: RecallObject[], question?: string): WorkRecallLocation => {
      const response = { status, threads, objects, ...(question ? { question } : {}) };
      if (threads.length > 20 || objects.length > 20 || Buffer.byteLength(JSON.stringify(response), 'utf8') > 8192) {
        return { status: 'clarify', threads: [], objects: [], question: '候选超过20主题、20对象或8 KiB，请明确主题或对象以缩小范围。' };
      }
      return response;
    };
    let threads: WorkThread[], objects: RecallObject[];
    try {
      threads = selection?.threadId ? [this.threads.get(selection.threadId)] : this.threads.list();
      if (reference) {
        if (reference.kind === 'event') {
          const events = this.threads.recallEvents(selection?.threadId, reference.id);
          if (!events.length) {
            if (selection?.threadId && this.threads.recallEvents(undefined, reference.id).length) {
              return result('clarify', threads, [], '明确事件与所选主题没有关联，请重新选择。');
            }
            return result('unavailable', [], [], '事件不存在或无权访问相关主题。');
          }
          const related = new Set(events.map(event => event.threadId));
          if (selection?.threadId && !related.has(selection.threadId)) return result('clarify', threads, [], '明确事件与所选主题没有关联，请重新选择。');
          threads = threads.filter(thread => related.has(thread.id));
          objects = events.filter(event => !selection?.threadId || event.threadId === selection.threadId)
            .map(event => ({ ...event, kind: 'event', title: `GitHub ${event.repository} ${event.branch}`, status: 'recorded', updatedAt: event.observedAt }));
        } else {
          const object = this.threads.recallObject(reference.kind, reference.id);
          if (!object) return result('unavailable', [], [], '对象不存在或无权访问。');
          const related = this.threads.recallThreads(reference.kind, reference.id);
          if (selection?.threadId && !related.some(thread => thread.id === selection.threadId)) {
            return result('clarify', threads, [], '明确对象与所选主题没有关联，请重新选择。');
          }
          threads = selection?.threadId ? threads : related;
          objects = [object as RecallObject];
        }
        return result(threads.length > 1 ? 'clarify' : 'located', threads, objects,
          threads.length > 1 ? '此对象关联多个主题，请明确选择主题。' : undefined);
      }
    } catch (error) {
      if ((error instanceof WorkThreadError || error instanceof WorkJobError) && error.status === 404) {
        return result('unavailable', [], [], '主题或对象不存在或无权访问。');
      }
      throw error;
    }
    const query = input.query.trim();
    if (/刚才|刚刚|那个|这个/u.test(query)) return result('clarify', [], [], '请明确选择当前对象或事件；历史记录不能证明“刚才”的指代。');
    // 只支持固定查询前缀及可见标题，不做开放式语义推断。
    const term = query.replace(/^(?:请)?(?:查找|找回|查一下|之前准备的|之前的|之前)/u, '').trim();
    if (!selection?.threadId && term) {
      const matched = threads.filter(thread => thread.title.includes(term) || query.includes(thread.title));
      if (matched.length) threads = matched;
    }
    if (threads.length > 20) return result('clarify', threads, []);
    if (/(?:上次|最近一次).*GitHub/iu.test(query)
      && (threads.length !== 1 || !selection?.threadId && !query.includes(threads[0]!.title))) {
      return result('clarify', threads, [], '请先明确GitHub更新所属的主题。');
    }
    objects = threads.flatMap(thread => {
      const linked = this.threads.recallObjects(thread.id) as RecallObject[];
      const events: RecallObject[] = this.threads.recallEvents(thread.id).map(event => ({ ...event, kind: 'event',
        title: `GitHub ${event.repository} ${event.branch}`, status: 'recorded', updatedAt: event.observedAt }));
      return [...linked, ...events];
    });
    const bounded = result('clarify', threads, objects);
    if (!bounded.objects.length && objects.length) return bounded;
    if (/(?:上次|最近一次).*GitHub/iu.test(query)) {
      const events = objects.filter(object => object.kind === 'event');
      if (!events.length) return result('clarify', threads, [], '当前范围尚无可选事件，请等待真实观察或选择其他主题。');
      if (this.threads.recallSourceIds(threads[0]!.id).length !== 1 || new Set(events.map(event => event.sourceId)).size !== 1) return result('clarify', threads, events, '存在多个GitHub来源，请选择具体事件以定位此次查找。');
      const latest = events.reduce((at, event) => event.updatedAt > at ? event.updatedAt : at, '');
      const matches = events.filter(event => event.updatedAt === latest);
      return result(matches.length === 1 ? 'located' : 'clarify', threads, matches,
        matches.length === 1 ? undefined : '同一观察时间存在多个事件，请明确选择。');
    }
    if (term) {
      const kind = /^(?:Goal|目标)$/iu.test(term) ? 'goal' : /^(?:Task|任务)$/iu.test(term) ? 'task'
        : /^(?:Run|执行记录)$/iu.test(term) ? 'run' : /^(?:Job|后台工作)$/iu.test(term) ? 'job' : undefined;
      objects = objects.filter(object => kind ? object.kind === kind : object.title.includes(term));
      if (objects.length === 1) {
        const object = objects[0]!;
        const related = selection?.threadId ? threads : object.kind === 'event' ? threads.filter(thread => thread.id === object.threadId)
          : this.threads.recallThreads(object.kind, object.id);
        return result(related.length > 1 ? 'clarify' : 'located', related, objects,
          related.length > 1 ? '该对象关联多个主题，请明确主题。' : undefined);
      }
    }
    return result('clarify', threads, objects, objects.length ? '请明确选择需要查找的对象。' : '当前范围未定位到对象，请补充可见标题或明确ID；未查询全部历史。');
  }
}
