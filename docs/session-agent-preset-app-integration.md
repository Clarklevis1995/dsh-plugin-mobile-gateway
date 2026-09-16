# App 会话运行模式接入说明

## 实现范围

gateway 已增加同一 Session 内的 Agent 模式查询、切换、锁定与通知。App 界面尚未修改；本次源码没有发布 npm，也没有升级本机 DSH。

用户流程：创建空白会话 → 进入会话页 → 选择已有模式，可重复修改 → 发送第一条消息 → 模式固定，后续完成、停止、重连均不可再次修改。

这里的模式是 Agent preset，例如 `standard`、`minimal`，与模型选择、权限模式及 gateway 的常驻/临时运行模式相互独立。

## 接入顺序

1. 检查 `hello.capabilities` 是否包含 `session-agent-preset`。没有则不提供当前会话切换入口。
2. 用现有 `session-create` 创建会话，收到 `session-created` 后以其 `sessionId` 进入会话页。
3. 在 Control 通道查询 `agent-presets` 和 `session-agent-preset`；查询未完成期间禁止选择。
4. 显示当前模式的名称；只有 `locked: false` 才允许打开选择器。名册使用 `presets`，显示 `name/description`，提交 `id`，有 `broken` 的项禁用并显示原因。
5. 选择后发送 `select-agent-preset`，携带唯一 `requestId`。保存期间禁止再次切换和发送消息；以成功响应的 `agentPreset` 更新当前值。失败保留原值并展示错误。
6. 成功切换后重新读取该 Session 的 `commands` 和 `skills`，因为模式决定工具、命令及技能集合。
7. 点击发送第一条消息立即在 App 暂时禁用模式选择，收到 `sent` 后保持锁定。若提交报错，重新查询状态再决定是否解锁；连接断开或请求超时也必须先重新查询。
8. 每次进入会话或重连时重查当前模式状态，不能依赖上次连接的本地可编辑标记。

`agent-presets` 的 `modeSelectionEnabled: false` 表示 Host 隐藏模式选择 UI 的设置，App 可遵循同一设置隐藏入口；旧 Host 没有该字段时默认显示。它不改变 `locked` 的含义。全局 `isDefault` 只用于未指定模式时的默认提示，不能覆盖已有会话当前值。

## 请求与响应

```json
{"type":"session-create","requestId":"create-1","workspaceId":"w1","agentPreset":"standard"}
{"kind":"session-created","requestId":"create-1","sessionId":"s1","agentPreset":"standard"}

{"type":"agent-presets"}
{"kind":"agent-presets","presets":[{"id":"standard","name":"标准模式","isDefault":true},{"id":"minimal","name":"精简模式","isDefault":false}],"modeSelectionEnabled":true}

{"type":"session-agent-preset","sessionId":"s1","requestId":"state-1"}
{"kind":"session-agent-preset","sessionId":"s1","requestId":"state-1","agentPreset":"standard","locked":false}

{"type":"select-agent-preset","sessionId":"s1","agentPreset":"minimal","requestId":"select-1"}
{"kind":"select-agent-preset","sessionId":"s1","requestId":"select-1","agentPreset":"minimal"}
```

创建时的 `agentPreset` 可省略，沿用 Host 默认值。选择成功响应不带 `locked: false`，避免把并发到达的开始对话通知重新解锁。

如果沿用“首条消息自动创建会话”的流程，只能在不带 `sessionId` 的 `message` 上附带 `agentPreset`；已有 Session 的模式修改必须使用独立选择接口。

## 多端更新及缓存

Control 通道（或旧版单连接）会收到：

```json
{"kind":"session-agent-preset-updated","sessionId":"s1","agentPreset":"minimal","seq":12,"time":1000}
{"kind":"session-agent-preset-updated","sessionId":"s1","locked":true,"seq":13,"time":1100}
```

- 第一种表示模式已提交，包括从 WebUI 切换产生的事件；仅更新模式，清除命令/技能缓存。
- 第二种表示已开始对话，仅更新锁定状态。未携带的字段保持原值。
- 更新按 `gatewayId + sessionId` 定位；这些控制增量不受对话订阅过滤，不要错误应用到当前显示的其他会话。
- `seq` 是该通知对应的持久事件序号，不是独立的控制通知连续序列。
- 同一页面只保留最新 `requestId` 的查询/选择响应；离开页面、切换 gateway 或 session 后忽略旧响应。查询发出后若收到锁定通知，不可被该查询的迟到 `locked: false` 覆盖。
- 通知不重放连接基线。重连查询负责恢复当前值和锁定状态，历史 `projections.values.agentPreset` 也可更新模式。
- Session header 的 preset 是创建事实；用户在空白阶段切换后，当前值来自投影，不能只读 header。

## 错误处理

| code | App 行为 |
|---|---|
| `agent-preset/locked` | 锁定模式入口，提示对话开始后不可修改 |
| `agent-preset/not-found` | 保留原模式，刷新已有模式列表 |
| `agent-preset/invalid` | 保留原模式，展示 Host 返回的损坏或不可用原因 |
| `agent-preset/unavailable` | 状态未知，保持禁用；不可假定为空白会话 |
| `session/not-found` | 刷新会话列表并退出无效会话 |
| `bad-request` | 请求缺少有效的 sessionId 或 agentPreset，应修正客户端参数 |
| 其他 Host/网络错误 | 保留原模式，重查状态；不自动重复有副作用的写入 |

新增查询和选择接口的成功及 Host 错误响应均保留有效 `sessionId` 和传入的字符串 `requestId`。本地参数错误至少保留 `requestType/requestId`。

## Host 对接与锁定规则

- 切换调用官方 `agentPresets/select`，参数为 `{ agentId: sessionId, agentPreset }`；它重组 Agent、写入 `agent-preset/selected`，不更换 ID、不修改全局默认值。
- 查询读取 `session/follow` 首帧的当前 preset 和 `sessionListMetadata`，不以“历史 events 数组为空”判断可编辑，因为历史会分页，空白会话也有初始化事件。
- 历史含对话轮次或用户输入即锁定。gateway 还覆盖 prompt 已受理但尚未写入轮次事件的间隙。
- 同一 gateway 内，模式选择与消息提交按 Session 串行，Control/Conversation 两个 socket 的竞争不会让第一条消息越过尚未完成的模式切换。
- Host 自身仍会检查会话轮次边界。WebUI 等绕过 gateway 的并发操作由 Host 自身负责；本次没有修改 Host 的并发实现。

## 验收

- 新建 → 查询标准模式 → 改成精简模式 → 改回标准模式，全程 session ID 不变。
- 发送第一条消息后，UI 立即锁定；绕过 UI 直接调用选择接口也返回 `agent-preset/locked`。
- 轮次完成、停止、App 重连、gateway 重启后仍锁定。
- 未知/损坏模式切换失败，原模式与会话保留；之后仍可选择有效模式。
- 保存模式期间发送消息不会抢先执行；两个设备并发操作能按响应和通知收敛。
- WebUI 切换模式后，App 当前模式、命令和技能缓存同步更新；WebUI 开始对话后 App 锁定。
- 切换到另一个 Session 时，旧 Session 的迟到响应不能修改新页面。

自动测试覆盖 Adapter 真实参数、消息/选择排序、历史锁定、输入校验、错误透传和真实本地 WebSocket 的模式查询、切换通知、锁定、双通道分流。未执行新版真实 DSH 与手机联调。
