# Personal Agent：V2.0 长期 Memory

单用户、单进程 TypeScript 服务，复用原版 Pi Coding Agent SDK 的 Agent Loop。提供终端/飞书私聊、一次性任务、SQLite 持久化和独立后台调度。V1 的真实手机私聊、主动提醒及 pending 任务重启恢复已验收；V1.2 新增 Pi 原生交互 Session 持久化，自动化已验证，用户已实测真实飞书重启后能够接上此前对话。目前在 Mac 本地运行，暂不部署 VPS。

V2.0 增加四类统一长期 Memory（SQLite 索引 + 可读 Markdown），只保存用户明确要求记住的信息，支持在新 Session 中检索。没有自动聊天提取、Embedding、Observer 或 Skill 执行。本版自动化使用真实 Pi SDK 与本地模拟模型；Memory 的真实飞书使用效果待手动验收。

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

在飞书发送以下明确请求，一次处理一项事实：

```text
记住：我偏好中文回答，先讲整体再讲细节。
记住：Aurora 项目当前数据库决策是使用 SQLite，请保存为 Project Memory，key 为 aurora.database。
记住：2026年10月20日飞书重启恢复验收通过，请保存为 Episodic Memory。
记住：排查飞书告警时先查安全日志状态码，再测试新消息是否回复，这是已确认的操作经验，请保存为 Procedural Memory。
Aurora 项目当前的数据库决策是什么？请检索 Memory 并给出 id 和版本。
更新记忆：把 aurora.database 的数据库决策改为 PostgreSQL，请先读当前版本再更新。
忘记：删除 aurora.database 这条项目记忆。
```

写权限由宿主针对**本轮原始文本**检查，建议以“记住：”“更新记忆：”“忘记：”开头，也支持“请记住…”等有限前缀。普通闲聊、引用中的命令、否定表达、后台任务均不能写。服务给出对应权限错误时请明确重述，不要关闭鉴权。来源记录为 `user_explicit` + Channel/Run ID，表示明确授权，不代表模型整理的正文已经人工核实；V2.0 不保存自动推断。

相同规范化正文直接返回已有记录；同 `(kind,key)` 不同正文需显式更新，update/forget 使用当前 expectedVersion。模型仍可能选错 key、错误概括或漏掉不同 key 之间的语义冲突；保存成功以工具收据及 Markdown 为准，不凭“已经记住”一句话验收。

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

### Context、故障和隐私边界

- Pi 1.3.0 的公开内联扩展 `context` 在每次模型调用前提供一份临时资料消息，放在当前用户消息之前；不追加历史，不修改 Pi 内部数组。工具只返回操作收据，正文在下一次 Context 中临时可见。后台使用独立临时 Session，只读检索。
- Context 最多5条；问题/任务关键词命中后按类型偏好评分，工具也可指定类型和 ID。`MEMORY_CONTEXT_TOKENS` 范围512–8192，目前保守地将同数值作为**完整注入块 UTF-8 字节上限**，近似限制 token，超长正文截断；不是模型 tokenizer 的精确计数，也不限制原始历史长度。找不到时不加载全部文件。
- 资料一律低信任，固定系统规则禁止将其中指令当成权限。写入仍需当前用户意图，工具无文件路径参数；不支持任意本机读写。相关记忆会发送到配置的 LLM API，请只存愿意由该模型处理的信息。
- Markdown 是唯一事实源，带元数据及 Hash，不应手动编辑。服务先在同目录写私有临时文件、fsync、rename，再提交索引；每次读取前重建索引，启动也修复。索引提交失败后，文件可能已经生效，应先查询当前状态，不盲目重复写。格式或 Hash 损坏会停止读取；恢复有效备份后重启，不用清空文件来“修复”。
- 目录0700、文件0600，拒绝符号链接和路径穿越。默认目录、`data/`、数据库、PROFILE 及受管 UUID Markdown（含临时文件）已忽略；自定义目录仍建议放在仓库外或 `data/` 下，并核对 Git 忽略规则。拒绝已配置凭据和常见 Key/Token 模式，但检测不是完整的隐私识别，不要向 Agent 发送密钥。
- forget 删除当前知识及有效索引，**不会自动抹除原始 Pi Session、任务/Run 日志、SQLite 空闲页、备份或供应商副本**。文件及数据库未加密，断电/硬件故障不保证最后一次写入完整；备份在正常停服后进行。
- 检索、校验与索引重建目前是线性扫描，适合小型个人知识库；没有语义召回、完整修订历史或精准跨 key 冲突检测。历史对话中仍可能有旧值，模型是否正确采用当前版本需要真实验收。暂不开展 V2.1。

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

