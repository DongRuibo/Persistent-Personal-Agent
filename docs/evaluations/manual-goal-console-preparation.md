# Windows RC发布与手动Goal Console离线准备

2026-10-26。发布与离线准备是两个授权范围：固定RC已发布；新入口尚未提交、推送或获得真实体验授权。本轮真实模型HTTP、文档GET、费用、飞书、正式数据操作均为0。没有修改产品src、Skill、依赖、Pi SDK或Agent Loop。

## 发布结果与保全

- 发布前独立读取远端：main=`c604565ca507ad9fe14e1cadf945918d14a92668`，codex/natural-pause-prep=`fdf3a069ca15847ab95f51c1ed39cd898d76c44f`；祖先检查通过，左右差异0/9，9个提交均保留单父线性历史。
- 全新干净、detached发布树为`C:/Users/Dongr/.codex/worktrees/windows-rc-release/Persistent Personal Agent`。只运行`git merge --ff-only fdf3a069ca15847ab95f51c1ed39cd898d76c44f`及`git push origin HEAD:refs/heads/main`，没有额外提交、强推或历史改写。推送后另一次`git ls-remote`确认main精确为该固定SHA，发布树保持干净。
- 原E盘保存树HEAD仍`ae2a8200daa5e2ae192cf210afeee0f2efb005f3`、8项修改不变；原v3-proactive树本地main仍`c604565`、3项文档不变。没有在脏树merge/pull/reset/stash。此时远端main/origin/main已更新，本地被占用的main引用有意保持旧值，不应在脏树直接pull。
- 复核8个非开发工作树的HEAD、分支、status及原脏文件Hash，全部不变；205份历史/发布证据Hash全部不变。正式.env、数据库、Session、Memory及HANDOFF未触碰。
- 发布证据：`E:/AgentWork/validation/personal-agent-windows-rc-release-20261026`中的pre-release-checks.json、ff-merge.log、fast-forward-check.json、release-verification.json。首个只读远端查询曾有TLS连接错误，同命令重读成功，没有改网络配置或Git策略。

## 最小实现及边界

开发树为`C:/Users/Dongr/.codex/worktrees/manual-goal-console-prep/Persistent Personal Agent`，分支`codex/manual-goal-console-prep`，HEAD仍为固定RC。仅使用现有Node24.19.0、npm及依赖，未安装包；新树node_modules链接到既有已审查依赖，未修改SDK。具体变更：

| 文件 | 目的 |
| --- | --- |
| scripts/manual-goal-console-cases.ts | 逐字冻结RC的M1～M9、各条6/4/4/5/4/4/5/4/4上限、40请求/¥6.60/零GET新scope |
| scripts/manual-goal-console-acceptance.ts | 默认拒绝执行的薄启动器，复用Independent入口 |
| scripts/independent-console-budget.ts | 仅增加新scope类型，原预留、落盘、重启、费率及损坏账本检查不变 |
| scripts/independent-console-acceptance.ts | 新模式接收一条真实stdin，校验原文/容量/后续输入；等待输入后再核对TTL；派发给原Console/main；追加生命周期审计和一次协作退出，旧P/R/S与N模式保持原定义 |
| tests/manual-goal-console.test.ts | 默认拒绝、原话一致、费用/容量/单条/总额、scope/配置/恢复、零GET、失败不退款 |
| tests/manual-goal-console-flow.test.ts | 原版Pi+真实SQLite+本机HTTP完整9条、真实子进程重启、TTL、额外输入及断连 |
| docs/evaluations/manual-goal-console-live-plan.md | 冻结原话、前置、停止、证据、后续授权与运行方式 |
| docs/STATE.md及本文 | 发布与离线准备交接，历史判定不改 |

没有产品业务分支或新状态机。只在隔离进程开启Goal；Skills/Web/Proactive/Formation仍关闭。原普通Chat工具与Guard保持不变；后台无工具、不联网取文档，一片段一次模型请求。非goal_manage工具调用或非预期Task/Memory/策略写入不能算通过。

入口采用一条消息一次启动：测试者输入后走原Console，等待主Chat及授权后台片段结束，沿用正常/quit退出，再显式resume恢复同一原生Session。它比持续驻留Console多了每条间的重启，已在方案披露；M4后重启不额外计Case。没有自动发送九条消息、语义纠错、后台结果复制或额外模型调用。

M2→M3、M5→M6、M8→M9保留5分钟有效视图。前一Case机械状态通过并由执行者审阅原始模型语义后，才可显式previous-reviewed；statePass不能代替模型质量。M1合法partial无草稿仍是计划生成失败；M3只批准不执行；M4/M7分别引用历史Checkpoint；Step complete后M9明确确认才使Goal达成。

