# V3.1–V3.3 本地自动化交付报告

日期：2026-10-23。结论：三个阶段代码及本地模拟验收完成，可交付审查；未验真实模型、正式GitHub仓库或飞书，不等于正式无人值守上线。V3.0.1原真实暂停和主模型收据误解失败保持开放。

## 基线、范围和隔离

- 开始时本地main及GitHub main均为 `ae2a8200daa5e2ae192cf210afeee0f2efb005f3`。原工作区有7份上一轮真实复验文件及未跟踪HANDOFF；本次未覆盖，独立受管工作树开发，分支 `codex/v3-proactive`。
- 将上一轮7份成果原样复制到独立树，以 `31c798a` 保存恢复点，不把它们算作本轮功能开发。真实报告/JSON内容没有修改，正式.env、正式数据和历史验收数据库未打开。
- 本轮收费API请求0；所有新增模型调用使用原版Pi SDK 1.3.0与本机HTTP桩；GitHub观察使用虚构仓库/提交及本机HTTP服务。无正式飞书/手机操作、推送或VPS部署。
- Node24.19.0；Windows原生及Linux Node24.19.0 bookworm容器。Linux断开外部网络、无宿主挂载；源码复制到独立/app。依赖沿用锁文件，不修改node_modules或Pi Loop。最终107份源码/测试/脚本/配置原始字节Hash一致；package-lock最初只有换行差异，规范JSON Hash相同，随后同步原始文件后核对全量一致。

## 阶段关卡（实际运行）

每阶段均运行 `npm run typecheck`、`npm run build`、`npm test`、`npm run eval:memory`、`npm run eval:formation -- --output=<新路径>`，两平台这五个命令全部退出0。

| 阶段 | Windows | Linux | 记录 |
| --- | --- | --- | --- |
| V3.1 | 217总/214通过/0失败/3跳过 | 217通过/0失败/0跳过 | v31目录；本地提交0736042 |
| V3.2 | 220总/217通过/0失败/3跳过 | 220通过/0失败/0跳过 | v32目录；本地提交708d297 |
| V3.3首轮 | 228总/225通过/0失败/3跳过 | 228通过/0失败/0跳过 | v33目录 |
| 补充单次/迁移测试 | 230总/227通过/0失败/3跳过 | 230通过/0失败/0跳过 | final目录 |
| 最终待反馈入口保护 | **231总/228通过/0失败/3跳过** | **231通过/0失败/0跳过** | release目录；最终交付版本 |

Windows跳过为原有POSIX私有权限位、当前账户不可创建符号链接、POSIX SIGTERM三项；Linux均实际运行通过。未验证Windows账户ACL、原生Mac、VPS或长时间真实运行。未调整冻结样本/预期，也未把跳过记为通过。

Memory eval保持原三集词法离线指标：Top1/Recall@5/MRR与Context命中分别9/12、17/19、17/18；无答案误supported均0（4/5/6条负例）。Formation冻结开发/留出各30/30通过，误候选和未经批准写入均0，收费API请求0。模拟提议正确不证明真实语义质量。

全部日志及源Hash清单根目录：`E:/AgentWork/validation/personal-agent-proactive-20261023`。每次追加独立目录，不覆盖前轮日志。机器汇总见同目录 `release/result.json`；两个eval原始输出见release/windows与release/linux。

## 端到端与安全断言

新增18项专项（每项包含相关竞争或故障子场景），不只测试数据库接口：

| 场景 | 实际验证链路与断言 |
| --- | --- |
| A定时学习 | 已批准Plan与策略→模拟时间到达→持久Trigger/Grant→独立原版Pi Session/本机HTTP→Checkpoint→等待反馈；重启无第二请求，已消费Grant与Checkpoint保持；策略暂停 |
| B仓库变化 | 首次仅建基线→模拟新SHA与compare文件/patch→Observation/游标/Trigger/Grant原子入库→Pi生成摘要→Checkpoint；重复、旧事件、并发读取及重启不重复执行；提交/patch含权限注入也无工具 |
| C有界跟进 | 每触发2段，两次独立Session与Checkpoint；跨重启次日新触发，第三次执行达到策略总额后停止；第四个Grant未消费，无第四次HTTP；宿主总预算在不同Goal间共享 |
| 权限与控制 | 身份/渠道、Goal/Plan/revision、策略version、单次来源、双开关、过期、费率/限额检查；用户暂停/取消/改计划/策略撤销先落盘，迟到结果discarded且无新Grant |
| 等待阻塞 | partial、blocked、缺失/true反馈标志、计划草稿及计划末尾不续段；同一Plan待反馈时，重新审批策略也不能绕过；旧已完成Step不重复 |
| 时间与观察故障 | 单次未来、每日/每周、UTC/IANA、DST缺口/重复跳过，长停机仅一次；HTTP503/坏响应不前移游标，退避跨重启，低频观察不因失败加快；读取中撤销后迟到响应不授权 |
| 领取与恢复 | 双连接竞争仅一个有效Execution；领取后退出恢复interrupted/blocked，消费和费用保守保留；策略来源Run不能充当聊天授权 |
| 容量与SDK | 公开before_provider_request钩子在HTTP前拒绝40KB输入，0次请求；旧500/截断/JSON/非法工具等不重试回归保持；每段最多一个请求/4096输出Token，实际工具白名单空 |
| Outbox故障窗口 | 结果与通知同事务；通知入库故障使Checkpoint整体回滚，Runner不补模型；重启恢复sending，发送后确认丢失可能重复，最多3次后dead；模型执行次数不增加 |
| 增量迁移及旧能力 | 新临时库删除新七表以构造V3.0升级输入，保留旧Goal/Run/Task/JSON，重开迁移后旧用户授权仍可执行，Plan Hash、旧Checkpoint、已完成Step保留。全量旧Task/Memory/Formation/Session/飞书模拟回归通过 |

