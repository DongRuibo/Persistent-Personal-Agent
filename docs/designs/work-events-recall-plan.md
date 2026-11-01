# 阶段3/4只读设计研究：事件订阅与关联回忆

日期：2026-11-01。状态：供 Planner 独立审查的实施建议R2，按独立R1的F1/F2/F3修订，**不是权限批准，不是已实现功能**。R1原件保存在proposal-r1.md/evidence-r1.json，逐项回复见revision-response-r2.md。

执行快照（2026-11-02）：用户已批准末节受控Web入口的隔离实现/离线验收。E1独立R2、E2独立R1、E3独立R2已通过，原两项审批UI P2关闭，失败证据保留。E4全量680项及实际Chrome桌面A/390px B各两后续事件闭环已完成，当前冻结待独立R1；关联回忆未编码。下文保留R2冻结设计与历史研究证据边界，不代表全部阶段已完成。

## 研究范围与证据口径

- 已读主审查树 AGENTS、PROJECT、STATE、连续开发任务书与2B任务书；原四阶段附件仅读取183–249、286–333行。
- 代码基线：`91b7a657ddf62cf625c53f7bcfbddaa22aa6740b`，执行树 `/Users/onruio/.codex/worktrees/work-core-stages/Persistent Personal Agent`。下列代码行号以该基线为准。研究期间B1开始增量修改 WorkRouter/WorkThreadService，故B1新接口只列“可复用候选”，不当作冻结基线事实。
- 没有读取正式.env、数据库、Session、Memory正文、备份；没有调用真实GitHub、收费模型、测试或浏览器；没有修改仓库源码、测试、文档、index或refs。只写future-design目录内的方案、原件备份、逐项回复及evidence.json（20个基线代码文件Hash与文档校验记录）；独立Reviewer报告由Reviewer写入。
- “事实”来自代码；“推荐”是研究推论，须经 Planner/Reviewer 冻结。唯一需要用户决定的权限范围见末节。

## 一、影响方案的已核实事实

