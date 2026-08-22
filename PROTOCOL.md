# dsh Mobile Gateway — WebSocket 协议参考

移动端通过一个经过设备鉴权的 WebSocket 连接与 dsh 通信：订阅 agent 实时输出、发送文字和图片、处理 Human-in-the-loop 提问、查询会话/工作区/历史、调整会话配置。本协议由持久化插件 `dsh-plugin-mobile-gateway` 实现（v0.6.0）。

- **本机端点**：`ws://127.0.0.1:3080/ws/mobile`（与 dsh web GUI 同端口）
- **局域网端点**：`ws://<电脑的私有局域网 IP>:3081/ws/mobile`（插件独立监听，只提供经过鉴权的 WebSocket）
- **公网端点**：必须由 TLS 反向代理提供 `wss://<域名>/ws/mobile`
- **帧格式**：全部为 JSON 文本帧（UTF-8）；图片字节使用标准 Base64
- **连接即推送**：连上后服务端立刻发送一条 `hello`，之后 agent 输出以 `event` 帧实时推送

---

## 1. 通用约定

### 客户端 → 服务端（请求帧）
```json
{ "type": "<消息类型>", ...参数 }
```

### 服务端 → 客户端（响应/推送帧）
```json
{ "kind": "<类型>", ...数据 }
```

### 统一错误帧
```json
{ "kind": "error", "code": "session-not-found", "message": "no such session",
  "requestType": "history", "sessionId": "..." }
```
- `code`：`bad-request` / `session-not-found` / `agent-busy` / `model-unavailable` / `fork-unavailable` / `unknown-command` / `workspace-invalid-path` / `directory-unreadable` / `internal` 等（多为宿主错误码透传）
- `requestType`：出错请求的类型（`message` 直发类错误无此字段）
- `sessionId`：涉及会话时附带

### 会话 ID 获取
`{"type":"sessions"}` 列表取 `sessionId`，或 `{"type":"message"}` 省略 sessionId 自动创建后从 `sent` 响应拿。

### 设备配对与鉴权

#### 网关与鉴权状态

WebUI 中有两个互相独立的开关。它们是本机管理设置，iOS 客户端不应调用 `/mgw/*`：

| 移动网关 | 设备鉴权 | iOS 连接结果 |
|---|---|---|
| 关闭 | 任意 | WebSocket Upgrade 返回 `503 Service Unavailable` |
| 开启 | 开启（默认） | 必须使用一次性配对码或长期设备 token，否则返回 `401 Unauthorized` |
| 开启 | 关闭（仅 Debug） | 仅 DSH 本机监听允许无凭证连接，`hello.authenticated` 为 `false`；独立局域网监听仍返回 `401` |

- 移动网关默认关闭。手动开启后，默认 5 分钟内没有客户端成功建立连接就自动关闭。
- 关闭移动网关会关闭现有连接，WebSocket close code 为 `4004`。
- 从 Debug 模式重新开启鉴权时，所有无凭证连接会被关闭，close code 为 `4003`。
- Debug 鉴权开关只影响 DSH 自带的本机监听，并且只在当前 DSH 进程中生效；独立局域网监听始终强制设备鉴权。

#### 首次配对

二维码与手动复制内容都严格使用**无 padding 的 Base64URL 字符串**。解码后的 UTF-8 内容是以下 JSON，而不是长期凭证：

```json
{
  "version": 2,
  "publicUrl": "wss://gateway.example.com/ws/mobile",
  "pairingCode": "<一次性 256-bit 配对码>",
  "expiresAt": 1787112000000
}
```

编码方式（唯一受支持的配对载荷格式）：

```js
const pairingText = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
```

客户端必须先执行严格 Base64URL 解码（只允许 `A-Z a-z 0-9 - _`，不接受 `=` padding、原始 JSON 或普通 Base64），再解析 JSON 并检查 `version` 与 `expiresAt`。

