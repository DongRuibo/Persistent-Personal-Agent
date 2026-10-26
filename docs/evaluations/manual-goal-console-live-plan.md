# 手动 Goal Console 生命周期冻结方案（仅离线准备）

2026-10-26。产品基线 `fdf3a069ca15847ab95f51c1ed39cd898d76c44f` 已作为Windows本地RC快进到main。本文和新入口尚未获真实执行/费用授权；未来须审查新代码Hash并单独批准，不能复用任何历史账本、数据或剩余额度。原[RC报告](local-rc-review.md)、P1/N1失败及R2/S1/N3限定成功不改变。

## 范围、额度与隔离

只用Console、新的绝对隔离根和 `manual-goal-console-v1` scope。复用IndependentBudget及 `independent-budget.json`，数据为根下P/agent.db、P/memory、P/sessions；没有新数据库框架或业务状态机。根与祖先禁止链接，第一次必须根不存在，后续必须显式resume，不能复制或重置旧账本。

仅隔离进程GOAL_ENABLED=true；Skills、Web、Formation、Proactive、查询改写均false。主Chat保持产品原工具/Guard，后台text_only、零工具、每片段一次模型请求；不连接飞书，不批准策略或写入Memory。源数据全部虚构。

最多40次物理模型HTTP、保守预留¥6.60、文档GET0；每次发送前原子持久预留，失败和未知不退款，重启不清零。只允许DeepSeek-V4.1-Flash和 `https://api.siliconflow.cn/v1/chat/completions` POST，GET/其他地址在DNS前拒绝；单请求65536字节、输出4096Token，后台另限32768字节。历史输入2/输出8元每百万Token仅供演算：40×0.164864=¥6.59456；不是当前核价、费用授权或供应商账单保证。

## 唯一冻结消息与顺序

M1原话：

> 帮我分阶段完成澄川职责练习。只使用以下虚构资料：宿主验证当前用户授权并保存Plan与Checkpoint；Pi每次使用独立Session执行一个text_only片段；工具能力由宿主白名单决定。正式计划最多1个Step。这个Step先根据资料出一道题并说明考察点，首次交付partial并等待我的回答；收到回答后点评并complete。先拟待批准计划，等我确认后再执行正式步骤。

| Case | 确切输入 | 机械前置与验收 | 预计/最多HTTP |
| --- | --- | --- | --- |
| M1 | 上述原话 | 全新真实自然语言创建，合法bootstrap，持久化1个新正式Step的待批准草稿，waiting_user；partial无草稿不算计划生成通过，停止 | 4/6 |
| M2 | 查看澄川职责练习进度 | M1已审阅；唯一完整视图实际成功投递，revision/draftHash/displayRunId有效；不执行 | 3/4 |
| M3 | 确认 | M2视图5分钟内、版本匹配；只批准Plan v1，不产生正式Execution | 2/4 |
| M4 | 继续澄川职责练习一段 | M3仅批准已核对；独立正式片段出题，partial Checkpoint引用bootstrap，提交并成功投递 | 4/5 |
| — | 正常停服、重启 | 入口正常/quit后退出；下一启动同根resume，不额外发送用户消息，不计模型Case | 0/0 |
| M5 | 查看澄川职责练习进度 | 恢复同一Session/Plan/Checkpoint和预算；真实查看，不新建Execution | 3/4 |
| M6 | 暂停澄川职责练习 | M5视图5分钟内，waiting_user→paused，revision仅加1；旧Plan/Step/Checkpoint不变 | 3/4 |
| M7 | 继续澄川职责练习一段。我的回答是：宿主验证用户授权并保存Plan与Checkpoint，Pi只执行当前text_only片段，工具权限由宿主白名单决定。 | M6已审阅；明确继续和完整反馈进入同一新授权片段，引用M4 Checkpoint，点评后Step complete，Goal仍waiting_user | 4/5 |
| M8 | 查看澄川职责练习进度 | currentStepId空、Step completed、Goal尚未达成确认；建立唯一有效视图 | 3/4 |
| M9 | 确认澄川职责练习目标已经达成 | M8视图5分钟内，用户一次明确控制才使Goal completed；不产生Execution | 3/4 |

