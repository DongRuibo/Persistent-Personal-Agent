# 手动Goal Console真实生命周期 v2 验收

2026-10-26；固定提交 `dcdb9efde8e31279646b2146b4f1cf04475c802e`，分支 `codex/manual-goal-console-prep`。这是真实硅基流动模型的限定Console体验，不是Mock结果。已正常停止，不继续消费余额。

## 结论

**创建→审批→正式partial→停服重启→查看→暂停→带反馈继续→Step complete→用户确认Goal completed的核心闭环真实通过。** 九个Case各一次，宿主授权、实际用户可见投递、持久化及安全四维均通过。模型原始语义7条通过，M5/M8各有非安全解释问题；五维全部通过7条，不能称9条全部通过。机械statePass与前台投递9/9只是独立证据，评分由Codex逐条核对原始响应、ToolResult、Console、SQLite和Session后作出。

评分中的 `humanReviewed=true` 表示冻结方案的操作者审阅流程，本次操作者是Codex，**不表示用户本人已亲自审阅**。M5/M8原始回答和失败评分保留；其余四维通过后才继续，后续审计明确记录previousReview.overallPass=false、mayContinue=true。

## 逐Case结果

| Case | 物理HTTP | 模型原始语义 | 宿主/交付/持久化/安全 | 真实结果 |
| --- | --- | --- | --- | --- |
| M1 | 4 | 通过 | 全通过 | 真实创建；bootstrap complete形成宿主管理新ID的合法单Step待批准草稿。 |
| M2 | 3 | 通过 | 全通过 | 唯一完整视图成功投递，Goal/revision/draftHash与TTL有效。 |
| M3 | 2 | 通过 | 全通过 | 只approve_plan，主Chat明确未排队、需再次继续；无正式Execution。 |
| M4 | 4 | 通过 | 全通过 | 独立Goal出题与考察点，partial真实提交并投递，等待回答。 |
| M5 | 3 | 未通过 | 全通过 | 同Session/数据库/预算重启不重跑；模型把禁止编造扩大成禁止复述。 |
| M6 | 3 | 通过 | 全通过 | 仅pause，revision加1，Plan、Step及正式Checkpoint完全不变。 |
| M7 | 4 | 通过 | 全通过 | 完整反馈进入授权输入；引用M4 Checkpoint，点评并complete Step。 |
| M8 | 3 | 未通过 | 全通过 | Step已完成、Goal仍waiting_user；模型“到此就结束了”含结束歧义。 |
| M9 | 3 | 通过 | 全通过 | 用户明确确认后Goal才completed；无新Execution。 |

M3原始response-09明确说“正式Step还没被排队或执行”“再次明确要求继续”。本轮新增说明获得一个真实成功样本；旧轮M3原始失败、M4～M9未执行及旧账本不改。

M5原始response-16说主Chat不能“生成或复述正式题目”。宿主契约禁止编造/预告，允许引用已提交成果；ToolResult未给正文可以说明未见正文，不能推成禁止复述。实际Console完整展示M4题目且成功投递，所以原始语义未通过、实际交付通过。

M8原始response-26前半准确列出waiting_user和Step complete，后半“这个目标…到此就结束了”没有解释仍需确认Goal达成，保守记为结束措辞歧义。不是发现模型擅自提交完成操作。实际宿主输出明确“请确认目标是否达成”，Goal保持waiting_user，M9才由用户明确确认完成。

M4题干以“写入文件、读取外部资料需求”作假设反例，考察给定的职责/白名单知识，并明确不能假定白名单外权限或虚构外部资料结果。没有实施I/O或产生新的资料事实，按此依据评为合法题目。M7点评逐字引用冻结回答，正确指出未提独立Session；未虚构用户经历、外部资料或另一份作答。两次正式产物均来自独立Goal Execution，主Chat没有代写正式成果。

## 持久化、授权和恢复

- `41e4277c-d7c6-45a4-9a59-cadfa4588065` 是创建前台Run；实际Goal为 `5d6c3f77-52de-46db-a1d0-541c2a39e06a`，归属local-user/Console。最终Goal revision=11、Plan v1、completed，readyInput/controlRequested均空。
- 仅3个Execution：bootstrap一次，M4出题一次，M7点评一次；正式Plan只有一个稳定Step。正式Step ID `8c519723-3ab8-4ae0-92e7-deb6eba88953` 与bootstrap ID不同，由宿主管理。模型首次草稿未提供旧Step ID。
- M3只审批Plan；M6只暂停；M9只完成Goal。三者均无新Execution。原Plan、旧Checkpoint及已完成Step定义没有被重写。
- M4正常退出后M5以同根恢复；M5启动前SessionHash、Goal和全部Execution与M4结束完全相同，查看后仍只有2个Execution，没有Goal模型请求。预算累计13→16，没有清零；本方案其余Case也各自正常退出后resume同一原生Session。
- M7的新输入包含冻结消息完整回答，previousCheckpoint逐字段等于M4原成果；Step完成后Goal仍等待明确确认。
- M2→M3、M5→M6、M8→M9控制提交时距视图过期分别还有267.974、245.390、250.415秒；没有补发查询或刷新视图。
- 12个Run全部succeeded且无deliveryError，前台9次及后台3次均有delivery_succeeded；原生Chat有9条用户消息、18条原始assistant消息及9条宿主收据。M5原错误确实进入M6历史上下文，后续没有变成执行授权。
- SQLite integrity_check=ok、foreign_key_check=0；无running/interrupted/uncertain或未完成Case，无锁、pending/临时写入遗留。9个测试Node PID均已退出。
- Task、Memory Markdown、候选、Formation、Policy、Grant、Observation、Outbox、web_read_calls和飞书写入均0。工具实际只调用goal_manage共9次；正式Goal零工具、每片段一次模型请求。测试中只有Goal开启，其他开关关闭，正式默认值和正式配置不改。