首次连接必须请求子协议 `dsh-mobile-v1, dsh-pair.<pairingCode>`，并携带 `X-DSH-Device-ID` 请求头；缺少稳定设备 ID 的配对请求会被拒绝，避免每次重连都创建新的可信设备。该值应为客户端在 Keychain 中持久保存的安装级随机 UUID，仅用于重新配对时复用可信设备记录，不能替代配对码或设备 token 完成鉴权。兼容实现也可把一次性配对码放在 `?pairingCode=`；但子协议不会进入常见的 URL access log，因此优先使用子协议。成功后服务端依次发送：

```json
{ "kind": "paired", "token": "<长期设备 token>",
  "device": { "id": "...", "name": "iPhone", "createdAt": 1787111700000 } }
{ "kind": "hello", "protocol": 3, "capabilities": ["images"], "authenticated": true,
  "device": { "id": "...", "name": "iPhone" }, "port": 3080, "clients": 1 }
```

`paired` 只发送一次。iOS 必须把 token 存入 Keychain，之后使用以下任一方式连接：

- 推荐：HTTP 请求头 `Authorization: Bearer <token>`
- WebSocket 子协议：`dsh-mobile-v1, dsh-auth.<token>`

长期 token 默认禁止放在 URL query 中，避免被代理日志、浏览器历史和监控系统记录。缺少凭证、凭证无效、配对码过期或重复使用时，HTTP Upgrade 返回 `401 Unauthorized`。

#### iOS 对接示例

首次配对时，先对二维码/手动字符串执行 Base64URL 解码，再从 JSON 解析 `publicUrl`、`pairingCode` 和 `expiresAt`，并在过期前连接：

```swift
func connectForPairing(publicURL: URL, pairingCode: String) -> URLSessionWebSocketTask {
    var request = URLRequest(url: publicURL)
    request.setValue(stableInstallationUUID, forHTTPHeaderField: "X-DSH-Device-ID")
    request.setValue(
        "dsh-mobile-v1, dsh-pair.\(pairingCode)",
        forHTTPHeaderField: "Sec-WebSocket-Protocol"
    )
    let task = URLSession.shared.webSocketTask(with: request)
    task.resume()
    return task
}
```

成功后第一条业务帧为 `paired`。客户端必须立即将 `token` 写入 Keychain；该 token 不会再次下发。随后还会收到 `hello`。

后续连接推荐使用 `Authorization`：

```swift
func connectAuthenticated(publicURL: URL, token: String) -> URLSessionWebSocketTask {
    var request = URLRequest(url: publicURL)
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    request.setValue("dsh-mobile-v1", forHTTPHeaderField: "Sec-WebSocket-Protocol")
    let task = URLSession.shared.webSocketTask(with: request)
    task.resume()
    return task
}
```

客户端连接状态机建议如下：

1. 收到 HTTP `503`：网关尚未开启，停止高频重连；等待用户在 WebUI 开启后再手动重试，或使用有上限的退避。
2. 收到 HTTP `401`：token 缺失、错误或已被吊销；删除 Keychain 中的旧 token，进入重新配对流程。
3. 收到 `paired`：保存 token，记录 device id，然后等待 `hello`。
4. 收到 `hello.authenticated == true`：进入正常业务通信。
5. Debug 模式收到 `hello.authenticated == false`：允许调试通信，但不得把该连接方式用于公网构建。
6. 收到 close code `4003`：服务端已重新开启鉴权，使用 token 重连或重新配对。
7. 收到 close code `4004`：移动网关已关闭，停止自动重连。

---

## 2. 连接管理

| type | 参数 | 说明 |
|---|---|---|
| `ping` | — | 心跳；回复 `pong` |
| `subscribe` | `sessionId` | 事件流过滤：之后只收到该会话的 `event`（不订阅 = 接收所有会话） |
| `unsubscribe` | — | 取消过滤 |

```json
{"type":"ping"}
→ {"kind":"pong","at":1786937352316}

{"type":"subscribe","sessionId":"session-abc"}
→ {"kind":"subscribed","sessionId":"session-abc"}
```

---

## 3. Human-in-the-loop 提问与回答

