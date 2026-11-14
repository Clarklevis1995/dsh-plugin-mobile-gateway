# APP 文件改动与 Diff 对接方案

核查日期：2026-11-11。基线：当前 mobile-gateway 工作区、本机安装的 DSH `0.2.2-rc.1`，以及相邻 `dsh-mobile` 仓库代码。

网关第一阶段已实现：`workspace-changes-v1`、实时事件补全、摘要/diff 查询、认证桥接、响应预算与断线取消。APP DTO、Store、原生界面及工具级预览仍待实施；本文中相关“待修改”表格是 APP 和后续阶段清单。实际网关契约以 `PROTOCOL.md` 为准。

## 1. 结论与范围

可以支持截图中的「文件名 + 新增/删除行数 + 红绿逐行 Diff」。DSH 已经有对应数据，移动网关需要补齐事件字段与查询桥接，APP 增加共享模型和原生展示。

建议分两步：

1. **先做整轮改动审阅**：复用 DSH 的 `workspace/changes`、改动摘要和带行号的 diff，轮次结束后显示文件卡片，点击查看。这一路能提供准确的旧/新行号和整轮增删统计。
2. **再做执行中的单次编辑预览**：复用 `tool/call` 和结果 `meta.diffs`，区分「准备修改」与「已完成」。单次编辑数据只有局部文本，没有全文件起始行号，不能冒充整轮审阅数据。

这是读取和展示能力；本期不包含编辑、撤销、应用补丁或回滚。也不等同于 Git `HEAD → 工作区` 的改动：整轮审阅比较的是**该轮开始与结束的工作区状态**。同轮改动后又还原的内容不会作为净改动保留；已有未提交改动不会自动算成本轮新增改动。

## 2. 已核实的数据链路

| 层级 | 已有能力 | 当前缺口或边界 |
| --- | --- | --- |
| DSH 文件工具 | `write/edit` 的 `tool/result.data.meta` 保存实际应用后的局部 `diffs`；`apply_patch` 保存可确认的改动及 `stopped` | `meta` 是工具私有 JSON，不能盲目当统一业务模型；局部片段无绝对行号 |
| DSH 工作区记录器 | `workspace/changes.data = {turn}`；摘要包含文件列表、增删统计；按事件 seq 与原始文件 index 查询 diff | 摘要和比较保存在 Host 内存/临时快照，Session dispose 或 Host 重启后可能不可用 |
| 网关实时事件 | `tool/call` 保留参数；`tool/result` 保留输出、错误和图片 | `buildWireEvent` 丢弃结果 `meta`；`workspace/changes` 落入默认分支，仅留下 type，连 turn 都丢失 |
| 网关历史/进入快照 | 原始事件保留 data；conversation 裁剪使用展开复制，未主动删除 meta 或 workspace/changes | 实时与历史结构不一致；没有摘要/diff 移动查询请求 |
| APP 共享层 | 能解析工具调用/结果，历史数据可保存在 raw | 尚无文件改动 DTO、整轮改动投影、查询 Store 与 diff 行模型 |

### 2.1 推荐来源：整轮改动

DSH 已有经过认证的只读路由：

```text
GET /api/changes.summary?sessionId=<id>&seq=<workspace/changes.seq>
GET /api/changes.diff?sessionId=<id>&seq=<workspace/changes.seq>&index=<原始数组下标>
```

摘要返回 `turn/files/total/added/deleted`，不返回 Host 内部的 cwd 与快照对象 ID。文件项为：

```typescript
{ path: string; display: string; added: number; deleted: number;
  binary?: true; oversized?: true }
```

`path` 可能为工作目录相对路径，也可能是目录外的 Host 路径；`display` 是用于显示的路径。它们不能被当作手机下载授权或任意主机文件读取授权。

文本 diff 有 `oldStart/oldLines/newStart/newLines/lines`，能直接渲染截图里的双行号和红绿底色；还支持 `binary`、`oversized` 拒绝类型，以及比较超时后的 `coarse` 标记。

上游默认最多列出 500 个文件、单文件每侧上限 2 MiB、文本比较预算 100ms；这些均可配置，APP 不能写死为服务端保证。`total` 可能大于 `files.size`；总统计可以包含未列出的文件。二进制/超限文件的 0/0 不表示内容未改变。

