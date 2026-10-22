# V3.0 Batch 2–4 MVP：实现与自动化验证

日期：2026-10-22（Asia/Shanghai）。结论：既定四表模型上的长期Goal闭环已完成并通过隔离自动化，交付用户和ChatGPT审查。真实SQLite、原版Pi SDK及真实main子进程已运行；模型为本机模拟HTTP服务，飞书传输为模拟。**本轮收费API请求/Token/费用均0，未做真实Goal模型或手机验收。**

机器证据及文件Hash见 [v3-mvp-validation.json](v3-mvp-validation.json)；未来收费/手机方案见 [v3-live-acceptance-plan.md](v3-live-acceptance-plan.md)。

## 范围与工作区保护

- 开始先读AGENTS、PROJECT、STATE、V3设计及相关实现，核对本地HEAD、origin/main和实际远端main，均为 `51bc736366733060e91625c881248dce268ceb9c`。Batch1尚有未提交/未跟踪文件，未覆盖；原样副本留在系统TEMP的 `personal-agent-v3-baseline-54518afe-72ef-4511-9d80-5a7c80feecde`。
- 期间另一操作按用户单独授权提交Batch1为 `65dcabb9886d4f6ccbef48f562d7120b776fcf19`，代码开发验收快照时HEAD与本地origin/main为该值。保留该提交及STATE中的发布历史，代码开发阶段未创建提交、未推送。开发收尾时两次 `git ls-remote origin refs/heads/main` 均因 `SSL_ERROR_SYSCALL` 失败，当时实际远端SHA未重新确认。
- 用户随后明确授权将本批提交推送GitHub main供审查。发布前使用单次HTTP/1.1参数成功核对实际远端main为上述65dcabb，与本地一致，未改全局网络或证书设置。90份源码/脚本/测试/夹具及构建配置Hash均与本报告已通过测试的版本一致，发布只补授权状态及证据说明，不修改实现或重跑收费测试；HANDOFF、正式配置/数据及外部日志不纳入提交。
- 原有未跟踪HANDOFF.md未改，前后SHA256均为 `ae6feb3c57368cce9669920d04740555a6d0406f39cc10d53394723b3631c998`。Batch1的sqlite-store.ts和goal-store.test.ts未在本轮修改；GoalStore仅增量添加可信宿主查询和计划提议事务。
- 未修改正式.env、正式用户数据、依赖清单/锁文件、Pi源码或node_modules源码。未引入框架、外部执行工具、定时、自主推进、Observer、Skills、Computer Use、Outbox或VPS。测试数据均为临时/隔离虚构内容。

## 交付行为与实现位置

一次创建或明确继续最多授权一个text_only片段。Goal有独立临时Session，只读Memory且无模型工具；完成片段后将Run、Execution、Checkpoint、Step和Goal在原聚合事务中提交，然后等待用户。仅计划批准不会执行；明确批准并继续才产生一次ready。所有步骤交付后仍需用户确认目标完成。

暂停/取消先持久化控制，再协作abort；忽略abort的迟到结果不能越过版本/控制检查。重启保留未消费ready；遗留running按已落盘控制恢复到paused/cancelled，其他blocked，不盲目重试。提交回执异常先读库确认，无法核实时停止新领取；已提交成果可重新查看，通知失败不重跑。

