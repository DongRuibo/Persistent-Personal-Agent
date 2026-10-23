# 统一 Console 真实体验验收冻结方案

状态：**仅准备，未获得本轮收费、真实网站、飞书或手机执行授权，实际请求0。** 本方案承接S0、S1-A/B、V3.0.1；历史账本和余额全部不沿用，旧失败报告不改。

## 范围、费用和入口

建议另行批准：最多 **32次物理模型HTTP请求、6元人民币保守预留、一次固定Pi Skills公开文档GET**，任一上限不足以容纳下一请求即在联网前停止。预计28次，不因剩余额度增测、重试或修JSON。32包含当前意图解析、原生工具后的后续请求、Goal独立Session及失败请求；消息数或model_calls行数不代替物理发送数。

统一入口为 `scripts/integrated-console-acceptance.ts`。同一个新隔离根目录、一份integrated-budget.json贯穿所有阶段和正常重启；baseline与集成阶段只隔离Session子目录，不拆预算。原子预留/文件fsync后才发送，失败不退额，进程互斥锁，续测核对根目录、模型、端点、费率、冻结方案/入口/源码/包Hash；旧账本、超限、容量不符、残留锁或未完成写入全部拒绝。

Web硬限制也在这份账本中：v2格式保存不可变webLimit与webAttempts，整轮最多一次预留，只允许`pi-skills-v1`及`https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md`。验收专用Web服务在调用产品DNS/HTTPS实现之前同步预留、fsync落盘；新Run、切换Session及跨进程重启不能重置。首次DNS/请求失败、中断或结果不确定均不退额，第二次及其他资源在DNS前拒绝。它与32模型请求/6元限制同时生效，互不替代，不改变普通产品的Web配额。旧v1账本没有可核对的Web消费记录，拒绝续测，不自动升级为零消费；异常退出残留锁仍需人工核对，不自动清锁。

模型请求体最多65536字节，输出最多4096 Token；Goal仍有更严格的32768字节上限，Chat Skills/Web共用每轮8次额度。每次预留公式（费率单位元/百万Token）：`ceil((实际JSON字节+512)*输入费率 + max_output_tokens*输出费率)` 微元；按字节保守估算输入，不依赖缓存折扣或模型usage退额，不承诺供应商账单严格等于预留。

费率**本轮未联网核实**，不得把历史2/8元当作当前报价。执行前由操作者从供应商官方定价确认模型、输入/缓存最高价、输出价及附加费用，并在24小时内注入ACCEPTANCE_PRICE_CHECKED_AT；未知费率或未知额外计费则不执行。仅以输入2/输出8演算：单请求最大预留0.164864元，32请求总上界5.275648元，因此建议6元；若实际费率更高，6元可能提前阻止后续步骤，不追加预算。

仅使用已注入的LLM_API_KEY/LLM_BASE_URL/LLM_MODEL兼容端点，不加载.env。人工另行批准以后才可执行以下入口；不能因文档存在自行运行：

```powershell
# 先在本机安全注入LLM_*及三项ACCEPTANCE_*，不要把Key发进聊天或写进命令历史。
# ACCEPTANCE_INPUT_RATE、ACCEPTANCE_OUTPUT_RATE、ACCEPTANCE_PRICE_CHECKED_AT必须来自本轮核实。
node --import tsx scripts/integrated-console-acceptance.ts --authorized --rates-confirmed --web-authorized --baseline --root=<全新绝对隔离目录>
# baseline输入完成后/quit；之后以同一根目录和账本续测，去掉--baseline。
node --import tsx scripts/integrated-console-acceptance.ts --authorized --rates-confirmed --web-authorized --resume --root=<同一隔离目录>
```

入口只复制/批准仓库中的agent-notes和interview-practice到新受管目录。Goal/Skills/Web仅在该隔离集成进程开启；Proactive、Formation、Memory改写始终关闭，未接飞书、Observer、手机或正式账号。正式.env、Task/Session/Memory、历史验收数据库不读不写。一次GET仍经S1-A的DNS/IP/TLS/代理/类型/大小/总超时检查，不为真实站点放宽边界。冻结话术中只有W1授予读取权限，不能重发W1或以恢复为由重新获取；正常冻结路径web_read_calls应仅一行，额外拒绝尝试可能留下failed行，不能把表行数当作实际GET数。联合核对webAttempts最多一项、来源/状态/快照及DNS/传输证据。若模型漏调工具或站点不合格，记录失败并停止依赖步骤。

## 冻结话术与门槛

所有Goal名称与话术在执行前冻结，不能事后改成更好匹配的名称。只使用虚构内容；对话间隔保持在5分钟展示TTL内。发生前置失败，后续依赖步骤记未执行，不新增“刷新/改名/再生成”来凑通过。

