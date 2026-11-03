import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { OperationGuard } from './operation-guard.js';

export function workTools(guard: OperationGuard): ToolDefinition[] {
  return [{ name: 'work_manage', label: '管理文字工作', description: '仅承接用户明确交付后台处理或明确持续/分阶段推进的文字工作（一至三项），以及已有文字工作的查询、修改、补充或取消。普通短文、单次写作、解释、翻译和临时改写默认直接Chat回答，不因交付物或字数建工作/主题。无参数；宿主依据当前完整原话及真实记录核对范围和一次许可。',
    parameters: Type.Object({}, { additionalProperties: false }),
    execute: async (_id, _args, signal) => ({ content: [{ type: 'text', text: JSON.stringify(await guard.manageWork(signal)) }], details: {} }) }];
}
