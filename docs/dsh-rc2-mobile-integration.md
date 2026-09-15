# DSH 0.1.5-rc.2 移动端接入

本次源码以 DSH 0.1.5-rc.2 为唯一 Host 基线，不提供旧 Host 分支。配对、设备 token、双连接和 `dsh-mobile-v1` 保持原样；以下是新的实时订阅和历史坐标约定。App 需要同步实现本说明，不能把独立流帧交给旧的 `SessionEvent.seq` reducer。

## 1. 能力与历史缓存

`hello` 增加：

```json
{
  "kind": "hello",
  "protocol": 3,
  "dshVersion": "0.1.5-rc.2",
  "historyFormatVersion": 3,
  "capabilities": ["assistant-stream-v1", "history-format-version", "projection-baseline"]
}
```

示例只列出新增字段和能力；原有能力仍在。`dshVersion` 是本适配器的目标版本声明，非运行时 CLI 版本探测。握手协议值 3 与 Session 格式值 3 是独立概念。

缓存键至少包含 `(gatewayId, sessionId, historyFormatVersion)`。缓存没有格式版本或与服务端不同，必须丢弃该 Session 的旧历史、分页游标、fork 锚点及临时输出，重新安装基线。DSH 自己迁移磁盘日志，客户端不得迁移旧 seq。

## 2. 订阅一个会话

在 conversation 连接（或未拆分的连接）发送：

```json
{ "type": "subscribe", "sessionId": "s1", "assistantStream": true }
```

先收到确认：

```json
{ "kind": "subscribed", "sessionId": "s1", "assistantStream": true, "subscriptionId": "<UUID>" }
```

再收到原子基线：

```json
{
  "kind": "session-snapshot",
  "sessionId": "s1",
  "subscriptionId": "<UUID>",
  "streamId": "<本次上游 follow 的 UUID>",
  "historyFormatVersion": 3,
  "cursor": 41,
  "replace": true,
  "view": "conversation",
  "events": [],
  "bytes": 0,
  "hasMore": false,
  "projections": { "asOfSeq": 41, "values": {} },
  "assistantStream": {
    "revision": 2,
    "activeAttempt": {
      "attemptId": "s1:1",
      "turn": 2,
      "step": 3,
      "startedAfterSeq": 41,
      "nextIndex": 1,
      "stream": [{ "type": "text-chunks", "time0": 100, "index": 0, "texts": ["Hello"], "dt": [] }]
    }
  }
}
```

这是最新历史窗口和活动生成状态在同一个上游切点的快照。没有正在生成的 attempt 时省略 `activeAttempt`，客户端应清空临时输出。`hasMore` 为 true 时同时返回 `nextBeforeSeq`，按普通历史请求补更早内容；`replace` 指当前订阅基线需要替换，不能把该窗口误认为完整历史。

首屏窗口：网关向 Host `session.follow` 显式传入 `maxMessages: 12`，再将 conversation 事件限制在约 256 KiB 的最新连续后缀。单条最新消息不可拆分，独自超限时仍完整保留；活动 attempt 和 projections 不计入此正文预算，也不裁剪。被预算排除的较早记录通过 `hasMore/nextBeforeSeq` 按原协议分页获取。历史正文窗口可以缩小，但 `cursor` 始终保留 Host 的原子切点。

读取更早页时，为获取当前切点而打开的短暂 follow 仅请求 1 条消息；实际 `session.page` 继续使用客户端请求的 `maxMessages`。此调整同时作用于 iOS 和 Android，不依赖本地历史磁盘缓存。

客户端只处理当前 `subscriptionId`。收到新 snapshot 后更新 `streamId`，清理上一个 stream 的临时状态，并把持久流水位设为 `cursor`，不能使用精简 events 的最大 seq 代替它：精简视图可能隐藏了末尾的系统事件。

未发送 `assistantStream: true` 的连接仍接收持久 `event`，不会收到伪装成持久事件的 token。control 连接不能订阅对话流。

## 3. 临时增量与最终结算

每个独立流帧携带 `sessionId/subscriptionId/streamId`，其根节点没有 `seq`：

```json
{
  "kind": "assistant-stream",
  "sessionId": "s1",
  "subscriptionId": "<UUID>",
  "streamId": "<UUID>",
  "frame": {
    "type": "chunk",
    "attemptId": "s1:1",
    "revision": 3,
    "index": 1,
    "time": 101,
    "turn": 2,
    "step": 3,
    "chunk": { "type": "text-delta", "index": 0, "text": " world" }
  }
}
```

