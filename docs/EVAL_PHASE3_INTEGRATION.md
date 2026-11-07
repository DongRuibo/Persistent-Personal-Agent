# 第三阶段：分支集成审查与稳定性收尾

2026-11-07。仅在独立Worktree `/private/tmp/ppa-phase3-integration`、临时分支`codex/phase3-integration`审查和验证。没有切换/覆盖原工作区、修改main、强推、创建PR、调用收费模型、发送真实飞书消息或访问正式SQLite/Session/Memory。没有修改Pi SDK或新增业务功能/依赖。

用户随后明确授权把已审查的集成候选和稳定性修复提交并推送到`codex/phase3-integration`。仅完成本独立分支的集成提交，不修改main，不创建PR；发布标识以Git记录为准。下列分支/未提交状态描述保留验证时点语境。可公开复核的数字见[脱敏机器摘要](../evals/reports/phase3-2026-11-07-v1-summary.json)，完整Trace、日志与工作区快照仅本地保留。

## 1. 本地与远端只读核对

| 对象 | 实际SHA |
| --- | --- |
| 原工作区HEAD/本地功能分支 | d0c71253dc19d5035615ae16be203fa5f05740c5 |
| origin/codex/notification-goal-recovery | d0c71253dc19d5035615ae16be203fa5f05740c5 |
| GitHub功能分支（ls-remote） | d0c71253dc19d5035615ae16be203fa5f05740c5 |
| 本地main、origin/main及GitHub main | 91b7a657ddf62cf625c53f7bcfbddaa22aa6740b |
| 共同祖先 | e2c95c067d4f33aa5cd9fdb0c6b17e40bc82ba4b |

main独有1个提交（91b7a65 WorkJobs 2A），功能分支独有2个提交（0d034eb首轮评测、d0c7125通知恢复）。原报告HEAD=0d034eb指提交前验证时点，不是当前远端或本地不同步。没有为“同步”而重置原工作区或改写提交。

原工作区有1个已修改文件`docs/STATE.md`和10份未跟踪文档，均未带入集成树。开始时记录这11份文件及454份本地评测文件的Hash，结束再次比对。原工作区分支、index和历史证据保持原样。

临时树从固定最新origin/main创建，再以`git merge --no-commit --no-ff d0c7125`构建候选；工作树和提交状态见末节交接。只读远端核验不等于fetch所有其他分支，也没有引用其他未授权工作树的功能。

## 2. WorkJobs 2A与通知恢复的语义集成

| 关注点 | 审查结论及证据 |
| --- | --- |
| Task与WorkJob事实源 | Task由tasks/带taskId的runs表示；WorkJob由work_jobs/独立runId表示，技术Run的taskId为空。两种状态机保持独立，未转成同一队列 |
| Notification Worker领取范围 | 仅goal_notifications，默认taskOnly；WorkJob没有enqueueTask路径。集成测试检查全库仅一条Task意图、WorkJob直发没有notificationId |
| Scheduler/WorkRunner竞争 | 同BackgroundLane，WorkRunner在健康检查前后均检查到期Task和ready Goal；已有tick防重入及SQLite事务领取保留。混合并发tick只执行一次task、一次work |
| 数据库迁移 | 两边增量构造均保留；原Goal通知表迁移先于WorkJobStore创建，WorkJob不引用通知列。旧ID/Checkpoint兼容、WorkJob重开/去重及混合库恢复均实测 |
| 聚合提交入口 | WorkJobStore使用finishRunInTransaction钩子，不走finishTaskRun；普通finishRun仍拒绝WorkJob/Goal Run，finishTaskRun拒绝taskId为空的Run |
| 启动恢复 | 同一独占锁后、同一事务恢复Run/Task/WorkJob/Goal/通知。running WorkJob→interrupted、queued保留；已完成Task通知可恢复，绝不重新执行模型 |
| 生命周期 | 同时start/stop WorkRunner、TaskScheduler、GoalRunner和NotificationWorker；等待结束后才关闭executor/数据库。原真实main强杀/重启与锁清理测试保持 |
| 消息及事件隔离 | Task/Goal投递按既有owner/target筛选；Web WorkJob用原绑定身份/收件箱。事件以runId隔离，Job回写不更改Task状态或Goal Checkpoint |
| 并发与外部副作用 | 慢Task通知不持有模型门，WorkJob可继续执行；模型仍串行。没有扩展多机Worker、改变原独占锁或保证外部Exactly-once |

集成专项新增3项：B07当前30秒契约、慢通知与WorkJob并发隔离、同库混合状态恢复。WorkJobs旧取消/迟到结果/串行优先级、真实main四次启动与强杀恢复、旧Goal通知迁移、双连接通知领取及租约令牌测试均在最终回归中保留。

