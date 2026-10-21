// 仅测试用：为旧版集成样本提供隔离解析结果，不是产品的自然语言解析器。
export function intentReply(payload: { messages: { role: string; content?: unknown }[] }): string | undefined {
  if (!JSON.stringify(payload.messages.find((message) => message.role === 'system')).includes('隔离的当前用户意图解析器')) return undefined;
  const value = payload.messages.findLast((message) => message.role === 'user')!.content;
  const encoded = typeof value === 'string' ? value : (value as { text: string }[]).map((part) => part.text).join('');
  const { message } = JSON.parse(encoded) as { message: string };
  const fields = Object.fromEntries([...message.matchAll(/^(kind|key)=(.+)$/gmu)].map((match) => [match[1], match[2]!.trim()]));
  const body = message.replace(/^(?:记住|更新记忆|忘记)[：:]/u, '').replace(/^(?:kind|key)=.+$/gmu, '').trim();
  const common = { mode: 'request', evidence: message };
  if (message.startsWith('记住：')) return JSON.stringify({ ...common, action: 'memory_remember', body, bodyEvidence: body,
    kind: fields.kind ?? 'project', key: fields.key ?? (body.includes('Aurora') ? 'aurora.database' : 'test.database') });
  if (message.startsWith('更新记忆：')) return JSON.stringify({ ...common, action: 'memory_update', body, bodyEvidence: body, selector: { keywords: [fields.key!] } });
  if (message.startsWith('忘记：')) return JSON.stringify({ ...common, action: 'memory_forget', selector: { keywords: [fields.key ?? message.split('key=')[1]!] } });
  const remind = /^(.+?)提醒我(.+)$/u.exec(message);
  if (remind) return JSON.stringify({ ...common, action: 'create_task', when: remind[1], body: remind[2], bodyEvidence: remind[2] });
  return JSON.stringify({ action: 'none', mode: 'query', evidence: message });
}

export function sseText(text: string): string {
  return [
    { index: 0, delta: { role: 'assistant', content: text }, finish_reason: null },
    { index: 0, delta: {}, finish_reason: 'stop' },
  ].map((choice) => `data: ${JSON.stringify({ id: 'intent-stub', model: 'local-stub', choices: [choice] })}\n\n`).join('') + 'data: [DONE]\n\n';
}
