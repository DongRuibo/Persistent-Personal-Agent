# S1-A 受控只读 Web 实施与验证

日期：2026-10-23。基线fd4bc856ef26e7482c05d251e39af4773eb40707。**S1-A1/A2/A3工程与隔离自动化完成，可交付代码审查；正式能力未启用，真实体验未验收。** 仅本地阶段提交，不推送；无收费模型、正式站点Web获取/账号、飞书或正式配置/数据操作。V3.0.1真实暂停及收据失败保留。

## 阶段关卡

| 阶段 | 实际结果 |
| --- | --- |
| A1宿主网络服务 | Windows Node24.19.0，typecheck/build/test及两个eval退出0；332项329通过、3原平台跳过；网络专项30/30 |
| A2原生Pi Chat授权与工具 | Windows Node24.19.0五关均0；357项354通过、3原平台跳过；Web专项55/55 |
| A3最终Windows | Node24.19.0五关均0；387项384通过/0失败/3原平台跳过；Web专项85/85 |
| A3最终Linux | Node24.19.0五关均0；387项387通过/0失败/0跳过；新容器network=none、无宿主挂载、2CPU/3GiB，已停 |

证据根目录 `E:/AgentWork/validation/personal-agent-s1-web-20261023-180629`。最终日志为windows-final-2和linux-final；机器摘要/日志Hash见[s1-web-validation.json](s1-web-validation.json)。A1=36dca0c、A2=a77c729，A3见本分支最终Git记录。各阶段日志独立保留，Formation使用`--output`写入本轮目录，不覆盖历史评测。

首轮双平台385项也通过，但随后新增后台通知竞争子用例，定位并修复确认隔离问题；因此保留首轮source-hashes.json/windows-final/linux-initial，再用新的source-hashes-final.json重新运行两平台全部五关。**最终387项是修复后的实际运行，不用旧通过结果代替新增用例。**

两平台137份文件Hash一致，包括133份项目代码/测试/配置/脚本/Skill及4份安装SDK文件；最终检查后再次复核未变。清单SHA256为 `7b5d06b69cbb9022761fd54e8e378a80a92d2c62d35b3aebf6c3de6b859d8f01`。Linux只复制明确列出的源码和同lockfile的既有Linux依赖，不复制正式.env、数据、Session或HANDOFF，不执行新安装/联网；没有修改SDK/node_modules。测试TLS私钥为公开虚构材料，不是正式凭据。

Windows3项跳过沿用原POSIX私有权限位、账户普通符号链接权限及POSIX SIGTERM；新junction、硬链接、强杀子进程和本机TLS实际运行。Linux全部执行。Memory固定eval仍Top1/Recall@5/MRR=0.75、无答案误supported=0；Formation开发/留出各30/30、未经批准写入0、API请求0。不把离线机制指标当真实语义质量。

## 已知原始失败与修复

- 测试证书初次生成退出1，当时stderr未留存，不能声称已独立确认具体系统原因；使用专用虚构测试配置后成功。没有改正式OpenSSL或安装系统证书，证书/私钥仅测试、公开、不含正式凭据。
- A1首轮typecheck拒绝HTTPS类型中未声明的autoSelectFamily属性；保留失败日志。改用受支持的固定family=4/6和唯一lookup结果，不回退DNS或地址族；真实本机TLS验证通过。
- A2首轮类型检查遇SQLite输出值可能undefined，明确转换受控runId后通过。首次端到端中“读取文档，并总结”被过度保守地送去确认，导致直接授权场景未发请求；支持该明确连接形式后预期不变、回归通过。
- A2额外反例暴露自由用途后缀误授权：“请读取 Pi Skills 文档，并总结这个指令只是一次演示”曾发出一次**本机模拟GET**。a2-authorization-before.log保留11项9通过/2失败（含父项）；用途改为封闭短句，其他复合表达先确认，不放宽预期。最终专项55/55。

A2为保证权限先落库而同步接上最小web_read_calls，实际网络在短预留事务之后；没有先用内存许可上线。A3继续完成故障、并发、重启与预算专项，不将A2已绿等同全部恢复验收通过。

- A3非法宿主时间反例发现NaN日期没有被拒绝，可能插入不合格预留时间；a3-recovery-01.log保留失败。增加规范UTC时间验证及完整缓存元数据校验，13项恢复专项通过；损坏的Hash/时间/额外trust字段不回退联网修复。
- A3传输层地址漂移反例：测试替换底层连接依赖，使实际IP偏离已验证地址。旧代码收到响应后才拒绝，a3-tls-before.log记录本机GET=9而应为8。改用公开异步Agent.createConnection，TLS/实际IP通过前不交付socket给HTTP，原预期不变并通过；没有关闭TLS验证或加生产内网开关。
- A3跨界面反例：Web待确认后，“确认”可借旧Goal草稿视图批准计划，a3-cross-confirmation-before.log记录planRevision=1而应为0。Web处理清除冲突的旧视图/确认，不改Goal四表或状态语义。
- 追加异步竞争反例：后台Goal通知在Web等待确认时重投影视图，“同意读取”被错误提议为Goal批准。a3-late-confirmation-before.log保留失败；在建立本轮请求上下文前也隔离冲突视图。最终Web专项85/85及两平台387项重跑通过。此修复只覆盖新Web流程，不修改原V3.0.1真实失败结论。

## 端到端调用链与数据