| 事实与问题根因 | 精确代码位置（相对执行树） | 对实施的约束 |
| --- | --- | --- |
| GitHubObserver已有固定GitHub GET及本机mock入口，仓库/分支/60–86400秒校验、5秒超时、64KiB响应及10000 UTF-8 bytes快照上限 | `src/github-observer.ts:1–29,32–56` | 复用网络客户端和校验；不新增任意URL、Webhook、PR/Issue、Token输入或联网Worker |
| 最多20条commit，必须在窗口内找到旧SHA；compare只接受ahead/identical，窗口断裂/force push/过大直接报错 | `src/github-observer.ts:32–55` | 游标gap不能猜测、回填或把当前head当作已分析范围 |
| cursor的主键是policyId；observation要求policyId，且每policy/head唯一 | `src/goal-policy-store.ts:44–50` | 这些表不能直接承载没有Policy的Web“仅观察”来源；强塞假Policy会制造错误授权语义 |
| observe只扫描active策略，并在相同事务写Observation、Trigger、游标和Grant | `src/goal-policy-store.ts:194–228` | 当前观察与执行授权耦合；只加展示页不能得到独立的仅观察模式 |
| 首次只建基线；重复head不触发；失败不推进head且退避持久化 | `src/goal-policy-store.ts:218–239` | 必须保留这些行为；事件化不能让重启补跑历史模型 |
| 原stop会递增Policy版本、撤销issued Grant，并撤销在途Goal提交资格；旧observe的不合格分支会调用它 | `src/goal-policy-store.ts:133–144,205,214–216` | 新独立来源的正常busy事件不能借此stop既有合法执行 |
| 原观察直接用批准的Policy.schedule轮询；consume不重新检查observation的仓库/分支/间隔 | `src/goal-policy-types.ts:10–12`; `src/goal-policy-store.ts:108–109,200–208,245–255` | 新来源接入必须明确校验其描述符与批准schedule完全一致 |
| Policy审批要求当前已批准Plan、精确Goal/Plan版本、合法waiting_user状态；不能代替尚欠的用户反馈 | `src/goal-policy-store.ts:90–117` | 新入口调用同一approve，不另造“自动执行权限” |
| 唯一用户入口policyConsole明确拒绝非console | `src/goal-policy-console.ts:5–21` | Web目前不能为自己的Goal合法批准Policy，前端订阅不可能填补这个缺口 |
| Goal归属Hash包含渠道和Web userId/飞书完整目标；main与Runner也按当前渠道接收 | `src/goal-store.ts:26–27,120–128`; `src/main.ts:91–94,110–115`; `src/goal-runner.ts:161–178` | Console有效Policy不能拼到Web主题/Goal；同名local-user不是跨渠道授权 |
| Grant消费仍检查Policy状态/版本/期限、Goal身份/版本/计划、Trigger来源、预算并一次消费 | `src/goal-policy-store.ts:245–275` | 订阅只确定路由；执行继续由原账本和Runner负责，不创建第二种Grant |
| partial/反馈/计划末尾/错误等会停止Policy；允许的多片段仍由settled签发原Grant | `src/goal-policy-store.ts:279–302` | 新Web审批首批限制每触发1片段；不改变原Console的1–5片段能力 |
| WorkThread关系只支持goal/task/run/memory且source固定user；关系没有执行/权限作用 | `src/work-thread-types.ts:1–14`; `src/work-thread-store.ts:9–21,51–65` | 订阅和事件需独立关系表；不能把后台自动关系伪装成用户手工work_links |
| 主题、Task、Goal、Run、Memory按原服务检查归属；detail遇到Memory关联就读Markdown | `src/work-thread-service.ts:15–54` | Recall定位只用元数据过滤路径，不能对全部主题调用detail当作“零Memory查询” |
| WorkJob本来有threadId/runId，结果只在Run，创建/领取/完成/取消均事务化 | `src/work-job-store.ts:17–25,27–50,56–87`; `src/work-job-types.ts:3–7` | 不另存Worker成果；关系Recall直接读原Job→Run；事件不能越权创建WorkJob |
| ownsRun只认可真实Web Chat、Task、Job、GoalExecution归属，不认可work_links | `src/web-ui-store.ts:32–46` | 关联或订阅不能成为访问Run的证明 |
| run(id,false)会对文件审批Run隐藏output并给fileOperationId；默认run(id,true)可带完整审批预览 | `src/web-ui-channel.ts:46–74`; `src/web-ui-store.ts:52–54` | Recall不能直接用默认run详情取正文；需复用false投影或同一fileForRun检查 |
| ACK与文件批准分开；完整渲染才delivery_succeeded；前端通用已呈现组件会自动发ACK | `src/web-ui-channel.ts:100–121`; `web/src/main.tsx:158–201` | Recall结果视图不可复用自动ACK包装，不能伪造Goal/文件已展示引用 |
| Goal view先校验actor，保留所有Execution和committed Checkpoint；executionForHost可校验输入/结果Hash | `src/goal-store.ts:120–140,152–171` | 取目标成果应读committed artifactText，不把原Run的结构化协议JSON当成果；Host方法先做actor归属检查 |
| 被丢弃的GoalExecution仍可有技术Run=succeeded且保留artifactText；ownsRun与run投影不会自动过滤它 | `src/goal-store.ts:369–372`; `src/web-ui-store.ts:32–38`; `src/web-ui-channel.ts:46–49,66–74` | 所有runId别名均先识别GoalExecution，再检查committed/Hash，不能裸读Run.output绕过提交状态 |
| Memory list/retrieve都会repair并读取Markdown；纯retrieve(records,query)是独立词法函数 | `src/memory-service.ts:176–204`; `src/memory-retriever.ts:91` | 关系Recall默认不读Memory；需要背景时先筛有权记录，再调用纯检索，不能全局retrieve后直接返回Web |
| 既有Memory上下文临时投影、有字节预算/截断降级，不追加Session；work scope完全不读Memory | `src/memory-service.ts:297–338`; `src/pi-executor.ts:139–152,364–390` | 可复用临时投影模式，不改Memory事实源、后台工具或普通聊天默认行为 |
| Web全部API已有登录、Origin、CSRF，Task/Goal/文件有各自入口 | `src/web-ui-server.ts:103–134,140–223` | 新API放在同一认证层；入口校验一次，后续传定型DTO；不允许请求带owner/channel来覆盖宿主身份 |

## 二、阶段3推荐：来源、事实、订阅、原执行链四者分离

### 2.1 最小新增持久模型

推荐在现有应用SQLite增量建立四张表；这是业务关系，不是消息队列或通用事件框架。表名可沿现有命名落实。

