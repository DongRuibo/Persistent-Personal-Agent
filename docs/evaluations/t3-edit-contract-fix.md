# T3 编辑提议契约最小离线修复（2026-10-27）

基线`a31e688c90dc5ec221593483a46495520ecb09fe`；独立分支`codex/t3-edit-contract-fix`，工作树`C:/Users/Dongr/.codex/worktrees/t3-edit-contract-fix/Persistent Personal Agent`。离线修复阶段未提交、推送、切换Console、操作飞书或读取正式.env。用户随后仅授权发布本轮7份文件至本独立审查分支；发布只补交接，产品/测试Hash保持最终离线验证版本，不合并main、不自动启动或发送消息。

## 已确认的原因与边界

原试用`summary.md`已通过write真实提交，Hash为`4d1c6ddb74ced969d1b6ab0389334cfec04560e5fd944a36b06e74979f801d5c`。后续编辑Run `a3c49e28-e451-4ccb-b590-66681484e49b`没有调用edit，误将旧创建审批过期解释为必须先另取资料read授权，宿主正确显示“未登记”。用户再说“允许”后，Run `136efc51-246c-421c-981c-273427ef9828`误调资料read，被`current_user_authorization_required`拒绝；没有新edit提议或文件修改。

现有`FileOutputService.snapshot`已按当前用户/渠道、专用输出根、已提交身份及Hash读取目标快照；`FileOperationStore.owned`根据committed记录取得所有权，不用旧审批TTL决定文件有效期。Pi edit在内存快照上生成精确替换及Diff，只有另行确认才提交。资料read只能访问批准资料副本，不能因编辑输出文件而取得新权限。

可修复的宿主缺口是：旧通用提示和edit描述没有明确说明上述内部读取及TTL语义。真实模型确实选择了错误流程；仅凭这个样本不能证明提示缺口是唯一原因，也不能保证补充说明后模型一定选择正确。

## 最小变更

- `src/file-output-tools.ts`：只修改edit工具描述，明确受限内部读取、旧审批不影响已提交文件、已知原文与替换内容时直接提议，以及新Diff仍需另行确认。
- `src/pi-executor.ts`：只在Chat且输出功能开启时追加同一契约；真正未知原文或意图时仍应询问，不编造旧文本，不建议用资料read访问输出目录。
- `tests/file-edit-contract.test.ts`及脱敏Fixture：原版Pi SDK、真实临时SQLite、本机模拟模型验证实际请求投影、跨TTL/重启编辑、确认前不写入、自然确认零模型调用、资料read越权拒绝及原错误回答保留。
- 本报告、`docs/STATE.md`及现有试用说明。没有新增工具、开关、数据表、读取范围或确认语法；未改Guard、账本、FS算法、Skill包、SDK或node_modules源码。

## 红绿与最终检查

| 检查 | 实际结果 |
| --- | --- |
| 新增4项对旧产品源码 | 3通过、1失败：实际Pi请求缺少明确的编辑契约；模拟服务内断言失败表现为500，原日志保留 |
| 修复后文件专项 | 27/27，含新增4项及既有输出、自然确认、提议契约回归 |
| npm run typecheck / build | 均退出0 |
| npm test | 544项：541通过、0失败、3既有平台跳过 |
| npm run eval:memory | 退出0，Recall@5/ContextHit仍0.75，真实模型调用0 |
| npm run eval:formation | 退出0，development/holdout各30/30，真实模型调用0 |

新测试在旧版已有3项通过，直接证明过期文件所有权、内部读取和权限隔离原来就正确，本轮没有为此重写实现。新增正向回归在无资料read工具时，创建确认→旧审批过期→重启→当前编辑授权→原生Diff→新的自然确认完整通过；新审批单独计时，确认前文件不变。旧错误响应仍只标为未登记，不自动纠错、补工具调用或伪造操作。

Windows Node v24.19.0、Pi 1.3.0。Docker Linux引擎命名管道不可用，未启动或安装环境，未验证Linux/Mac。3项既有跳过仍为POSIX权限位、Windows符号链接权限及POSIX优雅SIGTERM。Formation脚本生成的历史报告副本另存外部证据目录，新树中该文件已还原。

## 证据与保全

外部证据目录：`E:/AgentWork/validation/t3-edit-contract-fix-20261027`。包含`red-tests.log`、`green-targeted.log`、typecheck/build、full-tests、两个eval、生成评测副本、`validation.json`及`SHA256SUMS.txt`。

原编辑Run输出SHA-256：`dfc05a6146b924aa75746715eb6f4e4a836daafa006e22d162b6c9075838a893`；原错误read Run输出SHA-256：`667cb5d5405a371a4a5277a114f4df98ea7f8640f504138fbb7fc94e834d5758`。提取的脱敏模型原文SHA-256为`18b306a734f6fc1df49e16cf8286764a717ec376f513283d77f243be53aaf70c`，Fixture包含来源信息，没有改写原Session或数据库。

离线修复期间，原a31工作树保持干净，其49个dist文件、当时的试用summary.md、两个Skill及批准清单、原启动器、E盘STATE及飞书启动器共56项Hash复核不变。未重放旧数据库、清锁、重置预算或修改历史验收报告。源码/测试Hash与最终检查对应，逐文件及映射摘要见机器证据。后续用户亲自提交的合法编辑另记于下节，不把该预期文件变化当作离线修复阶段改写原数据。