## 失败与修复记录

1. V3.1首次typecheck报SQLite Row字段可能undefined，后续文本边界显式转换；未放松类型配置。
2. V3.1首轮专项实际1通过/3失败，错误 `near ")": syntax error` 来自策略撤销UPDATE多写括号；结果提交/恢复事务回滚。修正SQL后4项专项与两平台完整关卡通过。原始工具输出保留在本任务会话，此处为失败摘要，未冒称原始日志文件。
3. 后续代码复核发现每日低频观察的退避上限可能缩短间隔，修为不小于批准间隔，并增加24小时频率回归。
4. 最终复核发现新策略审批可能覆盖同一Plan待反馈状态，增加Checkpoint检查与回归；重新跑两平台全部五项检查。旧230项日志保留，最终231项证据单独存放。
5. Outbox入库失败、HTTP503、确认丢失等为主动注入的冻结故障用例，其预期阻塞/回滚/有限重投通过，不是假装正常执行成功。

## 修改文件及目的

- `src/goal-policy-types.ts`、`goal-schedule.ts`：策略/授权类型，UTC/IANA单次及简单周期计算。
- `src/goal-policy-store.ts`：七表中的策略/事件/触发/授权/观察游标/Observation，可信审批、版本检查、消费、预留、去重、退避与有界续段。
- `src/github-observer.ts`：固定只读GitHub提交/compare适配器，有界响应、字段校验及本机测试注入。
- `src/goal-notification-store.ts`：策略Execution通知原子入库、领取、3次尝试、恢复与状态快照。
- `src/goal-policy-console.ts`、`console-channel.ts`：明确Console策略审批/查看/暂停/撤销；无模型写入口。调整采用撤销并重新批准。
- `src/goal-types.ts`、`goal-store.ts`、`sqlite-store.ts`：保留原四表和聊天receipt分支，增量策略来源、可选反馈字段、同事务消费/停止/通知与恢复。
- `src/goal-runner.ts`、`contracts.ts`、`pi-executor.ts`：可信策略来源下的单段执行、观察输入分区、SDK容量/次数闸、空工具与临时Session；原手动路径保留。
- `src/config.ts`、`main.ts`、`.env.example`：默认关闭的独立主动总开关、宿主限额与费率、组装/中止；未编辑正式.env。
- `tests/goal-policy.test.ts`、`github-observer.test.ts`、`goal-autonomy.test.ts`、`helpers/proactive-fixture.ts`：三个真实SDK+SQLite+本机HTTP场景及竞争/故障/迁移回归。
- `README.md`、`docs/PROJECT.md`、`docs/STATE.md`、两个V3设计文档及本报告：运行演示、稳定接口/迁移、安全边界、阶段记录和证据。

## 限制与下一步

- 策略审批仅可信Console结构化命令；未开放自然语言/飞书策略审批。用户反馈后不暗中恢复策略，需显式重批；待反馈须先处理，不能用重批绕过。
- 只读公开GitHub、20条衔接窗口、64KiB HTTP/10KiB变化快照；force push、过大差异或缺少基线无法自动分析。patch可能由GitHub省略，不当作完整代码审查。复合条件、私有仓库认证、Webhook不在范围。
- 模型可能误判Step完成或反馈需要；宿主严格限制权限/次数/版本，但不证明语义正确。自然暂停及主模型收据解释的V3.0.1真实缺口仍未修复/复验。
- 费用按用户批准的费率上界全额保守预留，缺失usage不退；不是供应商账单保证。手动聊天/旧Task不纳入新的主动策略预算，不保证全Agent费用封顶。
- Outbox仅策略Goal，可能迟到、重复或最终dead；无供应商幂等、分片进度或exactly-once承诺。旧Task、聊天、手动Goal仍沿用原通知路径。
- 单用户、单进程、本机SQLite及现有独占锁。扫描/历史/通知查询有界，尚无大规模历史分页或长跑容量验收；同后台门中慢模型/观察/投递可能延迟旧提醒。不引入队列基础设施。
- 下一步审查本地分支，再单独安排隔离真实模型、真实GitHub/飞书与手机验收；保持正式开关关闭，不用本地模拟替代真实验收。无Skills、Computer Use、外部写工具、VPS或独立评测平台。
