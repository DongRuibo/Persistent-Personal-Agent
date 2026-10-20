# Personal Agent 当前状态与交接

更新日期：2026-10-20（Asia/Taipei）。此文件是当前快照；稳定架构见 [PROJECT.md](PROJECT.md)，开发规则见 [AGENTS.md](../AGENTS.md)，运行方法见 [README.md](../README.md)。

## 当前阶段与进行中事项

- 阶段：V1 飞书 Bot 本机实现和自动化测试完成；用户尚未创建飞书应用，真实 Mac/iPhone 联调待配置，VPS 不在本次范围。
- 本次工作：在 V0 上新增飞书官方 SDK 适配、白名单私聊、接收去重、持久化通知目标和消息路由；保留 Console、Pi SDK 1.3.0 和现有任务/Session 边界。未修改 `.env`、Pi 适配源码或实际用户任务数据库。
- 协作规则调整：用户已确认授权范围内可自主修改和测试；核心方案、高风险权限、删除数据、批量改写、推送或范围外事项仍先确认。
- 进行中：代码工作已结束；等待用户按 README 创建企业自建应用并在本机配置三项飞书参数，再进行真实收发/提醒/重启验收。不要求用户发送真实密钥。
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
| 2026-10-20 | 按用户授权整理 V1 本地 Git 提交，复核变更范围、忽略规则和敏感信息；不推送远端 |
| 2026-10-20 | 创建 AGENTS、PROJECT、STATE，用户确认授权范围内自主实现和逐任务交接规则 |

## 验证记录与证据边界

- 当前环境：macOS，Node `v26.3.1`，npm `11.16.0`；项目运行要求 Node >=24.15.0。
- 最近代码验证日期：2026-10-20。下表是本次 V1 开发实际执行的结果。

| 最近代码检查 | 实际结果 |
| --- | --- |
| 文档事实及相对链接 | 4份文档45个本地链接有效，`git diff --check` 通过；21个改动/新增文件未发现配置凭据或常见密钥模式 |
| `npm run typecheck` | 通过，退出码0；包含源代码和测试类型检查 |
| `npm run build` | 通过，退出码0；重新生成 `dist/` |
| `npm test` | 39通过、0失败、0跳过，退出码0；包含原有测试、V1 业务与 SDK/进程测试，临时本机监听已获权限 |
| `npm start -- --help` | 通过，构建入口显示 Console、daemon、feishu 三种模式；未启动服务或触碰实际数据库 |

Git 基线：首次提交 `8695610` 已上传；开始 V1 时已有 DeepSeek 联调的 PROJECT / STATE 本地更新，已保留。用户已授权将 V1 代码、测试和文档创建本地提交，提交说明为 `feat: add Feishu bot channel and proactive task notifications`，标识通过 `git log -1` 获取；本次不推送远端。提交整理未修改代码，沿用本轮已通过的类型检查、构建与39项测试，重新检查 diff 和暂存内容。

自动化证据：39项测试使用模拟模型/飞书服务和虚拟凭据。真实 Pi SDK 与飞书官方 Dispatcher 组合验证工具创建任务及可信路由；官方发送客户端使用模拟 HTTP 验证格式与错误脱敏；真实官方 WSClient 使用本机 WebSocket 握手验证就绪与关闭。SQLite 重开测试验证 pending 目标、跨重启去重和不依赖新消息的主动投递，进程测试验证 Console/daemon 与启动保护。没有调用真实飞书，也没有为 V1 再调用收费模型。

飞书手动验收1–4（实际私聊、建任务、主动通知、重启后通知）仍待用户创建应用；去重、未授权隔离和旧测试回归已由自动化验证，不能标成真实飞书验收通过。平台权限、事件订阅、App Secret 和用户 open_id 配置步骤在 README。

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

