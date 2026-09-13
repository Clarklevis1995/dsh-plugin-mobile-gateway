# dsh Mobile Gateway — WebSocket 协议参考

移动端通过经过设备鉴权的 WebSocket 连接与 dsh 通信：订阅 agent 实时输出、发送文字和图片、处理 Human-in-the-loop 提问与操作审批、查询会话/工作区/历史、调整会话配置。本协议由持久化插件 `dsh-plugin-mobile-gateway` 实现。当前源码仅适配 DSH 0.1.5-rc.2 / Session format 3，移动端接入变更见 [rc.2 接入说明](docs/dsh-rc2-mobile-integration.md)。

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

- 未保存用户选择且未显式配置时，移动网关默认关闭。管理界面支持关闭、临时开启、常驻开启，选择会持久化。
- 临时开启后默认 5 分钟内没有客户端成功建立连接才自动关闭；成功连接后本次运行保持开启，重启重新计时。常驻开启没有该计时器。
- 启动优先级为持久化选择 > `gatewayMode` > 旧 `gatewayEnabled`；旧配置 true 映射常驻，false 映射关闭。
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
{ "kind": "hello", "protocol": 3, "capabilities": ["split-channels", "images", "commands", "tasks", "goals", "session-cancel", "queue-control", "session-archive", "session-rename", "file-downloads"], "authenticated": true,
  "device": { "id": "...", "name": "iPhone" }, "port": 3080, "clients": 1 }
```

`paired` 只发送一次。iOS 必须把 token 存入 Keychain，之后使用以下任一方式连接：

- 推荐：HTTP 请求头 `Authorization: Bearer <token>`
- WebSocket 子协议：`dsh-mobile-v1, dsh-auth.<token>`

长期 token 默认禁止放在 URL query 中，避免被代理日志、浏览器历史和监控系统记录。缺少凭证、凭证无效、配对码过期或重复使用时，HTTP Upgrade 返回 `401 Unauthorized`。

#### 多网关身份扩展（当前源码，尚未发布新版本）

保持配对 `version: 2`、子协议 `dsh-mobile-v1` 和 `hello.protocol: 3`。以下新增字段不改变已有业务帧语义：

| 新字段 | 返回位置 | 约定 |
|---|---|---|
| `gatewayId` | 配对载荷、`paired`、`hello`、`GET /mgw/status` | 持久化 UUID v4；同一网关各访问地址、双通道及重启前后相同 |
| `gatewayName` | 同上 | 展示名称，允许改变，不能作为身份或鉴权依据 |
| `endpoints` | 配对载荷、`GET /mgw/status` | 规范化去重的 URL 字符串数组；不在 `hello` 或 `paired` 返回 |

配对仍保留 `publicUrl`，且它排在本次 `endpoints` 第一项。其后按本机配对请求 `endpoints`、插件配置 `endpoints`、公网配置、已监听 LAN 地址的顺序合并。每个输入列表及合并结果最多 16 项，每项最多 2048 字符。允许 HTTP(S) 输入并转为 WS(S)，拒绝凭证、query、fragment、未指定监听地址及公网明文 WS。

`POST /mgw/pair` 可额外传入 `endpoints: string[]`，只用于本次配对，不写入配置。移动端对新地址必须在发送凭证前建立信任；`hello` 的 ID 校验发生在鉴权后，不能替代 TLS 和地址确认。多个网关的 token 独立签发、保存和撤销；App 以网关连接上下文路由原有业务请求。

本机管理接口 `POST /mgw/gateway` 接受 `{"mode":"disabled|temporary|persistent"}` 中的一个具体值，例如 `{"mode":"persistent"}`。兼容旧 `{"enabled":true}`（临时开启）与 false（关闭）；不能同时传 `mode` 和 `enabled`。返回 `gatewayEnabled`、`gatewayMode`、`waitExpiresAt`、`connectedClients`。参数错误返回 400；保存失败返回 500 且不改变当前运行模式。

`GET /mgw/status` 增加身份、地址列表及 `gatewayMode`。模式的持久化不影响配对码有效期和文件传输超时。自动超时关闭若遇到磁盘写入失败，会保持当前进程关闭并记录错误；重启可能仍按旧保存模式运行，需修复存储后再次保存选择。

完整配对示例、旧 App 迁移、地址信任与错误处理见 [App 对接说明](docs/multi-gateway-app-integration.md)。

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
| `subscribe` | `sessionId`, `assistantStream?` | 事件流过滤；`assistantStream: true` 启用独立实时流及原子基线（见 [rc.2 接入说明](docs/dsh-rc2-mobile-integration.md)），并重放该会话仍待处理的提问与审批（不订阅 = 接收所有会话） |
| `unsubscribe` | — | 取消过滤 |

```json
{"type":"ping"}
→ {"kind":"pong","at":1786937352316}

