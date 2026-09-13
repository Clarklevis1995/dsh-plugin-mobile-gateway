# DSH 0.1.5-rc.2 协议兼容性审计

核对日期：2026-09-13。本文保留审计与修复过程；当前实现状态以本节为准，后面的合并复核及首次审计为历史记录。

## 当前源码修复状态

按用户要求，Host 唯一目标为 DSH 0.1.5-rc.2，不再实现旧版分支。基于 `b37b55c` 的本地修改已完成：

- 命令保持新版 `submittedAttachments`，目录只读取 `input.attachments`；删除旧 chunkrow 展开。
- 删除有重复 seq、缺失 turn/step 的全局临时 chunk 转发，新增 `session-follower.mjs`：使用持续 follow 的原子历史/活动生成快照与有序增量。
- 独立 `assistant-stream` 帧保留 attemptId/revision/index，补齐 turn/step；持久 event 仍使用真实 seq。缺口自动重建，切换/断连/卸载取消订阅，迟到 opening 不污染新订阅。
- history 输出格式版本/cursor；带 beforeSeq 或 atSeq 的请求必须带格式版本 3，拒绝旧/未标注游标，避免误用迁移前坐标。
- conversation 历史移除内嵌 stream 和系统/request 元信息；原始视图保留 stream；实时 attempt、中断标识、usage、surface 元信息及工具失败标识已补齐。
- control baseline 安装 todos/goal，重连和新连接可收到整体投影快照，清除过期值。
- 新增 decoder 生命周期/缺口/取消测试，以及真实 WebSocket 的独立流、持久消息去重、中途重连、控制基线、历史裁剪和游标版本测试。全量测试通过，gateway dispatch 为 119 项；发布包的 29 端点/34 调用样例契约检查通过。

**移动端还需要接入新协议。** 配对无需修改，但独立流展示、缓存重建和游标版本字段不能靠旧客户端自动完成。接入契约见 [rc.2 移动端接入说明](dsh-rc2-mobile-integration.md)。本次修改范围为 gateway 仓库，尚未发布，也未执行新版真实 Host 与 App 全流程联调。

## 合并 PR #9 / #10 后的复核（修复前记录）

复核提交：`b37b55ce5191d4b1c227899308ada7a67b15bdc5`，版本号仍为 `0.7.3`。相对首次审计，已合入命令适配 PR #9（`bc47e17`）与实时流 PR #10（`82c4da6`）。本节取代下文首次审计中关于当前状态的判断；后面的分析保留作为原始基线。

**结论：命令调用层已适配 rc.2；实时流接入了正确来源，但映射存在确定缺陷，尚不能认定流式对话完整兼容。**

| 项目 | 合并后状态 | 依据 |
|---|---|---|
| `commands.execute` 参数 | 已适配 rc.2 | 改为 `submittedAttachments`；已有 `parseWireImages()` 会增加 `type: image` |
| 命令目录附件能力 | 已适配 | `commandAcceptsAttachments()` 同时识别 `input.attachments` 和 `input.images` |
| 原有 Remote 样例输入 | 全部通过 | 重跑精确 rc.2 发布包检查，29 个端点、34 次调用，无失败 |
| 实时 token 来源 | 已接入，映射不正确 | 监听了 `agent/assistant-stream`，但序号冲突且缺少 turn/step |
| 活动生成的重连恢复 | 未适配 | 丢弃 start/end，不保留 attempt 状态，没有读取活动 stream 基线 |
| 历史内嵌 stream / attempt / 格式标识 | 未改动 | 旧探针复跑仍复现原问题 |
| 旧 DSH 0.1.2-rc.1 命令兼容 | 出现回退兼容问题 | 无条件发送新版参数，旧描述符只接受 `images` |

### 阻断项 A：多个 chunk 与最终消息使用同一 seq

位置：`lib/index.mjs:2755`。

新版 `session.seq` 是“下一个持久事件的序号”，不是临时 chunk 的序号。chunk 不写入 Session 日志，所以连续 chunk 之间它通常不变；接下来提交的 `assistant/message` 会使用这个相同序号。

