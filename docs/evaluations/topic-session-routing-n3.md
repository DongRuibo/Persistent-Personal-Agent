# 持续主题 N3：自动归属与纠正

2026-11-03。用户已批准的前置compact无切点限定修复独立R1 PASS，无业务阻断，本次compact阻断关闭。结合保持冻结的C1/C2最后R3结论，N3已知宿主机制阻断在本次离线验收范围关闭；不等于真实模型分类/摘要质量、产品试用、浏览器或长跑通过。N4/N5未开始，功能默认关闭；旧N3/收尾失败、原compact红灯及旧冻结包仅作历史保留，无新提交/发布/正式启用。

## 新授权前置compact限定修复（独立R1 PASS）

执行范围见本机`topic-session-routing/compact-fix/execution.md`。唯一业务树/HEAD不变，本轮仅4文件：`src/pi-executor.ts`增量适配原prepareTurn，`tests/topic-session-runtime.test.ts`新增4项真实SDK回归及两条既有失败负向断言，STATE与本评估维护当前结论。Guard/Router与C1/C2已审R3版逐字节相同；没有修改SDK/Agent Loop、预算参数、权限、正式数据或试用实例。

根因为53248字节软阈值与SDK原生保留切点不等价：本轮原第8普通回合实际historyBytes34666+reserveBytes19268=53934，公开compact在任何HTTP前抛`Nothing to compact (session too small)`。安装Pi1.3.0公开`AgentSession.compact()`对无工作仅抛精确Error，没有类型化状态；另一个原生状态为`Already compacted`。两条错误均发生在`session_before_compact`及摘要HTTP之前。仅精确匹配这两条、本次压缩前后同轮budget.calls不增加、signal未取消、原`tokens+ceil(reserve/2)+model.maxTokens<=contextWindow`时，才允许进入原Chat；实际JSON仍经65536最终发送门。其他异常原样失败，真实hook错误仍取消并抛`Compaction cancelled`，不会被归入无工作或回退默认摘要，不增加重试。

当前公开API说明更正：安装包`dist/index.d.ts`明确从entrypoint导出`buildSessionProjection`，旧建议书将它与`prepareCompaction`并列为内部入口不准确；后者确未公开导出。本轮不新增这两者的生产依赖、不因能读源码而依赖内部dist。精确错误字符串与固定SDK1.3.0耦合，升级SDK需重新核验无工作/取消/失败语义，未知字符串保持失败。

真实SDK/Web/SQLite/Session/Memory、clean PATH/HOME与TMPDIR=/private/tmp、localhost固定假HTTP，所有结果均非真实模型语义验收。新证据仅`compact-fix/worker-r1/`，命令、exit与执行前两个源码Hash见各`*-command.json`；原HTTP/字节/Run/events/账本见`original-red/`、`original-green/`及`targeted-final-evidence/`。

|验收|实际证据|
|---|---|
|A原反例|原脚本仅换out，原断言1/1红exit1→1/1绿exit0；第8普通回合由0HTTP失败变为1次主Chat、实际28162字节。新持久回归逐轮deepEqual原Goal，8普通回合均无工具；原脚本随后第9次明确“接着推进刚才的目标”是合法控制，Goal可从paused/revision4变ready/revision5，不与普通回合不变混淆。|
|B无工作与容量|真实`Already compacted`可发送51356字节；同状态实际payload76355被原65536发送门拒绝，0HTTP/工具；token反例26640+ceil17415/2+4096>32768由原窗口策略拒绝，0HTTP/工具。容量专属原因在本机Run诊断，Web保持通用失败提示，本轮没有用户容量提示UI。|
|C/D失败与执行边界|已有真实普通压缩/split两摘要/500/断流部分成功、known/unknown、取消/绝对超时/重启/SIGKILL全保持；500/断流新增断言无no_work、无主Chat。路由/压缩/Chat同轮物理8次预算与第9次零发送，未重放业务动作。|
|E信任与兼容|原Memory更新/删除时效、摘要与网页低信任、工具配对、旧文件/Goal/Web审批引用、默认关闭兼容在最终7文件及全量保持。|
|F同版工程检查|`npm run typecheck`、`npm run build`均exit0；7文件146/146、16502.440292ms；代码稳定后本轮一次最终`npm test`1086/1086、89848.632583ms，0失败/取消/跳过、自然退出。未运行web构建或浏览器，无UI变更。|

首次原脚本因沙箱localhost listen EPERM失败，原日志保留；获得最小监听权限后才取得上述业务原红。首次新增small夹具被Web入口413拒绝，未到compact，已移除该无效探针并使用原普通回合持久回归；它不算产品反例或安全通过。首轮新增测试中的token夹具实际可成功压缩，亦保留原日志；最终用真实原生Already compacted构造窗口反例，不替换compact/切点。所有旧失败、旧绿版本和原断言保留，不相加冒充当前同源计数。

