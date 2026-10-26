# T1 / T2-A 离线实现与验证

本轮基线`bcf4fcb711fe6b0dbcab327ea6079ba598cb26c4`，独立分支`codex/t1-t2a-readonly-files`，工作树`C:/Users/Dongr/.codex/worktrees/t1-t2a-readonly-files/Persistent Personal Agent`。仅离线开发；未提交、推送、合并或启用正式环境。完整命令、源码与SDK Hash、平台探测和保全核对见[机器证据](t1-t2a-offline-validation.json)。

## 实际实现与逐文件差异

| 文件 | 修改目的 |
| --- | --- |
| `src/config.ts` | 新增默认关闭LOCAL_FILES_ENABLED及显式绝对工作区；拒绝个人根目录、当前源码/数据/Skills重叠、UNC及Git仓库内目录；不读取正式.env |
| `src/local-file-service.ts` | 操作者批准清单；固定父目录/文件身份、Hash、大小；类型/链接及凭据限制、有界FD读取；不是通用文件框架 |
| `src/local-file-tools.ts` | 复用Pi1.3.0原生read/ls的schema、分页及呈现，注入受限access/readFile/exists/stat/readdir；当前请求授权、行范围/额度及无正文审计 |
| `src/local-files-admin.ts` | 仅宿主CLI批准明确的资料副本；wx不覆盖已有清单，未注册为Agent工具 |
| `src/pi-executor.ts` | 仅Chat启用read/ls；与Skills共用唯一read名及原8请求/64KiB预算；后台零工具，原生SDK实际白名单核对保留 |
| `tests/local-files.test.ts` | 6项原生工具/临时文件测试，含授权、越界、链接、替换、取消、额度和原生ls吞stat错误的反例 |
| `tests/local-files-pi.test.ts` | 4项原版Pi+SQLite+本机模型测试，含两个真实产品Skill包、共享循环额度、重启、正文注入及模拟飞书去重/投递 |
| `.env.example`、`README.md`、`docs/PROJECT.md` | 开关、运行边界与模块职责；不改正式配置 |
| `docs/t1-t2a-trial.md`、`docs/examples/t1-t2a-trial.ps1` | 独立T1/T2-A配置、未来人工Console/飞书步骤与T2-B前置；脚本仅建新目录、复制/批准虚构资料与现有Skill，不启动服务 |
| `docs/STATE.md`、本报告/JSON | 当前离线交接与证据，不修改历史真实报告 |

未修改SkillService、Skill安装批准/受限读取实现、两个Skill正文/版本、OperationGuard、Goal/Task状态机、Pi SDK、Agent Loop、package/lock或其他依赖。T1不是重新开发S0，只复用现有宿主批准机制与原生目录。

## 调用链和安全边界

当前已鉴权Chat原话 → 宿主固定资料目录/approved-files.json → 本轮明确文件或目录选择 → 唯一read/ls ToolDefinition → 注入操作重新核对路径/文件身份 → 有界FD读取及Hash检查 → 原生分页/清单格式 → 低信任ToolResult → 下一次本机模型请求。文件不进入Goal输入、不注册到后台；没有新增SQLite表。

原生read/ls均来自本机实际安装的1.3.0公开导出，使用read的access/readFile/detectImageMimeType与ls的exists/stat/readdir接口。没有复制分页/目录格式算法。宿主FD读取只为限制容量并核对打开对象，使用前后检查、文件身份与固定Hash，不能把cwd当沙箱。原生read解析先有元数据探测，故宿主在调用前拒绝非批准形态并固定ctx.cwd，正文只经受限注入操作。

ls原生实现会跳过stat异常；新反例强制在使用时校验失败，宿主保留异常并拒绝整个结果，避免悄悄返回部分成功。未知异常仅给通用错误；具体已知拒绝码进入metadata审计。正常源内容、ToolResult或历史Session不能增加当前文件授权；原Task/Memory/Goal写权限仍经现有Guard。Skill绝对批准路径与资料相对路径分流，拒绝不回退到内置任意read。

批准清单16文件/单文件32KiB/总128KiB；工具每轮4调用/2文件、单次8KiB/累计16KiB响应，含拒绝收据；原Chat主Loop和辅助请求共8次、请求体64KiB。资料只支持UTF-8 md/txt及最多4层相对路径，目录只投影批准条目。实际字节与相对路径进入Run Event，不重复保存正文；正文仍会进入原生Session和模型。所有开关默认关闭，配置脚本只在新的隔离进程显式设置。