预计29次，上限合计40。九条消息逐字沿用RC报告，不补答、改名、重拟或额外查看，不追加取消、执行中暂停、Web/Skill联合或主动策略。任一业务/语义失败停止依赖Case；安全、身份、账本、配置、传输留证或进程不确定时停整轮。过期视图停止，不刷新。M1的合法澄清和本轮计划生成指标单独记录，不能追改旧失败。

## 最小入口与普通Console的差异

`scripts/manual-goal-console-acceptance.ts`复用既有运行入口。每次启动选择一个Case，测试者在真实stdin键入或粘贴唯一冻结消息；包装层逐字核对后，才交给原src/main.ts和ConsoleChannel。第二条、错误、超长输入不会进入产品队列；先前已合法提交的操作不因后续错误被倒销。

每条处理及后台片段停止后，沿用原入口正常/quit退出，形成独立审阅点。因此除M4之外，其他Case也会短会话重启；同根恢复的是同一原生交互Session，不是九个新聊天。它不是九条消息一直驻留的产品进程，也不伪装这一差异。M4后必须核对重启前后执行/Checkpoint/Session与预算；重启本身零请求，不设额外Case。

前一Case机械通过且执行者已审阅模型原始语义，才可用`--previous-reviewed`开始下一条。stdin等待结束后再次按当前时间核对视图TTL；没有刷新或宿主权限替代。Case、原文、版本/源码/Node/价格/根目录Hash绑定到同一预算身份。输入在途被额外内容打断则持久停止，不能重新开始本轮。

## 未来获批后的启动方式（本轮不执行）

1. 用户一次性批准新审查代码Hash、M1～M9、40请求/¥6.60/零GET、固定模型端点及全新根。执行前重新核实官方和当前账号输入/缓存/输出价、附加费；未知则不联网。
2. 安全注入LLM_API_KEY、LLM_MODEL、LLM_BASE_URL、LLM_PROVIDER=personal-compatible，以及24小时内相同的ACCEPTANCE_PRICE_CHECKED_AT、INPUT_RATE、OUTPUT_RATE、CACHE_READ_RATE和EXTRA_FEES_CNY=0。入口不读取.env、不保存Key。重启保持同一核价时间和配置；变化则拒绝，不修账续跑。
3. 仅在此新开发工作树使用固定Node24.19.0和现有依赖，不能用会自动加载正式.env的npm start/dev。下列命令后由测试者发送表中一条原话，不另发/quit；入口会正常退出。

```powershell
node --import tsx scripts/manual-goal-console-acceptance.ts --authorized --rates-confirmed --case=M1 --root=<全新绝对根>
# 审阅后逐条换成M2…M9；不能批量跳过语义评分或自动重试。
node --import tsx scripts/manual-goal-console-acceptance.ts --authorized --rates-confirmed --resume --previous-reviewed --case=M2 --root=<同根>
```

## 四类证据与评分

- 模型：原始request/response、工具选择、初步计划/题目/点评及当时收到的ToolResult；质量人工评分，脚本modelQualityPass=null，不把statePass当语义成功。
- 宿主：真实Guard授权、CAS、审批、控制、成功展示Run、投递事件和用户可见output。原始模型错误可保留，宿主覆盖不能冒充模型理解通过。
- 持久状态：各Case前后SQLite、原生Session/收据、不可变Plan/Step身份、旧Execution和Checkpoint、反馈引用及输入Hash；查看/暂停/确认不新增片段，Goal不自动完成。只允许M1、M4、M7各一段独立模型执行。
- 预算/退出：发送前预留、物理HTTP/容量/Token、保守预留与未知账单分别记录；请求和脱敏响应留证。正常停止后只读核对锁、pending、未完成Run/Execution、Session及Hash；旧证据不动，不清锁或重置账本。

使用原版Pi、真实临时SQLite及本机模拟HTTP的离线测试只证明入口机制，不证明未来真实模型效果。本次没有执行这些真实消息，没有使用旧轮余额；准备完成后停止等待审查和新的费用授权。
