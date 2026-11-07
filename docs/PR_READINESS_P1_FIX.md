# PR Readiness P1：通知候选队列饥饿修复

日期：2026-11-07。范围仅为通知候选资格在 SQL LIMIT 前过滤，以及全部调用方的显式范围适配。

结论：已复现并修复此项 P1，可以重新进入独立 PR Readiness Review。原 `ff6e346` 不包含此修复，不能据此直接合并旧提交。修复报告交付后，用户已明确授权仅将本轮代码、测试和文档提交、推送到 `codex/notification-queue-p1-fix`；发布提交标识以该分支 Git 记录为准，不创建 PR 或合并 main，不发布原始 Trace、日志或无关改动。

## 1. 基线、隔离与根因

- 新工作树：`/private/tmp/ppa-notification-queue-p1-fix`；新分支：`codex/notification-queue-p1-fix`。
- 修复起点及离线验收时的 HEAD：`ff6e3465cde53f91e1e8639f1620872c211605df`，来自 `codex/phase3-integration`；本地 main 保持 `91b7a657ddf62cf625c53f7bcfbddaa22aa6740b`。
- 已阅读通知 Store、Worker、main、通知可靠性测试及 phase3 集成测试，并追踪 Scheduler、GoalRunner 和全部投递调用方。
- 原工作区、phase3 工作树、前轮审查工作树的 HEAD、Git 状态及 1,358 项受保护文件/历史证据 SHA-256 检查均保持不变。未访问正式数据库、真实 Session/Memory 或正式 `.env`。所有新数据库为临时合成数据，渠道为 Mock，模型为本机 Stub；真实飞书消息和收费模型调用均为 0。

旧 Store 只用 ownerId、pending 和 nextAt 查询最早 100 条，然后在 JavaScript 中通过 `taskOnly` 和任意 `accepts()` 挑选一条。100 条不匹配记录不会被当前 Worker 消耗，下次查询仍返回同样 100 条，第 101 条合法记录便永远进不了候选集。渠道相同但身份不同也会触发，不能只加 channel 条件。

同时发现运行期过期租约回收原本更新所有 owner/渠道/Task/Goal。为满足“不匹配记录不因当前查询被修改”，本次将该 UPDATE 限定到同一显式范围。原独占锁下的启动全局恢复 `recoverInTransaction()` 保持不变。

### 原授权和目标结构

| 类型 | 持久化 MessageTarget | 原 main 中 accepts() 的实际通知匹配 | 修复后的 SQL 条件 |
| --- | --- | --- | --- |
| Console | `channel: console` | 仅 Console | channel=console |
| Web | `channel: web, userId` | Web 且当前 userId | channel=web、userId 相等 |
| 飞书 | `channel: feishu, appId, chatId, userOpenId` | 飞书且当前 appId、allowedOpenId | channel=feishu、appId、userOpenId 相等 |
| 默认 Task Worker | 上述任一类型 | 上述匹配且有 taskId | 追加 `taskId IS NOT NULL` |

飞书 **chatId 是实际投递地址，原 accepts() 没有限定单个 chatId**。本次保持同 appId/userOpenId 的多个 chatId 可投递，未放宽应用/用户权限，也没有收紧为固定聊天。main 的 Goal/Policy `accepts()` 继续保留。

通知保存创建时的目标快照，配置切换不改写历史目标。因此同库可以残留旧 appId、旧 userOpenId 或旧 Web userId 的通知；本轮在隔离库分别构造并验证，没有查询生产库的实际残留条数。

`taskOnly` 来自 Worker 默认 `includeGoals=false`，防止 Task 通知 Worker 激活未开启的策略 Goal 通知；显式开启后仍可投递同范围 Task 和 Goal。GoalRunner 的策略通知调用同样传入明确范围，原 Goal/Policy 权限 callback 不变。

## 2. 最小修复与 SQL

新增可辨别联合类型 `NotificationTargetFilter`：Console；Web+userId；飞书+appId+userOpenId。Worker 和 Store 必须接收该描述，不从 callback 推断 SQL。身份值全部作为绑定参数，SQL 片段由类型分支和 taskOnly 布尔值选择。

旧查询及查询后过滤：

