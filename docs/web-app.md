# Web App V1 本地使用

本版只绑定 `127.0.0.1`，不部署、不与飞书共用数据。需要 Node >=24.15.0（Windows离线验证为24.19.0）、npm。先进入本PR独立代码目录，执行 `npm ci`、`npm run build`、`npm run web:build`。

## macOS日常启动

在本分支代码目录运行：

```bash
npm run web:local
```

命令自动构建前后端、复用Git主项目`.env`的四项`LLM_*`模型连接字段（不会加载其他字段），随后打开默认浏览器并自动登录，无需输入Web访问密钥或Tavily Key。已在环境中提供模型配置时优先使用；脚本不写回任何密钥。原`web:start`仍为手工配置入口。

日常数据固定在Git主项目`data/web-ui`，不在临时目录；重复运行只打开已运行的实例，不启动第二个Agent。保持启动终端打开，按回车可重新自动登录，`Ctrl+C`正常停止，之后使用同一命令恢复。初次Mac运行会建立独立工作空间，不自动导入旧Windows数据，也不沿用飞书库。默认真实Chat/Task/手动Goal及免费Tavily可用；主动策略、Formation、Skills、固定Web目录、本地文件读写保持关闭。

下方无Key离线命令仅供检查界面。日常聊天请使用`web:local`。自动登录沿用原60秒一次性入口和Cookie/CSRF；本机私有Unix socket仅用于让已运行的启动器再次打开网页，不传递模型或Web密钥。

## 无Key的离线检查

```powershell
npm run web:preview:offline
```

打开输出的本机URL，使用命令输出的固定测试密钥登录。预览使用新建临时SQLite/Session/Memory、原版Pi SDK及仅127.0.0.1的模拟模型，不读.env，不联网调用真实模型，不启动飞书。数据保留在系统临时目录，重启命令会创建新的临时数据。Ctrl+C停止。

可测试聊天和代码块显示；发送“10分钟后提醒我休息一下”会经原Guard创建任务。测试文件审批时发送：

```text
本次允许创建输出文件：answer.md
请生成一份离线检查文档，先展示预览，等我确认。
```

模拟模型会提出固定测试正文。到审批页核对、等待预览展示ACK，再点击“确认执行”并在对话框授权；最终状态来自宿主账本。模拟器只覆盖这些有限回复，不代表真实模型会同样选工具或理解意图。其他Task/Goal/Memory权限与边界由自动化测试覆盖。

## 连接操作者自己的模型配置

日常使用已配置的本机启动器时，双击`start-web.cmd`即可自动登录并在默认浏览器打开聊天页；服务已运行时再次双击只打开现有工作台。退出登录或会话过期后也用同一入口，无需输入、复制或记住网页登录密钥。当前机器入口及数据位置见[STATE](STATE.md)。

启动器在内存中持有独立Web密钥，通过`POST /api/launch`签发60秒内有效、一次性的浏览器入口；兑换后创建原有HttpOnly/SameSite会话并跳转`/#chat`。密钥不写入浏览器、文件或剪贴板；一次性入口不得作为书签或分享，重新签发、消费或服务重启后旧入口失效。普通API、Origin/CSRF、展示ACK和审批Guard保持原有校验。

以下为**手动配置方式**。页面的“手动登录（高级）”保留兼容原有访问密钥，不是日常启动器用户的必填步骤。不要复制完整正式飞书.env或沿用其数据库配置，勿将密钥粘贴到聊天。PowerShell中安全输入Key：

