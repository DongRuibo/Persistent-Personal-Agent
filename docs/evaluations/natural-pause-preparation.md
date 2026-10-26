# P1离线分析与独立自然暂停验收准备

2026-10-26（Asia/Shanghai）。基线`1e20e51145b4f2c422bbb7a918cb52f771f01ade`，独立工作树`C:/Users/Dongr/.codex/worktrees/natural-pause-prep/Persistent Personal Agent`、分支`codex/natural-pause-prep`。**本轮仅离线，准备和测试完成；无真实模型、公网DNS/GET或收费，没有提交、推送、合并或部署。**

交付：[新冻结方案](natural-pause-console-live-plan.md)、[机器证据](natural-pause-preparation.json)。旧[真实报告](independent-console-live-acceptance.md)及JSON、旧P1/P2/P3话术、原库/Session/预算和判定保持不变。R1/R2/S1真实成功保留，不再收费复测；本轮不能宣布自然暂停真实通过。

## P1的证据与归因

只读核对原`P/request-04.json`、`response-04.txt`、原生Console Session、Goal/Execution/Checkpoint及宿主收据。原SQLite使用`mode=ro&immutable=1`读取，不通过产品服务打开或迁移，不续跑旧账本。原数据与证据72份文件的SHA在开始和结束逐一复核。

原真实执行固定SHA是`0d0725c1aeeb9e6a498dca5a5f6b1fdcdcf0d5a0`，`1e20e51`是随后报告发布及本次分析基线。Fixture分别记录这两个身份，输出result不变。

原话完整到达bootstrap：

> 帮我分阶段制定青桐阅读计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行当前片段。先拟定待批准的阅读安排，等我确认后再执行正式步骤。

| 判断 | 原始证据与边界 |
| --- | --- |
| 确认：不是宿主漏传资料 | request-04的goal.objective和input.text均保留完整原话，包含两项虚构资料及先审批要求；Memory无命中、Skills关闭、后台无工具，未见其他资料覆盖输入 |
| 确认：模型把名称解释成阅读对象 | response-04明确要求“青桐相关内容、版本或篇目”“希望覆盖的青桐资料或篇目”，不是仅把青桐当Goal标签 |
| 确认：没有提交可批准草稿 | 模型输出partial、无proposedPlan；宿主如实保存唯一v0 bootstrap Checkpoint，Goal waiting_user/revision2，pendingAction为空。不是提交失败或状态机误拒绝 |
| 确认：主Chat没有在当时伪称草稿已保存 | 原ToolResult为ready/v0、无草稿/Checkpoint；主Chat准确解释等待初始化。其宿主收据也是当时快照。后续partial问题来自后台，不是主Chat代写成果 |
| 推测，不能确认为模型内部根因 | 名称嵌在整句目标、没有单独名称字段，存在被当作主题的语言歧义；bootstrap强调不虚构且提示缺信息应提问，可能使模型偏向询问，但现有证据不能证明某一提示句或权重就是因果原因 |

原Goal=`41aa1e4a-387e-4793-afb0-5018d2b3f57d`，bootstrap Run=`a1bd5677-6e61-4004-89c8-e234a66f8226`。原输出给了三段口头框架，但明确等待补充再正式规划，不能把artifact里的框架当proposedPlan，也不能把旧P1改判通过。

## 哪些信息必要，哪些可以后续确认

- **阅读对象/范围**：如果用户真要求安排未提供的某书/篇目，内容范围可能是必要信息，必须允许询问。但本条原话明确限定只使用已提供的两条虚构资料；没有证据要求新增书籍或“青桐相关内容”。对这些已知材料生成有限初步安排，不以另要篇目为必需。
- **总周期、截止时间、每日时长**：制定固定日历或用户指定时间预算时才可能必需。本条没有要求具体日期、提醒或自动调度，这些细节可以标注“待用户确定”，不应仅因缺少它们认定不能提出任何初步计划。
- **阶段目标与产物偏好**：会影响细化，但当前请求已有先拟初步安排/待审批这一交付目标。可以先保留一个有限的资料梳理方案，把未知验收偏好明确列为待确认；不能替用户编造目标、能力、篇目或期限。

因此本样本存在体验摩擦：用户已要求有限初稿，却被反问额外篇目和多个时间参数。但这不等于每项澄清都错误，更不等于所有资料不足都应强行complete。若核心对象、事实或权限确实缺失，partial并提出必要问题仍是合法且必须保留的路径。