```sql
SELECT * FROM goal_notifications
WHERE ownerId=? AND status='pending' AND nextAt<=?
ORDER BY createdAt,id LIMIT 100;
```

```ts
const item = candidates.find(item =>
  (!options.taskOnly || !!item.taskId) && accepts(JSON.parse(String(item.targetJson))));
```

修复后以飞书默认 Task Worker 为例，实际查询为：

```sql
SELECT * FROM goal_notifications
WHERE ownerId=?
  AND json_extract(targetJson,'$.channel')=?
  AND json_extract(targetJson,'$.appId')=?
  AND json_extract(targetJson,'$.userOpenId')=?
  AND taskId IS NOT NULL
  AND status='pending' AND nextAt<=?
ORDER BY createdAt,id LIMIT 1;
```

Console 删除两个飞书身份条件；Web 将它们替换成 `json_extract(targetJson,'$.userId')=?`；允许 Goal 时去掉 `taskId IS NOT NULL`。owner、状态、到期、渠道、身份、能力范围均在 LIMIT 前生效。每次调用原本只领取一条，故现在 LIMIT 为 1，不扩大读取上限。

运行期租约回收从：

```sql
UPDATE goal_notifications SET /* 原状态、uncertain、令牌清理字段不变 */
WHERE status='sending' AND leaseUntil<=?;
```

变为使用相同 owner/channel/身份/taskOnly 范围的 UPDATE：

```sql
UPDATE goal_notifications SET /* 同上 */
WHERE ownerId=?
  AND json_extract(targetJson,'$.channel')=?
  AND json_extract(targetJson,'$.appId')=?
  AND json_extract(targetJson,'$.userOpenId')=?
  AND taskId IS NOT NULL
  AND status='sending' AND leaseUntil<=?;
```

Task 结果提交、通知意图、取消检查、租约时长、`BEGIN IMMEDIATE` 事务、pending→sending 原子领取、leaseToken 确认、退避/Dead Letter 和 Task 状态均沿用原实现。按通知 ID 人工重试的 `retryDead()` 没有候选 LIMIT，保留其原权限检查。

为什么第 101 条不会再被挡住：先由 WHERE 得到当前 Worker 的合法集合，再按 createdAt/id 取第一条。不匹配的前 100 条不会占用 LIMIT 名额，其存在与数量都不会使合法记录被截断。此结论针对资格截断问题，不意味着任何队列规模下都具有固定查询耗时。

Scheduler 的独立调用兼容入口现在默认明确为 Console；Web/飞书调用方传入描述，main 仍注入原独立 Worker。原有混合渠道测试改为在各阶段明确选择相应范围，没有再提供“接受所有目标”的隐式 Worker。旧源码对照夹具保留仅供旧版本使用的 `accepts` 字段，新 Worker 只使用 `targetFilter`。

## 3. 隔离、顺序和并发回归

新增 [notification-queue-scope.test.ts](../tests/notification-queue-scope.test.ts)，13 项均使用独立 SQLite 和 Mock Channel。先在未修复源码执行同一组行为断言，结果 6 通过、7 失败；修复后 13/13 通过。修复前后仅调整接口适配字段，未改断言。失败日志和修复前测试源码快照保留。

| 覆盖 | 布置及验证 | 修复后 |
| --- | --- | --- |
| A | 100 条较早 Console + 第 101 条当前飞书；仅飞书送达 | 通过 |
| B-app | 100 条旧 appId 飞书 + 当前配置；旧记录不变 | 通过 |
| B-user | 100 条旧 userOpenId 飞书 + 当前配置；旧记录不变 | 通过 |
| C | 100 条 Goal + 第 101 条 Task；默认 Worker 只处理 Task | 通过 |
| D | 100 条较早飞书 + 当前 Console；飞书记录不变 | 通过 |
| Web | 100 条旧 Web userId + 当前用户；旧用户记录不变 | 通过 |
| owner/status/nextAt | 100 条其他 owner、未到期和终态记录不被领取 | 通过 |
| 飞书 chatId | 同 app/user 不同 chatId 都按原地址投递 | 通过 |
| includeGoals | 显式开启后同范围 Goal 和 Task 都可按序投递 | 通过 |
| E-order | 不同 createdAt 及相同 createdAt 的 id 次序保持 | 通过 |
| E-concurrent | 两个 SQLite 连接、两个 Worker、发送闸门重叠；有效租约仅领取/发送一次 | 通过 |
| E-fencing | 租约过期后重新领取；旧确认不能覆盖新 Sent，Task 仍只有一个 Run | 通过 |
| E-scope | 不匹配的过期 sending 记录不被当前查询/租约回收改写 | 通过 |

