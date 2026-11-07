# DSH 0.2.2-rc.1 移动端适配说明

本文供 DSH Mobile 的共享层、Android 和 iOS 接入网关 v0.12.0 源码。宿主基线为 DSH 0.2.2-rc.1，Node.js 需要 24.9 或更高版本。网关新增聊天引用、宿主级自动化任务管理、插件更新与插件详情读取，并修复批量投影和图片读取的兼容性。

当前修改处于源码联调阶段。移动端应依据 `hello.capabilities` 展示功能，并处理所连 Host profile 未启用对应服务的错误。

## 能力发现与连接

`dsh-mobile-v1` 子协议、`hello.protocol = 3`、`historyFormatVersion = 4` 继续使用。新增能力如下。

| capability | 移动端接入内容 |
|---|---|
| `message-quotes-v1` | 有序文字与引用发送，实时及历史紧凑引用展示 |
| `schedule-management-v2` | 宿主级任务分页、创建、读取、修改、暂停、恢复、立即执行和清理已结束任务 |
| `plugin-updates-v1` | 插件版本查询、更新进度与恢复结果、Markdown 详情 |

`hello.dshVersion` 是实际探测到的宿主版本，探测不到时省略。capability 表示网关理解相关请求。Host 具体服务可用性仍需通过查询结果判断。

拆分连接时，`message`、`history`、`subscribe`、`unsubscribe` 发 conversation 连接，定时任务、插件管理和 `attachment` 发 control 连接。旧单连接可继续承载所有请求。错误通道返回 `wrong-channel`。

所有请求均建议使用 UUID `requestId`，按 `(gatewayId, requestId)` 关联结果。插件请求必须提供非空且不超过 128 字符的 `requestId`。这些能力同样适用于已完成整组提交的 WebRTC 业务通道。

## 聊天引用

### 草稿模型与发送

建议共享层维护有序的 `Text` 与 `Quote` 草稿片段。用户选择聊天文字后，将选中文字的纯文本快照插入输入位置，保留换行。引用片段应支持整段移除。Android 可使用长按选区菜单，iOS 可使用原生文字选择菜单。图片和文件继续使用已有附件模型。

普通文本继续发送 `text`。包含引用时改用 `textParts`，两字段互斥。

```json
{
  "type": "message",
  "requestId": "quote-send-1",
  "sessionId": "s1",
  "mode": "queue",
  "textParts": [
    { "type": "text", "text": "关于这一段" },
    { "type": "quote", "text": "第一行原回复\n第二行原回复" },
    { "type": "text", "text": "请给出 Kotlin 示例" }
  ],
  "clientTimeZone": "Asia/Shanghai"
}
```

`textParts` 为 1 到 100 项，每项 `type` 为 `text` 或 `quote`，`text` 必须是字符串。引用内容去除空白后必须非空。片段顺序决定正文位置，可发送纯引用，可与 `images` 或 `files` 组合。新建会话仍可传 `cwd`、`workspaceId` 和 `agentPreset`。可继续对话的子会话沿用 `parentSessionId/subagentMode` 地址。

网关按 DSH Web 的规则，将每行引用加上 `> ` 并在引用和相邻正文间使用空行。以上请求保存为如下正文。

```markdown
关于这一段

> 第一行原回复
> 第二行原回复

请给出 Kotlin 示例
```

引用是所选文字的快照。引用本身携带正文，点击紧凑预览时展示完整引用内容。当前协议的引用片段只有 `type/text`，定位原消息可由 App 在本地草稿中另存来源。

排队消息的 `queue-update(action=edit)` 同样支持以 `textParts` 替代 `text`，使用相同的互斥和引用校验规则。`session-queues/session-queue` 的每项 `message.textParts` 在存在引用时提供展示片段，正文仍保存在 `message.content`。编辑排队消息时需保留附件，遵循现有文本编辑限制。

### 发送确认与重连

Host 接收消息后，网关返回如下帧。

