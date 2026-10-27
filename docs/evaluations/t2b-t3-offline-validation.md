# T2-B + T3 离线开发交接

固定基线`5e9c66818a8aa171d9f72f587f4ff4f098a0d840`，独立分支`codex/t2b-t3-file-tools`，工作树`C:/Users/Dongr/.codex/worktrees/t2b-t3-file-tools/Persistent Personal Agent`。本轮只开发/模拟验证；未提交推送、合并main、收费、公网访问、读取正式.env或操作现有飞书。T2-A已发布审查树保持原样，不在其中继续写代码。

## 实际实现与调用链

T2-B：当前可信用户明确搜索目录 → LocalFileService批准清单及目录/文件身份 → 原生find自定义glob或宿主字面量grep → 有界Hash核对/匹配 → 低信任结果进入下一次原生Pi请求。find不调用默认fd；安装版grep的注入接口不能绕开ensureTool("rg")/spawn，故没有注册默认grep，而按本轮授权在小集合里逐行includes匹配。只支持简单glob及大小写敏感字面量，不做通用搜索引擎。

T3-A：当前用户明确创建路径 → 主模型通过原生write定义提议完整内容 → 注入mkdir/writeFile只处理内存 → Guard固定请求、文件和内容Hash → file_operations保存pending → 完整预览成功投递 → 用户单独确认ID+Hash → Guard/账本验证身份、来源Run、成功投递、5分钟TTL与未消费状态 → 先持久executing → 完整临时文件无覆盖发布 → committed及宿主收据。确认不发主模型请求，不把“模型说已批准”当授权。

T3-B：当前用户明确编辑已归属自己的输出文件 → 核对身份/旧Hash → 入口要求旧文本唯一精确命中 → Pi原生edit在内存替换/检查重叠/生成Diff → 固定旧身份/Hash、修改Hash、新内容Hash → 同样完整预览及确认 → 临时文件fsync、重验旧内容、rename替换 → 同库提交结果。批准后写入冻结的新内容，不再让模型重算，也不重复调用SDK执行编辑算法。

普通Chat、资料工具、Skill与输出工具的根目录和授权分别处理；输出不自动进入资料/Skill清单。后台Task/Goal/Proactive仍零工具，不改原Goal Plan/CAS/Checkpoint、Task一次性或Memory权限。

## 逐文件差异

| 文件 | 目的 |
| --- | --- |
| `src/local-file-service.ts` | 增加只投影批准集合的filesIn；导出既有路径/有界读取边界供输出复用，未重写读取算法 |
| `src/local-file-tools.ts` | 原生find注入、最小字面grep；搜索授权、结果/片段/扫描限制；复用read/ls调用和返回额度 |
| `src/config.ts`、`.env.example` | 独立默认关闭搜索/写入及专用输出配置；拒绝资料/应用数据/源码重叠、仓库及UNC |
| `src/file-operation-store.ts`、`src/sqlite-store.ts` | 原应用库单表增量迁移、同用户/渠道、预览投递与TTL、一次消费、结果归属、崩溃不重放 |
| `src/file-output-service.ts`、`src/file-output-admin.ts` | 人工初始化全新输出目录及身份marker；平铺md/txt、归属/Hash/容量、无覆盖创建、临时文件编辑与保守失败 |
| `src/file-output-tools.ts` | 公开Pi write/edit定义及注入内存操作；完整内容/原生Diff，拒绝宽松编辑兜底，不开放默认FS操作 |
| `src/operation-guard.ts` | 复用当前Frame/一次操作、清除跨模块模糊确认引用、独立确定性文件确认、最终权威结果与安全拒绝码 |
| `src/pi-executor.ts`、`src/main.ts` | 同库服务组装、仅Chat白名单、共用8请求/64KiB预算、公开Session文件收据且保留模型错误原文 |
| `tests/local-search.test.ts`、`tests/file-output.test.ts` | 新增12项定点测试；原版Pi、真实SQLite、本机模型、临时目录及故障注入 |
| `tests/helpers/skills-fixture.ts` | 复用原Fixture，传入同库文件账本以支持新可选能力，不创建新Harness |
| `docs/examples/t1-t2a-trial.ps1` | 旧隔离配置也明确关闭新开关，防止继承开启值；UTF-8 BOM和PowerShell解析通过 |
| `README.md`、`docs/PROJECT.md`、`docs/STATE.md`、`docs/t2b-t3-trial.md`、本报告/JSON | 当前事实、精简未来人工步骤与真实/离线边界；旧报告/冻结方案/历史数据不改 |

没有新增依赖、SDK源码改动、Agent Loop、Skill Loader、MCP、Shell、独立数据库或复杂编排。新表是文件操作的最小审批/审计账本，不替代Task/Goal状态。

## 验证与失败记录

Windows Node24.19.0，实际一次最终完整回归：

