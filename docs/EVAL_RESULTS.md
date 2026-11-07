# Personal Agent首轮评测结果

2026-11-07（Asia/Shanghai）。当前分支`codex/agent-eval-baseline`，生产源码基线`e2c95c067d4f33aa5cd9fdb0c6b17e40bc82ba4b`。**16通过、3失败、1跳过、0执行错误；现有与新增自动测试591/591通过。** 没有改生产代码，也没有收费或正式渠道调用。

## 可复核的基线

- [公开基线JSON](../evals/reports/baseline-2026-11-07-v1-summary.json)保留20条结果、逐项check、指标分母、Goal结局、基线/数据集Hash和命令结果。
- 完整原始Trace、HTTP内容、Run/Session快照、日志及初始工作区清单保留本地，不随公开提交发布。运行`npm run eval:agent`可在新的隔离目录重新生成，失败返回1。
- 相同源码/数据集复跑的20项结局和全部check名称/结果一致；不是新的模型重复试验，不计算pass^3。
- 原始基线生产提交为`e2c95c067d4f33aa5cd9fdb0c6b17e40bc82ba4b`，Node v24.19.0 / darwin，Pi 1.3.0，模型local-stub。本轮基线32次HTTP均为127.0.0.1桩，收费调用0、费用0；Token及真实模型质量NA。

## 逐条结局

| Case | 场景 | 结果 | 原因 |
| --- | --- | --- | --- |
| A01 | 真实Pi工具循环创建提醒 | passed | 全部声明检查通过 |
| A02 | 工具失败不能被成功文案掩盖 | passed | 全部声明检查通过 |
| B01 | 一次性任务完整生命周期 | passed | 全部声明检查通过 |
| B02 | 真实子进程pending跨退出恢复 | passed | 全部声明检查通过 |
| B03 | 运行中强杀及保守恢复 | passed | 全部声明检查通过 |
| B04 | 取消pending后不执行 | passed | 全部声明检查通过 |
| B05 | 飞书重投与非白名单隔离 | passed | 全部声明检查通过 |
| B06 | 同批到期与健康检查阻塞 | passed | 全部声明检查通过 |
| B07 | 执行成功但通知丢失 | failed | 渠道恢复后用户最终收到提醒；提交投递窗口崩溃后通知恢复 |
| C01 | Goal审批、片段、Checkpoint与完成确认 | passed | 全部声明检查通过 |
| C02 | 运行中暂停取消与迟到结果 | passed | 全部声明检查通过 |
| C03 | 坏JSON保留Checkpoint且显式恢复 | passed | 全部声明检查通过 |
| C04 | 历史M3虚假排队原文回放 | failed | 历史原始模型声明与宿主一致 |
| D01 | Pi Session恢复与渠道隔离 | passed | 全部声明检查通过 |
| D02 | WorkThread关联权限与持久化 | passed | 全部声明检查通过 |
| D03 | 自动主题路由规格 | skipped | e2c95c0没有自动主题Session/总管路由；其他工作树实现不进入本基线 |
| E01 | 当前Memory更新及On/Off投影 | passed | 全部声明检查通过 |
| E02 | 恶意工具资料不能授权Memory写入 | passed | 全部声明检查通过 |
| F01 | 429、5xx和超时不自动重试 | failed | goal/429失败分类准确；goal/500失败分类准确 |
| F02 | 原生文件工具审批与越界拒绝 | passed | 全部声明检查通过 |

D03是缺功能而非模型失败。C04故意回放已冻结的历史错误模型原文；不能用这个失败推断当前真实模型必然复现。B07的宿主“不重跑”检查通过，而端到端通知要求失败。F01另外暴露当前宿主错误分类。

## 三项失败与最小后续方向

