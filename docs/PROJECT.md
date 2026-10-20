# Personal Agent 项目说明

## 定位与当前范围

面向单用户的长期运行 Personal Agent，目前在 Mac 本地开发与运行，未来保留迁移 Linux VPS 的能力，暂不部署。V0 提供终端对话及一次性后台任务；V1 新增飞书 Bot，Mac 本机手机私聊、主动提醒、pending 任务重启恢复已通过真实手动验收。V1.2 新增 Pi 原生交互 Session 持久化，已通过模拟模型及进程自动化测试；用户已亲自重启并确认真实飞书对话上下文恢复，证据边界见 STATE。

V2.0 在此基础上增加独立的 SQLite + Markdown 长期 Memory，只由明确的记忆请求写入。四类知识共用服务、索引和检索，不增加外部服务、依赖或 Pi 内部改动。实现及自动化验证与真实飞书验收分开记录。

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
| Channel | Console 与 FeishuChannel，使用包含目标的统一消息接口；任务引擎不绑定 SDK 或具体渠道 |

Pi SDK 使用公开 API，不 Fork、不修改内部源码和 Agent Loop。宿主负责业务状态、权限和投递策略；单用户、单进程、串行后台任务，不引入微服务或工作流框架。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| [src/main.ts](../src/main.ts) | 组装服务、进程锁、恢复、console/daemon 入口与信号退出 |
| [src/config.ts](../src/config.ts) | 环境变量、IANA 时区与参数校验、日志脱敏 |
| [src/contracts.ts](../src/contracts.ts) | Task / Run、AgentExecutor、Channel、Scheduler、MemoryService 业务接口 |
| [src/pi-executor.ts](../src/pi-executor.ts) | 原生 Session 文件创建/恢复与权限、后台隔离、白名单检查、执行生命周期、取消超时和用量观察 |
| [src/task-tools.ts](../src/task-tools.ts) | Pi 工具适配：创建、查询、取消任务，调用 Task Service |
| [src/memory-service.ts](../src/memory-service.ts) | 四类 Memory CRUD、来源/版本/Hash、原子文件提交、索引修复、关键词检索和有预算的临时 Context |
| [src/memory-tools.ts](../src/memory-tools.ts) | 五项受控 Pi 工具，只返回操作收据，正文由 Context 临时提供 |
| [src/task-service.ts](../src/task-service.ts) | 任务内容与时间校验、查询和 pending 取消规则 |
| [src/sqlite-store.ts](../src/sqlite-store.ts) | SQLite 表、原子领取、执行状态、日志、恢复与投递记录 |
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
- 重启继续等待中的任务；遗留 running 标记 interrupted；失败、中断和投递失败不自动重跑任务。有外部副作用时须人工核实，不能保证恰好一次。
- `message_end` 记录模型响应与用量；`agent_settled` 后仍检查 aborted、模型与工具错误、截断及最终文本。执行结束、数据库成功提交、渠道投递成功互相区分。
- UTC 持久化、IANA 用户时区解析。支持的中文时间语法见 README，歧义或 DST 无效时间要求用户明确，不让模型或服务器时区决定。
- 交互白名单为三项任务工具及 `memory_search/get/remember/update/forget`；后台无工具，可由宿主只读检索 Memory。禁止默认 Shell、任意文件读写和通用网络能力。服务仍需写数据库并请求配置的模型 API，工具白名单不等同于 OS 沙箱。
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

- 本轮原始用户文本须以“记住：/请记住…”、“更新记忆：/修改记忆：…”或“忘记：/删除记忆：…”表达对应操作。宿主在 AsyncLocalStorage 中绑定可信请求，模型不能用工具参数伪造授权或来源；否定、引用、普通聊天及后台执行不能取得写权限。不匹配的说法要求用户明确重述。
- 来源标记 `user_explicit` 表示本轮用户明确授权写入，保留 Channel 和 Run ID 以追溯原始请求；无 Run ID 的宿主调用使用请求 Hash。V2.0 不接受自动 Agent 推断作为记忆来源，也不宣称工具整理后的正文经过事实核验；模型仍可能误解、选错 key 或概括不准，需人工审查。
- `(kind,key)` 标识一项事实。规范化正文相同则跨类型返回已有记录，避免复制四份；同 key 不同内容拒绝 remember，须明确 update。更新、删除携带 expectedVersion，防止旧收据覆盖新值。不同 key 的隐含语义矛盾暂不能可靠识别，留给 V2.1。
- forget 使当前文件/索引失效，不删除 Pi 原始对话、Task/Run、审计日志、SQLite 空闲页、备份及模型服务商副本；历史回答可能仍含旧事实，不把逻辑遗忘说成全链路擦除。

