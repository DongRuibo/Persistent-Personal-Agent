# N0：Pi 多 Session 与原生压缩实验

日期：2026-11-03。结论：**N0 已独立 R1 GO，0阻断、0本轮需修复项。公开 API 的薄宿主适配可行；默认原生 compact 不能直接启用，N1—N5 仍待用户明确批准。** 见[独立 R1 报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-n0/reviewer-r1/review.md)。

## 范围与版本

- 独立树 `/Users/onruio/.codex/worktrees/topic-session-n0/Persistent Personal Agent`，分支 `codex/topic-session-n0`，HEAD `2dc2bdd172b63a964ae67133aefb119b9c19e555`。
- Node `24.19.0`、npm `11.17.0`、Pi coding-agent/pi-ai `1.3.0`；独立 APFS clone 的实体 node_modules，无 SDK 修改。
- 验收约定为[冻结原件副本](../designs/topic-session-n0-validation-plan.md)。仅临时 SQLite/Session/Memory/文件目录、localhost 假 HTTP 与固定假凭据；未读取真实 .env/个人数据、未发收费模型请求、未操作 62414/PID6239、4317/4318。
- 唯一生产差异：`src/pi-executor.ts` 原 Tavily 24 KiB 投影原样提为 `projectWebContext()` 并在原位置调用，保留 CRLF、处理顺序和预算。没有路由器、数据库迁移、新开关或正式 compact 接线。

## 实际公开接口

均从包正式 export 入口导入：`createAgentSession`、`SessionManager.open/appendMessage/appendCustomEntry/getBranch/buildSessionContext`、`AgentSession.prompt/compact/abortCompaction/abort/dispose`、`DefaultResourceLoader`、`SettingsManager`、`ModelRuntime.registerProvider/streamSimple/completeSimple`、`session_before_compact` / `session_compact` / `context` / provider hooks，以及根导出的 `compact`、`sessionEntryToContextMessages`。底层 OpenAI 流使用正式子路径 `@earendil-works/pi-ai/api/openai-completions`。

实验不写 SDK 私有状态、不改消息内部数组、不使用内部路径 import。摘要算法和切点始终来自 Pi；假模型只从实际入站事实标记生成摘要，不硬编码缺失的早期事实。扩展包装只添加固定低信任标识与入站来源元数据，不生成另一套摘要。

## 验收矩阵

以下证据均位于本机证据根的 `worker/frozen-final/<目录>/evidence.json`；JSON 保存实际原始 HTTP 字符串、解析 payload、bytes、preparation、事件与计数，旁边保存虚构 A/B JSONL。测试断言“存在原生缺口”的 exit0 **不表示该原生能力通过**。