用当前生产 listener、按 rc.2 帧形状输入 start → 两个 chunk → 最终 message → end，实际得到：

```text
assistant/chunk   seq=42   text="Hello"
assistant/chunk   seq=42   text=" world"
assistant/message seq=42   text="Hello world"
```

移动端共享层 `SharedConversationStore.receiveEvent()` 要求 `record.seq > lastSequence`，基线替换还会按 seq 去重。因此该输出不满足现有消费契约，会导致增量被拒绝、同序数据被覆盖或消息无法正确收敛。不能简单对 `session.seq` 加 index 修复，否则仍会占用后续持久序号。

应使用独立临时流身份，并在 committed 时与持久 seq 对齐；如果坚持旧移动协议，必须提供完整的虚拟序号及历史/fork 双向映射方案。

### 阻断项 B：从 chunk 读取不存在的 turn/step

位置：`lib/index.mjs:2748`、`lib/index.mjs:2757`。

rc.2 的 start 帧有 `turn/step`，chunk 帧只有 `attemptId/revision/index/time/chunk`。当前代码先过滤掉 start，再读取 `frame.turn/frame.step`，序列化后的两个 chunk 都没有这两个字段。

移动端 `ConversationProjection.kt:96` 使用 turn/step 构建消息键，缺失时落到 `-1--1`，无法与带真实 turn/step 的最终消息正确配对。即使修好 seq，这个问题仍单独存在。

需要按 session/attempt 保存 start 元信息，在 chunk 时补齐，处理 end/取消/Agent 替换时清理；中途订阅和重连必须从上游快照恢复，不能只依赖此前是否收到过 start。

### 旧版本回退兼容

PR #9 对目录做了新旧字段兼容，但 execute 仅支持新版参数。用本机精确 `0.1.2-rc.1` 发布描述符复核，当前调用缺少 `images`、多出 `submittedAttachments`。如果还要维持 README 声明的旧 DSH 支持，应增加 Host 能力/版本分支；否则应明确提高最低支持版本。不能把目录双字段识别理解成执行接口也同时兼容。

### 复核验证及下一步

- 现有 `npm test` 全部通过：115 项 gateway dispatch、认证、LAN、多网关 11 项等。
- 新增流 listener 在仓库现有测试中没有对应 `agent/assistant-stream` 用例，因此全量测试通过不能排除上述缺陷。
- 临时探针 `check-post-merge-stream.mjs` 直接执行生产映射函数与 listener，确认重复 seq、turn/step 缺失；输出存于 `post-merge-stream-results.json`。
- `check-post-merge-old-host.mjs` 验证旧 Host 参数不匹配；`check-event-mapping.mjs` 确认 attempt、工具错误判定、内嵌历史裁剪和格式标识问题仍在。
- 本次脚本和日志均在 `/private/tmp/dsh-rc2-packs/`；合并后的全量日志为 `gateway-tests-post-merge.log`。未执行新版真实 Host 与真机完整联调。

建议先修复实时流两个阻断项并覆盖连续 chunk、最终结算、失败重试、中途重连；随后处理历史代际/缓存和内嵌流精简。普通文件上传、jobs、PTC 详情仍属于后续能力扩展。

## 首次审计结论（合并前，历史基线）

当前 gateway 不能直接认定为完整兼容 DSH 0.1.5-rc.2。主要问题是命令参数变更、实时 Assistant 流与持久事件分离，以及 Session 历史格式升级后的序号与缓存语义。

普通文字/图片 prompt、会话与工作区管理、队列、模型、设置、Goal 和审批的核心入口仍在。无需重写整套网关，也无需因 DSH 升级而更换配对协议。

只修命令参数，可以恢复命令调用，但不能恢复逐 token 显示。若要完整支持流式输出、生成中重连和新版轨迹，建议 gateway 与移动端协同增加独立 Assistant 流能力。仅改 gateway、保持旧 App 完整体验，需要另外设计稳定的虚拟序号及双向游标映射，复杂度明显更高。

