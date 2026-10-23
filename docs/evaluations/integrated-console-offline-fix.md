# 综合Console真实失败后的离线定点修复

日期：2026-10-24（Asia/Shanghai）。产品基线：`c604565ca507ad9fe14e1cadf945918d14a92668`。本轮仅离线开发及审查，不是第二轮真实验收。

**结论：定点修复及Windows离线质量关卡通过，等待独立代码审查。** 467项测试：464通过、0失败、3项既有平台跳过；typecheck、build、eval:memory、eval:formation退出均0。Docker daemon不可用，WSL仅有Stopped的docker-desktop，本次Linux未运行，不能沿用历史Linux绿灯。真实模型HTTP、公网DNS/GET、收费评测、飞书、部署、Git推送/合并均0；没有读取正式.env或正式数据。

## 原始失败与因果核对

原始[真实报告](integrated-console-live-acceptance.md)、[JSON](integrated-console-live-acceptance.json)和[冻结方案](integrated-console-live-plan.md)逐字保留。真实结果仍是B0通过、W1/G1失败、后续7项未执行；模型8请求、¥0.409924保守预留、Web预留1且成功0。历史GET实际发送数依旧无法确认，范围0～1；本轮新增诊断不能倒推历史阶段。

- G1的response08提供`stepId=bc37acd1-07e9-41b4-a84d-17e014fbd6fa`，恰好是bootstrap步骤；原title为“梳理目标与初步计划”，模型改为“银杏阅读出题与点评”，instruction/deliverable/doneWhen也改变。它是可解析的1步JSON，Skill ID合法，partial和等待反馈合法。基线代码在全新库直接回放原结果，堆栈定位`GoalStore.draft`第316行的身份检查；事务回滚，未产生Checkpoint。只删除新Step的ID的历史离线反事实能够提交，说明本例提交异常的直接原因是身份；不代表整条G1体验没有其他问题。
- W1实际请求02/03均包含两个批准Skill目录及read/web_get，agent-notes描述是“整理用户已经提供的 Agent 技术资料、概念和实现证据，不自行访问外部来源”。模型先提议web_get；工具返回TimeoutError，下一真实模型轮次选择如实说明失败。没有agent-notes的read提议或宿主拒绝读取事件。模型在取数前、失败后都能看见目录；失败使其缺少整理正文，但不是剥夺全部选择机会。未发现足以确认需要修改Skill描述/权限的宿主缺陷，故包和路由不改；真实自动选择能力仍未通过。
- G1主模型口头描述“待批准计划/v0”，实际创建收据当时为ready、pendingAction=false；后台后来blocked。现有宿主覆盖及原生Session权威收据已阻止口述冒充持久计划。本轮补充明确状态和阻塞原因，并停止原执行失败分支对未知异常的无条件回显，并测试后续查看及重启；不能据此宣称真实模型已经理解正确。

## 最小修复与安全边界

| 文件 | 改动与目的 |
| --- | --- |
| `src/goal-runner.ts` | 首次create投影不暴露bootstrap Step ID，提示中的首次Schema不允许stepId；持久Execution仍保留原身份/inputHash。已知提交/Schema/容量错误以安全代码结束，未知提交异常仍是checkpoint_commit_failed，未知执行异常为goal_execution_failed；继续先重读已提交状态，不补请求、不补交。显示占位计划/待批准草稿/批准正式计划/Checkpoint的真实区别 |
| `src/goal-store.ts` | 正式新Step由宿主生成ID。只在sequence=1、Plan v0、create授权、无旧Checkpoint、唯一bootstrap的commit内，兼容对本Goal当前bootstrap的引用；分配新ID并同事务记录goal_initial_step_identity_assigned及first_create_bootstrap_reference依据。其他ID、跨Goal、重复ID、后续片段/修订继续拒绝。原Plan、已完成Step、审批/CAS和Checkpoint聚合事务不变 |
| `src/goal-commit-error.ts` | 固定业务错误类型、代码与中文说明白名单，不无条件回显异常；身份、重复、数量、Skill、结果状态/文本、快照等可核对原因进入Run.error、Execution.reasonCode与Goal.blockedReason |
| `src/operation-guard.ts`、`src/pi-executor.ts` | 复用原ToolResult和host-goal-result-v1，补充计划状态、Checkpoint有无与阻塞原因；提醒模型不能把pendingAction=false或v0称为已保存可审批计划。没有第二次纠错模型调用，没有新控制权限 |
| `src/web-read-service.ts`、`src/web-read-store.ts`、`src/web-read-types.ts` | 复用Run Events保存有限阶段：DNS开始/通过、建连、TCP、TLS/IP校验、请求创建、本地finish、响应头/首正文/完整响应、超时/中断/失败。每阶段最多一次，结束后的迟到事件不追加；审计写失败即中止。只保存固定阶段和call ID，不存IP、原始异常或正文。快照业务校验有独立类型，未知数据库异常仍走保守通用错误 |
| `scripts/integrated-console-acceptance.ts` | 仅透传阶段报告；整轮一次Web预留仍先于父类DNS/fsync完成。不修改v2格式、32请求/6元、固定ID/URL、容量或失败不退款规则 |
| `tests/fixtures/integrated-live-g1.json`、三个新增测试文件及`tests/web-read-service.test.ts` | 原始虚构输出及提取的初始快照、身份反例、跨模块Pi/SQLite端到端、阶段超时/故障及本机TLS证据 |

