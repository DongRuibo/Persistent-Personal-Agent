# Personal Agent 项目说明

## 定位与当前范围

面向单用户的长期运行 Personal Agent，目前在 Mac 本地开发与运行，未来保留迁移 Linux VPS 的能力，暂不部署。V0 提供终端对话及一次性后台任务；V1 新增飞书 Bot，Mac 本机手机私聊、主动提醒、pending 任务重启恢复已通过真实手动验收。V1.2 新增 Pi 原生交互 Session 持久化，已通过模拟模型及进程自动化测试；用户已亲自重启并确认真实飞书对话上下文恢复，证据边界见 STATE。

V2.0 在此基础上增加独立的 SQLite + Markdown 长期 Memory，只由明确的记忆请求写入。四类知识共用服务、索引和检索，不增加外部服务、依赖或 Pi 内部改动。实现及自动化验证与真实飞书验收分开记录。

V2.1b 已批准方案B：默认关闭的后台Semantic/Project候选发现，用户逐条批准后仍由原MemoryService保存。Formation不是Task调度器或新Memory事实源，不自动保存，不回扫历史。离线机制已验证；隔离真实模型验收发现宿主漏提两条合法事实，值得保留的候选召回4/6，尚未达到质量目标。一次批准更新及全新Session回答通过，真实手机Formation未验收，详见[报告](evaluations/v2.1b-formation-live-review.md)。

V2.1b.1 本地修复仅在semantic来源校验先接受完整原文匹配，再兼容原有时间前缀省略。property/quote及写入目标匹配不改，不能因去掉范围而覆盖另一主体/项目。固定真实输出回放由10/12、4/6改善为12/12、6/6；没有新收费语义验收，仍默认关闭，见[定点修复报告](evaluations/v2.1b.1-formation-fix-review.md)。

后续V2.1b.2按授权完成一次12请求真实复验，生产仍为f79a8b8：原六窗6/6，新两窗0/2，两次批准/新Session回答正确，宿主阻止跨项目错误目标和无效否定属性。属于安全拦截有效、形成质量仍有缺口；不改生产策略或启用正式Formation，详见[真实复验](evaluations/v2.1b.2-formation-live-review.md)。

另行真实手机验收曾发现普通项目陈述直接写入，随后按授权只修宿主保存意图检查。修复后实际拦截同类错误工具提议，并完成候选显示、批准、明确拒绝、编辑后确认及空Session检索；原误写与“先不保存”漏工具均保留，不能外推通用语义质量达标。最终Linux131全过、Windows128通过/3平台跳过，正式Formation继续关闭，详见[手机验收](evaluations/v2.1b.2-platform-feishu-review.md)。

V2.1b.3 仅修复拒绝漏工具、错误项目target和否定property三项：宿主对已显示候选的有界明确拒绝补执行，不增加模型请求；来源能逐字证明的一次否定遗漏由首个自述子句恢复。不同项目且无合法旧目标时，仅允许建议新增，不借模型ID覆盖其他主体；同范围旧目标存在而指错ID时仍澄清。原真实输出离线回放8/8，原始真实6/8与手机失败不覆盖，不等于新真实模型质量100%。见[定点修复](evaluations/v2.1b.3-formation-fixes.md)。

协作规则见 [AGENTS.md](../AGENTS.md)，当前进展与交接见 [STATE.md](STATE.md)，安装配置与运行说明见 [README.md](../README.md)。本文记录已经确定的方案，不把未来目标当成已实现功能。

## 技术栈

| 项目 | 当前选择 |
| --- | --- |
| 语言与运行时 | TypeScript / ESM，项目要求 Node.js >=24.15.0 |
| 依赖管理与构建 | npm + package-lock，TypeScript 编译至 `dist/` |
| Agent Runtime | 原版 `@earendil-works/pi-coding-agent@1.3.0`，配套 `pi-ai@1.3.0` |
| 飞书渠道 | 官方 `@larksuiteoapi/node-sdk@1.76.0`，企业自建 Bot、WebSocket 长连接与文本消息 |
| 模型 | 现成 LLM API；支持 Pi 内置 Provider 或流式 OpenAI Chat Completions 兼容端点 |
| 持久化 | Node 内置 `node:sqlite`；Task 库使用 WAL，Memory 使用独立可重建索引；单机进程锁 `proper-lockfile` |
| 时间 | `@js-temporal/polyfill`，IANA 用户时区，UTC ISO 时间存储 |
| 测试 | Node 内置测试框架 + tsx；本地模拟 API 及服务子进程测试 |

