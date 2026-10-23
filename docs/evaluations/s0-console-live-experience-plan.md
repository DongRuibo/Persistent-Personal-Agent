# S0 Console 最小真实体验验收方案

日期：2026-10-23。状态：**仅方案，尚未授权、未执行，无新增收费请求**。工程基线为 `fb5201c637cea86c9e8c8733d909859d50b72c99`，执行前还须纳入本轮[特殊调用权限修正](s0-invocation-fix.md)。本方案不复用 V3.0.1、Batch 5 或 Formation 的授权、目录、账本及余额。

## 1. 范围与独立限额

仅 Console，虚构资料及新隔离数据库、Session、Memory、Skill 目录；不连接飞书、手机、GitHub Observer 或其他账号。不启用 Proactive、Formation、Memory 改写及任何 Web 工具。当前真实验收缺口不随本方案通过而关闭。

建议上限为 **16 次物理模型 HTTP 请求、人民币 2 元保守预留**，任一不足以容纳下一请求即在联网前停止。最多 32768 字节实际请求体、4096 输出 Token；辅助意图解析、工具后的主模型请求均计数，SDK 重试、预热、压缩和自动修复 JSON 一律关闭。默认目标为约 12 次，不为用完额度增加场景。

费用须在批准执行前按实际模型、精确端点和供应商费率重新核实；本轮未读取正式 `.env`，也未确认当前费率。按非缓存最高费率保守预留：

`ceil((请求体UTF-8字节数 + 512) × 输入元/百万Token + 最大输出Token × 输出元/百万Token)` 微元。

例如输入 2 元/百万、输出 8 元/百万时，每个满容量请求预留 0.099328 元，16 次为 1.589248 元；**这只是历史费率示例，不是当前报价或供应商账单保证**。存在额外推理计费、输入 Token 上界无法确认或缺失费率时不得联网。实际 usage 与预留分开报告，未知不记零。

## 2. 执行前必须完成的离线入口验证

现有 `scripts/goal-console-retest.ts` 是 V3.0.1 专用，不能拿它的固定 scope、16/2 字样充当本轮入口。本次只交方案；另行批准执行后，先实现最小专用启动适配，再通过以下离线门槛，最后才允许模型联网：

- 新 scope `s0-console-skills-experience-v1`；新绝对根目录，拒绝已有目录首次启动。共享一份跨阶段、跨重启账本，绑定根目录、冻结方案/入口 Hash、模型/端点/费率及批准的阶段配置；禁止中途换目录清额、改限额或沿用旧账本。
- 独占锁、先预留并原子持久化再发送；第 17 次、超过 2 元、超容量、错误端点/模型、账本损坏、并发启动及身份不符均零联网。失败、断网、超时、崩溃不退款、不自动重试，恢复后不能漏算已预留尝试。
- 只允许精确模型端点的 POST，拒绝重定向和额外网络。阶段间关闭前一进程；恢复账本不会恢复入站消息或自动重复模型调用。
- 单独验证 Chat 的两次原生模型请求均入账，Goal 意图解析/规划/执行均入账，辅助请求不能绕过容量限制。费率无法核实或任一限制失效即停，不先发一条“探测请求”。
- 启动环境只接收用户在本机注入的模型变量，不加载正式 `.env`；需要读取其他配置时先明确来源与授权，不能复制正式数据库、Memory、Session 或账号设置。

## 3. 冻结话术及执行顺序

每行话术只提交一次；没有工具、结构异常、选错 Skill、计划不合格或超限均保留原始失败，不更名、不提示重试、不临时改题。允许的额外请求仅为同一原生 Loop 自然产生的解析/工具轮次，仍受 16/2 总限额控制。