| 门 | 原生事实 | 公开适配与结果 | 证据目录 |
| --- | --- | --- | --- |
| S1 | 同一可信 actor 可用不同原生文件隔离 A→B→A；A 早期事实返回，B 独有内容不混入 | 同进程重开、真实子进程恢复均零自动 HTTP/工具，actor 不随 key 变化。通过 | `session-a-b-a` |
| S2 | 各 Guard 独立后，B 回合不会替 A 撤销 Memory 旧短确认；直接回 A 仍能消费它，这是原生/现服务组合的真实缺口 | 实验入口显式清除并持久化短确认后不能复活；当前合法 Memory 确认仍成功；Task 归原 Web actor。单一 Goal displaySink 按串行当前 Session 保存。通过，但该入口维护尚未接产品 | `services-session-references` |
| S2 文件/Goal | A/B 分别有实际待批项；恢复只恢复引用，不延长期限或改变服务状态 | 文件 expired/cancelled 后重开 A 裸确认由原 Guard 零模型拒绝，fresh 预览/确认真实落盘。Goal A/B 均有 committed bootstrap 与待批计划，过期重开 A 拒绝；重新查看/确认只批准 A，B 不变。通过 | `file-a-b-a-expired`、`file-a-b-a-cancelled`、`services-session-references` |
| C1 | 单次压缩 1 HTTP，真实 split-turn 2 HTTP；早期有效约束来自实际摘要入站 | 压缩后实际主 payload、同进程重开及真实子进程 buildSessionContext 均含早期事实，恢复零 HTTP/工具；原始 JSONL 前缀保留。通过 | `native-single`、`native-split` |
| C2 | 原生摘要的 before_provider_request/message_end 均为 0；含长 user 历史的摘要实际 **130750 B**，绕过原 65536 门 | provider 的实际 fetch 统一计次/检查最终 HTTP bytes；超 64 KiB 摘要零发送。增长样本历史 41721 B，预留 20000 B，摘要实际 33739 B、主 Chat 11823 B。通过；正式触发策略尚未接线 | `native-oversize-web-bypass`、`adapted-oversize-preflight`、`growth-before-byte-boundary` |
| C3 | 切点可位于工具链附近，split-prefix 与保留段由原生算法决定 | 实际保留 tool call/result 的 ID 成对，当前原话仍在；没有工具自动重放，原记录未删除。通过 | `tool-chain-cut-pair`、`native-split` |
| B1 | 不能用一次 compact 事件当成一次 HTTP；Session 切换本身没有请求预算概念 | 同一预算覆盖假路由、两次 split 摘要、A/B 主 Chat；正好 8 次到达，第 9 次在服务收到前阻止。hook 第二摘要超额时显式 cancel，不回退默认摘要。通过 | `adapted-eight-ninth`、`hook-fail-closed` |
| B2 | 默认摘要完成事件不足以保留前一次成功用量；失败时不应丢已知调用 | 首摘要已知 31 input / 7 output，次摘要 500/断流/取消分别保留 unknown，未知项无 usage 字段；dispatched=2、completed=1、received=2，失败无压缩条目、重开无重放。通过；审计接线边界见下 | `adapted-split-500`、`adapted-split-disconnect`、`adapted-split-cancel` |
| B3 | **只取消 provider 信号时，SDK 可把 aborted 第二摘要当空摘要提交成功**；真实首红保留 | 同一 signal/绝对期限还联动公开 abortCompaction/abort；路由、摘要、主 Chat 三阶段的取消与期限均不进入后续阶段；取消摘要不提交。实际压缩中 SIGKILL 后重开零请求/工具、无摘要。通过 | `provider-only-cancel-original-gap`、`adapted-*-cancel/deadline`、`process-killed-compaction` |
| T1 | 原 WebUI 十八轮主 Chat 累计正文 24576 B，原始工具正文 294912 B。原生 preparation 取原记录；SDK另逐 toolResult 截 2000 **字符**，实际摘要 HTTP 41772/3558 B，仍带回原主投影已省略的旧正文 | 复制公开 preparation，将待摘要、split-prefix、保留段合并后复用**同一原投影**，再按原长度拆回；累计正文 24576 B。实际摘要 13484/7172 B、主 Chat 3302 B；保留来源/trust，并固定包为 UNTRUSTED_HISTORY_SUMMARY_V1。原 Guard 对伪批准零写。通过，非真实模型遵从保证 | `original-web-projection-versus-native`、`adapted-web-low-trust` |
| T2 | 临时 Memory 投影本身不追加 Session/摘要；但**助手复述会成为聊天历史**，forget 后原生摘要仍可含该旧值 | 原服务更新后的有效检索为 v2，删除后当前记录为空；历史没有被宿主写回当前 Memory 或用作 Guard 权限，伪批准零写。当前检索标识与历史摘要低信任标识可并存。通过结构门；不承诺真实生成永不引用旧值，也不承诺擦除聊天 | `memory-current-only`、`memory-assistant-echo`、`adapted-web-low-trust` |
| R1 | 正式入口、默认关闭状态、权限和数据结构未改 | 原19文件187/187、typecheck/build exit0；源码接缝 Hash 与回归版相同。通过 | `worker/validation/` |

## 必须保留的接线条件

1. 身份与 context key 分离。每个 Session 管理自己的 Guard/DialogueReferences；入口另维护“其他普通回合使旧短确认失效”的原语义。只有一个 Goal displaySink，按当前串行请求归属保存，不能让最后创建的 Session 抢走回执。
2. 预算放在**最终物理 HTTP 发送口**，跨路由/压缩/主 Chat/Session 共用一份 8 次与 65536 B 限制，并预留原话/system/tools/临时投影；不能仅依赖原 provider hooks。
3. 共用绝对 signal/deadline；摘要取消必须同时调用公开 abortCompaction。`session_before_compact` 抛异常会被 SDK 捕获并回退默认摘要；过滤/计量失败必须记录原因并显式返回 cancel，发送口仍需兜住原次数/字节门。
4. 公开 preparation 用副本，按原切点/配对运行 Pi 根 `compact`；摘要入站和主 Chat 共用原网页投影，结果固定标为历史低信任摘要并保留来源。临时 Memory 继续只由原服务提供当前有效检索，不将摘要反写 Memory。
5. 每次 HTTP 单独留计量。当前 `ModelCall` token 字段全为 number、purpose 未包括 compaction；本实验把 known/unknown 明确写入原 `run_events`（`n0_*`），**尚未接入产品 model_calls/UI**，没有把未知填 0。N1/N2 需要按这个事实确定原审计接口的小型接线，不可声称当前产品已统一统计。