| 顺序 | 输入/操作 | 预计HTTP | 预期 |
| --- | --- | --- | --- |
| B0 | baseline：“请只用现有知识，简短解释Agent Loop，不读取资料，不保存Memory。” | 1 | 正常对话，模型请求无read/web_get/goal_manage，无DNS/GET或写入；/quit后以--resume进入集成模式 |
| W1 | “请读取 Pi Skills 文档，并总结加载流程” | 3 | 原生目录进入首请求，模型自动选择agent-notes并受限read（用户不提供Skill ID/路径）；web_get只提议固定ID。下一请求实际包含Skill正文和带来源的低信任Web正文。最终区分资料事实、推断、未知；若先要求确认则本轮冻结路径不满足，记录而不加话术 |
| G1 | “帮我逐步制定银杏阅读计划，只使用虚构内容。正式计划最多1个Step，使用Skill interview-practice。该Step包含依据我稍后批准的资料出一道题并点评我的回答；首次交付题目必须partial并等待我回答，收到回答后才可complete。现在先给出待批准计划。” | 4 | 一个Goal、一次bootstrap、一个正式Step的草稿及正确Skill ID/Hash；审批前未激活Skill或绑定资料 |
| G2 | “将已获取的 Pi Skills 文档第1至8行绑定到银杏阅读计划第1步” | 3 | 只选同身份/渠道成功快照；显示来源、时间、版本、完整Hash、行范围/选中Hash；不裁剪范围、不联网，草稿保留Skill绑定。第1至8行不够或超过4KiB则记录容量失败，不临时改范围 |
| G3 | “批准银杏阅读计划并继续一段” | 4 | 成功展示后审批；独立Goal Session实际/skill展开interview-practice，输入含冻结的1至8行，零工具且单模型请求，partial Checkpoint与等待反馈。主模型收尾和宿主最终呈现分别记录 |
| R1 | /quit，记录账本/SQLite/Session Hash；同入口--resume正常启动，等待一个扫描间隔，不发送用户消息 | 0 | 无额外GET或Goal Execution，已提交Checkpoint与冻结资料不变、额度不重置 |
| V1 | “查看银杏阅读计划进度” | 3 | 唯一当前视图成功投递；宿主状态与SQLite一致，模型不依据历史错误解释推断未保存 |
| P1 | “暂停那个学习计划” | 3 | 原始失败原话：类别不要求标题含“学习”，唯一有效银杏视图仍与具名/版本校验；Goal变paused，Checkpoint不增长；工具、宿主呈现、持久收据均一致 |
| C1 | “继续银杏阅读计划。我的虚构回答：宿主保存授权与Checkpoint，Pi负责单次模型执行；工具能力由宿主白名单控制。” | 4 | 一次新的手动授权和独立片段；使用相同Skill与快照、引用旧Checkpoint，不重新读取网页。按实际回答给出反馈，保存新Checkpoint；若P1失败则本步未执行 |
| X1 | “取消刚才那个学习计划” | 3 | 指代为最后成功展示的同一Goal；状态cancelled，不能额外执行。模型最终解释、用户可见宿主状态与Session收据核对，无“未实际保存”等反向猜测 |

合计预计28次，最多32；多出来的4次仅容纳原生模型实际工具轮数差异，不授权重试失败步骤。每轮Chat的8次硬上限继续生效。W1未按需read或没有实际正文，分别记模型选择失败/宿主机制未触发，不凭模型口述判通过。若实际计划不满足G1，G2及后续不执行，不替用户批准非法计划。

## 证据与结论

每步记录四列：①模型理解/工具提议与最终解释；②宿主允许、澄清、拒绝及最终可见文本；③SQLite/原生Session/实际模型输入；④物理HTTP次数、usage和累计保守预留。保存冻结方案/入口/源码/包Hash、request-NN.json和原始response-NN.txt、工具call/result、skill_activated、host-goal-result-v1、Goal/Plan/Execution/Checkpoint及停止记录。不能只凭正文进入上下文判断回答质量，也不能把模拟通过当真实通过。

正常停服后仅对新隔离库只读核对（node:sqlite只读连接，或已有audit-goals.ts）：

```sql
SELECT id,runId,status,resourceId,owner,channel,finishedAt,
       json_extract(snapshotJson,'$.contentHash') FROM web_read_calls;
SELECT id,status,revision,planRevision,currentStepId,checkpointRunId FROM goals;
SELECT goalId,revision,hash,json_extract(specJson,'$.skillBindings'),
       json_extract(specJson,'$.webBindings') FROM goal_plans;
SELECT runId,status,planRevision,inputHash,checkpointHash,
       json_extract(inputJson,'$.skill.hash'),json_extract(inputJson,'$.web.binding.selectedHash') FROM goal_executions;
SELECT runId,type,details FROM run_events WHERE type IN
 ('goal_control','goal_checkpoint_committed','skill_activated','web_read_reserved','web_read_succeeded','goal_model_finalization_failed');
```

模型HTTP以原子预算预留、请求/响应文件对账；model_calls的Token只反映收到的usage，网络失败用量可未知，不退额。核对无Task/Memory/候选新增；Web成功快照唯一，bootstrap加两次正式片段且无重放，P1和X1状态正确。所有冻结用例满足才可确认本轮Console里程碑通过；任一失败原样保留、依赖未执行如实报告。V3.0.1两项门槛只有本次真实复验实际通过才可另写新结论；旧报告不覆盖。飞书/手机、真实主动策略、长期运行与S2权限仍未验收或授权。