WorkJob结果仍采用原直接发送Web收件箱的路径。结果提交与入箱之间仍有窗口，通知失败只保留deliveryError和可查成果；本轮没有扩展Outbox覆盖WorkJob，也没有将Task恢复率套用给WorkJob。

## 3. 冲突原因与解决依据

| 冲突文件/位置 | 原因 | 解决 |
| --- | --- | --- |
| src/main.ts关闭流程 | main加入WorkRunner，功能分支加入NotificationWorker，两边修改同一Promise.all | 两者都等待stop，再关闭executor/SQLite；启动、Web中断回调、优先级和目标过滤均保留 |
| src/pi-executor.ts message_end | WorkJob需保留首个500/截断/非法工具原因；Goal需保留HTTP分类和原契约停止事件 | 分scope保留workFailure与goal_contract_stopped；两者都禁止续工具/续请求，不用一侧覆盖另一侧 |
| src/pi-executor.ts timeout/catch | Work单独超时标志与Goal的ExecutionTimeout/HTTP分类相交 | 统一使用timedOut；真实取消/超时优先，已捕获HTTP错误穿透，Work非法工具/截断仍failed；Goal旧工具停止仍interrupted |
| docs/STATE.md阶段/最近修改/下一步 | 两条分支各自维护快照 | 保留2A和第二轮固定版本历史，新增第三阶段当前快照；最近条目最多5项，消除相互冲突的当前阶段指令 |

config.ts、contracts.ts、sqlite-store.ts、README等文本自动合并后仍逐项审查：WORK_JOBS_ENABLED与GOAL_MAX_ATTEMPTS同时存在；scope包含work和可选notificationId；保留WorkJob聚合入口保护及Task通知聚合事务；不删除任一正确路径。Scheduler未与WorkRunner合并为单一领取器。

## 4. Console偶发退出调查

调查覆盖spawn的参数/最小env、管道、stdin关闭、TMPDIR、exit/close时序及真实停止入口。子进程只使用假Key与重定向127.0.0.1的传输；正式URL仅元数据，不发公网模型请求。父测试TMPDIR=/private/tmp；子进程原白名单env不继承TMPDIR，使用系统默认临时路径，未将这一点误当SIGTERM根因。

诊断将stdout和stderr分开保存，记录每个子进程PID、expectedCode、exitCode、signalCode、killed、启动/exit/close时间和路径。等待close只为确保管道收齐，原退出码断言保持；没有删除测试、放宽断言或加生产等待。

同一环境下，修复前完整重复20次：18通过、2失败（第7/9次）；两个失败均为P1 HTTP500路径code=null/signal=SIGTERM。共保存278个子进程记录，无父编排超时。修复后完整重复20次：20通过、0失败、280个子进程记录，无超时、无异常signal。完整测试不跳步骤，仍检查6个正常Case、预算/语义隔离及HTTP失败后不再发送。

最终受控慢清理复现也由失败变通过：修复前两次SIGTERM并被self-signal终止，修复后一次SIGTERM、exitCode=1/signal=null；双方HTTP尝试均1、预算均halted。两轮完整重复总计40次、558个子进程记录；不是558次独立模型质量试验。0/20后测只说明已覆盖该已复现竞态，不能承诺未来任何退出异常均不存在。

根因位于`scripts/independent-console-acceptance.ts`：fetch失败排一个setImmediate(SIGTERM)，100ms轮询看到持久预算halt也发SIGTERM；非手动分支条件`!manual || !quitting`使已停止时仍可再次发。main是process.once监听，第一个停止后该监听消失。proper-lockfile依赖signal-exit；第二次只剩其监听时会卸载并调用process.kill(process.pid, SIGTERM)，导致code=null。

受控派生诊断器仅在测试中把锁释放延迟200ms，强制扩大清理重叠窗口：捕获fetch回调首发（2个监听器）、11ms后轮询第二发（1个监听器）和signal-exit真实selfKill。另用同依赖/一次性监听的最小子进程再次得到SIGTERM。慢清理是故障注入，不是修复里的等待。

修复仅使验收入口的fetch回调与轮询共用原quitting标志，首次请求停止即置位，已请求则不再发。真实外部SIGTERM处理、产品main和SDK不因此改成吞信号；预算仍halt、不重发HTTP，不改变用户取消或模型错误分类。

## 5. N07/N08四阶段Trace复核

旧Trace原文件保持，引用副本及Hash见机器记录；两例是非去重Mock渠道，不是飞书线上重复率。