API Key 只从环境变量读取，仓库仅放脱敏样例。准确依赖版本以 [package.json](../package.json) 和 lockfile 为准。

## 整体架构与边界

终端输入由 Console Channel 处理；飞书入口校验配置用户的文本私聊并落盘去重，在进程内串行调用同一个 AgentExecutor，复用交互 Pi Session。启动时通过原生 SessionManager 打开固定的私有 JSONL 文件，首次创建、以后恢复；Console 与飞书应用/白名单用户分别存储，不扫描全局 Pi 会话。Task Service 通过可信上下文绑定接收目标，不让模型选择接收人。独立 Scheduler 从 SQLite 领取到期任务，通过 AgentExecutor 创建新的临时后台 Pi Session，先提交结果，再通过 ChannelRouter 和 `Channel.sendMessage()` 通知持久化的接收会话。

| 概念 | 职责与生命周期 |
| --- | --- |
| Task / Run | SQLite 保存指令、下次执行时间、渠道接收目标、状态、执行结果与日志，跨进程重启保留 |
| Pi Session | 短期对话上下文；交互使用 Pi JSONL 文件跨重启恢复，每个后台任务使用独立内存 Session 并释放；不是长期记忆 |
| Memory Service | 跨 Session 的四类长期知识；Markdown 为事实源，独立 SQLite 为索引，不负责任务状态或完整聊天历史 |
| Goal（V3.0） | 同应用库四表持久目标/不可变计划/稳定步骤/执行；Checkpoint 嵌入已提交 Execution。独立Runner每次授权最多推进一段，随后等待；不以Memory或Session代替进度 |
| Channel | Console 与 FeishuChannel，使用包含目标的统一消息接口；任务引擎不绑定 SDK 或具体渠道 |

Pi SDK 使用公开 API，不 Fork、不修改内部源码和 Agent Loop。宿主负责业务状态、权限和投递策略；单用户、单进程、串行后台任务，不引入微服务或工作流框架。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| [src/main.ts](../src/main.ts) | 组装服务、进程锁、恢复、console/daemon 入口与信号退出 |
| [src/config.ts](../src/config.ts) | 环境变量、IANA 时区与参数校验、日志脱敏 |
| [src/contracts.ts](../src/contracts.ts) | Task / Run、AgentExecutor、Channel、Scheduler、MemoryService 业务接口 |
| [src/pi-executor.ts](../src/pi-executor.ts) | 原生 Session 文件创建/恢复与权限、后台隔离、白名单检查、执行生命周期、取消超时和用量观察 |
| [src/operation-guard.ts](../src/operation-guard.ts) | 当前意图与操作提议分离、宿主候选筛选、澄清/确认引用、一次性权限及操作审计 |
| [src/task-tools.ts](../src/task-tools.ts) | Pi 工具适配：创建、查询、取消任务，调用 Task Service |
| [src/memory-service.ts](../src/memory-service.ts) | 四类 Memory CRUD、来源/版本/Hash、原子文件提交、索引修复、关键词检索和有预算的临时 Context |
| [src/memory-retriever.ts](../src/memory-retriever.ts) | 纯只读检索、原问题主体/日期/排除约束、IDF/类型/字段排序、同主体子句证明与候选/证据分离、有界改写协议 |
| [src/memory-tools.ts](../src/memory-tools.ts) | 五项受控 Pi 工具，只返回操作收据，正文由 Context 临时提供 |
| [src/task-service.ts](../src/task-service.ts) | 任务内容与时间校验、查询和 pending 取消规则 |
| [src/sqlite-store.ts](../src/sqlite-store.ts) | SQLite 表、原子领取、执行状态、日志、恢复与投递记录 |
| [src/goal-types.ts](../src/goal-types.ts)、[src/goal-store.ts](../src/goal-store.ts) | Goal 最小类型、同连接事务、一次授权领取、版本计划、Checkpoint、控制收据与保守恢复；没有模型/渠道依赖 |
| [src/goal-runner.ts](../src/goal-runner.ts)、[src/background-lane.ts](../src/background-lane.ts) | 有界快照与结果校验、独立片段、提交异常重读和停止、结果通知；与Task共享后台门，旧到期Task优先 |
| [src/goal-service.ts](../src/goal-service.ts)、[src/goal-tools.ts](../src/goal-tools.ts) | 可信渠道绑定与Goal控制；无参数goal_manage适配，复用Guard同一Frame、已投递清单、版本和计划Hash |
| [src/time.ts](../src/time.ts) | 有界中文时间与 ISO 时间解析，明确处理时区和 DST 歧义 |
| [src/scheduler.ts](../src/scheduler.ts) | 独立扫描循环、串行执行、先提交结果再调用 Channel |
| [src/console-channel.ts](../src/console-channel.ts) | 终端对话与命令、控制台消息输出；daemon 不启动输入循环 |
| [src/feishu-channel.ts](../src/feishu-channel.ts) | 白名单私聊、接收去重、交互串行处理、可信任务目标、出站检查与文本分片 |
| [src/feishu-transport.ts](../src/feishu-transport.ts) | 官方 SDK 长连接、就绪/关闭、带超时的发送及敏感错误隔离 |
| [src/channel-router.ts](../src/channel-router.ts) | 按持久化渠道投递，飞书不可用时不回退 Console |
| [tests/](../tests/) | 状态、时间、权限、Pi 生命周期、模拟 API 和真实服务进程测试 |

