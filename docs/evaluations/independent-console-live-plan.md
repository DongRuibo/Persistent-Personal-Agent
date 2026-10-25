# P/R/S三个独立Console小规模真实复验冻结方案

2026-10-25（Asia/Shanghai）。**本轮仅准备、实现入口和离线验证，尚未授权或执行真实模型、收费、公网GET。** 产品基线`9ee11ede17be60ee3d9895ad815c555317a461ac`。将来须审查本方案、Case表、入口及对应源码Hash后，再一次性批准下述完整范围。旧真实报告、冻结话术、历史账本及剩余36次均不改、不复用。

## 独立性与目标

全新绝对根目录只保存本轮一份independent-budget.json总账本、固定方案/授权快照，以及P、R、S三个专用子目录。三个子目录各自拥有全新SQLite、Memory和原生Console Session；不是共享Session后清历史。每个Case启动一次原Console主程序，只自动发送一次冻结原话并正常/quit；不接收额外stdin。推荐先P，再R，再S，但组间没有语义通过依赖。

P关闭Skills/Web，仅Goal开启；R仅批准固定interview-practice包，Goal/Skills开启；S仅批准agent-notes 1.0.1，Goal/Web关闭。所有组Proactive、Formation、查询改写关闭，不连接飞书，不读取正式.env或数据，不访问Web。受限read只在R/S可用。Task/Memory工具权限沿用现有Guard；资料不能成为新授权。正式默认开关不改。

每组业务、模型语义失败或已知Case/组额度正常耗尽，只停止本组依赖Case；正常停服且共同安全健康时，其他组仍可开始。整轮额度不足、预算计数损坏、费率、身份、配置/源码、写入、请求/响应留证、进程或未知中断等共同安全故障锁住总账本，全部停止；不清锁、删pending或重置。入口/账本损坏时拒绝执行，不能人工修账后继续本轮。

## 冻结Case（与scripts/independent-console-cases.ts逐字一致）

| Case | 确切输入 | 前置、预期与停止规则 | 预计/最大模型HTTP |
| --- | --- | --- | --- |
| P1 | 帮我分阶段制定青桐阅读计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行当前片段。先拟定待批准的阅读安排，等我确认后再执行正式步骤。 | 空P库与Session，Skills/Web均关闭。真实模型调用goal_manage创建唯一青桐Goal，宿主一次bootstrap产生合法待批准草稿并投递，Plan仍v0，没有正式Step执行或审批。按原话判断创建和初始化是否正确；只有口头计划、未持久化或未展示均失败。禁止插入SQLite造目标；失败则P2/P3不执行 | 4/6 |
| P2 | 查看青桐阅读计划进度 | P1机械状态、真实语义及安全均通过。调用宿主查询，唯一、完整、同可信身份/Console渠道、当前revision及draftHash视图实际投递成功。检查原始模型、宿主最终输出、SQLite和Session，保存本次displayRunId/TTL。失败则P3不执行，不补查看 | 3/4 |
| P3 | 暂停那个学习计划 | P2成功且TTL内（5分钟，不续期）；当前视图必须仍对应P2的成功Run、唯一Goal、revision/显示版本。模型泛称选择青桐，宿主状态paused、控制收据与Session解释一致；Plan/Execution/Checkpoint不变。超时、歧义、错误具名、拒绝/仅口头暂停均失败或未执行，禁止刷新P2补测 | 3/4 |
| R1 | 帮我逐步制定白桦练习计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行单次片段，工具能力由宿主白名单控制。正式计划最多1个Step，使用Skill interview-practice。该Step先依据这些资料出一道题并说明考察点，首次交付必须partial并等待我回答，收到回答后点评并complete。现在先给出待批准计划。 | 空R库/Session与批准的固定Skill；不依赖P或S。真实创建、一次bootstrap、唯一待批准正式Step与interview-practice版本/Hash绑定，新的宿主Step ID区别于bootstrap。草稿完整保留数量和partial等待要求且成功展示，审批前不执行正式Step。失败则R2不执行 | 4/7 |
| R2 | 批准白桦练习计划并继续一段 | R1所有前置通过、已展示草稿仍有效。审批v1并只授权一次正式片段。主Chat必须按当时ToolResult识别排队/运行与旧v0 Checkpoint；不可提前宣称正式题目完成或编造另一题。后台独立Session原生展开已批准Skill、零工具、一次请求，提交partial并投递，等待用户；不回答/继续/取消。原始模型解释与宿主呈现分别评分，不以后来Checkpoint倒推此前回答正确 | 4/5 |
| S1 | 请把下面这段虚构的Agent技术资料整理成简短笔记，说明职责和调用关系，并区分资料中的事实与尚未验证的内容：宿主保存用户授权与Checkpoint；Pi执行当前片段；工具能力由宿主白名单控制。这里只描述了职责，没有提供测试结果。 | 空S库/Session，仅批准agent-notes 1.0.1；输入不提Skill ID/路径。独立评分用户任务完成、原生目录/受限read正常、是否真正自行read、是否有无关旧Goal上下文及未经授权工具/Memory写入。正确完成但不read：任务可通过、自动路由不通过，不强制补调read。此成功不能代替旧B1“Web后选择”或联合Goal验收 | 2/4 |