| 文件 | 本轮修改目的 |
| --- | --- |
| [src/background-lane.ts](../../src/background-lane.ts) | Task/Goal共享后台执行门；Goal等待前台队列，已有到期Task优先 |
| [src/goal-runner.ts](../../src/goal-runner.ts) | 有界片段、严格结果Schema、提交异常核对、控制中止、停机等待、成果展示和投递收据 |
| [src/goal-service.ts](../../src/goal-service.ts) | 可信身份/渠道绑定，真实视图版本与草稿Hash、TTL、计划提议/批准和控制 |
| [src/goal-tools.ts](../../src/goal-tools.ts) | 单一无参数goal_manage适配，工具参数不决定权限或目标 |
| [src/goal-store.ts](../../src/goal-store.ts)、[src/goal-types.ts](../../src/goal-types.ts) | 宿主查询及同事务revise_plan收据，保留原四表/CAS/Checkpoint语义 |
| [src/contracts.ts](../../src/contracts.ts) | Goal执行scope、宿主Memory查询、渠道goalId标识 |
| [src/operation-guard.ts](../../src/operation-guard.ts) | 当前原话隔离解析及宿主证据检查；共享操作帧；固定编号澄清；确认、计划调整和失败重新生成 |
| [src/pi-executor.ts](../../src/pi-executor.ts) | 原版SDK独立Goal Session，无工具、只读Memory、无查询改写，4096输出上限及非法工具单请求中止 |
| [src/main.ts](../../src/main.ts) | 恢复/组装Runner与Service、渠道归属、显示回执及退出顺序 |
| [src/scheduler.ts](../../src/scheduler.ts)、[src/task-service.ts](../../src/task-service.ts) | 共享执行门及可信当前投递目标；保留旧Task领取/一次性约束 |
| [src/feishu-channel.ts](../../src/feishu-channel.ts) | 前台接收至排队回复期间登记占用，避免新Goal抢先领取 |
| [src/formation-service.ts](../../src/formation-service.ts) | Goal查询/控制不产生Formation候选任务 |
| [scripts/audit-goals.ts](../../scripts/audit-goals.ts) | 显式路径、只读一致SQLite快照，不输出正文；检查指针/Hash/状态关联，不修复 |
| [scripts/goal-feishu-acceptance.ts](../../scripts/goal-feishu-acceptance.ts) | 未来Batch5隔离入口；默认不联网，累计请求/费用预留、响应留存与同账本续测 |
| [tests/goal-runner.test.ts](../../tests/goal-runner.test.ts) | 单授权、控制竞争、提交故障、后台互斥、真实Pi与Memory故障 |
| [tests/goal-control.test.ts](../../tests/goal-control.test.ts) | 自然语言授权/多目标/版本/Hash/TTL/显示/单帧/调整/完成及通知版本竞争 |
| [tests/goal-integration.test.ts](../../tests/goal-integration.test.ts) | 真实Pi+SQLite+本机HTTP模型+模拟飞书的完整生命周期与隔离 |
| [tests/goal-process.test.ts](../../tests/goal-process.test.ts) | 真实main三次启动、空Session、ready/Checkpoint恢复、等待零请求 |
| [tests/goal-audit.test.ts](../../tests/goal-audit.test.ts)、[tests/goal-budget.test.ts](../../tests/goal-budget.test.ts) | 只读核对器与未来验收预算的离线故障边界 |
| [tests/pi-executor.test.ts](../../tests/pi-executor.test.ts) | 原有Session回归增加独立Goal Session与dispose验证 |
| [README](../../README.md)、[PROJECT](../PROJECT.md)、[STATE](../STATE.md)、[V3设计](../designs/v3-persistent-goals.md) | 运行话术、稳定架构、当前快照、实际实现与保留限制 |
| 本报告、机器JSON、[Batch5方案](v3-live-acceptance-plan.md) | 可审查证据、文件Hash和待批准的真实验收步骤 |

## 分阶段验收与最终命令

| 阶段 | 推进前的实际检查 |
| --- | --- |
| Batch1复核 | 四表/关联Run/版本CAS/Checkpoint整体事务/Plan v0及v1/暂停取消与崩溃恢复；已有Goal与Task核心40项通过 |
| Batch2执行 | typecheck/build退出0；Runner、存储、Pi/Task等相关49项通过后才推进 |
| Batch3控制 | typecheck/build退出0；当时全量185项，182通过/0失败/3原有Windows跳过后推进Batch4 |
| Batch4最终 | 下表为最后代码版本的全量结果，覆盖新增生命周期、故障与通知版本竞争 |

Node均为24.19.0。Windows使用Codex捆绑runtime；Linux为官方 `node:24.19.0-bookworm-slim` 容器。容器只复制允许的源码/脚本/测试/夹具/配置模板，无正式.env/数据；缓存离线安装后断开全部Docker网络，`NetworkSettings.Networks={}`，只允许容器本机HTTP模拟服务。

| 命令 | Windows | 断网Linux |
| --- | --- | --- |
| `npm run typecheck` | 退出0 | 退出0 |
| `npm run build` | 退出0 | 退出0 |
| `npm test` | 191项：188通过、0失败、3跳过；15895.6617ms | 191项：191通过、0失败、0跳过；38413.87504ms |
| `npm run eval:memory` | 退出0，64题离线词法 | 退出0，同固定题集 |
| `npm run eval:formation -- --output=<隔离文件>` | 退出0，60窗模拟提议 | 退出0，同固定窗口 |

