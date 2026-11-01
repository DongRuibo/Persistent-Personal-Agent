# 第二阶段 2A：确定性路由与纯文本后台工作交付

日期：2026-11-01（Asia/Shanghai）。基线为已审查PR #3 head `e2c95c067d4f33aa5cd9fdb0c6b17e40bc82ba4b`，独立分支 `codex/router-worker-mvp`。开始时重新核对GitHub：PR #3 open/未合并，main为`75b724f17d17a70ad51caf7c4697251259d7ef3c`。用户已明确授权本次2A代码、测试和相关文档提交到`codex/router-worker-mvp`、推送并创建PR；发布准备阶段仍未提交或创建远端对象。新PR以`codex/workthread-foundation`为base，只展示2A增量并依赖[PR #3](https://github.com/DongRuibo/Persistent-Personal-Agent/pull/3)；不合并或修改PR #3/main，不开始2B。

## 已交付行为

- 同一Chat入口可显式选主题并后台提交，事务成功才返回真实Job/Thread/状态/时间收据；普通聊天默认行为与前台busy独立，Router模型调用0。
- 一张work_jobs管理新工作，不改变旧Task/Goal的含义；结果、错误、执行时间及用量仍是原Run/事件/model_calls。每项Job直接归属主题，不占手动WorkLink名额。
- WorkRunner使用原BackgroundLane，前台、到期Task和原已就绪Goal优先；work scope独立临时Pi Session、无工具/Skill/Memory正文/历史，14KiB入口、32KiB实际payload、单请求、最多4096输出token、原执行超时。
- queued取消无Run；running先原子取消/结束Run再abort，迟到结果无提交资格。重启原子恢复running为interrupted、保留queued，失败/中断/取消不重跑。取消不提前释放门。
- 提交结果后进入主题和现有收件箱，通知含主题/工作标识；通知失败只记deliveryError，结果可单独查看。详情读取不写ACK或批准文件操作。
- `WORK_JOBS_ENABLED=false`默认关闭，只在已启用WorkThread的本机Web组装；旧开关、Pi SDK/Loop、TaskScheduler、GoalRunner、OperationGuard与Memory服务实现保持原样。

## 文件与目的

