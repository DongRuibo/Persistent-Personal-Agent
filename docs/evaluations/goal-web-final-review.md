# Goal-Web A～D 最终审查收尾

审查基线：`79c83d0479dcf6a2dec364d7d66abb145d8164e1`；main：`5285975a3354f778012999526ed587b7e1b5c573`。本次只修统一验收入口的整轮 Web 硬限制，追加恢复断言，不重新开发 A～C。原 A～D 报告及 V3.0.1 真实失败记录不改。

## 红测与最小修复

原入口只给模型 fetch 加了持久限额；产品 Web 使用 Node HTTPS，`realWebGetsExpected:1` 不能拦截第二次请求。先在未修复的入口上运行真实 SQLite、原版 Pi、本机模拟模型及 HTTP 服务：同一验收根目录，第一次明确授权读取成功，正常重启并创建新的授权 Run 后再次读取。

原始结果：`mockWebGets=2, mockDns=2, modelHttp=4`；两行 web_read_calls 均 succeeded。冻结断言“同一验收根目录的新 Run 不得发出第二次 GET”失败，`2 !== 1`。[原始红测日志](goal-web-final-review-red.txt)和[原始反例源码](goal-web-final-review-red.test.txt)随本报告保留；在79c83d0的隔离副本中将源码保存为tests/integrated-web-budget.test.ts即可复现。原证据同时保存在本轮独立目录，没有覆盖旧报告或改成预期成功。

修复仅涉及：

- `scripts/integrated-console-acceptance.ts`：同一 integrated-budget.json 升级为 v2，增加固定 webLimit 与 webAttempts。只允许 pi-skills-v1 及方案既定的 v1.3.0 skills.md HTTPS 地址；专用 WebReadService 子类先同步预留、原子写入、fsync，再调用未改动的产品 DNS/HTTPS 实现。失败、中断和未知结果无退款、无自动重试；并发、新 Run、Session 切换及进程重启不增加额度。旧 v1 账本缺少可核对的 Web 历史，拒绝续测，不迁移为零。
- `src/main.ts`：导出可注入 Web 服务的宿主入口；普通运行仍创建原 WebReadService，原开关、授权、普通 Web 配额不变。验收先 import 再显式注入，避免双启动。直接源码/编译启动及旧验收入口设置 argv 后 import 的方式保留。
- `tests/integrated-web-budget.test.ts`：同一个红测安全预期保持不变，测试接入实际启动器使用的专用工厂。绿测 `mockWebGets=1, mockDns=1, modelHttp=4`，第二个 Run 留 failed 行；产品账本行数不能代替真实 GET 数。
- `tests/integrated-console-acceptance.test.ts`：v2 账本夹具、入口兼容和 import 不自动启动；原 32 请求、6 元、64KiB、4096 输出、费率/写入/重启限制继续验证。
- `tests/goal-receipt-context.test.ts`、`tests/goal-web-reliability.test.ts`：以下最终恢复审查的确定性故障注入。未修改对应产品状态机。
- `integrated-console-live-plan.md`、`STATE.md`：同步实际限制和交接；冻结话术、业务预期、预算建议不变。

专项验证包括：其他资源/错误地址零 DNS；发送前持久记录已存在；并发仅一个成功；DNS 失败、发送失败、中途取消不退额；独立子进程续测零 DNS；残留锁拒绝；写入失败/关闭/损坏/旧账本拒绝。Web 与模型限额独立同时生效。

首次绿测另暴露两处测试编排问题：SQLite 查询没有约定返回顺序，改为比较一成功一失败的集合；模拟传输同步 abort 并 reject 产生额外未处理 Promise，改为网络异步完成顺序。没有修改产品网络实现、放宽预期或丢弃日志（green-initial.log 保留）。随后 Web/模型预算专项 12/12，扩展恢复/入口专项 34/34。最终自审发现领取故障测试未提供合法 Skill，可能先命中 Skill 校验；补齐批准快照并要求异常明确来自 Web，再次专项 34/34，并对最终版本重跑双平台五关。首轮双平台日志及源码清单保存在 windows-initial / linux-initial / source-hashes-initial.json，不冒充收紧后最终版本的证据。

## A～D 最终自检

