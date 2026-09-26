# DSH 0.1.7-rc.1 网关与移动应用兼容性审计

> 更新（2026-09-24）：下文“当前网关”的结论记录的是适配前基线。现已在网关工作树完成 Session V4、`tool/result`、动态权限目录和默认预设配置适配；`dsh-mobile` 已完成 V4 历史解析及 Android/iOS 动态权限选项。网关完整测试、共享层 iOS 模拟器测试、Android 单元测试和 iOS 模拟器构建通过。尚未使用真实 rc.1 会话验证持久历史迁移、SSH 文件访问和运行中归档。新增能力表仍是后续功能规划。

核对日期：2026-09-24。网关基线：`3c2ac52`、npm 版本 `0.7.7`。目标：[官方 v0.1.7-rc.1 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.7-rc.1)，发布提交 `46a7f68`。本次为静态审计和一个最小复现；没有升级本机 DSH、迁移会话或修改生产代码。相邻的 `dsh-mobile` 应用仓库有未提交改动，本次只读取了其共享层和 Android 代码。

## 结论

**当前网关不能支持 v0.1.7-rc.1 的完整会话协议。** 官方 Session 格式是 V4；网关 `lib/dsh-host-adapter.mjs` 固定要求 V3。用 V4 `session/follow` 快照调用生产 `readSessionSnapshot()`，实际抛出 `unsupported-session-format`。因此历史、订阅快照、模型查询和会话预设查询等以快照为前置的功能确定失败。普通 `session/list` 等不读快照的调用可能仍可用，但不能据此判断消息收发全链路可用。

V4 的 `tool/result` 消息改为扁平工具角色结构。网关的实时事件映射及应用共享层的原始历史解码仍按 V3 嵌套包装读取，修好版本门槛后还会丢工具结果正文和部分失败状态。之前 0.1.6 审计指出的权限目录问题也仍在。其余 Remote API 与配置语义需要在精确 rc.1 发布包或真实宿主上联调，不能只靠旧测试夹具宣布兼容。

## 已确认的协议差异

| 优先级 | 差异与证据 | 当前影响 | 改法 |
|---|---|---|---|
| P0 | [官方 Session V4 常量](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/core/session/src/types.ts)为 `4`；网关 `lib/dsh-host-adapter.mjs:17,33` 固定 `3`，`lib/session-follower.mjs:22` 复用该校验 | V4 快照被拒；`history`、实时 follow，以及读取快照的模型、预设状态失败 | 以实际快照 `header.version` 返回格式版本，明确只接收经过验证的版本；同步更新历史/fork 游标校验和 `hello.historyFormatVersion`，让 App 清除旧缓存并重建基线。不能只把常量改成 `4` |
| P0 | [V3→V4 迁移规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.7-rc.1/packages/session/session-format-v3-to-v4/README.md)：`tool/result` 的 `message.role` 变为 `tool`，结果块直接放在 `message.content`，`isError` 位于 `message.isError` | `lib/index.mjs` 的 `buildWireEvent()` 只遍历旧的 `block.content`，故实时 `preview` 为空；失败判定只看旧包装或 `data.error`。应用 `GatewayDtos.kt` 的原始事件解析同样依赖旧包装 | 网关实时映射同时识别 V4 扁平结果及必要的旧数据；应用原始历史解码支持 V4 `message.content`、`message.isError`，保留 `data.error.code/reason` 供失败展示 |
| P0 | 旧 [0.1.6 审计](dsh-0.1.6-alpha.1-compatibility-audit.md)已确认候选权限从 `projections.values.permissions.options` 移到 `permissionPresets/catalog`；当前 `lib/index.mjs:1223` 仍要求旧字段 | `command-options(permission)` 与 `command-select(permission)` 失败；旧 `permission-options` 响应不含完整动态候选 | 经 Host Adapter 查询独立目录，与会话 `currentValue` 合并；动态 Auto 候选需使用实时目录，不能写死 |
| P1 | V3→V4 迁移可能插入中断的 `turn/end` 和子代理目录记录，随后重映射 `seq` 引用；上游负责迁移 | 手机保留 V3 `beforeSeq`、`atSeq`、事件缓存可能指向 V4 的另一位置 | 网关发送真实版本；App 已有格式变更重置机制，需用 V3 缓存升级 V4 的分页、fork 和重连场景验证 |
| P1 | 官方新增归档运行中任务的确认与 `stopActivity` 语义；网关目前只传 `{sessionId}` | 归档运行中会话可能返回 `workspace/session-active`；App 目前只有直接归档入口 | 透出受影响活动清单和明确的二次确认，再按新版参数请求停止；保留错误详情，不自动强制结束工作 |
| P1 | `lib/dsh-host-adapter.mjs:16` 写死 `DSH_VERSION='0.1.5-rc.2'`，`lib/index.mjs` 将其放进 `hello` | rc.1 宿主会被误报，诊断和能力判断不可靠 | 从宿主可验证元数据获取实际版本，或把该字段改为明确的网关适配目标，避免声称是运行版本 |

