# WorkThread 第一阶段交付记录

日期：2026-11-01（Asia/Shanghai）。基线为已合并 PR #2 的 `75b724f17d17a70ad51caf7c4697251259d7ef3c`，本地开发分支为 `codex/workthread-foundation`。已按用户授权发布到功能分支并创建[PR #3](https://github.com/DongRuibo/Persistent-Personal-Agent/pull/3)供审查；暂不合并main，不操作正式运行环境。

## 已实现的范围

WorkThread 表示持续存在的工作主题，由当前本机 Web 用户手动创建、改名、归档/恢复，关联已有 Goal、Task、Run、Memory，或移除关系。关联允许同一对象属于多个主题；调整归属可显式移除旧关系并添加新关系，每一步单独提交。归档只影响主题能否新增关联，不暂停原业务。

不增加模型工具、Router、Worker、并行调度、事件订阅、自动归类或 Chain of Recall；Pi Session、GoalRunner、Scheduler、Memory 写入和 OperationGuard 的实现未改。新功能不调用模型，不写长期知识，不把对象关联视为业务操作授权或文件预览 ACK。

## 数据模型与模块边界

| 表 | 字段与约束 | 目的 |
| --- | --- | --- |
| `work_threads` | `id` UUID主键、`owner`、`channel`、`title`、`status=active/archived`、UTC `createdAt/updatedAt` | 主题本身与可信Web归属；名称最多120字符 |
| `work_links` | `threadId`外键、`kind=goal/task/run/memory`、`objectId`、`source=user`、UTC `createdAt`；主键`(threadId,kind,objectId)` | 仅保存对象引用、显式来源与时间，不保存对象正文、状态、Session内容或Memory副本 |

- 复用应用的 `SqliteStore` 连接与事务，`CREATE TABLE/INDEX IF NOT EXISTS` 增量迁移。关闭开关也建空表或保留已有表，不回填、改写或自动关联旧对象。
- `WorkThreadStore`只管理主题和关系，检查主题归属并事务去重；`WorkThreadService`是宿主对象关联入口，检查原对象存在性与访问权。服务使用固定可信Web身份，HTTP不接受owner、target或channel参数。
- Task复用target匹配；Goal复用原Goal actor查询；Run复用`WebUiStore.ownsRun`；Memory复用宿主查询服务，要求来源为web且来源Run属于当前Web身份。来源缺失或无法确认的Memory不被猜测归属。
- 每次读取关系仍从原服务取当前元数据，不因关系授予额外权限。原对象删除、Goal关闭或权限变化时返回`object: null`；关系ID保留，可显式移除。Memory查询仍遵循原服务的Markdown检查/索引修复逻辑，关联层不写知识正文。
- DTO独立放在`work-thread-types.ts`，前端无需引入Node SQLite类型。模型没有新增工具，关联接口也没有执行、批准、续跑或写Memory能力。

## Web API与界面

