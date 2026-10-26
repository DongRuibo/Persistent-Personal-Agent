# 本地 Release Candidate 收敛审查

2026-10-26（Asia/Shanghai）。候选 `b7a87355e4b0bde62833c50de3c47471c4a0ca34`，分支 `codex/natural-pause-prep`；比较基线 `c604565ca507ad9fe14e1cadf945918d14a92668`。

**结论：可以收敛为 Windows 本地 RC，未发现明确阻断合并的源码问题；手动 Goal 适合下一阶段隔离真实体验，仍不属于完整生命周期已验收功能。** 本轮仅离线审查、回归和文档准备，不修改产品、Prompt、Skill或验收入口，不提交/推送/合并，不读取正式.env，不发生真实模型HTTP、公网文档GET、飞书或部署。

## 1. 八个提交与审查范围

| 提交 | 用途 |
| --- | --- |
| aad7edb | 首次正式Step身份、类型化提交失败原因、Web阶段诊断；对应真实失败回放 |
| 7e96d4e | 第二轮分阶段Console入口与冻结预算/Case |
| 4c673e1 | 第二轮真实失败记录，未修改产品 |
| 9ee11ed | A2收据按Plan/Step/Run与时间归属；agent-notes 1.0.1及回归 |
| 0d0725c | P/R/S独立复验准备与额度隔离 |
| 1e20e51 | P1失败、R1/R2/S1成功原始结论 |
| 83733d9 | 新自然暂停前置与原P1计划指标解耦，独立scope；产品不改 |
| b7a8735 | N1创建、N2视图、N3暂停成功；计划质量未通过，保留历史 |

共57文件变化：10项产品文件（9个src文件和agent-notes）、14项测试/Fixture、8个验收脚本，其余文档。只有aad7edb、9ee11ed改变产品实现；其余入口和报告不为产品授予权限。完整diff及逐提交文件清单保存在本轮证据目录。 相对main没有新增表结构或依赖迁移；GoalView仅增加可选投递字段，安全错误码复用既有reasonCode/Run，Web阶段复用Run Events。

| 不变量与实际检查 | 判断与对应证据 |
| --- | --- |
| Pi SDK与Loop | package/lock与基线相同，安装Pi Coding Agent/pi-ai均1.3.0；无vendored SDK/patches、无内部Loop修改。原生createAgentSession、ModelRuntime、loadSkills、read与公开hooks继续复用。已记录安装包文件Hash；本机未找到对应npm缓存包，未联网做上游逐字节比对 |
| Task/Session/Memory | Task Service、Scheduler、SQLite总库、Memory实现、main/config/BackgroundLane未改。Task一次性/取消pending、后台独立Session、Memory仅明确授权写入保留；全量模拟回归通过，不能把词法检索评测当语义全能 |
| 首次Step身份 | 仅首次create、Plan0、sequence1、无旧Checkpoint时，将本Goal bootstrap引用分配为宿主新ID并留事件；模型投影不暴露bootstrap ID。跨Goal、重复ID、后续修订和已完成Step改写仍拒绝，旧Plan不改。见[身份回归](../../tests/goal-initial-identity.test.ts) |
| 审批/CAS/Checkpoint/恢复 | 成功展示+当前身份/渠道/TTL/revision/draftHash后才能审批；一次用户Run只消费一次。领取冻结输入，聚合事务提交；失效/中断保守阻塞，不重放已提交片段。见[Goal回归](../../tests/goal-runner.test.ts)、[收据持久失败](../../tests/goal-receipt-context.test.ts) |
| A2异步收据 | ToolResult、用户展示和Session收据来自同一GoalView，历史bootstrap与当前正式Step分开，排队/运行/提交/投递分别呈现。错误主Chat原文保留，宿主不追加纠错请求。见[A2/B1回归](../../tests/a2-b1-offline.test.ts) |
| Skills | 版本/完整包Hash批准、路径/链接/read额度、无内置read回退保持；agent-notes 1.0.0旧Plan不能静默使用1.0.1，领取前阻塞，无新Execution；Goal固定原生展开，零工具/每片段一次模型。见[Skills](../../tests/skills.test.ts)、[Goal集成](../../tests/goal-skills-integration.test.ts) |
| Web与默认关闭 | 固定资源与先预留后联网不变，诊断只增Run Events；请求本地finish不等于远端收到GET。GOAL/SKILLS/WEB/PROACTIVE/FORMATION/查询改写默认均false。坏快照不重取，策略仍需独立批准。见[Web阶段](../../tests/web-read-phases.test.ts)、[端到端](../../tests/console-offline-repair.test.ts) |
| 验收与授权隔离 | src没有导入scripts；Mock预设及statePass只在测试/专用入口中。产品仍由Guard/Service/Store验权，不把机械验收判据作为用户权限。所有真实历史报告/账本不修改 |