## 剩余限制

离线修复阶段没有真实模型或公网调用，Mock按预定响应调用edit只能证明宿主契约与机制正确，不能证明真实模型自主选择已经通过。该阶段尚未切换用户试用进程；后续用户基于修复版亲自试用的真实结果见下节。不新增收费验收或Harness。

未知原文仍应合理澄清；文件外部变化仍拒绝，SQLite与FS不构成共同事务，uncertain不重放。自然确认继续要求唯一有效、完整成功投递的预览、相同身份/渠道/根、Hash、5分钟TTL及一次消费。旧P1/N1、M5/M8失败及R2/S1/N3限定真实成功不改判。

## 后续用户真实人工试用与只读复核

用户于2026-10-27亲自使用修复提交`de127b35ed62bb4ec231ee315a088135a9c545e7`的普通隔离Console，沿用已创建的`summary.md`和原生Session，发送以下两条消息；没有点名edit、追加资料read授权或填写操作ID/Hash：

```text
本次允许编辑输出文件：summary.md
确认
```

第二条在第一条完整预览成功投递后单独发送。Codex随后只读核对本次Run、SQLite、原生Session与文件，没有代用户发送、重试、重放或调用模型。

| 证据 | 实际结果 |
| --- | --- |
| 编辑提议Run | `556fde91-6f0f-41b1-93cf-fe575c193bf2`，13:12:27.595Z开始，13:12:39.955Z成功投递；工具事件只有一次edit，无read或其他工具 |
| 模型原始行为 | 主动选择edit，传入准确oldText/newText，并正确说明内部读取及待批准未写入；不是仅输出口头草稿 |
| 宿主登记操作 | `27312590-eb0c-4686-a7f1-8634e6c55aed`，原生Diff只替换“用户负责确认。”为“只有当前用户明确确认后，宿主才可以提交文件。” |
| 预览及确认范围 | 操作Hash `e4c92e60147e108d451fafdcaf5ee70aef61e1ee8fb3edd267880efd12ee0902`，有效期至13:17:29.734Z；相同Console用户/渠道/输出根，确认开始时余280.615秒 |
| 自然确认Run | `9cfd0e94-6f35-4dec-b2c5-2e0f3c4d4a12`，13:12:49.119Z开始，13:12:49.159Z成功投递；一次file_operation_committed，confirmationMode=natural；无工具和模型调用 |
| SQLite及实际文件 | 操作为committed且approvalRunId匹配；approvalHash等于用户原话“确认”的SHA-256；文件1864字节，与批准完整内容相同，旧句0处、新句1处 |
| Session | 保留真实edit调用和ToolResult、原始助手回答、host-dialogue-references-v2及两条host-file-result-v1；待批准收据entry `d72f002d`、提交收据entry `7cd503f2`均对应同一操作 |
| 其他能力 | 两Run无Task、Memory、Goal、Web或其他工具事件；审计时Task、Goal、Policy、Memory候选/Formation任务及Web账本均0条，未将它们记为新增验收通过 |

原内容Hash为`4d1c6ddb74ced969d1b6ab0389334cfec04560e5fd944a36b06e74979f801d5c`；预览、SQLite批准内容、提交收据和实际文件的新Hash均为`2696f545ee6837f4b328d200cf2689b6f9b87ade5cef76c864f8e057390683a2`。对旧已提交正文做这一处精确替换，与新正文逐字节相同；旧创建操作和原失败Run仍保留。

模型选择与待批状态理解通过，但原始助手复述Diff有一处未修改上下文把“工具白名单与当前用户授权”写成“工具白名单及当前用户授权”。这不是实际工具Diff，也没有进入批准内容、用户收到的宿主预览或实际文件；原错误复述保留，不将原始回答宣称为逐字完全正确。

提议Run有2条SDK模型调用记录，确认Run为0；SDK inputTokens合计11714、cacheReadTokens合计10880、outputTokens合计713。普通Console没有本轮独立的物理HTTP计数或持久费用总闸，SDK cost为null，供应商账单未获取；不将这些记录冒充旧验收账本或¥6.60硬限额。本次追加记录没有新增模型请求或公网访问。

只读审计与脱敏证据位于`E:/AgentWork/validation/t3-edit-natural-confirm-live-20261027`，包括audit.json、原始助手回答和两份宿主输出副本、保全Hash及SHA256SUMS；不将原始SQLite、Session、正文或配置提交Git。本次仅报告/STATE变更，执行UTF-8、事实、链接、差异和源码Hash核对，未重跑此前544项离线回归。文档提交在独立工作树完成并推送同一审查分支，现用de127b3工作树的HEAD、构建和启动器保持不变；未停服、清锁、操作飞书或读取正式.env。

结论：**这个已有已提交文件、旧创建审批已过期、准确原句已在上下文、唯一有效预览下的edit与自然“确认”场景真实通过**。不外推任意编辑意图、其他确认句式、过期/重复确认、多目标、跨渠道或并发恢复的真实质量；这些仍按各自既有证据和限制处理。旧失败记录和其他历史验收结论不改判。