| 表 | 必要字段与唯一关系 | 为什么旧表不能替代 |
| --- | --- | --- |
| `event_sources` | id、owner/channel、kind=github、创建后不可变repository/branch/intervalSeconds、显式观察许可的requestId/Run引用、status、revision、head、nextAt、failures/lastError、UTC时间；同身份repository/branch/intervalSeconds描述符唯一 | 未批准执行Policy也必须能明确许可只读观察。旧cursor必属Policy，不能谎造Policy借用 |
| `source_events` | id、sourceId、head、previous、observedAt、不可变snapshotJson及snapshotHash；`UNIQUE(sourceId,head)`；可选legacyObservationId | 统一事件需要独立去重和可追溯来源；snapshot是同一次观察材料，不能稍后重新GET假装同一事件 |
| `thread_subscriptions` | id、sourceId、threadId、可选goalId、可选policyId/policyVersion、status(active/paused)、revision、startAfterEvent或明确创建边界、UTC时间；同source/thread/目标去重，单一Policy只绑定一个执行分派关系 | work_links没有来源、停用、生效边界及Policy绑定语义，且只允许source=user |
| `subscription_events` | eventId、subscriptionId、订阅revision、判定状态/原因、可选原observationId/triggerId；`PRIMARY KEY(eventId,subscriptionId)` | 一个事件可到多个主题；需要持久说明“已观察、无授权、已交原链、过期/不可用”，并防重启重复分派 |

新增Web来源的**唯一快照原件在source_events**，限制严格沿用Observer现有的10000 UTF-8 bytes（不是10240），保存Hash；repository/branch和previous/head可单独列作来源定位。事件投递和Recall读取相同冻结快照，不重新抓GitHub。仅观察也保存原件，否则用户之后问“这次变化是什么”无法可靠复原。

旧Policy产生的已有observation可通过legacyObservationId投影为事件，正文继续以旧goal_observations.dataJson为原件；必须保留原渠道身份，不能因为投影就让Web可见Console观察。首批无需回扫迁移历史事件；实时接入从启用后开始。

**保留旧快照格式，接受必要的受控复制。** 新路径创建原goal_observations与Goal Execution输入时，读取source_events不可变原件、核对snapshotHash，随后仍保存原有完整快照格式，并通过subscription_events中的eventId/observationId/triggerId保留可追溯关联。不将旧dataJson改成引用/联合协议，不扩大GoalRunner或audit的读取分支。源事件是观察原件；已授权Goal的副本是执行时冻结证据，两者均不可随意更新。这不是新增独立事实源，也不是复制Task/Goal/Memory业务状态。

本方案不追求“外部快照正文完全零重复”：一个不超过10000 UTF-8 bytes的有来源事件，为实际授权Execution保留原格式副本，比改变旧审计/执行协议更小且兼容。异步恢复读取事件原件，缺失或Hash错失败关闭，不重新联网补齐。仅观察事件没有Goal副本。

### 2.2 范围开关与交互

- 新事件功能默认关闭；依赖本机Web和WorkThread。观察能力不以PROACTIVE_ENABLED为前提，否则“没有执行授权仅观察”仍不可用。没有Goal也可观察到主题。
- 开启功能不等于批准来源。用户在结构化Web表单明确repository、branch、间隔，界面说明仅GitHub固定只读API/周期观察/首轮基线/不调用分析模型，然后明确启用此来源。观察许可本身不含执行预算或Grant。
- 来源的repository/branch/intervalSeconds创建后不可修改；只提供暂停/恢复。改变任一字段须另建来源、显式许可，并重新审批/绑定Policy；旧事件仍引用旧的固定描述符，不自动承接新范围。
- 订阅只选择当前可见来源、当前主题、可选同渠道已有Goal。来源和目标不允许模型自行创建或跨渠道替换。Goal应已与主题关联，或同一次明确用户操作先建立正常用户关联，不自动伪造work_links来源。
- Web审批/绑定同一事务要求source可信身份与当前Goal/Policy归属一致、Policy.schedule.kind=github，且source的repository、branch、intervalSeconds与Policy.schedule批准的三项**完全相同**。不能用同一Goal的其他仓库/分支Policy，也不能用更快来源替代批准间隔；外部snapshot不决定这些授权字段。分派时再次核对固定绑定、事件sourceId及其可信身份，0不匹配Trigger/Grant。
- 主题事件列表显示来源、范围、发生时间、订阅判定、原Goal/Trigger/Run跳转。未授权只生成**待处理项/建议**，不能声称已经排队或分析完成；第一批待处理项可以是确定性提示，不额外调用模型。
- 三档按实际状态表达：关闭；仅观察；已批准Policy范围内执行。选择“自动执行”必须单独完成结构化Policy审批；订阅中存policyId只是引用，不是授权。
- 源暂停与订阅停用分开。源暂停停止其未来轮询；订阅停用停止给该主题分派未来事件。已消费的原Grant/在途Goal不因此假装取消；需要停止已授权Goal时提供原Goal暂停/Policy撤销入口并准确说明。
- 归档主题保持既有“不暂停原Task/Goal”语义。新订阅对归档主题不再分派未来事件，恢复后从恢复时开始，不补跑归档期间事件；已签发Grant仍由原控制服务处理。