{"type":"subscribe","sessionId":"session-abc"}
→ {"kind":"subscribed","sessionId":"session-abc"}
```

`subscribed` 之后，服务端会紧接着发送该 Session 尚未处理的
`question-requested` / `approval-requested`，并标记 `replay: true`。客户端必须按
`rpcId` 去重。这保证移动端在审批产生后才打开已有 Session 时仍能显示待处理卡片。

---

## 3. Human-in-the-loop

Human-in-the-loop 分为两条独立通道：

- **提问**：Agent 的 `ask_user_question` 工具向用户收集答案。
- **审批**：高风险工具操作（例如沙箱升权）请求一次性允许或拒绝。

二者都是 Host waterfall 的临时请求，不属于持久化的 `session/event`，且都必须以插件为该次请求生成的 `rpcId` 通过专用响应帧回答，不能作为普通 `message` 发送。该内部实现不改变移动端帧格式。

### 3.1 提问与回答

Agent 调用 DSH 的 `ask_user_question` 工具时，插件直接接入 Host 的 `user-questions/request` waterfall，并把临时请求投影给移动端。若没有可处理该 Session 的移动连接，插件调用 `next()`，由 WebUI 或后续 Host answerer 处理。

#### `question-requested` — 服务端推送问题

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

- `rpcId`：移动网关为这一整批问题生成的不透明稳定 ID。回答或取消时必须原样返回，客户端不得自行生成或解析。
- `questions`：一次工具调用中的完整问题批次；可能包含多题。
- `id`：问题 ID，必须在对应答案中原样返回。
- `header` / `detail`：可选展示信息。
- `options`：可选列表；每项包含 `label` 和可选 `description`。
- `multiSelect`：`true` 允许多选，缺省或 `false` 为单选。
- `intent`：可选展示意图。目前可能为 `{ "kind":"plan-review", "approve":"批准选项标签" }`；未知 intent 应退化为普通选项列表。
- `replay: true`：可选。表示这是移动端连接后重放的仍待回答问题。iOS 必须按 `rpcId` 去重。

#### `question-answer` — 移动端提交整批答案

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

提交规则由移动网关在进入 Host waterfall 前严格校验：

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

#### `question-cancel` — 跳过/取消整批问题

```json
{ "type":"question-cancel", "rpcId":"5ce4f5d1-...", "sessionId":"session-abc" }
```

回执仍为 `question-response`，其中 `action` 为 `cancel`。取消会让等待中的 `ask_user_question` 以 `ASK_CANCELLED` 结束，iOS 应在用户确认后再执行。

#### `question-resolved` — 服务端广播最终状态

```json
{ "kind":"question-resolved", "rpcId":"5ce4f5d1-...", "sessionId":"session-abc",
  "outcome":"answered" }
```

`outcome` 为 `answered` 或 `cancelled`。存在匹配 Session 的移动连接时，移动网关优先认领请求，多台移动设备中的第一个合法响应获胜；若没有匹配连接或连接全部断开，则通过 `next()` 回退给 WebUI/后续 Host answerer。所有移动连接都会收到由移动端完成的最终状态并应关闭对应选择界面。重连时网关会重放仍由它持有的问题；DSH 进程重启则会取消这些仅存在于运行时的问题。

---

### 3.2 操作审批

当 DSH 的工具管线要求人工授权时，插件会接入一次 Host `approval/request` waterfall，并向移动端投影为 `approval-requested`。这正是 Web UI 中“等待审批”卡片对应的能力：`reason` 是面向用户的审批说明，`toolName` 标识请求操作的工具，`callId` 可用于与实时工具调用轨迹关联。

#### `approval-requested` — 服务端推送待审批操作

```json
{
  "kind": "approval-requested",
  "rpcId": "approval-rpc-1",
  "sessionId": "session-abc",
  "approvalId": "approval-1",
  "toolName": "bash",
  "callId": "call-42",
  "reason": "escalate sandbox to danger-full-access",
  "replay": true
}
```

- `rpcId`：本次可回答请求的稳定 RPC ID；提交决定时必须原样返回。
- `approvalId`：移动网关生成的本次审批关联 ID；同样必须原样返回，并用于将最终状态关联到本地审批卡片。
- `toolName`：请求审批的工具名。
- `callId` / `reason`：可选。前者可关联工具调用，后者应直接显示为待审批原因。
- `replay: true`：表示当前仍未决定的审批在移动端连接或切换 Session 后重放。客户端应按 `rpcId` 去重。

审批请求不含工具完整参数；移动端应将 `reason` 与可见的工具调用轨迹作为展示依据，不应自行推断或构造命令。

#### `approval-response` — 移动端提交决定

```json
{
  "type": "approval-response",
  "rpcId": "approval-rpc-1",
  "sessionId": "session-abc",
  "approvalId": "approval-1",
  "outcome": "allowed-once"
}
```

`outcome` 只能是：

- `allowed-once`：仅允许这一次请求的操作。
- `rejected`：拒绝该操作。

这是一次性决定；协议不支持“始终允许”。`cancelled` 与 `unavailable` 是宿主侧状态，移动端不得提交。请求的 `sessionId`、`approvalId` 与 `rpcId` 必须匹配同一待审批项。

网关立即返回交付回执：

```json
{ "kind":"approval-response", "rpcId":"approval-rpc-1", "sessionId":"session-abc",
  "approvalId":"approval-1", "outcome":"allowed-once", "accepted":true }
```

如果另一台移动设备已经先作出决定，或请求已经回退给 WebUI/后续 answerer，则回执为 `accepted:false`，并附带 `reason:"not-pending"`。收到错误帧或未被接受的回执时，客户端应保留当前状态，等待最终状态或重新打开事件流。

#### `approval-resolved` — 服务端广播最终状态

```json
{ "kind":"approval-resolved", "rpcId":"approval-rpc-1", "sessionId":"session-abc",
  "approvalId":"approval-1", "outcome":"allowed-once" }
