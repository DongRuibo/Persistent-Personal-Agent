# Goal、Skill 与 Web 快照工程里程碑

基线：5285975a3354f778012999526ed587b7e1b5c573。审查分支：feature/goal-web-snapshots。当前为分阶段记录，未做任何新收费模型、真实网站、飞书或手机验收；原始真实失败报告保持不变。

## 阶段 A：真实失败的离线修复

- 原始依据：v3.0.1-live-retest.json 的 B 解析结果和 rawMainReplies。独立测试重建银杏阅读计划及唯一有效视图，原话“暂停那个学习计划”在修复前仍 waiting_user；收据测试也证明原工具只给数量，没有真实状态文本。两项失败保留在 a-before.log。
- 泛称修复只针对有界独立指代句：类别后缀可与名称不同，用户具名部分仍与唯一有效视图取交集。身份/渠道、成功投递、TTL、revision、草稿Hash、多目标、否定、混合动作检查保留。
- Goal 工具提供真实控制状态，用户最终回答继续由宿主呈现。原版 Pi sendCustomMessage(triggerTurn:false) 追加宿主状态收据，保留错误模型原文，重启后仍可见；不增加纠错模型调用、不修改 Pi Loop。
- 首次全量发现完整 render 内容会把后台成果带入 Session，已收窄为状态/版本/控制收据；原隔离测试不改预期。首次全量另有一项 Memory 工具错误，原日志未捕获内部原因；原专项及随后全量通过，未修改 Memory 实现，不武断归因。
- Windows Node24.19：typecheck、build、test、eval:memory、eval:formation 全部退出0；397项，394通过、0失败、3原平台跳过。a-test.log 等原失败和 a-*-02.log 最终日志位于 E:/AgentWork/validation/personal-agent-goal-web-20261023-195458。
- 这只证明离线机制修复；历史真实暂停/收据失败仍开放，须独立真实复验。

## 阶段 B：快照绑定与执行

- WebReadStore复用原表，只读验证成功Run/投递、owner和完整渠道、资源URL/版本/目录Hash、正文Hash/字节。Plan JSON增加webBindings；旧计划省略字段仍兼容，无新增表或缓存。
- GoalService/Guard只接受当前明确资料标题、Goal、步骤及全文或行范围；模型没有来源ID/Hash参数。资料变更生成新草稿，保留Skill绑定，展示来源时间/Hash/范围后走原审批。已完成步骤不可改写。
- 领取时冻结选中文本并进入Execution inputHash；Goal投影包含低信任标记，零工具/单模型请求。来源损坏时先阻塞未领取Goal，不消费模型或重新联网；执行后再校验，旧Checkpoint不覆盖。
- 新增9项真实Pi/SQLite/本机HTTP测试，包含完整闭环、全文超限拒绝、明确节选、多份来源澄清、跨渠道/Hash/版本/丢失、已完成Step与旧Plan保持不变。首轮两项失败为SQLite无原型对象与structuredClone比较的测试表示差异，改为原数据/JSON字节比对；后续模拟路由误把绑定中的“读取”当新Web请求，以及一个反例先命中Step ID校验，均修正测试编排，业务预期不变；原日志保留。
- Windows五关全部退出0；406项，403通过、0失败、3原平台跳过。最终日志b-*-final.log；未付费或访问真实网站。

## 阶段 C：统一场景与故障恢复

- 技术资料整理在真实Pi中自动提议agent-notes、受限read、当前用户授权Web获取；三次模型HTTP中同时看到Skill方法和低信任资料，未写Task/Memory/Goal。普通模型语义质量仍需真实验收。
- 已批准两步Skill+资料的主动Goal通过原Policy/Trigger/Grant执行；用户反馈、预算上限停止后续执行；暂停/撤销的迟到结果不提交Checkpoint，重启后无新授权。通知失败只有限重投消息，不重跑模型。
- 快照运行中损坏、SQLite提交触发器失败、Skill文件版本变化、网络失败后企图绑定、旧审批视图及跨模块确认均覆盖。真实子进程在已领取并冻结资料、实际Pi模型等待时被SIGKILL，恢复interrupted/blocked，不重放Web或模型。
- 新场景16项定点通过；首轮新增Web失败场景误用旧fixture的已关闭数据库，已修正为完整Runner/Executor/Store一起重启，原c-test-02.log保留；不是产品恢复故障。
- Windows五关全部退出0；421项，418通过、0失败、3原平台跳过。最终日志c-*-final.log。双平台最终回归将在D入口离线测试后统一完成，不把此前Linux结果冒充本轮。

## 后续阶段

D：统一Console验收入口、冻结方案及双平台最终关卡；仍没有收费或真实网站授权。