Worker源码/测试已稳定并冻结，4文件精确增量、累计31文件diff、443源码manifest、公开API核对及简明交接在`compact-fix/worker-r1/delivery/`。独立R1实际原脚本/原断言1/1（1836.755125ms）、7文件146/146（16201.951417ms），均exit0、0失败/取消/跳过；独立核同版Worker typecheck/build及1086全量原日志，未重复构建或全量。结论为限定PASS、无业务返修，详见[独立报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/compact-fix/reviewer-r1/review.md)。其非阻断P3指出STATE下一步仍称本任务待批准/未修，本次仅收尾STATE与本评估更正当前结论和证据位置，不改业务/测试、不重跑测试或新打包。此前N3及限定收尾内容以下均为历史阶段记录，包含当时尚未修复compact的结论，不覆盖其原件。

## 收尾R2-1最后返修（限定R3 PASS）

独立R2报告`n3-closure/reviewer-r2/review.md`确认唯一回归：原支持的否定到动作0–8字符间隔被新解析删除，“以后持续跟进求职，但不要在这里绑定主题”“…但不要帮我绑定主题”各use/create真实发生绑定。仅恢复原有界非贪婪间隔并限当前子句，保留前置文件/Goal宾语和现有对象中心、情态/量词规则；不加两条字面句式、不改C1 Guard、SDK或压缩参数。

新证据仅`n3-closure/worker-r2-fix/`。R2原脚本/原断言只换输出目录，prior模块逐字节复制：`spacing-before`0/4、exit1、2017.37875ms→`spacing-after`4/4、exit0、1909.370208ms，真实Web状态与调用原件完整；旧C2能力否定正反向3/3、1302.203292ms。最终7文件142/142、18386.29475ms；代码稳定后本轮一次全量1082/1082、87954.524917ms；typecheck/build/diffcheck exit0，均自然退出无取消/跳过。原8项仍7/8、exit1、2556.707792ms（唯一compact原红保留）；Task/Memory4/4、1707.554958ms；修订业务6/6、2929.863ms。原4/5判据校正不改、不为测试改变Goal规则。

本次修复增量5文件（Router、两个原测试、STATE/本评估）；整个限定收尾相对final-handoff是6文件，包含C1 Guard，不混为同一范围。Guard SHA256 `01e6fa1130f418ba5abb1444fab4fe4eaa15403b5842e000f500bf7cb6a09018`与R2已审版完全一致。交付两套清单/差异、累计diff、443源码包/manifest和SDK2113核对，全部旧报告/红灯/1082包保留；以下按历史时点记录，不覆盖最终限定R3 PASS及保留的整体compact阻断。

compact仍为标准普通第8轮已有整体连续使用阻断，不是本次新finding，也未修或接受。内部prepareCompaction只用于只读归因，不是生产公开入口；N4/N5不启动。限定最后R3已通过，源码/测试继续冻结；仅做两文档结论收尾，不提交/发布/正式启用，不推进N4/N5。

## 新授权收尾R1 FAIL与第1次返修（待收尾R2）

原冻结报告`n3-closure/reviewer-r1/review.md`一次交付C1/C2两项P2；compact另列已有运行局限。新证据仅`n3-closure/worker-r1-fix/`，相对首版精确6文件（两生产、两原测试、STATE/本评估），没有改SDK/表/权限/Goal状态机。

- **C1**：复用normalize，以有界类别/指代词排除判定关键词是否有具体对象条件，不改关键词正文或原匹配。原话host last而模型漏标签/只有“目标/提醒/记忆”时，实际选择处补全宿主reference；Goal仍按自身原展示交集/结束标记，Task/Memory用当前短对象、已清除或过期则无记录，不能退全库。真具名/Task时间条件维持原筛选；Task“取消我刚才设的上厕所提醒”仍取消厕所而不碰刚创建喝水，两项厕所仍多候选澄清；global latest/具名Memory/Goal重展示和同Session正向保持。没有采用一律把所有last+具体筛选限定旧展示的错误方案，也未改原断言。
- **C2**：共用persistent在原否定动作/宾语范围识别主题类别中心或持续事项的省略宾语，不枚举对象修饰词，覆盖“不绑定主题”“不要绑定”及use/create入口；明确文件/资料/Goal/Memory等其他对象另行处理，不把“不要绑定文件到Goal/主题”“不创建Goal/不联网/不保存Memory”泛化为主题拒绝。原自身肯定用途、另一事项/单次/材料/引文/ACK通过，不另造NLU/审批体系。

