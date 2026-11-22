# DSH 0.2.2-rc.5 兼容性评估

评估日期：2026-11-22。以本项目现有 RC.3 适配为起点，检查 RC.4、RC.5 标签增量；插件当前版本 0.12.3，版本准备日期为 2026-11-22。本次不发布 npm，也不升级正在运行的宿主或修改用户配置。

## 结论

当前检查范围内，未发现强制网关或 App 更改现有 RPC 的破坏性变化。存在一项错误码语义变更与一项搜索默认行为变更；依赖固定错误码、搜索端点或计费假设的调用方需要调整。

| 版本增量 | 改动 | 对项目的影响 |
|---|---|---|
| RC.4 | DeepSeek refusal 从 MALFORMED_RESPONSE 改为 CONTENT_REFUSED，保留拒答说明；拒答前消耗仍计入 usage | 网关原有通用错误字段可透传；App 原有通用失败渲染可显示。建议增加专门的拒答文案和回归用例 |
| RC.4 | LiveShare worker 使用宿主 Electron 的 Node 模式启动 | 本项目没有使用官方 LiveShare worker；移动网关现有 Cloudflare/WebSocket/WebRTC 链路无需跟随改动 |
| RC.5 | 未指定 searchProvider 时按模型路由自动选择搜索服务 | 属于配置与行为变化，需检查模型 API 中转部署、计费提示；不改变移动聊天帧 |
| RC.5 | WebSearchRequest 增加可选 llmProvider，官方 web_search 从会话模型请求上下文传递 | 本网关不直接调用 ctx.web.search，无需补参。自己调用该服务的自定义插件要传入模型路由才能得到对应默认搜索 |

累计对比包含 13 个提交。初次 GitHub compare 文件列表达到 300 条截断上限；二次复核已隔离获取两个官方标签，并通过完整 Git 文件树核对全部 448 个修改文件，补查了搜索提供方的源码补丁，消除了此截断盲区。发布过程中大量 package.json 改动是统一升级版本号，不等于业务接口变更。核心 Remote/Session 接口未发现新增源码变化，另以 RC.5 官方发布包验证所用契约。

Session 仍为 format 4，移动端仍使用协议 3 / dsh-mobile-v1。上一轮 RC.3 的成员投影和子代理控制兼容逻辑继续保留。

## 搜索迁移：需要关注的实际行为

没有保存或显式配置 searchProvider 时：

| 模型提供方路由 | 默认搜索 |
|---|---|
| deepseek-official / deepseek-account | deepseek-official，即 DeepSeek 服务端 Messages 搜索 |
| 其他路由，或不服务于模型请求的搜索 | deepseek-search-api |

注意按提供方路由判断，不是按模型名字含有 DeepSeek 判断。已保存的 web.searchProvider、profile 配置和 DSH_WEB_SEARCH_PROVIDER 覆盖自动选择；升级不会自动清除原来固定的 Search API。Fetch 默认仍为 http。

表中列出自动模式的优先提供方，不保证该提供方总能使用：若它不可用而只剩一个其他可用提供方，宿主会使用后者；剩余多个时报 WEB_PROVIDER_AMBIGUOUS，没有可用提供方时报 WEB_PROVIDER_UNAVAILABLE。显式配置的提供方不可用则直接报错，不适用此自动选择规则。搜索结果还改为优先使用来源自带 snippet，缺省时才使用 citation 摘录；移动端现有工具结果无需因此增加新协议。

“服务端搜索不按次收费”不等于完全免费：官方升级指南明确辅助 Messages 请求按模型 token 计费。其他路由上的 Search API 仍可能按请求计费。

### 使用第三方模型 API 中转的部署

这里的“中转”指 DeepSeek 模型 API 代理，不是本项目的手机移动网关。

Messages 搜索端点依次取 web-search-deepseek.baseURL、DEEPSEEK_SEARCH_BASE_URL、官方 https://api.deepseek.com/anthropic/v1；不会自动跟随模型提供方的 Base URL。在账号会话外，凭据来自该搜索提供方的 apiKeyEnv（默认 DEEPSEEK_API_KEY）。仅配置模型中转地址的用户，搜索可能仍发往官方端点并失败。

选择以下一种配置并实际验证，不由本插件擅自改写：

1. 保持自动选择：DeepSeek 路由使用服务端搜索，检查相应端点和凭据。
2. 继续固定 Search API：在宿主「网页搜索与获取」选择 DeepSeek Search API；YAML 配置时按指南一起保留 fetchProvider: http。
3. 通过中转运行 Messages 搜索：为搜索服务另设 Anthropic 兼容的 Base URL（到 /messages 之前），并确认密钥来源。只有需要跨模型自动选择时再切回自动选择。

显式选定的提供方不可用时，不应由 App 静默换提供方或密钥，否则端点和计费可能发生用户未选择的变化。

## App 是否需要更新

对当前 dsh-mobile 代码作了只读检查，本次未修改 App、未运行 App 测试或模拟器。

