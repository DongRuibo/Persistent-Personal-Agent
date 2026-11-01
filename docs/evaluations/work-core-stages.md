# 2B、事件订阅与关联回忆：整体离线交付

2026-11-02。R4已获**正式独立第1轮PASS，无finding**，R3 P3已关闭，见[独立报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/review.md)；本批批准的隔离实现与离线验收交付完成。本报告中的验收身份与Hash对应提交前基线`91b7a657ddf62cf625c53f7bcfbddaa22aa6740b`。用户已授权发布分支`codex/work-core-stages`按2B、事件、Recall三阶段提交、推送及创建一个以main为base的PR；实际SHA/PR以Git及本机release artifact为准，不在报告预写成功。未授权合并main或正式启用。机器摘要及全部变更逐文件目的见[验证JSON](work-core-stages-validation.json)。

## 最终行为与范围

2B只在用户显式请求后形成建议/澄清，确认才经原WorkJob入队。来源观察许可、主题订阅与独立Policy执行许可分离；首轮只建基线，后续合格事件经原Policy/Grant/GoalRunner续同一Goal一个无工具片段。Recall只在主题页显式“查找历史”读取原对象及有权committed成果，歧义先候选、文件只原审批入口、背景默认不读；不自动拼进Chat/Guard，不新增模型或保存长期记忆。

WORK_ROUTING_ENABLED、WORK_EVENTS_ENABLED、WORK_RECALL_ENABLED均默认false，依赖原本机Web/WorkThread；原Task、Goal、Run、Session、Memory事实源及原权限保留。无新增依赖/SDK改动；未扩展联网Worker或多Worker并行。开关及操作说明只维护于[README](../../README.md)。

## 正式独立gate与历史证据

| 阶段 | 已有正式结果 | 报告 |
| --- | --- | --- |
| B1 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b1/reviewer-r1/review.md) |
| B2 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b2/reviewer-r1/review.md) |
| B3 R1 | blocked; R2 closed | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b3/reviewer-r1/review.md) |
| B3 R2 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b3/reviewer-r2/review.md) |
| B4 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/reviewer-r1/review.md) |
| E1 R1 | blocked; R2 closed | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/e1/reviewer-r1/review.md) |
| E1 R2 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/e1/reviewer-r2/review.md) |
| E2 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/e2/reviewer-r1/review.md) |
| E3 R1 | blocked; R2 closed | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/e3/reviewer-r1/review.md) |
| E3 R2 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/e3/reviewer-r2/review.md) |
| E4 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/e4/reviewer-r1/review.md) |
| Recall R1 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r1/reviewer-r1/review.md) |
| Recall R2 | pass | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r2/reviewer-r1/review.md) |
| Recall R3 | pass; P3 snapshot resolved in R4 | [原报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r3/reviewer-r1/review.md) |
| R4 最终R1 | PASS，无finding；R3 P3关闭 | [独立报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/review.md) |

B3首次恢复状态问题、E1许可审计脱敏问题、E3两项审批UI问题及其红证据保留，各经第二轮关闭。R3非阻断P3“R3尚未实施”当前快照已在本卡移除。R4独立最终第1轮已通过，无阻断或非阻断finding；本次只更新文档实际结论并重算终diff/Hash，交原Reviewer核对，不新增正式修复轮。

旧[2B评估](work-router-2b.md)及[事件评估](work-events.md)保留各自644/680与实际浏览器版本，不作为当前Recall全量，也不相加。E4原两Goal各2个后续事件、Plan换版/丢响应/暂停撤销等冻结证据复用，本卡聚焦Recall的真实DOM。

## 当前工程、失败与版本

最终`npm run typecheck`、`npm run build`、`npm run web:build`、`TMPDIR=/private/tmp npm test`均exit0。Node实际spec报告730/730、失败/取消/跳过0，68803.871333ms；四份命令JSON逐项保存234工程文件Hash。Web构建仍2条既有lucide警告。

首次预览证据采集readdir类型错误按明确UTF8编码修正。首轮全量729/730失败于已有Policy组件测试：void处理器返回后固定60/70ms并未等待请求/后续context读取；受控180ms慢响应稳定复现相同disabled断言。仅测试helper改等原请求按钮真实busy结束、保留断言和慢响应，6/6定向通过；产品审批/按钮机制未改。

随后全量730/730（73095.630041ms）对应修key前版本。真实390归档时又发现WorkRecall/WorkEvents同级key相同导致面板重复，仅给两者稳定key加各自前缀，仍按主题卸载；修后实际归档/恢复均仅1个面板，原文/背景/模型不变，再以最终四项检查通过。未写源码镜像测试，不用旧结果覆盖新代码。

Reviewer独立9文件关键回归84/84、exit0、0失败/取消/跳过、4806.622125ms，原始[TAP](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/critical-regressions-loopback.log)与[命令](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/critical-regressions-loopback.json)留存。首跑沙箱51过33失败均listen EPERM，最小loopback权限重跑同组通过；未重跑全量或构建，84不与730相加。

纯本地`npm run eval:memory`仅运行一次，exit0、offline-lexical、模型0调用；三集Top1为9/12、17/19、17/18，漏召回仍在，成功退出不代表全命中。该次在key修复前，Memory/Recall后台与评估脚本未变；不新增语义优化或真实模型验收。