### 2.3 最小执行拆分与不重复条件

1. **网络层不动。** 独立小型来源tick复用GitHubObserver.poll；在事务外GET，持久化相同退避/游标gap行为。可在main生命周期接线，不创建新Worker/Agent/队列框架；不跨网络持BackgroundLane。
2. **来源事实先独立。** 网络返回后在短事务复核source revision、观察开关、head与启用状态；首次只建基线。变化才原子写不可变event、推进head，并为当时active订阅创建唯一subscription_events。此时没有任何自动业务权限。
3. **原Policy入口负责执行。** 对显式绑定Policy的Goal分派，由GoalPolicyStore一个局部的“已验证事件→原Observation/Trigger/issue”入口执行；入口核对source可信身份、固定绑定及repository/branch/intervalSeconds与批准schedule完全相同，再复用原审批状态/身份/Goal版本/Plan/期限检查和原issue，随后由原consume/Runner处理。正常busy先按第6步作只读判定，不能直接套用旧observe的不合格stop分支。source_events只存资料，没有方法生成Grant。不要复制GoalService控制/授权逻辑到事件服务。
4. **不双轮询同一绑定。** 新Web source-bound Policy需有持久的绑定关系；旧observe扫描排除这类Policy，来源tick是唯一网络观察者。此排除不随订阅暂停或事件功能关闭而回退，避免暂停后旧Observer偷偷续跑。旧Console/未绑定Policy继续原observe逻辑。新Web Policy审批与绑定在同一事务；不删除绑定以模拟撤销。
5. **两个事实事务之间允许恢复，不允许重抓。** 第2步commit后、第3步前崩溃，重启只从source_events冻结snapshot读取未判定的subscription_events；重新检查原订阅revision与原Policy版本/有效期/Goal状态。第3步的投递判定、原Observation/Trigger/Grant同事务提交；由同连接明确拥有一个事务边界，不在外层事务里调用另一个会BEGIN的公开方法。崩溃回滚后可重做这一纯本地判定，不能再次GET或签第二份同事件Grant。已经判定“无授权/停用/失效”的记录终结，不因后来批准Policy或恢复订阅而重播旧事件。
6. **延迟事件与busy分别判定。** 未判定项只对产生时绑定的Policy及版本尝试，不换用后来新批准的Policy。对于同一仍有效Plan/Policy，若Goal为ready（原issued Grant尚未领取）或running（原consumed Grant在途），只将**本次新事件**的subscription_events终结为busy/skipped：0新Trigger/Grant，不排队、不重放，不调用stop/issue/Goal控制，不更改既有Policy/Goal版本，不触碰既有issued/consumed Grant，原片段仍可正常committed。真实用户控制、Plan/版本失效、Policy失效、等待反馈或阻塞仍按原语义终止，不能以busy绕过这些条件。最小方案不保证每个繁忙期间事件都被自动分析；需要积压合并/重放属于后续单独产品需求，不为凑连续性另建Goal。
7. **继续同一个Goal。** 订阅绑定稳定goalId；每次后续事件只尝试该Goal和其仍有效Policy。每事件每个绑定Policy初始最多1个原Grant；用户批准的新Web方案每触发1片段。模型若需要反馈、计划末尾或Plan变化仍按原settled停止，不能把“订阅存在”解释为无限研究。

必要去重层次：source/head唯一解决轮询重投；event/subscription唯一解决主题分派；原policy/version/github/head与policy/head防止多个关系给同Policy重复Trigger/Observation；原trigger/segment和Grant消费继续防止重复模型执行。全部使用现有单进程SQLite短事务，不加分布式锁、通用重试器或“理论并发更稳”的框架。

### 2.4 边界行为应冻结