```json
{"kind":"sent","sessionId":"s1","mode":"queue","requestId":"quote-send-1"}
```

App 在发送期间保留原草稿、引用与附件，收到匹配的 `sent` 后清空。失败时显示错误并恢复可编辑状态。WebSocket `send()` 完成只表示数据已交给传输层。

对于显式提供的 `requestId`，网关会将同一 ID 传给 Host。实时用户消息还会返回其 `event.requestId`，历史原始事件中对应 `data.source.rpcId`。App 可用它们关联本地发送状态与服务端消息，合并重复回显。

断线时，已经创建的普通 Session 可以先重载排队消息和历史，按该 ID 查找接受记录，再决定恢复草稿或重试。对于创建新会话的发送，请先使用 `session-create` 取得并保存 Session ID，再发送消息，这样连接中断后仍有确定的目标。`requestId` 的关联不等同于任意时间、任意会话下的永久去重保证。

### 实时与历史展示

实时 `event` 的 `user/message` 增加可选的 `textParts` 与 `requestId`。

```json
{
  "kind": "event", "sessionId": "s1", "seq": 42, "time": 1793836800000,
  "event": {
    "type": "user/message",
    "source": "user",
    "text": "> 原回复\n\n请解释",
    "requestId": "quote-send-1",
    "raw": { "id": "message-42" },
    "textParts": [
      { "type": "quote", "text": "原回复" },
      { "type": "text", "text": "\n请解释" }
    ]
  }
}
```

`history.events[]` 和 `session-snapshot.events[]` 的 `user/message` 采用原始事件格式，正文仍在 `data.content`，引用展示片段在可选的 `data.textParts`。普通用户消息若没有引用则省略该字段。

共享层应把实时的 `event.textParts` 与历史的 `data.textParts` 解码为同一 UI 模型。存在片段时按序渲染正文和紧凑引用预览，展开时显示原引用文字。`event.text` 和 `data.content` 仍保留完整 Markdown 正文，适合复制、搜索或旧客户端回退展示。

引用识别基于持久化 Markdown。顶层连续的 `> ` 行会成为一个 quote 片段，包括从 Web 发送的引用和用户手写的块引用。代码围栏中的 `> ` 保持为代码文本。原草稿中相邻引用若在持久化后成为同一块引用，回放时可合并显示。`textParts` 是展示片段，换行分布可能与发送前的草稿片段不同。

按 `(gatewayId, sessionId, seq)` 合并实时与历史。预览应按当前可用宽度省略显示并允许展开全文，使用纯文本显示引用内容。

## 宿主级自动化任务

### 请求与响应

以下请求均发 control 连接。响应字段平铺在帧上，`kind` 与请求 `type` 一致，`requestId` 若提供则原样回显。

| 请求 | 参数 | 成功字段 |
|---|---|---|
| `schedule-catalog` | `requestId?` | `items`，全量宿主目录 |
| `schedule-list` | `active?`, `limit?`, `offset?`, `requestId?` | `items`, `shown`, `total`, `limit`, `offset` |
| `schedule-view` | `id`, `requestId?` | 单条任务或 `id/code` |
| `schedule-create` | `title`, `prompt`, `timing`, `target?`, `requestId?` | 创建后的单条任务 |
| `schedule-edit` | `id`, `action`, `expectedUpdatedAt`, `patch?`, `requestId?` | 修改后的单条任务，或删除结果，或 `id/code` |
| `schedule-history` | `id`, `limit`, `before?`, `requestId?` | `records`, `retention`, `nextBefore?` 等 |
| `schedule-run` | `id`, `requestId?` | 任务状态或 `id/code` |
| `schedule-delete-inactive` | `confirm: true`, `requestId?` | `deleted`，删除的已结束任务数 |

宿主级列表省略 `sessionId`。`active=true` 只列活动任务，`active=false` 列暂停与已结束任务，省略则列全部。分页 `limit` 为 1 到 500，默认 100，`offset` 为非负整数。刷新、修改筛选条件和收到变更通知时，从 `offset=0` 重新加载。

