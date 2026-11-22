# dsh Mobile Gateway — 移动业务与传输协议参考

移动端通过经过设备鉴权的 WebSocket 连接与 dsh 通信：订阅 agent 实时输出、发送文字和图片、处理 Human-in-the-loop 提问与操作审批、查询会话/工作区/历史、调整会话配置。本协议由持久化插件 `dsh-plugin-mobile-gateway` 实现。当前源码适配 DSH 0.2.2-rc.3 / Session format 4；移动端实时流接入见 [rc.2 接入说明](docs/dsh-rc2-mobile-integration.md)，插件管理见 [RC2 插件管理对接方案](docs/dsh-0.2.0-rc.2-plugin-management-mobile-integration.md)。

DSH Remote 要求的 `peer` 由网关在 Host 内部创建并注入，身份沿用已配对设备的本机用户权限，生命周期随插件释放；移动端请求帧不增加 `peer` 字段，`dsh-mobile-v1` 协议不变。

- **本机端点**：`ws://127.0.0.1:3080/ws/mobile`（与 dsh web GUI 同端口）
- **局域网端点**：`ws://<电脑的私有局域网 IP>:3081/ws/mobile`（插件独立监听，只提供经过鉴权的 WebSocket）
- **公网端点**：必须由 TLS 反向代理提供 `wss://<域名>/ws/mobile`
- **帧格式**：全部为 JSON 文本帧（UTF-8）；图片字节及语音 WAV 使用标准 Base64
- **连接即推送**：连上后服务端立刻发送一条 `hello`，之后 agent 输出以 `event` 帧实时推送

实验传输扩展：`webrtc-upgrade-v1` 复用鉴权 WebSocket 作为 bootstrap，两个独立 PC 分别承载 control/conversation，显式整组提交后才接入下文业务。WebSocket 继续 JSON 文本；RTC 使用 MGW1 有界二进制分片。实验默认关闭；原有协议和配对不变。完整信令、票据、安全、回退、分片头和 App 状态机以 [WebRTC 接入契约](docs/webrtc-app-integration.md) 为准；共享字节向量见 [transport-v1 fixtures](test/fixtures/transport-v1/frames.json)。网关可联调，App 待接入。

---

本次新增 `message-quotes-v1`、`schedule-management-v2` 和 `plugin-updates-v1`。完整帧示例、引用回放、任务 CAS、插件更新恢复及 App 验收见 [DSH 0.2.2-rc.1 移动端适配说明](docs/dsh-0.2.2-rc.1-mobile-integration.md)。

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

首次连接必须请求子协议 `dsh-mobile-v1, dsh-pair.<pairingCode>`，并通过 `X-DSH-Device-ID` 请求头或下述 `dsh-device.<clientDeviceId>` 子协议提供稳定设备 ID；缺少或包含非法设备 ID 的配对请求会被拒绝，避免每次重连都创建新的可信设备。该值应为客户端持久保存的安装级随机 UUID（iOS 可存入 Keychain），仅用于重新配对时复用可信设备记录，不能替代配对码或设备 token 完成鉴权。兼容实现也可把一次性配对码放在 `?pairingCode=`；但子协议不会进入常见的 URL access log，因此优先使用子协议。

浏览器等无法设置自定义握手头的客户端，可以把同一安装级设备 ID 与设备名放进子协议列表：
`dsh-mobile-v1, dsh-pair.<pairingCode>, dsh-device.<clientDeviceId>, dsh-device-name.<base64url(设备名)>`。
服务端只在缺少 `X-DSH-Device-ID` / `X-DSH-Device-Name`（或该头无效）时回退读取
`dsh-device.` / `dsh-device-name.` 前缀。子协议中的设备 ID 使用 8–128 个
`A-Z a-z 0-9 . _ -` 字符，不能包含请求头格式额外允许的 `:`，因为后者不是合法的
WebSocket 子协议 token 字符；浏览器直接持久化并使用 UUID 即可。设备名的 UTF-8
Base64URL 编码最长 512 字符。对于上述有效输入，两种传递方式语义相同，`clientDeviceId`
仍不是凭证，设备名只用于展示，配对码与长期 token 的要求不变。握手时服务端只协商回
`dsh-mobile-v1`，不会回显 `dsh-device.` / `dsh-device-name.` 或任何密钥。

成功后服务端依次发送：

```json
{ "kind": "paired", "token": "<长期设备 token>",
  "device": { "id": "...", "name": "iPhone", "createdAt": 1787111700000 } }
{ "kind": "hello", "protocol": 3, "capabilities": ["split-channels", "images", "commands", "tasks", "goals", "session-cancel", "queue-control", "session-archive", "session-rename", "file-downloads"], "authenticated": true,
  "device": { "id": "...", "name": "iPhone" }, "port": 3080, "clients": 1 }
```

`paired` 只发送一次。iOS 必须把 token 存入 Keychain，之后使用以下任一方式连接：

- 推荐：HTTP 请求头 `Authorization: Bearer <token>`
- WebSocket 子协议：`dsh-mobile-v1, dsh-auth.<token>`
- 无法设置请求头的浏览器：`dsh-mobile-v1, dsh-auth.<token>, dsh-device.<clientDeviceId>`
  （`dsh-device.` 仅用于复用可信设备记录，可省略）

长期 token 默认禁止放在 URL query 中，避免被代理日志、浏览器历史和监控系统记录。缺少凭证、凭证无效、配对码过期或重复使用时，HTTP Upgrade 返回 `401 Unauthorized`。

#### 多网关身份扩展（当前源码，尚未发布新版本）

保持配对 `version: 2`、子协议 `dsh-mobile-v1` 和 `hello.protocol: 3`。以下新增字段不改变已有业务帧语义：

| 新字段 | 返回位置 | 约定 |
|---|---|---|
| `gatewayId` | 配对载荷、`paired`、`hello`、`GET /mgw/status` | 持久化 UUID v4；同一网关各访问地址、双通道及重启前后相同 |
| `gatewayName` | 同上 | 展示名称，允许改变，不能作为身份或鉴权依据 |
| `endpoints` | 配对载荷、`GET /mgw/status` | 规范化去重的 URL 字符串数组；不在 `hello` 或 `paired` 返回 |

配对仍保留 `publicUrl`，且它排在本次 `endpoints` 第一项。其后按本机配对请求 `endpoints`、插件配置 `endpoints`、公网配置、已取得的 Cloudflare Tunnel 地址、已监听 LAN 地址的顺序合并。每个输入列表及合并结果最多 16 项，每项最多 2048 字符。允许 HTTP(S) 输入并转为 WS(S)，拒绝凭证、query、fragment、未指定监听地址及公网明文 WS。

`POST /mgw/pair` 可额外传入 `endpoints: string[]`，只用于本次配对，不写入配置。移动端对新地址必须在发送凭证前建立信任；`hello` 的 ID 校验发生在鉴权后，不能替代 TLS 和地址确认。多个网关的 token 独立签发、保存和撤销；App 以网关连接上下文路由原有业务请求。

本机管理接口 `POST /mgw/gateway` 接受 `{"mode":"disabled|temporary|persistent"}` 中的一个具体值，例如 `{"mode":"persistent"}`。兼容旧 `{"enabled":true}`（临时开启）与 false（关闭）；不能同时传 `mode` 和 `enabled`。返回 `gatewayEnabled`、`gatewayMode`、`waitExpiresAt`、`connectedClients`。参数错误返回 400；保存失败返回 500 且不改变当前运行模式。

`GET /mgw/status` 增加身份、地址列表及 `gatewayMode`。模式的持久化不影响配对码有效期和文件传输超时。自动超时关闭若遇到磁盘写入失败，会保持当前进程关闭并记录错误；重启可能仍按旧保存模式运行，需修复存储后再次保存选择。

Windows/macOS PC 可从本机管理接口 `POST /mgw/cloudflare` 一键启用 Quick Tunnel：`{"enabled":true,"mode":"quick"}`，无需账户、域名或 Token；返回的随机公网地址在 `GET /mgw/status` 的 `cloudflare.publicUrl` 中，隧道重启后可能变化，App 需重新扫码确认。固定地址可用命名 Tunnel：`{"enabled":true,"mode":"named","hostname":"gateway.example.com","token":"<Tunnel Token>"}`；后续更新可省略 Token 或传空字符串以保留已保存的 Token，关闭时只需 `{"enabled":false}`。状态字段返回模式、支持状态、公开地址、本机入口端口、连接状态和错误，但绝不返回 Token。启用时网关自动切为常驻模式；配置与 Token 保存在独立的 `0600` 文件中。插件会在需要时下载并校验 Cloudflare 官方 `cloudflared` 二进制。两种模式仅在 `127.0.0.1:3082`（可配置）接受已鉴权的 `/ws/mobile` WebSocket，其他 HTTP 路径返回 404；网关关闭或插件卸载时该入口及受管进程一同停止。

`POST /mgw/cloudflare/restart` 无需请求体，仅在网关与 Tunnel 均已开启时重启隧道；未开启时返回 `409`。当前移动连接会断开，Quick Tunnel 的地址可能变化，客户端需重新扫码确认。此操作不会重启 DSH Web，也不会将 `cloudflared` 自动更新到最新版本。

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
启用 `split-channels` 时，`subscribe` 仍由 conversation 连接发送，但上述重放帧会
桥接到 control 连接；交互卡片不得发送到 conversation 连接。

