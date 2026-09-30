# DSH 0.2.0-rc.2 插件管理：DSH Mobile 对接方案

## 范围与入口

网关通过现有 `dsh-mobile-v1` WebSocket 提供与 DSH Web 插件页相同的管理数据和操作。所有请求发往 **control** 连接；单连接旧客户端也可发送。必须使用已配对设备的 token。`hello.capabilities` 包含 `plugin-management-v1` 表示网关认识这些帧，页面仍以 `plugin-catalog.managementAvailable` 判断当前 Host 能否管理插件。网关修改的是其所连接的 DSH profile，不是手机本地插件。

截图中的「添加插件」对应**安装已有插件包**，不是创建源码工程。DSH RC2 的 Host 没有远程生成插件工程的接口；本方案覆盖 Web 插件页的浏览、安装、启停、卸载、配置与诊断，以及 Host 公开的插件条目控制和版本豁免。

## 页面数据

连接后发送：

```json
{"type":"plugin-catalog","requestId":"catalog-1"}
```

成功返回 `kind: plugin-catalog`、相同 `requestId`，以及：

| 字段 | 含义 |
|---|---|
| `managementAvailable` | 当前 Host profile 是否支持插件管理；false 时隐藏写操作 |
| `bundles` | Host `pluginManager/listBundles` 数组；每项额外增加网关计算的 `experimental` 布尔值 |
| `plugins` | Host `pluginManager/listPlugins` 原始数组；用于包内条目及独立条目控制 |
| `officialItems` | Web 的四类内置配置卡片：`shell`、`agent-loop`、`subagent`、`web-search`；每项提供当前可用的 `namespaces` |
| `settingsWritable` | Host 设置是否允许写入 |

按 Web 页面语义展示：先排除 DSH 内置 profile 包 `@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`、`@deepseek-ai/dsh-sdk-app`、`@deepseek-ai/dsh-acp-app`、`@deepseek-ai/dsh-sdk-minimal`，再保留 `installed || optional || error` 的 bundle。其中 `optional && !installed` 放在「官方」，`installed || !optional` 放在「已安装」。内置配置卡片也放在「官方」，但没有包级启停开关，点击进入配置。`bundles` 每行有 `name`、`version?`、`meta?`、`description?`、`enabled`、`installed`、`optional`、`removable`、`readOnlyReason?`、`error?`、`rows`、`overrides`，以及网关追加的 `experimental`。DSH Web 根据包名以 `@deepseek-ai/dsh-experimental-` 开头来生成「实验性」标签；移动端直接用 `experimental: true` 显示本地化标签，不需要自行猜测。显示名称、说明和图标优先取 `meta` 的本地化字段；`meta.title` 和 `meta.description` 可以是文本或带 `en` 回退的语言映射，`meta.icon` 是图片 data URL，不作为 HTML 注入。否则回退到 `description` / `name`。`readOnlyReason` 禁用启停，`removable: false` 仅禁用卸载；官方可选包即使不可卸载仍可启停。不要用 `plugins` 推测一个 bundle 的总开关状态，以 `bundle.enabled` 为准。

`managementAvailable: false` 时返回空目录和 `settingsWritable: false`。所有目录数据属于所连网关的 DSH profile；切换网关后重新请求并按 `gatewayId` 分别缓存。

## 请求与响应

每个插件请求都必须带本次连接内唯一的非空 `requestId`；响应原样带回。成功帧如下，`result` 均为 Host 原始结果，App 不应只凭发送成功就更新开关：

| 请求 `type` | 参数 | 成功 `kind` 与字段 |
|---|---|---|
| `plugin-catalog` | — | `plugin-catalog`：上述目录字段 |
| `plugin-registries` | — | `plugin-registries`：`registry`、`fallbackRegistries`、`resolved` |
| `plugin-inspect` | `spec`, `registry?` | `plugin-inspection`：`result` 为 `accepted` 或 `refused` 的安装前检查 |
| `plugin-install` | `spec`, `enabled?`, `registry?`, `approvedBuilds?` | `plugin-install-result`：`result` 为 `ChangeResult` |
| `plugin-install-status` | `installId` | `plugin-install-status`：`result` 为 `ChangeResult` 或 `null` |
| `plugin-install-cancel` | `installId` | `plugin-install-cancel`：`result.status` 为 `cancelled` / `too-late` / `not-running` |
| `plugin-bundle-set-enabled` | `name`, `enabled` | 同名 `kind`：`result` 为 `ChangeResult` |
| `plugin-entry-set-enabled` | `entryId`, `enabled` | 同名 `kind`：`result` 为 `ChangeResult` |
| `plugin-remove` | `name` | 同名 `kind`：`result` 为 `ChangeResult` |
| `plugin-settings` | `ns?` | 同名 `kind`：不传 `ns` 返回 `writable`、`hasDocument`、`namespaces`；传 `ns` 返回 `writable`、`namespace` |
| `plugin-settings-mutate` | `ns`, `expectedRevision`, `ops` | 同名 `kind`：返回修改后的 namespace 视图 |
| `plugin-version-exemptions` | — | 同名 `kind`：`exemptions`、`warnings` |
| `plugin-version-exemption-set` | `packageVersion`, `runtimeVersion`, `enabled`, `acceptRisk?` | 同名 `kind`：`result` 为 `ChangeResult` |

`spec` 是 DSH/pnpm 安装规格，可为包名、绝对本地路径、Git 或 tarball。`registry` 为 HTTP(S) 地址或 `null`（使用 pnpm 自身配置），省略则按 Host 当前配置。移动端先调用 `plugin-registries` 提供来源选择，再 `plugin-inspect` 展示包名、版本、来源、是否 bundle；只有 `status: accepted` 才提交安装。包内插件条目使用 `entryId`，包级操作使用 `name`，二者不可互换。