## 2. 本次实际离线回归

Windows、Node v24.19.0，使用现有依赖；移除LLM/验收/代理环境配置，未加载.env，npm offline。五项顺序运行一次，未新增或放宽测试。

| 命令 | 结果 |
| --- | --- |
| npm run typecheck | exit0，3.594s |
| npm run build | exit0，1.765s |
| npm test | 492项，489通过/0失败/3跳过，60.375s |
| npm run eval:memory | exit0，64题offline-lexical，真实API0；Top1/Recall@5仍9/12、17/19、17/18，15个无答案样本误supported0 |
| npm run eval:formation -- --output=<本轮新文件> | exit0，开发/留出各30/30，未批准写入0，真实API0；未覆盖历史默认报告 |

本次全量确实重跑R2对应A2错误输出回放/异步状态矩阵、S1对应目录/read/版本绑定与低信任资料回归、N3对应原版Pi+SQLite两种bootstrap状态的真实进程模拟链，以及共享Lane慢Observer/Outbox、Task/Memory旧行为。模拟模型按预设响应不证明新的真实语义成功率；已有R2/S1/N3真实结论引用各自原始报告，不重新收费。

3项Windows跳过：POSIX私有权限位（Windows ACL未验证）、无符号链接创建权限的文件拒绝案例、POSIX SIGTERM/进程恢复组合案例。Docker Linux引擎管道不存在，WSL只有Stopped docker-desktop；没有现成Mac执行环境。未安装/启动环境或远程登录，Linux/Mac未运行。Junction等已覆盖测试通过不能替代这3项。

证据：`E:/AgentWork/validation/personal-agent-rc-review-20261026`，含windows-gates.json、5份日志、formation-offline.json、regression-summary.json、sdk-audit.json、scope-review.json、platform-check.json、candidate/product.patch、保全及Hash清单。首次回归启动定位npm路径失败于执行任何gate之前；随后使用现有系统npm CLI配合固定Node运行五关，未安装依赖、未重跑失败业务样本。

## 3. 功能分级

| 等级 | 功能 | 本地使用边界及证据 |
| --- | --- | --- |
| A：适合低风险本地使用 | 普通文字Chat、Console/飞书既有对话、原生Session | 机制与历史真实对话/重启证据；本轮Windows回归通过。飞书旧能力不代表新Goal飞书已验收，不在本轮连接账号 |
| A | 一次性Task、查询与pending取消 | 历史真实提醒/重启及本轮机制回归；对重要时间仍核对IANA/UTC、宿主任务状态，不依赖模型口头承诺 |
| A | 明确授权的Memory CRUD/只读检索 | 历史手机批准/拒绝/新Session检索与本轮回归；Formation关闭，保留同义检索/历史语义失误限制 |
| A | 已批准纯文本Chat Skill的低风险使用 | S1在消息内资料上自主read agent-notes1.0.1并完成整理；仅受管包/受限read，不保证每次自动选择，不开放外部取数或写入 |
| B：可作隔离候选，正式启用前待验 | 手动Goal、interview-practice与状态收据 | R2真实批准后独立Skill片段/partial/投递通过；N3静止waiting_user暂停通过。可进入清楚目标与素材的隔离Console完整体验，不能据此全量启用正式Goal |
| B | Chat固定只读Web | B1一次固定GET及快照/正文入模型通过；首次W1超时和B1未自动选Skill仍保留。只在另获网站授权时使用，本次0GET |
| C：暂不启用/核心体验待补 | 开放式或有限资料的泛化计划生成 | P1/N1重复过度澄清、没有proposedPlan；合法partial不等于达成拟计划需求，列P1体验项 |
| C | Goal完整恢复/反馈继续/完成或取消，以及批准后/运行中控制 | 实现和离线链路充分，但缺连续真实验收；N3仅证明无草稿、初始化后静止waiting_user的唯一视图场景 |
| C | Skill+Web快照+Goal联合、Proactive/Observer/Outbox、Formation | 联合链/主动执行主要是本机模拟证据；Formation历史质量缺口仍在。默认关闭，不以本次RC合并授权正式无人值守 |
| C | 任意Shell/文件/Browser/MCP/Sandbox/Computer Use/外部写 | 不属于当前批准产品范围，不能从Skills或历史上下文推导权限 |

