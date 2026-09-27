# 多网关第一阶段：App 对接说明

本文对应 Gateway 插件本次源码实现；尚未发布新的 npm 版本。App 第一阶段目标为保存多个网关并切换连接，暂不要求同时保持多个控制通道。无需中央服务器，也不包含自动发现。

## 1. 不变的协议

- WebSocket 路径默认 `/ws/mobile`，子协议仍为 `dsh-mobile-v1`，`hello.protocol` 仍为 `3`。
- 配对载荷仍为 `version: 2` 的 JSON，经 UTF-8、无 padding Base64URL 编码。
- 首次连接发送子协议 `dsh-mobile-v1, dsh-pair.<pairingCode>`，同时发送 `X-DSH-Device-ID` 安装级 ID。
- 配对成功只发送一次 `paired.token`；后续使用 `Authorization: Bearer <token>` 或 `dsh-auth.<token>` 子协议。
- 控制通道发送 `X-DSH-Channel: control`；取得 token 并确认控制通道的 `hello` 后，会话通道使用同一网关 token 与 `X-DSH-Channel: conversation`。
- App 不调用 `/mgw/*` 管理接口。这些接口仅供 DSH 本机管理界面使用。

## 2. 新增字段

以下字段均为向后兼容的增量字段。新版 App 对旧插件应允许字段缺失，但新版插件返回的身份必须校验格式及一致性。

| 字段 | 类型 | 返回位置 | 含义 |
|---|---|---|---|
| `gatewayId` | string，UUID v4 | 配对载荷、`paired`、`hello`、管理状态 | 网关安装实例身份，重启和改地址不变 |
| `gatewayName` | string | 同上 | 服务端展示名称，可变，不用于合并资料或鉴权 |
| `endpoints` | string[] | 配对载荷、管理状态 | 同一网关的候选地址，规范化后去重，合并最多 16 个 |
| `gatewayMode` | string | 管理状态及模式修改响应 | `disabled` / `temporary` / `persistent`；不参与移动业务帧 |

`hello` 和 `paired` 不返回地址列表。新增可信地址需重新扫码或经用户明确确认，不能从未认证的广播或错误跳转中自动吸收。

配对载荷示例（这里展示的是解码后的 JSON，不能将原始 JSON 直接交给现有扫码解析器）：

```json
{
  "version": 2,
  "publicUrl": "wss://gateway.example.com/ws/mobile",
  "pairingCode": "<一次性配对码>",
  "expiresAt": 4102444800000,
  "gatewayId": "d56a1098-8519-43a1-9dce-fb99863bf5bb",
  "gatewayName": "家里电脑",
  "endpoints": [
    "wss://gateway.example.com/ws/mobile",
    "ws://192.168.1.10:3081/ws/mobile"
  ]
}
```

成功后收到：

```json
{
  "kind": "paired",
  "token": "<仅返回一次的长期 token>",
  "device": { "id": "<此网关分配的设备 ID>", "name": "Phone" },
  "gatewayId": "d56a1098-8519-43a1-9dce-fb99863bf5bb",
  "gatewayName": "家里电脑"
}
```

之后 `hello` 保留原字段，并增加相同的 `gatewayId`、`gatewayName`。所有业务请求仍按原协议发送，不需要把 `gatewayId` 加入每条消息；App 根据连接上下文路由。

## 3. 地址语义与信任规则

`publicUrl` 是本次配对的首选地址，兼容旧 App。`endpoints` 的来源顺序为：首选地址 → 本次本机配对请求指定的地址 → 插件配置地址 → 已配置公网地址 → 已取得的 Cloudflare Tunnel 地址 → 已启动局域网监听的地址。管理状态没有本次配对地址，只返回配置与监听产生的候选地址。

- `http` / `https` 输入由插件规范化为 `ws` / `wss`。不允许用户名密码、查询参数、fragment 或 `0.0.0.0` / `::` 监听地址；公网明文 WS 被拒绝。
- 每个输入列表最多 16 项，每项最多 2048 字符；合并后超过 16 个也会拒绝。候选地址可能包含手机不可达的 loopback 地址，App 应过滤或提示，不可据此判断网关离线。
- 地址顺序不保证网络可达或代表实时延迟；App 可以优先尝试最近成功且已确认可信的地址。
- 只有来自用户认可的配对二维码/手动导入，或用户单独确认的地址，才可使用凭证。`gatewayId` 是关联标识，不是证书或密码学身份凭据。
- Quick Tunnel 每次启动或重连可能取得新的 `trycloudflare.com` 地址；旧地址不能自动推导新地址。App 应让用户重新扫码更新同一 `gatewayId` 的已确认地址，不能向未确认的随机域名自动发送旧 Token。
- `hello` 在鉴权之后返回，不能依赖“先发送 token、再比较 ID”保护 token 不被恶意端点窃取；TLS 校验和发送前的地址信任判断必须先完成。局域网明文 WS 仅用于用户信任的网络。
- 地址被重定向时不得把 token 自动转发到其他来源。
- 配对码是单次使用。候选地址上的配对请求必须串行；若发生网络断开且无法确定配对是否已被消费，应重新生成二维码，不能对多个地址并行消耗同一码。

