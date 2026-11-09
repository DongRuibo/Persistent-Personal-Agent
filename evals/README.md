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