| 文件 | 修改目的 |
| --- | --- |
| [work-job-types.ts](../../src/work-job-types.ts)、[work-job-store.ts](../../src/work-job-store.ts) | Job DTO、同库增量表、请求去重、原子领取/结束/取消和恢复 |
| [work-router.ts](../../src/work-router.ts) | 显式Chat/Work分派、可信绑定的列表/详情/取消 |
| [work-runner.ts](../../src/work-runner.ts) | 共用后台门、原优先级、独立执行、迟到结果丢弃、通知及正常停机 |
| [sqlite-store.ts](../../src/sqlite-store.ts) | 接入Job的原Run事务与共同恢复，阻止普通finishRun绕过聚合提交 |
| [contracts.ts](../../src/contracts.ts)、[pi-executor.ts](../../src/pi-executor.ts) | 增量work scope、无Memory投影与查询改写、零工具/Skill、单请求和实际请求/输出预算 |
| [config.ts](../../src/config.ts)、[.env.example](../../.env.example)、[main.ts](../../src/main.ts) | 默认关闭开关、依赖/模式检查、同宿主身份组装、启动和关闭 |
| [web-ui-store.ts](../../src/web-ui-store.ts) | 从Job owner/channel及runId证明Run归属，不信任手工关系 |
| [web-ui-channel.ts](../../src/web-ui-channel.ts)、[web-ui-server.ts](../../src/web-ui-server.ts)、[web-ui-types.ts](../../src/web-ui-types.ts) | 原认证/Origin/CSRF/限流下的Job API、入口一次校验、详情与投递错误展示 |
| [main.tsx](../../web/src/main.tsx)、[work-jobs.tsx](../../web/src/work-jobs.tsx)、[work-threads.tsx](../../web/src/work-threads.tsx)、[style.css](../../web/src/style.css) | 主题选择、后台提交/同ID重试、收据、队列/取消/结果、主题内查询和窄屏布局 |
| [preview-web-ui.ts](../../scripts/preview-web-ui.ts)、[web-ui-fixture.ts](../../tests/helpers/web-ui-fixture.ts) | 新开关的临时预览及可控Runner，不引入真实配置或端点 |
| [work-jobs.test.ts](../../tests/work-jobs.test.ts) | 10项状态、迁移兼容、事务故障、身份和Run访问证据 |
| [work-router.test.ts](../../tests/work-router.test.ts) | 4项API/去重/权限/关闭兼容及普通Chat零路由调用 |
| [work-runner.test.ts](../../tests/work-runner.test.ts) | 当前13项真实Pi与模拟执行；P2补HTTP500并收紧失败/中断、原因、无输出与副作用断言 |
| [pi-executor.test.ts](../../tests/pi-executor.test.ts) | 当前6项；P2补保护性abort与真实取消/超时分类、异常Session释放及旧scope语义回归 |
| [work-jobs-process.test.ts](../../tests/work-jobs-process.test.ts) | 1项真实main四进程、强杀、陈旧锁自然恢复、关闭与开启、旧结果/Chat不重放 |
| [README](../../README.md)、[PROJECT](../PROJECT.md)、[STATE](../STATE.md) | 启用方法、已实现边界和当前交接快照 |
| [执行计划](../designs/work-router-worker-mvp.md)、[PR #3审查](workthread-pr3-review.md) | 仅带入本任务相关的原交接，计划补充实际交付入口；原审查结论不变 |

未带入旧路线图、PR #2本地报告或任何运行数据。未修改AGENTS、依赖或SDK源码；原审查工作树不切分支、不覆盖其未提交文档。

## 离线验收矩阵

| 场景 | 实际证据 |
| --- | --- |
| 两主题闭环 | 不同Job/Run/主题准确绑定，各1次模型请求；事务入队立即返回，结果分别可查和入箱 |
| 不阻塞Chat | Worker等待时真实Pi Chat成功；Worker payload不含该Chat或另一主题输入，交互JSONL在独立Worker前后逐字节不变 |
| 串行与优先级 | 同门Task→原Goal→Work顺序成立；前台准入、同步检查后新到期Task、取消后Session未结束均阻止Worker抢领 |
| 去重与冲突 | 同requestId重试、读取与重开返回原Job；内容或主题冲突409；实际main重启后既有Job/Chat不重跑 |
| 权限/工具 | 未登录、CSRF/Origin、额外owner/target/scope、未知/其他身份/渠道/归档主题均拒绝；手工WorkLink不能放行外来Run；模型强提Memory工具仅1请求且零写入 |
| 取消/停机 | queued取消无Run；忽略abort的迟到成功不能覆盖cancelled，门等执行结束；正常停止等待执行、保留其他queued |
| 原子性/恢复 | 触发器分别使claim/finish/cancel/recover写Job失败，Run与Job共同回滚；真实main强杀后running统一中断、queued保留、完成与取消不重排 |
| 通知 | 模拟投递失败保留succeeded/原Run输出与deliveryError；再tick/查详情不重跑，不写web_render_ack |
| 开关/预算 | 默认关闭、依赖检查；关闭API/Runner不执行，重开只领queued；UTF-8超限413；实际payload超限零HTTP；工具异常、截断、超时均非成功，无第二请求；4096输出参数实际下发 |
| 工程/浏览器 | 检查结果见下表；实际1280px/390px提交→继续Chat→结果→queued/running取消→刷新→主题→收件箱，控制台warn/error为空 |

真实main测试共4次启动、4次本机模拟HTTP（3个工作尝试+1次Chat）。强杀后等待原10秒陈旧锁自然失效，没有删锁或修改业务状态来绕过恢复。浏览器验收共4次本机模拟请求（2个成功Worker+1个取消中的Worker+1次Chat），另1个排队取消无Run/请求；最终2 succeeded/2 cancelled，刷新、主题和收件箱读取没有新增模型调用。

窄屏首次检查发现新列表挤占消息区，原因是原Chat使用固定高度flex布局。已将列表置于消息滚动区并默认折叠，输入和回复恢复可见；390px/1280px页面scrollWidth与innerWidth相等。最终前端构建重载后复验，截图仅保存在本机，不纳入代码。浏览器使用合成主题/文本，预览不等于真实手机或模型语义验收。

## 初次2A工程验证（历史记录）

| 检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` | 退出0，含src/tests/scripts |
| `npm run build` | 退出0 |
| `npm run web:build` | 退出0，保留2条既有lucide use-client警告 |
| 最终 `TMPDIR=/private/tmp npm test` | 615/615通过，0失败、0跳过，约70.14秒 |
| 新增专项 | 27项；前轮588项保留 |
| 差异/文件检查 | git diff --check、UTF-8、内部文档链接与差异路径/常见凭据模式检查通过 |

本机macOS arm64 / Node24.19.0。初次HTTP专项在沙箱listen EPERM；允许本机监听后重跑通过，未将环境限制报为业务失败。开发中修正了新进程测试的循环类型推断及UUID参数类型后完成typecheck。第一轮全量615/615通过；后续补充通知的主题/工作标识及开启Skill时的隔离断言后执行上表最终全量。最后布局调整只影响前端，已重新web:build及重载浏览器验证。未运行Memory/Formation eval，相关实现未改；没有新收费、真实Tavily/飞书、正式数据或长期负载测试。

## P2定点修复收尾（本轮重新验证）

原问题是work scope在模型失败、length或禁止工具提议时执行保护性abort，随后统一的stopped判断把已知故障改成ExecutionInterrupted。复用进入本轮前已经存在的3文件修复，没有重写其正确逻辑：`runPiSession`仅为work保存首个模型故障，单独记录真实超时；内部abort仍阻止第二次模型请求；真实取消、停机与超时仍优先中断。WorkRunner不靠错误文本猜状态，旧Chat/Task/Goal保持原分类。

本轮恢复开发的现场为同一`e2c95c0`/`codex/router-worker-mvp`，19项已修改及12项未跟踪；此前3文件修复已存在。本轮源代码和测试没有再改，仅更新STATE和本记录。相对初次2A交付，P2总差异为`src/pi-executor.ts`、`tests/work-runner.test.ts`、`tests/pi-executor.test.ts`及这两份文档。验收文件Hash、基线、完整31文件2A差异/P2差异/文档增量的Hash见[验证摘要](router-worker-mvp-validation.json)。完整2A包包含原计划与PR #3交接报告两份文档，明确保留其历史性质，没有加入无关旧路线图或运行数据。

| 本轮检查 | 结果与原始日志Hash摘要 |
| --- | --- |
| 原2A逻辑红灯 | 从原交付diff+HEAD在临时副本复原pi-executor，恢复CRLF后SHA-256与初交付清单完全一致；使用当前3项精确用例，3/3按预期失败，实际interrupted而期望failed，退出1；未回退真实工作树。[红灯日志Hash](router-worker-mvp-validation.json) |
| `TMPDIR=/private/tmp node --import tsx --test tests/pi-executor.test.ts tests/work-runner.test.ts` | 19/19通过，0失败/跳过，退出0；HTTP500、length、tool均Job/Run failed、原因准确、成功输出为空；各1次HTTP、无Memory/Task/文件副作用；payload零HTTP；真实超时interrupted。[专项日志Hash](router-worker-mvp-validation.json) |
| 取消/停机与旧scope | 专项覆盖running取消、迟到成功无资格、门等Session结束、停机interrupted、异常Session释放及Chat/Task/Goal原分类；全量含queued取消零Run/模型与真实main恢复。保护性abort没有移除或放开续请求 |
| `npm run typecheck` | 退出0。[类型日志Hash](router-worker-mvp-validation.json) |
| `npm run build` | 退出0。[后端构建日志Hash](router-worker-mvp-validation.json) |
| `npm run web:build` | 退出0，保留2条既有lucide use-client警告。[前端构建日志Hash](router-worker-mvp-validation.json) |
| `TMPDIR=/private/tmp npm test` | 618/618通过，0失败/取消/跳过，测试报告68.85秒，命令墙钟69.04秒，退出0；比初交付615多HTTP500和2项执行器分类回归。[全量日志Hash](router-worker-mvp-validation.json) |

首次专项因沙箱拒绝`127.0.0.1 listen`而退出1；首次后端/前端构建因执行树产物写入EPERM分别退出2/1。均保留`specialized-sandbox.log`、`build-sandbox.log`、`web-build-sandbox.log`原始日志，按工具审批机制仅授权既定本机模拟监听和执行树构建写入后重跑通过；环境受限失败未计为业务失败或隐藏。没有更换到主审查树执行。

本次P2收尾没有UI修改，浏览器沿用初交付证据，未重跑；未跑Memory/Formation eval、收费业务模型、真实联网/飞书/手机或长期负载。测试仅用临时SQLite、合成文本、假Key、本机模拟端点；未访问正式配置、数据库、Session、Memory及备份。新功能仍默认关闭；P2收尾时没有提交、推送、PR、合并或分支切换；第1轮独立只读复审已通过。此后用户已授权本次发布；发布准备不更改代码和测试，也不进入2B。

## 第1轮独立复审与最终文档收尾

[第1轮独立审查摘要](router-worker-mvp-validation.json)结论为无阻断、无追加可执行缺陷，可交付默认关闭的2A供用户决定是否发布；[审查检查及原记录Hash](router-worker-mvp-validation.json)保留具体检查。Reviewer重新实跑同一两文件专项19/19、0失败/跳过；618全量、typecheck、两端构建与原逻辑红灯仅核验Worker原始日志及Hash，浏览器仅核验初交付证据，没有冒充Reviewer重跑。Reviewer前后371文件Hash、所有本地refs及Git状态一致，未改执行树。

审查通过后只更新STATE与本评估的结论/链接，源码和测试保持冻结，未重复项目测试。原顶层证据、初次615历史、三项原逻辑红灯及沙箱EPERM失败日志保持原样。仓库内[验证摘要](router-worker-mvp-validation.json)记录31文件验收Hash、原始日志/差异Hash、检查命令、退出码、独立审查来源及未验证边界；原始日志、截图和本机快照不随代码发布。P2差异仍分为三文件源码/测试、含文档五文件和本轮文档收尾，完整2A原包31文件，不把已有修复说成发布准备新代码。

用户现已授权提交、推送及创建PR。因为PR #3仍未合并，新PR固定以`codex/workthread-foundation`为base并注明依赖，只展示2A增量；本次不合并、不调整PR #3、不修改main。未来PR #3合并后，必须另行核对基线再调整目标。发布准备仅改STATE、本记录并增加验证摘要；原执行计划与PR #3审查报告保留为历史依赖交接，不代表进入2B。发布动作的实际结果以Git提交和PR记录为准。

## 剩余边界与下一步

1. 2A只是显式确定性分派，不宣称智能语义路由完成；2B模型建议/澄清、联网与并行Worker、订阅及Chain of Recall均不在本轮。
2. 非抢占串行后台可能使运行后到期的Task延迟；取消/超时仍依赖SDK/供应商结束Session，不因取消提前开放第二个后台执行。优先级高的持续工作可能使Job等待，未承诺公平调度或提醒准点。
3. 通知没有通用Outbox，提交与投递间崩溃可能漏通知；结果从Job详情可查，没有因通知失败重跑或必达保证。
4. Job和每主题列表最近100项，无分页/删除；主题原100条/手工关联100条等限制保留。未做正式历史规模、连续运行、真实手机/模型语义质量或费用验收。
5. 功能默认关闭。用户已授权本次提交、推送及创建依赖PR，发布准备时尚无新提交标识；PR #3尚未合并，本分支依赖其已审查head，PR base为`codex/workthread-foundation`。不合并main、不启用正式功能或沿用旧收费许可。