## 产品契约是否需要修改

**本轮不修改产品代码。** 证据不支持一个确定性的宿主缺陷，现有契约已经同时容纳安全初稿与合法澄清：

- [PiExecutor](../../src/pi-executor.ts)的Goal提示已要求“能列初步计划时必须proposedPlan；只有缺少必要信息而无法列计划时才partial并提问”。没有强制要求篇目、周期或时长。
- [结果Schema](../../src/goal-runner.ts)的proposedPlan是可选项；初步计划的instruction/deliverable/doneWhen是有界文本，可明确记录待确认条件，没有要求填日历或虚构资料。
- [GoalStore](../../src/goal-store.ts)仅要求初始化complete必须带proposedPlan，合法partial可以无计划并等待用户；Plan审批、CAS、Step身份和Checkpoint原子提交仍保持。
- complete模拟路径已实际通过Pi与SQLite保存“具体时间待用户另行确定”的条件式草稿，证明宿主能够接受这种安全表示；它不证明真实模型一定会选这条路径。

没有把artifact中的口头框架自动转为正式Plan，没有硬编码青桐/阅读题材的产品路由，也没有强制模型虚构资料或增加收费重试。提示是否需要更明确地区分必要条件与后续偏好，可在更多证据后再讨论；本轮不据单样本修改。

## 新暂停方案与旧计划指标解耦

新scope为`natural-pause-console-v1`，N1/N2/N3只验证真实创建、唯一有效查看、原话暂停。三句输入与旧三句一致，减少话术变化，但判定和账本属于独立新轮：

- N1只在唯一Goal真实持久化、属于当前可信用户/Console、Plan v0、bootstrap已正常committed且waiting_user、无在途/不确定/共同故障时允许继续。complete+草稿与合法partial+无草稿均可；计划结果单独记录为`planGeneration`。
- N2必须成功展示当前唯一完整目标；N3前仍核对revision、可选draftHash、N2的displayRunId、成功投递及5分钟TTL。失败或超期不补答、不刷新。
- N3继续经原Pi、OperationGuard、GoalService和CAS控制。两条正路径都只暂停当前Goal，revision增加1，不改变计划、pending草稿、Execution或Checkpoint，不产生新执行授权；`pauseResult`与计划结果分开。
- 本方案仅覆盖初始化后已静止的waiting_user；不是批准后、执行中或终态暂停验收。新前置通过不代替宿主操作授权，模型错选、错具名/身份/渠道、多目标或过期仍拒绝。

## 文件差异

| 文件 | 必要改动 |
| --- | --- |
| `scripts/natural-pause-console-cases.ts` | 三个新Case ID、新scope、14次/¥2.31/零GET的静态定义；不修改旧Case表 |
| `scripts/natural-pause-console-acceptance.ts` | 只调用共享启动函数的轻量入口；默认无授权参数即拒绝 |
| `scripts/independent-console-budget.ts` | 允许宿主静态传入上述第二份固定定义；共用原预留、费用、锁、pending、fsync、恢复和失败不退款逻辑；默认仍是原PRS定义，不建立新预算引擎 |
| `scripts/independent-console-acceptance.ts` | 复用原main/隔离/Fetch/审计/正常停服；加入自然暂停固定模式和静止Goal前置，独立记录计划/暂停指标，检查查看和暂停不会改写成果或计划。旧CLI默认仍为PRS，旧P1仍要求草稿 |
| `tests/natural-pause-flow.test.ts` | 原版Pi、真实临时SQLite及本机模拟模型的两条完整链；错目标真实Guard拒绝、TTL发送前拒绝及13种前置反例 |
| `tests/natural-pause.test.ts` | 默认拒绝、三句话/额度、新旧scope双向隔离、跨重启、一次消费、容量/次数/费用、未知计费及GET发送前拒绝 |
| `tests/fixtures/natural-pause-bootstrap-partial.json` | 原始模型输出的有Hash来源离线Fixture，不带原授权、DB或Session；只用于新临时数据 |
| 本报告、JSON、冻结方案、STATE | 新交接；旧报告、真实结果、正式配置、产品/Skill/依赖不改 |

## 红绿和实际质量关卡