## 必须保持的执行语义

- 一次性任务：`pending → running → succeeded / failed / interrupted`；仅 `pending → cancelled`。
- 领取和创建 Run 在同一事务提交，条件更新与 `UNIQUE(taskId)` 防止重复领取。独占锁后才能恢复遗留运行状态。
- V2.0.1 仅在有到期 pending 时，通过 `AgentExecutor.checkReady()` 的同步宿主预检查再领取。PiExecutor 检查整个 Memory 的文件与索引；失败保留 pending，不生成 Run，记录去重后的阻塞原因，后续轮询恢复后继续领取。Scheduler 不依赖 Memory 或 Pi 对象，不增加任务状态或表迁移。预检查与执行之间仍有故障窗口，领取后的异常保持原有终态语义。
- 重启继续等待中的任务；遗留 running 标记 interrupted；失败、中断和投递失败不自动重跑任务。有外部副作用时须人工核实，不能保证恰好一次。
- `message_end` 记录模型响应与用量；`agent_settled` 后仍检查 aborted、模型与工具错误、截断及最终文本。执行结束、数据库成功提交、渠道投递成功互相区分。
- UTC 持久化、IANA 用户时区解析。支持的中文时间语法见 README，歧义或 DST 无效时间要求用户明确，不让模型或服务器时区决定。
- 交互白名单为三项任务工具及 `memory_search/get/remember/update/forget`；显式开启Formation后增加无参数 `memory_review`，后台无工具，可由宿主只读检索 Memory。禁止默认 Shell、任意文件读写和通用网络能力。服务仍需写数据库并请求配置的模型 API，工具白名单不等同于 OS 沙箱。
- 飞书只允许配置的应用内 open_id 和文本私聊；`(appId, message_id)` 持久化去重后再安排执行，不自动重放中断消息。模型执行和发送均不阻塞事件接收；发送失败只保存 deliveryError，不重跑 Agent。Outbox 尚未实现，故障窗口与升级方向见 README。

## V2.0 四类长期 Memory

| kind | 定义和正文位置（相对 MEMORY_DIR） | 写入边界 |
| --- | --- | --- |
| semantic | 用户画像、稳定事实、长期偏好；`PROFILE.md` 中分条存储 | 用户明确提供的稳定知识，不根据闲聊推断画像 |
| project | 长期项目背景、目标、技术决策、阶段；`projects/<id>.md` | 项目知识，不代替 Task/Run 状态或待办数据库 |
| episodic | 有长期价值的事件、反馈、决策过程、任务结果；`episodes/<id>.md` | 用户明确要求保存的重要事件，不复制完整 Session History |
| procedural | 确认或验证过的方法、步骤、操作经验；`procedures/<id>.md` | 用户明确提供的方法，只作为知识，不能自动变成可执行 Skill |

