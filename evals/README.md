# Router与多Session离线评测

被测基线为 `ead27a7e19fa99ac7413fceec81e603681192870`。评测仅使用 Node/tsx、现有 Pi SDK 和生产 Web/Router/SQLite/SessionManager/Memory 对象，无新增依赖。不要将本目录的固定模型结果称为真实语义准确率。

```sh
npm run eval:router:typecheck
node --import tsx --test tests/router-session-evaluation.test.ts
TMPDIR=/private/tmp npm run eval:router
```

需要允许临时监听 `127.0.0.1`。不加载 `.env`，模型配置为本机固定假模型，全部业务数据位于独立 `/private/tmp/ppa-router-eval-*`。没有收费或真实模型入口；运行中只对本评测创建的子进程使用 SIGKILL。默认全量80条；用 `-- --cases K01,K07 --out evals/reports/router-session/my-run` 定向复现。已有 manifest 的目录不能覆盖。失败或执行错误退出1；保留所有失败，不因为预期存在问题改为退出0。

人工数据为 [router-session-v1.json](datasets/router-session-v1.json)：十类各8条，包含前置状态、用户原话、标准路由、Session动作、允许的信息共享和标注理由。`{{id:alpha}}`/`{{canary:alpha}}`在隔离夹具中解析为实际ID/用户主动粘贴片段。样例目前由Agent编写并可人工修订，未经独立人工标注一致性验证。修订后会形成新Hash，不能覆盖旧成绩。

[固定Mock脚本](datasets/router-session-mock-v1.json)与gold分开保存。Runner不从gold生成模型答案；一些Mock故意提出不当create/use，用来检验宿主拦截。宿主把错误create拦成clarify仍可能不符合gold daily，必须保留失败。这类失败不证明真实模型会犯同样的错误，也不自动等于宿主权限缺陷。确定性路由分支单独统计。

每题前置主题由真实聊天建立，Canary通过用户消息写入原生Session，不直接改JSONL；旧未绑定主题通过原Store建立元数据。Memory Canary由明确的合成“记住”请求调用原服务保存，代表同一用户允许共享的事实。主回答固定、不回显历史；压缩桩只从实际摘要HTTP中提取收到的Canary，不查gold。这能验证宿主搬运和隔离，不能验证摘要模型的语义保真度。

每个K场景建立3个主题和多轮历史，实际SIGKILL，再启动新PID并走原Router重入3个主题，分母为8×3。覆盖空闲、路由HTTP、主Chat HTTP、压缩HTTP四种阶段；四题另要求杀前实际发生压缩。未完成的恢复探针也保留在分母。重启零自动HTTP、中断Run状态和原Session ID/绑定/Canary分别留证。

每次运行输出 `manifest.json`、`results.json`、`results.csv`、`contexts.jsonl`、`report.md`、逐Case原件与合成Session文件。HTTP正文包含setup/target/crash/recovery阶段；核心Context污染率只统计target回合，恢复探针单独计入恢复指标。零HTTP回合不进入污染率分母；自身上下文到达率另报，避免以空Context获得通过。报告有错误路由、按主题/类别分组、分子分母及未测原因。

Session复用要求正确目标、原绑定及原JSONL Session ID保留；错用另一个Session同时计FP和FN。首次绑定旧主题计为Session创建，虽然路由choice是use。所有执行错误保留在应评指标分母，真实模型语义字段始终为null。

旧通知评测仅通过 [历史来源摘要](baselines/prior-evaluations.json)引用30/30、恢复6/6、HTTP分类8/8，来源基线不同，不进入Router成绩，也不表示本分支包含通知修复。生产源码、既有tests/web与lockfile在执行前按Git clean规则核对授权基线ead27a7的blob；评测提交可以前进，manifest单独记录evaluation_commit；实际执行字节的SHA-256另记manifest（仓库checkout可能转换CRLF）。

Git中保留[合成结果摘要](reports/router-session-summary.json)和[逐Case CSV](reports/router-session-results.csv)，包括所有失败及未测字段。原始HTTP、Session和环境日志位于本地`reports/router-session/`且被Git忽略；复现命令可重新生成独立原件。

## 真实模型Router首批小样本

