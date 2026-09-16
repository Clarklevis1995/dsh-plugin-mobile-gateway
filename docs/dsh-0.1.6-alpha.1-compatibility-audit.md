# DSH 0.1.6-alpha.1 协议兼容性审计

核对日期：2026-09-16。

## 结论

当前 gateway `0.7.5` **不能直接声明完整兼容 DSH `0.1.6-alpha.1`**。确定的主要阻断是权限选择协议拆分：新版会话投影不再包含候选列表，而 gateway 的权限菜单仍依赖该列表，导致读取菜单和通过菜单切换权限均失败。

核心会话、消息提交、历史分页、Assistant 独立流、普通问答和人工审批没有发现本次升级引入的接口阻断。另有默认模式的条件性语义差异、SSH 文件访问缺口、版本误报及新增事件元数据丢失。

本次仅增加审计文档；没有修改生产代码、升级本机 DSH 或迁移用户会话。

## 基线与验证范围

- gateway：提交 `a92a039332bcfa4a1fadc55888e6b7a7e80dfd3d`，版本 `0.7.5`；开始审计时工作区干净。
- 上游：对比官方 `dsh-v0.1.5-rc.2` 与 `dsh-v0.1.6-alpha.1` 两个 tag 的完整源码。
- 发布包：分别下载两版 Session Controller、Workspace Controller、Settings Controller、Commands、Goal、Agent Presets、LLM 共七个包，比较生成的 `typert.host.js`；另外检查新版 Permission Presets 发布包。
- 七组包的旧版 55 个 Remote 端点没有删除；新版增加 `workspace/unarchiveSession`。现有入参 schema 唯一差异为 `session/updateQueue` 的图片块增加可选 `offloaded: true`，没有要求旧调用增加必填参数。此数量不代表 DSH 全部端点；新 Permission Presets 包另提供 `permissionPresets/catalog`。
- 用现有 Host Adapter 测试的真实调用，附加新版发布描述符的参数名与 schema 校验：18 次调用、14 个不同端点通过。
- `npm test` 全部通过，包括 125 项 gateway dispatch 检查、认证配对、LAN、多网关 11 项检查，以及 Host Adapter、Session Follower、Unicode wire、setup 测试。首次运行被沙箱禁止监听端口；允许本地监听后完整运行成功。
- 使用当前生产 `handleQuery()` 配合新版权限投影样例，复现下述权限菜单问题。

验证边界：没有执行新版真实 Host 与手机全流程联调。发布描述符输入验证及旧测试通过，不代表业务行为完整兼容；权限问题恰好说明旧测试夹具可能掩盖新版差异。

官方依据：[发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1)、[版本比较](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.5-rc.2...dsh-v0.1.6-alpha.1)。

## 1. 必须适配：权限目录从会话投影拆出

旧版 `projections.values.permissions`：

```json
{"options":[{"value":"workspace-write","name":"Workspace Write"}],"currentValue":"workspace-write"}
```

新版会话投影只保留：

```json
{"currentValue":"workspace-write"}
```

候选项改从新的进程级目录读取：

```js
typertGateway.invoke({
  namespace: 'permissionPresets',
  method: 'catalog',
  args: {},
})
// 返回 { options: [{ value, name, description? }] }
```

源码在 `packages/interaction/permission-presets/src/index.ts` 注册的投影视图明确只有 `currentValue`；这不是单纯的类型重命名。新版 `auto` 由运行中的 Auto review 插件动态贡献，不属于默认权限设置中的静态候选表。`custom` 是派生的当前状态，不是可切换候选项。

gateway 受影响位置：

- `lib/index.mjs:1211` 的 `loadCommandOptions()` 强制要求 `permissions.options`。
- `lib/index.mjs:1245` 的 `selectCommandOption()` 先查询上述菜单，因此写入前就失败。
- `lib/index.mjs:1629` 的旧 `permission-options` 接口直接透传投影，新版返回值不再包含 `sessionPermissions.options`；它读取的 settings namespace 也无法补全动态 Auto 候选。

生产函数复现结果：

