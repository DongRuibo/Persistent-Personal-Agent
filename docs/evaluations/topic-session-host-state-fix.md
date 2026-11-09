# 主题已创建却被主回答否认：定点修复

日期：2026-11-09。执行树为`/private/tmp/ppa-router-session-eval`，HEAD仍`5f4764d`。用户授权本轮定位根因、最小修复和回归；不提交、推送、重启正式实例或调用收费模型。

## 根因与证据

此前真实连续验收的C01（健身）、C03（求职）中，Router均提议create，SQLite已经创建主题、保存chatContextKey并冻结路由，原生主题Session也已建立；主回答却说“没法创建…主题”或“不会创建…独立主题”。这些失败不是Router选错或Session创建失败。

实际调用顺序：

1. [WebUiChannel.process](../../src/web-ui-channel.ts#L202)先调用Router，再调用原`freezeTopicRoute`。
2. [freezeTopicRoute](../../src/web-ui-store.ts#L141)在同一事务中创建主题、持久绑定、保存本轮路由。
3. [prepareChat](../../src/pi-executor.ts#L853)按冻结contextKey选择/创建原生主题Session，之后才启动主Chat。
4. 修前主Chat的`before_agent_start`只告知“主题由宿主冻结”，没有明确传达“当前主题会话已建立”的宿主事实；原总管提示又要求未调用工具不得声称执行。模型错误地把“没有创建主题的工具/没有创建Job或Goal”解释为“主题没有建立”。

代码与实际请求共同确认的信息缺口是：**已提交的会话状态没有明确告知主回答模型**。原始错误文本能证明概念混淆，不能据两例断言模型所有内部成因。修前回归进一步验证：SQLite在主HTTP前已完成绑定，但实际模型system消息没有已建立状态声明；修前4项1过3失败，失败指向该缺口。

## 最小修改

唯一生产修改位于[src/pi-executor.ts](../../src/pi-executor.ts#L545)的现有`before_agent_start`：当scope为chat、当前请求为主题模式、且当前Session具有宿主contextKey时，给本轮临时systemPrompt补充固定事实：

- 当前独立主题Session已经建立并持久绑定，主题会话由宿主管理，不需要模型创建工具。
- 旧历史若否认已建主题，以本轮宿主事实为准；保留旧错误消息原文。
- 会话绑定不等于创建Job、Goal、提醒或Memory，不等于启动后台自动跟进；执行结果仍按原工具收据判断。

直接使用当前Session已有的contextKey，不新增查询、状态字段、存储或模型调用。固定文案不含主题名称、简介、路径、ID或其他Session正文，不把低信任资料提升为系统指令。日常Session的contextKey为空，原提示保持相同；旧模式、临时澄清回答、后台执行不注入这条事实。Router、创建事务、Guard、工具、预算和Pi SDK均未修改；不改写或过滤模型最终回答。

## 回归与失败保留

[最小失败夹具](../../tests/fixtures/topic-host-state-failures.json)原样保留C01/C03的合成用户输入与真实否认回答；原始HTTP/SSE、Session、逐轮JSON与旧JSON/CSV不覆盖。

[新增4条回归](../../tests/topic-session-host-state.test.ts)使用真实Web/Pi/SQLite与本机假模型：

1. C01：检查主HTTP发生前SQLite已绑定、实送system含宿主事实；复用及运行时重开后仍含该事实，旧否认原文继续存在。
2. C03：同样复现求职输入，验证旧否认历史不被删改、没有新增Job/Task/Memory或额外HTTP。
3. 两主题切换后只带本主题私有历史；daily与clarify的实际请求不带“主题已建立”声明。
4. 主题模式关闭时，旧Coordinator主Chat不带新声明。

假模型首答故意固定回放旧否认，测试照样保留它，故这些测试**只证明宿主事实正确传到实际模型请求，不证明真实模型已经不再否认**。复用/恢复检查不增加语义模型请求；此处运行时重开不是新的OS强杀验收，旧真实强杀证据仍按其原版本单列。

修前首轮红测4项均红，其中1项是新测试夹具误用旧非Coordinator入口、收据API返回404；校正为目标旧Coordinator路径后，生产未改时为1过3红。两份红日志保留。修复后4/4，且原C01/C03输出未被后处理，证明修复位于输入事实层。

工程验证：`npm run typecheck`、`npm run build`、`npm run eval:router:typecheck`均退出0；主题/权限/恢复定点168/168通过。`TMPDIR=/private/tmp npm test`全量1149/1149，0失败/取消/跳过，91.131秒，退出0。没有Web代码改动，未重复web:build。

本地日志及前后Hash：`evals/reports/router-session/topic-host-state-fix-01/`，被Git忽略。原三批真实模型原件共176文件在修前记录Hash，结束时逐一复核均未改变；旧评测指标不重新计算为修后成绩。

## 文件与限制

| 文件 | 目的 |
| --- | --- |
| `src/pi-executor.ts` | 在实际主题Session主回答前传入固定宿主状态 |
| `tests/topic-session-host-state.test.ts` | 检查实送上下文、真实绑定、旧历史保留及作用范围 |
| `tests/fixtures/topic-host-state-failures.json` | 原样保留C01/C03输入和否认输出 |
| `docs/evaluations/topic-session-host-state-fix.md` | 根因、红绿证据与验证边界 |
| `docs/STATE.md` | 当前修复状态及下一步交接 |

本轮没有新增收费调用，也没有验证修复后真实模型的否认发生率。原真实验收100%路由、0/38污染等成绩只对应修前冻结版本，不能自动继承为修后验收。后续若明确授权，可只复验两条原失败及一条复用续聊，保留当前对照，避免重跑完整收费数据集。
