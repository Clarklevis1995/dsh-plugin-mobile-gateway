# DSH 0.2.2-rc.3 兼容性评估与移动端工作项

评估日期：2026-11-14。对比项目原来的 RC.1 适配基线与官方 RC.3 标签源码、发布说明和 npm 发布包；同时检查 RC.2 中间版本。修复已进入当前工作区，尚未发布或替换用户正在运行的网关。插件当前版本号为 0.12.1，版本准备日期为 2026-11-14。

## 1. 结论与改动范围

**需要修复网关。** `internal: invalid team projection` 可由合法的新宿主数据稳定触发；不是仅凭截图猜测。除此之外，子代理继续对话和中断也存在已确认的接口不兼容，本次一并修复。

RC.2 → RC.3 的发布说明仅列出两项：实验性 DeepSeek 历史会话导入插件，以及 Windows 桌面版应用内更新失败/无法自动重启的修复。没有在这两个增量中发现需要本插件调整的接口。但本项目从 RC.1 升级到 RC.3，必须包含 RC.2 的具名、多层子代理及团队统一改造，不能只看 RC.3 发布页。

| 项目 | 已确认变化及对本项目影响 | 本次处理 |
|---|---|---|
| 团队投影 | RC.1 的 `members/tasks/failure?` 变为 RC.3 的 `enabled/tasks/failure?`；原强校验报错 | 查询、历史/会话快照、控制基线、批量及旧式实时投影统一转换 |
| 子代理继续对话 | 新 `SubagentPromptRequest` 移除 `parentSessionId` 和 `mode`，严格描述符拒绝旧额外字段 | 新宿主发送新字段，旧 RC.1 保留原路径 |
| 子代理中断 | `interruptByParent` 改为 `interruptByUser(childSessionId)` | 按宿主版本选接口，写操作前验证直接父子地址 |
| 具名、多层协作 | 目录可带 `name`，子代理可以再委派子代理；任务可带 `ownerId/ownerName` | 网关保留原始字段；移动端需完善展示和导航 |
| 会话/控制流、任务、插件管理、附件、图片、语音、改动摘要 | 所覆盖的官方 RC.3 契约检查通过 | 沿用现有移动协议；不是所有宿主可选插件的全面兼容认证 |
| 导入 DeepSeek 会话 | RC.3 新增实验性宿主插件 | 本次未新增导入 RPC 或移动页面；后续可单独接入 |

Session 持久格式仍为 4，移动协议仍为 `dsh-mobile-v1` / 协议 3。格式号不变不意味着所有事件载荷或内部 RPC 都向后兼容。

## 2. 反馈问题的根因与修复

旧网关查询 `agent-team` 时要求 `members`、`tasks` 都是数组。RC.3 官方团队投影初始化后可以合法返回：

```json
{"enabled":false,"tasks":[]}
```

原代码会因此抛出 `invalid team projection`，移动端再显示 `internal: invalid team projection`。官方 RC.1 标签仍定义成员数组，RC.3 标签已移除；官方团队投影升级指南也明确停止恢复历史名册和邮箱。指南所在目录不能直接当作变更首次发布的版本依据。

本次在 Host Adapter 边界将新投影补充为：

```json
{"enabled":false,"tasks":[],"members":[]}
```

- 仅对缺少 `members` 且具有布尔 `enabled`、数组 `tasks` 的新结构补字段；旧结构原样保留。
- `enabled`、任务、`failure` 和额外宿主字段保留，不修改宿主原对象。
- 查询、历史读取、会话订阅 opening snapshot、控制流 baseline、`changes[]` 和旧式单键更新使用一致的规范化逻辑，避免重连后再次出现不兼容。
- `tasks` 非数组、`members:null` 等仍拒绝。没有通过吞掉错误或把损坏数据改为空团队来掩盖异常。
- 空 `members` 只是兼容旧端解码。当前子代理应从 `subagentCatalog` 发现，不能据此判断团队没有成员，也不能从历史名册恢复成员权限。

