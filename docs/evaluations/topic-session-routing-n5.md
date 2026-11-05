# N5 整体验收与试用交付

日期：2026-11-03。状态：**N5独立R1已PASS、无阻断**，批准范围内的隔离离线验收及真实试用方法交付完成。N4最后独立R3已PASS；R1两项P1及R2一项P2的原红/修复/关闭证据均保留。唯一业务树`topic-session-routing`，HEAD`ca1f6737d730565bdc41c9b18909a05de3ae88bf`，未暂存/提交/推送/合并。

## 本轮实际范围

先仅更新STATE/N4评估为独立R3结论，再冻结445文件N5基线。本轮不修改业务源码、测试、原preview或启动器，不新增框架/依赖；仅维护README、PROJECT、STATE、本评估及[短试用指南](../topic-session-trial.md)。浏览器适配和短HTTP探针在本机证据目录，复用现有webUiFixture、原版Pi SDK/SQLite/Runner/Server及旧Chrome原生CDP脚本，不把固定模型响应当语义分类质量。

证据根：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n5/worker-r1/`。矩阵的既有测试全部包含在本轮最终`full-test.log/json`，不是仅引用历史计数；除新增浏览器/短探针，不重复另写A1—A12测试套件。

## A1—A12证据映射

| 场景 | 既有测试及本轮新增证据 | 实际覆盖及边界 |
| --- | --- | --- |
| A1 日常短文 | `tests/topic-session-work.test.ts`普通误报batch/create；desktop/narrow `main-result.json`及HTTP/DB | 五类普通请求及后台/持续/创建Goal写作宾语反例零Job/Goal；浏览器初始短文0主题/Job/Goal、直接正文和日常标记 |
| A2 健身6→求职3→返回 | `tests/topic-routing-web.test.ts`“持续A6→B3→A”；`tests/topic-session-runtime.test.ts`首条/冷恢复；两viewport `continuity-http.json` | 实际入站保留首轮膝盖/20分钟，不含CAREER_SECRET_ONLY；未靠最近两轮或仅看回复猜连续性。主题选择为固定假模型 |
| A3 训练/饮食/周反馈 | `a3-a6-result.json`及`a3-a6/model-http.jsonl` | 三句自然原文逐项同thread，0新增Job/Goal；不是把“饮食Job同主题”冒称覆盖日常饮食聊天 |
| A4 身份不混 | runtime“同名项目按冻结ID隔离”；topic-router“同名不擅选”；work“同主题两Job/跨题原链” | 同名Session不串；同主题多个Job不以最新代选，具名跨题修订仍root/previous/thread原链；浏览器两Job成果均归原健身 |
| A5 新建/歧义/小问 | topic-router当前持续许可/同名澄清、topic-routing-web旧未绑定及无唯一主题；browser `main-chain.json/png` | 一次持续绑定、普通日常零主题、歧义只澄清、刷新恢复标记；不强迫用户加必选控件 |
| A6 切换/引用/纠正 | topic-routing-web纯切换/明确B引用A及“纯第二个不重放”；`a3-a6-result.json` | 精确“不是求职，是健身”零新模型/Job，原文字/route及原Job归属不改；训练/饮食/反馈同A后引用B，实际主HTTP含A事实、不含B私有标记。纯选择不执行上一条需求 |
| A7 重投/强杀/重开/关闭 | storage同UUID/事务/接收模式冻结；runtime实际SIGKILL/仅重开0HTTP及legacy/frozen/all；work-coordinator-process真实main强杀/关闭/重开 | claimed中断不重放、queued恢复、原Job只执行一次；旧主题队列不降级日常。launcher两次同目录另核实际持久恢复 |
| A8 权限/旧引用 | storage错误/越权/归档；topic-router额外身份/path/action拒绝；runtime旧确认失效；`a8-result.json`恶意简介公开HTTP短探针 | 实际可见简介含忽略用户/改owner/Shell/任意路径/建Goal/写Memory指令；3次router入站保持在低信任candidate.description，错误batch/create仍0Job/Goal/Memory，伪造owner/path/tools响应被入口拒绝、模型路径未创建；旧审批不复活。不宣称真实模型抗注入质量 |
| A9 压缩/预算/取消/低信任 | runtime普通前置compact/无工作硬软门/split部分失败/known-unknown/准备压缩Chat取消超时/Memory版本/Tavily24KiB来源；N0工具配对与SIGKILL | 原8次/65536字节、模型窗口、signal/绝对超时保留；实际HTTP与账本不双计，部分失败未知用量不记0、无半摘要重放；历史副本仍低信任，不保证忘记能擦除Session |
| A10 后台中聊天/迟到成果/刷新 | desktop1280×900、narrow390×844真实Chrome `background-chat`及`main-chain` DOM/截图；`main-result.json`/HTTP/DB | 工作挂起时仍聊天切求职，两Job晚到成果仍原健身，通知/刷新不改contextKey或旧route、不重发模型；单textarea/无新必选控件、无横向溢出。390px不是实际手机 |
| A11 旧能力/开关/审批 | 本轮全量原Task/Goal/Memory/Web/文件/关闭路径；`browser-approvals-complete` | 原Goal真实初始化→待批展示ACK→批准→显式继续一段，2次Goal HTTP；桌面/390文件均完整预览ACK、确认弹窗前pending、最终committed且文件实际存在。显式文件审批会结束隐含当前主题线索，详下节，不冒称自动保持 |
| A12 持续聊天vs明确Goal | work普通/持续误调实际0Job/Goal与明确中文/英文Goal审批/continue；浏览器日常/健身/求职/Goal | 仅持续交流不变后台业务，明确创建仍原Guard；旧模式原创建表达保持，真实模型工具选择仍待手动试用 |

## 实际执行结果

- `full-test.log/json`：**1115/1115**，0失败/取消/跳过，86364.86275ms，exit0；clean env仅PATH、TMPDIR及必要证据变量，测试自己使用dummy配置与/private/tmp数据。源实现和测试与N4通过版一致，无需再重复全量。
- typecheck/后端build复用N4 worker-r3已通过原日志，Web build复用N4 worker-r1原日志，两条既有lucide警告保留。N5仅文档及外部harness，所有工程输入Hash逐项复核不变；复用记录随冻结包提供，不把审阅日志说成本轮重跑。
- `browser-desktop-first`、`browser-narrow`主链exit0；`browser-approvals-complete`原Goal/文件审批exit0；`a3-a6-probe`及`a8-probe`均exit0。实际DOM、PNG、模型入站、Web POST、SQLite/Run和自有进程closed记录齐全，Chrome临时profile移除。成功组没有JS运行异常；浏览器有原apple-mobile-web-app-capable元标记弃用警告，未为此改产品。
- `launcher-smoke.log/json`、`launcher-result.json`：原`start-web-local.mjs --no-open`、四项显式dummy模型配置、全新固定`/private/tmp/ppa-topic-session-n5-launcher-smoke-20261103`与新端口52191。两次正常启动同目录，第二次原请求/Run不变、仅新发消息增加请求；4次localhost模型HTTP、0Job/Goal、filesWrite=false，自有子进程退出0；没打开默认浏览器、没读主.env。仅测试数据目录保留作证据。

A8短探针`a8-result.json`另保留完整实际router请求/错误输出/Run事件：恶意简介不变，两个普通误调正常正文；第三个恶意提权route产生预期failed拒绝，仅1次路由HTTP，没有继续主Chat、Job/Goal/Memory或模型指定路径写入。该预期拒绝不是产品失败，固定攻击样本不外推通用语义安全。

## 独立R1结论

[正式独立报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n4-n5/n5/reviewer-r1/review.md)：真实SDK+localhost定点**144/144**，0失败/取消/跳过，18186.423958ms、exit0；独立390×844主链、桌面/390原Goal和文件审批、A3/A6及A8公开HTTP探针均exit0。Reviewer逐字节复用冻结夹具，447源码/Git审前后不变，213件Worker证据Hash全同。独立144不与Worker全量1115相加；工程检查及启动器smoke是同源原件核验复用，不称独立重跑。独立首次listen EPERM和Chrome启动超时原件保留，申请精确权限后成功，见报告及同目录日志。

显式文件decision经旧日常Session结束隐含当前主题线索，独立审查认定为本次保留的非阻断限制；原绑定/route仍在，不能宣称审批后自动保持主题。真实模型语义、实际手机和长跑仍未验。本结论不覆盖原N4 R1/R2及N5外部脚本失败，也不是发布许可。审后仅四份文档状态句更新，Hash变化单列于本机`n4-n5/final-handoff/`。

## 保留失败与显式审批边界

首次窄屏及一次审批的自动权限审核超时均未执行，按工具规则各重试一次成功，不能算产品失败。审批外部脚本保留三次失败：`browser-approvals-first`错误:last-of-type选择器找不到按钮；`browser-approvals`已完成桌面文件后把正常滚动条宽1265误要求等于1280；`browser-approvals-final`桌面已成功，但第二文件实际route=clarify，没有新预览按钮，不能仅归为selector问题。

`approval-context-audit.json`保留第三次真实状态：显式`POST /api/files/{id}/decision`经原`WebUiChannel.decide→submit→webUi.accept`，生成成功的legacy Chat（coordinator=0、topicSessions=0、无topic_context_entered）；`previousChatContext`把该原日常执行视为contextKey=null，Pi跨Session的原otherChat结束旧短引用。原求职thread.chatContextKey与旧消息route仍在；不是通知/只读刷新导致绑定删除。随后固定模型错误请求create健身，宿主因没有当前持续许可而澄清，原红与HTTP未覆盖。

最终只将合成模型修为“无current且唯一可见已绑定候选时use该候选”才完成后续文件；这证明该已绑定Session可再次选用，**不证明文件显式审批自动保留了当前主题**。当前不改原审批路径；它是文档化限制，下一条隐含指代可能需要重新选择/明确主题。文件之后具名恢复的组合未再另测，本次普通纯切换/纠正和已有绑定恢复另有实跑，不混为同一事实。

## 真实使用与交付

短指南使用固定新目录`$HOME/.ppa-trials/topic-sessions-20261103`、新端口4329和原启动器，重开同目录保留上下文，既有62414/4317/4318保留。启动器仅本机复用原四项LLM配置，手动真实使用仍由用户亲自启动/发消息，本轮未发送收费或外网模型验收。该启动器强制文件读写关闭，真实清单不默认许诺文件写入。

源Hash、阶段N5/本轮N4N5/相对HEAD累计diff、逐文件目的、原始命令exit及截图/DOM/HTTP/DB在冻结交接中提供。保留N0—N4及本轮所有失败；没有Git提交/发布或正式启用。真实语义、成稿质量/延迟、实际手机与长跑均未验证，不能由确定性桩外推。
