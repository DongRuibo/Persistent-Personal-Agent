# M3审批状态解释：离线最小修复与v2体验准备

2026-10-26（Asia/Shanghai）。基线`e836cf38d7b6ce99a254e43bd349a47304db8183`，当前独立工作树/分支`codex/manual-goal-console-prep`；本轮未提交、推送或合并Git。只完成离线修复与新方案，不启动真实模型、收费、公网DNS/GET、飞书或正式数据操作，不读取正式.env。

## 事实与根因边界

原始材料只读核对：`E:/AgentWork/acceptance/manual-goal-console-20261026`及对应validation目录的request-08/09、response-08/09、M1 bootstrap响应、ToolResult、Console、SQLite和Session。原报告、结束账本、响应及Hash未改变，也未在原库上实例化新Store、迁移或重放。

已确认：M3输入为“确认”；Goal waiting_user、readyInputJson=null、Plan v1已批准；当前正式Step pending，但没有该Step的Execution、排队授权或后台领取。唯一Checkpoint属于Plan v0 bootstrap。模型response-09却称“正式步骤还在排队等待执行”，让用户等待后台领取。真实宿主最终输出、前台delivery_succeeded和随后持久Session收据均正确。原M3失败、M4～M9未执行不改判。

旧renderGoalState没有提供错误状态，但“当前Step pending、执行未领取”本身不能明确区分未获继续授权与已获授权待领取。现有系统提示已区分ready/running/committed，无需重写Prompt；在同一权威状态渲染处直接补齐“审批不等于排队”的说明更小、更明确。

特别核对M1 bootstrap的“批准后我将执行第一步”：它存在于后台成果/Console，但原始M3主Chat的request-08和request-09均不包含这句话或完整bootstrap正文。不能把它写成直接上下文注入的已证实根因。M2主Chat自己的“确认后才会进入正式执行阶段”确实保留为assistant历史；它与pending标签是否共同影响M3只是合理假设，单轮不能证明因果。逐消息匹配与原请求Hash在m3-request-context-analysis.json。

## 最小实现

唯一产品源码变更是`src/goal-runner.ts`的renderGoalState增加3行：正式Plan、waiting_user、没有readyInput、当前Step仍pending且尚无该Plan/Step的Execution时，显示：

> 正式计划已批准，但当前Step尚未排队或执行。必须由用户再次明确要求继续，宿主授权后才可领取正式片段。

限定pending且无对应执行记录，避免在已提交正式partial、等待反馈时误称Step从未执行。真正ready的原“已排队，等待领取”分支保持；running、历史bootstrap、committed与投递状态不改。OperationGuard原本就从同一GoalView生成ToolResult、用户权威输出和Session收据，因此无需复制三处说明或新建持久状态。没有自动继续、隐式授权、模型纠错请求、SDK/Loop或工具改动。

验收准备变更独立于产品授权：

| 文件 | 必要性 |
| --- | --- |
| scripts/manual-goal-console-review.ts | 新v2静态scope，读取人工五维评分及Case/Run/auditHash，分别计算综合通过与可继续 |
| scripts/manual-goal-console-v2-acceptance.ts | 薄启动器，复用原startIndependent |
| scripts/independent-console-budget.ts | 仅增加scope字面值，不改预留算法、限额或旧规则 |
| scripts/independent-console-acceptance.ts | 新模式读取前一Case评分，核对实际前台投递；不合格停止，原v1/P/R/S/N规则保留 |
| tests/fixtures/manual-m3-approved-not-queued.json | 从真实M3及bootstrap提取的虚构资料Fixture，原始UUID仅在模型回复中显式脱敏，保存原来源Hash |
| tests/m3-state.test.ts | 原版Pi/临时SQLite回放短确认、同源收据、错误原文保留、重启不执行及ready/running/partial对照 |
| tests/manual-goal-review.test.ts | 五维评分组合、Case/Run/Hash/类型、默认拒绝及旧scope隔离 |
| tests/manual-goal-console-flow.test.ts | 复用原本机模型/真实Console流程，新增v2带语义失败继续和硬停止两种场景；不改原v1期望 |
| docs/evaluations/manual-goal-console-v2-live-plan.md | 新版本冻结方案；原九条消息/逐条上限原样复用，旧文件不编辑 |
| docs/STATE.md、本文及JSON | 当前交接与实际验证结果 |

## 红绿及最终离线结果

证据目录`E:/AgentWork/validation/personal-agent-m3-state-offline-20261026`。所有Mock仅本机HTTP和新临时库，不调用真实模型，不以Mock选择率或理解模拟代表真实质量。