Agent 调用 DSH 的 `ask_user_question` 工具时，插件通过 API Gateway 的 `events.mux()` 收到临时的待回答请求，并推送给移动端。该请求不属于持久化的 `session/event`；回答必须使用本节协议，不能作为普通 `message` 发送。

### `question-requested` — 服务端推送问题

```json
{
  "kind": "question-requested",
  "rpcId": "5ce4f5d1-...",
  "sessionId": "session-abc",
  "questions": [
    {
      "id": "research-direction",
      "header": "研究方向",
      "question": "你想深入研究哪个方向？",
      "detail": "请选择最感兴趣的方向",
      "options": [
        { "label": "核心架构", "description": "DSH CLI、profile、bundle 与 Cordis" },
        { "label": "移动网关", "description": "研究 iOS 与 WebSocket 插件" }
      ],
      "multiSelect": false
    }
  ]
}
```

- `rpcId`：API Gateway 为这一整批问题生成的稳定 ID。回答或取消时必须原样返回，客户端不得自行生成。
- `questions`：一次工具调用中的完整问题批次；可能包含多题。
- `id`：问题 ID，必须在对应答案中原样返回。
- `header` / `detail`：可选展示信息。
- `options`：可选列表；每项包含 `label` 和可选 `description`。
- `multiSelect`：`true` 允许多选，缺省或 `false` 为单选。
- `intent`：可选展示意图。目前可能为 `{ "kind":"plan-review", "approve":"批准选项标签" }`；未知 intent 应退化为普通选项列表。
- `replay: true`：可选。表示这是移动端连接后重放的仍待回答问题。iOS 必须按 `rpcId` 去重。

### `question-answer` — 移动端提交整批答案

```json
{
  "type": "question-answer",
  "rpcId": "5ce4f5d1-...",
  "sessionId": "session-abc",
  "answers": [
    {
      "id": "research-direction",
      "selected": ["移动网关"]
    }
  ]
}
```

自由输入使用 `custom`。单选题使用 `custom` 时 `selected` 必须为空；多选题可以同时携带两者：

```json
{
  "id": "research-direction",
  "selected": [],
  "custom": "我想研究 API Gateway 的安全边界"
}
```

提交规则由 API Gateway 严格校验：

- 必须一次提交这一批中的全部问题，`answers` 数量、顺序和 `id` 必须与 `questions` 一致。
- `selected` 中的值必须与原始 `options[].label` 完全一致，且不能重复。
- 单选题最多选择一项；单选题的 `custom` 与 `selected` 互斥。
- `custom` 如果存在，去除首尾空白后不能是空字符串。

插件立即返回交付回执：

```json
{ "kind":"question-response", "rpcId":"5ce4f5d1-...", "sessionId":"session-abc",
  "action":"answer", "accepted":true }
```

如果 WebUI 或另一台移动设备已经先回答：

```json
{ "kind":"question-response", "rpcId":"5ce4f5d1-...", "sessionId":"session-abc",
  "action":"answer", "accepted":false, "reason":"not-pending" }
```

答案结构不合法时 `reason` 为 `bad-response`。这两种情况均不能重发为普通聊天消息。

### `question-cancel` — 跳过/取消整批问题

```json
{ "type":"question-cancel", "rpcId":"5ce4f5d1-...", "sessionId":"session-abc" }
```

回执仍为 `question-response`，其中 `action` 为 `cancel`。取消会让等待中的 `ask_user_question` 以 `ASK_CANCELLED` 结束，iOS 应在用户确认后再执行。

### `question-resolved` — 服务端广播最终状态

```json
{ "kind":"question-resolved", "rpcId":"5ce4f5d1-...", "sessionId":"session-abc",
  "outcome":"answered" }
```

`outcome` 为 `answered` 或 `cancelled`。WebUI、iOS 或其他客户端中的第一个合法响应获胜；所有移动连接都会收到最终状态并应关闭对应选择界面。移动端断线重连后，API Gateway 会重放仍待回答的问题；DSH 进程重启则会取消这些仅存在于运行时的问题。

---

## 4. 消息（手机 → agent）

