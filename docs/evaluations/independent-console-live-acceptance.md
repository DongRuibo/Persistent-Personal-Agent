# P/R/S独立Console真实复验（2026-10-26）

**本轮部分通过，未完整通过；所有进程已正常停止。** 六个冻结Case中，P1失败、P2/P3按前置规则未执行，R1/R2/S1通过。没有补答、刷新视图、重试、纠错请求或额外Case。没有修改产品代码、Skill包、冻结方案、历史报告或预算。未提交、推送、合并或部署。

固定提交：`0d0725c1aeeb9e6a498dca5a5f6b1fdcdcf0d5a0`；分支`codex/independent-console-prep`。使用[冻结方案](independent-console-live-plan.md)及其原入口；详细状态、逐Case评分、用量、时序与Hash见[机器报告](independent-console-live-acceptance.json)。

## 授权、前置与执行范围

- 本轮用户明确授权P1/P2/P3、R1/R2、S1，最多30次物理模型HTTP、¥5保守预留，P14/¥2.31、R12/¥1.98、S4/¥0.66不互借，公网文档GET为0。
- 固定`deepseek-ai/DeepSeek-V4.1-Flash`和`https://api.siliconflow.cn/v1/chat/completions`。执行前重新查看[硅基流动官方价格页](https://www.siliconflow.cn/pricing)，非低谷输入/缓存读取/输出为¥2/¥0.04/¥8每百万Token，低谷为¥1/¥0.02/¥4；用户本轮另外确认当前账号适用这些价格、无额外费用。实际请求发生在北京时间01:07—01:09，使用非低谷费率。
- 进程、用户和系统环境最初均无LLM配置，未发送模型请求。用户随后明确批准只提取正式`.env`的四个LLM字段；仅在进程内注入，未显示或保存Key。模型及端点匹配，原配置provider为openai，隔离进程按冻结入口要求使用项目原有personal-compatible适配器；不修改正式配置、不换模型。
- Node v24.19.0、原版Pi 1.3.0。入口六项离线检查重新运行，6通过、0失败/跳过，包括原生Pi、真实SQLite、模拟模型的跨进程链路及预算/停止反例；这部分不是收费验收。无产品修改，未另行重复全量build/eval或Linux回归。
- 全新数据根：`E:/AgentWork/acceptance/independent-prs-console-20261026`；证据根：`E:/AgentWork/validation/personal-agent-independent-console-live-20261026`。P/R/S各自数据库、Memory和原生Session，一份新总账本。旧轮数据库、Session和账本未打开或续跑。
- 正式开关不变。P仅Goal开启；R仅批准interview-practice；S仅批准agent-notes 1.0.1。Web、Proactive、Formation、查询改写关闭，未连接飞书。官方核价通过研究工具进行，与产品文档GET计数分开。

## 逐Case结果

| Case | 模型原始行为与语义判断 | 宿主和持久结果 | 判定 | HTTP / 保守预留 |
| --- | --- | --- | --- | --- |
| P1 | Chat提议goal_manage，解析器正确create；主Chat按当时收据准确说明尚无草稿。后台把“青桐”当成需要另外提供篇目的阅读对象，追问篇目、周期、时间，返回partial且无proposedPlan | Goal真实创建；v0 bootstrap一次committed/partial；waiting_user、revision2，pendingAction为空。没有可批准正式草稿；不是提交异常或Guard误拒绝 | **失败** | 4 / ¥0.176262 |
| P2 | 未发话术 | P1前置失败，不查看、不刷新 | **未执行** | 0 / ¥0 |
| P3 | 历史原话“暂停那个学习计划”未发送 | 未得到P2唯一有效视图；未调用暂停，不能评价自然暂停是否已修好 | **未执行** | 0 / ¥0 |
| R1 | 真实create；后台返回单Step计划，保留首次partial等待回答、答后点评complete、固定Skill。主Chat准确标注其聊天草案尚未持久化，但建议再确认生成草稿，属于额外交互建议 | 后续bootstrap自行提交合法待批准草稿并成功展示，宿主分配新Step ID、绑定Skill实际Hash，正式步骤未执行。无需采用主Chat的额外建议，按冻结R2继续 | **通过**，交互建议保留观察 | 4 / ¥0.186756 |
| R2 | 主Chat明确Plan v1已批准、当前Step排队且未领取；旧Checkpoint属v0/bootstrap，不是正式题目。不编造题目，不宣称已经交付 | 宿主收据与当时ToolResult一致；随后独立Goal原生展开Skill、一次模型请求、零工具；正式Step提交partial、成功投递并waiting_user。原始解释和宿主呈现分别通过 | **通过** | 4 / ¥0.210180 |
| S1 | 用户未提Skill ID；真实模型自行调用read读取agent-notes，随后完成职责/调用关系笔记，区分原文事实、推断和未知 | 受限read成功，1083字节完整正文进入下一物理请求；无旧Goal上下文，无Task/Memory写入 | **用户任务通过；自动选择通过** | 2 / ¥0.103860 |

P1的Run执行成功与Case失败不冲突：模型生成了合法partial结果，宿主如实保存并等待；冻结Case要求的待批准计划没有形成。P1退出码1是`statePass=false`，已正常完成、释放锁，账本没有halt或未知在途，因此按授权独立运行R/S。没有为关闭暂停门槛而接受较弱前置、手插Goal或补发查看。

P1已确认的失败形态是“有限虚构资料被模型判断为不足，且将目标名解释成阅读对象”；尚不能证明这是SDK机制错误，还是话术、bootstrap计划契约及模型理解共同作用。原始`P/response-04.txt`完整保留。

## R2：按当时收据，而非后续结果评分

R组Goal=`7a44074c-61db-4304-8cbe-d9c12f800f1b`。

| 对象 | 归属与事实 |
| --- | --- |
| bootstrap | Plan v0，Step `d467ba73-2215-4678-b232-0bb40a16ccb6`，Run `d4c7a754-673b-4729-a20e-0de691a5de3e`；complete Checkpoint仅保存计划初始化成果 |
| 正式计划 | Plan v1，Step `e29ce57d-8bec-475b-b4ae-a33187a6c87e`；新ID由宿主生成，模型response-08没有提供Step ID。草稿Hash=`7284ce2aeddb82dccb8ef78c2e7e00fb4eb3755aa06c422daa2bdc9846a24aab` |
| 审批 | Run `40e20236-3eb9-4bdb-91ee-5bfcef3a3691`批准v1并只授权一段；当时Goal revision3、ready，正式Step尚未领取 |
| 正式执行 | Run `a3ef55b0-ebe6-444b-866a-92d2a174070f`，Plan v1；Checkpoint明确引用上述旧bootstrap Run，partial/needsUserFeedback=true，最终Goal revision5、waiting_user |

关键时序（UTC；北京时间加8小时）：

1. `17:08:53.253`：宿主批准/排队快照。`R/request-11.json`的最新ToolResult明确“当前Step执行：未领取”，并标明历史v0归属。
2. `17:08:57.301`：主Chat原始response-11结束。它准确复述该快照，明确自己不会代替后台生成题目或点评。这是原始模型解释通过的直接证据。
3. `17:08:57.319`：`host-goal-result-v1`保存到原生交互Session，同样是revision3当时快照，不伪装持续更新的当前事实。
4. `17:08:57.940`：独立正式Goal才被领取；`17:08:57.964`记录interview-practice激活，Hash=`36a23f6ca5fb402aa10e910b73ee3a7470c6c3062027bea81da4ec88fcd0da83`，版本1.0.0、805字节。`request-12.json`含原生`<skill>`展开及冻结正文，工具列表为空。
5. `17:09:03.668`：正式partial Checkpoint与Run提交；`17:09:03.674`：记录成功投递。实际题目来自此Run，不来自主Chat。没有第二道主Chat编造的题目。

ToolResult、宿主最终文本和Session收据都保持原Plan/Step/Run及时间语义；最终SQLite后来变成waiting_user属于正常后续状态。通知文本在投递前生成时的`unconfirmed`不等于投递失败，实际投递另由成功事件证明。旧Execution和Checkpoint与R1审计逐字段相同，未被覆盖。

本轮R1→R2正常停服/重启后复用R组交互Session，没有重复bootstrap；未复制后台临时Session或题目进交互Session，也未增加纠错请求。

## S1：任务和路由分别判定

`S/response-13.txt`真实提议读取批准目录的`agent-notes/SKILL.md`，`request-14.json`的ToolResult正文与批准包文件逐字节一致。`skill_activated`记录版本1.0.1、Hash=`e15df5ce797d8898e572e020d3ccc4b8c49e655d80e6b0316d60b8a37c71a187`、1083字节。

原始response-14正确指出资料只提供职责与白名单关系，没有具体调用顺序、接口或测试证据；把“白名单意味着调用受限”标为推断，没有编造链接或验证结果。模型用户任务和真实自主read分别通过。S原生Session只有一条用户消息，物理请求没有P/R的Goal名称或ID；工具调用只有read，没有Memory或其他写操作。

这只证明“用户消息已提供资料”的单个正样本。**不能替代此前B1 Web取得资料后未选Skill的真实失败，也不能证明升级描述一定提高总体自动选择率。** 本轮没有Web或Skill+Web+Goal联合Case。

## 请求、Token、预算与账单

| 组 | 物理HTTP / 上限 | 保守预留 / 组上限 | 按实际Token及本轮费率估算 |
| --- | --- | --- | --- |
| P | 4 / 14 | ¥0.176262 / ¥2.31 | ¥0.01678704 |
| R | 8 / 12 | ¥0.396936 / ¥1.98 | ¥0.03504032 |
| S | 2 / 4 | ¥0.103860 / ¥0.66 | ¥0.00836104 |
| 总计 | **14 / 30** | **¥0.677058 / ¥5** | **¥0.06018840** |

14次物理POST均HTTP200，14份原始响应均有结束标记；与SQLite的14条model_calls一致。输入34155 Token包含缓存：其中未缓存18795、缓存读取15360；输出2748，推理Token0。SDK的inputTokens已经扣除cacheRead，不能重复相加。流中usage是不断更新的累计值，本报告每响应只取最后一份，不累加各delta。

¥0.677058是按发送前请求容量和输出上限持久预留；¥0.06018840是按返回Token及已确认费率的估算。**供应商实际账单未取得；SDK各cost均null，不把上述任一金额当作实际扣费。** 所有组分别核算，未互借、退款或重置，没有为了用完额度追加请求。未消费余额不授权下一轮续测。

产品公网文档GET为0，web_get未注册，三库web_read_calls均0；没有固定文档读取或重取。用于核价的官方页面研究访问独立记录，不冒充产品GET。

## 停服、数据和安全审计

- P1、R1、R2、S1均已记录finished，P1仅机械验收退出码1，其余0。控制进程收到STOP后退出0；未发现本轮Node/Python验收进程继续运行。
- 总账本halted为空，没有未完成Case、`.pending`、独占锁或数据库/Memory锁；没有running/interrupted/uncertain Run或Execution。
- P/R/S的SQLite integrity_check均ok，外键错误0；分别2/4/1条Run均succeeded，1/2/0个Execution均committed，输入及Checkpoint Hash正确。Session用户消息数1/2/1，宿主收据数1/2/0。
- 三库Task、Memory候选/Formation作业、Policy、Grant、Observation、通知Outbox、Web调用及飞书记录均0；Memory Markdown知识写入0。新建基础目录和索引不等于写入长期知识。
- 三组各保留0字节WAL与32768字节SHM；没有执行checkpoint、删除侧文件或清锁。空WAL、完整性检查及无运行记录共同表明未发现未提交帧，SHM存在本身不代表服务仍运行。
- 固定源码/Skill/方案Hash与执行授权profile一致，其他五个工作树的HEAD、分支、状态及原有文件Hash未变；原E盘保存分支8项改动保护。历史报告Hash不变；没有打开旧验收数据库/账本/原始Session。
- 正式`.env`仅按追加授权提取四字段、无写入；凭据不出现在本轮文件中。所有正式默认开关未更改，不启用主动策略，不操作正式数据或账号。

只读导出曾遇Python默认GBK解码失败，明确UTF-8后完成；初版源码清单用正斜杠，与Windows入口反斜杠JSON Hash不同，改用入口同一Node算法后Hash完全匹配。这些是离线审计脚本问题，不是额外真实请求，也没有改动冻结源码。

## 证据位置与Hash

原始请求/响应在新数据根各组的`request-NN.json`、`response-NN.txt`；Case前后审计为`P1/R1/R2/S1-audit.json`。新证据根保存四份Console日志、进程记录、`parsed-physical-responses.json`、完整只读SQLite/Session审计、源码清单和`SHA256SUMS.json`。清单覆盖本轮数据及证据，保留原始失败，不以摘要替代原文。

- 预算账本SHA256：`4853efe4dc8b186304985504ad6bb65ab171107d5ddd2c9f2c183cc92604da24`
- 冻结方案SHA256：`a64fe3bdb9ed6a7fb5664c41b9bd69beb6a1ce9a863f795450357174a2012a0f`
- 原入口算法源码Hash：`e84ce495593b2b61c2ec2b5d4ad94b4220bd5f63febdbe58d51995ad1c118f15`，与物理执行profile一致。

本次仓库只新增本报告和JSON，并更新STATE；产品、Skill包、原验收入口及所有冻结话术没有diff。无Git提交或推送。

## 门槛结论与下一步建议（不执行）

1. 自然暂停仍开放：P3没有实际发送，不能宣布历史泛称匹配已通过或再次失败。建议先离线审查P1对虚构资料及目标名称的理解，以及未来暂停复验是否只需“真实创建且可查询”的合法前置，避免把正式草稿完成作为无关依赖；若调整必须另行冻结方案，不补跑本轮。
2. A2异步收据在本次R2获得真实正证据：原始主模型理解、宿主呈现、持久收据和正式partial分别通过。旧真实编造题目的失败完整保留，这一个样本不代表V3.0.1所有操作收据、反馈、暂停、取消均已验收。
3. S1用户任务和原生自动选择均获得真实正证据；Web后自动选择和联合链路仍开放。R1主Chat建议额外确认生成草稿的交互歧义值得后续只读/离线分析，本轮不修产品或追加模型调用。

到此停止，等待ChatGPT独立审查真实证据。未授权开展修复、第二次收费重跑、合并main、推送或部署。
