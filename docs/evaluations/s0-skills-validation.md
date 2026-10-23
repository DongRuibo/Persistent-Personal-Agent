# S0 原生 Skills MVP 验证记录

开发基线：121e83e9a679bfccf646bca0597ccc2a274f34eb。日期2026-10-23。仅隔离虚构数据、真实SQLite、原版Pi1.3.0与本机模拟模型，不是收费模型或正式启用验收。原V3.0.1自然暂停与操作收据误解仍开放，原报告不改。

证据根目录：`E:/AgentWork/validation/personal-agent-s0-skills-20261023`。每轮命令日志独立保存，不覆盖失败或历史验收库。

## S0-A

已完成默认关闭开关、专用宿主批准清单/包Hash、原生SDK发现与解析、受限原生read、Console只读列表/详情、两份自包含纯文本Skill与停服批准入口。未开启Shell、通用文件、Web、MCP或任何外部写工具。

Chat累计正文读取最多8192字节，保存在原生Session custom entry，跨重启保留；重复读取照样计额度，避免把失败读取或被裁剪内容当成已加载。每轮read最多2次，分页拒绝；额度不足只返回拒绝收据，普通聊天与原工具照常可用。主Loop与辅助意图/Memory改写共享每轮8次HTTP硬限，自动重试关闭。只读包文件仍属低信任内容，写入继续受原Guard验证。

最终Windows256项：253通过、0失败、3原平台跳过；typecheck/build/test/eval:memory/eval:formation均退出0（s0-a/09–13）。7项新增测试覆盖真实PiExecutor原生目录→read→下一请求正文、越权无回退、Session额度重启、次数/取消/禁用/Hash、junction/硬链接及已有Task/Memory权限。所有模型请求均为本机桩。

原始失败：01-skills.log中junction已拒绝但错误分类为不支持资源，修复为文件分类前显式拒绝链接，02专项通过；03-typecheck.log保留原生ToolDefinition测试上下文签名不匹配，补齐测试上下文后04通过。初次适配还遇到SDK工具泛型方差，使用SDK公开defineTool统一类型，没有更改SDK或降低类型检查。

## S0-B

宿主把模型可选skillId映射为已批准包的ID/version/Hash，写入可选Plan绑定并纳入原草稿/正式Plan Hash；每步最多一个。原生结果Schema拒绝模型提供路径/Hash。用户明确指定时不得被模型换包或省略；当前步骤改用/移除Skill沿用revise_plan，只形成新草稿，成功展示并明确审批后才生效。普通“使用某技术”不能被扩大为绑定请求。

旧JSON不回填，完成步骤的旧绑定/定义/成果保留；数量约束、身份/清单/TTL/版本校验仍走旧Guard。批准前在事务外重新核对包，禁用/升级不能通过旧展示批准，事务内继续CAS。未新增DDL。

Windows261项258通过、0失败、3原平台跳过；typecheck/build/test/两个eval均退出0（s0-b/04–08）。新增5项覆盖自动/明确选择、非法字段、数量、显示/投递、禁用、改绑/移除及已完成成果。02-bindings.log保留测试夹具漏传Guard引用状态导致的两项失败；补齐原API必需参数后03五项通过，未放宽预期。

## S0-C 与最终平台回归

S0-C已完成。真实Console服务/Guard调用、真实SQLite、原版Pi Session和本机HTTP模型验证：创建→原生候选目录→提议绑定→完整展示/批准→原生/skill展开→单HTTP片段→Checkpoint→等待→关闭并重开SQLite与Session→继续→用户确认完成。Execution冻结ID/version/Hash/原始Skill文本，inputHash跨重启不变；临时副本正常释放，不使用无限Session或自建Loop。

主动场景验证固定Skill、真实Policy/Trigger/Grant消费、每触发有限续段、全局调用预算及跨重启账本。通知模拟失败后仅Outbox重投，不重跑片段。升级或禁用后拒绝旧Hash，已批准包不可用时领取前阻塞，不创建额外Execution或消费预算；明确改选/展示/重批新版本后恢复。暂停/取消迟到结果discarded，运行中禁用拒绝Checkpoint，退出/策略撤销中止请求，持久running恢复阻塞。非法工具提议、JSON错误、冻结文本篡改、原生展开结构不符或超容量均不重试。

新增测试合计21项，基线249项保留。最终使用**Node24.19.0**：

| 平台 | typecheck | build | npm test | eval:memory | eval:formation |
| --- | --- | --- | --- | --- | --- |
| Windows | 0 | 0 | 270项：267通过/0失败/3原平台跳过 | 0 | 0 |
| 隔离Linux | 0 | 0 | 270项：270通过/0失败/0跳过 | 0 | 0 |

