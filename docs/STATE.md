# Personal Agent 当前状态与交接

更新日期：2026-10-20（Asia/Taipei）。此文件是当前快照；稳定架构见 [PROJECT.md](PROJECT.md)，开发规则见 [AGENTS.md](../AGENTS.md)，运行方法见 [README.md](../README.md)。

## 当前阶段与进行中事项

- 阶段：V1 飞书 Bot 核心本机闭环已完成真实手动验收：手机私聊、一次性任务创建、主动提醒和 pending 任务重启恢复；自动化39项通过。VPS 不在本次范围。
- 本次工作：按用户授权完成本机飞书配置与启动，三项飞书参数已写入被 Git 忽略的 `.env`（权限0600），保留原有 DeepSeek 与时区配置；未改动 Runtime、Pi 适配或工具权限。实际任务库已由现有服务正常打开，启动前仅有2个 succeeded 任务，无待执行任务。
- 协作规则调整：用户已确认授权范围内可自主修改和测试；核心方案、高风险权限、删除数据、批量改写、推送或范围外事项仍先确认。
- 进行中：无新增代码开发。版本1.0.0已发布，用户在自己的终端完成重启恢复，手机截图与数据库确认单次执行、单次投递且无错误。用户已授权提交本次三份联调文档并将最新 main 推送 GitHub，供 ChatGPT 审查；不操作用户当前进程。去重/未授权等真实场景可另行补充。
- Git：已初始化本地 `main` 分支，`origin` 指向 [DongRuibo/Persistent-Personal-Agent](https://github.com/DongRuibo/Persistent-Personal-Agent)。首次发布包含源码、测试、文档与依赖锁文件，排除 `.env`、数据库、`node_modules/` 和 `dist/`。最新提交及同步状态通过 `git log -1`、`git status -sb` 与 `git ls-remote origin main` 核对。

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
| 2026-10-20 | 脱敏核对 DeepSeek 配置，通过真实 API 的执行与任务调度探测；旧证据保留如下 |
| 2026-10-20 | 按用户授权整理联调文档提交及 GitHub main 同步；核对远端已包含 V1 代码1509ccc，检查本机凭据与运行数据未被跟踪 |
| 2026-10-20 | 用户终端实测重启恢复成功，手机收到原任务提醒；只读核对任务单次执行、单次投递且无错误，记录核心本机闭环验收结果 |

## 验证记录与证据边界

- 当前环境：macOS，Node `v26.3.1`，npm `11.16.0`；项目运行要求 Node >=24.15.0。
- 最近代码验证日期：2026-10-20。下表是本次 V1 开发实际执行的结果。

| 最近代码检查 | 实际结果 |
| --- | --- |
| 文档事实及相对链接 | 4份文档45个本地链接有效，`git diff --check` 通过；32个已跟踪文件未发现本机凭据或私钥，未跟踪 `.env`、数据库或构建产物；本次提交仅3份文档 |
| `npm run typecheck` | 通过，退出码0；包含源代码和测试类型检查 |
| `npm run build` | 通过，退出码0；重新生成 `dist/` |
| `npm test` | 39通过、0失败、0跳过，退出码0；包含原有测试、V1 业务与 SDK/进程测试，临时本机监听已获权限 |
| `npm start -- --help` | 通过，构建入口显示 Console、daemon、feishu 三种模式；未启动服务或触碰实际数据库 |

Git 基线：V0 为 `8695610`，V1 代码为 `1509ccc`（`feat: add Feishu bot channel and proactive task notifications`）；已通过 GitHub 连接器确认 V1 代码存在于远端 main。本次三份联调文档随 `docs: record V1 Feishu live validation` 提交交付，目标为 origin/main，用户已明确授权提交和推送；具体最新标识见 Git 历史。联调时重新运行 `npm run build` 已通过；本次仅提交文档，类型检查与39项测试沿用此前结果，未重复运行。

自动化证据：39项测试使用模拟模型/飞书服务和虚拟凭据。真实 Pi SDK 与飞书官方 Dispatcher 组合验证工具创建任务及可信路由；官方发送客户端使用模拟 HTTP 验证格式与错误脱敏；真实官方 WSClient 使用本机 WebSocket 握手验证就绪与关闭。SQLite 重开测试验证 pending 目标、跨重启去重和不依赖新消息的主动投递，进程测试验证 Console/daemon 与启动保护。上述自动化测试没有调用真实飞书或收费模型。

飞书手动验收第1–4项（实际私聊、飞书建任务、主动通知、重启后通知）核心闭环已通过：重启步骤由用户报告，手机截图确认提醒到达，数据库确认单次执行与成功投递。去重、未授权隔离和旧测试回归已有自动化验证；尚未进行真实事件重投、第二账号隔离或完整多轮/取消验收，不把这些场景标为真实测试通过。

### V1 本机真实连接证据

- 浏览器已登录的当前应用成员选择器确认本人身份，凭据只写入本机 `.env`；没有新增权限、发送调试消息或输出密钥。
- `npm run build` 退出码0；通过项目的 `readConfig` / `readFeishuConfig` 校验，`.env` 权限0600且仍被 Git 忽略。
- 本轮曾以 `npm start -- --feishu` 启动，日志为 `用户时区=Asia/Shanghai；中断记录=0；模式=feishu`；保留用户原有时区设置。随后按用户要求正常发出 Ctrl+C，确认开发者实例退出并释放锁；之后由用户终端启动并完成重启恢复测试。
- 飞书“事件与回调”点击“验证”后显示“连接成功”；开发者在此停止配置，由用户接手保存、添加消息事件和发布。用户随后截图确认版本1.0.0已发布、应用已启用，本地进程持续运行。
- 用户手机截图确认“你好”收到模型回复；SQLite 只读核对对应飞书 Run：开始 `2026-10-20T09:01:28.873Z`，结束 `2026-10-20T09:01:30.214Z`，状态 succeeded，1条模型调用、1条 agent_settled、1条 delivery_succeeded，无 error 或 deliveryError。
- 第一条 target.channel=feishu 的真实任务：到期 `2026-10-20T09:06:42.196Z`，开始 `2026-10-20T09:06:42.746Z`，完成 `2026-10-20T09:06:44.170Z`；任务和 Run 均 succeeded，1条模型调用、1条 delivery_succeeded，无 deliveryError。此条确认发送 API 接受投递。
- 重启恢复实测任务 `4ca4b16f-ba69-4b07-87e9-6304dfe24972`：创建 `2026-10-20T09:21:13.712Z`，到期 `2026-10-20T09:23:13.712Z`，开始 `2026-10-20T09:23:14.413Z`，完成 `2026-10-20T09:23:16.120Z`。用户报告自行重启后恢复成功，手机截图确认17:23收到提醒；SQLite 只读核对 status=succeeded、runCount=1、delivery_succeeded=1、runsWithErrors=0。未独立采集用户重启前后 PID/启动日志，重启动作依据用户实测反馈。

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
2. 本轮只读核对数据库并更新 README / PROJECT / STATE，运行文档检查；代码未变，未重复类型检查、构建或39项自动化测试，未发起新模型请求。
3. 向审查者提供 GitHub main 中的 README、PROJECT、STATE，以及从8695610起的 V1 代码差异；联调记录随本次文档提交交付。后续 PR 或 VPS 部署需另行明确任务。

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