### `message` — 发送消息（会话不存在则创建）
```json
{ "type": "message", "sessionId": "session-abc", "text": "你好",
  "mode": "queue", "workspaceId": "w1", "cwd": "/path" }
```
- `sessionId`：可选。省略时**自动创建新会话**（可用 `workspaceId` 或 `cwd` 指定归属工作区，至多一个，workspaceId 优先）
- `mode`：`"queue"`（排队，默认）/ `"steer"`（打断当前回合）
- `text` 以 `/` 开头会被当作**斜杠命令**（如 `/permission ask`），宿主直接执行、**绝不发给模型**
- `text` 与 `images` 至少提供一项；因此支持纯图片消息
- `clientTimeZone`：可选 IANA 时区，例如 `Asia/Shanghai`，宿主会校验后记录到这条用户消息

### 发送图片

iOS 将本地图片原始文件数据编码成**标准 Base64**，不要包含 `data:image/...;base64,` 前缀：

```json
{
  "type": "message",
  "sessionId": "session-abc",
  "text": "请描述这两张图片",
  "clientTimeZone": "Asia/Shanghai",
  "images": [
    {
      "mediaType": "image/jpeg",
      "data": "/9j/4AAQSkZJRgABAQ...",
      "name": "IMG_1024.JPG"
    },
    {
      "mediaType": "image/png",
      "data": "iVBORw0KGgoAAA...",
      "name": "diagram.png"
    }
  ]
}
```

支持的 `mediaType`：`image/png`、`image/jpeg`、`image/webp`、`image/gif`。宿主会验证 Base64、文件签名、格式、尺寸、像素数、单图大小、图片数量和总大小；声明 MIME 与真实字节不一致会拒绝整条消息，且不会产生部分附件。

当前 DSH 默认最多 20 张图片、单图约 3.5 MiB、单条消息图片总计 100 MiB，实际值以最近一次 `history.projections.values.imageLimits` 为准。WebSocket 单帧上限默认 144 MiB，用于容纳 100 MiB 图片经 Base64 后的 JSON 请求；反向代理也必须允许相应大小的 WebSocket 帧。

Swift 编码示例：

```swift
let data = try Data(contentsOf: imageURL)
let image = [
    "mediaType": "image/jpeg",
    "data": data.base64EncodedString(),
    "name": imageURL.lastPathComponent
]
```

```json
→ { "kind": "sent", "sessionId": "session-abc", "mode": "queue" }
→ { "kind": "sent", "sessionId": "session-abc", "mode": "queue", "command": { "kind": "success", "text": "..." } }   // 斜杠命令时
```

---

## 5. 会话与历史查询

| type | 参数 | 说明 |
|---|---|---|
| `sessions` | — | 会话列表（`updatedAt/running/blank/cwd/agentPreset`） |
| `history` | `sessionId`, `beforeSeq?`, `maxMessages?`, `maxBytes?`, `view?` | 历史事件页（见下） |
| `attachment` | `sessionId`, `attachmentId` | 读取历史中属于该会话的图片字节 |
| `search` | `query` | 会话全文搜索 |
| `session-stats` | `sessionId` | 执行统计投影（输入框统计条数据源） |
| `context-usage` | `sessionId` | token 用量 + 上下文占用投影 |

### `history` 详细
```json
{ "type": "history", "sessionId": "session-abc", "maxMessages": 60, "maxBytes": 4194304, "view": "conversation" }
```
- 返回**原始 SessionEvent**（`{type, seq, time, data}`，方案A），可选裁剪
- 图片不会内联进历史页。`user/message.data.content[]` 中的图片块为 `{ "type":"image", "attachment": ImageAttachmentRef }`；iOS 使用其中的 `attachmentId` 请求图片数据
- `maxBytes`：单帧字节预算，默认 **4 MiB**；超预算保留最新部分并给出 `nextBeforeSeq` 续页（客户端 16 MiB 上限的安全余量）
- `view: "conversation"`：**对话裁剪模式**——丢弃 `assistant/chunk`（token 回放）与 `request/header`（system prompt），`tool/result` 嵌套文本截断到 2000 字符
- 分页：`hasMore` 为真时用 `beforeSeq: nextBeforeSeq` 请求更早一页