| 场景 | 配置及原话 | 预计请求 | 冻结验收点 |
| --- | --- | --- | --- |
| A：原有路径 | `SKILLS_ENABLED=false`，独立空 Session。发送：“请把下面提供的 Agent 技术资料整理成要点，区分原文事实和未知项。资料：Agent Loop 接收用户输入，模型可以提议工具调用，宿主检查权限后执行。虚构系统 Cedar 使用独立 Session 运行后台任务。不要联网，不要保存 Memory。” | 1 | 没有 Skill 目录、read 或激活事件；仍能正常回答，无 Task/Memory 写入 |
| B：没有批准包 | `SKILLS_ENABLED=true`，独立新 Session；新受管目录清单为 `{"schemaVersion":1,"skills":[]}`，不安装包。发送与 A 完全相同的原话 | 1 | 批准目录为空，没有正文或激活；不能从源码目录、全局路径或旧 Session 偷载 Skill，仍正常回答。受限 read 的工具名称存在不代表某个包已获批准 |
| C：自动选择 | 停止前一进程，在第三份新 Session 与受管目录只批准随仓库两份包，记录实际包 Hash。发送与 A 完全相同的原话，**不得补充 agent-notes 名称或路径** | 2 | 首次请求出现原生目录但无正文；主模型自行调用只读 `read` 读取 agent-notes；下一请求实际包含该包正文；激活 ID/Hash 与批准清单相符。最终答复区分资料事实和未知项，不声称已测试 Cedar |
| D1：创建面试 Goal | 沿用 C 的进程，明确 `GOAL_ENABLED=true`、`PROACTIVE_ENABLED=false`。发送：“创建一个长期目标：准备虚构的 Agent 面试。正式计划只允许 1 个 Step，使用 interview-practice；本轮只交付 1 道关于 Agent Loop 的题，题干不超过 80 字，等待我回答，不要联网或保存 Memory。” | 约 4：主模型工具提议、意图解析、主模型收尾、后台初始规划 | 初始规划只有目录、不展开 Skill；宿主成功展示待审批计划，正式 Step 数量为 1，绑定 interview-practice 的实际版本/完整 Hash。仅展示不执行正式练习 |
| D2：批准并执行 | 仅当 D1 的计划满足全部条件且展示未过 5 分钟时，发送：“批准这个计划并继续一段” | 约 4：主模型工具提议、意图解析、主模型收尾、独立 Goal 片段 | 宿主审批后才展开 interview-practice；正式执行零工具、一次模型请求；冻结正文与实际展开一致，生成一题、提交 Checkpoint 并等待回答，无自主下一段 |

合计预计 12 次。实际调用数以物理发送前的账本为准，不能拿一条用户消息或一条 Run 当一次模型请求。D1 未产生合格草稿则 D2 记为未执行/前置失败，不替它批准，也不为刷新展示增加一轮。若 D1 仅提出 Skill 而未绑定、未显示实际 Hash，同样记失败。

这里只验证包的宿主批准与计划批准。两个产品包默认允许 Chat 自动选择；本轮修复的 `disable-model-invocation:true` 特殊包需独立明确调用句，不应把所有普通 Skill 也改成“必须报 ID”。它的否定/引用/假设及重启隔离已有离线回归，不额外消耗本轮体验额度。

## 4. 证据、核对与判定

每个场景分别记录四列：**模型理解/提议、宿主允许或拦截、实际输入与 SQLite 状态、HTTP/Token/费用**。主模型说“使用了 Skill”或“目标已完成”均不能代替证据；上下文确实包含正文，也不能单独证明回答质量或 Skill 改善幅度。

保留冻结话术和包/入口/方案 Hash、脱敏物理请求与原始响应、工具 call/result、实际下一请求的正文证据、`skill_activated` 事件、原生 Session、Goal 输入/Checkpoint Hash、预算账本及正常停止记录。A/B/C 使用分开的空 Session，账本共用；只展示虚构内容，不记录 API Key 或鉴权头。

停进程后只读核对本轮隔离库，可复用 `scripts/audit-goals.ts`。补充只读 SQL（在 SQLite 只读连接中执行，不针对正式库）：

```sql
SELECT id,status,revision,planRevision,checkpointRunId FROM goals;
SELECT goalId,revision,approvedByRunId,hash,json_extract(specJson,'$.skillBindings') FROM goal_plans;
SELECT runId,planRevision,status,capabilityClass,inputHash,checkpointHash,
       json_extract(inputJson,'$.skill.id') AS skillId,
       json_extract(inputJson,'$.skill.hash') AS skillHash FROM goal_executions;
```

正式练习 Execution 的 Skill 与已批准 Plan 一致、Checkpoint 原子提交、无多余练习 Execution；Task/Memory 无新写入。模型请求次数以新账本和原始 HTTP 对齐，`model_calls` 用于实际响应的 Token/usage 对账，不能以其行数代替失败请求计数。

四个场景全部满足才判本轮 Console 体验通过；否则逐项报告失败、未执行及剩余额度，停止，不修预期凑通过。结果不覆盖[原 V3.0.1 真实暂停/收据失败](v3.0.1-live-retest.md)，不代表飞书、手机、主动策略、长时间运行或 Windows ACL 已验收。
