import type { MessageTarget, Run } from './contracts.js';
import type { PolicyAuthorization } from './goal-policy-types.js';
import type { SkillSnapshot } from './skill-service.js';
import type { FrozenWebInput, WebSnapshotBinding } from './web-read-types.js';

export type GoalStatus = 'ready' | 'running' | 'waiting_user' | 'paused' | 'blocked' | 'completed' | 'cancelled';
export type GoalStepStatus = 'pending' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'blocked' | 'superseded';
export type GoalExecutionStatus = 'running' | 'committed' | 'failed' | 'interrupted' | 'discarded' | 'uncertain';
export type StepOutcome = 'partial' | 'complete' | 'blocked';

// 只供宿主调用；来源 Run 存在不等于用户授权。自然语言验证留给后续 Service/Guard。
export interface GoalActor { ownerId: string; target: MessageTarget }
export interface GoalCommand {
  actor: GoalActor;
  sourceRunId: string;
  expectedRevision: number;
  text: string;
}
export interface GoalStepSpec {
  stepId: string;
  title: string;
  instruction: string;
  deliverable: string;
  doneWhen: string;
}
export type GoalStepProposal = Omit<GoalStepSpec, 'stepId'> & { stepId?: string; skillId?: string | null };
export interface SkillBinding { stepId: string; skillId: string; packageHash: string; version: string }
export interface GoalPlanSpec { objectiveHash: string; steps: GoalStepSpec[]; skillBindings?: SkillBinding[]; webBindings?: WebSnapshotBinding[] }
export interface GoalPlan {
  goalId: string; revision: number; baseRevision: number | null;
  sourceRunId: string; approvedByRunId: string | null;
  spec: GoalPlanSpec; changeReason: string; hash: string; createdAt: string;
}
export interface GoalPlanDraft {
  baseRevision: number; revision: number; spec: GoalPlanSpec;
  sourceRunId: string; changeReason: string; hash: string;
}
export type GoalReadyInput = { triggerRunId: string; text: string; kind: 'create' | 'continue' | 'regenerate' | 'approve' } | PolicyAuthorization;
export interface Goal {
  id: string; ownerId: string; accessKey: string; target: MessageTarget; objective: string;
  createdByRunId: string; status: GoalStatus; revision: number; planRevision: number;
  currentStepId: string | null; checkpointRunId: string | null;
  readyInput: GoalReadyInput | null; pendingAction: GoalPlanDraft | null;
  controlRequested: 'pause' | 'cancel' | null; blockedReason: string | null;
  createdAt: string; updatedAt: string; finishedAt: string | null;
}
export interface GoalStep {
  id: string; goalId: string; status: GoalStepStatus;
  lastExecutionRunId: string | null; createdAt: string; updatedAt: string;
}
export interface GoalExecutionInput {
  goalId: string; objective: string; planRevision: number; step: GoalStepSpec;
  authorization: GoalReadyInput; previousCheckpoint: GoalCheckpoint | null;
  skill?: SkillSnapshot;
  web?: FrozenWebInput;
}
export interface GoalCheckpoint {
  schemaVersion: 1; goalId: string; planRevision: number; stepId: string; executionRunId: string;
  previousCheckpointRunId: string | null; inputSourceRunId: string;
  stepOutcome: StepOutcome; artifactText: string; progressSummary: string; question: string;
  blockedReason: string | null; proposedPlan: GoalPlanDraft | null;
  needsUserFeedback?: boolean;
}
export interface GoalExecution {
  runId: string; goalId: string; stepId: string; planRevision: number; sequence: number;
  triggerRunId: string; baseGoalRevision: number; baseCheckpointRunId: string | null;
  capabilityClass: 'text_only'; status: GoalExecutionStatus;
  input: GoalExecutionInput; inputHash: string;
  checkpoint: GoalCheckpoint | null; checkpointHash: string | null; reasonCode: string | null;
}
export interface GoalResult {
  stepOutcome: StepOutcome; artifactText: string; progressSummary: string; question: string;
  blockedReason?: string;
  needsUserFeedback?: boolean;
  proposedPlan?: { steps: GoalStepProposal[]; changeReason: string };
}
export interface GoalControlReceipt {
  goalId: string; action: 'create' | 'continue' | 'approve_plan' | 'revise_plan' | 'pause' | 'cancel' | 'complete';
  revision: number; sourceRunId: string;
}
export interface GoalView {
  goal: Goal; plan: GoalPlan; steps: GoalStep[]; checkpoint: GoalCheckpoint | null;
  executions: { execution: GoalExecution; run: Run; delivery?: 'succeeded' | 'failed' | 'unconfirmed' }[];
}