每条任务除规则字段外，带有 `target`、`involvedSessionIds`、`status` 和可能存在的 `createdAt/updatedAt/lastDelivery/executionActive/deliveryFloorEndsAt`。`status` 为 `active/paused/ended`。规则 `kind` 包含 `after/at/every/daily/weekly/cron/rrule`，客户端应保留未知规则数据并提供只读摘要。

### 创建与执行目标

```json
{
  "type":"schedule-create", "requestId":"create-task-1",
  "title":"检查构建", "prompt":"查看构建是否完成并报告失败原因",
  "timing":{"kind":"every","every_seconds":3600},
  "target":{"kind":"session","sessionId":"s1"}
}
```

`title` 去除首尾空白后为 1 到 120 字符，`prompt` 必须非空。`timing` 采用以下 Host 结构，规则合法性、未来执行时间和最低频率由 Host 校验。

```json
{"kind":"after","after_seconds":3600}
{"kind":"at","at":{"date":"2099-11-06","time":"09:00","time_zone":"Asia/Shanghai"}}
{"kind":"every","every_seconds":3600}
{"kind":"daily","daily":{"time":"09:00","time_zone":"Asia/Shanghai"}}
{"kind":"weekly","weekly":{"time":"09:00","time_zone":"Asia/Shanghai","weekdays":[1,3,5]}}
{"kind":"cron","cron":{"expression":"0 9 * * 1-5","time_zone":"Asia/Shanghai"}}
{"kind":"rrule","rrule":"DTSTART:20991106T010000Z\nRRULE:FREQ=DAILY"}
```

`weekdays` 使用 Host 的星期定义，1 为周一、7 为周日。UI 应使用 IANA 时区并保留用户选择。返回的 `scheduledAt` 为 UTC 时间，显示时换算到用户时区。

`target.kind=session` 投递到已有会话。`new_once` 在首次触发时创建并复用一个会话。`new` 每次触发创建新会话。后两种可传 `create: {cwd?, agentPreset?}`。省略 target 时由 Host 使用首次创建并复用会话的默认行为。创建页面应显示目标选择，并提供计划执行时间预览。

### 编辑、暂停、恢复和删除

先通过列表或 `schedule-view` 取得当前任务，将 `updatedAt` 原样带回，缺失时传 `null`。网关要求新版 `schedule-edit` 显式提供 `expectedUpdatedAt`。

```json
{"type":"schedule-edit","requestId":"pause-1","id":"task-1","action":"update","expectedUpdatedAt":"2026-11-05T00:00:00.000Z","patch":{"active":false}}
{"type":"schedule-edit","requestId":"resume-1","id":"task-1","action":"update","expectedUpdatedAt":"2026-11-05T00:00:00.000Z","patch":{"active":true}}
{"type":"schedule-edit","requestId":"delete-1","id":"task-1","action":"delete","expectedUpdatedAt":"2026-11-05T00:00:00.000Z"}
```

`patch` 至少包含一个字段，支持 `title/prompt/timing/target/active`。更新成功直接返回完整任务。删除成功返回 `id/deleted:true`。各请求示例中的 revision 必须替换为每次实际读取的最新值。

返回 `code:schedule_conflict` 时保留草稿，刷新当前任务，让用户复核差异后再次提交。`schedule_not_found` 时刷新目录并提示任务已移除。`schedule-run` 返回 `schedule_execution_pending` 表示已有一次执行正在准入，应刷新状态。一次立即执行的接受结果与 Agent 完成回复分别展示。

清理入口应先向用户确认，再发送 `schedule-delete-inactive` 的 `confirm:true`。Host 清理已结束任务，并保留仍活动或暂停的任务。

Host `schedule/changed` 会被转为 `{"kind":"schedule-changed"}`。收到通知、重连或完成写操作后重新读取列表及当前详情。分页与详情缓存按 `gatewayId` 隔离。

### 旧移动请求的转换

