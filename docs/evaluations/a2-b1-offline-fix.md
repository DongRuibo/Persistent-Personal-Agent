# A2收据时序与B1 Skill选择：离线定点修复

日期：2026-10-24。基线`4c673e176bc4a847833079e591cb9837f1db8feb`，修复分支`codex/a2-b1-offline-fix`。**只完成离线修复和可审查证据，不代表真实模型理解或自动选择已修好。** 原[真实报告](staged-console-live-acceptance.md)、[JSON](staged-console-live-acceptance.json)、[冻结方案](staged-console-live-plan.md)及更早身份修复报告均不改。

本轮没有真实模型HTTP、公网DNS/GET、收费评测、飞书、正式数据或.env操作，没有合并、推送或部署；旧轮剩余36次及预算未使用。独立工作树：`C:/Users/Dongr/.codex/worktrees/a2-b1-offline-fix/Persistent Personal Agent`。原数据只读核Hash；SQLite分析使用新证据目录中的副本，以只读连接查询，不在原库运行初始化、迁移或重放。

## 确认的事实与根因

### A2：旧提交与新授权的身份混淆

原request-07的最新goal_manage结果为Goal ready、revision3、Plan v1已批准，但仅以Goal.checkpointRunId非空显示“Checkpoint：已提交”。此指针实际指向Plan v0/bootstrap：Step `1edd1bb3-d988-4807-931b-e479be101e93`，Run `9b484d67-43ec-404d-9a34-4d9d96ffe760`。新正式Step `5a46b94a-62be-4aba-ad86-e257bcde23a6`的Run `2cd98a0c-0a25-4b7c-931b-ec11786e7f89`在之后request-08才执行、提交partial。

response-07先声称“第一个片段也已经跑完”，并编造一题；response-08真正提交的是另一题。SQLite没有把Chat编造内容保存为Checkpoint。原Console最终结果已有宿主覆盖，原Session保留错误原文与2条host-goal-result-v1，但收据仍只记录Goal级别的Checkpoint有无，缺少Plan/Step/Run归属。**这是可确认的宿主信息契约缺口，与模型错误相符；不能证明是模型错误的唯一原因。** 不需要让Chat等待后台或再收费纠错。

### B1：发现正常，适用描述存在歧义，选择质量未证实

request-09/10均包含原生available_skills中的agent-notes名称、description、受管绝对路径和可用read工具。真实模型只调用web_get，4793字节完整正文进入request-10，随后直接总结；没有read提议、skill_activated或宿主拒绝Skill读取事件。因此本例不是原生发现失败，也不是Web失败使后续选择失去机会。

原description强调“用户已经提供”和“不自行访问外部来源”，未明确涵盖当前请求中由授权工具取得的资料。调整这一说明有证据依据；**是否能提高真实选择率尚无对照证据**。另外B沿用了A的原生Chat Session：错误response-07和2条宿主收据实际可见，正式response-08的成果正文没有复制进Chat；response-10还主动谈及旧Goal。可确认有旧话题干扰机会，不能确认它造成漏read。保留原Session继承机制，增加通用的当前请求优先提示，不清历史、不硬编码路由。

## 最小改动与调用关系

| 文件 | 目的 |
| --- | --- |
| `src/goal-types.ts`、`src/goal-store.ts` | GoalView只读派生投递证据：既有delivery_succeeded事件为succeeded，Run.deliveryError为failed，否则unconfirmed；无DDL或新持久状态 |
| `src/goal-runner.ts` | 共用renderGoalState：显示Goal/revision、批准Plan及批准Run、当前Step、同Plan/Step最新Execution、Checkpoint自己的Plan/Step/Run/outcome及独立投递状态；旧bootstrap明确是历史成果。完整输出仅引用已提交Checkpoint |
| `src/operation-guard.ts` | 每个Goal读取同一事务快照，同时构建ToolResult、frame.contextResult和用户可见结果；显示版本也取该快照，避免二次读取混用版本。不改身份、引用、TTL、审批、单次权限或CAS |
| `src/pi-executor.ts` | 原host-goal-result-v1标为“当时快照”，保留原模型错误；用公开sendCustomMessage、triggerTurn=false，不追加模型调用或复制后台Session。通用提示明确排队/执行/提交/投递之别，历史题目不替代本轮请求 |
| `skills/agent-notes/SKILL.md` | 1.0.1明确可整理本轮经宿主授权工具取得的正文；仍不能获取网络/任意文件权限或擅自追加取数。不强制所有文档查询使用Skill |
| `tests/a2-b1-offline.test.ts`、`tests/fixtures/staged-a2-b1.json` | 提取原虚构输出、原错误回答与旧Skill字节；原版Pi、临时SQLite、模拟模型和本机HTTP验证时序、状态、Session、只读资料与升级拒绝 |
| `README.md`、`docs/STATE.md`、本报告及机器报告 | 说明升级、证据、风险和交接，不改历史失败 |

调用链保持原状：GoalService控制事务→Guard读取GoalView→工具/宿主收据/前台结果同源→前台结束→Runner领取→独立零工具Goal Session单次模型请求→原子Checkpoint提交→Channel投递→记录投递证据。未增加执行授权、模型修复回合或另一套状态机。当前Step运行中仍可查看已知状态，不等待、预测或生成其成果。

“committed”只证明该Execution提交，不证明当前排队片段完成或消息送达。unconfirmed不等于确定没发出；succeeded只表示已有成功投递记录，不是必达或exactly-once保证。通知发送中的正文快照可以仍标unconfirmed，发送后再次查询才可看到成功记录。