```

`outcome` 为 `allowed-once`、`rejected`、`cancelled` 或 `unavailable`。所有移动连接都会收到由移动网关完成的最终状态并关闭对应审批卡片。移动端断线重连后，网关会重放仍由它持有的审批；已决或已回退的审批不会重放。

---

## 4. 消息（手机 → agent）

### `message` — 发送消息（会话不存在则创建）
```json
{ "type": "message", "sessionId": "session-abc", "text": "你好",
  "mode": "queue", "workspaceId": "w1", "cwd": "/path" }
```
- `sessionId`：可选。省略时**自动创建新会话**（可用 `workspaceId` 或 `cwd` 指定归属工作区，至多一个，workspaceId 优先）
- `mode`：`"queue"`（排队，默认）/ `"steer"`（打断当前回合）
- `message` 始终是用户 Prompt，Gateway 不会猜测或拦截其中的 `/...`。Host 命令必须使用下文的 `command-execute`；技能（如 `/android-cli 连接设备`）仍作为 `message` 发送，Host 会在 pre-step 阶段注入技能内容。
- `text` 与 `images` 至少提供一项；因此支持纯图片消息
- `clientTimeZone`：可选 IANA 时区，例如 `Asia/Shanghai`，宿主会校验后记录到这条用户消息

### 输入菜单目录（命令 + 技能）

目录按会话查询：Agent preset 会影响 Host 命令，会话工作目录会影响可用技能。客户端输入 `/` 后请求：

```json
{ "type": "commands", "sessionId": "session-abc", "locale": "zh-CN" }
```

```json
→ {
  "kind": "commands",
  "sessionId": "session-abc",
  "locale": "zh-CN",
  "groups": [
    {
      "id": "commands",
      "title": "命令",
      "items": [
        {
          "id": "command:compact",
          "name": "compact",
          "description": "Compact older conversation history",
          "source": "host",
          "ui": {
            "kind": "immediate",
            "submitRequest": "command-execute",
            "submitText": "/compact"
          }
        },
        {
          "id": "command:permission",
          "name": "permission",
          "description": "Switch the permission preset",
          "source": "host",
          "ui": {
            "kind": "select",
            "insertText": "/permission",
            "optionsRequest": "command-options",
            "selectionRequest": "command-select"
          }
        }
      ]
    },
    {
      "id": "skills",
      "title": "技能",
      "items": [
        {
          "id": "skill:android-cli",
          "name": "android-cli",
          "description": "Provides instructions for installing and using the Android CLI",
          "source": "skill",
          "action": "insert",
          "modelInvocable": true,
          "ui": {
            "kind": "input",
            "insertText": "/android-cli ",
            "images": true,
            "submitRequest": "message"
          }
        }
      ]
    }
  ]
}
```

- `groups` 是客户端的权威渲染结构；分组标题、顺序、条目和交互参数全部由服务端下发。
- `locale` 可传 `zh-CN` 或英文 locale；服务端返回实际使用的 locale，并为已知命令下发 `ui.displayHint`。客户端优先显示 `displayHint`，缺失时回退到 Host 原始 `hint`。
- 客户端只解释 `ui`，不按条目名写分支：`immediate` 将 `submitText` 通过 `submitRequest` 发送；`input` 插入 `insertText`、高亮首个 Token 并使用可选的 `displayHint/hint/images`；`select` 插入 `insertText` 并打开通用二级菜单。
- `source: "host"` / `action: "execute"`：真实 DSH 斜杠命令，必须将 `/<name>` 或 `/<name> <args>` 通过 `command-execute.line` 提交，不得放入 `message.text`。
- `source: "skill"`：条目来自 DSH `skill.list({sessionId})`。选中时仅按 `ui.insertText` 写入草稿，发送后 Host 会在 pre-step 阶段加载技能内容，不需要专用执行接口。`modelInvocable: false` 的用户专用技能也会被列出，其显示描述由服务端加上“仅用户”标记。
- `model` 虽然是与官方 Web UI 一致的客户端命令，但选项加载与提交同样走下述通用接口，客户端不需要识别它的名字或模型协议。
- Host 命令和技能各自保留原始顺序，`model` 客户端命令追加在命令组末尾。若未来 Host 自己注册 `model`，gateway 不会重复追加。
- `hello.capabilities` 包含 `commands` 时表示服务端支持此目录接口。

#### Host 命令执行

`ui.submitRequest` 为 `command-execute` 时，客户端将完整命令行发送到专用接口：

```json
{ "type": "command-execute", "sessionId": "session-abc",
  "line": "/compact", "images": [] }
→ {
  "kind": "command-executed",
  "sessionId": "session-abc",
  "line": "/compact",
  "commandId": "command-123",
  "result": { "kind": "success", "text": "Compacted 24 history items (~7230 tokens)." }
}
```

带参数命令仍是 `command-execute`：

```json
{ "type": "command-execute", "sessionId": "session-abc",
  "line": "/plan 帮我完成 Android 端适配", "images": [] }
