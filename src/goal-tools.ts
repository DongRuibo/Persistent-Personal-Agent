import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { OperationGuard } from './operation-guard.js';
import type { GoalService } from './goal-service.js';

export function goalTools(goals: GoalService, guard: OperationGuard): ToolDefinition[] {
  return [{ name: 'goal_manage', label: '长期目标', description: '创建、查看或控制可多次继续的长期目标。无参数，宿主仅依据当前原话、真实存储和有效清单决定操作；不能指定ID、权限或状态。',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _args, signal) => ({ content: [{ type: 'text', text: JSON.stringify(await guard.manageGoals(goals, signal)) }], details: {} }) }];
}