青桐名称及P1原文不含连续的“学习计划”。P3保留历史原话，不能改名绕过泛称匹配。P仅验证暂停，不含反馈继续、取消或完整生命周期；R2虽然约定将来收到回答后点评，但本轮不发送答案、不执行点评。S只有当前消息中的虚构资料，0公网GET。

## 预算建议与发送前硬限制（不是本次收费授权）

| 组 | 调用链 | 预计/最大物理HTTP | 保守预留硬上限 | GET |
| --- | --- | --- | --- | --- |
| P | 创建Chat/意图/收尾/Goal通常4；查看及暂停各3 | 10/14 | ¥2.31 | 0 |
| R | 创建及审批通常各Chat/意图/收尾/Goal4；额外read循环占既有余量 | 8/12 | ¥1.98 | 0 |
| S | 主Chat自行read后收尾通常2；若不read则可能1 | 2/4 | ¥0.66 | 0 |
| 整轮 | 包括全部Chat、解析、原生工具循环及后台请求，失败也计入 | **20/30** | **¥5**；三组各自上限合计¥4.95，不互借 | **0** |

只用固定`deepseek-ai/DeepSeek-V4.1-Flash`与`https://api.siliconflow.cn/v1/chat/completions`。输入/输出2/8元每百万Token仅为历史高价演算，未在本次核价；执行前必须重新核实[官方价格](https://www.siliconflow.cn/pricing)、当前账号适用输入/缓存/输出和所有额外收费。不明、非固定模型/端点或有未核实附加费即不启动，不探测调用、不换模型。

每次发送前预留`ceil((UTF-8 JSON字节+512)×输入价 + 输出Token上限×输出价)`微元，同步fsync、原子替换后才发送。请求体≤65536字节、输出≤4096；后台另限32768字节、零工具和每片段一次请求。按历史2/8，单次最大¥0.164864，P/R/S分别最高¥2.308096/¥1.978368/¥0.659456，整轮最高¥4.945920。新价更高时仍按原人民币硬闸拒绝，不扩额。保守预留不是供应商账单保证。

Case/组/总闸同时生效，每Case跨进程只开始一次；新Run、新Session、重启、失败或不确定均不退额、不清零。独占总锁防组间并发；新scope拒绝旧账本，根目录/模型/计费/源码/方案/Node变化拒绝续测。未完成Case、预算pending或残留锁阻止整轮；正常结束才能继续另一个独立组。任何GET、其他URL或非模型POST都在传输/DNS前拒绝，不注册web_get或提供Web传输回退。

## 四类证据与独立评分

1. **模型行为**：冻结原话、原始request-NN.json/脱敏response-NN.txt、工具提议/参数/结果及原始最终回答。R2保留触发正式Goal请求前的Chat收据与原始回答时间顺序；以该请求实际收到的Plan/Step/Run和提交/投递状态评分。原文错误不删除，不追加模型纠错。
2. **宿主操作**：Console stdout/stderr/退出码、goal_control、当前唯一视图与真实delivery_succeeded、Skill目录版本/Hash、skill_activated/read拒绝、原生/skill展开和实际工具白名单。模型说“保存/完成”不算持久证据。R的宿主正确覆盖与原始模型理解各自判定；未知投递不能推断已成功。
3. **持久状态**：每Case前后只读SQLite、Goal/Plan/Step/Execution/Checkpoint/inputHash/前驱、Run Events/model_calls、host-goal-result-v1和同Console Session。P3保存P2视图expires/displayRunId/版本核对；暂停不新增Execution，R审批只推进一次；S无Goal历史、无Task/Memory知识写入。Skill升级/禁用/Hash不符的拒绝复用已有离线反例，不在真实轮故意篡改资料。
4. **预算/网络**：新independent-budget.json每次物理发送的Case/字节/输出上限/保守预留/HTTP状态，实际Token与供应商cost未知记null。固定模型POST与公网GET计数分别报告；本方案GET恒0。记录正常停服、在途Run/Execution、锁/pending/WAL，异常不手工清理。正常关闭后Hash关键文件并只读审计。

入口statePass只是机械参考，S另输出routingObserved；执行者仍需对模型语义、宿主状态、用户任务、路由和非预期工具调用分别评分。它不自动把宿主成功或Mock路由当模型语义通过。P1/P2/R1审阅由获批执行者完成，无需用户每Case批准；只有确认前置真实通过才可向下一Case传`--previous-reviewed`，此参数不是模型能提供的授权。

## 执行前人工项目与未来启动方式

- 先取得一次性批准：本方案6个Case，P14/¥2.31、R12/¥1.98、S4/¥0.66，整轮30/¥5，0GET，Console、新根、固定模型及端点；审查实际Git提交与源码/方案/入口/Case/包Hash。**当前仅授权准备，不能运行以下命令。**
- 当时重新核价并确认账号无额外费；安全注入LLM_API_KEY、LLM_MODEL、LLM_BASE_URL、LLM_PROVIDER=personal-compatible。不在聊天或命令参数放Key，不自动读正式.env，缺配置集中报告，不试连。
- 注入核实后的ACCEPTANCE_INPUT_RATE、ACCEPTANCE_OUTPUT_RATE、ACCEPTANCE_CACHE_READ_RATE、ACCEPTANCE_EXTRA_FEES_CNY=0、ACCEPTANCE_PRICE_CHECKED_AT（24小时内，整轮保持同值）；未知/附加费未明确即拒绝。账号和官方核实记录另存本轮，不沿用旧确认。
- 新绝对根此前不存在，不是原数据/历史验收根；祖先、组目录和账本均不允许链接/junction。使用Node24.19.0、Pi1.3.0及已审查依赖；入口复制新组批准包，P无Skill，R/S互不加载另一包。三个组共用一账本，绝不可分别用三个新根取得三套额度。
- 再运行本入口专项离线限制检查。批准后才能使用模板；推荐P1→审阅→P2→快速审阅→TTL内P3，然后独立R1/R2，最后S1。任一组失败无需改变其他组的冻结输入。

```powershell
# 仅未来获批后；每条命令只自动发送该Case一次。root须同一全新绝对根。
node --import tsx scripts/independent-console-acceptance.ts --authorized --rates-confirmed --case=P1 --root=<新根>
node --import tsx scripts/independent-console-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=P2 --root=<同根>
node --import tsx scripts/independent-console-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=P3 --root=<同根>
node --import tsx scripts/independent-console-acceptance.ts --authorized --rates-confirmed --resume --case=R1 --root=<同根>
node --import tsx scripts/independent-console-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=R2 --root=<同根>
node --import tsx scripts/independent-console-acceptance.ts --authorized --rates-confirmed --resume --case=S1 --root=<同根>
```

P或R组的首次Case也可以作为本轮第一Case创建新根（不传--resume）；后续所有组使用同根--resume。语义失败后的依赖Case不启动；失败Case不得重发。P2视图到P3不得超过TTL，超期记未执行/前置失败，禁止刷新查看。每Case墙钟上限240秒；未知停服/写入/留证异常是共同停止条件，不把重启当免费补测。

## 可以关闭与不能关闭的门槛

P3实际成功才可能关闭历史自然暂停这一限定样本；R2原始模型理解、宿主、提交和投递分别通过才为A2修复提供真实正证据；S1仅验证消息资料上的自动选择，不替代B1 Web后选择。原V3.0.1收据解释及完整Goal反馈/取消/恢复、S0/S1/Web/Goal联合场景、飞书/手机和正式主动执行仍保留未验收项，不能因准备或Mock通过而标为真实通过。本轮交付后停止，等待ChatGPT审查及用户一次性批准，不自动执行。
