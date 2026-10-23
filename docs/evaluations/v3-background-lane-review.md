# V3 BackgroundLane 定点可靠性审查

2026-10-23；基线为本地/远端main `5c07ec79466a7c283e974f1eabac6d4369ef0d4f`。本轮只审查和修复Goal侧调度边界及待领取授权，不扩大权限、引入框架或修改正式配置/数据。修复在本地分支 `fix/v3-background-lane`，未经本轮发布授权不推送。

## 复现与结论

先添加确定性测试，再改生产代码。使用真实SQLite、同一个BackgroundLane、原版Pi SDK 1.3.0、本机模型HTTP和GitHub HTTP桩；用Promise屏障固定网络先后顺序，模拟时钟精确跨过Task到期点，不按墙钟延迟猜测竞争。

原代码六项全部失败，原始日志 `E:/AgentWork/validation/personal-agent-background-lane-20261023/baseline-red.log`：

| 固定交错 | 原代码实际结果 | 修复后 |
| --- | --- | --- |
| Observer请求挂起→Task到期→Task tick | Task仍pending，模型请求0 | Observer未返回前Task已succeeded，请求1 |
| Observer期间Task到期，返回后只先运行Goal tick | Task仍pending，Goal已调用模型1次 | Goal请求0、Grant仍未消费；Task先执行，再领取Goal |
| 已签发观察Grant延后到下一观察时点 | 策略paused、Grant revoked，Goal请求0 | 原Grant消费1次，单个Observation/Execution |
| 执行前Outbox挂起→Task到期 | Task仍pending | Task已完成 |
| 提交后Outbox挂起→Task到期 | Task仍pending | Task已完成，Checkpoint不重跑 |
| 同步checkReady跨过Task到期点 | Task仍pending，Goal已调用模型1次 | Goal请求0、预留0，Task先执行 |

根因是GoalRunner在整个异步tick中持门，且只在Observer之前检查Task；新主动模块把可达多个请求超时的网络等待串到模型互斥范围。另一根因是扫描把合法ready授权当作“不是waiting_user”的阻塞，延后领取或重启后可能撤销有效Grant。

## 最小修复及不变量

- `src/goal-runner.ts`：开始时瞬时探测准入，立即释放；Outbox/观察网络在门外。返回后重新获取门，读取当前Goal；门内和同步健康检查后都核对Task，才调用原claim。模型执行和聚合结果提交保持门内，结束只释放一次，再等待通知。
- `src/goal-policy-store.ts`：识别Goal/Plan/revision、策略ID/version均匹配的待领取ready授权；时间扫描和观察不再次签发或误撤销。期限、权限、取消/计划变更和预算校验仍在原扫描/领取/提交事务执行，未放宽。
- `tests/background-competition.test.ts`：18项专项及多个控制子场景。测试辅助夹具仅增加可注入共享门/渠道和模拟时钟读取，不改原冻结预期。
- `PROJECT`、`STATE`及主动设计同步实际调度边界；旧V3报告保留历史事实。

BackgroundLane、TaskScheduler、数据库DDL、权限解析器、预算和Checkpoint/Outbox事务代码均未修改。整个Goal tick仍由原work字段串行；Observer仍以版本/游标/CAS和唯一键落盘；Grant消费与Execution创建仍原子、唯一。多个tick/重启不会成为额外授权。

控制和退出断言：观察中退出会abort HTTP，取消/撤销后的迟到响应不落Observation或Grant；投递中stop等待在途发送结束，再退出，不遗留回调写入已关闭数据库，也不继续扫描/领取。Task持门时释放Outbox不能二次释放Task的门；最大并行模型数为1。等待Grant期间暂停/取消/改计划/撤销/到期均阻止消费，预留0、旧Checkpoint不变；合法等待Grant跨重启只消费一次。

## 验证记录

