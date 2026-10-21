# App 会话轮次导航接入指南

## 接入目标

使用 DSH 的 `turnOutline` 投影，实现 WebUI 的会话刻度导航、问答预览和点击跳转。服务端提供整场会话的大纲，App 只加载当前需要的正文；无需先下载全部历史，也不依赖全文搜索或 WCDB。WCDB 可以用于后续离线缓存。

适用基线为 DSH 0.2.1-rc.2、`dsh-mobile-v1`、`hello.protocol: 3`、Session format 4。本次是向后兼容的协议扩展；App 界面和本地存储需要单独实现。

## 能力发现与数据结构

检查 `hello.capabilities` 是否包含 `turn-outline-v1`。它表示网关支持大纲快照和控制流更新的传输，不保证 Host 已挂载 `@deepseek-ai/dsh-session-turn-outline`。官方 Web profile 已组合此插件，自定义 profile 可能没有。

投影值为按 `turn` 严格递增的完整数组：

```json
[
  { "turn": 1, "seq": 10, "prompt": "调整输入框阴影", "response": "已减轻阴影，保留轻微悬浮感。" },
  { "turn": 2, "seq": 30, "prompt": "再缩小一点", "response": "" }
]
```

| 字段 | 语义 |
|---|---|
| `turn` | Host 分配的非负轮次号；不要假定必须从 1 开始或连续 |
| `seq` | 该轮 `turn/start` 的持久事件序号，用于向前补齐历史 |
| `prompt` | 首条来源为 `user` 的人类文本预览，文本块以空格连接并折叠空白，最多 50 个 UTF-16 code unit，截断带省略号 |
| `response` | 最后一条有文本的助手消息预览，最多 120 个 UTF-16 code unit，在 `turn/end` 后提交 |

预览直接来自正文，不是 AI 摘要。注入上下文和工具结果不填充提示词预览；同轮后续 steering 不覆盖首条提示词。纯图片输入可以没有提示词文本，应显示“第 N 轮”等本地化占位。空回复可能表示轮次仍在运行或该轮没有助手文本，不能只据此推断生成状态。

建议共享模型中的 `turn`、`seq`、`asOfSeq` 使用 `Long`。JSON 数值按非负安全整数校验，`asOfSeq` 另允许空日志切点 `-1`。按网关 ID、会话 ID 和历史格式版本隔离缓存，不把其他网关相同 session ID 的记录混用。

## 快照与实时更新

### 当前会话快照

沿用对话连接的现有原子订阅：

```json
{ "type": "subscribe", "sessionId": "s1", "assistantStream": true }
```

`session-snapshot` 中读取 `projections.values.turnOutline`：

```json
{
  "kind": "session-snapshot",
  "sessionId": "s1",
  "subscriptionId": "sub-1",
  "streamId": "stream-1",
  "replace": true,
  "historyFormatVersion": 4,
  "cursor": 35,
  "events": [],
  "hasMore": true,
  "nextBeforeSeq": 30,
  "projections": {
    "asOfSeq": 35,
    "values": {
      "turnOutline": [
        { "turn": 1, "seq": 10, "prompt": "调整输入框阴影", "response": "已减轻阴影。" },
        { "turn": 2, "seq": 30, "prompt": "再缩小一点", "response": "" }
      ]
    }
  },
  "assistantStream": { "revision": 0 }
}
```

示例省略正文内容。`events` 和大纲是两份独立数据：首帧正文限制为最新窗口，大纲仍包含全部已开始的轮次，不随正文预算裁剪。普通 `history` 响应也保留相同的投影。

不建立实时订阅、只需要查询大纲时，可以在控制连接发送现有请求：

```json
{ "type": "history", "sessionId": "s1", "maxMessages": 1, "view": "conversation" }
```

这会返回少量最新正文和当前投影，不会加载全部历史。它不是无正文专用接口；不要用这样的响应替换已安装的完整聊天窗口，只提取投影即可。

### 控制连接基线

控制连接和 legacy 单连接初始化时收到 `projection-baseline`；Host 控制流重建后再次收到完整基线：

```json
{
  "kind": "projection-baseline",
  "projections": {
    "s1": {
      "asOfSeq": 35,
      "values": {
        "todos": [],
        "goal": null,
        "turnOutline": [
          { "turn": 1, "seq": 10, "prompt": "调整输入框阴影", "response": "已减轻阴影。" }
        ]
      }
    }
  }
}
```