## 核对基线与证据

- gateway：`package.json` 为 `0.7.3`，提交 `ee4cf3f75d501107cd75df2023ea15f8bea5e71a`；检查开始时工作区干净。
- 当前文档声明：DSH `0.1.2-rc.1` / `0.1.3-alpha.1`。本机实际安装的 CLI 及所检查的相关依赖为 `0.1.2-rc.1`。
- 目标版本的准确 npm 名称：`@deepseek-ai/dsh@0.1.5-rc.2`。
- 下载了目标版本的 Session/Workspace/Settings Controller、Commands、Goal、Agent Presets、LLM、API Gateway、Session、Agent、User Approval 发布包，检查真实 `typert.host.js` 与类型定义。
- 官方源码审计固定于 `c291e7961a515f6d7af9304e7fd1d257929aef26`，该源码的 CLI 版本为 `0.1.5-rc.2`。调用契约结论以精确 npm 发布包为准，源码用于追踪行为。
- 未更新本机 DSH、未启动新版实例、未迁移用户会话。

官方入口：[npm 精确版本](https://www.npmjs.com/package/@deepseek-ai/dsh/v/0.1.5-rc.2)、[固定源码提交](https://github.com/deepseek-ai/deepseek-harness/tree/c291e7961a515f6d7af9304e7fd1d257929aef26)。

注意三个独立版本：`dsh-mobile-v1` 是移动 WebSocket 子协议，`hello.protocol = 3` 是当前移动握手值，`Session header.version = 3` 是新版 DSH 持久会话格式。后两者数值相同没有兼容含义。

## 必须处理的差异

### 1. 命令执行参数和命令附件能力改变

当前 `lib/dsh-host-adapter.mjs:173` 发送：

```js
{ agentId: sessionId, line, images }
```

新版 `commands/execute` 精确参数是：

```js
{
  agentId: sessionId,
  line,
  submittedAttachments: images.map(image => ({ type: 'image', ...image })),
}
```

无附件也必须传 `submittedAttachments: []`。图片不仅需要改字段名，每项还要增加 `type: 'image'`。

新版严格边界拒绝旧参数：缺少 `submittedAttachments`，同时存在多余的 `images`。实际网关会在调用业务方法之前抛出 `gateway/arguments-invalid`。影响范围包括 `command-execute`、通过命令实现的菜单操作，以及 `/permission` 权限切换。

此外，命令目录的 `input.images` 改为 `input.attachments`。当前 `lib/index.mjs:1099` 的 `commandUiDescriptor()` 仍读取旧字段，会错误地把支持附件的命令标为不支持图片。适配层应把新版目录映射回现有移动 `ui.images`；普通文件支持再单独增加 capability。

兼容旧 DSH 时，应在适配初始化阶段选择版本/能力分支，或者读取可用的描述符。不要遇到任意执行异常就换参数重试有副作用的命令。

来源：[Commands 执行实现](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/interaction/commands/src/index.ts)、[附件与目录定义](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/interaction/commands/src/types.ts)。

### 2. 实时 token 不再是持久 `session/event`

| 项目 | 当前 gateway 假设 | DSH 0.1.5-rc.2 |
|---|---|---|
| 实时增量来源 | `session/event` 的 `assistant/chunk` | `agent/assistant-stream` |
| 增量身份 | 持久事件 `seq` | `attemptId`、`revision`、`index` |
| 生命周期 | chunk 后接最终消息 | `start` / `chunk` / `end` |
| 持久结算 | chunk 与 message 各自入日志 | 一个 `assistant/message` 或 `assistant/attempt`，内嵌 `data.stream` |
| 中途重连 | 当前 history 仅返回持久事件 | `follow({ assistantStream: true })` 可返回活动 attempt 的快照 |

`lib/index.mjs:2703` 只监听 `session/event`，所以正常完成后的 `assistant/message` 仍能收到，但生成中的文字、思考和工具参数增量不再到达手机。当前 `sessionSnapshot()` 还会取第一帧即关闭 stream，且没有请求 `assistantStream: true`，不能恢复活动中的生成前缀。

需要在 Host Adapter 增加持续 follow 或独立流适配。优先使用上游 `session/follow` 的快照与增量协定处理选中会话；若保留全局 Cordis 监听，则必须自行处理基线、订阅切换和重连竞态，并避免同一持久事件重复转发。

建议移动端新增显式选择的独立 Assistant 流帧，保留 `attemptId/revision/index`，处理：

- `start`：建立临时展示状态。
- `chunk`：按 attempt 和连续 index 追加；发现缺口后重新取基线。
- `end.committed`：用其 `seq` 与持久消息合并，避免重复显示。
- `end.abandoned`：清理临时 attempt，不伪造已经提交的会话消息。
- 生成中重连：安装 `snapshot.assistantStream.activeAttempt` 后接续后续帧。

不能直接把 `index`、`revision` 或 `startedAfterSeq` 当成旧 `event.seq`。临时流没有独占的持久序号。本项目的移动端共享层 `SharedConversationStore.receiveEvent()` 明确要求新事件 `seq > lastSequence`；随意合成会与去重、分页、fork 坐标冲突。

来源：[Agent 流类型](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/core/agent/src/runtime-types.ts)、[Remote 流类型](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/api/session-controller/src/types.ts)、[follow 快照与增量实现](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/api/session-controller/src/history.ts)。

### 3. 历史内嵌 stream、失败 attempt 和精简逻辑

新版 `SessionHistoryRecord` 只保留 `{ type: 'event', event }`；原来的顶层 `chunks + chunkrow/*` 由事件中的 `data.stream` 替代。内嵌紧凑记录包括 `text-chunks`、`reasoning-chunks`、`tool-call-chunks` 和单个 `chunk`。

当前 `expandHistoryRecords()` 对普通 event 直接透传，因此不能说新版历史会全部解码失败：已完成消息的 `data.message` 仍在，基础历史对话可以继续工作。但存在这些缺口：

- `lib/index.mjs:266` 对 `assistant/attempt` 落入默认分支，仅发事件类型，丢掉 turn/step、失败或重试 attempt 的流内容。
- `trimConversationEvent()` 只丢旧顶层 `assistant/chunk`。新版 `assistant/message.data.stream` 和 `assistant/attempt.data.stream` 仍全部进入 `view: conversation`，造成历史包体和序列化成本膨胀，可能更早触发 `maxBytes` 截断。
- 当前实时 `assistant/message` 映射不带 `interrupted` 和 usage；适配时应明确保留哪些完成/中断元信息，不能靠旧 usage chunk 推导全部状态。

改动建议：在适配层区分旧压缩行与新版内嵌 stream；普通对话历史保留最终 message，移除不需要的完整流；轨迹按需提供 attempt 和紧凑记录。不要为了兼容旧 chunk 直接按 `seq + index` 展开新版流，这会占用其他持久事件的真实坐标。

来源：[Session 事件定义](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/core/session/src/types.ts)、[Assistant 紧凑流定义](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/llm/llm/src/assistant-stream.ts)。

### 4. Session 格式迁移会改变历史 seq

目标发布包明确声明 `SESSION_FORMAT_VERSION = 3`。

- V1 → V2：把独立 chunk 收进 Assistant 事件，重新分配存续事件序号。
- V2 → V3：插入 `system/message`，重排序号与同会话引用；替换区间改为 `surfaceOp: { op: 'replace', startSeq, endSeq }`。
- 同一个 `sessionId` 升级后，历史 `seq` 不保证仍指向原事件。

当前 adapter 从快照取出 records/projections，却丢弃 `header.version`。移动端无法通过 history 响应识别格式切换。旧缓存若继续增量合并、沿用 `beforeSeq` 或把旧 `atSeq` 发给 fork，会有漏消息、错误去重或错误定位的风险；若客户端已经全量替换基线，则需用升级用例证明这一点。

需要在移动历史/同步契约中传递会话格式或历史代际标识，格式变化时清除该会话缓存和分页游标，重新建立完整基线；旧缓存没有标识时首次连接新版应执行一次重建。fork 必须使用当前代际中取得的真实持久序号。

`system/message` 不应被当作普通用户聊天展示；涉及上下文/轨迹时要定义其呈现规则。需要使用 surface 替换的消费者应适配 `startSeq/endSeq`，并保留必要 provenance。上游负责迁移磁盘日志，gateway 无需自行改写 JSONL。

来源：[V1 → V2 迁移](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/session/session-format-v1-to-v2/README.md)、[V2 → V3 迁移](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/session/session-format-v2-to-v3/README.md)。

## 兼容时应一并修正的现有缺口

这些是当前代码与新版有效数据之间的缺口，不全部代表 rc.2 才新增的破坏性变化。

| 缺口 | 当前行为 | 建议改动 |
|---|---|---|
| 工具失败判定 | `buildWireEvent()` 用 `!!data.error` 判断失败 | 新版允许 `tool-result` block 的 `isError: true` 而无结构化 `data.error`；以 block 状态为准，兼容已有错误元数据 |
| 控制流重连基线 | baseline 只处理 queues，忽略 projections | 安装 baseline 中的 todos/goal 等快照，避免断连期间变化没有后续增量就无法收敛 |
| 上游数据归一化边界 | 流帧解析与部分投影/目录兼容逻辑散落在 `lib/index.mjs` | 将 DSH 格式判断与数据映射集中到 Host Adapter；index 保留移动连接、鉴权和业务分发 |
| 能力声明 | 当前能力列表没有表明 Session 格式/Assistant 流模型 | 区分网关可提供能力与客户端主动选择的能力，避免向旧客户端发送其不能处理的新帧 |

## 已有核心接口中未发现直接参数阻断的部分

用实际 Host Adapter 的样例调用检查了 29 个不同 Remote 端点、34 次调用。除 `commands/execute` 外，其余样例通过发布包参数名和输入 schema 检查。

| 领域 | 核对结果 |
|---|---|
| Session list/search/create/prompt/attachment/fork/cancel/updateQueue/rename/selectModel/modelCatalog/canOpenWorkspacePath | 当前入口和样例参数仍有效；`session.list` **仍然使用 `_request`** |
| session.follow/page/control | 调用形状仍有效；历史/流输出和附加能力需按前文适配 |
| Workspace follow/create/archiveSession | baseline、归档及现有请求形状仍可用 |
| Settings describe/update | `ns/patch/expectedRevision` 仍可用；可省略 expectedRevision |
| Commands list | agentId 入参仍可用；目录的附件能力字段必须映射 |
| Skills、Agent Presets、LLM providers | 当前 namespace 和样例参数仍有效 |
| Goals edit/pause/resume/clear | `agentId/ref/request` 和 `maxGoalRounds` 仍有效 |
| 问答与审批 waterfall | `user-questions/request`、`approval/request` 及原回答形状仍在；不能把它们误判为需要迁移到另一个 RPC |
| Host 集成 | `typertGateway.invoke/stream`、`agentDefaultModel.currentSelection/saveSelection`、WebServer 注册入口仍在 |
| Web 管理面板与搜索配置 | sidebar/footer 和 shell/overlay slots 仍在；`session-query-sqlite` 与 `first-search` 配置仍有效 |

这不是新版真实 Host 全流程通过的证明；样例输入校验不覆盖业务状态、所有数据组合、返回值语义和真实浏览器集成。

## 可选的新能力，不阻塞基础兼容

1. **普通文件上传**：新版 prompt 支持 `{ type: 'file', receiptId }`，需先通过 `fileUploads/upload` 获取绑定 Agent 的 receipt。现有 gateway 只有图片提交与自身的文件列表/下载，不能等同于 DSH 文件附件上传。完整接入还需移动上传请求、receipt 绑定及文件 block 展示；不能直接把任意主机路径当 receipt。
2. **后台 jobs**：新版 `session.control` baseline 包含 jobs，增量有 job 状态。当前 gateway 忽略这部分；若要对齐新版后台任务面板，需要新增映射。它与已有 todos 清单不同。
3. **PTC 轨迹**：上游迁移把 `tool/code-dispatch*` 改为 `tool/ptc-dispatch*`，内置 preset `code` 改为 `ptc`。gateway 动态获取 preset，通常无需硬编码别名；若要呈现 PTC 详情，则需补充具体事件载荷与移动轨迹解释。不能全局替换字符串 `code`。

文件来源：[上传服务](https://github.com/deepseek-ai/deepseek-harness/blob/c291e7961a515f6d7af9304e7fd1d257929aef26/packages/client/file-upload/src/index.ts)。其他扩展见上面的 Session 类型及迁移来源。

## 推荐实施顺序与文件范围

| 顺序 | 范围 | 交付标准 |
|---|---|---|
| 1 | `lib/dsh-host-adapter.mjs`：命令参数及目录归一化；`test/host-adapter.test.mjs` | 空附件、图片附件、权限命令均通过目标发布包契约，兼容旧版本分支 |
| 2 | adapter 的历史输出；`lib/index.mjs` 的历史精简、错误/attempt 映射 | 已完成消息、失败 attempt、中断标识、大历史页行为有明确且验证过的移动输出 |
| 3 | adapter 的持续 Assistant 流；index 订阅/取消/通道分发；`PROTOCOL.md` | 新客户端可恢复实时输出和生成中重连，旧客户端按声明的降级策略运行 |
| 4 | 历史格式/代际标识；移动端共享历史与会话投影 | 旧格式缓存不会污染新序号，分页/fork/去重使用正确坐标 |
| 5 | 控制流 baseline 收敛、真实 Host 集成、文档 | todo/goal/queue 重连状态正确，Web 面板与配对在新版可用 |
| 后续 | 文件上传、jobs、PTC 完整轨迹 | 按新增 capability 单独交付 |

基础命令与普通历史适配可以保留 `dsh-mobile-v1` 和现有握手值。独立 Assistant 流可以采用向后兼容的显式订阅扩展；若选择改变既有 `event.seq` 的含义，就必须作为不兼容移动协议处理，不能静默修改。

## 验证结果与后续验收清单

本次已完成：

- `npm test` 全部通过，包括 gateway dispatch 115 项、认证、LAN 与多网关 11 项。首次沙箱运行因无法绑定测试端口退出，允许本地监听后重跑成功。
- 发布包契约检查：29 个端点、34 次调用；唯一失败项为旧 `commands/execute` 参数。新版空附件和带 `type: image` 的图片样例均通过。
- 事件映射探针复现：`assistant/attempt` 输出仅剩类型；合法 `isError: true` 且无 `data.error` 的工具失败被输出为 false；conversation 精简仍携带内嵌 stream；history 未输出格式版本。

审计脚本与详细输出暂存在 `/private/tmp/dsh-rc2-packs/`：`check-contracts.mjs`、`contract-results.json`、`check-event-mapping.mjs`、`gateway-tests.log`。临时目录可能被系统清理；正式实施时应把相关用例固化到仓库测试，并使用固定版本 fixture 或隔离的真实 Host。

正式兼容发布前至少补测：

- 旧 DSH 与 0.1.5-rc.2 的命令、附件目录、权限切换回归。
- 新版 stream start/chunk/end、失败重试、取消、无可见输出、工具参数流。
- 生成中断网重连、订阅切换、双通道连接；快照与增量无遗漏/重复。
- V1/V2 会话经真实上游迁移后打开、分页、fork，以及旧移动缓存失效。
- 内嵌流特别大的 history，conversation 视图确实去除流明细。
- 工具失败仅存在 block.isError、控制流重连安装完整投影基线。
- 真实 DSH Host 中插件加载、Web 管理入口、配对、普通消息、审批与重连闭环。

本次结论覆盖发布包契约和源码分析；尚未执行最后一组新版真实 Host 联调。
