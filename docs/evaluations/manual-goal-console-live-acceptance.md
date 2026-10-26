# M1～M9 手动Goal Console真实生命周期体验

2026-10-26，Asia/Shanghai。固定提交`f79f99c6a8d992e59fac513eeb85fb85be5d66a1`、分支`codex/manual-goal-console-prep`。

**本轮未通过，已正常停止。** M1真实创建并形成合法单Step草稿，M2完整有效视图通过；M3宿主只批准、不执行，但主模型原始解释把批准误称为执行排队。依据冻结规则停止M4～M9，没有补答、重试、改题、修复源码或追加请求。不能用机械statePass=true或宿主覆盖正确冒充模型原始解释通过。

## 前置、费率与实际执行

- 使用原[冻结方案](manual-goal-console-live-plan.md)、原Case表及专用入口；固定SHA、干净工作树、方案/入口/源码Hash核对通过。原版Pi 1.3.0，Node24.19.0；没有修改源码、SDK、Skill或权限。
- 重新运行`tests/manual-goal-console.test.ts`：4项通过/0失败/0跳过，含40次/¥6.60、逐条上限、容量、scope/重启、失败不退款及零GET。不是本轮重跑497项全量测试。
- 本轮进程缺少LLM变量，按明确授权逐行筛选正式.env的四个LLM字段，仅内存注入；原Provider=openai按既有兼容端点逻辑映射为personal-compatible。固定模型`deepseek-ai/DeepSeek-V4.1-Flash`，端点`https://api.siliconflow.cn/v1/chat/completions`。未输出、保存或提交Key，未加载其他正式业务配置。
- 自动核价：硅基流动官方模型目录/更新公告可读，国内价格页多次超时，只读浏览器也未成功。不能声称已独立抓取当前国内人民币价格表，也未用国际美元价换算替代。用户随后明确确认本轮在当前官方模型/计费页面核对：输入¥2、缓存读取¥0.04、输出¥8/百万Token，无附加费；低谷分别¥1/¥0.02/¥4。采用较高时段作预留及Token估算，核价来源在机器证据标为本轮人工确认。
- 官方参考：[价格页](https://www.siliconflow.cn/pricing)、[更新公告](https://docs.siliconflow.cn/docs/release-notes/overview)。核价浏览属于执行前核实，不是Agent文档读取；验收进程没有公网文档GET或Web工具。
- 全新数据根`E:/AgentWork/acceptance/manual-goal-console-20261026`；独立scope为manual-goal-console-v1。只开启隔离Goal，Skills/Web/Proactive/Formation/查询改写均关闭，Console固定local-user，无飞书、正式用户数据或历史余额。
- 操作者每次只启动一个Case，将原Case表的一条消息提交给受限stdin；审阅M1后才启动M2，审阅M2后才启动M3。没有九条批量执行或Mock响应。所有子进程均退出0，入口正常/quit结束；语义失败独立记录，不改写已完成的机械账本。

## 逐Case判定

| Case | 判定 | 原始模型与宿主/持久状态 | 实际/上限HTTP | 保守预留 |
| --- | --- | --- | --- | --- |
| M1 | 通过，附措辞观察 | 正确调用goal_manage创建；bootstrap真实partial且带有效proposedPlan，宿主生成新的正式Step ID，单Step草稿持久化并投递；主Chat没有编造正式题目 | 4/6 | ¥0.179032 |
| M2 | 通过 | 正确查询；唯一完整视图实际成功投递，revision=2、draftHash及displayRunId匹配；没有新增Execution | 3/4 | ¥0.149624 |
| M3 | **失败：模型语义**；宿主与投递通过 | 一次approve_plan，Plan v1已批准、Goal waiting_user、正式Step pending，未排队/未执行；原始主Chat却说已排队并暗示后台自行领取 | 2/4 | ¥0.145094 |
| M4 | 未执行 | M3语义失败后停止；未产生正式partial或题目 | 0/5 | ¥0 |
| M5 | 未执行 | 未验证正式Checkpoint停服后的恢复 | 0/4 | ¥0 |
| M6 | 未执行 | 未验证有正式Checkpoint后的暂停 | 0/4 | ¥0 |
| M7 | 未执行 | 没有发送反馈，没有新授权片段或complete点评 | 0/5 | ¥0 |
| M8 | 未执行 | 未验证Step完成而Goal等待确认的视图 | 0/4 | ¥0 |
| M9 | 未执行 | 没有发送完成确认，Goal未达成 | 0/4 | ¥0 |

M1原始Chat准确说明其当时ToolResult是Plan v0初始化、尚无草稿，但附带了冗余的理解确认问题；bootstrap的历史问题也使用“批准后执行”的笼统说法。作为措辞观察保留，不隐藏：本条核心计划生成并未依赖额外回答，实际合法草稿完整形成，故不同于历史P1/N1无草稿的失败。不能据此把旧P1/N1改判通过。

M2视图来源Run为`bfb30a25-7944-48ea-bb6d-7b37de5bfc9b`，实际投递于08:16:37.539Z，视图到期08:21:34.478Z。M3于08:16:59.156Z开始，审批发生08:17:00.388Z，仍在原视图TTL内；没有补查刷新。M5→M6、M8→M9未执行，没有借后续查看制造有效前置。

## M3：必须分开的四个结果

1. **模型收到的真实ToolResult**：`状态waiting_user；版本3；计划v1；正式计划已批准；当前Step pending；当前Step执行未领取`。Checkpoint明确属于Plan v0/旧bootstrap Run，非正式题目。没有continue授权。
2. **原始模型错误**（response-09.txt）：声称“正式步骤还在排队等待执行”，并说“下一步由后台执行器在独立 Session 里领取并交付该 Step 的 first-partial 内容”，让用户等结果后查看。这与waiting_user、readyInputJson=null及只有审批授权不符。没有实际后台排队，不能把pending步骤等同于ready Goal。
3. **宿主及用户可见结果正确**：Console实际发送的是SQLite权威结果：已批准、waiting_user、未领取，未声称新题目已提交。原始模型没有编造具体题目，但错误预测了后续推进。宿主覆盖没有被算作模型理解成功。
4. **Session仍保留两者**：原始错误assistant条目index21保留，其后index22为host-goal-result-v1权威收据。3条用户消息、3份收据，来源/Plan/Step/Run匹配。正确收据并不证明后续模型永远不会误读；本轮没有为此追加请求。

三个前台Run分别为M1 `01de6602-5dde-4af6-a793-02ed91ecd483`、M2上述Run、M3 `3ec34121-8d82-4d8e-8781-e1a66fd590f0`。逐条核对了delivery_succeeded、deliveryError=null、Console日志包含真实Run.output及Session收据。没有仅凭Run.succeeded或statePass宣称用户已收到正确回复。M1独立bootstrap也有单独的成功投递事件。

## Goal、Plan与Checkpoint引用链

- Goal：`dc14569d-fbc7-4c57-8557-d4059f64d9a0`，owner=local-user，渠道Console。M1创建revision0，领取/提交后revision2；M2不变；M3只批准后revision3、Plan v1、waiting_user、readyInputJson=null。
- bootstrap Step：`2f71d506-2138-49bb-8513-545d589a3fcf`，Plan v0；唯一Execution/Run为`6fa5925b-b59c-4a8a-926f-1ae8e7377a41`，status=committed、结果partial、previousCheckpoint=null、输入来自M1创建授权。它包含待批准草稿，不是正式题目或点评。
- 新正式Step：`ccf6dc43-3402-494b-b0b9-b18e0bfd8a8a`，由宿主生成，区别于bootstrap；审批后pending。v0的Step成为superseded，旧Execution和Checkpoint原样保留。
- Plan v1的sourceRun为bootstrap，approvedByRunId为M3前台Run；Hash=`7d0302faab6dbddf8d96143457ee36753059b757b1b62daaf228394b6dd4fd66`。
- 唯一Checkpoint Hash=`8587cb332af3028888eb78bb2dfd1d6f61f05f5cc689c69ef26701d377c3e639`；输入Hash=`832414e45da1d3dec0a1c2086518c8d08d5988637bc26ba5dd9849958f2dd9d1`。M1→M2→M3未改变旧Plan/Execution/Checkpoint；没有第二个Execution，也没有正式反馈引用链可验收。
- 已观察M2/M3恢复同一原生Session及初始化Checkpoint且不重放bootstrap；这不能代替尚未执行的M4→M5正式片段恢复。

## 用量、预算与停服审计

- 物理模型HTTP **9/40**，均HTTP200；9份请求、9份脱敏SSE响应，全部包含DONE标记，与SQLite model_calls=9逐项对应。逐条4/3/2均未超过6/4/4；未借用其他Case额度。
- 保守持久预留 **¥0.473750/¥6.60**，未退款、重置或复用旧账本。剩余31次请求及费用未消费，也不构成下一轮可沿用额度。
- 未缓存输入10,535、缓存读取16,768、输出1,112 Token，共28,415。SSE最后用量与SDK/SQLite分别按缓存口径核对一致；不累计每个流式chunk的递增usage。
- 按本轮已确认较高费率估算Token费用约 **¥0.03063672**。它、保守预留、供应商实际账单是三个概念；实际账单未取得、cost字段null，不推断为确定扣费。
- SQLite integrity_check=ok、foreign_key_check=0：Goal1、Plan2、Step2、Execution1、Run4、run_events51。Task/Memory候选/Formation/Policy/Trigger/Grant/Observer/Outbox/Web/飞书均0；Memory索引0条、Markdown0份。
- 三个执行子进程均正常退出，无本轮Agent进程，无独立账本锁、数据库锁、Memory锁或pending；无运行中Run/Execution。没有清锁、回滚消费或迁移原验收数据。
- 本轮289份已跟踪文件在写报告前Hash均未变；8个其他工作树HEAD/分支/status/脏文件Hash及205份历史/发布证据不变，原main3项、原E盘8项保留。上一轮准备与分支发布的全部Hash清单再次通过。正式.env仅按授权提取四字段，未改文件；本轮私有数据及证据扫描未发现实际Key字节。

## 证据、结论与下一步

- [机器JSON](manual-goal-console-live-acceptance.json)。原始数据在上述新acceptance根；完整私有证据在`E:/AgentWork/validation/personal-agent-manual-goal-console-live-20261026`：M1～M3的console/process/raw-summary/review、full-audit.json、session-audit.json、stop-decision.json及只读closed-state-copy。
- SHA256SUMS.txt和root-sha256.json保全请求、响应、账本、SQLite、Session及本轮证据；artifact-hashes.json记录交付文档和STATE。源码codeHash仍`196169576c10883cfbd0bf820bbdcca7dd79d8daf707eb01b4f462f3b1bec9a3`；方案Hash仍`e5cb419b88ef4c29c50cd3dd00acf009362c2e6b859f92b2e2c2edeb3a7019d4`。没有修改冻结方案或旧真实判定，没有提交/推送Git。
- 确认的问题是M3“批准≠排队”的原始解释错误。bootstrap历史问题措辞和pending标签可能影响模型理解，但只是推测，不能从单轮证明因果。本轮不改Prompt、代码或Skill，不收费重跑。
- R2/S1/N3既有真实限定成功保留。新M1验证了有清楚目标与素材时可形成合法单Step草稿，不证明所有阅读目标的过度澄清已解决。执行中暂停、取消竞态、完整反馈/完成链路及Skill/Web/Goal联合仍未验收。
- **尚不能依据本轮放行完整手动Goal日常工作流。** 宿主审批安全边界和权威呈现有效，但模型仍可能让用户错误等待自动执行；正式片段、恢复、暂停、反馈和达成确认没有获得本轮证据。保留Windows隔离候选及原有基础功能分级，所有正式开关继续关闭。下一步先交ChatGPT审查M3证据与最小收敛方向，费用或修复另需明确授权；本轮到此停止。