在 Git 仓库中使用轮次前后快照，并用文件工具捕获补充 Git 未覆盖路径；非 Git 目录或 Git 不可用时只记录文件工具改动，不能保证 Shell 修改都被捕获。记录器排除子 Agent Session，不承诺子会话有独立摘要。根会话摘要也不是每项修改归属哪个 Agent 的审计证据，共享目录的其他写入可能出现在同一轮净差异里。

### 2.2 辅助来源：单次工具改动

已安装版本的文件工具 meta 形状：

```typescript
// write
{ operation: 'create' | 'update'; path: string; diffs: FileDiff[] }
// edit
{ path: string; diffs: FileDiff[] }
// apply_patch
{ diffs: FileDiff[]; stopped: boolean }
// 每项是一个局部 hunk，常有前后各 3 行上下文
interface FileDiff { path: string; oldText: string | null; newText: string }
```

注意：

- `tool/call.arguments` 是调用意图，只有结果确认后才能显示「已修改」。失败时不得把调用预览当作应用成功。
- `oldText == null` 在局部 hunk 中也可能是纯插入；单凭它不能判断新建文件。
- `write` 新建文件的结果 `diffs` 可以为空；旧版本或无变化覆写也可能没有可用 diff，不能把空数组统一解释成失败或新增。
- 多文件 patch 可能部分完成，`stopped` 必须保留；新建/删除的结果 meta 不一定有足够片段重建所有变化。
- `tool/ptc-dispatch`/`tool/code-dispatch` 也可能携带 meta，应保留调用层级关系并防止与根调用重复展示。
- 这些片段缺少绝对行号；可以显示片段内行号，但必须标成局部片段。不能下载当前文件反查行号，重复文本与后续编辑会导致错配。

## 3. 网关协议（第一阶段已实现）

### 3.1 能力与事件

新增独立能力 `workspace-changes-v1`，表示支持以下整轮查询；将来的工具预览使用 `tool-file-diffs-v1`，避免一个能力名承诺两种不同语义。沿用 `protocol: 3` 和 `historyFormatVersion: 4`；通过可选字段和新请求扩展。

能力仅在相应 Host 路由/适配器可用时声明，不能仅根据版本号推断。网关对无坐标的固定 GET 路由探测预期 400；未挂载返回 404，非 owner 返回 403。每次鉴权后连接前探测最多 2 秒，共享并发探测；失败只省略能力，不阻断聊天。路由已挂载也不代表所有历史 seq 仍可读取；404 属于单条记录状态。

实时补全：

```json
{
  "kind": "event", "sessionId": "s1", "seq": 160, "time": 1794366000,
  "event": { "type": "workspace/changes", "turn": 3 }
}
```

历史与 opening snapshot 继续使用原始结构：

```json
{ "type": "workspace/changes", "seq": 160, "time": 1794366000,
  "data": { "turn": 3 } }
```

不要在事件流中内联整份 diff。这样不增加每个订阅者的流量，也不把大 diff 混入工具输出的 400/16000 字符裁剪通道。

### 3.2 摘要查询

在 control 连接发送，legacy 单连接也支持；所有请求/响应使用 requestId 关联，并带回来源坐标。

```json
{ "type": "workspace-changes-summary", "requestId": "cs-1", "sessionId": "s1", "seq": 160 }
```

```json
{
  "kind": "workspace-changes-summary", "requestId": "cs-1", "sessionId": "s1", "seq": 160,
  "summary": {
    "turn": 3, "total": 1, "added": 2, "deleted": 1,
    "files": [{ "path": "DESIGN-SPEC.md", "display": "DESIGN-SPEC.md", "added": 2, "deleted": 1 }]
  }
}
```

文件身份是 `gatewayId + sessionId + seq + 原始 index`。APP 可排序，但须保存原始 index；不能用排序后的下标查询。

### 3.3 Diff 查询

```json
{ "type": "workspace-changes-diff", "requestId": "cd-1", "sessionId": "s1", "seq": 160, "index": 0 }
```

