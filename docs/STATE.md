# Personal Agent 当前状态与交接

更新日期：2026-10-20（Asia/Taipei）。此文件是当前快照；稳定架构见 [PROJECT.md](PROJECT.md)，开发规则见 [AGENTS.md](../AGENTS.md)，运行方法见 [README.md](../README.md)。

## 当前阶段与进行中事项

- 阶段：V1 飞书 Bot 核心本机闭环已完成真实手动验收：手机私聊、一次性任务创建、主动提醒和 pending 任务重启恢复；自动化39项通过。VPS 不在本次范围。
- 本次工作：将 V1 真实验收整理为有日期、步骤、实际结果和证据边界的记录，只读复核指定 SQLite 样本。本轮仅修改本 STATE，未改动代码、配置、数据库或用户进程，未新增模型调用或统计功能。
- 协作规则调整：用户已确认授权范围内可自主修改和测试；核心方案、高风险权限、删除数据、批量改写、推送或范围外事项仍先确认。
- 进行中：无新增代码开发。版本1.0.0已发布，核心真实验收完成；本轮补充结构化工程证据和未来统计口径。去重/未授权等真实场景可另行补充，尚不实现成功率、Token 或恢复率统计。
- Git：已初始化本地 `main` 分支，`origin` 指向 [DongRuibo/Persistent-Personal-Agent](https://github.com/DongRuibo/Persistent-Personal-Agent)。首次发布包含源码、测试、文档与依赖锁文件，排除 `.env`、数据库、`node_modules/` 和 `dist/`。最新提交及同步状态通过 `git log -1`、`git status -sb` 与 GitHub main 提交记录核对。

## 已完成功能

- 终端对话与一次性任务创建、查询、仅 pending 取消；确定性命令可直接调用 Task Service。
- 独立 Scheduler 与 `--daemon` 入口，不依赖 stdin；后台串行执行，结果通过统一 `Channel.sendMessage()` 输出到控制台。
- SQLite 保存任务、Run、执行事件和模型调用；事务领取与唯一约束防重复领取，进程锁防同库双启动。
- 重启恢复 pending，遗留 running 标记 interrupted；失败、中断、投递失败不自动重跑任务。
- UTC ISO 时间存储，IANA 用户时区解析，支持 README 列出的中文时间；拒绝歧义和 DST 重叠/不存在时间。
- AgentExecutor 封装原版 Pi Session：交互会话进程内复用，后台每任务独立；检查 `agent_settled`、模型/工具错误、截断和中断，记录可观察的模型用量。
- 交互三项任务工具白名单，后台无工具；内存凭据和 Session，关闭自动资源发现与隐式重试。
- V1 新增 `--feishu` 入口，使用官方 SDK 1.76.0 的 WebSocket 长连接；白名单 open_id、文本私聊，模型与回复串行使用同一交互 Session，后台继续独立 Session。
- Task 持久化渠道、App ID、chat_id、用户 open_id；消息目标由可信上下文绑定，模型不能指定。旧 V0 SQLite 增量加列与接收去重表，旧任务仍是 Console，保留原有内容和状态。
- `(appId, message_id)` 与 Run 原子落盘去重，重投及重启后重投不再调用模型；发送失败保存 deliveryError，成功任务不重跑。Console/daemon 发现 pending 飞书任务会拒绝启动，避免使用错误渠道消耗提醒。
- Memory 仅接口；未新增 Memory、Observer、周期任务、WebUI、Outbox、外部队列服务或 VPS 配置。

## 最近关键修改（最多5项）

| 日期 | 修改及位置 |
| --- | --- |
| 2026-10-20 | V1 新增 FeishuChannel / FeishuSdkTransport / ChannelRouter，接入私聊、官方 SDK 和 `--feishu` 入口 |
| 2026-10-20 | V1 扩展 Task 目标与 SQLite 增量迁移、接收去重、启动保护及相关测试；更新 README 配置步骤与通知丢失窗口 |
| 2026-10-20 | 按日期、步骤、实际结果及未验证场景整理 V1 验收表，复核 SQLite 样本并明确未来统计口径；历史 DeepSeek 证据保留如下 |
| 2026-10-20 | 按用户授权整理联调文档提交及 GitHub main 同步；核对远端已包含 V1 代码1509ccc，检查本机凭据与运行数据未被跟踪 |
| 2026-10-20 | 用户终端实测重启恢复成功，手机收到原任务提醒；只读核对任务单次执行、单次投递且无错误，记录核心本机闭环验收结果 |

## 验证记录与证据边界

- 当前环境：macOS，Node `v26.3.1`，npm `11.16.0`；项目运行要求 Node >=24.15.0。
- 最近代码验证日期：2026-10-20。下表是本次 V1 开发实际执行的结果。

| 最近代码检查 | 实际结果 |
| --- | --- |
| 文档事实及相对链接 | 本轮只读核对2条真实任务和1条真实对话，23个本地链接有效，敏感信息检查及 `git diff --check` 通过；此前交付已检查32个已跟踪文件和4份文档45个本地链接 |
| `npm run typecheck` | 通过，退出码0；包含源代码和测试类型检查 |
| `npm run build` | 通过，退出码0；重新生成 `dist/` |
| `npm test` | 39通过、0失败、0跳过，退出码0；包含原有测试、V1 业务与 SDK/进程测试，临时本机监听已获权限 |
| `npm start -- --help` | 通过，构建入口显示 Console、daemon、feishu 三种模式；未启动服务或触碰实际数据库 |

Git 基线：V0 为 `8695610`，V1 代码为 `1509ccc`，上一份联调文档为 `4354d85`（`docs: record V1 Feishu live validation`）；本轮提交前已再次核对本地与 GitHub main 均为4354d85。本轮仅补充本 STATE，随 `docs: structure V1 Feishu acceptance evidence` 提交交付，用户已授权同步至 GitHub main；最新标识与同步结果见本次交付及 Git 历史。联调时 `npm run build` 已通过，本轮未修改代码，类型检查、构建与39项自动化测试沿用此前结果，未重复运行。

自动化证据：39项测试使用模拟模型/飞书服务和虚拟凭据。真实 Pi SDK 与飞书官方 Dispatcher 组合验证工具创建任务及可信路由；官方发送客户端使用模拟 HTTP 验证格式与错误脱敏；真实官方 WSClient 使用本机 WebSocket 握手验证就绪与关闭。SQLite 重开测试验证 pending 目标、跨重启去重和不依赖新消息的主动投递，进程测试验证 Console/daemon 与启动保护。上述自动化测试没有调用真实飞书或收费模型。

飞书手动验收第1–4项（实际私聊、飞书建任务、主动通知、重启后通知）核心闭环已通过：重启步骤由用户报告，手机截图确认提醒到达，数据库确认单次执行与成功投递。去重、未授权隔离和旧测试回归已有自动化验证；尚未进行真实事件重投、第二账号隔离或完整多轮/取消验收，不把这些场景标为真实测试通过。

### V1 真实飞书验收记录（2026-10-20）

环境：Mac 本机 Node 服务、真实模型 API、飞书个人身份的自建应用和手机飞书；代码基线1509ccc，飞书应用版本1.0.0。手机与运行配置时区均为 UTC+8（运行配置 Asia/Shanghai），下方数据库时间均为 UTC。用户负责手机操作和手动重启，开发者负责启动协助及只读数据库核对；本轮复核日期同为2026-10-20。

| 场景 | 实际测试步骤 | 实际结果与证据 | 验收结论 |
| --- | --- | --- | --- |
| 长连接与发布 | 配置当前应用的凭据及本人 open_id；构建并运行 `npm start -- --feishu`；在飞书后台验证连接，由用户配置事件并发布 | 构建退出码0；日志出现模式=feishu；后台显示“连接成功”；用户截图显示1.0.0已发布、应用已启用 | 通过，启动日志与平台页面证据 |
| 手机双向私聊 | 手机以创建应用的同一身份私聊机器人，发送“你好” | 手机截图显示收到回复；对应 Run succeeded，1次模型响应、1次 agent_settled 和1次成功投递，无执行或投递错误 | 通过，手机截图与数据库共同确认 |
| 一次性任务与后台执行 | 用户通过飞书创建短时提醒，等待到期由 Scheduler 执行 | 样本A持久化飞书目标；到期任务与 Run 均 succeeded，1次模型调用、1次成功投递，无错误 | 创建、执行与发送确认通过；此样本未单独保留手机到达截图 |
| pending 重启恢复及主动通知 | 用户创建两分钟后提醒，在自己的终端停止并重启服务，等待原任务；未重新创建该任务 | 用户明确报告恢复成功；手机截图显示 pending 创建确认及17:23主动提醒；样本B为同一任务，只有1条 Run、1条成功投递记录，无错误 | 核心场景通过；重启动作依据用户实测，手机到达与执行记录可交叉核对 |

数据库样本（本轮通过 `DatabaseSync` 的 readOnly 模式复核，不导出消息正文、接收人或凭据）：

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

- V1 手机私聊、任务创建、主动通知及重启恢复已有真实核心闭环证据；取消、多轮、真实事件重投及第二账号隔离未逐项实测。当前由用户在 Mac 终端管理进程，未配置开机自启动或 VPS，退出或睡眠仍会影响服务。
- 交互历史不跨重启保存，自动压缩关闭；长对话可能达到上下文限制。
- 时间解析是有界语法，不支持任意自然语言、Cron 或周期任务；不明表达要求补充。
- 后台串行执行；慢任务会延后后续任务。未做通知 Outbox：提交结果后发送前崩溃可丢通知，发送超时可能已送达，长消息可能只送达部分；失败仅记录，不重跑任务或自动重发。
- 入站去重提交后执行前崩溃可能丢失回复/未执行请求，Run 标记 interrupted 且重投不重放；应先查询任务再决定新请求。去重和 Run 记录暂不自动清理，Mac 睡眠/离线期间不保证准点通知。
- 协作式 abort 依赖供应商/SDK 响应；外部副作用不保证恰好一次，中断后需核实。
- SQLite 未加密、无自动清理；强杀或供应商未报告时用量可能缺失，费用不是供应商账单。
- 未来可靠通知需将结果和 Outbox 同事务提交，只独立重试投递，使用稳定消息标识和分片进度；本次没有实现该升级或永久恰好一次保证。

## 下一步与需要提供的信息

1. 保持当前 V1 范围，不继续新增功能。核心闭环已验收，可按需要补充上下文、取消和连续消息的真实测试；用户现有进程由其自行管理。
2. 本轮只读核对数据库并更新本 STATE，运行文档检查；代码未变，未重复类型检查、构建或39项自动化测试，未发起新模型请求。工程统计仅记录未来口径，不提前实现。
3. 本轮结构化验收补充随本次文档提交交付，按用户授权同步 GitHub main。审查时提供最新 STATE 与从8695610起的 V1 差异；后续 PR、部署或统计开发按明确任务推进。

## 本次文件变更

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
