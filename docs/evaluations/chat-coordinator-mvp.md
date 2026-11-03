# 单对话总管 MVP：实现与离线验收

日期：2026-11-03。分支`codex/chat-coordinator-mvp`，基线/当前HEAD均`d0cfcbc608ace1a79b9938a8c7a782fa80b5958c`；改动未提交。任务书为[已批准T1—T6](../designs/chat-coordinator-execution-plan.md)。**T1—T6已完成隔离实现与离线验收，T6整体独立R1 PASS，无阻断或新增需行动finding**。真实模型语义、正式启用与发布不在本结论内。机器可读结果见[validation](chat-coordinator-mvp-validation.json)。

仅独立工作树和临时SQLite/Session、虚构文字、localhost假模型/来源。没有正式`.env`/数据、4318、真实模型/外网、收费或Git发布；默认开关继续关闭。新代码迁移只在临时旧库验证，正式数据库与运行实例未切换。

## 实现边界

- 主Chat复用原Pi公开Session/Loop，work_manage无参数；隔离解析只读当前完整原话和有界低信任目录。宿主独立原文块/授权/归属校验，不让模型把专属材料改成shared或用旧focus覆盖显式对象。最多三项，单Frame一次消费，合法局部歧义保留其他明确项；混合写、依赖、超项、来源/权限错误保留原文并明确未启动。
- 原接收表queued先落盘、原子claim建Run，最多八条等待、幂等先容量；唯一新增子项表。稳定根Job、前序/来源Hash，有限补充在原Runner同事务聚合/创建claim/消费；不是新通用调度器。原Task/Goal优先，Worker串行独立临时Session、零工具、一次HTTP。
- 完整来源优先于Recall节选：14KiB冻结输入、32KiB实际HTTP、4096输出token；缺失/变更/超预算不以截断或另一前序替代。Goal只用原committedCheckpoint，控制不旁路Guard/Policy。
- 当前用户行为建立focus，通知/轮询不改；普通交流/歧义可使其失效，明确名称可越过普通最近100列表定位，20对象/8KiB目录不截最近20猜目标。
- 公开custom message/details绑定run边界、custom entry存结束分类，唯一context链临时投影；当前完整原话/工具配对、Guard原prompt、Memory/Web低信任处理保留。普通结构完整纯文字历史最多两轮4KiB，工作只有限目录/当时收据/来源；原JSONL不删除，旧无标记/缺结束只引用。结构分类不证明模型语义正确。
- 新模式只输入/发送，requestId/itemId/jobId/runId区分身份，根请求短标题和真实状态/成果同时间线交付。技术详情收起，文件完整hash ACK与明确decision、Goal/Policy权限保持。结果读原Job/Run，通知失败不重跑。
- 关闭Coordinator不领取协调消息和后继许可，**已提交的普通queued Job若WorkJobs仍开会继续执行**。A6零执行的off阶段明确同时关Coordinator与WorkJobs；不能将其写成单关Coordinator即可暂停Job。

## A1—A10证据映射

以下证据根为`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/chat-coordinator-mvp/`，各组计数不累计。T6最新命令/日志位于`t6/worker/`。

