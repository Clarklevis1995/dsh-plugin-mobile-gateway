# dsh Mobile Gateway — WebSocket 协议参考

移动端通过一个 WebSocket 连接与 dsh 通信：订阅 agent 实时输出、发送消息、查询会话/工作区/历史、调整会话配置。本协议由持久化插件 `dsh-plugin-mobile-gateway` 实现（v0.1.17）。

- **端点**：`ws://127.0.0.1:3080/ws/mobile`（与 dsh web GUI 同端口）
- **帧格式**：全部为 JSON 文本帧（UTF-8）
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

## 3. 消息（手机 → agent）

### `message` — 发送消息（会话不存在则创建）
```json
{ "type": "message", "sessionId": "session-abc", "text": "你好",
  "mode": "queue", "workspaceId": "w1", "cwd": "/path" }
```
- `sessionId`：可选。省略时**自动创建新会话**（可用 `workspaceId` 或 `cwd` 指定归属工作区，至多一个，workspaceId 优先）
- `mode`：`"queue"`（排队，默认）/ `"steer"`（打断当前回合）
- `text` 以 `/` 开头会被当作**斜杠命令**（如 `/permission ask`），宿主直接执行、**绝不发给模型**

```json
→ { "kind": "sent", "sessionId": "session-abc", "mode": "queue" }
→ { "kind": "sent", "sessionId": "session-abc", "mode": "queue", "command": { "kind": "success", "text": "..." } }   // 斜杠命令时
```

---

## 4. 会话与历史查询

| type | 参数 | 说明 |
|---|---|---|
| `sessions` | — | 会话列表（`updatedAt/running/blank/cwd/agentPreset`） |
| `history` | `sessionId`, `beforeSeq?`, `maxMessages?`, `maxBytes?`, `view?` | 历史事件页（见下） |
| `search` | `query` | 会话全文搜索 |
| `session-stats` | `sessionId` | 执行统计投影（输入框统计条数据源） |
| `context-usage` | `sessionId` | token 用量 + 上下文占用投影 |

### `history` 详细
```json
{ "type": "history", "sessionId": "session-abc", "maxMessages": 60, "maxBytes": 4194304, "view": "conversation" }
```
- 返回**原始 SessionEvent**（`{type, seq, time, data}`，方案A），可选裁剪
- `maxBytes`：单帧字节预算，默认 **4 MiB**；超预算保留最新部分并给出 `nextBeforeSeq` 续页（客户端 16 MiB 上限的安全余量）
- `view: "conversation"`：**对话裁剪模式**——丢弃 `assistant/chunk`（token 回放）与 `request/header`（system prompt），`tool/result` 嵌套文本截断到 2000 字符
- 分页：`hasMore` 为真时用 `beforeSeq: nextBeforeSeq` 请求更早一页

```json
→ { "kind": "history", "sessionId": "session-abc", "events": [ ...原始事件... ],
    "bytes": 3521, "view": "conversation", "hasMore": true, "nextBeforeSeq": 128,
    "projections": { "asOfSeq": 127, "values": { "tokenUsage": {...}, "contextPressure": {...}, "permissions": {...}, "sessionStats": {...} } } }
```

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

## 5. 工作区与目录

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

## 6. 模型与思考等级

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

## 7. 权限控制

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

## 8. 新会话默认配置

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

## 9. 分支（fork）

```json
{ "type": "fork", "sessionId": "session-abc", "atSeq": 42 }
→ { "kind": "fork", "sessionId": "session-分支新会话" }
```
- `atSeq`：从该消息所在的**完整一轮**分叉（省略 = 最近完成的 turn）；进行中的 turn 分叉会报 `fork-unavailable`
- 子会话继承源 cwd / 模型 / 血缘 / 标题 / 工作区

---

## 10. 宿主信息

| type | 返回 |
|---|---|
| `host` | `version`, `cwd`, `provider`/`model`（默认模型精简版）, `attachedSessions`, `canOpenPath` |

```json
{ "type": "host" }
→ { "kind": "host", "version": "0.1.0-rc.6", "cwd": "/Users/lichaofan",
    "provider": "deepseek", "model": "deepseek-chat", "attachedSessions": 3, "canOpenPath": true }
```

---

## 11. 服务端主动推送

| kind | 触发时机 |
|---|---|
| `hello` | 连接成功：`{ "kind":"hello", "protocol":1, "port":3080, "clients":1 }` |
| `event` | 任意会话的 agent 输出（见下） |
| `pong` / `subscribed` / `sent` | 对应请求的回复 |

### `event` 帧（agent 实时输出）
```json
{ "kind": "event", "sessionId": "session-abc", "seq": 42, "time": 1786937352,
  "event": { "type": "assistant/chunk", "turn": 1, "step": 0, "chunkType": "text-delta", "text": "正在" } }
```
`event.type` 覆盖（精炼字段）：
- `user/message` → `{text, source}`
- `assistant/chunk` → `{turn, step, chunkType: text-delta|reasoning-delta|tool-call-delta|usage|finish, text?/tool?/usage?/finish?}`
- `assistant/message` → `{turn, step, text, reasoning, toolCalls[]}`
- `tool/call` → `{turn, step, callId, name, arguments}`
- `tool/result` → `{turn, step, callId, isError, preview(≤400字符)}`
- `turn/start|end` / `step/start|end` → `{turn, step, reason?}`

---

## 12. 端到端示例（Postman）

1. Connect → 收到 `hello`
2. `{"type":"sessions"}` → 挑 `sessionId`（或直接下一步自动建）
3. `{"type":"subscribe","sessionId":"session-abc"}`
4. `{"type":"message","sessionId":"session-abc","text":"帮我查一下deepseek"}` → `sent`
5. 盯着 Messages 面板：`event` 流实时滚动（chunk → tool/call → tool/result → assistant/message）
6. `{"type":"history","sessionId":"session-abc","view":"conversation","maxMessages":60}` → 最近历史（自动分页用 `beforeSeq: nextBeforeSeq`）
7. `{"type":"session-stats","sessionId":"session-abc"}` → 统计条数据
8. 完事 `{"type":"unsubscribe"}` 或 Disconnect

---

## 13. 安全注意

- 当前 `/ws/mobile` **无认证**：任何能连到端口的人都能读会话、发消息、改配置（含全局默认值）
- 仅限本机/受信局域网使用；**暴露公网前必须加 token 认证**
- `set-default` / `save-default-model` 是全局写操作，客户端 UI 应加确认

---

## 14. 版本历史（插件）

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

---

*协议与插件源码同源维护：`dsh-plugin-mobile-gateway/lib/index.js` 顶部注释即协议摘要。*