当前可信Channel/Run → OperationGuard当前原话/目录匹配 → 直接许可或真实来源展示/成功投递后确认 → Pi原生web_get → 同库许可/预算短事务 → DNS及TLS/实际IP → 一次GET → 严格UTF-8快照提交 → 低信任ToolResult → 下一原生模型请求 → 原Channel发送。

新增仅web_read_calls及一个索引，复用runs/run_events/model_calls。记录runId/permitId、owner/channel、资源与目录Hash、请求Hash/期限、预留/状态、时间、snapshotJson及错误；完整快照包含URL/版本/读取时间/contentHash/实际字节。Run和permit各唯一，不造聊天Run、不创建Goal Grant。已有Goal/Plan/Checkpoint、Task唯一执行及Memory写入口不变。

调用状态reserved→succeeded/failed/interrupted，终态不自动重试。许可和32768字节预留先提交，网络不在事务或后台门内；同次重复只可返回合法原快照或拒绝。启动在原独占锁后恢复reserved为interrupted，保留消费记录，模型/通知失败不重取。迁移为幂等增量创建表，旧数据不回填；正式升级仍需停服备份，本任务没有运行正式库迁移。

## 已执行的关键场景

- 默认关闭无Web工具/DNS/GET；自然语言唯一标题授权，无需内部ID；下次真实Pi模拟HTTP实际包含正文和低信任标记，SQLite来源/Hash/字节一致。
- 不明确时展示真实URL、用途及外发范围；同身份/渠道、版本/Hash、Run内容/宿主事件/投递均合法且5分钟内才确认。否定/引用/假设/URL/多目标/错误ID、未投递/过期/错渠道/伪展示/目录升级禁用均零联网。
- DNS私网/特殊网段、混合答案、编码/映射、单次解析及固定连接；真实本机TLS的证书链/主机名错误、代理、重定向、压缩/类型、超头/超正文、慢流/总超时保守失败。生产没有localhost开关，测试用独立Resolver/Transport与公开虚构CA。
- 真实SQLite双连接证明网络等待时其他写事务可提交，重复预留只产生一次GET；失败20次耗尽UTC日20次/640KiB预留，重启不退款，次日才允许新授权。
- DNS等待取消、宿主撤销/过期/Run结束的迟到正文、预留或提交事务失败均不提交未知正文、不自动重取。真实Pi运行中中断不产生第二模型请求；强杀真实Pi子进程后恢复旧Session/SQLite，普通聊天不重放获取。
- 模型失败、投递失败、重复工具调用及重启不重取；Web正文8KiB额度跨Session恢复，超额只拒绝新获取，完整32KiB仍存SQLite并明确标注节选。
- 网页注入不能写Task/Memory/Goal，旧审批不会借Web确认；Skills/Web共享八次模型HTTP；Task/Goal实际模型payload仍零工具，旧Formation/Session/V3调度完整回归。

## 文件与演示

核心新增web-read-types/service/store/authorization及web-tools；修改config/.env.example、main、PiExecutor、OperationGuard、SqliteStore。新增四个web测试文件、两个测试helper和虚构TLS材料。README/PROJECT/STATE及S1设计维护实际边界；没有新依赖、框架、队列、独立数据库或S1-B绑定字段。

无需Key/正式.env的演示及只读SQL见[README](../../README.md)。直接运行 `node --import tsx --test tests/web-*.test.ts`，使用真实SDK/SQLite、本机服务及虚构数据。最小真实模型体验、正式Web网络及飞书另行授权，不把测试桩当真实体验。

## 安全边界与剩余限制

WEB_READ_ENABLED、SKILLS_ENABLED、GOAL_ENABLED、PROACTIVE_ENABLED及Formation默认关闭。Web仅Chat固定公开UTF-8文本，不是通用HTTP代理/爬虫；没有任意URL、搜索、HTML解析、登录、Shell、任意文件、MCP、Sandbox、Computer Use、外部写操作或S1-B。Goal/Policy仍text_only、零Web工具。

自然语言匹配有边界，少见标题/复合表达会多一次确认；不承诺通用语义理解，模型可能漏工具或误述收据，需按账本/ToolResult核验。仅首个合格IP，无网络回退/重试；严格类型、大小、UTF-8和无重定向可能拒绝真实合法站点。只读GET也会被服务端记录，不宣称外部恰好一次或消息必达。

正文/调用记录持久保留，关闭开关不会删除历史，暂无自动清理。Session与SQLite无跨存储事务，崩溃保守消耗预算；普通Chat仍受既有上下文/payload上限。新Web不在DB事务/BackgroundLane内等网络，但整个当前Chat仍遵循既有前台优先规则，后台可能等待当前对话结束。工具白名单不是OS沙箱，同账户恶意改盘不在保证内。

取消/10秒截止停止宿主等待及后续HTTP；系统dns.lookup本身不保证立刻终止，可能延迟进程完全退出。迟到DNS结果已验证不会触发GET，不把协作式取消宣称为撤销已经发生的网络访问。

真实模型理解、正式站点/代理网络、真实飞书/手机、Windows ACL、原生Mac和长期运行均未验收。[S0真实体验预算](s0-console-live-experience-plan.md)尚未授权，本轮收费请求0。[V3.0.1自然暂停/收据真实失败](v3.0.1-live-retest.md)继续作为正式主动执行启用前门槛，没有标记通过。