版本含义需分清：`dsh-mobile-v1` 是 WebSocket 子协议，`hello.protocol=3` 是网关协议，`Session header.version=4` 是上游持久日志格式；升级 Session 格式不必机械地改变前两者。

## 需在 rc.1 宿主复核的范围

- `session/create`、`prompt`、`follow/page/control`、`commands/execute`、`settings/describe/update`、`agentPresets/list/select`、`workspace/follow/archiveSession` 的精确参数和返回形状。发布说明明确客户端 Session 多实例及 slot 改变，但本插件使用 Host Remote Gateway；不能直接认定客户端 slot 变化作用于这里，也不能未经发布包检查就认定无影响。
- 设置已改为当前 Profile 的插件配置，Agent 预设改由插件组合包声明。网关的 `defaults` 与 `set-default` 假设旧 `agent-presets`、`permission` namespace 和字段；需要核实生效默认值、可修改字段和实时更新结果。此前 `modeSelectionEnabled=false` 时保存值不等于实际默认值的问题仍需处理。
- 新版归档、置顶、恢复的 Workspace Remote 能力，以及列表和 `workspace/follow` 的增量形状。当前只转发 `archivedSessionIds`，没有恢复或置顶入口。
- 真实升级场景：V3 持久会话迁移成 V4 后的 seq、工具结果、失败尝试、子代理记录、活动流快照、历史分页、fork 和应用缓存重建。当前 `npm test` 的 Host 假数据仍以 V3 为主，不能证明 rc.1 兼容。
- SSH 工作区的文件读取。当前 `lib/index.mjs` 用本机 `realpath/readdir` 和文件句柄实现 `file-list`、下载，不支持新版 SSH 文件提供方；需要改走 Host 文件能力或在远程工作区禁用相关入口。

## 可添加到网关与应用的功能

| 顺序 | 能力 | 网关工作 | 移动应用工作 |
|---|---|---|---|
| 1 | 归档管理：列表、筛选、恢复、置顶 | 接入 Workspace 归档/恢复/置顶 Remote 方法、状态流及运行中归档确认 | 增加归档页、置顶排序、恢复操作和受影响任务确认 |
| 2 | 后台任务与工作流 | 接入 Job Controller 的任务列表、实时输出、取消/唤醒状态 | 增加任务面板和完成通知；与现有会话重连状态对齐 |
| 3 | 文件改动审阅 | 提供经 Session 授权的文件改动清单与 diff，按需分页或分块传输 | 增加文件卡片、逐行/并排 diff，支持从聊天定位；先做文本 diff |
| 4 | 文件与文档预览 | 改用 Host `readBytes`/二进制流能力，避免本机 `fs` 对 SSH 路径的错误映射；继续做路径授权和流量限制 | 在现有文件浏览/下载基础上增加图片、PDF、Office、CSV/TSV 预览及缩放 |
| 5 | Subagent/Team 可观测性 | 透出成员、任务和子会话标识及更新流，保持看板只读 | 展示成员状态、切换子会话、跳转任务，不提供直接篡改 Agent 看板的 UI |
| 6 | 终端与浏览器侧栏 | 若要远程交互，新增单独鉴权的终端/浏览器会话接口、显式授权与生命周期管理 | 多标签终端、Shell 选择、URL 打开和会话恢复；属于高权限功能，应单独设计 |
| 7 | 插件管理与 MCP 资源 | 接入插件安装/启停配置及 MCP 资源列表/读取，分离只读与写操作 | 可先做资源浏览，再做插件管理；展示兼容性检查和安装任务状态 |

Headless `--json`、Messages/Files API、MCP SDK v2、PTC 命名/隔离、Browser/Computer Use、Auto review 等多数变化发生在宿主内部。网关无需复制其底层协议；若要让手机操作或展示这些功能，应新增明确的 Remote 映射和移动端能力声明。对涉及终端、插件安装、浏览器和 Computer Use 的入口，沿用现有设备认证还不够，需要单独核定授权边界。

## 验证记录

最小复现输入 `readSessionSnapshot({type:'snapshot', header:{version:4,id:'s1'}, cursor:0, records:[], projections:{}}, 's1')`，实际输出：`unsupported-session-format: mobile-gateway requires DSH 0.1.5-rc.2 Session format 3`。

本次没有可连接的 rc.1 宿主；本机 `git ls-remote` 因网络代理不可达而失败。因此本文将源码可确定的阻断与待联调项目分开，不把旧单元测试通过等同于新版兼容。