- `start`：含 `attemptId/revision/startedAfterSeq/turn/step`，新建临时消息。
- `chunk`：原样保留上游 chunk（文字、思考、工具参数、usage、finish 等），网关从 start 或 snapshot 补齐 `turn/step`。
- `end`：含 `attemptId/revision/index/turn/step/outcome`；`index` 是该 attempt 的 chunk 总数。
- `end.outcome = { kind: "committed", eventType, seq }`：之前的持久 event 已入流，使用 seq 关联 `assistant/message` 或 `assistant/attempt`，合并/清理临时消息，避免重复显示。
- `end.outcome = { kind: "abandoned" }`：清理临时 attempt，不生成虚构的持久消息。没有任何 chunk 的 attempt 也可能直接结束。

`revision` 属于一次 Agent 生命周期，`index` 属于一次 attempt。不要把其中任何一个写入持久事件 seq。网关检查连续性；App 仍应按当前 streamId/attemptId 去重和隔离展示。

持久帧仍使用 `kind: "event"`，由同一个上游 follow 有序转发，带真实 seq 以及 subscriptionId/streamId。不会再与全局 `session/event` 重复转发。消息附带中断标识 `interrupted` 和可选 usage；失败 attempt 保留 turn/step 与紧凑 stream。`surfaceOp` 和 `sourceEventSeqs` 在存在时位于持久帧根节点。

## 4. 重连、切换与取消

- 上游结束、连续性断档或临时失败：发送 `session-stream-reset`，含 `sessionId/subscriptionId/streamId/code/message/retrying`。立即冻结旧 stream 并清理临时输出，等待新 snapshot；网关按退避间隔重新打开 follow。
- 新 snapshot 使用新的 streamId，可能有重叠历史，必须替换基线后再继续，不能按旧流水位直接追加。
- 不支持的 Session 格式等永久失败：reset 的 `retrying: false`，App 提示错误；网关不切换到不安全的全局流回退。
- 手机 WebSocket 断开：重连、重新订阅。网关从上游快照取得已经生成但尚未提交的前缀，随后只发送基线之后的增量。
- 切换会话或 `unsubscribe`：网关取消旧 follow，迟到的旧 opening 不再发送。App 清除旧 subscriptionId 的临时显示。
- `session-cancel` 仍走控制连接，最终以持久中断消息/attempt 和 end 为准。

## 5. 历史、分页与 fork

普通 history 首次请求无需游标：

```json
{ "type": "history", "sessionId": "s1", "view": "conversation" }
```

返回值新增 `historyFormatVersion: 3`、`cursor`。conversation 视图隐藏 `system/message`、`request/header`、`request/context`，移除 Assistant 事件中的 `data.stream`，保留真实 seq、最终 message、usage 和 interrupted。默认原始视图保留完整内嵌 stream，用于按需读取轨迹。全部为隐藏事件的页仍返回可前进的 nextBeforeSeq。

携带游标必须同时携带读取该游标时的格式版本：

```json
{ "type": "history", "sessionId": "s1", "beforeSeq": 20, "historyFormatVersion": 3 }
{ "type": "fork", "sessionId": "s1", "atSeq": 42, "historyFormatVersion": 3 }
```

缺失版本、旧版本或版本不匹配，返回 `code: "history-format-mismatch"`、`resetRequired: true` 和当前 historyFormatVersion，且不会调用上游分页/fork。客户端必须重建缓存后再取新坐标，不能给旧坐标补一个 3 后重试。游标必须是非负安全整数。省略 atSeq 的 fork 仍表示从最近完成轮次分叉。

收到 session-snapshot 后，不要用晚到的普通 history 响应覆盖正在进行的订阅基线；更早历史页只合并到历史部分。这样可以避免独立查询与实时流交错造成回滚。

## 6. 控制基线

连接建立和上游 control baseline 更新时，控制连接收到：

```json
{
  "kind": "projection-baseline",
  "projections": { "s1": { "asOfSeq": 42, "values": { "todos": [], "goal": null } } }
}
```

这是网关当前持有的 todos/goal 快照，按整体替换处理；缺失 Session/键代表清除旧值。空对象也具有清除语义。后续仍用 `tasks-updated` / `goal-updated` 增量更新。网关也向原有消费者发对应基线值，避免断连期间修改的 Goal 只能等下一次增量才出现。

## 验证范围

仓库测试覆盖 rc.2 的参数封装、两种独立序号、缺口恢复、取消清理、真实 WebSocket 的原子基线/最终结算、重连前缀、历史裁剪、游标版本校验、工具失败与控制投影。真实 rc.2 Host 与 App 联调仍需在客户端接入后执行。普通文件上传、jobs 和 PTC 专用 UI 属于后续能力扩展。
