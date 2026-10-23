# 移动端普通文件上传对接指南

## 功能与接入前提

网关通过 `file-upload-v1` 支持 PDF、Office 文档、压缩包、音频及其他普通文件上传。文件先由网关分块接收和校验，再通过 DSH 官方流式接口进入附件存储，得到会话专属的上传凭证；App 随后把凭证与文字一起发送。文件不会被写到用户指定的工作区路径，也不会仅以文字路径代替附件。

基线为 DSH 0.2.1-rc.2、`dsh-mobile-v1`、`hello.protocol: 3`、Session format 4。App 必须已完成设备配对。新增能力只在 `fileUploadsEnabled: true` 的已配对连接中公布；Host 还需组合官方文件上传服务和支持文件流式存储的附件后端。能力声明表示网关协议可用，实际 Host 不提供上传服务时返回 `file-upload-unavailable`。

本功能提供上传、原生附件消息和历史引用。文件内容能否被 Agent 解析，仍取决于 DSH 的工具、技能和文件类型；上传 PDF 不等于模型直接获得 PDF 模态输入。图片继续使用原有 `images` 协议，语音转文字继续使用 `speech-transcribe`。

## 官方 WebUI 的实现方式

源码基于本机安装的 DSH 0.2.1-rc.2：

| 官方模块与入口 | 行为 | App 对应实现 |
|---|---|---|
| `dsh-client-ui-conversation` 的 `beginFileUpload` | 创建可取消任务，维护 `uploading/ready/error`，上传成功保存 `receiptId/file` | 共享层保存每个草稿附件的状态、进度和凭证 |
| 同模块的 `pumpFileUploads` | 按并发限制调度，不一次启动全部上传 | 客户端使用有界上传队列 |
| 同模块的 `sendSession` | 非图片附件必须为 ready，发送 `{type:"file", receiptId}` | 等所有文件获得完成响应后再发送消息 |
| `dsh-client-file-upload` 的 `ctx.fileUpload.upload` | Blob 经 Worker/XHR 上传并报告进度；stream 经 Worker/Fetch 传输；精确字节可走 Remote | 移动端改走现有已鉴权 WebSocket 的分块协议 |
| 官方 Host 路由 `/api/session/uploadFileBinary` | 接收原始二进制流，返回 Session 专属凭证与持久附件引用 | 网关在进程内通过 Connection 路由注册表和固定 owner Peer 调用，不要求手机访问此 HTTP 路由 |
| 官方 `SessionCommandController.prompt` | 校验同 Session 的凭证，转成原生 file 内容块，再进入 inbox | App 发送网关 `message.files`，不提交任意 `attachmentId` 或主机路径 |

WebUI 切换 Session 时会为携带的文件重新上传和绑定。发送失败时保留草稿，成功后再清理。上传和消息发送是两个独立步骤，上传成功不会自动唤醒 Agent。凭证绑定精确的 Session 实例；Host 处理成功消息后会退休凭证，不能把它当作永久附件 ID。

## 推荐流程与状态

1. 检查 `hello.capabilities` 包含 `file-upload-v1`，并保留当前 `gatewayId` 和连接代际。
2. 新草稿尚无会话时，先用已有 `session-create` 创建空白普通 Session。上传请求必须指定现有 `sessionId`，不能自动创建会话，也不支持子智能体会话。
3. 系统选择器取得文件后，复制到 App 私有草稿目录。后台流式计算字节长度和 SHA-256；不要把文件全部读入内存。上传期间固定这份副本，不能改用可能变化的外部文件。
4. 控制连接发送 open，按返回的 `chunkBytes` 逐块编码、发送并等待确认。
5. 所有字节确认后发送 finish。UI 显示“处理中”，直到收到 `file-upload-completed`，才能标记为 ready。
6. 对话连接发送 `message`，包含原始文字、可选图片和所有 ready 文件的 `receiptId`。没有文字的纯文件消息也可发送。
7. 收到 `sent` 后清理对应草稿；实时和历史渲染使用持久 `file` 引用。发送失败保留草稿，根据错误决定重试还是重新上传。

建议状态为：`preparing → opening → uploading → committing → ready → sending → sent`。各阶段允许进入 `error`；未完成上传可进入 `cancelling → cancelled`。每个草稿附件应有本地稳定 ID，并记录其所属网关、会话、连接代际、uploadId、字节数、摘要、已确认偏移、receiptId 和 file 引用。

## 通道与请求关联

上传的四类请求使用 **control 连接**，兼容 legacy 单连接。`message` 使用 **conversation 连接**，同样兼容 legacy 单连接。文件上传与消息发送可以位于两条不同连接，上传凭证由同一 Host 的目标 Session 校验。