| 检查位置 | 当前实现 | 结论 |
|---|---|---|
| shared/.../protocol/GatewayDtos.kt | FinishInfo.failure 为开放 JSON；历史保留 finish 与 reasonDetails | 新错误码不会因封闭枚举而解码失败 |
| shared/.../protocol/FailureDetails.kt | 从 message/reason/code/name 提取错误，保留 code | 能显示宿主拒答原因和 CONTENT_REFUSED |
| shared/.../projection/ConversationProjection.kt | assistant/attempt 和失败 turn/end 使用通用错误渲染 | 无需为兼容 RC.5 强制发版；可补充“模型拒绝回答”分类文案 |
| iOS Core/GatewayModels.swift | finish、failure、reasonDetails 保持开放字段 | 没有发现必须随 RC.5 更新的固定错误码限制 |
| App 搜索设置 | 未发现 searchProvider 两值枚举或固定直连 Search API 的实现 | 不需要仅为此次宿主默认值改动修改聊天协议；如以后新增原生搜索设置，必须支持自动选择 |

建议补充的双平台验收：

- refusal 实时失败与重开历史均显示宿主原因，停止生成态，不将其视作网络断线或无限重试。
- 拒答前已有部分输出、usage 时，保留诊断与用量，不显示成功完成，也不把已知用量置零。
- 重连后没有重复重发原请求；历史 assistant/attempt 和 turn/end 不造成重复正文。
- 自动、固定 Search API、固定服务端搜索三种配置，以及第三方模型 API 中转场景，搜索工具结果与网页来源正常显示。

此前 RC.3 的团队 App 适配属于旧基线工作，不应重复说成 RC.5 新增破坏性变更。当前共享层已可见 ownerId、未分配判断和 Team 模式状态逻辑；本轮重点是新错误的失败展示与搜索行为验收。

## 本次网关改动与验证边界

- Host Adapter 的契约基线更新为 0.2.2-rc.5；实际宿主版本仍由运行时探测，不用基线冒充。
- 增加 CONTENT_REFUSED 的 WebSocket 实时转发和精简历史测试，检查 message/code 未被压缩丢失。生产透传逻辑无需另加错误码白名单。
- 二次复核补齐失败 attempt 的用量：宿主失败记录的 usage 仅存在于 stream，原精简历史移除 stream 会丢失它。现从最后一条 usage chunk 提取累计快照，补入实时事件和精简历史的顶层 usage；已有顶层 usage 优先，不相加、不估算缺失用量。App 的共享轨迹投影已读取 event.usage 或 raw.usage，因此该数据修复无需再改手机 RPC。
- 更新当前 README、包描述、协议及版本记录；历史 RC.3 评估保留原有时间与结论。
- 官方契约检查使用隔离安装的 RC.5 包，业务数据为 fixture；不等于真实模型服务、手机 UI 或所有可选插件的端到端认证。

验证结果：

- `npm test` 完整回归通过；其中 WebRTC 子套件 45 项通过、1 项跳过。
- RC.5 官方包的 `agent-team-official`、`host-official`、`dsh-022-official`、`file-upload-official`、`speech-official`、`tool-images-official`、`workspace-changes-official` 共 7 组契约检查通过。
- `rc5-refusal-official` 通过。因官方包未单独导出内部转换器 JS，该项加载发布包附带的 TS 源码，经 Node 自带转换器转译后验证拒答 code、说明及 usage；不是模型服务实测。
- `rc5-search-official` 通过，使用真实 WebRuntime 和内存提供方验证 DeepSeek/其他模型/无模型路由、显式配置优先、首选不可用时的单一候选及多候选歧义；不调用真实搜索。
- 补齐失败用量后再次执行 `npm test` 完整回归通过。实时与精简历史均检查多条累计 usage 只取最后一条；额外检查已存在顶层用量、零值和缺失值。
- `npm pack --dry-run` 确认适配层、错误处理与新评估文档进入发布包；`git diff --check` 通过。

复核同时统一了六份翻译 README 的当前版本说明；历史 Changelog 和 RC.3 专题文档仍保留原版本，不应批量替换这些历史记录。App 真机上的拒答、部分输出与用量显示，以及真实搜索服务连通性，仍属于待验收项，不能由上述 fixture 检查替代。

## 官方依据

- [RC.4 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.4)
- [RC.5 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.5)
- [RC.3 → RC.5 标签对比](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.2.2-rc.3...dsh-v0.2.2-rc.5)
- [拒答错误码升级指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/docs/upgrade-guide/v0.2.2-rc.3/deepseek-refusal-code/guide.zh.md)
- [搜索默认值与中转迁移指南](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.5/docs/upgrade-guide/v0.2.2-rc.4/web-search-deepseek-model-default/guide.zh.md)
- [搜索功能合并提交](https://github.com/deepseek-ai/deepseek-harness/commit/f47a0a2b521d547ee400082c2dfad76aaa49607f)
