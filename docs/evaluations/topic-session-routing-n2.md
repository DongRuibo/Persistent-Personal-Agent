# 持续主题 N2：持久Session与原生前置压缩

2026-11-03。N2独立R2 PASS，R1-1已关闭，0阻断/0新finding；原R1 FAIL与红灯保留。N2完成并停写；本阶段没有N3语义路由、N4主题UI或真实模型质量结论。N1已独立PASS，全文基线`n1/delivery-final/source-baseline.tar.gz`（435文件），HEAD仍`ca1f6737d730565bdc41c9b18909a05de3ae88bf`；没有新提交/推送/合并。

## 产品接线与边界

- 复用原`createPiExecutor`，将原manager/references/Guard/tools/Skill/Web额度闭包随context绑定。owner/chatKey仍由原Web宿主固定，topic文件在原owner目录下由逻辑key映射的受管子目录，模型不传key或路径。daily仍原文件与原两轮4KiB投影；主题路径保留公开Session当前上下文及原生摘要，不套旧两轮投影。
- `ExecutionRequest.prepareChat`仅宿主回调，在原chatBusy、统一budget与绝对signal内运行，最多一次无工具`complete(systemPrompt,text)`，返回N1冻结route。固定route同样走真实Web/Pi入口；回调不是模型工具，不在业务层暴露Pi对象。N2没有语义路由器；生产只执行宿主已经冻结的route。
- 原SQL队列演进为`legacy`（旧）、`frozen`（旧+已冻结新）和`all`（旧+全部新），始终原createdAt/rowid FIFO。N2仅使用legacy/frozen，未路由新消息保持queued，不能默认构造daily；all留N3。N1精确布尔筛选是历史接口，不在N2继续分两条队列。
- 入口原规则拆为复用的prepare/finish引用处理；切换时处理上次及重入冷目标。由原SQLite `topic_context_entered`及实际执行旧Chat Run定位，排除queued、仅冻结route、suggest/policy审计，涵盖关闭功能期间的旧daily。无新表、epoch、注册表或未刷盘daily custom指针。
- Goal A8修前真实复现：A完整展示/ACK→B完整展示/ACK→冷A裸确认使A计划revision从0变1。核定后仅在原References保存`goalShortConfirmationEnded`；跨Session结束裸短确认，保留完整goalView及原具名操作/TTL/revision，重新完整显示时恢复。单一displaySink按当前请求归属，不能由最后创建主题覆盖。没有修改Goal数据库状态机；编号/“这个计划”的泛化未扩改。

## 物理HTTP、压缩与计量

新模式通过公开`ModelRuntime.registerProvider`覆盖streamSimple并同时声明已选api（SDK校验要求）；保留原provider/model配置和原API实现。公开SDK源码核对支持受控fetch的范围为openai-completions、openai-responses、azure-openai-responses、anthropic-messages；未知API明确发送前拒绝。实际HTTP验收使用openai-completions兼容假服务，未声称其他供应商真实连接通过。

统一最终fetch在每次发送前检查8次和65536字节，原工作/准备小请求仍32KiB；准备、普通/split摘要、主Chat、原意图/工作解析及Memory改写共用同一预算。新模式跳过旧chargeChat和旧message_end/辅助modelCall重复记账，旧请求和后台保留原路径。每物理请求在原run_events留dispatch/result/blocked及purpose/ordinal/真实body字节，供应商明确给出的usage才写原model_calls；未给usage或强杀未结算显示unknown，不能写0冒充已知。Web活动显示实际请求数/未知次数，已知token只累计原账本；费用仍以供应商账单为准。

只在空闲主prompt前按当前投影历史、真实system/工具Schema、原话、Memory上限及开销预留触发至多一次公开compact，并结合SDK实际context usage/估计。token仍是估计，最终发送门按真实序列化UTF8字节兜底，不宣称精确tokenizer。auto-compaction/retry关闭，不在运行中工具链中途压缩/续跑；单条或工具结果装不下明确失败，不放宽原门。