```json
→ { "kind": "history", "sessionId": "session-abc", "events": [ ...原始事件... ],
    "bytes": 3521, "view": "conversation", "hasMore": true, "nextBeforeSeq": 128,
    "projections": { "asOfSeq": 127, "values": { "tokenUsage": {...}, "contextPressure": {...}, "permissions": {...}, "sessionStats": {...} } } }
```

图片引用结构：

```json
{
  "type": "image",
  "attachment": {
    "attachmentId": "sha256-opaque-id",
    "mediaType": "image/jpeg",
    "bytes": 184320,
    "width": 1200,
    "height": 900,
    "name": "IMG_1024.JPG"
  }
}
```

iOS 发现尚未缓存的 `attachmentId` 后发送：

```json
{ "type":"attachment", "sessionId":"session-abc", "attachmentId":"sha256-opaque-id" }
```

服务端在确认该会话历史确实引用了这张图片后返回：

```json
{
  "kind": "attachment",
  "sessionId": "session-abc",
  "attachment": {
    "attachmentId": "sha256-opaque-id",
    "mediaType": "image/jpeg",
    "bytes": 184320,
    "width": 1200,
    "height": 900,
    "name": "IMG_1024.JPG"
  },
  "data": "/9j/4AAQSkZJRgABAQ..."
}
```

iOS 用 `Data(base64Encoded:)` 解码并按 `attachment.mediaType` 渲染，建议以 `attachmentId` 为缓存键。不要把 Base64 长期保存在对话模型对象里。并发同步历史时可限制为 2～4 个附件请求，优先加载当前可见消息。

### `session-stats` 详细（输入框统计条）
```json
{ "type": "session-stats", "sessionId": "session-abc" }
→ { "kind": "session-stats", "sessionId": "session-abc", "asOfSeq": 42,
    "sessionStats": { "turns": 6, "steps": 69, "llmMs": 2280000, "toolMs": 41400,
                      "ttftMs": 2600, "ttftSteps": 1, "decodeMs": 5000, "decodeTokens": 385,
                      "lastTurn": 6, "openStep": null, "pendingCalls": {} },
    "tokenUsage": { "totals": { "inputTokens": 10, "outputTokens": 5, "cacheReadTokens": 1, "cacheWriteTokens": 0, "reasoningTokens": 0 } },
    "contextPressure": { "contextWindow": 128000, "pressureTokens": 1500, "surfaceTokens": 2000 } }
```
展示公式（与浏览器同源）：LLM 时长=`llmMs`、工具=`toolMs`、首 token 平均=`ttftMs/ttftSteps`、速率=`decodeTokens/(decodeMs/1000)`、缓存命中=`cacheHitPercent(tokenUsage.totals)`、输入=`billedInputTokens(totals)`、输出=`outputTokens`。

---

## 6. 工作区与目录

| type | 参数 | 说明 |
|---|---|---|
| `workspaces` | — | 全部工作区（含每个的 `sessionIds`） |
| `workspace-create` | `path` | 对**已存在目录**创建工作区（已归属→`created:false` 幂等） |
| `directories` | `path?` | 浏览 server 目录（缺省 = home）；`crumbs` 面包屑 + `entries`（含 `hidden` 标记） |

```json
{ "type": "workspace-create", "path": "/Users/lichaofan/DeepseekHarnessProject" }
→ { "kind": "workspace-create", "workspace": { "workspaceId": "w9", "path": "...", "title": "...", "sessionIds": [] },
    "created": true }
```

---

## 7. 模型与思考等级

| type | 参数 | 说明 |
|---|---|---|
| `models` | `sessionId?` | **带 sessionId**：该会话的模型目录（`current` + `routable` + `groups`）；**不带**：全局模型目录（`groups` + `failures`，无需会话） |
| `providers` | — | 可配置 provider 列表（含 live/dormant 状态） |
| `select-model` | `sessionId`, `provider`, `model`, `reasoningEffort?` | 切换**该会话**的模型/思考等级（写入会话日志） |
| `default-model` | — | **默认**模型选择（新会话用，含 `reasoningEffort`） |
| `save-default-model` | `provider`, `model`, `reasoningEffort?` | 修改**默认**模型 + 思考等级（全局） |

