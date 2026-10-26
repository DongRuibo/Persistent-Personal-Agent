import { independentLimits } from './independent-console-cases.js';
import type { IndependentDefinition } from './independent-console-budget.js';

// 原RC的九条消息逐字冻结；不包含额外的取消、运行中竞态或联网场景。
export const manualGoalCases = {
  M1: { group: 'P', expected: 4, max: 6, goal: true, prompt: '帮我分阶段完成澄川职责练习。只使用以下虚构资料：宿主验证当前用户授权并保存Plan与Checkpoint；Pi每次使用独立Session执行一个text_only片段；工具能力由宿主白名单决定。正式计划最多1个Step。这个Step先根据资料出一道题并说明考察点，首次交付partial并等待我的回答；收到回答后点评并complete。先拟待批准计划，等我确认后再执行正式步骤。' },
  M2: { group: 'P', expected: 3, max: 4, goal: false, prompt: '查看澄川职责练习进度' },
  M3: { group: 'P', expected: 2, max: 4, goal: false, prompt: '确认' },
  M4: { group: 'P', expected: 4, max: 5, goal: true, prompt: '继续澄川职责练习一段' },
  M5: { group: 'P', expected: 3, max: 4, goal: false, prompt: '查看澄川职责练习进度' },
  M6: { group: 'P', expected: 3, max: 4, goal: false, prompt: '暂停澄川职责练习' },
  M7: { group: 'P', expected: 4, max: 5, goal: true, prompt: '继续澄川职责练习一段。我的回答是：宿主验证用户授权并保存Plan与Checkpoint，Pi只执行当前text_only片段，工具权限由宿主白名单决定。' },
  M8: { group: 'P', expected: 3, max: 4, goal: false, prompt: '查看澄川职责练习进度' },
  M9: { group: 'P', expected: 3, max: 4, goal: false, prompt: '确认澄川职责练习目标已经达成' },
} as const;
export const manualGoalDefinition: IndependentDefinition = {
  scope: 'manual-goal-console-v1', limits: { ...independentLimits, requests: 40, microCny: 6600000 },
  groups: { P: { requests: 40, microCny: 6600000 } }, cases: manualGoalCases,
};
