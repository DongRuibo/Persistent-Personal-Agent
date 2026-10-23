# Personal Agent 当前状态与交接

更新日期：2026-10-23（Asia/Shanghai）。此文件是当前快照；稳定架构见 [PROJECT.md](PROJECT.md)，开发规则见 [AGENTS.md](../AGENTS.md)，运行方法见 [README.md](../README.md)。

## 当前阶段与进行中事项

- 本轮已核对本地及GitHub main基线fd4bc856ef26e7482c05d251e39af4773eb40707。S0及特殊包权限修复已由用户确认通过ChatGPT代码审查；当前按授权连续实施S1-A1/A2/A3，不开发S1-B或扩大Goal/Policy。
- S1-A1/A2/A3工程及隔离自动化已连续完成：固定资源/安全网络、原版Pi Chat工具、当前原话与成功展示确认、单次持久许可/预算/快照、取消/强杀恢复、共用模型额度及Session正文额度。仅增量web_read_calls一表，不扩大Task/Memory/Goal/Policy权限，见[完整报告](evaluations/s1-web-validation.md)及[机器摘要](evaluations/s1-web-validation.json)。
- 工作在独立工作树 `C:/Users/Dongr/.codex/worktrees/v3-proactive/Persistent Personal Agent`，分支feature/s1-readonly-web；本地A1=36dca0c、A2=a77c729，A3见本分支最终Git记录，未推送。原E盘保留分支local/preserve-workspace-20261023及8份已有文件（含HANDOFF）Hash未变，不覆盖或混入提交。
- V3.0.1自然语言暂停与主模型操作收据误解两项真实失败列为**正式主动执行启用前必解项**，须独立修复并真实复验；[原始报告](evaluations/v3.0.1-live-retest.md)不改，不因V3工程收尾或Skills设计而标记通过。
- 最终两平台均Node24.19.0，typecheck/build/npm test/两个eval全部退出0；Windows387项384通过/0失败/3原平台跳过，Linux387全过/0跳过，Web专项85/85。137份项目/SDK文件Hash一致，检查后再次复核。首轮385项及新增竞争反例的失败/修复日志均保留；证据根目录E:/AgentWork/validation/personal-agent-s1-web-20261023-180629。Linux新容器全程network=none、无宿主挂载，同lockfile依赖仅从既有停止测试容器复制，未新安装；容器已停。Formation输出新路径，历史报告不改。
- WEB_READ_ENABLED、SKILLS_ENABLED、GOAL_ENABLED、PROACTIVE_ENABLED默认false，Formation不启用。本轮收费API、正式网站/真实账号、飞书/手机、正式.env/数据/历史验收库操作均0。[S0 Console体验方案](evaluations/s0-console-live-experience-plan.md)仍未获收费执行授权，不沿用旧预算。

## 已完成功能

- 终端对话与一次性任务创建、查询、仅 pending 取消；确定性命令可直接调用 Task Service。
- 独立 Scheduler 与 `--daemon` 入口，不依赖 stdin；后台串行执行，结果通过统一 `Channel.sendMessage()` 输出到控制台。
- SQLite 保存任务、Run、执行事件和模型调用；事务领取与唯一约束防重复领取，进程锁防同库双启动。
- 重启恢复 pending，遗留 running 标记 interrupted；失败、中断、投递失败不自动重跑任务。
- 到期任务领取前检查 Memory 文件/索引；已知故障保留 pending、无 Run/模型/投递，故障日志去重；恢复后单次执行。没有到期任务不检查，阻塞期间仍可取消；领取后再次故障仍失败且不重试。
- UTC ISO 时间存储，IANA 用户时区解析，支持 README 列出的中文时间；拒绝歧义和 DST 重叠/不存在时间。
- AgentExecutor 封装原版 Pi Session：交互会话进程内串行复用、原生 JSONL 跨重启恢复，后台每任务独立且临时；检查 `agent_settled`、模型/工具错误、截断和中断，记录可观察的模型用量。
- 交互三项任务工具与五项受控 Memory 工具白名单，后台无工具、仅宿主只读检索；内存凭据与设置，关闭自动资源发现与隐式重试。
- V1.2 新增 `SESSION_DIR`，默认 `<DATABASE_PATH>.sessions`；Console 与飞书应用/白名单用户分开存储，目录0700、文件0600，不扫描其他 Pi 会话，不因恢复重放历史请求或工具。
- V1 新增 `--feishu` 入口，使用官方 SDK 1.76.0 的 WebSocket 长连接；白名单 open_id、文本私聊，模型与回复串行使用同一交互 Session，后台继续独立 Session。
- Task 持久化渠道、App ID、chat_id、用户 open_id；消息目标由可信上下文绑定，模型不能指定。旧 V0 SQLite 增量加列与接收去重表，旧任务仍是 Console，保留原有内容和状态。
- `(appId, message_id)` 与 Run 原子落盘去重，重投及重启后重投不再调用模型；发送失败保存 deliveryError，成功任务不重跑。Console/daemon 发现 pending 飞书任务会拒绝启动，避免使用错误渠道消耗提醒。
- 宿主授权：主模型写工具参数仅作提议；隔离解析器只读当前原文及宿主待选类型/数量，不接收 Memory、历史或候选正文。宿主核对证据、时间、归属、状态、版本和唯一目标后授予一次性权限；具名/时间条件与指代取交集，多目标显示固定编号，实质改写先确认。普通陈述不自动保存；后台没有写工具。
- V2.0 四类 Memory 共用服务与 SQLite 索引：Semantic PROFILE、Project projects、Episodic episodes、Procedural procedures。仅明确记忆意图可写；规范化正文去重、稳定 key 冲突拒绝、版本检查、来源关联 Run、Hash 校验；不自动保存推断或提取全部对话。
- Memory 正文原子替换，索引可重建，启动和读取前修复；目录/文件0700/0600，宿主独占 Memory 锁，拒绝符号链接和凭据。通过 Pi 1.3.0 公开内联扩展和 context 返回本轮投影，工具只留收据，不把注入正文反复追加 Session；Context 异常公开 abort 并报错。
- Formation只在明确开启的测试进程发现待审批候选，没有未经批准的自动保存；未新增依赖、Embedding/向量库、Skills、WebUI、外部队列或VPS配置。
- V3.0长期Goal完整隔离闭环：四表/版本CAS/不可变Plan与Checkpoint、独立有界执行、自然语言控制、多目标澄清、计划调整、用户完成确认、等待与重启恢复；V3.1–V3.3另外加入明确策略下的定时、只读GitHub观察、有界text_only续段与有限重投Outbox，正式双开关仍关闭，没有外部执行工具。
- S0通过原生SDK加载批准Skill，Chat按需受限read、额度不足只拒绝读取；手动/主动Goal绑定包Hash并显式展开，审批、恢复、控制与通知仍走原服务。产品包agent-notes/interview-practice默认未安装到正式目录，安装和自动化演示见README。

## 最近关键修改（最多5项）

| 日期 | 修改及位置 |
| --- | --- |
| 2026-10-23 | S1-A1/A2/A3连续完成：阶段Windows329/332→354/357，最终Windows384/387、断网Linux387/387；Web85/85，五关均0。固定来源、可信许可、单表恢复；原始权限/确认竞争及网络时机失败保留，默认关闭、未推送 |
| 2026-10-23 | S0特殊包明确调用定点修复：先红后绿、专项53/53、Windows299/302且3原平台跳过；五关均0。新增Console16次/2元待授权方案、S1只读Web设计；用户随后授权提交推送，仅补发布交接状态，未收费，原真实失败保留 |
| 2026-10-23 | S0-A/B/C完成并逐阶段过关；最终Node24.19 Windows267通过/3原跳过、断网Linux270全过，两边五关均0；118源码Hash一致。用户随后授权合并推送main，发布仅补STATE；默认未启用，原始失败及阶段证据保留 |
| 2026-10-23 | V3主要工程按用户确认收尾；[原生Skills设计](designs/skills-tools-architecture.md)及[SDK隔离验证9项通过](evaluations/pi-native-skills-spike.md)，无产品功能启用；V3.0.1两项真实失败仍为主动启用门槛 |
| 2026-10-23 | 后台门修复7d02dd9：基线6项失败→18项专项通过，Windows246/249、Linux249全过，两边五检查均0；用户后授权合并推送main，发布只补STATE，未真实启用；[独立报告](evaluations/v3-background-lane-review.md) |

## 验证记录与证据边界

### V3.0.1本地真实模型复验（2026-10-23，未全通过）

- 按冻结A→B→C→D原话执行14请求，未增查/改名/重新生成。A/C数量通过，B未暂停，D取消目标正确但冻结预期中A应paused未满足；原始模型收尾还有错误推断，宿主最终呈现与SQLite一致。全过程只用新数据，未访问正式或历史验收目录/数据库；仅按追加授权受控读取四个LLM配置字段。
- 固定16/2/32KiB入口与6项离线闸验证后才联网；最终Windows213项210通过/3平台跳过，断网Linux213全过，两平台typecheck/build和两个eval均0。真实业务失败不被自动化绿灯覆盖，实际0.605440元是保守预留，账单未知。模型用量、SQLite断言及Hash见[JSON](evaluations/v3.0.1-live-retest.json)。本轮已停止，不自动花完剩余2次，不推送或启用日常Goal。

### V3.0.1离线定点收尾（2026-10-23，未真实复验）

- 数量和多重指代回归先失败后修复；真实45/47内容与原状态重建到独立临时库，原有效视图/交集/版本/投递/TTL/归属检查保留。事务拒绝、只调用一次、不自动修JSON、重启和已完成Step保留均验证，未修改旧原始输出或历史SQLite。
- Windows207项204通过/0失败/3平台跳过，断网Linux207全过/0跳过；两平台typecheck/build及eval:memory/formation均退出0，实际日志/Hash见[新机器证据](evaluations/v3.0.1-validation.json)。本轮未做真实模型/手机复验，旧Batch5完整清单仍未通过。方案中16次/2元尚待批准，旧48/5启动器不冒充新限制。

### V3.0 Batch5开关与电脑真实验收（2026-10-23，核心通过、完整清单未通过）

- 本轮48请求/5元授权已用48请求、预留2.337244元。用户改为电脑测试，未做飞书/手机复测。正式.env及原HANDOFF.md未变；测试正常停服、锁释放，不追加收费。验收完成后用户另行授权提交推送本轮代码、测试及文档，不包含正式数据或原HANDOFF.md。
- 原M01宿主误拒绝、错误意图/筛选、256KiB记录截断、模型自编Step ID、结果缺必填字段均保留。修复/显式再生成后完成计划v1、两题分别提交、等待/正常重启/未完成步骤接续、用户明确完成确认。重启34请求不变，旧执行Hash与最后有效Checkpoint逐项核对；最后确认无新Execution。
- 新学习安排期望一项却生成3步；暂停那个学习计划真实失败，库仍waiting_user。最后指代修复只通过原话/原解析离线回放及完整回归，不冒充收费复验。真实取消、调整、多活动目标、运行中竞争与新Goal飞书通知未覆盖。详细字段、原始日志Hash、失败前后及测试结果见[报告](evaluations/v3-batch5-acceptance.md)/[JSON](evaluations/v3-batch5-acceptance.json)。

### V3.0 Batch 2–4 MVP（2026-10-22，代码开发验收快照）

- 先复核Batch1四表、Run关联、CAS、原子Checkpoint、Plan v0/v1和控制恢复，存储/Task专项40项通过；Batch2的49项相关测试及typecheck/build通过后推进Batch3，Batch3全量185项182通过/3平台跳过后进入Batch4。最终增加故障与集成用例，不改冻结评测预期。
- [完整报告](evaluations/v3-mvp-validation.md)与[机器证据](evaluations/v3-mvp-validation.json)包含逐文件范围、命令、结果和Hash。真实SQLite/原版Pi SDK/本机模拟HTTP模型验证创建→计划→批准→片段→Checkpoint→等待→关库重启/空Session→继续→用户确认完成；真实main子进程三次启动验证ready恢复、waiting不请求及已完成片段不重放。飞书传输是模拟，不能当手机或真实模型成功。
- 故障覆盖暂停/取消与忽略abort的迟到结果竞争、重复请求/消息、非法计划/结构化输出、Memory失败/上下文错误、HTTP失败/截断/模型工具调用、失败显式重新生成、事务提交失败重读/停机、目标归属/版本/显示TTL/单操作互斥。新增通知回调竞争回归：权限只能引用实际发出的版本，不能在await投递后读新版本冒充显示过。
- Windows191项188通过/0失败/3跳过，Linux191通过/0失败/0跳过；两边typecheck/build、两个eval均退出0。Windows跳过仍为POSIX私有权限位、符号链接权限及POSIX SIGTERM；Linux均实际通过，未验原生Mac、Windows ACL或VPS。64题三集Top1/Recall@5/MRR/Context命中9/12、17/19、17/18；无答案误supported为0/4、0/5、0/6；最大Context1153/1613/1578字节；Formation开发/留出各30/30、误候选0、未经批准写入0；额外真实模型请求0。
- 日志保留于 `E:/AgentWork/validation/personal-agent-v3-20261022`。Linux首轮在线npm ci遇网络超时，随后本轮编排未等旧安装器退出便并行离线安装/测试，造成模块缺失；失败日志保留。确认旧安装器结束后，用lock一致的缓存离线安装，断网复跑全部通过。未将环境失败或历史通过替换为当前证据。
- 现阶段完整闭环仅在隔离自动化中成立；收费API/Token/费用0，无正式数据操作。自然语言仍可能漏工具/误解析，未做真实语义质量与手机送达、长时间运行验证。通知无Outbox；已提交成果不会因通知失败重跑，通知可能丢失。

