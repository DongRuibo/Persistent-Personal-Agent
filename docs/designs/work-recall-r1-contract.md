# Recall 有界定位与原成果契约（R1/R2）

2026-11-02。R1独立第1轮已通过；R2独立第1轮已通过。R3显式Web/API已独立第1轮通过；R4工程/全量730与实际Chrome桌面/390离线闭环已完成，正式独立第1轮PASS、无finding，见[独立报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/review.md)；不代表真实语义/手机/长跑或正式启用。

- 唯一入口 `WorkRecallService.locate(unknown)`：入口一次校验 `{ query, selection?: { threadId?, object?: { kind, id } }, includeBackground?: boolean }`；kind仅goal/task/run/job/event，不接收owner/渠道/授权。查询UTF-8≤2048字节。格式/字节超限抛400；合法请求返回located/clarify/unavailable及元数据。
- 显式对象ID先原归属直查，再核所选主题关系；无所选主题可定位有权的独立对象，多主题关联须澄清。天然Job归属与实际subscription_events关系复用原事实；明确ID不依赖最近100项列表。明确主题/对象可绕开无关候选超限。
- 归档主题可读历史；原B1路由/新增工作对归档的拒绝不改。手工关联不授予Goal/Task/Run权限，Memory关联忽略；已删除或不可见返回不可用，不泄露存在性。
- 无显式对象/事件的“刚才/刚刚/那个/这个”始终澄清，主题选择和唯一历史候选均不能证明指代。不会按updatedAt擅选。
- 标题查询仅逐字包含匹配，可去固定前缀“请查找/查找/找回/查一下/之前准备的/之前的/之前”；主题名也可逐字出现在查询中。类型词仅Goal/目标、Task/任务、Run/执行记录、Job/后台工作。多个匹配澄清，不按相似度排名；复杂自由表达未承诺理解。
- “上次/最近一次…GitHub”需明确选中主题或查询逐字包含唯一主题名，并且该主题真实订阅只有唯一来源；第二来源即使尚无事件仍需澄清。最近仅按真实observedAt，时间并列不擅选。多来源有候选时提示选择具体事件；唯一来源但无事件时提示当前范围无可选事件。尚不提供sourceId筛选字段。
- 无显式对象时先限定候选范围，超20主题/20对象或完整序列化响应UTF-8超过8192字节，清空候选并要求缩小；绝不截断后声称唯一或全库不存在。最近100列表只能用于检测候选超限，不用于明确ID不存在判断。
- Run仅沿ownsRun读取id/taskId/status/时间列；事件SQL仅ID/来源repo与branch/previous/head/observedAt/snapshotHash/主题关系，无snapshotJson。记录状态recorded只表示事件事实已保存，不表示执行成功；locate不校验/输出成果或授予操作许可；read按下述R2规则校验原件。
- locate保持0Memory/模型/成果正文/Session/业务写入/ACK，includeBackground不会令locate读取背景；普通Chat、Guard、GoalRunner/Policy及原SDK流程不接入。read只在显式调用时读取受控原成果，R3仅在显式Web入口调用，不接普通聊天。


## R2 原成果与背景