| 场景 | 推荐可验收行为 |
| --- | --- |
| 初次来源观察 | 仅建head基线，不把已有20条commit都当新事件 |
| 重复poll/同head/进程重启 | 不新增event、分派、Trigger或Execution；只读已完成状态 |
| event已存而尚未分派时重启 | 只读同一snapshot+Hash；同一Policy事务最多签发一次；不额外GET |
| 同一有效Plan/Policy的Goal已ready或running | 仅新事件busy/skipped终结；0新Trigger/Grant，既有Policy/Goal版本、issued/consumed Grant与在途成果提交资格均不变；重启不补跑此新事件 |
| source与Policy的repo/branch/interval不一致 | 审批/绑定拒绝，分派拒绝；0Trigger/Grant/Execution。不修改固定来源字段来迁就旧Policy |
| 订阅停用/恢复 | 未判定的旧revision项终结为停用；已判定仅观察项不重开；恢复仅未来事件 |
| 来源暂停后恢复，旧head已不在20条窗口 | 保留旧head并显示需核对；不自动重设基线或触发。可新增明确的“放弃缺口、从当前重新建基线”操作，但不得把该操作当作分析旧事件；是否纳入首批可由Planner按UI必要性决定 |
| 旧事件后来批准Policy | 仍为当时无授权；下一次新变化才能触发。手动分析旧事件必须新的一次用户意图，读取旧快照并走原聊天/Guard，不注入自动Grant |
| Policy过期、撤销、换Plan、需反馈、限额/费率不可用 | 事件保留，判定原因可见；不消费新权限；原Policy消费最终再检查，原迟到结果控制保留 |
| 主题移除关联/不可见Goal/错渠道 | 当前归属与关系重新校验；不执行、不换Goal、不拼接身份 |
| 通知/浏览器读取失败 | 不重跑Goal或Worker；继续原Outbox/Inbox的消息语义，不另加通用通知框架 |
| 外部snapshot含指令/伪造授权 | 仅资料；进入原UNTRUSTED_GOAL_SNAPSHOT observation，工具仍为0 |

### 2.5 预计阶段3改动文件

- 新 `src/source-event-types.ts`、`src/source-event-store.ts`：四表和定型事件/订阅DTO；可将短service与store同文件，避免为了目录层次拆小函数。
- 新 `src/source-event-service.ts`：可信Web身份、来源显式许可、订阅归属与tick；如逻辑短可并入前者，不强求三文件。
- `src/github-observer.ts` 原则不改；已有poll和限制够用。
- `src/goal-policy-store.ts`：局部事件接入、创建执行快照前核对事件Hash、绑定Policy排除、原事务复用；旧dataJson/audit格式、Console控制与原consume/settled语义保留。
- `src/sqlite-store.ts`：组装同连接事件store及短事务；`src/config.ts` / `src/main.ts`：默认关闭开关与来源tick生命周期；必要时原GoalRunner只接线，不重写后台门。
- `src/web-ui-channel.ts` / `src/web-ui-server.ts` / `src/web-ui-types.ts`、`web/src/work-threads.tsx`与最小样式：来源/订阅/事件视图；Web Policy控制只有用户批准后才实施。
- `src/web-ui-store.ts`按需复用2B请求模式/幂等容器保存结构化Policy操作Run；不得把审批Run当聊天建议或调用模型，模式须在B3冻结后定。若既有容器不能保留原请求/版本且区分模式，才增加最小的Policy请求记录，不靠伪造Chat来源绕过source()。
- 适量新增 `tests/source-events.test.ts` / 进程用例，扩展现有GitHub/Policy/Web回归；交付时按规范更新README/STATE、评估记录，稳定架构事实改变才改PROJECT。

## 三、阶段4推荐：显式有界关系Recall，原始成果与出处优先

### 3.1 入口与定位

- 同一Web输入区增加显式“查找历史”模式，或主题页“查找相关工作”入口；普通发送聊天不增加分类、历史扫描或模型请求。默认关闭/依赖WorkThread的独立能力开关可按现有风格接线。
- 当前明确选择threadId/对象/事件优先；定位时调用B1已形成的Goal/Task元数据路径（当前增量候选名为routingObject/routingObjects/get/list），不要求B1预建Recall模块。
- 初始候选上限沿2B：最多20主题、所选主题20对象、元数据8KiB；超限提示缩小，不把截断子集当全库不存在。WorkJob/Run/事件候选在本阶段局部补充，不倒灌2B协议。
- “刚才那个”只有当前界面可证明的唯一对象引用才直接定位；“上次GitHub更新”先限定主题/来源及时间关系；“之前准备的面试计划”用可见标题/目标元数据匹配。多个对象或主题均合理时给候选澄清，不能选最高相似项当事实。不能仅凭最近updatedAt认领自然指代。
- 最小首版可确定性匹配词/类型/显式时间修饰+澄清，不新增模型分类。若用户期待开放式自然语言命中率，应单列真实语义验收，不能以固定离线样本宣称通用理解能力。

### 3.2 关系扩展与结果读取

