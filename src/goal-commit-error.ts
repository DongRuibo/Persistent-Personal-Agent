import { GoalPlanQuantityError } from './goal-plan-quantity.js';

// 只呈现宿主定义的业务错误；不把未知异常、路径或原始外部文本作为诊断返回。
const messages = {
  goal_plan_step_identity: '计划 Step ID 跨目标或定义已变化，需新建步骤',
  goal_plan_duplicate_step: '计划步骤重复',
  goal_plan_shape: '计划步骤必须为1至12项',
  goal_skill_unavailable: '用户指定的Skill未批准或不可用',
  goal_skill_ambiguous: '指定了多个Skill，请明确每步选择',
  goal_plan_fields: '模型不能提供Skill路径或可信Hash',
  goal_completed_skill: '已完成Step不能修改Skill绑定',
  goal_skill_selection: '模型Skill提议违反用户明确选择',
  goal_skill_approval: 'Skill未批准、不兼容或需要用户明确指定',
  goal_skill_version: 'Skill已升级，需明确改选并重新批准',
  goal_skill_id: 'Skill ID无效',
  goal_result_text: 'Goal 文本为空或超出容量',
  goal_output_capacity: 'Goal 输出超过容量',
  goal_output_schema: 'Goal 输出不符合结果 Schema',
  goal_output_json: 'Goal 输出不是合法JSON',
  goal_input_budget: 'Goal 输入超过分区预算，请缩小或分段；尚未调用模型',
  goal_snapshot_budget: 'Goal 快照超过总预算',
  goal_skill_changed: 'Skill执行后已禁用或变更，拒绝提交进度',
  goal_result_state: 'Goal 结果状态无效',
  goal_bootstrap_plan_required: 'bootstrap 完成必须提交计划草稿',
  goal_blocked_plan_conflict: '阻塞结果不能同时申请计划批准',
  goal_web_snapshot_invalid: 'Goal Web执行资料缺失、损坏或版本不符，拒绝提交',
} as const;
export type GoalCommitFailureCode = keyof typeof messages | 'goal_plan_quantity';
export class GoalCommitError extends Error {
  constructor(readonly code: keyof typeof messages) { super(messages[code]); }
}
export function safeGoalCommitFailure(error: unknown): { code: GoalCommitFailureCode; message: string } | undefined {
  if (error instanceof GoalCommitError) return { code: error.code, message: `${error.code}：${messages[error.code]}` };
  if (error instanceof GoalPlanQuantityError) return { code: 'goal_plan_quantity', message: error.message };
  return undefined;
}
export function isGoalCommitFailureCode(value: string): boolean { return Object.hasOwn(messages, value) || value === 'goal_plan_quantity'; }
