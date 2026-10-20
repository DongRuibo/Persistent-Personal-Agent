# Personal Agent 项目说明

## 定位与当前范围

面向单用户的长期运行 Personal Agent，目前在 Mac 本地开发与运行，未来保留迁移 Linux VPS 的能力，暂不部署。V0 提供终端对话及一次性后台任务；V1 新增飞书 Bot，Mac 本机手机私聊、主动提醒、pending 任务重启恢复已通过真实手动验收。V1.2 新增 Pi 原生交互 Session 持久化，已通过模拟模型及进程自动化测试，真实飞书上下文恢复待手动验收。

协作规则见 [AGENTS.md](../AGENTS.md)，当前进展与交接见 [STATE.md](STATE.md)，安装配置与运行说明见 [README.md](../README.md)。本文记录已经确定的方案，不把未来目标当成已实现功能。

## 技术栈

| 项目 | 当前选择 |
| --- | --- |
| 语言与运行时 | TypeScript / ESM，项目要求 Node.js >=24.15.0 |
| 依赖管理与构建 | npm + package-lock，TypeScript 编译至 `dist/` |
| Agent Runtime | 原版 `@earendil-works/pi-coding-agent@1.3.0`，配套 `pi-ai@1.3.0` |
| 飞书渠道 | 官方 `@larksuiteoapi/node-sdk@1.76.0`，企业自建 Bot、WebSocket 长连接与文本消息 |
| 模型 | 现成 LLM API；支持 Pi 内置 Provider 或流式 OpenAI Chat Completions 兼容端点 |
| 持久化 | Node 内置 `node:sqlite`，WAL，单机进程锁 `proper-lockfile` |
| 时间 | `@js-temporal/polyfill`，IANA 用户时区，UTC ISO 时间存储 |
| 测试 | Node 内置测试框架 + tsx；本地模拟 API 及服务子进程测试 |

API Key 只从环境变量读取，仓库仅放脱敏样例。准确依赖版本以 [package.json](../package.json) 和 lockfile 为准。

## 整体架构与边界

终端输入由 Console Channel 处理；飞书入口校验配置用户的文本私聊并落盘去重，在进程内串行调用同一个 AgentExecutor，复用交互 Pi Session。启动时通过原生 SessionManager 打开固定的私有 JSONL 文件，首次创建、以后恢复；Console 与飞书应用/白名单用户分别存储，不扫描全局 Pi 会话。Task Service 通过可信上下文绑定接收目标，不让模型选择接收人。独立 Scheduler 从 SQLite 领取到期任务，通过 AgentExecutor 创建新的临时后台 Pi Session，先提交结果，再通过 ChannelRouter 和 `Channel.sendMessage()` 通知持久化的接收会话。

| 概念 | 职责与生命周期 |
| --- | --- |
| Task / Run | SQLite 保存指令、下次执行时间、渠道接收目标、状态、执行结果与日志，跨进程重启保留 |
| Pi Session | 短期对话上下文；交互使用 Pi JSONL 文件跨重启恢复，每个后台任务使用独立内存 Session 并释放；不是长期记忆 |
| Memory Service | 未来独立长期记忆服务；当前仅有接口，不存储、不检索、不参与执行 |
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
- 交互白名单仅 `create_task`、`list_tasks`、`cancel_task`，后台无工具；禁止默认 Shell、任意文件读写和通用网络能力。服务仍需写数据库并请求配置的模型 API，工具白名单不等同于 OS 沙箱。
- 飞书只允许配置的应用内 open_id 和文本私聊；`(appId, message_id)` 持久化去重后再安排执行，不自动重放中断消息。模型执行和发送均不阻塞事件接收；发送失败只保存 deliveryError，不重跑 Agent。Outbox 尚未实现，故障窗口与升级方向见 README。

## 开发阶段与验收目标

| 阶段 | 目标与验收 | 状态 |
| --- | --- | --- |
| V0 本地基础 | 对话与任务闭环；恢复、锁、时间、Session 隔离和执行日志；类型检查、构建及模拟 API/进程测试通过 | 已实现，当前验证见 STATE |
| V0 真实环境验收 | 使用用户配置的真实模型完成对话、任务管理与短时后台任务；在 Linux VPS 验证启动、日志、重启及退出 | DeepSeek 本地最小闭环已验证；完整使用效果和 VPS 待验收，详见 STATE |
| V1 飞书本机 | 白名单私聊、上下文复用、主动提醒与恢复、事件去重、保留 Console；无需公网回调地址 | 已实现，39项自动化测试通过；手机私聊、主动提醒与 pending 任务重启恢复核心闭环已实测，去重和鉴权仍以自动化证据为主 |
| V1.2 Session 持久化 | Pi 原生 JSONL、Console/飞书隔离、正常重启恢复、保持 Task 独立及工具白名单 | 已实现，42项自动化测试通过；真实飞书上下文恢复待用户验收 |
| 下一阶段 | 先审查及验收 Session 持久化，再单独设计 Memory 的存储、检索和写入策略 | 本次不实现 Memory、Observer，不部署 VPS |

Memory、周期任务、WebUI 和复杂框架不属于本阶段。架构或范围调整先说明并取得确认，再同步本文及 STATE。