| 检查 | 结果 |
| --- | --- |
| npm run typecheck | 退出0，含测试类型 |
| npm run build | 退出0 |
| npm test | **525项：522通过、0失败、3既有平台跳过**；基线513项加12项定点测试 |
| npm run eval:memory | 退出0；offline-lexical Recall@5=0.75、ContextHit=0.75、supportedRecordPrecision=1；真实API0，不把退出0当检索质量全过 |
| npm run eval:formation | 退出0，development30/30、holdout30/30、未经授权写入0、真实API0；输出到新独立证据目录 |
| 配置/CLI冒烟 | 原PowerShell配置解析通过；新隔离config-demo安装两个既有Skill及虚构资料，单独初始化输出；正确开关/目录/账本核对，无Agent启动或模型调用 |

按顺序先T2-B及原read/ls定点14/14，再T3创建/编辑及搜索验证；最后统一完整五关。新用例覆盖：默认白名单、当前授权/引用/否定、越界/敏感名/容量、资料Hash/硬链接、无rg/fd子进程/网络、有限匹配/共用额度、原生结果进入下一请求、后台无工具；完整预览未写入、投递/身份/渠道/TTL/Hash、重复确认、原错误原文与收据；精确编辑/Diff/CRLF、批准后内容改变、临时写后再变化、无覆盖创建、取消/预取消、写入及SQLite完成失败、executing崩溃恢复和不重放。

保留实现期失败，未删除或修改预期：

- `t3-initial-typecheck.log`：原生ToolResult的structuredContent要求JSON值，原返回unknown及可选details类型不合；改为明确JSON文本并检查原生Diff结果。
- `t3-test-types.log`：测试调用公开工具接口时少传两个参数，补正确调用签名。
- `t3-tests-first-run.log`：错误身份反例误用了已结束Run，先被chatRun校验拦截；改用有效当前Run，让反例真正到达身份/渠道检查，未放宽期望。
- `t3-edge-tests.log`：Mock在取消后未重置调用计数，未提议第二次创建；修复Fixture计数，未改产品路由或预期。

恢复验证采用同进程关闭/重建PiExecutor与原生Session、真实SQLite恢复逻辑；没有把它冒充新的真实模型或完整跨OS进程验收，既有进程退出平台缺口仍保留。

最终源码Hash（排序src/*.ts、package.json、package-lock.json的相对路径和SHA256）：

`22667bf17e7c2808446bb724b12c61651a8e3021b719bc5017bed04206072259`

命令、单项源码/锁定SDK Hash、平台探测和保全结果见[机器JSON](t2b-t3-offline-validation.json)。原始离线日志及校验清单位于`E:/AgentWork/validation/personal-agent-t2b-t3-offline`，不把本地SQLite、Session或原始日志放入代码仓库。

## 安全边界及未验证项

- 搜索/写入分别默认关闭。当前请求必须明确范围；Skill、文件、历史Session、模型参数或“已批准”说法均不产生新许可。仅前台Chat，SDK活动工具名与宿主白名单仍逐次核对。
- 搜索仅批准的16文件/128KiB；read/ls/find/grep共4调用、8KiB单次/16KiB累计返回、128KiB原始读取预留。输出仅平铺非空UTF-8 md/txt、每文件8KiB、总16文件/128KiB，每轮一项提议/确认，预览上限24KiB；模型循环与现有Skills/Web共用8请求/64KiB，无单独叠加额度。
- 新建以完整临时文件无覆盖发布；编辑以旧身份/Hash校验及临时文件替换。Node没有跨进程文件Hash CAS，最终检查与rename间不能保证抵御外部并发写；要求运行中只有本进程写专用目录，外部编辑前停服。不是OS沙箱，不抵御同账户恶意进程或挂载变化。识别凭据过滤也不能证明任意文本不含秘密。
- FS与SQLite不能共同提交，executing预留在先；任何可能已提交但未完成持久记录的结果进入uncertain，阻塞后续写，不自动重试/删除/接管。崩溃恢复只标不确定，不从Session重放动作。正常重启仍核对原数据、审批投递和TTL。
- 预览/内容在私有操作库与原生Session持久化，事件只有元数据；未来正文会发给模型。普通Chat没有整轮费用硬闸，真实模型/飞书效果仍未验证，Mock工具选择不能作真实自动选择证据。
- Linux Docker引擎当前不可用，WSL仅docker-desktop；未安装/启动新环境，无Linux/Mac结果。3个既有Windows跳过仍为POSIX权限位/ACL、文件符号链接创建权限、POSIX SIGTERM优雅退出；临时NTFS硬链接/junction及本轮发布在Windows已实际测试。输出依赖硬链接/fsync/rename，FAT/exFAT/网络盘不在支持范围。
- 原E盘HEAD/改动状态/STATE与现用飞书启动器Hash前后一致；没有读正式.env、业务SQLite/Memory/Session或私人资料，没有操作现用进程。历史P1/N1与M5/M8失败、R2/S1/N3限定成功、v2四维9/9/语义7/9保持原判定。

本轮结束即停止：独立开发树未提交、未推送、不合并main，等待一次性审查和未来真实试用授权；不推进T4、Shell、MCP或新Agent架构。