A表示有条件的低风险本地可用，不是全面语义可靠率承诺。B不会自动开启，C不阻止A继续使用。README部分“暂停仅离线/未复验”是旧批次边界，当前以本报告、STATE及逐轮报告为准；未来发布可补一条当前限定证据链接，不重写历史为全通过。

## 4. 计划生成体验：P1与N1

[原P/R/S报告](independent-console-live-acceptance.md)和[新自然暂停报告](natural-pause-console-live-acceptance.md)是不同轮、相同创建原话。两次bootstrap均收到完整输入，返回合法partial、无proposedPlan；未发现消息丢失、Schema不支持或Checkpoint失败的证据。

- **确实必要**：任务的具体产物、可用资料，以及关系到安全/正确性且不能假定的核心事实。若要现实书籍的具体章节安排但未提供书籍，询问范围合理，不能编造内容。
- **可后续确认**：仅根据已给的两条虚构职责资料整理初步安排，不需要先知道现实篇目、日历周期、每周小时或偏好。可在计划说明中标待确认，不能变成先执行正式任务的借口。
- **名称歧义**：模型原文把“青桐阅读”解释为篇目/系列，而不是Goal名称；重复样本支持这一行为观察，但不能证明内部推理原因，也不保证改提示必定改善。
- **状态用词**：artifact中的“草稿/框架”不等于持久proposedPlan；实际pendingAction=null。宿主和收据已明确无待批草稿，不能将模型口头描述算计划生成通过。

优先级 **P1体验改进，非本次源码合并阻断**。它阻碍“只给名称或有限资料就先拟计划”的顺滑体验；R1/R2表明目标、资料和验收条件清楚时可以形成/批准计划，所以不应把所有手动Goal判为不可用。

建议下一次最小通用改进仅针对bootstrap说明：区分任务名称与素材；优先以已给资料提出可供审阅的暂定步骤，把非必要偏好放入待确认条件；仅缺会改变产物真实性/权限的核心信息时澄清；partial无proposedPlan时称“初步建议/待补信息”，不能称“已保存待批准计划”。继续允许合理澄清、不硬编码名称/题材、不强迫虚构、不自动补请求。本轮不实施Prompt/产品改动。

## 5. 下一阶段手动Goal体验清单（仅建议，未授权执行）

只开Goal，暂不依赖Skill/Web；使用全新数据库、Memory、Session和整轮预算scope，保留R2/S1/N3已有结论。名称用新的“澄川职责练习”，所有资料虚构。操作面保持普通Console，SQLite/Session只作事后审计，不手插目标。

创建原话建议冻结为：

> 帮我分阶段完成澄川职责练习。只使用以下虚构资料：宿主验证当前用户授权并保存Plan与Checkpoint；Pi每次使用独立Session执行一个text_only片段；工具能力由宿主白名单决定。正式计划最多1个Step。这个Step先根据资料出一道题并说明考察点，首次交付partial并等待我的回答；收到回答后点评并complete。先拟待批准计划，等我确认后再执行正式步骤。

