# 独立自然暂停Console复验冻结方案

2026-10-26（Asia/Shanghai）。基线`1e20e51145b4f2c422bbb7a918cb52f771f01ade`。**本轮只准备与离线验证，没有真实模型、费用或公网访问授权。** 未来须先审查实际提交/源码及本方案Hash，再取得新的完整执行授权。旧P1/P2/P3方案、Case判定、原始数据、Session及账本不修改、不复用。

## 唯一目标与隔离

只验证一个通过真实自然语言创建、已持久化且可以合法暂停的Goal。目标名仍为“青桐阅读计划”，不含连续“学习计划”；暂停保持历史原话。N1/N2/N3复用旧三句输入，但使用独立方案、新scope与新数据，**不是旧P1改判或补跑**。

只用Console，全新绝对根目录及其`P/agent.db`、Memory和原生Session，一份`independent-budget.json`，scope=`natural-pause-console-v1`。旧PRS scope必须拒绝，禁止迁移、克隆旧库/Session/账本或清零续测。根及祖先禁止链接/junction。仅测试进程开启Goal；Skills、Web、Formation、Proactive、查询改写关闭，无read/web_get、后台text_only零工具。正式开关和数据不变，不连接飞书。

## 冻结Case、前置及停止条件

| Case | 确切输入 | 前置与预期 | 预计/最大物理模型HTTP |
| --- | --- | --- | --- |
| N1 | 帮我分阶段制定青桐阅读计划，只使用以下虚构资料：宿主保存授权与Checkpoint，Pi执行当前片段。先拟定待批准的阅读安排，等我确认后再执行正式步骤。 | 空数据/Session；主模型须通过goal_manage真实创建唯一Goal。等待唯一bootstrap正常结束，Goal属于local-user/Console，Plan v0、waiting_user、无控制请求/阻塞/ready授权，唯一Execution committed且Checkpoint归属一致。允许complete+合法草稿，也允许合法partial+无草稿；计划生成结果另记，不虚构或手插Goal。未创建、未知执行、非法结果或共同安全异常均停止，不补答 | 4/6 |
| N2 | 查看青桐阅读计划进度 | N1创建/持久/停服及模型语义已审阅通过；不要求正式草稿。真实查看且唯一完整视图成功投递，同可信身份和Console，当前Goal revision及可选draftHash相符；displayRunId必须为本次N2成功交互Run、有delivery_succeeded，TTL有效。不能从模型声称“已展示”推断成功。失败停止，不补查看 | 3/4 |
| N3 | 暂停那个学习计划 | N2成功、未超过5分钟TTL，仍为同一唯一完整视图，revision/draftHash/displayRunId/身份/渠道均有效；Goal仍处于静止waiting_user，无在途、不确定结果或共同安全故障。模型须正确指向该Goal，宿主按原Guard执行一次pause，Goal变paused，原计划、pending草稿、Execution与Checkpoint不变，无新执行授权。模型解释和宿主状态/收据独立评分；错目标、仅口头暂停、拒绝、过期、歧义均不通过，不刷新/补发 | 3/4 |

此轮为了排除异步结果竞争，仅涵盖初始化后已静止的waiting_user。没有把paused、终态、ready/running或不确定执行作为本方案可继续前置；产品对其他合法状态的控制语义不变，批准后/执行中暂停仍未验收。bootstrap可能提出必要问题，**不回答该问题也可暂停真实存在的Goal**。未生成正式草稿不代表已完成计划生成指标，亦不能声称待批准计划存在。

## 宿主前置与原授权校验

新前置只判断验收是否可继续：唯一持久Goal、原文目标和当前可信归属、Plan v0、合法committed bootstrap、当前Checkpoint一致、无在途及安全故障。N2还必须有当前成功投递视图。N3仍走原版Pi、原goal_manage、OperationGuard、GoalService和版本CAS，不把脚本通过当作新的产品操作授权。

泛称只在原Guard的唯一有效展示、具名条件交集规则内成立；错误具名、过期/未投递视图、跨身份/渠道、revision/draft变化、多Goal歧义、终态及模型错选均拒绝。不得删除关键词筛选、伪造Run、扩大暂停/取消权限或手动造目标。查看与暂停不能改写计划、草稿或成果；出现变化按共同安全异常停整轮。

