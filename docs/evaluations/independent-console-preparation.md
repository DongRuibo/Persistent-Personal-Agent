# P/R/S独立小规模Console复验：准备交付

2026-10-25（Asia/Shanghai）。基线`9ee11ede17be60ee3d9895ad815c555317a461ac`；独立分支`codex/independent-console-prep`。**准备及离线质量关卡完成，真实执行未获授权、未启动。** [冻结方案](independent-console-live-plan.md)包含6条确切话术、每Case前置/预期/停止、证据格式和未来启动模板。[机器证据](independent-console-preparation.json)保存实际日志、Hash及审批范围。

## 范围与关键差异

| 文件 | 改动及必要性 |
| --- | --- |
| `scripts/independent-console-cases.ts` | 冻结P1/P2/P3、R1/R2、S1，分别14/12/4次与¥2.31/1.98/0.66；整轮30/5、零GET；预计20次 |
| `scripts/independent-console-budget.ts` | 本轮新scope总账本，Case/组/整轮同时限额、发送前原子预留、失败不退款、跨进程累计、独占锁与共同故障持久停止。已完成Case不能重发，未知在途/pending不自动清理；一组业务失败不消费或封禁其他组 |
| `scripts/independent-console-acceptance.ts` | 复用现有stagedAudit、脱敏响应留证及原main；三个独立业务/Session目录、分组批准包、固定模型POST白名单、零Web工具/GET、每Case一条输入及正常退出。P3验证P2本次实际投递视图及TTL；R记录按时间点可查的工具/Session/Checkpoint；S把routingObserved与机械成功分开 |
| `tests/independent-console.test.ts` | 默认拒绝、冻结话术、限额/计费/容量、独立失败、重启与锁/pending/配置变化、GET拒绝和请求/响应留证写入故障 |
| `tests/independent-console-flow.test.ts` | 原版Pi、真实SQLite、实际Console子进程及本机模拟模型验证六Case；私有组/Session隔离、P2有效视图反例、R异步提交、S真实read及不read评分、语义失败后独立S、共同HTTP失败后整轮停止 |
| `docs/STATE.md`、本报告/JSON及冻结方案 | 更新准备交接与审批要求，不改历史报告或真实结论 |

没有修改`src/`、Skill包、Pi SDK/Agent Loop、依赖、正式开关或产品权限。旧staged/integrated入口、旧方案与旧失败报告保持原Hash，不把新30/5额度写进旧账本。新增代码只是此份冻结复验的宿主入口，不是新的产品工作流或通用评测平台。

## 入口行为与边界

- P只打开Goal，Skills/Web关闭；R只批准interview-practice；S只批准agent-notes 1.0.1、Goal/Web关闭。各组数据库、Memory和原生Session不共享，一份新总账本串行锁住全轮。正式环境不启用能力。
- 只有当前Case冻结原话可发送；模型、端点、请求体/输出、工具和后台范围不符时发送前拒绝。额外stdin不进入产品。所有GET在传输前拒绝；没有Web服务回退。原Chat权限校验、Goal一次授权、Plan/Step/CAS/Checkpoint和只读Skill边界不变。
- 既有P2视图必须是本次P2成功Run、唯一完整同身份/Console、Goal revision/draftHash仍一致，TTL内才可P3；不手工造Goal，不刷新视图补测。R1草稿也必须真实显示、版本有效后才可R2。操作者审阅声明不是模型授权，不代替数据库前置。
- 预算记录在每次实际发送前fsync/原子替换；网络失败/状态未知不退款，重启不清零。旧scope、根/模型/费率/代码/方案/Node变化、账本或身份/写入/进程安全故障阻止后续请求。业务、模型语义失败或已知Case/组额度正常耗尽，在正常停服后可让其他独立组继续；只有总闸或计数/写入等共同故障锁住整轮。
- R2的原始模型解释须按它收到的ToolResult时间点单独审查；宿主正确覆盖和稍后提交的正式题目不能替此前模型误解洗绿。S正确回答但没有read时，可分别记用户任务通过、路由指标失败；Mock按预期调用read不能证明真实选择率。

## 实际离线结果

证据目录：`E:/AgentWork/validation/personal-agent-independent-console-prep-20261025`。

