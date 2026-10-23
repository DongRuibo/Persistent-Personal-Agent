# 第二轮分阶段Console真实验收冻结方案（待批准）

状态：**仅准备与离线模拟验证，未执行本轮真实模型、公网DNS或GET。** 产品基线为审查固定提交`aad7edbc38da2ee93985e4c10e118283431ea823`；本方案和专用入口还须ChatGPT审查、用户一次性批准预算/固定网站/执行范围。旧32/6方案、原始失败、旧账本和剩余额度不改、不复用。两个非阻断P2建议不在此轮扩展产品实现。

## 分阶段组织与新隔离目录

采用同一个**全新**绝对根目录、一份`staged-budget.json`、同一Console身份与原生Session；新目录内独立SQLite、Memory、批准Skills。不同Case各启动一次原Console main并正常停服，目录、模型、费率、源码、Node和累计账本保持一致。每个Case仅输入一条冻结自然语言；A3/C4为零消息重启观察。入口以专用stdin自动发送原话和`/quit`，不接受额外交互输入，不 Fork Pi 或改产品Console。

A先验证不依赖Web的Goal闭环；B关闭GoalRunner独立验证Skill/Web；C只在A、B全部通过后创建另一个联合Goal。A最后必须取消，因此C使用新目标，不能复活已取消Goal或改写其历史。

正式Goal/Skills/Web/Proactive/Formation默认关闭不改。隔离A/C仅开启Goal与Skills，Web工具关闭、所有Goal执行零工具；B只开Skills/Web，关闭Goal与后台Runner，不能推进失败后残留的A Goal。Proactive、Formation、Memory查询改写全程关闭，无飞书、Observer、Task定时或正式账号。模型和工具不能设置Case、阶段、预算或验收结论。

## 冻结输入、前置与判据

下表输入与`scripts/staged-console-cases.ts`逐字一致；未来获批的执行者直接使用入口，不自行补句、换名或发送额外消息。每次人工证据审阅由获批执行者完成，不要求用户逐步确认。遇到模型要求澄清或计划不合约，记录失败并停止依赖Case，不补答来凑通过。

