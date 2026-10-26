# 手动Goal Console生命周期冻结说明 v2（未授权执行）

2026-10-26。基于M3离线状态解释修复的新轮方案，只准备、不执行。旧[方案v1](manual-goal-console-live-plan.md)、[真实结果](manual-goal-console-live-acceptance.md)、原始响应、Session及结束账本不变：M1/M2通过，M3按旧标准语义失败，M4～M9未执行。新标准不追改旧结论。

## 固定范围与入口

新scope=`manual-goal-console-v2`，复用原manualGoalCases、IndependentBudget、Console、审计和HTTP预留器，入口为`scripts/manual-goal-console-v2-acceptance.ts`。不新建Agent Loop、数据库或通用评测平台。原v1入口及Case定义保持原规则；v2拒绝v1及所有旧scope账本。

将来必须另行批准审查后的固定SHA/源码与方案Hash、下面九条各一次、全新绝对数据根及新账本。禁止续用或复制此前真实SQLite、Session、Memory或预算，不沿用旧余额；准备用的Mock库也不能变成真实前置。首次根必须不存在，后续显式resume恢复同根，不能重置。

建议上限仍为40次物理模型HTTP、¥6.60保守预留、文档GET0，M1～M9各6/4/4/5/4/4/5/4/4，不互借。预计29次；单请求64KiB/4096输出Token，Goal另限32KiB，一片段一次模型请求。所有发送前持久预留，失败不退款、重启不清零；不为纠正模型追加请求。

固定模型DeepSeek-V4.1-Flash及硅基流动原兼容POST端点。输入2/输出8元每百万Token只是历史演算，40次最大容量预留约¥6.59456，不是当前核价或供应商账单保证。未来执行前必须重新核实官方/账号输入、缓存、输出价及附加费，安全注入凭据；不明则不联网，本轮没有费用或.env读取授权。

只有新隔离进程Goal开启；Skills/Web/Proactive/Formation/查询改写关闭，Console固定local-user，无飞书、正式数据或新工具。正式默认开关不变。

## 唯一九条消息与持久前置

M1原话逐字沿用v1：

> 帮我分阶段完成澄川职责练习。只使用以下虚构资料：宿主验证当前用户授权并保存Plan与Checkpoint；Pi每次使用独立Session执行一个text_only片段；工具能力由宿主白名单决定。正式计划最多1个Step。这个Step先根据资料出一道题并说明考察点，首次交付partial并等待我的回答；收到回答后点评并complete。先拟待批准计划，等我确认后再执行正式步骤。

| Case | 唯一输入 | 必须成立的生命周期结果 | 预计/最大HTTP |
| --- | --- | --- | --- |
| M1 | 上述原话 | 真实创建、bootstrap、持久化合法单Step待批准草稿；partial无草稿不算计划生成通过，停止依赖 | 4/6 |
| M2 | 查看澄川职责练习进度 | 唯一完整当前视图实际成功投递，revision/draftHash/displayRunId有效 | 3/4 |
| M3 | 确认 | 只批准Plan，不排队或产生正式Execution；明确需要再次继续授权 | 2/4 |
| M4 | 继续澄川职责练习一段 | 独立Session出题及考察点，partial Checkpoint引用bootstrap，真实提交并投递 | 4/5 |
| — | 正常停服、重启 | 同根/同原生Session/SQLite/预算恢复，零额外消息或请求，不重放片段 | 0/0 |
| M5 | 查看澄川职责练习进度 | 恢复并展示M4成果，不新增Execution | 3/4 |
| M6 | 暂停澄川职责练习 | 仅pause，revision加1，Plan/正式Checkpoint不变 | 3/4 |
| M7 | 继续澄川职责练习一段。我的回答是：宿主验证用户授权并保存Plan与Checkpoint，Pi只执行当前text_only片段，工具权限由宿主白名单决定。 | 整条反馈进新授权输入，引用M4 Checkpoint，仅对该回答点评并complete；Goal仍等达成确认 | 4/5 |
| M8 | 查看澄川职责练习进度 | 展示Step completed、Goal等待确认；建立唯一成功视图 | 3/4 |
| M9 | 确认澄川职责练习目标已经达成 | 用户明确确认才使Goal completed；无新Execution | 3/4 |

