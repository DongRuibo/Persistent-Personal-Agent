# Router与多Session真实连续对话验收

日期：2026-11-09。生产基线`ead27a7`，评测工作树`/private/tmp/ppa-router-session-eval`、HEAD `5f4764d`。本轮不修改生产逻辑或SDK，不提交、推送、部署或操作正式实例。

**结论：三个主题的真实Session隔离和恢复在本次短对话中有效，可继续小规模、有人监督的试用；回答与宿主状态的一致性仍有缺陷。** 首轮有一次评测客户端限流中断，保留原件并补验，不能把它说成模型误路由，也不能用补验覆盖首轮成绩。

## 验收范围与证据层级

本轮是真实模型端到端链路：Web HTTP单入口 → 原`WebUiChannel`/`routeTopic` → 原SQLite主题冻结与绑定 → 原Pi主Chat/工具Guard → 原生Session JSONL。模型为本机既有硅基流动`deepseek-ai/DeepSeek-V4.1-Flash`，所有样本、历史及校验码均为本轮合成数据。未加载正式用户Session、Memory或数据库。

使用原[运行时组装](../evals/environments/router-session-runtime.ts)及新的[评测子进程](../evals/fixtures/router-conversation-process.ts)。子进程不持有真实Key，只将原始模型正文转给父进程计量并逐字节中继。保持生产工具、提示、max_tokens与零重试；中继缓冲SSE，故不测流式延迟。调用前校验实际模型及关闭推理参数，按实际字节和实际输出上限预留。未运行`main.ts`进程锁、Scheduler、Worker、Goal、搜索、文件或浏览器UI；结论不覆盖这些范围。

[21轮人工可改数据](../evals/datasets/router-conversation-v1.json)在首轮前冻结，Hash写入manifest；本轮没有修改gold。原有80条Mock及20条Router-only真实语义结果均不并入本轮分母。

| 阶段 | 内容 |
| --- | --- |
| C01—C06 | 分别创建健身、求职、项目Alpha，写私有Canary与约束，代词续聊 |
| C07—C12 | 三次纯切换后继续原主题，检验旧历史 |
| C13—C14 | 在求职中提项目名称，不读取项目Session，再以“它”续聊 |
| 强杀 | 首轮因收据限流，在C14尚未结束时SIGKILL；补验改为空闲SIGKILL |
| C15—C20 | 三次切回原主题，核验旧绑定、原Session ID、历史及Canary |
| C21 | 健身/求职未定，要求先选择；预期clarify |

## 指标

| 指标 | 首轮21轮 | 定点补验8轮 |
| --- | --- | --- |
| 原始真实模型Routing Accuracy | **15/15 = 100%** | **4/4 = 100%** |
| 宿主最终路由，严格全分母 | **20/21 = 95.24%** | **8/8 = 100%** |
| 确定性纯切换 | 6/6 | 4/4 |
| 创建准确率 | 3/3 | 不适用，无新建 |
| Session Reuse Precision | **100%**，TP16/FP0 | **100%**，TP8/FP0 |
| Session Reuse Recall | **94.12%**，TP16/FN1 | **100%**，TP8/FN0 |
| Session Reuse F1 | **96.97%** | **100%** |
| Context Contamination Rate | **0/30 = 0%** | **0/8 = 0%** |
| 自身历史应到达/实际到达 | 11轮/10轮；1轮未进入Chat | 4轮/4轮 |
| Session Recovery Rate | **3/3 = 100%**，在途路由强杀 | **3/3 = 100%**，空闲强杀 |
| 自动逐轮判定 | 19/21，退出1 | 8/8，退出0 |

原始模型只统计真实`topic_route` HTTP提议，不含确定性选择或主回答；首轮C14模型给出正确use，但宿主尚未完成处理就被测试终止。宿主严格20/21及复用FN1是把这次端到端观测失败留在分母的保守统计，**不表示发现一次模型语义误路由**。只看可观测最终路由为20/20，另有1轮未知；补验也不把未知改写成首轮成功。

复用检查不仅计主题数量：逐轮核对目标ID、原chatContextKey及对应JSONL文件的原生Session ID。首轮可观察19个主题路由、补验8个均保留正确物理绑定/创建关系；首轮另有1个clarify、1个未完成路由。错误目标会同时计FP/FN。本轮创建由真实Router完成，没有用gold预建主题。

两个运行含重复探针，不能合成29个独立样本或19个独立语义题。恢复也不报成6个独立主题。样本短且由Agent设计，未做独立人工标注一致性验证，100%不是生产稳定性证明。

## 实际模型上下文

两轮合计**38次真实HTTP，私有Canary污染0/38**；其中主Chat **0/18**、Router **0/19**、无历史临时澄清回答 **0/1**。零模型HTTP的纯选择排除在分母之外。真实主Chat的18次HTTP含首次建题及一次memory_search后的后续模型请求。

三个Canary都经用户消息进入原生Session。检查实际送往供应商的完整正文：本轮用户主动提供的Canary允许出现；主Chat允许当前预期主题的历史Canary；其他主题私有Canary，以及Router/澄清回答中的历史Canary，均算污染。共15轮要求旧历史，其中14轮在实际主Chat请求中收到自己的Canary；首轮C14没有进入主Chat，不能以空上下文算通过。

