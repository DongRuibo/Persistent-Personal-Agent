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

## 阶段 D：统一真实验收准备与自审

- 统一Console入口及4项离线测试覆盖32物理请求/6元/65536字节/4096输出上限、发送前fsync预留、失败不退额、跨重启/独占锁、账本/费率/源码/模型篡改、写入失败零发送；真实Pi的主请求、隔离解析和工具后请求实际共用一份账本。
- [统一冻结方案](integrated-console-live-plan.md)预计28请求、上限32/6元及一次固定公开Web GET。仅以历史2/8费率演算，不声称当前价格已核实；未来执行需24小时内人工确认费率和单独批准，入口本轮默认拒绝运行，无收费或真实网站访问。
- 自审增加两个先红后绿的反例：解析器漏掉具名目标时，绑定不得落到当前唯一视图（review-target-before.log）；新步骤未继承旧Web绑定时，审批界面必须明确显示“无Web资料绑定”（review-binding-display-before.log）。宿主现独立校验当前原话中的确切资源名和目标名，混合/未知绑定句澄清；原Step资料不冒充新Step输入。
- Windows首轮最终426项423通过/3原跳过，首轮Linux426全过且144份源码/SDK匹配；原始证据保留windows-initial/linux-initial。补充审批展示反例后最终Windows427项424通过/0失败/3原平台跳过，五关全0；最终Linux427全部通过/0跳过，五关全0；144份源码/SDK在两平台测试前后均复核一致，清单SHA256为71e827e075ef4528eb617e3c14147d1b9c0fe93c2f100f58eb500994552c42a4。Linux容器全程network=none、无宿主挂载，2CPU/3GiB，测试后已停止。
- D首轮类型检查发现新增测试误写fixture.web属性，修为fixture.requests，原日志d-typecheck-01.log保留。Linux首次直接提取依赖到Windows因符号链接权限失败，未修改代码/测试，改为复用既有Linux依赖tar并在断网容器内提取；setup-failure.log保留，未新安装/联网。

## 核心文件与调用链

| 文件 | 目的 |
| --- | --- |
| operation-guard.ts / goal-tools.ts（工具本身沿用） | 唯一有效视图、类别/具名交集、当前资料/Goal/步骤/范围绑定及一次操作控制 |
| pi-executor.ts | 原版Loop/Skill展开，宿主控制状态ToolResult与原生持久收据；无额外纠错请求 |
| web-read-types.ts / web-read-store.ts | 可选资料DTO、来源身份/投递/Hash/容量校验、只读选择与冻结；复用原表 |
| goal-types.ts / goal-store.ts / goal-service.ts / sqlite-store.ts | Plan JSON绑定/审批/CAS、Execution inputHash、提交前复核和兼容连接，无新DDL |
| goal-runner.ts | 资料/无资料展示、领取前阻塞、低信任冻结投影，保留原Grant/预算/Checkpoint/通知 |
| goal-control/receipt-context/web/web-reliability测试及helpers | 原始失败重建、完整用户场景、跨模块确认与真实子进程故障 |
| integrated-console-acceptance.ts及测试 | 专用验收入口、原子预算与冻结身份，不是通用评测平台 |
| README / PROJECT / STATE / 两份设计及新报告 | 使用、架构、可恢复状态、边界与原始失败；历史验收报告不修改 |

用户当前明确读取 → Pi原生web_get → Guard一次许可 → web_read_calls完整快照 → 原生read加载agent-notes并整理 → 用户独立指定资料/Goal/Step/范围 → 宿主只读选择来源 → Plan草稿显示URL/时间/Hash/节选 → 有效完整展示后批准 → Skill和Web绑定纳入Plan Hash → 原授权/Policy Grant领取并冻结Execution输入 → Pi独立/skill展开、零工具/单请求 → 来源/控制版本复核 → 原Checkpoint事务 → 原通知/Outbox → 重启等待用户，无重取或已提交片段重放。

## 局限与下一步

- 仍是单用户、单进程架构；源身份映射沿用main的Console或飞书应用/白名单chatKey及完整目标，非多租户隔离。自然语言绑定只覆盖已记录的独立句式，不承诺开放语义理解；未知形式澄清。
- 资料按固定源及Hash冻结，不自动刷新。即使Web网络关闭也可读取已批准合法快照；禁用目录、损坏或缺失不降级。源Chat失败/未成功投递不作为可绑定资料，不能因恢复重取。
- 4KiB选中资料、原Goal总容量、Skill包容量及32KiB实际Goal请求共同约束；组合超限可能在领取后保守失败/保留预算预留，但尚未调用模型。不会自动删约束、裁剪资料或返还未知执行预算。
- 状态收据帮助模型核对，不能保证真实模型永远正确解释；最终用户呈现由宿主控制，后台成果和临时Memory不追加交互Session。V3.0.1两项原始真实失败继续开放，本轮离线成功不是新真实通过。
- 原网络边界、协作式取消的底层DNS延迟、有限通知重投/可能重复或丢失、同OS账户恶意进程、Windows ACL、原生Mac及长期运行限制保留。没有真实模型、正式网站、飞书/手机或正式主动策略验收。
- 工程审查后下一步只建议按统一方案另行批准Console真实体验；不提前合并main、部署或扩展S2/Sandbox/Computer Use。所有正式开关保持false。