一个事实选一种类型。统一 `MemoryService` 提供 search/get/remember/update/forget，索引以 `kind` 区分，不建四套服务。默认目录为 `<DATABASE_PATH>.memory`，调试数据库不会默认复用正式 Memory；可配置 `MEMORY_DIR=./data/memory`。同一单用户宿主下 Console/飞书共用 Memory，但交互 Session 仍隔离。更换实际使用者须配置新的数据目录，Memory 不是多租户系统。

### 正文、索引与一致性

- Markdown 是唯一知识事实源，含服务生成的元数据注释：UUID、kind、稳定事实 key、来源、UTC 创建/更新时间、版本及规范化正文的 SHA-256。Semantic 条目合并在 PROFILE，其余每个 UUID 一个文件；禁止模型提供文件路径。
- `index.db` 保存这些索引字段和正文缓存。它与 Task 数据库、Pi JSONL 均分离；不对三者做跨存储事务。版本是当前记录的递增号，不是另一个历史档案。
- 唯一写入口先验证权限、重复和版本，在原目录以0600临时文件写入、fsync、rename 原子替换，再在 SQLite 事务中刷新索引。删除非 Semantic 文件用 unlink；Semantic 删除原子重写 PROFILE。索引失败不会回滚已提交的 Markdown，不自动重做副作用。
- 启动及每次读取前从全部受管 Markdown 重建索引，修复缺失、陈旧、文件提交后索引失败等情况；删除的文件不会从旧索引复活。文档格式、路径或 Hash 异常则报错并保留证据，不静默采用旧索引。文件只能通过服务修改，不自动导入任意手写 Markdown。
- 宿主对数据库和 Memory 目录分别持有单进程锁；独立测试服务也须遵守单写者约定。目录0700、文件0600，拒绝符号链接及路径穿越。没有加密、硬件故障恢复或安全擦除承诺；正常停服后备份 Markdown、索引、Task 库和 Session。

### 写入授权、去重与来源

