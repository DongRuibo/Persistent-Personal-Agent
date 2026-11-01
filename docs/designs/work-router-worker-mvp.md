# 第二阶段首批：确定性路由与纯文本后台工作

日期：2026-11-01。规划基线：WorkThread [PR #3](https://github.com/DongRuibo/Persistent-Personal-Agent/pull/3) `e2c95c067d4f33aa5cd9fdb0c6b17e40bc82ba4b`；[审查结论](../evaluations/workthread-pr3-review.md)。本文保留交给「执行规划」对话的已授权实施范围。2A已实现，实际文件、离线验证和剩余限制见[交付记录](../evaluations/router-worker-mvp.md)；后续2B仍待独立规划。

## 目标与拆分

用户已将本对话定位为规划与审查，并要求将具体开发交给现有「执行规划」对话。四阶段顺序保持：WorkThread 底座 → Router/Worker → 事件订阅 → Chain of Recall。

本次实施第二阶段的 2A：在同一 Web 聊天入口显式选择当前工作主题和“后台处理”，可靠创建一个纯文本后台工作，迅速返回真实排队收据；前台随后可以继续聊天。后台完成后，结果可从主题与现有收件箱查看。

后续 2B 再引入自然语言路由建议与澄清；有预算的联网 Worker 单独验收。2A 不把显式按钮分派称为智能语义路由完成，不以关键词猜测替代模型路由，也不提前实现事件订阅和 Chain of Recall。

## 分支与协作

1. 开始先读 AGENTS、PROJECT、STATE、本计划和相关实现；重新核对 Git 状态、PR #3 head/main 及执行目标。不得直接从旧 main 开发而遗漏 WorkThread。
2. PR #3 仍未合并时，从已审查的 `e2c95c0` 创建 `codex/router-worker-mvp`。优先用独立 worktree，先报告路径；不得在审查工作区切换分支、覆盖未提交文档或改写 main。若 PR head 或 main 已变化，先核对差异，再确定实际基线。
3. 本轮允许执行对话完成本计划的代码、离线测试和交接文档；不自动 commit、push、建 PR 或合并。阶段完成后回到审查流程，发布另按用户明确指令。
4. 当前审查报告、计划和 STATE 是尚未提交的本地交接文档；执行对话从审查工作区读取，必要时只把这三份相关内容带入自己的工作树，不复制未跟踪的旧路线图、PR #2 报告或任何运行数据。

## 优先复用与必须新增的部分

| 现有实现 | 复用方式与边界 |
| --- | --- |
| WorkThreadService / Store | 校验当前 Web 主题和读取已授权关系；主题 ID 只定位上下文，不能代替业务授权 |
| PiExecutor / AgentExecutor | 已有 Chat 持久会话与后台临时会话分离能力，已有 abort、超时、observer 和资源释放；只增量支持新的纯文本工作 scope，不修改 SDK 或 Loop |
| BackgroundLane | 全系统仍最多一个后台模型执行；新 Runner 使用同一个门，不另造线程池或队列框架 |
| TaskScheduler | 定时提醒和 pending 取消语义不变；新工作领取前让已到期 Task 优先 |
| GoalRunner / GoalService / Guard | 长期目标继续使用原 Plan、Grant、Checkpoint 与控制流程；新工作不伪装为 Goal，普通提醒/Goal 请求继续走原 Chat 工具与 Guard |
| Run、事件、model_calls | 技术执行、结果与用量的唯一记录；不另建 Worker 结果库 |
| WebUiStore、ChannelRouter | 扩展新 Job 的 Run 归属判断和既有入箱展示；ChannelRouter 仍只做通知投递 |

需要增加一张轻量 `work_jobs`：现有 Task 的 dueAt、提醒语义和仅 pending 可取消不适合运行中取消的一次性工作；Goal 则有多步骤计划与授权生命周期。把新工作塞入任一旧类型都会改变已经验收的语义。新表仅管理新工作本身，不复制旧 Task/Goal/Memory，也不抽象统一工作流引擎。

## 数据模型

建议最小字段，执行者可按现有命名风格调整，但不可扩大业务范围：

| 字段 | 含义 |
| --- | --- |
| id | 稳定 UUID |
| owner、channel | 宿主绑定的当前本机 Web 身份，拒绝客户端提供身份 |
| threadId | 创建时显式选定且可访问的活跃 WorkThread；一个 Job 属于一个主题 |
| requestId | 同一 owner/channel 内唯一；重复提交同一输入返回原 Job，内容或主题冲突返回 409 |
| instruction | 本次用户提交的有界纯文本输入，创建后不变；不从 Session 复制聊天历史 |
| status | queued / running / succeeded / failed / interrupted / cancelled |
| runId | 排队时为空；首次领取时原子创建 Run 并绑定，唯一且不复用 |
| createdAt、updatedAt | UTC 时间；开始、结束时间和输出从原 Run 读取 |

- `work_jobs` 使用同一应用 SQLite、现有事务和增量建表。Job 状态与 Run 状态必须同事务维护，不能出现已取消 Job 对应成功结果。
- 结果正文、错误详情、调用用量均放原 Run/事件表；Job 不存一份重复结果。
- 按 `threadId` 查询 Job，再按 `runId` 找执行。首批无需把 `job` 加进 `work_links.kind`，避免为一个直接归属增加多态迁移；也不强制把每次 Job Run 再写进有 100 条上限的手工关联表。
- Web Run 可见性须由可信 Job owner/channel 与 Run 绑定证明，不能仅凭一个手工 WorkLink 放行。WorkThread 归档不等于取消已排队/运行工作，延续第一阶段“归档只整理”的语义。

## 入口与路由

1. 默认关闭的新开关（建议 `WORK_JOBS_ENABLED=false`）；只在本机 Web 且 WorkThread 已启用时组装。依赖未满足时给出明确配置错误，不启动半可用功能。
2. 在现有 Chat 输入区加入可选主题和明确的“后台处理”提交方式，保持普通聊天默认行为。普通请求不增加 Router 模型调用，不增加隐式工作，不改变原文字面意图。
3. WorkRouter 是宿主的小型确定性分派：普通输入进入原 WebUiChannel.submit；显式后台提交经主题归属/状态和输入检查后进入 WorkJob。不要新增泛化插件注册器或关键词意图解析器。
4. 现有 Task/Goal ID 或主题关联仅是定位信息，提醒、批准、继续、暂停、取消 Goal 等仍由原服务和 Guard 核验当前用户意图；本批不借选择主题自动继续关联 Goal。
5. 新的 Job 创建、列表/详情、取消 API 沿用登录、Origin、CSRF、限流和入口一次校验。缺失主题或越权 ID 拒绝；不允许传入 target、owner、工具权限或任意执行 scope。
6. 入队后返回宿主生成的 Job ID、Thread ID、状态与时间；只有事务成功才显示“已排队”。后台状态不能占用 Chat 的 `busy`，也不能重提原 Chat 请求。
7. 只处理本次显式提供的文本。材料不足时结果可以提出问题，但不自动读取文件、联网、追问后续跑、跨 Session 取历史或读取关联 Memory 正文。后续补充在本批是新的明确提交，不伪装成暂停恢复。

## 执行、取消和恢复

- 新增 WorkRunner，在原 BackgroundLane 内串行领取 Job；使用独立临时 Pi Session、无工具、无自动 Skill 加载。Chat 可在 Worker 运行期间独立处理。不得修改 TaskScheduler/GoalRunner 已有执行和授权含义。
- 领取前复用执行就绪检查，并让前台、到期 Task 和已就绪的原 Goal 优先；不抢占已经运行的后台片段。单后台执行不承诺运行中的长工作绝不延迟提醒，现有执行超时继续生效。
- 新增 `work` scope 的限制只作用于新工作：单次模型请求、无隐式 Memory 查询改写调用、明确输入/请求体/输出预算与超时。可沿用 Goal 的单请求、32KiB 实际请求体及最多 4096 输出 token 的公开 SDK 宿主限制；检查中文按 UTF-8 字节计，不静默裁剪。旧 Chat/Task/Goal 的 Memory 规则不变。
- `queued → running` 与创建/绑定 Run 原子提交；提交成功结果必须检查 Job 仍 running 且 Run 对应。失败或超时进入明确终态，不自动重试。
- 取消 queued：进入 cancelled，不创建 Run、不调用模型。取消 running：先在事务中撤销成功提交资格并结束技术 Run，再 abort 对应临时 Session；迟到结果不能覆盖 cancelled。现有 RunStatus 无需新增 cancelled，可记为 interrupted 并记录用户取消原因。执行门等该 Session 结束后释放，不能因用户点击取消就并行放出下一个 Worker。
- 进程重启：queued 保留等待；running 对应 Job/Run 统一恢复 interrupted，不重新排队；完成、失败、取消的工作不再执行。新功能关闭时不领取 queued 工作，重新开启后才按原已提交请求处理。
- 先原子提交 Job 与 Run 结果，再复用现有 Web 入箱。通知失败只记录原 Run 的 deliveryError；结果仍可从 Job 详情读取，不重新调用模型。本批不改造 Goal 专属 Outbox 或建立通用消息系统。
- 正常停机中止在途 Session、等待 Runner 结束后关库；不能把取消后的迟到执行留给下一次启动提交。

取消后迟到结果、重复提交、进程中断和通知失败都是该阶段明确验收场景，因此需要上述最小状态条件；不为多进程分布式抢占等本项目不支持的场景增加机制。

## 预计修改文件

| 文件 | 目的 |
| --- | --- |
| `src/work-job-types.ts`、`src/work-job-store.ts` | 新 Job 类型、表、去重、原子领取/结束、取消与恢复 |
| `src/work-router.ts`、`src/work-runner.ts` | 确定性分派及受现有执行门约束的后台生命周期；只有出现独立复用职责才再拆 Service |
| `src/config.ts`、`.env.example`、`src/main.ts` | 默认关闭开关、依赖检查、组装、恢复和停机 |
| `src/sqlite-store.ts`、`src/contracts.ts`、`src/pi-executor.ts` | 复用事务/Run，增量 work scope 与宿主预算；不改 node_modules |
| `src/web-ui-channel.ts`、`src/web-ui-store.ts`、`src/web-ui-server.ts`、`src/web-ui-types.ts` | 新 Job API、Run 归属、收据、结果和既有收件箱 |
| `src/work-thread-service.ts`（按需） | 按主题查询 Jobs；保持原四类手工关联行为 |
| `web/src/main.tsx`、`web/src/work-threads.tsx`、`web/src/style.css`（按需） | 现有 Chat/主题视图中的提交、队列、取消与结果，不重新设计工作台 |
| `tests/work-jobs.test.ts`、`tests/work-router.test.ts`、`tests/work-runner.test.ts`及现有进程夹具 | 状态、权限、去重、执行隔离及真实进程恢复 |
| README、PROJECT、STATE、阶段验收记录 | 开关、已实现边界、实际测试与未验证事项 |

这是定位清单，不要求为了凑文件而拆分模块。原 Task/Goal/Scheduler/Memory 的修改若超出必要接线，须先说明具体原因与影响。

## 验证与交付门槛

全部使用新临时 SQLite、合成文本与本机模拟模型端点；不读取正式配置、数据库、Session、Memory 正文或备份，不启动日常服务，不收费。

1. **闭环**：两个主题各提交一个工作；排队收据绑定准确，创建请求不等待模型完成。结果按 Job/Run/主题展示并进入现有收件箱。
2. **不阻塞 Chat**：模拟 Worker 正在等待时，普通 Chat 成功完成；Worker 输入不包含该 Chat 或另一个主题内容，临时 Session 执行后释放。
3. **串行与优先级**：两个 Job 只有一个后台执行；到期 Task、原 Goal 与 Worker 共用门。保持已有 Task/Goal 行为与前台准入规则。
4. **去重**：重复提交、HTTP 响应丢失后重试、页面刷新和进程重启都不重复建 Job/Run；相同 requestId 的不同输入或主题拒绝。
5. **权限**：未知、其他身份/渠道、归档主题不能新建工作；读取和取消也检查归属。手工关联其他 Run 不能扩大结果访问权；提示注入不能启用工具、写文件或保存 Memory。
6. **取消**：queued 取消零模型请求；running 取消后模拟忽略 abort 的迟到成功，不提交成功输出、不影响下一工作。终态重复取消明确且幂等。
7. **恢复**：通过真实 main 子进程验证 queued 保留、running → interrupted、已提交结果不重跑；重启不重放前台请求。
8. **通知**：模拟投递失败，Job/Run 结果保留、deliveryError 可查、模型调用数不增加；再次查看结果不冒充渲染 ACK 或文件许可。
9. **开关与预算**：关闭时旧 UI/API 和原回归不变，新 API/Runner 不执行；新 scope 单请求、输入超限、输出截断、超时和工具调用异常可解释地终止；普通聊天新增路由调用数为 0。
10. **工程验证**：`npm run typecheck`、`npm run build`、`npm run web:build`、`TMPDIR=/private/tmp npm test` 全部通过；模拟浏览器完成提交→继续聊天→结果→取消→刷新，并报告实际调用数。不能把模拟结果描述为真实语义验收。

执行前先在执行对话说明实际方案与文件范围；方案与本文一致即可实施。若必须新增框架、改变权限语义、扩展到联网/并行/模型路由，先停止该扩展并说明理由。交付精确 diff、测试记录、STATE、剩余风险，保留未提交状态供下一轮审查。

## 后续安排

- 2A 审查通过后，2B 再设计“确定性定位优先、模型只建议、歧义澄清”的自然语言 Router。届时明确请求预算、候选范围、用户确认、旧暂停/收据语义反例，并单独申请有上限的真实模型验证。
- 阶段 3 复用 GitHubObserver 与 Policy/Grant 增量引入事件/订阅；阶段 4 按关系取原始结果与来源，再按需检索 Memory。本批不预建两阶段的表、工具或接口。
- PR #3 的 100 主题/候选限制、大规模 Memory 查询性能和真实手机体验仍是独立非阻断事项，不夹带删除、数据迁移或缓存重构。
