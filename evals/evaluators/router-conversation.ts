export interface ConversationPlan {
  version: string; model: string; base_url: string;
  limits: { cny: number; requests: number; input_reservation: number; output_reservation: number };
  reservation_rates: { input_cny_per_million: number; output_cny_per_million: number };
  topics: Record<string, { canary: string; facts: string[] }>;
  turns: ConversationTurn[];
}
export interface ConversationTurn {
  id: string; text: string; target: string | null; action: 'create' | 'reuse' | 'clarify';
  selection: boolean; own_required: boolean; recovery: boolean; restart_after?: boolean; facts?: string[];
}
export interface ConversationCall {
  index: number; turn: string; stage: string; body: string; bytes: number;
  reservation: { input: number; output: number; cny: number };
  status?: number; response?: string; usage?: { prompt_tokens: number; completion_tokens: number } | null;
  error?: string; elapsed_ms?: number;
}

// 按实际序列化字节加协议余量预留输入，按原生产输出上限预留输出；跨重启不退还额度。
export class ConversationBudget {
  requests = 0; input = 0; output = 0; cny = 0;
  constructor(readonly plan: ConversationPlan) {}
  reserve(bytes: number, maxOutput: number) {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > 65536 || !Number.isSafeInteger(maxOutput) || maxOutput < 1 || maxOutput > 4096) throw new Error('请求预算参数无效');
    const input = bytes + 256, output = maxOutput;
    const cny = (input * this.plan.reservation_rates.input_cny_per_million + output * this.plan.reservation_rates.output_cny_per_million) / 1e6;
    const limit = this.plan.limits;
    if (this.requests + 1 > limit.requests || this.input + input > limit.input_reservation || this.output + output > limit.output_reservation || this.cny + cny > limit.cny) throw new Error('本轮预算不足，拒绝发出模型HTTP');
    this.requests++; this.input += input; this.output += output; this.cny += cny;
    return { input, output, cny };
  }
}

export function gradeConversationContext(plan: ConversationPlan, turn: ConversationTurn, calls: ConversationCall[], userText: string) {
  const privateTokens = Object.entries(plan.topics).map(([alias, topic]) => ({ alias, token: topic.canary }));
  const chat = calls.filter(call => call.stage === 'chat');
  const contaminated = calls.flatMap(call => privateTokens.filter(item => call.body.includes(item.token)
    && !userText.includes(item.token) && !(call.stage === 'chat' && item.alias === turn.target))
    .map(item => ({ request: call.index, stage: call.stage, alias: item.alias, token: item.token })));
  const own = turn.own_required && turn.target ? chat.length > 0 && chat.every(call => call.body.includes(plan.topics[turn.target!]!.canary)) : null;
  return { requests: calls.length, chat_requests: chat.length, own_required: turn.own_required, own_present: own,
    contaminated_requests: new Set(contaminated.map(item => item.request)).size, contaminated: contaminated.length > 0, violations: contaminated };
}