- **红**：原产品代码上新增2项M3测试，1通过/1失败；失败精确为“旧版本没有明确区分已批准和已排队”。原日志m3-red.log及基线源码Hash保留。
- **绿**：同一反例添加通用说明后通过；额外核对旧R2/A2异步收据与自然暂停机制通过。原始错误assistant回复仍进入Session，随后正确宿主收据同源追加，用户权威结果不含错误排队声明。查看加短确认仅5次本机Mock请求，不追加纠错或Goal调用。
- ready对照保留合法“批准并继续一段”的授权及排队说明，领取后running、提交partial、投递前unconfirmed/投递后succeeded不混淆；已有partial不显示“Step尚未执行”。旧A2矩阵覆盖complete及失败/中断。
- 新v2完整Mock流程：9条/29次本机模型HTTP，最终Goal completed、3次独立Execution/Checkpoint；M3原始解释故意使用真实错误形态、评分modelSemanticPass=false，其他四维通过且人工审阅后允许M4继续。M4模型请求仍包含原错误及正确收据，评分未被改绿，不复制后台Session，不额外请求纠正模型。
- 另一个全新Mock根在M3后给userVisibleResultPass=false：M4在接收stdin/联网前拒绝，仍9次模型请求、1个bootstrap Execution、原Session及业务状态不变；账本持久halt=manual_review_failed，不可改评分或重置后续跑。缺少评分时也不发送下一条。
- 五维单测逐一拒绝宿主、用户可见、持久化、安全失败；错误Case/Run/Hash、非法类型、未人工审阅拒绝。新v2不能打开旧v1 scope。旧v1完整流程及原故障反例保留。

| 最终命令 | 实际结果 |
| --- | --- |
| npm run typecheck | 退出0，源代码与测试均通过 |
| npm run build | 退出0；原Node24.19.0和现有依赖，无安装 |
| npm test | 503项，500通过/0失败/3既有平台跳过，约108.00秒 |
| npm run eval:memory | 退出0；64题离线词法，三集Top1/Recall@5仍9/12、17/19、17/18；无答案误supported0/15，真实调用0 |
| npm run eval:formation | 退出0；开发/留出各30/30、未批准写入0、真实调用0；输出新证据文件 |

3项Windows跳过仍为POSIX权限位、无权限创建符号链接、POSIX信号退出；不是新增功能跳过。Docker客户端存在但Linux引擎管道不可用，WSL仅Stopped docker-desktop，没有现成Mac；未安装/启动环境，本轮Linux/Mac未跑。既有R2/N3及Task/Memory/Skills/调度回归在本轮全量实际运行，仍不等于新的真实模型验收。

## 新轮的评分、继续和停止

新scope=manual-goal-console-v2；九条原话、预计29/最多40次HTTP、¥6.60保守预留、零文档GET和5分钟视图TTL保持。未来必须重新核价、单独批准固定审查版本，并使用全新数据/Session/预算；不能复用原剩余31次请求或复制旧真实前置。本次不消费。

每条分别评分modelSemanticPass、hostAuthorizationPass、userVisibleResultPass、persistencePass、safetyPass。五项都true才是综合通过；机械statePass及真实前台投递通过、后四项true且人工审阅后，才可在保留modelSemanticPass=false的情况下继续观察。仅允许主Chat原始状态解释/措辞缺陷，非预期工具、非法计划、错成果/引用、用户可见错误不属于可继续条件。

固定位置的人工review.json须绑定前一Case、前台Run和audit原始Hash。缺失评分不接收下一条；损坏/错归属评分、审计不一致或后四维失败会持久停止整轮。审核文件不是产品授权，M4/M7仍须本条明确继续消息；评分不能批准Plan、提高预算、改工具或生成Execution。最终报告保留各维度失败、综合失败与生命周期机械完成的区别，不把“允许继续”写成“全部通过”。

## Hash、保全与剩余风险

- 当前执行代码Hash：`6730f140c468b9b4e4a0a13208d6aba7ad796d2c6dcb77af4d45a51127a68c16`。v2方案Hash：`4121217f6bea9f47867a4d711913a74c9befee9c7d2e4548ebd2cd561f5d6722`。最终Mock账本逐一匹配代码Hash；逐文件源码/Fixture与日志Hash、完整review.patch及只读Mock副本保存在新证据目录。
- [机器摘要](m3-state-offline-fix.json)及新[冻结说明](manual-goal-console-v2-live-plan.md)。原真实SQLite/Session/账本、旧方案/报告和历史数据共489份受保护文件Hash未变；8个其他工作树的HEAD/分支/status及原脏文件Hash未变，原main3项与E盘8项保留。
- 本轮只在当前独立工作树留下未提交改动，HEAD仍e836cf3；本地main及origin/main引用未改，不联网推送或合并。正式默认开关不变，产品未开放任何新能力。
- 本修复证明权威状态说明更明确，不证明真实模型一定服从。错误原文仍保留在Session；后续模型能否正确使用历史纠正、真实完整生命周期及人工评分可靠性仍需新轮观察。执行中暂停/取消竞态和Skill/Web/Goal联合不在本轮。
- 保留历史M1/M2真实通过、M3失败/M4～M9未执行，以及R2/S1/N3限定成功与P1/N1缺口。准备完成后停止，等待独立审查与新的执行授权，不自行真实复测或修复其他问题。
