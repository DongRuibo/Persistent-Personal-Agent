# Personal Agent：V0 基础与 V1 飞书 Bot

单用户、单进程 TypeScript 服务，复用原版 Pi Coding Agent SDK 的 Agent Loop。提供终端/飞书私聊、一次性任务、SQLite 持久化和独立后台调度。V1 仅新增飞书渠道，当前按 Mac 本地运行交付，未做真实飞书联调或 VPS 部署。

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

## 后台服务与 VPS

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
4. 按[官方获取 Open ID 指南](https://open.feishu.cn/document/home/user-identity-introduction/open-id)，在 API 调试台选择**当前应用**，将用户 ID 类型设为 `open_id`，通过成员选择器选择自己并复制 `ou_...`。不要用另一个应用的 open_id、union_id 或 user_id。若改用手机号/邮箱查询 ID，按该接口额外申请 `contact:user.id:readonly`；运行 Bot 本身不要求这一额外权限。
5. 在本机现有 `.env` 中追加以下三项，保留原有 DeepSeek/模型配置：

   ```dotenv
   FEISHU_APP_ID=cli_0123456789abcdef
   FEISHU_APP_SECRET=<REDACTED>
   FEISHU_ALLOWED_OPEN_ID=ou_your_open_id
   ```

   三项均须替换为自己的真实值。缺少白名单、凭据或格式无效会拒绝启动，不提供临时开放所有用户的模式。`open_id` 虽非密钥，也无需发送给开发者。
6. 在“事件与回调”中选择“使用长连接接收事件”，订阅**应用身份**的 `im.message.receive_v1`（接收消息）。如果平台提示先建立连接，先按下面命令启动本地进程，再回页面保存订阅；无需填写公网地址、Verification Token 或 Encrypt Key。长连接方式参见[官方 SDK 说明](https://github.com/larksuite/node-sdk/blob/main/README.zh.md)；具体页面以开放平台当前显示为准。
7. 创建应用版本并发布，使机器人能力、权限和事件配置生效；将应用可用范围限制为自己。平台要求管理员审批时，需由你完成。权限或事件修改后，按平台要求重新发布。
8. 在 Mac、iPhone 的飞书中登录同一企业内的同一用户，搜索该机器人并进入私聊。Mac 上的 Agent 进程必须保持运行、联网且未睡眠；手机只是交互入口，任务在 Mac 执行。停机/睡眠期间的 pending 提醒会在恢复运行后补执行，不能保证原定时刻送达。

### 本机启动和手动验收

```sh
npm run build
npm start -- --feishu
```

看到 `模式=feishu` 表示 SDK 已报告首次 WebSocket 握手成功；`WSClient.start()` 返回本身不作为已连通依据。初始连接30秒内未确认就绪会失败退出。保持该终端运行，用 Ctrl+C 停止；重启仍使用相同命令、数据库、App ID 和白名单。

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

目前**未实现通知 Outbox**，存在以下故障窗口：

1. Run/任务结果已经提交，发送前进程崩溃：任务保持 succeeded，通知可能永久丢失，甚至没有机会记录 deliveryError。
2. 飞书已接收但客户端超时，或发送后尚未记录 `delivery_succeeded` 就崩溃：送达状态不确定，不自动重发，也不重新调用模型。长消息分片可能只送达前半部分。
3. 入站去重已提交但模型尚未执行就崩溃：该消息仍算接收过，Run 恢复为 interrupted，重投不会自动重放，以免重复创建已产生副作用的任务。用户应先发新消息查询任务，再决定是否重新提出请求。排队消息只在内存中，未实现入站补偿。

后续可靠投递可在**提交任务结果的同一 SQLite 事务**写入通知 Outbox，由独立投递循环领取记录、使用稳定消息标识和分片进度重试并确认送达；只重试投递，不重跑 Agent。仍需遵守飞书幂等窗口及限流，不能宣称外部恰好一次。本版仅说明该升级方向，不实现。

## 时间规则

- `USER_TIMEZONE` 是 IANA 命名时区，例如 `Asia/Taipei`、`Asia/Shanghai`、`America/New_York`。
- 数据库所有时间字段使用规范 UTC ISO 字符串，例如 `2026-10-21T01:00:00.000Z`。服务器的 `TZ` 不参与时间解析。
- 支持 `今天/明天/后天 + 凌晨/早上/上午/中午/下午/晚上 + N点/时 + 分钟/半`，例如“明天上午九点”“后天下午三点半”。
- 支持“N秒/分钟/小时/天后”（常见中文数字或阿拉伯数字）、`YYYY-MM-DD HH:mm[:ss]` 用户当地时间、带 UTC 偏移的 ISO 时间。
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

- `contracts.ts` 定义业务接口；Pi 类型只存在于 Pi 适配层 `pi-executor.ts` 和 `task-tools.ts`，V1 未改动这两个文件。
- Task 状态由 SQLite 管理，Pi Session 只保存当前执行上下文。交互 Session 在进程内复用，每次后台任务新建 Session 并释放，二者不混入对话历史。
- Scheduler 只依赖 `AgentExecutor`、存储和 `Channel.sendMessage()`；ChannelRouter 根据任务的持久化目标路由到 Console 或 FeishuChannel，飞书官方 SDK 仅封装在 FeishuSdkTransport 中。
- Memory 仅定义接口，未实现、未调用。没有 WebUI、周期任务或复杂工作流。

任务状态：`pending → running → succeeded / failed / interrupted`；`pending → cancelled`。

领取任务和创建执行记录在同一 `BEGIN IMMEDIATE` 事务中提交，条件更新和 `UNIQUE(taskId)` 防止一次性任务被重复领取。只有 pending 能取消，不能撤销已经发生的操作。

启动获得独占锁后，将遗留 running 执行及任务标记 interrupted，保留 pending；失败和中断均不自动重试。需要继续时先查看结果、核实副作用，再手动创建新任务。这不是外部副作用“恰好一次”保证。

`message_end` 用于保存每次模型响应的用量；`agent_end` 只表示底层一轮结束；收到 `agent_settled` 后还需检查 aborted、模型错误、工具错误、输出截断和最终文本，才能提交成功。Pi 执行结束、SQLite 任务提交成功、渠道投递成功是独立阶段。投递失败保留成功的任务结果和 `deliveryError`，不重跑任务，也不自动重发消息。

## 安全与日志

- 交互白名单只有 `create_task`、`list_tasks`、`cancel_task`；后台 Session 无工具。没有 Shell、任意文件读写、浏览器或通用网络工具。
- SDK 使用内存凭据、设置和 Session，自定义空资源加载器不发现本机扩展、Skills、AGENTS、模板或 MCP；不读取全局 Pi 配置，不保存 Key 到 Pi 认证文件。
- 关闭 Agent 自动重试、Provider HTTP 重试、自动压缩、缓存预热和 SDK 可配置的分析功能。保留原版 Pi SDK 及 Agent Loop。
- 服务自身仍会写 SQLite，并向指定 LLM API 和启用的飞书服务发请求。工具白名单属于应用能力边界，不是操作系统沙箱。模型会收到对话和当前任务内容。
- `.env`、数据库、构建产物及依赖目录已加入 `.gitignore`。启动设置 umask 0077，新建数据目录权限0700。已有文件权限需要自行检查。
- `tasks` 保存任务及投递目标；`runs` 保存结果、错误和投递错误；`run_events` 保存执行生命周期；`model_calls` 保存 Provider、模型、token、stopReason 和费用；`feishu_messages` 保存消息 ID 和 Run 关联。错误及输出中的已配置模型 Key、App Secret 和常见认证内容会脱敏，不记录 HTTP 头或原始请求。
- 模型用量仅能记录 SDK 实际观察到的响应；进程被强杀、网络中断或供应商未报告用量时可能缺失。内置模型费用来自 SDK 价格估算，并非账单；兼容端点费用未知。
- SQLite 未加密，会保留任务文本和生成结果。V0 没有自动清理；不要把 Key 写进任务或提示词。

## 验证与限制

`npm run typecheck` 同时检查源代码和测试；`npm run build` 输出到 `dist/`；`npm test` 使用 Node 内置测试框架。

测试覆盖时间解析、服务器时区独立性、DST、取消与领取、SQLite 重开恢复、调度关闭、通知失败、用量与脱敏、Pi 生命周期及会话隔离。集成测试在 `127.0.0.1` 上运行临时模拟 Chat Completions API，使用虚拟 Key；进程测试会启动并关闭临时服务及数据库。在禁止回环监听的沙箱内需要允许本地监听。

当前自动化测试39项全部通过，包含 V0 原有测试，以及鉴权、跨重启去重、提醒目标恢复、串行处理、投递失败不重跑、旧库迁移和启动保护。官方 WSClient 在临时本机 WebSocket 服务上验证首次握手与关闭；官方事件 Dispatcher 接入真实 Pi SDK、模拟模型 API 验证工具目标传递；官方发送客户端以模拟 HTTP 验证序列化和凭据脱敏。

这些均为**模拟飞书服务/模型 API 测试，不代表真实飞书联调成功**。用户尚未创建飞书应用，Mac/iPhone 实际收发、权限生效、服务重启后的真实提醒均待按上面的手动步骤验收。DeepSeek 的 V0 真实调用证据与用户报告的 V0 本机重启测试单独记录在 [STATE](docs/STATE.md)，不扩大为 V1 飞书证据；Linux VPS 本次不部署。

当前限制：不持久化对话历史、没有上下文自动压缩；长对话达到模型上下文限制后需要重启交互会话。服务采用协作式取消，若供应商/SDK 无法响应 abort，退出可能延迟；systemd 强制停止后，下次启动会标记遗留执行中断。崩溃可能发生在结果生成后或通知投递前，不保证通知一定送达。

下一步由用户完成飞书应用与本机凭据配置，再验收真实 Mac/iPhone 私聊和主动提醒；Memory、Observer、周期任务、WebUI 暂不开发。本版只延用已有执行日志接口，未新增 Observer 系统或 Temporal 工作流框架。

官方参考：[Pi SDK](https://pi.dev/docs/latest/sdk)、[1.3.0 完整控制示例](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/examples/sdk/12-full-control.ts)、[Node SQLite](https://nodejs.org/api/sqlite.html)。
