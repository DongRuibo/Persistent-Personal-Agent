# 事件订阅阶段 E4 离线验收

日期：2026-11-02。结论：Worker已完成工程与实际Chrome离线验收，冻结待独立R1；不代表正式启用或发布。机器摘要见[验证JSON](work-events-validation.json)。

## 范围与修改

E1来源事实/E2订阅已通过各自独立审查；E3独立R2关闭审批范围与原请求恢复的两项P2。E4基于其396文件冻结，分支`codex/work-core-stages`，HEAD`91b7a657ddf62cf625c53f7bcfbddaa22aa6740b`未变，仍未提交。

- `scripts/preview-web-ui.ts`：仅离线事件模式增加独立A/B GitHub loopback、真实HTTP分类、可控clock、原合法Web Goal/Plan种子、原GoalResult、stdin推进/换Plan/暂停/重开/丢响应/正常停止及只读证据。
- `tests/helpers/web-ui-fixture.ts`：可选测试runtime组装原GoalRunner，复用clock/proactive/中断/共享lane，重开恢复配置，停止释放；旧调用默认行为保留。
- `web/src/work-events.tsx`与原UI测试：仅P3恢复按钮/提示/注释和测试标签，明确服务器未接纳时会首次提交原冻结请求，已接纳时读取原收据；无新API/表/权限/持久化。
- README/PROJECT/STATE及两份design只更新现状和已实现边界，历史失败与设计批准原文保留。本评估/JSON记录验收，不启动Recall。

## 工程与版本

最终typecheck/build/web:build均exit0；全量680/680，0失败/取消/跳过，66483.317833ms。Web构建仍2条既有lucide警告。原日志为Node实际spec格式，未伪称TAP；追加reporter选项位于test globs之后，未改变报告器，真实命令保留。

首轮680/66239.801542ms对应预览最初单次丢响应注入；随后只修测试注入为持续断连及增加stdin正常停止，最终四项重验不与首轮相加。最终每命令JSON保存源码Hash，历史B4/E1/E2/E3不移作当前通过数。

## 实际Chrome闭环

同一最终临时库：桌面1280×900主题A、390×844主题B，各自已有Web Goal/已批准Plan。浏览器实际明确许可各自固定来源、首轮baseline无事件、订阅、一次no_policy变化0新增Grant/模型、独立完整结构化Policy；之后各两个新事件，各续原Goal一段并通过主题/原Goal/技术Run/冻结原件/Inbox追溯。B变化时A Goal/Execution保持不变。

最终Goal HTTP=4、Chat=3、Router/Work/intent=0；GitHub loopback=27（18 commits、9 compare）。4个策略Execution均committed、4 Trigger/Grant；总Execution6另含2个零模型bootstrap，Goal数2、Task/WorkJob/文件操作0。普通Chat包括两视口各一次及关闭事件后一次，不混入策略模型计数。通知4条，未点“标为已查看”。

原Run和冻结原件读取前后，run_events、Execution、Policy/审计、Grant、file表逐项相同；0意外ACK/显示授权/文件decision。Goal请求工具0，恶意commit/patch进入低信任快照，仅作为资料；不以mock输出证明真实模型抵抗注入。

## 请求恢复与控制

合法原Plan1→2后实际墙钟20.761秒，旧勾选清除、批准按钮disabled，再明确勾选才批准。批准及撤销原事务提交后，预览销毁HTTP响应连接，Chrome自动重发仍用同payload/requestId/Run；持续断连后页面显示Failed to fetch。等待14.504/13.852秒、原5秒轮询显示active/revoked之后，恢复入口仍可达；解除测试故障后恢复只读原收据，approved/revoke审计各1，无新Grant。

390px B另在服务器接纳前停HTTP，原请求未到服务器；32.326秒后恢复网络，点击恢复会首次接纳原冻结授权。此前B Policy不存在，此后只有1个Policy/1次approved/0新增模型；不把这步称为纯读取，也不借当前新表单重新授权。

实际来源和订阅pause/resume不恢复执行权限；B Policy暂停、A Policy撤销后，新事件仅记录user_pause/user_revoke，仍4次Goal模型。关闭事件后即使到期也0来源HTTP、Chat可用；重开来源观察可形成新事实，但A仍revoked/B仍paused，旧终态不补跑、Grant不增加。完整页面重载或主题卸载丢本页pending跟踪是已接受边界；服务器原请求/收据持久。

## 布局、失败与清理

实际两视口操作表单、长SHA、冻结原件与原Goal；390px scrollWidth=bodyWidth=390，桌面为1280，控制台error/warn记录0。截图/DOM和只读合成DB对账互证。

初实例Goal/Chat均0、GitHub3：自动fill日期未生效导致浏览器required阻止提交，改用原生分段键盘；一次提交后断连被Chrome自动重发，未进入页面未确认窗口，保留证据后调整测试注入并在新临时实例完成主链。另有一次select标签定位、一次登录Detached和一次证据查询列名错误，均保留，不计为产品失败。初实例pipeline Ctrl+C返回1；最终stdin stop正常exit0，自有服务停止、tab关闭/viewport重置、两临时root精准删除，合成DB与JSON保留。

## 证据与未验边界

本机证据`work-core-stages/evidence/e4/worker/`保存396文件起点/终Hash、身份/index/refs不变核对、完整含untracked和相对E3R2增量diff、命令/真实退出码/原日志、逐文件目的、浏览器截图DOM/计数/合成SQLite及清理记录。

未访问正式.env/DB/Memory/Session/备份、真实GitHub或收费模型；无正式开关启用、SDK/依赖/生产执行链更改，无stage/commit/push/PR/merge。真实语义质量、真实手机、外网与长跑、供应商账单/外部恰好一次仍未验证；旧Goal/Formation真实失败保留，Recall未实现。