| Case | 确切输入或动作 | 前置条件 | 预期与停止条件 | 预计/最大模型HTTP |
| --- | --- | --- | --- | --- |
| A1 | 帮我逐步制定青桐阅读计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行单次片段，工具能力由宿主白名单控制。正式计划最多1个Step，使用Skill interview-practice。该Step先依据这些资料出一道题并说明考察点，首次交付必须partial并等待我回答，收到回答后点评并complete。现在先给出待批准计划。 | 新根/空业务库、批准的固定Skill包 | 唯一Goal；一次bootstrap；持久待批准v1恰好1个正式Step，宿主新UUID区别于bootstrap；四个定义字段满足完整意图；interview-practice版本/Hash与批准包一致。无正式Step执行或审批。只有口头草稿、非法ID/数量/绑定、无待批准草稿均失败 | 4/6 |
| A2 | 批准青桐阅读计划并继续一段 | A1模型语义和宿主状态均通过；草稿完整展示/投递成功、Hash和revision有效 | 批准正式v1并只执行一个独立Goal Session；原生/skill展开与冻结正文一致、零工具、一次Goal请求；partial Checkpoint、题目/考察点和等待回答。收到答案前complete、自动续段、漏Skill或仅口头成功均失败 | 4/5 |
| A3 | A2已自动正常停服后，以同根/同Session/同账本启动一次，不发送用户消息，观察至少一个扫描间隔，再/quit | A2已成功提交partial且waiting_user，无ready/running授权 | 零模型/零Web；Session、Goal/Plan、Execution/Checkpoint逐字与Hash一致；预算旧attempts前缀及消费一致，仅增加Case起止审计。任何自动执行、清空额度或改写历史均失败 | 0/0 |
| A4 | 查看青桐阅读计划进度 | A3通过；唯一Goal和原Checkpoint仍在 | 宿主从SQLite展示唯一完整、有效版本视图并成功投递；工具结果、模型最终解释、用户可见文本、Session收据一致，不能把bootstrap/v0或历史口述当可审批计划 | 3/4 |
| A5 | 暂停那个学习计划 | A4真实展示/投递成功；唯一同身份/渠道视图，TTL内、revision/显示版本一致 | 泛称仍选青桐阅读计划并变paused；无新Execution/Checkpoint，模型能正确解释已暂停。错误具名、错误目标、仅澄清或模型反说未保存均失败；不补发查看或改名 | 3/4 |
| A6 | 继续青桐阅读计划。我的虚构回答：宿主保存授权与Checkpoint，Pi负责单次模型执行；工具能力由宿主白名单控制。请点评这个回答并完成当前Step，等待我决定Goal是否达成。 | A5真实paused；有效批准Plan/Skill和旧partial Checkpoint | 一次新授权和独立Execution，冻结同一Skill版本/Hash，引用A2 Checkpoint，点评仅针对该回答；当前Step complete，新Checkpoint保留前驱，Goal等待用户最终决定，不自动completed。无覆盖/重跑旧成果 | 4/5 |
| A7 | 取消刚才那个学习计划 | A6成功提交并显示同一Goal、有效指代视图 | 正确取消青桐Goal，历史3次Execution（bootstrap、题目、点评）及Checkpoint不变；模型原始最终解释、宿主收据、Console、SQLite、持久Session都正确。不因宿主兜底正确而把模型错误判通过 | 3/4 |
| B1 | 请读取 Pi Skills 文档，并总结加载流程 | A已结束或因语义/产品失败停止；新根也允许只执行B。批准一次固定GET；Model/安全/预算前置均有效 | 当前B1模型自行选择agent-notes并真实受限read；固定web_get；唯一完整合法成功快照，来源/时间/Hash/字节持久；下一真实请求包含Skill正文和低信任Web正文，最终区分事实/来源/未知。漏read、要求额外确认、网络超时/中断、不合法类型均记失败，不重取。仅A历史中read过不能算B成功 | 3/4 |
| C1 | 帮我逐步制定杜鹃资料练习，这是虚构的练习目标。正式计划最多1个Step，使用Skill interview-practice。该Step依据我稍后批准的已获取资料出一道题并说明考察点，首次交付必须partial并等待我回答，收到回答后才点评并complete。现在先给出待批准计划。 | A1～A7和B1的四类证据均通过；A Goal cancelled；B成功同身份完整快照、agent-notes真实read。执行者完成审阅，传入--prerequisites-confirmed | 新的唯一杜鹃Goal，一次bootstrap、一个待批准正式Step及正确Skill绑定；青桐历史不变。旧Goal仍取消。没有手工补造、替换或导入快照 | 4/5 |
| C2 | 将已获取的 Pi Skills 文档第1至8行绑定到杜鹃资料练习第1步 | C1成功、B成功快照仍合法且可唯一选择 | 仅使用同身份/渠道的已有成功快照；实际第1～8行存在且非空、≤4KiB；新草稿完整展示来源资源/版本/时间/全文Hash、行范围/选中Hash/字节、Skill Hash及新审批Hash。范围不足或超限失败，不裁剪、不换行数、不GET | 3/4 |
| C3 | 批准杜鹃资料练习并继续一段 | C2成功展示，最新draftHash/revision有效 | 批准新Plan；Execution同时冻结interview-practice及准确的第1～8行，inputHash匹配，Goal独立Session零工具/一次模型请求，不注册web_get；partial成果、来源/未知和Checkpoint正确，等用户反馈；旧Plan/青桐Goal历史不变 | 4/5 |
| C4 | C3正常停服后同根重启，零消息观察至少一个扫描间隔，再/quit | C3已提交waiting_user/partial，无在途授权 | Session、Plan/绑定、冻结Skill/Web输入和Checkpoint不变，零模型/GET、无重放；费用/请求累计不变，唯一Web预留仍消费 | 0/0 |

“青桐阅读计划”及A1完整objective均不含连续的“学习计划”。A5保留历史原话，必须处理泛称和具名筛选差异，不能改成“青桐学习计划”绕过问题。名称与资料在本方案中事先冻结。新方案允许Chat读取已批准纯文本Skill用于规划，但不把Chat预读当Goal批准/激活；Goal审批前不得注入Skill正文或执行正式Step。此新定义不修改旧G1“审批前未激活”的原预期或失败结论。

## 预算建议与硬限制（尚未授权）