表中0为命令退出码，不是得分。Windows保留的3项为Memory POSIX权限、当前账户不能创建普通符号链接、POSIX SIGTERM进程恢复；Linux全部实际执行。新增Windows junction及硬链接拒绝测试实际通过，不能据此宣称完整Windows ACL已验。

Linux使用新node:24.19.0-bookworm-slim容器，cpuset=0,1、内存3GiB；只复制白名单源码/测试/配置/文档，无.env、正式数据或宿主挂载。npm ci --ignore-scripts后断开bridge，测试时仅本机loopback，最终容器已停止。118份源码/测试/脚本/配置原始SHA256与Windows逐项一致，Windows完成后复核仍0变化，见source-hashes.json及linux/final/source-verification.json。

Memory默认离线12个可回答样本Top1/Recall@5/MRR均0.75，无答案误supported=0；Formation开发/留出各30/30、未经批准写入0、真实API请求0，跨平台一致。Schema/模拟模型通过不等于模型语义质量通过。

## 原始失败与环境记录

- s0-c/01-typecheck.log：门外准备后局部变量重名，重命名通知阶段局部引用后02通过，未重构调度器。
- s0-c/04-integration.log：升级后重批无法领取、展开失败原因被通用中断覆盖两项失败。根因分别为领取前把Step错误标blocked，以及内部abort覆盖新的边界错误。修复为尚未领取Step保留pending，仅阻塞Goal；新的PiBoundaryError保留具体原因。05两类共12项通过，06补上退出/撤销后8项集成通过；冻结预期未放宽。
- 早期A/B/C Windows命令实际使用系统Node24.12.0（低于项目>=24.15.0），日志原样保留。最终显式使用已有bundled Node24.19.0，PATH仅对测试进程生效，重新运行五关；没有修改系统Node或配置。最终证据以windows-final为准，早期阶段日志不能冒充受支持版本验收。

## 证据与复核

[机器摘要](s0-skills-validation.json)记录平台、退出码、计数、日志Hash、默认开关与开放问题。最终目录为windows-final和linux/final，早期阶段及失败分别在s0-a/b/c，不覆盖。关键Hash：

| 证据 | SHA-256 |
| --- | --- |
| source-hashes.json | 93aa3e19ada4f84bcc1ee0563036d3d032bc485b5268578e9dc666399fe7ccf3 |
| windows-final/test.log | 74b9df846d383f3f94c54e10334acb1f842396ee1a47f916c6605aa131983a1c |
| linux/final/test.log | e1cbbe02fe4e7eb86f4942d42499bfcc90ac868191c6db7d67d552832128f1f8 |

运行入口与停服安装/审批/更新步骤见[README](../../README.md#s0pi-原生-skills默认关闭)。自动化演示可直接执行 `node --import tsx --test tests/skills.test.ts tests/goal-skills.test.ts tests/goal-skills-integration.test.ts`；不会读取.env或连接真实账号。源代码、依赖和测试夹具Hash可按机器摘要复核。

## 安全边界与剩余限制

本轮可以认定**S0工程MVP的隔离自动化验收完成**，不是正式主动执行或真实模型质量验收。SKILLS_ENABLED、GOAL_ENABLED、PROACTIVE_ENABLED默认仍false，Formation未启用；收费API、真实账号/飞书/手机、正式.env/正式数据/历史数据库操作均0，无新增依赖、DDL、SDK修改或远端推送。

Host批准文件属于单用户可信配置，工具白名单不构成OS沙箱，不能抵御同账户恶意进程/管理员替换文件。包更新必须停服重新批准、重启；无在线安装/热启用。Chat历史及已展开正文不删除，过去内容不授予新权限；累计正文额度不会自动重置。极端磁盘故障或崩溃可能留下私有运行副本，但恢复不扫描或自动执行它们。新字段向前读取旧数据，不保证旧二进制安全降级运行新Skill库；回退需对应备份。

包Hash按实际UTF-8文本字节及资源/profile清单计算，不归一化行尾；跨平台复制改变字节时按包升级重新核对、审批，不能沿用旧Hash静默替换。

S0不提供通用Shell、文件写、Web、Browser、MCP、Sandbox、Computer Use或发布。Goal仍text_only/零工具/一段一次HTTP；等待、失败、未知结果、权限/预算不足都停止。旧Task/手动Goal的通知可能失败，策略Outbox也不保证exactly-once或必达，未扩展为通用副作用队列。

**V3.0.1自然暂停与主模型收据解释真实失败保持开放**；新增Skills真实自动选择/遵循、真实主动执行、飞书渠道、Windows ACL、原生Mac和长期运行均未验。下一步先交代码/报告给ChatGPT审查，再另行决定隔离真实复验，不消费旧48/5或16/2账本。