## 请求及费用设计上限（待另行批准）

预计10次，最多14次物理模型HTTP；N1/N2/N3分别最多6/4/4，整轮保守预留最多¥2.31，公网GET为0。包含主Chat、隔离解析器、原生工具循环及唯一bootstrap，错误响应也计入；每Case仅开始一次，不重试、不补答、不追加、不退款，失败或未知不清零。所有未来请求发送前原子持久预留；跨进程恢复锁、pending、未结束Case、配置/源码变化或不确定结果全部拒绝，不人工修账续跑。

只允许`deepseek-ai/DeepSeek-V4.1-Flash`及`https://api.siliconflow.cn/v1/chat/completions`的固定模型POST。所有GET/其他URL在DNS前拒绝，不能用核价不明或其他模型探测。请求体最多65536字节、输出最多4096；bootstrap另限32768字节、单次模型请求、零工具。

历史较高输入¥2/输出¥8每百万Token仅用于预算演算：单次最大预留`(65536+512)×2+4096×8=164864`微元，14次最多¥2.308096，低于¥2.31。此数额**不是当前费率或本次收费授权，也不是供应商账单保证**。执行前须重新核实官方及当前账号输入/缓存/输出价、所有附加费；未知则不联网，更高费用仍按原人民币闸拒绝，不能提高预算。

## 未来执行前项目与启动模板

1. 一次性批准审查后的固定提交、本方案/入口/Case/源码Hash、N1/N2/N3、14次/¥2.31/零GET、固定模型端点、Console和全新根。旧轮余额不复用。本次没有此执行授权。
2. 核实当时官方与账号费率、无额外费用；安全注入LLM_API_KEY、LLM_MODEL、LLM_BASE_URL、LLM_PROVIDER=personal-compatible及ACCEPTANCE_INPUT_RATE/OUTPUT_RATE/CACHE_READ_RATE、EXTRA_FEES_CNY=0、PRICE_CHECKED_AT（24小时内）。入口不读取正式.env；如缺安全配置，另行取得字段提取授权，不展示Key。
3. 固定Node v24.19.0、Pi 1.3.0及已审查依赖；再次离线检查限额。N1先运行、正常停服并审查创建/结果归属；N2后及时审查唯一视图，TTL内直接N3。人工审阅由已获整轮授权的执行者完成，不需要每Case重新申请普通批准。

```powershell
# 仅未来获批后；同一全新根，三Case各一次，不发送额外stdin。
node --import tsx scripts/natural-pause-console-acceptance.ts --authorized --rates-confirmed --case=N1 --root=<全新绝对根>
node --import tsx scripts/natural-pause-console-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=N2 --root=<同根>
node --import tsx scripts/natural-pause-console-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=N3 --root=<同根>
```

## 证据和判定

- **模型**：冻结原话、全部原始request/response及工具提议/结果、原始最终解释。N1计划结果（complete/partial、是否草稿、澄清问题）与Goal创建分别记录；N3自然指代/解释独立评分，不用宿主覆盖代替模型理解通过。
- **宿主**：真实goal_manage创建/查看/暂停、唯一目标归属及版本、成功展示Run/投递事件、控制收据。拒绝必须如实记录，不能凭模型自然语言判定成功。
- **持久状态**：每Case前后只读SQLite、Session、Goal/Plan/Step/Execution/Checkpoint及Hash。暂停前后同Goal、revision仅因合法控制递增，原计划/草稿/Checkpoint逐字段不变，没有新Execution/Grant、Task、Memory知识或策略写入。`statePass`仅为机械参考，另记planGeneration和pauseResult。
- **预算和停服**：每物理请求发送前账本、次数/容量/输出上限/费用预留、Token及未知实际账单，0公网GET。进程正常退出后核对锁/pending/WAL和未结束Run/Execution；不清锁、退款或重置。前置超期或失败停止，原始证据及SHA清单保留。

旧P1失败、旧P2/P3未执行、R1/R2/S1真实成功保持原判。新组即使成功，也只验证初始化后非终态Goal的基本自然暂停，不能替代计划生成、批准后/执行中暂停、反馈继续、取消、Web/Skill联合、飞书或正式主动执行验收。交付准备后停止，等待审查和新的明确执行授权。