| 阶段 | 调用链估算 | 预计/最大物理模型HTTP | 保守费用硬上限 | Web预留 |
| --- | --- | --- | --- | --- |
| A | 创建/批准/反馈通常各3次Chat+意图及1次Goal；查看/暂停/取消通常各3次；重启0。Skill读取或原生工具循环差异只占各步已有余量 | 21/28 | ¥4.62 | 0 |
| B | 原生read→web_get→最终回答通常3次；允许原生调用顺序差异，不能重发用户消息 | 3/4 | ¥0.66 | 整轮1次固定pi-skills-v1 |
| C | 新Goal bootstrap4、资料绑定3、批准/片段4、重启0 | 11/14 | ¥2.32 | 0 |
| 总计 | 包括Chat、隔离意图解析、工具后续模型、独立Goal及失败请求 | **35/46** | **整轮¥8；各阶段上限另行同时生效，合计¥7.60，不互借** | **最多1** |

每次模型发送前持久预留：`ceil((实际UTF-8 JSON字节+512)×输入价 + 输出上限Token×输出价)`微元。请求体≤65536字节，Goal更严格≤32768，输出≤4096；不扣缓存折扣、不依usage退额、不自动修JSON。按**仅供演算的历史2/8元/百万Token**：单请求最大¥0.164864，A/B/C分别最高¥4.616192/0.659456/2.308096，总¥7.583744。费用是保守预留，不是供应商账单保证。

模型仍为`deepseek-ai/DeepSeek-V4.1-Flash`，兼容端点固定`https://api.siliconflow.cn/v1/chat/completions`。本轮不联网核价，不声称2/8为当前价格。将来执行前必须核实硅基流动官方最新定价、账号适用输入/缓存/输出价及所有附加费；输入预留采用可能适用的最高价。费率、缓存写入或额外收费不明则停止。不得换模型、扩额或沿用历史确认。各Case余量只容纳原生循环差异，不授权重发、补话术或重试错误。

新账本scope为goal-skills-web-staged-console-v1；严格拒绝旧integrated v2/v3.0.1账本、旧目录、新Run/Session重置、残留锁、未完成.pending、配置/源码/方案/Node/包Hash变化。独占锁后读账本，同步fsync/原子替换后才发模型请求或DNS。失败/取消/不确定均不退额。每Case跨进程只开始一次，不提供续发同Case的选项。A3/C4的模型上限0强制阻止意外联网。

固定Web只允许`pi-skills-v1`及`https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md`。B1预留先于DNS，第二次、其他Case/资源在DNS前拒绝；独立于模型46/8限额。保留10秒总超时、IP/DNS/TLS、代理/重定向、类型/容量等产品检查。旧轮唯一预留和未用24次/剩余费用永不复用。

## 失败、独立继续与机械判据边界

每步都先审阅模型行为、宿主操作、SQLite/Session/Checkpoint、网络预算四类证据。入口的`statePass`只表示部分机械状态通过，**不是场景总通过或模型语义通过**。任一类预期失败即停止本阶段后续Case；不因为数据库正确而忽略模型对收据的错误解释。--prerequisites-confirmed只能由已获批执行者审阅A/B实际证据后提供，模型不能产生该参数；它不是新的用户授权，也不替代源状态检查。C1还会只读核对A已取消、B唯一成功同身份快照且B同一Run有agent-notes读取记录，缺失或失效仍拒绝。

- A某Case因模型、计划或宿主行为失败：A后续不执行；在费率/凭据/安全/账本仍可靠且A正常停服后，B可独立执行。B进程关闭GoalRunner，A留下ready/paused/blocked也不能被B推进；C不得执行。
- A通过、B失败：保留A各项结论；C全部未执行，不重GET，不为用完额度新增A用例。
- A/B通过、C失败：保留A/B结论，停止C后续；不改范围、修快照或重新联网。
- 额度耗尽、费率/身份/源码不符、锁/原子写入异常、凭据异常、调用结果不确定或无法正常停服：停止对应进程并审计；不能用“独立B”绕过共同安全/预算故障。残留锁不自动清除，不把未完成Case改回未消费。
- 原有V3.0.1自然暂停只由A5实际成功关闭；收据解释由A4/A5/A6/A7模型原始最终回答与真实状态一致才可关闭。B仅关闭S0自动选择/read及S1固定资源取数门槛；C才覆盖已批准Skill/Web联合Goal与Checkpoint恢复。飞书/手机、真实主动策略、长期运行、S2等均不在本轮。

## 证据格式与正常停服审计