```

- `line` 必须以 `/` 开头，参数作为同一字符串跟在命令后面。
- 只有目录中 `ui.images: true` 的命令可携带图片；图片结构与 `message.images` 相同。Gateway 会再次校验。
- `result.kind: "error"` 表示命令已进入 Host 但处理失败；客户端应保留当前草稿和图片供用户修改。
- 命令不会生成 `user/message`，也不会进入模型 Prompt。Host 会持久化 `command/run` / `command/done`；`compact` 还会产生 `compaction/start` / `compaction/summary` / `compaction/end`。Gateway 会把这些事件实时转发，客户端据此渲染“正在压缩…”和最终结果。

#### 通用二级菜单

当 `ui.kind` 为 `select` 时，客户端使用 `ui.optionsRequest` 指定的请求类型加载标准化选项：

```json
{ "type": "command-options", "sessionId": "session-abc", "command": "permission" }
→ {
  "kind": "command-options",
  "sessionId": "session-abc",
  "command": "permission",
  "options": [
    { "id": "ask", "label": "Ask", "description": "Ask before risky operations", "selected": true },
    { "id": "workspace-write", "label": "Workspace Write", "selected": false }
  ]
}
```

`id` 是服务端拥有的 opaque 值；客户端只负责原样回传。模型选项和权限选项使用完全相同的 `{id,label,detail?,description?,selected}` 结构。

选择后使用 `ui.selectionRequest` 指定的请求类型提交：

```json
{ "type": "command-select", "sessionId": "session-abc",
  "command": "permission", "optionId": "workspace-write" }
→ {
  "kind": "command-selected",
  "sessionId": "session-abc",
  "command": "permission",
  "selected": { "id": "workspace-write", "label": "Workspace Write", "selected": true }
}
```

客户端用 `selected.label/detail` 更新输入框状态栏。`model`、`permission` 的具体查询、校验和写入全部由服务端处理；现有 `models/select-model` 与 `permission-options/permission` 仅作为兼容接口保留。

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

### 排队消息同步与修改

`hello.capabilities` 包含 `queue-control` 时，控制连接会收到 Host 当前待处理消息。连接初始化或 Host 控制流重连后，网关发送完整快照：

```json
{
  "kind": "session-queues",
  "queues": {
    "session-abc": [
      {
        "id": "message-1",
        "placement": "queued",
        "rpcId": "prompt-1",
        "message": {
          "id": "message-1",
          "content": [{ "type": "text", "text": "稍后处理这件事" }]
        }
      }
    ]
  }
}
```

之后某个 Session 的队列发生变化时，网关发送该 Session 的完整替换值：

```json
{ "kind": "session-queue", "sessionId": "session-abc", "items": [] }
```

- `session-queues.queues` 是全量快照，客户端必须整体替换所有 Session 的本地队列；快照里消失的 Session 也要清除。
- `session-queue.items` 是单个 Session 的全量队列，不能当作追加事件；空数组表示已无待处理消息。
- `id` 是后续编辑操作使用的 `itemId`。`placement` 为 `queued`（下一回合）、`steering`（当前回合最近的下一步）或 `context`（系统上下文）。
- `rpcId` 是 Host 的 Prompt 提交标识，网关会原样转发且它可能不存在。当前 `sent` 回执尚未把该值返回给移动端，因此“发送中本地回显与队列项的精确关联”仍是待实现能力。

编辑排队文本：

```json
{ "type": "queue-update", "sessionId": "session-abc", "itemId": "message-1",
  "action": "edit", "text": "修改后的消息" }
→ { "kind": "queue-item-updated", "sessionId": "session-abc", "itemId": "message-1",
    "action": "edit", "accepted": true }
```

删除排队项或将下一回合消息立即插入当前回答：

```json
{ "type": "queue-update", "sessionId": "session-abc", "itemId": "message-1", "action": "remove" }
{ "type": "queue-update", "sessionId": "session-abc", "itemId": "message-1", "action": "steer" }
```

`queue-item-updated` 只是 Host 已提交操作的回执，不是队列最终状态。App 应始终以最新的 `session-queue` 更新界面；该推送可能在回执之前或之后到达。编辑只接受非空文本；`steer` 只适用于仍处于 `queued` 且 Session 正在运行的消息。目标已经开始处理或消失时，Host 返回 `session/queue-item-not-found`；当前回合已不能插入时返回 `session/steer-unavailable`。

### 停止当前生成与稍后继续

停止当前 Session 正在执行的 Agent 回合：

```json
{ "type": "session-cancel", "sessionId": "session-abc" }
→ { "kind": "session-cancelled", "sessionId": "session-abc", "accepted": true }
```

- `accepted: true` 表示 Host 已接受取消请求；最终停止状态仍以该 Session 后续实时事件和 `sessions.running` 为准。
- 取消只停止当前回合，不会删除 Session 历史，也不会清空已经进入 Host inbox 的待处理消息。
- 稍后继续不需要专用恢复请求。客户端等待 Session 停止后，使用相同 `sessionId` 发送普通 `message` 即可继续已有上下文。
- 如果 Session 不存在、未附加或属于不能由普通 Session API 控制的子 Agent，服务端返回对应 Host 错误。
- `session-cancel` 与 `question-cancel` 不同：前者停止整个 Agent 回合，后者只取消一次 `ask_user_question`。

---

## 5. 会话与历史查询

| type | 参数 | 说明 |
|---|---|---|
| `sessions` | — | 会话列表（`updatedAt/running/blank/cwd/agentPreset`） |
| `session-archive` | `sessionId` | 将 Session 加入 Host 的完整归档集合（隐藏但不删除） |
| `session-rename` | `sessionId`, `title` | 写入用户指定的持久化 Session 名称 |
| `history` | `sessionId`, `beforeSeq?`, `historyFormatVersion?`, `maxMessages?`, `maxBytes?`, `view?` | 历史事件页（见下） |
| `attachment` | `sessionId`, `attachmentId` | 读取历史中属于该会话的图片字节 |
| `file-list` | `sessionId`, `path?`, `requestId?` | 列出会话工作目录内的一层文件与文件夹 |
| `file-download-open` | `sessionId`, `path`, `requestId` | 打开一个工作目录内的普通文件下载 |
| `file-download-read` | `transferId`, `offset` | 拉取下载的下一块字节 |
| `file-download-cancel` | `transferId` | 取消并关闭下载 |
| `search` | `query` | 会话全文搜索 |
| `session-stats` | `sessionId` | 执行统计投影（输入框统计条数据源） |
| `context-usage` | `sessionId` | token 用量 + 上下文占用投影 |
| `tasks` | `sessionId` | 当前任务列表（`todos` projection） |
| `goal` | `sessionId` | 当前目标及其 CAS 版本（`goal` projection） |

### Session 归档与重命名

在 App 端归档 Session：

```json
{ "type": "session-archive", "sessionId": "session-abc" }
→ { "kind": "session-archived", "sessionId": "session-abc",
    "archivedSessionIds": ["session-abc", "session-old"] }
