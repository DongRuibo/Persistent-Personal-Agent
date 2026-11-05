# 持续主题 N1：存储与默认关闭接缝

2026-11-03。状态：独立R1 PASS，0阻断/0本轮finding；本报告不是N2—N5或真实语义验收。用户已批准N0本地提交后依次实施N1—N5，逐阶段独立审查。唯一执行树`topic-session-routing`，分支`codex/topic-session-routing`，基线`ca1f6737d730565bdc41c9b18909a05de3ae88bf`；本轮没有新提交/推送/合并或实例切换。

## 实现及冻结契约

- `work_threads.description`默认空串，最多480字的简短范围；`chatContextKey`默认NULL。旧组织主题不自动升级，旧create语义保留，INSERT改显式列名。绑定复用owner/channel校验，活跃主题已绑定则稳定回读；首次绑定由宿主生成`topic-<UUID>`，不接受模型路径或key，不把key作为身份。
- `web_ui_chats.topicSessions`为接收时0/1快照，`topicRouteJson`默认NULL。旧库原行默认0/NULL；原消息、Run、Job状态及WorkLinks不复制、不重分类。原同UUID接收幂等优先容量，开关变化不产生冲突；正文/原模式冲突仍拒绝，新旧模式共用原八条等待容量。
- 新`TopicRouteChoice`仅daily/use/create/clarify；未知输入在`freezeTopicRoute`入口严格字段/类型/UUID/文字边界校验一次。标题120字、简介480字、依据及澄清问题各240字；外部输入含owner、路径、contextKey或`bindUnbound`等额外字段拒绝。N1没有模型调用/语义解析器。
- `freezeTopicRoute(actor, requestId, input, now, explicitThreadId?)`复用原同连接SQLite事务：先核对本人主题模式请求，再创建或绑定主题并写原请求route。use只含threadId/reason；旧未绑定主题要求可信宿主`explicitThreadId`等于该主题ID。该参数不来自外部模型字段；N3须核实当前用户明确选用事实。新主题无需另一个许可ID。
- 冻结结果为daily、clarify，或topic（threadId/contextKey/标题与简介快照/有界依据/原use或create选择）。重复同选择只读原结果，冲突拒绝；标题后来改名不改旧快照。错误/越权/归档ID拒绝，写route故障同时回滚新主题或旧主题绑定。首次Session只能在此事务成功之后打开，本阶段没有打开主题Session。
- `WORK_TOPIC_SESSIONS_ENABLED=false`，严格布尔、依赖Coordinator及其依赖、仅本机Web。N1开启后新模式仅接收等待；现有生产`start()`只领取旧模式，**不执行主题请求**。旧未绑定主题及普通日常请求行为保持。已接收新模式关闭后仍能原GET/POST同UUID只读、查询及撤回，submit旧路径明确拒绝重解释。
- 原`POST /api/chat`以前按Coordinator/WorkRouter/submit分流；现在统一进receive。非Coordinator新请求仍receive→submit（与原WorkRouter的chat分支一致）；已接收主题请求在依赖开关关闭后先回读原收据，避免进入旧Chat。原鉴权、CSRF、字段及文本入口检查保留。无UI新增或权限放宽。

`claim(owner, now, topicSessions=false)`第三参数是**精确接收模式筛选**，N1生产只用默认false；true仅用于存储验收，不代表“包含两种模式”。N3正式开启时必须按原createdAt/rowid顺序统一领取当时可执行旧/新模式，关闭时只跳过主题模式；不能简单把功能开关传入该参数，不能新增第二队列。

## 实际验证

证据根：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n1/worker/`。精确命令、环境、退出码在`commands.jsonl`；各命令对应`*-source.json`和原始日志，最终含untracked的完整diff与manifest在`delivery/`。

- 最终`affected-frozen`：18个测试文件 **261/261**，0失败/取消/跳过，35352.371875ms，exit0。覆盖新增8项、配置/非Web启动拒绝、原WorkThread/WorkJob/Web/路由建议/Coordinator/工作续接/Worker及子进程恢复。新旧测试组计数不重复相加。
- 新增8项：临时旧SQLite迁移原行/正文/状态/WorkLinks/Run/Job逐字段一致；旧主题默认未绑定；新主题与route同事务/UUID幂等/真实关闭重开；daily和clarify零主题；精确领取筛选；显式绑定与稳定key、owner/channel及错误/归档拒绝；触发器故障新主题和旧绑定双向回滚；非法外部字段/有界文字与撤回拒绝；真实Web开关关闭/重开/收据/撤回和旧Chat兼容；原八条容量共用。真实Web专项的主题请求模型调用0，另一个旧日常请求实际localhost假模型HTTP1，不是收费请求。
- `npm run typecheck`、`npm run build`均exit0；`node node_modules/typescript/bin/tsc -p web/tsconfig.json`共享前端类型检查exit0。未改前端实现，未跑Vite构建/浏览器；全量npm test和N0 29项不在N1重复运行，按N5统一验收。
- 首次修前`first-red`因原schema无description列而exit1，保留原日志及测试Hash。`storage-1`6项存储通过，Web因localhost沙箱EPERM失败；随后准确Web命令获权限后1/1通过，环境失败未当业务失败。
- `affected-1`157项中156通过，唯一失败是既有迁移测试精确字面量没有新增默认字段。只在原断言增`topicSessions:0/topicRoute:null`，原正文/状态/Run/模式核对保留。扩展后261/261，再将旧主题绑定许可从未知输入改为可信宿主参数，最终同组261/261复验通过；旧日志不覆盖。

## 独立R1结论

独立28/28、0失败/取消/跳过、2067.017209ms，另自编全关闭HTTP1/1、1960.201208ms；两组分别报告、不相加。全依赖关闭后已冻结topic收据回读/正文冲突/snapshot/撤回重投零重执行，另一个新旧Chat1次localhost假HTTP；typecheck/diff-check均exit0。原261同源日志、435文件manifest、2113项SDK已独立只读审计。Reviewer首轮localhost沙箱EPERM保留，准确放行后通过；未重复Worker build或261。见[独立报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/n1/reviewer-r1/review.md)。审后只补本报告/STATE，业务和测试Hash不变；N1基线另存`n1/delivery-final/`，不改旧证据。Planner已批准开始N2接缝调查，主要代码待方案核定。

## 交接边界

N2主题Session/原生压缩/预算计量，N3语义路由，N4原工作继承/单输入UI，N5整体回归尚未实现。本阶段开关不适合日常试用：显式开启后新模式消息会等待直到后续接线或用户撤回。N2继续遵守N0公开SDK冻结约束，N3不能将存储许可参数当模型自证或把精确筛选参数误当统一队列开关。

依赖仅从已授权N0树使用macOS APFS `cp -cR`复制独立实体，不symlink/hardlink共享可写缓存；未改SDK或依赖版本。所有测试使用`TMPDIR=/private/tmp`；未读正式.env/密钥/数据库/Memory/Session，未操作保留试用实例，不调用收费模型。N1已独立R1通过，后续仅按Planner核定阶段继续；N2主要接线方案仍须核定。