### V3.0 Batch 1 存储与事务（2026-10-22，历史阶段，提交65dcabb）

- 生产改动仅 [goal-types.ts](../src/goal-types.ts)、[goal-store.ts](../src/goal-store.ts) 和 [sqlite-store.ts](../src/sqlite-store.ts)。不改Pi、OperationGuard、TaskService、Scheduler、渠道、Memory权限、Session或依赖。`SqliteStore.goals`共用原连接；原Run内部写入方法不自行BEGIN，Goal结果与进度必须同事务结束，普通finishRun拒绝单独结束Goal Run。
- [32项Goal专项](../tests/goal-store.test.ts)用虚构临时库和本地子进程：创建/领取/审批/Checkpoint/控制/共享恢复故障整体回滚；两项延迟外键直到COMMIT才失败；两个进程竞争只有一个领取；取消和结果的两种固定顺序以及真实跨进程竞争；子进程直接退出后普通中断blocked、pause→paused、cancel→cancelled；恢复幂等、没有新授权不再执行。
- Plan v0创建、v1仅草稿、批准才建新Step/Plan、仅批准不执行、明确批准并继续才ready、v2保留旧版和已完成原义/移除未完Step为superseded均验证。partial/complete/blocked映射、Checkpoint前指针/归属/Hash、跨Goal指针拒绝、已提交Execution不可改写、最终用户确认、暂停后的计划/完成确认恢复均覆盖。
- 控制收据已落盘而前台Run失败/投递失败，或Checkpoint通知失败时，重开库仍能经receipt/view重展示真实计划/成果；Run数量不增加、没有ready授权。已成功Run却无Checkpoint的异常组合被uncertain阻塞，不根据output猜进度。不从Memory、Session或历史Run产生权限；模型语义判定尚未接入，不能声称已做Goal提示注入或自然语言验收。

| 本轮命令/环境 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 退出0，源代码及测试类型均通过 |
| `npm run build` | 退出0，使用兼容Node24.19.0，未修改依赖 |
| `npm test` | 171项，168通过、0失败、3跳过，14.65秒；含32项Goal及旧Task关键回归 |
| `npm run eval:memory` | 退出0，64题离线词法；三集Top1/Recall@5/MRR/Context命中仍9/12、17/19、17/18；无答案误supported为0/4、0/5、0/6；最大Context1153/1613/1578字节；额外模型调用0 |
| `npm run eval:formation -- --output=<临时新文件>` | 退出0，开发/留出各30/30、误候选0、未经批准写入0；模拟请求不计真实API；真实请求/Token/费用0 |

- 三项Windows跳过是POSIX私有权限位、无权限创建符号链接及POSIX SIGTERM优雅退出；不是Goal存储测试跳过。本轮没有Mac/Linux新证据，历史Linux137通过不能当成本批通过。第一次Formation输出参数被PowerShell拆分而误写默认历史报告，随后恢复原Git版本、用单个完整参数重跑到临时文件；已核对历史评测文件无diff，冻结样本与原失败记录保留。
- 测试日志及两项离线报告留在本机临时目录 `personal-agent-goals-validation-8f175179-3cd2-493e-ab79-a4f9bcfaa583`（系统TEMP下）；不写正式数据目录。无收费API、正式用户Agent、真实Goal/飞书联调；未开启正式Formation。
- 提交前另在只包含本批8文件的隔离快照复跑：typecheck/build退出0，全量171项168通过/0失败/3原有平台跳过，15.69秒。原工作区复跑曾有一项Memory测试因Windows临时文件rename返回EPERM失败，原2项证据集成测试单独复跑均通过，隔离全量也通过；未为此修改Memory实现。日志在系统TEMP的 `personal-agent-batch1-release-084b341b-e760-4a71-bce7-d88968049287/validation.log`。发布期间发现的并行GoalRunner改动（含GoalStore新增查询方法）原样保留，不纳入本批提交。
- 剩余：本批没有Runner、自动领取、控制abort、Goal自然语言工具、最终渠道呈现或可靠通知。view暂返回全部历史；uncertain需人工核对，不提供绕过不变量的强制重试。Batch2必须有界投影输入、验证Pi结果、提交失败先重读并停止新领取，不能把完整存储快照直接当无限上下文；详见设计第15节。

### V2.1b.4 真实飞书回归（2026-10-22）

- 独立虚构数据、真实官方飞书连接、真实主模型/隔离解析/Formation提取；24/32请求均HTTP200、10个手机Run成功且无投递错误。总预算保守预留0.977334/2元，非供应商账单；未花剩余额度，测试服务正常停止，正式Formation及正式数据未改。
- 普通陈述只形成候选；“第一条先不保存”实际rejected。新Baryl项目显示后批准才新增project v1，Cedar旧条目未改。H02真实原响应漏“不”且误指服务端旧ID，宿主记录恢复/丢弃目标事件，完整时间/否定/范围作为新草稿显示，经用户批准才新增semantic v1，旧服务端记录不改。最终2 applied/1 rejected、Memory4含2种子、未批准写入0、Task0。
- 使用此前不存在的sessions-fresh，首问前历史0。首问Run `55bc7f18-a374-4efd-a0cf-7d161c5496af`命中Memory `bdc8609f-0fbd-43af-bd1c-0faa5ae4cc6b` semantic/v1及服务端旧条目，Context878字节、uncertain；最终回答准确区分移动端/脚本/服务端，用户手机确认；没有动态Memory Context持久累积。
- 本轮Windows139项136通过/3平台跳过，typecheck/build通过；Linux及固定eval沿用前批证据，不冒充重跑。前2次原始流未落盘的测量问题如实保留，测试记录器修正后第3–24请求原始输出可查。主模型漏拒绝工具和H01跨项目错误提示本轮未出现，仅保留前批自动化故障证据；不将本轮有限样本当长期成功率100%。
- [完整验收报告](evaluations/v2.1b.4-feishu-acceptance.md)及[机器证据/Hash](evaluations/v2.1b.4-feishu-acceptance.json)供ChatGPT审查；只改测试工具与文档，生产源码/冻结样本未改。本轮按用户明确授权交付main，不自动开启正式Formation或继续新功能。

### V2.1b.3 三项定点修复（2026-10-22）

- 先以保存的[8窗真实输出](evaluations/v2.1b.2-formation-live.json)离线复现H01/H02：6/8；新增“主模型仅口头拒绝”回归仍pending，修复前2项均红。[前后回放](evaluations/v2.1b.3-formation-replay-before.json)及[修复后](evaluations/v2.1b.3-formation-replay-after.json)的原始输出/fixture/逐行Hash一致，修复后8/8；没有改模型输出或冻结期望。
- 宿主仅对当前整句有界拒绝、已成功显示的候选及本轮无其他操作时补执行；继承原owner/TTL/digest/revision/hash/序号检查，引用/假设/未投递/错编号/后台/关闭开关不获权限。Pi正常执行及历史仍保留，不追加模型请求；主模型模拟口头回复，最终实际rejected、无Memory写入及再次形成。
- H01只在主体确定的新项目、无合法旧目标时丢弃另一项目的模型提示，以pending新增候选保留完整原话，不能更新Cedar等其他项目。H02仅恢复源首个自述子句中能唯一核对的一次否定遗漏；同范围旧值/错误ID仍澄清，不能跨移动端/服务端覆盖。测试分别批准后新增v1、来源为当前审批Run，旧ID/version/hash/content未变；没批准始终零写入。
- Windows及断网Linux真实Pi/SQLite/文件测试：typecheck/build均0；137项Windows134通过/3跳过、Linux137全过/0跳过。60窗开发/留出各30/30，未批准写入0；64题三集Top1/Recall@5/MRR/Context命中仍9/12、17/19、17/18，误supported0/4、0/5、0/6，最大Context1153/1613/1578字节。机器证据/日志Hash见[validation](evaluations/v2.1b.3-validation.json)。
- 本批收费API/Token/费用0，未做新真实模型或手机复测，不分析正式历史、不改正式开关；原手机46请求账本与旧失败保留。更复杂措辞、不同否定结构及未知模型输出仍可能失败，8/8不能作为长期质量百分比。细节及复测步骤见[报告](evaluations/v2.1b.3-formation-fixes.md)。

### V2.1b.2 手机验收收尾（2026-10-22，原始阶段记录保留）

- 真实渠道、真实主模型及隔离解析器，沿用同一隔离Task/Memory/Session与累计账本；请求上限40→48经用户另行明确授权，费用始终最多2元。实际46请求均HTTP200，无网络重试；保守预留1.877388元，不是实际账单。model_calls 46条：未缓存输入22894、缓存读取72704、输出1643 Token，费用字段null。16个Run均技术执行成功、Task0，不等于16次用户意图都正确完成。
- 已实际核对：普通偏好先形成pending且Memory0；显示后批准成为semantic v1；修复后普通项目事实的错误memory_remember被宿主阻断，随后形成pending；明确拒绝后真实rejected、Memory不变。原“第一条先不保存”仅口头答应且仍pending的失败保留，没有顺手改主模型工具路由。
- 手机形成“寒山／含山”两个不同项目的法语候选，第二条编辑后revision2仍pending、Memory原2条不变。实际用户编辑原话为“含山验收项目的第二语言是德语”，不是计划的界面语言；开发者指出差异后用户明确同意。审批Run `984e8544-7536-4876-871f-12095f0011ed`绑定revision2/Hash，经原Guard新增project Memory `8d62c78f-64f5-4fef-b014-bb0e154adcb8` v1、正文与Markdown一致，source.reference为当前审批Run。候选revision与Memory版本分别记录，原2条未改。
- 02:14:12使用此前不存在的sessions-fresh重启，首次查询前用户历史0，未删除旧Session或手机聊天。02:17:56的首个问题仅“含山验收项目的第二语言是什么”，Run `f263f33f-aeb6-435a-85ac-3071f0db186b`实际命中上述ID/project/v1，Context678/2048字节、supported；回答“含山验收项目的第二语言是德语。”，未调用写工具、成功投递，用户手机确认收到。JSONL只含固定系统提示、本轮用户及助手，Memory注入正文未另行追加为历史输入；助手正常回答可含事实。不是仅凭“我记得”认定Memory命中。
- 最终Memory3条（两条经批准+一条修复前误写现场），候选2 applied/1 rejected/1 stale；第一条寒山因Memory变化保守失效，未进入知识。新Session问题也触发一次只读形成提取、无新候选，已计入46请求。正常停止进程、锁释放，保留全部私有快照audit/01–15，不清理失败数据、不开正式Formation、不追加模型调用或推送。
- 仍需后续单独决定：主模型普通拒绝漏工具、H01错项目target/H02丢否定导致的候选失败、Windows ACL与原生Mac验证、更多同义问法/长期形成质量；不在本次扩大修复。完整步骤、日志Hash与费用边界见[平台/手机报告](evaluations/v2.1b.2-platform-feishu-review.md)及[保存意图修复](evaluations/v2.1b.2-memory-consent-fix.md)。

### V2.1b.2 平台补跑与手机验收准备（2026-10-22，以下阶段记录保留）

