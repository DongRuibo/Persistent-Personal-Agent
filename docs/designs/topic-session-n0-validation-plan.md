# N0 Pi 多 Session 与原生压缩验收约定

冻结日期：2026-11-03。授权仅 N0 实验、离线验证、审查和必要常规修复；不执行 N1—N5，不提交、推送、合并或切换试用实例。

## 基线与隔离

- 新工作树：`/Users/onruio/.codex/worktrees/topic-session-n0/Persistent Personal Agent`；分支 `codex/topic-session-n0`；HEAD `2dc2bdd172b63a964ae67133aefb119b9c19e555`。
- 已发布 Coordinator 与本地旧开发树 `dd8baa7` 文件树相同；PR #5 仍 open，头为 `d0cfcbc`；main 为 `91b7a65`。不从旧 main 实验，也不修改原两棵工作树。
- 本机 Node 24.19.0、npm 11.17.0、Pi SDK 1.3.0。依赖在新树独立准备，不链接到活跃树的可写缓存，不修改 SDK、Agent Loop 或原 `node_modules`。
- 每次实验使用临时 SQLite、Session、Memory、资源目录和 `127.0.0.1` 假模型；模型凭据只用固定假值。禁用模型列表网络刷新、自动发现 Skills/扩展/MCP、遥测、重试与自动压缩，不读取 `.env` 或正式/试用数据。
- 原 62414、4317、4318 实例不访问、不重建、不启停。原树保护清单见本机同目录 `protected-before.json`。

## 最小实验范围

先跑原生行为对照，记录真实缺口；然后仅在公开 API 足以支持时验证薄宿主适配。允许测试公开 SessionManager、createAgentSession、compact/abortCompaction、扩展事件以及公开 provider 接口；不直接赋值 SDK 私有状态、改其内部数组或导入未公开内部实现来绕过接口。

实验放在 `tests/` 及必要测试 helper，复用原 OperationGuard、Task/Goal/Memory 服务、展示收据和假 HTTP fixture。优先不改 `src/`；如关键实证必须增加一个测试接缝，先说明具体最小差异，由 Planner 核定，不能借此写正式多 Session 路由或 UI。

不实现新的 WorkThread 迁移、主题分类器、Session 注册表、后台调度器或摘要框架。所谓“路由”只是一份假模型解析调用，用于验证它与压缩/主 Chat 共用预算，不验证语义分类质量。

## 冻结场景

