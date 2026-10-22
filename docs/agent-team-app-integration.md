# APP 智能体团队与子智能体会话接入指南

本文是本仓库当前源码的实现契约，面向 APP 网络层、数据层、聊天页和看板开发。按本文实现后，APP 可以展示 Lead 和子智能体、查看共享任务板与每个成员的任务、在成员间切换聊天视图，并向可继续对话的成员发送消息。

- 编写日期：2026-10-21。
- 网关：0.11.0 当前源码，新增能力尚未发布；运行时仍以 capability 判断是否支持。
- 已核对的 Host：DSH **0.2.1-rc.2**，Session format **4**。
- WebSocket：`/ws/mobile`，子协议仍为 `dsh-mobile-v1`，`hello.protocol` 仍为 `3`。
- 新能力：`agent-team-v1`、`subagent-conversations-v1`。
- 本次只改网关与协议文档，APP 页面需按本文接入。

## 1. 能力边界与页面目标

| APP 功能 | 本次网关支持方式 |
|---|---|
| 团队成员面板，包含 Lead | `agent-team` 读取 `agentTeam.members` |
| 共享任务看板 | 同一响应中的 `agentTeam.tasks` |
| 成员任务筛选 | 用任务 `ownerName` 匹配成员 `name`，不要匹配标题 |
| 待处理 / 进行中 / 已完成分栏 | 用任务 `status` 分组 |
| 任务详情、依赖、写入范围、冲突提示 | 完整透传任务投影字段 |
| 查看所有层级的普通子智能体 | 从根开始逐级查询 `subagents`，支持展开树或有界遍历 |
| 切换 Lead、团队成员或普通子智能体 | 使用该视图的地址重新 `subscribe` |
| 独立历史、分页、执行轨迹、实时输出 | 复用 `history`、`session-snapshot`、`event`、`assistant-stream` |
| 与团队成员继续对话、发送图片 | `message` 携带直接父会话 ID 和 `continuable` 模式 |
| 停止成员当前生成 | `session-cancel` 携带同样的父子地址 |
| 成员自己的待办与 Goal | 子地址请求 `tasks` / `goal`，或读取该成员的历史投影 |
| 查看别的成员时仍同步团队任务 | control 连接上的全局团队投影更新 |
| 创建团队、分配任务、修改共享任务 | 在 Lead 对话中向智能体提出要求，由 Host 的团队工具处理 |

本次没有新增直接创建成员、直接增删改共享任务的移动 RPC。不要发送未经实现的 `team-task-create`、`team-task-update`、`agent-spawn` 等请求，也不要把 `command-execute` 当作任意工具调用器。共享任务分配是 Host 团队工具的职责；APP 可以向 Lead 发送明确的自然语言指令，并以新的任务投影作为执行结果。

有两类“任务”，必须在产品和数据中分开：

1. **团队共享任务**：`agentTeam.tasks`，有 `id`、`revision`、`ownerName`、依赖与写入范围，属于 Lead。
2. **成员内部待办**：`todos`，来自 `tasks` / `tasks-updated` 或成员历史投影，属于具体成员会话。它没有共享任务的身份和归属语义，不能拼入共享任务板。

## 2. 身份与地址：必须先实现

建议 APP 保存以下逻辑模型，字段名可按平台编码习惯转换：

```text
ConversationTarget {
  gatewayId: String
  sessionId: String          // 当前聊天视图的会话 ID
  parentSessionId: String?   // 直接父会话，仅子智能体视图填写
  subagentMode: String?      // continuable / one-shot / unknown
}
TeamContext {
  gatewayId: String
  leadSessionId: String      // 切换团队成员时始终保留
}
```

三个 ID 的区别：

| 名称 | 含义 | 示例 |
|---|---|---|
| `leadSessionId` | APP 保留的团队根会话 ID；不是本次请求新增的顶层字段 | `session-lead` |
| `sessionId` | 本次请求操作的当前会话 | `session-scout` |
| `parentSessionId` | 当前子智能体的**直接**父会话 | `session-lead` |

团队成员是 Lead 的直接子会话。如果成员又创建了普通子智能体，孙节点的 `parentSessionId` 必须填该成员 ID；不能填 Lead ID。

Lead 请求：

```json
{"type":"history","sessionId":"session-lead"}
```

团队成员请求：

```json
{"type":"history","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable"}
```

孙节点请求示例：

```json
{"type":"history","sessionId":"session-frame-reviewer","parentSessionId":"session-scout","subagentMode":"one-shot"}
```

地址规则：

- 普通会话只发 `sessionId`。不要把普通 fork 会话的父 ID 当成子智能体地址；普通 fork 与子智能体不是同一种会话。
- 子会话必须同时带 `parentSessionId`、`subagentMode`；`sessionId` 始终填写子会话 ID。
- `parentSessionId` 必须非空，且不同于 `sessionId`。
- `subagentMode` 用独立字段表示生命周期；`message.mode` 继续表示 `queue` / `steer`。
- `external` 不是本地会话，不能用于 `history`、`subscribe` 或 `message`。
- 不要从 ID 格式猜父子关系，不要把成员名字当成会话 ID。
- 所有缓存和请求路由都必须包含 `gatewayId`，不同电脑可能有同名任务或相同 ID。

可复用子地址的移动请求为：`history`、`subscribe`、`message`、`session-cancel`、`tasks`、`goal`。其他现有请求是否适用于子会话，不能仅凭本次 capability 推断；本期成员聊天页的模型、模式、重命名、fork 等按钮不要直接照搬普通会话操作。

## 3. 连接、鉴权和能力发现

复用 APP 已有设备配对和 token，不新增团队鉴权流程。建议使用两条已鉴权连接：

```text
control:      X-DSH-Channel: control
conversation: X-DSH-Channel: conversation
Authorization: Bearer <已配对设备 token>
```

也可沿用现有子协议 token 方式；握手、设备 ID 和配对详情见 [主协议](../PROTOCOL.md)。连接地址和 token 来自同一网关的配对信息。

`hello` 中相关字段示意，capabilities 仅列出与本文相关的部分：

```json
{
  "kind":"hello",
  "protocol":3,
  "historyFormatVersion":4,
  "capabilities":["split-channels","assistant-stream-v1","projection-baseline","agent-team-v1","subagent-conversations-v1"],
  "authenticated":true
}
```