```powershell
$env:WEB_UI_ENABLED = 'true'
$env:WEB_UI_HOST = '127.0.0.1'
$env:WEB_UI_PORT = '4317'
$env:WEB_UI_DATA_DIR = 'E:/AgentWork/web-trial/w1-new'
# 选择全新空目录；后续用同一目录恢复。三项数据路径由Web入口固定派生。
Remove-Item Env:DATABASE_PATH, Env:SESSION_DIR, Env:MEMORY_DIR -ErrorAction SilentlyContinue
$webAccessSecret = Read-Host '输入独立Web随机访问密钥（至少32字节）' -AsSecureString
$env:WEB_UI_ACCESS_KEY = [System.Net.NetworkCredential]::new('', $webAccessSecret).Password
$modelAccessSecret = Read-Host '输入LLM API Key' -AsSecureString
$env:LLM_API_KEY = [System.Net.NetworkCredential]::new('', $modelAccessSecret).Password
$env:LLM_PROVIDER = 'openai'
$env:LLM_MODEL = '<你的模型ID>'
# 使用兼容端点时配置此值；使用Pi原生Provider时清除此环境变量。
$env:LLM_BASE_URL = 'https://<你的兼容端点>/v1'
$env:USER_TIMEZONE = 'Asia/Shanghai'
$env:GOAL_ENABLED = 'true'
$env:PROACTIVE_ENABLED = 'false'
$env:MEMORY_FORMATION_ENABLED = 'false'
$env:MEMORY_QUERY_REWRITE = 'false'
$env:SKILLS_ENABLED = 'false'
$env:WEB_READ_ENABLED = 'false'
$env:LOCAL_FILES_ENABLED = 'false'
$env:LOCAL_FILES_SEARCH_ENABLED = 'false'
$env:LOCAL_FILES_WRITE_ENABLED = 'false'
npm run web:start
```

