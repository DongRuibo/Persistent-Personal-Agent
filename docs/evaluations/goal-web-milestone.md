# Goal、Skill 与 Web 快照工程里程碑

基线：5285975a3354f778012999526ed587b7e1b5c573。审查分支：feature/goal-web-snapshots。当前为分阶段记录，未做任何新收费模型、真实网站、飞书或手机验收；原始真实失败报告保持不变。

## 阶段 A：真实失败的离线修复

- 原始依据：v3.0.1-live-retest.json 的 B 解析结果和 rawMainReplies。独立测试重建银杏阅读计划及唯一有效视图，原话“暂停那个学习计划”在修复前仍 waiting_user；收据测试也证明原工具只给数量，没有真实状态文本。两项失败保留在 a-before.log。
- 泛称修复只针对有界独立指代句：类别后缀可与名称不同，用户具名部分仍与唯一有效视图取交集。身份/渠道、成功投递、TTL、revision、草稿Hash、多目标、否定、混合动作检查保留。
- Goal 工具提供真实控制状态，用户最终回答继续由宿主呈现。原版 Pi sendCustomMessage(triggerTurn:false) 追加宿主状态收据，保留错误模型原文，重启后仍可见；不增加纠错模型调用、不修改 Pi Loop。
- 首次全量发现完整 render 内容会把后台成果带入 Session，已收窄为状态/版本/控制收据；原隔离测试不改预期。首次全量另有一项 Memory 工具错误，原日志未捕获内部原因；原专项及随后全量通过，未修改 Memory 实现，不武断归因。
- Windows Node24.19：typecheck、build、test、eval:memory、eval:formation 全部退出0；397项，394通过、0失败、3原平台跳过。a-test.log 等原失败和 a-*-02.log 最终日志位于 E:/AgentWork/validation/personal-agent-goal-web-20261023-195458。
- 这只证明离线机制修复；历史真实暂停/收据失败仍开放，须独立真实复验。

## 后续阶段

B：成功快照引用与 Plan 审批/Execution 冻结；C：跨模块端到端及双平台最终回归；D：统一 Console 验收入口和冻结方案。完成后补充实际结果，不以计划代替证据。