- V2.0.2 使用“当前已鉴权自然语言 → 隔离结构化意图 → 宿主验证 → 一次性执行”，不再要求用户使用前缀、标点或 UUID。主 Agent 保留 Pi Session/Memory 上下文，但它的写工具参数只是提议，不能直接决定权限或目标。
- 首次写工具调用时通过原版 ModelRuntime.completeSimple 发起一次无工具、无历史、无 Memory/Task 正文的隔离请求，只提供当前原始消息和宿主待选操作类型/数量。解析器识别请求/查询/否定/假设/引用/不确定，返回当前文本证据及结构化操作。宿主检查 Schema、原文证据、时间、实际归属/状态/版本与唯一目标，执行核对后的值而不是主 Agent 参数；解析结果本身仍是可能出错的模型判断，不是数学授权证明。
- 真实手机误写后补充直接Memory保存检查：宿主从当前原话分离事实与保存动作，有界自然表达可直接保存；普通事实/外部引文不授予权限，其他记忆请求先展示并确认，长确认须指向刚展示内容。只约束memory_remember，不增加分类调用、不改Task或候选审批；这是保守快路径与确认回退，不宣称通用语义识别。范围、红绿回归及手机复验边界见[修复报告](evaluations/v2.1b.2-memory-consent-fix.md)。
- 普通提醒和明确的 Memory 原文抽取可直接执行；实质改写保存成5分钟待确认内容，当前明确确认后重新检查目标版本再执行。普通偏好陈述不自动写入。不同 key 的语义冲突与推断式记忆提取仍不实现。
- Task 按当前可信渠道身份筛选 SQLite 任务，不用模型提供接收人。最近创建、明确展示的编号引用由宿主维护；同时给定内容/日期时必须取交集，不能让“刚才”覆盖具名条件。关键词采用保守字面/中文词项匹配，扩大可能候选后不按相似度擅选；多个可能 Pending 必须澄清。查询的编号顺序由宿主渲染，避免模型重排；真正取消前再次验证归属及 pending，SQL 条件更新与领取竞争时至多一方成功。
- 引用、选项、待确认内容通过 Pi 公开 SessionManager custom entry 保存于当前身份的私有 Session，元数据不进入模型 Context。有效期5分钟，恢复只恢复引用，不续跑。候选 IDs 不替代 Task 状态或 Memory 当前版本；实际信息每次查存储。Console/飞书/应用用户仍隔离，Memory 仍是单用户共享服务。
- 序号由宿主从当前消息独立核对：支持1–100的常见中文/数字/全角写法，position 不符、模型改用其他引用或漏掉明确序号时澄清。“刚才/最新”须有当前消息依据，不能互换；引号内标记不产生引用能力，复杂/多序号选择先澄清。解析结束后按当前时钟重新检查编号、待选及确认有效期。这是局部确定性校验，不是完整自然语言理解或额外模型调用。
- OperationGuard、Task/Memory Service 的 AsyncLocalStorage 绑定本轮请求和宿主 WriteOperation；每轮最多消费一次，包括并行工具请求。普通主 Agent 执行使用只读权限，外部资料和历史不能伪造 WriteOperation。原严格命令兼容入口仅用于可信宿主/调试调用，产品工具必须走新 Guard。
- 典型写操作增加一次解析（最多1000输出token、20秒、无重试），聊天/查询/后台不额外解析；对有效宿主草稿回复简短“确认”不再解析，其他自然语言确认仍需一次隔离解析。解析与主模型用量均关联 Run，解析完成不冒充 agent_settled；主 Agent 仍按原 Pi 生命周期验证。记录 proposal/authorized/committed/confirmation 事件，仅类型/ID/版本，不复制隐私正文。
- 未开放任务修改。当前 Store 没有编辑接口；后续最小方案是仅对 pending 用条件 UPDATE 比较原 dueAt/instruction/updatedAt、原子改动并记录当前 Run 审计，与 Scheduler 领取互斥。应先设计并测试 CAS 失败、过期时间、通知目标与引用失效，不用取消再新建替代编辑；本轮无 Task 状态/表迁移。
- `(kind,key)` 标识一项事实。规范化正文相同则跨类型返回已有记录，避免复制四份；同 key 不同内容拒绝 remember，须明确 update。更新、删除携带 expectedVersion，防止旧收据覆盖新值。不同 key 的隐含语义矛盾暂不能可靠识别，留给 V2.1。
- forget 使当前文件/索引失效，不删除 Pi 原始对话、Task/Run、审计日志、SQLite 空闲页、备份及模型服务商副本；历史回答可能仍含旧事实，不把逻辑遗忘说成全链路擦除。

### 检索和 Pi Context

1. 执行前校验 Memory 存储。通过公开 `DefaultResourceLoader.extensionFactories` 注册唯一受信任的内联扩展；私有资源目录、内存 Settings、所有 no* 开关及空资源投影禁止自动发现本机扩展、Skills、AGENTS、模板和 MCP。
2. `context` 事件在每次模型调用前根据本轮用户问题或 Task 指令检索当前有效版本。使用中文 `Intl.Segmenter` 词项IDF与低权重二元字串、英文关键词；先根据原始问题限定具名实体、日期、常见排除条件，再结合字段线索和类型评分，最多5条候选，支持显式kind过滤。未知实体/中文称呼及字段解析仍有限。未采用FTS5或向量库。
3. `memory_search/get` 返回 ID、key、版本、Hash、来源类型等收据，并选中本轮要读的条目。正文在接下来的临时 Context 中提供，不把正文一遍遍作为工具结果存入 Session。读到的记录受同一总预算约束，超长正文截断，不保证所有选中项均可装入。
4. Context 返回新的消息列表，在当前用户消息前插入带 `UNTRUSTED_MEMORY_DATA_V2` 标记的低信任资料。只改变请求投影，不追加 Session、不修改 Pi 内部数组；系统指令固定声明资料没有执行权限。每次重新构建，不累积旧注入；更新/删除后使用新状态。
5. `MEMORY_CONTEXT_TOKENS` 默认2048，上限8192；目前以同数值 UTF-8 **字节**限制完整注入块，作为保守预算近似，不使用中文字符数/4，也不宣称等同供应商精确 tokenizer。此预算不含系统提示、原始历史和模型输出。
6. SDK 会捕获扩展异常，因此宿主预检查，并在 Context 异常时通过公开 `ExtensionContext.abort()` 中止，向执行器报告错误。后台仅用独立临时 Session + 同样的只读检索，没有 Memory 写工具，不把后台结果混入聊天。

