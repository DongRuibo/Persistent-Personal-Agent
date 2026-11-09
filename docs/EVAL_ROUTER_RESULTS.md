# Router与多Session专项评测综合报告

日期：2026-11-09（Asia/Shanghai）。完成用户批准的80条离线评测；生产源码不改，收费调用0。用户随后授权将本轮评测提交并推送独立分支，不合并main；发布身份以Git记录和远端回读为准。

宿主的主题绑定、Session复用、Canary隔离和强杀恢复在本组固定模型实验中得到支持；**真实模型的语义选题能力尚未测量，不能据此宣称整体Router准确率96.25%或架构全面验收通过。**

## 运行身份与证据

- 独立工作树：`/private/tmp/ppa-router-session-eval`，分支`codex/router-session-eval`，被测基线 `ead27a7e19fa99ac7413fceec81e603681192870`；发布提交只增加评测及文档，不改变被测生产逻辑。
- Node `v24.19.0`，平台`darwin`；沿用现有Pi 1.3.0及lockfile，无新依赖。node_modules只链接既有安装，不修改SDK。
- 最终运行：full-02本地manifest，源码/评测输入指纹`6ad10d2bea50697b4636dc791bcd0acd9849aaf27c345ab0b0e4bafc2ccd291d`；数据集SHA256 `fe054cd1259d23aa4813ab0312a4c1303f80d8a499d42a55fb457939b6e6e4d2`。
- Git发布[结果摘要JSON](../evals/reports/router-session-summary.json)与[80行CSV](../evals/reports/router-session-results.csv)，保留全部逐题结果及3条失败。原始JSON、实际HTTP Context、逐Case原件、合成Session和运行日志仍在本地`evals/reports/router-session/full-02/`；该目录不随Git发布。
- 模型输出为固定localhost桩；每题标准答案与Mock提议独立保存，不将gold输入Router。摘要桩仅复述自己实际收到的Canary，不能证明真实摘要质量。

## 四类核心结果

| 指标 | 本轮数值 | 适用范围 |
| --- | --- | --- |
| Routing Accuracy：真实模型语义路由 | **未测 / null** | 没有真实语义模型预测，不能用Mock代替 |
| Mock路由链路符合gold | **77/80 = 96.25%** | 固定提议经过真实Router/宿主后的契约符合率，包含不当Mock提议 |
| 确定性分支路由 | **9/9 = 100%** | 本轮无语义解析HTTP的生产确定性分支，非总体语义准确率 |
| Session创建准确率 | **5/5 = 100%** | 包含4个新主题与1个旧主题首次绑定；实际SQLite/JSONL |
| Session Reuse Precision | **55/(55+0) = 100%** | 固定Mock决策；TP=55，FP=0 |
| Session Reuse Recall | **55/(55+0) = 100%** | 固定Mock决策；FN=0 |
| Session Reuse F1 | **100%** | 正确目标、原contextKey与原JSONL Session ID均需匹配 |
| Context Contamination Rate | **0/71 = 0%** | target回合中任一模型HTTP含禁止Canary即污染；9个零HTTP回合不入分母 |
| Session Recovery Rate | **24/24 = 100%** | 8次实际SIGKILL，每次3个主题，重启后经Router重入 |

真实模型条件下的复用、污染和恢复端到端指标也保持null。上表的百分比仅属于固定模型与真实宿主组合，不代表真实模型或生产可靠性。

## 数据集与路由误差

[可修改gold](../evals/datasets/router-session-v1.json)与[固定Mock脚本](../evals/datasets/router-session-mock-v1.json)各80条。gold包含当前主题、完整前置用户消息、历史主题元数据、预期路由/Session动作、跨题读取规则及理由。固定Mock中N08/U05/U06刻意给出错误create提议，用于区分安全拦截与正确日常路由；数据目前由Agent编写，未经独立人工标注一致性验证。

