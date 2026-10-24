# 第二轮分阶段Console真实验收报告

日期：2026-10-24（Asia/Shanghai）。固定提交：`7e96d4e869a7efee9a4a3e33cb2e97ec128f142c`；分支`codex/staged-console-prep`。

**本轮未通过，已正常停服。** 执行A1、A2、B1：A1通过，A2机械状态通过但真实模型收据解释失败，B1成功取回固定文档但没有选择/read agent-notes。按冻结停止规则，其余9个Case未执行。未改话术、重试、补答、补测、重取网页或追加预算。

## 授权、配置与执行前置

- 用户一次性批准A/B/C共12个Case，46次模型HTTP／¥8保守预留；阶段28/4/14次及¥4.62/0.66/2.32不互借，固定pi-skills-v1最多一次GET。
- 按[冻结方案](staged-console-live-plan.md)使用全新根`E:/AgentWork/acceptance/staged-console-live-20261024`、新staged-budget.json，未复用原32/6或V3.0.1额度。最初前置未满足时没有启动，原[执行前报告](staged-console-live-preflight.md)/[JSON](staged-console-live-preflight.json)保持当时快照不覆写；随后用户明确授权读取ENV必要字段，并重新确认当前账号适用公开费率且无额外收费后才运行。
- 仅只读原E盘.env的LLM_API_KEY/LLM_MODEL/LLM_BASE_URL/LLM_PROVIDER，不显示或保存Key，不读取业务路径/飞书配置，不修改正式.env。模型`deepseek-ai/DeepSeek-V4.1-Flash`和`https://api.siliconflow.cn/v1/chat/completions`匹配；隔离进程按已冻结入口指定personal-compatible宿主适配器，正式provider=openai不改。
- 本次重新核对[硅基流动官方价格](https://www.siliconflow.cn/pricing)：非低谷输入2、输出8、缓存读取0.04元／百万Token，低谷1/4/0.02；用户确认账号适用且无附加费。预留始终采用较高的输入2／输出8、不折扣退额。官方公告称同一模型ID升级至1017版本；未换模型ID，也不声称独立验证了服务权重。
- Node24.19.0、Pi SDK1.3.0，146份源码/测试/依赖及冻结方案/Case/入口Hash核对一致。执行前入口专项7/7通过，包含原子预留、容量/次数/费用、一次GET、跨重启及失败不退；这些是Mock验证，不计真实模型通过。本轮未重复完整五关或Linux，不把准备阶段Windows474项/历史Linux结果冒充本轮重跑。

## 每个冻结Case的判定

| Case | 真实判定 | 模型、宿主与持久状态 | 本步HTTP／预留 |
| --- | --- | --- | --- |
| A1 | **通过** | 模型正确创建并区分v0占位；bootstrap返回一个合法正式Step、没有自编Step ID。宿主分配新UUID，待批准草稿保留全部数量/素材/partial→反馈→complete约束，绑定批准的interview-practice；成功展示，未批准或执行正式Step | 4／¥0.184352 |
| A2 | **失败**；statePass=true | 批准和独立Goal执行正确：原生Skill正文展开，零工具/一次Goal请求，partial Checkpoint持久化并等待反馈。但主Chat在后台结果出来前，误称正式片段已跑完并编造另一道题；模型原始解释与当时真实状态不一致。宿主最终展示正确，不抵消模型失败 | 4／¥0.199224 |
| A3 | 未执行 | A2语义失败，禁止以零请求重启场景绕过前置 | 0／¥0 |
| A4 | 未执行 | 依赖A3；未补发查看刷新视图 | 0／¥0 |
| A5 | 未执行 | 依赖A4；历史原话“暂停那个学习计划”未在本轮验证 | 0／¥0 |
| A6 | 未执行 | 依赖A5；未补答或继续 | 0／¥0 |
| A7 | 未执行 | 依赖A6；未取消或额外清理Goal | 0／¥0 |
| B1 | **失败**；statePass=false | 共同安全/配置/预算健康，A正常停止后独立执行B，关闭GoalRunner。模型准确调用固定web_get，取得完整快照并作有来源的总结；目录和read工具均可用，却没有选择或读取agent-notes，因此不满足完整B预期 | 2／¥0.141414 |
| C1 | 未执行 | A/B未全部真实通过，不提供审阅声明 | 0／¥0 |
| C2 | 未执行 | 无联合Goal，不绑定资料；不人为替换快照 | 0／¥0 |
| C3 | 未执行 | 无已批准Skill/Web联合Plan，不运行 | 0／¥0 |
| C4 | 未执行 | 联合执行未发生，不以其他重启代替 | 0／¥0 |

A1、A2进程退出0；B1退出1是机械判据不通过，原main仍正常完成关闭。原始Run均技术succeeded不代表场景业务通过。A2的statePass=true也不能替代语义判定，所以没有继续A3～A7。A1→A2确实跨进程恢复了计划、Session与累计账本，A2→B1恢复后原Goal未变；B关闭GoalRunner，这些附带观察不能冒充A3/C4的正式恢复验收。

## A1：首次计划身份与数量的真实证据

- Goal：`9f64abc4-6c73-491d-aac8-4abb2ac60143`，名称原话保持“青桐阅读计划”，完整objective不含“学习计划”，未改名避开历史指代问题。
- bootstrap Step：`1edd1bb3-d988-4807-931b-e479be101e93`；正式Step：`5a46b94a-62be-4aba-ad86-e257bcde23a6`。response-04.txt的proposedPlan省略Step ID，由宿主管理新身份；正式Plan v1只含一个Step。
- Skill：interview-practice@1.0.0，包Hash `36a23f6ca5fb402aa10e910b73ee3a7470c6c3062027bea81da4ec88fcd0da83`，进入待批准草稿Hash及正式Plan。出题、等待和点评作为同一Step的子交付，未静默裁剪或增加正式步骤。
- response-03.txt正确说明当时ready/v0/尚无可审批草稿，等待bootstrap；随后独立初始化结果形成真实待批准草稿并展示。有限结论是本次首次计划优选契约通过，不能由一个样本证明所有ID反例的真实成功率。

## A2：真实失败、宿主防护及Session

request-07.json中的工具收据实际为ready、revision3、Plan v1、Checkpoint已提交。该Checkpoint仍来自bootstrap（v0），正式Step的请求request-08.json尚未发生。response-07.txt却说：

> 正式计划已经批准，第一个片段也已经跑完，结果记进了 Checkpoint。

接着它自行给出“宿主、Pi和工具白名单各自负责什么”的题目，并表示当前已partial等回答。真正Goal随后在response-08.txt交付的是“白名单外工具及跳过Checkpoint为何不成立”的另一道题。

宿主没有把编造的题目提交为Checkpoint，也没有追加模型纠错：用户可见前台结果使用真实宿主控制收据；后台独立产出才写入partial Checkpoint并投递。原生Session保留模型错误原文，另追加2条host-goal-result-v1收据；没有改写错误证据。Run/Plan/Execution/Checkpoint无非预期授权或重复执行。

**可确认的表现**是模型混淆“已有bootstrap Checkpoint”和“当前正式Step已交付”。源码OperationGuard的收据只对Goal级checkpointRunId输出“已提交”，缺少所指Plan/Step/Run及是否当前片段的区分；这与失败形态一致，属于后续最小修复的重要线索。尚不能证明它是唯一原因，也不能声称在本轮已修好。

B后续回答还自发提到旧Goal等回答，但未调用Goal工具或改变状态。持久Session同时包含错误原文和宿主纠正收据；错误是否会在后续控制中继续传播尚未验证，不能凭纠正收据存在就认定模型已理解。

## B1：一次固定GET成功，Skill自动选择失败

唯一来源为冻结的`https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md`，资源pi-skills-v1、版本pi-1.3.0。成功快照4793字节，Hash `5b9805525b194474ef1fe5455a0917ef15ed7f710aa9bec2eee11879556469e5`；全文进入request-10.json的低信任ToolResult，shownBytes=4793、excerpt=false。

| 阶段 | 本轮时间（UTC） |
| --- | --- |
| 宿主Web预留 | 03:14:27.543 |
| DNS开始／完成 | 03:14:27.549／03:14:28.430 |
| 连接／创建请求 | 03:14:28.455／03:14:28.459 |
| TCP／TLS验证 | 03:14:30.066／03:14:30.406 |
| 本地发送完成 | 03:14:30.422 |
| 响应头／正文开始 | 03:14:31.002／03:14:31.006 |
| 完整响应／成功快照 | 03:14:31.047／03:14:31.050 |

成功路径通过冻结NodeWebTransport的HTTP200、类型和容量检查，并有完整响应及快照证据，支持本轮GET1次；没有仅凭req.end/本地finish推断远端收到。整轮预留已消费，不退款或重取。上轮W1没有这些阶段证据，其实际GET仍保持未知0～1，不能用本轮倒推或解释旧超时根因。

response-09.txt只调用web_get，response-10.txt直接总结，无read调用、无skill_activated。agent-notes目录描述和受限read都实际进入这两次请求，因此是**模型未主动选择Skill**，不是宿主拒绝Skill，也不是网页失败后失去后续机会。描述偏向“已经提供的资料、不自行访问外部来源”可能影响路由，但本轮没有对照试验，只记录为待离线分析的假设；不为冻结话术硬编码调用。

## 账本、Token与费用

| 阶段 | 模型HTTP／上限 | 保守预留／上限 |
| --- | --- | --- |
| A | 8／28 | ¥0.383576／¥4.62 |
| B | 2／4 | ¥0.141414／¥0.66 |
| C | 0／14 | ¥0／¥2.32 |
| 整轮 | **10／46，均HTTP200** | **¥0.524990／¥8** |

接口自报输入共28757 Token：未缓存16469、缓存读取12288；输出2341，思考Token0。SQLite的inputTokens按未缓存口径为16469，cacheReadTokens12288、outputTokens2341，与原始usage相符；10条model_calls的cost均null。

按本轮实际发生时段和确认费率计算，Token费用估算约**¥0.05215752**；这是接口Token乘单价的估算，**不是供应商实际账单**。保守预留¥0.524990独立保留、不退款；未查询供应商账单，不对账号其他消费作判断。剩余36次请求及余额不再使用，Web唯一额度已消费。

## 正常停止、持久审计与证据

- 真实进程已全部退出，匹配该根的Node进程0；staged/数据库/Memory锁及pending均不存在，未手工清锁；WAL为0字节。
- SQLite完整性ok、外键检查空；Goal1、不可变Plan2（v0/v1）、Step2（bootstrap/正式）、Execution2且都committed。第一个为bootstrap complete，第二个为正式partial，后者引用前驱Checkpoint；Hash与输入/原子提交一致。Goal最终waiting_user、revision5、Plan v1，未擅自暂停或取消作清理。
- 原生Console Session1份、3条本轮用户输入、2条宿主收据；后台Goal是独立临时Session，零工具、各一次模型请求。Task0、Memory知识Markdown0，候选/Formation/策略/Trigger/Grant/Observation/Outbox/飞书记录均0；Memory空目录/索引是正常启动元数据，不是知识保存。
- B运行后A的Goal、Plan、Step、Execution逐项不变。正式四项能力默认关闭，不启用主动策略或正式Agent，无手机/飞书或外部写操作。
- 原E盘8项修改、原main工作树三份文档、审查修复工作树8份文档及78份旧数据/证据Hash一致。146份产品及验证源文件不变，所有旧报告/方案/账本保留；本轮只新增报告和STATE更新，没有产品代码修改、提交或推送。
- 数据根见上文；证据根`E:/AgentWork/validation/personal-agent-staged-live-20261024`包含Case审阅/判定、原始控制台日志、SQLite/Session审计、全部源/数据Hash清单。模型原始请求/脱敏响应、原生Session和SQLite留在隔离根，不上传原始数据。部分早期审阅辅助脚本用错字段名的导出错误没有触发网络重跑；最终审计使用实际runId、事件at和顶层Token字段，原始数据未改。

| 关键原始文件 | SHA256 |
| --- | --- |
| SQLite | `2e0e9ca7686590abd00a4266bb17b4f0c2cde7cfd2dffb0235d4fe74c04f12f1` |
| 新账本 | `140ac865aefe96663c9af7357a02ee8bb3324e204ce640e1b81b5575af57a093` |
| A2错误解释response-07.txt | `37a2ac9f92f77d70157b1195b137e1d97173673e72fedec7f407bcd7896016d1` |
| 正式Goal结果response-08.txt | `99be1924811dbcfd34c89c4caeae7f0a6253597b8a9896fcb92cfdac07648f94` |
| 全文进入模型的request-10.json | `d1a25d3a88fd402d99d27e0e05160d08437c733364250bb85d133633f5a80786` |
| 原生Session | `088893f9a14b0a3a94f1f18422a95cd966793fad56967ffd0a06d0d19b464515` |

详见[机器报告](staged-console-live-acceptance.json)。冻结方案、入口和Case Hash分别为50011284…、a9a0c611…、d4702cc0…，完整值及每请求账本/Token在JSON中。

## 结论与下一步建议（未实施）

本轮获得两项有限真实正证据：首次计划身份/数量/审批契约，以及批准后的Goal Skill展开与partial持久化；固定文档获取及低信任正文进入下一请求也通过。**S0/S1/Goal整体真实验收仍未通过，正式主动执行不可据此启用。** V3.0.1自然暂停本轮未执行，收据解释本轮再次失败，两项历史门槛都继续开放。

1. 优先离线收紧Checkpoint收据的Plan/Step/Run归属与“已批准、已排队、已执行、已交付”区别，使用本轮request/response07构造回归；不能靠新增收费纠错掩盖主模型误解。
2. 离线核对主Chat对后台产物的可见性：保留真实宿主收据和错误原文，避免把旧模型题目当作当前正式Checkpoint；具体方案需要维持现有Session/Goal语义，不引入新状态机。
3. 离线分析agent-notes描述与取数后整理的适用边界，验证原生目录/read契约；不硬编码冻结话术路由，不扩工具权限。
4. 下一轮验收设计可考虑让自然暂停的独立前置不被其他模型解释失败掩盖，但须新冻结方案及单独批准；本轮不临时改顺序、重启补测、追加调用或消费余额。
