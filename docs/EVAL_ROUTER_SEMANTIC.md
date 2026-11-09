# Router真实模型语义评测：首批20条

日期：2026-11-09（Asia/Shanghai）。用户在本轮明确批准使用本机硅基流动`deepseek-ai/DeepSeek-V4.1-Flash`，费用预算5元；最多20次HTTP、每次输出≤512 Token、总输入保守预算≤60000 Token、无自动重试。只实现和运行Router评测，不改生产逻辑、不提交/推送/合并。

## 结果与适用范围

| 指标 | 结果 | 分母 |
| --- | --- | --- |
| 模型原始 Routing Accuracy | **16/17 = 94.12%** | 实际请求模型的17条；原始提议先按生产Schema评分，尚未套宿主纠正 |
| 宿主最终路由准确率 | **19/20 = 95%** | 全部20条，含确定性分支 |
| 确定性分支 | **3/3 = 100%** | T01/P05/L07，没有调用模型，不混入模型准确率 |
| API错误 | **0/17** | 全部模型请求正常结束，供应商均报告usage |
| 真实模型条件下Session复用/污染/恢复 | **未测 / null** | 本轮只冻结路由状态并运行Router，不启动主Chat/Worker/真实Session |

本轮退出码**1**，唯一失败U05保留。此次是真实模型、单次、小样本、固定状态的语义评测，不是80条真实模型评测，也不是连续聊天端到端质量或稳定性证明。旧80条Mock的77/80及Session机制指标保持历史原件，不与本轮累加。

## 身份、数据和运行链

- 请求及响应模型ID均为`deepseek-ai/DeepSeek-V4.1-Flash`，端点`https://api.siliconflow.cn/v1`；生产源码基线`ead27a7e19fa99ac7413fceec81e603681192870`，评测起点提交`5f4764db08e82168cc5feb22d9fea77d526ce2be`，本轮工作未提交。
- 冻结计划[router-semantic-pilot-v1.json](../evals/datasets/router-semantic-pilot-v1.json)，SHA256 `51c89c5af30b843e15042f74bc1d1cd7c20e9fc2241d15eb2f9f6d6585482d9c`；十类各2条，从原80条选出。选择、gold和新主题范围词在收费调用前冻结，运行后未改标准或生产提示。
- 原样调用生产`routeTopic`与`parseTopicRouteChoice`，用原`SqliteStore`建立独立内存状态，再调用原`freezeTopicRoute`核对逻辑归属。模型请求使用同一Pi公开SDK和生产兼容模型参数：`temperature=0`、`max_tokens=512`、`enable_thinking=false`、零工具、零重试。
- Router提示直接来自生产函数，不另写一份提示。模型只收到当前原话、候选名称/简介/ID、当前主题ID及已有引用元数据，不含expected/gold、Mock答案、Session全文或Memory正文。
- K01/K08只取先前已验证的离线重启后路由状态，本轮没有再次SIGKILL；C05也只测试主题选择，没有实际Memory注入。当前声明不升级为真实模型Session恢复/隔离指标。

## 逐类结果

| 类别 | 实际模型提议正确 | 宿主最终正确 |
| --- | --- | --- |
| N 新主题与日常对照 | 2/2 | 2/2 |
| R 延续旧主题 | 2/2 | 2/2 |
| S 同主题新子任务 | 2/2 | 2/2 |
| T 主题切换 | 1/1 | 2/2 |
| M 同时提及多主题 | 2/2 | 2/2 |
| P 代词与上下文引用 | 1/1 | 2/2 |
| U 不明确与澄清 | 1/2 | 1/2 |
| K 强杀重启 | 2/2 | 2/2 |
| C 跨主题引用与Memory | 2/2 | 2/2 |
| L 多个Session选择与候选边界 | 1/1 | 2/2 |

## 保留失败：U05

当前原话：**“如果以后长期帮我摄影，会怎么开始？”**

- 冻结gold为`daily`：假设讨论可以直接回答，尚未授权创建持续主题。
- 真实模型提议`create`，主题“长期摄影协助”，认为这是新的持续事项，忽略了假设框架。
- 宿主`persistent`检查拒绝该创建，最终为`clarify`，未建立新主题绑定。最终选择仍与gold daily不符，不能将安全拦截计作路由成功。
- 定位：`src/topic-router.ts`的`persistent`拒绝假设许可，`parseTopicProposal`将不合法create转为clarify。模型输入的生产提示已经明确“假设不创建”；本轮不改提示或生产函数追求全绿。
- 此次N08真实模型直接选择daily，符合gold；它在旧Mock中曾被刻意喂入错误create。两类证据不可混为同一条真实失败。