这能修复由上述合法结构引起的查询失败；截图本身不含用户日志，无法据此排除该用户环境中同时存在其他错误。

## 3. 子代理写操作的兼容处理

新版宿主 prompt 参数示意：

```json
{"request":{"requestId":"m1","childSessionId":"child","delivery":"queue","content":[{"type":"text","text":"继续"}]}}
```

中断调用改为 `subagents/interruptByUser`，参数为 `{"childSessionId":"child"}`。移动端仍使用现有 `sessionId/parentSessionId/subagentMode`，不直接感知宿主 RPC 变化。

由于新版写接口只传 child，网关写入前使用官方 `session/follow` 子会话地址验证移动端声明的直接父子关系；验证失败不执行 prompt 或 interrupt。读取只取最小 opening window，并释放该次 follow。只有 `continuable` 接受发送和中断，原来的队列/steer、requestId、时区和内容处理继续保留。

版本分流使用探测到的宿主启动包版本；RC.1 使用旧参数和 `interruptByParent`，RC.2/RC.3 使用新接口。探测不到版本时采用当前 RC.3 适配基线，但不会将其伪装成 `hello` 上报的实际宿主版本；非标准宿主打包需要单独验证版本探测。

## 4. 其他升级风险

以下是 RC.3 随附升级指南中的部署注意项，部分更早就已引入，不能全部归因于 RC.3 的两项发布增量。本次没有修改宿主配置。

| 风险 | 升级时应采取的动作 |
|---|---|
| `subagent/catalog` v3 | 官方明确旧进程拒绝新目录载荷。创建新子代理前升级所有共享同一 Session 存储的进程；不要认为 Session format 仍为 4 就可以直接降级。回退需有升级前的数据备份与明确恢复方案 |
| 归档自动清理 worktree | 符合条件、由新版记录创建事件的工作树会在归档时通过非 force remove 清理；分支和提交保留。被忽略文件等可能随目录删除。需要保留检出目录时检查工作树服务 `retainOnArchive`；旧版创建且没有创建事件的目录不被追溯扫描 |
| 搜索提供方与认证 | 默认搜索可改走 DeepSeek Search API，计费与旧模型辅助搜索不同；旧 `baseURL/apiKeyEnv/apiKey` 配置可能不再生效，需按能力迁移为对应字段。旧 Exa/Perplexity 包已移除，使用自定义组合时按官方指南检查 |
| SDK、Session append、工具与 UI 扩展 | 自定义 `Session.append` 包装器需支持批量追加；直接调用 SDK/team 工具的扩展需适配新参数和错误分类；使用官方菜单浮层定位接口的扩展需迁移。当前网关未直接包装 Session.append，本次未扩展这些宿主功能 |

## 5. 交给移动端的后续工作

消除本次投影弹窗应先部署网关修复；无需为了这个兼容字段单独改变手机 RPC。但这并不等于 RC.3 的新团队体验已经完整实现。

### P1：团队与具名子代理展示

1. `agentTeam.enabled === true` 时，即使 `members:[]`、`tasks:[]`，也应允许显示团队入口和空任务板。有历史任务但没有任何目录成员时，也要允许进入看板；不要只凭成员数量显示入口。`visible` 与 `isTeam` 都要同步修正，避免只改变标题却仍隐藏按钮。
2. 团队任务从 `agentTeam.tasks` 读取，成员从父节点的 `subagentCatalog` 读取。旧宿主的 `members` 可兼容展示，但不要将它作为新版唯一来源。
3. 名称展示优先使用目录 `name`，再按 `label`、id 回退；展示名不能替代会话寻址 ID。任务保留 `ownerId` 和 `ownerName`；优先按 ownerId 匹配，只有缺少 ownerId 时才回退为 ownerName 与代理身份 name 匹配，不能使用 label。未知 ownerId 不得误匹配其他同名成员。两者都缺失才算未分配；负责人不在目录时仍显示保存的名称或 ID。
4. `enabled:false` 不代表删除历史任务或子代理；`null/unavailable`、空目录和空团队是不同状态。投影 `failure` 应保留可查看的诊断信息。