```json
{
  "kind": "workspace-changes-diff", "requestId": "cd-1", "sessionId": "s1", "seq": 160, "index": 0,
  "diff": {
    "kind": "text", "path": "DESIGN-SPEC.md", "display": "DESIGN-SPEC.md",
    "before": true, "after": true, "coarse": false,
    "hunks": [{ "oldStart": 4, "oldLines": 1, "newStart": 4, "newLines": 2,
      "lines": ["-每段三拍", "+每段四拍", "+所有片段保持原速"] }]
  }
}
```

二进制/超限仍是正常响应中的数据状态：`diff = {kind: "binary" | "oversized", path, display}`。`before=false/after=true` 可标记新建，反向为删除；不要仅根据 +N/-N 推断操作类型。首期不承诺重命名识别。

### 3.4 错误、限制与传输

复用 `kind: error`，补齐 `requestType/requestId/sessionId/seq/index?`：

| code | 含义与 APP 行为 |
| --- | --- |
| `bad-request` | seq/index 必须为非负安全整数，requestId 非空；拒绝无效参数 |
| `workspace-changes-unavailable` | Host 路由或能力未挂载；提示升级/不可用 |
| `workspace-changes-missing` | Host 返回 404，记录已释放、未曾记录或 index 无效；提示“该次改动记录已不可用” |
| `workspace-changes-failed` | 上游 500 或异常；保留卡片，允许重试 |
| `workspace-changes-response-too-large` | JSON 超过网关响应预算；提示过大，不渲染残缺 diff |

不得把 404 转成空摘要，避免误显示“没有改动”。认证拒绝沿用既有认证错误，不能伪装为记录过期。

摘要和单文件 diff 的完整 JSON 响应分别限制为 1 MiB、4 MiB；对上游 body 做限长读取并校验最终 wire 帧大小。转义字符可能放大 JSON，不能只检查文本长度。超限返回错误，不截断单行或 hunk 冒充完整数据；WebRTC 复用现有分片，WS/RTC 传同一业务模型，不另加 base64。

首期按需查询单文件，无摘要分页、无 diff 分页；列表明确展示“已列出 N / 总计 M”。若确需查看被上游 cap 省略的文件，需要新增 Host 分页能力，不能由 APP 伪造下一页。

页面关闭/切网关时在 APP 取消本地任务并丢弃迟到结果；Host 调用绑定连接 signal 与请求超时。首期没有独立 wire cancel，不声称关闭页面能即时中断已发出的查询。

### 3.5 Host 适配与代码落点（已实现）

`createDshHostAdapter` 已增加 `workspaceChanges.available/refresh/read`：通过现有 `connection.createSharedFetchHandler('/api')` 调用上述两条固定路由，并传入已认证 peer，沿用文件上传已使用的进程内认证调用模式。不能假设存在未经核实的 Typert `changes/*` 方法，也不需要公开桌面 HTTP 端口或把浏览器 Cookie 交给 APP。

仅允许固定 GET 路由与类型化坐标，不能提供任意 URL 代理；对 session 访问沿用现有 peer 认证边界。目录外改动可通过 Host 已记录的 seq/index 读取比较；“打开当前文件”另走 `file-resolve` 与下载授权，不能借 diff 路由扩大下载范围。`changes.open` 打开的是主机桌面文件，不用于手机预览。

| 文件 | 已实现内容 |
| --- | --- |
| `lib/dsh-host-adapter.mjs` | 固定路由桥接、能力检测、signal、大小限制与状态映射 |
| `lib/index.mjs` | `buildWireEvent` 增加 workspace/changes.turn；请求分发、响应坐标、hello 能力；不变更历史 seq |
| `PROTOCOL.md` | 实施完成后登记能力、请求/响应、错误和生命周期约束 |
| `test/workspace-changes*.test.mjs`、`test/gateway.test.mjs` 与原有 Host 测试 | 认证桥接、实时/历史一致性、无效坐标、404/500、体积预算、连接退出 |

工具预览阶段建议在网关适配层将已识别文件工具的 meta 校验为可选 `fileDiffs`（path/oldText/newText）及操作/停止标记；实时、历史和 PTC 同一提取器，不原样透传所有工具私有 meta。必须先通过 tool/call.name 或 dispatch.name 确认生产工具，再做形状校验。该扩展须单独补充契约，不影响第一阶段交付。

