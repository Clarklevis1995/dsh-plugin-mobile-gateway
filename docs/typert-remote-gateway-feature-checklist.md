# Typert Remote Gateway 功能清单

本文用于持续跟踪 `dsh-plugin-mobile-gateway` 对 DeepSeek Harness 官方 Typert Remote Gateway 能力的适配情况。

- `[x]`：移动网关已经实现，并有对应测试或现有协议文档覆盖。
- `[ ]`：尚未实现，或当前实现不足以兼容标注的 Host 版本。
- 对于部分支持的能力，拆成已完成项和待完成子项，不使用含糊的“部分完成”标记。
- 功能只有在代码、测试和必要协议文档均完成后才能勾选。
- 每次实现本清单中的功能时，应在同一次变更中更新本文件。

## 版本基线与兼容性

- [x] 以 DSH `0.1.5-rc.2` / Session format 3 为唯一适配基线，不提供旧 Host 分支。
- [x] 使用独立 Host Adapter 隔离 DSH Remote namespace、method 和严格参数名。
- [x] 保留移动配对和 `dsh-mobile-v1`、`hello.protocol = 3`；新增独立实时流需移动端接入。
- [x] rc.2 输入契约、流状态机和真实 WebSocket mock Host 回归测试。
- [ ] rc.2 真实 Host 与移动 App 完整联调。

## 连接、鉴权与通用传输

- [x] 提供 `/ws/mobile` WebSocket 入口。
- [x] 支持本机、独立局域网监听和 TLS 反向代理公网入口。
- [x] 支持一次性配对码、长期设备 Token 和设备吊销。
- [x] 局域网监听强制设备鉴权。
- [x] 支持 `ping` / `pong` 心跳。
- [x] 支持按 Session 订阅和取消订阅实时事件。
- [x] 支持统一移动端错误帧。
- [ ] 为普通 RPC 增加移动端请求 ID 与响应关联。
- [ ] 支持取消单个正在执行的普通 RPC。
- [ ] 在移动连接断开时取消该连接拥有的未完成查询、命令和流。
- [ ] 将 Typert 的结构化错误类别完整映射为稳定的移动端错误码与详情。

## Session 生命周期与查询

- [x] 列出 Session。
- [x] 搜索 Session 内容。
- [x] 使用 Workspace 创建 Session。
- [x] 使用 `cwd` 创建 Session。
- [x] 创建 Session 后发送第一条消息。
- [ ] 创建 Session 时显式选择 `agentPreset`。
- [ ] 创建或采用客户端预分配的 `sessionId`。
- [x] 在移动端重命名 Session。
- [x] Fork Session。
- [x] 支持指定 `atSeq` Fork。
- [ ] 在 Host 桌面打开 Session Workspace 路径。
- [x] 查询 Host 是否具备打开 Workspace 路径的能力。

## 消息、队列与运行控制

- [x] 发送文本 Prompt。
- [x] 发送纯图片 Prompt。
- [x] 发送图文 Prompt。
- [x] 支持 `queue` 投递模式。
- [x] 支持 `steer` 投递模式。
- [x] 为 Host Prompt 生成唯一 `requestId`。
- [x] 取消当前正在执行的 Agent 回合，同时保留待处理队列。
- [x] 取消后使用相同 `sessionId` 发送新消息继续已有会话。
- [ ] 向移动端返回并持久关联 Prompt `requestId`。
- [x] 显示 Session 当前排队消息。
- [x] 编辑一条尚未处理的排队消息。
- [x] 删除一条尚未处理的排队消息。
- [x] 将指定排队消息转换为 Steer。
- [ ] 显示 Session 后台 Job 列表与运行状态。

## 实时会话流与状态同步

- [x] 通过 Host `session/event` 向未启用 follow 的连接转发持久 SessionEvent。
- [x] 转发 `todos` projection 的增量更新。
- [x] 转发 `goal` projection 的增量更新。
- [x] 将 WebUI 或其他客户端写入的 `session/title` 变化实时通知移动端。
- [x] 将 Workspace 归档集合变化实时通知移动端。
- [x] 在 `0.1.5-rc.2` 上使用 `session.follow({ assistantStream: true })` 接收实时 Assistant 流。
- [x] 将 `assistant-stream` 的 start/chunk/end 转发为独立移动帧，并从 start/基线补齐 turn/step。
- [x] 处理 Assistant Stream reconnect baseline、revision、index 和 settlement。
- [x] 使用 `session.follow` 持续接收 durable event，而不只读取 opening snapshot。
- [x] 上游断流或序号出现缺口时重建 Session 快照；移动连接重建后重新订阅恢复。
- [x] 安装并向控制连接重放 todos/goal projection baseline。
- [x] 处理 `session.control` baseline 中的 queues，并在重连时整体替换。
- [ ] 处理 `session.control` baseline 中的 jobs。
- [ ] 处理 `session.control` baseline 中除 `todos`、`goal` 外的 projections。
- [x] 转发 `session.control` 的 queue 更新。
- [ ] 转发 `session.control` 的 jobs 更新。
- [ ] 支持除 `todos`、`goal` 之外的通用 projection 更新。
- [ ] 实时同步 Session 新增事件。
- [ ] 实时同步 Session 删除事件。
- [ ] 实时同步 Session running 状态。
- [ ] 实时同步 Session activity/排序时间。
- [ ] 实时同步 Session 非持久化错误。

