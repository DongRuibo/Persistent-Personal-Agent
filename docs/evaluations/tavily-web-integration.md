# Tavily 免费搜索与网页读取接入验证

日期：2026-10-30，Asia/Shanghai。工作分支 `codex/web-app-w1-mvp`，开发验证基线HEAD `1d21fcabfaa9a0f0057a8d03026447847a15f4a3`；开发完成当时未提交推送，2026-10-31用户另行授权交付现有PR #2分支。原有自动登录、连接状态和Task提醒等工作区改动保留。

## 实现与逐文件目的

| 文件 | 本次目的 |
| --- | --- |
| `src/tavily-service.ts` | 固定免Key Search/Extract请求；入口网址/DNS、响应结构/容量、失败及UTF-8正文截断 |
| `src/web-search-tools.ts` | 两项Pi公开工具；可信Web请求范围、当前来源、凭据阻止、每轮次数/文本预算、限流和事件元数据 |
| `src/web-search-types.ts` | 前后端共用结果、来源、调用记录和摘要DTO |
| `src/config.ts` | 解析独立`WEB_SEARCH_ENABLED`布尔开关 |
| `src/main.ts` | 仅Web启动默认启用并注入Tavily；其他启动渠道不注入 |
| `src/pi-executor.ts` | 注册普通Chat工具与说明；沿用8次模型上限；context只裁剪新增工具的历史正文副本 |
| `src/web-ui-channel.ts` | 从原run_events投影调用摘要；snapshot不带来源详情/正文，原Run详情按需返回来源 |
| `src/sqlite-store.ts` | 仅对新增tavily_call结构化事件逐字段脱敏后序列化，保留其他日志原行为 |
| `src/web-ui-types.ts` | WebRun新增可选摘要/详情，能力DTO增加webSearch |
| `web/src/web-sources.tsx` | 状态/失败说明、按需加载来源、展开缓存及获取时间 |
| `web/src/main.tsx` | 在现有聊天中挂接来源组件，工作台展示联网能力 |
| `web/src/style.css` | 新增来源区域的字号、链接颜色和长文本换行，其他布局不变 |
| `tests/tavily-web.test.ts` | 服务入口、免Key请求、响应、超时/限流及容量测试 |
| `tests/tavily-pi.test.ts` | 原Pi/临时SQLite/API工具循环、来源加载、恢复、额度、Context和原Guard集成验证 |
| `tests/helpers/web-ui-fixture.ts` | 可选注入模拟Tavily，默认仍保持原离线工具集 |
| `README.md`、`docs/web-app.md` | 默认启用/关闭方式、日常使用、免费限流和模型费用说明 |
| `docs/PROJECT.md`、`docs/STATE.md` | 已确认架构与最新验证状态 |
| 本报告、`tavily-web-live.json` | 改动清单、实际检查和公开问题的真实调用证据 |

未修改Pi SDK或Loop、OperationGuard、Task/Goal/Memory服务和审批提交；没有新表、依赖、MCP、付费Key配置或浏览器自动化。

## 自动化与环境

- Node `24.19.0`，Mac。原node_modules来自Windows，按原lock执行`npm ci`，package-lock不变，未手工改依赖源码。
- 最终`npm run typecheck`、`npm run build`、`npm run web:build`均退出0；前端仍有原lucide的两条use-client非阻断警告。
- 最终`TMPDIR=/private/tmp npm test`：**577通过，0失败，0跳过**，约69.81秒；其中新增定点14项。未重跑Memory/Formation eval。
- 沙箱禁止127.0.0.1监听，申请本机权限后运行集成测试；Mac的`/var`别名触发既有链接保护，测试改用真实临时路径，没有放宽生产Guard。
- 覆盖固定端点/无认证头、参数/凭据阻止、公开网址及DNS、空结果/格式错误/提取失败清单/来源不匹配、响应体1MiB、UTF-8截断、超时/取消、限流停止、每轮4次/24KiB、后台/其他渠道不注册、原写入Guard、来源读取不ACK、重复请求与重启不重放。
- 生产日志脱敏器下复现`token=...`使JSON闭合引号损坏，新增用例先红后绿；仅新事件逐字段脱敏，来源记录可正常恢复且示例凭据不留存。
- 多轮测试同时核对实际后续模型请求的网页正文不超过24KiB，以及Pi JSONL中原结果仍完整；其他消息与工具不改写。

## 浏览器检查

独立临时服务，使用模拟模型和模拟Tavily，与真实验证分开。已检查完成状态、来源/时间、展开缓存、刷新恢复，以及最终构建加载；浏览器error/warn为空。轮询只调用摘要投影，首次展开时详情投影计数由2增至3，关闭再展开及轮询仍为3。截图保存在本机`/private/tmp/ppa-tavily-ui.png`，不提交图片。

工具执行途中状态由有界事件进入原3秒轮询；不新增Token流式、SSE或后台推送。

## 真实模型与Tavily

独立新建Web SQLite/Session/Memory，仅只读主项目四项LLM配置；没有读取私人历史、加载完整.env、飞书操作或其他真实任务。使用正常`main --web-ui`与鉴权Web API，没有设置搜索开关，实际能力为true；Goal、Formation、Skills及本地文件等额外能力关闭。

- 用户问题1轮：询问Tavily当前免Key能力，并要求打开官方说明页核对。
- Run：`de8963b7-b6cf-4fc6-8d6b-7fb946fdc4f8`，结果`succeeded`。
- 模型自主生成3个不同查询，Search三次、Extract一次均成功，达到本轮4请求上限；没有请求重放或同查询自动重试。
- 实际读取`https://docs.tavily.com/documentation/keyless`，6722字节、未截断；持久工具结果正文Hash为`82dcc435c08381c23450cc3430a4bfc911ba8c102ee16c7d989965c40ec99482`。最终回答正确说明Search/Extract免费免Key且有限流，并引用该来源。
- 现有硅基流动`deepseek-ai/DeepSeek-V4.1-Flash`共5次模型响应，报告输入8307、输出388、cacheRead17920，cost=null；未查询账单，不能宣称模型免费。
- [公开原始结果和来源元数据](tavily-web-live.json)不含密钥或完整网页正文。真实检查后仅补充提取异常响应一致性校验、来源样式及结构化日志脱敏，最终全量覆盖；没有为此重复收费检查。

真实服务已正常停止。这个单问题样本验证接入闭环，不证明所有问题的搜索质量、站点可达性或长期稳定性。免费限流由Tavily决定；登录页/复杂站点提取失败如实显示，不切换收费方式。日常Web服务需从本工作区重新构建并启动后使用，未代替或迁移历史Windows运行实例。

## 提交推送前复核（2026-10-31）

- 本轮启动器语法、后端类型检查/构建、前端TypeScript/生产构建通过；完整`TMPDIR=/private/tmp npm test`577通过、0失败、0跳过，约67.05秒，含上文14项Tavily定点测试。
- 候选源码和报告经过路径、UTF-8及敏感模式核对；正式配置、聊天数据库、Session、Memory、恢复备份均不提交。只交付现有Web分支，不合并main，不新增真实模型或Tavily请求。
- 未重跑Memory/Formation eval或浏览器交互；上文2026-10-30的原始真实报告及计量不改写，也不将本轮离线复核冒充新的真实验收。