V2.1 第一阶段保留上述数据边界，仅优化只读 Retriever：

- V2.1a.1 将候选相关性、事实归属、证据充分性分开：none=无相关候选，insufficient=相关但缺所问事实，uncertain=字段/归属无法可靠判断，supported=限定规则在同一合法主体子句找到所问字段/日期证据。中文称呼、英文项目与用户自身从子句发现，不硬编码具体人名/项目/语言值；UI/开发语言、电话费/泛价格分开，未知属性保守处理，多主体比较分别覆盖。不是通用NER或语义证明，复杂主客体/否定仍可能漏召回或判断错误。
- 收尾限制主体继承：只有明确省略谓语/属性声明延续owner；未知新主体清除owner和继承日期，后续省略也不重新接到旧主体。相关候选仍可返回，证据不足不等于删除知识。系统规则和Context均声明只提供本轮片段；未召回/排除不能证明全库不存在，不对排除对象附加无依据说明。模拟模型只验证接线，真实生成遵从仍待复测。
- `records`是Top5，`relatedIds`是排序后的相关项，`evidenceById`记录逐条状态及主体/字段/引句，`supportIds`只表示Top5内的证据项。Context依次选择支持项、其余Top5、合规工具选中项，去重且最多5条；不再以supportIds独占过滤。每项包含证据元数据，截断引句不能继续算可见证明；整体覆盖不足降为uncertain。保留相关参考使Context命中改善，也增加非答案片段，预算不变。
- 可选 `MEMORY_QUERY_REWRITE=true`，默认false；低置信度时使用当前配置模型，通过同一公开异步context Hook调用 ModelRuntime.completeSimple。只处理当前原始问题，最多3个短改写、每轮一次、512输出token、5秒，无工具/历史/Memory正文。V2.1a.1中主体、字段、类型、日期和排除条件都取原问题，改写仅作低权重召回词项；失败回退词法并记录降级，不能借此绕过文件校验或授予写操作。
- 改写计划只在本轮异步上下文保留，不跨轮缓存正文。ID选择在每次context都重新解析当前Markdown/索引，因此更新/删除不能从陈旧对象复活。Task与Memory的写权限验证代码不变；后台依然独立Session和只读检索。
- 每轮 `memory_rewrite` 记录状态/额外延迟，模型用量由同Run观察器记录。`memory_context`分别记录候选/支持项/实际注入ID及版本、字节预算、检索与实际证据/降级状态，不记录查询、引句或正文。费用仍以供应商账单为准。
- 保留每次磁盘Hash与索引事务故障检测，不引入跨轮缓存或文件监听。收尾样本1000条定向Context P50约54ms、宽泛约117ms；历史曾约52/167ms，更早宽泛约63ms。主体交叉检查最坏仍有二次比较，不能据单次测量承诺普遍性能提升。历史[检索报告](evaluations/v2.1-retrieval-review.md)、[证据报告](evaluations/v2.1a.1-evidence-review.md)和[收尾对照](evaluations/v2.1a.1-closeout.md)分别保留原始结果、退步与生成侧待验收边界。

Memory 是低信任知识而非权限来源。历史用户/助手文字仍由 Pi 保存，无法保证模型永不引用旧事实；当前版本由检索 Context 指明。验收必须用**全新空 Session + 同一 Memory**排除历史混淆，并结合 Run 的 `memory_context` 事件（仅 ID/kind/version、字节预算，不含正文）核对命中，不能仅凭“我记得”下结论。

## 开发阶段与验收目标