## 历史、统计与附件读取

- [x] 读取 Session opening snapshot。
- [x] 分页读取更早的历史记录。
- [x] 读取 format 3 event 记录，保留真实 seq 与内嵌 stream，不展开为虚构序号。
- [x] 输出历史格式/cursor；拒绝缺失或不匹配版本的分页/fork 游标。
- [x] 支持移动端历史帧字节预算。
- [x] 支持 conversation 裁剪视图。
- [x] 读取历史图片附件字节。
- [x] 查询 Session 统计信息。
- [x] 查询 Token Usage 与 Context Pressure。
- [x] 原始历史和实时事件保留 Assistant attempt，conversation 历史移除内嵌 stream。
- [ ] 移动端完成独立 Assistant 流及 attempt 明细展示。

## Host 命令与技能

- [x] 按 Session 列出 Host 命令。
- [x] 执行 `0.1.5-rc.2` Host 命令。
- [x] 转发 `command/run` 与 `command/done` 生命周期事件。
- [x] 提供服务端驱动的命令菜单 UI 描述。
- [x] 提供模型和权限的通用二级选择菜单。
- [x] 按 Session 列出用户可调用技能。
- [x] 区分 Model 可调用技能与仅用户技能。
- [x] 适配 rc.2 `commands.execute.submittedAttachments` 参数。
- [x] 识别 rc.2 `input.attachments` 命令描述。
- [ ] 支持向 Host 命令附加普通文件 receipt。
- [ ] 实时同步 `commands/change`，使移动端命令目录自动刷新。

## Human-in-the-loop

- [x] 转发 `user-questions/request`。
- [x] 支持单选、多选和自由输入答案。
- [x] 支持取消整批问题。
- [x] 校验问题答案的数量、顺序、ID 和选项。
- [x] 多设备竞争时只接受第一个合法响应。
- [x] 重放尚未处理的问题。
- [x] 没有匹配移动连接时回退给 WebUI 或后续 answerer。
- [x] 转发 `approval/request`。
- [x] 支持单次允许和拒绝审批。
- [x] 重放尚未处理的审批。
- [x] 广播问题和审批的最终状态。

## Workspace 与目录

- [x] 读取 Workspace baseline/list。
- [x] 创建 Workspace。
- [x] 使用插件本地文件系统实现浏览 Host 目录。
- [x] 使用插件本地文件系统创建目录。
- [ ] 重命名 Workspace。
- [ ] 删除 Workspace 注册记录。
- [ ] 调整 Workspace 顺序。
- [ ] 调整一个 Workspace 内的 Session 顺序。
- [x] 在移动端归档 Session。
- [x] 持续消费 `workspace.follow` 的 baseline/archived 更新，并缓存完整归档集合供新连接恢复。
- [ ] 转发 `workspace.follow` 的 upsert/remove/order 更新。
- [x] 在 Workspace 流重连时用新 baseline 原子替换缓存的归档集合。
- [ ] 调用 Host 原生 Directory Picker；此项属于低优先级桌面能力。

## 文件上传、下载与引用

- [x] 上传 Prompt 图片。
- [x] 下载历史图片附件。
- [x] 列出 Session Workspace 内的文件和目录。
- [x] 分块下载 Session Workspace 内的普通文件。
- [x] 校验文件下载 offset 和最终 SHA-256。
- [x] 防止通过绝对路径、`..` 或符号链接逃逸 Workspace。
- [x] 支持取消文件下载并清理空闲传输。
- [ ] 通过官方 `fileUploads.upload` 上传普通文件。
- [ ] 支持普通文件的流式 HTTP 上传。
- [ ] 使用文件 upload receipt 发送 Prompt。
- [ ] 使用文件 upload receipt 执行 Host 命令。
- [ ] 支持 `@文件` / `@目录` 候选补全。
- [ ] 支持跨 Session 引用候选补全。
- [ ] 支持发送规范化 `dsh-session:` 引用并显示引用快照状态。

## 模型与 Provider

- [x] 获取 Host 模型目录。
- [x] 获取 Session 当前模型选择。
- [x] 切换 Session 模型。
- [x] 切换 Session Reasoning Effort。
- [x] 读取新 Session 默认模型。
- [x] 保存新 Session 默认模型。
- [x] 列出可配置 Provider。
- [ ] 调用 `llm.listProviders` 获取完整 Provider 运行时信息。
- [ ] 调用 `llm.discoverModels` 从指定 Provider 配置动态发现模型。
- [ ] 实时同步 `llm/adapters-updated` 并刷新模型目录。

## 权限与 Settings