1. **宿主收据写入失败**：在真实原版 Pi 的公开 sendCustomMessage 边界注入 Session 写入故障。前台 Run 失败，但 SQLite 原控制收据仍在；重启后同 Run 再进入只显示原收据，不增加 Goal、控制版本或 ready 授权。Runner 只消费原来已提交的授权一次，产生一个 Execution；待审批及再次重启不重放。原模型错误原文不删除，不增加纠错模型调用。
2. **快照来源失效**：对已批准、同时绑定 Skill/快照的主动 Goal，先发出策略 Grant，再分别删除、损坏或改版本；模拟预检后、领取前的竞争。领取事务在 consume 前再次冻结核对并回滚。Grant consumedAt=null、reserveCny=0，无新 Execution、模型请求、GET 或 Checkpoint；Runner 阻塞并跨重启保持，Plan 不变。
3. **启动器与方案一致**：实际 main 接收验收专用服务；该服务只暴露固定资源，调用产品 fetch 前消费全局 Web 预留。baseline 与集成共用根目录/账本，模型 32/6 限额不重置；既有 DNS/IP/TLS/容量/代理限制和所有默认关闭开关不变。旧入口兼容、源码和编译后 --help 已离线检查。

## 回归与证据

本轮证据目录：`E:/AgentWork/validation/personal-agent-goal-web-final-20261023`。机器摘要见 [goal-web-final-review.json](goal-web-final-review.json)。

| 环境 | typecheck / build / test / eval:memory / eval:formation | 全量测试 |
| --- | --- | --- |
| Windows，Node 24.19.0 | 五项退出 0 | 441 项，438 通过、0 失败、3 原平台跳过 |
| 隔离 Linux，Node 24.19.0 | 五项最终退出0；Formation输出保护失败另存日志后仅换新输出路径复跑 | 441 项，441 通过、0 失败、0 跳过 |

Windows 三项原跳过为 POSIX 权限位、无权限创建符号链接、POSIX SIGTERM 优雅退出；Linux均实际运行通过，不代表已验证 Windows ACL。Linux 使用新容器 personal-agent-goal-web-final-20261023、network=none、无宿主挂载、2CPU/3GiB；复用同 lockfile 的离线依赖包，不联网安装，验证后停止。145 份项目/SDK 文件在两平台及测试前后 Hash 一致，清单SHA256：`d6c9be6eb2df19311203227cd01c6032d3edc06e82fe5f7da73bbe08cbc930df`；旧验收文档无diff，原工作区八份文件Hash不变。

最终Linux的Formation第一次保存结果触发EEXIST：输出路径仍有首轮报告，脚本按既有wx规则拒绝覆盖。原退出1和日志保留在linux-final/linux-results.json及linux-eval-formation.log；仅改命令参数为新文件linux-formation-final.json后退出0，最终五关汇总为linux-results-final.json，未改源码或样本。145份最终源码复核在这次单独复跑后完成。两平台Formation开发/留出均30/30，未经授权写入0、真实API0；Memory eval仍为固定离线评测，不宣称真实模型质量。

原始证据保留：red-web-budget.test.ts / red-web-budget.log、green-initial.log、green-web-budget.log、targeted-initial.log / targeted-final.log、两平台首轮和最终五关日志/结果及源码清单。本轮收费模型、真实验收网站、飞书/手机、正式配置/数据操作为 0；GitHub 核对和分支推送按本次单独授权执行。

原始红测日志按字节保留，含终端输出的两个仅空格行，因此全差异空白检查会对该证据文件报告两项trailing whitespace；不为排版改写原始日志。排除这一原始捕获文件后的代码/文档差异检查退出0，日志SHA256与原文件一致。

## 结论与剩余限制

**满足合并前的离线工程验收条件**：定点硬限制和恢复验证通过，最终双平台五关退出0；仅追加并推送feature/goal-web-snapshots，不合并或推送main。没有新增产品工具权限、框架、数据表或普通 Web 配额，也不开发 S2/Sandbox/Computer Use。

真实模型/网站体验尚未执行；V3.0.1 自然暂停和操作收据解释的历史真实失败仍开放，离线通过不能标为真实通过。下一步仅在另行批准统一 Console 方案、32 模型请求/6 元预留及一次固定 GET，且核实费率后执行。异常锁/未完成写入及旧 v1 账本保守拒绝，需要人工核对，不能自动清锁、退额或重取；不宣称硬件故障下绝对持久或消息恰好一次。