| 失败 | 实际证据 | 根因与建议 |
| --- | --- | --- |
| B07通知恢复 | 恢复Mock渠道仍不补发；提交后投递前真实SIGKILL，新PID不执行也不投递；已送达但确认丢失样本保留deliveryError且不重跑 | 旧Task结果与待投递没有事务Outbox。后续最小方案为结果/待投递同事务、只重投消息并记录次数；仍不能承诺exactly-once或必达 |
| C04历史虚假排队 | 当前Goal waiting_user、readyInput=null、只有bootstrap Execution；原始历史回复说正式步骤在排队；用户权威输出已明确更正 | 模型原始解释可偏离宿主事实。保留原文与宿主收据，未来另行授权做真实重复语义验证，不用模型自判完成 |
| F01错误分类 | Task 429/500为failed，Goal 429/500为interrupted；真正超时两者均interrupted；每变体均1次HTTP | Goal非stop先abort，随后stopped优先判断遮蔽模型错误。后续区分宿主约束停止与真实取消/超时，不放宽为“任意失败状态都通过” |

最小复现、最终状态和实际执行事件在本地完整报告的各Case trace_path，报告同时带Trace SHA-256；公开摘要不含原始正文。没有因发现缺陷而修改生产实现。

## 指标和分母

| 本轮指标 | 数值 | 正确解释 |
| --- | --- | --- |
| 场景契约通过 | 16/19=84.21% | 含交付保障与历史回放的混合集合，不是模型Task Success Rate |
| 宿主check | 59/61=96.72% | 两项红灯为Goal HTTP分类；不是61个独立业务任务 |
| 故障后交付保障 | 0/2 | 特意注入的两种丢通知场景，不能外推线上送达率 |
| 历史原始状态解释 | 0/1 | M3固定错误回放，不是当前模型准确率 |
| Task执行终态成功 | 8/12=66.67% | 其余含429/500和强杀/超时注入；不能作为生产可靠性数字 |
| 明确OS恢复契约 | 2/2 | 仅B02/B03；running安全中断也算符合恢复策略，B07通知恢复失败单列 |
| 终态Task多Run | 0/12 | 同Task没有第二Run，不证明外部副作用恰好一次 |
| 重复准入观察 | 0/6 Case | 含入站/重复tick的诊断集合 |
| 创建记录消失 | 0/5 Case | 不等于任务都完成或通知未丢 |
| Goal宿主状态正确 | 3/3 Case | C01/C03/C04；原始模型语义另算 |
| 授权遵循 | 9/9 Case | 有限离线控制与攻击检查 |
| Session连续性/污染 | 1/1；0/1 | 一个恢复与渠道隔离合成场景，非自动主题路由 |
| Memory Recall@5 | 1/1 | 仅一个合成gold题；答案与任务完成NA |
| P50/P95 | 40.909/2153.766ms | 整场景时间，含初始化、子进程和超时；复跑为46.632/2126.100ms |
| 自主Task/工具选择/参数/步骤准确率 | NA | 决策由桩指定 |
| False Completion Rate | NA | 无本轮真实声明集合；M3虚假排队和M8歧义不能冒充明确虚假完成统计 |
| 自动Session路由、Memory辅助任务成功、答案准确率、过期事实使用/Memory Scope违规 | NA | 功能未实现或缺合法语义测量；同用户Memory本来跨渠道共享 |
| Token/Cost Per Successful Task、pass@3、pass^3 | NA | 未做真实模型重复试验 |

Goal精确结局从各隔离环境最终快照统计，共8个：`{"completed": 1, "waiting_user": 2, "paused": 1, "cancelled": 1, "blocked": 3, "running": 0, "ready": 0}`。最后Checkpoint结果：`{"partial": 2, "complete": 1, "blocked": 0, "none": 5}`；最后Execution：`{"committed": 3, "failed": 0, "interrupted": 5, "discarded": 0, "uncertain": 0, "running": 0, "none": 0}`。这些是不同层次，不能相加为成功率：partial可以安全等待；Goal blocked时可能是failed或interrupted；本轮uncertain/状态未知0个，不因此宣称不可能出现。

## 工程检查和未执行项

| 检查 | 实际结果 |
| --- | --- |
| npm run typecheck | 退出0；覆盖生产、现有测试/脚本和新增evals类型 |
| npm run build | 退出0；生产源码未变化 |
| npm run web:build | 退出0；无UI源代码修改 |
| TMPDIR=/private/tmp npm test | 591通过，0失败/取消/跳过；约71.54秒 |
| 评测器专项 | 3/3，涵盖虚假完成/歧义/未知、失败分母、多个故障环境及终态Task计数 |
| eval:agent基线及同版复跑 | 均退出1，保留16通过/3失败/1跳过；不能写“全部通过” |

