# S0 + S1 + Goal + V3.0.1 综合 Console 真实验收

日期：2026-10-23（Asia/Shanghai）。基线：`c604565ca507ad9fe14e1cadf945918d14a92668`。

**结论：未通过。** B0通过，W1、G1失败；按冻结依赖门槛停止G2及后续7项，没有改话术、补题、重试、换模型或追加预算。真实模型请求8/32，全部HTTP200；保守费用预留0.409924/6元，供应商实际账单未知。固定Web预留1/1，成功获取0；当前证据不能确定HTTP GET是否已在超时前发出，不把预留数冒充实际发送数。V3.0.1两项历史真实失败保持开放。

## 授权、前置检查与隔离

- 本轮用户明确授权32次物理模型HTTP、6元预留、最多一次固定Pi Skills HTTPS GET。另行确认当前账号输入2、输出8元/百万Token、无额外费用；不沿用任何历史账本或余额。
- 实际模型ID：`deepseek-ai/DeepSeek-V4.1-Flash`，端点：`https://api.siliconflow.cn/v1/chat/completions`。实时核对[硅基流动官方价格](https://www.siliconflow.cn/pricing)：较高时段输入2/输出8/缓存0.04，低谷输入1/输出4/缓存0.02。预留统一采用2/8，不扣缓存折扣。文本计费参考[官方说明](https://docs.siliconflow.cn/docs/userguide/capabilities/text-generation)；账号适用费率和无附加费由用户本轮确认。
- [官方更新公告](https://docs.siliconflow.cn/docs/release-notes/overview)称同名ID于2026-10-21升级至1017；本轮未改ID，响应仅报告同名模型，不额外声称已独立验证底层构建。所有请求enable_thinking=false，Goal零工具、单次模型HTTP。
- 当前进程及Windows用户/系统环境均无LLM配置。沿用此前明确批准的四个LLM字段只读提取并在内存中注入子进程；未加载其他正式配置、未显示/落盘密钥。原配置provider=openai，验收入口采用既有personal-compatible SDK适配标签；模型与端点不变，正式.env未修改。
- 使用原`scripts/integrated-console-acceptance.ts`，未修改产品或SDK。Node24.19.0，Pi SDK1.3.0；执行前重新通过13项预算专项，0失败/0跳过：v2统一账本、32/6/64KiB/4096上限、跨进程累计、发送前持久预留、一次Web限制及失败不退额。按2/8计算，单请求最大预留0.164864元，32请求最大5.275648元，小于6元。
- 新根目录：`E:/AgentWork/acceptance/s0-s1-goal-v301-20261023`；数据库、两阶段Session、Memory和批准Skill均位于此根目录。证据与一次性控制器：`E:/AgentWork/validation/personal-agent-integrated-live-20261023`。控制器只发送冻结方案里的原话，没有额外模型消息。冻结方案Hash为`06fa3f52c8eea5cf14a36950413a9dc72fed0264b5dfb5aac4ff0be47297e57b`，入口Hash为`d382eab2629e9e6ff9de4390315b77211e8d6b9126171cd23402b9fd9bfa78fd`；145份项目/SDK文件执行前后Hash一致。

## 每个冻结场景的实际结果

Token列顺序为未缓存输入 / 缓存输入 / 输出。前台Run succeeded只表示交互完成，不代表场景通过。

| 场景 | 真实模型、工具与最终回答 | 宿主、SQLite与Session | HTTP / Token / 保守预留 | 判定 |
| --- | --- | --- | --- | --- |
| B0 | 仅以现有知识解释Agent Loop，无工具调用 | baseline无read/web_get/goal_manage；Task、Memory、Goal均无新增，正常退出0 | 1 / 1813·0·121 / ¥0.046802 | 通过 |
| W1 | 正确提议web_get(pi-skills-v1)，未read agent-notes；下一请求收到拒绝/失败ToolResult，最终如实表示读取失败、未总结文档 | 当前原话授权、整轮持久预留成功；web_read_calls唯一一行failed/TimeoutError，约10.009秒后结束，snapshotJson=null；不退额、不重取，未得到正文 | 2 / 2913·2688·102 / ¥0.110118 | 失败；网络/宿主取数阶段超时，agent-notes选择与正文遵循未验成 |
| G1 | 按原话创建目标前，Chat原生read interview-practice，805字节正文实际进入请求5；随后goal_manage，意图解析识别create。主模型请求7口头给出1步草案，独立Goal请求8输出1步proposedPlan，却复用bootstrap Step ID改写定义 | 创建控制收据成功；主模型口头草案被宿主真实状态覆盖。Goal仅一次初始化Execution，提交被身份/不可变Step检查拒绝；状态blocked/revision2，Plan仍v0、pendingAction=null、Checkpoint=null；无正式Skill绑定 | 5 / 4366·8960·1147 / ¥0.253004 | 失败；模型结构化结果语义违反Step身份契约，宿主正确拦截 |
| G2 | 未发送资料绑定原话 | W1无成功快照，且G1无待批准草稿 | 0 | 未执行：依赖失败 |
| G3 | 未发送批准原话 | 无合法可审批计划或资料绑定 | 0 | 未执行：依赖失败 |
| R1 | 未执行Checkpoint后的重启场景 | G3无Checkpoint；不能用B0→W1的预算续测代替Goal恢复验收 | 0 | 未执行：依赖失败 |
| V1 | 未发送查看原话 | 遵守G1失败后不执行后续步骤的冻结门槛 | 0 | 未执行 |
| P1 | 未发送“暂停那个学习计划” | 未实际复验历史暂停失败，不记通过 | 0 | 未执行 |
| C1 | 未发送继续/反馈原话 | 无已批准Skill+资料片段或P1暂停状态 | 0 | 未执行：依赖失败 |
| X1 | 未发送取消原话 | 不追加取消测试来使用剩余额度 | 0 | 未执行 |

W1失败后仅继续了尚不依赖网页快照的既定G1初始化检查；G1失败后，按[冻结方案](integrated-console-live-plan.md)“G2及后续不执行”的门槛正常停服。没有重发W1或修正G1。

## G1根因、收据与权限边界

原始请求8响应是可解析、满足外层Schema的JSON，proposedPlan恰好1步，skillId为interview-practice。问题不是步数超限或SQLite损坏：新步骤的stepId为`bc37acd1-07e9-41b4-a84d-17e014fbd6fa`，与宿主bootstrap步骤完全相同，但title/instruction等均改变。原系统Prompt已经要求新步骤省略stepId，模型仍复制了输入中的ID。GoalStore.draft据此拒绝，底层异常为：`计划 Step ID 跨目标或定义已变化，需新建步骤`。运行层将其统一标成checkpoint_commit_failed，丢失了对外诊断细节。

离线重放只在独立新库恢复提交前快照，未修改原验收库、响应或业务预期，未删除保护触发器、未调用模型/网络：原始响应再次触发相同拒绝。仅在离线对照中省略新步骤ID后，原宿主可以生成1步草稿及正确Skill Hash绑定。这是定位反事实，**不是一次真实成功、修复或收费复测**。原验收库Hash始终为`d4a644815a054cf78467b2d132c4ec0079c557f261003e254f2be9bada1f6caa`。

原始主模型请求7还口头给出“待批准计划/v0/1个Step”，但工具真实结果为已创建排队、ready、pendingAction=false。用户可见内容由宿主覆盖，先显示创建排队，再由后台显示blocked，没有把口头草稿当可审批计划或生成新控制。原生Session同时保留模型原文和随后顶层custom_message类型的host-goal-result-v1收据；收据准确反映创建时的ready/待批准=false，不是新授权。没有执行下一轮真实查询，不能据此证明错误历史永远不会影响后续理解。

G1的805字节读取是**Chat中已批准纯文本Skill的受限read**，不是Goal批准后的/skill展开。冻结G1“审批前未激活Skill”的字面预期未满足；现有Chat授权允许预读，是否允许为Goal规划预读的产品/验收口径需下轮明确。本轮不改预期，也不将这次Chat读取算作手动Goal绑定/执行通过。Goal实际请求8没有工具、没有激活Skill正文、没有Web资料；全部写权限、预算和审批边界保持原样。

## 审计、成本与Web发送证据

- 真实模型物理请求8，全部HTTP200：Chat6、隔离意图解析1、独立Goal1。请求/响应各8份，与账本和model_calls的8行一致；最大请求体13892字节，输出限额最大4096，Goal仅一次请求，自动重试0。停止时仍有余额，未增加测试。
- 未缓存输入9092、缓存输入11648、输出1370 Token，总输入20740。8条SDK cost均null；保守预留¥0.409924不是账单。按确认的2/8和官方缓存参考0.04估算约¥0.02960992，仍只是Token估算，供应商实际账单未取得。
- 固定来源为`https://raw.githubusercontent.com/earendil-works/pi/v1.3.0/packages/coding-agent/docs/skills.md`，目录Hash`9203d78fddff573fbf49802b198e226b5778af560d21acdaf75d93baa7ac076c`。v2账本只有1次webAttempts，SQLite只有1个reserved→failed调用，成功快照/完整正文/正文Hash均0。当前日志缺少DNS/TLS/GET提交分阶段记录，因此只能证明已开始一次受限取数、成功GET为0、实际发送GET数量介于0和1，不能声称服务端收到一次GET。
- 两个子进程都经/quit正常退出0，root预算锁和数据库/Memory锁已释放，无running Run/Execution、ready授权或主动策略。真实B0→集成重启保留模型账本1次起点；R1的Goal/Checkpoint恢复仍未执行。
- 最终SQLite：Task0、Memory Markdown0、候选0、策略/Trigger/Grant/Observation/Outbox均0；Goal1、Plan v0一份、初始化Execution失败1、committed0、Checkpoint0。integrity_check=ok，外键0异常，既有audit-goals只读检查通过；失败没有留下半份计划或重复执行。
- 145份源码/SDK Hash及原工作区8份文件/分支/HEAD均不变；正式配置未修改、正式数据/历史验收库未打开。没有修改产品代码、冻结方案、SDK或历史失败报告，没有提交/推送/合并Git。仅新增本报告/JSON并更新STATE，未重跑全量typecheck/build/test/两个eval或Linux；本轮实际重跑的是13项入口离线限制测试。

## 原始证据与离线复现

真实根目录保留integrated-budget.json、authorization.json、frozen-plan.md、request-01～08.json、原始response-01～08.txt、原生Session及原SQLite。证据目录保留各步骤快照/输出、console-1-baseline.txt、console-2-integrated.txt、controller-events.jsonl、audit.json、decoded-model-responses.json、goal-integrity-audit.json、host-result-audit.json、stopped-artifact-hashes.json、冻结Hash/核价/账号确认资料和一次性控制器源码。

关键失败响应08 SHA256：`452451e49bed35c5386da6d8ed85391f4b7e8fa4f089b4f4c86c122cfa34a7da`。只读核对命令：`node --import tsx scripts/audit-goals.ts E:/AgentWork/acceptance/s0-s1-goal-v301-20261023/agent.db`。原始response08可从decoded-model-responses.json对应序号查看；与audit.json中bootstrap Step对比，再按replay-commit.mjs在全新离线副本重放。该脚本为一次性分析记录，不能直接更新原库、复用实际验收入口或重新发模型请求。

诊断编排记录也保留：控制器初次普通管道stdin即关闭，尚未启动验收/零请求；改用保持stdin的终端后执行，冻结话术未变。首次离线备份企图将已结束Execution回退，被不可改写触发器拒绝，日志保留；随后在新库插入提交前快照，未删触发器。Session审计首版误按message内嵌查收据，漏掉Pi顶层custom_message；host-result-audit.json按原生格式确认1条真实收据，原Session未改。以上均不算真实产品成功或收费重试。

## 历史门槛与下一轮优先级

V3.0.1自然暂停：P1未执行，保持开放。操作收据解释：P1/C1/X1未执行，不能宣布真实复验通过；G1另暴露口头草稿与宿主实际状态不一致，宿主覆盖及持久收据本例有效。完整S0+S1+Goal闭环、批准后Skill展开、Web快照绑定、Checkpoint/重启、反馈和取消全部未验成，正式主动执行继续关闭。

1. **P0：收紧初始化Plan的结构化身份契约。** Prompt已提醒仍被模型违反；优先研究bootstrap新步骤DTO不暴露stepId、宿主分配新ID，保留既有不可变旧Step语义，不能用静默重写非法ID或收费JSON修复重试掩盖问题。
2. **P1：保留结构化拒绝原因。** 将非法Step身份/数量/绑定等可诊断业务错误与真正SQLite提交异常区分并关联Run；本例checkpoint_commit_failed掩盖了正确安全拦截，用户与排障都容易误解。
3. **P1：定位固定HTTPS资源超时并补最小阶段证据。** 分清DNS、连接/TLS、GET提交、响应头/正文阶段，设计下轮获批的可达性核对；不放松固定资源、代理、重定向、私网、容量及一次预留限制，不自动退款或重取。
4. **P1：统一模型收据和草稿用语，明确Chat预读与Goal批准的边界。** pendingAction=false时不能把主模型建议称为已保存、可审批的正式草稿；继续保留宿主最终呈现。下轮分别验证agent-notes自动选择、Chat按需read及Goal批准后展开，不能混算通过。

本轮已结束，不自行修复产品代码或消耗剩余额度。下一轮先经ChatGPT审查失败证据与最小修复范围，再另行批准开发/真实复验；不推进S2、Sandbox、Computer Use或正式无人值守。
