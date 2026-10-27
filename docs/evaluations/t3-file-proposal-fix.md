# T3 文件提议最小离线修复（2026-10-27）

## 范围与结论

基线 `32d8687b62ffa2ec8e1568ac4a68c2ff012a8c3c`，独立分支 `codex/t3-proposal-contract-fix`。仅修复 Chat 的文件提议提示与未登记状态呈现，不修改 Pi SDK/Loop、Skill 包、授权规则、文件算法或数据库模型。离线修复阶段没有真实模型请求、收费、公网文档访问、正式配置读取、实例切换、Git 提交或推送。随后用户仅授权发布本轮7份文件至独立审查分支，交接见 STATE；不合并 main，不启动真实试用。

现有工具应由 Agent 自主选择。用户提供当前授权和内容要求，不需要知道 write/edit 名称。提议、宿主预览、用户确认、文件提交仍是原来的四个步骤；离线测试通过不等于真实模型自主选择已通过复验。

## 已确认的失败与原因边界

- 原 Run `a7fcfac8-22e1-4bf7-ab8f-25c9917013c2` 收到 `本次允许创建输出文件：summary.md`，原生 Session 工具快照包含 write；模型以 stop 正常返回纯文本“待批准预览”，没有工具调用、提议事件或 file_operations 记录，文件不存在。随后不完整确认由宿主拒绝，没有写入。
- 模型原文只有聊天草稿，却要求用户下一步确认。原 Guard 没有收到文件工具调用便直接返回这段文字，因此技术 Run succeeded 不能代表已登记提议。
- 原流程的“只生成预览”、Skill 的“不调用文件写入”与独立文件提议阶段没有明确分开。宿主 Chat 通用提示缺少文件阶段说明。Pi 1.3.0 使用 customPrompt 时不自动构造默认 tools/rules 段；工具 description 仍存在，但 promptGuidelines 不能代替实际系统提示。可以确认这些契约歧义，不能从单一样本确定各句对模型的因果贡献。

提取的脱敏响应在 [fixture](../../tests/fixtures/t3-file-text-preview.json)。原始 Session/SQLite 不迁移、不重放、不改写；测试使用原版 Pi、临时 SQLite、临时批准 Skill 与本机模拟模型。

| 原始证据 | SHA-256 |
| --- | --- |
| Session 条目 f1514df5（UTF-8 原行，不含换行） | `168072aacdfad83b74b2266091a4171abb051b6ac5ced13aa82664c2b81a7654` |
| 模型原文 / 原 Run.output（2261 UTF-8字节） | `55203cfb7179df65c0ee8c8cb767528a5453c7858517b221fb699f29721cf7ab` |

## 最小修改

- `src/pi-executor.ts`：仅在前台 Chat 且写开关开启时追加通用流程。明确 write/edit 调用只登记提议，模型应自主选择；Skill 整理和当前用户另行授权的文件提议分阶段，Skill 本身不提供任何权限。没有要求用户点名工具，没有设置强制调用或追加模型纠错。
- `src/operation-guard.ts`：当前创建/编辑授权没有实际文件工具提议时，输出权威“本轮未登记待批准文件操作”，将原回答标为未登记草稿/澄清；追加仅含状态的 host-file-result-v1 收据与 file_proposal_missing 事件。原模型回答仍留在原生 Session；不从聊天合成操作，不生成ID/Hash或确认权限，必要澄清保留。
- 新增3项测试和原始失败响应 fixture；人工说明区分宿主预览与聊天草稿，说明单行 Console 使用方式；STATE 更新交接。

没有修改 agent-notes 1.0.1/interview-practice 1.0.0、批准清单或旧冻结绑定。原试用中 agent-notes 正文 SHA-256 仍为 `b1a5570d9c0ad4c2f552e891014d28f9574f4c981e9cb2e984c31303d203d88a`。既有当前请求首行、否定拦截、身份/渠道、TTL、Hash、一次消费、后台零工具及默认关闭边界全部保留。

## 红绿与回归

| 检查 | 实际结果 |
| --- | --- |
| 新增回归，旧产品代码 | 0/3，3失败；原始红日志保留 |
| 修复后专项（新增3项及既有文件8项） | 11/11 |
| npm run typecheck / build | 均退出0 |
| npm test | 528项，525通过、0失败、3平台跳过 |
| npm run eval:memory | 退出0；Recall@5、ContextHit仍0.75，真实API0；不宣称质量全绿 |
| npm run eval:formation | 退出0；development与holdout各30/30，真实API0 |

新增测试验证：原口头预览不会登记操作；原文与独立状态收据保留并跨重启进入上下文；错误确认拒绝且无额外请求；真实 Pi 发向模拟模型的请求含文件阶段说明，已加载整理 Skill 后不点名工具的用户请求仍可形成受控提议，确认前文件不存在；用户确认零模型请求、一次创建；关闭能力或普通聊天不受新状态提示影响，必要澄清不丢失。

模拟模型依然由 Fixture 决定是否调用工具。它证明提示确实进入 SDK 请求与宿主边界正确，不能测出真实模型自主路由成功率。

Windows Node v24.19.0、Pi 1.3.0。3个既有缺口为 POSIX权限位、当前账户无符号链接创建权限、POSIX优雅SIGTERM恢复。Docker Linux引擎管道不存在，WSL仅停止的docker-desktop；未启动、安装环境，未声称Linux/Mac通过。

完整日志及机器证据：`E:/AgentWork/validation/t3-proposal-contract-fix-20261027/validation.json`；包含 red-tests.log、green-targeted.log、typecheck.log、build.log、tests.log、两个eval、平台检查及保全Hash。Formation脚本自动生成的旧报告副本已另存到本轮证据目录，并将新修复树中的该文件还原；历史报告未更新。

## 源码与保全

四份产品/测试输入文件 SHA-256 映射经键排序、紧凑JSON编码后计算 SHA-256：`c91ba4b2cef49182c36b953c7a4d6fa2b56d2bc47222566ba9e69ae002e82c5a`。逐文件Hash见 validation.json。

原 T2-B/T3 源码树保持干净，固定32d8687不变，49个原dist文件Hash全部一致；当前试用配置、Skill批准、虚构资料与初始化输出标记Hash一致。原失败Session条目和Run.output Hash复核不变。原E盘STATE、飞书启动器Hash及保存的stash均保留，没有停止或重启任何现有实例。

修复未切换到正在运行的 Console。审核后如需人工复验，应明确授权切换修复版本，继续使用普通 Console、自主工具选择与本人确认，不再要求用户手工指定 write/edit；不新增验收 Harness。模型仍可能漏调用或澄清，新的宿主状态会如实显示未登记；真实效果尚未验证。原P1/N1、M5/M8与其他历史结论均不变。