真实Pi/Web/SQLite/Session/Memory，clean env与TMPDIR=/private/tmp、localhost假HTTP，原最终脚本只换输出目录，不改断言：

|命令证据|实际结果|
|---|---|
|adjacent-before原8项|3/8、exit1、3234.0615ms|
|adjacent-final4原8项|**7/8、exit1、2536.835375ms**；剩余仅compact已知独立失败，不skip、不称全过|
|task-memory-before / final4原四项|0/4红→**4/4、exit0、1639.82625ms**；均冷恢复实际工具/解析到存储，类别漏标签/显式last都无状态变化|
|business-final4修订原判据|6/6、exit0、2669.541958ms；A待批具体诊断/合法A真实readyInput/B不变|
|focused-1|86/86、exit0、15879.437959ms，含原natural-language厕所回归、真实新模式同名/时间/latest|
|targeted-final4原7文件|**142/142、exit0、18459.255667ms**，0失败/取消/跳过，自然退出|
|typecheck-final4 / build-final4 / diffcheck-final4|exit0；typecheck首红两处已收窄联合类型的冗余判断TS2367保留，删重复判断不改语义|
|full-final4 npm test|**1082/1082、exit0、90949.797209ms**，对象范围稳定后最终同源全量，0失败/取消/跳过、自然退出|

前一版focused86、targeted139与full1079（92350.289958ms）绿灯保留其源版本。准备封存时Planner实际入口核对发现“不绑定任何主题”仍绑定，`quantified-object-before`0/1、exit1、582.012958ms原红保留。没有仅加“任何”：改为在前置宾语、绑定对象/目的对象的现有子句范围识别类别中心，明确文件对象继续排除；不同修饰不影响识别。入口正反向1/1（588.923917ms），并新增真实Web use/create两项：任何/任意主题否定均仅1次route/无绑定；“不要把含主题信息的文件绑定到主题”肯定持续用途仍可绑。生产实际改变后才重验上述最终141/1081，旧1079不冒充当前同源；当前冻结后不再扩矩阵或重复全量。

量词后1081版候选已完整保留在`delivery-1081-pre-modal/`（四Hash不改）。Planner随后实际核对“不需要绑定主题”“暂时不必绑定主题”仍红：`modal-denial-before`入口及真实Web use/create 0/3、exit1、1494.338917ms；将否定动作改为“不+普通情态/助词”的结构、宾语仍限原子句对象范围，未补两句全文特例。`modal-denial-after`3/3、exit0、1575.51475ms，普通不打算/不愿意及非主题文件/Goal能力否定正向保持。Planner只读零HTTP入口核对10/10、sourceSHA吻合，证据`n3-closure/planner-denial-entry-green.json`；确认没有已知入口残余后才运行上述最终同源全量。此前1079/1081均不冒充当前版本，不重写已封存包。当前最终之后只做文档/Hash，不再扩矩阵或重复全量。

英语类别最小单例经实际工具证实同C1：仅把独立夹具objective改为“帮我逐步准备ALPHA Goal”，当前“接着推进刚才的Goal”、模型keywords=[Goal]漏reference，修前paused/revision4→ready/revision5且本次readyInput，`english-goal-before`0/1、exit1、1902.106208ms。将规范产品类型goal/task与既有memory同列（normalize已小写），没有扩语言分类器；原独立单例`english-goal-after`1/1、exit0、1857.647291ms，新增同一真实冷恢复回归并保持“继续ALPHA Goal”真具名正向。此前1081包保留在`delivery-1081-pre-english/`，旧Hash不改；该实际生产变化后按Planner确认只做上述最终142/1082同源检查并直接冻结，不再新增语言矩阵。C2 Planner入口SHA仍与当前topic-router吻合。

原业务4/5与判据校正记录保持，未为succeeded改变Goal状态机；本轮未机械重跑原4/5。原定点绿灯不是R1两个新反例的替代证明，新原探针后置断言和工具/HTTP/前后状态另存完整原件。既有默认关闭/File/Web/身份/TTL/ACK/revision、R1明确B引用A和普通解释回归由实际原专项保留。所有命令源Hash绑定最终版本；旧首版三次全量不冒充本返修同源，不累加。

