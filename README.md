# Personal Agent：长期目标、Memory 与一次性任务

单用户、单进程 TypeScript 服务，复用原版 Pi Coding Agent SDK 的 Agent Loop。提供终端/飞书私聊、一次性任务、SQLite 持久化和独立后台调度。V1 的真实手机私聊、主动提醒及 pending 任务重启恢复已验收；V1.2 新增 Pi 原生交互 Session 持久化，自动化已验证，用户已实测真实飞书重启后能够接上此前对话。目前在 Mac 本地运行，暂不部署 VPS。

V2.0 增加四类统一长期 Memory（SQLite 索引 + 可读 Markdown），支持在新 Session 中检索。V2.1b 增加默认关闭的后台 Semantic/Project 候选发现，必须由用户逐条批准才保存；没有自动保存、Embedding、Observer 或 Skill 执行。历史真实飞书与生成验收保留在 STATE。2026-10-21 完成一轮隔离真实 Formation 验收：13次请求，6条值得保留的事实中宿主保留4条；两条合法提议被校验误拒绝，尚未达到质量目标，继续默认关闭。失败原文、一次批准更新及新 Session 回答见[真实验收报告](docs/evaluations/v2.1b-formation-live-review.md)。

V2.1b.1 已定点修复这两条宿主误拒绝，保留完整时间/范围与原有更新目标校验。原输出离线回放12/12、值得保留事实6/6，不代表新真实模型质量已达标；前后证据见[修复报告](docs/evaluations/v2.1b.1-formation-fix-review.md)。无需Key即可离线核对：`node --import tsx scripts/replay-formation-live.ts`。

V2.1b.2 已按授权完成12次隔离真实复验：原六窗6/6，新两窗0/2，整体6/8；两次批准与新Session回答通过，但错误项目target触发澄清、丢否定的property被拒绝。没有越权写入，仍不适合把质量标为全面达标，正式Formation保持关闭。[真实复验报告](docs/evaluations/v2.1b.2-formation-live-review.md)保留全部失败和实际用量；该批历史审计脚本的源码Hash检查对应原基线，不用于宣称新代码已做真实复验。

2026-10-22真实手机曾发生普通项目陈述被直接memory_remember保存；用户授权[宿主保存意图定点修复](docs/evaluations/v2.1b.2-memory-consent-fix.md)后，同句式错误提议被宿主拦截并正常形成候选。已实测显示、批准、明确拒绝、编辑后再确认、全新空Session命中已批准的当前Memory；“第一条先不保存”曾仅口头答应、未实际拒绝，失败保留。最新Windows131项128通过/3平台跳过，Linux131全过/0跳过，类型/构建及生产修复后的两个eval退出0。本轮手机46/48请求、保守预留1.877388/2元，测试进程已停；[完整证据及剩余问题](docs/evaluations/v2.1b.2-platform-feishu-review.md)不代表形成质量全面达标，正式Formation仍关闭。

V2.1b.3 按授权定点修复上述三个问题：有成功显示的候选时，宿主为“第一条先不保存”等有界拒绝补执行；H01明确新项目丢弃错误旧目标，仅建议新增；H02只有能够从当前原文唯一核对的否定漏字才恢复完整属性。批准/版本/来源校验保留，未批准仍不保存。相同真实提取输出离线回放6/8→8/8；主模型漏工具由真实Pi＋模拟模型验证，不是新的收费模型或手机验收。复核命令：`node --import tsx scripts/replay-formation-revalidation.ts`；[修复与回归说明](docs/evaluations/v2.1b.3-formation-fixes.md)保留原始失败、前后对比和适用限制。正式Formation继续关闭。


## Web App V1（独立本机模式）

Node.js >=24.15.0（当前Mac使用24.19.0）。React/Vite 前端与 Node HTTP API 同源，固定绑定 `127.0.0.1`，默认关闭。本模式不读取 `.env`，不启动飞书；不要使用会自动加载正式配置的 `npm start/dev`。完整启动说明见 [Web App](docs/web-app.md)。

macOS日常启动：在当前代码目录运行`npm run web:local`，自动构建、复用主项目四项LLM配置并打开浏览器自动登录，无需填写访问密钥。数据固定在主项目`data/web-ui`；保持终端运行，`Ctrl+C`停止，重复运行只打开现有实例。首次Mac运行不会自动导入旧Windows历史。下面是离线界面检查命令，日常使用无需运行它。

```powershell
npm ci
npm run build
npm run web:build
# 零费用体验：临时SQLite + 原版Pi + 本机模拟模型，不需要任何真实Key。
npm run web:preview:offline
```

上面命令会输出本机地址及固定测试登录密钥，数据仅为新建临时目录。该模式用来检查界面和离线路径，不是收费模型验收。正式模型连接需操作者自行安全注入独立配置，再运行 `npm run web:start`。Chat、Task/Goal、T3审批均复用原服务；通知仅存入应用收件箱，没有Web Push或iPhone推送。