| 顺序 | 输入/操作 | 功能及模型质量 | 持久化/权限验收 | 预计/最多HTTP |
| --- | --- | --- | --- | --- |
| M1 | 上述创建原话 | 正确理解名称、资料与1个正式Step，持久草稿；不无谓追问 | 真实create/bootstrap，Plan0、宿主新Step ID、合法草稿，尚无正式执行 | 4/6 |
| M2 | 查看澄川职责练习进度 | 准确显示草稿/未批准 | 唯一完整成功投递视图，revision/draftHash/TTL有效 | 3/4 |
| M3 | 确认 | 仅批准，不声称片段完成 | TTL内批准Plan v1，旧Plan不改、无新Execution/自动执行 | 2/4 |
| M4 | 继续澄川职责练习一段 | 基于资料出题、partial等待回答，不抢答 | 唯一正式Execution、一次模型、冻结Plan，Checkpoint原子提交并投递 | 4/5 |
| — | /quit，正常退出，再启动同一隔离根 | 不发送新用户话术 | 锁释放；重启不重放片段，Session/Plan/Checkpoint/预算保留 | 0/0 |
| M5 | 查看澄川职责练习进度 | 读取真实已交付题目与partial，不重新出题 | 当前版本唯一视图；Checkpoint/Execution不变 | 3/4 |
| M6 | 暂停澄川职责练习 | 正确暂停/解释 | TTL内pause一次，成果不变，无新执行 | 3/4 |
| M7 | 继续澄川职责练习一段。我的回答是：宿主验证用户授权并保存Plan与Checkpoint，Pi只执行当前text_only片段，工具权限由宿主白名单决定。 | 恢复与反馈合并在同一明确继续请求，点评该回答后complete | 新Execution引用旧Checkpoint，不覆盖旧题，当前Step completed，Goal仍待达成确认 | 4/5 |
| M8 | 查看澄川职责练习进度 | 区分Step complete与Goal未确认 | currentStepId为空、无待批、无新执行，建立当前视图 | 3/4 |
| M9 | 确认澄川职责练习目标已经达成 | 解释宿主完成结果 | TTL内Goal completed，一次控制；不能由模型自行完成 | 3/4 |

“继续”和回答合并，避免为了测试两个词而先空跑一个片段；普通反馈本身不成为新执行授权。若M1仅partial无草稿，在本轮完整生命周期指标中记录未通过并停止，不补答/重拟；旧自然暂停的独立前置不移植为计划通过判据。其他前置、语义、预算或持久化失败均停止依赖步骤，不换题、改名、刷新视图或重试。

分别评分：**功能**（真实操作是否完成）、**模型质量**（题目/点评/解释是否依据资料和当时状态）、**持久化及安全**（归属/授权/CAS/原子提交/重启不重放）。宿主覆盖不能冒充模型原始理解通过。

批准后但未领取的pause、running中的pause与cancel/迟到结果单列安全边界组，不包含在上述普通体验额度。它们仍待真实验证，若未来做真实竞态须另冻结可观察的状态前置、上限和停止规则；当前不靠发更多模型请求碰运气。普通M9选择明确达成，不同时追加取消；取消组另批。

预算建议：9条消息，预计29次物理HTTP，最多40次、人民币保守预留¥6.60、文档GET0；单步最大6/4/4/5/4/4/5/4/4，合计40。按历史较高输入2/输出8元每百万Token、单请求65536字节/4096输出计算，上界40×0.164864=¥6.59456；**只是方案演算，不是当前核价或执行授权**。未来重新核实固定模型/端点/账号输入缓存输出费率及附加费，达到任一上限即停，不复用旧余额。

重要前置：普通`node dist/main.js`本身没有整轮物理请求/人民币持久总闸，环境变量不能制造该保障。下一轮获批后应只复用现有independent/staged发送前预留器和当前Case定义，为普通Console加一个薄传输入口并先离线审查；不用新的通用Harness，不改产品权限。本轮没有实现该未来入口，因此本清单**尚不可作为有硬预算保障的收费启动命令**。

## 6. 合并、平台与隔离启动建议（本轮均不执行）