- `WorkRecallService.read(unknown)`复用同一入口校验，再调用已定型的定位逻辑；不重复校验外部字段。返回`{ location, untrusted: true, results, background, omitted }`，不持久化查询或把结果送入Session/Guard。
- `location`沿R1。明确对象或唯一定位后读成果；也允许选中主题且空查询时读取本主题有界关系。其他歧义/不可用不读取成果或背景。全部元数据预算包含定位/状态字段；超限仍明确缩小范围，不以截断候选宣称唯一。
- `results`最多5项（含无成果/文件入口状态项）；按runId去重并保留`sources`别名。所有runId先识别GoalExecution→当前Web actor/Goal开关→committed与checkpointHash；权限不足/坏Hash失败关闭，discarded/failed/interrupted/running等只状态/出处。不给Execution.input/readyInput/Grant凭据，不回退裸Run。Goal正文在归属及committed之后才读取；Goal历史SQL最近6项，计数说明其余未加载历史。
- 普通Run经ownsRun及fileForRun，再读最多4096个SQLite字符前缀与原全文字节数；只对Run成功且原Task/Job成功提供成果。文件Run仅`fileOperationId`/原出处，不读proposal/payload或返回preview/content/diff/文件Hash，不写ACK。Task/Job原instruction整体提供，预算不足时`instructionOmitted: true`并保留原入口，不把240字符标题当完整需求。
- 事件验证保存snapshotHash及head，再核原Observation相同快照/previous/head、Trigger、Policy、Grant.executionRunId与目标Goal关系；只导出需要的ID/来源。坏/缺来源标不可用，0联网补齐；无执行（含Grant未消费）明确仅观察、尚无分析成果。重复Run优先保留事件→执行证据，其他别名省略有计数。
- 成果`excerpt = { text, originalBytes, displayBytes, truncated }`；按码点截取，有效代理对不拆开。每段text原UTF-8≤4KiB且其JSON字符串含转义≤4KiB；全部摘录（含背景）的原字节/转义字符字节合计≤16KiB。元数据/出处（去掉excerpt.text后的完整JSON）≤8KiB；完整JSON≤32KiB。
- Goal原objective/progressSummary/question整体提供或在`omittedFields`标明省略，保留Goal/Run原入口，不改写含义。`omitted.results`是已枚举唯一结果中未展示项数；`historyEntries`是各Goal最近6项之外未加载历史行数，不冒称全库唯一遗漏数；`sources`是省略的来源别名数，`background`是省略的背景候选数。
- 仅read显式`includeBackground: true`才调用原listForHost（沿既有全目录修复/扫描，可能重建索引，并非只读单文件），先筛web source且当前ownsRun证明reference，再按主题显式Memory关联ID限定，最后纯retrieve原查询，无改写/save/知识更新。背景结果保留id/kind/key/version/source及受控excerpt；成果项与背景合计最多5项。读取失败仅`background.status = unavailable`，不覆盖已取成果；默认status=not_requested且0Memory调用。
- 所有正文/commit均旧时点低信任资料；0业务执行/工具/控制/ACK/文件decision/Session注入。Goal committed与技术Run succeeded不互相替代，观察事实不等于分析成功。

验证：固定TMPDIR=/private/tmp，最终typecheck/build exit0，23文件相关回归221/221（含R1 13项、R2 26项）通过；原转译夹具失败与分版本日志保留在本机evidence/r2/worker。不与旧94/680相加，未跑Web构建/浏览器/全量/真实模型/外网/手机/长跑，未提交。


## R3 Web接线（已实现，待独立第1轮）

- `WORK_RECALL_ENABLED=false`默认关闭、依赖WorkThread、只在本机Web装配；关闭不暴露capability，`POST /api/work-recall`及新增`GET /api/tasks/:id`返回404。原Task列表与原Run接口保留。
- POST沿原登录/Origin/CSRF和32KiB JSON传输限制；HTTP不复制业务字段校验，直接交`read(unknown)`。错误沿原400，不建表/Run/Session或授权。
- 主题页显式面板可本主题/全部可见主题、空主题关系读取、查询/候选或明确kind/id；输入变更清旧呈现、忽略迟到/卸载响应，默认不请求背景。不持久化查询，完整刷新或主题卸载后不自动重查。
- 结果直接使用R2受控摘录/出处/状态与真实字节、truncated/omitted。普通Run明确技术记录；不裸读Run补成果、不套Viewed/ACK、不拼Chat/Guard。文件仅ID/显式原审批页；用户打开原完整预览后的旧ACK/确认流程单列。
- 原Goal导航复用现有选中目标；原Task在新增只读接口以当前Web目标归属直查，Run只在点击后读原接口并在独立技术记录面板呈现，不依赖最近100列表或新路由框架。
- R3三项工程和15文件154项适用HTTP/组件回归通过（13004.615209ms）；之后只有提示语及1条断言收尾，已补类型/Web构建和组件3/3（207.086916ms）。未做当前全量或DOM/实际Chrome；历史E4的680不能覆盖新Recall，R4统一验。