|项|实际证据与断言|限制|
|---|---|---|
|A1|T5 browser三条独立提交和一句三项分开；work-manage单Frame/事务/幂等；context三工作交错真实HTTP。|固定模型不代表真实路由质量。|
|A2|T5最终浏览器屏障A运行时B/普通问答/文章分别9/12/9ms返回接收，首条100ms；延迟4504ms后新草稿保留。|这是当轮localhost样例，不是SLA或费用比较。|
|A3|T6增强[同主题测试](../../tests/work-continuation.test.ts)：A/B共享同主题，各初轮和修改轮均原Runner真实HTTP；独立C真实HTTP成果先提交、通知晚于A查询投递。共5份Worker入站，A2/B2/C1，另一工作材料/成果和C通知不混入续接。|此前同主题初轮由Store合成，旧证据不冒充本次完整HTTP。|
|A4|原续接屏障测试：领取前两修改/资料合并一次，领取后补充不改冻结输入，纯资料0自动请求。|等待阶段只保存收据，不创建可暗改后继queued。|
|A5|T2/T3归属/授权反例、同文错误分配矩阵、负向/引用/假设、越权、Frame/请求重复与8HTTP实际拒绝第9请求。|有界支持结构；不证明任意语言安全或正确。|
|A6|T6新增[真实main第三窗口](../../tests/work-coordinator-process.test.ts)：Job/item已提交而父Chat仍running且第二主HTTP受控未收尾时SIGKILL；协调+Jobs off回读；on原Job一次Worker，旧Chat/解析零重放、同UUID和再次重启不重复。原queued/claimed与后继claim强杀继续保留。|首轮只关Coordinator却期待queued的错误测试假设红日志保留，未修改Runner语义。|
|A7|取消/迟到结果、失败/中断、通知失败、来源缺失/变更和14KiB/32KiB/Hash预算；T5 DOM取消/失败/clarify、通知失败成果仍可读且Worker计数不增。|通知无必达保证，不自动收费重跑。|
|A8|T1旧库前后原文/Run/Job/模式一致；关闭/旧Task/Goal/Memory/Web/Policy与跨渠道专项；Goal和文件短确认、来源入口。|仅临时库迁移；原获准事件链使用模拟来源，不是实网GitHub。|
|A9|T5主Chrome headless 1280×900/390×844：三项交错、修改、查询/停止/成果、刷新身份、草稿/重试/撤回、文件与Goal流程；R1补回WebSources后另做成功/截断/失败只读DOM。|主流程与后补一行版本见下表；不是手机或人工可视桌面。|
|A10|历史FAIL、漏委派样例、真实mockHTTP入站/分项计数、当前未验清单均保留。|未调用真实模型，不报告真实路由准确率/质量/人民币费用。|

T6最终同版专项2/2、全量934/934（69664.73325ms，0失败/取消/跳过），typecheck/build/web:build和diff-check均exit0；精确命令/退出码见validation及外部command-results。构建保留2条既有lucide模块指令警告。此前ma闭包窄化类型红和修复前934绿另存，不累计、不把旧类型红当成功；最终独立R1已通过，实跑结果见下节。

## 浏览器版本与请求数

|组|源码/性质|实际记录|
|---|---|---|
|T5主流程|main.tsx `193a831a…`，统一交付/草稿/详情完整版本，尚遗漏来源入口|Worker与Reviewer分别真实headless主流程通过；16请求/13Job，47假模型HTTP=主26+解析10+Worker11。不能据此称当时来源入口通过。|
|T5 R1独立补充|同一主流程版|实际满8queued、第9条429草稿保留、撤回后同UUID重试、运行补充一后继；20假模型HTTP=主15+解析3+Worker2，独立分组。|
|T5 fix-r1/R2|main.tsx `cf8ed86e…`，仅新增原WebSources一行；测试host另增回归|Worker与Reviewer各自3条普通网页回答成功/截断/失败DOM，通过原Run GET显示来源/节选/失败，展开重开/390刷新不重搜；各6假模型HTTP/3mockSearch。未机械重跑47HTTP主流程，不把旧版全链写成后补版全链。|
|T6|生产源码沿T5 R2，无业务增量|A3/A6仅补强测试，原DOM分组证据复用；最终类型/构建/全量以本次记录为准。|

专用Chrome profile由mkdtemp创建，CDP仅回环、use-mock-keychain及禁后台联网等测试参数；用户Chrome Cookie、4318、真实资料未使用。截图、动作、实际HTTP/SQLite和来源/构建Hash、退出和端口关闭在各冻结目录。初轮驱动选择器/轮询/端口/证据导出竞读失败保留，不当成通过。

## 历史与本次验证边界

