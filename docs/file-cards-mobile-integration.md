# 移动端文件卡片、正文引用与预览接入

基于本机 DSH `0.2.0-rc.2` 和当前 `dsh-mobile` 代码检查，2026-10-15。

## 数据来源与网关调整

截图中的两个入口来源不同，但应共用一个移动端文件打开流程：

| 入口 | 数据来源 | 移动端行为 |
| --- | --- | --- |
| 回复底部文件卡片 | `present` 成功后产生的持久事件 `deliverables/presented` | 按本轮交付的文件列表渲染图标、文件名和描述 |
| 正文蓝色文件名 | Markdown 文件链接 | 拦截文件链接，交给文件打开流程 |
| 正文行内代码文件路径 | 桌面端用本轮产生或交付的文件集合匹配行内代码 | 仅对已知路径或唯一匹配文件名提供点击预览 |

上游事件结构已经存在，不需要增加 `ContentBlock.type = file`，也不应拿只支持图片的 `attachment` 接口读取 PDF：

```json
{
  "type": "deliverables/presented",
  "seq": 42,
  "time": 1786937352,
  "data": {
    "turn": 3,
    "callId": "present-1",
    "files": [{ "path": "build/三亚国庆旅游攻略.pdf", "description": "A4 共 8 页" }]
  }
}
```

上游 `@deepseek-ai/dsh-tool-present/lib/types/types.d.ts` 定义上述数据；工具实现只在成功后追加事件。`@deepseek-ai/dsh-client-ui-deliverables` 将交付结果归到对应 `turn` 的回复末尾，并匹配正文文件引用。它的 `/api/present.open` 是让**主机桌面**打开文件的接口，不能当作移动端预览接口。

本次网关实现：

1. `lib/index.mjs` 的 `buildWireEvent` 保留实时事件的 `turn/callId/files`。原实现落入默认分支，只返回事件类型。历史和 opening snapshot 原本就保留该事件，无须转换历史格式。
2. 新增能力 `file-references-v1`，保持 WebSocket `protocol: 3`、`historyFormatVersion: 4`。
3. 新增控制请求 `file-resolve`，将工作目录内的相对路径或主机原生绝对路径转换为现有下载协议需要的相对路径，并返回文件元数据。
4. 文件读取继续使用 `file-download-open/read/cancel`，保留分块、取消、连接归属及最终 SHA-256 校验。

卡片只保证声明时文件存在，文件内容没有被快照保存。路径越界、文件删除或文件过大时应显示可恢复的错误，不能用任意绝对路径下载绕过工作目录限制。

## App 共享层改动

下面路径均相对于 `dsh-mobile` 仓库。本次未修改 App 代码。

| 位置 | 改动 |
| --- | --- |
| `shared/.../protocol/GatewayDtos.kt` | 增加 `PresentedFile(path, description?)`；`GatewayEvent` 增加 `files`；`RawSessionEvent.normalizedEvent()` 显式处理 `deliverables/presented`，保留 `turn/callId/files` |
| `shared/.../protocol/GatewayWireDecoder.kt` | 确认新事件和 `file-resolved` 可解码；文件元数据复用已有 frame 字段，补齐缺失字段 |
| `shared/.../projection/ConversationProjection.kt` | 按会话与 `turn` 收集交付文件，产出本轮回复下方的卡片数据；同时更新原生桥接使用的快照模型 |
| `shared/.../gateway/GatewayProtocol.kt` | 增加 `fileResolve(sessionId, path, requestId)` 请求，走控制连接；读取 `hello.capabilities` |
| `shared/.../facade/SharedWorkspaceFileStore.kt` | 增加解析阶段及其请求关联；收到 `file-resolved` 后调用已有 `download`，purpose 使用 `preview` |

实时事件读取 `frame.event.files`，历史读取 `raw.data.files`，两者最终必须进入同一数据模型。只修改实时 DTO 会导致重新进入会话后卡片消失；只修改历史映射会导致文件生成后不能立即显示。

事件按 `gatewayId + sessionId + seq` 幂等合并。同一事件内卡片以 `seq + index` 标识；同一轮重复交付同一原始路径时可以更新描述，保持首次出现顺序。对历史分页中暂时缺少对应 assistant 的交付事件先保留，后续合并时挂载，不能丢弃。不要改变持久化事件 seq 或把卡片存为新的 assistant 文本消息。

统一打开流程应显式携带 `gatewayId/sessionId`，不能在异步回调中重新读取当前选中会话。现有 Android `openWorkspaceFile` 从 `snapshot.selectedSessionId` 取会话，需要改为接受来源会话，并在来源网关失效或会话切换时正确取消/丢弃回调。

## 卡片与链接统一打开流程

```text
卡片 / Markdown 文件链接 / 已知行内文件引用
  → openConversationFile(gatewayId, sessionId, sourcePath)
  → control: file-resolve(requestId, sessionId, path)
  ← file-resolved(path, name, mediaType, size, modifiedAt)
  → 原有 file-download-open/read
  → 临时文件落盘、长度与 SHA-256 校验、原子提交
  → 展示应用内预览
```

`file-resolve` 的完整 JSON 示例与错误码见仓库根目录 `PROTOCOL.md` 的“文件卡片与正文文件引用”。解析不需要先遍历目录，因此文件位于 `build/` 下时也可以直接打开。