| 请求 | 当前结果 |
|---|---|
| `command-options`，`command=permission` | `command-options-unavailable` |
| `command-select`，`command=permission` | 同样失败，尚未执行写入；还沿用 `requestType=command-options` |
| `permission-options` | 成功，但 `sessionPermissions` 只剩 `currentValue` |
| 直接 `permission`，明确传入有效名称 | 可到达原有 `/permission` 执行入口；没有被菜单前置检查阻断 |

建议：Host Adapter 增加权限目录查询，将 catalog 的候选项与会话投影的 `currentValue` 合成现有移动菜单和兼容响应。保留 `/permission` 写入路径；动态目录需在使用前刷新，若缓存则处理 `permission-presets/catalog-changed`。会话 Auto 选项不能写成全局默认权限。

这可以在 gateway 内适配，现有 `command-options` / `command-select` 移动消息形状可继续使用。若 App 自行解析历史中的权限投影，则也需要核对其是否依赖旧 `options` 字段。

依据：[权限类型变更](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/interaction/permission-presets/src/types.ts)、[权限目录与投影实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/interaction/permission-presets/src/index.ts)。

## 2. 条件性不一致与元数据缺口

| 项目 | 新版变化及当前影响 | 建议 |
|---|---|---|
| 默认 Agent 模式 | 增加 `modeSelectionEnabled`。为 false 时，Host 对未指定 preset 的新会话使用配置默认值，忽略保存的用户默认值。gateway 的 `defaults` 仍返回 settings 中保存的 `default`；`set-default` 返回 `applied: true` 也不代表后续新会话采用该值 | 查询有效默认值时结合 `agentPresets/list` 的 `isDefault` 和 `modeSelectionEnabled`；区分已保存与实际生效。`agent-presets` 原始响应已经透传新字段 |
| SSH 工作区 | 新版文件/进程可通过 SSH provider 操作远端。gateway `resolveSessionRoot()`、文件列表、下载及目录操作仍使用本机 `node:fs` | 启用 SSH provider 的部署不应宣称文件功能兼容；接入 Host 文件能力或明确禁用。远端路径本机不存在会失败，同名本机路径存在时可能访问错误目录。普通本地工作区不受此项影响 |
| 宿主版本误报 | `lib/dsh-host-adapter.mjs:16` 将 `DSH_VERSION` 写死为 `0.1.5-rc.2`；`host.describe` 和 `hello` 均使用该值 | 改为真实宿主版本或明确的兼容目标字段。这不是运行时版本拒绝逻辑，但会误导诊断/版本判断 |
| `image/offload` | 新增持久事件，`data.targets` 包含消息 `seq` 和 `imageIndexes`。gateway 接受其真实序号，历史保留原始数据；实时 `buildWireEvent()` 的默认分支只发事件类型，丢弃 targets | 基础聊天不因未知类型直接中断，但实时 offload 语义缺失；需要展示模型实际保留的图片上下文时补齐映射 |
| Auto review 拒绝原因 | `tool/result.data.error` 增加可选 `reason`，位于模型消息之外。实时映射只保留 `isError` 和模型内容 preview，丢失结构化错误名、代码和原始原因 | 保留必要的 error 元信息。历史仍保留这些数据，实时展示存在缺口 |

Auto review 使用 `tools/pre-execute` 的自动决策入口。普通 `approval/request` / `user-questions/request` 的签名及回答形状没有改变，不能据此把所有审批流判定为失效。

依据：[默认模式选择策略](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/preset/agent-presets/src/index.ts)、[SSH 文件系统提供方](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/ssh/fs-ssh/README.zh.md)、[image/offload 定义](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/compaction/compaction-image-offload/src/projection.ts)、[Session 工具错误定义](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/core/session/src/types.ts)、[Auto review 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/experimental/auto-review/src/index.ts)。

## 3. 保持兼容或仅增加能力的部分