- `contracts.ts` 定义业务接口；Pi 类型只存在于 Pi 适配层 `pi-executor.ts` 和 `task-tools.ts`。V1.2 在适配层接入原生 Session 文件，未修改 Pi SDK。
- Task 状态由 SQLite 管理，Pi Session 只保存当前对话上下文。交互 Session 在进程内复用并跨重启恢复，每次后台任务使用独立内存 Session 并释放，二者不混入对话历史。
- Scheduler 只依赖 `AgentExecutor`、存储和 `Channel.sendMessage()`；ChannelRouter 根据任务的持久化目标路由到 Console 或 FeishuChannel，飞书官方 SDK 仅封装在 FeishuSdkTransport 中。
- 独立 FileMemoryService 管理四类长期知识与可重建索引，通过公开 Context 临时注入；Memory、Session、Task 均独立。没有 WebUI、周期任务或复杂工作流。

任务状态：`pending → running → succeeded / failed / interrupted`；`pending → cancelled`。

领取任务和创建执行记录在同一 `BEGIN IMMEDIATE` 事务中提交，条件更新和 `UNIQUE(taskId)` 防止一次性任务被重复领取。只有 pending 能取消，不能撤销已经发生的操作。

启动获得独占锁后，将遗留 running 执行及任务标记 interrupted，保留 pending；失败和中断均不自动重试。需要继续时先查看结果、核实副作用，再手动创建新任务。这不是外部副作用“恰好一次”保证。

`message_end` 用于保存每次模型响应的用量；`agent_end` 只表示底层一轮结束；收到 `agent_settled` 后还需检查 aborted、模型错误、工具错误、输出截断和最终文本，才能提交成功。Pi 执行结束、SQLite 任务提交成功、渠道投递成功是独立阶段。投递失败保留成功的任务结果和 `deliveryError`，不重跑任务，也不自动重发消息。

## 安全与日志

- 交互白名单为 `create_task`、`list_tasks`、`cancel_task` 及五项 Memory 工具；后台 Session 无工具，允许宿主只读检索。没有 Shell、任意文件读写、浏览器或通用网络工具。
- SDK 使用内存凭据和设置；交互 Session 使用宿主指定私有文件。资源加载器只注册宿主内联 Memory 扩展，关闭本机扩展、Skills、AGENTS、模板及 MCP 自动发现；不读取全局 Pi 配置，不保存 Key 到 Pi 认证文件。
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

V1 核心本机闭环及 V1.2 上下文跨重启恢复已有真实用户实测反馈；V2.0 Memory 待真实飞书验收及代码审查。尚未实测的取消/鉴权与重投场景可另行补充。不自动开展 V2.1、Observer、周期任务、WebUI 或 VPS。本版沿用已有执行日志，并增加不含正文的 Memory 命中事件。

官方参考：[Pi SDK](https://pi.dev/docs/latest/sdk)、[1.3.0 完整控制示例](https://github.com/earendil-works/pi/blob/v1.3.0/packages/coding-agent/examples/sdk/12-full-control.ts)、[Node SQLite](https://nodejs.org/api/sqlite.html)。
