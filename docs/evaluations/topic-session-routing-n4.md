# N4 原工作链与单输入框整合

日期：2026-11-03。状态：**最后独立R3 PASS，N4已授权离线机制验收通过，无剩余阻断。** 原R1/R2失败记录保留；N5尚未开始，本结论不等于全批、真实模型语义、浏览器或手机通过。依据[已批准规划](../designs/topic-session-routing-plan.md)第3.5/4/6节及本机`n4-n5/execution.md`。

## 实现范围

- `src/work-coordinator-store.ts`：在原commitBatch事务读取父请求冻结route，新Job继承其主题并拒绝归档；日常保持原按名组织及不绑定Session。原Goal成果首次文字修订无Job根时也继承许可父请求route；已有根始终优先原root.threadId，原Job/Run/许可事务及Runner不改。
- `src/work-coordinator.ts`：只在已接收的topicSessions请求中校验每项自己的后台/持续分阶段文字执行框架。普通交付、仅持续对话误报batch时回普通Chat，零Job/Goal；同批普通项不借另一项后台措辞入队。复用原范围覆盖、肯定动作、否定/引用及候选定位，不新增Schema或分类调用。仅原两处动作前缀支持明确后台及持续/分阶段修饰。
- `src/operation-guard.ts`：Goal create按当前可信prepareChat选择一套创建许可谓词；新模式要求明确创建长期目标/学习计划/Goal，不以持续协助创建。误报create返回not_applicable且保留原单轮消费限制；自动/定时拒绝、旧模式和continue/审批状态机保持。
- `src/pi-executor.ts`、`src/work-tools.ts`：对齐主Chat、工具说明与隔离解析，持续主题不等于执行。主提示通过公开before_agent_start按本轮prepareChat追加，不能用全局flag重新解释旧队列；无SDK/Loop修改、无权限或预算扩展。
- `web/src/main.tsx`：在原消息时间线添加日常/主题标题/待澄清文字，来源只读request.topicRoute。沿用原队列、成果归属及ACK入口；无必选控件、第二入口或focus状态。
- `tests/topic-session-work.test.ts`：18项真实SDK+localhost假模型/临时SQLite与Session定点。`tests/work-route-ui.test.ts`：复用原Hook/fetch宿主核对历史标签、通知和刷新只读。`tests/topic-session-runtime.test.ts`、`tests/topic-routing-web.test.ts`只调整创建Goal的准备原文，保留原目标定位、审批与失效断言。
- `docs/STATE.md`及本评估：维护本次已完成、待审和N5边界。README/PROJECT及完整手动试用说明由N5统一维护。

## 验收与实际证据