## 实际离线结果

Windows Node24.19.0；最终产品源码综合SHA256（排序src/*.ts、package.json、package-lock.json的相对名和文件Hash）：

`0ebb3c11d52c2abfd21c8fd699c72b229d61b9680ee6efc380c3257de6c26627`

| 检查 | 实际结果 |
| --- | --- |
| npm run typecheck | 退出0，源与测试类型均通过 |
| npm run build | 退出0 |
| npm test | 513项：510通过、0失败、3既有Windows平台跳过；包括本轮10项新专项 |
| npm run eval:memory | 退出0，offline-lexical；Recall@5/Context Hit均0.75，supportedRecordPrecision=1，API0；不表示检索质量全部通过 |
| npm run eval:formation | 退出0，fixture30/30、holdout30/30、unauthorizedWrites0、API0；输出到独立证据目录，不覆盖历史报告 |
| 配置脚本 | PowerShell语法解析通过；在全新config-demo批准两个现有包和230字节虚构文件；正确设置隔离目录/开关，没有启动Agent |

第一轮专项连同原Skills测试50/50通过；之后补跨仓库目录拒绝，最终完整五关再次通过。保留首个typecheck失败日志：read分流参数类型为unknown导致TS2571，补明确类型后通过；该错误是实现期类型错误，没有真实消费或正式写入。重跑前日志用before-root-check前缀保留，不覆盖失败材料。

本机Docker Linux引擎管道不可用；WSL仅有docker-desktop，未启动/安装新环境，无Linux/Mac结果。3项跳过分别为POSIX私有权限位（Windows ACL未验证）、旧测试创建文件符号链接所需权限不足、POSIX SIGTERM优雅退出。新专项已实际验证NTFS junction与硬链接，但不能把它替代文件符号链接及其他平台验收。

原版Pi+SQLite/本机模型已验证：默认无文件工具；真实原生ls/read后正文进入下一请求；唯一工具名与宿主白名单匹配；两个既有Skill批准/Hash不变且read可共用；8请求总额度不叠加；原始资料恶意建议不能创建Task；重启不重放、不从旧Session继承文件授权；后台Task/Goal请求无工具；模拟飞书身份、重复消息、投递保持正确。Mock按预定调用只证明机制，不证明真实模型会自动选择Skill或正确理解任意资料。

## 证据与保全

外部证据目录：`E:/AgentWork/validation/personal-agent-t1-t2a-offline`。含最终五关log/JSON、首个类型失败、此前检查日志、SDK源码Hash、配置演示、平台探测、产品源码Hash及原工作区前后快照。最终`SHA256SUMS.json`另列本轮修改文件和证据Hash；`changes.patch`包含本轮差异，没有私有Session、数据库或.env。

原E盘工作树仍在bcf4fcb且仅原docs/STATE.md修改，其SHA256仍为`764190b8bce117ebde8803d9a85b1c8cb2949c06f2b9540912032566c6c6c3f4`；现用飞书启动器SHA256仍为`4509d93e3ae2d7dfd056c73d042e897decab2abe4fa1bce06f5c56af6fc6c419`。不读取其.env、SQLite、Memory或原生Session，不改变/停止其进程，也不读取或重写历史验收库与账本。

## 剩余限制与下一步

- 未做新真实模型或真实飞书试用，未使用任何旧额度。真实Skill选择、模型材料理解和手机交互尚需用户审查后另行启用；普通Chat没有整轮费用硬闸。
- 只用于操作者控制的本机脱敏资料副本。不是OS沙箱，不承诺抵御同账户恶意进程、挂载变化或同步OS调用阻塞；凭据过滤不能证明任意文本不含秘密。内容/目录替换或批准变化会拒绝，不能自动重批准或清Session。
- 最终请求体包含会话历史，超过64KiB时拒绝，不自动截断资料或重置Session；行范围限制的是返回，Hash核对仍读取完整的有界文件。
- grep/find默认涉及rg/fd子进程与可能工具取得；进程树、搜索范围/链接、输出和取消隔离未实现，作为T2-B明确前置，不注册默认工具绕过。
- 历史v2宿主等四维9/9、模型语义7/9，M5/M8及P1/N1失败不改；R2/S1/N3限定成功不外推。本轮结束后停止，未提交推送或正式切换飞书。