隔离断言比较排除记录的**所有列快照**，不限于 status。E-fencing 有意验证租约过期时两个发送尝试及 `uncertain=1`；它验证令牌保护，不宣称外部恰好一次。现有真实子进程故障注入仍由完整回归和固定 30 题覆盖。

## 4. 查询执行计划与索引

Node v24.19.0、SQLite 3.53.3，102 条合成已完成 Task 通知。诊断探针截获真实 deliver() 的 SQL/绑定参数，再运行 EXPLAIN QUERY PLAN；未访问正式库。

旧查询确实返回 100 条 Console，之后飞书 JavaScript 过滤命中 0 条。旧查询和修复后 Console、Web、飞书、含 Goal/仅 Task 的所有受测 SELECT 都得到：

```text
SEARCH goal_notifications USING INDEX notifications_due (ownerId=? AND status=? AND nextAt<?)
USE TEMP B-TREE FOR ORDER BY
```

SQLite 在计划文字中显示 `nextAt<?`；实际 SQL 仍是 `nextAt<=?`。新的范围租约 UPDATE 得到：

```text
SEARCH goal_notifications USING INDEX notifications_due (ownerId=? AND status=?)
```

索引保持 `notifications_due(ownerId,status,nextAt)`，另有主键和 runId 唯一索引。**没有新增索引、DDL、迁移或历史数据改写**。JSON 身份条件仍需在索引缩小的集合上求值，ORDER BY 仍需临时排序；本轮样本足以验证正确性和既有索引被采用，不足以证明大队列性能，因而不据此新增表达式索引。

## 5. 实际验证结果

| 执行 | 结果 |
| --- | --- |
| 新增 13 项，修复前 | 6 通过、7 失败，退出 1；保留原始失败 |
| 新增 13 项，修复后 | 13/13，退出 0 |
| 完整回归首跑 | 669/670，退出 1；一处 Memory 混合渠道夹具遗漏显式范围适配 |
| Memory 夹具适配后专项 | 2/2，退出 0；原通知数量、目标、Task/Run/模型次数断言不变 |
| `TMPDIR=/private/tmp npm test` 最终 | **670/670**，0 失败/取消/跳过，76.94 秒，退出 0 |
| `npm run typecheck` 最终 | 通过，退出 0 |
| `npm run build` | 通过，退出 0 |
| `npm run web:build` | 通过，退出 0；保留依赖 lucide-react 的两条既有 use-client 构建告警 |
| `npm run eval:agent -- --out evals/reports/p1-fix-original20` | **17 通过、2 失败、1 跳过**，退出 1 |
| `npm run eval:phase2 -- --out evals/reports/p1-fix-fault30` | **30/30**，0 失败/错误/跳过，退出 0 |
| 用户指定字面命令 `npm run web` | package.json 无 web 脚本，退出 1；实际前端检查为 web:build |
| 用户指定字面命令 `npm run eval`，两次 | package.json 无 eval 脚本，两次均退出 1；实际分别执行上述固定 20 题/30 题入口 |

未增加脚本别名或启动真实服务来使不存在的命令变绿。需要本机监听的测试在获得工具权限后执行，未把沙箱限制计成业务失败。TMPDIR 使用 `/private/tmp`，依赖复用既有 node_modules，未安装或修改依赖/SDK。

- B07：立即重发的历史断言仍失败；已持久化意图、Task 不重跑和崩溃后恢复子项保持通过。30 秒退避的当前契约由原故障集验证。
- C04：历史 M3 虚假排队语义回放仍失败。现有宿主保护回归通过不等于新真实模型语义实验通过。
- D03：自动主题路由仍未实现，继续跳过；未引用其他分支能力。
- 两份原数据集、原 30 项故障场景实现和现有断言未改。评测入口仅适配必需的显式通知范围参数。
- 原 30 题的固定 11 通知场景仍为意图 11/11、Mock 外部接受 9/11、本地 Sent 9/11、可恢复故障 6/6；重复为已接受场景中的 2/9。N07、N08 各接受 2 次、Task 各执行 1 次。这些是离线机制指标，不是生产投递成功率。