| 场景 | 平台接受 | 客户端响应 | 本地Sent | 重试 |
| --- | --- | --- | --- | --- |
| N07响应丢失 | 同notificationId首次已接受 | Mock抛unknown，客户端未确认 | pending、uncertain=1，30秒后可重投 | 第二次接受并返回成功，最终sent、attempts=2、uncertain仍1；Task只执行1次 |
| N08确认前SIGKILL | 首进程已写外部接受收据 | 测试在Channel返回/本地确认前SIGSTOP后SIGKILL；无法据此断言已收到供应商成功响应 | 旧sending重启恢复pending、process_interrupted、uncertain=1 | 新PID再次接受同ID，sent且attempts=2；新进程模型执行0次 |

N08名称“外部成功后Sent前”不代表已测到客户端收到响应后的每一个指令窗口；当前注入落在外部接受后、Channel尚未返回，不能夸大成额外独立网络场景。Task成功、意图持久、外部接受、本地确认仍必须分别计数。

固定11个共同题：意图11/11、外部接受9/11、本地确认9/11；2个未接受为永久拒绝与重试耗尽。接受题中2/9重复来自N07/N08；可恢复6题恢复6/6。不是零丢失、零重复或永久必达；有限重试与dead仍需人工处理。

### 是否增加外部核验或人工不确定状态