Windows三项跳过为POSIX私有权限位、无符号链接权限、POSIX SIGTERM优雅退出；Linux均实际通过。不是原生Mac、Windows ACL、VPS或真实手机测试。代码测试后的改动仅为文档和证据整理。

Memory原集/留出/证据留出可回答数12/19/18；Top1、Recall@5、MRR及Context命中分别为9/12、17/19、17/18，无答案误supported为0/4、0/5、0/6，最大Context为1153/1613/1578字节；额外模型调用0。Formation开发/留出各30/30，误候选0、未经批准写入0，实际API/Token/费用0。未更改冻结样本或预期，模拟指标不代表真实语义精度。

原始日志保留在本机 `E:/AgentWork/validation/personal-agent-v3-20261022`，机器JSON保存日志/夹具/实现Hash。该目录不进入Git。首次Linux在线npm ci网络超时；随后本轮编排未等待旧安装器结束便离线安装并启动测试，造成模块缺失并失败。已确认旧安装器退出，从相同package-lock的既有缓存完成离线安装，再断网跑完全部检查；首轮失败日志以 `*-attempt-1.log` 保留，不归咎业务，也不抹去失败。

## 关键故障与安全证据

- **生命周期与不重做**：integration覆盖创建/v0→草稿→批准/v1→partial成果→等待→关库、新临时交互Session→继续→后续步骤→用户完成确认，检查实际前Checkpoint指针和Run数；process测试跨真实main退出/启动，ready只消费一次，waiting启动0请求，继续不重复bootstrap。
- **事务与竞争**：保留Batch1的32项存储测试（含双进程领取/取消竞争、延迟外键COMMIT失败、真实进程退出恢复和旧Task唯一约束）。Runner新增取消/暂停先落盘、忽略abort的迟到结果、结果整体回滚、提交已成功但回执丢失采用成果、无法重读立即停止新领取。
- **失败阻塞**：HTTP500、截断、工具调用、非法JSON/未知字段/计划、输入超限、Memory预检及执行期Context损坏均不静默修复或自动重试；有可核对状态时结束为阻塞，无法核对则停机。失败重新生成必须有当前用户新的明确意图，不可凭普通继续绕过。
- **授权与隔离**：普通事实、引用/否定/假设/要求自动推进不创建权限；多目标必须固定清单澄清，序号独立核验；过期/未投递/跨渠道/旧revision/错误Hash均不能批准。只显示标题的列表不能批准未看见计划。短确认不执行；同Frame的Task/Memory/Formation/Goal只能消费一次操作，解析前即占帧。
- **实际显示版本**：通知发送前保存视图，投递等待期间发生计划修改，只登记原先实际发出的版本；不能读回新版本冒充已经显示。该竞争有独立回归。
- **能力白名单**：真实Pi SDK模拟请求中Goal工具列表为空，Memory恶意文本作为低信任Context，不持久化为聊天历史；没有Shell、Browser、MCP或写工具。Goal上下文和进度不写Memory，不生成Formation任务；飞书白名单/去重和原Task/Memory/Session回归全部保留。

## 已知限制与Batch5边界

- 自然语言依赖主模型提议和隔离解析，主模型可能漏工具，未知表达可能误判/需澄清；宿主规则不是通用语义证明。单独“我今天学完了”不自动推进，请同时明确继续。仅原始目标不变的计划调整；改变总体目标需新建Goal。
- 输入分区预算为目标/本次原话4KiB、计划/当前步4KiB、前Checkpoint6KiB、快照总14KiB，另有Memory2KiB；成果artifact允许显式标记节选，其余关键文本超限阻塞，完整成果保留SQLite。超大目标/计划不是无限上下文。
- view暂返回全部Execution，无长期分页；uncertain无法自动解锁，须人工核对。进程/SQLite/Session保留原有单进程、未加密和非跨存储事务限制，协作abort不保证未知外部副作用恰好一次；本阶段仅纯文本产物。
- 没有Outbox：结果提交后崩溃可能丢通知，发送超时可能已送达；查询能重展示数据库成果，不自动重发/重做。没有定时触发、自主推进或外部操作能力。
- 尚未做真实Goal模型语义、手机送达/交互、原生Mac/Windows ACL、长期运行和供应商实际账单验证。
- Batch5建议48个模型HTTP请求/5元保守预留，**不是已获授权或实际消费**。具体手机话术、费率核对、请求计数、停止/续测、SQLite查询和证据要求见[方案](v3-live-acceptance-plan.md)。实际执行须用户单独批准，当前交付不启动验收或正式服务。
