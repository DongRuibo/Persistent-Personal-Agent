# Pi 1.3.0 原生 Skills 隔离技术验证

日期：2026-10-23。性质：架构调研的一次性技术验证，**不是 Skills 产品功能、真实模型或正式主动执行验收**。基线 main `553526038a44cf0c07091c604991ac1503b3b09d`；生产源码、依赖和 SDK 均未修改。

## 方法与结果

使用仓库实际安装的 `@earendil-works/pi-coding-agent@1.3.0`、Windows Node24.19.0 和[可复现脚本](fixtures/pi-native-skills-spike.mjs)。只使用SDK公开包根导出，不导入私有路径或修改node_modules。脚本创建新临时目录：一个虚构Skill、一份参考、未批准的虚构默认目录及模拟私有文件；模型端点仅 `127.0.0.1` 的HTTP服务，凭据为固定fake值，内存认证、无全局配置、无自动重试/压缩/遥测。

最终运行9项通过、0失败；本次最终运行6个本机模拟模型HTTP，收费0。另有一轮相同检查通过，后补公开parseSkillBlock断言和收窄测试名称后再运行最终版，两轮累计12个本机HTTP；不是12次收费请求，也没有API收费重试。启动阶段的一次导入失败发生在创建HTTP服务前，未消耗请求。

| 检查 | 实际证据 |
| --- | --- |
| 原生API/解析/目录隔离 | `loadSkills(...includeDefaults:false)` 与 `DefaultResourceLoader(noSkills:true,additionalSkillPaths:[批准目录])` 均只发现fictional-study；未加载虚构默认目录和任何扩展 |
| 原生目录/正文分离 | tools为空时systemPrompt无目录；受限read启用时有name/description/path，无正文标记 |
| 原版Loop按需加载 | 首个HTTP有目录但无正文；模拟模型请求read后，第二HTTP包含正文和工具结果；实际工具清单只有read，观察到agent_settled |
| 越权拒绝/同名覆盖 | 模拟模型实际请求批准目录之外的虚构私有文件，第二HTTP含DENIED_SKILL_PATH、不含其正文标记；证明没有回落到内置任意read |
| 负例与取消 | 原始路径穿越、未批准文件、目录、junction/符号链接别名及已取消signal拒绝；Windows实际创建并检查junction，未使用正式文件 |
| 参考读取 | 已批准参考经SDK原生read格式化返回，未新写文件解析器 |
| 零工具显式激活 | `session.prompt('/skill:fictional-study ...',{expandPromptTemplates:true})` 一次HTTP得到正文，无工具；公开parseSkillBlock可识别实际展开块 |
| 当前适配限制 | 时间前缀＋expandPromptTemplates=false的一次HTTP不含正文，不能把当前getSkills改非空就宣称接通 |
| 禁用过滤 | 原生skillsOverride过滤后getSkills返回空；这里只证明目录过滤，不声称已测试Goal授权撤销 |

模拟模型返回预置工具调用和文本，证明的是SDK与宿主适配接缝；**没有证明真实模型理解description、自动选对Skill、遵循正文或拒绝提示注入的质量**。

## 发现与设计影响

1. 原生发现、frontmatter解析、目录呈现、read工具Schema/格式化、工具循环和显式Skill展开均能复用，无需独立Skill解析器或Agent Loop。
2. read提供公开ReadOperations，但SDK会在调用access前解析/探测路径；必须在execute入口先校验原始路径，只读获准快照。目录/cwd本身不是沙箱，SDK自带read的50KiB输出上限也不是产品预算。
3. customTools中同名read在1.3.0会覆盖内置实现，需用实际越权调用验证。每次SDK升级都应复验；不能仅检查getActiveToolNames里有read。
4. Chat原生按需正文至少需要工具结果后的下一模型轮；Goal保持text_only/一次HTTP时，应在已审批范围内用原生显式展开，不静默给主动策略加read。
5. 显式展开不经过read工具；只有宿主登记的批准路径可进入loader，产品需用执行副本/Hash和发模型前校验保证没有未知名称/读取失败的静默回退。该产品校验尚未实现。

推荐方案、三种执行场景、首批范围、拟改文件、预算与恢复测试详见[设计](../designs/skills-tools-architecture.md)。

## 原始记录与复现

原始证据根目录：`E:/AgentWork/validation/personal-agent-skills-sdk-20261023`。`01-initial-import-failure.log`保存首版脚本误用CommonJS require.resolve解析只提供ESM import导出的SDK而失败的完整记录；修正为标准ESM import，不改SDK、不放宽断言。`02-first-pass-report.json / payloads.json`及`03-final-report.json / payloads.json`分别保留两个完成运行，未覆盖首轮记录。

最终临时资料：`C:/Users/Dongr/AppData/Local/Temp/pi-native-skills-spike-CV1hpa`，内含report.json与payloads.json，仅虚构内容，未读取正式.env/Task/Session/Memory/历史验收数据库。脚本不自动清理，方便复核；HTTP服务和各Session结束时正常关闭。

| 文件 | SHA-256 |
| --- | --- |
| `docs/evaluations/fixtures/pi-native-skills-spike.mjs` | `01720CB8E8B646CB21F00B197E16D19169D11BB17935BE04F106C68F1157E904` |
| `01-initial-import-failure.log` | `F49A727F01C8D42E15FC34995F7133D1E290A74ED75C77778DE7CFA282B2DC50` |
| `03-final-report.json` | `FBE6979DDA37A2D425FCD52EB8D180E7094BF05E8AFFC7C672BA5E1CC2EF3506` |
| `03-final-payloads.json` | `E8CE332D63B8AD8BC8674D02790A57F3A8B6C387C2F10089327269C2D7DD40F6` |

在安装了仓库锁定依赖的工作树中执行：

```powershell
node docs/evaluations/fixtures/pi-native-skills-spike.mjs
```

每次复现创建全新临时目录和本机随机端口，输出其证据位置，不读取.env、不连接正式账号。Node须满足项目运行要求；Windows需允许临时junction，本次实际通过。

## 未验证项

没有接入产品Chat、Goal/Policy/Grant/SQLite、持久Session额度或Checkpoint；没有测试产品的热禁用、包升级、故障窗口或真实语义。受限读取原型基于明确文件映射和内存字节，不是完整跨平台安装器/ACL/并发路径替换防护的证明。

没有执行整套typecheck/build/npm test/两个eval、Linux或手机测试，因为本轮未修改产品代码；现有调度回归不重跑。没有开放Shell、任意文件写、Browser、Computer Use、MCP或外部发布，GOAL_ENABLED和PROACTIVE_ENABLED默认值不变。V3.0.1自然暂停及收据解释原始失败继续保留，不能被这9项检查抵消。