| 阶段 | 目标与验收 | 状态 |
| --- | --- | --- |
| V0 本地基础 | 对话与任务闭环；恢复、锁、时间、Session 隔离和执行日志；类型检查、构建及模拟 API/进程测试通过 | 已实现，当前验证见 STATE |
| V0 真实环境验收 | 使用用户配置的真实模型完成对话、任务管理与短时后台任务；在 Linux VPS 验证启动、日志、重启及退出 | DeepSeek 本地最小闭环已验证；完整使用效果和 VPS 待验收，详见 STATE |
| V1 飞书本机 | 白名单私聊、上下文复用、主动提醒与恢复、事件去重、保留 Console；无需公网回调地址 | 已实现，39项自动化测试通过；手机私聊、主动提醒与 pending 任务重启恢复核心闭环已实测，去重和鉴权仍以自动化证据为主 |
| V1.2 Session 持久化 | Pi 原生 JSONL、Console/飞书隔离、正常重启恢复、保持 Task 独立及工具白名单 | 已实现，42项自动化测试通过；用户已实测真实飞书重启后上下文恢复 |
| V2.0 长期 Memory | 四类统一服务、显式写入、关键词检索、可重建索引、低信任临时 Context、新 Session 命中 | 已实现；实际自动化结果及待真实飞书验收见 STATE |
| V2.0.2 自然交互 | 隔离意图解析、宿主候选/确认与一次性执行，不要求用户命令格式 | 当前实现及真实/模拟边界见 STATE |
| V2.0 授权与固定验收 | 原文/目标绑定、Task 宿主门、四类/后台/停服备份恢复、同义及干扰检索基线 | 已实现；模拟与真实证据见 STATE |
| V2.1 第一阶段 Retriever | 词法约束、排序/证据、可选只读查询改写、独立留出与性能评测 | V2.1a已实现；历史真实改写两轮同义3/4与4/4，主体/字段风险促成本次修复 |
| V2.1a.1 证据与Context | 原问题约束、同主体子句证明、支持与相关项分离、截断降级、未知owner与检索范围收尾 | 96项自动化通过；64题候选/Context不退，1项事件证据保守降级。旧提示真实生成主答案8/8、整段7/8；本次提示尚无新真实生成，改写默认关闭 |
| V2.1b 候选形成MVP | 后台发现、集中候选、用户单项批准 | 已按方案B实现，默认关闭；[最初13请求验收](evaluations/v2.1b-formation-live-review.md)宿主漏提2项、召回4/6。后续修复与手机验收分别保留，不以历史无误写结论覆盖新失败 |
| V2.1b.1 合法候选校验 | 完整来源归属及原兼容路径，property/范围/目标权限保留 | 已修复，历史输出离线回放12/12、6/6；121项测试118通过/3平台跳过；2026-10-22用户授权发布main，未做新收费或手机验收 |
| V2.1b.2 真实复验 | 虚构数据8提取+2审批+2新Session生成及独立手机验收 | 原12请求宿主预期6/8，H01/H02仍失败；另行手机46/48请求完成核心机制链路，修复后误写提议被拦截，批准/明确拒绝/编辑确认/新Session检索均有库和Run证据。普通拒绝措辞仍有漏执行；Linux131全过、Windows128通过/3跳过。见[修复](evaluations/v2.1b.2-memory-consent-fix.md)与[手机报告](evaluations/v2.1b.2-platform-feishu-review.md)，不启用正式Formation |
| V2.1b.3 三项定点修复 | 拒绝补执行、目标提示与否定属性恢复 | 保存输出8/8离线回放、Pi模拟集成及冻结12/60窗回归；不调用收费API或开启正式Formation，真实语义/手机复测仍单独列项 |
| V3.0 Batch 1–4 长期目标MVP | 四表、不可变Plan/Checkpoint、独立Pi片段、受控自然语言控制、恢复与故障回归 | 本地隔离自动化已接通，待审查；真实模型/手机Batch5尚未执行，结果见STATE |

V3.0 采用“持久Goal + 多次短生命周期text_only Pi片段”，已在既定四表模型上实现Batch2–4。每次明确创建/继续最多推进一段；计划批准默认只接受计划，明确“并继续”才同时授予一次执行。当前原话、目标归属、固定清单、成功投递、五分钟有效期、revision和草稿Hash由同一个OperationGuard核对，模型参数不能选目标或状态；短确认不扩大权限。Goal查询也经一次隔离意图解析，普通聊天不额外路由。

