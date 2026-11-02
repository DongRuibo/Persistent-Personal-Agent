# B1 路由建议契约与后续接线

日期：2026-11-01。基线：`91b7a657ddf62cf625c53f7bcfbddaa22aa6740b`。隔离分支：`codex/work-core-stages`。授权见[总任务书](work-core-stages-plan.md)及[2B任务书执行副本](work-router-2b-plan.md)。本文件冻结 B1 接口及 B2/B3 接线方案。B1/B2已独立审查通过；B3持久/API/UI及R1刷新绑定修复已通过R2；B4工程与离线浏览器已执行、等待独立终验，默认仍关闭。

## B1 已实现边界

- `work-route-types.ts` 保存跨Router/contracts/Pi共用的 `WorkRouteRequest`、五类 `WorkRouteSuggestion`、`WorkRouteContext`、`WorkRoutePreparation`；`work-router.ts` 保持原类型重导出，并提供纯准备函数 `prepareWorkRoute(input, service)`。原 `WorkRouter.route(chat/work)` 代码未变；B1没有新增组装或开关，B2另有独立默认关闭开关，旧 Chat/显式后台仍零 Router 调用。
- 请求 `mode='suggest'`，带稳定 UUID `requestId`、本次原文 `text` 及 `selection`。选择仅含可选主题 ID、可选 `{kind:'task'|'goal',id}`。身份来自可信 Web 服务，不能由请求传 owner/channel/target。B1 接受已定类型，不增加各层重复 Schema 检查；B3 在 HTTP 入口校验并规范化一次。
- 显式 ID 表示本次明确选择的对象，不从自然语言相似度推断。B1 未实现文字里的 UUID 提取；B2/B3 如接收文字中的明确 ID，应由宿主将明确引用映射为同一 `selection.object`，而不是交给模型伪造对象或 Guard 引用。
- 当前主题/对象直接验证原归属。主题不存在/不可见为404，明确归档主题为409；对象不存在/不可见为404，Goal关闭时不暴露其元数据。关联不增加访问权。
- 有明确对象且与当前主题无关联时澄清；无当前主题但明确对象关联多个活跃主题时澄清。唯一关联可定位；无关联的合法对象仅返回原对象入口建议，不杜撰主题。归档主题不进入候选，但对象本身仍由原服务独立管理。
- 只选主题不决定执行意图，返回 `suggestion=null`，留待 B2；没有选择时只提供当前身份的活跃主题，不遍历各主题读取正文或所有 Goal/Task。多条普通主题候选也不在 B1 按分数选中任何一个。
- 候选最多20主题；已选或唯一定位的主题最多20个可见 Goal/Task元数据。超量不截断，返回缩小范围的 `clarify` 与空候选。完整 JSON 候选按 UTF-8 最多8 KiB；原文最多14 KiB。B2另检查系统提示和原文在内的实际32 KiB请求体。
- `WorkThreadService.routingObject/routingObjects` 都复用原 `object()` 判断，`list(object?)` 只检查现有关系 ID；不读取 Memory/Run正文或 Session。旧公开 `detail()` 及四类候选行为保持。原 `object()` 的240字符标题投影沿用，候选不增加完整 Task/Goal正文。
- `existing_task/existing_goal` 只表示定位，`work` 只表示建议一次纯文本工作。任何建议都不创建 Job/Task/Goal、不改变状态、不写 Memory，不填充“已展示/已确认”引用，也不授予 Guard 能力。

## B2 模型适配契约（已实现，R1通过）

准备结果的 `suggestion` 非空时不调用模型；`null` 时最多一次公开 SDK `completeSimple`。模型只接收本轮原文及已构建候选，不接 Session、Memory正文、工具或授权。协议入口一次校验五种结果、字段、长度、候选ID和选择一致性；候选外 ID、显式冲突或歧义不得静默替换。`chat` 不自动转发原 Chat；Goal/Task仍由用户选择原入口处理。

预算沿用2B任务书：输出512 token、10秒、实际payload32 KiB、零隐式重试。取消/截断/错误不创建业务对象，也不自动回退 Chat。每条路径区分 Router 模型调用与后续 Chat/Guard 调用；B2仅接本机模拟模型，真实语义质量未验收，API/UI仍待B3。