```json
{ "type": "models" }
→ { "kind": "models",
    "groups": [ { "id": "deepseek", "name": "DeepSeek",
                  "models": [ { "id": "deepseek-chat", "name": "DeepSeek Chat",
                                "reasoning": { "efforts": [ { "id": "low", "name": "Low" }, ... ] } } ] } ],
    "failures": [] }

{ "type": "models", "sessionId": "session-abc" }
→ { "kind": "models", "current": { "provider": "deepseek", "model": "deepseek-chat" },
    "routable": true, "groups": [ ... ], "failures": [] }

{ "type": "providers" }
→ { "kind": "providers", "providers": [ { "provider": "deepseek", "displayName": "DeepSeek", "declared": true } ] }

{ "type": "select-model", "sessionId": "session-abc", "provider": "deepseek",
  "model": "deepseek-chat", "reasoningEffort": "high" }
→ { "kind": "select-model", "selected": { "provider": "deepseek", "model": "deepseek-chat", "reasoningEffort": "high" } }
```

---

## 8. 权限控制

| type | 参数 | 说明 |
|---|---|---|
| `permission-options` | `sessionId?` | 可用权限 preset 列表（`namespace`）+ 该会话当前生效值（`sessionPermissions`） |
| `permission` | `sessionId`, `name` | 切换**该会话**的权限 preset（走官方 `/permission` 命令，不触发模型） |

```json
{ "type": "permission", "sessionId": "session-abc", "name": "workspace-write" }
→ { "kind": "permission", "sessionId": "session-abc", "set": "workspace-write",
    "commandId": "cmd-1", "result": { "kind": "success", "text": "..." } }
```

---

## 9. 新会话默认配置

| type | 参数 | 说明 |
|---|---|---|
| `agent-presets` | — | preset 名册（含 `isDefault` 标记） |
| `defaults` | — | 读取默认 agent 预设 + 默认权限 |
| `set-default` | `target`(agent-preset\|permission), `value` | 修改默认预设/默认权限（全局） |

```json
{ "type": "defaults" }
→ { "kind": "defaults", "agentPresetDefault": "standard", "permissionDefault": "ask" }

{ "type": "set-default", "target": "agent-preset", "value": "minimal" }
→ { "kind": "set-default", "target": "agent-preset", "value": "minimal", "applied": true }
```

---

## 10. 分支（fork）

```json
{ "type": "fork", "sessionId": "session-abc", "atSeq": 42 }
→ { "kind": "fork", "sessionId": "session-分支新会话" }
```
- `atSeq`：从该消息所在的**完整一轮**分叉（省略 = 最近完成的 turn）；进行中的 turn 分叉会报 `fork-unavailable`
- 子会话继承源 cwd / 模型 / 血缘 / 标题 / 工作区

---

## 11. 宿主信息

| type | 返回 |
|---|---|
| `host` | `version`, `cwd`, `provider`/`model`（默认模型精简版）, `attachedSessions`, `canOpenPath` |

```json
{ "type": "host" }
→ { "kind": "host", "version": "0.1.0-rc.6", "cwd": "/Users/lichaofan",
    "provider": "deepseek", "model": "deepseek-chat", "attachedSessions": 3, "canOpenPath": true }
```

---

## 12. 服务端主动推送

| kind | 触发时机 |
|---|---|
| `paired` | 首次配对成功；仅此一次返回长期设备 token |
| `hello` | 连接成功：`{ "kind":"hello", "protocol":3, "capabilities":["images"], "authenticated":true, "port":3080, "clients":1 }` |
| `event` | 任意会话的 agent 输出（见下） |
| `question-requested` / `question-resolved` | Human-in-the-loop 问题请求与最终状态 |
| `pong` / `subscribed` / `sent` | 对应请求的回复 |

