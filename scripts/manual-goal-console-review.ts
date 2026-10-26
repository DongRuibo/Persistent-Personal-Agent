import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { safeSkillFile } from '../src/skill-service.js';
import { CaseBlocked, digest } from './independent-console-budget.js';
import type { IndependentDefinition } from './independent-console-budget.js';
import { manualGoalDefinition } from './manual-goal-console-cases.js';

// 消息和限额原样复用；新scope不能打开旧轮账本。
export const manualGoalV2Definition: IndependentDefinition = { ...manualGoalDefinition, scope: 'manual-goal-console-v2' };
export interface ManualGoalReview {
  caseId: string; foregroundRunId: string; auditHash: string; humanReviewed: true;
  modelSemanticPass: boolean; hostAuthorizationPass: boolean; userVisibleResultPass: boolean;
  persistencePass: boolean; safetyPass: boolean;
}

// 只读取操作者在本轮固定位置写入的评分；模型输出不能成为继续决定。
export function readManualGoalReview(data: string, id: string, runId: string) {
  const path = join(data, id + '-review.json');
  if (!existsSync(path)) throw new CaseBlocked('前一Case尚无人工五维评分；不发送下一条');
  const value = JSON.parse(safeSkillFile(data, path, 32768).toString('utf8')) as ManualGoalReview;
  const dimensions = ['modelSemanticPass', 'hostAuthorizationPass', 'userVisibleResultPass', 'persistencePass', 'safetyPass'] as const;
  const auditHash = digest(safeSkillFile(data, join(data, id + '-audit.json'), 4194304));
  if (!value || value.caseId !== id || value.foregroundRunId !== runId || value.auditHash !== auditHash || value.humanReviewed !== true
    || dimensions.some(key => typeof value[key] !== 'boolean')) throw new Error('人工评分归属、审计Hash或维度无效；停止整轮');
  return { review: value, overallPass: dimensions.every(key => value[key]),
    mayContinue: dimensions.filter(key => key !== 'modelSemanticPass').every(key => value[key]) };
}