| 能力 | APP 含义 |
|---|---|
| `agent-team-v1` | 网关理解团队查询、团队投影和成员状态帧 |
| `subagent-conversations-v1` | 网关理解显式父子地址，并能路由子会话历史、订阅、发送和停止 |
| `assistant-stream-v1` | 可以使用 `assistantStream:true` 订阅 |
| `projection-baseline` | control 建连后接收投影基线 |

能力公布表示网关实现了协议；Host 是否启用实验性团队插件，要看查询的 `projectionState`。普通子智能体浏览也可以在没有团队插件的场景使用。

- 缺少 `agent-team-v1`：隐藏团队看板或提示升级网关。
- 缺少 `subagent-conversations-v1`：不要把子 ID 填进普通消息接口。
- `projectionState: unavailable`：表示当前读取没有该投影，不能据此断言会话不存在或清空为“0 个任务”。
- 非法 channel 返回 `wrong-channel`。下面各请求须发送到正确连接。
- 不指定 channel 的 legacy 单连接仍兼容；新 APP 建议使用 split channels，保持看板与聊天订阅独立。

## 4. 首次进入团队页面的完整流程

1. 建立 control 和 conversation，分别等待 `hello` 并检查能力。
2. control 开始消费 `projection-baseline` 和实时更新。不要等用户展开看板才建立 control。
3. control 发 `sessions`，读取会话摘要和初始 `running`；不要从 `sessions.items[].projections` 取团队数据，该接口故意只保留标题投影。
4. control 发 `agent-team`，`sessionId` 填 Lead ID。
5. control 发 `subagents`，`sessionId` 填 Lead ID；根据需要展开后继续查询下一级。
6. conversation 发 Lead 或当前成员的 `subscribe`，设置 `assistantStream:true`。
7. 收到 `session-snapshot` 后安装该视图的聊天基线和实时状态；任务看板从团队缓存渲染。
8. 用户选择成员时执行第 9 节的切换流程。共享任务仍然从原 `leadSessionId` 读取。

建议首次查询都带唯一 `requestId`，重入页面后丢弃上一页面仍在途的响应。`subscribe` 的代际判断使用服务端 `subscriptionId`，不能用 `requestId` 替代。

## 5. 团队查询：`agent-team`

**连接：control**。请求：

```json
{"type":"agent-team","sessionId":"session-lead","requestId":"team-load-001"}
```

| 请求字段 | 类型 | 必填 | 含义 |
|---|---|---|---|
| `type` | string | 是 | 固定 `agent-team` |
| `sessionId` | string | 是 | Lead 会话 ID |
| `requestId` | string | 建议 | 原样回显，用于关联在途请求 |

完整响应示例：

```json
{
  "kind":"agent-team",
  "sessionId":"session-lead",
  "requestId":"team-load-001",
  "projectionState":"ready",
  "asOfSeq":120,
  "agentTeam":{
    "members":[
      {"id":"session-lead","name":"lead","role":"lead","phase":"active"},
      {"id":"session-scout","name":"footage-scout","role":"teammate","phase":"active"},
      {"id":"session-music","name":"music-producer","role":"teammate","phase":"active"},
      {"id":"session-graphics","name":"graphics-designer","role":"teammate","phase":"active"}
    ],
    "tasks":[
      {
        "id":"task-1",
        "revision":3,
        "subject":"素材勘察：11 段录屏逐帧分析 + 镜头切点",
        "description":"读取制作要求，逐帧分析录屏，输出可用于剪辑的切点清单。",
        "status":"completed",
        "ownerName":"footage-scout",
        "blockedBy":[],
        "writeScopes":["promo/analysis"],
        "ready":false,
        "writeScopeWarnings":[]
      },
      {
        "id":"task-2",
        "revision":2,
        "subject":"原创配乐与音效",
        "description":"制作 48 秒配乐，输出音频文件。",
        "status":"in_progress",
        "ownerName":"music-producer",
        "blockedBy":[],
        "writeScopes":["promo/audio"],
        "ready":false,
        "writeScopeWarnings":[]
      },
      {
        "id":"task-3",
        "revision":1,
        "subject":"视觉资产",
        "description":"生成标题卡和结尾 CTA。",
        "status":"pending",
        "blockedBy":["task-1"],
        "writeScopes":["promo/graphics"],
        "ready":true,
        "writeScopeWarnings":[]
      }
    ]
  }
}
```

`task-3` 的依赖列表非空但依赖已完成，因此 `ready:true`；不能以 `blockedBy.length > 0` 代替 `ready`。

响应字段：

| 字段 | 类型 | 语义 |
|---|---|---|
| `projectionState` | string | `ready` / `unavailable` / `migration-required` |
| `asOfSeq` | integer，可缺省 | 当前精确投影的会话日志切点；迁移提示响应没有它 |
| `agentTeam` | object 或 null | 当前团队完整值，原样透传 |
| `agentTeam.failure` | string，可缺省 | Host 读取持久化团队记录出现错误；成员和任务停在最后有效状态 |

三种状态必须分别处理：

```json
{"kind":"agent-team","sessionId":"session-lead","projectionState":"unavailable","asOfSeq":10,"agentTeam":null}
```

显示“团队数据暂不可用”，提供重试。网关 capability 存在不表示该 Host profile 安装了团队投影。

```json
{"kind":"agent-team","sessionId":"session-lead","projectionState":"migration-required","agentTeam":{"members":[],"tasks":[]}}
```

这是 Host 返回的迁移前缓存提示，示例内容仅为示意；可以只读展示并标注待刷新，不能把它安装成带 seq 的权威基线。打开对应会话取得新基线；如果 Host 拒绝旧格式，提示在桌面端处理或升级，停止无限重试。

```json
{"kind":"error","requestType":"agent-team","requestId":"team-load-001","sessionId":"session-lead","code":"session/not-found","message":"session not found"}
```

这是会话未找到，与“没有团队投影”不同。

### 5.1 成员字段与界面规则

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 成员持久会话 ID，作为选择与缓存主键 |
| `name` | string | 团队内成员名字，也是任务 `ownerName` 的匹配依据 |
| `role` | string | `lead` / `teammate` |
| `phase` | string | `provisioning` / `active` / `failed`，持久生命周期 |
| `error` | string，可缺省 | 成员创建失败原因 |