**整体运行阻断仍在：** Reviewer首版已标准复现创建/bootstrap/批准/暂停/完整展示后的第8个普通解释回合，在historyBytes34667+reserveBytes19268=53935>53248时触发Nothing to compact，0HTTP/0工具/0Guard。兼容contextWindow32768/maxTokens4096、keepRecentTokens1536/reserveTokens4096；Reviewer从SDK内部路径只读调用prepareCompaction归因：1536为undefined、512有preparation；它不是package entrypoint公开导出，不能作为生产公共API，公开生产入口仍为AgentSession.compact()。见本机n3-closure/compact-api-note.md，此对照非修改建议或实施。当前原8项compact仍失败，未通过调整预算/重试或修改SDK凑绿灯；它是整体连续使用/试用验收阻断，不再仅称“待隔离的夹具问题”。C1/C2即使后续独立关闭也不能据此称整体可连续试用；需另获明确任务处理或明确接受验收范围，当前不启动N4/N5。

返修包`n3-closure/worker-r1-fix/delivery/`交精确六文件增量/累计diff（含untracked）、443源码包/manifest/SDK2113核对、逐文件目的、原红/7of8与4of4/HTTP/实际命令exit。到此停写，等待独立收尾R2，不自判通过。

## 新授权限定收尾首版（历史：后经独立R1 FAIL）

契约`topic-session-routing/n3-closure/execution.md`，新证据仅`n3-closure/worker-r1/`；基线为旧`final-handoff/`443文件，旧报告和源码包保持。精确6文件：operation-guard、topic-router、两个原测试文件、STATE/本评估，无新增业务文件。

1. 请求框架与权限分工：路由前只对确定业务操作/纯对象选择复用原引用投影；历史对象词或动词开头的疑问不作为执行请求，普通“刚才那个训练计划里的深蹲动作怎么做”“刚才那个训练计划应该怎么调整”“解释一下如何取消刚才那个提醒”及两条动词开头疑问正常进Chat，有/无Goal视图对照均通过。未建设第二个分类器或NLU服务，未识别句式仍交原主Chat，路由元数据不等同授权。
2. 实际消费兜底：Goal在真正选择last/choice/demonstrative或无selector/无筛选的单项display回退时复用goalShortConfirmationEnded拒绝结束展示，完整view不删除；Task/Memory在原otherChat清理短last/列表并保存。真实可信冻结错归属绕过Router，切换/关闭daily后冷重建，再调用实际工具/隔离解析，重复两次均无提交/状态变化；具名、原global latest、当前重展示后continue/取消/Memory忘记保持。未改变Goal pendingAction/审批/continue业务，也未增加状态字段/表/权限。
3. 旧主题用途：persistentUse先对完整当前原话复用persistent否定/材料约束，再核实目标自身肯定子句；完整请求先/后拒绝绑定或选用不能被some越过，原旧目标正向、无关不联网/不保存Memory及clarify+ACK保持。

实际检查（clean env，TMPDIR=/private/tmp，真实Pi/Web/SQLite/Session配localhost固定假HTTP）：

- 原R3 adjacent-probe仅换输出目录，`adjacent-before` **0/3、exit1、1880.292875ms**；`adjacent-after`3/3，最终同源`adjacent-probe-final4`3/3、3140.733208ms，自然退出，断言未弱化。旧R3原件不写入。
- 新专项首轮`closure-first`6/7、exit1：普通回合实际route+两个split compact+main共4次，新增夹具错误写死2次；仅改测试按真实dispatch目的核对1route/1main，其余只许compaction。生产压缩/门未改，`closure-second`8/8。原失败与完整HTTP保留。
- 最终同源7文件`targeted-final4` **132/132、exit0、15372.621458ms**，覆盖原路由/存储/Session/Goal/File/Web边界及新真实Guard矩阵，0失败/取消/跳过、自然退出。
- 原独立R1 **2/2、2184.833458ms**；旧绑定 **2/2、2945.598166ms**；原业务 **4/5、exit1、5306.83975ms**仍保留（已核定A待批具体拒绝判据），独立修订v2原断言 **6/6、exit0、5626.238416ms**。不为succeeded断言改Goal语义，历史判据记录见原R3/旧收尾交接。
- typecheck-final4/build-final4均exit0；最终同源`full-final4` npm test全量 **1072/1072、exit0、91630.59725ms、0失败/取消/跳过、自然退出**。首次/第二次全量也1072/1072（91655.2995ms/91893.405875ms），随后分别发现“继续解释刚才那个训练计划”“继续刚才那个训练计划的解释”快路径红灯并实际改生产，才再次验证；三版各有源码Hash，不把旧绿当最终同源、不累加。这是共享Guard回归，不是N5产品实施/浏览器/真实语义验收；最终之后无新源码变化或失败，不再重复全量。diffcheck及最终源码/SDK/文档核对见delivery。

