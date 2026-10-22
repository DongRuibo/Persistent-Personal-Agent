# V3.0 Batch 5：电脑真实模型验收与未通过项

日期：2026-10-23（Asia/Shanghai）。开关与电脑核心生命周期已完成；**Batch5不是全项通过**。真实暂停失败后仅完成离线修复，计划粒度仍有偏差，手机及部分控制场景未真实覆盖。全部原始失败保留。

用户批准GOAL_ENABLED、测试/文档及最多48模型HTTP请求/5元保守预留，随后因手机不便改为电脑测试。实际使用48请求、预留2.337244元，达到请求上限后停止，不因费用余额增加请求。正式.env、正式数据及原HANDOFF.md未改，未日常启用；验收结束时尚未提交，用户随后另行授权将本轮代码、测试及文档提交推送GitHub main。基线为main `74704bda3deb05f5bbd64d498ab2ce66fa63fbc9`。

## 已验证与结论边界

- 生产Console/main/OperationGuard/GoalRunner/原版Pi/真实SQLite与真实兼容模型完成：创建→partial进度→失败阻塞→明确重新生成→结构化计划→批准→第一题Checkpoint→等待→正常停服重启→只执行第二题→等待→明确确认completed。所有交互话术由开发者在Console输入虚构数据，不是本人手机输入。
- 真实重启前后请求均34、Goal和Execution逐字段相同；后续唯一新Execution为原第二题，前指针为第一题Checkpoint。第一题已提交执行及Hash没有变化。最终确认只改Goal终态，不新增Execution。
- 真实创建与自然语言继续、批准、完成成功；失败时旧进度保留、没有自动重试。原始失败的初始化和第一题只有明确“重新生成”才再次执行；不能称为原始话术一次成功或未经修复的顺畅闭环。
- 真实“暂停那个学习计划”失败，没有暂停；最后的宿主引用修复只经过离线回放和完整模拟回归，**尚无收费复验**。学习安排“一项”的草稿被扩成3步，原一项计划预期未达到，未改预期或手工批准它。
- 本轮没有连接飞书、发送机器人消息或手机实测。Console共用Goal业务引擎，但不能证明飞书鉴权、消息去重、Goal通知分片/送达或手机呈现。旧手机连通仅为历史证据。取消、计划调整、多个活动目标澄清、运行中暂停/取消竞争、通知故障本轮仍只有自动化证据，未记真实通过。

## 修改文件及目的

| 文件 | 目的 |
| --- | --- |
| `src/config.ts` | GOAL_ENABLED默认false，只接受显式true/false |
| `src/main.ts` | 关闭时不组装Goal Service/Runner，不领取已有ready；输出开关状态 |
| `src/pi-executor.ts` | 工具、聊天提示及直接Goal请求受开关控制；明确目标筛选/反馈分离、继续与替换区别、单轮一次调用、新Step ID及四项必填结果契约 |
| `src/operation-guard.ts` | 产物真实性约束与操作否定分开；“那个/这个计划”绑定有效唯一完整视图，具名条件与指代取交集；待选动作只由纯选择短句延续，查看不能变成暂停；其余身份/版本/Hash/投递/TTL/单操作检查保留 |
| `scripts/goal-feishu-acceptance.ts` | 验收进程开启Goal、独立数据；增加model-only Console模式，用户改为电脑后沿用原48/5总闸；Goal原始SSE记录4MiB |
| `scripts/feishu-formation-acceptance.ts` | 复用记录器增加有界可选容量参数；原Formation默认256KiB不变 |
| `tests/config.test.ts`、`tests/goal-integration.test.ts`、`tests/goal-process.test.ts` | 默认/非法开关、真实Pi白名单/提示及关闭时绕过拦截、ready不消费与启用后生命周期；五次串行子进程总时限45秒，各次启动仍单独限时 |
| `tests/goal-control.test.ts` | M01、错误selector/动作及最后暂停47回放；完整原话、目标交集、旧清单/过期/未投递/引用/跨渠道不授权 |
| `tests/goal-runner.test.ts`、两个新增`tests/fixtures/v3-goal-live-*-result.json` | 未修改的真实结果22/30回放，错误Step ID/缺必填字段整体失败且保留Checkpoint；测试中的合规对照仅离线构造，不冒充真实复验 |
| `tests/feishu-formation-acceptance.test.ts` | Goal长SSE、Formation默认限制及4MiB硬上限回归 |
| `.env.example`、README、PROJECT、STATE、V3设计、验收方案、本报告/JSON | 默认关闭、当前授权与实测失败、证据和继续边界 |