所有上传请求必须带 1 至 128 字符的非空 `requestId`，响应和错误回显。建议每次 RPC 使用新的 UUID；消息发送的 requestId 则固定为该次提交的 UUID，重试同一次提交时保持不变。`uploadId` 仅标识传输，不代替 requestId。

上传中的 uploadId 只属于创建它的 WebSocket；即使另一个 socket 属于同一设备，也不能继续写入或取消。切换网关、Session 或连接代际后，不得把旧回调应用到新草稿。

## 协议帧

### 开始上传

```json
{
  "type": "file-upload-open",
  "requestId": "open-1",
  "sessionId": "s1",
  "name": "分析报告.pdf",
  "size": 7,
  "sha256": "7d1a54127b222502f5b79b5fb0803061152a44f92b37e23c6527baf665d4da9a"
}
```

上例摘要对应 ASCII 内容 `abcdefg`，size 为解码后的精确字节数。摘要为 64 位十六进制，大小写均可；响应规范化为小写。允许零字节文件，使用空文件摘要，open 后直接 finish。

```json
{
  "kind": "file-upload-opened",
  "requestId": "open-1",
  "uploadId": "upload-uuid",
  "sessionId": "s1",
  "name": "分析报告.pdf",
  "size": 7,
  "chunkBytes": 262144,
  "maxBytes": 536870912,
  "idleTimeoutMs": 120000
}
```

`name` 仅为显示文件名，最多 255 个 UTF-16 code unit，不得包含目录分隔符、控制字符、NUL，也不能是 `.` 或 `..`。不要发送移动端完整路径。Host 仍会对最终文件名做清理，后续展示以完成响应中的 `file.name` 为准。

不传 `path`、`cwd`、`parentSessionId` 或 `subagentMode`。通用文件不做扩展名白名单，字节原样存储，不执行、不解压。传输大小使用 64 位整数，并保证落在 JSON 安全整数范围；不要用字符串替代数值。

### 发送分块

```json
{
  "type": "file-upload-chunk",
  "requestId": "chunk-1",
  "uploadId": "upload-uuid",
  "offset": 0,
  "data": "YWJjZGVmZw=="
}
```

```json
{
  "kind": "file-upload-chunk-accepted",
  "requestId": "chunk-1",
  "uploadId": "upload-uuid",
  "sessionId": "s1",
  "nextOffset": 7
}
```

- `offset` 按解码后的字节计数，必须等于网关当前已接收字节数。下一块必须使用确认帧的 `nextOffset`。
- 每块为非空、标准带 padding 的 Base64，不带 data URL 前缀、空白或换行。每块独立编码，不能按字符直接切割整文件 Base64。
- 每个 uploadId 同时只进行一项操作，采用“发一块、等确认、再发下一块”。不同文件可以在服务端并发限制内并行。
- `chunkBytes` 为解码后的块上限，会同时受 WebSocket payload 配置约束；不能硬编码为 256 KiB。最后一块可以更短。
- 界面进度根据已确认字节数计算，不使用客户端已发出的 Base64 长度。100% 字节已传输仍须等待 finish 完成。

### 校验并提交

```json
{ "type": "file-upload-finish", "requestId": "finish-1", "uploadId": "upload-uuid" }
```

```json
{
  "kind": "file-upload-completed",
  "requestId": "finish-1",
  "uploadId": "upload-uuid",
  "sessionId": "s1",
  "receiptId": "host-receipt-uuid",
  "file": {
    "attachmentId": "sha256:7d1a54127b222502f5b79b5fb0803061152a44f92b37e23c6527baf665d4da9a",
    "name": "分析报告.pdf",
    "bytes": 7
  },
  "sha256": "7d1a54127b222502f5b79b5fb0803061152a44f92b37e23c6527baf665d4da9a"
}
```

网关先校验接收长度与摘要，再流式交给官方附件存储。只有 Host 返回合法凭证后才发送完成响应，并删除网关私有暂存文件。`attachmentId` 是不透明持久引用，即使当前带 `sha256:` 前缀，也不要依赖其字符串结构；`receiptId` 是发送新消息所需的会话权限凭证，两者不可互换。

完成结果在原连接上短暂缓存，默认最多 2 分钟，且全网关最多保留 128 条，较早结果可能被逐出。同一连接再次发送相同 uploadId 的 finish，可以取得相同凭证，不重复创建 Host 上传。它不是跨连接断点续传，也不是永久查询接口。

### 取消

```json
{ "type": "file-upload-cancel", "requestId": "cancel-1", "uploadId": "upload-uuid" }
```

```json
{ "kind": "file-upload-cancelled", "requestId": "cancel-1", "uploadId": "upload-uuid", "sessionId": "s1" }
```

