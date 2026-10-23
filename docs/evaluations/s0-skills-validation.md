# S0 原生 Skills MVP 验证记录

开发基线：121e83e9a679bfccf646bca0597ccc2a274f34eb。日期2026-10-23。仅隔离虚构数据、真实SQLite、原版Pi1.3.0与本机模拟模型，不是收费模型或正式启用验收。原V3.0.1自然暂停与操作收据误解仍开放，原报告不改。

证据根目录：`E:/AgentWork/validation/personal-agent-s0-skills-20261023`。每轮命令日志独立保存，不覆盖失败或历史验收库。

## S0-A

已完成默认关闭开关、专用宿主批准清单/包Hash、原生SDK发现与解析、受限原生read、Console只读列表/详情、两份自包含纯文本Skill与停服批准入口。未开启Shell、通用文件、Web、MCP或任何外部写工具。

Chat累计正文读取最多8192字节，保存在原生Session custom entry，跨重启保留；重复读取照样计额度，避免把失败读取或被裁剪内容当成已加载。每轮read最多2次，分页拒绝；额度不足只返回拒绝收据，普通聊天与原工具照常可用。主Loop与辅助意图/Memory改写共享每轮8次HTTP硬限，自动重试关闭。只读包文件仍属低信任内容，写入继续受原Guard验证。

最终Windows256项：253通过、0失败、3原平台跳过；typecheck/build/test/eval:memory/eval:formation均退出0（s0-a/09–13）。7项新增测试覆盖真实PiExecutor原生目录→read→下一请求正文、越权无回退、Session额度重启、次数/取消/禁用/Hash、junction/硬链接及已有Task/Memory权限。所有模型请求均为本机桩。

原始失败：01-skills.log中junction已拒绝但错误分类为不支持资源，修复为文件分类前显式拒绝链接，02专项通过；03-typecheck.log保留原生ToolDefinition测试上下文签名不匹配，补齐测试上下文后04通过。初次适配还遇到SDK工具泛型方差，使用SDK公开defineTool统一类型，没有更改SDK或降低类型检查。

## S0-B

宿主把模型可选skillId映射为已批准包的ID/version/Hash，写入可选Plan绑定并纳入原草稿/正式Plan Hash；每步最多一个。原生结果Schema拒绝模型提供路径/Hash。用户明确指定时不得被模型换包或省略；当前步骤改用/移除Skill沿用revise_plan，只形成新草稿，成功展示并明确审批后才生效。普通“使用某技术”不能被扩大为绑定请求。

旧JSON不回填，完成步骤的旧绑定/定义/成果保留；数量约束、身份/清单/TTL/版本校验仍走旧Guard。批准前在事务外重新核对包，禁用/升级不能通过旧展示批准，事务内继续CAS。未新增DDL。

Windows261项258通过、0失败、3原平台跳过；typecheck/build/test/两个eval均退出0（s0-b/04–08）。新增5项覆盖自动/明确选择、非法字段、数量、显示/投递、禁用、改绑/移除及已完成成果。02-bindings.log保留测试夹具漏传Guard引用状态导致的两项失败；补齐原API必需参数后03五项通过，未放宽预期。

## 后续阶段

S0-C后台原生展开及最终Linux完整回归尚待完成。当前不能宣称整个S0产品验收通过。