新增主题N01的真实标题为“长期健身计划”，通过预先冻结的范围词“健身”检查；另逐条核对20条输入、原始选择与最终选择。数据集与复核均由Agent完成，尚无独立人工标注一致性研究；范围词不构成通用语义裁判。

## 请求、Token、预算与延迟

- 实际HTTP **17次**，另3条确定性分支；未重试、未使用剩余额度扩展样本，也未调用主回答、压缩、后台Worker或额外裁判模型。
- 供应商报告：输入**6952 Token**、输出**867 Token**；17/17响应有usage，未知响应0。每条输出均≤512 Token。
- 实际序列化正文加协议余量的输入保守预留**34261 Token**，输出预留**8704 Token**，费用保守预留**1.38154元**，均在已批准上限内。
- 费用预留使用输入20元/M、输出80元/M的保守系数，**不是供应商单价，不是实际花费**。SDK兼容模型cost字段为0，不能当作零费用。中国站该模型精确账单单价未确认，实际`cost_cny`保留**null**。
- 已查官方国际站价格为输入$0.15/M、输出$0.60/M，但不能直接套到`.cn`账单；平台公告说明该model ID自2026-10-21起升级到1017。运行只确认响应ID，没有权重版本校验。来源：[官方模型页](https://www.siliconflow.com/models/deepseek-v4-1-flash)、[官方更新公告](https://docs.siliconflow.cn/docs/release-notes/overview)。
- SDK单请求延迟P50 **912ms**、P95 **1395ms**，包括序列化、网络和响应解析；非完整Chat端到端延迟。

## 证据、验证与修改范围

[合成结果摘要JSON](../evals/reports/router-semantic-pilot-summary.json)、[20行CSV](../evals/reports/router-semantic-pilot-results.csv)保留模型原始提议、宿主最终选择及U05失败。

本地`evals/reports/router-session/semantic-live-01/`含manifest、20份逐Case原件、实际序列化请求、收费发送前落盘的`http-events.jsonl`、原始results.json/CSV/report、command.json与verification.json。原始结果SHA256为`1987772469adaf5ca041a83b537c1ebf83466a36d8902700e4d1b48da612c99f`。读取本机配置时只使用模型连接字段和Key；Key未打印或保存，证据扫描未发现其值。

- 新增4项评测器测试，加原3项共7项通过；覆盖预算硬门、原始错误与宿主纠正分开、新主题范围待复核/确定性分母、真实SDK准备模式零网络及请求参数。
- `npm run eval:router:typecheck`、`npm run typecheck`、`npm run build`均退出0；`TMPDIR=/private/tmp npm test` **1142/1142**，0失败/取消/跳过，91042.292042ms。
- 无前端变更，本轮未重复web:build。类型/构建/测试日志在本地`semantic-validation/`；准备模式17个实际payload零网络演练通过后，才运行本批真实请求。

| 文件 | 修改目的 |
| --- | --- |
| `evals/datasets/router-semantic-pilot-v1.json` | 冻结20条独立状态、gold、范围词和批准预算 |
| `evals/environments/router-semantic-model.ts` | Pi SDK真实模型适配、实际HTTP预算、用量未知处理与Key脱敏 |
| `evals/evaluators/router-semantic.ts` | 原始提议/最终路由分开计分，确定性分母和预算预留 |
| `evals/runners/router-semantic.ts` | 准备/真实模式、原Store归属冻结、逐题原始证据及JSON/CSV |
| `tests/router-semantic-evaluation.test.ts` | 4项有意义的计分/预算/零网络验证 |
| `package.json`、`evals/README.md` | 新命令及安全复现边界，默认只准备不收费 |
| 两份合成结果摘要/CSV、本报告、`docs/STATE.md` | 交付事实、保留失败、区分旧Mock与本轮真实成绩 |

生产`src/`、原有业务测试和依赖不改；没有提交、推送、合并或部署。先前Git推送授权仅覆盖提交5f4764d的19文件，不延伸到本轮新改动。下一步可人工复核gold和U05，再另行批准扩大语义样本与连续聊天端到端评测；本轮不自动收费扩展。