`phase` 不是运行状态。成员 UI 状态按以下规则计算：

```text
phase == provisioning → 正在创建；禁用进入和发送
phase == failed       → 创建失败；展示 error，禁用进入和发送
phase == active       → 结合 session-status / sessions.running 显示运行中或未运行
running 尚未知         → 显示状态未知/同步中
```

Lead 行也出现在成员数组中；成员总数包括 Lead，子智能体数只统计 `role == teammate`。保留 Host 数组顺序，不假设只有三名成员。当前选中高亮按 `member.id == currentTarget.sessionId` 判断。

点击 Lead：切回普通会话地址。点击 active teammate：构造 `{sessionId:member.id,parentSessionId:leadSessionId,subagentMode:"continuable"}`。

`ready` 且只有 Lead、没有任务也是合法数据；实验性投影可能对普通会话生成 Lead 行，不能仅凭存在 `agentTeam` 就显示“已有多人团队”。

### 5.2 共享任务字段与看板规则

| 字段 | 类型 | 必有 | 含义 |
|---|---|---|---|
| `id` | string | 是 | 团队内任务身份；不同团队都可能出现 `task-1` |
| `revision` | integer | 是 | 此任务版本，变更后递增 |
| `subject` | string | 是 | 卡片标题 |
| `description` | string | 是 | 完整任务说明，展开显示 |
| `status` | string | 是 | `pending` / `in_progress` / `completed`；解码应兼容 `deleted` 和未来未知值 |
| `ownerName` | string | 否 | 当前负责人名字；缺省表示未分配 |
| `blockedBy` | string[] | 是 | 前置任务 ID，保留 Host 顺序 |
| `writeScopes` | string[] | 是 | 建议写入路径/范围，作为说明展示 |
| `ready` | boolean | 是 | Host 计算的可领取状态：仅 pending 且依赖全部完成时为 true |
| `writeScopeWarnings` | string[] | 是 | Host 计算的潜在写入冲突说明 |

产品规则：

- 三列显示：待处理 `pending`、进行中 `in_progress`、已完成 `completed`；不要用成员是否运行来覆盖任务状态。
- 对 `pending && !ready` 标记“受阻”，详情列出 `blockedBy`。已开始或已完成的任务 ready 为 false，不能因此标记受阻。
- 任务 ID 在当前快照中找不到时，保留原 ID；不要推断为已完成。
- 当前投影通常排除 `deleted`；客户端解码保留兼容，收到后从可见列表移除。
- `writeScopes` 是建议范围，不是权限控制；不能在 APP 中称为“强制隔离目录”。
- `writeScopeWarnings` 非空时显示可展开提示，不替代任务状态。
- 负责人：`members.first(name == task.ownerName)`，找不到时仍显示原 `ownerName`；不要丢弃这条任务。
- 缺省 owner 的任务显示“未分配”，不自动归给 Lead。
- “当前成员任务”只筛选该成员 `name`；团队看板始终能切回“全部成员”。
- 点击任务的负责人，可进入对应 active 成员会话；点击任务卡片主体展开详情，避免混淆两个动作。
- 共享任务完整快照是权威值，不能只追加任务；任务移除、负责人变更、完成后重开都要反映。
- 缓存任务主键使用 `(gatewayId, leadSessionId, task.id)`，禁止只用 `task.id`。

## 6. 普通子智能体目录：`subagents`

**连接：control**。每次返回指定父节点的**直接子节点**：

```json
{"type":"subagents","sessionId":"session-lead","requestId":"children-lead-001"}
```

```json
{
  "kind":"subagents",
  "sessionId":"session-lead",
  "requestId":"children-lead-001",
  "projectionState":"ready",
  "asOfSeq":120,
  "subagentCatalog":[
    {"id":"session-scout","mode":"continuable","label":"逐帧分析 11 段录屏","createdAt":1792550400000},
    {"id":"session-review","mode":"one-shot","label":"检查分镜","createdAt":1792550401000},
    {"id":"remote-run","mode":"external","label":"远程执行","createdAt":1792550402000},
    {"id":"session-old","mode":"unknown","createdAt":1792550403000}
  ]
}
```

`projectionState` 和 `asOfSeq` 语义与第 5 节相同；不可用是 `null`，确实没有子节点是 `[]`，两者不能混淆。

| 模式 | 可查看历史 | 可发送/停止 | APP 行为 |
|---|---|---|---|
| `continuable` | 是 | 是 | 点击进入，显示输入框；能否成功发送仍由 Host 校验 |
| `one-shot` | 是 | 本次接口不支持 | 只读会话、轨迹与结果 |
| `external` | 无本地子会话 | 否 | 展示目录元信息，禁用本地聊天导航 |
| `unknown` | 可按 unknown 地址尝试读取 | 否，直到身份明确 | 先只读，读取历史中 `projections.values.subagent` 后确认实际模式 |

目录字段 `label` 是创建任务标签；只有 continuable 保证存在。它不同于团队成员 `name`。`createdAt` 是毫秒时间戳，不能当排序序号或 seq。

`subagents` 不提供 `hasChildren`，也不自动递归。实现“全部子智能体”可以使用以下策略：

1. 对根调用 `subagents`。
2. 显示所有返回行。为非 external 的行提供展开按钮。
3. 展开行时，以该行 `id` 为父节点继续调用 `subagents`。
4. 要一次展开全部，APP 做有界的广度遍历，例如最多 4 个并发读取，并维护 visited 集合；这是客户端策略，不是协议限制。
5. 每个分支保留 loading/error/ready 状态；一个分支失败不能清空整棵树。
6. 不要把所有层级都挂到根下面。构造导航地址时，直接父 ID 就是该次目录响应的 `sessionId`。
7. 接到某父节点 `subagents-updated` 后整体替换该父节点子列表。未返回的旧节点从该目录移除，不等于用户会话被删除。

普通子智能体的任务标签来自目录 `label`，其内部待办来自该子会话 `todos`；不要捏造共享任务。团队成员面板和普通子智能体树可以共用目标模型，但各自的数据来源要保留。

## 7. 全局实时团队同步

### 7.1 基线

control 连接初始化会收到：

