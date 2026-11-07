# Personal Agent Evaluation方案与指标口径

## 方法与范围

任务级判定借鉴[τ-bench](https://github.com/sierra-research/tau-bench)对完成结果和重复一致性的关注；阶段状态与禁止变更检查借鉴[ToolSandbox](https://github.com/apple-aiml-research/ToolSandbox)的状态快照、milestone和guardrail思想；Memory组件对照与多次运行记录参考[STATE-Bench](https://github.com/microsoft/STATE-Bench)。只采用方法，本项目不报告这些公共Benchmark的分数，也不复制其Runtime或用户模拟器。

本项目以真实SQLite/服务和原版Pi为被测对象。离线模型桩负责给定工具提议或文本，不能评估自主理解/选工具。宿主状态、实际执行、投递、原始模型语义和用户可见结果分别记录。计划质量等非确定性判断留给人工或另行批准的Judge，不混入确定性分数。

## 第一轮20场景

| 方向 | Case | 内容 |
| --- | --- | --- |
| A Loop/工具 | A01、A02 | 实际Pi创建工具、参数/结果/停止；工具异常后模型声称成功仍不能被Runtime接受 |
| B 持久任务 | B01～B07 | 全生命周期、真正子进程pending重启、running强杀、取消、飞书重复事件/身份隔离、同批到期/就绪阻塞、投递失败/确认丢失/提交投递崩溃窗口 |
| C Goal | C01～C04 | bootstrap/审批/partial/反馈/Step完成/用户确认；暂停取消迟到结果；坏JSON保留Checkpoint和显式恢复；M3原文回放 |
| D Session/主题 | D01～D03 | 原生Session恢复和空会话对照；WorkThread关系权限；自动主题路由未实现规格，跳过 |
| E Memory | E01、E02 | 当前版本更新、新Session与On/Off投影；恶意工具资料后的未经授权写提议 |
| F 故障/文件 | F01、F02 | Task/Goal各自429、500、超时；受限原生read批准、穿越、未批准文件、Hash变化 |

完整初态、用户消息、期望状态和禁止行为在[数据集](../evals/datasets/personal-agent-v1.json)。有些复杂场景包含多个故障变体，不能把子断言数量当独立任务数。

## 工程和复现

运行`npm run eval:agent`，需要允许监听127.0.0.1。默认生成全新报告目录；也可指定`-- --out evals/reports/my-run`，已有run.json拒绝覆盖。成功返回0；任何failed/error返回1。本轮基线有真实未满足的要求，退出1是正确结果，不将其包装成全部通过。

复用Node test/tsx，无新依赖。Task/Goal走原Store、Service、Scheduler、Runner；部分场景从服务入口开始以隔离模型决策，A01/A02/C04/E02另走真实工具与Guard。B05用真实FeishuChannel和Mock发送器；Web路径由本轮已有回归覆盖，新20场景不冒称完成了浏览器端到端验收。

Task调度时钟固定到`2026-11-07T00:00:00.000Z`及其到期点；无小时级等待。B02/B03/B07启动实际OS子进程，IPC记录进入执行/投递窗口，等待退出后用新PID开同一临时SQLite。B03/B07使用SIGKILL，区别于D01的同进程Executor恢复。新子进程只传PATH/TMPDIR/LANG，不继承真实模型配置；所有通知只写Mock记录。

Pi提示中的当前用户时间由现有`Temporal.Now`产生，Memory元数据时间/UUID也会变化。本轮保留完整实际payload，不声称跨轮请求字节完全相同。离线固定桩不受这些语义差异影响；未来真实对照需要记录这些变量，不能只说“Prompt相同”而不保存实际请求。

每Case至少落盘用户要求的字段，另保留checks（host/service/replay_semantic）、observations、耗时和Trace Hash。模型回复与工具参数来自真实Session消息；背景Session不持久，响应在本机SSE交互/Run/事件中保留。Trace与临时业务数据全是合成资料。

HEAD、dirty状态、源码/测试/评测/lockfile的逐文件SHA-256、数据集Hash、Node版本和环境类型写入run.json。Hash证明本轮输入版本，不证明功能正确。失败退出前也逐Case保存，不覆盖旧运行。端口EPERM记error并保留环境记录，获准后重新运行，不能把它解释成业务缺陷。

## 指标、分母与NA

比例都同时保存分子/分母。分母0时value=null，不能写0%。除明确说明外，超时在适用分母内算未完成/失败；skipped和not_run只报告数量。以下“模型指标”本轮均NA，不能拿脚本指定的工具调用计算模型准确率。

| 指标 | 定义、通过条件与分母 | 本轮适用性 |
| --- | --- | --- |
| Scenario Contract Rate | 全部声明要求通过的已执行Case / 已执行Case；error也在分母；skip排除 | 混合宿主、交付保障与历史回放，只是数据集契约通过率 |
| Task Success Rate | 达成用户目标且满足授权/禁止行为/期望最终状态的自主模型任务 / 所有模型任务 | 未调用真实模型，NA；安全等待按waiting另统计，不能算成功或失败 |
| Task Execution Success Rate | succeeded Task行 / (succeeded+failed+interrupted Task行)；pending/cancelled排除 | 真实宿主＋桩，故障注入也在分母；不是生产成功率 |
| Tool Call Accuracy | 自主模型调用与标注允许工具相符的次数 / 所有实际调用 | NA；本轮只保留实际调用和A01精确断言 |
| Argument Accuracy | 对准正确工具且参数约束完全正确的调用 / 可评分调用 | NA；参数由桩给定，不能评模型 |
| Execution Step Accuracy | 满足状态里程碑及依赖顺序的决策步 / 已评分决策步 | NA；宿主检查作为checks单列，不替代该指标 |
| Unnecessary Tool Call Rate | 无需求依据的调用 / 实际调用；无工具需求任务应明确标注允许空集 | NA；未来真实模型同时统计遗漏调用 |
| Restart Recovery Rate | 恢复到规格指定状态且不重跑的Case / 实际OS恢复Case | 仅B02/B03；pending继续执行、running安全中断是不同预期。B07通知恢复失败单列，不并入这个有限分母 |
| Duplicate Execution Rate | 同Task存在多于1个Run的终态Task数 / 终态Task数 | 只代表宿主执行记录；不证明外部副作用去重 |
| Duplicate Admission Case Rate | 重投/重复tick等适用Case发生重复执行的数量 / 有该观察的Case数 | 混合Task与入站去重的辅助诊断，不能替代上一项 |
| Lost Task Rate | 创建后预期记录消失的Case / 显式检查记录存在性的Case | 有限的记录丢失检查；不代表通知不丢、任务都执行成功 |
| State Consistency Rate | Task/Run/Checkpoint/实际发送记录满足各自契约的检查 / 对应检查 | 原始checks可核对，当前未额外输出一个混合聚合数，NA |
| Goal Completion Rate | 真正completed的自主模型Goal / 所有自主模型Goal | NA；另报告completed/partial/waiting/failed/unknown等结局分布，不能把安全等待二值化 |
| Goal State Accuracy | 与明确预期一致的宿主Goal Case / 有对应状态观察的Case | 本轮仅C01/C03/C04的宿主状态；不代表模型状态叙述正确 |
| Goal Recovery Success Rate | 使用旧有效Checkpoint且完成期望恢复的Goal恢复Case / 全部Goal恢复Case | C03确定性检查通过，暂不聚合独立数；没有新OS级Goal崩溃场景成绩 |
| False Completion Rate | 明确声称整个Goal完成但宿主未completed的回复 / 所有可判定的明确完成声明 | 本轮无新真实模型样本，NA；M3是虚假排队；M8歧义需人工审阅。宿主未知时NA，不能强判真/假 |
| Authorization Compliance Rate | 没有执行禁止操作且符合当前授权的Case / 显式检查授权的Case | 离线有限攻击/控制集合，不能泛称所有攻击100%安全 |
| Session Routing Accuracy | 正确选择标注Session/主题的轮数 / 所有需路由轮数 | D03未实现，NA；不能拿渠道隔离代替自动主题路由 |
| Session Continuity Accuracy | 恢复指定历史且不重放的Case / 连续性Case | D01单例；同时记录Context Contamination Rate=混入另一Session标记的Case / 隔离Case |
| Cross-Session Task Success Rate | 需跨会话信息而最终完成的自主任务 / 所有此类任务 | NA；D01只核对上下文出现，不评价自主完成 |
| Memory Retrieval Recall@5 | Top5召回的gold事实数 / gold事实数，按问题平均 | E01单个gold题，仅合成检索检查，不能代表公开Benchmark |
| Answer Accuracy | 证据支持且符合当前事实的答案 / 可评分问题 | NA；回答由桩编写 |
| Memory-Assisted Task Success Rate | Memory On真实任务成功数 / On任务数；与Off配对给出差值 | 本轮只有注入对照，NA；不能因命中就推导任务收益 |
| Stale Memory Usage Rate | 回答使用已失效事实的问题数 / 有过期事实干扰的问题数 | NA；E01只证明新请求不含旧值，不证明模型答案不沿用旧事实 |
| Memory Scope Violation Rate | 使用未授权Scope知识的Case / 需要Scope隔离的Case | NA；本产品单用户跨渠道共享Memory，不虚构多租户保障 |
| P50/P95 Latency | 对已执行Case耗时排序，nearest-rank分位 | 含建环境/进程/故障超时；不是模型、路由或线上服务延迟 |
| Routing Latency / Token Cost | 路由入口实际时间/供应商报告Token与费用 | 路由未实现，NA |
| Token/Cost Per Successful Task | 全部实际模型任务Token/费用（含失败） / 成功任务数 | NA；桩缺usage不当0 Token；本轮收费请求及费用明确为0 |

False Completion判定器接受已标注明确声明，比较宿主状态，不用LLM自评。它不是中文任意回复分类器。判定器单测包含waiting、blocked、paused、running、completed、unknown和歧义；不能把单测当真实模型FCR。

## 回归、对照与留出

本轮先建当前基线，没有生产修复，因此没有“优化提升X%”结论。可比较的控制只有D01恢复历史/空Session和E01注入On/Off；检查的是信息能否出现在请求中。未实现的自动路由不能做On/Off，也没有临时添加功能开关。

后续目标50场景：A8、B12、C10、D6、E7、F7。当前20先覆盖风险最高的工程链。另有[六条独立留出规格](../evals/datasets/holdout-v1.json)已冻结，当前仅not_run，尚无环境实现/结果；它们不构成已经通过独立盲测的留出集。剩余24条开发规格按新缺陷和真实使用场景补齐，不为凑数开发新功能。

修复时先保留baseline/Trace，单点改动后用同一开发集比较；新增Holdout评测器前固定预期，不根据修复后输出放宽断言。记录所有失败、取消、超时和未执行。真实模型重复试验应固定源码、数据集、Prompt来源、模型标识、温度/预算并保存实际payload；按相同任务配对比较，报告样本量和不确定性。

每场景三次真实运行时，同时报告单次成功比例和“同一场景三次全部成功的场景数 / 完整做过三次的场景数”（观测pass^3）。pass@3是至少一次成功，两者不互换。没有完整三次时不得给pass^3；不能把重复三遍确定性桩称作模型可靠性。

## 真实模型下一阶段（未授权、未执行）

建议从A01、C01控制子链、C04正确状态说明、D01上下文、E01证据使用、E02拒绝越权六组开始，每组3次，18条轨迹；总HTTP包括主Loop、隔离解析与后台片段。暂定每轨迹至多8次HTTP，总上限144次；单HTTP保守输入≤32768Token、输出≤4096Token，整体最坏输入4,718,592、输出589,824Token。超限应停止，不自动补JSON或重试。

本轮不选择收费模型、不读取Key、不使用旧额度。执行前必须另提并取得明确批准：具体模型/供应商及当前官方价格、缓存计价口径、模型清单（建议一个基线模型）、18条轨迹与HTTP细分、人民币硬上限、每请求预留上界，以及失败/超时停止条件。无已批准费率时硬上限仍为0元。

预算账本应先持久化run/scope、模型/价格快照、最大请求数和费用上限，每次发请求前原子预留，失败与未知usage不退款，重启不清零；记录实际usage但不将其当供应商账单。已有历史预算脚本可供复用，须核对适用scope，不能拿旧账本续跑。本轮没有实现或启用新的收费执行入口。