每Case保存原冻结消息、case起止、模型HTTP序号/用途/工具白名单、request-NN.json和脱敏response-NN.txt、原生ToolCall/ToolResult、模型最终回答与Console宿主最终文本。保留goal_control、goal_checkpoint_committed、skill_activated、host-goal-result-v1，及Goal/Plan/Step/Execution/输入/Checkpoint Hash、控制前后与历史对照。A5核对唯一成功投递视图、身份/渠道/TTL/revision/显示版本及泛称/具名交集；不能以模型selector本身代替授权。

B保存web_read_reserved、web_read_phase、失败/成功快照及同一Run的Skill读取证据；逐项列DNS开始/通过、TCP、TLS/IP、本地request_created/request_finished_local、响应头/正文/完整结束。req.end或本地finish不证明远端收到GET；若只有不完整阶段，实际发送数据实保持区间，不能猜测。快照完整保存与模型收到的有界节选分别记录shownBytes/excerpt；模型不能把节选说成完整文档。

每Case正常/异常都记录退出方式、running Run/Execution、锁、pending/WAL状态。入口保存Goal/Plan/Step/Execution、model_calls、Web和Run Events，以及停服后的业务锁/在途计数；执行者另存该次Console stdout/stderr和退出码、WAL大小及预算锁最终释放结果，不为补日志重发Case。A3/C4对比停服前后的原生Session Hash、Goal/Plan/Execution/Checkpoint与预算attempts前缀，不能用仅恢复预算替代Goal恢复。正常释放锁与额度不退款分别记录；通知/发送失败不重跑模型。Token/供应商cost未知则null，物理发送、预留、Token估算、实际账单分列。完整性及外键检查仅针对本轮新库，不打开正式或历史库。

## 将来获批后执行前必须完成

1. ChatGPT审查本方案及入口固定提交；用户一次性批准A/B/C范围、最多46次模型HTTP、¥8保守预留及一次固定GET。当前消息仅批准准备，不是上述费用授权。
2. 在本机安全注入LLM_API_KEY/LLM_MODEL/LLM_BASE_URL及LLM_PROVIDER=personal-compatible；不从正式.env自动读、不在命令参数或聊天中放Key。若届时确实缺配置，集中说明安全注入方法，不能自行读取完整.env。核价后注入ACCEPTANCE_INPUT_RATE、ACCEPTANCE_OUTPUT_RATE、ACCEPTANCE_PRICE_CHECKED_AT；确认无未知附加费。
3. 核对批准Git/source/entry/cases/plan/包Hash、Node版本；再次离线验证入口与旧账本隔离、容量/次数/费用/一次GET/跨重启限制。新根事先不存在，避免正式及历史路径、链接/junction；全程一个根、一个新账本，冻结authorization.json和方案副本。
4. 用原版Pi SDK、只批准仓库内两个固定包，保持正式开关关闭；无任何收费或网站“试连”。启动后逐Case按预期审核，不为探测连通性额外发请求。

以下仅为**将来获批后**的启动模板，本轮不运行：

```powershell
# 使用Node24.19.0；配置仅安全注入环境变量。先完整审阅批准，不把本模板当授权。
node --import tsx scripts/staged-console-acceptance.ts --authorized --rates-confirmed --case=A1 --root=<全新绝对目录>
# A2/A3/A4/A5/A6/A7依次各执行一次，前项任一类失败即停止A后续。
node --import tsx scripts/staged-console-acceptance.ts --authorized --rates-confirmed --resume --case=A2 --root=<同一目录>
# B可以独立继续；仅B1显式开放这一次GET。模型与Web预算仍同一本。
node --import tsx scripts/staged-console-acceptance.ts --authorized --rates-confirmed --web-authorized --resume --case=B1 --root=<同一目录>
# 只有A/B四类证据全部通过，执行者才可加此审阅声明；无需再向用户逐步索要普通批准。
node --import tsx scripts/staged-console-acceptance.ts --authorized --rates-confirmed --prerequisites-confirmed --resume --case=C1 --root=<同一目录>
# C2/C3/C4依次使用相同入口/目录和--resume，不再传Web许可、不发送额外原话。
```

入口会自动发送该Case冻结原话并等待本轮前台/Goal片段结束后/quit；Case墙钟上限240秒。机械不通过退出码1仍应区分正常释放资源与崩溃。A4→A5及A6→A7须在5分钟视图TTL内；过期就记失败，不刷新视图补测。完整轮执行无需小Batch再次授权，但不能消耗未经批准的新预算。
