# 第二轮分阶段Console验收准备验证

日期：2026-10-24。结论：**方案和入口已完成离线准备，第二轮真实验收尚未启动。** 本轮真实模型HTTP、公网DNS/GET和费用均为0；所有模型响应为本机模拟，不代表真实模型理解通过。

## 基线与隔离

- 审查基线：`aad7edbc38da2ee93985e4c10e118283431ea823`，本地main和origin/main跟踪引用为`c604565ca507ad9fe14e1cadf945918d14a92668`，前者包含后者。本轮不联网刷新远端。
- 工作树：`C:/Users/Dongr/.codex/worktrees/staged-console-prep/Persistent Personal Agent`；分支`codex/staged-console-prep`；HEAD仍aad7，无新提交、合并或推送。
- 只新增验收脚本/测试/方案/本报告及JSON，并更新当前修复工作树的STATE。`src/`、依赖、Pi SDK、产品权限和默认开关均未修改；旧统一入口及其冻结话术不改。
- 原E盘8项修改、原main工作树三份未提交文档、审查工作树8份文档、78份历史数据/证据逐文件Hash一致。原SQLite、Session和账本没有被打开重放或迁移，仅以文件方式读取Hash；正式.env、正式数据及凭据未读取。

## 方案与改动

[冻结方案](staged-console-live-plan.md)逐字列出12个Case、前置、成功/失败/停止规则及四类证据。A不依赖Web；B关闭GoalRunner，A的产品/语义失败不自动污染B；C必须具备A/B通过证据和有效SQLite来源。共同配置、预算、未知网络结果或停服异常仍停止，不以独立阶段绕过。

| 文件 | 目的 |
| --- | --- |
| `scripts/staged-console-cases.ts` | 固定A1～A7、B1、C1～C4的消息、调用范围和单步/阶段/整轮限额 |
| `scripts/staged-console-acceptance.ts` | 复用产品main和既有服务；新隔离账本、冻结消息stdin、单Case正常停服、只读源状态/Hash检查、零请求重启审计 |
| `tests/staged-console-acceptance.test.ts` | 默认拒绝、额度/原子写入/跨进程、冻结话术、阶段隔离及DNS前唯一Web预留 |
| `tests/staged-console-flow.test.ts` | 原版Pi、真实SQLite、本机模拟模型/HTTP，Goal/Skill/快照全链路及实际Console HTTP500不重发 |
| `docs/evaluations/staged-console-live-plan.md` | 下一轮待批准方案，不替换旧冻结方案 |
| 本报告及同名JSON | 实际验证、源Hash、原始调试失败和证据位置 |
| `docs/STATE.md` | 当前准备状态、预算待批、历史失败和下一步 |

建议预算为预计35、最多46次物理模型HTTP，整轮¥8保守预留；A/B/C另限28/4/14次和¥4.62/0.66/2.32，额度不互借。仅B1整轮一次固定pi-skills-v1预留，失败/中断不退、不重取。历史2/8费率下，46次最大容量预留演算为¥7.583744；该历史费率不是当前核价、预留不是账单。将来必须重新核实官方/账号/附加费、批准费用和固定网站后才执行。

## 离线验证

Windows Node24.19.0，现有依赖原样复用，无安装。最终原版Pi SDK为1.3.0。

| 检查 | 实际结果 |
| --- | --- |
| 新入口专项 | 7/7通过，0跳过 |
| `npm run typecheck` | 退出0 |
| `npm run build` | 退出0 |
| `npm test` | 474项，471通过、0失败、3原平台跳过 |
| `npm run eval:memory` | 退出0，离线固定64题，无真实模型请求 |
| `npm run eval:formation -- --output=<本轮新证据文件>` | 退出0，离线模拟，无真实模型请求，历史报告未覆盖 |
| Linux | 未运行：Docker Linux daemon管道不存在，唯一WSL发行版docker-desktop处于Stopped；未启动或下载安装环境 |

3项Windows跳过仍为既有POSIX私有权限、无符号链接权限及POSIX SIGTERM场景，不是新入口测试跳过。以本轮实际日志为准，不沿用历史Linux通过结果。