网页普通聊天现已接入免费免 Key Tavily `web_search` / `web_fetch`，需要最新资料时由模型自动决定搜索并读取来源，无需申请或填写搜索 Key。`--web-ui` 下默认开启，可在启动环境设置 `WEB_SEARCH_ENABLED=false` 关闭；Console、飞书、后台Task/Goal不新增工具。Tavily免费模式有限流，模型调用仍按原服务商计费，不自动切换收费搜索。更新代码后重新构建、重启本机Web服务并刷新浏览器即可；运行限制见 [Web说明](docs/web-app.md#自动联网与来源)，本轮隔离真实验证见 [接入验证](docs/evaluations/tavily-web-integration.md)。

## WorkThread：工作主题与关联（默认关闭）

WorkThread 用来手动整理当前本机 Web 工作空间的 Goal、Task、Run 和 Memory。启用后在“工作主题”页创建、改名、归档/恢复主题，并添加或移除已有对象的关联。归档不暂停任务或目标，移除关联不删除原对象；主题不会自动执行、选择工具或保存记忆。

`WORK_THREADS_ENABLED` 默认 `false`，只接受 `true`/`false`；在 Web 进程启动环境中显式设置后重启，功能关闭时隐藏导航并关闭新 API，已有关系保留。现有启动器不会从 `.env` 读取此开关。先用新临时数据离线检查（macOS）：

```sh
npm run web:build
WORK_THREADS_ENABLED=true npm run web:preview:offline
```

此预览沿用本机模拟模型；可先在对话页创建一个提醒，再去主题页关联已有任务/执行记录。每个工作空间最多100个主题、每主题100条关联，各类候选最多100项；没有分页、自动归类或模型操作入口。Memory只展示来源Run可确认属于当前Web工作空间的条目名称；已删除、停用或失去访问权的对象显示不可用。模型/任务状态继续以原服务为准，主题页手动刷新取得最新状态。[数据模型、API与验证边界](docs/evaluations/workthread-foundation.md)。

## 纯文本后台工作 2A（默认关闭）

在本机 Web 的对话页选择“后台工作主题”，输入本次要处理的文字，再点击“后台处理”。成功入队后会返回工作 ID、主题和提交时间；你可以继续普通聊天。展开对话中的“后台工作与结果”，或进入相应主题，查看状态、取消和完整结果；执行结束后也会进入现有收件箱。

`WORK_JOBS_ENABLED=false` 为默认值，只接受 `true` / `false`。启用还需 `WORK_THREADS_ENABLED=true` 和 `--web-ui` 本机模式，缺少依赖会报配置错误。零费用预览：

```sh
npm run web:build
WORK_THREADS_ENABLED=true WORK_JOBS_ENABLED=true npm run web:preview:offline
```

预览只使用新临时数据与本机模拟模型。先在“工作主题”创建主题，再回对话页提交文字。日常启动器不会从 `.env` 读取这些开关；本轮没有启用正式环境。

每个工作只处理本次显式输入，不继承 Chat 历史或主题关联，不读取 Memory 正文、不加载 Skill、不联网、无工具，不自动继续或保存记忆。输入最多 14 KiB（按 UTF-8 字节计），实际模型请求最多 32 KiB，单次模型请求、最多 4096 输出 token，沿用 `EXECUTION_TIMEOUT_MS` 超时。普通聊天继续走原 Chat/Guard，新增 Router 模型调用为 0；选择主题不会自动推进关联 Goal。

后台工作与原 Task/Goal 共用一个执行门，领取时让前台、到期 Task 和已就绪 Goal 优先。已运行工作不抢占，慢工作仍可能延迟之后到期的提醒。排队取消不建 Run；运行中取消先结束提交资格，再中止临时 Session，迟到结果不能覆盖取消，执行门等 Session 结束才释放。重启保留 queued，running 与对应 Run 一起恢复 interrupted；失败、中断、取消及已完成工作均不自动重跑。关闭开关不领取 queued，再次开启后处理原已提交请求。

结果、错误和用量沿用原 Run。通知失败只记 `deliveryError`，结果仍可从工作详情查看，不重跑模型；没有新增通用 Outbox 或必达保证。工作列表及每主题列表只显示最近 100 项，无分页。后续补充材料需明确新提交；本批没有自然语言模型路由建议、联网或并行 Worker、订阅及链式召回。实际离线证据见[2A交付记录](docs/evaluations/router-worker-mvp.md)。

## 路由建议 2B（默认关闭）

同一对话输入区可选择“路由建议”，先显示本次完整原文、主题/对象建议或澄清。只有当前建议的明确确认才创建纯文本WorkJob；成功形成建议不代表已排队或完成。普通聊天和显式“后台处理”不增加Router调用。

`WORK_ROUTING_ENABLED=false`，仅支持本机 `--web-ui`，依赖 `WORK_THREADS_ENABLED=true`、`WORK_JOBS_ENABLED=true`。三个开关只接受true/false，日常启动器不会从.env读取这些开关。可先用独立临时数据与固定模型检查：

```sh
npm run web:build
PREVIEW_SEED=true WORK_THREADS_ENABLED=true WORK_JOBS_ENABLED=true WORK_ROUTING_ENABLED=true npm run web:preview:offline
```

该预览会创建两个合成主题和一个合成提醒，假Key/数据均属临时空间。模型输出是固定桩，不能据此判断真实路由准确率；不连接收费模型或Tavily/GitHub。

每次建议最多一次模型HTTP、512输出token、10秒绝对超时，无自动重试或回退Chat。原文最多14 KiB UTF-8；候选最多20主题、所选主题20个Goal/Task、8 KiB元数据，实际HTTP body最多32 KiB；超限要求缩小范围，不截断。候选不读取Memory正文、Session或原成果。

编辑原文/选择会让当前建议失效并请求持久撤销；未收到服务端确认时显示“撤销待确认”。刷新只恢复视图和当前绑定，不补模型或自动确认；其它历史只读，已有Job收据仍保留。Task/Goal/chat建议的“原文放回聊天输入框”只回填原文，需用户再发送，由原Guard判断；不生成展示ACK或Grant。普通Chat仍限10000字符，超出时保留全文并提示编辑。

目前受控API为 `openai-completions`、`openai-responses`、`azure-openai-responses`、`anthropic-messages`；其余明确拒绝建议，不暗换模型。实际HTTP仅验过兼容端点的本机模拟，其余白名单仅核对SDK源码，真实模型语义/手机/长跑未验。建议默认继续关闭，工程与浏览器证据见[2B评估](docs/evaluations/work-router-2b.md)。

## V3.0：可手动继续的长期目标（默认关闭，电脑核心验收通过）

V3.0.1只做Batch5定点收尾：明确的正式计划步数会在草稿/审批时核对；“一项安排”拆成多个正式Step时保留完整草稿并要求确认口径，不静默裁剪。多重或二选一指代只澄清。详见[离线修复报告](docs/evaluations/v3.0.1-closeout.md)。用户随后批准[最小真实复验方案](docs/evaluations/v3.0.1-live-retest-plan.md)，专用Console入口落实16次/2元及32KiB限制后，实际14次/0.605440元预留即停服；数量和取消局部通过，自然暂停失败，暂不能完整收尾，见[真实复验报告](docs/evaluations/v3.0.1-live-retest.md)。本轮已结束，旧48/5入口不适用，不自动使用剩余额度。

`GOAL_ENABLED` 默认 `false`，只接受显式 `true`/`false`。关闭时不注册Goal工具/提示、不启动Runner，不领取已有ready目标；数据不删除，启动时仍做原有保守崩溃恢复。仅在独立的 `DATABASE_PATH`、`SESSION_DIR`、`MEMORY_DIR` 测试进程中设 `GOAL_ENABLED=true`；专用Batch5启动器会自动开启，正式.env无需修改。该开关与Formation相互独立。

Batch 1–4 已接通 Goal/Plan/Step/Execution、独立 GoalRunner、受控自然语言入口与自动化生命周期。每次明确创建或继续最多执行一个纯文本片段，Checkpoint 与 Run、步骤、目标状态同一 SQLite 事务提交，随后等待用户。旧 Task 仍是一次性提醒；Goal 不使用 Memory 或聊天历史保存进度。没有新增依赖。Batch5按用户调整在电脑Console完成真实模型核心闭环，实际48请求、保守预留2.337244元后停服。完整清单未全通过：学习计划粒度有偏差，暂停指代仅离线修复、未收费复验；飞书/手机本轮未复测。结果与失败见[当前报告](docs/evaluations/v3-batch5-acceptance.md)。正式用户服务及数据不在本次操作范围。

审查后先使用**全新隔离路径**运行，不能复用正式数据库、Memory 或 Session。在终端当前进程设置 `DATABASE_PATH`、`MEMORY_DIR`、`SESSION_DIR`（PowerShell：`$env:DATABASE_PATH='E:/AgentWork/acceptance/v3-local/agent.db'`，另外两项分别指向同一新目录内的 `memory`、`sessions`），保持 `MEMORY_FORMATION_ENABLED=false`。明确设 `GOAL_ENABLED=true` 后运行 `npm run build`，再用 `npm start` 或 `npm start -- --feishu`；模型和飞书凭据只在本机配置。收费验收使用[有累计预算的专用入口](docs/evaluations/v3-live-acceptance-plan.md)，普通启动不限制账单。自动测试无需Key，均使用模拟模型。

可用话术：“帮我逐步准备 Agent 面试”“查看长期目标进度”“批准这个计划并继续一段”“继续之前的面试准备任务”“暂停那个学习计划”“取消面试目标”“确认面试目标已完成”。不需要UUID；同类目标多个时选宿主清单编号。等待中的学习反馈请连同“继续一段”明确提交，避免把普通聊天误作推进授权。

“确认”只批准已经成功显示且五分钟内仍有效的计划，**不执行**；“批准并继续一段”才产生一次执行授权。计划可说“面试计划先补 Agent Loop”，或给出完整的新步骤、说明、产物和验收条件；宿主先展示草稿，再批准。旧计划和成果保留。运行中调整先登记暂停并中止旧片段，停止后先继续恢复审批界面，再批准新草稿。改变整个目标范围请创建新Goal，当前不原地改写objective。

暂停/取消运行中的目标先显示“正在停止”，SDK结束后才落 paused/cancelled；迟到结果不能推进。模型失败/中断进入 blocked，不自动重试；核实后可明确“重新生成面试任务这一段”，可能再次计费。uncertain/invariant_violation必须人工核对，不能强行继续。查看进度只读取已提交成果，通知失败不重新执行；查看仍通过交互模型路由，可能有主模型及隔离意图解析消耗，没有后台推进请求。

手动Goal输入快照最多14 KiB，加Memory最多2 KiB；目标/反馈、计划和摘要/问题超预算先阻塞，不悄悄截断条件。较长成果只提供明确标记的摘录及原Checkpoint引用，完整正文仍在数据库。每段临时Pi Session、零工具、输出最多4096 Token、沿用执行超时；不支持Shell、Browser、MCP或外部写工具。新增主动策略见下节。

## V3.1–V3.3：显式策略下的时间、观察及有界推进

代码和本地模拟验收与真实模型/飞书验收分开。原V3.0.1暂停与收据解释缺口仍开放。设计与数据迁移见[主动执行设计](docs/designs/v3-proactive-goals.md)，实际检查见[验证报告](docs/evaluations/v3-proactive-validation.md)。全部新增表与V3.0数据兼容，不改变Task一次性、Memory写入或Pi Loop。

`GOAL_ENABLED=false`、`PROACTIVE_ENABLED=false` 均为默认值。仅在**新的隔离目录**配置两者为true；设置经核对的 `PROACTIVE_INPUT_CNY_PER_MILLION` / `PROACTIVE_OUTPUT_CNY_PER_MILLION`，未知或0时不执行自动片段。宿主每日调用、执行、人民币预留及总次数/总预留使用 `.env.example` 中的独立上限；每条策略还需更小的明确上限。每日按UTC，全局账本跨重启与策略保留，失败或缺失usage不退预留。费率是用户批准的上界，预留不是供应商账单硬保证。

先按前节创建Goal、查看并批准正式Plan，保持waiting_user；再用 `/policies`、`/policy show ID` 查看策略和审计。审批不交给模型，Console直接输入一行完整JSON（替换真实隔离Goal的ID/revision/planRevision及未来有效期）：

```text
/policy approve {"goalId":"<隔离Goal ID>","expectedGoalRevision":3,"planRevision":1,"expiresAt":"2027-01-01T00:00:00.000Z","capability":"text_only","schedule":{"kind":"daily","time":"09:00","timeZone":"Asia/Shanghai"},"limits":{"segmentsPerTrigger":1,"dailyExecutions":2,"dailyModelCalls":2,"totalExecutions":5,"dailyBudgetCny":0.2,"totalBudgetCny":0.5}}
/policy pause {"id":"<策略ID>","version":1}
/policy revoke {"id":"<策略ID>","version":2}
```

单次未来改用 `schedule={"kind":"once","at":"2026-12-01T01:00:00.000Z","timeZone":"Asia/Shanghai"}`；每周用 `{"kind":"weekly","time":"09:00","timeZone":"Asia/Shanghai","weekday":1}`（周一为1）。IANA当地时间的DST重复/不存在日期跳过，停机错过多个周期只补一个；不回放旧周期。修改或恢复策略采用明确撤销、按当前Goal版本重新批准。Goal暂停、取消、改计划、手动继续使旧版本失效；失败/中断、计划审批、需要反馈或已到计划尾部也停止，不能自动批准计划或确认Goal完成。

观察策略替换schedule为 `{"kind":"github","repository":"fiction/agent","branch":"main","intervalSeconds":300}`。只读公开GitHub API，首次建基线不触发；后续新提交与compare差异生成持久Observation，批次唤醒一次。最短60秒，响应64KiB、变化快照10KiB、提交窗口20条；窗口断裂、force push、过大或读取失败保留游标并退避，需人工核对后重批基线。差异/commit message只作低信任资料，不授予工具或长期Memory写入。测试不会访问真实GitHub，生产适配器只有明确审批该策略才发出读取。私有仓库认证不在本版范围。

每触发允许1～5个片段，GoalRunner每次tick最多执行一段。仅上段complete、明确 `needsUserFeedback=false`、还有已批准步骤且所有限额有效才允许续段；缺失该字段默认停下。自动Goal的通知Outbox与Checkpoint同事务提交，最多3次发送尝试，失败退避30秒/60秒，重启可恢复；通知可能迟到、重复或最终失败，不能保证exactly-once或必达。不会因通知失败重跑模型。延迟通知是执行时快照，审批/继续前重新查看当前Goal。

无需Key/正式数据的本地演示：`node --import tsx --test tests/goal-policy.test.ts tests/github-observer.test.ts tests/goal-autonomy.test.ts`。这会运行模拟时钟、真实SQLite、原版Pi SDK、本机模型及GitHub HTTP桩，演示A定时、B观察、C有界持续推进及故障恢复；临时目录由测试创建并清理。不要将其称为真实模型或手机验收。策略配置目前仅有Console确定性命令，尚未开放自然语言/飞书策略审批。

专项回归：`node --import tsx --test tests/goal-*.test.ts`。只读核对隔离库：`node --import tsx scripts/audit-goals.ts E:/AgentWork/acceptance/v3-local/agent.db`；不建表、不修复、不输出正文。完整[设计](docs/designs/v3-persistent-goals.md)、[自动化证据](docs/evaluations/v3-mvp-validation.md)、[Batch 5手机验收方案](docs/evaluations/v3-live-acceptance-plan.md)及最新[STATE](docs/STATE.md)分别记录实现和未验证范围。

## S0：Pi 原生 Skills（默认关闭）

`SKILLS_ENABLED=false`。开启后只加载专用 `SKILLS_DIR`（默认 `<DATABASE_PATH>.skills`）内 `approved.json` 明确批准、内容Hash匹配的标准包，不扫描全局Pi/Skills/Extensions/MCP。复用Pi1.3.0的发现、解析、目录、read格式化及原版Agent Loop；没有自建Skill解析器。

只有声明 `disable-model-invocation:true` 的特殊包，需要当前用户独立发送明确调用句，例如 `请使用 Skill agent-notes`、`调用 agent-notes` 或 `/skill:agent-notes`，才允许本轮受限read。仅提到ID、否定、引用、假设、疑问、带其他说明的复合句及历史调用均不授权；不确定时会返回格式提示。此判断只允许读取，不保证模型选择或已展开Skill，Chat不因此开启原生命令展开；`/skill ID`仍只是宿主查看命令。两份产品包未声明此标志，保留正常自动选择。修复与边界见[报告](docs/evaluations/s0-invocation-fix.md)；[Console真实体验方案](docs/evaluations/s0-console-live-experience-plan.md)尚未执行。

首批仅 [agent-notes](skills/agent-notes/SKILL.md) 与 [interview-practice](skills/interview-practice/SKILL.md)：整理已提供资料、面试练习。只消费给定文字，不自行上网或写文件/Memory。自动化演示仅用新临时目录、本机模拟模型和真实SQLite，无需Key、不读.env：

```sh
node --import tsx --test tests/skills.test.ts tests/goal-skills.test.ts tests/goal-skills-integration.test.ts
```

供后续自行检查的安装步骤：先 `npm run build`；在**停服且此前不存在的隔离目录**中复制标准包，再由宿主批准。例如PowerShell：

```powershell
New-Item -ItemType Directory -Path './data/s0-demo/agent.db.skills'
Copy-Item -LiteralPath './skills/agent-notes' -Destination './data/s0-demo/agent.db.skills' -Recurse
Copy-Item -LiteralPath './skills/interview-practice' -Destination './data/s0-demo/agent.db.skills' -Recurse
node dist/skills-admin.js ./data/s0-demo/agent.db.skills agent-notes
node dist/skills-admin.js ./data/s0-demo/agent.db.skills interview-practice
```

该宿主命令只批准已复制包并生成Hash清单，不是模型工具，不下载、不执行安装脚本；批准不启动Agent。含批准参考文件的包只限Chat，命令末尾加 `chat-only`；S0 Goal包必须自包含、只有SKILL.md且不超过4096字节。需要脚本、执行工具或其他资源的包明确拒绝。

后续启动自己的隔离验收进程时，临时环境变量设置 `SKILLS_ENABLED=true`，并将 `DATABASE_PATH`、`SESSION_DIR`、`MEMORY_DIR`、`SKILLS_DIR` 指向同一全新验收目录的各自专用路径，保持Formation/Goal/Proactive关闭，先核对 `/skills`、`/skill agent-notes`。真实模型对话另行安排，本轮未执行这些真实启动或收费步骤；不要直接在正式目录照抄开启。

Chat自动匹配目录并通过受限原生read按需读取正文和references：只允许已批准路径，拒绝穿越、链接/junction、硬链接、分页、脚本与任意文件。每轮最多2次read，Session正文累计8192字节，重复读取也计额度，原生Session custom entry跨重启保留。额度不足只返回Skill拒绝收据，普通对话和旧工具仍可用，不自动清Session或重置额度。开启Skills时每轮主Loop与辅助解析/Memory改写共用最多8次模型HTTP，实际payload最多65536字节，无自动重试；它不是供应商账单硬上限。

手动Goal可说“帮我逐步准备面试，使用Skill interview-practice”，也可让草稿在批准集合提议skillId。宿主展示每步ID/version/完整Hash及无绑定项，必须成功送达并审批；“给面试当前步骤改用Skill agent-notes”或“移除面试当前步骤的Skill”只生成新草稿，再批准。模型不能指定路径/可信Hash，已完成Step和旧成果不改。启用Goal仍需独立GOAL_ENABLED与用户单次授权。

主动Goal还需PROACTIVE_ENABLED及显式Policy/Grant：仅按审批Plan固定Skill，仍为text_only、零工具、每片段一次模型请求。宿主通过原生 `/skill:name` 在时间前缀之前展开冻结副本；联网前逐字核对名称、位置、正文、本轮Goal输入及Hash。执行后也核对未禁用/变更，失败保守停止。Execution/inputHash记录实际Skill原文/版本/Hash，Checkpoint和通知仍走原事务，通知失败不重跑。

升级/停用：停服后修改受管包或清单。更新必须重新运行宿主批准命令并重启，旧Goal不能自动换到新Hash，须改选并重批Plan。`approved.json` 中 `enabled:false` 表示禁用；已有绑定无法使用时Goal阻塞，不创建新Execution。历史Chat正文、Run和Session不删除，历史内容不授予当前工具权限。无运行中热安装/启用接口。

仓库中的agent-notes现为1.0.1，明确可整理本轮经宿主授权工具取得的正文，仍不授予网络或文件权限。已有受管1.0.0及批准记录不会自动更新；选择升级时按上述流程重新审阅批准，旧Plan绑定不得静默替换。收据归属、异步结果及描述调整的离线证据见[定点修复报告](docs/evaluations/a2-b1-offline-fix.md)；真实模型自动选择和收据理解仍待复验。

实现与故障边界见[设计](docs/designs/skills-tools-architecture.md)与[本轮验证](docs/evaluations/s0-skills-validation.md)。真实模型的自动选择/遵循质量、真实主动执行、飞书及长期运行尚未验收；V3.0.1自然暂停和收据解释原始失败继续保留。S0没有Shell、Web、Browser、MCP、Sandbox、Computer Use或外部写工具。

## T1 / T2-A：独立 Skills 试用与 Chat 只读资料（默认关闭）

T1沿用现有两个Skill、宿主批准清单和原生目录/read，不新增安装系统。T2-A增加独立的`LOCAL_FILES_ENABLED=false`与`LOCAL_FILES_WORKSPACE`，复用Pi1.3.0公开的原生read/ls ToolDefinition及可注入文件操作。仅Chat可用；Task/Goal/Proactive仍无文件工具，不提供Shell、写入、grep/find或任意目录扫描。

资料须先复制到独立目录、由操作者用`node dist/local-files-admin.js <绝对资料目录> notes/a.md`批准；不接入整个个人目录或代码仓库。当前消息首行明确`本次允许读取资料文件：notes/a.md`，可附`#L1-L20`；列目录另需`本次允许列出资料目录：notes`。宿主配置、批准清单与本轮范围取交集，目录清单不授权读取。原生read的分页与文本呈现保持不变，宿主另限路径、文件身份/Hash、链接、容量和当前授权；两个功能共用唯一read名及原Chat请求预算。

完整配置、额度、隔离试用及未来飞书人工切换步骤见[T1/T2-A操作说明](docs/t1-t2a-trial.md)。配置示例只创建虚构资料并批准两个现有包，不启动Agent、不读取.env；本轮仅模拟验证，未更改正在使用的飞书实例。普通Chat无整轮人民币硬上限；正文会发给模型并进入原生Session，审计事件只保存相对路径/字节/拒绝原因。

## T2-B / T3：资料搜索与确认后输出（默认关闭）

`LOCAL_FILES_SEARCH_ENABLED=false`；显式开启且已有T2-A批准副本时，Chat增加find/grep。find使用Pi1.3.0公开自定义glob与Node匹配；grep因锁定SDK无法阻止rg，仅在批准的小文件集合内做有界字面量匹配。均不下载/运行rg/fd，与read/ls共用4次调用、16KiB返回及128KiB本轮读取预留。

独立`LOCAL_FILES_WRITE_ENABLED=false`与`LOCAL_FILES_OUTPUT`。仅宿主初始化的全新平铺输出目录内md/txt，不与资料、源码或应用数据重叠。Pi原生write先在内存生成完整内容，edit先在内存精确编辑并生成原生Diff；展示内容/变化和Hash后等待用户。当前用户在唯一有效预览后直接回复“确认允许”或“确认保存”，宿主自己关联ID/Hash，核对身份、成功投递、5分钟TTL及旧文件Hash后一次提交，不调用主模型。多项或审批视图歧义不自动选择，其他普通Chat会结束短确认引用；原`确认文件操作 <ID> <Hash>`命令仍兼容。创建绝不覆盖，编辑冻结已批准内容并原子替换；未知文件/SQLite窗口不重放。账本在原应用库的file_operations中，事件只记元数据，预览与成果会持久化。

仅前台Chat开启，后台Goal/Task/Proactive仍无工具。读、搜索和写入分别授权，不能借Skill/资料正文或模型声称“已批准”执行。未开启写入时白名单无write/edit。配置和精简未来人工步骤见[T2-B/T3说明](docs/t2b-t3-trial.md)。本轮仅本机模拟验证，未切换现用飞书或调用真实模型；普通Chat仍无整轮人民币费用硬闸。

## S1-A：Chat 受控只读 Web（默认关闭）

`WEB_READ_ENABLED=false`，独立于Skills/Goal/Proactive；开启开关也不能代替当前用户读取许可。首批宿主目录仅包含Pi1.3.0的“Pi Skills 文档”和“Pi SDK 文档”，资源的固定HTTPS地址、版本、启用状态及目录Hash由代码维护，不支持模型提交URL、在线安装或热更新。目录Hash约束来源配置；抓取后的contentHash另行记录正文，不把网页内容当已批准指令。

在已明确开启的新隔离进程中，可说“请读取 Pi Skills 文档，并总结加载流程”或“读取 Pi SDK 文档”。无需知道内部ID。不能确定资源或用途的表达先展示具体地址、范围与用途，成功投递后5分钟内单独回复“确认读取”或“同意读取”才会读取。否定、引用、假设和任意URL不授权；多资源须澄清，其他复合表达保守确认。只看见模型说“已读取”不算证据，应核对web_read_calls及下一模型请求的ToolResult。

每个Run/许可最多一次实际GET；HTTP错误、超时、模型失败或发送失败都不自动重取。DNS全部地址须合格，固定IP和TLS校验在HTTP发送前完成；不跟重定向、不继承代理、不发送Cookie/鉴权头或用户提问，只接受UTF-8公开纯文本/Markdown。单次10秒、头部8KiB、响应32KiB，宿主UTC日20次尝试/640KiB预留，失败不退款，跨重启保留。读取与写操作不在同轮混用，切换Web界面后旧审批须重新查看。

Chat的Skills/Web共用每轮8次模型HTTP上限，含辅助解析；Web正文在原生Session内累计8KiB，超额只拒绝新获取，普通聊天仍可继续。完整合法正文保存在SQLite快照，提供给模型的节选明确标注。既有正文仍保留在Session，关闭开关不会清除历史。Web不写Memory，不向Task/Goal/Policy开放工具；已有资料的Goal绑定由S1-B独立审批。

安全的本地演示无需Key、不加载.env、不访问真实站点：

```sh
node --import tsx --test tests/web-read-service.test.ts
node --import tsx --test tests/web-chat.test.ts tests/web-read-recovery.test.ts tests/web-process-recovery.test.ts
```

第一步验证本机TLS、模拟DNS和网络边界；第二步用真实SQLite/原版Pi/本机模拟模型及HTTP演示自然授权、展示后确认、正文进入下一请求、重启/取消/强杀恢复及预算。产物只在新临时目录；测试私钥仅用于虚构域名，不安装系统证书。正式运行依旧需要另行配置模型和批准读取，**本轮没有真实站点、收费模型、飞书或手机验收**。实现、失败记录及双平台结果见[报告](docs/evaluations/s1-web-validation.md)和[设计](docs/designs/s1-readonly-web-tools.md)。

升级会在原SQLite增量创建web_read_calls，即使Web开关关闭也会创建表；正式升级前需停服备份，本轮未操作正式库。隔离库的只读核对SQL：

```sql
SELECT runId,resourceId,catalogHash,status,reservedBytes,createdAt,finishedAt,
       json_extract(snapshotJson,'$.contentHash') AS contentHash,
       json_extract(snapshotJson,'$.bytes') AS actualBytes FROM web_read_calls;
```

## S1-B：把已获取资料交给 Goal

在新的隔离环境开启Goal，先取得同身份/渠道成功读取并投递的固定资源快照，再创建目标并查看初步计划。例如目标已明确使用Skill interview-practice后，可说：

```text
将已获取的 Pi Skills 文档全文绑定到银杏阅读计划第1步
将最近读取的 Pi Skills 文档第1至8行绑定到银杏阅读计划当前步骤
批准银杏阅读计划并继续一段
```

前两句只生成待批准草稿；核对来源、时间、版本、Hash及全文/行范围后才批准。每步最多一份Web资料，可与一个Skill同时绑定，二者不相互授权。多份来源须明确“最近读取的”；全文超过4096 UTF-8字节拒绝，只有用户明确行范围才节选。现有Goal总输入及实际请求体上限继续生效，组合超限在模型发送前阻塞。

绑定进入Plan Hash，领取时冻结文本到Execution inputHash；Goal零工具、一次模型请求、不联网。快照缺失/损坏、跨身份/渠道、资源禁用/错版本或Skill变化保守阻塞，不用新网页或新包替代。变更重新展示审批，完成Step、旧Plan、Checkpoint不改写。Web许可TTL不延伸到未来获取；关闭网络开关不抹去已批准资料，也不自动刷新。

“暂停那个学习计划”仍须唯一、有效、成功投递的视图；类别泛称可与标题不同，具名条件仍取交集。用户和原生Session接收真实宿主状态收据，不增加纠错模型调用、不把后台成果复制到交互Session。历史真实失败仍待另行真实复验。

无需Key、.env或外网的完整演示：

```sh
node --import tsx --test tests/goal-web.test.ts tests/goal-web-reliability.test.ts tests/goal-receipt-context.test.ts
node --import tsx --test tests/integrated-console-acceptance.test.ts
```

第一条覆盖完整链路、策略预算及暂停/撤销/强杀/数据库/通知故障，第二条只验证未来验收入口的离线限额。实现及失败见[工程报告](docs/evaluations/goal-web-milestone.md)；统一真实方案建议32次/6元和一次固定Web GET，**尚未授权执行**，见[冻结方案](docs/evaluations/integrated-console-live-plan.md)。正式配置、数据、飞书/手机及S2权限不在本轮范围。

## V2.1b 候选形成（默认关闭）

正式 Formation 未开启；隔离验收仅使用临时虚构数据。审查并修复已发现的问题后如决定试用，请先备份并使用独立的 `DATABASE_PATH`、`SESSION_DIR`、`MEMORY_DIR`，再在本机配置：

```dotenv
MEMORY_FORMATION_ENABLED=true
# 示例是保守费率上界，启用前核对自己供应商的实际价格并调整，单位：元/百万 Token。
MEMORY_FORMATION_INPUT_CNY_PER_MILLION=10
MEMORY_FORMATION_OUTPUT_CNY_PER_MILLION=20
```

运行 `npm run build`、`npm start -- --feishu`（Console 仍可用）。只分析开关开启后的新成功聊天；不扫描旧 Session。正常回复发送尝试结束、前台空闲约10秒后提取：每窗最多3条消息、一次请求、最多3条候选；无工具、无历史、最多5条相关且非敏感的既有事实参考。输入以2000 UTF-8字节控制，输出512 Token，10秒超时，不自动重试。过长消息整句跳过，不能截掉否定或限定词。

体验验收请只用虚构事实：

1. 说“我以后开发虚构 Agent 项目主要使用 TypeScript”，等待正常回复后空闲约10秒。此时正式 Memory 应没有新记录。
2. 问“有什么建议记住的吗？”看到宿主固定清单后说“第一条记下来”。每轮只批准一项；没有清单、编号不符或过期会拒绝。
3. 在另一条虚构事实上测试“第二条先不要”或“这些先不保存”。同一规范化原话拒绝后不再推荐；完全不同的改述仍可能再产生建议。
4. 测试“把第一条改成‘我主要使用 TypeScript 和 Go’再记”：先显示新草稿，**再回复确认**才写入。涉及旧事实会先显示旧值；多目标先按旧事实列表澄清，再确认。
5. 停止服务后换一个全新 `SESSION_DIR`，保持相同数据库和 Memory 目录，询问批准的虚构事实；核对 `memory_context` 的 ID/version，而不只看“我记得”的文字。
6. 创建更新候选后，通过原有明确记忆工具更新/删除正式知识，旧清单应失效，不能恢复旧值。没有可确认目标时用原有明确记忆操作澄清，不自动新增矛盾事实。

首版草稿保留完整原话，避免模型把“Python用得少了”改成“完全不用Python”；不是成熟语义摘要器。疑问、假设、引用、临时信息和常见敏感内容保守跳过，可能漏掉有价值信息。候选仅在应用数据库的 `memory_formation_jobs` / `memory_candidates`，不写 Markdown、不进普通 Memory 检索或 Pi Context。拒绝不写 Memory；提示仅附在下一条正常回复，每个渠道审批空间每天至多一次，不额外主动发消息。

20次/UTC日、0.2元/UTC日的形成预算跨渠道共享。按费率上界和输入字节/输出上限预留，中断不退预算；示例费率下不保证每天能提取20次。这是本地保守限额，不是供应商账单硬上限；审批解析及正常聊天不计入形成预算。实际可见用量在 `model_calls`（`purpose=memory_formation`、jobId），排队、预留、失败在形成表和 `run_events`；中断请求可能有未知用量。

候选7天过期，运行中清理正文/引文/旧值，停服期间在下次开启时清理。最小 Hash/状态保留用于抑制重复；SQLite空闲页、WAL、Run、Session及备份不保证擦除。Memory任意变化使尚未审批的旧候选失效，这是保守取舍。提取中崩溃不重试；批准前标 applying，重启只核对匹配落盘结果，无法确认则 blocked，需人工查状态，不盲重放。

数据默认在项目私有数据目录，Git已忽略。Mac/Linux沿用0700/0600；Windows chmod 不代表 ACL 隔离，需用当前账户的私有目录并自行核对访问权限。已在隔离数据中进行小规模真实手机 Formation 验收，未验证 Windows ACL、原生Mac补跑或长期形成质量；收费语义小样本与模拟机制结果分别记录。验证命令：`npm run typecheck`、`npm run build`、`npm test`、`npm run eval:memory`、`npm run eval:formation`。详细边界和结果见 [设计与实现](docs/designs/v2.1b-memory-formation.md)、[离线报告](docs/evaluations/v2.1b-formation-review.md)及[真实验收](docs/evaluations/v2.1b-formation-live-review.md)。验收原始报告已落盘，收费脚本拒绝覆盖或再次消费本轮额度；离线复核使用 `node --import tsx scripts/review-formation-live.ts`，不联网。

## 环境与安装

- Node.js **24.15.0 或更高版本**，npm。本项目使用 Node 内置 `node:sqlite`，不同 Node 版本可能显示 SQLite 实验性提示。
- 已锁定 `@earendil-works/pi-coding-agent@1.3.0`，SDK 自身要求 Node >=22.19.0；本项目选择更高的运行基线。
- 一个支持的模型 API Key。只在自己的机器上设置，不要贴进聊天或提交到 Git。

```sh
cd '/Users/drb/code/Persistent Personal Agent'
npm ci
cp .env.example .env
chmod 600 .env
```

用本地编辑器编辑 `.env`：

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=gpt-4.1-mini
LLM_API_KEY=<REDACTED>
USER_TIMEZONE=Asia/Taipei
DATABASE_PATH=./data/agent.db
POLL_INTERVAL_MS=1000
EXECUTION_TIMEOUT_MS=120000
```

将 `<REDACTED>` 替换为自己的 Key。Provider 和 Model 必须匹配 Pi 的模型目录，详见 [Pi 模型文档](https://pi.dev/docs/latest/models)。默认模型是配置示例，不代表已验证你的账号有权限。

如果使用 **OpenAI Chat Completions 兼容端点**，添加：

```dotenv
LLM_BASE_URL=https://api.example.com/v1
LLM_MODEL=your-model-id
LLM_API_KEY=<REDACTED>
```

配置 `LLM_BASE_URL` 时使用独立的兼容 Provider，忽略 `LLM_PROVIDER`。端点应包含供应商要求的基础路径（通常为 `/v1`），不要填写 `/chat/completions`。自定义端点必须支持流式 Chat Completions；交互任务管理还需要支持 function calling。此模式暂按 32K 上下文、最大 4096 输出 token 配置，模型费用记录为 `null`，不伪报为免费。

硅基流动配置示例（2026-10-20 已用本机账号真实验证）：

```dotenv
LLM_BASE_URL=https://api.siliconflow.cn/v1
LLM_MODEL=deepseek-ai/DeepSeek-V4.1-Flash
LLM_API_KEY=<REDACTED>
```

使用现有兼容 Provider 即可，无需改 Pi SDK。应用读取 `LLM_*`，本机另存的 `guiji_*` 不会自动成为活动配置。本次已在忽略的 `.env` 中切换，原 DeepSeek 配置保存在 `DEEPSEEK_PREVIOUS_LLM_*` 供本机回退；实际文件权限0600，凭据不提交。运行中的进程保留旧环境，正常停止再启动后生效，原任务库与会话目录保持不变。账号可用模型与参数参见[硅基流动官方接口文档](https://docs.siliconflow.cn/docs/api/chat-completions-post)，本次真实验证范围见 STATE。

针对官方 `api.siliconflow.cn`，宿主通过 SDK 公开模型参数显式发送 `enable_thinking=false` 和 `max_tokens`，与既有 `thinkingLevel=off` 对齐。仅声明模型 `reasoning=false` 不会自动关闭供应商默认推理；通用适配默认的 `max_completion_tokens` 也不等同于该端点文档的 `max_tokens`。其他兼容端点保持原有参数。该修复已通过临时数据真实模型闭环及本机真实飞书 Project Memory 保存、全新 Session 检索、更新和删除验收，具体证据见 STATE；不保证供应商每次延迟或通知送达。

## 运行

```sh
npm run typecheck
npm run build
npm test
npm start
```

开发模式：`npm run dev`。只显示帮助、不启动数据库：`npm start -- --help`。

终端支持普通对话，例如：

```text
明天上午9点，帮我写一段早安问候
查询我的任务
取消刚才创建的任务
```

确定性命令直接调用 Task Service，不消耗模型请求：

```text
/create 10秒后 | 写一句今天的学习提醒
/create 明天上午9点 | 写一段早安问候
/create 2026-12-01T09:00:00+08:00 | 写一段月初计划建议
/tasks
/task <完整任务ID>
/cancel <完整任务ID>
/runs
/quit
```

`/tasks` 最多返回100个任务；`/task` 查看指定任务的结果、错误、模型用量和执行事件。`/runs` 查看最近100次执行，包括对话。自然语言操作是否被正确理解仍取决于模型；需要精确控制时使用命令，任务创建成功以返回的任务 ID 和 `dueAt` 为准。

V2.0.2 以自然语言为主要入口，不需要 UUID 或固定命令。例如：

```text
过两分钟记得叫我去厕所。
帮我设个提醒，明天上午9点开会。
晚上8点记得提醒我给朋友打电话。
刚才那个提醒不用了。
把明天早上开会的提醒取消。
我明天还有哪些提醒？
```

明确的普通提醒直接执行；“明天早上”缺少具体几点会询问，“等我洗完澡”需要可观察触发条件或具体时间，不能假装能够检测。时间由宿主按用户时区解析，不接受模型凭空生成的 UTC。修改已有提醒尚未开放，不会用取消后新建冒充编辑。

取消由宿主查 SQLite 并匹配归属、内容、时间和 pending 状态。纯“刚才那个”使用最近创建/明确显示的宿主引用；同时点名内容和时间时，这些约束必须保留，不能被指代覆盖。多个可能目标会列出固定编号，回答“第二个”即可。编号和待确认内容有效期5分钟，重启后保留有效引用，但不重放操作；过期或对象已执行时需重新查询。Console 的斜杠命令只作为调试入口保留。

宿主独立核对“第二个、2号、第２项”等1–100的常见序号，不直接信任解析器的 position；不一致时先澄清。“刚才”和“最新”也须有本轮原文依据，不能互换。引号中的名称/示例不提供引用权限；“倒数第二个”或多个不同序号等复杂选择先要求明确。解析完成后再次检查选项/确认是否过期，不增加模型调用。

手机复测建议：创建一个两分钟提醒→说“刚才那个不用了”；创建两个相似提醒→取消该类提醒→根据宿主编号选一个；查询明天任务→确认没有新增；明确保存一个虚构偏好→更新/删除。核对实际状态而非只看模型说成功。本机真实模型探测不等于飞书手机送达验收。

## V1.2 交互 Session 保存与恢复

使用原版 Pi SDK 1.3.0 的 `SessionManager.open()`，不自行序列化聊天历史。启动时打开宿主指定的固定文件；文件不存在时创建，存在时由 Pi 重建对话上下文。收到新的已授权消息后才调用模型；恢复不会续跑旧请求、重放工具或重新执行已完成任务。V1.2 升级前仅在内存中的对话无法追回，从本版启动后的对话开始保存。

默认位置：

```text
<DATABASE_PATH>.sessions/<会话身份的 SHA-256>/chat.session.jsonl
# 默认 DATABASE_PATH=./data/agent.db，即 ./data/agent.db.sessions/...
```

可选设置 `SESSION_DIR=./data/sessions`。相对路径以启动工作目录为准；保持原来的数据库与 Session 目录即可恢复。每份数据库使用自己的 Session 目录，不要用多个不同数据库的进程共享同一目录；宿主对数据库和 Memory 目录分别持有独占锁。

- Console 使用固定的 `console` 身份；飞书使用当前 App ID 与白名单 open_id 生成身份，同一用户在 Mac/iPhone 的该应用私聊共享上下文。身份由启动配置生成，模型和未授权消息不能指定。
- Console 与飞书分别保存；更换 App ID 或白名单用户创建另一份 Session。仅轮换密钥、保持身份与目录不变时继续原会话。
- 不扫描 `~/.pi`、其他项目或目录中最近修改的会话；加载历史不改变本次启动显式配置的模型、工具白名单或资源加载策略。
- 后台每次任务仍创建 `SessionManager.inMemory()`，不读取交互历史，也不把后台输出写回交互 Session。聊天中创建任务时的工具调用及结果属于聊天记录，仍会正常保存。
- 每个会话子目录权限 `0700`，文件 `0600`，重新打开时收紧权限；`*.session.jsonl` 已被 Git 忽略。凭据与 SDK 设置仍在内存，不作为配置写入 Session。对话和工具结果会保存且未加密，请勿在提示词中发送密钥。
- 无法读取或被 SDK 判定无效的文件会阻止启动，不静默覆盖历史。SDK 容忍部分损坏行，当前不额外校验、修复或保证断电时最后一条记录完整。

正常退出用 Ctrl+C（Console 也可 `/quit`）。Pi 在消息落盘时保存记录，`dispose()` 释放会话；不需要手动导出历史。需要全新对话时，停服后改用一个新的 `SESSION_DIR`，旧目录保留作备份。重启本身不清空历史，也不能解决上下文过长问题。

备份/迁移：先正常停服，再一起复制 `DATABASE_PATH`（如有 SQLite WAL/SHM 一并保留）、整个 `SESSION_DIR` 和 `MEMORY_DIR`；在新位置配置路径和凭据，保持飞书 App ID/白名单身份及目录结构，重新启动。会话打开时显式使用当前工作目录，避免依赖旧机器的目录；此方案尚未在 Linux VPS 实测。

### 真实飞书验收步骤

1. 停止旧实例，执行 `npm run build`、`npm start -- --feishu`，保持原 `.env`；无需新增配置。
2. 发送“我正在开发一个基于 Pi 的 Personal Agent”，再问“我刚才说我在开发什么？”。
3. 创建“两分钟后提醒我喝水”，确认创建成功后 Ctrl+C 正常停服。
4. 重新运行 `npm start -- --feishu`，发送“我们刚才在讨论什么？”，确认模型能接上先前内容。
5. 等待原提醒主动送达，确认只有一次。再继续对话，检查后台生成的提醒内容未作为聊天历史加载。

2026-10-20 用户已确认完成重启测试，重启后仍能记得此前对话，上下文恢复核心场景通过。此次反馈未补充同轮提醒和后台隔离结果，其他场景的证据边界见 STATE。上述步骤保留用于复测；自动化中的模型回答由本地桩生成，只证明上下文传递与恢复机制。

## V2.0：长期 Memory 的使用和验收

不需要更换模型或飞书凭据。保持现有 `.env`，构建后正常启动：

```sh
npm run build
npm start -- --feishu
```

Memory 默认保存在 `<DATABASE_PATH>.memory/`（默认 `./data/agent.db.memory/`）。也可自行在 `.env` 配置专用目录：

```dotenv
# 可选；不配置时跟随数据库，避免调试库误读正式记忆
MEMORY_DIR=./data/memory
MEMORY_CONTEXT_TOKENS=2048
```

```text
<MEMORY_DIR>/
  PROFILE.md             semantic：稳定偏好/画像/事实，多条合并
  projects/<UUID>.md     project：背景/目标/决策/阶段
  episodes/<UUID>.md     episodic：有长期价值的事件/反馈/结果
  procedures/<UUID>.md   procedural：明确确认过的工作经验
  index.db               SQLite 可重建索引及正文缓存
```

PROFILE 和知识文件在首次写入对应类型时创建。四类共用 `memory_search/get/remember/update/forget`，不复制同一事实四份。Project Memory 不承担任务调度；Episodic 不复制全部聊天；Procedural 只是知识，不能执行 Shell 或 Skill。Console 与飞书共享这个单用户 Memory，交互 Session 仍分别保存；换实际使用者应使用新的数据目录。

在飞书自然表达明确的长期记忆意图即可，一次处理一项事实：

```text
记住我比较喜欢中文回答。
以后你要记得我偏好简洁的解释。
你可以记一下，我现在主要用 TypeScript 开发。
记住 Aurora 项目的数据库使用 SQLite，保存为 Project Memory。
把 Aurora 项目的数据库记忆更新为 PostgreSQL。
忘掉 Aurora 项目的数据库选择这条记忆。
```

默认没有“记住”等明确保存要求的普通聊天不提取；显式开启V2.1b后可形成待审候选，仍不能自动保存。类型和 key 可由模型提议，用户不必学习元数据格式。宿主从当前原始请求独立提取事实并核对目标，实质改写先展示待确认正文；用户确认后才写入。多个目标必须澄清，更新/删除继续使用当前版本检查。相同规范化正文去重、同 `(kind,key)` 不同正文要求更新的规则保留；来源 `user_explicit` 关联本轮 Channel/Run，不证明事实客观正确。

安全边界：主模型看到的 Memory、历史对话和工具结果不能授予写权限。写工具调用前，宿主使用一次不含这些数据、没有工具的隔离意图解析，再校验当前消息证据、实际记录和参数；工具调用参数仅作提议，不能扩大已核对的操作。读到偏好不等于有权修改偏好；只有当前明确请求或有效宿主澄清/确认状态可以继续操作。语义解析仍可能出错，不承诺完全免疫提示注入。

成本与延迟：只有一轮首次请求写工具时增加最多1次解析调用（典型写流程为主模型→解析→主模型，共3次模型响应）；普通聊天、查询、后台任务不增加该调用。解析最多1000输出 token、20秒上限且不重试，失败不执行；用量纳入同一 Run 的 model_calls。有效待确认内容的简短“确认”不再调用解析器。宿主操作日志只记录操作类型、目标 ID 和版本，不记录正文；原始 Session 本身仍保存对话。

### 区分 Memory 命中与 Session 历史

1. 在当前飞书会话保存一个无敏感信息的测试项目事实，记下 Memory id/version，并询问确认。
2. Ctrl+C 正常退出，重新执行 `npm start -- --feishu`，确认事实仍可读。这只能证明重启后的整体可用，不能单独证明来自 Memory。
3. 再次停服，使用一个**此前不存在**的 Session 目录启动，保持同一 `DATABASE_PATH`、`MEMORY_DIR` 和飞书身份：

   ```sh
   SESSION_DIR=./data/memory-acceptance-session-01 npm start -- --feishu
   ```

4. 只问“测试项目的数据库决策是什么？请先检索 Memory”，不要在问题中给答案。核对其 id/version 与文件一致，并在 Task SQLite 的 `run_events` 中查看 `type='memory_context'` 的命中 ID/版本。`memory_get/search` 可能在后续模型调用才补充命中，因此检查同一 Run 的全部事件。
5. 更新同一事实，确认版本递增，旧值不再是当前 Memory；删除后换另一个全新 Session 再问，确认不命中。原 Session 仍可能从历史文字回答，不能将其当作删除失败或 Memory 命中。
6. 在未删除的非敏感记忆中选择一项创建“两分钟后”的提醒；停服重启，检查 Pending 任务、主动通知及其 Run 的 Memory 命中。后台指令和结果不应出现在交互 JSONL。

验收后停服，恢复原来 `npm start -- --feishu` 即回到原 Session；无需删除任何目录。请只提供日期、操作、脱敏结果和命中 ID/版本，不提供 `.env`、真实隐私正文或完整 Session。最小中文评测样本见 [memory-eval.json](tests/fixtures/memory-eval.json)：4个正例和1个无关问题，自动化只验证关键词检索，不代表通用问答质量。

扩展的[检索样本](tests/fixtures/memory-retrieval-eval.json)含10条虚构记忆、16个原词/同义/干扰/无答案问题。运行 `npm run eval:memory` 可复测，不加载 `.env`、不调用模型或读取正式存储；[本次基线](docs/evaluations/v2-memory-baseline.json)保留逐题结果。原词 Top1=4/4、同义 Top1=0/4、干扰 Top1=1/4；后两组的 Recall@5 分别1/4、4/4。4个无答案问题仅1个空检索，相关片段不代表存在答案。所有 Context ≤2048字节。这是检索器评测，不验证真实模型最终回答；测试脚本成功不等于检索质量达标。

### V2.1 第一阶段：检索质量与可选查询改写

默认使用词项 IDF、中文二元字串、实体/日期/排除约束和字段线索排序。`search` 返回最多5条候选；V2.1a.1 将相关性与主体/字段/日期的子句证据分开，区分界面语言/开发语言、电话费/泛价格。`none`=无相关候选，`insufficient`=相关但缺所问事实，`uncertain`=字段或归属不确定，`supported`=限定规则发现同一主体的对应字段证据。**这是有界启发式，不能证明任意问题可回答**；未知字段保守处理，回答仍须核对原文。资料不足时说明本轮无法确定，不能因未召回或排除某人就断言全库没有此事实。

Context先装入Top5中的证据项，再装入其余相关候选及合规工具选中项；不再因一个supported标签丢弃其他相关项。最多5条、同一UTF-8字节预算；证明引句被截断时降级。每次读取当前版本，不缓存旧正文，不写入持久Session。会保留更多参考噪声，不能把Context非空当成有答案。

对于无共同词的问题，可选择在本机 `.env` 中设置 `MEMORY_QUERY_REWRITE=true`。默认 `false`，本次没有修改你的 `.env`。启用后复用当前模型：每轮低置信度最多一次查询改写，输入只有当前问题，没有历史、Memory正文或工具；上限512输出token、5秒、无重试。失败记录 `memory_rewrite` 的 `lexical_fallback`，回退词法；有相关正文时Context也提示降级。文件/索引故障仍中止，不因改写失败跳过校验。实体、日期等约束继续取原始问题，改写不会产生写权限。

```sh
# 默认纯离线：原16题 + 旧独立24题 + 新证据留出24题，无API
npm run eval:memory
# 100/1000条虚构数据性能；包括磁盘校验与索引事务
node --import tsx scripts/benchmark-memory.ts
```

[V2.1历史报告](docs/evaluations/v2.1-retrieval-review.md)与[本次逐题证据报告](docs/evaluations/v2.1a.1-evidence-review.md)保留新旧结果和失败样本。相对087888c，本次词法：原题Top1仍9/12、原词4/4；旧独立集Top1/Context命中15/19→17/19；新24题Top1/Context命中15/18→17/18，但Recall@5从18/18降至17/18（Mosaic句中“用户”被误当主体）。新集无答案误supported为2/6→0/6；词法同义组仍仅1/4。未知关系、复杂主客体及通用同义召回尚未解决，证据标签不等于真实生成拒答。

收费语义验收必须先获得用户授权，再显式执行：

```sh
node --env-file-if-exists=.env --import tsx scripts/evaluate-memory.ts --live --allow-paid
```

它只向当前模型发送固定虚构问题，最多40次改写，不打开正式数据或发送飞书；输出保留额外调用次数、Token、耗时和失败。用户授权后已用当前硅基流动模型完成两轮：共44次请求，43次成功、1次回退；输入4671/输出1253 token，失败用量未知。完整记录见[真实改写验收](docs/evaluations/v2.1-live-rewrite-acceptance.json)。带 `--replay=<已保存的评测JSON路径>` 可离线回放已记录的改写；回放不是新的真实模型测试。Run中的改写用量通过 `model_calls` 记录，兼容Provider费用为null；`memory_rewrite`事件记录延迟，不记录正文/凭据，供应商未报告时0 token不等于零计费。

两轮历史改写曾把“阿青电话费用”误匹配到Quartz价格并标supported。V2.1a.1离线回放已不再出现此误标，旧独立集正确Context从18/19提高至19/19。之后另获授权完成[4问真实生成](docs/evaluations/v2.1a.1-evidence-review.md#真实生成验收2026-10-21)：11/12请求，主答案8/8、整段7/8；1条把“本轮排除阿白”说成“阿白没有记录”，3次改写均超时回退。成功改写后的生成仍未验证，**继续保持 `MEMORY_QUERY_REWRITE=false`**。本轮已结束，不自动用剩余额度重试；`scripts/check-memory-generation.ts` 无 `--allow-paid` 拒绝运行，未来新的收费轮次仍须另行授权。

后续[收尾修复及指标](docs/evaluations/v2.1a.1-closeout.md)：未知新主体不再继承上一子句owner；明确“也喜欢简短解释”等省略仍保留支持证据。Context与系统提示明确区分检索片段和全库检查。96项自动化通过，64题排名/召回/Context命中不退，1项事件证据保守降级；本轮没有收费调用或新版真实生成验收，不能据提示测试声称已消除真实模型附加断言。

V2.1b已按[方案B](docs/designs/v2.1b-memory-formation.md)实现后台候选、集中展示、每轮批准一条，默认关闭，未批准候选不进入知识Context。真正批量批准或自动保存需另行决策与授权；当前程序仍只在用户明确要求/批准时写Memory。

手机最小复测：在专用测试目录保存非敏感联系人/项目事实，停服后换全新 `SESSION_DIR` 并保持同一测试Memory；分别问联系方式、费用、UI/开发语言和未记录的发布日期，核对 `memory_context` 的候选/支持项/实际注入ID、version、evidence与预算。更新、删除后再换新Session确认当前值与不命中，不要在问题中带答案或清空正式目录。完整步骤和未验收边界见本次报告。

固定集成验收见 [memory-acceptance.test.ts](tests/memory-acceptance.test.ts)：四类飞书入口 CRUD/去重/白名单、全新 Session、后台只读及停服复制三份存储后恢复到新目录。使用真实 SDK 与存储、模拟模型/飞书发送；手机端自然语言使用效果与实际手机送达仍需复测。备份必须在所有写入者停服后一起进行；恢复演练不覆盖热备份、突然断电、磁盘损坏或 Linux VPS。

若收到“执行中断”，先核对本轮 Run、工具事件和实际存储，不能假定写入成功或未成功。默认执行超时120秒，排队和发送时间另计；收到回复前连续发“你好”不会催快模型。原请求中断后，历史文本仍保留，但新一轮普通问候没有写权限，不能借它继续旧的记忆操作。确认没有写入后，在明确的新请求中重新表达“记住：”；为避免失败历史影响验收，可停服后另用一个全新的 SESSION_DIR，保留失败现场，不删除原目录。

### Context、故障和隐私边界

- Pi 1.3.0 的公开内联扩展 `context` 在每次模型调用前提供一份临时资料消息，放在当前用户消息之前；不追加历史，不修改 Pi 内部数组。工具只返回操作收据，正文在下一次 Context 中临时可见。后台使用独立临时 Session，只读检索。
- Context 最多5条；问题/任务关键词命中后按类型偏好评分，工具也可指定类型和 ID。`MEMORY_CONTEXT_TOKENS` 范围512–8192，目前保守地将同数值作为**完整注入块 UTF-8 字节上限**，近似限制 token，超长正文截断；不是模型 tokenizer 的精确计数，也不限制原始历史长度。找不到时不加载全部文件。
- 资料一律低信任，固定系统规则禁止将其中指令当成权限。写入仍需当前用户意图，工具无文件路径参数；不支持任意本机读写。相关记忆会发送到配置的 LLM API，请只存愿意由该模型处理的信息。
- Markdown 是唯一事实源，带元数据及 Hash，不应手动编辑。服务先在同目录写私有临时文件、fsync、rename，再提交索引；每次读取前重建索引，启动也修复。索引提交失败后，文件可能已经生效，应先查询当前状态，不盲目重复写。格式或 Hash 损坏会停止读取；恢复有效备份后重启，不用清空文件来“修复”。
- V2.0.1 在领取到期任务前通过 `AgentExecutor.checkReady()` 校验 Memory；文件或索引不可用时保留 pending，不创建 Run、不调用模型或发送任务结果，相同阻塞原因仅记录一次，恢复后继续调度。没有到期任务时跳过检查；阻塞中的 pending 仍可取消，停服后仍由 SQLite 保存。检查覆盖整个 Memory 目录，因此一个坏文件也会延迟其他提醒。
- 领取前检查与后续执行不是原子操作。领取后再次发生 Memory/Context 故障，仍按现有 failed/interrupted 终止，不自动重试；升级也不会重置此前失败的任务。启动时 Memory 已损坏仍拒绝启动，交互读取仍保留原来的失败处理，本次没有增加无 Memory 降级执行。
- 目录0700、文件0600，拒绝符号链接和路径穿越。默认目录、`data/`、数据库、PROFILE 及受管 UUID Markdown（含临时文件）已忽略；自定义目录仍建议放在仓库外或 `data/` 下，并核对 Git 忽略规则。拒绝已配置凭据和常见 Key/Token 模式，但检测不是完整的隐私识别，不要向 Agent 发送密钥。
- forget 删除当前知识及有效索引，**不会自动抹除原始 Pi Session、任务/Run 日志、SQLite 空闲页、备份或供应商副本**。文件及数据库未加密，断电/硬件故障不保证最后一次写入完整；备份在正常停服后进行。
- 检索、校验与索引重建目前是线性扫描，适合小型个人知识库；可选只读改写已隔离评测，可改善召回但仍有主体/字段误匹配；没有Embedding、完整修订历史或精准跨 key 冲突检测。历史对话中仍可能有旧值，模型是否正确采用当前版本需要真实验收。V2.1b仅提供默认关闭且需逐条批准的候选发现，尚无真实语义质量证据。

## 后台服务与 VPS（保留迁移参考，当前暂不部署）

```sh
npm start -- --daemon
```

daemon 不创建 readline，不读取 stdin；即使标准输入关闭仍然持续调度。SIGINT/SIGTERM 会中断当前调用、保存状态并释放锁。终端模式的 `/quit` 或 EOF 会停止整个进程，后台运行请使用 `--daemon`。

VPS 上复制源码、`package.json`、`package-lock.json`、配置文件后，在 Linux 上重新运行 `npm ci` 和 `npm run build`；不要复制 macOS 的 `node_modules`。下面是需要自行安装的 systemd 配置示例，项目没有修改系统配置：

```ini
[Unit]
Description=Personal Agent V0
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=agent
WorkingDirectory=/opt/personal-agent
ExecStart=/usr/bin/node --env-file=/opt/personal-agent/.env /opt/personal-agent/dist/main.js --daemon
Restart=on-failure
RestartSec=15
TimeoutStopSec=30
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

把用户、项目目录和 Node 路径改为 VPS 实际值（用 `command -v node` 查询）。确保服务用户有数据库目录写权限。安装 unit 后用 `systemctl enable --now personal-agent` 启动，`journalctl -u personal-agent -f` 查看输出。`Restart=on-failure` 重启的是服务，**不会重试已经失败或中断的任务**。

同一数据库由 `proper-lockfile` 独占。重复启动直接失败；强制杀进程后锁最多需要约10秒过期。该锁用于单机单进程保护，不支持共享网络文件系统、多实例或分布式调度。

## V1：创建并运行飞书 Bot

使用官方 `@larksuiteoapi/node-sdk@1.76.0` 的 WSClient 长连接接收事件，不配置公网回调 URL。Console 和 `--daemon` 保留，飞书模式使用 `--feishu`，三种输入模式不同时启动。

### 需要手动完成的开放平台配置

1. 打开 [飞书开发者后台](https://open.feishu.cn/app)，创建**企业自建应用**。群聊里的自定义 Webhook 机器人不适用于本项目。按平台要求完成企业/开发者设置。
2. 在应用能力中添加/开启“机器人”，设置名称。在“凭证与基础信息”取得该应用的 App ID、App Secret，只复制到自己的本机 `.env`，不要发进聊天、截图、源码或日志。
3. 在权限管理申请两项应用身份权限：`im:message.p2p_msg:readonly`（读取用户发给机器人的单聊消息）和 `im:message:send_as_bot`（以应用身份发消息）。当前不需要群消息、文档、文件或 Shell 权限。参见[接收消息事件](https://open.feishu.cn/document/server-docs/im-v1/message/events/receive)和[发送消息 API](https://open.feishu.cn/document/server-docs/im-v1/message/create)。
4. 在[发送消息 API 调试台](https://open.feishu.cn/api-explorer?project=im&resource=message&apiName=create&version=v1)选择**当前应用**，将查询参数 `receive_id_type` 选为 `open_id`，点击其下方出现的“快速复制 open_id”，选择自己并点击“复制成员 ID”。若默认已选 open_id 却未显示按钮，可先切换其他 ID 类型再切回。此路径已在真实页面验证，无需点击“开始调试”、发送消息或新增通讯录权限。不要用另一个应用的 open_id、union_id、user_id 或机器人的 ID。其他方式参见[官方获取 Open ID 指南](https://open.feishu.cn/document/home/user-identity-introduction/open-id)；若改用手机号/邮箱查询接口，才需额外申请 `contact:user.id:readonly`。
5. 在本机现有 `.env` 中追加以下三项，保留原有 DeepSeek/模型配置：

   ```dotenv
   FEISHU_APP_ID=cli_0123456789abcdef
   FEISHU_APP_SECRET=<REDACTED>
   FEISHU_ALLOWED_OPEN_ID=ou_your_open_id
   ```

   三项均须替换为自己的真实值。缺少白名单、凭据或格式无效会拒绝启动，不提供临时开放所有用户的模式。`open_id` 虽非密钥，也无需发送给开发者。
6. 在“事件与回调”中选择“使用长连接接收事件”，订阅**应用身份**的 `im.message.receive_v1`（接收消息）。如果平台提示先建立连接，先按下面命令启动本地进程，再回页面保存订阅；无需填写公网地址、Verification Token 或 Encrypt Key。长连接方式参见[官方 SDK 说明](https://github.com/larksuite/node-sdk/blob/main/README.zh.md)；具体页面以开放平台当前显示为准。
7. 创建应用版本并发布，使机器人能力、权限和事件配置生效；将应用可用范围限制为自己。平台要求管理员审批时，需由你完成。权限或事件修改后，按平台要求重新发布。
8. 在 Mac、iPhone 的飞书中使用创建应用时的同一身份（本次为飞书个人身份），搜索该机器人并进入私聊。Mac 上的 Agent 进程必须保持运行、联网且未睡眠；手机只是交互入口，任务在 Mac 执行。停机/睡眠期间的 pending 提醒会在恢复运行后补执行，不能保证原定时刻送达。

### 本机启动和手动验收

```sh
npm run build
npm start -- --feishu
```

看到 `模式=feishu` 表示 SDK 已报告首次 WebSocket 握手成功；`WSClient.start()` 返回本身不作为已连通依据。初始连接30秒内未确认就绪会失败退出。保持该终端运行，用 Ctrl+C 停止；重启仍使用相同命令、数据库、App ID 和白名单。

### 连接告警排查

连接日志带 UTC 时间，并区分 `state=connected`（首次连接或重连成功）、`state=reconnecting`（SDK 正在重连）、`state=failed`（不可恢复或重试耗尽，服务退出）。短时断线后看到“重连成功”说明该次连接已恢复；仍需发送“你好”确认实际消息收发。当前日志回调统一写入 stderr，连接成功提示本身不表示错误。

SDK 错误只输出固定类别和可提取的安全状态码，不打印原始错误、请求头、URL、连接票据或消息正文：

| 新日志字段 | 排查方向 |
| --- | --- |
| `category=network_error networkCode=ENOTFOUND` / `EAI_AGAIN` | 优先检查 DNS、网络或代理环境；不能只凭该码判定飞书权限有误 |
| `networkCode=ECONNRESET` / `ETIMEDOUT` | 检查网络切换、代理及超时，与告警时间对应核对 |
| `category=handshake_timeout` / `heartbeat_timeout` | WebSocket 握手或心跳异常；检查是否随后重连成功、Mac 是否睡眠或离线 |
| `category=http_error httpStatus=...` / `api_error apiCode=...` | 根据具体 HTTP/飞书业务码检查请求、凭据或权限；不直接重置密钥 |
| `category=ws_connect_error` / `unknown` | SDK 未保留足够底层原因或当前规则未识别，保留安全类别继续定位 |

使用新版需要先正常停止旧实例，再运行 `npm run build`、`npm start -- --feishu`。如告警再次出现，提供同一时间段的 `state`、`category`、数字错误码，以及机器人是否能回复即可；不要提供 `.env`、完整 SDK 错误对象或密钥。若最终失败退出，按错误码解决原因后重新启动；不要反复创建提醒来测试，以免产生多个新任务。

这项改动只完善安全诊断与恢复提示，沿用 SDK 自动重连策略，没有新增消息或任务重试。本机模拟断线/重连已验证，用户之前那次告警的根因尚未确定。

依次在机器人**私聊**中验证：

1. 发送“你好”，确认回复；再问“我上一句说了什么”，确认同一进程内保留上下文。
2. 发送“1分钟后提醒我喝水”；收到任务 ID 后发送“查询我的任务”，核对 pending 状态与执行时间。
3. 不再发送消息，等待提醒主动到达。通知通过持久化 chat_id 发送，不依赖最近一次消息或临时回复令牌。
4. 再创建一条“1分钟后提醒我喝水”，确认写入后在到期前 Ctrl+C 停止，重启 `npm start -- --feishu`，等待原任务到期主动通知，不重新创建任务。
5. 发送“取消任务 <任务ID>”，确认只有 pending 可以取消。

同一 `message_id` 重投的去重已由自动化测试覆盖；手动再次发送相同文本是**新的 message_id**，会作为新请求处理。未授权用户、群聊、机器人发送者、图片/文件、空消息、无效 JSON 和超过10000字符的文本直接忽略，不调用模型、不创建 Run 或任务、不回复。

飞书模式不会同时开启终端输入。需要 Console 调试可退出飞书后运行 `npm start`；若同一数据库仍有 pending 飞书任务，Console/daemon 会拒绝启动以免丢提醒。独立调试请在启动进程的环境中设置另一份 `DATABASE_PATH`。旧 V0 任务默认仍输出 Console，不会自动改发飞书。

### 路由、去重与投递边界

- Task 新增持久化目标：渠道、App ID、chat_id、用户 open_id。启动时增量加列并新增 `feishu_messages` 去重表，保留 V0 任务和执行记录；旧任务默认 Console。不要在运行期间用旧版本进程操作已迁移数据库。
- 只有通过白名单的私聊才能写入接收记录。`(appId, message_id)` 是去重主键，接收记录与 Run 原子提交，随后立即结束事件处理。模型和回复在进程内串行执行，同一交互 Pi Session 被复用，后台任务仍使用独立 Session；没有引入外部队列服务。
- 消息目标由 Channel 的可信上下文绑定，模型工具没有选择或修改接收人的参数。出站再次检查 App ID 和白名单，配置更换后不会把旧任务通知发给新的用户；不匹配只记录投递错误。
- 消息结果先写入 `runs`，再发送。飞书业务错误保存 code，网络错误只记录安全摘要，不记录 SDK 原始 Axios 对象、请求头、App Secret 或连接票据。文本按编码字节分片，每片关联稳定 uuid，但不自动重发。

旧Task、聊天回复和手动Goal通知仍沿用直接发送，未使用Outbox，存在以下故障窗口（V3.3策略执行的通知例外，见前节）：

1. Run/任务结果已经提交，发送前进程崩溃：任务保持 succeeded，通知可能永久丢失，甚至没有机会记录 deliveryError。
2. 飞书已接收但客户端超时，或发送后尚未记录 `delivery_succeeded` 就崩溃：送达状态不确定，不自动重发，也不重新调用模型。长消息分片可能只送达前半部分。
3. 入站去重已提交但模型尚未执行就崩溃：该消息仍算接收过，Run 恢复为 interrupted，重投不会自动重放，以免重复创建已产生副作用的任务。用户应先发新消息查询任务，再决定是否重新提出请求。排队消息只在内存中，未实现入站补偿。

旧Task及前台回复的Outbox仍是后续范围。V3.3只为策略Goal执行增加最小持久通知及有限重试；未实现飞书分片进度或供应商幂等保证，不能宣称外部恰好一次。

## 时间规则

- `USER_TIMEZONE` 是 IANA 命名时区，例如 `Asia/Taipei`、`Asia/Shanghai`、`America/New_York`。
- 数据库所有时间字段使用规范 UTC ISO 字符串，例如 `2026-10-21T01:00:00.000Z`。服务器的 `TZ` 不参与时间解析。
- 支持 `今天/明天/后天 + 凌晨/早上/上午/中午/下午/晚上 + N点/时 + 分钟/半`，例如“明天上午九点”“后天下午三点半”。
- 支持“N秒/分钟/小时/天后”（常见中文数字或阿拉伯数字）、`YYYY-MM-DD HH:mm[:ss]` 用户当地时间、带 UTC 偏移的 ISO 时间。
- 支持“过两分钟”“两分钟之后”“晚上8点”“明早9点”等常见别名。“明天早上”可筛选已有任务的时段，但创建提醒时仍须明确几点。
- “N天后”按用户当地日历；小时和分钟按实际时长。“明天9点”、cron、星期和任意自由文本表达不做猜测，要求补充明确时间。
- 夏令时重叠或不存在的当地时间拒绝解析，要求提供显式偏移。“晚上12点/1点”等跨日歧义也要求明确日期和偏移。启动时和每次对话都向模型提供用户时区，但最终解析由服务完成。
- 到期检查约每 `POLL_INTERVAL_MS` 执行一次；后台任务串行，前一任务较慢会延后后续任务。停机期间到期的 pending 任务在下次启动后执行。

## 架构及状态边界

```text
Console 输入 → Task Service / AgentExecutor → Pi 交互 Session
                     ↓ SQLite
独立 Scheduler → 原子领取 → AgentExecutor → 新 Pi 任务 Session
                     ↓ 执行结果提交
                 Channel.sendMessage()
```

- `contracts.ts`及各业务DTO定义宿主接口；Pi类型集中于`pi-executor.ts`及Task/Memory/Skill/Web工具适配层，业务服务不操作Pi内部对象。V1.2在适配层接入原生Session文件，未修改Pi SDK。
- Task 状态由 SQLite 管理，Pi Session 只保存当前对话上下文。交互 Session 在进程内复用并跨重启恢复，每次后台任务使用独立内存 Session 并释放，二者不混入对话历史。
- Scheduler 只依赖 `AgentExecutor`、存储和 `Channel.sendMessage()`；ChannelRouter 根据任务的持久化目标路由到 Console 或 FeishuChannel，飞书官方 SDK 仅封装在 FeishuSdkTransport 中。
- 独立 FileMemoryService 管理四类长期知识与可重建索引，通过公开 Context 临时注入；Memory、Session、Task 均独立。Goal的已授权周期策略见前节；没有WebUI或复杂工作流框架。

任务状态：`pending → running → succeeded / failed / interrupted`；`pending → cancelled`。

领取任务和创建执行记录在同一 `BEGIN IMMEDIATE` 事务中提交，条件更新和 `UNIQUE(taskId)` 防止一次性任务被重复领取。只有 pending 能取消，不能撤销已经发生的操作。

启动获得独占锁后，将遗留 running 执行及任务标记 interrupted，保留 pending；失败和中断均不自动重试。需要继续时先查看结果、核实副作用，再手动创建新任务。这不是外部副作用“恰好一次”保证。

`message_end` 用于保存每次模型响应的用量；`agent_end` 只表示底层一轮结束；收到 `agent_settled` 后还需检查 aborted、模型错误、工具错误、输出截断和最终文本，才能提交成功。Pi 执行结束、SQLite 任务提交成功、渠道投递成功是独立阶段。投递失败保留成功的任务结果和 `deliveryError`，不重跑任务，也不自动重发消息。

## 安全与日志

- 交互白名单为create_task/list_tasks/cancel_task及五项Memory工具；显式开启Formation后另加memory_review，SKILLS_ENABLED开启后另加仅批准Skill文件的受限read，LOCAL_FILES_ENABLED开启后增加受控资料read/ls（与Skill共享唯一read名），LOCAL_FILES_SEARCH_ENABLED另加find/字面量grep，LOCAL_FILES_WRITE_ENABLED另加只提议的write/edit，WEB_READ_ENABLED另加固定资源web_get。后台Session/形成请求无工具，允许宿主只读检索。没有Shell、任意目录读写、浏览器或通用网络工具。
- SDK使用内存凭据和设置；交互Session使用宿主指定私有文件。资源加载器只注册宿主内联扩展，关闭本机扩展、AGENTS、模板及MCP自动发现；Skills也不自动发现，只有SKILLS_ENABLED显式开启后加载受管批准包。不读取全局Pi配置，不保存Key到Pi认证文件。
- 关闭 Agent 自动重试、Provider HTTP 重试、自动压缩、缓存预热和 SDK 可配置的分析功能。保留原版 Pi SDK 及 Agent Loop。
- 服务自身仍会写 SQLite，并向指定 LLM API 和启用的飞书服务发请求。工具白名单属于应用能力边界，不是操作系统沙箱。模型会收到对话和当前任务内容。
- `.env`、数据库、默认 Memory、Session 文件、构建产物及依赖目录已加入 `.gitignore`。启动设置 umask 0077，新建数据目录权限0700；会话和 Memory 目录/文件打开时收紧权限，其他已有数据文件权限需要自行检查。
- `tasks` 保存任务及投递目标；`runs` 保存结果、错误和投递错误；`run_events` 保存执行生命周期；`model_calls` 保存 Provider、模型、token、stopReason 和费用；`feishu_messages` 保存消息 ID 和 Run 关联。错误及输出中的已配置模型 Key、App Secret 和常见认证内容会脱敏，不记录 HTTP 头或原始请求。
- 模型用量仅能记录 SDK 实际观察到的响应；进程被强杀、网络中断或供应商未报告用量时可能缺失。内置模型费用来自 SDK 价格估算，并非账单；兼容端点费用未知。
- SQLite 未加密，会保留任务文本和生成结果。V0 没有自动清理；不要把 Key 写进任务或提示词。

## 验证与限制

`npm run typecheck` 同时检查源代码和测试；`npm run build` 输出到 `dist/`；`npm test` 使用 Node 内置测试框架。

测试覆盖时间解析、服务器时区独立性、DST、取消与领取、SQLite 重开恢复、调度关闭、通知失败、用量与脱敏、Pi 生命周期及会话隔离。集成测试在 `127.0.0.1` 上运行临时模拟 Chat Completions API，使用虚拟 Key；进程测试会启动并关闭临时服务及数据库。在禁止回环监听的沙箱内需要允许本地监听。

V2.0 自动化覆盖四类 CRUD、来源/权限、去重/版本冲突、跨进程恢复、索引丢失与故障修复、符号链接/凭据保护、中文评测及有界 Context；真实 Pi SDK + 模拟模型验证全新 Session 命中、动态注入不落盘、更新删除及 Context 异常中止。原有鉴权、去重、串行、任务调度/通知、真实服务子进程及 Session 测试继续运行；本次完整结果见 [STATE](docs/STATE.md)。

这些均为**模拟飞书服务/模型 API 测试，不代表全部真实场景均已验收**。另外，本机真实长连接、应用发布、手机私聊、飞书任务创建与主动提醒已确认；用户已报告亲自停止/重启进程后仍收到原任务提醒，并提供手机截图，SQLite 核对该任务 succeeded、仅1条 Run 和1条成功投递记录、无错误。重启操作由用户实测确认，开发者只读核对执行及投递记录；重复事件重投与未授权用户仍只有自动化证据。详细证据见 [STATE](docs/STATE.md)，Linux VPS 本次不部署。

当前限制：没有上下文自动压缩；历史跨重启保留，长对话达到模型上下文限制后需要使用新的 Session 目录。会话文件与 SQLite 不是跨存储事务；强杀时可能出现两者记录不一致或最后一条会话记录不完整，恢复只加载上下文，不自动补偿或重放。服务采用协作式取消，若供应商/SDK 无法响应 abort，退出可能延迟；下次启动会标记遗留执行中断。崩溃可能发生在结果生成后或通知投递前，不保证通知一定送达。

V1核心本机闭环及V1.2上下文跨重启恢复已有真实用户实测反馈；V2.0 Project Memory核心闭环已有真实飞书验收；Retriever真实语义与手机效果仍待验收。V3.1–V3.3及S0本地模拟与真实验收分开记录；S0只含上述纯文本Skills，WebUI、Computer Use、VPS及其他生态不在本轮范围。本版复用已有Run/Events/ModelCalls，不另建评测平台。

官方参考：[Pi SDK](https://pi.dev/docs/latest/sdk)、[1.3.0 完整控制示例](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/examples/sdk/12-full-control.ts)、[Node SQLite](https://nodejs.org/api/sqlite.html)。