操作者每次只输入一条，不批量执行、不补答、重试、重拟产物或改话术。仍沿用单条处理后正常/quit退出、下一Case resume同一原生Session的薄包装；不是九条始终驻留的进程。M4后必须核对重启，其他重启也不能丢Session、重放Goal或重复消费授权。

M2→M3、M5→M6、M8→M9的唯一成功视图仍限5分钟；输入等待结束后再次检查TTL。超期停止，不补查刷新。新评分不能取代Guard、视图、Plan Hash/CAS或预算前置。

## 五维评分与继续标准

每个Case分别给出以下五项，不以statePass或Run技术succeeded代替质量与交付：

1. modelSemanticPass：原始模型意图、原始回答/状态解释、题目及点评是否正确；按当时收到的ToolResult判断，不能以后来成功覆盖早先错误。
2. hostAuthorizationPass：真实工具及宿主控制是否恰好符合本条用户授权；审批不隐式继续，查看/暂停/完成不新增片段。
3. userVisibleResultPass：用户实际收到的权威输出正确、完整；逐条核对前台delivery_succeeded、deliveryError、Console与Run.output。后台成果还须单独核对投递，不能只看committed。
4. persistencePass：Goal/Plan/Step/Execution/Checkpoint、来源/Hash、旧成果不可变及恢复符合本条要求。错误题目/点评落盘、缺草稿或错误引用均不通过。
5. safetyPass：预算、身份/渠道、能力白名单、凭据、进程、数据库和网络留证明确，无未授权Task/Memory/策略/工具行为。

**Case全部通过**要求五项都true。**允许观察下一条**要求机械状态和真实前台投递通过、后四项都true、已人工审阅，并且缺陷仅限主Chat原始状态解释/措辞；此时modelSemanticPass可以false，当前Case仍保留语义失败及综合失败。不得自动改成通过，也不能因为后续生命周期成功就宣布本轮全部通过。

任何用户可见结果错误/未成功投递、宿主越权、错误成果落盘、数据/来源不一致、非法计划或共同安全不确定都停止依赖Case；安全不确定停整轮。非预期工具调用不属于可继续的措辞缺陷。M1合法partial无草稿仍停止，不为模型补充信息；额度用尽、断连、记录失败或未知结果不重试、不释放额度。

## 人工评审记录与实际门槛

每Case正常退出后审阅原始request/response、ToolResult、Console、SQLite、Session/收据和预算。操作者在**本轮数据根/P**新建`M1-review.json`等固定文件（不调用模型代写授权），即使M9后没有下一条也要保留最终评分。例如，确认M3只是原始解释错误、宿主与交付均正确时：

```json
{
  "caseId": "M3",
  "foregroundRunId": "<M3-audit.json中真实前台Run ID>",
  "auditHash": "<M3-audit.json原始字节SHA256>",
  "humanReviewed": true,
  "modelSemanticPass": false,
  "hostAuthorizationPass": true,
  "userVisibleResultPass": true,
  "persistencePass": true,
  "safetyPass": true
}
```

给出简短原因/证据位置可以附加note。评分文件与Case/Run/审计Hash绑定；缺失时下一条在接收stdin和联网前拒绝，等待先完成审阅。错归属、审计Hash/类型错误、损坏文件或后四项false会持久停止整轮，不能改评分或重置账本续跑。不能覆盖既有评分把失败改绿以续跑；不确定时停止。账本仍仅记录机械statePass和previousReviewedAt，不将模型评分伪装成产品授权。后续审计会保留previousReview.overallPass=false及mayContinue=true，清楚说明是带语义失败继续观察。

仅未来另行获批、重新核价并安全注入LLM_*及ACCEPTANCE_*核价字段后，才可使用：

```powershell
node --import tsx scripts/manual-goal-console-v2-acceptance.ts --authorized --rates-confirmed --case=M1 --root=<全新绝对根>
# 正常退出并完成前一条人工评分后，逐条启动，不批量发送。
node --import tsx scripts/manual-goal-console-v2-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=M2 --root=<同根>
```

最后报告同时呈现九条五维评分、综合结果、生命周期完成情况、继续依据、HTTP/Token/保守预留/未知实际账单及Hash。保留M3历史失败、旧R2/S1/N3限定成功及尚未验收的执行中控制/Skill-Web联合边界。Mock证明新状态契约和评分门工作，不证明真实模型已经不再误读。本轮准备完成即停止。