- `suggestWorkRoute` 先调用原准备函数，非空结果零模型；其余调用 `AgentExecutor.suggestWorkRoute`，没有调用原Chat或Guard的回退路径。五类JSON结果在适配入口一次Schema与候选ID/当前选择校验，额外字段、候选外ID和冲突拒绝；语义歧义要求模型clarify。多个候选本身不是歧义，允许提出其中一个待用户确认的建议，不能当作已定位事实或授权。
- `WORK_ROUTING_ENABLED=false`，严格布尔，依赖WorkThread/WorkJob。main只允许本机Web；适配只由可信Web chatKey组装，关闭时无建议模型函数。未改Web请求表、API、UI、Job确认或原执行链。
- 复用同一 `ModelRuntime`/配置，以公开 `completeSimple` 和 `fetch` 检查实际序列化HTTP body，超过32768字节、非字符串body或第二次发送立即拒绝；`redirect='error'`不让自动重定向绕过计数。公开参数为512输出token、10秒、maxRetries=0，绝对10秒信号覆盖总时长，取消race不无限等待SDK，迟到结算不再写observer。close取消本轮建议并等待有界外层promise结束。
- 当前受控API白名单为 `openai-completions/openai-responses/azure-openai-responses/anthropic-messages`：本地SDK源码证明这些入口接受公开fetch；本轮实际loopback只验证兼容 `openai-completions`，其余未做HTTP模拟或真实模型验证。Google/Bedrock等不在本次受控白名单，明确0HTTP失败，不宣称任意provider普遍支持。
- 实际用量沿原observer，`purpose='work_route'`与 `memory_formation` 区分。`work_route_http`事件记录dispatch/blocked、bytes和attempts；dispatch是宿主发起尝试，不承诺服务器收到。取消/超时未观察到完整响应时保留未知用量，不凭空写0 token或费用；前置payload超限零HTTP、无model_calls。建议结果事件只记录kind/ID与deterministic/model来源，不存原因/原文，也不授予Guard引用。

## B3 持久请求与恢复契约（已实现，R2通过）

B1核实时 `web_ui_chats` 只有 `owner/requestId/runId/text`，不能把普通 Chat 行当成已保存建议请求。B3现已增量增加mode/selection并迁移旧行，不从旧聊天推断建议模式。

实际在此现有请求表增量增加 `mode TEXT NOT NULL DEFAULT 'chat'` 与 `selectionJson TEXT NOT NULL DEFAULT '{}'`，不另建建议表。旧行按 chat/空选择解释。B3同步更新为明确列名INSERT和查询，避免原 `INSERT ... VALUES` 在加列后失效；mode在SQL先筛选再各自LIMIT100，100条建议不会挤掉关闭后的旧Chat历史。

- 同一可信 owner + requestId 的 `mode`、规范化后本次原文和规范化选择须全部一致。`chat/suggest`跨模式复用ID、换原文、换主题或换对象一律409；重试已有请求只读已存在Run，不再次调用模型。
- 入口沿用原去首尾空白规则，不截断正文；选择采用固定键顺序、缺省为空对象的规范JSON，比较其值而非客户端JSON键序。普通 chat 永远空选择。候选元数据不并入输入身份，避免后台状态变化让相同网络重试被误认新输入。
- 原 `accept` 的同连接事务同时建立 Run 与请求行。建议成功/失败/中断均由原Run记录；重启原恢复将 running 标记 interrupted，绝不自动补调建议模型。
- 请求类型由请求行 `mode` 投影到 Web 历史，建议Run不混作普通Chat回答或后台成果。技术Run的 succeeded 仅表示形成建议，不代表排队或执行成功。
- 用量走原 `store.observer(runId)` / `model_calls`。新增少量 `work_route_started/work_route_suggested/work_route_revoked` 事件；事件只保存来源 deterministic/model、结果kind和允许的ID，不复制原文或候选正文。普通原因/澄清文字作为 `runs.output` 展示文本，结构化选择从已验证的结果事件恢复，避免把经过通用脱敏的自由文本误当JSON解析。这里不改通用脱敏策略。
- 编辑原文、换主题/对象或撤销时，UI立即废弃当前建议，并将原Run记为 `work_route_revoked`，防止刷新恢复为可确认。迟到响应只关联原requestId，不能替换新输入或自动发起工作。重新建议使用新requestId。

## 确认 WorkJob 的稳定 requestId（已实现，R2通过）

`work`建议的确认直接复用该建议原UUID `requestId` 作为 `WorkJobStore.create` 的 requestId，不在每次点击时生成UUID，也不建立第二张确认表。两个现有表各自保存请求与Job生命周期，Job原有 `(owner,channel,requestId)` 唯一键保证同一建议的确认重试最多一份Job。