取消会中止接收或正在执行的 Host 提交，等待操作退出，再释放临时文件和并发名额；被取消的活动请求可能同时返回 `file-upload-cancelled` 错误，App 需按各自 requestId 结算。取消已完成的上传不会删除 Host 持久附件。提交与取消竞争时，Host 可能已经完成存储，因此不能承诺取消能回滚已落盘的附件。

## 发送文件消息

```json
{
  "type": "message",
  "requestId": "submission-uuid",
  "sessionId": "s1",
  "text": "帮我分析这个报告",
  "files": [{ "receiptId": "host-receipt-uuid" }],
  "mode": "queue"
}
```

```json
{ "kind": "sent", "requestId": "submission-uuid", "sessionId": "s1", "mode": "queue" }
```

`files` 最多 20 项，不允许重复凭证；每项只需 `receiptId`。网关不会采信客户端提供的主机路径或持久 attachmentId。含文件消息必须有已存在的普通 sessionId 和 1 至 128 字符的 requestId。`text` 可省略，可同时携带已有 `images`，`mode` 可为 `queue` 或 `steer`。当前移动协议组装顺序为图片、文件、文字，不表达图片与文件任意交错排序。

网关将文件项转成官方 `{type:"file", receiptId}`。Host 校验该凭证属于当前 Session，准入后转换为 `{type:"file", attachment}` 并处理凭证生命周期；跨 Session、伪造或已退休凭证返回 `session/attachment-invalid`。

含文件消息的 requestId 会原样传给 Host。消息回执丢失但连接可恢复时，用同一个 requestId 重试完全相同的提交，Host 可根据 inbox 或已记录用户消息去重。不要给同一 ID 换正文，也不要在不明确是否送达时用新 ID 自动重复发送。Host 重启或 Session 实例替换后应先核对队列和原始历史中的 `source.rpcId`，凭证可能已失效。

上传成功、消息发送失败时保留草稿；普通可恢复错误可重试原提交，凭证失效则重新上传。切换 Session 必须重新上传并取得新凭证，不能把旧会话凭证携带过去。关闭后重新打开 App 时，也不要仅凭数据库存过 receiptId 就判定文件 ready，应重新校验草稿所属连接与 Host 状态，必要时重新上传。

## 实时消息与历史渲染

持久用户消息的实时帧新增可选 `event.files`：

```json
{
  "kind": "event", "sessionId": "s1", "seq": 42, "time": 1000,
  "event": {
    "type": "user/message", "text": "帮我分析这个报告", "source": "user",
    "files": [{ "attachmentId": "opaque-file-id", "name": "分析报告.pdf", "bytes": 7 }]
  }
}
```

`history` 与 `session-snapshot` 保留原生 `{type,seq,time,data}` 结构，文件位于 `user/message.data.content[]` 的 `{type:"file",attachment:{attachmentId,name,bytes}}`。App reducer 必须识别 file 块，不能因未知类型丢掉整条纯文件消息；实时和历史按网关、会话、格式版本及 seq 合并，得到相同的附件卡片。

推荐保存附件名称、字节数和持久引用，不在消息表内存储大段 Base64。发送设备可继续使用其私有草稿副本进行本地预览；在确认消息已入历史、无需重试后，再按缓存策略释放副本。

本次不增加按 file attachmentId 下载附件的接口。已有 `attachment` 是图片读取接口，`file-download-*` 只读取会话工作目录中的文件，不能把 attachmentId 当路径传给它们。Host 附件存储可以在工作区之外；其他设备即使看见附件卡片，也不能据此假定已有远程预览链路。已有 `deliverables/presented` 文件卡片和本地文件链接仍按原下载协议处理。

## 失败处理与资源生命周期

错误帧为 `kind:"error"`，带 `requestType/requestId/code/message`，并在请求提供时带 sessionId 或 uploadId。错误文案用于显示，分支判断使用 code。

| code | 处理方式 |
|---|---|
| `authentication-required` / `wrong-channel` | 检查设备配对和通道；即使调试关闭普通鉴权，也不能匿名上传或发送文件凭证 |
| `file-upload-disabled` / `file-upload-unavailable` | 关闭当前上传入口或提示管理员检查配置；不可退回上传任意路径 |
| `bad-request` / `session-not-found` / `subagent/attachment-invalid` | 修正文件名、请求字段或会话目标，子会话不提供此入口 |
| `file-too-large` | 在选择阶段或 open 失败后提示大小上限，不自动反复上传 |
| `file-upload-limit` / `file-upload-busy` | 降低并发，等待前一请求完成；不要同时发多个 chunk 或 finish |
| `file-upload-offset` / `file-upload-invalid-data` / `file-upload-size` | 修正偏移、Base64 和长度；chunk 不是幂等请求，回执状态不明时取消并从头重传 |
| `file-upload-incomplete` | 补齐剩余块后再 finish；当前已接收字节仍保留 |
| `file-upload-checksum` | 当前传输已销毁，从固定本地副本重新计算后完整重传 |
| `file-upload-not-found` / `file-upload-cancelled` | 传输属于其他连接、已取消、已过期或已结束；重新 open，不能从旧偏移续传 |
| `file-upload-timeout` / `file-upload-failed` / `file-upload-invalid-response` / 文件系统错误码 | 当前操作可能失败；finish 的失败会清理传输，保留本地副本，提示重试；磁盘问题应先处理空间或权限 |
| `session/attachment-invalid` | Host 不支持文件存储或凭证不属于该 Session、已失效；检查 Host 错误消息并视情况重新上传 |