### 安装与恢复

```json
{"type":"plugin-inspect","requestId":"inspect-1","spec":"some-dsh-plugin"}
{"type":"plugin-install","requestId":"install-1","spec":"some-dsh-plugin"}
```

安装期间，同一控制连接收到：

```json
{"kind":"plugin-install-state","requestId":"install-1","phase":"installing","attempt":{"registry":null,"index":1,"total":1}}
{"kind":"plugin-install-log","requestId":"install-1","jobId":"...","stream":"stdout","text":"..."}
```

`phase` 可为 `installing`、`cancelling`、`applying`。日志只发给发起安装的连接，包含 `jobId`、`stream`、`text` 和可选 `exitCode`；App 限制内存中日志行数，并对输出视为不可信文本。结束时收到 `plugin-install-result`。取消使用 `plugin-install-cancel`，其 `installId` 等于原安装请求的 `requestId`。断线重连后可发送 `plugin-install-status`，`installId` 仍为原安装 ID；它可能等待运行中的安装结束，`result: null` 表示 Host 无此记录，随后刷新目录。不要用新的 `plugin-install` 盲目重试。

`ChangeResult.application` 可能是 `applied`、`restart-required`、`overridden`、`failed`、`cancelled`；还需查看 `changed`、`stage`、`error`、`warnings`、`pendingBuilds`、`approvedBuilds`、`packageResult`。`restart-required` 时提示重启 DSH Web 后再刷新目录。若 `pendingBuilds` 非空，只有用户明确批准这些具体包的构建脚本，才再次安装并将包名放入 `approvedBuilds`；切勿自动批准。失败或取消后刷新目录确认最终状态。

### 开关、卸载与配置

```json
{"type":"plugin-bundle-set-enabled","requestId":"toggle-1","name":"some-dsh-plugin","enabled":false}
{"type":"plugin-entry-set-enabled","requestId":"entry-1","entryId":"some-entry-id","enabled":true}
{"type":"plugin-remove","requestId":"remove-1","name":"some-dsh-plugin"}
```

用户操作前用目录的 `readOnlyReason`、`removable` 决定控件可用性。收到结果后依 `application` 展示成功、重启要求或错误，再刷新 `plugin-catalog`。**关闭或卸载 `dsh-plugin-mobile-gateway` 自身会切断当前连接**；App 应在操作前明确提示，并把连接中断后的最终状态标为“待重连确认”，不可视作操作失败或成功。关闭后只能从 DSH Web/CLI 重新开启。

配置卡片与包内配置都走 Host settings。先请求 `plugin-settings`，用 `namespace.schema` 渲染表单，展示 `value` / `base` / `user`，使用 `secrets[].set` 显示“已设置”，不得期待服务端回传密钥明文。保存时仅提交改动路径：

```json
{"type":"plugin-settings-mutate","requestId":"save-1","ns":"web-search-deepseek","expectedRevision":4,"ops":[{"op":"set","path":["provider"],"value":"example"}]}
```

`ops` 支持 `set`（需要 `value`）和 `unset`，`path` 为字符串数组，空数组表示整个配置节。移动端应优先提交字段级操作并带读取时的 `revision`；版本冲突重新获取 namespace，让用户决定如何合并。内置配置卡片的 namespace 由 `officialItems` 返回，不要把 Web UI 内部路由当成插件 ID。

版本豁免属于高风险高级设置；只在用户看到 Host 的具体不兼容版本并明确接受风险时传 `acceptRisk: true`。普通插件页可以先只展示豁免情况，但协议已经支持读取与修改。

## 更新通知、错误与安全

| 服务端通知 | App 行为 |
|---|---|
| `plugins-changed`，含 `reason` (`plugin` / `bundle` / `install` / `remove`) | 重新请求 `plugin-catalog`；该通知不包含完整目录 |
| `plugin-settings-changed`，含 `ns`、`revision` | 当前正在编辑该 namespace 时标记远端已更新，重新读取后再保存 |
| `plugin-install-state` / `plugin-install-log` | 仅更新匹配原安装 `requestId` 的进度 UI |

错误统一为 `{"kind":"error","requestType":"...","requestId":"...","code":"...","message":"..."}`。参数错误为 `bad-request`，未配对为 `authentication-required`，同 ID 安装进行中为 `plugin-install/in-progress`；Host 错误保留其 `code`。`plugin-inspect` 的业务拒绝是成功帧内 `result.status: refused`，不是传输错误。所有可执行操作只发至经过鉴权的控制连接，App 不应在未配对、只读或目录不可用时展示可用按钮。

## DSH Mobile 实施顺序与验收

1. 在协议模型和控制通道请求器加入上表帧；`requestId` 用 UUID，按 `(gatewayId, requestId)` 关联响应及安装事件，设置超时和断线恢复。
2. 完成插件页：官方可选包、四个内置配置卡片、已安装第三方包；使用 Host 提供的本地化元数据、状态与只读原因。
3. 完成「添加插件」流程：registries → inspect → 用户确认 → install → 进度/日志 → 结果/刷新；支持取消和重连查询。
4. 完成包级启停、条目级启停、卸载和 schema 配置；对 `restart-required`、构建脚本批准、网关自身停用及配置冲突给出明确状态。
5. 在已配对 RC2 环境验收：官方包开关、第三方包安装和卸载、配置读取/保存、安装取消、断线恢复；同时验证未配对控制连接被拒绝。

网关源码的单元测试覆盖 Host Remote 参数映射、响应、校验及安装 ID；端到端的真实包安装仍应在非生产 DSH profile 中验收，避免修改用户当前运行的 Web profile。