正文链接处理规则：

- 使用 Markdown 解析器返回的链接目标，不扫描整段文本；解析 `<...>`、中文和空格，URL 编码仅解码一次，保留真正文件名中的特殊字符。
- 相对文件路径和主机绝对路径走解析接口。明确的 `file://` 链接仅提取合法本地路径后交给网关，绝不能在手机本地直接打开主机路径。Windows 主机的盘符/UNC 路径不能误判为普通 URI scheme。
- `https://` / `http://` 继续作为网页处理。其他 scheme 按 App 已有白名单处理。`dsh-resource://` 属于上游另一套资源地址，当前新增接口不接收；如需支持，须先实现明确的地址语法和会话范围校验，不能当作普通路径。
- 只分离已识别的源码行号片段，例如 `#L24`、`#L24-L30`；它不是文件名的一部分。不要无条件剥离文件名中的 `#`。
- 行内代码优先精确匹配本轮已知路径。仅当 basename 在本轮唯一时才允许缩写匹配；歧义或未知文本维持普通代码样式。不要使每个包含 `.pdf` 的代码字符串都变成文件卡片。

缓存应隔离 `gatewayId + sessionId + canonicalPath`，结合解析返回的 `modifiedAt/size` 判断是否需要重取；下载的最终 SHA-256 用于确认传输完整性。元数据不能保证跨时间内容不变，不能只凭旧路径缓存永远打开旧文件。长文件下载进度与取消由现有下载状态机提供，Base64 不进入聊天消息模型。

## Android 接入

`androidApp/.../ui/DshMarkdownText.kt` 当前用 Markwon 渲染，尚无传入聊天文件打开器的入口。增加文件链接回调，并在 Markwon 的链接处理层区分网页和文件目标。需要将当前 `gatewayId/sessionId` 安全地传到回调；列表复用时更新回调，避免使用旧消息的会话。

聊天消息/本轮回复组件增加文件卡片，文件名来自路径 basename，描述使用 `description`。大小可在解析后显示；“共 8 页”目前只是描述文字，没有独立 `pageCount` 协议字段，不应伪造。点击卡片与正文链接走同一个打开器。

`androidApp/.../ui/WorkspaceFilesUi.kt` 已有下载完成监听：代码类文件应用内预览，PDF 等其他文件通过 `ACTION_VIEW` 外部打开。应把下载完成处理和预览承载从文件列表弹层提取到可供聊天页调用的位置，避免聊天页下载成功却没有监听器展示预览，也避免重复监听造成重复弹窗。

要满足截图 PDF 的“直接弹出预览”，增加应用内 PDF 弹层或页面，可基于系统 [PdfRenderer](https://developer.android.com/reference/android/graphics/pdf/PdfRenderer) 对本地文件分页渲染。渲染放在后台执行，限制页面位图缓存，离开页面释放页、renderer 和文件描述符；大文档不要一次渲染全部页面。保留“另存为/用其他应用打开”作为辅助操作。其他不支持的文件显示下载/外部打开选项；聊天文件预览不应自动触发 APK 安装流程。

## iOS 接入

`DeepSeekHarnessMobile/Views/ConversationView.swift` 的 `MarkdownContent` 使用 MarkdownUI。通过链接打开处理拦截本地文件引用并交给统一打开器；已知行内代码引用需要在解析/渲染层匹配，普通 `openURL` 处理不会自动让代码片段变成链接。

`DeepSeekHarnessMobile/Views/RootView.swift` 已有 `WorkspaceQuickLookPreview`、下载结果和预览绑定。将其提取为共享预览组件，并在聊天页可以触达的层级展示 sheet；无需重写已有 [QLPreviewController](https://developer.apple.com/documentation/quicklook/qlpreviewcontroller) 桥接。共享层新增卡片模型后，同步更新 Swift 原生桥接和会话渲染快照，否则 Kotlin DTO 有数据而 Swift UI 仍然看不到卡片。

## 兼容与验收

不支持 `file-references-v1` 的旧网关，可对已确认安全的相对路径复用原有文件下载；对于无法解析的绝对路径给出升级提示。上游未调用 `present` 时，不自动把所有 Markdown 链接生成底部卡片，正文文件链接仍可以单独预览。

网关自动化覆盖历史事件保留、实时字段、解析元数据、中文/空格、相对/绝对路径、目录、缺失、越界、符号链接和原有分块 SHA-256 下载。App 实现后需要补充：

1. 实时产生 PDF 后立即出现卡片，历史重入、重连、分页和多网关同名文件不会丢失或重复。
2. 卡片、正文链接及已知行内代码路径均可打开同一 PDF，手机没有外部 PDF 阅读器时仍可预览。
3. 多个文件、同 basename 不同目录、多个回合时归属正确。
4. 下载中切换会话/网关、断线或关闭预览时无跨会话弹窗、残留临时文件及重复监听。
5. 文件修改/删除、超限、越界、校验失败时显示真实错误，允许重试或取消。

本次自动化使用模拟 rc.2 Host 和真实本地 WebSocket；尚未完成真实桌面 DSH 到移动 App 的端到端联调。