开发中`explanation-frame-before`与`explanation-tail-before`各exit1：仅动词开头或直接对象开头仍不够；最终只接完整简短对象操作，讲解宾语/修饰尾部交原Chat，没补“解释”等关键词黑名单。原复杂“更新刚才那个：新正文”类别断言相应改为不固定路由，实际Memory Guard冷恢复负向/全局latest正向保留；未删原授权检查。`targeted-final3`130/132红另有两点：完整对象类型初漏“记忆候选”（已恢复原明确编号类型、ACK/TTL矩阵通过）；新增Goal测试先堆叠八个普通对照，后续负向在公开compact前失败，未到Guard，不当安全通过。最终按契约保留一个有真实Goal展示的正文对照，入口矩阵继续覆盖全部普通句，四类Goal负向均实际到工具/隔离解析检查，无授权/提交；Task/Memory同理。

**单列局限供Reviewer判断：** `targeted-final3-evidence/fixture-30.json`记录真实SDK错误“Nothing to compact (session too small)”。配置兼容模型contextWindow=32768、maxTokens=4096；主题公开compaction keepRecentTokens=1536、reserveTokens=4096，摘要响应为测试factSummary。初始化/批准/暂停/完整展示后累计八个普通正文对照，首个可信错归A的“接着推进刚才的目标”触发historyBytes=34887、reserveBytes=19270，合计54157超过宿主53248主动压缩阈值；estimatedTokens=3520。公开session.compact在该次未发HTTP即拒绝，Run只有entered/preflight/failed，无Goal工具或Guard事件。这一真实错误未修，不把它泛称产品无关；没有另加标准长对话复现来确定保留段/历史形状的普适原因。既有runtime长对话/普通与split compact在最终定点及全量通过，仍不能排除该低token高字节历史边界。仅调整新增Guard夹具以实际到消费检查，未改SDK/预算/压缩产品逻辑，也不宣称该边界已解决。

完成后冻结`n3-closure/worker-r1/delivery/`：相对旧最终基线精确6文件增量、累计diff含untracked、443源码包/manifest、SDK2113文件Hash、各运行源码Hash/命令exit及HTTP原件。尚待新独立Reviewer，不把Worker绿灯覆盖旧三轮FAIL或预写新PASS，N4/N5未开始。

## 旧N3三轮最终独立R3结论：停止，未通过（历史冻结）

原报告在本机`topic-session-routing/n3/reviewer-r3/review.md`；独立Reviewer已冻结停审。N0为本地提交`ca1f6737d730565bdc41c9b18909a05de3ae88bf`，N1 R1 PASS、N2 R2 PASS；N3三轮结果依次FAIL，不外推为功能可用或批准发布。

- **R3-1/P2未修**：真实Web先建立健身持续主题、从未创建Goal，普通“那个训练动作怎么做”可回答，但“刚才那个训练计划里的深蹲动作怎么做”被last+计划硬判成Goal引用。实际route=clarify、零HTTP、主Chat未执行。根因是将Goal工具内部对象指代判断用于路由前业务意图判定；来源`n3/reviewer-r3/normal-training-plan.json`。
- **R3-2/P2未修**：旧求职未绑定时，“以后持续跟进求职，但不要绑定主题”仍由宿主给explicitThreadId并实际绑定/开主Chat；入口“以后持续跟进求职，不要选用为持续主题”同根。persistentUse先逐子句some接受肯定范围，未保留整条主题绑定否定。来源`binding-denial-unit.json`、`binding-denial-web.json`。
- 三项相邻探针 **0/3、exit1、1093.355417ms、自然退出**，原反例/完整HTTP/Run不删、不改、不实施报告建议。R1-1保持关闭；R2-1业务对象错误消费已关闭；R2-2另一事项持续用途原2/2通过，但不能据此宣称旧绑定边界全部关闭。
- 原business-v2脚本只换证据目录仍 **4/5、exit1**；独立修订判据另存v2，**6/6、exit0、2707.203125ms**。具体证明冻结route/实际Session/主Chat/Goal工具均A，待批A按原Guard诊断“Goal 当前不能继续；需先处理计划或确认完成”拒绝、无continue提交/readyInput且B不变；合法已批准暂停A可真实readyInput排队，未运行后台片段。原4/5不改称5/5，最初修订夹具5/6失败也保留，未改生产/Goal语义。
- Reviewer独立7文件 **124/124、exit0、11882.386334ms、自然退出**；已核对Worker同源132/132与24/24、原typecheck/build/diffcheck exit0。各组不累加且不能抵消新反例。旧业务代码和测试未改，收尾仅本STATE/评估两文档变化；只跑diffcheck和文档事实/链接核对，不重复业务测试。N5全量、web:build/浏览器、真实模型/摘要/多供应商/手机/长跑未做。

