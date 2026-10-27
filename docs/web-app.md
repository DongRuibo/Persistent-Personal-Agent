# Web App V1 本地使用

本版只绑定 `127.0.0.1`，不部署、不与飞书共用数据。需要 Node >=24.15.0（Windows离线验证为24.19.0）、npm。先进入本PR独立代码目录，执行 `npm ci`、`npm run build`、`npm run web:build`。

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

以下只提供命令，本次开发未连接真实模型。不要复制正式飞书.env或沿用其数据库配置，勿将密钥粘贴到聊天。PowerShell中安全输入Key：

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

## 行为与限制

- Chat提交持久化请求ID和Run后返回，结果轮询。一次只接纳一个前台请求；断连不会取消模型，重试同一ID不重放。页面刷新只查询历史，不能自动重发。失败或中断需先核对状态，有副作用时不保证外部恰好一次。
- Task/Goal创建、取消、继续、暂停和计划批准通过对话及原Guard，不通过直接数据库写API。Goal详情只读；未开启Goal时明确显示关闭。Web后台Goal入箱不当成用户已看见计划，需要Chat重新查看后批准。
- 文件预览是账本冻结正文及结构化原生Diff。客户端可见渲染后ACK，宿主核对Run/Hash记录展示；ACK不等于用户同意，也不是已经阅读全部文字的证明。确认/拒绝再进入原Guard核验身份、5分钟TTL、来源完整预览及投递、Hash和一次消费。过期/消费/failed/uncertain均不可再批；uncertain须人工核对，不自动修复或重试。
- 任务结果先提交，再存入应用收件箱。界面区分入箱和用户已查看，Web Push及iPhone推送未实现。入箱失败不重跑Task/Goal，Task结果仍可从Run查看；旧Task/手动Goal无新增必达保证。
- 列表最多100项、文件最多60项，没有分页。Chat/Run长输出显示最多32768字符，节选不自动ACK；Checkpoint正文最多16000字符。Session完整JSONL、原始表、内部路径和凭据不导出。没有Memory浏览器管理页面，Memory操作仅走原聊天工具。
- Markdown不执行原始HTML，不加载远程图片；站点限制同源脚本/请求。HTTP回环Cookie为HttpOnly/SameSite=Strict，状态变更强制Origin+CSRF；登录10次/分钟、全部请求600次/分钟、写请求90次/分钟，JSON最多32KiB。访问密钥不进URL、浏览器存储或构建产物。
- PWA只有Manifest、192/512图标、standalone与移动安全区。无Service Worker，不缓存API/Chat/Memory/审批，也不提供断网刷新启动；当前页面可显示离线提示。只在PC回环服务，iPhone/LAN/HTTPS实机使用不在本轮范围。

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