## 4. APP 对接方案

以下路径均相对相邻 `dsh-mobile` 仓库；本次只检查，不修改 APP。

### 4.1 KMM 共享层

| 位置 | 待修改内容 |
| --- | --- |
| `shared/.../protocol/GatewayDtos.kt` | 新增 ChangedFile、ChangesSummary、DiffHunk、Text/Binary/Oversized Diff；GatewayEvent 和 RawSessionEvent.normalizedEvent 保留 workspace/changes.turn |
| `shared/.../protocol/GatewayWireDecoder.kt` | 解码两个响应与带坐标错误；未知字段兼容；校验非负统计、行号、hunk 前缀和预算 |
| `shared/.../gateway/GatewayProtocol.kt` | 新增摘要/diff 控制请求与能力读取；requestId 关联 |
| `shared/.../projection/ConversationProjection.kt` | 为对应 turn 建立改动入口；同轮采用最新 workspace/changes.seq，事件按来源与 seq 幂等 |
| 新增 `shared/.../facade/SharedWorkspaceChangesStore.kt` | 按事件坐标缓存摘要/单文件详情；查询合并、超时、重试、失效、加载状态和内存限额 |
| `shared/.../facade/SharedConversationStore.kt` 及原生桥接快照 | 暴露摘要、卡片和详情状态，保证 Android 与 Swift 都获得新模型 |

建议核心模型（示意，完整序列化与可见性按项目约定）：

```kotlin
data class ChangesKey(val gatewayId: String, val sessionId: String, val seq: Int)
data class ChangedFileRef(val key: ChangesKey, val originalIndex: Int)
data class DiffRow(
    val kind: DiffRowKind, // CONTEXT / ADD / DELETE
    val oldLine: Int?,
    val newLine: Int?,
    val text: String
)
```

Store 状态使用 Idle/Loading/Ready/Missing/Error；Binary/Oversized 属于 Ready 的内容类型。进入会话后，为可见轮次懒加载摘要；可选预取最近一轮。点击文件才加载 diff，不因一张卡片出现就预取全部文件。

请求回调必须持有原始 key、index、requestId 和连接代际。切会话可保留缓存，但不能把来源会话的响应弹到当前会话。重连不让旧响应覆盖新状态；Host 重新启动后应使先前 Missing 状态可以重新核查，已缓存内容可明确显示为本地保存的记录。

分页暂时缺少目标 turn 时保留事件，稍后挂载；同轮新 seq 到达后使用新坐标，不能把前后两次摘要简单相加。多次修改同一文件的净统计只使用 Host 摘要；单次工具片段不合并成“整轮 diff”。

### 4.2 统一交互

```text
轮次结束 → workspace/changes(turn, seq)
  → 查询摘要 → 回复下方显示「本轮改动 N 个文件  +A −D」
  → 文件行「DESIGN-SPEC.md  +35 −35」
  → 点击 → 全屏改动详情（旧/新行号、红绿行、上下文间隔）
```

按 hunk.oldStart/newStart 初始化两个计数器：空格前缀同时递增；`-` 只递增旧行；`+` 只递增新行。只去掉第一个前缀字符，保留正文缩进、空白、空行和制表符；不要 trim。hunk 间插入省略行，不把两个片段拼成连续文件。默认显示全部已返回的 hunk，上下文为 Host 提供的三行，不提供依赖当前文件的“展开历史上下文”。

以纯文本代码展示文件内容，保留 `+/-` 和文字标记辅助无障碍识别；不将 Markdown、HTML 或源码作为可执行内容。文件名、路径可复制；行长支持横向滚动。可选语法着色不能阻塞首屏，后台构造行模型并设内存限额。

`coarse=true` 显示“比较超时，按整段替换展示”；binary 显示“二进制文件已改动，无法逐行对比”；oversized 显示“文件过大，无法逐行对比”。Missing 显示记录不可用，允许单独查看仍存在且获准下载的当前文件，但不能把当前内容当作旧 diff。

### 4.3 Android