| 类别 | 样例数 | Mock链路符合gold |
| --- | --- | --- |
| N 新主题与日常对照 | 8 | 7/8 |
| R 延续旧主题 | 8 | 8/8 |
| S 同主题新子任务 | 8 | 8/8 |
| T 主题切换 | 8 | 8/8 |
| M 同时提及多主题 | 8 | 8/8 |
| P 代词与上下文引用 | 8 | 8/8 |
| U 不明确与澄清 | 8 | 6/8 |
| K 强杀重启 | 8 | 8/8 |
| C 跨主题引用与Memory | 8 | 8/8 |
| L 多个Session选择与候选边界 | 8 | 8/8 |

各目标的Mock链路符合率如下，不是模型领域能力排名。

| 目标 | 符合/样例数 |
| --- | --- |
| fitness | 22/22 |
| career | 21/21 |
| photo | 2/2 |
| english | 2/2 |
| daily | 2/5 |
| legacy | 1/1 |
| alpha | 9/9 |
| clarify | 15/15 |
| beta | 2/2 |
| writing | 1/1 |

三条失败原样保留；最终CLI退出码为**1**，没有为了全绿改标准或生产逻辑。

| Case | 用户输入 | 固定Mock提议 | gold / 实际 | 根因与证据边界 |
| --- | --- | --- | --- | --- |
| [N08摘要](../evals/reports/router-session-summary.json) | 他说“以后帮我健身”，请解释这句话，不创建任何主题。 | create photo | daily / clarify | 无当前持续用途，宿主阻止创建并改为澄清；安全边界保持，但未得到gold日常路由。错误提议来自固定桩，不能推断真实模型会同样犯错。 |
| [U05摘要](../evals/reports/router-session-summary.json) | 如果以后长期帮我摄影，会怎么开始？ | create photo | daily / clarify | 无当前持续用途，宿主阻止创建并改为澄清；安全边界保持，但未得到gold日常路由。错误提议来自固定桩，不能推断真实模型会同样犯错。 |
| [U06摘要](../evals/reports/router-session-summary.json) | 不要创建主题，只解释一下这个术语。 | create writing | daily / clarify | 无当前持续用途，宿主阻止创建并改为澄清；安全边界保持，但未得到gold日常路由。错误提议来自固定桩，不能推断真实模型会同样犯错。 |

这三题均未新增主题/Session/Job/Task，临时补答也没有历史或Memory输入。失败分类为`route_gold_mismatch`和`overclarification`，不能将“拦截错误创建”改记为路由成功。

## Session复用与上下文隔离

复用评分检查明确目标、请求前后绑定、物理Session文件ID；旧未绑定主题即使Router choice为use，仍计首次创建。没有只用Session数量替代复用Precision/Recall，也没有将执行错误从应复用分母删除。

80/80回合完成Context采集与Runtime dispatch数量/purpose核对；9条确定性回合没有模型HTTP，不记为“干净Context成功”。其余71条target回合合计**143次模型HTTP**，其中**58次主Chat HTTP**；按同一回合任何阶段检出禁止Canary即计污染。要求自身历史的51条均命中自身Canary，**51/51**；按实际所选主题条件化污染为**0/56**，正确路由子集污染为**0/68**。

独立核对还扫描了setup/target/crash/recovery的全部请求，没有发现未登记的其他Case私有Canary。Canary只证明这些可观测标记的传递结果，不证明所有自然语言秘密都不会泄漏。

同用户明确保存的共享语言偏好允许进入两个不同主题，命中**2/2**；另一条Memory关闭对照不含该事实。C07由用户在当前原话主动粘贴项目片段，其Canary允许在本轮请求出现，未把该行为误算自动跨Session读取。其他跨题引用未获得他题私有聊天正文。主题名/简介等允许共享的路由元数据与私有历史分开判定；当前Memory没有主题级ACL，不能把全部长期Memory出现都算泄漏。

## 强杀与恢复

