// 本轮专用冻结话术；只由验收入口发送，不作为产品意图规则或权限来源。
export const stagedLimits = { requests: 46, microCny: 8000000, bodyBytes: 65536, outputTokens: 4096 } as const;
export const stageLimits = { A: { requests: 28, microCny: 4620000 }, B: { requests: 4, microCny: 660000 }, C: { requests: 14, microCny: 2320000 } } as const;
export type Stage = keyof typeof stageLimits;
export const stagedCases = {
  A1: { stage: 'A', expected: 4, max: 6, goal: true, prompt: '帮我逐步制定青桐阅读计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行单次片段，工具能力由宿主白名单控制。正式计划最多1个Step，使用Skill interview-practice。该Step先依据这些资料出一道题并说明考察点，首次交付必须partial并等待我回答，收到回答后点评并complete。现在先给出待批准计划。' },
  A2: { stage: 'A', expected: 4, max: 5, goal: true, prompt: '批准青桐阅读计划并继续一段' },
  A3: { stage: 'A', expected: 0, max: 0, goal: false, prompt: '' },
  A4: { stage: 'A', expected: 3, max: 4, goal: false, prompt: '查看青桐阅读计划进度' },
  A5: { stage: 'A', expected: 3, max: 4, goal: false, prompt: '暂停那个学习计划' },
  A6: { stage: 'A', expected: 4, max: 5, goal: true, prompt: '继续青桐阅读计划。我的虚构回答：宿主保存授权与Checkpoint，Pi负责单次模型执行；工具能力由宿主白名单控制。请点评这个回答并完成当前Step，等待我决定Goal是否达成。' },
  A7: { stage: 'A', expected: 3, max: 4, goal: false, prompt: '取消刚才那个学习计划' },
  B1: { stage: 'B', expected: 3, max: 4, goal: false, prompt: '请读取 Pi Skills 文档，并总结加载流程' },
  C1: { stage: 'C', expected: 4, max: 5, goal: true, prompt: '帮我逐步制定杜鹃资料练习，这是虚构的练习目标。正式计划最多1个Step，使用Skill interview-practice。该Step依据我稍后批准的已获取资料出一道题并说明考察点，首次交付必须partial并等待我回答，收到回答后才点评并complete。现在先给出待批准计划。' },
  C2: { stage: 'C', expected: 3, max: 4, goal: false, prompt: '将已获取的 Pi Skills 文档第1至8行绑定到杜鹃资料练习第1步' },
  C3: { stage: 'C', expected: 4, max: 5, goal: true, prompt: '批准杜鹃资料练习并继续一段' },
  C4: { stage: 'C', expected: 0, max: 0, goal: false, prompt: '' },
} as const satisfies Record<string, { stage: Stage; expected: number; max: number; goal: boolean; prompt: string }>;
export type StagedCase = keyof typeof stagedCases;
export const stagedModel = { model: 'deepseek-ai/DeepSeek-V4.1-Flash', endpoint: 'https://api.siliconflow.cn/v1/chat/completions' } as const;
