# Personal Agent离线评测

从仓库根目录运行 `npm run eval:agent`。使用现有Node/tsx/Pi SDK，无新依赖、不加载`.env`、不读取真实数据，也没有收费模型入口。需要允许监听`127.0.0.1`。运行会创建新的临时SQLite/Session/Memory和Mock渠道；退出前清理临时业务目录，仅保留合成Trace及报告。

默认每轮输出到新的`evals/reports/<UTC运行ID>/`与`evals/traces/<UTC运行ID>/`。指定目录可用`npm run eval:agent -- --out evals/reports/my-run`；不能覆盖已有`run.json`。报告有失败或执行错误时退出1；跳过单独记录。当前三个失败必须保留，不能为了CI变绿去掉。

当前入口只执行`datasets/personal-agent-v1.json`的20个开发场景。`datasets/holdout-v1.json`是六条冻结、未实现的独立留出规格，不参与本轮调优或得分。没有真实模型成绩，也没有自动主题路由成绩。

`environments/offline.ts`启动本机SSE桩并调用真实`createPiExecutor`；`fixtures/process.ts`是实际OS子进程，直接运行生产Store/Scheduler；`runners/scenarios.ts`承载场景和故障；`evaluators/metrics.ts`负责分母、状态及声明核对。故障直接在隔离实例/Mock Transport边界注入，不创建第二套Runtime，不改SDK或生产源码。

每轮`run.json`冻结HEAD、分支、工作区状态、源码/评测/lockfile逐文件Hash及数据集版本。逐Case JSON保留规范、实际状态、真实工具调用参数与结果、模型桩请求/响应、Runtime事件、进程PID/退出信号和失败原因。工具参数来自Pi持久消息，执行依据为工具结果与Runtime事件；不把桩发出的提议直接算调用成功。

入口：[审计](../docs/EVAL_AUDIT.md)、[指标与实验方案](../docs/EVAL_PLAN.md)、[本轮结果](../docs/EVAL_RESULTS.md)、[面试材料](../docs/EVAL_INTERVIEW.md)。

公开仓库只跟踪`reports/baseline-2026-11-07-v1-summary.json`精简摘要。生成的Trace及reports子目录保留本地并被Git忽略，不含在公开提交中。