- [完整记录](evaluations/v2.1b.2-platform-feishu-review.md)包含环境、命令、日志Hash、计费边界和待验收步骤。官方Node24.19.0 Linux容器只复制允许文件，无.env/正式数据，npm ci后断网。初轮123全过；补入3项验收预算测试后最终126全过、0失败/0跳过，约20.62秒。此前Windows跳过的Unix权限、符号链接和POSIX SIGTERM均实际通过；不是原生Mac/VPS或Windows ACL验收。
- Linux typecheck/build、eval:memory、eval:formation退出0；固定64题及60窗预期保留，全部模拟，无收费调用。Windows最终typecheck/build退出0、126项123通过/0失败/3跳过，约10.60秒。原始日志只在忽略的data/acceptance/formation-platform-20261022，Hash见报告。
- 用户另授权手机40模型请求/2元、虚构数据、确认其他电脑Agent已停。启动器固定data/acceptance/formation-feishu-20261022三份存储，用真实生产main/飞书渠道；测试进程Formation=true、QueryRewrite=false，正式.env不改。所有模型调用发送前落预算，跨重启累计、错误不退款；本轮0请求/0元预留。
- 真实飞书尚未连接：官方认证10014/app id not exists、无Token；当前.env App ID为示例值，非环境覆盖。隔离库Task/Run/model_calls/Job/候选均0、Memory Markdown0，测试已退出。待用户只在本机配置真实App ID与同应用Secret，不在聊天发送。未开始手机普通陈述/清单/批准/拒绝/编辑确认/新Session检索，不能标记通过；不自动修H01/H02、开启正式形成或推送。
- 后续用户修正App ID后真实长连接成功；首条普通偏好形成pending，Memory索引/Markdown0，手机查看清单后批准，applied及v1来源当前审批Run均核对通过。随后普通项目陈述却绕过候选、直接经memory_remember写入，来源Run416f52d2-da53-4831-9fdf-21e7dc2e86f7，Memory c13dacc2-fb06-48c0-9557-35ea0044a3a7/v1；下一轮显示无候选与真实状态一致。原话没有记忆请求，不能将source=user_explicit标签当授权证据。
- 本轮手机最终14请求、保守预留0.545922元，model_calls输入9106/缓存读取16000/输出507 token，账单未核验。正常停止测试进程、未删除误写现场，未触及正式数据；首条候选审批通过不抵消本次非请求写入1条。拒绝、编辑确认、手机全新Session仍未验收，不能记通过。完整证据及拟修复范围见[报告](evaluations/v2.1b.2-platform-feishu-review.md#拒绝验收失败普通项目陈述被直接保存)。
- 随后用户批准修复，生产仅operation-guard.ts变更：保存动作与事实证据分离，有界自然表达快路径、未知请求先确认、否定/引用/普通陈述不直接写，长确认不能只信解析器标签。新增3组回归在旧代码0/3、修复后14项自然语言全过；新增真实Pi+模拟错误分类仍无Memory写入。Windows全量130项127通过/3跳过（11.15秒），Linux130全过/0跳过（20.81秒），两平台typecheck/build和Linux两个eval退出0，未改冻结预期。详见[修复记录](evaluations/v2.1b.2-memory-consent-fix.md)。
- 01:47:39仅隔离测试服务重启，账本保留14请求/0.545922元起点，未清理2条旧Memory；指导同句式新项目“寒杉验收”以避开旧错误记录去重，原始失败不抹去。后续手机结果待核对，不把自动化绿灯当作真实复验通过。

### V2.1b.2 隔离真实模型复验（2026-10-22）

- 用户明确确认最多12请求/总预算1元，仅虚构数据、无正式Formation/历史。调用前冻结[8窗](../tests/fixtures/memory-formation-revalidation.json)，六原样本与旧预期逐字一致，两个新样本不按结果修改。基线f79a8b8，生产Hash仍一致；[真实原文及状态](evaluations/v2.1b.2-formation-live.json)、[离线断言/人工判断](evaluations/v2.1b.2-formation-live-review.json)和[完整报告](evaluations/v2.1b.2-formation-live-review.md)分别保留。
- 实际UTC `2026-10-21 16:33:16.475–16:33:36.347`，当地2026-10-22 00:33；来源Run和Job中旧日期是虚拟测试时钟。8提取+2审批解析+2只读生成共12请求，均HTTP200/stop，无重试。成功来源Run、空闲推进、主Agent工具调度及清单显示模拟；真实部分为生产提取器、宿主隔离审批解析和Pi新Session生成，不记作真实飞书或自然工具选择验收。
- 保守预留0.616810元，低于1元，调用上限已用完。响应prompt5680（含cacheRead1024、未命中4656）、output1076；按当日核对官方峰时2/0.04/8元每百万估算0.01796096元，非账单证明；费率链接与计算见报告。单请求P50 1186.96ms、最大1909.15ms，不是手机/前台全链路。
- 宿主预期6/8，原六窗6/6，新两窗0/2；值得保留事实可直接批准4/6，含需澄清保留5/6。F01/F02完整时间/范围被接受，F05重复及F06小岚错target仍靠宿主拦截。H01模型两条Beryl提议都指Cedar旧ID，违反单来源单提议；宿主仅留首条完整草稿需澄清、无target，不覆盖Cedar。H02property“做移动端项目使用Ruby”缺“不”，不在原文连续片段中且错指服务端旧事实，来源校验拒绝；不是原先单边去时间词的宿主问题。本轮不修、不重跑、不降预期。
- 未批准写入和Task创建均0。F01 Memory `8222a56c-a79a-4a17-8c0d-13d340e7770e` v1，审批Run `ef578232-ae36-4716-8a2f-e17a5a4e5f6d`；F04同ID `8ac6d6e9-2570-48db-840e-fdf891350810` v1→v2，审批Run `6fcdcd01-7c03-4804-ace5-315a3170c407`。两条正文保留原话、source为当前批准Run；两个新无工具/历史Session答简洁中文、主要TypeScript且Python用得少，命中同ID当前版本，Context668/628字节，生成无写入。F04标签uncertain保留，不据正确回答外推标签质量。
- `npm run typecheck`、`npm run build`退出0；`npm test`123项、120通过、0失败、3Windows平台跳过，约10.82秒。新预算/冻结样本专项5项通过；`scripts/review-formation-revalidation.ts`离线断言退出0。本批未重跑两个eval入口，生产无变化，沿用V2.1b.1的60窗/64题；Mac/Linux三项、真实手机、主模型自主工具选择、长期运行/账单未验。没有提交推送或启用正式Formation。

### V2.1b.1 定点修复与离线回放（2026-10-21）

- 先运行[保存输出回放](../scripts/replay-formation-live.ts)及新增回归，实际退出1、只失败F01/F02；[修复前](evaluations/v2.1b.1-formation-replay-before.json)10/12、4/6。仅修改semantic来源校验后，[修复后](evaluations/v2.1b.1-formation-replay-after.json)退出0、12/12、6/6。property中的“平时／以后做Agent项目”以及完整quote/draft/否定均保留，不用裁掉范围的属性查旧目标。
- [机器对比及Hash](evaluations/v2.1b.1-formation-comparison.json)断言两次原始输出相同、仅F01/F02结果改变；冻结12/60窗、原真实报告/人工判断/损坏导出/历史60窗结果与HEAD字节一致，未覆盖失败或调整预期。回放只重新绑定随机sourceRunId/已有targetId，不改模型语义字段；各窗均不批准，Memory摘要不变、Task0、实际API/Token/费用0。
- 新增4项回归：固定12窗，F01/F02/F04经真实OperationGuard+模拟清单/审批调度落盘，及16项额外正反例。只查看/提取写入0；明确批准后F01/F02原话v1、F04同ID v2，来源指向当前审批Run。跨主体/项目错误目标、缺少范围、假设/引用/敏感、伪造来源/原文仍拒绝或阻止直接批准。不是新真实生成或手机验收。
- `npm run typecheck` / `npm run build`退出0；`npm test`121项、118通过、0失败、3平台跳过，约11.78秒。`npm run eval:formation -- --output=docs/evaluations/v2.1b.1-formation-offline.json`退出0，[60窗](evaluations/v2.1b.1-formation-offline.json)开发/留出各30/30、候选各11/11、未批准写入0；新增可选新报告路径，不覆盖历史默认报告。
- `npm run eval:memory`退出0，[64题新结果](evaluations/v2.1b.1-retrieval-regression.json)三集Top1/Recall@5/MRR/正确Context比例仍9/12、17/19、17/18，误supported仍0/4、0/5、0/6，最大Context1153/1613/1578字节；额外模型调用0。并行评测P50约17.80–19.15ms，仅是本批采样，不判断性能提升或退步。
- 平台：沙箱内WSL列表访问拒绝，授权范围外只读核对仅有docker-desktop；Docker Desktop Linux引擎管道不可用，未取得Mac/Linux环境。Unix权限位、文件符号链接及POSIX SIGTERM三项仍跳过，未安装/启动其他环境或声称已通过。
- 当前冻结12窗无剩余宿主漏提/负例候选；原模型重复及第三人称错误提议仍在，未知语义效果未解决，不能把离线6/6当新模型质量达标。旧review-formation-live脚本的源码Hash保护不改，应在原基线复核；当前使用新回放。完整差异、文件职责及最多12请求、保守预留0.879680元/总闸1元的待授权方案见[修复报告](evaluations/v2.1b.1-formation-fix-review.md)。

### V2.1b 隔离真实模型验收（2026-10-21）

- 实现基线 `eabc01dbd0dee70f4606cb226decee311f611d24`，Windows、Node24.19.0、Pi1.3.0原版；源代码Hash与实际调用时相同。用户授权最多16请求/1元，仅虚构数据、不发飞书。UTC `14:52:31.373–14:52:50.364`，当地22:52；正式Formation前后false，查询改写false，正式存储未访问。
- [冻结12窗](../tests/fixtures/memory-formation-live.json)、[请求/响应与Job/候选/Memory](evaluations/v2.1b-formation-live.json)、[逐项人工判断与离线断言](evaluations/v2.1b-formation-live-review.json)、[完整说明](evaluations/v2.1b-formation-live-review.md)保留失败，未调整预期。源成功Run由测试构造、空闲用虚拟时钟推进；主Agent查看/审批工具调度与清单投递模拟。真实部分是生产候选提取器、隔离审批解析及新Session只读生成，不冒充手机全链路。
- 实际13请求=11提取+1审批解析+1生成，全部HTTP200/stop，零重试；F12虚构密码被宿主预滤，F01无候选导致原定审批/生成跳过，不补足16次。供应商响应输入4830/输出856/cacheRead0 token；按请求字节/输出上限和输入10/输出20元每百万保守预留0.513240元。按当时官方峰时2/8费率估计0.016508元，非账单证明，来源及口径见报告。单请求P50 1384.92ms、最大2433.27ms，不是手机/前台端到端延迟。
- 宿主预期10/12、保留候选有效4/4、值得保留事实召回4/6，未达80%目标。F01“平时偏好”和F02“以后做Agent项目主要使用”被模型正确提取，但宿主只在来源移除时间前缀、未同步property，`formation-service.ts:122–123`的owns校验误拒绝。原模型有用新提议6/8；另外为重复提议与F06把小岚语音偏好误指用户旧记录。宿主去重/主体校验阻断，未批准写入0，Task创建0。未修生产代码，不声称真实precision90%/recall80%门槛达标。
- F04真实审批将Memory `7546e8c3-629b-4a5d-9e9b-2e85d265adf3`（fixture.language）原ID v1→v2，来源为审批Run `48b75941-de24-43aa-932a-c2bea6aeff2c`；新建无工具/无历史Session回答“我目前主要用 TypeScript，Python 已经用得少了。”，保留原限定，命中同ID/v2、Context628/2048字节，生成无写入。回答第一人称角度可改进；只完成1条真实批准/生成，未执行的F01不记通过。
- 首次报告对整个JSON脱敏破坏F12闭合引号，原字节[另存](evaluations/v2.1b-formation-live.redacted-original.txt)并保留Hash；仅离线修复该字段、改验收脚本为按字符串值脱敏，新增结构/引号/换行回归。真实调用未重跑、模型输出未改，原报告脚本Hash对应修复前版本；生产Hash仍一致。
- 本批重跑 `npm run typecheck`、`npm run build`退出0；最终 `npm test`117项、114通过、0失败、3跳过，约13.64秒。Windows未验证Unix权限位、文件符号链接及POSIX SIGTERM案例；离线报告复核退出0。本批未重跑两个eval入口，生产未改；实现批次64题/60窗证据保留下节。未验证第二轮、真实主模型工具选择、手机、长期运行/账单与Mac/Linux跳过项；后续需单独授权定点修复及新的收费复验。

### V2.1b 实现批次离线机制验收（以下原始记录保留）

- 当前Windows，Node24.19.0；沙箱原子重命名EPERM后在授权范围申请沙箱外执行临时数据测试。系统Node24.12不满足项目要求，未替换系统安装或改正式.env。
- `npm run typecheck`、`npm run build`均退出0；`npm test`最终114项：111通过、0失败、3项因Windows能力明确跳过（约7.72秒）。`npm run eval:memory`、`npm run eval:formation`均退出0，详情见[本轮报告](evaluations/v2.1b-formation-review.md)。Windows未验证Unix权限位、文件符号链接拒绝、POSIX SIGTERM进程测试；其余恢复/后台/鉴权与持久化模拟回归继续执行。不能宣称Mac/Linux进程验收本轮重跑通过。
- [冻结60窗](../tests/fixtures/memory-formation-windows.json)和[逐项/Hash/延迟报告](evaluations/v2.1b-formation-offline.json)：开发/留出30/30，保留候选各11/11，负例误提0，未批准写入0。40次均为模拟提取器调用，真实模型/API/Token/费用0。脚本预设输出不证明真实语义正确率或漏提率已达标。
- 旧64题Top1/Recall@5/MRR/正确Context比例仍9/12、17/19、17/18；无答案误supported0/4、0/5、0/6，最大Context1153/1613/1578字节，金标/旧报告未改。自述“我…”批准后新Session可检索，主体别名不授予写权限。
- 小样本入队宿主P50约4.50ms、P95约6.88ms，模拟完整处理最大37.52ms，最大1264/2000输入字节；非真实网络/模型时间，也非大库性能。候选费用按配置费率上界预留，实际账单未测量。清单发送失败/模型失败不能批准未显示内容；每轮批准一次，源为当前审批Run。
- 未真实测试：形成模型/手机、语义同义去重、主观信息价值、中文分类/漏提率、长期运行、大规模Formation、崩溃/断电和安全擦除。默认Formation/查询改写保持false；本轮未分析私人历史、自动保存或推送GitHub。

### V2.1a.1 历史收尾（以下原始记录保留）

- 当前环境：macOS，Node `v26.3.1`，npm `11.16.0`；项目要求Node >=24.15.0。只使用临时虚构数据，无正式存储读写。
- 本轮[收尾报告](evaluations/v2.1a.1-closeout.md)与[64题/归属/性能对比](evaluations/v2.1a.1-closeout.json)记录源码、冻结Fixture Hash及逐题结果；[历史证据报告](evaluations/v2.1a.1-evidence-review.md)、旧评测和真实生成原文未覆盖。
- 最终完整测试的受限运行遇到127.0.0.1监听EPERM；申请本机回环权限后完整重跑通过，不将环境受限误报为业务失败或跳过后声称成功。
- 发布核验仅更新文档状态，复核11个交付文件、凭据模式、文档链接及源码/测试/冻结样本Hash；与下表已验证的实现一致，因此没有重复功能测试或调用收费API。无关Icon和正式数据不纳入提交。

| 检查 | 本轮实际结果 |
| --- | --- |
| `npm run typecheck` / `npm run build` | 均退出0，包含src/tests/scripts类型检查 |
| `npm test` | 96通过、0失败、0跳过，约6.66秒；真实Pi SDK/存储，模拟API/飞书，不是收费语义验收 |
| `npm run eval:memory` | 退出0，冻结原16+旧24+证据24共64题；没有修改样本、预期或历史结果 |
| Top1 / Recall@5 / MRR / Context命中 | 原集均9/12 / .750、旧独立均17/19 / .895、证据留出均17/18 / .944，前后不变；原词4/4不退 |
| 无答案与证据 | 三集无答案误supported仍0/4、0/5、0/6。旧24发布结果证据10→9项：不再借用户反馈当项目证明，正确候选/Context不丢失；记录支持精度10/10→9/9，非最终答案精度 |
| 新主体正反例 | 实际旧/新retrieve的14项约束7→14通过；未知同事等6项误支持消除，合法“也喜欢/并且喜欢/喜欢”及属性省略保留，已知多主体分别归属；含“的”的省略仍保守且保留候选 |
| Context与范围 | 三集最大1153/1613/1578字节，预算仍2048；新增范围/排除说明，严格预期key比例仍60.0%/44.7%/39.5% |
| 100/1000性能 | 12次/项；100条定向Context P50 4.18→4.11ms，宽泛5.27→4.95ms；1000定向55.54→53.80ms、宽泛162.18→116.96ms，组末RSS约157MiB。单批样本，不承诺通用加速，最坏仍可能二次比较 |
| 集成与旧能力 | 新空Session当前Memory、更新/删除、投影不持久化、后台隔离、恶意Memory无写权、Task/Feishu/Guard继续通过；完整库abai.contact存在，但本轮Context排除，不暗示全库不存在 |
| 本轮未执行 | 收费模型/真实飞书、正式数据核对、成功改写后的真实生成、V2.1b实现、10k/Linux负载 |

历史Git：V2.0 `73bdad5` / `73e4887`，V2.0.1 `688ea0d`，授权加固 `2938a6f`，V2.0.2 `e042118` / `8b531f9`、验收记录 `dcec1f4`，V2.1a `087888c`，V2.1a.1 `eeaeae9`。以下历史真实验收保留原代码/提示基线，不转写成本次修复后的新证据。

### V2.1a.1 只读真实生成验收（2026-10-21）

- 用户明确授权4问、改写开关各一轮、最多12请求/1元，仅发送虚构Memory。UTC `07:12:35.803–07:14:28.102`（当地15:12–15:14），真实Pi SDK 1.3.0 + 当前硅基流动DeepSeek-V4.1-Flash，进程正常退出0。8次独立task-scope临时Session，无工具和历史，不创建正式Task、不经飞书。
- 先核对[原始最终回答和实际请求Context](evaluations/v2.1a.1-live-generation.json)，再对照完整15条虚构记忆，保留[逐条人工判断及代码/报告Hash](evaluations/v2.1a.1-live-generation-review.json)。不是只看模型自述，也不让被测模型打分。每条Context的ID/key/version=1、正文、事件及字节一致性均离线断言，最大1537/2048字节。
- 费用未知和未来日期未知在开/关两轮都正确拒绝编造；阿青联系方式均回答电话沟通；UI均回答日语，并未误用Kotlin。主答案8/8；但关闭组联系方式额外声称“没有阿白联系偏好的记录”，实际完整虚构库有abai.contact（邮件），仅本轮排除了它，故整段严格评为7/8。未擅自修生产提示、重跑或删除失败回答。
- 开启组3次改写约5.002–5.004秒aborted后词法回退，1题置信度足够跳过；没有成功改写。本次验证了真实生成与回退路径，不能冒充成功查询改写后的生成已验证；超时的服务端/网络根因不确定。
- 合计11请求，8次生成stop、3次改写中断；输入4885/输出312 token，仅是已报告部分。按重新核对的官方输入2/输出8元每百万估算0.012266元；中断可能有未报告消费，其中2次SDK为0/0。脚本按请求体字节/输出上限保守预留0.331976元，低于授权1元，但非实际扣费证明。关闭组耗时1.255–13.901秒，开启1.405–42.410秒，不能将全部延迟归因于5秒改写。
- 临时Memory ID/version/hash前后一致、Task数量0；自建临时目录清理，原始证据只含虚构知识与模型响应，没有凭据/正式历史。仅补验收脚本审计、预算回归及文档，重跑typecheck/build/94项测试/default eval退出0，Retriever/Context/PiExecutor与生成时源码Hash不变。未开发自动记忆形成，改写继续默认false，不消耗剩余1请求。

### V2.1 查询改写隔离真实验收（2026-10-21）

- 用户明确同意最多80次、两轮只读改写。使用当前硅基流动 `deepseek-ai/DeepSeek-V4.1-Flash`，UTC观测窗口05:36–05:38；两个进程均正常结束。只发送冻结的虚构问题（无Memory正文、历史、工具或正式数据），本地检索运行在临时目录；没有生成答案/飞书发送，不是完整Pi真实模型端到端验收。
- 两轮间未改排名器、提示或题目预期；冻结的retriever/最终留出Hash一致。原始[第1轮](evaluations/v2.1-live-rewrite-round1.json)、[第2轮](evaluations/v2.1-live-rewrite-round2.json)、[汇总及代码Hash](evaluations/v2.1-live-rewrite-acceptance.json)保留逐题候选/证据/Context、实际改写及Token/耗时。API用量来自供应商响应，失败请求可能有未报告消费。
- 两轮各22/40题触发额外调用、18题跳过；累计44次，43次成功、1次回退，未消耗剩余36次额度。首轮“木星环厚度”失败且回退为空，当前脚本未区分上游/JSON/Schema原因；第二轮成功。温度0仍有改写变化，“机器人断线”第1轮误排数据库备份、第2轮首条正确，保留两次结果。
- 真实改写的召回更好，但留出Context严格预期key比例两轮均69.2%，低于词法版71.4%；“阿青联系方式”正确记录在Top5却未进入Context，“阿青每月电话费用”两轮把Quartz套餐排首位并标supported。不能用Recall@5=100%掩盖主体错误或把证据标签当事实证明。真实模型未见Memory正文，因此没有观察到最终错误回答或真实拒答，只确认检索层风险。
- 本轮重跑typecheck/build/完整84项测试与默认eval通过，80个真实评测题次可离线回放（无额外API且除耗时结果一致）。目前仅补验收记录，不按留出失败调算法、不改默认开关或正式配置。

### V2.0.2 “验收1021”真实飞书验收（2026-10-21）

- 用户按启动步骤在 Mac 上运行、用手机飞书完成操作并报告可用，提供4张截图。当前代码基线 `8b531f967e0c1c7391a44f718e68c681fb10aaf9`；实际模型为硅基流动 `deepseek-ai/DeepSeek-V4.1-Flash`，配置时区 Asia/Shanghai，与本节展示的 Asia/Taipei 同为 UTC+8。
- 验收窗口为 UTC `03:40:08.243–03:43:47.134`，当地 `11:40:08–11:43:47`；执行/Memory 联合只读断言于 UTC `03:49:28.338` 完成，任务最终复核于 `03:51:03.818`。使用 SQLite readOnly + query_only + 读取事务核对 `data/agent.db`、独立 Memory 索引；只读当前身份 JSONL 中该时段的相关记录及受管 Markdown，不实例化会修复索引的 MemoryService，不修改正式数据或重启进程。
- 截图保留在聊天，不复制进仓库；文档只记录虚构测试事实、任务/Run 标识和汇总，不记录 App Secret、Key、open_id、chat_id 或其他私人对话。样本任务目标一致，均匹配配置的飞书应用/白名单用户。

| Task ID 前8位 | 手机操作及真实结果 | UTC 到期时间 | 核对时状态 / 后台 Run 数 |
| --- | --- | --- | --- |
| 468ceb09 | “过十分钟记得叫我喝水”后说“刚才那个提醒不用了”，创建/取消指向同一任务。此项无1021标记，通过该时段原话、唯一任务和操作事件关联；越过原到期后仍无后台 Run | 2026-10-21 03:50:10.496Z | cancelled / 0 |
| 7fc49eae | 明天上午9点参加验收1021会议；是宿主候选列表第二项，“第二个”只取消此 ID | 2026-10-22 01:00:00Z | cancelled / 0 |
| 585b9d6c | 明天上午10点参加验收1021会议；是列表第一项，未被第二项选择误取消 | 2026-10-22 02:00:00Z | pending / 0 |
| 29ab6ba8 | 两分钟后提醒“验收1021主动通知成功”；仅一条后台 Run，结果与投递各成功一次，用户确认手机收到 | 2026-10-21 03:43:44.156Z | succeeded / 1 |

- **澄清与查询核对：** Run `703c0490` 返回两个候选，无 operation_authorized/committed；JSONL 宿主选项明确为 `[585b9d6c, 7fc49eae]`。随后“第二个”的 Run `beefe00d` 只提交对7fc49eae的 cancel_task。Run `9df69604` 实际调用 list_tasks，返回10点 pending、9点 cancelled，只有查询、没有写提交；不是仅根据机器人文字判断成功。
- **主动通知核对：** 后台 Run `f85e85f0-7dfd-40e9-9951-8e7f8f6eed23` 于 UTC `03:43:44.697` 领取，`03:43:46.449` 完成，`03:43:47.134` 记录 delivery_succeeded；1次模型响应，无工具/错误/投递错误。到期至投递 API 成功约2.978秒，未把它当作手机端展示延迟，也不据单一样本宣称恰好一次保证。
- **Memory 核对：** “飞书验收1021项目的吉祥物是蓝色纸鹤”保存为 project，ID `db23b94f-199d-466f-9d17-c0006eb078fa`，key=`飞书验收1021项目吉祥物`，version=1，source=user_explicit。保存 Run `b99b294b` 有 remember 提交和真实工具收据；检索 Run `0c5e3dc7` 的 memory_search 返回该条，memory_context 命中同一 id/project/v1，339字节，预算2048。删除 Run `0eeadbf2` 有 forget 提交及 deleted=true/historicalCopiesRemoved=false 收据；随后 Run `9bd83d4e` 实际调用 memory_search 返回0条，Context hits为空。当前索引按该 ID 和1021均为0条，`projects/<该ID>.md` 不存在，当前 Markdown 无该测试事实；原始 Session/日志仍保留，不宣称安全擦除。
- **运行统计：** 12条飞书入站交互 + 1条后台任务，共13条 Run 均 succeeded，分别有1条非中断 agent_settled 和1条 delivery_succeeded，error/deliveryError 均为空。8次写提交为4次创建任务、2次取消、1次保存 Memory、1次删除；澄清和查询不产生写提交。34条模型记录按 SDK 字段分别汇总 input=15113、output=1878、cacheRead=91648、cacheWrite=0 token；全部 cost=null，未混加缓存口径或估算账单。这是限定样本，不是长期执行成功率。
- **耗时口径：** 12次交互 Run 从接收至结果提交为2.756–4.685秒，至发送 API 成功为3.496–5.341秒；手机实际显示时间没有独立测量，不能据此承诺每轮延迟。
- **未清理项：** 截至核对时，10点会议585b9d6c仍 pending，将在当地2026-10-22 10:00执行；只读核对未擅自取消。若不再需要，用户可在飞书明确取消该测试提醒。
- **仍未验证：** 本轮没有重启期间选择编号/全新 Session、Memory 更新或其他三类 Memory、错误 position/latest/过期输入的真实故障注入、真实事件重投/未授权账号、断网/崩溃/睡眠或 Outbox。相关模拟/历史证据单独保留；不能将本轮正常路径通过扩展成所有安全场景或长期稳定性已通过。

### V2.0.2 序号与引用修复（2026-10-21，本机自动化）

- 修复前先新增失败测试：用户“第二个”而解析器 position=1 时实际取消第一项；“刚才那个”被解析为 latest 也会误选。再单独复现解析等待期间编号过期仍取消，确认问题后修复。
- OperationGuard 对当前原话中的常见1–100中文/阿拉伯/全角序号独立解析并与 position 核对。显式序号被模型漏掉或改成 last/latest、同句有多个不同序号、倒数选择、仅在引号内出现等情况澄清，不操作。具名/时段约束继续取交集，用户无需 UUID。
- last/latest 需要当前消息对应依据，不能互换。恢复的编号/待选/确认仍检查有效期、当前归属/状态/版本；解析完成后重新读取时钟，过期不执行。引用校验为本地确定性逻辑，不增加模型调用、不更改持久化格式。
- 4项新增自动化覆盖错误解析、正常序号1/2/10/12/20/100、Memory 更新/删除错号不改变正文/版本/索引、错误 last/latest 与过期引用；模拟时钟覆盖等待解析期间选项和确认过期。原 SDK 集成补“重开后错号/错误 latest 均不取消，再正确选择第二个”的真实 JSONL/SQLite 断言。
- 修复时仅临时数据和模拟模型；之后补充的真实手机正常路径见上节。复杂自然语言选择和其他语义误判仍可能存在，这个修复不是完整语言理解或提示注入免疫保证。

### V2.0.2 自然语言与安全执行（2026-10-21）

- 新增 [OperationGuard](../src/operation-guard.ts)：当前原文的结构化解析与真实存储共同决定权限；不信任主模型提议的正文、时间或 ID。宿主要求时间是当前消息的原始片段，再调用 time.ts，拒绝凭空 UTC、过去/DST 无效时间和不明外部触发。常见“过两分钟/两分钟之后/晚上8点”有确定性别名解析，缺少几点仍需澄清。
- 查询按可信渠道归属返回真实记录，固定编号由宿主展示。取消的具名/时段约束与“刚才/最新/第二个”取交集，多个 Pending 不自动挑选；历史或已结束记录不能冒充取消成功。引用/待选/改写草稿有效期5分钟，通过公开 SessionManager custom entry 持久化，但不成为模型上下文。后台仍为独立临时 Session，无写工具。
- 明确自然记忆意图可写，无需特殊冒号。只保存当前原文事实，实质改写先显示草稿确认；更新/删除使用当前唯一记录及 expectedVersion，确认后再次检查。普通聊天会撤销待确认/待选操作，不继承旧授权。一次请求最多消费一个写操作，并行提议、已中止请求、否定、假设、引用、查询和恶意 Memory 回归均覆盖。
- 典型写操作多一次无工具/历史/Memory 的 completeSimple 调用，最多1000输出token、20秒且不重试，解析和主模型用量均记入同一 Run。聊天/查询/后台不增加解析；对有效草稿简短“确认”直接复核，其他自然确认仍需解析。主执行成功继续取决于 Pi agent_settled、错误及最终响应，不把解析结束当成任务完成。
- 自动化分层：[自然语言宿主测试](../tests/natural-language.test.ts) 注入结构化语义样本，只证明验证逻辑；[SDK 集成测试](../tests/natural-language-integration.test.ts) 使用真实 Pi 1.3.0/JSONL/SQLite、模拟 API，核对解析请求没有历史/Memory/工具、主参数不能扩权、编号跨重启一致、无效 JSON 失败关闭、用量及元数据不进入模型 Context。模拟桩不证明真实语言理解。

**隔离真实模型证据（非飞书联调）：** 用户已明确同意少量虚构提醒/偏好测试。使用专用临时 Task/Memory/Session 和当前模型配置，未读取正式业务数据、未启动 Scheduler、未向飞书发送消息。开发中共3轮，不能混成最终版本一次全量通过。安全摘要见 [v2.0.2-natural-language-acceptance.json](evaluations/v2.0.2-natural-language-acceptance.json)。

| UTC 时间 | 真实步骤及结果 |
| --- | --- |
| 02:16:19–02:16:59，13请求 | 发现同义新建仅查询未新建、主模型自行澄清、具名厕所取消误选最后的喝水提醒、抽取提醒正文不必要确认；本轮不通过。否定/假设/引用未产生写入，明确“记住我比较喜欢中文回答”实际保存 semantic/v1 |
| 02:18:38–02:19:10，8请求 | 调整后不同措辞确实分别新建，明天上午9点开会创建及具名时段取消通过；“刚才”泛词和两个相近内容的澄清仍不满足，本轮不作为全量通过 |
| 02:21:04–02:21:16，4请求 | “两分钟之后叫我喝水”创建 → “刚才那个提醒不用了”只取消该记录；在两个预置厕所提醒下，具名取消先返回固定选项且两者仍pending → “第二个”只取消显示的第二条，另一条仍pending。实际核对 SQLite 状态通过，单轮约2.7–4.0秒 |

先用回归测试复现具名约束被“last”覆盖的误取消，修复为始终取交集；相近词项只扩大候选，不按相似度擅选。开发原始报告在本机忽略的 `data/diagnostics/natural-language-real-report{,-v2,-v3}.json`，文件0600；公开摘要仅含虚构样本及统计，无凭据。最终自然 Memory 更新/删除/确认、手机送达、全部安全场景在最终版本的一次真实全量验收尚未完成。小样本不代表通用语义正确率或提示注入免疫。

### 历史授权加固与固定验收（2938a6f，2026-10-21）

以下前缀/逐字匹配规则描述历史基线；产品工具在 V2.0.2 已由上面的隔离解析与宿主验证替代。严格入口只保留给可信宿主/调试调用，四类存储及备份回归仍持续运行。

- 先以回归测试在旧实现复现“记住这些内容需要付费吗？”被识别为 remember；修复后要求带冒号且不以问号结束。拒绝错误操作类型、否定/引用、普通聊天、后台和已中止请求。
- Memory 保存/更新正文逐字匹配本轮命令（去首尾空白，移除独占元数据行），阻止模型把中文偏好改写成英文；用户指定 kind/key/id 时必须匹配。更新/删除必须指定目标，跨类型同 key 必须消歧，保留 expectedVersion。没有待确认草稿系统；先讨论再由用户发送完整正文是当前替代方案。
- Task 工具只接受本轮有界提醒/创建格式，原始时间与内容、取消完整 id 绑定，每轮最多一次成功写入。Memory 指令不能取得权限：测试实际把恶意 Memory 送入 Pi Context，再让模拟模型强制返回 create_task/cancel_task，执行器报工具错误且任务无新增/误取消。不能据此宣称真实模型永不受提示注入影响。
- `tests/memory-acceptance.test.ts` 按四类逐一经 FeishuChannel 和真实 Pi 工具保存、重复事实/重复事件、未授权用户、全新空 Session 检索、原 id 更新至v2、后台检索、指定删除及又一空 Session 负向查询；核对真实 Markdown/索引、来源 Run、Context id/version、原飞书目标及后台不修改交互 JSONL。模型回答由桩按 Context 生成，只证明线路，不验证语言理解或手机送达。
- 停服备份测试关闭所有 Executor/存储后，将 Task 库、四类 Memory 与 Session 一起复制为备份，再恢复到新目录；移除恢复副本的索引后从 Markdown 重建。ID/版本/来源一致、原 Session ID/历史恢复、旧入站事件仍去重、加载不调用模型或重放工具、pending 向原目标通知一次，后台不带交互历史；原目录和备份不变。未验证在线热备份、强杀/断电、磁盘故障或 Linux VPS。
- 既有文件原子替换、索引恢复、Scheduler、鉴权、事件去重、通知失败不重跑、Session 和操作系统进程回归继续通过。旧测试样本按新的明确格式传原文；没有删去这些原能力的断言。

### 检索效果与下一阶段判断（2026-10-21）

10条虚构四类记忆、16题；预算2048 UTF-8字节，脚本隔离临时数据、无模型和正式数据。初始 Memory 写入之间间隔2毫秒，固定当前检索器同分时按更新时间的顺序；重复运行得到相同报告。不是代表性统计样本，也不测模型工具改写后的二次检索或最终回答。

| 问题组 | 数量 | Top1正确 | Recall@5 | 预期条目进入 Context |
| --- | --- | --- | --- | --- |
| 原词 | 4 | 4/4 | 4/4 | 4/4 |
| 同义问法 | 4 | 0/4 | 1/4 | 1/4 |
| 干扰记忆/否定/相近项目 | 4 | 1/4 | 4/4 | 4/4 |
| 库中无答案（指标表示空检索） | 4 | 1/4 | 1/4 | 1/4为空 |

- 换成“哪种文字/拿铁方糖/机器人断线”缺少原关键词会漏检；相近项目和否定、日期不能由当前词频排序可靠区分。无答案题可能返回相关但不含答案的片段，不等于模型已经编造答案；生成侧是否正确拒答仍待真实验证。
- 所有注入均在预算内，最大1150字节。完整保留查询、预期 key、实际候选 key 和各项结果，无真实隐私正文：[样本](../tests/fixtures/memory-retrieval-eval.json)、[脚本](../scripts/evaluate-memory.ts)、[基线](evaluations/v2-memory-baseline.json)。`npm test` 只验证评测可复现与预算，不掩盖失败问题或宣称质量已达标。
- 第4项结论：建议 V2.1 首个任务聚焦“实体/字段约束与候选相关性、按需查询改写、无答案处理”的最小方案及评测，先讨论取舍再开发；不立即自动提取所有聊天。参考验收目标可设同义/干扰 Top1各≥3/4，原词不退步，并加新留出问题与真实模型新 Session 拒答检查，避免仅迎合16题。检索改进不得放宽本轮写权限。待检索证据稳定再设计确认式写入/自动分类，不能从本次脚本推导已具备语义理解。
- 可靠通知尚无 Outbox，仍可能在任务结果提交与发送间崩溃而丢通知。若开始依赖重要提醒，先单独授权实现结果与 Outbox 同事务、只重试投递，不能因发送失败重跑任务。本轮未升级通知语义。

### V2.0.1 Memory 故障隔离（2026-10-21，自动化通过）

- 故障回归先在原代码运行失败：临时 Markdown 正文改动导致 Hash 不匹配，到期任务实际变为 failed，断言期望 pending；据此确认修复目标，不是仅凭审查结论修改。
- tests/memory-integration.test.ts 使用真实 Pi 1.3.0、临时 Markdown/SQLite 和模拟 fetch。运行中破坏正文后连续调度：任务仍 pending、Run/模型请求/投递均为0，同一错误仅报告一次。正常关闭并恢复原文件、重开全部服务对象后，原任务成功一次，原飞书目标保留；这是对象/存储重开测试，不是新的真实飞书或操作系统进程验收。
- 对临时 Memory 索引注入真实 SQLite INSERT 失败触发器：到期任务同样保留 pending，不增加 Run、模型请求或投递；移除触发器后执行一次。已恢复后再次遇到故障会重新报告。
- 在领取前检查成功后立即损坏文件：任务仍按原路径 failed，不调用模型；恢复文件后的下一轮不重试该终态任务。此用例明确保留检查与执行之间的故障窗口，不承诺任意阶段都能恢复。
- tests/scheduler.test.ts 补充未来任务跳过检查、阻塞中的 pending 可取消、取消后不再检查/领取；既有模型失败、通知失败、SIGTERM、鉴权、去重和 Session 回归保持通过。
- 范围：不新增状态/表/依赖，不降级为无 Memory 执行，不改变交互错误策略、授权前缀或低信任资料规则；未触碰正式数据、配置或用户进程。

### V2.0.1 本机独立进程故障验收（2026-10-21，通过）

- 基线 `688ea0dbe9c9feacbda3f0f9a3aa06a04debe046`；UTC `01:28:24.672 → 01:28:32.331`（Asia/Taipei 为09:28）。运行实际 dist/main.js Console 服务，经 `/create 2秒后` 创建2个测试任务，不是直接调用 Scheduler.tick 或推进模拟时钟。
- 使用专用临时 DATABASE_PATH、MEMORY_DIR、SESSION_DIR，子进程环境仅给假凭据和 localhost 模型地址，不加载正式 .env，不连接飞书；实际 Markdown、SQLite、Pi SDK、调度循环、Console Channel 与 SIGTERM 退出路径均参与。模型输出为固定测试文本，不验证真实模型理解或手机送达。

| 场景 | 到期故障期间的实际结果 | 修复及重启后的实际结果 |
| --- | --- | --- |
| 运行中修改测试 Markdown，触发 Hash 不匹配 | UTC 到期 `01:28:27.303`，`01:28:27.843` 核对 pending；Run/模型请求/模型记录/投递/结果输出均为0，阻塞错误仅1次，服务未退出 | 恢复原文件后 `01:28:28.219` 核对 succeeded，上述计数各1；正常停止并重启进程后仍各1 |
| 运行中为测试索引注入 SQLite INSERT 失败触发器 | UTC 到期 `01:28:30.812`，`01:28:31.347` 核对 pending；Run/模型请求/模型记录/投递/结果输出均为0，阻塞错误仅1次，服务未退出 | 移除触发器后 `01:28:31.682` 核对 succeeded，上述计数各1；再次正常重启后仍各1 |

- 总计3个真实服务子进程、2次本机模拟模型请求、2次 Console 结果输出；全部子进程正常退出，模拟服务器已关闭，临时 Memory/Task/Session 已清理。正式数据、配置和用户正在运行的进程均未操作。
- 本机证据保存在 Git 忽略目录 `data/diagnostics/memory-fault-20261021-bhOgSB/`，含 report.json 及 process-1.log 至 process-3.log，文件0600。它们是本机验收证据，不随代码提交；没有将本次结果标为真实模型或真实飞书联调通过。

### V2.0 Memory 自动化证据与待验收（2026-10-20）

| 场景 | 实际证据 / 边界 |
| --- | --- |
| 四类创建、读取、更新、删除 | memory-service.test.ts 按四类分别运行，来源关联测试 Run；版本递增，旧关键词不再命中，删除及重开不再返回 |
| 真正跨进程持久化 | 子进程写入后退出，移除临时测试索引，另一子进程仅从 Markdown 重建并读出相同 key；只操作临时目录 |
| 重复和冲突 | 规范化相同正文跨类型只保留1条；同 key 不同正文拒绝；expectedVersion 过旧拒绝；不同 key 的语义冲突未实现 |
| 写故障一致性 | 模拟 rename 失败：旧正文/版本保持且临时文件清理；模拟 SQLite INSERT 失败：Markdown 已是新版本，索引事务回滚，解除故障 repair 后恢复新版本；文件移除后旧索引不复活 |
| 权限和隐私 | 普通聊天、引用、否定、后台、已取消请求不写；并行请求不继承写权限；拒绝已知凭据/常见 Key 模式、路径穿越和符号链接，文件权限检查通过；不是完整的隐私检测或 OS 沙箱 |
| 全新 Pi Session 的命中 | memory-integration.test.ts 使用真实 Pi 1.3.0 + 本地模拟流式 API；空 Session 无历史消息且请求不含此前“记住”文本，仍获得 Memory Fact；同时核对临时块与 memory_context 命中事件 |
| Context 不累积/删除 | 每次模型请求最多1个临时资料块、有字节预算，持久 JSONL 不含注入块；工具返回收据；更新后 Context 仅新值，删除后另一个空 Session 不命中；不保证旧 Session 的自然语言历史不被模型引用 |
| Context 故障 | 文件预检查失败不调用模型；context 回调故障通过公开 abort 中止，宿主报错，不静默忽略 |
| 后台及 Task 隔离 | 后台可读相关 Memory、无工具、输出不写交互 JSONL；forget 后已有 Task 仍 pending；既有任务、鉴权、去重、通知、Session/进程回归继续测试 |
| 最小中文检索评测 | tests/fixtures/memory-eval.json：四类各1个相关问题首条命中，加1个无关问题无命中，5/5通过；不代表语义召回或真实模型回答正确率 |
| 真实飞书 Memory | **Project Memory 核心闭环通过**。修复后保存、全新 Session 检索、原记录更新、另一全新 Session 读取第2版、删除及重启后全新 Session 双查询无命中，六次执行与投递均成功，均有正式存储/Session/Context证据。初次超时记录保留；其他三类真实 CRUD、真实故障注入及本轮后台提醒未验收 |

V2.0 主体的57项自动化未调用真实模型或飞书，测试中的“飞书来源”为模拟。下面的验收诊断才开始有真实调用和限定范围的只读证据，不把它混入自动化或宣称全部真实场景通过。

### V2.0 首轮真实验收与兼容修复（2026-10-20）

- 用户在 Mac 自行启动 `SESSION_DIR=./data/v2-memory-acceptance-1-a npm start -- --feishu`；提供连接成功日志及手机截图。测试为虚构项目事实，key=`acceptance.v2.mascot`。
- 保存 Run `cdf6c689-f7b5-490d-809b-5006474a5073`：UTC `15:20:15.387 → 15:22:15.399`，耗时120.012秒，agent_settled.aborted=true；没有 tool_execution_start，模型记录 aborted，正式 Memory 索引无该 key。判定：这次没有成功保存，不是飞书断线或已完成写入。
- 用户随后发“你好”，Run `03e27e82-c89f-4fdf-87f5-4ccebb9cfb67`：入站 `15:21:44.030`，开始执行 `15:22:16.351`，完成 `15:24:16.356`。包含约32秒排队及120秒执行；模型从历史尝试 memory_remember，宿主因本轮无明确记忆意图拒绝，未越权写入。两条中断通知均 delivery_succeeded，说明消息发送成功与 Agent 执行成功须分开。
- 只读查询使用 DatabaseSync(readOnly=true)，限定该时间窗、测试 key 与对应 Session 消息；未使用会写索引的 FileMemoryService 读取正式数据，未打印凭据或无关历史。
- 真实固定短请求：默认参数约0.786秒返回 OK，仍有 reasoning_content；显式 enable_thinking=false 约0.647秒返回 OK 且无推理内容。说明当前凭据/端点可用，不证明完整工具回路可靠。
- 发现两个可验证的映射问题：仅 thinkingLevel=off / reasoning=false 未下发供应商关闭开关，SDK 通用默认使用 max_completion_tokens。依据硅基流动官方 Chat Completions 文档，通过公开 samplingParams 和 compat.maxTokensField，只对 api.siliconflow.cn 发送 enable_thinking=false / max_tokens；不改 SDK、Key、超时、权限或其他端点参数。
- 诊断期间只补关闭开关的临时完整 Pi 请求仍30秒中断；25秒 HTTP 对照也未完成。相同虚构8工具载荷改用 max_tokens 直接请求约1.6秒返回工具调用，HTTP 头对照均约1.7–1.8秒完成。它们用于定位，不当作执行成功，返回工具未执行；不能将一次延迟全部归因于某个开关。
- **最终修复后真实 Pi + 临时数据**：保存约2.202秒，Memory 确认 project/version=1；另建全新空 Session 检索约2.310秒，回答包含虚构测试事实，命中同一 Memory ID/version。4次模型响应，SDK inputTokens 合计6725、outputTokens 合计267；仅此隔离闭环统计，不包含前面的短请求/对照及超时服务器可能消耗的用量，费用未估算。
- 所有主动模型探测只发固定 OK 或用户提供的虚构事实；SQLite 为内存库，Memory/Session 在私有临时目录并已清理。未向飞书发测试消息，未改正式 Memory/Task/Session，未重启用户服务。该轮隔离探测不代替正式手机验收；后续用户复测结果单独记录如下。

### V2.0 修复后正式飞书验收（2026-10-20至21，Project Memory 核心闭环通过）

| 场景 | 步骤、实际结果及证据 |
| --- | --- |
| 明确保存 | 用户在 `v2-memory-acceptance-2-a` 中通过飞书发送虚构项目事实，指定 `kind=project`、`key=acceptance.v2.mascot`；机器人返回 id=`a4040f6d-f167-449c-bc86-cf0b944e98ff`、version=1。只读核对正式索引与对应 projects Markdown：正文符合测试事实、Hash 一致、文件权限0600，source.type=user_explicit、source.channel=feishu |
| 执行与投递 | 来源 Run `13a9a50c-16b9-4caf-8c24-023b1b627591`，UTC `15:45:21.553 → 15:45:24.331`，耗时2.778秒，succeeded、无执行/投递错误。memory_remember 后 Context 命中同一 id/version=1，agent_settled.aborted=false，`15:45:25.506` delivery_succeeded；2次模型响应，正常 stop 完成 |
| 全新 Session 检索 | 通过。事先确认 `data/v2-memory-acceptance-2-b` 不存在；本轮文件只有1条用户提问，含项目名、不含答案或保存指令，之前只有 system 消息，没有旧用户/助手/工具对话。首轮 Context 已命中上述 id、kind=project、version=1，355字节/2048预算；随后 memory_search 成功。用户提供的机器人回答与当前正文一致，排除沿用 A 聊天历史作为答案来源 |
| B 执行与投递 | Run `cb1885e7-90b9-4713-b1b3-6751afa96431`，UTC `15:53:57.870 → 15:54:00.401`，耗时2.531秒，succeeded、无执行/投递错误；agent_settled.aborted=false，`15:54:01.184` delivery_succeeded。2次模型响应，无 Memory 写入工具；该次检索命中同 id/key 的第1版 |
| 明确更新（本地10月21日） | 用户在 B 以“更新记忆：”明确修改原测试记录；扣除宿主时间前缀后，原始提问识别为 update。实际 memory_update 使用原 id、expectedVersion=1；同 id/key/kind 升至 version=2，createdAt 不变，UTC updatedAt=`2026-10-20T16:03:43.301Z`。只读核对 Markdown 和索引正文、元数据及 Hash 一致，文件0600；当前正文含新值、不含旧值，匹配该 id/key 仅1条，来源仍为 user_explicit/feishu |
| 更新执行与投递 | Run `fa107502-97df-450a-914b-8fa1e4c5bd8c`，UTC `2026-10-20T16:03:41.767 → 16:03:45.349Z`，耗时3.582秒，succeeded、无执行/投递错误；Context 在更新前命中第1版、更新后命中第2版，均355字节/2048预算；agent_settled.aborted=false，`16:03:46.070` delivery_succeeded，2次模型响应。Session 未存入独立注入资料块；助手回复提及内部标记本身不构成安全隔离证明 |
| 更新后全新 C 检索（本地10月21日） | 通过。事先确认 C 目录不存在；用户切换 `SESSION_DIR=./data/v2-memory-acceptance-2-c` 后提问，本轮文件仅1条用户消息，含项目名、不含新旧答案，之前仅 system、无旧对话。首轮和 memory_search 后的 Context 均只命中测试 id 的第2版，355字节/2048预算；用户提供的回答为新值，Markdown/索引仍为第2版且无旧值。未调用写入工具，未持久化独立注入块 |
| C 执行与投递 | Run `5959caf8-00c8-48f9-becf-3258674c1d68`，UTC `2026-10-20T16:06:53.794 → 16:06:56.889Z`，耗时3.095秒，succeeded、无执行/投递错误；agent_settled.aborted=false，`16:06:57.591` delivery_succeeded，2次模型响应 |
| 指定删除（本地10月21日） | 通过。用户在 C 的本轮明确删除意图识别为 forget；实际先 memory_get，再 memory_forget，目标为指定测试 id、expectedVersion=2。只读核对该 projects Markdown 已不存在，索引按 id 或 key 匹配为0；删除后 Context hits=[]、bytes=0。用户收到删除成功及 historicalCopiesRemoved=false；历史 C Session 和 Task 库文件仍存在，未声称已擦除历史副本或逐项比对其他数据 |
| 删除执行与投递 | Run `97c2ecb5-f8d7-4e67-9dc9-6d1f7023f154`，UTC `2026-10-20T16:08:26.359 → 16:08:31.565Z`，耗时5.206秒，succeeded、无执行/投递错误；agent_settled.aborted=false，`16:08:32.177` delivery_succeeded，3次模型响应 |
| 删除后全新 D 负向检索（本地10月21日） | 通过。事先确认 D 目录不存在；用户重启并切换 `SESSION_DIR=./data/v2-memory-acceptance-2-d`，本轮文件仅1条用户提问，含项目名及 key、不含新旧答案，之前只有 system、无旧对话。两次 memory_search 分别查询项目关键词与 acceptance.v2.mascot，均成功返回空数组；两次 Context 均 hits=[]、bytes=0。重启后指定 Markdown 仍不存在，索引按 id/key 匹配为0；回答未包含新旧吉祥物，无写工具调用，未重新创建记忆 |
| D 执行与投递 | Run `350d519b-973e-475f-82ea-0eff893499ae`，UTC `2026-10-20T16:16:08.624 → 16:16:12.200Z`，耗时3.576秒，succeeded、无执行/投递错误；agent_settled.aborted=false，`16:16:13.064` delivery_succeeded，2次模型响应 |

证据边界：本轮真实验收使用一个虚构 Project Memory 样本，验证保存、跨 Session 读取、更新和删除的核心闭环；不代表四类全场景、普遍召回率或长期稳定性。其他三类真实飞书 CRUD、重复请求的真实复测、真实写入故障恢复、对抗注入、后台 Memory 检索及本轮提醒回归尚未验收，相关自动化与 V1 历史证据分别保留，不能混同。forget 不清除历史 Session、Task、日志或备份副本。

开发者仅只读核验指定测试 id/key、关联 Run 和文件，未自行触发模型、工具或写入正式存储；各验收反馈步骤仅更新文档，未逐次重跑代码测试。用户随后授权统一提交推送，本轮提交前重新完成类型检查、构建和58项自动化，结果见上表；未再调用真实模型或飞书。

### 硅基流动真实模型验证与切换（2026-10-20）

- 用户授权测试 `.env` 的 `guiji_*` 并在成功后替换当前模型供应商。仅在进程内读取 Key，未输出凭据；官方 `https://api.siliconflow.cn/v1/models` 返回 HTTP 200，列表包含指定模型 `deepseek-ai/DeepSeek-V4.1-Flash`。
- 使用原有 `createPiExecutor` 与兼容 Provider 发起真实流式请求。交互 Session 实际调用一次 `create_task`，创建1个临时 pending 任务，并按测试要求返回确认；独立后台 Session 执行成功，内存消息收集器收到1条结果，观察到2条 `agent_settled`。
- 共3次真实模型响应，SDK 观察到 inputTokens=1697、outputTokens=177、cacheReadTokens=0；费用记录为 null，不代表免费或供应商账单。本次另有1次模型列表 GET 请求，没有把收费请求加入自动化测试。
- 探测只发送固定测试文本，SQLite 为 `:memory:`，Session 在私有临时目录中并已清理；用固定 UTC 时钟推进任务到期，无真实等待一分钟。未读取或发送用户既有对话、未操作实际任务库、未调用飞书或启动常驻服务；该结果不代表新供应商下的真实飞书端到端已重复验收。
- 验证成功后，将本机 `LLM_BASE_URL`、`LLM_MODEL`、`LLM_API_KEY` 切换为硅基流动配置；保留原值在 `.env` 的 `DEEPSEEK_PREVIOUS_LLM_*`，其余配置逐项核对保持不变。权限0600、Git 忽略规则有效，`readConfig` 与 `readFeishuConfig` 校验通过。
- 运行中的进程不会自动读取新 `.env`。用户正常停止后运行 `npm start -- --feishu` 才生效；使用同一数据库、Session 目录与飞书身份继续恢复。仍采用兼容 Provider 的保守32K上下文和4096输出上限，未实现额外路由、自动供应商回退或成本估算。

### 飞书安全诊断验证（2026-10-20）

- 原因分析：原 logger 丢弃 SDK 参数，所有错误使用相同文案；onReconnecting 只输出警告，onReconnected 未绑定，无法看到恢复结果。这两项是日志可观察性缺陷，不能据此确定用户实际网络告警的原因。
- 实现：只提取固定类别、白名单网络码及数字 HTTP/飞书码，适配 SDK 嵌套参数并限制遍历深度/数量；未知内容只标记 unknown。状态行含 UTC 时间，记录 connected / reconnecting / failed；发送异常也保存安全诊断摘要，不自动重发消息或任务。
- 先用“首次握手应报告连接成功”断言在原实现复现失败；修复后定向5项通过。本机真实官方 WSClient 握手 → 模拟远端断开 → 自动重连 → 关闭验证成功，临时故障未触发 fatal；模拟配置拒绝保留业务码并终止。未知错误、嵌套对象、循环引用及混入凭据的错误不会打印原始内容。
- 完整类型检查、构建和44项测试通过。仅使用临时本机 HTTP/WebSocket 服务与虚拟凭据；未修改 SDK 源码、真实网络配置、用户进程或数据库。
- 待真实验证：用户正常停止旧实例、启动构建后的新版，发送一次“你好”，观察是否有重连成功；若持续异常，只提供同一时段的安全状态/类别/数字码及是否能回复。SDK 部分 WebSocket 错误已丢弃底层原因，此时只保留 ws_connect_error / unknown，不猜测或输出连接票据。

V1 原有自动化证据：39项测试使用模拟模型/飞书服务和虚拟凭据。真实 Pi SDK 与飞书官方 Dispatcher 组合验证工具创建任务及可信路由；官方发送客户端使用模拟 HTTP 验证格式与错误脱敏；真实官方 WSClient 使用本机 WebSocket 握手验证就绪与关闭。SQLite 重开测试验证 pending 目标、跨重启去重和不依赖新消息的主动投递，进程测试验证 Console/daemon 与启动保护。上述自动化测试没有调用真实飞书或收费模型。

### V1.2 Session 持久化自动化验收（2026-10-20）

- 核对本机锁定 SDK 1.3.0 的公开声明及官方 SDK 文档：使用 `SessionManager.open(path, sessionDir, cwdOverride)`，不修改源码。空文件由 SDK 初始化，已有文件由 SDK 重建上下文；打开后按当前启动配置创建 AgentSession，不调用 `continue()` 或历史工具。
- 存储：`<SESSION_DIR>/<SHA-256(chatKey)>/chat.session.jsonl`。默认根目录 `<DATABASE_PATH>.sessions`；Console 的 chatKey 为 `console`，飞书为当前 App ID/白名单 open_id 的稳定组合，由入口生成。单用户私聊不依赖手机或 Mac 客户端，模型不能选择文件或接收身份。
- `tests/session-persistence.test.ts`：真实 Pi SDK + 临时 SQLite + 本地模型桩 + 模拟飞书发送。首次创建空会话、连续对话、工具创建 pending 任务，关闭并重开 Executor/SQLite，确认 Session ID 不变、模型请求含先前对话；重投旧消息不发请求、不重复建任务；Scheduler 单次执行并向原 chatId 通知；后台无工具、无交互历史，后台输出不入交互文件。
- 同文件验证 Console、不同应用和不同用户不能加载原对话；目录0700/文件0600，已存在文件权限收紧，无配置凭据自动写入；无关 Pi 文件不加载，被 SDK 判定无效的文件报错并保持内容。
- `tests/service.test.ts`：真实操作系统子进程正常退出、daemon 执行恢复任务、再重启 Console；下一次模拟模型请求包含原交互上下文而不含后台任务，启动/恢复不额外发模型请求。原有双启动拒绝、SIGTERM 中断与不重试检查继续通过。
- 初次运行新增集成测试因沙箱 `listen EPERM 127.0.0.1` 失败；获得本地监听权限后定向2项通过，再运行完整42项全部通过。类型检查与构建退出码均为0。

证据边界：上述自动化使用虚拟凭据与模拟模型/飞书服务。测试中“正确回答”由模型桩根据收到的历史生成，只证明历史恢复和传递；真实飞书跨重启的用户实测反馈单列如下。开发者没有代替用户停止或重启其进程。

### V1.2 真实飞书上下文恢复验收（2026-10-20）

| 场景 | 用户报告的测试过程 | 实际结果 | 证据与结论 |
| --- | --- | --- | --- |
| 交互上下文跨重启恢复 | 重启前已有对话；用户重启 Agent 进程，重启后继续交互并检查此前内容 | 用户明确反馈：“重启之后，它的上下文还是可以记得之前讲过的东西。” | 核心场景通过，依据用户亲自操作后的反馈 |

证据边界：记录日期为用户反馈当日；未独立采集本次重启前后 PID、启动日志、具体问答、Session 文件或运行构建标识，不补造测试话术、Token 消耗或截图。用户此次仅确认上下文恢复，没有补充同轮 Pending 提醒、后台隔离、去重或异常恢复结果；这些场景仍分别依据 V1 历史真实验收和 V1.2 自动化证据。此前连接告警的原因及长期稳定性仍未核实。

飞书手动验收第1–4项（实际私聊、飞书建任务、主动通知、重启后通知）核心闭环已通过：重启步骤由用户报告，手机截图确认提醒到达，数据库确认单次执行与成功投递。去重、未授权隔离和旧测试回归已有自动化验证；尚未进行真实事件重投、第二账号隔离或完整多轮/取消验收，不把这些场景标为真实测试通过。

### V1 真实飞书验收记录（2026-10-20）

环境：Mac 本机 Node 服务、真实模型 API、飞书个人身份的自建应用和手机飞书；代码基线1509ccc，飞书应用版本1.0.0。手机与运行配置时区均为 UTC+8（运行配置 Asia/Shanghai），下方数据库时间均为 UTC。用户负责手机操作和手动重启，开发者负责启动协助及只读数据库核对；V1 联调后复核日期同为2026-10-20。

| 场景 | 实际测试步骤 | 实际结果与证据 | 验收结论 |
| --- | --- | --- | --- |
| 长连接与发布 | 配置当前应用的凭据及本人 open_id；构建并运行 `npm start -- --feishu`；在飞书后台验证连接，由用户配置事件并发布 | 构建退出码0；日志出现模式=feishu；后台显示“连接成功”；用户截图显示1.0.0已发布、应用已启用 | 通过，启动日志与平台页面证据 |
| 手机双向私聊 | 手机以创建应用的同一身份私聊机器人，发送“你好” | 手机截图显示收到回复；对应 Run succeeded，1次模型响应、1次 agent_settled 和1次成功投递，无执行或投递错误 | 通过，手机截图与数据库共同确认 |
| 一次性任务与后台执行 | 用户通过飞书创建短时提醒，等待到期由 Scheduler 执行 | 样本A持久化飞书目标；到期任务与 Run 均 succeeded，1次模型调用、1次成功投递，无错误 | 创建、执行与发送确认通过；此样本未单独保留手机到达截图 |
| pending 重启恢复及主动通知 | 用户创建两分钟后提醒，在自己的终端停止并重启服务，等待原任务；未重新创建该任务 | 用户明确报告恢复成功；手机截图显示 pending 创建确认及17:23主动提醒；样本B为同一任务，只有1条 Run、1条成功投递记录，无错误 | 核心场景通过；重启动作依据用户实测，手机到达与执行记录可交叉核对 |

数据库样本（V1 联调后通过 `DatabaseSync` 的 readOnly 模式复核，不导出消息正文、接收人或凭据；V1.2 本轮未重查用户数据库）：

- 私聊样本：开始 `2026-10-20T09:01:28.873Z`，完成 `2026-10-20T09:01:30.214Z`；Run succeeded，modelCalls=1、agent_settled=1、delivery_succeeded=1，无 error 或 deliveryError。
- 样本A，任务 `62572f2f-8188-4720-9ab1-35c637763a7d`：创建 `2026-10-20T09:03:42.196Z`，到期 `2026-10-20T09:06:42.196Z`，开始 `2026-10-20T09:06:42.746Z`，完成 `2026-10-20T09:06:44.170Z`；succeeded，runCount=1、modelCalls=1、delivery_succeeded=1、runsWithErrors=0。
- 样本B，任务 `4ca4b16f-ba69-4b07-87e9-6304dfe24972`：创建 `2026-10-20T09:21:13.712Z`，到期 `2026-10-20T09:23:13.712Z`，开始 `2026-10-20T09:23:14.413Z`，完成 `2026-10-20T09:23:16.120Z`；succeeded，runCount=1、modelCalls=1、delivery_succeeded=1、runsWithErrors=0。

证据边界：手机截图保留在本次聊天，未加入仓库；样本正文不写入文档。未独立采集用户重启前后的 PID、启动日志或实际停机时长，数据库结果本身不能单独证明重启。两条成功任务仅是验收样本，不用于宣称长期成功率或外部副作用恰好一次。凭据仅在本机忽略的 `.env`，当时校验权限0600，未新增通讯录权限。

仍未完成的真实场景：

- 同一 message_id 的事件重投、跨重启重投和第二账号未授权访问；目前有自动化证据。
- 完整多轮上下文、连续消息排队、仅 pending 可取消及取消后不通知；目前有自动化证据，未逐项人工验收。
- 断网、发送失败、强杀运行中任务和入站/通知崩溃窗口；目前只做相关自动化测试，未对真实环境故障注入。
- Linux VPS、开机自启动、长时间运行稳定性与大样本执行成功率；本阶段未实施。

### 后续工程统计口径（尚未实现）

- 真实执行成功率：限定 UTC 时间窗口及真实飞书数据，分别统计交互与后台任务；以 runs 的 succeeded /（succeeded + failed + interrupted）计算已结束执行的成功比例，单列 running，pending/cancelled 任务不计为执行失败。消息投递成功与模型执行成功分开记录；避免将自动化测试、V0 历史样本混入。
- Token：按 runId 关联 model_calls，分别统计 inputTokens、outputTokens、cacheReadTokens、cacheWriteTokens；不在未确认供应商口径前重复相加。缺失记录不当作零消耗，cost=null 代表费用未知，不能据此推算供应商账单。
- 恢复情况：以重启前 pending 任务清单、重启记录及重启后相同 taskId 的 runs / run_events 对齐核对。run_interrupted 表示遗留执行中断，不能直接当成 pending 恢复成功；当前记录不足以单独计算可靠的总体恢复率。

本轮只记录上述定义，未新增查询脚本、报表、依赖或统计功能；后续有足够真实样本和清晰采样范围后，再用于工程评估或简历中的定量描述。

### V0 历史真实模型证据

- 配置：`LLM_MODEL=deepseek-flash`，`LLM_BASE_URL=https://api.deepseek.com/`，用户时区 `Asia/Taipei`。`LLM_API_KEY` 已配置且不是占位符，未打印、记录或提交；`.env` 已被 Git 忽略。设置 BASE_URL 后由兼容 Provider 接管，`LLM_PROVIDER=openai` 不影响此路径。模型与地址对照 [DeepSeek 官方文档](https://api-docs.deepseek.com/)。
- 使用 `node --env-file=.env --import tsx` 执行两个临时探测脚本，直接调用项目的 PiExecutor、TaskService、SqliteStore 和 TaskScheduler；数据库为 `:memory:`，消息渠道为结果收集器。未启动常驻服务，未触碰实际用户任务库，未把收费 API 请求加入自动测试。
- 第一次探测：真实 Pi Session 回复“连接成功”；`agent_start → agent_end → agent_settled`，stopReason 为 stop。
- 第二次探测：交互 Session 实际调用 `create_task`，按原始“5秒后”创建一个任务；独立后台 Session 到期执行，返回“定时测试成功”，Run 和 Task 提交 succeeded，`Channel.sendMessage()` 收到1条结果，无报告错误。
- 时间证据：到期 `2026-10-20T06:58:19.114Z`，完成 `2026-10-20T06:58:19.667Z`；观察到 `agent_settled`、`run_succeeded`、`delivery_succeeded`。另外通过 Task Service 查询并取消一个独立 pending 测试任务，取消项没有执行。
- 共观察到4次真实模型响应，SDK 汇总：输入1149、输出125、缓存读取640 token；兼容 Provider 的费用仍为 null，未据此估算账单。
- 当时的探测边界：仅验证该账号/模型的 API 连通、一次工具创建任务与后台执行；未覆盖完整自然语言查询/取消、多轮效果或 Linux VPS。用户后续补充的 V0 本机重启证据如下。
- 本次 V1 任务中用户补充报告：已在 V0 实测“创建任务 → 退出进程 → 重启恢复 pending → 到期执行成功”。这是用户提供的本机验证证据，本轮未重复该收费场景，也不代表飞书恢复通知已验收。

## 已知问题与限制

- S1-A仅Chat固定公开文本，常见标题/短句可直接读取，其他复合表达先确认；无搜索/HTML/账号/任意URL或S1-B。Session/SQLite保留正文和记录，暂无自动清理；只读GET也可能被服务端记录，不保证外部恰好一次。真实模型选工具/遵循与收据质量、真实站点/飞书/手机、Windows ACL、原生Mac和长跑未验，按[报告](evaluations/s1-web-validation.md)边界交付，不能因模拟绿灯启用正式能力。

- V3.0电脑真实模型核心闭环已验证，V3.0.1仍有自然暂停及主模型收据解释失败；手机Goal、原生Mac/Windows ACL和长期运行未验。V3.1–V3.3仅本地模拟通过，策略审批当前仅Console命令；模型可能误判完成/反馈需要。目标原义不变，换目标需新建；超预算目标/计划/摘要阻塞，长成果显式节选，完整成果留在SQLite。view暂无历史分页，uncertain需人工核对。策略Goal已有定时/观察/有界推进和最小Outbox，仍无exactly-once或必达保证。

- V2.1b.3针对已知三项有离线红绿证据和Pi模拟回归，新真实模型/手机复测尚未执行。拒绝补执行是有界短句路径，不覆盖所有自然语言；否定恢复只接受能在原文逐字证明的一次遗漏，复杂歧义仍保守拒绝/澄清。正式Formation保持关闭。

- V2.1b.1的F01/F02修复已在V2.1b.2单轮真实复验通过，但新项目错误target及范围否定property暴露额外失败：原六窗6/6、新两窗0/2。宿主保持安全拦截，产品形成质量仍有缺口；模型重复/第三人称错目标也仍存在，默认关闭，不外推为总体精度达标。
- 真实手机的直接Memory误写已按授权定点修复，但手机复验未结束：新的确定性检查是有界中文快路径，不是通用语义证明；少见合法表达可能多一次确认或保守拒绝。只改remember，update/forget仍有原隔离解析语义风险。原失败和零API桩复现保留，不能把新回归130通过当作从未误写或完整真实语义达标。
- 完整原话草稿可能冗长；只保守匹配主体/属性，未知字段/指代可能漏提或要求明确操作；语义等价的改述可能重复建议，全文归一化和拒绝Hash不是通用语义去重。疑问/假设/引用/临时过滤有假阴性；模型mode/durable/分类仍可能错误，用户批准不能当客观事实证明。
- 任意Memory变动使所有旧候选失效；普通聊天的新事实因此可能丢失建议，需要新陈述，不回扫历史。applying无法精确对账则blocked，写异常不重试；未知中断费用保留预算。审批/正常聊天不计入形成0.2元额度；本地预算非供应商账单硬上限。
- Windows最终123通过/3项跳过；Linux容器已补跑126全过/0跳过，涵盖Unix权限位、符号链接与POSIX SIGTERM。不等于原生Mac/VPS部署或真实飞书Formation验收；Unix权限位不能验证Windows ACL。当前Windows飞书App ID已修正并连接成功，手机候选/审批/新Session等步骤仍待验收。

- V2.0 首轮真实飞书保存超时，修复后 Project Memory 保存/全新Session检索/更新/删除已有历史样本；本次8b531f9补上自然创建/取消、编号选择和 Memory 保存/检索/删除的真实手机证据。两批都是限定样本，不保证每轮延迟、其他类型效果或长期稳定性；本轮没有重新验证 Memory 更新/全新Session。历史超时记录的0 token不代表供应商没有消耗或计费。
- Memory文件/索引仍全量扫描，主体交叉比较最坏二次；本轮1000条宽泛Context P50约117ms（上轮约167ms，更早约63ms），不是通用复杂度优化。新主体继承已收紧，但含“的”的省略、复杂主客体/否定/未知字段仍可能漏召回或判断错；旧24一项事件证据保守降级，Mosaic及旧同义失败保留。原真实生成整段7/8，本次提示尚无新真实验证；成功改写生成仍未验。默认改写false，最多5条及相同字节预算，参考噪声未消失；没有Embedding/通用语义理解、自动提取或完整修订历史。
- V2.0.1 健康检查覆盖整个 Memory 目录；一个损坏文件也会延迟其他到期任务。预检查与执行不是原子操作，领取后再出故障仍 failed/interrupted，不自动重试；升级不重置已失败任务。启动前 Memory 已坏仍拒绝启动，交互请求也保留原错误策略。
- V2.0.2 隔离语义解析仍可能误判用户意图、漏掉约束或选错未指定的 kind/key；原文证据与 Schema 不是语义正确性证明。主模型也可能不提议工具，导致请求未执行。宿主有界匹配不具备通用语义理解，最多100个查询结果，候选过多或无法匹配时需补充。仅单操作/轮，不支持任务编辑；时间澄清尚不保存不完整创建草稿，补充时需重新说明完整提醒。
- 序号/引用校验仅覆盖常见明确写法；倒数、复合选择或替换正文自身含序号等情况可能要求进一步说明。它不取代隔离解析器对否定、假设、引用和整体意图的判断，也不承诺所有自然表达均可直接执行。
- 写操作通常增加一次模型请求，且仅20秒解析超时，不承诺每轮2.7–4.0秒；该耗时只是最后4条样本。确认/候选5分钟过期，不能承接任意历史对话引用。原始用户消息和宿主改写草稿仍保存在私有 Session 中；隔离解析仅降低历史/Memory 干扰，不能保证所有提示注入都被阻止。
- Memory 的低信任指令边界不等同于对模型的数学保证。原始用户/助手消息仍持久化，旧事实可能在 Session/Run/备份及 SQLite 空闲页保留；forget 只让当前知识和索引失效，不承诺全链路安全擦除。
- Markdown 与 Memory 索引不构成跨存储事务；文件落盘后索引失败可能已经保存成功，先查状态再处理。坏格式/Hash 会阻止启动或使本轮执行失败，须恢复有效备份；后台失败不自动重试。不支持手改正文自动采纳、硬断电耐久性或崩溃残留临时文件自动清理。

- 用户报告启动后 SDK 告警，随后确认上下文恢复可用；告警发生时是否仍能回复暂未检查。已补安全诊断与重连成功提示，用户需重启到新版才能看到；实际告警根因和持续稳定性尚未确认，不将日志改进称为真实网络故障已修复。
- V1 手机私聊、任务创建、主动通知及重启恢复已有历史真实证据；本次补上自然取消和多目标编号澄清。连续并发排队、真实事件重投及第二账号隔离仍未逐项实测。当前由用户在 Mac 终端管理进程，未配置开机自启动或 VPS，退出或睡眠仍会影响服务。
- V1.2 交互历史跨重启保存，自动压缩仍关闭；长对话可能达到上下文限制，重启不再清空历史，需要使用新的 SESSION_DIR 开始空会话。升级前未持久化的历史不会从 SQLite 日志自动重建。
- Session 文件未加密、不自动清理；无法读取或被 SDK 判定无效时阻止启动，不额外修复 SDK 容忍的损坏行。它与 SQLite 不构成跨存储事务，强杀/断电可能造成记录不一致或最后一条不完整；不自动补偿或重放，任务状态仍以 SQLite 为准。
- 显式配置 SESSION_DIR 时，每份数据库使用独立目录；锁仍以数据库为单位，不支持多个数据库进程共享同一会话目录。
- 旧Task时间解析是有界语法，不支持任意自然语言或Cron；Goal周期仅显式策略下的每日/每周固定时间，不明表达要求补充。
- 后台串行执行；慢任务/观察/投递会延后后续任务。旧Task、聊天和手动Goal无Outbox，仍可能丢通知；策略Goal最多3次投递，发送超时可能重复，长消息可能只送达部分；所有通知失败均不重跑模型。
- 入站去重提交后执行前崩溃可能丢失回复/未执行请求，Run 标记 interrupted 且重投不重放；应先查询任务再决定新请求。去重和 Run 记录暂不自动清理，Mac 睡眠/离线期间不保证准点通知。
- 协作式 abort 依赖供应商/SDK 响应；外部副作用不保证恰好一次，中断后需核实。
- SQLite 未加密、无自动清理；强杀或供应商未报告时用量可能缺失，费用不是供应商账单。
- 旧Task/聊天的通知Outbox、供应商幂等和分片进度仍是后续范围；本次仅实现策略Goal结果与通知同事务和有限重投，没有永久恰好一次保证。

## 下一步与需要提供的信息

1. 将S1-A分支代码、[设计](designs/s1-readonly-web-tools.md)、[完整报告](evaluations/s1-web-validation.md)及[JSON证据](evaluations/s1-web-validation.json)交给ChatGPT审查。按本次授权只创建本地阶段提交，推送须另行批准；不继续扩展S1-B或工具生态。
2. 本地无Key演示见README，运行tests/web-*.test.ts，仅临时库和本机模拟服务。真实模型/站点体验须另行明确场景、独立费用与网络范围；旧[S0 Console16次/2元方案](evaluations/s0-console-live-experience-plan.md)仍未执行授权，不复用旧账本或余额。
3. S1-B Goal网页快照绑定、主动动态Web、HTML/搜索/任意地址及其他工具均未开发。真实飞书留重要里程碑；本轮不部署或启用正式功能。
4. 正式主动执行启用前，仍须独立解决V3.0.1自然暂停与收据误解并真实复验。Web/Skills/Goal/Proactive及Formation保持关闭；不以本轮模拟成功替代真实质量、原生Mac或Windows ACL验收。

## V2.0.2 关键文件（主体及本轮修复）

8b531f9修复时修改 operation-guard.ts、两份 natural-language 测试、README/PROJECT/STATE，共6个文件；本次真实验收记录仅修改 STATE，下面其余文件属于已发布实现。

- 宿主边界：[operation-guard.ts](../src/operation-guard.ts)、[pi-executor.ts](../src/pi-executor.ts)、[contracts.ts](../src/contracts.ts)。
- 服务和工具：[task-service.ts](../src/task-service.ts)、[task-tools.ts](../src/task-tools.ts)、[sqlite-store.ts](../src/sqlite-store.ts)、[time.ts](../src/time.ts)、[memory-service.ts](../src/memory-service.ts)、[memory-tools.ts](../src/memory-tools.ts)。
- 新增验证：[natural-language.test.ts](../tests/natural-language.test.ts)、[natural-language-integration.test.ts](../tests/natural-language-integration.test.ts)、[模拟解析适配](../tests/helpers/intent-stub.ts)；原集成用例适配新增解析响应，time.test.ts 补常见别名。
- 文档：README、PROJECT、STATE 及 [真实模型摘要](evaluations/v2.0.2-natural-language-acceptance.json)。未修改配置、依赖、SDK 或数据库 Schema。

## V2.0 本次关键文件

- 新增 src/memory-service.ts、src/memory-tools.ts、tests/memory-service.test.ts、tests/memory-integration.test.ts、tests/fixtures/memory-eval.json。
- 修改 src/pi-executor.ts、contracts.ts、config.ts、main.ts，及 Console/Feishu Channel 的可信来源传递；测试配置、.env.example、.gitignore。
- 更新 README、PROJECT、STATE、AGENTS 的 Memory 架构边界，未变更协作确认规则；无依赖升级或 Task 表迁移。

## V1.2 历史文件变更

此前连接诊断修改 [feishu-transport.ts](../src/feishu-transport.ts)、[feishu-transport.test.ts](../tests/feishu-transport.test.ts)、README 和 STATE；真实验收补充保留。

| 范围 | 文件 |
| --- | --- |
| 会话创建与配置 | [pi-executor.ts](../src/pi-executor.ts)、[main.ts](../src/main.ts)、[config.ts](../src/config.ts)、[.env.example](../.env.example)、[.gitignore](../.gitignore) |
| 自动化 | 新增 [session-persistence.test.ts](../tests/session-persistence.test.ts)；扩展 [service.test.ts](../tests/service.test.ts)、[config.test.ts](../tests/config.test.ts)、[pi-integration.test.ts](../tests/pi-integration.test.ts) |
| 说明与边界 | [README.md](../README.md)、[PROJECT.md](PROJECT.md)、[AGENTS.md](../AGENTS.md)、本 STATE |

V1.2 当时没有新增依赖、数据库迁移或框架。Task Service、Scheduler、飞书收发/鉴权与工具实现在该次实现中未改动。

## V1 历史文件变更

| 范围 | 文件 |
| --- | --- |
| 新增飞书与路由 | [feishu-channel.ts](../src/feishu-channel.ts)、[feishu-transport.ts](../src/feishu-transport.ts)、[channel-router.ts](../src/channel-router.ts) |
| 入口与配置 | [main.ts](../src/main.ts)、[config.ts](../src/config.ts)、[console-channel.ts](../src/console-channel.ts) |
| 任务与消息边界 | [contracts.ts](../src/contracts.ts)、[task-service.ts](../src/task-service.ts)、[sqlite-store.ts](../src/sqlite-store.ts)、[scheduler.ts](../src/scheduler.ts) |
| 自动化测试 | 新增 [feishu-channel.test.ts](../tests/feishu-channel.test.ts)、[feishu-transport.test.ts](../tests/feishu-transport.test.ts)；扩展 [config.test.ts](../tests/config.test.ts)、[pi-integration.test.ts](../tests/pi-integration.test.ts)、[service.test.ts](../tests/service.test.ts) |
| 依赖与样例 | [package.json](../package.json)、[package-lock.json](../package-lock.json)、[.env.example](../.env.example) |
| 说明与交接 | [README.md](../README.md)、[PROJECT.md](PROJECT.md)、本 STATE；保留本次开始前的 DeepSeek 文档更新 |

V1 代码实现未修改 `src/pi-executor.ts`、`src/task-tools.ts`、Pi SDK 源码或 AGENTS 规则。后续本次真实联调仅写入实际 `.env`（被忽略）、更新 README / PROJECT / STATE 并启动现有服务，未新增运行框架。

## 给下一位开发者或 AI

先读 AGENTS → PROJECT → STATE，再检查相关代码及当前改动，确定一个任务与验收目标。向 ChatGPT 交接时提供 PROJECT、STATE 和问题相关代码/diff，必要时补 AGENTS；讨论结论不自动扩大授权。任务结束后覆盖更新此快照，报告真实测试结果及未验证事项，无需复制完整聊天历史。