四表、Task/Memory语义、SDK内部及依赖不变。关闭Goal仍做原SQLite建表/保守崩溃恢复，保留历史与ready，是启用开关，不是数据库只读模式。Goal后台无工具、Memory只读，未开放Shell/Browser/MCP、任意写工具或新框架。Formation与QueryRewrite仅在测试进程保持false。

## 自动化最终结果

Node24.19.0、原版Pi1.3.0。最终Windows与断网Linux容器源码/测试/Fixture/脚本及包配置共92文件逐项SHA256一致；容器无.env/正式数据。本表对应最后暂停指代离线修复后的代码，而非此前197项结果。日志/Hash见[机器证据](v3-batch5-acceptance.json)。

| 检查 | Windows | Linux容器 |
| --- | --- | --- |
| typecheck / build | 退出0 / 0 | 退出0 / 0 |
| npm test | 198项：195通过、0失败、0取消、3跳过；17.35秒 | 198通过、0失败、0取消、0跳过；26.18秒 |
| eval:memory | 退出0，固定64题 | 退出0，固定64题 |
| eval:formation | 退出0，开发/留出各30/30，未经批准写入0 | 同左 |

Memory三集Top1/Recall@5/MRR/Context命中仍9/12、17/19、17/18，无答案误supported为0/4、0/5、0/6，最大Context1153/1613/1578字节。Windows跳过POSIX权限位、符号链接权限、POSIX SIGTERM；Linux对应项实际执行。未验原生Mac、Windows ACL或VPS。自动化中的模型/飞书响应为模拟，不证明真实语义质量。

失败日志同样保留：M01原话回放修复前失败；最后暂停47回放修复前waiting_user而非paused，修复后10项Goal控制测试全过；真实结果22/30始终被拒绝，不放宽Schema或手工修真实响应。首轮全量跨进程测试超过原20秒总时限而取消，调整为五次启动匹配的总时限后通过，内部等待检查未取消。重复eval输出路径遇EEXIST，改用新路径后通过，没有覆盖历史报告。一次容器路径误写/workspace，复制失败，旧源码通过的194项不作最终证据；核对实际/app源码后另跑。以上均不藏在最终绿灯中。

最终日志目录：`E:/AgentWork/validation/personal-agent-v3-batch5-20261023/final-delivery`。复核无需收费API：

```powershell
npm run typecheck
npm run build
npm test
npm run eval:memory
npm run eval:formation -- --output=<尚不存在的新报告路径>
node --import tsx scripts/audit-goals.ts E:/AgentWork/acceptance/v3-goals-20261023/agent.db
```

## 真实请求与原始失败