这是 N0 冻结的接口约束，不是本轮已实现的产品路由；N1—N5 仍全部未实施、待用户明确批准。

后续顺序仍按[原规划](../designs/topic-session-routing-plan.md)：N1存储 → N2主题Session → N3路由 → N4原工作链/单入口 → N5回归。N2须落实身份/contextKey分离、入口各类引用按原规则失效、单一Goal sink按实际请求归属、最终HTTP共享8次/65536预算与unknown审计、统一取消/绝对期限及共享低信任投影；候选位置沿用原规划的 `src/pi-executor.ts`、`src/contracts.ts`、`src/main.ts`、`src/config.ts`，必要权限接缝为 `src/operation-guard.ts`、`src/goal-service.ts`，不另设计机制。

## 验证、失败和证据

证据根：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-n0/`。

- 独立 R1 实际复验 **29/29，exit0，9200.910542ms，0失败/取消/跳过**，结论 GO、0阻断/0本轮需修复项；[报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-n0/reviewer-r1/review.md)、同目录 `commands.json` / `tests-localhost.log` 留证。Reviewer只读核对187回归与工程日志，未重复运行这些检查；独立首轮localhost沙箱失败保留。
- 最终 `TMPDIR=/private/tmp N0_EVIDENCE_DIR=<证据根>/worker/frozen-final node --import tsx --test tests/topic-session-n0.test.ts`：**29/29，0失败/取消/跳过，9676.999542ms，exit0**。其中诊断原生缺口的测试不计为原生通过。29项是工程测试数，不替代冻结矩阵结论。
- 原19文件适用回归：**187/187，0失败/取消/跳过，36743.589709ms，exit0**。覆盖 Pi/Session、自然意图/Task/Memory、文件/Goal、Tavily/Web、Coordinator/续接及其进程恢复。精确文件列表、命令和退出码见 `worker/validation/commands.json`；原始输出为 `regression.log`。
- typecheck/build 均 exit0；无前端变更，未跑 web:build、浏览器、全量939、真实模型、手机或长跑。旧939/153不作为本次运行结果。
- 首轮 `run-1` 16/17：仅 provider 取消导致空摘要提交，原红与 HTTP/事件保留；最终同一源码另有 `provider-only-cancel-original-gap` 可复现该缺口。`run-3/4` 为严格 Memory 命令、hook 错误文本与子进程保留预算的夹具红；`run-6` 使用 symlink tmp 导致原文件 fixture 初始化失败且泄漏临时监听，测试子进程明确终止，日志保留；改为项目规定 `/private/tmp` 后通过。`final-s2` 的文件两红来自只有 custom 条目、尚未首轮助手时 SDK 未刷盘，补实际 SDK 初始化后 `final-s2-fixed` 28/28。所有旧日志不覆盖。
- 最终 Hash、精确 diff、文件副本及命令历史见 `worker/delivery/`。早期迭代测试文件未逐轮冻结全文 Hash，不能宣称首红日志与每个早期测试版本都有密码学绑定；生产改动前基线与 SDK 固定，最终全部关键事实均可在冻结版重复验证。

剩余边界是产品接线和真实语义质量，独立 R1 未发现必须修改 SDK、扩权限或自建摘要引擎的结构性障碍。本次审查已独立核对发送前第9次拦截、hook失败 cancel、取消无摘要提交、文件/Goal失效恢复与 Memory 助手复述边界。审后只更新本报告与STATE交接文字，业务/测试Hash与R1版一致，未重跑工程检查；最终交付见证据根 `delivery-final/`。N1—N5继续等待用户批准。

本轮未 stage/commit/push、未建 PR、未合并或启用功能，无新提交标识。