```

归档仅将 Session 从 Workspace 分组界面隐藏，不会删除历史。`archivedSessionIds` 始终是 Host 确认后的**完整归档集合**，客户端应使用它整体替换本地集合，而不是只追加本次 `sessionId`。

在 App 端重命名 Session：

```json
{ "type": "session-rename", "sessionId": "session-abc", "title": "新的会话名称" }
→ { "kind": "session-renamed", "sessionId": "session-abc",
    "title": "新的会话名称", "seq": 128 }
```

Host 会规范化并持久化名称；空白名称返回 `bad-request`，超过 Host 限制或规范化后无效的名称返回 Host 的 `session/title-invalid` 错误。

WebUI、App 或其他客户端造成的变化通过以下帧主动推送：

```json
{ "kind": "session-archives", "archivedSessionIds": ["session-abc"] }
{ "kind": "session-title-changed", "sessionId": "session-abc",
  "title": "WebUI 修改后的名称", "seq": 129, "time": 1786937352,
  "source": { "kind": "user" } }
```

- `session-archives` 在网关取得 opening baseline 后缓存；新设备连接时会收到当前完整集合，之后每次 WebUI 归档都会收到新的完整集合。
- `session-title-changed` 是 Session 列表级元数据通知，即使客户端正在 `subscribe` 另一个 Session 也会收到。
- 同一名称变化仍会作为带序号的普通 `event` 帧发给订阅该 Session 的客户端；客户端可按 `seq` 幂等处理。

### `history` 详细
```json
{ "type": "history", "sessionId": "session-abc", "maxMessages": 60, "maxBytes": 4194304, "view": "conversation" }
```
- 返回**原始 SessionEvent**（`{type, seq, time, data}`，方案A），可选裁剪
- 图片不会内联进历史页。`user/message.data.content[]` 中的图片块为 `{ "type":"image", "attachment": ImageAttachmentRef }`；iOS 使用其中的 `attachmentId` 请求图片数据
- `maxBytes`：单帧字节预算，默认 **4 MiB**；超预算保留最新部分并给出 `nextBeforeSeq` 续页（客户端 16 MiB 上限的安全余量）
- `view: "conversation"`：**对话裁剪模式**——隐藏系统消息与 request/header、request/context，移除 Assistant 事件的内嵌 `data.stream`，`tool/result` 嵌套文本截断到 2000 字符
- 分页：`hasMore` 为真时用 `beforeSeq: nextBeforeSeq, historyFormatVersion: 3` 请求更早一页

```json
→ { "kind": "history", "sessionId": "session-abc", "events": [ ...原始事件... ],
    "historyFormatVersion": 3, "cursor": 200,
    "bytes": 3521, "view": "conversation", "hasMore": true, "nextBeforeSeq": 128,
    "projections": { "asOfSeq": 200, "values": { "tokenUsage": {...}, "contextPressure": {...}, "permissions": {...}, "sessionStats": {...} } } }
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

### 文件下载（图片、文档、IPA、APK 及其他普通文件）

文件下载是独立于历史图片 `attachment` 的二进制传输通道。它不按扩展名做授权白名单：图片、PDF/Office 文档、`.ipa`、`.apk` 和其他**普通文件**均可下载；服务端仅根据扩展名给出 `mediaType`，以便移动端决定打开方式。

所有 `path` 都是相对于该 `sessionId` 的 `cwd` 的相对路径，使用 `/` 分隔。例如先列出根目录：

```json
{ "type": "file-list", "requestId": "files-1", "sessionId": "session-abc" }
→ {
  "kind": "file-list", "requestId": "files-1", "sessionId": "session-abc", "path": ".",
  "entries": [
    { "name": "builds", "path": "builds", "kind": "directory" },
    { "name": "app.ipa", "path": "app.ipa", "kind": "file", "bytes": 123456,
      "modifiedAt": 1787111700000, "mediaType": "application/octet-stream" }
  ]
}
```

打开并按需拉取每一块：

```json
{ "type": "file-download-open", "requestId": "download-1", "sessionId": "session-abc", "path": "builds/app-release.apk" }
→ { "kind": "file-download-opened", "requestId": "download-1", "transferId": "...",
    "sessionId": "session-abc", "path": "builds/app-release.apk", "name": "app-release.apk",
    "mediaType": "application/vnd.android.package-archive", "size": 2345678, "chunkBytes": 524288 }

{ "type": "file-download-read", "transferId": "...", "offset": 0 }
→ { "kind": "file-download-chunk", "transferId": "...", "offset": 0,
    "data": "<标准 Base64>", "eof": false }

{ "type": "file-download-read", "transferId": "...", "offset": 524288 }
→ { "kind": "file-download-chunk", "transferId": "...", "offset": 524288,
    "data": "<标准 Base64>", "eof": true, "sha256": "<64 位十六进制摘要>" }
```