定位主题后只走明确关系：手工work_links、天然threadId的WorkJob、阶段3订阅事件及其原Trigger→Grant.executionRunId→GoalExecution；每一步仍调用原归属检查。**任一runId入口都先识别是否属于GoalExecution**，包括Goal关联、kind=run手工关联、明确runId、重复关系和其他对象别名；识别后统一走同一Goal归属/committed/Hash投影，不因入口类别改读技术Run.output。按runId去重，不能因为一个Run被多个关系引用就重复算多个成果。

| 对象 | 原成果与来源读取 | 不可用/敏感边界 |
| --- | --- | --- |
| WorkJob | store.workJobs.get(actor,id)→原Run；带jobId/runId、原始instruction、状态、完成时间 | 失败/中断不编成果；取消后迟到输出不作为成功 |
| Task | 原Web target Task→原一次Run.output | 不重跑Task，不改Task权限/状态 |
| Goal | 先goals.get(actor,id)，再有界取committed GoalExecution，校验checkpointHash；正文取artifactText+progressSummary/问题 | 不返回readyInput、Grant凭据、原内部授权文本；不能把未提交/丢弃结果当成功。view目前会全取历史，首版应局部增加按已知runId/最近N条读取，避免借view无界扫描 |
| Run及其别名 | 先ownsRun并识别GoalExecution；命中则走Goal专用actor+goalId/committed/checkpointHash投影，绝不裸读技术Run.output。确认不是GoalExecution后，才复用channel.run(id,false)或同一fileForRun检查取有界output | discarded/failed/interrupted的GoalExecution只返回真实状态和出处，不输出为已提交成果；即使技术Run=succeeded也相同。文件审批Run只返回fileOperationId和来源提示；不返回preview/content/diff/hash供确认，不写ACK |
| GitHub事件 | 来源repo/branch、previous/head、事件时间、不可变snapshotHash与关联observation/trigger/run引用；可跳原GitHub commit来源 | 无执行则明确“仅观察，尚无分析成果”；来源缺失/Hash错不重新联网伪补。显示当时来源，不假称分支仍指向旧head |
| Memory关联/补充背景 | 仅在用户显式请求或关系不足且选择“补充长期背景”时，复用原Memory读取与纯retrieve | 不自动保存成果；不把其他渠道记忆因关系存在就暴露给Web |

Goal历史的最小新读方法是：按给定runId识别GoalExecution或按goalId/LIMIT N取记录，经actor+goalId归属校验后，只对committed记录沿原checkpointHash方法核对并返回成果DTO；其他Execution仅返回状态/出处。缺失或损坏Hash失败关闭，不回退技术Run正文。不要直接把executionForHost暴露成无鉴权API，也不为Recall重构GoalStore主执行流程。

Memory的最小实现：在显式背景分支才调用listForHost，先筛source.channel=web且source.reference被当前ownsRun证明；需要主题限定时再取显式关联ID，然后调用纯retrieve(records,原查询)。仅导出既有记录的有界片段和id/version/source；不调用全局MemoryService.retrieve后绕过来源筛选。读取失败明确本轮背景不可用，不影响已有关系成果、不声称不存在。此路径默认不调用查询改写模型，避免悄悄增加HTTP。

### 3.3 投影、预算与安全语义

- 首版直接展示可追溯原成果摘录，零新模型请求，是关系Recall的真实闭环。不要把并未运行的模型摘要包装成“分析”。用户可继续正常聊天，但不把Recall原文拼成用户新指令或Guard输入；如果后续确需模型回答，再在公开context事件中临时加入有界低信任投影，作为独立任务冻结预算，不追加完整正文到Session。
- 推荐读取上限：查询2KiB；最多5个原成果；每个摘录至多4KiB、成果合计16KiB；元数据/来源合计8KiB；最终序列化API结果≤32KiB。按UTF-8字节和完整JSON实测，不用字符数冒充字节预算。超限减少条目/摘录并标omitted/truncated、原始bytes、显示bytes及原对象入口。
- 原Goal目标/反馈/问题不为凑预算悄悄改写；只截取可标识的成果片段。原文不可得时显式“本轮未提供/不可访问”，没有证据就不补历史答案。摘录是旧时点资料，不能推出对象当前仍有效或执行已成功。
- 所有成果、commit message和patch为低信任资料。Readonly Recall API没有Tool/Task/Goal/Policy/文件批准/Memory写入出口；引用中的“确认”“取消”“保存”不触发操作。
- 不调用channel.acknowledge、goals.displayed、delivery_succeeded、文件decision；不用前端自动ACK的呈现包装。只能跳原详情视图让原交互自行做完整展示与确认。
- 搜索/选项/只读读取可不持久化。若需要刷新保留，最多存请求模式、原查询、选择ID与来源收据，不能复制整份成果形成新事实源；不扫描Pi历史Session。