`npm run eval:router:semantic`默认只准备：通过真实Pi SDK捕获序列化请求但不发送网络，不读取Key。20条冻结状态见[计划](datasets/router-semantic-pilot-v1.json)。真正调用需要显式`-- --live --config <本机模型.env路径>`并事先获得模型、请求/Token和费用授权；本轮已批准预算5元、最多20HTTP、512输出、60000输入预留，实际只跑一次17个HTTP。不要用新输出目录自动补跑或消耗剩余额度。

脚本只调用生产Router及原Store，不运行主Chat/Worker，不加载真实Session或Memory。模型原始提议与宿主最终归属分别统计，确定性分支不进入模型准确率分母；价格未知时cost为null。原始输入/输出仅保留于已忽略的`reports/router-session/semantic-*`目录。结果见[语义评测报告](../docs/EVAL_ROUTER_SEMANTIC.md)、[合成摘要](reports/router-semantic-pilot-summary.json)与[CSV](reports/router-semantic-pilot-results.csv)。

该历史Router-only Runner固定检查生产基线`ead27a7`。当前分支已包含主题状态提示修复，因此直接运行会按原保护拒绝启动；历史复现需在独立的原生产源码快照中配套本评测脚本，不移除基线检查。历史成绩不自动作为修后成绩。

## 真实连续对话验收

独立的[21轮冻结输入](datasets/router-conversation-v1.json)经过生产Web HTTP、Router、主Chat和原生SessionManager，健身/求职/项目各放一个私有Canary，再切换、指代续聊、跨主题引用及SIGKILL恢复。使用新隔离数据库、Session和Memory目录，不启动正式实例、Scheduler或Worker。原始模型请求正文、SSE、Run、Session及生命周期仅保留在被忽略的`reports/router-session/conversation-*`中。

```sh
npm run eval:router:conversation -- --output evals/reports/router-session/conversation-prepare-new
# 只有重新明确授权真实调用和预算后才执行；--output必须是全新目录。
npm run eval:router:conversation -- --live --config /本机/模型.env --output evals/reports/router-session/conversation-live-new
```

默认prepare只启动/关闭隔离入口，模型HTTP为0。真实模式读取本机模型配置，子进程使用假Key；父进程对实际原始请求逐次计量后中继到既有模型，正文及生产max_tokens保持原样。中继缓冲完整SSE，故不测流式首字时延。全局上限5元保守预留、40次HTTP、500000输入预留、100000输出预留，无供应商自动重试；不能把预留或公开价估算说成实际账单。

本轮21轮首验保留C06漏答和C14评测客户端轮询429失败；C01/C03模型否认宿主已创建主题另记人工审阅问题，不混入路由分数。只把评测轮询50ms改为1000ms，使用`--resume <首轮输出目录>`从隔离目录副本补验固定8轮（选求职、C14、空闲强杀、C15—C20）。该补验承接首轮实际请求的累计预算，不覆盖原件，不重跑收费首轮、不更改gold。此参数是本次补验专用，不能据此自动追加收费实验。

结果见[连续验收报告](../docs/EVAL_ROUTER_CONVERSATION.md)、[摘要JSON](reports/router-conversation-summary.json)、[逐轮CSV](reports/router-conversation-results.csv)。首轮和补验单独列指标；零HTTP纯切换不进入上下文污染分母；Memory目录共享元数据和私有Session Canary分开判断。没有触发压缩，不宣称真实长上下文/共享记忆安全已验收。

主题状态修复的独立小规模复验使用`--host-state-retest`，默认仍为零模型请求的prepare；新授权后才可追加`--live --config <本机模型.env路径>`。该固定计划共5轮、最多16HTTP、费用预留上限5元，不使用连续验收的旧余额。本次实际8HTTP，C01/C03均承认已建主题，两次续聊保留原Session；主回答0/4否认，费用预留0.619890元，账单未核验。求职答复偏长问题和旧否认失败均保留，见[复验报告](../docs/evaluations/topic-session-host-state-live-retest.md)、[摘要](reports/topic-host-state-retest-summary.json)与[CSV](reports/topic-host-state-retest-results.csv)。不要把再次运行当作默认授权。
