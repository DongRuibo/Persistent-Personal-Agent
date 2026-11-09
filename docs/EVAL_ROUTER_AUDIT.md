# Router与多Session架构审计

审计日期：2026-11-09（Asia/Shanghai）。当前原目录为 `codex/notification-goal-recovery@d0c7125`，只有通知评测基线；多主题功能在干净的 `codex/topic-session-routing@ead27a7`。本次已按授权从后者创建独立 `codex/router-session-eval`，未合并通知分支或修改生产逻辑。

## 实际实现与调用链

`WebUiServer /api/chat → WebUiChannel.accept/start/process → routeTopic → WebUiStore.freezeTopicRoute → PiExecutor.prepareChat → 对应Pi Session → context事件/Memory投影 → 主模型`。

| 能力 | 代码证据 | 实现与边界 |
| --- | --- | --- |
| 自动选题 | `src/topic-router.ts:129` | daily/use/create/clarify；确定性选择先处理，语义部分最多一次无工具请求；候选只有名称/简介/绑定状态/引用，20项/8KiB |
| 绑定/幂等 | `src/web-ui-store.ts:121`、`src/work-thread-store.ts:52` | 创建主题、绑定contextKey、冻结请求同事务；原UUID回读；旧未绑定主题须明确持续用途 |
| Session隔离 | `src/pi-executor.ts:435` | owner保持，主题路径按contextKey Hash分开；SessionManager、Guard、引用按主题保存 |
| 持久恢复 | `src/pi-executor.ts:444`、Pi SDK SessionManager.open | 固定JSONL重开；原生分支/压缩条目恢复活动上下文；无扫描全局CLI历史 |
| 前置压缩 | `src/pi-executor.ts:566,753` | 公开compact/hook；保留低信任来源；共享8次HTTP、真实请求字节、取消与超时；不修改SDK |
| Context构建 | `src/pi-executor.ts:591` | 日常/旧Coordinator有有限普通历史投影；主题模式走本Session压缩感知上下文；不存在独立自研Context Builder服务 |
| Memory注入 | `src/memory-service.ts:297`、`src/pi-executor.ts:667` | 当前版本临时检索/投影，不直接追加Session；同用户Memory共享，不提供主题级Memory ACL |
| 工作协调 | `src/work-coordinator.ts:223`、`src/work-coordinator-store.ts:43` | 明确委托才建工作，新Job继承冻结主题；旧工作续接按根链；选题不授予操作权限 |

ChannelRouter只负责结果出站投递，WorkRouter的显式Chat/后台分派也不等于自动主题Router。当前功能只适用于本机Web，开关默认关闭；可保留多个Session，交互执行仍串行。没有实现任意跨主题聊天全文拼接或多Worker并行。

## 已有测试与证据缺口

`tests/topic-router.test.ts`、`topic-routing-web.test.ts`覆盖真实生产Router、确定性边界与固定语义输出；`topic-session-storage/runtime/work`覆盖SQLite、Pi JSONL、引用隔离和工作链。`topic-session-runtime.test.ts:378`有真实子进程恢复，391有压缩SIGKILL；但其夹具`tests/helpers/topic-session-runtime-process.ts:23`预先冻结路由，不能作为重启后自动选题准确率。N3固定语义输出也不能外推真实模型质量。

已有实际HTTP检查、Memory版本/临时注入检查、压缩来源/预算检查均值得复用。历史1135/1135是工程回归，通过数不等于路由或恢复准确率。旧通知评测D03因原基线缺自动Router而skipped，保持原件，不改为本次通过。

## 本轮测量与保留限制

80条人工可改数据、固定Mock输出与实际结果独立留存；标准答案不作为模型输入。重点检查实际发给本机模型的HTTP Context，区分私有聊天Canary与允许共享Memory。Canary是可观测泄漏探针，不能证明所有语义信息都不泄漏。

归属不明时的临时无工具补答不进入持久Session；显式文件审批仍可能结束隐含主题线索；本轮不修这些生产行为。真实分类、真实摘要保真、手机、其他Provider和长期运行均未测。

完整指标定义、复现方法见[评测说明](../evals/README.md)，结果见[综合报告](EVAL_ROUTER_RESULTS.md)。本轮只新增评测/文档及npm命令，无新外部依赖或收费调用；评测完成后用户另行授权仅提交并推送独立评测分支，不合并main。