只读检查当前 `dsh-mobile` 后确认，App 仍有实际兼容缺口；并非只需更换说明文案。本次未修改移动端仓库，也未运行 App 测试。

| 实施位置（相对 dsh-mobile 仓库） | 当前代码与可推导的影响 | 应修改内容 |
|---|---|---|
| `shared/src/commonMain/kotlin/com/clarklevis/dsh/shared/facade/SharedTeamStore.kt`：`snapshot()` | 已有 catalog 成员回退，但 `visible` 只看成员，`isTeam` 只看旧 teammate 或任务。enabled 空团队、只有历史任务但目录为空时，按钮会被隐藏 | 将能力、enabled、任务存在与可浏览子节点纳入 visible；isTeam 识别 enabled，并保留历史任务可读性 |
| 同文件：目录成员构建 | 名称使用 label/id，忽略 name | 分离身份名称、显示名和描述；name 优先展示，label 保留为任务描述，旧目录缺少 name 时用 ID 作身份回退 |
| 同文件：`TeamTaskView` | 只有 ownerName，没有 ownerId。未知字段被忽略，不会因此解码崩溃，但丢失负责人身份 | 增加可选 ownerId；按 ID 匹配、过滤和导航。避免仅有 ownerId 的任务被视为未分配 |
| `androidApp/src/main/kotlin/com/clarklevis/dsh/android/ui/TeamUi.kt` | 当前成员筛选、负责人点击按 ownerName 对成员展示 name；未分配只判断 ownerName | 配合共享层按 ID 优先，名称仅作历史回退；负责人展示兼容 name/ID |
| `DeepSeekHarnessMobile/Core/GatewayModels.swift`：`MobileTeamTask`；`Views/ConversationView.swift`：`TeamContentSheet` | Swift 镜像没有 ownerId，筛选、点击和未分配逻辑同 Android | 增加可选 ownerId，并与 KMP/Android 使用相同身份规则；缺省字段兼容旧桥接快照 |
| `shared/src/commonTest/kotlin/com/clarklevis/dsh/shared/SharedTeamStoreTest.kt` | 团队 fixture 仍主要是旧 members 结构 | 加入下述 RC.3 场景，并保留旧结构回归；Android/iOS 补页面验收 |

建议 App 合并前至少验收：

| 输入场景 | 预期 |
|---|---|
| enabled=true、tasks=[]、members=[]、catalog=[] | 显示团队入口及空任务板 |
| enabled=false、tasks 非空、members=[]、catalog=[] | 能进入历史任务板，不把关闭模式解释为删除任务 |
| catalog 中 name=reviewer、label=检查分镜 | 标题为 reviewer、描述为检查分镜；ownerName=reviewer 的任务能关联 |
| 任务只有 ownerId | 能关联真实成员，不列入未分配 |
| ownerId 未知、ownerName 与另一成员相同 | 保留负责人文本，不跳转该同名成员 |
| ownerId 与 ownerName 都缺失 | 归入未分配 |
| 两个父节点下都有 checker，任务 ownerName=reviewer/checker | 按完整代理路径兼容匹配，不匹配另一个分支的 checker |
| 旧 RC.1 members 团队 | 原有生命周期、导航和任务展示仍可用 |

多层目录的 name 只在同级唯一；任务的 ownerName 可为 reviewer/checker 完整路径。App 应从直接父关系构造身份路径，根为 lead，根下第一层不加 lead/ 前缀。任一链路未命名时按 ID 回退，不能将 label 当成身份路径，也不能用显示用的单段名称跨分支匹配。