### 检索和 Pi Context

1. 执行前校验 Memory 存储。通过公开 `DefaultResourceLoader.extensionFactories` 注册唯一受信任的内联扩展；私有资源目录、内存 Settings、所有 no* 开关及空资源投影禁止自动发现本机扩展、Skills、AGENTS、模板和 MCP。
2. `context` 事件在每次模型调用前根据本轮用户问题或 Task 指令检索当前有效版本。使用中文 `Intl.Segmenter` 词项与二元字串、英文关键词，评分后最多5条；有实际词项命中才加类型偏好（项目问题优先 project、方法优先 procedural 等），也支持工具显式限定 kind。未采用 FTS5 或向量库。
3. `memory_search/get` 返回 ID、key、版本、Hash、来源类型等收据，并选中本轮要读的条目。正文在接下来的临时 Context 中提供，不把正文一遍遍作为工具结果存入 Session。读到的记录受同一总预算约束，超长正文截断，不保证所有选中项均可装入。
4. Context 返回新的消息列表，在当前用户消息前插入带 `UNTRUSTED_MEMORY_DATA_V2` 标记的低信任资料。只改变请求投影，不追加 Session、不修改 Pi 内部数组；系统指令固定声明资料没有执行权限。每次重新构建，不累积旧注入；更新/删除后使用新状态。
5. `MEMORY_CONTEXT_TOKENS` 默认2048，上限8192；目前以同数值 UTF-8 **字节**限制完整注入块，作为保守预算近似，不使用中文字符数/4，也不宣称等同供应商精确 tokenizer。此预算不含系统提示、原始历史和模型输出。
6. SDK 会捕获扩展异常，因此宿主预检查，并在 Context 异常时通过公开 `ExtensionContext.abort()` 中止，向执行器报告错误。后台仅用独立临时 Session + 同样的只读检索，没有 Memory 写工具，不把后台结果混入聊天。

Memory 是低信任知识而非权限来源。历史用户/助手文字仍由 Pi 保存，无法保证模型永不引用旧事实；当前版本由检索 Context 指明。验收必须用**全新空 Session + 同一 Memory**排除历史混淆，并结合 Run 的 `memory_context` 事件（仅 ID/kind/version、字节预算，不含正文）核对命中，不能仅凭“我记得”下结论。

## 开发阶段与验收目标

| 阶段 | 目标与验收 | 状态 |
| --- | --- | --- |
| V0 本地基础 | 对话与任务闭环；恢复、锁、时间、Session 隔离和执行日志；类型检查、构建及模拟 API/进程测试通过 | 已实现，当前验证见 STATE |
| V0 真实环境验收 | 使用用户配置的真实模型完成对话、任务管理与短时后台任务；在 Linux VPS 验证启动、日志、重启及退出 | DeepSeek 本地最小闭环已验证；完整使用效果和 VPS 待验收，详见 STATE |
| V1 飞书本机 | 白名单私聊、上下文复用、主动提醒与恢复、事件去重、保留 Console；无需公网回调地址 | 已实现，39项自动化测试通过；手机私聊、主动提醒与 pending 任务重启恢复核心闭环已实测，去重和鉴权仍以自动化证据为主 |
| V1.2 Session 持久化 | Pi 原生 JSONL、Console/飞书隔离、正常重启恢复、保持 Task 独立及工具白名单 | 已实现，42项自动化测试通过；用户已实测真实飞书重启后上下文恢复 |
| V2.0 长期 Memory | 四类统一服务、显式写入、关键词检索、可重建索引、低信任临时 Context、新 Session 命中 | 已实现；实际自动化结果及待真实飞书验收见 STATE |
| 后续 | 审查并真实验收 V2.0，按证据规划 V2.1 自动分类/提取/语义冲突处理 | 本次不自动开展 |

本阶段不做自动提取、Embedding、向量库、Observer、自主 Skill、周期任务、WebUI、复杂框架或 VPS。架构或范围调整先说明并取得确认，再同步本文及 STATE。