模型`deepseek-ai/DeepSeek-V4.1-Flash`，兼容端点硅基流动。于本轮核对[供应商官方价格页](https://www.siliconflow.cn/pricing)，采用较高时段输入2/输出8元每百万Token、不扣缓存折扣预留。每请求联网前按完整请求字节+512及最大输出Token预留；每段仅一次模型请求，输出上限4096，解析最多1000，不自动重试。**预留不是实际账单或供应商硬收费保证**。

48请求均HTTP200不代表48次业务成功。model_calls也是48条：未缓存输入41234、缓存读取80896、输出7500 Token，cost均null；含请求18截断时已观察到的部分用量，未知后续计费不退款。API请求数已用尽，即使5元尚有预留余额也不能继续。

调用前冻结M01/M02/M03及预期；额外分支在请求前追加，原话和原预期没有按响应改写。完整原始响应、Session、账本、每阶段SQLite读快照在新根目录`E:/AgentWork/acceptance/v3-goals-20261023`；无正式数据复制。原始流18不完整，其他响应与是否正常结束分别保存，不把HTTP200或partial流当完整有效结果。

| 请求 | 实际结果 |
| --- | --- |
| 1–3 | 原M01创建被宿主误拒绝：“不要替我假设已经掌握知识”是产物约束，却被当成操作否定；Run失败、Goal0 |
| 4–7 | 修复后原话创建1Goal，partial Checkpoint成功；误分词“松柏面”，把求职练习理解为产品验收；文本计划没有proposedPlan，原结构化草稿预期未达 |
| 8–11 | 补充场景并继续；解析器把新反馈作筛选词且给无依据last，宿主拒绝；主模型重复调工具触发一次操作限制，无新Execution |
| 12–14 | 首次空Session启动前聊天消息0，账本仍11请求、旧Checkpoint不变；复验目标筛选正确，但误判revise_plan并扩写步骤，宿主拒绝 |
| 15–18 | 明确继续正确领取一段；旧记录器256KiB被供应商逐片usage撑满，流中断，Execution interrupted、Goal blocked，旧进度保留；不是完整模型JSON或单纯网络超时 |
| 19–22 | 显式重新生成；完整JSON有效但新步骤自编ID，计划校验拒绝、事务无Checkpoint，仍blocked。原结果22作为不变Fixture保留 |
| 23–26 | 明确新Step ID规则后原样再生成；新步骤省略ID，宿主赋值；两步v1草稿/Checkpoint成功提交，前指针接原partial成果 |
| 27–30 | 自然语言批准并继续一段，计划v1有效；第一题正文虽生成却缺progressSummary/question，Schema拒绝、无进度提交。原结果30保留 |
| 31–34 | 明确重新生成当前失败片段，四字段齐全；第一题complete/Checkpoint成功，第二题pending、waiting_user |
| 35–38 | 正常停服重启，34请求及Goal/Execution/Checkpoint逐字段相同；“继续之前的松柏面试验收任务这一段”只执行第二题，前指针接第一题，两步完成但Goal仍waiting_user |
| 39–41 | “确认松柏面试验收目标已完成”才completed，无新Goal请求/Execution、Checkpoint不变 |
| 42–45 | 创建独立青杉学习计划，1Goal/1初始化有效；“计划一项”的草稿扩为3步，不满足冻结的一步草稿预期；未批准该计划 |
| 46–48 | “暂停那个学习计划”解析pause/keywords学习计划/last；宿主未识别该有界指代而要求重新选择，未暂停。达到请求上限后停服，原现场不改 |

随后只做离线修复：宿主从当前原话识别“那个/这个计划”，必须有唯一、完整、未过期、成功投递且版本一致的视图，先绑定该Goal，再与具名条件取交集；不由模型last标签选择目标。多目标清单、伪造引用、引用他人、过期/未投递、旧版本及跨渠道回放均不授权。这是已授权自然语言控制的修复，不改变四表或增加权限；没有新收费验证，因此真实暂停仍记失败。

## SQLite与停服证据

- 面试Goal `5680ab83-b836-48f4-942e-a013ea7c650f`：completed/revision21/Planv1；7次Execution中4 committed、2 failed、1 interrupted。有效链为原partial→结构化计划→第一题→第二题；失败片段不进入有效链。最终Checkpoint `47578f92-749a-47ad-9c6c-c91072ad504c`。
- 学习Goal `5970a7ff-0d52-4551-bb1e-5be23aac881d`：waiting_user/revision2/Planv0；1次committed，pending草稿v1有3步。真实pause没有控制收据，不能把技术上成功返回澄清当暂停成功。离线修复未改本轮真实库。
- Task0、Memory Markdown0、候选0；外键检查0异常，integrity_check=ok，audit-goals无不变量异常，投递错误0仅指Console投递，不指飞书。
- 正常停止收费进程，acceptance.lock及数据库进程锁均释放；停服后的db/WAL/SHM/账本快照、48份响应、重启/继续/完成断言和Hash保留。正式.env及HANDOFF.md的SHA256与开工前一致。

## 剩余限制与下一步

保持GOAL_ENABLED默认false，交付审查。未知模型输出、计划步数/粒度、意图分类仍不可靠；宿主保证结构/状态/授权和保守阻塞，不保证自然语言产物完全符合用户约束，也不凭模型自身判断完成。不能把这批带失败的定点迭代换算为通用成功率。

取消、计划调整、多活动目标澄清、运行中控制竞争及飞书/手机本轮未真实验收；最后暂停修复也需真实复验。当前48请求授权已经用尽，**不新开账本、不自动追加调用**。后续是否补这些场景由用户决定并另行批准预算；[手机话术及SQLite核对方案](v3-live-acceptance-plan.md)保留，不要求本次必须使用手机，也不把旧手机连通当新Goal通知验收。没有开发V3.1、Observer、自主推进、Skills、Computer Use、Outbox或VPS。