针对性证据：

1. 全容量46次预留累计7,583,744微元；第47次、单步/阶段超额、64KiB/4096上限、未知/过期费率、过高费率预算不足全部拒绝。失败状态不退费，重启累计不变。
2. 账本fsync/原子替换先于模型发送或DNS；锁、pending、旧scope、不同源码/费率/Node配置不能恢复；消息被改写、错误模型/工具范围不发送。
3. A1失败后A2不能开始，B可独立进入；C即使带审阅参数，仍不能跳过A/B实际状态。坏Hash/空快照/错版本/跨身份、Skill Hash改变均在C开始前拒绝，Case和执行授权不增加。
4. 本机模拟完整流程使用36次模型HTTP、一次模拟Web GET，12个Case机械状态通过。A1的额外一次原生Skill读取消耗已有余量；A3/C4均零请求，正常停服/重启后Session和持久状态不变，A取消历史不被B/C改写。
5. A1～A7和C4走真实Console子进程；B1/C1/C2/C3复用同一新账本、原生Session和SQLite，以进程内原版Pi/宿主服务及Mock Web传输验证。不将后者宣称为完整公网CLI联调。逻辑官方端点在测试中仅作为匹配元数据，实际模型传输全部改投127.0.0.1；Mock DNS返回固定地址，未进行公网解析。
6. 实际Console收到本机HTTP500后只发送1次，正常停服、保留失败预留和结束记录；再次启动同Case在发送前拒绝。未使用SDK隐式重试或替换消息。

原始准备期调试失败亦保留：测试账本URL的TypeScript字面量类型不符；新增损坏快照夹具先以SQL NULL触发产品已有CHECK约束，改为JSON null后才检验源状态拒绝；测试局部计数的TS7022补显式类型后通过。这些是新测试/准备代码问题，不是新真实业务失败，不覆盖上一轮G1/W1原始证据。日志分别为typecheck-tests.log、targeted-second.log、typecheck-final.log，后续通过另存文件。

## 冻结Hash与证据

| 文件 | SHA256 |
| --- | --- |
| 新冻结方案 | `5001128432f01bcaca04a261782c2586dda21693b2fe8e6663b8dbed89cbb627` |
| 新执行入口 | `a9a0c61180b09710cf52635c21d67d295eb07a5533f3844dc2ddffadbdc9431d` |
| Case源码 | `d4702cc08a0c1e1a390833812b6b272906e85713aca9cd6dff62036d0b3cc6bd` |

完整Hash、运行时Profile、Windows关卡、模拟数据位置及保全核对见[机器报告](staged-console-preparation.json)。本机原始日志/清单在`E:/AgentWork/validation/personal-agent-staged-console-prep-20261024`；临时模拟数据路径由frozen-targeted.log及test-frozen.log记录，不上传SQLite、原生Session或预算账本。源码/方案改变后必须重新审查和离线验证，不沿用已有临时Profile联网。

## 剩余门槛

- statePass只是机械检查，不能判断模型是否真正理解题意、主动选Skill、完整解释宿主收据或正确区分事实/未知；获批执行者须逐Case审阅四类原始证据，语义失败即停止依赖Case。脚本不是通用评测或自动裁判平台。
- 当前未核实新费率或凭据；固定文档是否能在10秒内取得、真实正文第1～8行是否可用于练习、累计Session是否达到64KiB上限均待真实验收，失败不改范围、不裁剪或重取。
- 旧真实结果不变：B0通过，W1超时、实际GET仍只能确认0～1；G1被安全拒绝，其余7项未执行。V3.0.1自然暂停和操作收据解释仍未真实通过。本轮模拟成功不能关闭这些门槛。
- 待ChatGPT审查固定方案/入口后，由用户一次性批准A/B/C、46次/¥8及一次固定GET；重新核价、安全注入配置并新建从不存在的根目录。手机、飞书、正式主动策略和新功能均不在范围内。本轮没有提交或推送。
