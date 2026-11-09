# 主题状态修复：小规模真实模型复验

日期：2026-11-09。执行树`/private/tmp/ppa-router-session-eval`、HEAD `5f4764d`。本轮沿用现有硅基流动`deepseek-ai/DeepSeek-V4.1-Flash`，使用用户新批准的5元预算；不再修改生产逻辑，不提交、推送、部署或操作正式实例。

**本次针对“否认已创建主题”的复验通过。** C01、C03均明确承认宿主已建立主题；两个主题的续聊均未出现否认，且复用了原生Session。共4条模型主回答，否认0条，不确定0条；这是单次小样本结果，不能承诺长期零复发。求职答复仍有偏长/超出两句话的格式问题，原样保留。

## 冻结输入与判定

[5轮计划](../../evals/datasets/topic-host-state-retest-v1.json)在调用前冻结：C01、C03原样来自[旧失败夹具](../../tests/fixtures/topic-host-state-failures.json)，随后求职续聊、纯切回健身、健身续聊。没有向模型提供旧答案或标准结果，也没有直接预建主题。

核心判定是：宿主已创建/复用主题时，模型不否认当前主题Session已建立。主动承认与没有否认分开记录；续聊不要求额外主动复述状态。本文及本机审阅原件`evals/reports/router-session/topic-host-state-retest-live-01/topic-denial-review.json`（不入Git）由Codex逐条阅读完整答案得出，没有额外judge模型调用，也不是独立人工盲评。自动检查只负责路由、绑定、上下文和调用状态，不能替代语义判定。

| 回合 | 实际行为及回答审阅 | 结果 |
| --- | --- | --- |
| C01 | 新建健身；回答“主题已经按‘健身’建立” | 明确承认，没有否认 |
| C03 | 新建求职；回答“宿主已建立‘求职’独立主题并完成绑定” | 明确承认，没有否认 |
| R03 | 求职续聊；沿用上海、Agent方向及私有校验码 | 原Session复用，无否认 |
| S01 | 宿主确定性切回健身，0模型HTTP | 不进入模型否认率分母 |
| R01 | 健身续聊；保留30分钟、不跳跃及原校验码 | 原Session复用，无否认 |

旧C01/C03真实否认答案仍留在原JSON/SSE和失败夹具，不因修后成功删除或重写。本次所有回答也完整保留。

## 机制与上下文核对

- 原始真实语义Router提议4/4正确；最终路由5/5，含一次确定性选择。不是Mock模型成绩。
- 实际新建主题2个；两个续聊均保留正确threadId、chatContextKey和原生JSONL Session ID（2/2），纯切换亦保持原ID。复用Precision/Recall/F1均100%，自动分母3包括该次纯选择，模型续聊分母另列为2。
- 实际主模型请求4/4包含“当前独立主题Session已经建立并完成持久化绑定”的固定宿主事实；Router没有收到这条主回答专用声明。
- 两条续聊的实际Chat请求均收到本主题历史Canary；8次模型HTTP中私有Canary污染0/8，其中主Chat0/4、Router0/4。主题目录简介属于允许的路由元数据，不当作其他Session全文。
- 8个请求与原生产`topic_model_http`发送事件的阶段/字节数对应一致；全部HTTP200、stop结束，usage8/8可观测，零工具调用。Job/Task/Memory记录均0。
- 实际经过原Web HTTP入口、Router、SQLite和Pi主Chat/SessionManager；新建独立数据目录，未加载正式Session、Memory或数据库。中继保持正文和生产输出上限，缓冲SSE，不测流式首字时延。

本轮没有重启、压缩、共享Memory播种或旧否认历史迁移测试，对应指标未测，不继承旧成绩。生产修复字节与上一轮1149项回归通过版本一致，本轮未改生产代码。

## 仍保留的失败与限制

C03、R03的自我介绍主体按两句模板组织，但附加了确认、解释或邀请，不能算严格遵守整段“最多两句话”。这是保留的格式问题，不改主否认标准、不声称完整指令遵循全部通过，也不在本轮顺手修改生产提示。自我介绍中的X%是待用户替换的模板，本轮没有核验个人经历。

原始自动`summary.json`的`topic_denial_review`保留pending，因为运行时没有调用额外模型评审；完成后的逐条审阅单独写入`topic-denial-review.json`，最终[摘要JSON](../../evals/reports/topic-host-state-retest-summary.json)汇总两者，避免把自动机制通过当作语义通过。

## 费用与验证

本轮只跑一次：**8次真实HTTP，输入12020、输出706 Token**；预算从本轮新授权开始，不使用上轮余额。计划门限为16HTTP、150000输入预留、50000输出预留、5元金额预留，实际保守预留**0.619890元**（输入50250、输出18432预留），没有重试、补跑或消费剩余额度。

继续使用原预算器按实际序列化字节+256预留输入、按实际生产max_tokens预留输出；金额系数输入5元/输出20元每百万Token。它是预算预留，不是账单；**actual_cost_cny为null**。计划内价格注释沿用此前同日官方页的2/8元快照，本轮重新访问官方价格页超时，未把它当成本次实时账单或据此追加请求。

本轮新跑`npm run eval:router:typecheck`及预算/Context测试3/3通过；prepare实际启动/关闭隔离入口，模型HTTP0；真实运行自动机制5/5、退出0，主语义审阅0/4否认。生产及既有测试未改变，复用上一轮typecheck/build、相关168/168和全量1149/1149记录，没有重新跑全量或Web构建。原192个历史证据文件Hash全部保持不变。

## 文件与复现

| 文件 | 目的 |
| --- | --- |
| `evals/runners/router-conversation.ts` | 复用既有真实链路，增加显式5轮小样本入口；语义结果默认待审，不自动判通过 |
| `evals/datasets/topic-host-state-retest-v1.json` | 固定C01/C03、续聊输入、预算和判定标准 |
| `evals/reports/topic-host-state-retest-summary.json` | 汇总真实调用、Session/Context检查及逐条语义审阅 |
| `evals/reports/topic-host-state-retest-results.csv` | 逐轮结果和完整模型回答，保留格式问题 |
| `docs/evaluations/topic-session-host-state-live-retest.md` | 本报告及证据边界 |
| `docs/STATE.md` | 最新交接快照 |

本地原件位于`evals/reports/router-session/topic-host-state-retest-live-01/`，包括实际请求、原始SSE、逐轮SQLite/Session快照、manifest、预算流水、审阅和完整性检查；prepare与preflight目录保留零请求准备和修前Hash。原件目录被Git忽略；未提交或推送。

默认命令只准备，不读取Key或发模型请求：

```sh
node --import tsx evals/runners/router-conversation.ts --host-state-retest --output evals/reports/router-session/新的准备目录
```

本轮真实执行另传`--live --config <本机模型.env路径>`并使用全新输出目录。再次收费运行需新的明确授权，不能默认延用本轮剩余额度。