- 从d0cfcbc隔离建立后最初按清单带入6文件：operation-guard.ts、goal-no-intent.test.ts、STATE.md与三份designs文档。Guard带入修复把有效none作为非执行工具结果保留普通Chat，不产生Goal宿主收据或放开其他写权限；后续T2/T3在同Guard最小增加工作Frame/focus，原修复未回退。最初复制Hash和最终全批逐文件目的在T6外部交接，不将带入内容都算成新总管功能。
- T1 R1 PASS；T2原R1—R3 FAIL后按用户明确恢复、R4 PASS；T3原R1—R3 FAIL/暂停后用户明确追加一轮、R4 PASS；T4 R1 PASS；T5 R1 P2 FAIL、补一行后R2 PASS。原失败、payload、暂停与追加授权记录均保留，未换名字抹除。T6整体独立R1 PASS，原始报告与验证组见下节。
- 本批仅离线确定性机制；真实模型选择工具、原文分配与消歧成功率、成稿质量、真实费用/延迟、实际手机和长跑未验。漏work_manage时可能只长答而没有Job，宿主没有宽泛关键词兜底，未虚构承接。保守原文边界不能证明任意语法；前置共同约束可shared、局部尾随限制保留own quotes，无法证明的后置跨项限制澄清。
- 正式迁移、启用、运行实例切换、Git暂存/提交/推送/PR/合并、真实网络与收费未执行。旧正式试用失败和Formation/事件历史验收仍按各自日期/版本记录，不被本次离线绿灯覆盖。

## 最终独立审查与交接

[独立T6 R1报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/chat-coordinator-mvp/t6/reviewer-r1/review.md)：PASS，无阻断或新增需行动finding。Reviewer核对完整45文件diff、最初6文件带入、原日志与分版本浏览器，并独立运行A3/A6 2/2、跨模块188/188、新模式旧Task/Memory正向1/1、原Policy两组2/2，全部exit0；各组不累计。新模式下Task创建/查询/取消与重开Memory保存/检索共17次localhost假模型HTTP，事实源正确，不代表真实模型回答质量。

审前后426文件、Git身份和4018份旧证据Hash一致，T5修复后116个生产文件与当前一致；未机械重复934全量或整组浏览器。报告SHA-256：`dd8c285b4c46ed681b1e258a88c626ca62ea7f2614b6308a16b0dd72e98173de`。Planner核对原日志与结论后只更新STATE、本文件和validation的交接状态；业务代码/测试不变，最终完整diff及45文件目的位于本机`t6/delivery/`。原失败和Worker/Reviewer冻结证据不覆盖。

## 待用户另行批准的手动真实试用

不自动启动或发请求。T6独立已通过；真实试用开始前须另行确认独立临时数据目录、提供商/模型/费率、可接受的人民币上限和停测条件；密钥仅由操作者安全配置，不发聊天。不复用正式库或4318试用Session。

第一小轮只做六条Chat：短问答；一句三项各带不同材料标记；点名查进度；修改面试；其运行中再补一句修改；停止文章。逐项查看真正接收/Job/成果与来源，核对材料和旧成果不串项、草稿/重试及停止结果；工具漏调、澄清、成稿缺陷和费用如实记录，失败就停，不自动追加尝试。纯文字试用关闭网页/文件等非本轮能力。

这组六条Chat最多48次主/辅助HTTP，加三初始Worker和至多两次修改Worker共**至多53次模型HTTP**；53只是在本清单按正确解析且不重试、不扩项条件下的请求数边界，不是费用报价。本批未为总管/WorkJob新增人民币硬额度拦截；常见请求数可能更少，实际费用必须按供应商费率与实际model_calls/token用量核对。尚未查验真实费率，不能把“假模型费用0”推断为真实免费。人民币预算需用户另行明确，由操作者观察用量并决定停测，不能承诺手动观察能卡住硬金额。实际手机/长跑和正式切换另分批授权。