```json
{
  "kind":"projection-baseline",
  "projections":{
    "session-lead":{
      "asOfSeq":120,
      "values":{
        "todos":null,
        "goal":null,
        "turnOutline":[],
        "agentTeam":{"members":[{"id":"session-lead","name":"lead","role":"lead","phase":"active"}],"tasks":[]},
        "subagentCatalog":[],
        "subagent":null,
        "subagentTiming":null
      }
    }
  }
}
```

示例展示一个仅 Lead 的团队。真实基线可以同时包含很多会话，其中也可能包含当前正在查看的子会话。

新增控制投影键：

| 键 | 值 | 更新帧 kind |
|---|---|---|
| `agentTeam` | 团队完整值 / null | `agent-team-updated` |
| `subagentCatalog` | 直接子目录数组 / null | `subagents-updated` |
| `subagent` | 子身份对象 / null | `subagent-identity-updated` |
| `subagentTiming` | 子执行耗时对象 / null | `subagent-timing-updated` |

控制基线只覆盖 Host 当前控制集合。基线没出现一个冷会话，不代表它被删除。对冷会话仍需第 5、6 节查询或打开历史。

Host 控制流重新建立时，网关发送新 `projection-baseline`，并为原控制集合里失效的值发送 null 更新。APP 应替换本次控制流的基线集合，保持冷会话查询缓存单独管理；null 更新使对应控制值失效。

### 7.2 增量是完整值替换

```json
{
  "kind":"agent-team-updated",
  "sessionId":"session-lead",
  "asOfSeq":121,
  "agentTeam":{
    "members":[
      {"id":"session-lead","name":"lead","role":"lead","phase":"active"},
      {"id":"session-scout","name":"footage-scout","role":"teammate","phase":"active"}
    ],
    "tasks":[]
  }
}
```

这里 `tasks:[]` 表示当前可见共享任务为空，应替换旧任务数组，不是“没有改任务”。

其他帧结构：

```json
{"kind":"subagents-updated","sessionId":"session-lead","asOfSeq":122,"subagentCatalog":[{"id":"session-scout","mode":"continuable","label":"逐帧分析","createdAt":1792550400000}]}
```

```json
{"kind":"subagent-identity-updated","sessionId":"session-scout","asOfSeq":2,"subagent":{"mode":"continuable","label":"逐帧分析","seq":1}}
```

```json
{"kind":"subagent-timing-updated","sessionId":"session-scout","asOfSeq":20,"subagentTiming":{"settledMs":3200,"active":{"since":1792550400000,"through":1792550400600}}}
```

`subagentTiming` 字段：

- `settledMs`：已结束轮次累计耗时，毫秒。
- `active`：可选，当前开放轮次的 `since` / `through` 时间边界，毫秒。
- `lastTurnCompleted`：可选，最近已关闭轮次是否正常完成；轮次开放时可能缺省。
- 不要用耗时投影推断 `running`，以成员状态通知为准。

失效例子：

```json
{"kind":"agent-team-updated","sessionId":"session-lead","asOfSeq":121,"agentTeam":null}
```

失效应显示“待同步/数据暂不可用”，重新查询需要的会话；不能把 null 解释成已完成或空板。重建失效通知可能沿用旧水位，因此同 seq 的 null 也必须处理。

这些团队、目录、身份、耗时更新发往 control/legacy，**不受当前 conversation 的订阅会话过滤**。成员自己的 `tasks-updated` 则按原有交互通道规则处理；split control 不需要切换订阅。

### 7.3 成员运行状态

新帧：

```json
{"kind":"session-status","sessionId":"session-scout","running":true}
```

```json
{"kind":"session-status","sessionId":"session-scout","running":false}
```

该帧发送到所有 control/legacy，不受聊天订阅过滤。它是进程内状态通知，没有 seq 或历史重放保证。

- 初始状态从 `sessions.items[].running` 获取；缺行时保持未知，不能伪造运行状态。
- 重连或 APP 回前台后重新查询 `sessions`。
- 查询期间缓存新到的 `session-status`，先安装列表结果，再覆盖查询期间收到的状态，避免较早列表快照覆盖较新通知。
- Host 创建/释放成员 Agent 或移除驻留 Session 时网关也会同步状态；`running:false` 只表示当前没有运行，不表示任务完成、成员删除或无法恢复。
- `phase:failed`、`phase:provisioning` 优先于运行状态展示。

### 7.4 顺序、缓存与版本

建议至少维护：

```text
teamByLead[(gatewayId, leadSessionId)]
catalogByParent[(gatewayId, parentSessionId)]
statusBySession[(gatewayId, sessionId)]
projectionCut[(gatewayId, sessionId, projectionKey)]
conversationByTarget[ConversationTarget]
```

处理规则：

1. 持久日志 seq 只在同一会话内可比。Lead 的 121 和成员的 20 没有大小关系。
2. 同一会话不同投影分别记录水位，不能收到 `subagentTiming` 的 200 就丢弃晚到的 `agentTeam` 199。
3. 同一键收到较旧查询响应，不覆盖已收到的较新精确实时值；使用 `requestId` 丢弃过期页面查询。
4. 一次控制重建基线是新的控制代际；基线替换必须允许相同 seq 的 null 失效，不能使用简单的 `incomingSeq <= cachedSeq` 全部过滤。
5. `migration-required` 没有权威 seq，只作为提示缓存，不覆盖已有精确投影。
6. `agentTeam.failure` 表示投影停在最后有效状态。保留画面并显示异常，停止把它标成持续更新成功。
7. 未识别的新 JSON 字段应忽略或保留；未知枚举显示兜底状态，不让整个连接解码失败。

## 8. 子会话历史与分页

**连接：conversation**。首次历史请求：

```json
{"type":"history","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","requestId":"history-scout-001","maxMessages":12,"view":"conversation"}
```

响应示意：

```json
{
  "kind":"history",
  "requestId":"history-scout-001",
  "sessionId":"session-scout",
  "parentSessionId":"session-lead",
  "subagentMode":"continuable",
  "historyFormatVersion":4,
  "cursor":80,
  "hasMore":true,
  "nextBeforeSeq":50,
  "view":"conversation",
  "bytes":1200,
  "events":[],
  "projections":{"asOfSeq":80,"values":{"subagent":{"mode":"continuable","label":"逐帧分析","seq":1},"todos":[],"turnOutline":[]}}
}
```