最终交付在本机`topic-session-routing/final-handoff/`：累计31文件用途表、完整累计diff（含untracked，基于已提交N0 HEAD）、精确Git状态、443源码manifest/包与Hash、相对R3仅两文档差异证明，以及三轮原报告链接。历史N1/N2/N3 Worker/Reviewer包保持原件；下文R1/R2过程按当时阶段保留，不将“待审”历史描述当当前结论。

## 最小接线

- 原Web输入、SQLite队列和串行executor不变；开启claim all，关闭legacy，接收模式冻结。宿主prepare回调在原busy/budget/绝对signal中一次隔离无工具解析daily/use/create/clarify；模型未知输出在唯一适配入口校验schema/长度/候选及当前原话，Store改typed并保留归属/归档/幂等/原事务不变量。新主题/旧绑定/冻结route与必要宿主决定事件同事务，之后才开Session。
- 目录只投影同Web owner/channel active主题的id/title/description/bound，最多20项/8KiB；超量明确缩小，不拿截断列表当唯一。一般“那个训练动作怎么做”可在当前主题理解历史，裸业务确认/编号只用当前有效引用。模型reason不产生工具许可，也不能提供contextKey/path/owner/action/explicitThreadId。
- executor只读取最后实际context原References；Goal沿原validateDisplay、Web沿displayed/current hash、文件抽出consume前只读共用验证，消费仍在原事务内重新校验/唯一更新。投影只给类别/数量，无正文/许可；Task/Memory/Work沿原引用生命周期。N2 Goal ended标记和Web otherChat(false)修复保留。
- 纯选择必须完整原话匹配；“切到健身，今天怎么练”或引号中的本次材料不会被删成仅切换。成功纯选择以原Run topic_context_selected且succeeded成为当前上下文；排队/模型候选/failed/interrupted不生效。切换结束上次与目标旧短引用，不造假assistant/私有persist；纠正只影响当前/后续，不改旧route/日志、不重放旧请求。
- 通用澄清只列已绑、名称/必要范围可区分且完整问题<=240字符的候选；否则请用户给名称/范围。旧未绑单独明确“选用为持续主题”问题，宿主purpose事实+本次明确选择才给explicitThreadId。复用原Run成功、ACK、FrozenRoute.question==Run.output、五分钟及最近普通回合；无新审批端点/hash许可对象。资料引用先判断，不因提到旧主题要求绑定；留当前context，经原具名成果Guard/Recall或清楚缺资料说明，不读另一Session全文。
- 路由前对最后实际context复用原prepareReferences(prompt,true)，路由异常沿原finishReferences(false,false)，恢复原普通回合失效时点；不清Goal独立view，不吞getState/prepare故障，不默认daily。

## 实际验证

证据根`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n3/worker/`。commands.jsonl有精确命令/退出码，每轮*-source.json为测试前源码Hash；原HTTP/字节、Run/events、账本/文件/主题状态在各*-evidence/。全部业务数据TMPDIR=/private/tmp，真实SDK+localhost固定假HTTP，不是收费模型或真实外网/语义验收。

- 原R1冻结版`affected-final-2`21文件 **257/257**，0失败/取消/跳过，39467.358875ms，自然退出，无force-exit。包括新路由/Web、N1存储、N2 29和Web R1-1六项、原文件/Goal/config/WorkThread/Coordinator/Router/Recall/Web/Formation相关回归。该原冻结版typecheck、build exit0；当时build后只调整新增deadline夹具和文档，生产源码Hash不变；其typecheck/257覆盖当时测试Hash。本次R1-1后不冒称旧257同源。未机械重跑旧419、web:build或N5全量。
- N3验证含daily零主题、持续A六轮/B三轮/回A早期约束、同UUID零重调/重复主题、同名范围、旧未绑许可、完整原话与普通跟进、ACK澄清纯选择/未ACK/TTL/问题不一致、冷重建实际context、资料引用不混A历史、文件/Goal冷确认负向与重新完整展示ACK正向。真实自动route→pre-prompt compact→主Chat，原native summary/低信任标记和早期约束保留，实际每HTTP<=65536；路由+工具链第9次零发送，known/unknown不双计。500/断流/超时/停机取消不冻结、不建主题、不主Chat、不降级/重试，重开与UUID回读零重放。原N2实际子进程/kill、Memory当前版本/助手历史副本与权限边界在最终组继续通过。
- 新事务事件故障回滚主题/绑定/route；仅成功纯选择才定位，未成功事件不算实际context；N1旧库行/正文/Run/Job/Links迁移与所有未知字段/无界/越权/归档/冲突/幂等/回滚断言保留。未知JSON拒绝迁到真实parse入口，未用类型断言绕过非法输入测试。

## 保留的原红与修正