- Windows typecheck、build、npm test、eval:memory、eval:formation均退出0。全量486项：483通过、0失败、3项既有平台跳过。
- 新增6项专项在全量中全部通过：5项预算/入口边界，加1项跨进程链路。成功模拟轮六Case共20次本机模型HTTP、零GET；加“不read”“P仅口头未创建但S仍能独立完成”“HTTP500整轮停止”“R单Case第8次发送前拒绝但P仍独立继续”等独立反例合计36次本机HTTP，均不是收费模型消费。
- 六Case使用真实自然语言工具调用创建Goal，没有向SQLite插入目标。P2唯一视图覆盖过期、错revision、多目标、跨身份/渠道、未投递、错draftHash及旧Run反例；R后台零工具、单次请求并提交partial、引用旧Checkpoint；三个Session用户数3/2/1、组间旧Goal上下文未串入S，P业务/Session不被R/S改写。
- 请求上限、费用、未知缓存价/附加费、64KiB/4096（后台32KiB）、发送前留账、失败不退、跨重启、Case重复、共同停服、GET/错误URL零发送、请求写失败和响应留证失败均有反例。response500原文保留；不依赖发送后再拒绝。
- A2归属、编造产物覆盖/原文保留、Session收据、Skill版本/Hash升级阻塞、read路径/容量/取消及低信任资料不授权写入，复用已存在的A2/B1、Skills、Goal和Web回归，没有重复开发产品修复。
- Memory eval为offline-lexical、模型调用0；Formation固定开发/留出窗各30/30、API0，写入本证据目录的新输出，不覆盖历史评测。
- 三项跳过：POSIX私有权限位、Windows账户不具备的符号链接权限、POSIX SIGTERM优雅退出。Docker Linux engine不可用，WSL只有Stopped的docker-desktop，Linux未运行；未启动服务或下载安装环境，不沿用旧Linux结果。

初始失败日志全部保留：typecheck-initial.log记录新入口类型约束错误，已修复；flow-initial.log和flow-diagnostic.log检出留证ReadableStream在Pi正常结束取消后仍close已取消controller，错误触发共同停止。修复仅区分正常消费者cancel与真实读/写失败，并保留最早停止原因；flow-stream-fix.log及最终全量通过，响应写入失败的硬停止反例仍有效。没有修改冻结原话、重放历史库或放宽消费限制。一个只读临时调试导出因Python默认编码失败，改用UTF-8读取；未产生网络调用。自检另外区分了已知组限额不足与共同账本故障，补充发送前拒绝及实际进程跨组继续反例后重跑五关；初版485项和最终486项日志均保留，未提高任何额度。

## 证据与工作树

源码清单、方案/入口/Case Hash、可应用差异及日志Hash见机器报告和证据目录的source-manifest.json、preparation.patch、evidence-manifest.json。所有修改仅在本独立工作树；其余5个工作树HEAD/分支/已有改动和13份受保护仓库文件保持不变。历史验收数据库、预算账本及原始Session没有打开、迁移、覆盖或续跑；只读审计仅针对本轮新建Mock数据。

当前HEAD仍为9ee11ed，未提交、合并或推送；不部署、不连接飞书。真实模型、公网DNS/GET、收费均0；没有读取正式.env。测试用虚构Key/本机HTTP，正式安全配置与默认开关保持原样。

## 待一次性批准与剩余风险

下一次需要明确批准本方案的P1/P2/P3、R1/R2、S1，固定DeepSeek-V4.1-Flash及硅基流动兼容端点，**整轮最多30次物理HTTP、¥5保守预留、0公网GET**；其中P14次/¥2.31、R12次/¥1.98、S4次/¥0.66不互借。批准应指向审查后的固定Git提交与本方案Hash、新隔离根和Console范围。获批执行前还须重新核实官方/账号所有适用价格、确认无额外费，安全注入凭据并再次检查限额；不复用旧确认或余额。当前没有核价或试连。

真实模型可能漏工具、要求澄清、误解收据或不read；P2→P3可能因人工审阅太慢超TTL，届时停止且不刷新。文件/Session故障或账本不确定须人工审计，不自动恢复未知请求。保守预留不是供应商账单保证，当前没有Linux/Windows ACL或长期稳定性新证据。P/R/S各自只有限定样本，不能替代Web后选择、Skill/Web/Goal联合链路、反馈/取消/重启完整生命周期、手机/飞书或正式主动执行验收。

旧V3.0.1自然暂停与收据解释的真实失败继续开放。本轮交付后停止，等待审查及新的完整一次性授权；不直接启动真实复验。