| 范围 | 核对结果 |
|---|---|
| 会话格式 | `SESSION_FORMAT_VERSION` 仍为 3。本次没有 rc.2 那次跨格式的历史游标迁移；不要把 DSH 软件版本、Session 格式和移动握手值混为一谈 |
| 会话读取和控制 | `session/list` 仍使用 `{ _request: {} }`；`follow/page/control` 入参保持不变。Assistant 的快照及 `start/chunk/end` 协定保持不变 |
| 消息、命令、队列 | prompt 原有文字和图片结构仍有效；命令仍使用 `submittedAttachments`；队列图片块新增可选 `offloaded`，现有文字编辑请求不需修改 |
| Session fork | 参数不变，切点改为所选边界 `seq + 1`，不再继续带入下次 `turn/start` 前的后续输入/设置。这是上游行为修复，gateway 原有 atSeq 转发无需改协议 |
| 工作区归档 | 原有 archive 和归档集合推送保持；增加 `workspace/unarchiveSession({ request: { sessionId } })`。gateway 尚未提供恢复归档请求，但从 Web 恢复后，可通过已有 workspace stream 同步归档集合 |
| Skill / 命令目录 | Skill 增加可选 `path`，CommandDescriptor 增加可选 `definitionId`；当前按名字执行不受影响，移动组合菜单没有保留这两个新元信息 |
| 插件生命周期 | `agent/session-start` 移除，`agent/created` 改为等待完成的异步串行初始化；gateway 不监听这两个事件，不需要修改该 hook |
| 同步 Session 历史 API | `snapshotEvents/eventAt/ownEvents` 是弃用，非本版本全部删除。gateway 通过 Remote follow/page 读取，不直接依赖这些同步 API |
| Host 服务及 Web UI | `typertGateway.invoke/stream`、`agentDefaultModel`、`webServer.register/registerUpgrade` 及当前 sidebar/footer、shell/overlay 集成入口未发现阻断变化 |

依据：[Session Remote 类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/api/session-controller/src/types.ts)、[fork 实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/api/session-controller/src/commands.ts)、[Workspace Controller](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/api/workspace-controller/src/index.ts)、[Agent 生命周期](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/core/agent/src/runtime-types.ts)。

## 4. 模型协议和部署配置变化

DeepSeek 默认由 Chat Completions 改为 Messages，并增加 Files API 图片复用。这发生在 Host 到模型服务之间；gateway 使用 Host 的统一 Session/LLM 数据模型，不需要把移动 WebSocket 改成 Anthropic Messages。

显式配置旧官方根地址的部署，需要移除覆盖或使用 `https://api.deepseek.com/anthropic`；自定义 API 地址会保留，因此要核对其与所选协议是否匹配。否则可能出现手机正常连接、模型请求失败的情况。本次没有读取用户凭据或验证实际模型服务配置。

PTC 包/服务统一改为 `ptc-runtime`、工作流执行器改为 `workflow-ptc`、E2B 移除、Ralph 默认关闭，以及 Sandbox/Shell 异步接口变化，均需使用相关自定义插件或配置的部署另行适配。当前 gateway 没有这些直接依赖，bundle patch 也没有引用这些旧名称。终端、MCP resources、Browser/Computer Use 属于新增能力，不能据此认定当前移动端已经支持。

依据：[DeepSeek 协议默认配置](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.6-alpha.1/packages/llm/llm-deepseek/src/config.ts)、[官方发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.6-alpha.1)。

## 建议顺序

1. 优先修复权限目录适配，覆盖新版只有 `currentValue` 的投影、动态 Auto、派生 custom、菜单查询与选择及兼容接口。
2. 修正宿主版本信息和默认 Agent 模式的有效值语义。
3. 本地工作区完成真实 Host 与 App 的消息、生成中重连、历史分页、fork、权限切换、问答/审批、文件下载及归档同步联调。
4. 单独决定是否接入恢复归档、SSH 文件访问、image/offload 展示和 Auto review 错误详情。

临时证据目录：`/private/tmp/dsh-alpha1-audit/`，含双版本源码、npm 包、`check-contract.mjs`、`schema-deltas.json`、`reproduce-permissions.mjs`、`permission-reproduction.json` 和完整测试日志。临时探针没有改动仓库生产实现或原有测试。
