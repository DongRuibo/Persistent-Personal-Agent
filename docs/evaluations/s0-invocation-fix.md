# S0 特殊 Skill 明确调用权限定点修复

日期：2026-10-23。基线 `fb5201c637cea86c9e8c8733d909859d50b72c99`。用户已确认 S0-A/B/C 通过 ChatGPT GitHub 代码审查；本轮只修特殊字段 `disable-model-invocation` 的读取授权，另外交付两份方案文档，没有开发 S1 Tools。

## 根因与改动

`skill-tools.ts` 原先用 `currentText().includes(info.id)` 判断明确调用。它只能证明 ID 出现，无法证明当前用户要调用；“不要使用 agent-notes”“假设我说：请使用 Skill agent-notes”及引用都能通过。模型提议 read 也不是用户授权。

新增私有的有界判断，完整匹配当前原话中的独立调用句：中文“请使用 Skill agent-notes”“调用 agent-notes”“请帮我加载技能 agent-notes”，英文“Please use skill agent-notes.”或精确 `/skill:agent-notes`。输入只做 NFKC 和首尾空白归一化，不剥掉引号、代码块、否定词或条件再猜意图；ID作为字面量转义。多余条件、疑问、复合句、提及、错ID和相似ID都拒绝，返回明确格式提示。

只替换特殊标志的谓词，保留原生加载器/read、包Hash与范围检查、次数/容量/取消、跨Session额度、普通包自动选择、Task/Memory Guard和Goal/Policy/Checkpoint机制。拒绝不返回正文，不扣正文额度、不产生激活事件，仍按原规则消耗本轮读取尝试次数，普通聊天继续。没有增加模型调用或授权解析服务。

这个判断只是本轮 read 的必要条件，不是原生展开器或权限总开关。Chat依旧 `expandPromptTemplates:false`；`/skill:ID`不自动展开。Pi仍可能隐藏特殊包目录或不提议read，允许不等于一定调用；宿主 `/skill ID` 查看命令也不等于调用。历史已经读取的正文仍在原生Session中，本修复阻止新的未经授权读取，不清除历史或宣称模型遗忘。

## 测试及原始失败证据

先补测试再改实现，固定同一组预期。新增两项顶层测试、30项子用例：24项拒绝、6项明确允许；另外用真实PiExecutor/SQLite/本机模拟HTTP验证“明确调用→关闭并重启→本轮否定却被模型提议read”，当前授权不继承旧调用，普通回复仍成功。

- 修复前：`01-before.log`中两项新增顶层测试失败；runner含父子计数为32项、7通过/25失败。父项及后续计数断言也会报错，**不是25个独立漏洞**。保留原日志，不用修复后的结果覆盖。
- 修复后：Skills/Goal Skills三文件专项 **53/53通过**。原生read后下一请求正文、无工具Goal、Plan审批/Hash、重启、预算、暂停取消及通知故障等旧用例仍通过。
- Windows Node **24.19.0** 完整回归：typecheck、build、npm test、eval:memory、eval:formation全部退出0；**302项，299通过、0失败、3项原有平台跳过**。跳过仍为POSIX私有权限位、账户普通符号链接权限及POSIX SIGTERM；junction/硬链接等既有用例实际运行。
- 本次没有重跑Linux。上一轮[S0报告](s0-skills-validation.md)的Linux270/270是历史证据，不把新增32项记成Linux已通过；本轮也没有验证Windows ACL、原生Mac或真实模型。
- Memory/Formation冻结评测不改；收费模型请求0，真实飞书/手机/Observer调用0，正式配置/数据操作0。公开文档调研及Git远端只读核对不属于模型验收。

Formation评测脚本默认会重生成旧路径 `v2.1b-formation-offline.json`；本轮发现后将新产物保存为日志目录的 `formation-offline-current.json`，旧路径恢复为基线版本。新产物Hash另存机器摘要，不以本轮计时或Windows原始字节Hash替换历史报告；冻结样本和通过预期均未修改。

日志根目录：`E:/AgentWork/validation/personal-agent-s0-invocation-20261023-172457`。机器摘要及SHA256见[s0-invocation-fix.json](s0-invocation-fix.json)。完整运行命令是Node24.19下的 `npm run typecheck`、`npm run build`、`npm test`、`npm run eval:memory`、`npm run eval:formation`；专项为 `node --import tsx --test tests/skills.test.ts tests/goal-skills.test.ts tests/goal-skills-integration.test.ts`。

## 文件及交付范围

| 文件 | 目的 |
| --- | --- |
| src/skill-tools.ts | 仅替换特殊包明确调用谓词与拒绝提示 |
| tests/skills.test.ts | 否定/引用/假设/提及/显式调用及真实Pi跨重启回归 |
| README、PROJECT、STATE及Skills设计 | 说明特殊包支持的独立调用句、交接状态与未开放能力 |
| 本报告及JSON | 独立保留原始失败、修复后结果、日志Hash与未验证范围 |
| [Console体验方案](s0-console-live-experience-plan.md) | 冻结话术、16次/2元独立建议限额及联网前门槛；仅方案，尚未执行 |
| [S1只读Web设计](../designs/s1-readonly-web-tools.md) | 固定公开文本资源、Pi工具适配、宿主只读许可与Goal/Policy后续边界；未编码 |

未修改SDK/node_modules、依赖、原Goal状态语义、正式.env、HANDOFF、历史报告或正式数据库。E盘原工作区8项已有文件Hash保持不变。变更在独立工作树分支 `fix/s0-explicit-skill-invocation` 完成；最初交付未提交推送，用户随后明确授权提交、合并并推送GitHub main。发布只补交接状态，代码与已验证Hash一致，未重复运行回归，最终提交及远端结果以Git记录为准；该授权不包含收费体验或S1实施。

## 剩余限制与下一步

特殊包只支持列出的可确定独立调用句，例如“请使用 agent-notes 整理资料”这种附带任务的自然复合句会保守拒绝；不能据此宣称通用自然语言意图识别已解决。普通自动包不受这项特殊门槛影响。真实模型能否自动选中、读取并遵循Skill仍待[独立体验验收](s0-console-live-experience-plan.md)。

S1建议先批准Chat固定资源只读批次，手动Goal先消费用户批准的冻结快照，不向text_only Goal/Policy偷偷添加Web工具。任意URL、HTML、自动网页刷新与主动网络能力另行决定。

[V3.0.1真实自然暂停和操作收据误解](v3.0.1-live-retest.md)仍为正式主动执行启用前必解项；本轮未修改其实现或历史结论，不用新增离线成功替代真实复验。
