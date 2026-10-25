// 本轮只准备；这些额度和固定话术不是收费授权，也不是产品意图规则。
export const independentLimits = { requests: 30, microCny: 5000000, bodyBytes: 65536, outputTokens: 4096, publicGets: 0 } as const;
export const groupLimits = { P: { requests: 14, microCny: 2310000 }, R: { requests: 12, microCny: 1980000 }, S: { requests: 4, microCny: 660000 } } as const;
export type Group = keyof typeof groupLimits;
export const independentCases = {
  P1: { group: 'P', expected: 4, max: 6, goal: true, prompt: '帮我分阶段制定青桐阅读计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行当前片段。先拟定待批准的阅读安排，等我确认后再执行正式步骤。' },
  P2: { group: 'P', expected: 3, max: 4, goal: false, prompt: '查看青桐阅读计划进度' },
  P3: { group: 'P', expected: 3, max: 4, goal: false, prompt: '暂停那个学习计划' },
  R1: { group: 'R', expected: 4, max: 7, goal: true, prompt: '帮我逐步制定白桦练习计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行单次片段，工具能力由宿主白名单控制。正式计划最多1个Step，使用Skill interview-practice。该Step先依据这些资料出一道题并说明考察点，首次交付必须partial并等待我回答，收到回答后点评并complete。现在先给出待批准计划。' },
  R2: { group: 'R', expected: 4, max: 5, goal: true, prompt: '批准白桦练习计划并继续一段' },
  S1: { group: 'S', expected: 2, max: 4, goal: false, prompt: '请把下面这段虚构的Agent技术资料整理成简短笔记，说明职责和调用关系，并区分资料中的事实与尚未验证的内容：宿主保存用户授权与Checkpoint；Pi执行当前片段；工具能力由宿主白名单控制。这里只描述了职责，没有提供测试结果。' },
} as const;
export type IndependentCase = keyof typeof independentCases;
export const groupSkills = { P: [], R: ['interview-practice'], S: ['agent-notes'] } as const;
