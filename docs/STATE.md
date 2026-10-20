# Personal Agent 当前状态与交接

更新日期：2026-10-20（Asia/Taipei）。此文件是当前快照；稳定架构见 [PROJECT.md](PROJECT.md)，开发规则见 [AGENTS.md](../AGENTS.md)，运行方法见 [README.md](../README.md)。

## 当前阶段与进行中事项

- 阶段：V2.0 长期 Memory 基础系统；保留 V1 飞书核心闭环与 V1.2 跨重启上下文真实验收记录。继续 Mac 本地开发，不部署 VPS。
- 本次工作：四类统一 FileMemoryService、SQLite + Markdown、显式写入门、去重/版本/修复、有预算的 Pi 公开 Context 投影、受控工具和自动化。基于干净 main `87bff5c` 实施，保留 `c2ffcce` 后的诊断和模型验证改动；未操作真实 `.env`、用户进程、任务库、历史或飞书服务，未发真实收费 API 请求。
- 协作规则调整：用户已确认授权范围内可自主修改和测试；核心方案、高风险权限、删除数据、批量改写、推送或范围外事项仍先确认。
- 进行中：代码、文档与自动化已完成；用户已明确授权将 V2.0 源码、测试和文档提交并推送到 GitHub main，供 ChatGPT 审查。Memory 的真实飞书验收留给用户，不开展 V2.1。
- Git：已初始化本地 `main` 分支，`origin` 指向 [DongRuibo/Persistent-Personal-Agent](https://github.com/DongRuibo/Persistent-Personal-Agent)。首次发布包含源码、测试、文档与依赖锁文件，排除 `.env`、数据库、`node_modules/` 和 `dist/`。最新提交及同步状态通过 `git log -1`、`git status -sb` 与 GitHub main 提交记录核对。

## 已完成功能

- 终端对话与一次性任务创建、查询、仅 pending 取消；确定性命令可直接调用 Task Service。
- 独立 Scheduler 与 `--daemon` 入口，不依赖 stdin；后台串行执行，结果通过统一 `Channel.sendMessage()` 输出到控制台。
- SQLite 保存任务、Run、执行事件和模型调用；事务领取与唯一约束防重复领取，进程锁防同库双启动。
- 重启恢复 pending，遗留 running 标记 interrupted；失败、中断、投递失败不自动重跑任务。
- UTC ISO 时间存储，IANA 用户时区解析，支持 README 列出的中文时间；拒绝歧义和 DST 重叠/不存在时间。
- AgentExecutor 封装原版 Pi Session：交互会话进程内串行复用、原生 JSONL 跨重启恢复，后台每任务独立且临时；检查 `agent_settled`、模型/工具错误、截断和中断，记录可观察的模型用量。
- 交互三项任务工具与五项受控 Memory 工具白名单，后台无工具、仅宿主只读检索；内存凭据与设置，关闭自动资源发现与隐式重试。
- V1.2 新增 `SESSION_DIR`，默认 `<DATABASE_PATH>.sessions`；Console 与飞书应用/白名单用户分开存储，目录0700、文件0600，不扫描其他 Pi 会话，不因恢复重放历史请求或工具。
- V1 新增 `--feishu` 入口，使用官方 SDK 1.76.0 的 WebSocket 长连接；白名单 open_id、文本私聊，模型与回复串行使用同一交互 Session，后台继续独立 Session。
- Task 持久化渠道、App ID、chat_id、用户 open_id；消息目标由可信上下文绑定，模型不能指定。旧 V0 SQLite 增量加列与接收去重表，旧任务仍是 Console，保留原有内容和状态。
- `(appId, message_id)` 与 Run 原子落盘去重，重投及重启后重投不再调用模型；发送失败保存 deliveryError，成功任务不重跑。Console/daemon 发现 pending 飞书任务会拒绝启动，避免使用错误渠道消耗提醒。
- V2.0 四类 Memory 共用服务与 SQLite 索引：Semantic PROFILE、Project projects、Episodic episodes、Procedural procedures。仅明确记忆意图可写；规范化正文去重、稳定 key 冲突拒绝、版本检查、来源关联 Run、Hash 校验；不自动保存推断或提取全部对话。
- Memory 正文原子替换，索引可重建，启动和读取前修复；目录/文件0700/0600，宿主独占 Memory 锁，拒绝符号链接和凭据。通过 Pi 1.3.0 公开内联扩展和 context 返回本轮投影，工具只留收据，不把注入正文反复追加 Session；Context 异常公开 abort 并报错。
- 未新增依赖、Memory 自动提取、Embedding/向量库、Observer、Skill、周期任务、WebUI、Outbox、外部队列或 VPS 配置。

## 最近关键修改（最多5项）

| 日期 | 修改及位置 |
| --- | --- |
| 2026-10-20 | 新增 memory-service.ts：四类 CRUD、来源/版本/Hash、原子文件与可重建索引、中文检索和预算 |
| 2026-10-20 | 新增 memory-tools.ts；PiExecutor 公开 context 动态投影、工具收据及失败中止，保留交互/后台隔离 |
| 2026-10-20 | main/config 增加 Memory 生命周期、独占锁及目录/预算配置；Channel 传入可信 Run 来源；无密钥变更 |
| 2026-10-20 | 新增 Memory 单元/真实 SDK 模拟集成测试、四类中文最小评测，保留此前44项回归 |
| 2026-10-20 | README / PROJECT / AGENTS 同步四类边界、写入门、故障窗口与人工验收；V1/V1.2 真实历史证据保留如下 |

## 验证记录与证据边界

- 当前环境：macOS，Node `v26.3.1`，npm `11.16.0`；项目运行要求 Node >=24.15.0。
- 最近代码验证日期：2026-10-20。V2.0 最终检查结果见下表；V1/V1.2 真实验收证据另列如下，不能当成 V2.0 真实模型验收。

| 最近代码检查 | 实际结果 |
| --- | --- |
| 文档事实及相对链接 | 4份文档63个本地链接有效；18个变更文件未命中本机凭据；8项运行数据忽略检查通过，Git 无已跟踪运行数据；git diff --check 通过 |
| `npm run typecheck` | 通过，退出码0；包含源码和测试 |
| `npm run build` | 通过，退出码0，生成 dist |
| `npm test` | 57通过、0失败、0跳过，退出码0；此前44项回归保留，新增13项；本地临时监听获权限，全部使用假凭据/临时数据/模拟服务 |

Git 基线：V1.2 为 `c2ffcce`；飞书诊断为 `a65a25b`，硅基流动验证文档为 `87bff5c`。本次从 `87bff5c` 继续实现 V2.0，不回退历史基线。源码、测试与文档统一以 `feat: add V2 long-term memory foundation` 提交交付，目标为 `origin/main`；准确提交标识和同步结果由 `git log -1`、`git status -sb` 及远端 main 核对。真实 `.env` 与全部运行数据不提交。

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
| 真实飞书 Memory | **未执行**。用户需按 README“V2.0”保存事实 → 正常重启 → 全新 SESSION_DIR → 核对 Memory ID/version 与 Run 事件 → 更新/删除 → 后台提醒，不能仅凭“我记得”验收 |

没有调用本机真实模型或飞书，没有读取用户 Memory/Session 正文，没有启动或停止用户进程。上述新测试中的“飞书来源”由可信测试请求模拟；V1 的真实飞书证据与本阶段测试严格分开。

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

- V2.0 真实飞书与当前供应商的记忆写入/使用效果待人工验收；显式意图识别是有界前缀，模型仍可能误分类、选错事实 key 或整理不准，不宣称自动语义冲突解决。
- Memory 检索/修复线性扫描；仅四类关键词检索、每轮最多5条，Context 使用 UTF-8 字节上限作保守 token 近似，长条目会截断；没有 Embedding/通用语义召回、自动提取或完整修订历史。
- Memory 的低信任指令边界不等同于对模型的数学保证。原始用户/助手消息仍持久化，旧事实可能在 Session/Run/备份及 SQLite 空闲页保留；forget 只让当前知识和索引失效，不承诺全链路安全擦除。
- Markdown 与 Memory 索引不构成跨存储事务；文件落盘后索引失败可能已经保存成功，先查状态再处理。坏格式/Hash 会阻止启动或使本轮执行失败，须恢复有效备份；后台失败不自动重试。不支持手改正文自动采纳、硬断电耐久性或崩溃残留临时文件自动清理。

- 用户报告启动后 SDK 告警，随后确认上下文恢复可用；告警发生时是否仍能回复暂未检查。已补安全诊断与重连成功提示，用户需重启到新版才能看到；实际告警根因和持续稳定性尚未确认，不将日志改进称为真实网络故障已修复。
- V1 手机私聊、任务创建、主动通知及重启恢复已有真实核心闭环证据；取消、多轮、真实事件重投及第二账号隔离未逐项实测。当前由用户在 Mac 终端管理进程，未配置开机自启动或 VPS，退出或睡眠仍会影响服务。
- V1.2 交互历史跨重启保存，自动压缩仍关闭；长对话可能达到上下文限制，重启不再清空历史，需要使用新的 SESSION_DIR 开始空会话。升级前未持久化的历史不会从 SQLite 日志自动重建。
- Session 文件未加密、不自动清理；无法读取或被 SDK 判定无效时阻止启动，不额外修复 SDK 容忍的损坏行。它与 SQLite 不构成跨存储事务，强杀/断电可能造成记录不一致或最后一条不完整；不自动补偿或重放，任务状态仍以 SQLite 为准。
- 显式配置 SESSION_DIR 时，每份数据库使用独立目录；锁仍以数据库为单位，不支持多个数据库进程共享同一会话目录。
- 时间解析是有界语法，不支持任意自然语言、Cron 或周期任务；不明表达要求补充。
- 后台串行执行；慢任务会延后后续任务。未做通知 Outbox：提交结果后发送前崩溃可丢通知，发送超时可能已送达，长消息可能只送达部分；失败仅记录，不重跑任务或自动重发。
- 入站去重提交后执行前崩溃可能丢失回复/未执行请求，Run 标记 interrupted 且重投不重放；应先查询任务再决定新请求。去重和 Run 记录暂不自动清理，Mac 睡眠/离线期间不保证准点通知。
- 协作式 abort 依赖供应商/SDK 响应；外部副作用不保证恰好一次，中断后需核实。
- SQLite 未加密、无自动清理；强杀或供应商未报告时用量可能缺失，费用不是供应商账单。
- 未来可靠通知需将结果和 Outbox 同事务提交，只独立重试投递，使用稳定消息标识和分片进度；本次没有实现该升级或永久恰好一次保证。

## 下一步与需要提供的信息

1. 审查 GitHub main 的 V2.0 提交，重点检查唯一写入口、文件/索引一致性、context 公开接口、显式授权与四类知识边界；提交包含本阶段代码、测试和文档。
2. 用户正常停止旧进程、构建并按 README 完成真实飞书 Memory 验收；提供日期、步骤、脱敏结果及命中 ID/版本即可，不提供 Key 或完整私人文件。V1.2 原上下文恢复已实测，无需重复声称待验收。
3. 评审和验收后再决定 V2.1 的自动分类/提取/语义冲突策略；不自动开始 Memory 扩展、Observer、Skill Learning 或 VPS。真实连接若持续告警只提供安全类别/状态码。

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