主题目录的名称/范围简介是设计允许的路由元数据，可能包含城市或技术栈，不属于Session全文泄漏。本轮Canary没有进入这些简介。C13主Chat只读求职历史，要求用户补充项目技术细节，没有从项目Session取回其私有校验码。不能据此声称已穷举所有语义层面的信息泄漏。

Memory索引实际记录为0，模型Context的memory_context均为空；C01真实调用一次memory_search返回空数组，没有写入记录。没有给Memory播种共享知识，所以**本轮没有测出允许共享记忆开启时的真实隔离质量**，旧离线共享Memory指标仍单列。最终Job/Task均0。

## 两次真实进程恢复

首轮PID5989被SIGKILL后，新PID6008启动；C14遗留Run从running变为interrupted，没有自动重放，恢复时自动模型HTTP为0。三个主题文件在启动前后SHA-256相同，后续三个主题探针均读回旧历史、原绑定及原Session ID。

补验从首轮隔离持久化目录的副本继续，原件不变；先明确选求职并完成C14，再在空闲时SIGKILL PID6103，新PID6106启动。三个主题JSONL在启动前后仍逐字节相同；三个恢复探针均通过，自动模型HTTP为0。

原始`restart.snapshot_unchanged`两次均为false，原因已逐项核对：无对话的日常根Session在初始化追加model_change/thinking_level_change元数据；首轮另有预期的running→interrupted。三个主题的历史、ID和绑定未丢失。报告保留该原始false，不把全部快照声称为完全不变。未触发压缩，也未证明真实摘要质量。

## 保留的问题

1. **回答否认已创建主题：C01、C03。** SQLite已建立健身/求职及独立Session，模型却回答“没法创建…主题”或“不会创建…独立主题”。私有历史后续能正常复用，因此不是未创建或串题。自动路由/隔离断言没有覆盖这类措辞，本报告及CSV另加人工审阅失败，不把自动19/21当完整产品通过率。主Chat实际提示混合主题冻结与工作创建约束，且未回读明确的本轮创建收据；这提示Session与Job/Goal可能发生概念混淆，尚不能断言唯一根因。本轮不修改提示或生产逻辑。
2. **C06漏答TypeScript。** 实际请求包含本主题技术栈和Canary，回答只明确提SQLite，未满足“复述技术栈”，自动判为失败；不是历史缺失或跨主题泄漏。
3. **C14评测客户端429。** 首轮每50ms轮询收据，触发原Web入口每分钟600请求限制（[实现](../src/web-ui-server.ts#L148)），不是硅基流动429。没有自动重发用户消息。只把评测轮询改为每秒一次，从原数据副本补验R00选择求职、C14、C15—C20，全部通过；首轮输出、输入、失败及退出1不覆盖。补验明确接续预算，不重置5元额度，也不更改生产限流。

## 费用与验证

本轮新预算5元，与此前Router-only实验分开。共38HTTP，usage38/38可观测，输入**59049**、输出**2740** Token；没有供应商自动重试。按请求完整字节+256及生产max_tokens逐次预留，最终输入预留247659、输出预留87552，金额预留**2.989335元**，低于5元。

[官方中国站价格](https://www.siliconflow.cn/pricing)在2026-11-09显示本模型最高档输入2元/输出8元每百万Token；本轮预留按输入5元/输出20元计算，不扣除缓存折扣。按可观测usage及公开最高档估算**0.140018元**，不等于真实账单；**actual_cost_cny仍为null**，未读取账户账单。没有用低价估算追加请求。

实际检查：`npm run typecheck`、`npm run build`、`npm run eval:router:typecheck`均退出0；三个评测文件定点**10/10**；`TMPDIR=/private/tmp npm test`全量**1145/1145**，0失败/取消/跳过，86.624秒，退出0。没有Web改动，未重复web:build。生产src与既有业务测试未改，旧评测原件未覆盖。

## 交付与复现

- [输入数据](../evals/datasets/router-conversation-v1.json)、[Runner](../evals/runners/router-conversation.ts)、[预算及Context判定](../evals/evaluators/router-conversation.ts)、[子进程传输](../evals/fixtures/router-conversation-process.ts)、[评测测试](../tests/router-conversation-evaluation.test.ts)。
- [摘要JSON](../evals/reports/router-conversation-summary.json)、[29轮原始判定CSV](../evals/reports/router-conversation-results.csv)。CSV保留首轮C14失败及C01/C03人工问题，补验单独标run。
- 本机原始证据：`evals/reports/router-session/conversation-live-01/`与`conversation-live-02/`，包含请求正文/SSE/逐轮JSON/Session副本/manifest/Hash/预算流水/进程生命周期；`conversation-validation/`含复算及工程验证日志。均被Git忽略，未纳入待发布内容。
- [运行说明](../evals/README.md#真实连续对话验收)。默认prepare零模型请求；新增收费实验需重新明确授权，不能默认延用剩余额度。

下一步优先单独定位并修复“宿主已建题、回答却否认”的状态表达，再做小规模失败集复验；不建议为这组短对话的100%路由继续盲目扩样或调整Router。本轮没有实施该修复。
