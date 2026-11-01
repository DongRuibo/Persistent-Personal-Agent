# 路由建议2B离线验收

日期：2026-11-01。从main `91b7a657ddf62cf625c53f7bcfbddaa22aa6740b` 在隔离分支 `codex/work-core-stages` 实现，未提交、发布或启用正式功能。B1/B2 R1、B3 R2通过；B4完成后冻结等待独立终验。功能默认关闭，运行与限额见[README](../../README.md#路由建议-2b默认关闭)，持久契约见[设计](../designs/work-route-b1-contract.md)。

## 文件与目的

| 文件 | 目的 |
| --- | --- |
| `src/work-route-types.ts`、`src/work-router.ts`、`src/work-thread-service.ts` | 五类建议与确定性定位；仅有权元数据、有界候选，不读Memory正文；保留旧chat/work入口 |
| `src/contracts.ts`、`src/pi-executor.ts`、`src/config.ts`、`src/main.ts` | 公开SDK单次隔离建议、实际HTTP预算/取消/observer、默认关闭及依赖组装 |
| `src/web-ui-store.ts`、`src/web-ui-types.ts` | 原请求表增量mode/selection、幂等冲突、撤销与分类历史；旧INSERT兼容 |
| `src/web-ui-channel.ts`、`src/web-ui-server.ts`、`src/work-job-store.ts` | 原鉴权层API、独立建议在途槽、Run恢复/撤销、稳定UUID确认与既有Job只读收据 |
| `web/src/main.tsx`、`web/src/work-routes.tsx`、`web/src/chat-timeline.ts`、`web/src/style.css` | 可选建议、原文/澄清/确认、当前绑定与历史只读、编辑立即失效和待确认状态；B4仅补持久10k提示 |
| `tests/work-route-suggestions.test.ts`、`tests/work-route-model.test.ts`、`tests/work-route-web.test.ts`、`tests/config.test.ts` | 定位/预算/实际HTTP/持久确认/权限和旧路径回归 |
| `tests/helpers/web-ui-fixture.ts`、`scripts/preview-web-ui.ts` | 临时DB、假Key、本机固定模型及测试专用传输暂停，不改生产stop语义 |
| `.env.example`、`README.md`、`docs/PROJECT.md`、`docs/STATE.md`、三份2B设计及本评估 | 脱敏样例、运行入口、稳定边界、当前状态和证据范围 |

## 工程证据与版本

- typecheck、后端build、web:build退出0；`TMPDIR=/private/tmp npm test`为644/644、0失败/取消/跳过，测试约66.92秒。仍保留两条既有lucide告警。
- 644后仅测试夹具HTTP暂停和一条前端持续超限提示变化：前者typecheck与25/25 Web回归通过，后者Web类型/构建、6个真实源码VM场景及真实DOM通过。全部`src/`后端及其它测试保持644版；不声称644测试过新增提示。
- B1的32项包含8专项，B2的50项包含原专项；B3初版72项、R2的29项/6源级场景与B4全量独立记录，不相加宣称独立覆盖。B3刷新绑定缺陷先复现，R2独立审查关闭。

原始命令/退出码/完整日志、源码Hash版本及冻结diff均在[本机B4证据](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/)，摘要见[validation.json](work-router-2b-validation.json)。Hash表单独保存在证据目录，不复制到文档。

## 实际浏览器与持久核对

使用Chrome真实1280×900、390×844 viewport；窄屏innerWidth和scrollWidth均390，不是实际手机。固定JSON模型通过真实本机HTTP与SDK，两个主题均走通：建议成功时0新增Job→明确确认同UUID唯一Job→继续Chat→原主题/Run成果。刷新/重复确认不再调用Router，历史未绑定建议只读，Job收据只读恢复。

- 刷新后编辑原文、主题或对象均撤销相同稳定ID；轮询不夺回当前或覆盖草稿；慢建议迟到不覆盖新输入。网络撤销失败真实显示本地失效/撤销待确认并禁确认，恢复同端口会话后明确重试成功。
- 14336字符ASCII及4700字符中文（14100 UTF-8字节）完整回填、无截断；ASCII跨轮询仍显示普通Chat 10000字符限制，发送不发Chat HTTP。关闭建议后新入口/卡片消失，原Chat和2A成功，Router计数不变。
- API建议与Chat并存由B3 HTTP测试证明；单输入区编辑触发撤销、确认Job后继续Chat由本轮DOM证明。未宣称单输入框UI并行发送两份草稿。
- 第一实例Router7/Chat2/Work2，第二Router3/Chat1/Work1，intent均0；共16次本机HTTP含2次API历史种子，不含644套件。取消未必生成model_calls，不把HTTP计数伪装为成功用量。两实例数据库及计数分开，捕获warn/error控制台条目0。

关键证据：[桌面建议0Job](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/browser/desktop-suggestion.jpg)、[390px结果](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/browser/mobile-result.jpg)、[网络待确认](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/browser-run2/network-pending.jpg)、[同会话恢复](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/browser-run2/network-recovered.jpg)、[最终长文提示](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/browser-run2/ascii14k-limit-fixed.jpg)、[关闭后Chat/Work](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/work-core-stages/b4/worker/browser-run2/routing-off-final.jpg)。相邻JSON/DOM记录实际宽度、原文exact、HTTP计数及SQLite收据。所有本次服务退出0、标签页关闭、viewport重置。

## 保留失败与限制

首次测试pause误用生产stop，导致测试会话被清理；失败DOM保留后仅修测试传输暂停，用新实例验证同DB/会话/端口恢复。长文首次回填原文正确但提示count0：revoke后的refresh清除临时error；补基于完整draft.length的持续提示后真实DOM重验。B1/B2监听EPERM、B3初始Header类型/SQLite空原型断言及R2宿主异步时机错误原日志均保留，未全部归因环境。

无真实模型语义准确率、原生非兼容provider实际HTTP、实际手机、长期运行或正式环境验收。仅四类受控API白名单，其中实际HTTP只验兼容端点mock，其余仅公开SDK源码核实；不支持者明确失败。无收费请求、真实GitHub/Tavily或正式.env/DB/Memory/Session访问；SDK、依赖和锁文件未改。既有Goal暂停/收据理解及Formation真实失败不由本轮mock覆盖。事件/关联回忆后续另派，本批未实现；本批无提交发布。
