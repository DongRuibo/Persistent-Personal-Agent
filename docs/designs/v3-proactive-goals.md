# V3.1–V3.3 宿主主动执行

用户于2026-10-23批准连续开发及隔离模拟验收；正式配置、正式数据、收费调用和远端推送不属于本次实施步骤。原版 Pi Loop、Task 一次性约束、Memory 写入及 V3.0 四表含义保留。

## V3.1 已实现

`GoalPolicyStore` 与 `GoalStore` 共用应用 SQLite 连接。增量增加 `goal_policies / goal_policy_events / goal_triggers / goal_grants`；已有表不重建，旧 readyInput/Checkpoint 可直接读取。策略保存所有者、渠道访问键、正式计划版本、目标版本、有效期、text_only 能力、频率和限额。审批事件保存完整原话和策略快照，暂停/撤销增加版本。调整采用撤销旧策略、按当前 Goal 版本批准新策略；不自动恢复旧授权。

Console `/policy approve JSON` 是确定性可信入口，不调用模型，不注册策略写工具。必须明确提供 Goal ID、revision、已批准 Plan、到期时间、schedule、limits。模型、Memory、Session 和外部资料均不能启用策略。每日上限按 UTC 日期；全局总额账本跨策略、重启持久化，不因失败或 usage 缺失返还。无有效费率上界时阻塞。一次模型请求按32768输入字节（保守作为 Token 上界）和4096输出 Token 预留，Pi 公开请求钩子拦截容量/第二次请求，禁用 SDK 重试。预留不是供应商账单保证。

到期扫描在短事务内去重 Trigger，产生 Grant 和技术审计 Run。该 Run 不是聊天授权，不能调用 Goal 创建/控制；授权权威是独立 Grant 的策略版本、目标版本、触发来源和消费记录。领取在同一事务核验并消费 Grant、预留预算、新建 Execution Run、将 Goal/Step 改为 running。原用户 receipt 分支保留。

`GoalRunner` 与旧 TaskScheduler 共享 BackgroundLane，仍尊重前台与到期 Task 优先级。每个 Execution 一个临时无工具 Pi Session。Checkpoint/Run/Goal/Step 原子提交后，策略检查是否可以等待下个触发；缺失或 true 的 `needsUserFeedback`、partial、blocked、草稿、计划结束、失败、中断均暂停。只有完成本段、还有已批准后续 Step、明确无需反馈，策略才保留。该标志不能授予或扩大执行权限。

2026-10-23定点可靠性修复：Goal侧先瞬时检查前台/在途后台准入并立即释放门，再等待Outbox和只读Observer；网络后重新获取门，门内及同步健康检查后再次核对到期Task，随后才领取/消费预算、执行及提交。提交后先释放门再通知，不能在通知返回时二次释放其他Task的门。`work`仍串行化整个Goal tick，Observation游标/CAS、Grant和Execution的事务/唯一约束保持。合法同版本ready Grant代表等待领取，不能被后续时间/观察扫描误判为用户阻塞；到期、Goal/Plan版本变化和撤销仍有效。六项原始失败与完整回归见[独立审查报告](../evaluations/v3-background-lane-review.md)。

单次未来触发或每日/每周固定本地时间；UTC 保存 nextAt，IANA 用 Temporal 解析。DST 重叠与缺口当天跳过，下一合法日期继续；不挪动当地时间。停机错过多个周期只合并一个触发，下一次从当前时刻计算。暂停、取消、手动继续或计划修改导致 Goal revision 不匹配，扫描/领取撤销旧策略；策略撤销对运行中 Goal 先落盘 pause/revision，迟到结果只记 discarded。running 崩溃恢复 blocked，绝不回放。

## V3.2 已实现

在上述授权链前增加 `goal_observer_cursors / goal_observations`。`GitHubObserver` 固定读取 GitHub API 的指定公开仓库/分支，最短60秒观察，20条提交窗口，首次只建基线；发生变化时读取 compare 的文件清单和可用 patch，64KiB 响应、10KiB 变化快照上限。窗口断裂、force push、响应无效、过大或请求失败均不移动游标，持久化有限指数退避；需要人工核对时可撤销并重新审批基线。不能把未提供的 patch 当作完整代码审查。

成功状态比较、Observation、Trigger、Grant、游标同事务；重复并发快照、相同 SHA、重启不会重复授权。HTTP 在事务外，返回时重新核对策略/目标版本、停止状态和游标。一个变化批次只产生一个唤醒，批次中的所有新提交及文件差异进入低信任快照；不把 commit message 当指令。只允许已审批的 GitHub 仓库/分支；本机模拟服务通过宿主构造参数注入，不开放任意 URL 配置，不使用正式账号。私有仓库凭据、Webhook、任意生态适配器不在范围内。

## V3.3 已实现

每触发允许用户显式批准1～5段，宿主tick最多执行一段，完成本段且无需反馈才在同一事务写下一Grant；每段都重新检查策略、Goal/Plan、有效期和共享限额。Grant的(triggerId,segment)唯一；执行中崩溃恢复blocked并暂停策略，不回放。到达触发片段数后等待下次时间/事件；单次策略无下一触发时结束。每日计数与人民币全额预留按UTC，策略及全局的每日/总限额同时检查，跨重启不清空。

固定停止条件包括用户控制、计划/目标版本变化、权限/额度不足、过期、partial、blocked、需要反馈、草稿待批、计划末尾、执行失败或结果不明。策略暂停不因聊天恢复或用户反馈自动重新批准；必须显式重新审批。同一Plan的Checkpoint仍待反馈或partial时，重新审批策略也拒绝，先明确继续处理反馈；刚批准的新Plan可授权首次触发。模型只能报告结果，不能改变能力、费用、条件或接收人；其对Step完成和反馈需要的语义判断不保证正确，默认缺失反馈标志会停止。没有自动审批计划、Goal完成确认或Memory写入。

`goal_notifications` 为第七张增量表。策略执行的Checkpoint/Run/Goal/Step、策略停止/后续Grant和通知记录同事务；入库失败整笔回滚，Runner保守核对后阻塞/停服，不请求模型补交。发送前落盘sending并递增次数，发送后确认sent；失败30秒/60秒退避，最多3次进入dead。恢复sending可能重投；若已送达但确认丢失会重复，有限重试仍可能无法送达。发送不确认用户已经看过完整计划，不写Goal审批视图元数据。旧Task、聊天及手动Goal通知保持原路径。Outbox不是独立消息平台，未实现供应商幂等或分片进度。

依赖保持不变，未修改原版Pi/SDK源码。只用公开SDK扩展请求钩子约束一次请求和容量；无Shell、文件写入、Browser、MCP、外部发布、账号写操作或支付。

## 验收

阶段依次执行 typecheck、build、npm test、eval:memory、eval:formation，Windows 与断网 Linux 分开记录；真实 SQLite、原版 Pi SDK、本机模拟模型与模拟 GitHub。旧 V3.0.1 真实自然暂停与主模型收据误解缺口仍开放，不把模拟成功替代真实验收。
