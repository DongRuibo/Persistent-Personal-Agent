import { independentCases, independentLimits } from './independent-console-cases.js';
import type { IndependentDefinition } from './independent-console-budget.js';

// 独立方案复用原话，不追改旧P1的计划生成指标；数额仅供未来审查，不是收费授权。
export const naturalPauseCases = {
  N1: { ...independentCases.P1 },
  N2: { ...independentCases.P2 },
  N3: { ...independentCases.P3 },
} as const;
export const naturalPauseDefinition: IndependentDefinition = {
  scope: 'natural-pause-console-v1',
  limits: { ...independentLimits, requests: 14, microCny: 2310000 },
  groups: { P: { requests: 14, microCny: 2310000 } }, cases: naturalPauseCases,
};