### `event` 帧（agent 实时输出）
```json
{ "kind": "event", "sessionId": "session-abc", "seq": 42, "time": 1786937352,
  "event": { "type": "assistant/chunk", "turn": 1, "step": 0, "chunkType": "text-delta", "text": "正在" } }
```
`event.type` 覆盖（精炼字段）：
- `user/message` → `{text, source, images?: ImageAttachmentRef[]}`
- `assistant/chunk` → `{turn, step, chunkType: text-delta|reasoning-delta|tool-call-delta|usage|finish, text?/tool?/usage?/finish?}`
- `assistant/message` → `{turn, step, text, reasoning, toolCalls[]}`
- `tool/call` → `{turn, step, callId, name, arguments}`
- `tool/result` → `{turn, step, callId, isError, preview(≤400字符)}`
- `turn/start|end` / `step/start|end` → `{turn, step, reason?}`

---

## 13. 端到端示例（Postman）

1. Connect → 收到 `hello`
2. `{"type":"sessions"}` → 挑 `sessionId`（或直接下一步自动建）
3. `{"type":"subscribe","sessionId":"session-abc"}`
4. `{"type":"message","sessionId":"session-abc","text":"帮我查一下deepseek"}` → `sent`
5. 盯着 Messages 面板：`event` 流实时滚动（chunk → tool/call → tool/result → assistant/message）
6. `{"type":"history","sessionId":"session-abc","view":"conversation","maxMessages":60}` → 最近历史（自动分页用 `beforeSeq: nextBeforeSeq`）
7. `{"type":"session-stats","sessionId":"session-abc"}` → 统计条数据
8. 完事 `{"type":"unsubscribe"}` 或 Disconnect

---

## 14. 安全注意

- `/ws/mobile` 的移动网关默认关闭；本机 WebUI 手动开启后，若 5 分钟内没有设备成功连接会自动关闭
- 网关开启后仍要求已配对设备凭证；不要把 `requireAuth` 设为 `false` 后暴露到网络
- `/mgw/*` 是配对/吊销管理面，默认只允许本机访问；公网代理只应转发 `/ws/mobile`
- DSH HTTP Server 本身没有 TLS、认证或 Origin policy；公网必须使用 TLS 反向代理和 `wss://`
- 长期 token 只保存在 iOS Keychain；服务端磁盘仅保存摘要
- `set-default` / `save-default-model` 是全局写操作，客户端 UI 应加确认
- `question-answer` / `question-cancel` 会直接恢复或终止等待中的 Agent 工具调用；只允许经过鉴权的可信设备提交，并按 `rpcId` 防止重复操作

---

## 15. 版本历史（插件）

| 版本 | 新增 |
|---|---|
| v0.1.5 | workspace-create / directories / host |
| v0.1.6 | 修复消息分发器遗漏（host/directories/workspace-create 未路由） |
| v0.1.7 | models / select-model / permission-options / permission / context-usage |
| v0.1.8 | permission 改走 typert 网关（不再经 prompt） |
| v0.1.9 | 修复 `agentId` wire 键 |
| v0.1.10 | message 支持 workspaceId/cwd 建会话 |
| v0.1.11 | agent-presets / defaults / set-default |
| v0.1.12 | history 字节上限 + 自动续页 + conversation 裁剪 |
| v0.1.13 | session-stats |
| v0.1.14 | default-model |
| v0.1.15 | save-default-model |
| v0.1.16 | fork（新对话分支） |
| v0.1.17 | models 支持无 sessionId 全局目录；新增 providers |
| v0.3.0 | 默认设备鉴权；一次性二维码配对；摘要化凭证存储；WebUI 设备面板；在线状态和即时吊销 |
| v0.5.0 | Human-in-the-loop：转发 API Gateway question 请求、整批回答/取消、重连重放与多端状态收敛 |
| v0.6.0 | DSH 0.1.1 图片：WebSocket Base64 上传、实时图片引用、历史附件按会话安全读取 |

---

*协议与插件源码同源维护：`dsh-plugin-mobile-gateway/lib/index.mjs` 顶部注释即协议摘要。*