每题3个主题各有多轮原生持久历史；空闲、路由HTTP、主Chat HTTP、压缩HTTP各2题，总计8次SIGKILL和8个不同的新PID。重启自身新增模型HTTP为**0**；6个在途请求恢复interrupted，2个空闲场景没有额外中断Run。原请求不重放，下一条消息重新经过Router。

K02/K04/K06/K08另要求杀前确实发生压缩，均有实际摘要HTTP及恢复后原生compaction条目。24个主题重入均核对原绑定、原Session ID、自身Canary到达与其他主题Canary缺席，**24/24**。首次原目标重入若失败，不会被后续补充探针覆盖为成功。

这里使用实际OS子进程与原生产对象组装，不是仅close/open内存对象；没有验证断电、磁盘损坏、跨OS、正式进程长期运行或真实模型摘要保真。SQLite与JSONL不是跨存储事务，结果不构成任意故障下的保证。

## 实际验证与保留失败

- `npm run eval:router:typecheck`通过；评测器3项测试通过，覆盖错误目标复用的FP/FN、空分母/零HTTP及私有/共享/主动粘贴区分。
- `npm run typecheck`、`npm run build`、`npm run web:build`退出0；Web构建保留两条既有lucide模块指令警告。
- `TMPDIR=/private/tmp npm test`：**1138/1138**，0失败/取消/跳过，95759.634958ms，退出0。原有1135项不改，新增3项评测器测试；这些回归数不与80条评测相加。
- 最终执行命令/退出码、工程检查、全量回归命令和独立证据核对保存在本地`evals/reports/router-session/validation/`；发布摘要保留验证结果与原始结果Hash。
- 初次CRLF比对误报、沙箱listen EPERM、默认临时目录引发的“Skill目录禁止链接”均单列在本地`evals/reports/router-session/setup-failures.json`。原环境错误报告、失败日志及定点诊断不删除；未放宽生产路径校验。full-01和小批量结果属于先前版本，不与最终full-02累计。

旧通知**30/30、恢复6/6、HTTP分类8/8**按[来源摘要](../evals/baselines/prior-evaluations.json)及原JSON SHA256引用；来源生产基线为e2c95c0，与本轮不同，不重复建立、不混入本轮得分，也不表示本分支包含通知修复。

## 文件交付与后续边界

| 文件 | 目的 |
| --- | --- |
| `evals/datasets/router-session-v1.json` | 80条可人工检查的gold与前置历史 |
| `evals/datasets/router-session-mock-v1.json` | 与gold独立的固定模型提议 |
| `evals/environments/router-session*.ts` | localhost实际Context采集、真实业务对象和Session快照 |
| `evals/fixtures/router-session-process.ts` | 可SIGKILL的独立进程宿主 |
| `evals/evaluators/router-session.ts` | 路由、复用、污染、恢复指标与分母 |
| `evals/runners/router-session.ts` | 实验、证据冻结、JSON/CSV/Markdown输出与失败退出 |
| `evals/router-session-types.ts`、`evals/tsconfig.json` | 评测类型与完整类型检查 |
| `tests/router-session-evaluation.test.ts` | 评测器关键计分与污染分类自测 |
| `package.json` | 两个评测命令，无依赖变化 |
| `docs/EVAL_ROUTER_AUDIT.md`、本报告、`docs/STATE.md` | 实现审计、结果和当前交接快照 |

所有生产`src/`、既有tests/web及lockfile与ead27a7保持Git blob一致。发布准备只调整评测脚本的Git基线校验/元数据，使后续评测提交仍可运行；模型运行、计分、数据集不变。80题原始manifest保留原执行字节Hash，发布后smoke另存本地，不覆盖或累计原结果。本轮发布由用户另行明确授权，只提交并推送独立评测分支，不合并main；原通知工作区未写入。

离线目标已完成。真实Routing Accuracy仍需在人工复核gold后，另行指定真实模型和预算；本轮没有该授权，也没有调用。复现命令和计分说明见[evals/README](../evals/README.md)。
