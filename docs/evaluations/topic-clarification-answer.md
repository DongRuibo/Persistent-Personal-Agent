# 主题语义澄清补答限定修复

日期：2026-11-05。状态：实现及最终同源检查完成，独立R1已PASS，无阻断。本轮没有Git提交/推送或真实实例操作。

## 问题与边界

用户真实试用中，普通求职提问只收到泛化主题澄清，没有回答当前问题。根因是Pi适配在合法clarify分支直接返回route.question；现有持续用途检查还会把整条中的假设措辞视为不允许创建持续主题。只改提示或增加求职关键词不能保证当前问题获得回答。

本轮保留原persistent/绑定授权规则，不添加领域关键词。路由格式、候选外ID、HTTP失败、取消、超时和预算硬门继续失败，不catch降级。没有唯一有效业务引用、短确认、无效编号及纯选择继续原零模型澄清/Guard语义。

## 实现与文件目的

- `src/topic-router.ts`：仅普通语义路由澄清设置宿主action=answer；确定性业务/选择歧义不设置。新answer候选用自然问句，旧chat/selection话术不变。模型Schema不接受action或其他权限字段。
- `src/topic-route-types.ts`：增加可信answer决定、PreparedTopicChat.hasCandidates及固定宿主分隔；不增加模型权限。
- `src/web-ui-channel.ts`：本条冻结decision的action和候选存在事实传至Pi；已有route回读同条decision，不重新选择目录。
- `src/pi-executor.ts`：answer分支只传当前完整原话与宿主提示，用公开runtime做一次无工具文字补答。没有Session/历史/Memory/目录正文输入，不运行业务工具或Guard解析。输出额度沿正常model.maxTokens；正常stop、无工具且非空才接受。候选由宿主原样附在正文后；无候选正文最多一个具体业务追问，不输出内部主题声明。原引用结束规则保留。
- `src/web-ui-store.ts`：旧output===question兼容；新answer可为正文加固定分隔和原样question后缀。仍要求成功Run、完整渲染ACK、五分钟、最近普通回合及原候选有效性，不增审批状态或表。
- `tests/topic-clarification-answer.test.ts`：新增合成求职问题及真实SDK/localhost假模型回归；真实原文只在本机证据，不含真实简历或私人Session。
- `tests/topic-router.test.ts`、`tests/topic-routing-web.test.ts`、`tests/topic-session-runtime.test.ts`：只更新受本次语义补答影响的action/HTTP次数预期，并保留零工具、绑定与旧业务断言。
- `tests/topic-session-storage.test.ts`：固定后缀仅answer生效、ACK/过期/改写输出拒绝。
- `docs/STATE.md`、`docs/PROJECT.md`及本评估：交接状态、稳定行为及证据限制。

## 已执行验证

所有模型请求均为localhost假模型，数据位于/private/tmp。首跑监听EPERM和macOS临时目录符号链接错误单独保留，修正环境后才作业务红绿。首个正式业务红实际只返回“请补充一个明确主题名称与项目范围……”；修复后有正文。

- 最终typecheck、build退出码0；最终定点136/136、0失败/取消/跳过。覆盖零工具/主题/Job/Goal/Memory、daily及其他主题消息正文不变、补答无旧历史、无候选具体追问、有候选宿主完整后缀、ACK编号只选择不重放、未ACK/过期/错误编号拒绝、旧Goal/文件/Web短引用失效与原正向审批。
- 同定点覆盖路由非法JSON/候选外ID/额外权限字段、500/取消/超时不补答；补答toolCall/空/length/500/断流/取消/超时均不执行、不重试；已知/未知usage分别记录，65536门前零发送。原8次共享预算、第9次零发及实际compact/split、重启、低信任边界回归通过。补答本身最多新增一次HTTP，不另设额度。
- 用户报告原文在本机SDK+localhost假模型重放通过：2次HTTP、route=clarify、零新增对象；模型回答是固定桩，不能当真实模型质量验证。
- 最终同源全量1135/1135通过（105647.859375ms，0失败/取消/跳过），退出码0。初轮及友好问句版1135通过日志分别保留；Planner补提的目录上限扩展和其TS7022检查原件标为excluded并撤回，恢复后又完成本次最终检查。web:build退出码0，两条既有lucide模块指令警告；友好问句调整只影响宿主文案，无前端输入变更。

证据目录：`/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/clarification-reply-20261105/worker-r1`。447文件起始manifest/原件、业务红、环境失败、初轮未过定点及测试预期修正、最终命令/exit/HTTP/账本、增量diff与交付manifest均保留。源代码编码沿原UTF-8/CRLF，不触碰旧N0—N5冻结证据。

## 独立R1与审后收尾

[独立R1报告](/Users/onruio/.codex/visualizations/2026/10/31/01a19381-5bc8-7220-8166-cc210f227e22/topic-session-routing/clarification-reply-20261105/reviewer-r1/review.md)已PASS，无阻断或本轮待修finding。独立clean env定点136/136（15789.997375ms）及真实SDK/localhost的answer补答后文件/Goal/Web审批3/3（3993.94525ms），均exit0；旧短审批不复活，重新展示和具名正向保持。Reviewer核对Worker全量/构建实际日志，没有重复全量；136及3项不与1135累加。

审查开始/结束449文件SHA256及Git状态一致，42行status不变、index空、HEAD未变。独立监听EPERM及探针claim前冻结的合法409原件保留。审后仅STATE与本评估更新结论，没有业务/测试/脚本变更或重新测试；最终相对447初始的13文件diff、文件目的及449manifest见本机`clarification-reply-20261105/final/`。原Worker/Reviewer冻结产物不修改。

## 限制与用户下一步

目录超过20主题/8KiB且不能缩小的分支仍沿原上限提示，本轮未扩大；未重新做浏览器UI或收费真实模型验证。

归属不确定的文字补答不进入任何持久Session，也不会建立长期主题或开始长期跟进；后续仍需确定归属，已明确主题继续原路径。不能保证模型总能生成高质量回答、严格只问一个问题或不在文字中误称能力；宿主实际无工具及无写路径。新增一次模型调用会增加费用和延迟，仍受同轮8HTTP/65536/绝对取消超时约束。新真实模型语义、真实手机和长跑均未验证。

本轮未操作4329及旧62414/4317/4318。运行中4329尚未加载本次修复，需由用户在试用原终端按Ctrl+C，再执行[短试用指南](../topic-session-trial.md)原命令并保持同目录重开；不自动迁移、重启、清理或重发旧消息。未提交、未推送，HEAD仍为ca1f6737d730565bdc41c9b18909a05de3ae88bf。