证据根：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n4/worker-r1/`。

| N4目标 | 实际断言与证据 |
| --- | --- |
| 新Job继承主题 | 同健身主题训练/饮食两Job的threadId等于冻结route，主题数仍1；各自实际Worker HTTP只含本工作材料 |
| 稳定工作链 | 切求职主题后具名修改训练安排，后继root/previous/thread仍属原训练工作；Goal首次修改继承本次主题，后续跨题仍原根链 |
| 不选同主题最新工作 | 同主题两Job用主题范围查询产生澄清，不创建第三项或擅选最后Job；原合法focus与具名续接回归保留 |
| 日常后台 | 明确后台项沿原组织，chatContextKey为null；同批普通短信项未排队，返回未委托后台的澄清 |
| 普通/持续聊天零业务副作用 | 五类普通请求、健身/求职持续对话及否定/引用误报batch/create：实际Job/Goal数0，普通正文成功交付；持续场景仅创建主题Session |
| 旧请求保持原语义 | 新模式daily→已接收旧请求→新模式daily实际主HTTP无新提示残留；旧模式逐步准备目标仍可创建Goal |
| 明确Goal仍可用 | 中文长期目标与英文Goal创建均走原Goal；原待批准计划展示/ACK→批准→continue引用当前Run有效；旧引用失效与文件审批回归通过 |
| 路由标记只读 | 原UI Hook/fetch读取daily/topic/clarify标记，通知/刷新不改归属，历史标记读取无ACK请求、无新增选择控件；HTTP/数据库侧通知与冷恢复不改当前contextKey |
| 事务与权限 | 冻结主题归档后原提交事务完整回滚，不按工作名另建主题；既有actor、候选、材料覆盖、取消、许可与文件Hash回归保留 |

以下为R1实现验证的历史记录；其328/328不能覆盖独立后来发现的两个P1，R2结果见下节。R1冻结候选使用clean env（dummy配置由夹具构造）、`HOME=/private/tmp/n4-offline-home`、`TMPDIR=/private/tmp`，未读取正式.env/Memory/Session或使用收费模型。

- `n4-regression-frozen.log/json`：17文件、328/328，0失败/取消/跳过，22890.378ms，exit0。含主题Session/压缩/旧引用、工作/Goal/File及UI Hook必要回归；不是全量。
- `typecheck-frozen.log/json`与`build-frozen.log/json`：exit0。`web-build.log/json`：exit0，两条原有lucide use-client警告；此后Web构建输入未改，未重复同一UI构建。
- `n4-regression-frozen-http/`：当前N4场景实际202接收、200收据/ACK状态、localhost入站payload、冻结请求/主题/Job/Goal及Run事件。只含虚构资料，ACK是原回答/审批展示流程，不来自新标签。
- `baseline-red.log/json`及`baseline-red-http/`：将每个修改前快照核对N4基线SHA256后复制到/private/tmp独立源码树，重放17项2过15红，证实误建/主题继承/归档事务缺口。与最终新增自然动作头一项的18项定点不混算。
- 保留`focused-first`监听EPERM环境失败、`focused-r2`的Goal新主题/claim模式两个夹具失败、`n4-regression-first`三处旧Goal种子失败、`n4-regression-stable`第二个持续动作头失败及后续绿灯。普通误报场景是故意错误模型输出，不是实测语义分类质量。

## R2：普通写作宾语误授执行许可的限定修复

独立[R1报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n4/reviewer-r1/review.md)不通过：普通“帮我写一段后台处理功能的介绍。”及带材料版本实际各建1个queued Job；“帮我写一段创建Goal的功能介绍。”实际创建1个Goal。原字面搜索只证明动作宾语包含相关词，不能证明用户要求在后台执行或创建Goal。R1全部证据和失败保留。

R2相对R1仅5文件：`src/work-coordinator.ts`、`src/operation-guard.ts`、`tests/topic-session-work.test.ts`、STATE和本评估。原CRLF保持；其他R1源码及正向准备原文未改。

- 工作入口复用原workCommand与已验证逐项原话范围，仅捕获原动作前缀。后台/异步/持续/分阶段必须在实际动作前缀；尾随“交给后台处理”须自己是完整委托子句。普通写作宾语、把字宾语、资料中的相同字面不提供许可。没有新Schema/分类模型/框架或反例词语黑名单，原范围/否定/引用检查继续执行。
- Goal仅在新模式要求创建为当前句首主动作；“写一段…创建Goal…”不是该主动作，“创建Goal的说明”依属格仍是说明宾语。旧模式许可谓词与原view/approve/continue不改。无分隔“创建长期目标虚构学习目标甲”正向种子仍原样通过，不要求用户添加冒号或空白。
- 正式SDK/HTTP回归新增独立3原例及5个同根表达：持续修改/分阶段推进是写作宾语、把字宾语、如何创建目标的说明、创建Goal的功能说明。每例故意误报batch/create，核对普通正文、0Job/Goal及持久主题数；并保留原明确后台、尾随委托、持续/分阶段交付、中文/英文Goal正向和旧模式/原审批链。

R2证据根为`../worker-r2/`（相对本机R1证据目录），完整路径：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n4/worker-r2/`。

| 实际命令与证据 | 结果 |
| --- | --- |
| 未改独立probe，`independent-counterexamples-red` + `probe-results-red.json` | 在未改R1源码上复现2 Job/1 Goal；exit1为零副作用检查实际失败 |
| 同一独立probe，`independent-counterexamples-green` + `probe-results-green.json` | 3例均HTTP202、Chat succeeded、普通正文可交付、Job=Goal=0，exit0 |
| 正式26项在R1版，`formal-counterexamples-red` | 18过8红、exit1，保留新增八个同根实际反例 |
| 修复后`focused-green` | 26/26，0失败/取消/跳过，4763.689ms，exit0；后续正向动作对照也包含在最终回归 |
| `regression.log/json` | 同源17文件336/336，0失败/取消/跳过，21282.599667ms，exit0；含全部原R1种子、审批/引用、主题/工作链、文件及UI Hook |
| `typecheck-final` / `build` | 均exit0；Web构建输入与R1相同，复用R1 web-build exit0和两条既有lucide警告 |