示例仅突出元数据，`events` 实际按历史分页返回，事件结构沿用 V4 规范。`cursor` 是 Host 开启快照时的持久水位，不是当前展示列表最后一条 seq；对话过滤后 events 可能为空，仍需处理分页游标。

更早一页：

```json
{"type":"history","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","requestId":"history-scout-page-002","beforeSeq":50,"historyFormatVersion":4,"maxMessages":12,"view":"conversation"}
```

- 用上次响应的 `nextBeforeSeq`，不要自己 `seq - 1`。
- 只在 `hasMore:true` 时继续分页；空 events 但带有效下一游标仍可翻页。
- `beforeSeq` 必须同时携带 `historyFormatVersion:4`。
- 历史与消息体可按字节裁剪；APP 不得假设每页恰好 12 条消息。
- 对话视图使用 `view:"conversation"`；完整历史/轨迹需要时不传该字段，沿用已有解码器。
- 分页响应只补旧正文，不替换新快照的实时 active attempt，不倒退当前持久 cursor。
- 更多正文、工具结果和轮次大纲语义见 [rc.2 接入说明](dsh-rc2-mobile-integration.md) 和 [轮次导航说明](turn-outline-app-integration.md)。

通常首次进入直接使用下一节的原子订阅基线即可，不需要先 history 再 subscribe；history 主要用于更早分页、单独只读预览和恢复补查。

## 9. 切换智能体视图与实时输出

**连接：conversation**。切入子成员：

```json
{"type":"subscribe","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","assistantStream":true}
```

确认帧：

```json
{
  "kind":"subscribed",
  "sessionId":"session-scout",
  "parentSessionId":"session-lead",
  "subagentMode":"continuable",
  "subscriptionId":"subscription-scout-1",
  "assistantStream":true
}
```

随后原子基线示意：

```json
{
  "kind":"session-snapshot",
  "sessionId":"session-scout",
  "parentSessionId":"session-lead",
  "subagentMode":"continuable",
  "subscriptionId":"subscription-scout-1",
  "streamId":"stream-scout-1",
  "replace":true,
  "historyFormatVersion":4,
  "cursor":80,
  "hasMore":false,
  "events":[],
  "bytes":0,
  "view":"conversation",
  "projections":{"asOfSeq":80,"values":{"todos":[],"turnOutline":[]}},
  "assistantStream":{"revision":0}
}
```

`assistantStream` 可以包含正在输出的 `activeAttempt`。这是同一个快照切点的原子基线，客户端必须连同历史一起安装。完整 token 帧见 [实时流协议](dsh-rc2-mobile-integration.md)。

持久事件与 token 示意：

```json
{"kind":"event","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","subscriptionId":"subscription-scout-1","streamId":"stream-scout-1","seq":81,"time":1792550401000,"event":{"type":"turn/start","turn":2}}
```

```json
{"kind":"assistant-stream","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","subscriptionId":"subscription-scout-1","streamId":"stream-scout-1","frame":{"type":"start","attemptId":"attempt-1","revision":1,"startedAfterSeq":81,"turn":2,"step":0}}
```

```json
{"kind":"assistant-stream","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","subscriptionId":"subscription-scout-1","streamId":"stream-scout-1","frame":{"type":"chunk","attemptId":"attempt-1","revision":2,"index":0,"time":1792550401100,"chunk":{"type":"text-delta","index":0,"text":"已完成素材分析"},"turn":2,"step":0}}
```

这些是已启用 assistant stream 的 follower 帧。普通 legacy 持久事件可以只有 sessionId，不能要求所有旧事件都有父子地址字段。

### 9.1 切换流程

1. 立即保存旧目标草稿、滚动位置、已加载正文和分页状态。
2. 设置新的 `desiredTarget`，显示该成员缓存或 loading；输入框草稿同步切换。
3. conversation 对新目标发送 `subscribe`。新订阅自动取消旧 follower，无须先 unsubscribe。
4. 等待新 `subscribed`，安装新的 `subscriptionId`；再等待对应 `session-snapshot`。
5. 接受快照后设置新的 `streamId`，替换该视图的当前历史窗口与 token 基线；已有更早分页可按 seq 去重保留。
6. 此后的事件只交给匹配当前 target、subscriptionId、streamId 的聊天 reducer。
7. control 继续接收原 Lead 看板、所有成员状态与目录变化。
8. 切回 Lead 时重新发送普通地址：

```json
{"type":"subscribe","sessionId":"session-lead","assistantStream":true}
```

停止浏览所有会话时：

```json
{"type":"unsubscribe"}
```

此操作只停止订阅，不停止智能体执行。离开某成员页面也不会停止它的任务；停止执行必须显式调用 `session-cancel`。

### 9.2 快速点击与代际隔离

- 一条 conversation 连接同一时刻只有一个活动订阅。切换不等于同时打开多个 token 流。
- `subscribed` 不回显请求 ID。建议订阅命令单飞：等待本次确认后再发下一次订阅，等待期间把用户意图合并为最后一个目标。
- 确认到达时若目标已经不是最新 `desiredTarget`，不把它展示成当前页，继续发送最新目标。
- 只按 sessionId 过滤不够；A → B → A 时第一次 A 的延迟帧可能污染第二次 A。必须使用 `subscriptionId` 和 `streamId`。
- 服务端已取消旧 follower 并阻止过期异步开流继续发布；APP 仍需过滤已经进入网络缓冲或自身任务队列的旧帧。
- 对陌生 streamId，只有新 `session-snapshot` 可以安装它，不能用一个 token chunk 建立新代际。
- assistant revision/index 与持久 seq 是两套时钟，token 不消耗持久 seq。
- `session-stream-reset` 后丢弃该 stream 的临时 token 状态，等待自动重新打开的快照；明确的地址错误需要修正，不应无限重发。

## 10. 对子智能体发送消息

**连接：conversation**。与 Lead 一样仍使用 `message`，新增父子地址：

```json
{
  "type":"message",
  "requestId":"human-scout-001",
  "sessionId":"session-scout",
  "parentSessionId":"session-lead",
  "subagentMode":"continuable",
  "mode":"queue",
  "text":"请把第二段录屏的切点再提前半秒，并说明原因。",
  "clientTimeZone":"Asia/Shanghai"
}
```

