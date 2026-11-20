# Bot 模式通信接入

本扩展由独立 Worktree 开发，尚未发布。网关支持声明为 `bot-v1`；它表示网关能够桥接 Bot API，不保证主机已安装或启用 DS-Bot。客户端进入模式后调用 `hello` 检查插件版本与能力。

## 宿主与鉴权

固定调用 `connection.createSharedFetchHandler('/api')`，使用网关由宿主创建的 owner Peer。请求只能到 `/api/bot`，实时订阅只能到 `/api/bot/feed`。无需浏览器 Cookie，也不向 LAN/Cloudflare 暴露额外 HTTP 接口。Bot 请求只接受已配对设备，在 split transport 中归属 control 通道；普通问答的 conversation 订阅保持独立。

## 请求与回执

```json
{"type":"bot-call","requestId":"bot-1","endpoint":"hello","payload":{"api":[1]}}
{"kind":"bot-result","requestId":"bot-1","endpoint":"hello","value":{"api":1}}
```

`requestId` 为 1–128 字符的字母、数字、点、下划线、冒号或连字符。接口名采用明确白名单，主机手机配对、密钥管理、插件安装和任意 URL 代理均不可调用。通过 `hello` 检查双方 API 交集；本适配支持 API 1。`state` 会去掉仅应留在主机配对界面的 `phone` 字段。

读取接口包括 `hello`、`state`、`chat`、`room-chat`、`notices`、`avatar`、`image`、`markdown-image`、`file-text`、`memory-view`、`memory-history`、`usage-summary`、`schedules`、`run-stats`。写入接口包括 `send`、`stage-image`、`stop-chat`、`stop-member-work`、`stop-room-work`、`answer-question`、`view-reply`、`approval-answer`、`memory-add`、`memory-edit`、`memory-forget`、`schedule-create`、`schedule-delete`。

失败使用既有 `kind:error`，带回 requestType、requestId、code 和 message。主机未装插件返回 `bot-unavailable`；API 无交集返回 `bot-version-unsupported`。有效的插件拒绝码透传，例如 `bot/stale`、`bot/read-only`。

## 实时订阅

```json
{"type":"bot-subscribe","requestId":"bot-2"}
{"kind":"bot-subscribed","requestId":"bot-2","subscriptionId":"bot-2","hello":{}}
{"kind":"bot-event","subscriptionId":"bot-2","botEvent":"message","botData":{}}
{"type":"bot-unsubscribe","requestId":"bot-3"}
{"kind":"bot-subscribed","requestId":"bot-3","subscriptionId":null}
```

每条设备连接最多一个 Bot 订阅。回执先于事件；替换、取消或设备断线会释放上游 reader，旧订阅不得污染新订阅。流结束或解析失败时返回 `bot-stream-reset`，客户端进行有界退避、重新订阅并对账。

`botEvent` 和 `botData` 分别承载 DS-Bot 的原始事件名称与对象；不能使用普通会话协议已有的 `event` 与 `data`，它们分别被定义为会话对象和附件字符串。支持 `hello/revision/live/message/stream/notice/room`，未知事件跳过。

## 同步规则

- 私聊历史调用 `chat`，群聊历史调用 `room-chat`；分页 cursor 为不透明对象，原样传回。
- `stream` 用 attemptId 关联临时气泡；最终落盘消息以历史读取结果为准。
- 同一个私聊事件的 seq 可能含多个文本块，不能只按 seq 去重；必须包含会话分段、kind 与块顺序。
- 读取历史期间发生消息变更时，完成后再读取一次最新页；不可用较早响应覆盖后来的状态。
- `revision/live` 合并刷新 state；`room` 合并刷新群聊最新页，群聊不保证具有与私聊相同的逐字流。
- 重连后用 boot/seq 和 notices 定位变化，再刷新 state 与相关聊天。notices 仅为内存中最近 200 条提醒，不是消息存储。boot 变化或 reset 时重新对账。
- `send` 不保证客户端幂等。超时或断线不能直接自动重发；客户端保留“发送状态待确认”，同步历史后核对。网关不会重试上游写调用。本版本不声称跨主机重启的 exactly-once 发送。
- 配对只保证访问授权；后台可靠通知仍需另行实现系统推送，不能以无限长连接作为 iOS 后台保证。

## 边界与验证

HTTP 请求与响应、单个 SSE 事件均限制为 4 MiB；调用超时 30 秒，取消信号沿用宿主和设备连接生命周期。图片通过以下分块方式传输，不提高 JSON 限制；附带文件的用户消息通过普通会话的分块上传与提交入口。

单元测试：`node --test test/bot-bridge.test.mjs test/bot-images.test.mjs`。

真实宿主验证：在临时 DSH_HOME 中使用 DS-Bot 与本 Worktree 网关，显式隔离 deviceFile/gatewayStateFile/cloudflareStateFile，监听 3098；然后运行：

```sh
DSH_BOT_PROBE_URL=http://127.0.0.1:3098 node scripts/bot-live-probe.mjs
```

脚本仅配对、读取团队和 Chief 历史、订阅真实 SSE、验证长期凭据重连后历史一致；只输出计数和版本，不输出正文或凭据。当前已用 DSH 0.2.2-rc.3 / DS-Bot 0.3.6 验证 2 个 Bot、1 个群聊和 13 条 Chief 历史条目。