## 实际离线验证与失败保留

证据目录：`E:/AgentWork/validation/personal-agent-manual-goal-prep-20261026`。日志和机器结果均按新文件保存，未覆盖旧报告、历史账本或Session。

| 实际检查 | 结果 |
| --- | --- |
| typecheck | 退出0，源代码与测试类型检查通过 |
| build | 退出0，未修改依赖 |
| npm test | 497项，494通过/0失败/3既有平台跳过，测试运行73.67秒 |
| eval:memory | 退出0；64题词法离线，三集Top1/Recall@5为9/12、17/19、17/18；无答案误supported为0/15，真实调用0 |
| eval:formation | 退出0；开发/留出各30/30、未经批准写入0、真实调用0；输出到新证据目录 |
| 新专项 | 5项通过；完整主线29次本机模拟HTTP、9条均机械通过，1个Goal/2版Plan/3次Execution及Checkpoint/9条用户消息和宿主收据 |
| 平台 | Docker客户端存在但Linux引擎管道不可用；WSL只有Stopped的docker-desktop，无可用Mac。没有启动或安装环境，Linux/Mac本轮未运行 |

3项Windows跳过仍为POSIX权限位、无权限建立符号链接，以及POSIX信号进程退出；本次程序内协作停止测试不能替代外部POSIX SIGTERM或Windows ACL验证。

针对性负例：

- 合法partial但无草稿：M1记录计划失败，M2零新增请求；不会修改旧P1/N1判定。
- 在输入等待期间让视图过期：M3在发模型请求前拒绝，Session不补查，原2个Case及预留保留；三个视图节点均有失效断言。
- 错误/双条/未完成输入：零请求、整轮halt。首个请求在途收到额外输入：只保留1次预留，零Execution，正常退出无锁；不会把第二条交给产品。
- 真实本机断连：只保留1次预留，零Execution，整轮halt，无锁；新进程拒绝续跑，不重发。正常完成的Case不可重做；旧scope、配置/源码变化、pending或未完成Case拒绝恢复。
- 预算按最大请求体演算40次预留¥6.594560，单条和总闸同时限制；高费率先触及费用闸；未知缓存费率、超体积/输出、GET均发送前拒绝。该数字来自Mock，不是实际费用。

初始失败同样保留：typecheck-initial.log记录测试局部变量推导错误，补明确类型后通过；targeted-initial.log及targeted-repair-1.log记录新在途额外输入反例会留下入口锁。stdin、fetch中止与轮询重复触发退出，存在清理竞争；新模式改为原轮询统一一次协作停止，未改产品信号处理。targeted-repair-2.log全绿后，再对最终代码运行上述完整五关。原失败临时目录/锁没有清理或续跑。

最终测试临时数据脱敏副本在offline-final-fixtures；offline-audit-summary.json核对8个独立Mock根，完整主线9条通过、负例均停在预期处，全部无lock/pending、源码Hash匹配。全部专项共42次本机Mock HTTP分属不同隔离根，不能把它们当成一轮真实预算消费。真实模型HTTP/Token/费用、公网文档GET均0。请求、响应、SQLite、Session和Checkpoint保留，未把Mock回答当作模型真实能力。

## Hash、待授权事项与剩余限制

- 本轮入口按既有规则计算的codeHash（src/scripts、锁文件、两个Skill）：`196169576c10883cfbd0bf820bbdcca7dd79d8daf707eb01b4f462f3b1bec9a3`。最终测试账本逐一匹配；完整逐文件源码/证据SHA见source-hashes.json及SHA256SUMS.txt，review.patch提供含未跟踪新文件的差异。
- 本轮第二阶段没有Git提交、推送或合并，修改留在独立开发树。发布树仍干净；不得把准备代码误称已在main发布。
- 下一次需要一次性批准新入口审查版本、M1～M9逐条各一次、全新隔离根、最多40物理HTTP/¥6.60保守预留/零GET、固定DeepSeek-V4.1-Flash与硅基流动端点。执行前重新核实官方/账号费率、缓存费及附加费，安全注入凭据；本次没有读取.env或核价联网，也没有预先授予未来费用。
- R2异步收据、S1消息资料自动Skill及N3静止waiting_user自然暂停的真实限定成功保留；P1/N1过度澄清与计划生成不足仍待观察。完整Goal生命周期、批准后/执行中暂停、取消竞态、Skill/Web/Goal联合、Linux/Mac和正式主动执行仍未获真实通过。
- 手动Goal可作为隔离Windows候选体验；发布不等于功能正式启用。准备完成后停止，等待审查及新授权，不自动开始M1～M9。