访问 [本机工作台](http://127.0.0.1:4317)。登录会话12小时、最多4个，重启后需重新登录；聊天和业务状态跨重启恢复。`WEB_UI_DATA_DIR`固定派生 `agent.db`、`sessions/`、`memory/`，拒绝非Web已有目录和不同路径覆盖，数据库及Memory仍持独占锁。Ctrl+C等待正常停止；不要对同一数据根再启动第二个调度器。`web:start/web:dev`不自动加载任何.env。普通Chat仍可能多次模型请求，没有新增人民币账单硬上限。

Skills、受控资料读取和文件输出继续使用原有人工批准方式，默认关闭。要测试T3，先选择**此前不存在、在Git与应用数据目录之外**的输出目录：

```powershell
node dist/file-output-admin.js 'E:/AgentWork/web-output/w1-new'
$env:LOCAL_FILES_WRITE_ENABLED = 'true'
$env:LOCAL_FILES_OUTPUT = 'E:/AgentWork/web-output/w1-new'
npm run web:start
```

不要将这个输出根放在 `WEB_UI_DATA_DIR` 下。编辑仅针对同一Web身份通过T3创建、身份及Hash仍匹配的文件，格式和完整限制见[T3说明](t2b-t3-trial.md)。后台不获得任何文件工具。

## 自动联网与来源

网页普通聊天默认接入 Tavily 免费免 Key 模式，保留现有聊天模型。直接询问需要新资料的问题，或给出公开网页链接要求分析即可；Agent按需调用`web_search`和`web_fetch`，不逐次要求确认。启动环境中设置`WEB_SEARCH_ENABLED=false`可关闭。原`WEB_READ_ENABLED`仍只控制固定目录`web_get`，与新能力独立。离线预览仍使用模拟模型，默认不接外网搜索。

无需Tavily账号或Key；只向固定Search/Extract端点发送必要搜索词/所选网址，不发送模型Key或整段聊天记录。搜索词由模型生成，可能包含当前问题相关信息，不保证自动匿名化。仅允许读取当前用户提供或本轮搜索返回的公开HTTP(S)网址；入口拒绝凭据、本机/内网及非公网DNS，远端正文提取由Tavily完成。不支持登录网站、上传文件或浏览器交互。

每轮最多4次Tavily请求、搜索最多5条来源、每次读取一个网页；单次15秒、响应体1 MiB、单页正文16 KiB、每轮工具结果24 KiB上限。模型Context中新增网页正文只保留最近24 KiB，旧结果保留出处及省略标记，Pi持久Session不改写。正文可能因限额截断，不将摘要当全文。其他工具、原模型次数上限及审批Guard保持原样。

对话显示搜索/读取状态和失败原因；完成后展开“查看网页来源”取得链接、获取时间及节选说明。来源沿用原鉴权Run详情API按需加载，snapshot仅状态/次数/来源数量，均不传网页正文。来源元数据存于原`run_events`，刷新/重启不重放搜索，查看来源不产生文件/Goal审批授权。

Tavily[官方免Key模式](https://docs.tavily.com/documentation/keyless)免费但有限流，不保证无限可用。限流后本轮停止后续Tavily请求；其他超时/失败明确返回，不自动重试或切换收费方式。聊天模型仍按原服务商计费。接入及实际验证见[报告](evaluations/tavily-web-integration.md)。

## 行为与限制

- Chat提交持久化请求ID和Run后返回，结果轮询。一次只接纳一个前台请求；断连不会取消模型，重试同一ID不重放。页面刷新只查询历史，不能自动重发。失败或中断需先核对状态，有副作用时不保证外部恰好一次。
- Task/Goal创建、取消、继续、暂停和计划批准通过对话及原Guard，不通过直接数据库写API。Goal详情只读；未开启Goal时明确显示关闭。Web后台Goal入箱不当成用户已看见计划，需要Chat重新查看后批准。
- 每3秒的snapshot轮询只带文件ID、文件名、状态、时间、Hash及展示ACK等元数据；文件提议在Chat/活动中显示详情入口，不随轮询重复返回冻结预览。打开具体审批详情才GET现有文件详情API，期间状态仍由元数据轮询更新。读取详情不等于ACK，更不等于同意执行。
- 文件预览是账本冻结正文及结构化原生Diff。客户端可见渲染后ACK，宿主核对Run/Hash记录展示；ACK不等于用户同意，也不是已经阅读全部文字的证明。确认/拒绝再进入原Guard核验身份、5分钟TTL、来源完整预览及投递、Hash和一次消费。过期/消费/failed/uncertain均不可再批；uncertain须人工核对，不自动修复或重试。
- 任务结果先提交，再存入应用收件箱。Task通知同时按到达时间在对话中显示为“任务提醒”，包含任务事项、原始结果和发送时间；从同一持久记录投影，刷新不会重复创建消息或调用模型，也不会将后台结果混入Pi交互Session。查看状态沿用收件箱，需用户明确标记；普通入箱不建立文件或Goal计划展示ACK。页面可见时由原3秒轮询更新；Web Push、系统弹窗及iPhone推送未实现。入箱失败不重跑Task/Goal，Task结果仍可从Run查看；旧Task/手动Goal无新增必达保证。
- 列表最多100项、文件最多60项，没有分页。Chat/Run长输出显示最多32768字符，节选不自动ACK；Checkpoint正文最多16000字符。Session完整JSONL、原始表、内部路径和凭据不导出。没有Memory浏览器管理页面，Memory操作仅走原聊天工具。
- Markdown不执行原始HTML，不加载远程图片；站点限制同源脚本/请求。HTTP回环Cookie为HttpOnly/SameSite=Strict，状态变更强制Origin+CSRF；登录10次/分钟、全部请求600次/分钟、写请求90次/分钟，JSON最多32KiB。应用不将访问密钥写入URL、localStorage/sessionStorage或构建产物；登录表单和输入框请求关闭自动完成，但浏览器或密码管理器仍可能提示保存，由用户自行选择。
- PWA只有Manifest、192/512图标、standalone与移动安全区。无Service Worker，不缓存API/Chat/Memory/审批，也不提供断网刷新启动。页面连接状态依据实际本机API请求，不以浏览器的外网联网标志禁用本机操作；连接失败不影响已保存记录，轮询恢复只重新查询，不自动重发操作，手动刷新仍可用。只在PC回环服务，iPhone/LAN/HTTPS实机使用不在本轮范围。

更新本分支后，请退出并重新启动自己的本地Web预览，再刷新浏览器，使前后端使用同一版API投影；不需要操作飞书服务。

## 检查命令

```powershell
npm run typecheck
npm run build
npm run web:build
npm test
npm run eval:memory
npm run eval:formation
```

前端开发可另开终端运行 `npm run web:watch`，后端运行 `npm run web:dev`；在同源后端URL检查，构建完成后手动刷新。避免另开Vite跨源代理，以保持与生产相同的Origin/CSRF行为。自动化全部使用模拟模型和临时数据，实际结果见[STATE](STATE.md)。