---

## 3. Human-in-the-loop

Human-in-the-loop 分为两条独立通道：

- **提问**：Agent 的 `ask_user_question` 工具向用户收集答案。
- **审批**：高风险工具操作（例如沙箱升权）请求一次性允许或拒绝。

二者都是 Host waterfall 的临时请求，不属于持久化的 `session/event`，且都必须以插件为该次请求生成的 `rpcId` 通过专用响应帧回答，不能作为普通 `message` 发送。该内部实现不改变移动端帧格式。

同一请求遵循“任意端先完成、所有端同步收起”的单胜方规则：Mobile 任一设备先完成时，Gateway 会结束 Host 的 WebUI 远端请求并让所有 WebUI 实例收起；任一 WebUI 先完成时，Host 会取消其余 WebUI 实例，Gateway 同时向所有 Mobile 设备广播终态。迟到响应统一视为 `not-pending`。

### 3.1 提问与回答

Agent 调用 DSH 的 `ask_user_question` 工具时，插件接入 Host 的
`user-questions/request` waterfall，把临时请求投影给移动端，同时继续启动 WebUI
或后续 Host answerer。任一端先给出有效答案即完成该请求；Gateway 会向所有移动端
广播 `question-resolved`。Mobile 先完成时，Gateway 同时取消 WebUI 的对应远端请求，
使其收起半屏弹窗；WebUI 先完成时，移动端收到终态后收起对应卡片。若 Mobile 已断开，
则由仍在等待的 Host answerer 继续处理。

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

`outcome` 为 `answered` 或 `cancelled`。网关启用时会登记待答提问，并同时保留 WebUI/后续 Host answerer；多台移动设备与 WebUI 中的第一个合法响应获胜。实时广播仍按订阅 Session 过滤，后台会话的提问会在设备首次连接或之后打开对应 Session 时以 `replay:true` 重放。若没有可用移动连接和后续 answerer，则保持原有回退行为，不挂住工具调用。所有移动连接都会收到由移动端完成的最终状态并应关闭对应选择界面；DSH 进程重启则会取消这些仅存在于运行时的问题。

---

### 3.2 操作审批

当 DSH 的工具管线要求人工授权时，插件会接入一次 Host `approval/request`
waterfall，并向移动端投影为 `approval-requested`，同时保留 WebUI answerer；WebUI
与 Mobile 中任一端先提交的有效决定生效。Gateway 随后向所有移动端广播
`approval-resolved`；若 Mobile 先完成，还会取消 WebUI 的对应远端请求以收起审批弹窗。
`reason` 是面向用户的审批说明，`toolName` 标识请求操作的工具，`callId` 可用于与实时
工具调用轨迹关联。

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
  "displayReason": { "en": "Allow this command?", "zh-CN": "允许执行此命令？" },
  "replay": true
}
```

- `rpcId`：本次可回答请求的稳定 RPC ID；提交决定时必须原样返回。
- `approvalId`：移动网关生成的本次审批关联 ID；同样必须原样返回，并用于将最终状态关联到本地审批卡片。
- `toolName`：请求审批的工具名。
- `callId` / `reason`：可选。前者可关联工具调用，后者是原始审批说明。
- `displayReason`：rc.2 新增的可选多语言说明；客户端优先按当前语言显示，缺失时回退到 `reason`。该字段也会随待处理请求重放。
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

当前 DSH 默认最多 20 张图片、单图 50 MiB、单条消息图片总计 100 MiB，实际值以最近一次 `history.projections.values.imageLimits` 为准。WebSocket 单帧上限默认 144 MiB，用于容纳 100 MiB 图片经 Base64 后的 JSON 请求；反向代理也必须允许相应大小的 WebSocket 帧。

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

`hello.capabilities` 包含 `queue-control` 时，控制连接会收到 Host 当前待处理消息。DSH 0.1.7-rc.1 从 `session/control` 的 `projections.values.inbox` 提供待处理消息：`next-turn` 映射为 `queued`，`next-step` 按来源映射为 `steering` 或 `context`。连接初始化或 Host 控制流重连后，网关发送完整快照：

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

之后某个 Session 的 `inbox` 投影发生变化时，网关发送该 Session 的完整替换值：

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
| `workspace-changes-summary` | `sessionId`, `seq`, `requestId` | 整轮文件改动清单和增删统计；需 `workspace-changes-v1` |
| `workspace-changes-diff` | `sessionId`, `seq`, `index`, `requestId` | 按清单原始下标读取带行号的 diff；需 `workspace-changes-v1` |
| `file-list` | `sessionId`, `path?`, `requestId?` | 列出会话工作目录内的一层文件与文件夹 |
| `file-resolve` | `sessionId`, `path`, `requestId` | 将文件引用解析为可下载路径及预览元数据；需 `file-references-v1` |
| `file-download-open` | `sessionId`, `path`, `requestId` | 打开普通文件下载；工作区外文件由 DSH 授权读取 |
| `file-download-read` | `transferId`, `offset` | 拉取下载的下一块字节 |
| `file-download-cancel` | `transferId` | 取消并关闭下载 |
| `search` | `query` | 会话全文搜索 |
| `session-stats` | `sessionId` | 执行统计投影（输入框统计条数据源） |
| `context-usage` | `sessionId` | token 用量 + 上下文占用投影 |
| `tasks` | `sessionId` | 当前任务列表（`todos` projection） |
| `goal` | `sessionId` | 当前目标及其 CAS 版本（`goal` projection） |

### 会话列表投影

`sessions.items[]` 保留 Host 返回的会话元信息（包括 `sessionId`、`updatedAt`、`running`、`blank`、`cwd`、`agentPreset`、`parentSessionId` 和 `origin`）。每项 `projections` 仅保留原有的 `asOfSeq` 和 `values.title`，不随列表下发大纲、任务、上下文等完整投影，避免大量会话导致公网隧道传输超时。标题仍从 `projections.values.title` 读取，缺失或 `null` 时沿用客户端的默认标题规则。

```json
{ "type": "sessions" }
→ { "kind": "sessions", "items": [
    { "sessionId": "session-abc", "updatedAt": 1786937352, "running": false, "blank": false,
      "cwd": "/workspace", "agentPreset": "standard",
      "projections": { "asOfSeq": 200, "values": { "title": "排查网关连接" } } }
  ] }
```

此裁剪仅用于 `sessions` 响应，不修改 Host 数据；`history`、`session-snapshot`、控制投影基线及实时投影通知继续提供各自原有的详情。现有客户端无需修改请求或标题解析方式。

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
- `view: "conversation"`：**对话裁剪模式**——隐藏系统消息与 request/header、request/context，移除 Assistant 事件的内嵌 `data.stream`，同时保留 `data.finish`（结束类型和结构化失败原因）；`tool/result` 原始文本块截断到 2000 字符，另用 `data.output/outputTruncated` 保留最多约 16000 字符的首尾输出
- 分页：`hasMore` 为真时用 `beforeSeq: nextBeforeSeq, historyFormatVersion: 4` 请求更早一页

### 会话轮次大纲

`hello.capabilities` 的 `turn-outline-v1` 表示支持完整轮次大纲传输；不要求 Host 开启全文搜索，也不保证自定义 Host profile 挂载了大纲插件。App 可从 `history` / `session-snapshot` 的 `projections.values.turnOutline` 读取数组，每项为 `{turn, seq, prompt, response}`；`seq` 指向 `turn/start`，提示词和回复分别最多 50 / 120 个 UTF-16 code unit，回复在轮次结束后提交。正文分页和字节裁剪不会裁掉大纲。

控制连接（兼容 legacy 单连接）的 `projection-baseline.projections[sessionId].values` 新增 `turnOutline`，缺少该投影时为 `null`。Host 大纲变化时发送完整替换值：

```json
{ "kind": "turn-outline-updated", "sessionId": "s1", "asOfSeq": 40,
  "turnOutline": [{ "turn": 1, "seq": 10, "prompt": "调整输入框阴影", "response": "已减轻阴影。" }] }