成功：

```json
{
  "kind":"sent",
  "requestId":"human-scout-001",
  "sessionId":"session-scout",
  "parentSessionId":"session-lead",
  "subagentMode":"continuable",
  "mode":"queue",
  "messageId":"accepted-message-123"
}
```

| 字段 | 规则 |
|---|---|
| `requestId` | 建议 APP 在发送前生成唯一 ID 并保存；子消息会传递给官方接口，响应回显 |
| `text` | 非空文本，或者提供至少一张有效图片 |
| `images` | 沿用现有格式 `[{mediaType,data,name?}]`，data 为 Base64 |
| `mode` | `queue` 默认：排到后续轮次；`steer`：尝试注入最近步骤，Host 可按其执行状态回退 |
| `clientTimeZone` | 可选，合法 IANA 名称或 UTC，沿用现有时间语义 |
| `messageId` | 成员 inbox 接受的消息 ID，不是 Session ID，也不是工具调用 ID |

发送图片示例结构：

```json
{"type":"message","requestId":"human-scout-image-002","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","mode":"queue","text":"请比较这帧画面","images":[{"mediaType":"image/png","data":"<实际图片的Base64>","name":"frame.png"}]}
```

上例 Base64 是占位符，联调时必须替换为实际图片。图片类型、大小与数量限制继续遵守 [主协议的图片输入规则](../PROTOCOL.md)，由网关和 Host 的附件校验共同执行。

发送状态：

```text
草稿 → 发送中 → sent（已被 inbox 接受）→ 实际消息/输出事件
         ↘ 明确 error：展示错误，保留草稿
         ↘ 断线且未收到回执：标为发送结果未知，恢复后核对历史与队列
```

- `sent` 只表示接受，不表示该任务已完成或已有回复。
- 不要收到 sent 就把其他成员的输入框清空；按发送时固定的 target 和 requestId 更新。
- 子消息的 `messageId` 可与实时 `user/message.event.raw.id` 或历史 `user/message.data.id` 对照；消息仍在队列时还没有对应的已执行正文。
- 不保证自动重试去重。没有回执时，不要重连后盲目自动重发，以免对成员重复下达任务；先查询历史和队列，再提供用户可控的重试。
- one-shot、unknown 不能发送，网关返回 `subagent/not-resumable`。
- 即使 active，父 Agent 不在场、恢复容量不足、模型不能接收图片等情况也可能失败，按第 15 节处理。
- 不要为子会话携带 `workspaceId`、`cwd` 或 `agentPreset` 来创建新会话；成员对话必须有明确 sessionId 与父地址。

### 10.1 用户把任务交给不同成员

APP 可以提供两个入口，语义要明确：

1. **继续沟通**：进入某成员会话发送要求，该消息只路由给该成员。
2. **创建/调整共享任务**：在 Lead 会话发送要求，如“请把 task-2 重新分配给 music-producer，其他任务不变”。由 Lead 调用团队工具处理，APP 等待 `agent-team-updated`。

给成员发送一段文本不会由网关自动新建共享任务，也不会自动改变 owner。APP 可以预填指令，但要让用户看到实际发送给哪个会话。

创建新团队前先查询现有 `agent-presets`，由用户选择 Host 实际返回的团队模式 ID，再使用现有 `session-create` / 空会话 `select-agent-preset` 流程。不要硬编码实验性 preset ID；模式选择细节见 [会话模式接入](session-agent-preset-app-integration.md)。

## 11. 停止与继续

**连接：control**。停止成员：

```json
{"type":"session-cancel","requestId":"stop-scout-001","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable"}
```

```json
{"kind":"session-cancelled","requestId":"stop-scout-001","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","accepted":true}
```

- accepted 表示已接受取消请求，执行方可能稍后才停止；以 `session-status` 和轮次事件更新界面。
- 已空闲、已结束或不在驻留运行中的目标，官方接口可能接受为空操作。
- 不自动清空成员排队消息，不删除成员，不把它拥有的共享任务改成 completed。
- 恢复使用同一成员地址重新发送一条 `queue` 消息，比如“继续处理当前任务”；是否能恢复由 Host 校验。
- 不要对成员调用缺少父地址的普通 `session-cancel`，Host 会拒绝普通会话路由。

## 12. 成员待办、审批与轨迹

### 12.1 成员自己的待办

**连接：control**：

```json
{"type":"tasks","requestId":"todos-scout-001","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable"}
```

```json
{"kind":"tasks","requestId":"todos-scout-001","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","asOfSeq":80,"todos":[{"content":"整理镜头切点","status":"in_progress"}]}
```

`goal` 同样支持父子地址，返回该会话自己的 Goal。历史和订阅快照中的 `projections.values.todos` / `goal` 也可直接初始化。实时 `tasks-updated` / `goal-updated` 用它们自己的 sessionId 路由，禁止覆盖团队共享任务。

### 12.2 审批和用户提问

- 复用 `question-requested`、`approval-requested`、对应响应和 resolved 帧，不新增团队审批协议。
- 请求中的 `sessionId` 可能是任何成员或更深子会话。按 `rpcId` 去重并保存真实 sessionId。
- 切入子会话时网关会按现有机制重放仍待处理的卡片，split 模式的卡片发到 control。
- 不要把子成员审批发送给 Lead，也不要仅显示当前页而丢掉后台其他成员的待处理卡片。
- 用户点击后台审批通知，可按目录/团队缓存定位该成员；若地址暂不可得，先保留卡片并刷新目录。

### 12.3 对话与执行轨迹

子会话复用现有 V4 消息与工具轨迹渲染器。轨迹数据属于该成员会话，不能拼接进 Lead 的 seq 空间。`assistant-stream`、持久 `event`、历史原始事件的结构不同，继续使用已有转换层。

## 13. APP 数据层与状态机建议

建议拆为三个可独立更新的状态：

```text
TeamStore      : Lead 的成员与共享任务、每个父节点的目录
SessionStore   : 各会话摘要、运行状态、独立 todos / goal / outline
ConversationUI : 当前 target、订阅代际、当前正文窗口、stream、草稿与滚动位置
```

事件路由示意：