- 客户端必须严格使用服务端返回块的 `offset + 已解码 data 字节数` 作为下一次 `offset`；当前版本不支持断线续传。请先写入临时文件，收到 `eof: true` 后校验整文件 SHA-256，再原子重命名为最终文件。
- 每个 `transferId` 仅归属创建它的 WebSocket 连接。连接关闭、`file-download-cancel`、空闲 2 分钟、传完最后一块或插件卸载都会关闭文件句柄；取消成功返回 `{ "kind":"file-download-cancelled", "transferId":"..." }`。
- 默认每块为 512 KiB、同时最多 4 个下载、单个文件最多 512 MiB。部署方可用 `fileDownloadChunkBytes`、`fileDownloadMaxTransfers`、`fileDownloadMaxBytes`、`fileDownloadIdleMs` 调整；`fileDownloadsEnabled: false` 会关闭该能力，且 `hello.capabilities` 不再包含 `file-downloads`。
- 绝对路径、空路径（`file-download-open`）、`..` 路径段、NUL 字符、工作目录外的符号链接、目录和其他非普通文件都会被拒绝。`file-list` 不返回符号链接，避免客户端误认为其可下载。

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

## 6. 任务列表与目标

WebUI 中的“任务”与“进行中的目标”分别对应 DSH 的 `todos` 和 `goal` session projection。移动端进入会话后应请求 `tasks` 与 `goal` 取得基线；随后以 `tasks-updated` / `goal-updated` 实时更新 UI。

### 任务列表

```json
{ "type": "tasks", "sessionId": "session-abc" }
→ {
  "kind": "tasks",
  "sessionId": "session-abc",
  "asOfSeq": 42,
  "todos": [
    { "content": "检查 Android SDK", "status": "completed" },
    { "content": "创建项目", "status": "in_progress" },
    { "content": "构建 APK", "status": "pending" }
  ]
}
```

- `todos: null` 表示该会话尚未写入过任务列表；客户端可隐藏任务卡片。
- 任务由 Agent 的 `todo_write` 更新；移动端只读展示，不能直接改写。

### 当前目标

```json
{ "type": "goal", "sessionId": "session-abc" }
→ {
  "kind": "goal",
  "sessionId": "session-abc",
  "asOfSeq": 42,
  "goal": {
    "goal": {
      "id": "goal-opaque-id",
      "revision": 7,
      "objective": "初始化一个 Android app",
      "phase": "active",
      "maxGoalRounds": 12
    },
    "roundsStarted": 3,
    "createdAt": 1787111700000,
    "updatedAt": 1787111800000
  }
}
```

`goal: null` 表示没有当前目标。所有目标写操作必须携带刚读取到的 `{id, revision}`。这是 DSH 的 compare-and-set 保护：当 WebUI 或另一台设备已经修改目标时，宿主拒绝陈旧 revision，移动端应重新请求 `goal` 后再提示用户重试。

| type | 参数 | 说明 |
|---|---|---|
| `goal-edit` | `sessionId`, `ref`, `objective?`, `maxGoalRounds?` | 修改目标名称（`objective`）或轮数上限，至少提供一项 |
| `goal-pause` | `sessionId`, `ref` | 暂停当前目标 |
| `goal-resume` | `sessionId`, `ref` | 继续已暂停/阻塞的目标 |
| `goal-clear` | `sessionId`, `ref` | 删除当前目标 |

更改目标名称：

```json
{ "type": "goal-edit", "sessionId": "session-abc",
  "ref": { "id": "goal-opaque-id", "revision": 7 },
  "objective": "完成 Android app 初始化" }
→ { "kind": "goal-edit", "sessionId": "session-abc",
    "ref": { "id": "goal-opaque-id", "revision": 8 } }
```

暂停、继续和删除只替换 `type`：

```json
{ "type": "goal-pause", "sessionId": "session-abc", "ref": { "id": "goal-opaque-id", "revision": 8 } }
→ { "kind": "goal-pause", "sessionId": "session-abc", "ref": { "id": "goal-opaque-id", "revision": 9 } }

{ "type": "goal-clear", "sessionId": "session-abc", "ref": { "id": "goal-opaque-id", "revision": 9 } }
→ { "kind": "goal-clear", "sessionId": "session-abc", "cleared": true }
```

### 实时更新

```json
{ "kind": "tasks-updated", "sessionId": "session-abc", "asOfSeq": 43, "todos": [ ... ] }
{ "kind": "goal-updated", "sessionId": "session-abc", "asOfSeq": 44, "goal": { ... } }
```

服务端只转发 `todos` 与 `goal` projection；客户端按 `asOfSeq` 做高序号覆盖，避免较早推送回写较新的查询结果。

---

## 7. 工作区与目录

| type | 参数 | 说明 |
|---|---|---|
| `workspaces` | — | 全部工作区（含每个的 `sessionIds`） |
| `workspace-create` | `path` | 对**已存在目录**创建工作区（已归属→`created:false` 幂等） |
| `directories` | `path?` | 浏览 server 目录（缺省 = home）；`crumbs` 面包屑 + `entries`（含 `hidden` 标记） |
| `directory-create` | `path`, `name` | 在父目录下创建一个子文件夹 |