传输只在当前进程和 socket 内有效，不支持断线、重启后断点续传。socket 关闭或网关停止时中止活动上传并删除网关暂存；空闲传输由定时扫描回收，实际回收可晚于 idleTimeoutMs 一个扫描周期。提交阶段有独立超时，且同一传输的取消、写入和清理串行协调。

finish 失败或取消时，官方附件存储可能已接收部分或全部内容；网关只保证清理自身暂存，不操作 Host 附件 GC。进程被强制杀死时，系统临时目录可能残留 `dsh-mobile-upload-*`，它们不是可恢复传输。

## 网关配置

| 配置 | 默认值 | 作用 |
|---|---|---|
| `fileUploadsEnabled` | `true` | 关闭后不公布上传能力，拒绝上传和含文件消息 |
| `fileUploadMaxBytes` | 512 MiB | 单文件解码后大小上限 |
| `fileUploadChunkBytes` | 256 KiB | 单块解码后字节上限，实际值还受 maxPayloadBytes 约束 |
| `fileUploadMaxTransfers` | 4 | 全网关活动上传上限，包含尚未完成的 open 与 Host 提交 |
| `fileUploadIdleMs` | 120000 | 空闲传输和完成结果缓存的保留时间 |
| `fileUploadCommitTimeoutMs` | 180000 | 会话查询和 Host 附件提交的单次超时 |

上传开关与 `fileDownloadsEnabled` 独立。手机只需现有 `/ws/mobile` 可达，Cloudflare Quick、命名 Tunnel 和 LAN 入口无需新增 HTTP 路由。网关为每个活动上传使用私有暂存目录，磁盘预算需考虑并发数乘单文件上限，以及官方存储提交时可能同时存在的副本。

## App 实施顺序与验收

KMM 共享层新增上传 DTO、按 requestId 分发的请求协调器、草稿附件 reducer 和有界队列；平台层负责系统文件选择、私有副本、后台摘要计算和文件流读取，UI 订阅共享状态。不要在主线程做文件复制、SHA-256 或 Base64 编码，也不要把每块数据长期存进状态流。

Android 可使用系统文档选择器和 ContentResolver 流，iOS 可使用文档选择器并在授权访问期间复制到私有目录；两端都应保留原始显示文件名、真实字节长度，以及可重新读取的草稿副本。UI 展示“上传中、处理中、可发送、失败重试、取消”，移除附件时主动取消活动上传。

客户端验收应包含：

- PDF、Word、ZIP、音频及含 NUL 的二进制数据上传后与原始 SHA-256 一致；零字节文件可完成。
- 超限文件、目录路径文件名、错误摘要、错误偏移和非法 Base64 得到可处理错误。
- 纯文件、文件加文字、图片加文件加文字均能发送；历史恢复与实时消息展示一致。
- 切 Session、切网关、断线和取消时旧任务不能污染新草稿；另一个 socket 不能操作原 uploadId。
- 跨 Session 凭证被 Host 拒绝；同一次消息重试沿用 requestId，不重复进入队列。
- finish 回执丢失时可在原连接缓存有效期内重试；其余未知进度情况从头重传。
- 最多并发上传数、空闲回收、磁盘写入失败和 Host 取消不会留下仍占用的传输名额。
- 上传成功不会自动发送给 Agent；App 必须等用户执行发送。

自动验证入口：`npm test` 包含上传单元测试和真实 WebSocket 的鉴权、通道分流、上传到消息与实时文件引用测试。可选官方契约测试使用实际 DSH 流式路由、附件存储、凭证解析及 prompt 准入，所有数据位于测试临时目录：

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/file-upload-official.test.mjs
```

代码入口：[上传管理器](../lib/file-upload.mjs)、[Host Adapter](../lib/dsh-host-adapter.mjs)、[消息与 WebSocket 接入](../lib/index.mjs)。这次不修改 App 页面，也不发布 npm；客户端完成后还需在设备上验证文件选择、后台编码、进度、取消和卡片展示。