### 3.4 预计阶段4改动文件

- 新 `src/work-recall.ts`（短service与DTO可同文件）：定位、受控关系遍历、有界摘录与来源；不建向量DB或Recall Runner。
- 局部扩展 `src/work-thread-service.ts`元数据查询，复用B1；`src/goal-store.ts`按需增加有界只读成果方法，主执行不变。
- 复用 `src/work-job-store.ts` / `src/web-ui-store.ts`既有归属；只有缺少有界关系查询才局部补方法，不为统一风格重构。
- Web channel/server/types、主题/Chat最小视图和样式；若仅原文Recall足够，`src/pi-executor.ts`无需改。确需模型合成时只做公开context适配并单独冻结任务，不放进普通chat默认路径。
- 新 `tests/work-recall.test.ts`和最小Web进程/浏览器覆盖；按阶段更新交付文档。

## 四、可独立验收任务卡

| 卡 | 明确产物 | 独立验收门槛 |
| --- | --- | --- |
| E1 来源/事件事实 | 冻结DTO、四表、来源许可/游标/快照Hash/去重；先不接自动执行 | 临时DB增量迁移/重开；首次基线；同head唯一；gap不前移；mockGitHub固定网络；关闭零轮询；仅观察0模型/0Grant |
| E2 订阅/可见性 | 创建/查询/停用、事件投递判定、主题展示 | 两主题/两身份、错误源/Goal/跨渠道、归档/停用/恢复边界；事件事实不被订阅删除；订阅0授权 |
| E3 原执行与Web批准 | 用户先批准末节权限，再实现结构化Web Policy及原事件入口 | 原approve/source/Grant/预算/Runner均保留；source/Policy三字段精确匹配；事件到原Goal不是新Goal；新Web每触发最多1片段；busy新事件不影响原授权/在途提交；无工具；Console限制与旧链不变；纯本地恢复不重复HTTP/Grant |
| E4 事件阶段冻结 | 工程回归、独立审查、Web离线验收、证据 | typecheck/build/web:build/npm test；源码Hash/diff/原始日志；桌面/390px完整观察→审批→变化→原Goal→成果；未批准E3时不能宣称自动闭环完成 |
| R1 有界定位 | 查询/当前引用/候选澄清，零正文/Mem读取 | 两主题、“刚才/上次/之前”明确与歧义、不可见ID、候选超限；无静默擅选/无模型请求 |
| R2 成果/来源 | Job/Task/Goal/Run/事件关系与低信任摘录 | 任意Run别名统一识别GoalExecution，取原committed成果和Hash，discarded即使技术Run成功也无正式成果；去重、状态变化/缺失来源；文件Run0正文/0ACK；UTF-8预算实测；默认0Memory读取 |
| R3 Web读取闭环 | 自然引用→澄清→原成果和来源跳转；可选只读Memory背景 | 刷新不执行/不赋权；普通chat请求数不变；Memory先归属过滤；恶意原结果不触发任何控制 |
| R4 总体验收 | 全回归/浏览器/交付证据 | 事件→原Goal→原成果→自然引用找回链路可追溯；关闭兼容；所有真实模型/手机/长跑缺口单列 |

## 五、自动化与浏览器离线验证清单

自动化必须使用临时SQLite/合成Memory和Session/本机mock。复用现有 `tests/github-observer.test.ts`、`tests/goal-policy.test.ts`、`tests/background-competition.test.ts`、`tests/work-threads.test.ts`、`tests/work-jobs.test.ts`、`tests/web-ui.test.ts`夹具，不复制生产数据。

1. source启用后首次head无事件；相同head重复/重复分派/重启均0额外执行。两来源同repo/branch但不同可信身份不合并权限。
2. 在event提交后、分派事务前模拟进程退出：恢复读取同snapshotHash，禁止新GET，原Grant最多一次；Grant提交后退出则沿原Goal保守恢复，不重跑模型。
3. 停用订阅/来源、归档主题、变GoalPlan、撤销/过期Policy、Goal等反馈/运行中、未知费率/预算耗尽，逐一核对event保留、判定原因、Grant/Execution数量及模型HTTP计数。
   - 单独构造已有issued-ready与consumed-running，在相同有效Plan/Policy下到达新事件；新事件busy/skipped且0新Grant，既有Policy/Goal版本、Grant状态不变，原片段仍committed；重启不补跑被跳过事件。另测Plan变化/用户暂停应照旧阻止迟到提交。
   - 同Goal/同owner但不同repository、不同branch、不同intervalSeconds（尤其更快间隔）均绑定失败；匹配三项才正常交原链。来源字段修改接口拒绝；新来源不会承接旧Policy，暂停/关闭不会回退旧observe。
