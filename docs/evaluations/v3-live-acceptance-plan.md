# V3.0 Batch 5：真实验收方案（本轮额度已用尽，执行结果另记）

方案初稿：2026-10-22；授权更新：2026-10-23（Asia/Shanghai）。用户已明确批准先补GOAL_ENABLED及回归，然后在隔离环境完成Batch5，最多48个模型HTTP请求/5元保守预留。用户后续表示手机不便，授权在电脑继续真实模型验收；飞书与手机本轮不复测，不能据此标为通过。实际记录见[Batch5报告](v3-batch5-acceptance.md)。当前实际48/48请求、预留2.337244元，已停服；电脑核心通过但完整清单未通过，不再发起本轮调用。最后暂停修复、其他控制及手机若补测须另行批准新预算，不能因5元有余额自动续测。本方案不是执行结果；Batch1–4的模拟测试不能替代真实语义质量或手机送达证据。

## 本轮批准范围与费用

- 本轮最多 **48个模型HTTP请求、人民币5元保守预留**，任一先到即停；不自动补测、扩额或重置账本。失败/中断/未知用量同样计入。主模型、隔离意图解析、Goal片段全部计数；不是48条手机消息。
- 单次输出最多4096 Token，意图解析最多1000 Token。每个实际Goal片段只有一个请求；一次控制通常是主模型工具提议、隔离解析、主模型收尾共3请求，有效短确认通常2请求，另加被明确授权的1个Goal请求。主模型可能漏工具或额外调用，按实际账本记，不承诺固定消耗。
- 仅使用批准的兼容端点/模型、本人飞书应用和白名单账号，虚构目标/经历。启动前从供应商当前官方价格页核对输入/输出费率上界（含峰时及适用附加项），写入当前进程 `GOAL_ACCEPTANCE_INPUT_RATE`、`GOAL_ACCEPTANCE_OUTPUT_RATE`，单位元/百万Token；不把历史Formation费率当当前报价。费率不明则不启动。
- 每请求预留微元 `ceil((完整请求UTF-8字节数+512)×输入费率 + 最大输出Token×输出费率)`。完整请求含系统、工具Schema和Session。字节数不是精确Token测量，不能证明供应商账单硬上限；额外收费类别不在批准上界中则停止。达到5元预留可能早于48请求，届时报告未完成项。
- 新轮新根目录、新账本和响应文件；不复用或修改以前两个Formation账本。不改正式.env、正式数据、正式Formation开关、已发布机器人权限或应用版本。手机测试会向本人机器人会话发送结果，须一并批准。

## 启动与停止（本轮已批准）

先确认正式服务已经正常停止，避免同一应用多条连接争抢。用Node>=24.15.0，完成typecheck/build/test。选择一个**尚不存在**的E盘目录，例 `E:/AgentWork/acceptance/v3-goals-round-01`；不要先手工建空根目录。用本机已有凭据配置，不把Key、Secret或open_id贴进聊天。