- typecheck-1为SQLite row.id联合类型；typecheck-2为N1/N2夹具unknown/宽kind，随后迁移typed入口；typecheck-3为测试requestId默认UUID模板字面量类型。均保留原件。
- unit-1 17/18及n2-regression-1 56/57：原N1/N2“开启仍等待未路由”阶段假设已过时。原固定route专项改为宿主先freeze再真实HTTP重投；关闭新模式仍等待/不降级的断言保留，没有删除原迁移/幂等检查。
- web-1 4/6：早期事实使用了N0摘要夹具不识别的FACT标记；文件Web投影本就隐藏正文，改查原测试Run/完整文件入口，未改变产品。旧文件提议仍需明确取消后再预览，保留原多项歧义规则。
- scope-red 10/13：实证引用材料可误建、引号新问题被吞、旧资料引用先索绑定。按当前请求框架/完整原文/先资料引用修复；web-3的编号带引号新问题又暴露短业务分支同根截取，改成全文识别。最终正反向通过，包含无关Memory/联网/Task/Goal能力否定不撤销主题意图、长公共前缀/同名候选可理解范围。
- failure-ref-red **0/2**：A文件完整预览/ACK→普通新请求路由500或取消→冷裸确认错误写入。核定后复用原入口/失败结束时点，failure-ref-fixed **2/2**（2024.18525ms），最终257中仍冷恢复零写；Goal同Session/冷恢复合法确认保留正向。
- 首次affected-final卡在新增deadline夹具await“服务已接收”；80ms可能在派发前耗尽。精确定位仅终止本轮测试子PID42385（不涉及保留实例），原251/252、exit1/163809.626333ms日志保留。仅修测试：deadline不等待接收屏障，测试期限定1000ms；分别核对发送前0派发/0账本和在途1派发/unknown，不改生产期限。最终相同21文件组自然退出257/257，不以强退掩盖资源泄漏。

## 独立R1与第1轮R1-1修复（待R2）

`n3/reviewer-r1/review.md`为FAIL：当前C时，“在求职B继续，参考资料A那份报告，今天怎么准备面试”“切到求职B，参考资料A报告帮我准备面试”“在求职B继续，不要引用资料A”，模型正确use B仍被宿主改成C。原分支只判断整句有参考/引用和B名称，没有定位资料对象A。

仅修改topic-router.ts的use分支：分别定位参考/引用/借用之后的资料对象与当前有限“在/切到/切换到/转到”归属框架。唯一可核实的B优先；错误模型A可由该明确当前B纠正，不将C当万能回退。目标无法核实/多选则clarify、无主Chat；纯引用A保持当前或明确缺资料，不索取未绑定A的持续许可。不改原话/候选上限/事务/Guard/Session/工具权限，不增通用语法框架；其余N3路径待R2继续审查。

新证据仅`n3/worker-r1-fix/`：

- Reviewer原两探针复制后只改输出目录，0/2红（2261.093084ms）→2/2绿（1823.990459ms），原三句断言不改；旧Reviewer/Worker目录不改写。
- 新增两项入口+三项真实Web回归原红0/5；修后随原路由共35/35，通过后仅修可变union在回调中的类型窄化（const当前ID），首次typecheck错误原件保留。
- 最终7文件`affected-final` **110/110**，12366.232166ms，0失败/取消/跳过，自然退出，无force-exit；typecheck-final、build-final、diffcheck-final均exit0。原257/419、web:build、N5全量未重复，不相加。
- 真实Web矩阵每次都先令当前C：三条原句分别让模型正确B/错误A，六次均冻结B并实际主HTTP带B_PRIVATE、无C_PRIVATE/A_PRIVATE，完整当前原话保留；未知明确去向只1次route HTTP、无主Chat，纯引用旧未绑定A仍保持C且chatContextKey=null。

相对R1冻结版仅五文件：topic-router、两个原测试文件、STATE、本评估；新交付`n3/worker-r1-fix/delivery/`含增量/更新累计/443源码manifest及包、精确命令/源码Hash和原HTTP。Worker至此停写待R2，R1-1尚待独立确认关闭；不能将修复专项通过等同N3全面通过。

## 独立R2与第2轮修复（待R3）

R2原报告/独立探针保留在`n3/reviewer-r2/`，已关闭R1-1；新增业务指代可被错误模型路由B并消费旧Goal/Task，以及旧求职可借健身的长期措辞自动绑定。修复前复制原探针只改证据目录：业务2/5、旧绑定0/2，均exit1；原R1仍2/2。新证据只写`n3/worker-r2-fix/`，不改旧包。