所有接口沿用原Web登录、Cookie、精确Origin、CSRF及限流，关闭`WORK_THREADS_ENABLED`时均返回404（未登录仍401）。字符串/枚举/UUID只在HTTP入口校验，内部传递确定类型的值。

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/work-threads` | 当前工作空间主题列表 |
| `POST /api/work-threads` | `{id,title}`创建；相同ID与名称幂等返回，冲突名称409 |
| `GET /api/work-threads/:id` | 主题及关联；后续宿主可按稳定ID查询 |
| `POST /api/work-threads/:id` | `{title?,status?}`明确调整主题；拒绝空变更 |
| `POST /api/work-threads/:id/links` | `{kind,objectId,action:link/unlink}`；重复关联不增加记录，移除不存在的本人关系为幂等空操作 |
| `GET /api/work-objects/:kind` | 当前身份可见的候选元数据，至多100项 |

“工作主题”页面复用工作台导航、面板、登录与API客户端；提供创建、选择、改名、归档/恢复、按类型添加与移除关联。关闭时导航隐藏，直接进入页面也不显示主题数据。原生选择框过滤已关联对象；原对象状态通过“刷新主题”更新。移动端导航适配增加的一项，旧的六项导航布局保持可用。

## 修改文件与目的

| 文件 | 目的 |
| --- | --- |
| `src/work-thread-types.ts`、`src/work-thread-store.ts`、`src/work-thread-service.ts` | 新的主题/关系类型、增量表、归属检查及原对象查询 |
| `src/sqlite-store.ts` | 在原应用库初始化两张新表，复用事务 |
| `src/config.ts`、`src/main.ts` | 默认关闭开关及向Web宿主注入现有Memory查询服务 |
| `src/web-ui-channel.ts`、`src/web-ui-server.ts`、`src/web-ui-types.ts` | 有条件组装服务、能力标志、经认证/CSRF保护的API及业务错误响应 |
| `web/src/work-threads.tsx`、`web/src/main.tsx`、`web/src/style.css` | 主题页面、导航入口与窄屏排版 |
| `tests/work-threads.test.ts` | 迁移、四类关联、重复、归属、开关、删除后读取及审批边界测试 |
| `tests/helpers/web-ui-fixture.ts`、`tests/web-ui-process.test.ts` | 显式测试开关、真实进程启动与重启持久化验证 |
| `scripts/preview-web-ui.ts` | 原离线预览可通过环境开关开启主题页面，仍用临时数据和模拟模型 |
| `.env.example`、`README.md`、`docs/PROJECT.md`、`docs/STATE.md`、本记录 | 开关、操作说明、稳定模型与本轮验证交接 |

## 实际验证

Mac arm64，Node 24.19.0 / npm 11.17.0。未读取正式 `.env`、数据库、Session、Memory正文或备份；未启用正式功能、运行飞书或发起收费模型/Tavily请求。以下均为新临时SQLite/Markdown与本机模拟API。

| 检查 | 结果与证据 |
| --- | --- |
| `npm run typecheck` | 通过，后端/测试类型检查 |
| `npm run build` | 通过 |
| `npm run web:build` | 通过，保留2条已有lucide `use client`警告；JS约390kB、gzip约120kB |
| 新增WorkThread用例 | 10/10通过；四类关联、重复去重、错误ID、跨身份/渠道拒绝、实时原状态、删除Memory后不可用、可控调整和文件审批不被绕过 |
| 实际`--web-ui`进程 | 关闭/开启2种配置通过；默认接口关闭，开启后主题与Task关系跨真正进程停止/重启保留，同库锁仍有效 |
| 旧数据库 | 无WorkThread的Task/Run表增量迁移；原记录字段和结果不变，外键检查通过，关系重开仍在 |
| `TMPDIR=/private/tmp npm test` | **588/588通过，0失败、0跳过，约73.54秒**；原577项回归及新增11项全部通过 |
| 浏览器 | 临时合成样本完成创建→关联四类对象→改名→归档/恢复→移除/重新关联→页面刷新后恢复；未出现其他渠道任务，重复项不再列为候选 |
| 界面与副作用 | 1280px桌面与390px窄屏均无横向溢出；控制台warn/error为空；退出临时预览时统计模型请求0、错误0 |

首次测试暴露的是夹具先结束Run再创建Goal/文件提议的非法顺序；修正夹具以遵循原服务要求，未放宽生产授权逻辑。首次前端类型检查暴露Node SQLite类型混入问题，已拆出纯DTO类型文件。最终检查结果以上表为准。

原始日志、合成样本截图与diff仅保留本机，不提交测试数据或截图到仓库。重新验证和离线体验命令统一见[README](../../README.md#workthread工作主题与关联默认关闭)。

发布前按已验证清单核对21个交付文件Hash，全部一致；此次仅更新发布交接文档和修正未发布本地文档的引用，不重复全量回归。提交内容另核对路径、敏感模式、UTF-8、冲突标记与文档链接。

本机Git的HTTPS凭据不可用、SSH主机尚未信任，因此通过已连接的GitHub工具发布。远端功能提交`8134e34119e97224aeae3d8c6fb9be164b3767d4`与本地原提交`d54eeebfa8c417627b037704a3b5349cd24a9f35`共享Git树`1849cd78d0ae9297f81643d36a47b37483ff597c`，21个文件的blob SHA逐一相同；不同SHA仅来自提交元数据。本地原提交保留，未绕过SSH主机校验或修改main。

## 剩余边界与交接

- 只支持当前本机Web工作空间；没有跨渠道身份合并、自动数据迁移或正式历史回填。Memory来源缺失时不可关联，关联删除不会删除知识。
- 当前上限为100主题（含归档）、每主题100关联、每类100候选；无分页、主题删除、自动清理或历史关联审计。名称不是唯一键，相同名称可以对应不同主题ID。
- 本轮证明的是离线机制与合成样本界面。未验证正式历史规模、真实手机、长期运行或收费模型语义；上一阶段真实Web文件审批等缺口不因此改判。
- 原未提交的`docs/personal-agent-roadmap.md`及`docs/evaluations/web-app-v1-pr2-merge-review.md`未修改且不随本PR发布。STATE仅更新当前阶段、验证和审查交接信息。
- 已发布到`codex/workthread-foundation`并创建[PR #3](https://github.com/DongRuibo/Persistent-Personal-Agent/pull/3)供审查；暂不合并main。main继续停在75b724f；下一阶段Router/Worker/事件/Recall需独立任务授权。