### Skill版本与旧审批

原真实安装包为1.0.0、758字节，批准Hash `e42d303f2c12195e4c1a4ebe54365f34e0c25c0b5ae86e84481146bceb33822e`。Fixture保留其CRLF字节；Git规范化后的同文LF包Hash不同，不能当成可自动替代。新包版本/实际Hash见[机器报告](a2-b1-offline-fix.json)和skill-version-hashes-final.json。

原受管安装、批准文件、旧Plan和Checkpoint均不更新。保留旧包时仍按其原Hash工作；选择升级则停服、审阅并重新批准实际字节包、重启，旧Plan不自动换Hash，需重新绑定/展示/审批。新测试用原批准Hash形成旧Plan，再安装批准1.0.1；领取前保守阻塞，旧Execution/Plan/Checkpoint逐字不变，模型调用0。不引入兼容性自动重映射。

## 红绿反例与验证

证据根：`E:/AgentWork/validation/personal-agent-a2-b1-offline-fix-20261024`。原验收根和预算账本不接入测试。

- `red-targeted.log`：先在4c673e1产品基线上运行3个新测试，3/3失败，分别检出ToolResult缺少Checkpoint归属、运行状态/投递展示缺口、旧Skill版本说明。B红测证明描述未调整，不证明真实路由一定改善。
- `green-targeted.log`：对应修复后相关53/53通过，含原Skills权限、收据持久化失败及综合Skill/Web/Goal回归。
- 最终新增6项在`green-byte-exact-final.log`全部通过：旧bootstrap+新正式计划、故意重放错误回答、ToolResult/Console/Session同源、运行/partial/complete/failed/interrupted及投递状态、跨重启不重放、实际read/低信任Web、共享Session且B不注册Goal工具、后台延迟中查看、发送失败不重跑、原1.0.0批准Hash升级后旧Plan阻塞。
- `windows-reviewed-final-gates.json`记录typecheck、build、npm test、eval:memory、eval:formation均退出0。全量480项：477通过、0失败、3项原平台跳过；最终字节精确Fixture又通过6项专项。全量后仅收紧该Fixture的原包字节/Hash断言，产品代码未再变化。
- 三项跳过为POSIX私有权限位、当前Windows账户无符号链接权限、POSIX SIGTERM优雅退出。Docker Linux engine不可连接，WSL只有Stopped的docker-desktop；linux-runtime-check.json保留实际结果。本轮Linux未运行，没有下载安装环境或沿用历史绿灯。
- Memory eval为offline-lexical，调用0；Formation开发/留出固定窗各30/30，API 0，独立输出formation-eval.json，不覆盖历史结果。全量保留原Task/Memory/Session/Formation/Skills/Web/Goal/策略/通知及预算入口回归。

编排失败也保留：green-initial.log中一项因测试对JSON序列化字符串直接匹配引号导致Mock 500，改为核对解码消息；expanded-targeted.log中B模拟请求没明确指定资源被宿主正确拒绝，改用既有明确话术后通过。没有放宽产品检查或改旧Case、预期。最后审查又将Session“无后台正文”断言改为解码JSONL消息，避免对转义换行的错误检查。

差异导出曾受Windows默认文本换行转换影响，反向校验失败；初始差异文件保留，改为逐字节导出并保留新文件原行尾后，Git只读反向校验通过。没有因此修改产品源码。

本机复现：`node --import tsx --test tests/a2-b1-offline.test.ts`。完整命令及退出码在机器报告；Formation使用新的`--output=`，不能照抄覆盖已有证据文件。Mock按预定顺序调用read不代表真实模型会自行选择Skill。

## Hash、差异与工作树

[机器报告](a2-b1-offline-fix.json)记录151份源码/测试/脚本/包文件的最终清单Hash、可应用的product-and-tests-reviewed-final.patch及关键原始证据Hash。证据根同时保留causal-audit.json、解析后的真实输出、只读SQLite副本和最终校验记录。原始request/response、Session、SQLite及账本保持原Hash；旧真实报告和冻结入口/话术不改。原E盘保存分支HEAD/8项改动、其他工作树分支/HEAD与已有改动保持不变。

当前修复工作树HEAD仍为4c673e1，改动未提交、未合并、未推送。node_modules仅复用已有依赖；不修改Pi SDK、Agent Loop、正式配置或默认开关。报告、Hash清单和完整diff供审查，不以文档发布冒充产品已启用。

## 剩余风险与下一轮建议

宿主信息契约和输出已离线修复，模型仍可能忽略提示或在不调用Goal工具的普通回答中复述旧错误；Session有纠正收据不证明模型已理解。权限/版本/执行/Checkpoint继续由宿主决定。B1真实自动选择率、A2真实收据解释、正式Skill/Web联合Goal及完整生命周期仍待新授权复验。V3.0.1自然暂停、操作收据两项历史门槛继续开放，正式主动执行不启用。

下一次小规模复验可把自然暂停设为独立测试组：事先冻结一个不含“学习计划”连续字样的虚构Goal名称，先通过独立的合法创建/持久化与查看建立唯一同身份、渠道、revision/显示版本且投递成功的视图；不依赖Web或agent-notes。查看成功后在TTL内立即发送原话“暂停那个学习计划”，分别审查模型、宿主、SQLite和Session；前置失败或超期即停，不补查刷新。Skill自动选择和收据解释使用独立判据/预算，不能用其失败阻挡已具备有效前置的暂停组，也不以宿主造状态冒充真实自然创建通过。本轮仅建议，未创建新收费入口或执行。