R2 `regression-http/`保留实际SDK请求/HTTP状态、临时SQLite投影和原Run事件。只使用clean env、dummy配置、/private/tmp合成数据及localhost假模型；没有真实语义或收费请求。R1→R2差异、N4全部增量、相对HEAD累计diff、逐文件Hash与最终445文件manifest随R2冻结交接提供。当前结论仍是Worker已验证、待独立R2复审，不把两个P1自行标为独立关闭。

## R3：实际动词前的后台修饰正向回归

独立[R2报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n4/reviewer-r2/review.md)已关闭原R1两项P1，并发现一项P2：`请根据虚构材料在后台整理报告：虚构材料。`、`请把报告在后台整理好：虚构材料。`在R1可建Job，R2却not_applicable。原五场景真实SDK/HTTP对照及两条正式回归在未改R2源码上已复现，原红保留。

原因是原workCommand把介词/把字句实际动词前的文本捕获为subject（例如“虚构材料在后台”“报告在后台”），R2只看prefix而漏掉此位置。R3只在`src/work-coordinator.ts`既有判定中增加subject末端锚定的`在后台\s*$`检查：必须紧邻原已识别实际动词，不重新任意搜索宾语。不改原动作解析、prefix、尾随委托、否定/引用与逐项范围，不扩副词词表，不改Goal/Guard或旧生命周期。生产改动为一个条件和中文注释。

`tests/topic-session-work.test.ts`仅新增独立两条正向，每例实际daily请求应1个queued Job、0Goal，组织主题chatContextKey=null。原R1/R2负向八例、所有正向和Goal准备原文不改。连同STATE及本评估，R2→R3共4文件；完整N4仍12文件，445源码，index空，累计37未提交。

R3证据：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n4/worker-r3/`。

| 实跑 | 结果 |
| --- | --- |
| 未改独立positive-probe，`positive-probe-red` / `positive-results-red.json` | 未改R2源码版，独立两条各0Job导致exit1；其他原三正向满足 |
| 新增正式两例，`formal-positive-red` | 修前0/2、exit1，实际SDK/HTTP，不把不入队当解析模型遗漏 |
| 同一独立positive-probe，`positive-probe-green` / `positive-results-green.json` | 四个后台正向各1 queued Job、Goal正向1Goal；均HTTP202、Chat succeeded，五例预期满足、exit0 |
| `regression.log/json` | 最终同源17文件338/338，0失败/取消/跳过，24063.605625ms，exit0；包含原R1/R2八例零副作用、全部正向和新增两例 |
| `typecheck` / `build` | 均exit0；Web输入未改，继续复用R1 web-build及两条既有lucide警告 |

`regression-http/`保留实际当前请求、HTTP入站、Job/Goal与Run事件。R2→R3 diff、整N4阶段diff、累计diff、字节快照、445源码manifest及命令exit随冻结交接提供。只使用/private/tmp虚构数据、dummy配置和localhost假模型；未tick独立probe新建Job，无收费、外网模型或正式实例操作。上表为Worker交接时点的验证；随后独立R3正式PASS，见下节。

## 最后独立R3结论

[独立R3正式报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n4/reviewer-r3/review.md)：N4 PASS，无剩余阻断。独立17文件338/338，0失败/取消/跳过，20781.877625ms，exit0；原R1三负向均0Job/Goal，原R2五正向预期全部满足，八个正式普通表达的实际HTTP/数据库均零副作用。445源码审前后Hash不变，原R1/R2证据全保留。N4三轮审查结束，后续进入已批准N5，不重跑N4证明同一结论。

## 冻结与未验证

阶段精确12文件；修改前快照、阶段/累计diff、逐文件用途与源码manifest见证据根。HEAD保持`ca1f6737d730565bdc41c9b18909a05de3ae88bf`，本地未提交，未暂存/推送/合并。保留全部原N1—N3及compact改动。

本轮不运行最终全量、实际浏览器/390px、真实模型/手机或长跑。N4独立通过后，已授权N5完成全量、离线浏览器和可执行隔离真实手动测试说明；用户亲自启动新隔离目录/端口并发送真实模型消息。固定假模型只证明宿主机制，不证明自然分类、澄清率、成稿质量或时延。后台/分阶段框架与Goal创建入口仍是有界当前原话校验，不能据此宣称覆盖所有自然说法。既有62414/4317/4318实例和正式数据未操作。
