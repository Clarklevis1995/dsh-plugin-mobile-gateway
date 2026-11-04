# 生图插件图片：网关实现与移动端适配方案

检查日期：2026-11-04。本机安装的 `dsh-image-gen` 为 `0.10.2`；基于当前网关及相邻 `dsh-mobile` 仓库检查。本次修改网关，移动端代码尚未修改。

## 结论与原因

可以由网关提供图片数据，但 App 必须同时接入工具图片展示。仅开启插件或升级网关，现有 App 仍不会自动显示图片。

`dsh-image-gen` 的生成/编辑工具将图片保存到 DSH 的附件库，返回 `{ type: "image", attachment: ... }`，并为普通工具调用记录 `data.meta.kind = "dsh-image-gen"`（批量为 `dsh-image-gen-batch`）。桌面插件注册 `dsh-image-result` 会话节点，从工具结果或 PTC 子调用生成独立图片行。截图中的本地保存路径是额外的工作目录副本，不是移动端的图片地址。

旧网关的 `buildWireEvent` 在 `tool/result` 中只提取文字；`tool/ptc-dispatch` 和 `tool/code-dispatch` 走默认分支，只留下类型。App 的历史 `RawSessionEvent.normalizedEvent()`、共享会话投影也没有把工具图片送到聊天展示层。两侧都需要补齐。

这些结论来自本机插件的 `lib/index.js` 中 `imageOutput`、`saveGenerated`，`lib/client.js` 中 `imageResultsFromMeta`、`imageResultsFromPtcDispatch`，以及官方 `dsh-api-session-controller` 的 `attachment`、`referencedImage` 实现。

## 已实现的网关协议

- `hello.capabilities` 增加 `tool-result-images-v1`，继续使用 `protocol: 3`、`historyFormatVersion: 4`。
- 普通 `tool/result` 转发 `event.images`，支持直接图片块、嵌套 `tool-result` 图片块，以及插件的单图/批量元数据引用。
- `tool/ptc-dispatch`、`tool/code-dispatch` 转发图片、调用关系、参数、错误状态及限制长度后的文字 `output/outputTruncated`。不要求工具名为 `generate_image`，因此其他返回标准图片附件的工具也能复用。
- `view: "conversation"` 的历史及 opening snapshot 为上述事件补充 `data.images`；原始图片块仍保留。没有 `view` 的原始历史维持原格式，客户端必须能解析原始图片块。
- 引用按附件 ID 在一个事件内去重，仅传递 PNG/JPEG/WebP/GIF 的有效附件元数据。不会扫描工具文字里的文件路径，不转发图片 Base64、任意 URL 或主机文件读取地址。
- 整体失败的工具结果不生成成功图片引用。批次中成功图片块与单项失败文字可以共存；若上游把整个批次标为失败，则不自动展示成功卡片。

实时帧示例：

```json
{
  "kind": "event",
  "sessionId": "s1",
  "seq": 42,
  "time": 1793779200,
  "event": {
    "type": "tool/result",
    "turn": 3,
    "step": 0,
    "callId": "generate-1",
    "isError": false,
    "images": [{
      "attachmentId": "sha256:<digest>",
      "mediaType": "image/png",
      "bytes": 1234567,
      "width": 1536,
      "height": 1024,
      "name": "generated-image"
    }]
  }
}
```

手机仍通过**控制连接**请求图片，无需新增 HTTP 路由：

```json
{ "type": "attachment", "sessionId": "s1", "attachmentId": "sha256:<digest>" }
```

```json
{
  "kind": "attachment",
  "sessionId": "s1",
  "attachment": {
    "attachmentId": "sha256:<digest>", "mediaType": "image/png",
    "bytes": 1234567, "width": 1536, "height": 1024
  },
  "data": "<base64>"
}
```

接口不新增 `requestId` 契约；沿用当前按会话与附件关联响应的方式。官方 Host 从会话持久日志中查找引用后读取附件，未引用的图片返回 `session/attachment-invalid`。不能直接通过桌面插件 `/plugins/dsh-image-gen/image` 路由或截图中的绝对路径取图，也不需要开放附件目录。

**授权边界**：本机官方 Host 已确认支持直接 `tool/result.message.content` 和 `tool/ptc-dispatch.content` 的图片引用。只有元数据或嵌套图片块的第三方结果可能被官方接口拒绝；网关提取到引用并不扩大 Host 的授权范围。`tool/code-dispatch` 做兼容转发，但当前本机 Host 的引用查找分支没有该名称；需要上游同时支持，或会话中另有同一附件的合法引用。不要用直接读磁盘绕过此错误。现有 `attachment` 请求只使用普通 `sessionId`；子智能体独立会话的附件访问需另行确认上游接口支持后扩展，不能把父会话 ID 当作任意子会话附件的授权。

## 移动端共享层

以下路径相对于 `dsh-mobile`，建议按顺序实现。