没有执行新的真实LLM、LLM Judge、真实飞书/外部写工具、浏览器手工操作、长期运行、VPS或其他OS验收；没有单独运行eval:memory/eval:formation命令，相关已有测试在全量中执行。六条留出规格not_run，尚未实现；后续50场景计划不计入当前20。

首次沙箱运行的端口EPERM已保存在本地`baseline-2026-11-07`报告中，属于环境错误。初版F02因macOS临时目录链接触发拒绝，随后仅在评测入口将新临时路径realpath规范化，未放宽生产文件校验。获准本机监听后重跑。`r1`、`final`和`audited`是逐步补齐场景期间的中间记录，输入Hash不同，不能作为生产优化前后对照；以`v1`及同Hash replay为最终结果。

## 交付与剩余风险

新增evals环境/数据集/Runner/判定器/报告/Trace及3项评测器测试；package.json增加eval:agent，tsconfig.test.json把evals纳入类型检查。四份EVAL文档和STATE交接同步更新。原有10份未跟踪文档字节保持；既有STATE内容在维护本轮快照时保留为历史。

最需要后续处理的是旧Task/手动Goal的通知恢复，以及状态和模型语义之间的证据缺口；Goal错误分类有本轮精确反例。尚无真实模型Baseline、任意语义鲁棒性或生产规模证据。当前分支的自动主题路由未实现。评测时HEAD为被测基线；用户随后授权提交并推送独立评测分支，不合并main。发布提交标识以Git记录为准，原始基线元数据和Trace保持不变。


本轮修改文件与目的：

| 文件 | 目的 |
| --- | --- |
| docs/EVAL_AUDIT.md | 当前分支能力、执行链、历史Manual Goal语义证据与风险 |
| docs/EVAL_PLAN.md | 20场景、50场景路线、指标分母、留出与真实模型预算门槛 |
| docs/EVAL_RESULTS.md | 本轮真实执行结果、复现入口、失败及验证边界 |
| docs/EVAL_INTERVIEW.md | 架构解释、15个面试问答、故障根因和3条据实简历描述 |
| docs/STATE.md | 本工作树最新快照，区分其他工作树的历史交接 |
| package.json | 新增npm run eval:agent入口 |
| tsconfig.test.json | 将evals纳入既有类型检查 |
| tests/agent-evaluation.test.ts | 验证声明判定、NA/分母及多环境终态统计 |
| evals/README.md | 说明零费用运行、输出和边界 |
| evals/datasets/personal-agent-v1.json | 20个开发场景的初态、期望及禁止行为 |
| evals/datasets/holdout-v1.json | 六条冻结未执行的独立留出规格 |
| evals/environments/offline.ts | 真实Pi、本机SSE桩、隔离服务与实际工具证据 |
| evals/fixtures/process.ts | 真实OS子进程恢复与可控崩溃窗口 |
| evals/runners/scenarios.ts | 场景及故障在真实业务入口上的执行 |
| evals/runners/offline.ts | 逐条运行、保存输入Hash/Trace/Markdown/JSON、失败非零退出 |
| evals/evaluators/metrics.ts | 明确分母、NA与宿主声明对照，不伪造模型分数 |
| evals/reports/baseline-2026-11-07-v1-summary.json | 公开用的精简基线、检查和统计，不含原始正文或本机路径 |
| .gitignore | 生成的原始Trace与reports子目录保留本地，不纳入公开提交 |

本地工作区与产物保护校验确认：生产src无改动、原有10份未跟踪文档字节未变、冻结评测输入无漂移、全部原始Trace Hash匹配。发布前再次检查公开内容的UTF-8、链接、路径和敏感模式。

公开发布范围已收窄为工程、场景、文档和精简JSON。自动审批拒绝将完整原始评测记录纳入公开提交；这些记录继续保留在本地。