后台Goal与旧Task共用进程内执行门：旧到期Task优先，Goal在无前台排队时领取；已运行片段不抢占，慢Goal可能延迟新到期提醒。每段新建无工具内存Pi Session，Memory只读且不改写查询；投影14 KiB + Memory至多2 KiB，输出至多4096 Token。完整目标/反馈/计划/摘要超限阻塞，长成果明确标记摘录并保留数据库原文，不保证任意长历史都能放入模型。

Checkpoint位于committed Execution，与Run/Step/Goal同事务提交；异常先重读，无法核对则停止新领取并停服，不请求模型补交。运行中pause/cancel先持久化、再abort；恢复以cancel、pause、普通中断阻塞的优先级落点。通知无Outbox，不保证送达；查询可重展示，不重跑成果。失败仅在明确重新生成文本时新建尝试；uncertain无强制重试入口。

计划增补或完整替换仅形成待批准草稿；已完成步骤和旧成果保留。运行中调整先暂停，停止后恢复审批；不原地改变目标原文，换目标新建Goal。Task/Run一次性唯一约束、Memory写入授权及Session隔离保留；Goal控制聊天和执行不进入Formation。原版Pi源码、node_modules、权限框架和依赖均未修改。完整[设计](designs/v3-persistent-goals.md)、[自动化证据](evaluations/v3-mvp-validation.md)和[待授权真实验收](evaluations/v3-live-acceptance-plan.md)明确区分机制通过与真实语义未验收。

本阶段不做未经批准的自动保存、另外两类自动提取、Embedding、向量库、Observer、自主 Skill、周期任务、WebUI、复杂框架或 VPS。架构或范围调整先说明并取得确认，再同步本文及 STATE。

## V2.1b 候选与正式知识的边界

- `formation-types.ts`定义来源、候选、视图与严格输出Schema；`formation-store.ts`在应用库新增Job/候选两表；`formation-service.ts`负责有界Worker、去重/保守冲突、快照失效与审批状态。Pi相关调用仅在适配器，用公开completeSimple，不创建另一套Agent Loop。
- 正常成功chat与符合条件的Job同事务提交，队列故障用SAVEPOINT隔离；关闭开关、失败/后台Run、已经提交的Memory操作及候选审查不入队。Worker只获得只读Memory端口，最多3条新消息，不读Session或助手回复；候选未批准不进Markdown、Memory索引或普通Context。
- 相同规范化完整事实去重，不能只看“喜欢/加糖”就丢掉否定或范围。更新目标由主体/属性前缀及当前真实记录保守核对，模型targetId仅参考；多目标先澄清，未知归属不能自动覆盖。相似改述仍可能重复建议，这是MVP限制。
- 审批通过已有OperationGuard，持有同一轮一次操作能力。固定清单最多3条、5分钟，绑定owner、ID/revision/草稿Hash、整库ID/version/hash摘要和成功显示Run/发送记录；编辑后重新显示并确认。用户未看到的清单不能批准。工具只回收据，宿主渲染清单；Session自定义引用仅保存元数据。
- 最终source=user_explicit关联当前审批Run；原始发现Run/quote/hash在候选保留。采用现有remember/update与expectedVersion，不伪造请求、不放宽服务授权。任意正式Memory变化让旧候选保守失效。applying先落盘，崩溃仅精确对账，不确定blocked、不重放写入。
- 单一应用库跨渠道共用UTC日20次/0.2元预留预算；审批owner是渠道身份的隔离Hash，不是长期个人ID。提取input≤2000字节、output≤512Token、10秒、无重试；前台优先，中断费用不退。参考最多5条相关且非敏感记录，语义正确性依然取决于模型与用户审查。
- 候选7天过期后运行时清除来源/草稿/旧值，保留最小Hash抑制重复；历史Run/Session、WAL/空闲页和备份不擦除。Mac/Linux沿用私有模式，Windows使用账户ACL，当前未验证其隔离性。默认关闭，不将模拟机制成绩当作真实语义门槛达标。