`session_before_compact`复制公开preparation，将messagesToSummarize、split-prefix和保留段联合经过原`projectWebContext`24KiB投影，再调用SDK根compact；摘要固定`UNTRUSTED_HISTORY_SUMMARY_V1`及原来源/trust标记。原JSONL不删改，当前原话/工具配对保留。临时Memory仍由原服务读取当前有效版本，不注入持久Session/摘要；助手已复述的旧Memory可作为历史进入摘要，不承诺forget擦除聊天或真实模型永不引用旧值。

统一绝对signal从准备之前开始，覆盖创建/compact/主Chat，取消同时联动公开abortCompaction和abort；close等待已进入回合。hook故障显式cancel，最终发送口仍兜底，不能抛错后让SDK回退默认摘要。split第二次500/断流时首个31 input/7 output仍保留，第二次unknown；强杀只有dispatch也显示unknown，恢复不重放模型/工具。

## 实际验证与原红

证据根：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n2/worker/`。精确命令/退出码`commands.jsonl`，每次源码Hash为对应`*-source.json`；`*-evidence/fixture-*.json`保存实际原始假HTTP、字节、Run/事件/已知账本/Goal快照。最终相对N1增量、累计diff及源码manifest在`delivery/`。

- `affected-final`34文件 **419/419**，0失败/取消/跳过，46250.268208ms，自然退出。包括原N0 29、N1存储、N2最初28项及Pi/Session/自然意图/Task/Memory/Goal/文件/Web/Tavily/Coordinator/续接/Worker和实际子进程回归。不同组不相加。该命令与原R1冻结版生产源码相同，后来只追加一项已核定Goal关闭/实际进程对照；本次R1-1之后不再视为当前源码的重复全量，测试文件旧Hash保留。
- 最终`runtime-final`N2专项 **29/29**（13822.200792ms），0失败/取消/跳过，自然退出，没有force-exit。覆盖A六轮→B三轮→A早期约束、同名ID隔离、普通/split/部分500/断流、真实请求字节与第9次零发送、一次准备上限、三阶段取消/期限、空白daily首条主题、关闭经过旧daily、文件/Goal实际子进程旧短确认拒绝与新展示/ACK确认正向、具名Goal操作、真实进程仅重开0HTTP、SIGKILL压缩不提交/不重放、Task/Memory正反向、Memory当前版本/删除/助手副本、18轮Tavily原投影、hook失败无回退、未知API零外网尝试、准备前close与FIFO/审计排除。
- 最终typecheck exit0；build、web:build exit0，只有两条既有lucide use-client告警。补Goal测试后只重跑专项/typecheck，未机械重跑生产源码不变的419或构建。没有N5全量/浏览器、收费模型、真实外部来源、手机或长跑。
- 保留`goal-a8-red`真实首红和`goal-a8-fixed`，修复不覆盖原计划已误批的临时事实；后来正反向全在新临时数据验证。`runtime-1`/`runtime-isolation-2`因streamSimple重新注册缺api失败，fixture初始化尚未进入close导致测试监听残留，准确核对后仅终止本轮两个子测试PID31537/31587，原输出保留；未操作保留实例。
- `typecheck-1/2`为SDK导出/RetryPolicy等接口错误，`typecheck-tests-1`为不存在的夹具方法，`typecheck-5`为子进程Goal构造参数，均保留后修正。`runtime-3/4`还保留无usage假响应、文件收据故意隐藏正文和多项待批歧义的错误测试假设；修正夹具，不绕过原文件歧义Guard。`runtime-frozen`新增真实进程Goal对照后27/29：前述负向/新确认已通过，但更长历史触发摘要，Goal假模型误回工具，SDK正确拒绝（Summarization attempted to call a tool）。仅补无工具摘要文字分支后`runtime-final`29/29。开发期force-exit只用于保留早期失败，最终自然退出已单独证明。


## 独立R1与第1轮修复（R2已通过）

独立报告`n2/reviewer-r1/review.md`为FAIL，29/29及三探针中的两项通过；P1真实复现A已ACK的Web预览→B“确认读取”无预览→冷重建回A“确认读取”会消耗A旧view并发生一次GET。根因在`otherChat(false)`复用入口：false仅约束文件确认，Web仍根据别的Session的确认原话保留旧view。

生产只改`OperationGuard.prepareReferences`三行：将参数名改为统一确认开关，并在不允许确认时结束Web view。未改变同Session确认匹配、原Web投递/TTL/owner检查、明确具名读取、Goal或文件规则，未新增权限/状态表。新增`tests/topic-session-web-confirmation.test.ts`六项真实Pi/临时SQLite/Session/假HTTP回归，包括跨主题、关闭功能后旧daily、clarify、同Session冷重建正向、未投递与过期拒绝；三个跨路径之后明确具名新读取仍可成功。

新证据仅`n2/worker-r1-fix/`，旧`worker/`与`reviewer-r1/`不改写：

- 复制Reviewer三探针先2/3首红，修后3/3（2098.877875ms）；新六项先3/6首红，均已保留实际GET/Run原件。
- `targeted-final`：新六项、原web-chat/web-process-recovery/web-read-service/web-read-recovery/web-read-phases及N2专项，**135/135**，0失败/取消/跳过，16984.070417ms，自然退出，无force-exit。
- `npm run typecheck`、`npm run build` exit0。生产修复后build通过，之后仅改新增测试中的明确读取原话与本文档，最终typecheck及135项覆盖最终测试Hash。未重跑419、web:build或N5全量；原419/29与本次不相加。
- `targeted-1`90/93原件保留：三条跨Session拒绝已通过，但后续正向夹具使用“请直接读取”仍触发原预览规则；只改成原已支持的“请读取…并总结加载流程”，不扩解析或权限。

冻结交付在`n2/worker-r1-fix/delivery/`，含相对原R1冻结版的完整增量、更新累计diff/manifest与源码包、精确命令/退出码和Hash。该修复版随后已由独立R2通过，原冻结包不改写。

## 独立R2 PASS与最终冻结

2026-11-03独立`n2/reviewer-r2/review.md`：**PASS，R1-1关闭，0阻断/0新finding**。原三探针断言不改，跨Session GET为0→0→0，同Session冷恢复GET1，clarify文件零写；新增六项+原web-chat独立 **34/34**，2731.570167ms，exit0，自然退出，无force-exit。

Reviewer独立核对439源码/源码包与修复冻结Hash、2113 SDK文件一致，并核对Worker最终7文件 **135/135**（16984.070417ms）、命令退出码/源Hash。独立34和Worker135不相加；原R1独立29及原419仅沿其原版本证据，R2未重复工程构建或全量。真实假HTTP/Run/GET与失败原件保留在各自Worker/Reviewer目录。

本次收尾仅更新STATE与本评估，业务/测试Hash与R2已审版一致，不重复工程测试；最终439全源码基线、manifest、archive、累计diff及两文档增量冻结在`n2/delivery-final/`。HEAD仍为N0本地提交，无新stage/commit/push/合并。N3仅只读方案，待Planner核定后实施；不启用试用实例。

## 交接

N1/N0原证据只读保留；依赖/SDK未修改，仍为独立APFS实体。业务数据全部`TMPDIR=/private/tmp`，假模型仅localhost，未读正式.env/密钥/数据库/Session/Memory，未操作62414/PID6239或4317/4318，无Git提交或远端操作。

N3必须从当前明确原话、有界目录与当前有效引用选择，最多一次准备模型，先冻结route再主prompt；不能把prepare回调当新授权、不能将contextKey作为身份。N4原工作继承/主题显示、N5统一全量/浏览器/用户真实试用仍未实施。N2独立R2已通过并冻结；N3只读方案交Planner核定，未编码，不自行跨阶段。