带 `sessionId` 的 `schedule-list` 继续返回与该会话关联的活动任务 `items`，关联按 `target.sessionId` 或 `involvedSessionIds` 判断。此模式使用全量目录过滤，与宿主级分页参数互斥。

旧 `schedule-update` 仍接受 `id/expected/title?/prompt?/change?`。`expected` 带 `updatedAt` 时使用该时间进行 CAS，缺失时先比较规则及内容，再以当前 revision 提交。旧 `change` 对接新版 `timing`。不匹配时返回 `updated:false, code:schedule_conflict`。旧规则与迁移后记录结构不一致时，App 应重新读取并使用新版编辑流程。

旧 `schedule-delete` 转为 Host `edit(action=delete)`，可附带 `expectedUpdatedAt`。`sessionId` 若存在，网关会在操作和历史读取前核对任务与会话的关联。新版页面优先使用 `schedule-edit` 的显式 CAS。

## 插件更新与详情

### 查询版本和展示详情

继续通过 `plugin-catalog` 获取目录，使用 `bundles[].updatable` 决定是否显示检查更新入口，使用 Host 返回的包名、版本、只读原因与错误信息。

```json
{"type":"plugin-versions","requestId":"versions-1","name":"some-dsh-plugin"}
{"type":"plugin-detail","requestId":"detail-1","name":"some-dsh-plugin","language":"zh-CN"}
```

版本响应为 `kind:plugin-versions`，数据在 `result`。`result.status=listed` 时包含 `installed/registry/attempts/versions/omitted`。`refused` 时展示 `problem/reason/attempts`，保留重试入口。具体版本的兼容性和可选状态按 Host 返回值展示。

详情响应为 `kind:plugin-detail`，数据在 `result`。`status=found` 时包含 `origin/path/markdown`，`status=none` 时展示短描述。Markdown 渲染应禁用原始 HTML 执行。详情中的相对图片引用需要另行处理受鉴权的 Host 图片路由，首期可保留图片占位和替代文字。

### 更新、进度和恢复结果

```json
{"type":"plugin-update","requestId":"update-1","name":"some-dsh-plugin","version":"1.2.3","registry":null}
```

`registry` 可省略，或使用版本查询结果中的源，`null` 表示 pnpm 默认源。更新版本应来自用户选择的版本条目。更新期间，以原 `requestId` 关联以下事件。

```json
{"kind":"plugin-update-state","requestId":"update-1","step":"checking"}
{"kind":"plugin-update-state","requestId":"update-1","step":"removing"}
{"kind":"plugin-update-state","requestId":"update-1","step":"installing"}
{"kind":"plugin-update-state","requestId":"update-1","step":"restoring"}
```

安装子阶段还可能收到已有 `plugin-install-state/plugin-install-log`。进度和日志只发送给发起操作的连接，App 应限制日志行数。更新自身网关插件时，热更新可能切断连接，页面进入待重连核实状态。

最终响应结构如下。

```json
{
  "kind":"plugin-update-result", "requestId":"update-1",
  "result":{
    "from":"1.1.0", "to":"1.2.3", "step":"install",
    "result":{"changed":true,"application":"applied","stage":"install","target":"some-dsh-plugin"}
  }
}
```

注意两层 `result`。外层为 `PluginUpdateResult`，内层为最后阶段的 `ChangeResult`。外层 `step` 为 `check/remove/install`。安装失败且旧版本已经被移除时，Host 可能返回外层 `restore: ChangeResult`，表示恢复旧版本的结果。UI 应同时展示目标版本更新结果和旧版本恢复结果。`restore.application=failed` 时显示明确的恢复失败状态，并提供刷新、诊断信息和 Host 日志入口。

`application` 继续按 `applied/restart-required/overridden/failed/cancelled` 解释。`restart-required` 时提示重启 DSH，再重新查询目录。`pendingBuilds` 等诊断按现有插件管理规则展示。