```json
{ "type": "workspace-create", "path": "/Users/lichaofan/DeepseekHarnessProject" }
→ { "kind": "workspace-create", "workspace": { "workspaceId": "w9", "path": "...", "title": "...", "sessionIds": [] },
    "created": true }
```

### 创建文件夹

`path` 是当前父目录的绝对路径，`name` 只传新文件夹名称，不传完整目标路径：

```json
{ "type": "directory-create", "path": "/Users/lichaofan/DeepseekHarnessProject", "name": "Sources" }
→ { "kind": "directory-create", "path": "/Users/lichaofan/DeepseekHarnessProject/Sources" }
```

创建和目录浏览使用同一套宿主 Node 文件系统实现，不依赖 DSH 的 native Directory Picker，因此 macOS native 模式也可远程创建目录。父路径必须是绝对路径且必须指向真实存在的目录；名称去除首尾空白后不能为空、`.`、`..`，也不能包含 `/` 或 `\\`。

创建成功后，iOS 应重新发送对应父目录的 `directories` 请求来刷新列表。请求格式、相对父路径或非法名称返回 `bad-request`；目标已存在返回 `directory-exists`；父目录不存在、不是目录或其他文件系统失败返回 `directory-create-failed`。此操作只创建文件夹，不会自动注册工作区；如果要把新目录作为工作区，再使用返回的 `path` 调用 `workspace-create`。

---

## 8. 模型与思考等级

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

## 9. 权限控制

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

## 10. 新会话默认配置

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

## 11. 分支（fork）

```json
{ "type": "fork", "sessionId": "session-abc", "atSeq": 42, "historyFormatVersion": 3 }
→ { "kind": "fork", "sessionId": "session-分支新会话" }
```
- `atSeq`：从该消息所在的**完整一轮**分叉（省略 = 最近完成的 turn）；进行中的 turn 分叉会报 `fork-unavailable`
- 子会话继承源 cwd / 模型 / 血缘 / 标题 / 工作区

---

## 12. 宿主信息

| type | 返回 |
|---|---|
| `host` | `version`, `cwd`, `provider`/`model`（默认模型精简版）, `attachedSessions`, `canOpenPath` |

```json
{ "type": "host" }
→ { "kind": "host", "version": "0.1.0-rc.6", "cwd": "/Users/lichaofan",
    "provider": "deepseek", "model": "deepseek-chat", "attachedSessions": 3, "canOpenPath": true }
```

---

## 13. 服务端主动推送

| kind | 触发时机 |
|---|---|
| `paired` | 首次配对成功；仅此一次返回长期设备 token |
| `hello` | 连接成功：`{ "kind":"hello", "protocol":3, "capabilities":["split-channels","images","commands","tasks","goals","session-cancel","queue-control","session-archive","session-rename","file-downloads"], "authenticated":true, "port":3080, "clients":1 }` |
| `event` | 任意会话的 agent 输出（见下） |
| `session-queues` / `session-queue` | Host 队列完整快照 / 单个 Session 队列替换值 |
| `session-archives` | Host 的完整 Session 归档集合在连接初始化或 WebUI/App 归档后变化 |
| `session-title-changed` | 任意客户端写入新的持久化 Session 名称 |
| `tasks-updated` / `goal-updated` | 当前会话的任务列表或目标 projection 发生变化 |
| `question-requested` / `question-resolved` | Human-in-the-loop 问题请求与最终状态 |
| `approval-requested` / `approval-resolved` | Human-in-the-loop 操作审批请求与最终状态 |
| `pong` / `subscribed` / `sent` | 对应请求的回复 |

### `event` 帧（agent 实时输出）
```json
{ "kind": "event", "sessionId": "session-abc", "seq": 42, "time": 1786937352,
  "event": { "type": "assistant/message", "turn": 1, "step": 0, "text": "已完成", "reasoning": "", "toolCalls": [] } }
```
`event.type` 覆盖（精炼字段）：
- `user/message` → `{text, source, images?: ImageAttachmentRef[]}`
- 实时 token 使用独立 `assistant-stream`，不是带持久 seq 的 `assistant/chunk`；详见 [rc.2 接入说明](docs/dsh-rc2-mobile-integration.md)。
- `assistant/attempt` → `{turn, step, stream[]}`
- `assistant/message` → `{turn, step, text, reasoning, toolCalls[], interrupted?, usage?}`
- `session/title` → `{title, source?}`
- `tool/call` → `{turn, step, callId, name, arguments}`
- `tool/result` → `{turn, step, callId, isError, preview(≤400字符)}`
- `turn/start|end` / `step/start|end` → `{turn, step, reason?}`

---

## 14. 端到端示例（Postman）

1. Connect → 收到 `hello`
2. `{"type":"sessions"}` → 挑 `sessionId`（或直接下一步自动建）
3. `{"type":"subscribe","sessionId":"session-abc","assistantStream":true}`，等待 `session-snapshot`
4. `{"type":"message","sessionId":"session-abc","text":"帮我查一下deepseek"}` → `sent`
5. 盯着 Messages 面板：独立 `assistant-stream` 展示 token，`event` 流提供已提交的消息和工具事件
6. `{"type":"history","sessionId":"session-abc","view":"conversation","maxMessages":60}` → 最近历史（自动分页用 `beforeSeq: nextBeforeSeq, historyFormatVersion: 3`）
7. `{"type":"session-stats","sessionId":"session-abc"}` → 统计条数据
8. 完事 `{"type":"unsubscribe"}` 或 Disconnect

