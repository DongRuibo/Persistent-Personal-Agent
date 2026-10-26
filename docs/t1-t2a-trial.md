# T1 Skills / T2-A 只读资料试用

本轮仅离线实现及模拟验证，不启动真实模型、正式飞书或原试用实例，不读取正式.env。当前个人试用可继续使用原版本；下列步骤供审查后人工另行启用，不能在现有飞书进程中热切换。配置及数据应保存在新的隔离目录。

## 准备与开关

Node >=24.15.0，在本修复工作树运行`npm run build`。不要使用会自动读取.env的`npm start/dev`。样例[配置脚本](examples/t1-t2a-trial.ps1)只创建新目录、复制并批准已有的agent-notes 1.0.1/interview-practice 1.0.0及虚构资料，不启动服务、不联网、不读取凭据。

在此工作树的PowerShell中执行（路径必须此前不存在；不要使用历史验收目录）：

```powershell
# T1：只开启现有Skills，文件工具关闭。
. ./docs/examples/t1-t2a-trial.ps1 -TrialRoot 'E:/AgentWork/tool-trial/t1-new'
# 或T1+T2-A：使用另一套新目录，并批准脚本生成的虚构资料副本。
. ./docs/examples/t1-t2a-trial.ps1 -TrialRoot 'E:/AgentWork/tool-trial/t2a-new' -EnableLocalFiles
```

脚本配置独立的DATABASE_PATH、MEMORY_DIR、SESSION_DIR、SKILLS_DIR；仅SKILLS_ENABLED=true，其他Goal/Web/Proactive/Formation/查询改写关闭。只有显式加EnableLocalFiles才设置LOCAL_FILES_ENABLED=true。脚本不复制Key或飞书参数，也不读取/启动原实例。新目录中有`state/agent.db`（服务启动时创建）、`memory/`、`sessions/`、`skills/`、`documents/`。

实际自己的资料必须先脱敏，再由操作者用系统Copy-Item复制少量md/txt到**新的**documents目录，停服后执行：

```powershell
node dist/local-files-admin.js 'E:/AgentWork/tool-trial/other-new/documents' notes/a.md notes/b.txt
```

此命令只批准明确列出的文件，不递归发现，不复制源文件，不启动Agent。文件名使用正斜杠相对路径。清单`approved-files.json`用wx首次创建，不覆盖已有批准；内容或批准需变更时，停服并使用新的副本目录重新批准、显式更新配置。不要复制别处的批准清单：文件/目录身份也被冻结。不是只读磁盘挂载，操作者仍可修改副本；改写会使工具保守拒绝。只支持本地普通文件，不使用网络盘、UNC、个人目录或代码仓库。

## 未来的Console / 飞书人工试用

审查并另行批准真实费用后，由用户安全配置当前进程的LLM环境变量；飞书还需三个FEISHU变量。不要把Key放入聊天或脚本，不读取整个正式.env。普通Chat没有整轮费用硬闸；8次是**单轮**模型调用上限，不能解释为金额上限或供应商账单保证。先控制少量交互，通过`/runs`及供应商账单核对用量。

Console用`node dist/main.js`。飞书用`node dist/main.js --feishu`；**沿用同一机器人前，先由用户在另行批准的切换中正常停止原实例**，或使用独立测试机器人。本轮不执行这两条启动命令、不停原服务、不代发测试消息。用Ctrl+C正常退出，等待退出后才能重启；保留相同数据路径，使用同一套配置恢复Session，不重新批准或删除数据。

T1可发送普通的资料整理/面试练习需求，让模型根据原生目录选择两个已批准Skill。`/skills`与`/skill agent-notes`是Console查看命令；飞书直接发自然语言。已有两个包不需要新增特殊调用权限，不新增Skill作为前置。模型可能不选择Skill；成功/未选择应按真实工具事件记录，不能凭口头“用了Skill”确认。Skill read仍每轮最多2次、Session正文累计8192字节；耗尽后只拒绝继续读Skill，普通对话可继续，不能自动清Session重置额度。

T2-A当前用户必须使用明确的首行授权格式；模型或文件里的同样文字不算授权。例如：

```text
本次允许列出资料目录：notes
任务：列出可用资料，不读取正文。
```

```text
本次允许读取资料文件：notes/overview.md#L1-L20
任务：整理这段资料，区分事实与未知信息。
```

可在消息前两行分别给读文件与列目录授权；每种操作只能使用自己的范围。两文件用`、`或逗号分隔；没有行范围时只表示该已批准文件，可由原生read分页。行范围限制返回文本，底层仍有界读取完整的小文件以核对Hash，审计bytes记录实际读取量。列目录不授权读文件或子目录；下一条消息若要重新读取，必须重新明确授权。拒绝、引用、假设、过期历史消息和模型路径建议均不授权。

Skills与资料共用唯一原生read名：批准Skill绝对路径走原S0校验，资料只接受当前授权相对路径；任一拒绝都不会回退到无限制read。Skill正文不能授权文件，文件正文也不能批准Skill或其他操作。

## 限制和审计

| 范围 | 上限/行为 |
| --- | --- |
| 宿主资料清单 | 16文件、每文件32KiB、总128KiB；仅UTF-8 md/txt；清单16KiB；最多4层相对路径 |
| 当前Chat请求 | 文件工具4调用、2不同文件；读/列目录共计；单次返回8KiB、累计16KiB，拒绝收据也计入 |
| 原生分页 | offset>=1，limit<=2000；指定行范围时模型不能扩大；超大响应拒绝，不静默改写用户范围 |
| 模型循环 | 主Loop与辅助请求共用原8次/轮、请求体64KiB限制，不与Skills/Web叠加额度 |
| 目录 | 只显示批准条目；不扫描未知文件名；默认最多32条 |
| 权限 | 只Chat；后台仍零工具；无write/edit/bash/grep/find/MCP/Web/图片/任意路径 |
| 审计 | Run Event `local_file_access`：SDK来源、相对路径、实际读取字节、封装响应字节和拒绝原因，不保存正文或绝对根路径 |

拒绝路径穿越、绝对/设备/ADS路径、符号链接/junction、硬链接、隐藏文件、典型配置/凭据名称和可识别凭据正文。内容扫描不能证明任意资料不含秘密，操作者必须先脱敏；获准正文会进入模型和原生Session，不能把“审计不重复正文”理解为“不持久化会话内容”。已有Memory写入仍需当前可信用户明确意图。

每次使用核对批准清单、父目录身份及文件类型；打开FD后及读取后重新检查身份、大小、链接/时间，再核对固定Hash。原生read的路径解析存在前置元数据探测，宿主先验证原始相对路径、固定ctx.cwd，再由注入操作控制正文。此方案不是OS沙箱，不承诺隔离同账户恶意进程、挂载变化或内核；只用于操作者控制的本地专用资料副本。未知错误只返回通用拒绝，不暴露原始路径/异常。

## T2-B前置风险

安装版本的原生grep调用ensureTool("rg")并spawn；find默认使用ensureTool("fd")/spawn（有可注入glob接口）。缺失工具时的取得行为、子进程递归遍历、链接、路径范围、结果正文、容量、取消和进程树回收需要单独验证。cwd不是沙箱，不能直接注册默认grep/find。T2-B不能通过开放bash、通用rg/fd或自行重写搜索器绕开要求；本轮不安装或运行这些工具，不提供其权限。
