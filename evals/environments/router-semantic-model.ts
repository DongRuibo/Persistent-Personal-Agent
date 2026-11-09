import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { SemanticBudget } from '../evaluators/router-semantic.js';
import type { SemanticPlan } from '../evaluators/router-semantic.js';

export class PrepareOnly extends Error {}

// 使用与生产Pi适配相同的公开SDK、模型参数和一次请求限制；不复制Router提示词。
export async function semanticModel(plan: SemanticPlan, apiKey: string, mode: 'live' | 'prepare', transport: typeof fetch = fetch) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerProvider('personal-compatible', { baseUrl: plan.base_url, api: 'openai-completions', authHeader: true,
    models: [{ id: plan.model, name: plan.model, reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32768, maxTokens: 4096, samplingParams: { enable_thinking: false },
      compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: 'max_tokens' } }] });
  await runtime.setRuntimeApiKey('personal-compatible', apiKey);
  const model = runtime.getModel('personal-compatible', plan.model)!;
  const budget = new SemanticBudget(plan);
  const redact = (value: string) => apiKey ? value.replaceAll(apiKey, '<REDACTED>') : value;
  return { budget, redact,
    async complete(systemPrompt: string, text: string, record: Record<string, unknown>[], onDispatch?: (event: Record<string, unknown>) => void) {
      let attempted = false, prepared = false, knownUsage = false;
      const signal = AbortSignal.timeout(plan.limits.timeout_ms), started = performance.now();
      const response = await runtime.completeSimple(model, { systemPrompt, messages: [{ role: 'user', content: text, timestamp: Date.now() }] },
        { signal, maxTokens: plan.limits.max_output_tokens_per_request, maxRetries: 0, temperature: 0,
          fetch: async (url, init) => {
            if (attempted || prepared) throw new Error('每条真实路由最多一次HTTP；拒绝重发');
            if (typeof init?.body !== 'string') throw new Error('无法度量实际路由请求正文');
            const body = JSON.parse(init.body);
            if (body.model !== plan.model || body.max_tokens !== plan.limits.max_output_tokens_per_request || body.tools?.length || body.enable_thinking !== false) {
              throw new Error('实际请求偏离已批准模型/输出上限/零工具/关闭推理参数');
            }
            const actualUrl = new URL(String(url)), base = new URL(plan.base_url);
            if (actualUrl.origin !== base.origin || actualUrl.pathname !== base.pathname.replace(/\/$/u, '') + '/chat/completions') throw new Error('实际请求地址偏离已批准模型端点');
            const bytes = Buffer.byteLength(init.body);
            if (bytes > 32768) throw new Error('实际路由请求超过生产32KiB门限');
            const event: Record<string, unknown> = { phase: mode === 'prepare' ? 'prepared' : 'dispatch', body, bytes };
            record.push(event);
            if (mode === 'prepare') { prepared = true; throw new PrepareOnly('只准备实际序列化请求，未发网络'); }
            event.reservation = budget.reserve(bytes); attempted = true;
            onDispatch?.(event);
            const result = await transport(url, { ...init, signal, redirect: 'error' });
            event.http_status = result.status; event.request_id = result.headers.get('x-request-id');
            return result;
          },
          onProviderStreamEvent: event => {
            const usage = (event as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
            if (typeof usage?.prompt_tokens === 'number' && typeof usage.completion_tokens === 'number') knownUsage = true;
          } });
      if (prepared) throw new PrepareOnly('实际序列化已记录；零网络调用');
      const output = response.content.filter(part => part.type === 'text').map(part => part.text).join('');
      record.push({ phase: 'result', model: response.model, stop_reason: response.stopReason, text: redact(output),
        usage: knownUsage ? { input_tokens: response.usage.input, output_tokens: response.usage.output,
          cache_read_tokens: response.usage.cacheRead, cache_write_tokens: response.usage.cacheWrite } : null,
        cost_cny: null, elapsed_ms: Math.round(performance.now() - started), error: response.errorMessage ? redact(response.errorMessage) : null });
      if (knownUsage && response.usage.output > plan.limits.max_output_tokens_per_request) throw new Error('供应商输出超批准上限，停止后续请求');
      if (signal.aborted || response.stopReason !== 'stop' || response.content.some(part => part.type === 'toolCall') || !output.trim()) {
        throw new Error(redact(response.errorMessage ?? `路由模型未正常完成：${response.stopReason}`));
      }
      return output;
    },
  };
}