## 实际Chrome与分类计数

同一最终合成库，1280×900主题A、390×844主题B，各明确许可独立GitHub loopback来源→baseline→订阅→独立完整Policy→后续新事件→原Goal合法committed→显式“上次GitHub更新”→原来源/原Goal/技术Run。全部主题查询先显示A/B候选，选择B后才给B成果；B变化期间A的Goal、Execution、Grant逐项相等。

最终模型HTTP：Goal2（每主题1个新事件）、Chat2（正常及全部新开关关闭各1）、显式Job1，Router/intent0，共5；Goal tools均0。来源HTTP7（commits5/compare2）；Recall18次，0新增模型/授权。总Execution4另含2个零模型Plan初始化，不能说4次Goal模型；两个pending Task是合成旧记录，未执行。初始独立预览实例无浏览器闭环、模型/来源/Recall均0，不与最终实例相加。

默认背景的16次Recall均0 Memory list，显式A/B背景各1次并只返回所选主题有权记录；正常WorkThread元数据亦可能读Memory，不能把总list13都算Recall。remember/update/forget均0，合成Markdown Hash不变。旧Run中文/emoji/引号/反斜线原文显示4001/13100字节并明确截断；空query候选、空来源、不可用ID、归档历史、Job旧成果、坏事件Hash失败关闭均有实际DOM。2300字节查询按钮禁用；长SHA/ID/JSON的Worker实际scrollWidth读数为桌面1280、窄屏390，原始数值仅保存在CUA工具回显，browser-analysis.json是汇总；保存的截图/DOM本身不能独立证明该数值。最终console error/warn0；390px不是手机。

Recall文件结果仅操作ID、不含正文或批准Hash。显式打开原文件审批页后出现1条既有web_render_ack，未点击确认执行、文件仍pending；主动进入Chat历史及两次回复正常呈现另8条ACK，**不是全库ACK0**。最终稳定只读窗口`all-off-chat-after.json`→`final-readonly-after.json`中17张业务表、Markdown Hash、模型/来源HTTP完全相同，0新增ACK/控制/Memory保存；该窗口含再次显式Recall及原Run只读。早期A前快照仍running，随后原Runner正常settled，该段不声称全表零变化。

完整刷新/离开主题清空查询，不自动重查。全部新开关关闭隐藏入口而普通Chat可用，恢复不补执行旧事件；同PID30936内运行时关闭/重建Store、Memory、Executor、Server并重开库后原成果可读、无额外授权/模型。此为运行时重建，不是浏览器真实OS进程重启；最终全量中的`tests/source-events-process.test.ts`与`tests/work-event-policy.test.ts`原实际main子进程恢复证据单列。

## Reviewer独立布局原件

Reviewer复用冻结preview/既有构建，新合成实例进行实际Chrome布局和390归档/恢复复验，原始只读DOM evaluate直接保存为[measurements.json](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/layout-preview/measurements.json)及各*-measurement.json；document/body scrollWidth在1280×900均1280、390×844均390。长中文/emoji截断原文和展开来源JSON可见，[桌面图](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/layout-preview/desktop-source.jpg)、[窄屏图](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/layout-preview/narrow-source.jpg)与DOM齐全；归档/恢复Recall与Events各1，console0。本次仅1次Recall、该次Memory list0、模型/来源HTTP0，普通主题元数据list2另列；没有重跑原两主题Policy/事件全部链，也不是手机验收。自有服务/3端口、tab/viewport及临时根已清理，见[清理原件](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/evidence/r4/reviewer-r1/layout-preview/cleanup.json)。

## 交付原件、清理及未验边界

原Worker的520份已审冻结原件与`reviewer-r1/`均保持不变；本次仅文档结果收尾证据另存`work-core-stages/evidence/r4/final-delivery/`，保存8份审前文档、最终407项Hash/身份、完整57文件diff与仅文档delta。原Worker本机原件根：`work-core-stages/evidence/r4/worker/`。包含405文件起点、最终Hash/身份、完整含untracked与相对R3 diff、各版本真实命令/exit/spec或定向TAP、受控红日志、截图/DOM、原始请求/分类HTTP、合成DB、逐文件目的及manifest。桌面截图`browser-final/final-a-readonly-result.jpg`，390截图`browser-final/final-b-explicit-goal.jpg`；具体路径在验证JSON。

两个自有预览正常stop exit0、9个端口关闭、自建tab217333206关闭、viewport重置，合成DB/Memory保留。清理先被自动审查以临时目录归属证明不足拒绝；补源码精确mkdtemp前缀、本次PID创建记录、UID/时间/inode/realpath后只清理明确集合936根，1194根原已不存在，未处理其他实例。详见cleanup与ownership-proof原件。

未读写正式.env/DB/Memory/Session/备份，无正式开关启用、真实GitHub/收费模型、手机、外网或长期运行；不以mock输出证明抗注入或通用语义质量。确定性逐字/类型/上次GitHub定位不保证自由表达；显式背景可扫描/修复原索引，0知识保存不等于文件系统绝对零写；来源窗口gap保守停留、单后台lane可能延迟提醒、原通知可能重复/丢失，pending/查询只在当前页内存。原Goal暂停/收据解释及Formation真实失败继续以历史报告为准，未被本次离线成功覆盖。