本地main与origin/main均c604565，候选是其直接后代，左右分歧0/8，Git拓扑支持fast-forward。**本轮完全离线，未重新读取GitHub远端**；执行发布前必须fetch/ls-remote复核main和固定候选SHA，远端变化时重新判断，不强推。

为保持已经审查的候选和证据链，推荐一次快进完整8个提交；两项产品修复不可缺，其余准备/真实记录为同一线性历史，不建议临时cherry-pick、压缩或丢弃报告。未发现需先改代码才能合并的明确阻断。无需建设独立CI平台；后续若获批，可用普通仓库CI跑Windows/Linux。Linux/Mac补回归是跨平台发布及正式无人值守宣称前的门槛，不阻止本地Windows RC收敛。

当前main所在v3-proactive工作树有STATE及两份旧真实报告共3项未提交修改，原E盘保存分支仍有8项；其他4个旧审查工作树干净。**不要在这些脏目录直接merge/pull、stash后遗忘、reset或删除。** 后续另获发布授权时可采用全新detached发布工作树：

```powershell
# 仅供未来获得发布授权后执行；本轮未执行任何一行。
git fetch origin main codex/natural-pause-prep
# 先核对远端main和固定候选；示例以远端main仍为c604565为前提。
git worktree add --detach '<全新发布目录>' origin/main
git -C '<全新发布目录>' merge --ff-only b7a87355e4b0bde62833c50de3c47471c4a0ca34
# 审核diff/无密钥后，非强制推送；远端若已变化会拒绝。
git -C '<全新发布目录>' push origin HEAD:refs/heads/main
git ls-remote origin refs/heads/main
```

此方法不切换或改写原工作树的分支、HEAD或文件；原本地main仍留c604565和原3项修改，不为“同步本地main”强行更新它。不要额外推送本轮未提交RC文档；若希望将本报告一起发布，应先单独授权审查/提交，重新固定新的候选SHA。

合并后低风险本地候选只用全新目录和当前进程环境；下面仅是配置模板，**没有提供Key，不会由本报告启动**：

```powershell
$rcRoot = 'E:/AgentWork/acceptance/manual-goal-rc-<唯一新轮次>'
if (Test-Path -LiteralPath $rcRoot) { throw '必须使用全新隔离根' }
New-Item -ItemType Directory -Path $rcRoot | Out-Null
$env:DATABASE_PATH = "$rcRoot/agent.db"
$env:SESSION_DIR = "$rcRoot/sessions"
$env:MEMORY_DIR = "$rcRoot/memory"
$env:SKILLS_DIR = "$rcRoot/skills"
$env:GOAL_ENABLED = 'true'
$env:SKILLS_ENABLED = 'false'
$env:WEB_READ_ENABLED = 'false'
$env:PROACTIVE_ENABLED = 'false'
$env:MEMORY_FORMATION_ENABLED = 'false'
$env:MEMORY_QUERY_REWRITE = 'false'
# 未来另行核价、授权并安全注入模型环境；不运行会自动读取正式.env的npm start/dev。
# 普通产品入口为 node dist/main.js；有界真实验收须先接入前述预算入口，不能直接照此收费运行。
```

正式.env、正式数据和默认开关不改变。不加`--feishu`/`--daemon`，不批准Policy，不装外部Skill或联网取文档。普通产品使用本来可能计费，不能把RC合并当新的模型授权。

## 7. 保全与交付状态

本轮开始候选树干净。只新增本报告并更新STATE；没有产品/测试/依赖改动，没有Git提交推送合并。快照保护原E盘分支/HEAD/8项修改、其他工作树、72份旧证据及最近自然暂停31份原件/67份审计证据等；复核结果和Hash见本轮preservation-before/final-verification及SHA256SUMS。

R2、S1、N3仍只按各自真实限定范围认可；P1/N1计划失败、旧失败响应/Session/Checkpoint/账本与冻结话术不改。后续优先审阅本RC结论，再单独决定发布和有界手动Goal体验。交付后停止，不自行修复体验问题或开展新收费轮次。