新版团队按根会话启用，与 agent-preset 不再是同一件事。官方提供 `agentTeams/setEnabled(agentId, enabled)`，后续配套已新增可选 `agent-team-mode-v1`、`agent-team-set-enabled` 移动写接口和双端对话「更多」菜单开关，详见 [协议](../PROTOCOL.md#移动端-team-模式开关agent-team-mode-v1)。只浏览已有团队仍复用原查询协议；旧网关未声明新能力时隐藏 App 开关。 应处理根会话限制、宿主权限和持久化失败，不能只在 App 本地改 enabled。旧接入指南中“选择团队 preset 即创建团队”的描述已修订。

### P1：多层浏览与恢复

1. 每层只查询该节点直接子目录；进入孙节点时传它的直接父 ID，不能一直传根 Lead。
2. external 不作为本地子会话打开；one-shot/unknown 不直接开启续聊。沿用 continuable 限制，等待宿主验证真实关系。
3. 首次加载和重连都以新 baseline 替换对应投影值；实时完整值不能和旧名册做累加合并。按网关、会话、投影键分别管理 seq。
4. 验收空 enabled 团队、只有历史任务的团队、旧 RC.1 有成员团队、具名子代理、ownerId/name 匹配、三级目录、跨视图更新、断线恢复、非法父子地址拒绝，以及发送/停止回执。多层地址已有基础实现，本次列为回归项，不据此断言整套目录导航需要重写。

### P2：可继续接入的功能

- RC.2 的代码审阅与工作树体验：分支/提交/文件类型筛选、逐文件已审阅进度、评审评论和分支更新。当前已有的改动摘要能力不等于完整评审流程，应单独设计权限、写操作及冲突展示。
- RC.3 的 DeepSeek 会话导入：先完成宿主插件可用性与官方接口调研，再增加选择导入、进度、失败恢复和导入后进入会话的流程；本次不凭实验性插件名称虚构协议能力。
- 向上阅读时自动加载历史并保持滚动位置，可复用现有分页接口实现，同时保留加载失败重试。

## 6. 验证证据与边界

- `npm test` 完整回归通过；WebRTC 套件中 45 项通过、1 项跳过，不代表整个仓库只有 46 项测试。
- 新增/更新团队回归 7 项通过，覆盖旧结构、新结构查询、损坏值拒绝、新写接口、非法父子关系、历史快照、真实本机 WebSocket baseline/会话快照/批量更新/重连。
- 隔离安装官方 `@deepseek-ai/dsh@0.2.2-rc.3` 后，以下 7 个检查脚本通过：`agent-team-official`、`host-official`、`dsh-022-official`、`file-upload-official`、`speech-official`、`tool-images-official`、`workspace-changes-official`。
- 团队契约检查使用官方投影定义生成无 members 的数据，通过真实 Gateway、Connection Peer 和严格描述符校验。业务服务使用内存 fixture；附件测试使用隔离临时存储，语音识别器是替身。
- 没有升级或重启用户现有 DSH，没有写入真实用户会话，也没有完成真实手机到 RC.3 宿主的端到端联调。发布前仍需验收真实会话下的团队打开、子代理发送与停止。

复现官方契约检查时，将 `DSH_INSTALL_ROOT` 指向隔离安装的官方 DSH 包目录，再执行相应 `test/*-official.test.mjs`；不要使用插件的版本号代替宿主版本。

## 7. 官方依据

- [RC.3 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.3)
- [RC.2 发布说明](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.2-rc.2)
- [RC.1 团队类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/experimental/agent-team/src/types.ts)
- [RC.3 团队类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/team/agent-team/src/types.ts)
- [RC.3 子代理控制类型](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/subagent/subagent/src/control-types.ts)
- [RC.3 子代理名称与路径规则](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/subagent/subagent/src/names.ts)
- [RC.3 Team 模式开关实现](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/packages/team/agent-team/src/index.ts)
- [团队投影迁移](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.1-rc.3/team-projection/guide.zh.md)
- [具名子代理与目录 v3](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.2-alpha.3/subagent-names/guide.zh.md)
- [归档清理工作树](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.2-rc.1/archive-worktrees/guide.zh.md)
- [搜索默认提供方](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.2-alpha.2/web-search-default-provider/guide.zh.md)、[搜索认证迁移](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.2-alpha.2/web-search-credential-modes/guide.zh.md)、[搜索计费选择](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.3/docs/upgrade-guide/v0.2.2-rc.1/web-search-billing/guide.zh.md)