- 原始六项失败日志保持不变；首次修复六项转绿。
- 18项专项全部通过，日志 `final-focused-v2.log`。其中包括两种Outbox、Observer和Task竞争、12次并发tick、模型并行度、前台准入、退出/取消/撤销、未消费Grant跨重启和五种失效控制。
- 修复复核时发现前台已排队仍可能在门外签发Grant，新增回归先得到 `4 !== 3`（Goal revision），保留 `preflight-foreground-red.log`；瞬时准入探测后转绿。没有放宽预期。
- 首轮Windows246项243通过/3原平台跳过，Linux246全过，两边五个检查均退出0。补充恢复/控制和前台准入后，最终Windows249项246通过/0失败/3原平台跳过，断网Linux249通过/0失败/0跳过；两边 `npm run typecheck`、`npm run build`、`npm test`、`npm run eval:memory`、`npm run eval:formation -- --output=<新路径>` 全部退出0。Windows跳过仍为POSIX权限位、符号链接权限及POSIX SIGTERM，Linux均实际运行。
- 本轮新增测试的第一次typecheck发现mock参数缺类型，已显式标注ExecutionRequest；原生产类型和tsconfig未放宽。

证据根目录 `E:/AgentWork/validation/personal-agent-background-lane-20261023`；首轮及最终release日志分开保存，旧V3.0.1及V3.1–3.3历史验收数据不改。最终Windows/Linux的108份源码/测试/脚本/构建配置原始Hash完全一致，汇总见 `release/result.json`；原E盘工作区8份文件Hash不变。Memory离线三集Top1/Recall@5/MRR保持9/12、17/19、17/18，无答案误supported均0；Formation开发/留出各30/30、未经批准写入0。全部模拟，无收费模型请求、真实GitHub观察、飞书或手机操作，不能代替真实语义验收。

## 剩余风险

1. 已经领取并运行的Goal仍是有界、不抢占；Task在此后才到期，仍须等该片段完成/中断及提交。不提供硬实时截止保证。
2. 同步SQLite、Memory健康检查或事件循环阻塞仍可延迟调度。旧Task自身的发送仍保持原持门路径，未顺手改其通知语义。
3. 网络不占Task的门，但整个Goal tick仍串行；慢Outbox/Observer会延后同Runner的其他Goal。渠道接口无强制取消能力，正常退出等待在途投递；现有飞书传输有单次超时，不能承诺任意自定义Channel都迅速退出。
4. 取消后在途历史通知可能完成投递，它是已提交结果快照，不是新执行。通知仍可能重复、最终dead或长消息部分送达，没有exactly-once/必达保证。
5. 单用户/单进程和现有独占锁范围不变；未验正式主动执行、真实模型输出、真实GitHub/飞书或长跑。V3.0.1自然暂停和主模型收据误解的真实失败均保留，未修复/未复验。

## 本地真实模型最小验收建议（本轮未执行）

建议下一轮仅Console、新隔离数据目录、虚构Goal/Plan、本机模拟GitHub和投递屏障，仍不用真实账号或手机。预置虚构已批准Plan仅用于调度测试，用户通过确定性策略命令批准；不将其计为自然语言创建/审批通过。

1. Observer保持挂起，令旧Task到期：先看到Task完成，再释放观察并允许Goal一段。预计Task1次+Goal1次请求。
2. Goal一段提交后，保持Outbox发送挂起，令另一Task到期：Task仍应完成，释放投递后Checkpoint及执行次数不变。预计Goal1次+Task1次。
3. 只查询SQLite核对每个Task Run、Observation/Grant消费、Execution前后Checkpoint和通知状态；暂停/撤销后不得出现新请求，不为凑次数额外生成。

预计4次，硬上限建议6次模型HTTP请求、人民币0.5元保守预留，任一上限达到即停止；不是供应商账单保证。正式联网前需先给该隔离入口接入独立的请求/容量/预算及跨重启账本闸，离线证明有效，并核对本机模型费率上界；费率未知则不联网。不得沿用旧48次或16次账本，不自动重试/修JSON；失败保留原始输出，停止对应场景。本轮未实现或运行收费入口，仅交付建议。