确认入口读取本人持久请求、已成功且未撤销的 `work`结果事件、保存的原文和选择；提交主题只能为该结果的主题。确认携带的原文/选择若与保存值不同则409，须重新建议。首次创建前重新核对主题仍活跃可见、原对象仍可见且选择关系没有冲突；确认不携带模型改写指令，不构造Guard授权。先由原Job存储提交，才展示真实queued收据。

已存在同requestId且主题/原文匹配的Job只读回原收据，包含刷新、断线重试和服务重启；不得因确认重试重跑模型。已有Job的主题后来归档时仍可读回原Job，保持2A已有语义；尚未创建时归档则拒绝。B3已在原JobStore补按绑定requestId的只读查找，使确认先读已有收据，再进行首次创建所需当前访问校验。不同原文/主题冲突继续走原JobStore409。

Goal/Task建议没有该确认创建路径；只能回原聊天入口，将本次原文交原Guard重新判断。建议定位不构成权限，旧引用和失败证据不因路由建议恢复而改变。

## 验证与剩余项

本轮新增8项纯SQLite测试；受影响回归共32项，已经包含这8项，不能相加为40项。类型检查退出0。第一次32项在沙箱中20通过、12项因临时监听127.0.0.1被EPERM拒绝，已保留日志；最小权限重跑同命令32/32，0失败/取消/跳过。B1未运行全量、构建或浏览器，由B4整体执行；没有收费模型、正式数据或真实GitHub/Tavily访问。