这是 Host 当前控制流所覆盖会话的集合，通常为已附着的会话，不是磁盘上所有历史会话的目录。冷会话进入页面后仍需从自身的 `history` 或 `session-snapshot` 取得投影。基线中缺少某个 session 不表示删除该会话或其本地正文。

App 应整体替换来自控制流的基线集合。首次连接时网关可能先发送空的缓存集合，稍后再发送上游基线；不能把首个空集合视为“没有历史会话”。重建后不在集合内的旧控制状态应失效，必要时为当前页面重新取得会话快照。

### 大纲更新通知

```json
{
  "kind": "turn-outline-updated",
  "sessionId": "s1",
  "asOfSeq": 40,
  "turnOutline": [
    { "turn": 1, "seq": 10, "prompt": "调整输入框阴影", "response": "已减轻阴影。" },
    { "turn": 2, "seq": 30, "prompt": "再缩小一点", "response": "已缩小阴影范围。" }
  ]
}
```

- 通知携带完整数组，整体替换对应会话的大纲，不能 append 或按数组下标拼接。
- 发往控制连接和 legacy 单连接，不发往 conversation 连接，也不受该连接的 `subscribe.sessionId` 过滤。必须按 `sessionId` 分发，不能直接写入当前页面。
- 新控制连接的 `projection-baseline` 包含网关最近收到的大纲；其他投影更新不会覆盖它。
- `asOfSeq` 是上游投影对应的持久日志切点，不是独立通知流水号，不能要求连续或用它推进对话事件游标。
- Host 每轮通常至多更新三次大纲：开轮、首条提示词、落定回复；流式 token 不会触发大纲逐字更新。已加载轮次可以使用本地消息提供即时预览。

大纲值的清空与缺省规则：

| 值或情形 | App 行为 |
|---|---|
| `[]` | 有效的空大纲，整体替换旧数组 |
| `null` | 当前控制源不提供该大纲，清除其旧值，退回已加载轮次导航 |
| 控制基线中的投影缺失 | 网关会规范化为 `turnOutline: null` |
| 会话快照中该键缺失 | Host 不提供此投影，使用已加载轮次；不要伪造完整历史 |
| 重建基线不再包含旧 session | 控制状态失效；网关另发送该 session 的 `turn-outline-updated`，值为 `null` |

会话从控制基线消失时发出的 `null` 是失效通知，使用旧缓存的水位，不代表新的日志事件。它与新基线一起处理，不应用普通增量的水位规则忽略失效。冷会话可重新读取自己的快照恢复大纲。

## App 状态与乱序处理

建议将以下状态放在 KMM 共享层，由 Android 和 iOS 分别渲染：

- `TurnOutlineStore`：服务器大纲、来源、投影水位及连接代际。
- `TurnNavigationIndex`：合并服务器大纲与已加载轮次，生成有正文锚点的 `loaded` 项及只有 `seq` 的 `unloaded` 项。
- `TurnJumpCoordinator`：目标轮次、目标 `seq`、加载状态、可取消的跳转代际。

合并规则与 WebUI 一致：以 `turn` 为键取两侧并集并升序排列；有已加载节点则优先使用其正文锚点，非空的本地预览覆盖服务端预览，本地预览为空时回退服务端。没有可见正文节点时保留服务端 `seq`，标为未加载。渲染锚点应是稳定节点 ID，不是易变的列表下标。

在同一连接代际内，对每个会话的 `turnOutline` 单独记录 `asOfSeq`，忽略水位更小的普通快照或更新，相同水位重复值幂等处理。不要把任务或 Goal 的水位作为大纲水位：不同投影可能更新于不同事件。

收到新 `projection-baseline` 时开启新的控制基线代际并替换其集合；这是权威重建，可能使旧缓存失效。控制连接与对话连接各有代际，切网关、断线重连、订阅替换后应丢弃属于旧代际的回调。会话快照必须匹配当前 `sessionId/subscriptionId/streamId`，跨通道的旧历史响应不能覆盖新大纲或当前聊天窗口。

历史格式改变或出现 `history-format-mismatch` 时，清理该会话旧大纲的 `seq`、分页游标、跳转任务及旧格式消息缓存，再取得新基线；不能只把旧坐标的版本号改成 4 后重试。

## 点击轮次与加载历史

已加载项直接滚动到该轮用户消息；无用户节点时滚动到该轮第一个可见节点。历史分页插入头部、图片或 Markdown 改变高度时，应保持语义锚点及其偏移，避免页面跳动。