- [x] 读取 Settings namespace 描述。
- [x] 使用 `settings.update` 修改 namespace。
- [x] 读取权限 Preset 列表。
- [x] 读取 Session 当前权限。
- [x] 通过官方 `/permission` 命令切换 Session 权限。
- [x] 读取和修改新 Session 默认权限。
- [ ] 使用 `settings.replace` 完整替换 namespace section。
- [ ] 使用 `settings.mutate` 执行路径级 set/unset 操作。
- [ ] 完整处理 Settings revision conflict 并返回 Host 最新值。
- [ ] 实时同步 `settings/document-updated`。
- [ ] 在 Host 打开 Settings 文档；此项属于低优先级桌面能力。
- [ ] 在 Host 打开 Agent Preset 目录；此项属于低优先级桌面能力。

## Credentials

- [ ] 查询脱敏后的 Credential 引用状态。
- [ ] 设置 Credential 值。
- [ ] 清除 Credential 值。
- [ ] 实时同步 `credentials/reference-updated`。
- [ ] 确保任何 Credential Secret 都不会通过移动端查询接口回传。

## Agent Preset

- [x] 列出 Agent Preset 名册。
- [x] 显示默认 Agent Preset。
- [x] 修改默认 Agent Preset。
- [ ] 读取 Preset 文档或插件组成。
- [ ] 复制可编辑 Preset。
- [ ] 删除可编辑 Preset。
- [ ] 为尚未开始的空白 Session 切换 Agent Preset。
- [ ] 实时同步 `agent-preset/selected`。

## Goal 与任务列表

- [x] 读取 `todos` 任务列表。
- [x] 实时同步 `todos` 更新。
- [x] 读取当前 Goal 和 CAS revision。
- [x] 编辑 Goal objective 或 maxGoalRounds。
- [x] 暂停 Goal。
- [x] 恢复 Goal。
- [x] 清除 Goal。
- [x] 实时同步 Goal 更新。
- [ ] 直接创建 Goal。
- [ ] 将 Goal 标记为完成。

## 子 Agent

- [ ] 列出直接子 Agent 和后代树。
- [ ] 显示子 Agent 的模式、运行状态和血缘关系。
- [ ] 向 continuable 子 Agent 发送后续 Prompt。
- [ ] 在子 Agent 后续 Prompt 中发送图片。
- [ ] 从父 Session 中断 continuable 子 Agent。
- [ ] 订阅和展示子 Agent Session 的实时会话流。

## 消息反馈

- [ ] 列出一个 Session 的 Assistant 消息反馈。
- [ ] 为最终 Assistant 消息添加点赞或点踩。
- [ ] 为反馈添加备注。
- [ ] 修改带版本保护的反馈。
- [ ] 删除带版本保护的反馈。
- [ ] 处理反馈 version conflict 并向移动端返回当前权威值。

## Host 插件与动态 Cordis

- [ ] 查询 Host 插件清单和运行阶段。
- [ ] 查询 Agent Preset 的插件组成。
- [ ] 接收动态 Cordis 包运行请求。
- [ ] 允许或拒绝包含浏览器半包的动态 Cordis 运行。
- [ ] 停止或撤销动态 Cordis 包。
- [ ] 获取动态 Cordis Client 代码。
- [ ] 同步动态包发布和撤销事件。
- [ ] 支持 Cordis runtime inspect 查询。
- [ ] 上报动态 UI 渲染或 Client Guard 失败。

> 动态 Cordis 和 runtime inspect 强依赖 Web 页面生命周期，移动端优先级较低；在明确产品需求前保留未勾选状态。

## 官方 Remote Event 转发

- [x] `approval/request`。
- [x] `user-questions/request`。
- [ ] `agent-preset/selected`。
- [ ] `api-session/activity`。
- [ ] `api-session/added`。
- [ ] `api-session/error`。
- [ ] `api-session/removed`。
- [ ] `api-session/status`。
- [ ] `commands/change`。
- [ ] `credentials/reference-updated`。
- [ ] `llm/adapters-updated`。
- [ ] `settings/document-updated`。
- [ ] `cordis/request-run`。
- [ ] `cordis/request-run-resolved`。
- [ ] `cordis/dynamic-package`。
- [ ] `cordis/dynamic-retract`。
- [ ] `cordis/inspect-query`。
- [ ] `cordis/inspect-query-resolved`。

## 暂不纳入正式覆盖率

- [ ] 实验性 Agent Team Remote：`view`、`createTask`、`updateTask`。

> Agent Team 当前没有进入官方标准 `api-remotes` Client Assembly。只有在官方正式挂载或移动端产生明确需求后，才将其移动到正式功能章节。

## 完成定义

勾选一个待实现功能前，至少需要满足以下条件：

- [ ] Host Adapter 已封装对应 Remote 调用或流，不在业务层散落 namespace/method。
- [ ] 移动端协议请求、响应和错误形态已经定义。
- [ ] 对应单元测试或网关端到端测试通过。
- [ ] DSH 0.1.5-rc.2 相关契约和行为测试通过。
- [ ] `PROTOCOL.md` 与 README 中面向用户的能力说明已经同步。

> 本节是每个新功能的验收模板，不表示当前所有待实现功能已经满足这些条件，因此保持未勾选。