- **红**：仅在全新临时库用原P1 partial输出Fixture运行旧入口。Goal/Checkpoint正常持久化，旧P1 `statePass=false`、退出1，使“可进入新基本暂停”反例失败。`baseline-red.log`保留。红的是旧入口不适合作为新暂停前置，不是证明旧P1计划生成指标或产品状态机有bug。
- **绿**：N1→N2→N3两条实际Console链，各10次本机模拟HTTP；partial无草稿与complete有草稿均暂停成功，前后Execution/Checkpoint和Plan逐字段不变；没有手插Goal或伪造用户Run。
- 错目标提议由真实Guard拒绝，Goal仍waiting_user；另一个新临时库的N2视图设为过期后，N3在发送前拒绝、HTTP增量0、Case未消费、不刷新。加上该反例，新flow合计37次本机Mock HTTP，均不是收费模型消费。
- 13种新前置反例：TTL过期、未投递、错身份、错渠道、revision变化、多Goal、cancelled、completed、旧displayRunId、draftHash不符、uncertain执行、已有cancel请求、complete草稿与Checkpoint不一致。既有Guard的否定/引用/混合操作、具名交集、CAS、终态和收据测试继续完整回归。
- 专项初轮5/5通过；最终新增GET反例及版本不变断言纳入全量，共新增6项全部通过。Windows typecheck/build/npm test/eval:memory/eval:formation均退出0；**492项：489通过、0失败、3项既有平台跳过**。
- Memory eval为offline-lexical、真实调用0；Formation开发/留出各30/30、API0，输出到新的证据目录，没有覆盖历史报告。没有因为本轮未修改Memory/Formation而跳过原离线核对。最终自检补上complete草稿与Checkpoint一致性反例后，再跑五关均通过；两次全量日志均保留。
- Docker Linux engine命名管道不存在，WSL只有Stopped的docker-desktop；Linux未运行，不安装或启动新环境。Windows三项平台跳过与Linux缺口保留，不能引用旧Linux结果冒充本轮。

## 证据、Hash与工作树

新证据根：`E:/AgentWork/validation/personal-agent-natural-pause-prep-20261026`。保存原始P1只读审计摘要、初次红测/专项/最终五关日志、Linux检查、四份最终Mock轮数据的证据副本、源码清单、可应用patch及`SHA256SUMS.json`。副本仍带原临时根身份，只供取证，不可作为未来真实预算继续执行。

- 原request-04 SHA256：`f7bddc961c8e879371dd7c6e447edcb701f93ba04efa2bd3baae4179e39f32a4`
- 原response-04 SHA256：`4098cbc469b5aefb6b870c221a95c6192e4cd4b9b953863da7a804124216dd97`
- 新冻结方案SHA256：`55a36b74e27032cf4015d5619bd247540dd04d4f88db3dcc5bf6de81e1fe6bca`
- 新入口SHA256：`1a7fbbd1e62e684ee012a8f36825d973b959489d140807a230a4549796768834`
- 原入口算法源码Hash：`44e5bd3d848da961825156c97a3978582e840c4551e09f84ce30587dfd6c7c2f`，与最终Mock轮profile相同。

当前HEAD仍为基线1e20e51，修改仅在新工作树，未暂存/提交/推送/合并。原E盘保存分支HEAD、8项改动及其他工作树保护；旧72份原数据/账本/Session/报告证据SHA不变。没有读取正式.env、正式数据或凭据，所有正式开关保持默认关闭；真实模型、公网DNS/GET、收费、飞书均0。

## 待批准的准确范围与剩余风险

未来仅建议批准新方案N1/N2/N3一次，**最多14次物理模型HTTP、¥2.31保守预留、0公网GET**，Console、全新根及账本、固定DeepSeek-V4.1-Flash/硅基流动兼容端点；不含Web/Skill/Formation/Proactive、反馈继续或取消，不借旧30次/¥5轮余额。执行前重新核价、确认当前账号附加费和安全注入配置，缺失则拒绝联网。

真实模型仍可能不创建Goal、误读名称、选择错误工具/目标，或原始解释不正确；N2→N3可能超TTL。Mock成功没有关闭自然暂停真实门槛，也不证明P1计划生成能力改善。旧P1失败、P2/P3未执行以及R2/S1已有真实成功均原样保留；批准后/执行中暂停、完整生命周期、Web后路由和联合链路仍是后续事项。

本次到此停止，等待代码与证据审查及下一次明确授权，不启动真实复验。