| 位置 | 改动 |
| --- | --- |
| `shared/.../protocol/GatewayDtos.kt` | `GatewayEvent` 已有 `images`。历史归一化的 `tool/result`、`tool/ptc-dispatch`、`tool/code-dispatch` 补齐图片读取。优先用 `data.images`；无字段时从标准原始内容提取，插件 meta 作为兼容来源。沿用 `GatewayImageAttachment`，保持失败过滤与事件内去重规则 |
| `shared/.../protocol/GatewayWireDecoder.kt` | 确认实时工具事件的 `images` 进入 DTO，未知可选字段不导致整帧失败；读取 capability |
| `shared/.../projection/ConversationProjection.kt` | 当前 `tool/result` 只产生文字 `TOOL_RESULT`。增加独立的图片展示项（例如 `GENERATED_IMAGES`），与工具日志共存，并在实时与历史路径中使用同一规则 |
| `shared/.../gateway/GatewayProtocol.kt` | 复用现有 `attachment(sessionId, attachmentId)`，不发送主机路径、不要求额外文件下载能力 |
| 共享快照/原生桥接 | 新展示项、图片引用列表必须进入 Android 与 Swift 使用的快照；不能只改 Kotlin DTO |

图片展示项应在生成事件的位置出现，工具过程折叠后仍可见。可用 `gatewayId + sessionId + seq + "images"` 作为展示项标识，同事件内保持图片顺序。不伪造新的持久事件 seq，也不把工具输出改成助手正文。

普通调用可用 `turn/callId` 定位；PTC 子调用可能没有 `turn`，需要根据 `rootCallId/parentCallId/subCallId` 关联已有工具调用，或先按事件顺序独立展示，待更早分页到达后补充归属。不能因为缺少 `turn` 丢弃图片。实时、opening snapshot、重连和分页按来源会话与 seq 幂等合并。

`run_code` 有时还会将同一图片作为 `source.kind = "tool"` 的后续用户消息注入上下文。避免在工具图片行和该内部注入消息重复渲染：关联相同附件和调用，优先展示工具结果；保留真实用户上传的同图消息，不要按整个会话的附件 ID 全局删重。工具事件暂缺时保留后续注入图片，历史补齐后再合并。

## Android

`androidApp/.../ui/ConversationDisplayGroups.kt` 会把过程项归入工具折叠区。独立图片展示项应成为单独的 timeline entry，并提供 `images`，使 `ConversationScreen.kt` 当前可见附件收集与加载逻辑可以触发下载。只给 `TOOL_RESULT` 填 `images` 仍可能因过程分组而看不到。

复用现有 `attachmentThumbnails/attachmentStates` 和 `ConversationImagePreviewRequest`、图片预览弹层：按比例显示缩略图，加载失败提供重试，点击进入多图预览。生图通常尺寸更大，后台解码时按显示尺寸采样并限制缓存；关闭预览释放大位图，列表状态不存 Base64。

## iOS

在共享快照转换为 Swift 会话条目的桥接处增加图片展示项，在 `DeepSeekHarnessMobile/Views/ConversationView.swift` 及其 timeline 组件渲染独立图片行。复用已有 `store.imageData(for:)` 和附件加载/预览流程。确保图片行未归入可折叠工具过程，且无助手文字时也能出现。

两端缓存及下载任务均应隔离 `gatewayId + sessionId + attachmentId`。异步回调使用图片来源会话，不能重新读取当前选中会话；切换网关、断线或离开页面时取消或丢弃失效结果。图片读取失败要展示实际错误与重试，不把电脑路径当作手机本地路径打开。

## 开启、兼容与验收

在 DSH 插件管理中开启并配置好 `dsh-image-gen`；移动网关运行上述版本，App 实现该适配后，生成结果通过标准会话事件自动出现。无需在手机执行桌面插件的 JavaScript，也无需读取或下发图片服务 API Key。插件关闭后不再产生新结果，历史引用仍可读取（前提是附件库未清理）。

这提供的是“标准图片附件输出”能力；插件自带画布、画廊、配置 UI 或任意自定义会话节点不会自动变成移动端 UI。只有远程 URL/Base64 而没有持久附件引用的插件，需要先在上游转换为 DSH 附件。

旧网关没有 capability 时，App 可从历史原始工具内容提取已有图片引用；实时字段可能缺失，应提示升级以获得完整实时支持。App 不应因 capability 缺失而拒绝原有用户/助手图片。

网关已验证：提取规则、批量去重、失败过滤、实时普通/PTC/code 图片字段、历史 conversation 图片保留、附件读取回归；独立官方契约测试使用临时真实附件存储，验证普通工具/PTC 图片读取成功及跨会话读取被拒绝。执行方式：

```sh
npm test
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/tool-images-official.test.mjs
```

App 完成后验收：

1. 普通生成、编辑、多图及 `run_code` 子调用均立即出图，折叠工具过程后仍可见，无助手正文也正常。
2. 关闭工作目录保存后仍可看图；无需开启文件下载，说明使用的是附件库。
3. 重新进入、重连、历史分页和同图内部上下文注入不重复展示，不丢失图片。
4. Android/iOS 均可加载、失败重试和全屏预览；大图滚动无明显卡顿或内存失控。
5. 多网关同会话 ID、切换会话、并发加载不串图；附件缺失/不被授权时展示真实错误。

本次未进行真实生图服务到移动 App 的端到端联调，未安装或重启正在运行的网关。