`request_created`只表示本地ClientRequest已创建；`request_finished_local`只表示交给本机流，均不证明远端收到GET。TLS完成只证明连接校验，响应头/完整正文才是后续已观察的HTTP响应证据，也不宣称严格exactly-once。无DNS回退、代理降级、重定向、新URL、额外GET或延长10秒超时。网络和短SQLite事务仍分离；没有DDL迁移、第二套缓存/账本、新依赖或SDK改动。默认Goal/Skills/Web/Proactive/Formation关闭。

## 红绿证据与实际回归

证据目录：`E:/AgentWork/validation/personal-agent-console-offline-fix-20261024`。全部新数据库/Skill安装位于临时目录或此新证据根，不在原验收库运行迁移或重放。

1. `red-targeted-valid-fixture.log`：基线4/4失败，分别检测原G1被阻塞、bootstrap ID暴露、具体拒绝原因丢失、DNS超时无阶段证据。测试先写、产品后改；同一组在`green-initial.log`为4/4通过。
2. `baseline-g1-stack.json`：从Git导出c604565源码，在新库插入提取的初始快照，原结果直接触发原Step身份错误，保留完整离线堆栈；没有删触发器、改旧库或调用模型。此堆栈不是原真实运行当时捕获的堆栈。
3. `targeted-integration.log`：50/50通过；自审收紧未知执行异常回显后，`targeted-final.log`在最终源码上83/83通过。包括真实Pi SDK、本机模拟模型/HTTP、SQLite、Chat read+Web、首次待批准草稿、审批前零正式执行、批准后冻结Skill/Web并提交partial Checkpoint、失败不提交、宿主覆盖错误口述、收据跨重启和恢复不重放；也包括旧预算、同Run重复控制、跨进程一次GET和快照损坏拒绝测试。最终全量还运行了本机TLS及既有Task/Memory/Formation/Goal/策略/通知测试。
4. `windows-final-gates.json`及对应日志：typecheck/build/test/eval:memory/eval:formation全部退出0；npm test共467，464通过、0失败、3跳过。Memory eval为offline-lexical，模型调用0；Formation固定开发/留出窗各30/30，实际API 0。模拟预算日志里的“请求”不代表收费消费。
5. 三项原跳过分别是POSIX权限位、Windows账户不具备的符号链接权限、POSIX SIGTERM优雅退出；Windows ACL未验收。`linux-runtime-check.log`记录Docker Linux engine不存在；未启动Linux发行版或Docker服务、下载镜像或安装依赖，本次没有Linux结果。

原始失败不删除：`red-targeted.log`首次夹具漏插创建控制收据；修正夹具后才取得有效红测。`targeted-expanded.log`首次扩展测试漏传已批准Skill快照；补齐宿主调用契约，未放宽预期或业务保护。`baseline-g1-setup-failure.log`记录一次性回放器误用相对Skill目录，之后使用新库/绝对目录得到有效基线堆栈。三者均是离线编排错误，不冒充产品根因或真实模型请求。

## Hash、工作树与复现

原response08 SHA256：`452451e49bed35c5386da6d8ed85391f4b7e8fa4f089b4f4c86c122cfa34a7da`；原agent.db：`d4a644815a054cf78467b2d132c4ec0079c557f261003e254f2be9bada1f6caa`；原v2账本：`29eda343bd44d0f8df4508b633773dab8b47fcf36375ce5c9b990b66d1ad1f87`；冻结方案：`06fa3f52c8eea5cf14a36950413a9dc72fed0264b5dfb5aac4ff0be47297e57b`。原数据和证据全量Hash比对见`preservation-check.json`；不是只核对数据库正文而忽略Session/账本。

本轮源码/测试Hash清单及整体SHA见`source-manifest.json`和[机器报告](integrated-console-offline-fix.json)；完整产品/测试增量diff为`repair.patch`，其Hash见机器报告。`evidence-manifest.json`记录日志及审计文件Hash。原真实报告的Markdown/JSON保持原Hash，不把本轮离线通过写回旧结论。

在本修复工作树离线复现核心检查：`node --import tsx --test tests/goal-initial-identity.test.ts tests/web-read-phases.test.ts tests/console-offline-repair.test.ts`。使用Node24.19.0及已存在依赖；测试自行创建新库，绝不传入原验收根目录，不运行真实验收入口。Formation需指定新的`--output=<新路径>`，避免改写历史报告。

修复工作树：`C:/Users/Dongr/.codex/worktrees/console-offline-fix/Persistent Personal Agent`；分支`codex/console-offline-fix`；HEAD仍为c604565，本轮未提交/合并/推送。原v3-proactive工作树的STATE及两份报告不变，原E盘保存分支/HEAD和8项改动不变。依赖仅复用已有node_modules，不修改SDK。

## 剩余风险与真实门槛

- 本例初始身份缺陷已离线修复；兼容仅限首次create，后续bootstrap失败后重新生成时仍须省略新ID，不提供通用自动修JSON或ID重映射。
- W1真实超时究竟发生在哪一阶段仍未知，公网可达性没有验证；历史GET保持0～1。新增阶段证据只服务未来另行授权的运行。
- agent-notes真实自动选择、Goal真实审批后的Skill/Web联合使用、自然暂停、模型正确理解收据、真实Checkpoint和重启闭环仍未验成。Chat规划时预读批准纯文本Skill与冻结G1“审批前未激活”的字面预期差异仍保留；本轮未改变权限或验收标准。
- V3.0.1两项历史真实失败继续开放，正式主动执行不启用。只有新的独立授权、重新核价和预算闸检查后，才可安排小规模真实复验；旧唯一Web额度和剩余模型额度均不能恢复或自动沿用。
- 当前可交付离线代码及证据审查；不宣称真实体验、Linux当前版本、Mac、Windows ACL或长期生产可靠性已通过。