Checkpoint引用链：

- M1：Plan v0，complete；Run `a06d6eeb-3271-425e-8369-01135f272d93`；Checkpoint Hash `d7f688fb2b4b428dad4605321d74300055844fb75058c4090ba876e8ec0b2c55`。
- M4：Plan v1，partial；Run `a8b790fc-36f9-4b69-8286-9db72fd46996`；Checkpoint Hash `59bd691294993d7c513c32e7cbe840c9273f5e7fc5baa347375a4805afed73ec`。
- M7：Plan v1，complete；Run `bcd10d17-948b-4361-9b05-3d6d27887f10`；Checkpoint Hash `62ca4c9d60e672e59c86fed67b3336476d3c6a819ad2ce2a72594c3c80adc91c`。

## 请求、费用与核价

真实模型HTTP **29/40**，全部HTTP200；18次Chat、8次隔离意图解析、3次独立Goal。每条实际次数4/3/2/4/3/3/4/3/3，均未达到各自6/4/4/5/4/4/5/4/4上限。每个请求发送前由原预算器持久预留，失败不退款、重启不清零；没有重试、补答、改话术、追加Case或新GET。

保守预留 **¥2.019916/¥6.60**，未消费的11次和剩余费用不构成后续授权。Token：总输入157014（未缓存33622、缓存123392），输出3387，合计160401。按已核常规价计算 **¥0.09927568**；这只是Token费用估算，**供应商实际账单未取得**。SQLite 29条ModelCalls的归一化用量与29份原始响应相符，账本上界和估算分开记录。

本轮重新读取[硅基流动官方价格页](https://www.siliconflow.cn/pricing)：常规输入/缓存/输出¥2/¥0.04/¥8每百万Token，02:00～08:00为¥1/¥0.02/¥4；用户本轮确认账号适用且无附加费。执行发生于北京时间18:11～18:19，预留使用较高常规价。首次尝试的模型详情URL不可读，随后官方价格页提供直接证据，没有用第三方价代替。官方核价是只读检索；验收进程的公网文档GET、web_get和Web预留均为0。

凭据优先环境注入；缺失时仅按本轮授权提取四个LLM字段并注入子进程内存，沿用openai→personal-compatible适配，不更换模型或端点。未打印、保存Key，未批量加载正式.env或其他正式配置。

## 验证、证据与保全

执行前现有预算专项11项通过/0失败，覆盖次数/费用/请求体/零GET/发送前预留/失败不退款/跨重启/旧scope及五维审阅。初次记录解析误按TAP格式判断，而Node默认为spec报告，脚本在真实根或Case创建前退出；按现有11通过结果修正解析后才启动M1，未重跑测试或消费请求。没有产品代码、Skill、SDK、Agent Loop或冻结方案变更，未重复完整离线回归。

业务根：`E:/AgentWork/acceptance/manual-goal-console-v2-20261026`。私有证据：`E:/AgentWork/validation/personal-agent-manual-goal-console-v2-live-20261026`，包含request-01～29/response-01～29、逐Case Console/审计/五维评分、进程退出、Token/预算、恢复及Session/Checkpoint核对。closed-state-copy与原已停服业务根84个文件逐字Hash一致，原始根不清理或续跑。Hash总表SHA256SUMS.txt及root-sha256.json保留。

- 源码Hash：`6730f140c468b9b4e4a0a13208d6aba7ad796d2c6dcb77af4d45a51127a68c16`。
- v2冻结方案Hash：`4121217f6bea9f47867a4d711913a74c9befee9c7d2e4548ebd2cd561f5d6722`。
- SQLite：`29d5f819cb2ea43038877f618475fa5861c4ef39beb8f14b8b17b58d68b27c3d`。
- 原生Chat Session：`40d5b1b688ac577ba24f0cabec79867cc0544fa9af3406d629000a8844b9d2e3`。
- 已关闭预算账本：`c4285440f81ea168bedba945f81e3237f7e91fdb3724848efeb2b3007ea02786`。

299个原跟踪文件在报告更新前全部Hash一致；792份历史证据及8个其他工作树保全核对通过，包括原main3份文档及E盘8项修改。仅新增本报告、[机器JSON](manual-goal-console-v2-live-acceptance.json)及更新当前STATE；不提交、推送、合并或修改正式数据。旧P1/N1、旧M3失败与R2/S1/N3限定成功不改。

## 个人试用建议和剩余范围

**建议直接进入有人监督的低风险Console个人试用，不以M5/M8非安全措辞为由再建设准备入口。** 用经审查的本轮固定版本和现有普通Console，新独立数据目录，先限资料明确、纯文本、单Step、人工审批且一次继续一段的目标。只在新进程显式开启Goal，Skills/Web/Proactive/Formation继续关闭；以权威宿主输出和Checkpoint判断进度，遇交付/状态/权限不一致即停。无需先合并main或部署。本次不实际开启试用；其费用和正式启用由用户另行决定，不复用本轮余额。

当前没有发现阻断上述限定试用的宿主或持久化缺陷。但这只是一个虚构目标样本，不证明任意任务计划质量。P1/N1过度澄清、任意自然语言理解、执行中暂停/取消竞态、异常/崩溃恢复、Web/Skill/Goal联合、手机和主动执行真实验收仍有缺口。M5/M8原始模型解释质量保留开放，不能据此宣称通用语义可靠。交付后停止，不自行修复、另建方案或再次收费。
