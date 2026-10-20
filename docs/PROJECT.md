# Personal Agent 项目说明

## 定位与当前范围

面向单用户的长期运行 Personal Agent，目标部署在 Linux VPS，未来可经飞书、Mac 和手机与用户交互。当前 V0 提供终端对话及一次性后台任务，先建立可靠的执行、持久化与渠道边界。

协作规则见 [AGENTS.md](../AGENTS.md)，当前进展与交接见 [STATE.md](STATE.md)，安装配置与运行说明见 [README.md](../README.md)。本文记录已经确定的方案，不把未来目标当成已实现功能。

## 技术栈

| 项目 | 当前选择 |
| --- | --- |
| 语言与运行时 | TypeScript / ESM，项目要求 Node.js >=24.15.0 |
| 依赖管理与构建 | npm + package-lock，TypeScript 编译至 `dist/` |
| Agent Runtime | 原版 `@earendil-works/pi-coding-agent@1.3.0`，配套 `pi-ai@1.3.0` |
| 模型 | 现成 LLM API；支持 Pi 内置 Provider 或流式 OpenAI Chat Completions 兼容端点 |
| 持久化 | Node 内置 `node:sqlite`，WAL，单机进程锁 `proper-lockfile` |
| 时间 | `@js-temporal/polyfill`，IANA 用户时区，UTC ISO 时间存储 |
| 测试 | Node 内置测试框架 + tsx；本地模拟 API 及服务子进程测试 |

API Key 只从环境变量读取，仓库仅放脱敏样例。准确依赖版本以 [package.json](../package.json) 和 lockfile 为准。

## 整体架构与边界

终端输入由 Console Channel 处理：确定性任务命令进入 Task Service，普通对话通过 AgentExecutor 进入交互 Pi Session。独立 Scheduler 从 SQLite 领取到期任务，通过 AgentExecutor 创建新的后台 Pi Session，先提交结果，再通过 `Channel.sendMessage()` 通知。

| 概念 | 职责与生命周期 |
| --- | --- |
| Task / Run | SQLite 保存指令、下次执行时间、状态、执行结果与日志，跨进程重启保留 |
| Pi Session | 当前执行上下文；交互在进程内复用，每个后台任务单独创建并释放 |
| Memory Service | 未来独立长期记忆服务；当前仅有接口，不存储、不检索、不参与执行 |
| Channel | 输入适配及统一主动消息接口；V0 仅 Console，任务引擎不绑定具体渠道 |

Pi SDK 使用公开 API，不 Fork、不修改内部源码和 Agent Loop。宿主负责业务状态、权限和投递策略；单用户、单进程、串行后台任务，不引入微服务或工作流框架。

## 模块职责

| 文件 | 职责 |
| --- | --- |
| [src/main.ts](../src/main.ts) | 组装服务、进程锁、恢复、console/daemon 入口与信号退出 |
| [src/config.ts](../src/config.ts) | 环境变量、IANA 时区与参数校验、日志脱敏 |
| [src/contracts.ts](../src/contracts.ts) | Task / Run、AgentExecutor、Channel、Scheduler、MemoryService 业务接口 |
| [src/pi-executor.ts](../src/pi-executor.ts) | 创建隔离 Session、白名单检查、执行生命周期、取消超时和用量观察 |
| [src/task-tools.ts](../src/task-tools.ts) | Pi 工具适配：创建、查询、取消任务，调用 Task Service |
| [src/task-service.ts](../src/task-service.ts) | 任务内容与时间校验、查询和 pending 取消规则 |
| [src/sqlite-store.ts](../src/sqlite-store.ts) | SQLite 表、原子领取、执行状态、日志、恢复与投递记录 |
| [src/time.ts](../src/time.ts) | 有界中文时间与 ISO 时间解析，明确处理时区和 DST 歧义 |
| [src/scheduler.ts](../src/scheduler.ts) | 独立扫描循环、串行执行、先提交结果再调用 Channel |
| [src/console-channel.ts](../src/console-channel.ts) | 终端对话与命令、控制台消息输出；daemon 不启动输入循环 |
| [tests/](../tests/) | 状态、时间、权限、Pi 生命周期、模拟 API 和真实服务进程测试 |

## 必须保持的执行语义

- 一次性任务：`pending → running → succeeded / failed / interrupted`；仅 `pending → cancelled`。
- 领取和创建 Run 在同一事务提交，条件更新与 `UNIQUE(taskId)` 防止重复领取。独占锁后才能恢复遗留运行状态。
- 重启继续等待中的任务；遗留 running 标记 interrupted；失败、中断和投递失败不自动重跑任务。有外部副作用时须人工核实，不能保证恰好一次。
- `message_end` 记录模型响应与用量；`agent_settled` 后仍检查 aborted、模型与工具错误、截断及最终文本。执行结束、数据库成功提交、渠道投递成功互相区分。
- UTC 持久化、IANA 用户时区解析。支持的中文时间语法见 README，歧义或 DST 无效时间要求用户明确，不让模型或服务器时区决定。
- 交互白名单仅 `create_task`、`list_tasks`、`cancel_task`，后台无工具；禁止默认 Shell、任意文件读写和通用网络能力。服务仍需写数据库并请求配置的模型 API，工具白名单不等同于 OS 沙箱。

## 开发阶段与验收目标

| 阶段 | 目标与验收 | 状态 |
| --- | --- | --- |
| V0 本地基础 | 对话与任务闭环；恢复、锁、时间、Session 隔离和执行日志；类型检查、构建及模拟 API/进程测试通过 | 已实现，当前验证见 STATE |
| V0 真实环境验收 | 使用用户配置的真实模型完成对话、任务管理与短时后台任务；在 Linux VPS 验证启动、日志、重启及退出 | 待开展，需要用户配置/部署条件 |
| 后续明确任务 | 按已批准需求接入飞书等 Channel，继续复用现有边界 | 仅方向，未实现、未授权展开 |

Memory、周期任务、WebUI 和复杂框架不属于本阶段。架构或范围调整先说明并取得确认，再同步本文及 STATE。