在当前聊天渲染链路接入共享的改动卡片；新增独立 Diff 页面，可用现有 UI 栈实现虚拟列表。每个 hunk/行使用稳定 key，长行横向滚动，窄屏默认单列 unified diff；不强制左右分栏。行号采用等宽字体与固定 gutter，支持深色模式和字体放大。

沿用 `WorkspaceFilesUi.kt` 所使用的文件读取能力作为“查看当前文件”辅助入口；明确传入来源 gatewayId/sessionId/path。该入口受原有路径限制，删除文件或目录外文件可能不能打开，不影响读取已记录的 diff。

### 4.4 iOS

`DeepSeekHarnessMobile/Views/ConversationView.swift` 接入共享卡片，通过新增 SwiftUI Diff 详情视图展示，共享层预先生成 DiffRow，iOS 使用惰性列表。同步更新原生桥接/会话快照结构，避免 Kotlin 已有数据但 Swift 界面不显示。

查看改动展示文本 diff；查看当前文件才复用既有 Quick Look/代码预览。二者明确分开，以免用户误以为当前文件内容就是该轮结束时的历史版本。

## 5. 实施顺序与验收

1. 网关实现 workspace-changes-v1，先做官方 Host 固定路由契约测试和本地 WS/RTC 一致性验证，再更新 PROTOCOL.md。
2. KMM 实现 DTO、Store、轮次入口、缓存和原生快照；用相同 fixtures 验证实时、opening snapshot、历史分页三条路径。
3. Android/iOS 实现卡片和文本 diff 页，完成桌面 Host 到 APP 真机联调。
4. 有执行中预览需求时再实现 tool-file-diffs-v1；若需要跨 Host 重启长期回看，另立持久化任务，不把临时快照误当持久审计记录。

必须覆盖：

- 单次编辑、多 hunk、同文件多次编辑、同轮先改后还原；显示 Host 的轮次净统计。
- 新建、删除、空文件、尾部无换行、中文/emoji/空白/超长行；hunk 行号与前缀正确。
- write/edit/apply_patch、Shell 修改、非 Git 目录、PTC、子会话；范围符合前述边界。
- 缺少能力时旧 APP/网关正常聊天；已保存事件没有摘要时不显示“0 改动”。
- 历史重入、断线重连、同轮新 seq 替代旧 seq、分页先见结果后见 turn；无重复卡片。
- 多网关同名 session/path、排序后点选、请求中切会话、迟到响应；不串文件、不串网关。
- summary total 大于 files 数量、二进制、oversized、coarse、4 MiB wire 超限、认证错误与异常 JSON。
- Host dispose/重启后的 404；明确显示不可用，工具局部片段不能冒充整轮版本。

## 6. 证据与核查边界

网关已完成专项测试、本地 WebSocket 集成与本机官方 DSH Connection/Deliverables 路由契约验证（摘要服务使用 fixtures）。尚未完成真实文件工具执行到 APP 的端到端联调。

网关证据：`lib/index.mjs` 的 `buildWireEvent/trimConversationEvent`；`lib/dsh-host-adapter.mjs` 的 `readHistoryRecords` 和认证上传桥接；`PROTOCOL.md` 的历史与实时工具事件章节。

官方证据均来自本机安装目录：

```text
/Users/lichaofan/.nvm/versions/node/v24.20.0/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/
  dsh-workspace-changes/lib/types/types.d.ts
  dsh-workspace-changes/lib/index.js
  dsh-client-ui-deliverables/lib/index.js
  dsh-client-ui-deliverables/lib/types/changes.d.ts
  dsh-tool-fs/lib/index.js
  dsh-tool-fs/lib/types/diff.d.ts
  dsh-tools/lib/types/presentation.d.ts
  dsh-session/lib/types/types.d.ts
  dsh-client-ui-tool/lib/types/client/tool/models/diff-card-model.d.ts
```

已验证官方 SharedFetch 路由的 owner Peer、非 owner 拒绝、摘要和 diff 坐标、404 生命周期，以及网关预算、畸形响应和取消逻辑。定制 Host profile 通过连接时的有界路由探测决定能力声明。截图未证明其运行版本与本机完全一致，方案以本机已核实契约为依据。