本轮原始日志、修复前源码快照、实际 SQL/计划和保护检查：`/private/tmp/ppa-p1-fix-evidence/`；摘要及查询计划位于本工作树忽略目录 `evals/reports/p1-fix/`；两套逐题 JSON/Trace 分别位于上述新报告目录及新建 `evals/traces/` 运行目录。不覆盖旧证据，不纳入提交。

## 6. 文件与目的

| 文件 | 目的 |
| --- | --- |
| `src/contracts.ts` | 明确 Console/Web/飞书通知范围类型，飞书不绑定单个聊天 |
| `src/goal-notification-store.ts` | 所有资格进入 LIMIT 前 SQL，运行期租约回收使用同范围；保留事务/令牌/投递逻辑 |
| `src/notification-worker.ts` | 使用显式范围，不再接收任意通知资格 callback |
| `src/main.ts` | 将现有配置和授权身份显式传给 Worker/GoalRunner |
| `src/goal-runner.ts` | 两处通知投递调用同步适配；原 Goal/Policy 权限 callback 不变 |
| `src/scheduler.ts` | 独立使用时明确默认 Console，其他渠道可传范围；main 仍使用注入 Worker |
| `tests/notification-queue-scope.test.ts` | 新增上述 13 项行为回归 |
| 现有测试及夹具（下列） | 仅传入范围/适配构造调用；混合渠道 Memory 样本显式选择对应阶段的渠道；不改原断言 |
| `evals/environments/{goal-recovery,notifications}.ts`、`evals/runners/scenarios.ts` | 同步调用接口，保留旧源码对照和历史失败预期 |
| `docs/PR_READINESS_P1_FIX.md`、`docs/STATE.md` | 本报告与当前交接快照 |

现有测试/夹具适配清单：`a2-b1-offline`、`console-offline-repair`、`feishu-channel`、`goal-initial-identity`、`goal-integration`、`goal-receipt-context`、`goal-runner`、`goal-skills-integration`、`m3-state`、`memory-acceptance`、`memory-integration`、`notification-adapters`、`phase3-integration`、`pi-integration`、`session-persistence`、`staged-console-flow`、`web-ui`、`work-runner`（均为 `tests/*.test.ts`），以及 `tests/helpers/{goal-web-crash-client,goal-web-fixture,notification-process,proactive-fixture}.ts`。

`src/pi-executor.ts`、`src/config.ts`、`src/sqlite-store.ts`、依赖文件、WorkJob 实现、Console SIGTERM 逻辑和历史报告保持基线内容。

## 7. 剩余风险与下一步

1. 外部接受但响应/本地确认丢失时，重试仍可能重复；本轮没有新增外部幂等保证，也没有关闭重试。租约 fencing 只保护本地状态。N07/N08 的风险继续披露。
2. 不匹配身份的旧通知按要求保持原样，需匹配配置或既有人工处置；本轮不清理、不改写或跨身份发送。原全局启动恢复仍会在独占启动阶段保守恢复 sending，与本轮运行期查询隔离是不同操作。
3. 规模性能、真实飞书投递、生产迁移/长期运行、真实模型语义能力均未新增验证；Mock 通过不构成这些能力的证明。
4. 此处只关闭已定位的 P1。应复审新分支的实际修复 diff，再处理独立 PR Readiness Review 中其他已披露限制；PR #5 的后续集成问题不在本轮修改范围。禁止据此自动创建 PR 或合并原 `ff6e346`。

发布范围：仅本轮 34 个文件；提交前再次核验源码/测试与已通过验证的 Hash 一致，原始 Trace、日志和忽略目录不纳入提交。此前实际测试结果沿用，不将发布检查表述为新一轮全量测试。建议下一步：将独立修复分支和新增测试交给 PR Readiness Review；创建 PR 或合并仍需用户后续明确授权。