---

## 15. 安全注意

- `/ws/mobile` 的移动网关默认关闭；本机 WebUI 手动开启后，若 5 分钟内没有设备成功连接会自动关闭
- 网关开启后仍要求已配对设备凭证；不要把 `requireAuth` 设为 `false` 后暴露到网络
- `/mgw/*` 是配对/吊销管理面，默认只允许本机访问；公网代理只应转发 `/ws/mobile`
- `/mgw/public-setup` 仅供本机 WebUI 调用，通过受限 Unix Socket 请求 root Helper；Helper 只接受状态查询以及“公网 IPv4 + 当前 DSH 端口”的固定 Nginx 配置操作，不接受命令或文件路径
- DSH HTTP Server 本身没有 TLS、认证或 Origin policy；公网必须使用 TLS 反向代理和 `wss://`
- 长期 token 只保存在 iOS Keychain；服务端磁盘仅保存摘要
- `set-default` / `save-default-model` 是全局写操作，客户端 UI 应加确认
- `question-answer` / `question-cancel` 会直接恢复或终止等待中的 Agent 工具调用；只允许经过鉴权的可信设备提交，并按 `rpcId` 防止重复操作
- `approval-response` 会直接允许或拒绝等待中的高风险工具操作；只允许经过鉴权的可信设备提交，并按 `rpcId` 和 `approvalId` 防止串用或重复操作
- 文件下载只允许读取该会话 `cwd` 内的普通文件；移动端必须在写入完成后校验最终块给出的 SHA-256，且不得把 `transferId` 视为可跨连接复用的凭证

---

## 16. 版本历史（插件）

| 版本 | 新增 |
|---|---|
| v0.7.2 | 独立对话/控制连接；空 Session 创建；停止生成与稍后继续；排队消息同步及编辑/删除/Steer；App 归档/重命名 Session；WebUI 归档集合和名称变化实时同步到 App |
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
| v0.6.2 | 目录创建：通过 API Gateway `host.createDirectory` 在工作区目录下创建子文件夹 |
| v0.6.3 | macOS native picker 兼容：目录创建改用与目录浏览一致的宿主文件系统实现，并补齐路径、名称和错误码校验 |
| v0.6.6 | Human-in-the-loop 操作审批：转发 API Gateway approval 请求、一次性允许/拒绝、重连重放与多端最终状态收敛 |
| v0.6.7 | 订阅已有 Session 时重放待处理 Human-in-the-loop 请求，并增加 Approval 端到端诊断日志与安装版本标记 |
| v0.6.8 | 会话工作目录受限的文件列表与分块下载：支持图片、文档、IPA、APK 等普通文件，含连接归属、路径越界防护、取消、超时和 SHA-256 完整性校验 |
| v0.6.9 | 服务端驱动的命令与技能目录：支持本地化 Hint、通用二级选项、专用命令执行，以及 command/compaction 生命周期事件；Host 命令不再作为用户 Prompt 发送 |
| v0.7.0 | 任务与 Goal 对齐：任务/Goal 基线查询、`todos`/`goal` 实时投影、Goal 改名、暂停、继续与删除 |
| v0.7.1 | DSH v0.1.2-rc.1 兼容：内部迁移至 Remote Gateway 与 Host waterfall，移除 APIProxy 依赖；`dsh-mobile-v1` 保持不变 |

---

*协议与插件源码同源维护：`dsh-plugin-mobile-gateway/lib/index.mjs` 顶部注释即协议摘要。*

### 提前创建空会话

`hello.capabilities` 中的 `session-create` 表示支持发送首条消息前创建会话。
客户端发送 `{"type":"session-create","requestId":"unique-id","workspaceId":"w1"}`，
收到 `{"kind":"session-created","requestId":"unique-id","sessionId":"..."}` 后，
即可使用现有的命令目录、模型和权限接口；该操作不会调用 prompt 或启动 Agent。
`workspaceId` 与 `cwd` 均可省略，同时提供时优先使用 `workspaceId`。
失败返回 `kind:error`、`requestType:session-create` 和原始 `requestId`。
客户端不应自动重试超时的创建请求，以免重复创建会话。


### Independent conversation and control connections

A gateway advertising `split-channels` in `hello.capabilities` accepts the optional
`X-DSH-Channel` upgrade header (`control` or `conversation`). Without this header,
the connection keeps the legacy behavior. Clients must wait for the control hello
capability before opening a second connection. Pair only on control; reuse the
returned device token and device ID for conversation, never reuse a pairing code.

- Conversation: `message`, `history`, `subscribe`, `unsubscribe`; receives their
  replies and subscribed session events. History and live events share this lane
  to preserve their ordering.
- Control: all other requests, including file downloads, rename/archive, session
  cancellation, permissions, questions and approvals. Global metadata and pending
  interactions are delivered only to this connection.
- `ping` is accepted on either connection. A request on the wrong lane receives
  `error` with code `wrong-channel` and `requestType`.

Each connection has its own WebSocket send queue. A slow conversation receiver
does not put file responses behind conversation frames. This isolates socket
queues; the underlying network link and Host resources remain shared. On connection
failure clients reconnect and authenticate both lanes, then resubscribe and catch up
history. Older gateways without the capability continue using one connection.
