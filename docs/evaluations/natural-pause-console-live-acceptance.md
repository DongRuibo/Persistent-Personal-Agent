# 独立自然暂停 Console 真实复验

2026-10-26（Asia/Shanghai）。**本轮自然暂停目标通过；计划生成质量仍未通过。** N1真实创建、N2有效视图、N3历史原话暂停均完成，不以statePass替代语义判断。没有修改产品、补答、重试、额外Case或用完余额。旧P1失败、P2/P3未执行和R1/R2/S1通过保持原判。

## 基线与执行范围

- 固定提交 `83733d97a8334e5f21d9a092344ac8c0d4139e96`，分支`codex/natural-pause-prep`，Node24.19.0、原版Pi1.3.0。运行北京时间 **13:37:47–13:39:21**。执行前停在核价前置的快照单独保留，没有提前消费。
- 本轮授权N1/N2/N3各一次，最多14物理HTTP/¥2.31/零文档GET，新scope`natural-pause-console-v1`。固定模型`deepseek-ai/DeepSeek-V4.1-Flash`及`https://api.siliconflow.cn/v1/chat/completions`，没有切换。
- [官方价格页](https://www.siliconflow.cn/pricing)重新核对：非低谷输入/缓存/输出¥2/¥0.04/¥8每百万Token；每日02:00–08:00为¥1/¥0.02/¥4。用户本轮确认账号适用且无附加费。预留取较高费率。
- 仅获批提取正式.env四个LLM字段，在进程内注入，不显示、保存、Hash或提交Key；正式provider=openai按既有baseUrl逻辑映射到冻结入口的personal-compatible适配器，不改正式配置。
- 全新数据`E:/AgentWork/acceptance/natural-pause-console-20261026`；证据`E:/AgentWork/validation/personal-agent-natural-pause-live-20261026`。只开启隔离Goal，Skills/Web/Formation/Proactive/查询改写关闭，后台text_only零工具；无飞书。

## 逐Case判定

| Case | 真实模型与宿主结果 | 判定 | HTTP | 保守预留 |
| --- | --- | --- | ---: | ---: |
| N1 | goal_manage真实创建；唯一bootstrap正常committed partial、无proposedPlan，Goal waiting_user | **创建/合法初始化通过**；**未形成待批准计划，计划质量未通过** | 4 | ¥0.175984 |
| N2 | 真实view，唯一完整目标视图成功投递；revision2，无draftHash，displayRunId及TTL有效；计划/成果不变 | **有效视图通过** | 3 | ¥0.148778 |
| N3 | 原话“暂停那个学习计划”；解析器pause、keywords=[学习计划]、reference=last；宿主据唯一有效视图绑定青桐目标，一次CAS提交paused/revision3 | **真实自然暂停通过**，原模型解释、宿主、SQLite与Session一致 | 3 | ¥0.169772 |

N1确切原话和其余两句均与冻结Case一致，见[机器JSON](natural-pause-console-live-acceptance.json)。主Chat分别为物理响应03/07/10；后台bootstrap为04。原始请求响应均完整保留。

### N1：创建不等于计划生成

主Chat先正确调用goal_manage，隔离解析器create。工具当时返回ready/revision0、Plan0初始化、无草稿/Checkpoint；响应03正确说明尚未产生正式计划和成果。后台随后独立请求04提交partial，Goal变waiting_user/revision2。不能用后来的提交倒推此前主Chat已收到成果。

后台又把“青桐阅读”理解为篇目/材料对象，要求书目、总周期、每周时长和划分偏好，并要求用户再明确最多N步。原话已限定虚构资料、未规定日历或数量；这些追问存在不必要摩擦，未满足先拟待批准安排。它没有虚构具体书目或时间；缺必要依据时仍可合法澄清，partial无草稿本来符合宿主契约。模型为何这样解释的内部原因未知。

成果中“先提交阅读安排草稿”等措辞不代表SQLite已有草稿，实际pendingActionJson和proposedPlan均null。**新N1只允许这一合法持久状态进入暂停验证，不把旧P1改判通过。**

### N2/N3：授权、归属及时间

- 唯一Goal `69e922b8-98e7-4918-96b2-70fcb42df4f5`，local-user/Console，与冻结目标原文一致；目标名不含连续“学习计划”。
- N2展示Run `afdfe4a0-fba0-4aa0-8397-ee142294b7b8`，有delivery_succeeded；视图details=true、单一目标、revision2、无draftHash，与当前状态匹配。没有手插Goal或伪造Session/视图。
- N3控制Run `daf880a7-dc1b-4ca6-a8af-b13c03ff9a00`。05:39:18.236Z以revision2授权，05:39:18.239Z提交pause/revision3；距视图到期还剩 **262.762秒**。未刷新查询。
- 全轮goal_control为create和pause各一次；**pause仅一次**。Goal仅status、revision、updatedAt变化；Plan、Step、待批草稿、Execution、Checkpoint和输入Hash不变；查看/暂停不新增执行或授权。
- 响应09未直接输出UUID，而是pause+自然泛称+last；宿主仍用可信视图、身份/渠道、revision与CAS确定目标，模型参数没有成为权限来源。响应10准确回答paused、版本3、Plan0、bootstrap partial和进度保留，没有编造正式产物。

## 宿主呈现、Session与SQLite

最终用户可见结果由宿主输出“控制已保存”及真实状态；原模型回答另存于原生交互Session，**不使用宿主覆盖冒充模型原始理解通过**。本次响应10本身正确，因而两项独立通过。

Session有3条冻结用户消息、3条host-goal-result-v1收据，原生类型为custom_message。收据为状态摘要；Run.output另外带Step列表和已提交成果，内容归属一致，不要求字节完全相等。跨进程后的请求05和08确实可见已有宿主收据；隔离意图解析请求09没有历史Goal UUID/收据或工具。后台临时Session没有复制到交互Session。

最终SQLite：1 Goal paused/revision3、1 Plan v0、1 Step waiting_user、1 committed bootstrap Execution及1 partial Checkpoint、4个succeeded Run、10个ModelCalls、53个事件。integrity_check=ok，foreign_key_check=0。Task/Memory知识及候选/Formation/策略/Trigger/Grant/Observer/通知/Web读取/飞书均无新增。

三个Case均exit0并正常停服；验收子进程0，锁0、pending0、running/interrupted Run0、未完成Execution0、WAL0字节，SHM文件可以存在但不表示在运行。最终审计使用SQLite ro&immutable=1；审计前后新数据文件Hash不变。

离线汇总曾误把收据筛选成type=custom，首次摘要得到0；保留该摘要，按customType与原始Session确认custom_message收据3条并另存reviewed摘要。这是审计提取口径纠正，不是产品失败或收费重测。

## 消费、预检与证据

- **10/14物理模型HTTP，全部HTTP200**，每条均有发送前持久预留及对应request/response；Case各只消费一次，不退款、不重置、不重试。最大请求20314字节，输出上限4096；bootstrap单次请求6036字节、零工具。
- **¥0.494534/¥2.31保守预留**。未缓存输入10598、缓存输入18304、输出1385 Token。按本轮确认非低谷费率估算 **¥0.03300816**，不是供应商实际账单；账单未取得，不能据此宣布实际扣费。
- **公网文档GET0**；未加载read/web_get，web_read_calls0。没有访问Pi文档、另取资料或旧账本。剩余4请求及费用空间不再消费。
- 执行前专项：natural-pause及independent-console预算测试 **9/9通过，0跳过**，覆盖scope隔离/14次与Case6/4/4/人民币闸/容量/未知费率/重启/pending/GET发送前拒绝。方案/入口/Case/运行源码Hash与准备快照一致。
- 本轮未改产品，不重复全量typecheck/build/npm test/两个eval或Linux；前一准备批次Windows492项489通过/3跳过、五关0是历史证据，非本轮重跑。
- 原E盘8项改动、其他6工作树、72份历史证据及旧账本Hash均保持；新数据31文件已独立只读复制并核对Hash。

| 关键对象 | SHA256 |
| --- | --- |
| 冻结方案 | `55a36b74e27032cf4015d5619bd247540dd04d4f88db3dcc5bf6de81e1fe6bca` |
| 运行源码聚合 | `44e5bd3d848da961825156c97a3978582e840c4551e09f84ce30587dfd6c7c2f` |
| 新预算账本 | `cc57c736d2763c5c2a04755fd40b0ccc4697b35b41c131c70a12ae4e3a601e8d` |
| SQLite | `b102c04605e5d11bff3488e88af844c027cb7970143c3bfe0a0057b7f1918d87` |
| 原生Session | `5efdb51a5491138a2ca23a88d6d0d4140c87a6af6a99290403512257b9f1e047` |
| Plan v0内容 | `8be1b88f3e72252e9bce3b7dc443917ff3ca0392dbf0a5700c37be8b589b3db8` |
| Checkpoint | `7e6ab8599cf7ecb7e3563821aa0129d6bdc5ab1b8d0af381288f353a28651a69` |

证据目录保留N1/N2/N3-console.log、process/review/parsed-responses、raw-acceptance-copy（请求/响应、SQLite、Session、Case审计与预算原件副本）、final-readonly-reviewed-audit.json、session-context-and-receipts.json、preservation-before/after.json及Hash清单。详细记录见[JSON](natural-pause-console-live-acceptance.json)；冻结[方案](natural-pause-console-live-plan.md)和所有历史报告不改。

## 门槛与下一步

本轮为历史原话在**初始化后静止waiting_user、无草稿、唯一有效视图**的真实成功样本，可以交由ChatGPT审阅这一窄场景的自然暂停门槛。不能外推有草稿、已批准、ready/running、迟到结果、继续/取消、Skill/Web联合、飞书或正式Proactive已验收。历史失败仍保留；R2收据和S1路由已有成功不重跑。

下一项值得分析的是有限资料下不必要澄清及“草稿”的口头表述；本轮不修复或新增收费Case。报告、机器JSON与STATE为本轮仅有仓库修改；无Git提交、推送、合并或部署。验收已结束，等待独立审查和下一阶段授权，不自行使用余额。