- DeepSeek 的 V0 本地闭环已有证据，真实飞书及 VPS 验收未完成；用户明确尚未创建飞书应用。本次不部署 VPS。
- 交互历史不跨重启保存，自动压缩关闭；长对话可能达到上下文限制。
- 时间解析是有界语法，不支持任意自然语言、Cron 或周期任务；不明表达要求补充。
- 后台串行执行；慢任务会延后后续任务。未做通知 Outbox：提交结果后发送前崩溃可丢通知，发送超时可能已送达，长消息可能只送达部分；失败仅记录，不重跑任务或自动重发。
- 入站去重提交后执行前崩溃可能丢失回复/未执行请求，Run 标记 interrupted 且重投不重放；应先查询任务再决定新请求。去重和 Run 记录暂不自动清理，Mac 睡眠/离线期间不保证准点通知。
- 协作式 abort 依赖供应商/SDK 响应；外部副作用不保证恰好一次，中断后需核实。
- SQLite 未加密、无自动清理；强杀或供应商未报告时用量可能缺失，费用不是供应商账单。
- 未来可靠通知需将结果和 Outbox 同事务提交，只独立重试投递，使用稳定消息标识和分片进度；本次没有实现该升级或永久恰好一次保证。

## 下一步与需要提供的信息

1. 用户按 README 创建飞书企业自建应用、开启 Bot、申请私聊接收/应用发消息权限，选择 WebSocket 长连接并订阅 `im.message.receive_v1`，发布并将可用范围限制为自己。
2. 在现有本机 `.env` 追加 `FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_ALLOWED_OPEN_ID`，保留 DeepSeek 配置；`npm run build` 后运行 `npm start -- --feishu`。只需告诉开发者“已配置”或提供脱敏错误，**不要发送 Key、App Secret 或完整 `.env`**。
3. 在 Mac/iPhone 私聊验证“你好”、上下文、1分钟提醒、到期前退出并同命令重启后通知。使用同一 DATABASE_PATH、App ID 和白名单，保持 Mac 运行/联网/唤醒。
4. VPS 和 Git 推送需另行明确任务；V1 本地提交不代表远端已同步。

## 本次文件变更

| 范围 | 文件 |
| --- | --- |
| 新增飞书与路由 | [feishu-channel.ts](../src/feishu-channel.ts)、[feishu-transport.ts](../src/feishu-transport.ts)、[channel-router.ts](../src/channel-router.ts) |
| 入口与配置 | [main.ts](../src/main.ts)、[config.ts](../src/config.ts)、[console-channel.ts](../src/console-channel.ts) |
| 任务与消息边界 | [contracts.ts](../src/contracts.ts)、[task-service.ts](../src/task-service.ts)、[sqlite-store.ts](../src/sqlite-store.ts)、[scheduler.ts](../src/scheduler.ts) |
| 自动化测试 | 新增 [feishu-channel.test.ts](../tests/feishu-channel.test.ts)、[feishu-transport.test.ts](../tests/feishu-transport.test.ts)；扩展 [config.test.ts](../tests/config.test.ts)、[pi-integration.test.ts](../tests/pi-integration.test.ts)、[service.test.ts](../tests/service.test.ts) |
| 依赖与样例 | [package.json](../package.json)、[package-lock.json](../package-lock.json)、[.env.example](../.env.example) |
| 说明与交接 | [README.md](../README.md)、[PROJECT.md](PROJECT.md)、本 STATE；保留本次开始前的 DeepSeek 文档更新 |

未修改 `src/pi-executor.ts`、`src/task-tools.ts`、Pi SDK 源码、AGENTS 规则或实际 `.env`。未新增运行框架。

## 给下一位开发者或 AI

先读 AGENTS → PROJECT → STATE，再检查相关代码及当前改动，确定一个任务与验收目标。向 ChatGPT 交接时提供 PROJECT、STATE 和问题相关代码/diff，必要时补 AGENTS；讨论结论不自动扩大授权。任务结束后覆盖更新此快照，报告真实测试结果及未验证事项，无需复制完整聊天历史。