```

该通知不受 `subscribe.sessionId` 过滤，不发往 conversation 连接。`[]` 为有效空大纲；`null` 使旧控制大纲失效并降级到已加载轮次。Host 控制流重建会整体替换基线，并为被移除会话发送 `null` 失效通知，沿用其旧缓存水位。控制基线只覆盖 Host 当前控制集合，缺少冷会话不表示会话被删除；进入冷会话仍从其历史快照读取大纲。新控制连接会获得最近缓存的大纲。

`asOfSeq` 是投影切点，不是连续通知序列。数组整体替换，不能 append；App 需处理控制基线代际与历史响应乱序。完整帧示例、触屏交互、分页跳转、版本重建和验收步骤见 [App 会话轮次导航接入指南](docs/turn-outline-app-integration.md)。

### `history` 响应示例

```json
→ { "kind": "history", "sessionId": "session-abc", "events": [ ...原始事件... ],
    "historyFormatVersion": 4, "cursor": 200,
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

### 文件卡片与正文文件引用

`hello.capabilities` 中的 `file-references-v1` 表示支持文件交付事件的完整实时字段以及 `file-resolve`。这是协议 3 的可选增量，不改变 Session V4 格式；关闭 `fileDownloadsEnabled` 后不公布此能力，解析请求返回 `file-download-disabled`。旧客户端可忽略新增能力与事件。

DSH `present` 工具成功后持久化 `deliverables/presented`，移动端根据这个事件渲染卡片，而非从回复文字猜测附件：

```json
{
  "kind": "event", "sessionId": "session-abc", "seq": 42, "time": 1786937352,
  "event": {
    "type": "deliverables/presented", "turn": 3, "callId": "present-1",
    "files": [{ "path": "build/三亚国庆旅游攻略.pdf", "description": "A4 共 8 页" }]
  }
}
```

`history` / `session-snapshot` 中同一事件仍使用原始 `{type, seq, time, data: {turn, callId, files}}` 格式。按 `sessionId + seq` 合并历史和实时事件，再按 `turn` 将卡片放在本轮回复下面。文件引用保存的是路径，读取的是当前文件内容，并未复制成永久附件；文件以后可能被修改或删除。`description` 是模型提供的描述，页数并非结构化字段。

点击卡片或正文中的本地文件链接后，通过**控制连接**解析：

```json
{ "type": "file-resolve", "requestId": "resolve-1", "sessionId": "session-abc", "path": "build/三亚国庆旅游攻略.pdf" }
→ {
  "kind": "file-resolved", "requestId": "resolve-1", "sessionId": "session-abc",
  "path": "build/三亚国庆旅游攻略.pdf", "name": "三亚国庆旅游攻略.pdf",
  "mediaType": "application/pdf", "size": 330752, "modifiedAt": 1786937352000
}
```

- 输入为未做 URL 编码的文件系统路径，可以是相对路径或主机原生绝对路径（POSIX、Windows 盘符和 UNC）。工作区内普通文件保持原有读取方式；工作区外的普通文件通过 DSH `workspaceFiles.stat/readBytes` 读取，权限由该会话的 Host 文件系统决定，不直接通过 Node 文件系统绕过权限。会话 `cwd` 的已知路径别名会映射到真实工作目录。
- 输出 `path` 在工作区内为规范化相对路径，工作区外为 Host 返回的绝对路径（Windows 分隔符统一为 `/`）。`size` 单位为字节；工作区内 `modifiedAt` 为 Unix 毫秒，外部文件省略此字段，不将 Host 的不透明 `version` 伪造为时间戳或用于旧版预览缓存。随后原样把输出 `path` 交给 `file-download-open`，完成分块下载及 SHA-256 校验后在 App 内预览。
- 解析不会创建 `transferId`，下载会重新检查文件。外部文件每个分块都经过 Host 读取并核对路径、字节数和不透明版本，版本变化返回 `file-changed`；DSH 拒绝读取时返回 `file-not-allowed`，不回退到本地读取。卡片事件不扩大权限。`file-list` 仍仅浏览当前会话工作目录。
- `..` 路径段、NUL、空路径返回 `bad-request`；缺失、目录或非普通文件、Host 拒绝读取、超限文件分别返回 `file-not-found`、`file-not-regular`、`file-not-allowed`、`file-too-large`。响应和失败均回显字符串 `requestId`，失败另带 `requestType: "file-resolve"`。
- Markdown 链接由 App 解析，先提取路径并分离 `#L24` 等行号片段，再发送路径；不要把整个 Markdown、HTTP URL 或 `file://` URL 当作路径传入。行内代码只应将本轮已知文件路径及唯一匹配的文件名转换为可点击引用。

两端具体接入点及验收清单见 [文件卡片与预览接入说明](docs/file-cards-mobile-integration.md)。

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
- `file-download-open` 接受 `file-resolve` 返回的相对或绝对路径。空路径、`..` 路径段、NUL、目录及非普通文件仍被拒绝；外部文件仅可经 Host 授权读取。`file-list` 仍拒绝绝对路径、工作区外目录和符号链接。旧版 Host 缺少 `workspaceFiles` 时保持工作区内功能，不能读取外部文件。

### 普通文件上传

已配对连接在启用 `fileUploadsEnabled` 时公布 `file-upload-v1`。上传请求走 control 连接（兼容 legacy），消息走 conversation 连接（兼容 legacy）。普通文件按原始字节进入官方附件存储，取得会话专属 `receiptId`，不接受客户端指定的主机路径。自定义 Host 未组合官方文件上传服务时返回 `file-upload-unavailable`。

| type | 必填参数 | 成功 kind |
|---|---|---|
| `file-upload-open` | `requestId`, `sessionId`, `name`, `size`, `sha256` | `file-upload-opened` |
| `file-upload-chunk` | `requestId`, `uploadId`, `offset`, `data` | `file-upload-chunk-accepted` |
| `file-upload-finish` | `requestId`, `uploadId` | `file-upload-completed` |
| `file-upload-cancel` | `requestId`, `uploadId` | `file-upload-cancelled` |

`requestId` 为 1 至 128 字符的非空字符串，所有上传响应和错误均回显。`sessionId` 必须是已有普通会话；新草稿先使用 `session-create`，子智能体暂不支持文件附件。`name` 只允许不带目录和控制字符的 1 至 255 字符文件名。`size` 为非负安全整数，`sha256` 是完整原始字节的 64 位十六进制摘要，允许空文件。

`file-upload-opened` 返回 `uploadId/sessionId/name/size/chunkBytes/maxBytes/idleTimeoutMs`。chunk 使用标准 Base64，`offset` 按解码字节计数，必须等于当前已确认位置；每次等待 `file-upload-chunk-accepted.nextOffset` 后再发下一块，不支持分块流水线或跨连接续传。finish 校验长度和 SHA-256 后通过官方流式接口提交：

```json
{ "kind": "file-upload-completed", "requestId": "finish-1", "uploadId": "upload-uuid", "sessionId": "s1",
  "receiptId": "host-receipt-uuid", "sha256": "<64 位十六进制摘要>",
  "file": { "attachmentId": "opaque-file-id", "name": "报告.pdf", "bytes": 1234 } }

{ "type": "message", "requestId": "submission-uuid", "sessionId": "s1", "text": "分析这个报告",
  "files": [{ "receiptId": "host-receipt-uuid" }], "mode": "queue" }
```

含文件消息必须有 `requestId`，会原样传给 Host 用于相同提交的重试去重。`files` 最多 20 项，不允许重复凭证；可以纯文件发送或与已有图片、文字混合。Host 校验凭证所属的准确 Session，并将其转换为原生 file 内容块；上传完成不会自动发送消息。

实时 `user/message` 新增 `event.files: [{attachmentId,name,bytes}]`；历史 `data.content[]` 保留 `{type:"file",attachment:{attachmentId,name,bytes}}`。附件 ID 不等于工作区路径，现有图片 `attachment` 和工作区 `file-download-*` 不能用于按此 ID 下载文件。

默认单文件 512 MiB、每块 256 KiB、全网关最多 4 个活动上传、空闲 2 分钟、Host 提交超时 180 秒。可配置 `fileUploadMaxBytes/fileUploadChunkBytes/fileUploadMaxTransfers/fileUploadIdleMs/fileUploadCommitTimeoutMs`，实际分块上限还受 `maxPayloadBytes` 限制。上传开关独立于下载开关。

uploadId 仅归属创建它的 socket；取消、断线、空闲超时和网关停止会清理网关暂存并中止活动提交。原连接可在短期完成缓存内重试 finish 取得同一结果，缓存最多 128 条、默认保留 2 分钟；不提供断点续传或 Host 附件回滚删除。更完整的官方 WebUI 源码对应关系、JSON 示例、错误表、App 状态机和验收步骤见 [移动端普通文件上传对接指南](docs/file-upload-app-integration.md)。

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
| `permission-options` | `sessionId?` | Host `permissionPresets/catalog` 的 `options`、`defaultOptions`、`defaultPreset`，以及该会话当前生效值（`sessionPermissions`） |
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
| `session-agent-preset` | `sessionId`, `requestId?` | 读取当前会话的 `agentPreset` 和 `locked` |
| `select-agent-preset` | `sessionId`, `agentPreset`, `requestId?` | 在首次对话前修改当前会话模式，保持 session ID |
| `defaults` | — | 读取默认 Agent 预设、默认权限及动态可选默认权限（`permissionDefaultOptions`） |
| `set-default` | `target`(agent-preset\|permission), `value` | 修改默认预设/默认权限（全局） |

```json
{ "type": "defaults" }
→ { "kind": "defaults", "agentPresetDefault": "standard", "permissionDefault": "ask", "permissionDefaultOptions": [{ "value": "ask", "name": "Ask" }], "modeSelectionEnabled": true }

{ "type": "set-default", "target": "agent-preset", "value": "minimal" }
→ { "kind": "set-default", "target": "agent-preset", "value": "minimal", "applied": true }
```

DSH 0.1.7-rc.2 的 Agent preset 名册不再包含 `modeSelectionEnabled`。网关在字段缺失时仍允许移动端选择和保存默认模式；旧版 Host 明确返回 `false` 时沿用其禁用语义。这个移动端字段不代表桌面端「代码工作工具」的本地开关状态。

### 当前会话模式选择

`hello.capabilities` 包含 `session-agent-preset` 时，可以进入已创建的空白会话后选模式。
上述两个新增请求走 Control 通道，成功和错误响应均携带 `sessionId` 与原始可选 `requestId`。

```json
{ "type": "session-agent-preset", "sessionId": "s1", "requestId": "get-mode-1" }
→ { "kind": "session-agent-preset", "sessionId": "s1", "agentPreset": "standard", "locked": false, "requestId": "get-mode-1" }

{ "type": "select-agent-preset", "sessionId": "s1", "agentPreset": "minimal", "requestId": "set-mode-1" }
→ { "kind": "select-agent-preset", "sessionId": "s1", "agentPreset": "minimal", "requestId": "set-mode-1" }
```

候选项使用 `agent-presets.presets`：显示 `name`（缺失时使用 `id`），提交 `id`；带 `broken` 的项不可选。
当前值以 `session-agent-preset.agentPreset` 为准，不能用全局 `isDefault` 或 Session header 代替。
`agentPreset` 可以为 `null`，表示会话没有记录预设（旧会话或未使用预设的配置），属于成功查询；不自动回填当前默认值。`locked` 独立来自持久化会话元数据：`agentPreset: null, locked: true` 的旧会话可继续发送消息，但不可切换模式。客户端应将成功返回的有效 `locked` 视为状态已确认，不以预设是否为空判定发送权限。未锁定且没有记录预设时显示「未记录模式」，保留首次对话前的模式选择能力。
Host 在同一 Session 内重组 Agent 并持久化选择，不通过修改全局默认模式实现。

首次消息被 gateway 接受后即锁定；已记录的用户输入或 `turn/start` 也会锁定。
gateway 对同一 Session 的模式切换与消息提交串行处理，Host 同时保留自身的对话边界检查。
未知/损坏的模式由 Host 拒绝，之前的模式保持；停止或完成对话不会恢复可修改状态。
如果状态投影缺失，返回 `agent-preset/unavailable`，客户端不得把未知状态当作可修改。

```json
{ "kind": "error", "requestType": "select-agent-preset", "sessionId": "s1", "requestId": "set-mode-2", "code": "agent-preset/locked", "message": "session has already started; its agent preset is fixed" }
```

Control/旧单连接接收全局模式状态增量，不受所订阅会话过滤；只合并实际携带的字段：

```json
{ "kind": "session-agent-preset-updated", "sessionId": "s1", "agentPreset": "minimal", "seq": 12, "time": 1000 }
{ "kind": "session-agent-preset-updated", "sessionId": "s1", "locked": true, "seq": 13, "time": 1100 }
```

模式变化后，App 应丢弃该会话的命令/技能缓存，重新查询；对话通道的 `agent-preset/selected` 事件也保留 `event.agentPreset`。
增量没有连接基线，进入会话及重连后必须重查 `session-agent-preset`；收到锁定通知或错误后锁定控件。
发送首条消息和切换模式期间暂时禁用操作，等待切换成功再发送消息；不要用旧查询响应覆盖后到的锁定通知。

`session-create` 和不带 `sessionId` 的首条 `message` 也支持可选 `agentPreset`。
已带 `sessionId` 的 `message` 不接受该字段；应提前调用 `select-agent-preset`。
详细 App 状态与验收步骤见 [会话模式接入说明](docs/session-agent-preset-app-integration.md)。

---

## 11. 分支（fork）

```json
{ "type": "fork", "sessionId": "session-abc", "atSeq": 42, "historyFormatVersion": 4 }
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
| `projection-baseline` | 控制投影集合，含 `todos/goal/turnOutline`；连接初始化及 Host 控制流重建时发送 |
| `turn-outline-updated` | 指定 Session 的完整轮次大纲替换值或 `null` 失效通知；仅控制/legacy 连接 |
| `schedule-changed` | Host 定时任务目录已变化；无载荷，重新请求 `schedule-catalog` 或当前 Session 的 `schedule-list` |
| `question-requested` / `question-resolved` | Human-in-the-loop 问题请求与最终状态 |
| `approval-requested` / `approval-resolved` | Human-in-the-loop 操作审批请求与最终状态 |
| `pong` / `subscribed` / `sent` | 对应请求的回复 |

### `event` 帧（agent 实时输出）
```json
{ "kind": "event", "sessionId": "session-abc", "seq": 42, "time": 1786937352,
  "event": { "type": "assistant/message", "turn": 1, "step": 0, "text": "已完成", "reasoning": "", "toolCalls": [] } }
```
`event.type` 覆盖（精炼字段）：
- `user/message` → `{text, source, images?: ImageAttachmentRef[], files?: [{attachmentId,name,bytes}]}`
- 实时 token 使用独立 `assistant-stream`，不是带持久 seq 的 `assistant/chunk`；详见 [rc.2 接入说明](docs/dsh-rc2-mobile-integration.md)。
- `assistant/attempt` → `{turn, step, stream[], finish?: {kind, failure?}}`
- `assistant/message` → `{turn, step, text, reasoning, toolCalls[], interrupted?, usage?, finish?: {kind, failure?}}`
- `session/title` → `{title, source?}`
- `tool/call` → `{turn, step, callId, name, arguments}`
- `workspace/changes` → `{turn}`，宣布整轮文件改动记录；使用事件根节点的 `seq` 查询摘要和单文件 diff，详见“整轮文件改动审阅”。
- `deliverables/presented` → `{turn, callId, files: [{path, description?}]}`，用于本轮回复下方的文件卡片。
- `tool/result` → `{turn, step, callId, isError, preview(≤400字符), output, outputTruncated, error?}`
- `turn/start|end` / `step/start|end` → `{turn, step, reason?, reasonDetails?}`，保留原有 `reason` 字符串；`reasonDetails` 提供结构化终态错误或取消来源。
- `llm/retry` → `{turn, step, retryId, retry, maxRetries?, delayMs, provider, mode, failure}`。
- `llm/retry-started` → `{turn, step, retryId, retry}`。

`failure` 保留上游提供的 `message/code/status/providerRetryAfterMs/requestId` 等诊断字段。工具 `output` 同时包含标准输出、`[stderr]`、沙箱提示和退出状态标记；超过 16000 字符时保留开头和末尾并设置 `outputTruncated: true`。需要未裁剪的完整内容时，按对应 seq 请求不带 `view: "conversation"` 的历史。

移动端必须区分工具失败、模型请求失败、重试和整轮终止：`assistant/attempt` 不代表整轮中断；重试用 `retryId` 合并状态，`llm/retry-started` 更新为已重试并保留失败详情；最终错误以 `turn/end.reason: "error"` 为准，`aborted` 显示取消，`interrupted` 显示中断。Shell 的非零退出码可能仅在输出末尾 `[exit code: N]` 中，Host 的 `isError` 仍为 false；展示时可以标记该工具失败，但不能据此终止整轮。

### 运行中计时提示

DSH Web 的“深度求索中，用时 22 秒 ···”是客户端文案，不作为独立 Host 事件或网关帧发送。移动端可用 `sessions.items[].running` 判断会话是否运行；订阅中的 `event` 帧在根节点带 `time`，`event.type: turn/start` 标记本轮开始，`turn/end` 标记结束。收到 `turn/start` 后以 `Date.now() - time` 在本地更新秒数，收到 `turn/end` 或会话 `running: false` 后停止。计时文本、单位和动画由移动端本地化渲染。

重连得到的 `session-snapshot.events` 只含最近窗口，长时间运行的 Turn 可能已把 `turn/start` 挤出窗口。此时 `sessions.items[].running` 仍可用来显示“深度求索中”，但不能只凭快照推断准确的起始时间；若需要恢复精确计时，应沿 `nextBeforeSeq` 读取更早历史，找到最近尚未结束的 `turn/start`。未取得起始时间前不要从重连时刻重新计算并声称是整轮耗时。

---

## 14. 端到端示例（Postman）

1. Connect → 收到 `hello`
2. `{"type":"sessions"}` → 挑 `sessionId`（或直接下一步自动建）
3. `{"type":"subscribe","sessionId":"session-abc","assistantStream":true}`，等待 `session-snapshot`
4. `{"type":"message","sessionId":"session-abc","text":"帮我查一下deepseek"}` → `sent`
5. 盯着 Messages 面板：独立 `assistant-stream` 展示 token，`event` 流提供已提交的消息和工具事件
6. `{"type":"history","sessionId":"session-abc","view":"conversation","maxMessages":60}` → 最近历史（自动分页用 `beforeSeq: nextBeforeSeq, historyFormatVersion: 4`）
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
| v0.12.1（待发布） | 适配 DSH 0.2.2-rc.3；修复团队投影及子代理继续/中断兼容性，新增 agent-team-mode-v1 会话开关；协议 3、Session 格式 4 不变 |
| v0.12.0 | 适配 DSH 0.2.2-rc.1 与 Node.js 24.9+；新增聊天引用及排队引用编辑、宿主级自动化任务、插件版本查询/更新/详情、跟随 DSH 的界面语言；修复批量投影与图片读取；完整信息见 [版本记录](CHANGELOG.md) |
| v0.10.4 | 精简 `sessions` 列表投影，仅保留 `asOfSeq` 和 `values.title`，修复大量会话通过公网隧道传输时超时的问题；保留会话元信息和历史完整投影，现有移动客户端无需配套修改 |
| v0.10.3 | 适配 DSH 0.2.1-rc.2；为 Remote 请求及实时订阅补齐 Connection Peer，修复读取 `signal` 时的空值报错，并随网关停止释放 Peer；移动端协议保持不变 |
| v0.10.2 | 补齐 `deliverables/presented` 文件卡片实时字段；新增 `file-references-v1` 能力与 `file-resolve` 安全文件引用解析；复用现有分块下载支持移动端预览接入 |
| v0.10.1 | 新增官方 speech Remote 语音输入桥接；模型准备与状态同步；移动端音频转文字与取消转写；连接关闭时清理语音任务 |
| v0.10.0 | 响应式居中控制面板与主题同步；自定义下拉菜单；独立配对模态窗口与缩放动画；按运行实例关闭重启提醒；在线设备折叠列表与移动端设备名称上报；Tunnel 配置交互优化 |
| v0.9.0 | DSH 0.2.0-rc.2 插件管理；PC 端 Cloudflare Quick / 命名 Tunnel 及独立重启；插件私有 `cloudflared` 缓存及校验；配对入口选择指引；网关重启与 DSH Web 停止工具 |
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

## 17. 定时任务（DSH 0.2.2-rc.1）

以下请求走控制连接，Host 未启用定时任务时返回统一错误。`schedule-management-v2` 使用宿主级任务模型，响应为平铺字段并回显可选 `requestId`。

| 请求 | 参数 | 响应 |
|---|---|---|
| `schedule-catalog` | `requestId?` | `items` 全量目录 |
| `schedule-list` | `active?`, `limit?` 1–500, `offset?`, `requestId?` | `items/shown/total/limit/offset` |
| `schedule-view` | `id`, `requestId?` | 当前任务或 `id/code` |
| `schedule-create` | `title/prompt/timing`, `target?`, `requestId?` | 创建后的任务 |
| `schedule-edit` | `id/action/expectedUpdatedAt`, `patch?`, `requestId?` | 更新后的任务，或 `deleted:true`，或 `id/code` |
| `schedule-history` | `id`, `limit` 1–100, `before?`, `requestId?` | `records/retention/nextBefore?` 等 |
| `schedule-run` | `id`, `requestId?` | 任务或 `id/code` |
| `schedule-delete-inactive` | `confirm:true`, `requestId?` | `deleted` 数量 |

`schedule-edit.action` 为 `update/delete`。修改时 `patch` 支持 `title/prompt/timing/target/active`。`expectedUpdatedAt` 必须使用读取到的 `updatedAt`，缺失时传 `null`。`schedule_conflict` 时保留草稿并重新读取，复核后再提交。

旧 `schedule-list(sessionId)` 继续返回该会话关联的活动任务，与宿主级分页参数互斥。旧 `schedule-update(sessionId?, id, expected, title?, prompt?, change?)` 转换为带 CAS 的编辑，`expected` 无 revision 时比对当前记录。旧 `schedule-delete(sessionId?, id, expectedUpdatedAt?)` 转换为删除。旧帧的 `sessionId` 若存在则继续限定任务关联范围。

`schedule_not_found` 表示任务不存在。`schedule_out_of_scope` 表示任务存在，但请求携带的 `sessionId` 既非目标会话，也不在 `involvedSessionIds` 中。

Host `schedule/changed` 转为无载荷 `schedule-changed`。重连、通知或写操作结束后刷新目录与详情。完整目标、规则、冲突、旧客户端转换和示例见 [移动端适配说明](docs/dsh-0.2.2-rc.1-mobile-integration.md)。

## 18. 插件管理（DSH 0.2.0-rc.2）

`hello.capabilities` 包含 `plugin-management-v1`。插件请求走控制连接，必须使用已配对设备 token；即使本机调试关闭了普通连接鉴权，匿名连接也不能执行这些请求。每个请求必须有非空 `requestId`，响应回显。`plugin-catalog` 的 `managementAvailable` 决定当前 Host profile 是否实际支持管理。

| 请求 type | 主要参数 | 成功响应 |
|---|---|---|
| `plugin-catalog` | `requestId` | 同名 kind；`managementAvailable`、`bundles`（每项含 `experimental`）、`plugins`、`officialItems`、`settingsWritable` |
| `plugin-registries` | `requestId` | 同名 kind；`registry`、`fallbackRegistries`、`resolved` |
| `plugin-versions` | `requestId`, `name`, `registry?` | 同名 kind；`result` 为版本列表或业务拒绝 |
| `plugin-detail` | `requestId`, `name`, `language` | 同名 kind；`result` 为 Markdown 详情或 none |
| `plugin-update` | `requestId`, `name`, `version`, `registry?` | `plugin-update-result`；`result` 含最后阶段结果和可选 restore |
| `plugin-inspect` | `requestId`, `spec`, `registry?` | `plugin-inspection`；`result` 为 accepted/refused 检查结果 |
| `plugin-install` | `requestId`, `spec`, `enabled?`, `registry?`, `approvedBuilds?` | `plugin-install-result`；`result` 为 Host `ChangeResult` |
| `plugin-install-status` / `plugin-install-cancel` | `requestId`, `installId` | 同名 kind；`result` 为安装结果/null 或取消状态 |
| `plugin-bundle-set-enabled` | `requestId`, `name`, `enabled` | 同名 kind；`result` 为 `ChangeResult` |
| `plugin-entry-set-enabled` | `requestId`, `entryId`, `enabled` | 同名 kind；`result` 为 `ChangeResult` |
| `plugin-remove` | `requestId`, `name` | 同名 kind；`result` 为 `ChangeResult` |
| `plugin-settings` | `requestId`, `ns?` | 同名 kind；全部 namespace 或指定的 `namespace` 视图 |
| `plugin-settings-mutate` | `requestId`, `ns`, `expectedRevision`, `ops` | 同名 kind；返回修改后的 namespace 视图 |
| `plugin-version-exemptions` / `plugin-version-exemption-set` | `requestId`；写入还需 `packageVersion`, `runtimeVersion`, `enabled`, `acceptRisk?` | 同名 kind；豁免列表或 `ChangeResult` |

Host 的 `plugin-manager/changed` 转为 `plugins-changed`（含 `reason`），`settings/document-updated` 转为 `plugin-settings-changed`（含 `ns`、`revision`）。`plugin-manager/install-state` 和 `plugin-manager/install-log` 只发给发起安装的连接，分别转为 `plugin-install-state` 和 `plugin-install-log`；它们的 `requestId` 就是原安装请求 ID。断线后用新的请求 ID 调 `plugin-install-status`，`installId` 填原安装 ID；切勿直接重复安装。关闭/卸载网关插件自身可能先断线，再由 DSH Web/CLI 恢复。

新增 `plugin-updates-v1` 的更新进度、两层结果、恢复状态与断线核实，以及详情读取，见 [0.2.2-rc.1 移动端适配说明](docs/dsh-0.2.2-rc.1-mobile-integration.md)。

详细字段、官方/第三方页面分组、安装进度、配置 schema、错误处理和 DSH Mobile 验收步骤见 [插件管理对接方案](docs/dsh-0.2.0-rc.2-plugin-management-mobile-integration.md)。

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

### 移动端设备名称

移动端在 WebSocket 握手中通过 `X-DSH-Device-Name` 上报 UTF-8 设备名称的标准 Base64 编码；配对和凭据重连时均发送。网关不使用控制面板指定的名称，未上报时使用“未命名设备”。可信设备接口保留原始 `name`，并提供 `displayName`；同名设备显示编号后缀，例如“我的手机 (1)”“我的手机 (2)”。


## 官方语音输入（`speech-input-v1`）

网关代理 DSH 0.2.0-rc.2 的官方实验性 `speech` Remote。先在 DSH 插件管理中启用 `@deepseek-ai/dsh-experimental-voice-input-bundle`（“语音输入”），并在详情中下载、准备模型；也可由客户端通过下面的准备接口操作。识别模型运行在 DSH 主机上，不进入移动安装包。

所有语音请求必须来自已配对设备，并使用 **control 连接**（兼容 legacy 单连接）。即使关闭本机调试鉴权，未配对连接也不能调用语音接口。配对连接的 `hello.capabilities` 包含 `speech-input-v1`，表示网关协议支持；**是否已启用官方插件、模型是否就绪，需要查询目录**。

每个请求都必须提供非空 `requestId`（最多 128 字符），活动请求和订阅期间不要复用。转写结果不创建 Session、不启动 Agent、不写历史，也不自动发送；客户端根据请求 ID 确认录音仍属于当前草稿后插入文字。

| 请求 `type` | 字段（除 `requestId` 外） | 响应 `kind` |
|---|---|---|
| `speech-catalog` | 无 | `speech-catalog` |
| `speech-subscribe` | 无 | `speech-subscribed`，随后推送 `speech-state` |
| `speech-unsubscribe` | 无 | `speech-unsubscribed` |
| `speech-configure` | `providerId?`, `language?`，至少一个 | `speech-configured` |
| `speech-prepare` | `providerId`, `downloadSource?` | `speech-preparing` |
| `speech-cancel-preparation` | `providerId` | `speech-preparation-cancelled` |
| `speech-transcribe` | `audioBase64`, `providerId?`, `language?` | `speech-transcript` |
| `speech-cancel` | `targetRequestId`，同连接的活动转写 ID | `speech-cancelled` |

### 目录、安装和进度

```json
{ "type": "speech-catalog", "requestId": "speech-info-1" }
```

启用后响应 `available:true`，并透传官方 `providers`, `selection`, `maxDurationSeconds`。`maxAudioBytes` 为官方限制和网关限制的较小者：网关最多接受 4 MiB 解码后 WAV，并按 `maxPayloadBytes` 为 JSON 信封预留空间。官方默认时长为 120 秒，实际值以目录为准。

`providers[]` 包含 `id`, `name`, `location`, `languages`, `preparation`，以及可选 `setupEstimate` 和 `downloadSources`。`preparation.phase` 为 `ready` 或 `standby` 时可转写；`unprepared` 需要准备。不要假设语言代码，使用所选 Provider 的 `languages`。`selection` 是主机保存的默认识别器和语言。

插件未启用/Remote 已撤销时，目录返回：

```json
{ "kind": "speech-catalog", "requestId": "speech-info-1", "available": false,
  "providers": [], "code": "speech/unavailable",
  "message": "Enable the official voice input bundle in DSH plugin management" }
```

```json
{ "type": "speech-subscribe", "requestId": "speech-watch-1" }
{ "type": "speech-prepare", "requestId": "speech-setup-1", "providerId": "sensevoice-local" }
```

每条 `speech-state` 带订阅的 `requestId`，是完整目录快照。准备过程会提供阶段、步骤和真实下载字节。`speech-preparing` 只表示准备请求已提交，不能当作模型已就绪。`downloadSource` 必须来自目录公布的源，官方 Provider 会验证它。断开观察连接或取消订阅不取消 Host 拥有的准备任务；只有 `speech-cancel-preparation` 显式取消。订阅因服务禁用或正常结束而终止时会返回错误，重新启用后需要重新订阅。

### 松手后提交录音、回填文字

客户端长按时录音，松手停止并转换成 **16 kHz、单声道、PCM16 WAV**，将包含 WAV 头的完整文件编码为规范 Base64（不是 PCM 裸流、AAC/M4A 或 Opus）。

```json
{ "type": "speech-transcribe", "requestId": "record-1",
  "providerId": "sensevoice-local", "language": "zh", "audioBase64": "<完整 WAV 的 Base64>" }
```

```json
{ "kind": "speech-transcript", "requestId": "record-1", "text": "帮我检查这段代码",
  "audioSeconds": 3.2, "inferenceSeconds": 0.4 }
```

`text` 允许为空，表示未识别到讲话。录音开始时应从目录捕获识别器和语言并随请求发送，避免主机偏好在录音中改变。这里只支持官方插件的**完整录音转写**，没有实时增量文字、语音通话或 TTS。

每连接最多一个活动转写，网关总共最多四个，每连接最多八个待完成普通语音请求。转写包括目录查询在内有 180 秒超时；官方 Provider 还具有自己的准备/推理限制。

```json
{ "type": "speech-cancel", "requestId": "cancel-1", "targetRequestId": "record-1" }
```

取消回执只表示已发出取消信号；原转写随后返回 `speech/cancelled`，资源清理完成前仍占并发名额。断线、网关停止会中止该连接的活动转写和状态订阅。其他连接不能取消这个转写，即使属于同一设备。客户端上滑取消、切换页面或替换草稿后必须忽略旧请求的迟到结果。

错误统一为 `kind:error`，包含 `requestType`, `requestId`, `code`, `message`。网关错误包括 `authentication-required`, `wrong-channel`, `bad-request`, `speech/unavailable`, `speech/busy`, `speech/request-in-progress`, `speech/request-not-found`, `speech/invalid-audio`, `speech/cancelled`, `speech/timeout`, `speech/invalid-response`, `speech/stream-ended`；官方插件的 `speech/transcription-failed` 等错误代码保留。

## 智能体团队与子会话（agent-team-v1 / subagent-conversations-v1）

当前源码提供两个协议 3 可选能力，Host 适配基线为 DSH 0.2.2-rc.3、Session format 4。完整 APP 实施规范见 [智能体团队 APP 详细接入指南](docs/agent-team-app-integration.md)，包含成员与任务完整字段、目录树、视图切换、消息和停止、投影缓存、恢复流程及验收清单。

| 连接 | 请求/推送 | 说明 |
|---|---|---|
| control | `agent-team` | 请求 `sessionId` 为 Lead ID，`requestId?` 回显；响应 `agentTeam` 完整值及 `projectionState`、精确值的 `asOfSeq` |
| control | `subagents` | 请求 `sessionId` 为父节点 ID，`requestId?` 回显；响应 `subagentCatalog` 直接子节点数组及相同投影状态字段 |
| control | `agent-team-updated` | `{sessionId,asOfSeq,agentTeam}`，团队完整值替换，null 表示失效 |
| control | `subagents-updated` | `{sessionId,asOfSeq,subagentCatalog}`，父节点直接子目录完整替换，null 表示失效 |
| control | `subagent-identity-updated` | `{sessionId,asOfSeq,subagent}`，该子会话身份完整值或 null |
| control | `subagent-timing-updated` | `{sessionId,asOfSeq,subagentTiming}`，该子会话耗时完整值或 null |
| control | `session-status` | `{sessionId,running}`，全局进程内运行状态；初始/重连用 sessions 刷新 |

两个查询都返回 `projectionState: ready | unavailable | migration-required`。没有投影是 null，空目录是 `[]`，空任务板是团队对象中的 `tasks:[]`；迁移提示没有 `asOfSeq`，不能当作精确基线。未找到会话返回 `session/not-found`。查询不激活 Agent、不调用模型。capability 仅表示网关理解协议，不保证 Host 已启用实验性团队插件。

RC.3 宿主的团队投影为 `{enabled,tasks,failure?}`，不再提供历史成员名册。网关在查询、历史/会话快照、控制基线及实时投影中补充 `members:[]`，保留其余原始字段，兼容旧移动端解码；RC.1 的成员数组仍原样转发。缺失任务数组、错误类型的 `members` 等畸形值仍报错。`members:[]` 不表示没有子代理，当前子代理从 `subagentCatalog` 读取；移动端应结合 `enabled` 显示空团队入口，并使用目录的 `name` 展示具名代理。详见 [RC.3 兼容性评估与移动端工作项](docs/dsh-0.2.2-rc.3-compatibility-audit.md)。

新增投影键 `agentTeam/subagentCatalog/subagent/subagentTiming` 同时出现在 `projection-baseline`。上述更新与运行状态不受当前聊天 subscribe 过滤，仅发往 control/legacy。Host control 重建会发送替换基线及失效通知；基线未包含冷会话不表示会话删除。各投影按 `(gatewayId, sessionId, projectionKey)` 管理水位，不能跨会话或跨键比较 seq。初始运行状态从 sessions 查询取得，实时状态不具备持久 seq。

子会话沿用现有 `sessionId` 为当前视图 ID，增加 `parentSessionId`（直接父会话）和 `subagentMode`（`continuable | one-shot | unknown`）；这两个字段必须一起提供。普通会话不带它们，external 节点没有本地子会话地址。

```json
{"type":"subscribe","sessionId":"child","parentSessionId":"lead","subagentMode":"continuable","assistantStream":true}
{"type":"history","sessionId":"child","parentSessionId":"lead","subagentMode":"continuable","requestId":"h1","beforeSeq":20,"historyFormatVersion":4}
{"type":"message","sessionId":"child","parentSessionId":"lead","subagentMode":"continuable","requestId":"m1","mode":"queue","text":"继续处理当前任务"}
{"type":"session-cancel","sessionId":"child","parentSessionId":"lead","subagentMode":"continuable","requestId":"stop1"}
{"type":"tasks","sessionId":"child","parentSessionId":"lead","subagentMode":"continuable","requestId":"todos1"}
```

- conversation：`history/subscribe/message`；control：`session-cancel/tasks/goal`。`goal` 同样支持子地址。其他操作不能仅凭此能力推定支持子地址。
- `subscribed`、follower 的 snapshot/event/assistant-stream/reset 回显父子地址；切换使用新 `subscriptionId/streamId`。旧 legacy 持久事件可能只有 sessionId。
- history、tasks、goal、session-cancel 的正常响应及查询失败回显原请求 requestId（如果提供）。`sent` 对子消息额外返回 `messageId`、父子地址以及原 requestId。
- 子消息内部使用官方专用 continuation 接口；RC.2/RC.3 转为新的 `prompt` 请求及 `interruptByUser`，调用前通过官方子会话历史地址验证直接父子关系；RC.1 保留旧接口。移动端继续传递原有父子地址，无需改 RPC。`message.mode` 仍是 queue/steer，不表示生命周期。只有 continuable 能发送与停止。
- 共享任务来自 Lead 的 `agentTeam.tasks`，负责人字段是 `ownerName`；成员 `todos` 仍是独立内部待办。
- 普通子目录包含 continuable/one-shot/external/unknown；按父节点逐级读取，不自动递归。
- 子会话父子关系由 Host 校验，非法关系返回 `subagent/unauthorized` 等错误；无法继续的模式返回 `subagent/not-resumable`。
- 发送回执只表示 inbox 接受，不保证执行完成，也不提供自动重试去重保证。断线无回执应核对历史/队列，不能盲目重发。
- 本次不提供直接创建成员或变更共享任务的移动 RPC；由用户在 Lead 对话中提出要求，Host 团队工具执行，APP 等待权威投影更新。
## 工具结果图片（tool-result-images-v1）

`hello.capabilities` 包含 `tool-result-images-v1` 时，实时 `tool/result`、
`tool/ptc-dispatch`、`tool/code-dispatch` 的 `event.images` 可携带持久图片附件引用，
结构与用户/助手消息的 `images` 相同：`attachmentId/mediaType/bytes/width/height/name?`。
协议仍为 3，历史格式仍为 4。conversation 历史与 opening snapshot 在上述事件的
`data.images` 中提供同一列表；原始历史可从内容块解析引用。

图片通过现有控制请求 `attachment(sessionId, attachmentId)` 读取，继续由 Host 校验会话引用，
本能力不开放本地文件路径或插件 HTTP 路由。PTC/code 事件同时保留
`rootCallId/parentCallId/subCallId/name/arguments/isError/output/outputTruncated/error?`，
`turn/step` 可能缺失。图片应独立于工具折叠区显示。

完整约束、官方 Host 对不同内容结构的授权限制、移动端共享层及 Android/iOS 实施步骤见
[生图插件图片接入](docs/generated-images-mobile-integration.md)。

## 手机系统连接器（device-tools-v1）

Mobile message routing uses the authenticated connection's deviceId/gatewayId, not caller-supplied message fields. The existing requestId is correlated with the host-created inbox message ID; the Agent uses the messages actually claimed for its step. Source context is available before system-prompt assembly, without adding markers to user text or changing the wire protocol. Mobile phone_* calls omit deviceId and route directly to that source; a different device ID is rejected. Multiple source devices in one input batch are ambiguous, and an offline source never falls back to another phone. Desktop requests without a mobile source must explicitly select a device. See docs/phone-connectors.md for shortcuts and timing logs.

仅已配对设备的 control/legacy 连接可用。七模块为 calendar、reminders、location、photos、music、health、alarms；不包含通讯录。管理端 `GET /mgw/devices` 返回每台设备持久 permissions 与当前连接 modules；`POST /mgw/devices/:id/permissions` 接收 `{ "permissions": { "calendar": true } }` 布尔补丁，复用本机管理面及 Origin 校验。默认全关闭，重配对清空。

App 发送 `device-tools-register`（type、version=1、requestId、递增 capabilityRevision、modules: [{id,enabled,available}]），可选携带本次手机手动开关的 `permissionChanges` 布尔补丁。网关只更新该配对连接所属设备，开启项要求对应模块 enabled/available，严格排除通讯录。网关返回 `device-tools-registered`（kind、version、requestId、capabilityRevision、connectionLeaseId、permissions、permissionSync=true）。普通重连注册不携带补丁，不根据 enabled 自动恢复已撤销的主机权限。旧网关没有 permissionSync 回执时，App 提示更新网关；保存失败、超时或断线不重放已发送的开启操作。每次注册生成新租约并取消旧调用，主机权限改变推送 `device-tools-permissions`。

网关 `device-tool-invoke` 携带 invocationId、connectionLeaseId、tool、arguments、timeoutMs、sessionId、toolCallId、consentContext。App 校验三层权限后，按用户已开启的连接器持续授权自动执行并返回 `device-tool-result`（type、version、两个 ID、status=success 与 result，或 status=error 与 error.code）。取消为网关 `device-tool-cancel`，App 可返回 `device-tool-cancelled` 或 error/cancelled。所有消息 version=1；结果只接受当前设备、连接、租约与 invocationId。撤权、断线、禁用和超时立即清理 pending，迟到结果丢弃。

参数最多 16 KiB，结果最多 128 KiB，最长 120 秒，单设备最多两个在途调用。日历/提醒/健康范围最多 8×24 小时。照片只接受一张最长边 768 像素、原始 JPEG 不超过 64 KiB 的 metadata-free 缩略图，result.images=[{mediaType,data,width,height}]；data 为规范 base64。Agent 插件将其交给宿主附件服务验证落存，输出持久 image block；不会把 base64 传给模型。其他工具拒绝图片和附件字段。详见 [手机连接器实现与联调](docs/phone-connectors.md)。


## Device removal management

`GET /mgw/devices` is the shared active paired-device source for both trusted devices and device permissions, including offline devices. Both views use the same total count and online-first ordering. Revoked devices are absent from both.

`POST /mgw/devices/revoke` accepts `{ "deviceIds": ["id-a", "id-b"] }` and returns `{ "revokedIds": ["id-a", "id-b"], "devices": [...] }` (the remaining active devices with permissions/modules). The ID array must be non-empty and contain non-blank strings of at most 128 characters. Existing management body-size, local-access and Origin checks apply. Repeated or already-removed IDs are harmless; `revokedIds` contains only devices actually removed by this request.

All selected registry records and permissions are persisted in one atomic replacement before any selected connection is closed. Save failure restores the in-memory registry and leaves connections/credentials unchanged. Successful removal cancels native invocations and closes every selected device's WebSocket/RTC channel; removed credentials cannot reconnect. Unselected records and permissions are unchanged. The existing `POST /mgw/devices/:id/revoke` route remains compatible and uses the same persistence behavior.


## iPhone 写入与闹钟

模块注册新增可选 `tools` 数组，值必须属于该模块的固定白名单。未声明 tools 的旧客户端仅使用既有工具，不提供新写入。新增 `calendar.create`、`reminders.create`、`alarms.create`、`alarms.list`、`alarms.cancel`；手机与网关需同时更新。网关权限新增 alarms，仍默认关闭。

所有创建及闹钟取消要求 operationId UUID，同一用户操作重试必须复用。iOS 先原子保存 attempted，再调用系统，保存回执后返回结果。重复操作返回原结果或 outcome_unknown，不重复创建。主机对已派发写入的断线、撤权、超时和无效结果返回 outcome_unknown，因为操作可能已经落库。闹钟使用 iOS 26+ AlarmKit 一次性固定时刻调度，仅管理当前主机登记的 Whaleness 闹钟，不管理苹果“时钟”App。

详见 [iPhone 连接器操作](docs/iphone-connector-actions.md)。


## Apple Music 资料库浏览

新增 music.library（kind=songs/albums/artists/playlists，query 可选，offset=0..10000，limit=1..50）及 music.play-library（kind=songs/albums/playlists，itemId 为返回的 library: ID）。仅向明确声明对应 tools 的手机派发。旧 music.search/music.play 保留数字 ID 兼容。新工具读取个人资料库，不搜索全网目录；分页与空筛选结果不能当作曲库总数或整库为空，读取错误必须保留为错误。详见 docs/iphone-connector-actions.md。


## 地图与精确位置

location 权限模块新增 location.precise、maps.search、maps.geocode、maps.reverse-geocode、maps.directions 和 maps.open。maps.* 也属于 location 模块，注册、权限校验、撤权取消统一使用该映射；只有声明对应 tools 的手机可接收调用。location.current 的两位小数近似结果保持兼容。精确位置依赖系统 fullAccuracy 授权，结果返回实际精度。

地图查询有界返回候选地点或路线，不读取个人收藏、历史和通讯录。maps.open 在新版 Android 返回 ready，仅准备手动点击的地图卡片；iOS 与旧版 Android 的 handoff-requested 回执只表示已安排跳转，均不表示导航已开始。具体参数及真机边界见 docs/iphone-maps-connectors.md。


## 持久化地点标记

location 模块新增 maps.markers.create/list/update/delete，手机需明确声明 tools。记录属于来源手机中按主机隔离的 Whaleness 数据，不是苹果地图收藏。创建、修改、删除需要 operationId UUID，重试原样复用。手机在单个 SQLite 事务中提交标记变化和操作回执，历史重试只返回 replayed=true 的原结果；expectedRevision 可检查修改冲突。列表按更新时间分页，每页最多 20 条。沿用位置开关、前台和来源绑定；详情见 docs/iphone-map-markers.md。


## 手机连接器登记状态查询

新版 `device-tools-registered` 回执附加 `statusQuery: true` 与 `modules: [{id,enabled,available,tools}]`。modules 是网关实际接受的工具交集，包含关闭或未授权的模块；调用仍需要本机开关、系统授权、主机 permissions、当前前台状态及有效租约。不得把 App 自己声明的 tools 冒充网关确认的能力。

手机在已鉴权的控制通道发送 `{type:"device-tools-status",version:1,requestId}`，网关返回 `{kind:"device-tools-status",version:1,requestId,status:"registered"|"not-registered",statusQuery:true,modules,permissions}`。仅当查询连接就是当前登记 owner 时，返回 registered、当前 connectionLeaseId 与 capabilityRevision；其他连接不能借用同设备旧连接的租约。未登记时 modules 为空，不返回其他 owner 的租约。

查询是只读操作：不更换租约、不改变权限、不取消在途工具，不重新申请系统授权。App 只接受匹配当前 requestId、租约及修订的确认；重新注册、断线后忽略旧响应。页面显示时每 10 秒核验一次，前台才发送请求，单次最多等待 5 秒；查询错误或超时显示未确认，并清除展示的能力清单。用户可刷新或主动重新注册；执行连接器任务期间不允许重新注册打断任务。旧网关无清单时显示未确认，不推断为已注册，也不向未声明查询支持的旧网关持续发送查询。


## Apple Music 搜歌与应用卡片

新增原生只读工具 `music.catalog-search`，归属 music，需手机显式声明；参数 query（非空、最多 100 字符），limit 可选（1～20，默认 10）。成功结果 `{items:[{id:"catalog:...",title,artist?,album?,url?}],source:"apple-music-catalog"}`，只包含公开歌曲目录元数据，不代表个人收藏，不调用播放器。失败使用 music_catalog_unavailable、permission_denied 或取消错误，不能伪装成空结果。

`music.library` 的条目新增可选 url，原 library: ID 和播放接口不变。网关校验 URL 为 music.apple.com 的 HTTPS 内容链接，保留专辑链接中的 i 歌曲选择参数；移除其他参数，不接受任意站点、登录页面或将资料库 ID 拼接的链接。

Agent 工具 `phone_music_catalog_search` 和 `phone_music_library` 的结果附加 musicLinks，最多 20 项。助手单独一段输出 `[歌名 · 歌手](官方 URL)`，iPhone 正文渲染为音乐卡片，只有点击才通过 Universal Link 请求打开 Apple Music。无 URL 的本地条目不生成假卡片；打开失败在本机提示，不自动播放或添加曲库。

参见 [iPhone Apple Music 卡片](docs/iphone-music-cards.md)。


### 音乐卡片封面元数据

`music.catalog-search` 与 `music.library` 的条目附加可选 artworkURL（HTTPS 的 mzstatic.com 或其子域，最长 2048 字符）和 durationSeconds（有限数值，0～86400）。网关拒绝非法图片源及时长，不代理任意图片 URL。

musicLinks 附加 album、artworkURL、durationSeconds（有数据才返回）及 cardURL。cardURL 在官方 URL 的片段中携带 `dsh-music-card=<base64url JSON>`，JSON 为 `{v:1,title,artist?,album?,artworkURL?,durationSeconds?}`，最多 4096 字节，标题/歌手/专辑各最多 200 个 UTF-16 单元。原 url 保持无片段，用于普通客户端。客户端跳转时去除片段，仅使用外层通过验证的音乐 URL；元数据不得改变目标歌曲。

Agent 优先使用 cardURL 原样输出音乐卡片，缺失时使用 url。客户端封面异步加载，失败显示音乐图标，不影响打开歌曲；普通旧链接仍可展示，无需依赖临时会话缓存。

## 整轮文件改动审阅（workspace-changes-v1）

`hello.capabilities` 包含 `workspace-changes-v1` 时，可读取该轮改变的文件、增删行数及带旧/新行号的 unified diff。网关在设备鉴权后、发送 hello 前探测官方摘要和 diff 路由；探测最多等待 2 秒，失败不影响普通聊天连接，但不声明此能力。支持 WebSocket、WebRTC 与 legacy 单连接；查询属于 **control** 通道，conversation 通道返回 `wrong-channel`。保持 `protocol: 3`、`historyFormatVersion: 4`。

完成的顶层轮次有改动记录时发送：

```json
{ "kind": "event", "sessionId": "s1", "seq": 160, "time": 1794366000,
  "event": { "type": "workspace/changes", "turn": 3 } }
```

历史及 `session-snapshot` 对应原始事件为 `{type:"workspace/changes", seq, time, data:{turn:3}}`。事件只宣布坐标，不内联摘要/diff；按 `gatewayId + sessionId + seq` 幂等合并，同轮取最新事件。

### 改动摘要

```json
{ "type": "workspace-changes-summary", "requestId": "cs-1", "sessionId": "s1", "seq": 160 }
```

```json
{ "kind": "workspace-changes-summary", "requestId": "cs-1", "sessionId": "s1", "seq": 160,
  "summary": { "turn": 3, "total": 1, "added": 2, "deleted": 1,
    "files": [{ "path": "DESIGN-SPEC.md", "display": "DESIGN-SPEC.md", "added": 2, "deleted": 1 }] } }
```

文件可有 `binary:true`、`oversized:true`；这些文件的 0/0 不表示未改变。`total` 可大于列出的 `files.length`，总统计可包含未列出的文件。保留每项**原始数组下标**用于查询，排序后不能改用显示顺序的下标。`display` 用于展示，`path` 可为相对路径或目录外的主机路径，不能作为任意文件下载授权。摘要不返回 Host 的 cwd 或快照对象 ID。

### 单文件 diff

```json
{ "type": "workspace-changes-diff", "requestId": "cd-1", "sessionId": "s1", "seq": 160, "index": 0 }
```

```json
{ "kind": "workspace-changes-diff", "requestId": "cd-1", "sessionId": "s1", "seq": 160, "index": 0,
  "diff": { "kind": "text", "path": "DESIGN-SPEC.md", "display": "DESIGN-SPEC.md",
    "before": true, "after": true, "coarse": false,
    "hunks": [{ "oldStart": 4, "oldLines": 1, "newStart": 4, "newLines": 2,
      "lines": ["-每段三拍", "+每段四拍", "+所有片段保持原速"] }] } }
```

`before/after` 表示文件在轮次开始/结束时是否存在。hunk 起始行号从 1 开始；空格前缀同时递增旧/新行号，`-` 只递增旧行号，`+` 只递增新行号。只去掉首个前缀，保留正文空白。`coarse:true` 表示比较超时后按整段替换展示。其他正常结果为 `diff:{kind:"binary"|"oversized",path,display}`，不含 hunks。

### 错误、预算与生命周期

请求要求非空 `requestId`（最多 128 字符）、非空 `sessionId`（最多 2048 字符）、非负安全整数 `seq`，diff 还需非负安全整数 `index`。不接受 `childSessionId`。

错误使用 `{kind:"error",code,message,requestType,requestId,sessionId,seq,index?}`，有效的已提供坐标会回带：

| code | 含义 |
| --- | --- |
| `bad-request` | 请求坐标无效 |
| `workspace-changes-unavailable` | 官方只读路由不可用 |
| `workspace-changes-missing` | Host 返回 404：记录释放、未记录或下标不存在；不能当作空摘要 |
| `authentication-required` | Host 拒绝 Peer 认证 |
| `workspace-changes-failed` | Host 异常、响应格式错误或请求超时 |
| `workspace-changes-response-too-large` | 超过摘要 1 MiB / diff 4 MiB 的 JSON body 或最终业务帧预算 |

网关校验字段、hunk 前缀与行数，拒绝残缺/异常数据，不截断后冒充完整 diff。查询超时 30 秒，连接断开或插件 Peer 释放时取消；没有独立 wire cancel。WebRTC 使用已有 MGW1 分片，业务载荷与 WebSocket 一致。

这是**轮次开始到结束的净变化**，不是 Git HEAD 差异或单次工具调用预览。非 Git 目录/Git 不可用时只能保证文件工具捕获范围，Shell 改动可能缺失；不承诺子 Agent 独立摘要。Host 的记录保存在 Session 生命周期内，Host 重启/Session dispose 后即便事件仍在历史中也可能返回 missing。不会从手机当前下载的文件重建旧版本。

网关通过固定的 `/api/changes.summary`、`/api/changes.diff` 在进程内携带 Host 创建的 owner Peer 调用官方认证路由，不公开任意 URL 代理或 `changes.open` 主机桌面操作。APP 集成、显示状态与验收见 [文件改动对接方案](docs/file-changes-app-integration.md)。


Android 地图入口改为手动跳转：新版 `maps.open` 返回 `status=ready` 和 latitude/longitude/name/mode（directions 时附 transport），不安排外部 Activity。网关仍校验坐标与字段白名单，并附加通用 `mapLinks/cardURL/destination`，由 Agent 输出卡片，用户点击后选择地图应用。不能把 ready 表述成已打开地图或开始导航。原 handoff-requested 回执仍兼容 iOS 与旧版 Android；手机和网关需一起更新以支持 ready。

## 移动端 Team 模式开关（agent-team-mode-v1）

RC.2 及以后的 Host 额外声明 `agent-team-mode-v1`。仅根会话可使用 control 请求：

```json
{"type":"agent-team-set-enabled","sessionId":"ROOT_ID","requestId":"unique-id","enabled":true}
```

参数严格限定上述四项，不接受子代理地址。网关复用认证 Peer 调用官方 `agentTeams.setEnabled({agentId,enabled})`，与同一会话的 prompt/preset 保序。宿主持久化完成后再读取真实团队投影，成功回执为：

```json
{"kind":"agent-team-mode-set","sessionId":"ROOT_ID","requestId":"unique-id","agentTeam":{"enabled":true,"tasks":[],"members":[]},"asOfSeq":42,"projectionState":"ready"}
```

错误回显 `requestType=agent-team-set-enabled`、sessionId 和 requestId。持久化失败、投影不可确认或权限拒绝均不能当作保存成功。开关以宿主投影为准，不乐观切换；超时或断线后重新查询，不自动重放写入。旧网关无此能力时隐藏可写入口。关闭不会停止或删除子代理，也不删除历史任务。已有 `modelSelection.lastUsed` 的会话关闭前应确认；确认必须绑定原根会话 ID。新对话先创建真实根会话再配置，开关不是全局默认设置。