```text
onControl(frame):
  projection-baseline     → 安装/替换该控制代际的投影集合
  agent-team              → 按 requestId 和该键水位更新指定 Lead
  agent-team-updated      → 按 sessionId 替换对应 agentTeam
  subagents               → 更新指定父节点目录
  subagents-updated       → 替换指定父节点目录
  subagent-identity-updated → 更新该子会话身份
  subagent-timing-updated → 更新该子会话耗时
  session-status          → 更新该会话 running
  tasks-updated           → 更新该会话内部待办
  question/approval       → 按真实 sessionId 和 rpcId 保存

onConversation(frame):
  subscribed              → 关联当前单飞切换请求，记录 subscriptionId
  session-snapshot        → 仅接受最新目标的 subscription，安装 streamId 与基线
  event / assistant-stream → 仅当前 target + subscriptionId + streamId 可以进入当前聊天 reducer
  history                 → 按 requestId 找原始 target，仅补该会话旧正文
  sent                    → 按 requestId 找原始发送目标，更新该次发送状态
```

业务层计算：

```text
currentMember = team.members.find(id == currentTarget.sessionId)
currentMemberTasks = team.tasks.filter(ownerName == currentMember.name)
unassignedTasks = team.tasks.filter(ownerName 缺省)
memberStatus = phase != active ? phase : running已知 ? running/inactive : unknown
```

实现时 `currentMember == null` 要有兜底，可能正在看普通子智能体或旧成员数据。点击任务 owner 找不到成员时只展示名字，不构造不存在的导航地址。

不要把当前选中的成员写成所有请求的隐式全局变量。发送、分页、停止等异步请求发出前，复制并固定完整 target，之后即使用户切换页面也不能改变该次请求的目的地。

## 14. 断线、后台和恢复

1. 连接断开时保留成员、任务和正文缓存，标记可能过期。停止认为当前 token 流仍有效。
2. 重连两条连接，检查新的 capabilities；网关可能已切换版本或 Host 配置。
3. control 接收新的 `projection-baseline`，并重查 `sessions`、当前 Lead 的 `agent-team` 和已展开分支的 `subagents`。
4. conversation 使用当前完整 target 重新 subscribe；新快照会恢复进行中的输出。
5. 新 streamId 是新代际，不能接着旧的 revision/index 拼接。快照是替换型基线。
6. 按真实子 sessionId 恢复审批和提问卡片。
7. 对发送结果未知的消息核对历史/队列，不自动重发。
8. 恢复不了的分支保持错误态，允许返回 Lead 或切其他成员；不要清空整个团队页面。
9. APP 回前台时执行同样的轻量刷新；不能假定后台期间运行状态通知全部收到。

网关本身会在 Host control 流或会话 follower 中断后重开，并发送新基线；客户端不需要为每条 token 再查询团队。团队插件状态、会话持久数据迁移等永久问题要显示给用户。

## 15. 错误处理表

常见错误统一使用 `kind:"error"`，包含 `code`、`message`，查询通常还带 `requestType`、`sessionId` 和原 `requestId`。本次新增的查询、历史、停止及正常子发送路径会保留关联信息；兼容旧输入校验错误时应容忍可选字段缺省。

| code / 情况 | 含义 | APP 动作 |
|---|---|---|
| `bad-request` | 地址缺字段、相同父子 ID、非法模式等 | 保留草稿，修正 APP 参数；不要无限重试 |
| `wrong-channel` | 发到另一条连接 | 修正网络分发，不提示用户重新建任务 |
| `session/not-found` | 指定会话不存在 | 刷新目录，允许返回 Lead |
| `session/agent-busy` | 子会话误走普通会话路由等 | 检查是否丢失 parentSessionId / subagentMode |
| `subagent/unauthorized` | 父子不匹配、模式不匹配 | 停止该错误地址订阅，刷新目录，不尝试绕过关系校验 |
| `subagent/not-found` | 子会话不可用 | 展示分支不可用并允许重试/返回 |
| `subagent/catalog-diagnostic` | 子身份缺失或目录损坏 | 显示诊断，不伪造 continuable 地址 |
| `subagent/not-resumable` | 该模式不能继续 | 只读展示，禁用发送和停止 |
| `subagent/parent-unavailable` | 直接父 Agent 当前不可用 | 提示父会话暂不可用，用户可回父会话打开后再试；网关不自动重建父身份 |
| `subagent/delivery-unavailable` | 成员 inbox 或冷恢复当前无法接受 | 保留草稿，允许稍后重试 |
| `subagent/attachment-invalid` | 图片或模型能力校验失败 | 提示更换图片/改为文本 |
| `subagent/invalid-time-zone` | clientTimeZone 非法 | 修正客户端时区编码 |
| `history-format-mismatch` | 分页未带 V4 或旧缓存游标 | 清理该会话旧格式游标，重取基线 |
| `unsupported-session-format` | 会话格式不支持 | 停止自动循环，提示处理 Host 会话格式 |
| `SESSION_QUERY_PERSISTENCE_FAILED` | 持久化读取失败；可能是旧格式拒绝迁移 | 展示实际错误，旧格式拒绝时不要无限重开 |
| `gateway/invocation-unavailable` | Host 没挂载官方接口或版本不匹配 | 提示检查 Host 插件与版本 |
| `agentTeam.failure` | 投影发现错误记录，保持最后有效值 | 显示“团队数据异常”，保留可见内容并建议检查桌面端 |
| `projectionState:unavailable` | 没有投影 | 显示不可用，不当成网络失败或空团队 |
| `projectionState:migration-required` | 迁移前提示 | 只读提示，重新打开会话获取权威值 |

Host 的错误码可能扩展，未识别错误也要展示 message 并允许用户返回其他会话。服务端的 `session-stream-reset` 是独立帧，不能只在 `kind:error` 分支处理。

## 16. 推荐界面结构

与用户提供的 WebUI 对齐，可按以下页面实现：

