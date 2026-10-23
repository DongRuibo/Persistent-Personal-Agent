import type { GoalActor } from './goal-types.js';
import type { GitHubWatch } from './github-observer.js';

export type GoalSchedule = { kind: 'once'; at: string; timeZone: string }
  | { kind: 'daily' | 'weekly'; time: string; timeZone: string; weekday?: number };
export interface PolicyLimits {
  segmentsPerTrigger: number; dailyExecutions: number; dailyModelCalls: number; totalExecutions: number;
  dailyBudgetCny: number; totalBudgetCny: number;
}
export interface PolicyProposal {
  goalId: string; expectedGoalRevision: number; planRevision: number; expiresAt: string;
  capability: 'text_only'; schedule: GoalSchedule | GitHubWatch; limits: PolicyLimits;
}
export interface GoalPolicy extends PolicyProposal {
  id: string; ownerId: string; accessKey: string; version: number;
  status: 'active' | 'paused' | 'revoked' | 'blocked' | 'expired';
  nextAt: string | null; reason: string | null; createdAt: string; updatedAt: string;
}
export interface ProactiveOptions {
  enabled: boolean; inputRate: number; outputRate: number;
  dailyCalls: number; dailyExecutions: number; dailyBudgetCny: number;
  totalExecutions: number; totalBudgetCny: number;
}
export interface PolicyCommand { actor: GoalActor; sourceRunId: string; text: string }
export interface PolicyAuthorization {
  kind: 'policy'; triggerRunId: string; text: string; grantId: string;
  policyId: string; policyVersion: number; triggerId: string;
  observation?: { id: string; repository: string; branch: string; previous: string; data: unknown };
}