R2-1小幅提取Guard原referenceFromMessage/deicticGoalLabel与demonstrative语义，原Goal操作复用同一判定。只向路由投影当前有效类别/数量，不含正文；Task last/choice与Goal完整view分别遵循原规则，Memory候选只复用同次ACK/TTL/开启且validateDisplay成功的事实。业务指代在模型归属前固定当前context；无唯一有效引用或同时明确其他主题则澄清，原Guard仍决定具体对象/授权，具名筛选仍取交集。普通“那个训练动作怎么做”、带新内容的主题选择、具名新操作不被泛拦；未改Goal pendingAction或continue行为、原权限/表/队列/SDK。

R2-2只在实际肯定持续用途范围核实旧目标title/完整ID；另一事项、单次/资料/引文或目标自身否定不构成explicitThreadId。无法证明复用原persistent-use澄清及成功ACK选择；明确旧目标持续用途和无关“不联网/不保存Memory”保持正向，新create不硬配模型标题。

实际验证（全部localhost假模型、真实Pi/Web/SQLite/Session及临时数据，无force-exit）：

- `focused-4` **49/49**，6039.612708ms；含Goal待批A具体拒绝、合法A继续真实readyInput归A、B完全不变，Task多项编号/显式换题冲突/具名新操作，Memory候选无效ACK/关闭/TTL零引用且不读正文。`focused-3`48/49红保留：新增假模型用TASK乙被原分词仅取TASK而多候选，只更换唯一BETA夹具，不改原匹配。
- `affected-final` **132/132**，11829.651458ms；覆盖路由、主题运行、原Goal/Task自然意图、Task服务、Web恢复。命令误列不存在的`topic-route-store.test.ts`，Node忽略该路径；实际8文件，并不包含存储。随后`compatibility-final`补实际存储/原Web跨Session确认/File输出3文件 **24/24**，2251.434ms；迁移/幂等/越权/事务及原N2边界保留。两组不与旧257/110相加，不冒充N5全量。
- 原R1探针 **2/2**，1327.395541ms；原R2旧绑定 **2/2**，1211.650042ms，断言未弱化。原R2业务探针仍 **4/5、exit1**，2922.642791ms：approve/Task/correct-current/普通跟进均通过，continue固定A后被原Guard具体诊断“Goal 当前不能继续；需先处理计划或确认完成”拒绝。原succeeded前提是排除v1压缩夹具失败；Planner与Reviewer已核定此处判据过严，见`n3/r2-continue-probe-clarification.md`。原探针不改、不称5/5。
- 另证据核对原probe冻结route/实际main/Guard均A、B逐字段不变、A无readyInput及continue提交；原operation_authorized是apply前尝试事件，未产生operation_committed或可排队继续。新增真实Web对照证明合法已批准暂停A可成功continue且readyInput.triggerRunId归本次A，B不变；不为绿灯增加pending继续分支。
- 中间`original-regression-1`55/57（第一项目误作编号/带引号新内容误判）与`unit-2`26/27（更新编号分类遗漏）红灯保留，修复全文/业务动作范围后回归通过；旧绑定首轮1/2保留，补自身否定范围后原2/2。typecheck-final/build-final/diffcheck-final均exit0，各轮源码Hash绑定命令；未重复旧419/257或web:build/N5全量。

相对R2已审版7文件：`src/topic-route-types.ts`增加只读按类引用事实；`src/operation-guard.ts`复用原指代/有效展示元数据；`src/topic-router.ts`业务context固定/冲突澄清及旧目标自身用途；两个原主题测试文件补固定回归；STATE/本评估更新阶段事实。交付`n3/worker-r2-fix/delivery/`含相对R2、相对N2与累计diff、443源码manifest/包、SDK Hash审计、原HTTP及逐项证明。业务源码/测试到此冻结，等待最后一轮独立R3，不能据Worker专项宣布N3 PASS。

## 交接与限制

本轮约15文件（8生产、4测试、3文档），原R1冻结版完整用途/Hash见`n3/worker/delivery/hand-off.md`，第1次修复包见`n3/worker-r1-fix/delivery/hand-off.md`，本次第2轮包见`n3/worker-r2-fix/delivery/hand-off.md`。N0/N1/N2与Reviewer证据只读保留；SDK未改，未读正式.env/密钥/数据，未操作62414/PID6239或4317/4318，无新提交/远端操作。

当前只证明有界宿主机制，不证明真实分类、摘要或多供应商实连质量。没有跨Session正文搜索或自动Memory；历史助手Memory副本仍可能被摘要保留。N4工作继承/UI、N5统一全量/浏览器、真实模型/手机/长跑未完成。旧N3最终R3两项P2与三轮停止按历史保留；后续用户已另行批准上面的两项限定收尾，新Worker交付待新R1，不自动推进N4/N5。