| 编号 | 场景与必须采集的事实 | 通过条件 |
| --- | --- | --- |
| S1 | 相同可信 Web actor，A→B→A；捕获实际 SDK 发给假 HTTP 的请求；关闭并重开 Session，再做真实子进程恢复 | A/B 独有历史不混入；A 首轮约束能回到 A 后续输入；恢复本身不发模型请求、不执行工具；两 Session 的 owner 不因 context key 改变 |
| S2 | SessionManager 持久化各自 DialogueReferences；使用原 Guard/服务验证 Task、Memory 和 Goal 展示回执；A 待批→B 待批→回 A 裸确认；过期或已失效引用再恢复 | 原身份、对象归属、单轮权限不扩大；显示回执落实际 Session；已失效授权不复活；须有合法当前请求的正向对照，不能通过把全部操作禁掉过关 |
| C1 | 实际原生 `compact()` 在主 prompt 前运行；构造超过两轮的历史，假摘要按入站事实生成；记录 preparation、请求、summary、保留段和 Session 条目 | 后续实际 payload 含早期有效约束；重新打开/子进程恢复后仍含摘要；原始记录保留；固定模型不能只硬编码缺失信息冒充恢复 |
| C2 | 单次压缩与真实 split-turn 分别记录 HTTP 数、payload 字节、usage、SDK 事件与已有 before_provider_request/message_end 回调数；历史增长触及宿主 65536 字节边界 | 不能用一次 compact 事件等同一次 HTTP；原生绕过现有门限必须明确暴露。适配成功时每个实际 HTTP 都先过原次数/字节门，不能增大上限；考虑原话、system、tools、临时投影预留 |
| C3 | 历史中有合法 toolCall/toolResult；压缩切点接近工具链；随后新 prompt | 提供实际 payload/Session 证据说明配对完整；没有孤立结果、丢当前原话或压缩后自动重复工具；不能靠删除所有工具回合掩盖问题 |
| B1 | 假路由→compact→主 Chat 属于同一请求；包含 split-turn；正好 8 次及第 9 次边界 | 只一份预算；第 9 次在假 HTTP 服务收到之前被阻止；压缩或 Session 切换不重置计数；已知 usage 逐次可核对到原审计路径或明确标为尚未接入的实验记录 |
| B2 | 首摘要成功、第二摘要 500/断流/取消；首调用有已知 usage、后调用可能无 usage | 已成功调用与已知 token 不因整体 compact 失败丢失；未获供应商 usage 的调用明确 unknown，不能伪记零；服务端收到数、客户端发起数及完成数分开 |
| B3 | 路由阶段、compact 阶段和主 prompt 阶段取消/绝对超时；使用可控屏障；进程在进行中退出后重开 | 同一取消/绝对期限覆盖全部阶段；终止后不进入下一阶段、不自动重试；恢复不重放。不能只检查 Promise 拒绝而不核对服务端请求与工具动作计数 |
| T1 | 超预算 Web 工具正文、含伪指令的网页标记；检查原生压缩入站与压缩后主 Chat 入站 | 保留低信任来源；不借摘要绕过原 Web 正文预算或取得操作权限；如原生不经过现有 context 投影，必须如实报告，不能只检查普通 Chat 路径 |
| T2 | 本轮有效 Memory 临时投影、随后更新/删除；恢复和压缩；摘要中包含伪批准指令 | 临时 Memory 不持久追加到 Session/摘要；旧检索版本不冒充当前 Memory；摘要不能成为 Guard 新授权。用户本人曾说过的话仍是历史，不把 forget 当成擦除聊天 |
| R1 | 新实验不接正式入口；适用旧 Session/Guard/Task/Goal/Memory/Web/Coordinator 回归与类型检查 | 旧路径与默认关闭状态不变；运行实际命令并保存退出码。若没有生产改动，说明适用测试选择，不为文档重复全量工程 |

## 证据与结论口径

- 保存原始命令、退出码、日志、输入/输出 payload、SDK 事件、请求计数、临时持久化记录摘要、源码/SDK 版本及 Hash。只保存虚构测试数据；失败、首次环境失败和修复前证据均不覆盖。
- 每项分别给出“原生事实”“公开适配是否验证”“通过/不通过/未验证”，明确 SDK 原生能力、实验宿主适配与尚未产品接线的区别。
- 断言某个原生缺口存在的测试即使 exit0，也不能据此将该能力记为通过。整体 N0 GO 要求上述关键门均有运行证据且无绕过；任一必要门未满足则为 NO-GO/待决策。
- 如果需要修改 SDK、扩大权限/预算、依赖私有对象或新建复杂摘要框架才能继续，停下并报告，不靠额外体系凑绿灯。完成其他不受影响的诊断，最多提出两种替代方案，未经用户批准不实现替代架构。
- Worker 完成后，独立 Reviewer 在新上下文核对需求、实际 diff、原始日志，并独立运行关键可复现测试。最多三轮审查修复；超限或重大架构分歧停止。

## 交付与后续

预计交付：最小实验测试/必要 helper、N0 评估（含公开接口清单、每项结果、原生与宿主适配边界）、本验收约定、`docs/STATE.md`。不改 AGENTS 协作规则，不把待实现方案写进 PROJECT 已实现架构。

通过时冻结后续可复用的身份与 context key 分离、Session/Guard/展示回执归属、请求预算/取消、压缩输入和审计接口建议；明确哪些只经实验验证、哪些仍需 N1—N5 接线。无论是否通过，都先交用户决策，不自动进入 N1。