启动器的 `--model-only` 运行原版Console/Service/Guard/Pi链路。用户起初要求先真实模型、手机稍后，曾为手机预留额度；14请求后用户改为电脑继续验收，现Console沿用同一48请求/5元总闸，不新开账本。以后手机若另行复测，不带该参数并以 `--resume` 沿用剩余额度；预算耗尽则须另行批准新预算。Console目标与飞书目标按原归属隔离，不能把Console输入当手机输入，也不能让飞书接管Console目标；手机核心闭环须另用虚构目标实测。2026-10-23核对[硅基流动官方价格页](https://www.siliconflow.cn/pricing)：deepseek-ai/DeepSeek-V4.1-Flash较高时段输入2、输出8、缓存读取0.04元/百万Token；本轮预留使用2/8且不扣缓存折扣。

```powershell
# 两个费率值须在批准时核对并设置；不要照抄未知数字。
$env:GOAL_ACCEPTANCE_INPUT_RATE='<批准的输入费率>'
$env:GOAL_ACCEPTANCE_OUTPUT_RATE='<批准的输出费率>'
node --env-file=.env --import tsx scripts/goal-feishu-acceptance.ts --authorized '--root=E:/AgentWork/acceptance/v3-goals-round-01'
```

[验收入口](../../scripts/goal-feishu-acceptance.ts)无上述显式参数会在读取配置及联网前退出。它在当前进程覆盖三份数据路径、显式开启GOAL_ENABLED，并关闭Formation与查询改写；文件.env不变。只允许指定兼容模型端点和原有飞书渠道，不注册任何外部工具。账本先原子落盘再请求，不因HTTP失败或重启退额度；配置/预算失败停止测试服务。

输入 `/stop` 正常退出，等待锁释放。续测使用**同一根目录、身份、模型、费率和账本**：

```powershell
node --env-file=.env --import tsx scripts/goal-feishu-acceptance.ts --authorized --resume --fresh-session '--root=E:/AgentWork/acceptance/v3-goals-round-01'
```

`--fresh-session`第一次使用新建sessions-fresh，旧sessions保留；后续同名参数会恢复该目录，不会反复清空历史。空会话验收前确认该渠道身份的chat.session.jsonl尚不存在或user/assistant历史为0；Console与飞书的身份子目录不同，不以另一个渠道是否用过根目录判断。不得删除Session、账本或acceptance.lock来重置额度；异常退出后先核对进程和账本，再人工处理遗留锁。

## 手机话术与验收顺序

核心闭环优先；计划必须先看再批准。下表中的名称是虚构数据，可按实际步骤数/问题调整反馈；如果模型输出过多步骤、虚构经历或缺少必要问题，记录真实失败，不替模型改答案后宣称通过。以下全部场景若超出预算，停止并标记剩余项未验。

| 顺序 | 手机话术或动作 | 手机和SQLite共同核对 |
| --- | --- | --- |
| 1 | “帮我逐步准备V3验收面试，只有虚构经历。计划最多两步，每次只推进一段；不要替我假设已经掌握知识。” | 1个Goal/v0/bootstrap，至多1个Execution；先排队收据，再有成果/问题/待批准计划，不能自动连续执行 |
| 2 | 阅读计划后“批准V3验收面试计划并继续一段” | 计划v1才接受，1个新Execution，前指针为bootstrap；完成或partial均须等待用户 |
| 3 | 按模型问题给虚构反馈，并明确“继续V3验收面试任务这一段” | 仅1个新Execution；使用上次成果/问题，不把已经completed步骤重新领取 |
| 4 | waiting_user时`/stop`；同库/Memory、第一次全新Session重启；手机“查看V3验收面试目标进度” | 重启和等待本身0请求；首问前聊天user/assistant历史0，查询可重展示相同Checkpoint，不新增Execution |
| 5 | “V3验收面试计划先补Agent Loop” | 只保存待批准新草稿，旧计划和成果仍在；没有Goal模型请求；手机可看新旧步骤差异 |
| 6 | 阅读后“确认” | 只批准新计划，不执行、不ready；核对draftHash/来源Run/planRevision，不能被模型扩大为继续 |
| 7 | “继续之前的V3验收面试准备任务” | 新授权只推进1段。若所有步骤尚未交付，最多在剩余预算内重复本步骤；不承诺有限话术能证明学习效果 |
| 8 | 仅在当前计划全部交付后“确认V3验收面试目标已完成” | waiting_user→completed，无新Goal请求；模型自己的“已完成”不能产生终态 |
| 9 | 若预算足够，创建“V3对照面试”与“V3另一个面试”两个相似目标 | 各创建只执行一次bootstrap，不因相似而合并；不影响已完成目标 |
| 10 | “暂停面试任务” | 多目标澄清，展示固定编号；不能凭相似度擅自暂停；completed记录可能显示但不能改变 |
| 11 | “第N个”（选择一个未终结的对照目标） | 仅所选目标paused，清单不重排；若清单已过期/版本变化，重新查看再选，不强行执行 |
| 12 | “取消V3对照面试目标” | cancelled，旧Checkpoint仍可查；没有新Goal请求；其他目标状态不变 |

若要单独验证“暂停那个学习计划”，可在剩余预算内新建一个独特学习目标后暂停；否则记录为已有自动化而未真实覆盖。运行中暂停/取消、强杀、失败提交和通知丢失以自动化慢模型故障注入为主，不为碰到时间窗口盲目重复收费。实际话术、分支、请求数和未出现分支逐项记录。

## SQLite核对与证据

每个关键点先读库，结束时正常停服后再留快照；备份agent.db以及仍存在的WAL/SHM，不能仅复制一个活跃.db当完整备份。只操作本轮新根目录。

```powershell
node --import tsx scripts/audit-goals.ts E:/AgentWork/acceptance/v3-goals-round-01/agent.db
```

[只读核对器](../../scripts/audit-goals.ts)输出Goal ID/状态/revision/planRevision/Checkpoint指针/执行数量/投递错误数量及不变量异常；不读.env、不调用模型、不建表、不修改状态、不输出正文。它只证明结构一致性，不证明模型产物语义正确。需在本机另行查看目标正文、计划及checkpointJson，与手机实际内容比对，敏感内容不发聊天。

本机SQLite工具可按以下查询交叉核对；将 `<goal-id>` 替换为核对器显示的本轮ID：

```sql
SELECT id,status,revision,planRevision,currentStepId,checkpointRunId,controlRequested FROM goals;
SELECT goalId,revision,baseRevision,sourceRunId,approvedByRunId,hash FROM goal_plans WHERE goalId='<goal-id>' ORDER BY revision;
SELECT e.runId,e.sequence,e.stepId,e.planRevision,e.triggerRunId,e.status,e.baseCheckpointRunId,e.checkpointHash,r.status,r.deliveryError
FROM goal_executions e JOIN runs r ON r.id=e.runId WHERE e.goalId='<goal-id>' ORDER BY e.sequence;
SELECT runId,type,details FROM run_events WHERE type IN ('goal_control','goal_claimed','goal_checkpoint_committed','goal_execution_stopped','agent_settled','delivery_succeeded','delivery_failed');
SELECT runId,details FROM model_calls ORDER BY id;
```

重点：一个triggerRunId最多一个Execution；Checkpoint只指committed；成功结果、Step和Goal同进度；waiting/paused/completed/cancelled不自动请求；暂停取消先控制收据后结束执行；通知失败不多一条Execution。Memory Markdown/Hash与候选数前后不变，Task没有被Goal伪造创建。短确认必须对应实际成功投递的完整计划视图。

保留本轮budget.json、response-NN.txt、SQLite/Session快照、文件Hash、手机实际截图或用户确认、原始失败。按model_calls区分输入/输出/缓存和未知cost，账本预留不是实际账单；强杀可能已计费而无用量。若模型漏工具、错误计划、误筛目标、未送达或预算不足，报告失败/未完成，不能用主模型口头回复替代真实状态。

交付审查后再决定是否日常使用，不在本轮开启正式Formation、部署VPS、增加权限、Skills、Observer、自主循环或Outbox。