1. **聊天顶部团队按钮**：展示子成员数量。当前普通会话只存在 Lead 时可收起入口。
2. **团队面板**：上半部成员列表，显示 name、运行/创建状态、当前会话标记；下半部共享任务。
3. **共享看板**：全部/当前成员/未分配筛选，三状态分栏；卡片显示标题、负责人、写入范围、状态。
4. **任务详情**：完整描述、依赖、ready、写入范围、警告、任务 ID 与 revision。失败数据保持可读。
5. **成员聊天页**：面包屑保留 Lead 标题与成员名，输入框明确目标，运行时提供停止。
6. **普通子智能体树**：展示 label、mode，展开加载后代；外部节点和只读模式标识清楚。
7. **后台交互提示**：其他成员等待提问或审批时提供可定位入口。

成员自己的内部待办可以放在该成员聊天页的“待办”面板，不混入共享看板。切换成员不切换 TeamContext，不关闭 control，不清除其他成员草稿。

## 17. 最小联调脚本顺序

以下为客户端应发送的 JSON 顺序，A/B 两条连接使用同一个已配对设备身份：

```text
A(control)       建连 → hello → projection-baseline
B(conversation)  建连 → hello
A → {"type":"sessions"}
A → {"type":"agent-team","sessionId":"session-lead","requestId":"t1"}
A → {"type":"subagents","sessionId":"session-lead","requestId":"c1"}
B → {"type":"subscribe","sessionId":"session-lead","assistantStream":true}
B ← subscribed / session-snapshot

用户点 footage-scout：
B → {"type":"subscribe","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","assistantStream":true}
B ← 新 subscribed / 新 session-snapshot
A → {"type":"tasks","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","requestId":"todos1"}
B → {"type":"message","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","mode":"queue","text":"继续细化切点","requestId":"m1"}
B ← sent / 后续成员事件
A ← session-status / agent-team-updated 等（具体到达顺序不固定）

用户点停止：
A → {"type":"session-cancel","sessionId":"session-scout","parentSessionId":"session-lead","subagentMode":"continuable","requestId":"stop1"}
A ← session-cancelled

用户回 Lead：
B → {"type":"subscribe","sessionId":"session-lead","assistantStream":true}
B ← 新 subscribed / 新 session-snapshot
```

用真实响应中的 ID 替换示例 ID；团队只有一个 Lead 时，先在 Lead 请求创建团队成员和共享任务，再重复读取面板。

## 18. APP 验收清单

| 场景 | 预期 |
|---|---|
| Lead + 3 名成员 + 3 条共享任务 | 成员总数 4，子成员数 3，owner 与任务正确匹配 |
| 点击任一成员 | 聊天目标、标题、正文、输入草稿和轨迹同时切换 |
| 切到成员后任务在后台完成 | 看板实时更新，无需先返回 Lead |
| 成员运行中/空闲 | 状态变化，不改变共享任务的持久 status |
| 同一成员有两项共享任务 | 成员筛选展示两项，不只取第一项 |
| 任务未分配 / owner 暂找不到 | 仍然展示，不自动归属 Lead |
| 依赖未完成 | pending 且 !ready 显示受阻 |
| 任务被删除、重开、重新分配 | 完整替换正确，无旧 owner 或重复任务残留 |
| 成员正在创建/创建失败 | 按 phase 展示，禁用不可进入的目标 |
| 子会话发文本和图片 | 路由给正确成员，Lead 不收到误发文本 |
| 成员 queue / steer | 回执正确，实际执行由 Host 事件体现 |
| 停止后继续 | 停止保留成员与任务，再发消息可按 Host 条件继续 |
| Lead → A → B → A 快速切换 | 旧 token、旧历史和旧回执不污染新页面 |
| 切换时仍有分页请求在途 | 响应只补原 target 缓存 |
| 层级 Lead → A → C | C 用 A 做直接父，不误用 Lead |
| one-shot / external / unknown | 按模式限制交互，unknown 先解析身份 |
| 控制连接重连 / Host 控制流重建 | 新基线正确安装，null 失效正确处理 |
| token 过程中断线 | 新快照恢复，旧 attempt 不重复拼接 |
| App 后台再回前台 | 刷新 running、团队板和当前订阅 |
| 发送后断线无回执 | 标记结果未知，不自动重复发送 |
| 子成员出现提问/审批 | 正确关联其真实 sessionId，重放不重复 |
| 无团队插件 / 没有子节点 | unavailable 与空数组有不同空态 |
| 团队记录损坏 / 旧格式迁移失败 | 显示错误并保留数据，不无限重试 |
| 两个网关都有 task-1 | 缓存互不覆盖 |
| 旧网关缺 capability | APP 可继续使用原普通对话，并提示团队能力需升级 |

## 19. 网关实现与验证入口

| 内容 | 仓库位置 |
|---|---|
| 地址校验及移动地址映射 | `lib/session-target.mjs` |
| 官方 Host 端点与参数适配 | `lib/dsh-host-adapter.mjs` |
| 查询、消息、状态帧与控制投影转发 | `lib/index.mjs` |
| 子会话实时订阅与切换隔离 | `lib/session-follower.mjs` |
| 查询、路由和 WebSocket 回归 | `test/agent-team.test.mjs` |
| 官方严格描述符 / Gateway / Peer 契约验证 | `test/agent-team-official.test.mjs` |

网关自测：

```bash
npm test
```

用本机已安装的官方 DSH 验证生成描述符与参数契约，不启动真实用户会话：

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/agent-team-official.test.mjs
```

该契约测试使用官方 Gateway、Connection 和生成的严格描述符，业务服务为测试替身；不能替代 APP 与真实团队运行的人工联调。最终按第 18 节逐项验收。

## 20. 交给 APP 开发者的实施顺序

1. 增加 capability 识别与 ConversationTarget 模型，保留多网关身份。
2. 在现有历史、订阅、发送、停止、tasks/goal 请求中编码子地址。
3. 增加团队/目录查询和四类投影更新解码；接入 control 基线。
4. 实现 TeamStore、目录树与 per-session running 状态。
5. 实现团队成员面板、任务详情和看板筛选。
6. 实现成员视图切换、单飞订阅、subscriptionId/streamId 过滤。
7. 接通子成员输入、图片、停止、发送结果未知与审批恢复。
8. 实现重连刷新、错误降级和全部验收用例。

本期完成后，APP 的团队浏览、成员聊天与共享看板可以与 WebUI 使用同一份 Host 数据；后续若需要原生拖拽分配、直接编辑任务等操作，需要另外设计并实现 Host 有授权语义的变更接口，不能由 APP 本地修改投影来冒充执行成功。