连接中断后重新请求 `plugin-catalog`，以目录中实际版本和错误状态核实结果。当前 Host 的 `waitForInstall` 查询的是安装子任务，不能代表整个更新及恢复过程完成。App 应保留“结果待核实”状态，避免将断线直接标成成功，也避免自动再发一次更新。更新进度的 `restoring` 仅表示开始恢复，最终以 `restore` 结果或重连后的实际目录为准。

## 投影与图片读取

DSH 0.2.2-rc.1 将 Host 投影更新改成 `changes[]`。网关在 Host Adapter 内展开后，继续发送 `tasks-updated/goal-updated/turn-outline-updated`、团队和子代理相关推送以及 `session-queue`。移动端继续按已有帧解码，按 `(gatewayId, sessionId, projectionKey)` 保存水位，同一 seq 下的不同投影都应应用。

首次连接和 Host 控制流重建后，以 `projection-baseline` 恢复状态。基线中的 `null` 清除对应 UI 状态，空数组表示有效的空列表。重连验证应同时检查任务、目标、大纲、团队和待处理消息。

新版 Host 图片读取需要完整引用。网关会按会话历史分页查找真实附件引用，再调用 Host。移动端继续发送 `attachment(sessionId, attachmentId)`，并使用现有图片缓存与加载器。不存在于该会话的附件返回 `session/attachment-invalid`。深历史图片可能需要更多查询时间，加载期间保留占位并允许重试。

## 移动端实施与验收

建议先完成共享协议模型及发送状态，再分别实现 Android 和 iOS 页面。以下场景均应覆盖两个平台，并在切换网关后确认缓存隔离。

1. 能力发现。旧网关缺少新增 capability 时隐藏对应入口，当前网关查询到 Host 功能不可用时显示具体错误。
2. 引用草稿。在正文开头、中间、结尾插入引用，包含多段、空行、中文、emoji、代码文本和 CRLF，验证顺序及整段删除。
3. 发送。纯引用、引用加正文、引用加图片、引用加文件分别发送。成功后清空草稿，参数拒绝或断线时保留草稿与附件。
4. 回放。从 Mobile 与 Web 各发送引用，验证实时消息、snapshot、历史分页、重连和 App 重启后的预览一致。代码围栏中的 `> ` 保持代码显示。
5. 回显关联。用 `requestId` 对齐 `sent`、实时用户消息和历史 `source.rpcId`，验证多设备回显及断线恢复。
6. 投影。一次事件同时改变多个投影，确认同 seq 的每项更新均生效，空列表和 null 清除状态正确，新连接能恢复最近基线。
7. 定时任务。宿主分页、活动筛选、三个投递目标、创建、修改时间与内容、暂停、恢复、立即执行、历史分页和清理已结束任务。
8. 冲突。两个设备同时编辑，第二次收到 `schedule_conflict` 后保留草稿，重新读取并复核，禁止自动覆盖。
9. 插件。可更新与不可更新包、版本查询失败、详情无文档、更新成功、需要重启、安装失败后恢复、恢复失败、更新网关自身导致断线。
10. 图片。用户图片、工具生图、PTC 生图、深历史图片、断线重试和跨会话附件拒绝。

## 契约来源与验证入口

官方接口以对应发布标签为准。

- [引用序列化](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-conversation/src/client/input/prompt.ts)
- [块引用格式](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/client/ui-primitives/src/markdown/quote-text.ts)
- [Session 帧与图片请求类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/api/session-controller/src/types.ts)
- [宿主定时任务类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/schedule/schedule/src/types.ts)
- [插件更新与详情类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/plugin-manager/src/types.ts)

仓库 `npm test` 覆盖网关回归。`test/dsh-022-official.test.mjs` 使用目标发布包的 Gateway、Peer 和严格描述符验证新管理接口及批量投影，业务数据位于内存。其他 `*-official.test.mjs` 覆盖 Host、团队、语音、文件和图片。

```sh
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/dsh-022-official.test.mjs
```

真实 Android/iOS 页面操作与真实插件安装、计划触发、升级已有持久会话仍需按上述清单完成端到端验收。