当前sendText返回void，未持久化供应商message_id/逐片回执；响应丢失时本来也未必取得ID。飞书官方[消息资源说明](https://open.larksuite.com/document/server-docs/im-v1/message/intro)说明message_id是平台生成、可从发送响应获取；本地notificationId不是该ID。官方[发送/查询消息文档](https://open.feishu.cn/document/server-docs/im-v1/message/create)本次工具无法读取正文，不能据此证明按uuid核验能力、跨重启去重期限或分片幂等。未用第三方镜像替代官方保证，未实际调用飞书。

本轮判断：保持有界重试、uncertain留痕和dead人工重发，不为降低重复率关闭所有重试。 当前uncertain只是持久标记，不会自动进入人工审批；没有单条通知暂停或“人工核验已送达”的确认入口，Console的dead重试也只是重投，飞书/Web没有新增人工操作界面。应如实披露这一操作边界。新建供应商查询器需要验证ID获取、权限、查询一致性和分片语义；凭聊天内容或时间模糊匹配不能作为成功证明。对当前低风险文本提醒，先接受公开的可能重复取舍；未来若用于高影响外部动作，必须先建立可验证回执及人工核对路径，未知时暂停，而不是复用当前发送重试。本轮不新增复杂状态机或未经验证的生产核验器。

## 6. 历史失败保持

- B07原题及立即再次tick的历史断言不改，仍failed。新增当前契约测试逐一检查0ms与29999ms不重发、30000ms恢复、原notificationId及Task只执行一次；不把新契约冒充旧题通过。
- C04历史M3原始“已排队”仍为语义失败。既有m3-state两项测试在集成树通过：错误模型原文留在Session，宿主输出明确未排队，waiting_user/readyInput=null，重启无新增执行。可说明宿主拒绝错误状态声明，不能说明真实模型语义问题已解决。
- D03保持skipped/未实现。WorkRouter 2A只是显式mode=work分派，不是自动主题识别；没有导入其他工作树的自动路由。

## 7. 实际验证及证据

| 命令/检查 | 本轮实际结果 |
| --- | --- |
| 修复前首次集成npm test | 657/657，退出0；偶发问题仍在专项重复中暴露 |
| 修复后最终TMPDIR=/private/tmp npm test | 657/657，0失败/取消/跳过，退出0 |
| npm run typecheck | 退出0，源/测试类型检查通过 |
| npm run build | 退出0 |
| npm run web:build | 退出0，保留既有依赖use client打包警告 |
| npm run eval:agent（原20题） | 17通过/2失败/1跳过/0执行错误，退出1 |
| npm run eval:phase2（30故障题） | 30通过/0失败/0跳过，退出0 |
| 新增集成契约 | 3/3通过 |
| Pi/WorkJobs/M3相关专项 | 35/35通过 |
| Console修复前/后重复 | 18/20→20/20，失败记录不删 |
| 用户所列npm run web | 缺少脚本，退出1 |
| 用户所列npm run eval（两次） | 两次均缺少脚本，退出1 |
| UTF-8/冲突标记/diff检查/旧工作区Hash | 最终交付检查通过 |

集成前624/624与main 2A历史618/618仅作版本背景，不拼成当前成绩；当前657项是实际完整执行。两次集成完整回归的原日志、Console修复前两次失败、受控故障及早期命令错误全部保存。

Git checkout按既有core.autocrlf把部分原LF评测文件检出为CRLF，字节Hash与第二阶段工作目录不同；Git blob/规范化内容相同且git diff无评测器/数据集改动。实际运行源码Hash单独记录，不用“同字节Hash”虚构跨工作树一致。依赖锁文件逐字节相同。

缺失命令是package.json未定义入口，不算业务测试失败或绿色检查。未新增别名或启动真实Web服务；改用现有构建及两套离线评测。所有失败/跳过及先前重现日志均保留，原评测器/固定题不修改。

机器记录和原始诊断保存在本Worktree `evals/reports/phase3-integration/`（Git忽略），包含分支快照、冲突原文、Console每次/每子进程、清理窗口注入、完整命令日志、两套结果/Trace及验证Hash。报告链接：[机器摘要](../evals/reports/phase3-integration/summary.json)、[Console对照](../evals/reports/phase3-integration/console-summary.json)、[固定20题](../evals/reports/phase3-original20-final/results.json)、[30故障题](../evals/reports/phase3-fault30-final/results.json)。原始记录不自动发布。

## 8. 可靠性边界与PR条件

- 单用户单进程SQLite和BackgroundLane；通知Worker独立于模型门但仍在同一进程，启动健康检查失败时不能自行工作，不承诺分布式或并行模型执行。
- Task/Run与发送意图同事务，网络不在事务中；外部接受与本地确认无法原子化。稳定ID/租约令牌只防仓储误确认，不撤回已经在途的消息。
- 执行中崩溃按原规则保守中断，不自动重跑或补造成功通知；Outbox覆盖已与终态同事务提交的意图。Task已完成不反转、不因投递失败重跑。Goal仍由宿主版本/授权/Checkpoint核验，手动可选有界HTTP重试、策略单请求预算保留。
- WorkJob结果可查，直接Web通知存在提交后入箱前窗口；主Chat/手动Goal通知也仍直接发送。消息渠道能力和不同业务对象的可靠性不能混算。
- 没有收费语义质量、真实飞书幂等/分片恢复、正式库迁移、跨OS、长期运行、吞吐或生产P95验证。Console后测的0失败不构成未来零风险证明。

具备有条件进入PR代码审查的基础：两侧语义已集成，657项回归、两套固定评测及已复现Console竞态的修复后20次验证完成。原20题2失败/1跳过属于明确保留的历史契约/语义/未实现项目，不可用30/30掩盖；PR描述必须同时披露通知重复、死信和WorkJob直接通知边界。

这不是正式上线批准。审查交付时只保留本地未提交集成候选；用户随后已授权提交并推送本独立分支，PR与合并main仍不在本次发布范围。没有因此启用正式功能或安排真实收费验收。

## 9. 下一阶段建议与交接

不建议继续扩展自动路由、联网Worker、消息框架或更多重试状态以堆砌能力。对当前面试目标，先把固定版本、真实数据口径、失败取舍和可复现命令讲清楚，比增加业务模块更有价值。本次仅按后续授权提交/推送已审查候选；下一步若要创建PR或合并main，仍需用户明确指示。这不等于批准启用正式开关或真实收费验收。若后续目标是日常可靠运行，应单独限定隔离的真实渠道回执/分片与长期恢复验收，再决定是否需要外部核验。

当前改动文件及目的：main.ts整合两个Worker的关闭；pi-executor.ts保留两scope错误/超时契约；independent-console-acceptance.ts修复验收入口重复停止；independent-console-flow.test.ts补齐退出诊断；phase3-integration.test.ts新增3个实际混合契约测试；STATE更新交接，本报告记录结论。其余文件来自两个固定分支的原有变更，不是本轮重写。原20题/历史Trace/Pi SDK/依赖锁文件均保持。

验证交付时，临时分支HEAD为基底91b7a65，MERGE_HEAD=d0c7125且冲突已解决；不把当时HEAD单独作为被测源码版本。测试代码指纹`76d637ceaf9aee404e6850bbfbfaf296d83157fe95bc47aabcc75553b11df733`与逐文件Hash见机器摘要。所有阶段原始记录留本地，原工作区11份未提交/未跟踪文件及454份旧证据Hash不变。验证结束时尚未创建新Git提交或推送/PR；后续授权的独立分支发布以Git记录为准，PR仍不创建。

发布后可用`git diff origin/main...HEAD`审查集成增量，并结合本报告及STATE核对边界。原始诊断与原工作区无关修改不纳入发布，不在原工作区执行reset/checkout。