4. 窗口gap/forcepush/response超限/HTTP错误/迟到HTTP，游标不误前移、退避持久化；恢复或重建基线不补分析旧事件。
5. 合成两条不同主题GitHub事件，绑定已有不同Goal；新变化只续其原Goal，不新建Goal或WorkJob，来源和Run在结果页可追溯；多订阅不令同Policy双签发。
6. 外部commit/成果包含“批准”“记住”“删除文件”“取消另一个计划”等注入，验证0越权业务写、工具为0、原Guard状态不变。
7. Recall的显式选择/唯一标题/歧义、未完成/failed/cancelled/discarded、无成果、已删除/不可见对象、缺source/Hash错、跨渠道伪造work_link都得到准确结果；不把未召回说成全库不存在。
   - 同一技术Run=succeeded、GoalExecution=discarded且保留artifactText，分别从Goal关联、Run关联和明确runId读取，均无正式成果正文；committed的多种别名可返回并按runId去重，损坏Hash失败关闭。
8. 关联文件审批Run通过Recall只出现fileOperationId；前后file status、delivery_succeeded、Guard展示引用均不变；打开原文件页才走原完整预览/确认。
9. 中文/emoji/长JSON引号/多字节截断验证真实UTF-8和序列化上限；来源、截断标志/原始长度准确，结果缺失不自动造摘要。
10. 默认Recall关系分支用会抛错的Memory mock证明零读取；显式背景只读当前Web有权记录，不回传Console/飞书记忆，不保存、不收费改写。
11. 关闭所有新开关，原Task/Goal/Memory/Chat/显式WorkJob回归；普通chat无新增Router/Recall/来源请求或历史扫描。

浏览器用临时进程、合成来源与mock事件：桌面和390px各完成来源显式许可→只观察→订阅/停用→（批准权限后）当前Web Goal结构化Policy→新事件→原Goal单片段→主题/收件箱结果→“上次GitHub更新”→歧义选择→原成果/来源。另验证来源错误、空状态、归档、刷新/重启、文件Run跳转不ACK、窄屏表单与长SHA不溢出、控制台无新增error。离线模型输出只证明机制；真实语义命中率、手机、真实GitHub与长期运行未验证。

## 六、唯一必须由用户决定的权限范围

**用户已明确批准下述受控Web入口，授权仅限隔离实现和离线验收；审批来源为本次用户答复，不是研究Worker或Reviewer同意。**

> 已批准新增默认关闭的Web来源/观察许可与独立结构化Policy审批：已登录本机Web用户可明确许可固定GitHub只读repository/branch的周期观察，并为自己当前可见的已有Web Goal审批、暂停或撤销GitHub text_only Policy；审批完整展示repository/branch/间隔、原Goal、当前Goal/Plan版本、有效期、每日/总次数及人民币预算；首批每触发最多1个无工具text_only片段。策略仍由原GoalPolicyStore.approve/control、原Trigger/Grant/预算消费、原GoalRunner执行；不修改policyConsole的Console限制，不做跨渠道身份拼接，不给事件、订阅或模型审批权。来源观察许可与执行Policy在UI和审计上分开记录。

推荐批准该最小入口，才能在Web完成“新事件找回原Goal、已有授权内续段、结果可追溯”的真正闭环。现有宿主模型费率/总开关仍须有效；此批准仅授权隔离实现/离线验收，不开启正式来源、不访问正式数据、不授权收费真实试验。

替代选择：只实施来源显式观察、订阅、待处理展示与Recall，用户再通过原聊天/Guard手动继续原Goal。它有真实事件事实与可追溯读取，但**没有Web事件自动续原Goal能力**，E3自动闭环与原阶段3完成定义必须明确留待后续。不能借Console Policy实现Web执行，也不能把展示待处理项冒充自动闭环。

其余命名、表结构细节、限额显示、Recall显式入口与候选澄清可由Planner在已授权范围内冻结；目前没有第二个必须用户拍板的决策。核心策略语义若在E1/E3审查中发现不可兼容，应带精确证据回交，不能悄悄扩大权限。