未加载项按以下步骤处理：

1. 记录目标 `turn/seq` 和新的跳转代际，暂停自动跟随底部，显示该轮的加载状态。
2. 复用当前历史窗口的 `nextBeforeSeq` 向前分页。请求示例：

   ```json
   { "type": "history", "sessionId": "s1", "beforeSeq": 300, "historyFormatVersion": 4, "maxMessages": 200, "view": "conversation" }
   ```

3. 按 `sessionId + seq` 合并、去重更早页，更新分页游标。目标 `turn/start` 进入连续补齐的历史覆盖范围后，再解析该轮消息锚点；不能仅凭本地最小 seq 判断已覆盖，因为重连缓存可能有缺口。
4. 未到达目标且 `hasMore: true` 时继续，必须确认 `nextBeforeSeq` 严格减小。即使可见 `events` 为空，仍使用服务端返回的有效游标继续，不以数组为空判断结束。
5. 布局提交后滚动到目标锚点，清除加载状态。用户再次选轮次时，只允许最新跳转执行滚动；已有历史请求可以完成并缓存，但不能把页面拉回旧目标。
6. 会话切换、网络错误、历史到头或游标不前进时结束循环并允许重试。未能恢复目标节点时，不显示“跳转成功”。

历史响应目前不提供独立请求 ID 的关联保证。同一会话的普通上拉加载与跳转加载需要串行协调，不要为同一 session 并发启动多个无法区分的 `history` 请求。已安装实时快照后，历史页只补充历史区域，不替换实时消息。

网关当前只开放 `maxMessages`，未开放 WebUI 内部的 `turnWindow` 参数，也没有任意锚点附近直接读取的新接口。`200` 是 App 的起始批量建议，不是协议固定值；需要服从响应实际 `hasMore/nextBeforeSeq` 和字节预算。远距离跳转可能需要多次请求。

## 触屏交互与降级

WebUI 使用固定间距刻度和虚拟列表，悬停或键盘焦点显示一行提示词与至多三行回复；点击才跳转。它在窄屏隐藏导航，App 应独立适配触屏：扩大触摸区域，按住或拖动时显示预览，松手确认跳转，并允许取消。轮次较多时虚拟化刻度，不必同时创建全部消息视图。

没有 `turn-outline-v1`、Host 缺少投影或收到 `null` 时，只展示已加载轮次。纯图片轮次使用编号；隐藏的工具轨迹不填充问答预览。书签持久化、全文搜索、智能摘要与本功能独立，不由本协议扩展提供。

完整大纲每次整值传输，大小随轮次数增长。正文预算不限制投影大小，大量会话或数千轮历史应关注客户端帧上限及内存，后续再根据实测引入大纲分页；不要把当前方案描述成恒定大小。

## 验收与源码入口

- 正文只加载尾部窗口时，仍显示全部已知轮次及问答预览。
- 新轮次开轮、提示词落日志、回复落定后均能更新；流式期间没有逐 token 的整大纲写入。
- 已加载轮次立即定位；未加载轮次连续补页到目标，期间阅读位置稳定。
- 连续点击不同轮次、切会话、断线重连和历史版本改变后，旧回调不能触发错误滚动。
- `[]` 清空，`null` 降级，控制基线缺键或移除 session 后旧控制大纲失效；会话正文和磁盘冷会话不被误删。
- 控制连接收到更新，对话连接只接收自己的快照；新设备恢复最近的大纲，旧客户端忽略新增字段和帧仍可对话。
- 中文、表情、纯图片、无助手文本、steering 和中断轮次的占位与截断正确。

网关自动测试覆盖 Host Adapter 的快照与历史分页投影保留、正文裁剪不裁掉大纲、能力发现、真实 WebSocket 的更新分流与订阅过滤、新连接恢复、空值及控制基线重建。App 触屏和滚动验收需在客户端实现后执行。

DSH 0.2.1-rc.2 的源码入口：`dsh-session-turn-outline` 的 `projection` 定义；`dsh-client-ui-chat` 的 `TurnNavigator`、`mergeTurnRailItems`、`ChatNavigation`；`dsh-api-session-controller` 的 `Session.loadThrough`。网关对应 [Host Adapter](../lib/dsh-host-adapter.mjs)、[控制流处理](../lib/index.mjs) 和 [协议说明](../PROTOCOL.md)。