## 4. 客户端状态与接入流程

建议保存：

```text
GatewayProfile
  localId                  本地稳定记录 ID
  gatewayId?               远端身份，旧插件允许缺失
  gatewayName              服务端名称
  alias?                   用户本地别名
  endpoints[]              已确认的候选地址
  preferredEndpoint?       最近成功地址
  credentialRef            按 localId 隔离的安全存储引用
  remoteDeviceId?          此网关返回的 device.id
  lastConnectedAt?
```

1. 将旧单网关配置迁移为一条资料；保留 token、缓存和草稿，迁移要幂等。未配对成功的新资料不覆盖当前网关。
2. 解析配对载荷并检查版本、有效期、地址和身份字段。已有相同 `gatewayId` 时提示更新资料，不按名称或 IP 合并。
3. 建立控制通道；收到 `paired` 时核对其身份与二维码相符，再立即将 token 写入该资料的安全存储。持久化失败时阻止后续业务，提示重新配对。
4. 收到 `hello` 后再次核对身份，保存服务端名称及原协议能力列表。二维码带有身份时，缺失或不一致的返回均视为异常，不能降级为旧网关。
5. 根据页面需要使用该网关 token 建立会话通道，再核对其 `hello.gatewayId`。
6. 重连仅使用该资料的已确认地址与凭证。网关 ID 不匹配时关闭连接、保留原记录并提示重新确认。
7. 再次配对同一安装会轮换该网关的 token。保存新 token 后主动重建该网关现有通道；不影响其他网关。

旧插件完全没有身份字段时，以 `localId` 隔离资料。升级后只经原本可信且认证成功的连接绑定远端 ID，遇到记录冲突须提示，不能静默合并。

第一阶段切换网关时应关闭旧连接、取消订阅与待处理请求。连接代次和网关 ID 一起绑定到异步回调，丢弃旧回调。数据键使用 `(localId, resourceId)`，模型、工作区、会话、任务、审批和文件均需隔离。

发送消息、审批、停止任务等写操作超时后，不自动重发；查询状态后再决定操作，避免重复执行。删除本地网关不等同于撤销服务端授权。

## 5. 错误与状态处理

| 结果 | App 行为 |
|---|---|
| Upgrade HTTP 503 | 显示网关关闭或不可用；有界退避，提示本机开启 |
| Upgrade HTTP 401 | 凭证无效、配对过期或已使用；停止用同一凭证无限重试，提供重新配对 |
| Upgrade HTTP 400 | 检查安装级 ID 等协议参数，显示可理解的错误 |
| close 4003 | 可能是撤销设备或重新开启鉴权；重新检查授权，不能仅显示普通网络中断 |
| close 4004 | 显示网关已关闭，避免紧密重连循环 |
| 网络断开 | 当前资料独立退避重连，不将其他网关标记离线 |
| 返回身份不匹配 | 停止业务，不覆盖既有身份、地址或 token |

## 6. 已核对的 App 代码入口

在兄弟仓库中只读检查了以下入口，本次没有修改 App：

- `DeepSeekHarnessMobile/Core/GatewayModels.swift`：`GatewayPairingPayload` 当前只有四个旧字段；需要增加可选字段，并在业务帧模型补充身份。
- `DeepSeekHarnessMobile/Core/PairingPayloadParser.swift`：当前严格检查 Base64URL、version 2 和过期时间；应保留原校验并增加新字段规则。
- `DeepSeekHarnessMobile/Core/GatewayFrameRouter.swift`：`paired` / `hello` 路由需传递网关身份，绑定所属连接上下文。
- `DeepSeekHarnessMobile/Core/AppStore.swift`：配对入口需要从单网关状态迁移到按资料管理。其余连接、缓存及安全存储调用点需在 App 实施时继续排查。

现有 Codable 解码器会忽略新增字段，已用当前真实配对模型与解析器执行兼容性样例；这不代表 App 已实现多网关，也不能代替真机验收。

App 交付验收以 [第一阶段验收报告](multi-gateway-phase1-acceptance.md) 的人工步骤及 [待办](multi-gateway-todo.md) A1–A4 为准。