消息端到端验证可额外设置 `DSH_BOT_PROBE_SEND=1`。该模式会在隔离实例发送测试文本，断言真实流式片段、落盘消息与重连后的历史一致。请使用确定性本地模型，避免测试依赖外部服务。


## Agent 图片：不修改 DS-Bot

用户安装官方 DS-Bot 与本网关即可，不再依赖 `feat/mobile-agent-images`。兼容层在 `lib/bot-images.mjs`；它只调用注入的官方会话、附件和工作区文件能力。DSH Remote 接口名称继续集中在 `dsh-host-adapter.mjs`。不读取 DS-Bot 的内部 state.json、私有运行时或任意本机文件，也不修改官方插件。

`hello` 的 `agent-image-refs/image-chunks/markdown-image` 是本网关追加的能力声明，同时提供 `imageBridge={provider:mobile-gateway,agentImageScopes:[private-chat],maxBytes:16777216}`，不能据此声称官方 DS-Bot 自带这些扩展。

- 私聊：公开 state 决定会话分段、后台会话和隐藏交流轮次；从普通会话历史补充 assistant/tool 图片引用，支持无文字图片回复。图片保留原始会话。最多向前查八页定位当前轮次，无法确定的内部图片不输出。
- 群聊：只补充群自身会话中能精确匹配公开行的图片；保留上游已经公开的引用与 Markdown 正文。官方公开 API 尚缺群成员图片与公开发言的稳定来源映射，**群成员结构化图片补充尚未完整支持**。不扫描成员内部会话猜测发言者。
- 字节：`image` 复用普通模式 `sessions.attachment`，先从历史找到完整引用，再调用官方附件接口；`markdown-image` 复用相同的 `files.stat/readBytes` 和当前会话工作区权限。
- 实时：每条设备连接独立跟踪当前聊天的官方 session/follow，只发重新读取通知。公开 state / revision 会更新当前会话，切换、取消和断线释放旧监听；不同设备互不覆盖。群成员内部原始事件不推给客户端。

两类图片端点都从 `offset:0` 开始，每块最多 384 KiB，返回 `{mime,data,offset,nextOffset,size,done,rev}`，`rev` 为图片内容 SHA-256；APP 最大组装 16 MiB。单帧仍为 4 MiB。网关有界内存缓存最多 8 张 / 32 MiB，20 秒有效；即使命中缓存也先验证最新 Bot 会话归属。工作区读取期间版本、总字节数或偏移变化都会失败。读取错误使用 `bot-image-invalid` 或官方权限错误。

`preview:true/false` 兼容现有 APP 调用，但当前返回同一份官方图片字节，不在服务端另外缩图。APP 使用已有图片展示、预览、保存及错误组件。历史和通知只传引用，不携带图片 Base64。

验证命令：

```sh
node --test test/bot-bridge.test.mjs test/bot-images.test.mjs
npm test
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/tool-images-official.test.mjs
DSH_BOT_IMAGE_PROBE_URL=http://127.0.0.1:3097 \
DSH_BOT_IMAGE_PROBE_HOME=/private/tmp/.dsh-test-bot-stock-xxxx \
node scripts/bot-image-live-probe.mjs
```

图片探针只允许本机隔离测试端口与 `.dsh-test-` 目录，测试后清理自己的图片。结构化测试额外设置 `DSH_BOT_IMAGE_PROBE_STRUCTURED=1`，要求隔离 mock 将 `网关图片验证：<path>` 转为官方 `read_image` 工具调用，不能用于真实模型/用户主机。所有 mock 扩展放在仓库外。

2026-11-18 迁移验收：未修改的官方 DS-Bot 0.3.6、0.3.8 均在独立宿主中通过真实配对、Agent Markdown 图片与 7,682,433 字节图片的 20 块精确重组。官方 `read_image` 工具产生的 64×64 结构化图片可通过本网关补充到私聊并触发实时重新读取；图片字节与普通会话附件接口完全一致。官方真实附件存储及跨会话拒绝测试通过。测试日志位于仓库外 `/private/tmp/dsh-bot-stock-*` 和 `/private/tmp/dsh-bot-stable-*`。

网关 Bot 相关 18 项契约测试通过，覆盖隐藏轮次、归档来源、图片分块、多设备隔离、分段切换与重订阅取消。最终网关完整回归通过（包含既有跳过项）；中途一次既有 LAN / Cloudflare 状态等待断言超时，单项与完整回归重跑均通过。APP 共享层 680 项既有测试校验通过（Gradle 增量命中）。


## 角色资料和会话附件

- `state {avatars:"ref"}` 保留官方自定义头像引用，为内置角色外形生成 SVG 内容引用。`avatar` 按相同引用返回图像，APP 按主机保存到本地。
- `role-settings` 增加 `update-bot`、`duplicate-bot`、`set-main`，沿用官方设置、模型、记忆和定时任务接口。模型目录来自团队状态，推理档位由 `efforts` 查询。
- `bot-attachments` 增加 `send-attachments`。APP 使用普通会话的文件分块上传和图片预处理，发送 `{chatId,sessionId,text,images,receipts}`。网关核对当前 Bot 会话和写入权限，复用官方会话提交接口。普通文件继续遵守 `fileUploadsEnabled` 和会话凭证校验。
