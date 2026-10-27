# T3 自然文件确认离线修复（2026-10-27）

基线 `9f8723cb0f0c538844ec3ab5449e65401f202fc8`，分支 `codex/t3-natural-file-confirm`，独立工作树 `C:/Users/Dongr/.codex/worktrees/t3-natural-file-confirm/Persistent Personal Agent`。离线修复阶段只修确认交互，未提交、推送、读取正式.env、收费调用或切换Console/飞书。用户随后仅授权发布本轮9份文件至独立审查分支，交接见STATE；不合并main、不自动启动或切换实例。

## 原因与修复

原版本只把“确认文件操作 ID Hash”路由到宿主，其余回复进入普通Chat。用户说“确认允许”后，即使模型理解，也无法提交。这是宿主确认入口问题，不需要模型代用户批准，也不需要放宽文件工具。

- `src/operation-guard.ts`：将宿主提议的ID/Hash保存到既有DialogueReferences.fileView；明确短句仅关联紧接着的宿主文件预览。在模型执行前处理“确认允许”“确认保存”“确认”“确认创建/修改”“同意保存”“就这样保存”“按这个保存/修改”及句末标点。自然确认成功时不请求主模型，用户原话Hash与确认Run仍进入原操作账本，事件标记natural/command。
- `src/file-operation-store.ts`：继续原consume事务、成功完整投递、身份/渠道/根、内容Hash、5分钟TTL及pending一次消费检查。自然确认增加操作类型与同范围其他有效提议检查；多项不自动选最近一项。预览告诉用户可以直接回复“确认允许”，精确命令仍兼容。没有新表或迁移，没有更改FS提交算法。
- `src/pi-executor.ts`：通用说明改为宿主绑定自然确认，不再要求用户填写内部ID/Hash；模型仍没有确认工具，Skill、Memory和文件正文不能授权。
- 新增真实Pi SDK + 临时SQLite + 本机模拟模型测试，更新README、PROJECT、STATE和现有试用说明。其余Task/Memory/Goal、工具白名单、Skill包及默认关闭开关不改。

短确认焦点保存在宿主Session引用中，不从模型回答或旧聊天恢复。普通Chat新请求会结束焦点；重启不结束仍有效的焦点，也不延长TTL。引用、假设、否定、混合修改、错误具名及泛泛“好的”不批准。其他审批视图冲突或多项有效文件提议造成歧义时结束短确认引用，不能靠重复短句、其他提议过期或重启自动变成批准。

## 红绿和实际检查

| 检查 | 实际结果 |
| --- | --- |
| 初次反例对旧产品代码 | 11项：2通过、9失败；覆盖自然确认未进入宿主等旧缺陷 |
| 开发自检新增反例 | 1项失败：歧义拒绝后重复短句仍可能选择文件；已修复并保留红日志 |
| 最终文件专项 | 23/23，含最终新增12项（7组及5子项）和既有11项 |
| npm run typecheck / build | 最终均退出0 |
| npm test | 540项：537通过、0失败、3既有平台跳过 |
| npm run eval:memory | 退出0，Recall@5/ContextHit仍0.75，真实模型调用0 |
| npm run eval:formation | 退出0，development/holdout各30/30，真实模型调用0 |

专项验证：自然创建与编辑、确认零模型请求、原话Hash、重复确认和重启不重放；未投递、部分预览、失败源Run、过期、编辑前文件变化；跨身份/渠道/输出根及其他审批视图；多项歧义、语义不符、失效引用和老精确命令兼容。原模型模拟响应不决定是否批准，宿主只处理当前用户原话。

首次typecheck发现测试中的虚构飞书目标缺少必需chatId，已补齐；原失败日志保留。自检发现现有Guard会清理另一审批清单，故仅拒绝本轮歧义还不够；已同时结束文件短引用，并增加“重复同句”和“其他提议过期后重启”的反例。修改后重新完成专项、typecheck/build、全量及两个eval，初次通过日志没有覆盖最终结果。

Windows Node v24.19.0、Pi 1.3.0。Linux Docker引擎仍不可用，没有安装或启动环境。3个既有跳过为POSIX权限位、当前账户缺少文件符号链接创建权限及POSIX优雅SIGTERM恢复；不声称Linux/Mac通过。Formation脚本生成的旧报告副本另存本轮证据目录，新树中的该文件已还原，不改历史结果。

## 证据、保全与限制

机器证据：`E:/AgentWork/validation/t3-natural-file-confirm-20261027/validation.json`。同目录保存原始red-tests.log、review-red.log、green-targeted.log、最终typecheck/build/tests及两个eval、首次类型失败和中间通过日志、平台检查及preservation-before.json。

三份产品文件与新增测试的逐文件SHA-256见机器证据。键排序紧凑JSON映射的SHA-256为 `65e91cfb06c2149464045f03c32f14dfb256192d72c995e8ddaa3ee50f0a55df`。最终交付文件Hash另见SHA256SUMS.txt。

原9f工作树保持干净，其49个dist文件、现有summary.md、Skill及批准清单、旧启动脚本、原E盘STATE和飞书启动器，共56项Hash复核不变；本轮不重放原试用库、不删除Session或锁、不修改历史报告。未修改Pi或node_modules，未新增Harness。

尚未在实际Console/飞书切换本版本。现用启动脚本仍固定9f；审查后另行切换修复版，才能用自然确认。旧版尚未处理的提议不自动获得新短确认引用，原精确命令仍按原TTL校验。

当前支持有界明确短句，不宣称理解任意复杂确认、多目标自然选择或自然取消；多个有效提议须先明确对象，可用保留的精确命令处理。插入其他普通Chat后需要新的完整预览，不能从旧模型文字继续授权。文件系统与SQLite仍不构成共同事务，未知提交仍阻塞且不重放。原P1/N1、M5/M8等失败和R2/S1/N3限定成功均保持原结论，不把本轮离线验证当成新增真实模型验收。