证据目录：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b1/worker/`。最终完整diff（含未跟踪文件）、开始/冻结Hash和验证元数据保存在此；无提交、推送、PR或合并。B1/B2 R1已通过，各自冻结材料不覆盖；B3在独立证据目录冻结后停写等待R1，B4整体与浏览器闭环仍未验收。

B2最终验证：`npm run typecheck`退出0；Pi/Guard/Router/config及B1/B2受影响回归共50/50，0失败/取消/跳过，约12.28秒。该50包含B2模型7项、B2配置1项及B1纯SQLite8项，不能重复相加。初版模型7/7也保留，但不替代修订后50项；初次沙箱模型7项全部监听EPERM，随后最小权限实际重跑。

B2真实本机计数：五类合法建议各1 HTTP；17条协议/多候选路径各1；HTTP500/429/截断/禁止工具各1，四条否定/引用/假设/注入固定输出各1；前置/实际payload超限和预取消均0，中文合法body为16704字节/1 HTTP，取消及close各1；真实绝对超时约10005ms/1 HTTP。固定模拟只证明约束接线与无业务副作用，不证明自然语言路由语义准确。7项模型共35次loopback HTTP（其中1次普通Chat历史隔离基线），无外部业务API；其他原回归的本机请求另计。证据位于同前缀 `work-core-stages/b2/worker/`。

## B3 实际接线与验证（2026-11-01）

- 开关依赖沿B2。新增登录/Origin/CSRF后的 `POST /api/work-routes`、`GET /api/work-routes/:requestId`、`POST .../revoke`、`POST .../confirm`。POST规范化selection的字段/类型/UUID一次，数组kind、显式null、身份/授权字段均拒绝。revoke/confirm携本次冻结text/selection作期待值比较，不能换正文或目标。
- 建议使用单独在途槽，与原Chat busy分开；仍只有一个建议在途，不新增Worker/Runner。共享原foreground计数但不抢占后台；普通Chat和原2A分派不增加分类请求。入口准备结果复用于异步过程，未重复读候选或Memory正文。
- revoke未知ID时在原请求表建立revoked/interrupted技术收据，0模型，解决撤销先于原POST接纳的实际交错。已接纳时先记revoked、abort匹配的在途建议并等待有界结束；旧revoke不会取消后来建议。已创建Job不会因建议撤销被取消。
- Chat/suggest在同Web请求命名空间检查mode/text/context冲突，未统一重构原2A另一个表的命名空间；suggest→confirm故意复用原UUID。confirm读取持久原文/已验证结果，已有匹配Job先回收据（包括后来归档/撤销建议），首次创建才重验活跃主题、对象归属与关系，冲突409。首次纯文本Job不产生Task/Goal Grant或Memory写入。
- snapshot仅开启时增加suggestions及workRouting/busy；普通Chat/建议各自按mode先筛选最近100。建议事件恢复结构、Run.output恢复理由，直接Run GET带mode=suggest；建议Run拒绝业务展示ACK，不套Goal/Task原display引用。
- 原输入区增加建议按钮、可选明确Goal/Task下拉及独立卡片。卡片明示完整原文、候选主题/对象、建议/clarify与确认/撤销；低信任文本用React纯文本，不自动执行链接/HTML。确认有Job时显示真实收据，仍由原WorkJobs查询/取消。
- 编辑本次原文/主题/对象立即禁用旧建议并向服务端撤销。UI明确区分“本地已失效，撤销待确认”和服务端已revoked；网络失败显示重试，不能声称已持久撤销。迟到POST响应不回填新draft。原文回聊天只在用户点击后完整放回输入框，不自动POST、不拼接模型理由/ID/授权指令；超过原Chat10000字符时保留全文并提示编辑，不扩大旧预算。建议输入允许完整14KiB原文，超限不截断。
- 三种证据分开：API建议在途与普通Chat并存已由真实SDK/本机HTTP验证（2次Router+1次Chat）；编辑触发撤销的前端接线及确认Job后继续聊天已编译，但实际DOM交互仍待B4桌面/390px浏览器。不能用API通过宣称UI并行已经验收。

B3最终 `npm run typecheck`退出0；受影响9测试文件共72/72（含本轮10项），0失败/取消/跳过，约16.39秒。包括实际main四次临时启动/强杀旧Job恢复回归；不是正式进程。Web类型/构建退出0，仍两条既有lucide use-client告警。72项后只调整了建议卡片的收据/撤销待确认文案，单独重跑对应Web类型/构建；后端和测试源Hash保持72项版本。后端build、全量npm test和浏览器仍留B4。

初始失败全部保留且分开解释：typecheck有测试Header联合类型错误；首轮新增测试有1项SQLite空原型行对比断言错误及9项监听EPERM。仅修正测试Header标注/对象展开断言后，最小权限新增10/10通过；随后补严格数组kind反例，最终72项通过。没有把测试夹具错误归为环境，也不覆盖原失败日志。

本轮旧schema迁移用临时库复原旧请求表结构；一个对象关系失效的首次确认用定型持久结果夹具验证守卫，明确不冒充真实模型能绕过B1生成该结构。其余建议Web用真实Pi SDK和loopback固定模型响应，语义准确率/真实模型/手机/长跑未验。证据在同前缀 `work-core-stages/b3/worker/`，含B2增量/HEAD完整diff、开始/冻结Hash和所有命令/退出码/日志。无提交、推送、PR或合并；未读正式.env/DB/Session/Memory/备份或调用真实GitHub/Tavily。

### B3-R1-01：刷新后的当前建议绑定（R2待复审）

R1实际复现指出：snapshot恢复卡片却没有恢复currentRoute，文字/主题/对象变化不触发撤销，旧卡仍可确认。R2仅在首个成功snapshot恢复最新未撤销、未有Job且running/succeeded建议的冻结ID/输入绑定；不覆盖用户draft/选择、不POST或补模型。后续轮询永不重新绑定，避免夺回本地新请求或重新激活已失效建议。logout重置这一页面恢复标记。

只有当前绑定建议可以确认；其他历史卡明确“历史建议（只读）”，确认按钮禁用，confirm处理器还检查当前ID/invalid以防旧回调。历史可以由用户明确将原文放回输入框后重新请求，不能直接确认未绑定旧卡。已有Job历史不恢复活动绑定，得到真实Job收据时解除当前绑定，继续聊天不撤销Job。撤销未获服务端确认仍只显示本地失效/待确认，不冒称服务端已撤销。

R2验证：Reviewer原复现先确认缺陷；派生真实App/卡片源级宿主修前红、修后6场景绿；typecheck/Web构建与相关29项全过。源级宿主不是DOM，实际刷新/编辑/切换/历史卡在桌面和390px仍由B4验收。本轮后端/测试源保持初版72项版本，未重跑72/全量；证据仅新增 `work-core-stages/b3/worker-r2/`，不覆盖R1原材料。

### B4 离线整体验收（等待独立终验）

typecheck/build/web:build通过，npm test实际644/644、0失败/取消/跳过。真实Chrome1280×900和390×844完成建议→确认→聊天→结果，以及刷新/历史只读/输入与选择失效、慢建议迟到、纯HTTP故障撤销重试、14KiB完整回填和关闭兼容。原失败和两个临时实例计数分别保留。

浏览器发现回填10k提示被refresh立即清掉，仅增加按draft长度派生的持续提示，额度/后端不变；新UI重新Web构建并实际跨轮询验证。测试pause初版误用生产stop，改为夹具只暂停传输后重验同DB/session/端口恢复。644不冒称覆盖后加提示；src产品代码与644版本一致，夹具重验25项、最终Web/源级6场景和DOM另有Hash。详见[2B评估](../evaluations/work-router-2b.md)及[验证摘要](../evaluations/work-router-2b-validation.json)。
