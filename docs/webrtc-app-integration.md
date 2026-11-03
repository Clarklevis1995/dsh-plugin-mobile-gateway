# WebRTC P2P 优先接入契约

日期：2026-10-30。能力：`webrtc-upgrade-v1`。状态：**网关可联调，Android/iOS App 待接入**，源码尚未发布。原来的配对二维码、`/ws/mobile`、`dsh-mobile-v1`、`hello.protocol=3` 和业务 JSON 保持兼容。

## 配置与范围

首次使用默认“局域网直连”，通过同一 Wi-Fi 下的主机内网地址使用 WebSocket。需要 P2P 时，在“移动设备 → 连接与配对 → 连接方案”主动选择“公网入口 + 优先 P2P（实验）”。选择会自动启用 P2P 优先并保存，STUN 与配对入口也可在同一页面编辑，无需修改源码或 YAML。保存后 App 断开并重新连接即可生效，现有连接保留。选择 Cloudflare 或其他入口选项时，新连接使用 WebSocket。已有显式关闭配置仍生效，界面保存的选择优先于启动配置。

也可使用插件的本地配置：

```yaml
webrtc:
  enabled: true
  mode: prefer-webrtc
  stunServers:
    - stun:stun.cloudflare.com:3478
  negotiationTimeoutMs: 12000
  rtcConnectTimeoutMs: 8000
  bindTimeoutMs: 5000
  maxFrameBytes: 16384
  maxLogicalMessageBytes: 16777216
  maxPendingNegotiations: 8
  maxActiveGroups: 16
```

实验开关默认 `true`，策略默认 `prefer-webrtc`；`ws-only` 不协商 RTC。默认自动使用 Cloudflare STUN（`stun:stun.cloudflare.com:3478`）发现公网地址和端口，并将同一列表下发给 App。管理页无需填写，允许自定义覆盖；清空管理页列表会恢复默认，旧管理状态里的空列表也会恢复默认。底层启动配置显式 `stunServers: []` 仍可用于仅 host candidate 的离线场景（没有管理页覆盖时）。禁止把示例域名当服务器。首版不使用 TURN。RTC 库 `werift@0.25.2` 是正式运行时依赖，随插件由包管理器自动安装，不要求用户另行安装。插件要求 Node 22 及以上。开关关闭、运行库加载中或加载异常时，新旧 App 继续使用普通 WebSocket。

信令依然需要一个手机能访问的、已经信任的 WebSocket 入口，可以是现有 LAN、公网 WSS 或 Cloudflare Tunnel。P2P 不替代首次配对和入口发现，首版不新增协调服务器、账号、应用层 E2EE、ICE restart、无缝迁移或后台保活音视频。

## 连接状态机

```text
已保存设备凭据
  → 鉴权 WebSocket bootstrap
  → 验证 gatewayId 和 capability
  → 同时准备 control / conversation 两个独立 PC
  → 两个 DataChannel 都完成票据绑定
  → WSS 显式 transport-select / transport-selected
  → 选中的承载发送两个真实业务 hello
  → 原有业务 Runtime 开始工作
```

任一 PC 准备失败则显式选择 WebSocket；服务端把 bootstrap 原子转换为 control，App 收到新的业务 hello 后，再打开普通 WSS conversation。不得提前打开 conversation，不得将 bootstrap hello 发布给业务 Runtime。客户端收到旧网关或关闭实验功能的新网关的普通 hello 时，直接使用现有连接，不能另造一次假握手。

首次领取配对 token 的连接不升级。凭据保存成功后，用新的已配对连接开始上述流程。

## Bootstrap 与信令

请求已有 `/ws/mobile`，沿用 bearer token 和设备标识，附加：

```text
X-DSH-Channel: control
X-DSH-Transport-Intent: negotiate-v1
```

只对这种已配对且运行库可用的连接，hello 增加 `webrtc-upgrade-v1` 和：

```json
{"transport":{"version":1,"bootstrap":true,"modes":["webrtc","websocket"],"negotiateTimeoutMs":12000,"maxFrameBytes":16384,"maxLogicalMessageBytes":16777216}}
```

完整 hello 仍保留 gatewayId、device、protocol、DSH 版本及既有 capabilities。bootstrap 不创建业务订阅、不加入业务广播。整个协商总时限从 bootstrap 建立开始，子阶段不能延长它。

客户端：

```json
{"type":"transport-negotiate","requestId":"n1","version":1,"preferred":["webrtc","websocket"],"receiveLimits":{"maxFrameBytes":16384,"maxLogicalMessageBytes":16777216}}
```

网关：

```json
{"kind":"transport-offered","requestId":"n1","transportSessionId":"服务端分配的 UUID v4","expiresInMs":12000,"iceServers":[],"channels":["control","conversation"],"receiveLimits":{"maxFrameBytes":16384,"maxLogicalMessageBytes":16777216},"bindTickets":{"control":"一次性随机票据","conversation":"另一张一次性随机票据"}}
```

占位字符串不是可运行请求。票据各有 256 bit 随机熵，Host 只在内存保存摘要，绑定当前设备、gatewayId、bootstrap、协商代次和通道。对每个方向，发送上限取本地能力与对端 receiveLimits 的较小值。客户端不得指定 STUN/TURN 目标。

Client 是唯一 offer 发起者；每个 channel 单独维护每方向从 1 开始的连续 signalSeq：

```json
{"type":"transport-signal","transportSessionId":"当前 UUID","channel":"control","signalSeq":1,"signalType":"offer","sdp":"合法的 application-only SDP"}
```

Host 响应 `kind: transport-signal`、`signalType: answer`。candidate 帧使用 `signalType: candidate` 及 `candidate: {candidate,sdpMid,sdpMLineIndex}`；完成后用 `signalType: end-of-candidates`。candidate 字符串应以 `candidate:` 开头；部分原生库输出 SDP 行 `a=candidate:`，App adapter 应去掉 `a=`。远端描述安装前最多缓存 256 个 candidate，之后按库的合法时序提交。首版每个 PC 只接受一个 application m-line；不创建音视频通道。

不接受重复 JSON 字段（包括转义后相同的字段名）、跨会话信令、错误枚举、乱序序号及超限内容。总信令上限 64 KiB，SDP 48 KiB，单个 candidate 4 KiB；每设备 20 条/秒、短时突发 40 条。每设备最多 2 组未回退的协商/RTC 连接。已发生可恢复网络失败时，同一协商仍在途的信令收到 `transport/negotiation-ended`，临时 PC 已撤销，不能激活业务。

## DataChannel 绑定与整组提交

两个 PeerConnection 各自只创建一条可靠、有序 DataChannel，label 分别为：

- `dsh-mobile-control-v1`
- `dsh-mobile-conversation-v1`

DataChannel 打开后的第一条消息是最多 4 KiB 的 UTF-8 JSON 文本：

```json
{"type":"transport-bind","version":1,"gatewayId":"已验证的网关 UUID","transportSessionId":"当前 UUID","channel":"control","ticket":"本通道票据"}
```

Host 校验后返回 `kind: transport-bound`，回显 version、gatewayId、transportSessionId、channel，不回显票据。绑定后只接受 MGW1 二进制帧；绑定成功尚不能发送业务。

两条通道都绑定后，WSS 返回：

```json
{"kind":"transport-ready","transportSessionId":"当前 UUID","channels":{"control":"bound","conversation":"bound"}}
```

客户端显式提交：

```json
{"type":"transport-select","requestId":"s1","transportSessionId":"当前 UUID","mode":"webrtc"}
```

Host 返回 `kind: transport-selected`，回显 requestId、transportSessionId 和 mode，然后在选中的两个通道发送正常业务 hello。相同选择重复提交只回显，不能重复激活；冲突选择结束整组。客户端收到 selected 并验证关联后，先在两条 RTC 通道各发送一条原有 `ping`，然后才提交其他业务。每条通道在首次 ping 前只发送 hello，开场基线和广播在有界发送队列中等待，避免 RTC 快于 WSS 时业务通知抢在 selected 前到达。这个门控只影响新 RTC 承载。RTC hello 可以早于 WSS selected 到达：App 只可暂存预期的两个 hello，总预算 256 KiB，不让业务提前执行。

失败回退使用相同 select，`mode: websocket`。先关闭临时 PC 和票据，再复用原 bootstrap 为正常 control。`transport-failed.recoverable=true` 仅表示可以提交 WSS，绝不表示服务端已经回退；`recoverable=false` 必须停止本次自动恢复。selected 超时或丢失时关闭整组，以新代次 ws-only 连接，不能猜测承载或双写。

父信令 WSS 必须保持在线，只接受 transport 管理和 ping/pong；其断开、撤销设备、关闭网关、任一业务通道失效都会关闭整个 RTC 组。DTLS 指纹、身份、票据、分片等安全错误不能当作打洞失败静默降级。

## MGW1 二进制分片

WebSocket 继续使用原 JSON 文本。RTC 业务 JSON 使用 `stringifyWireFrame` 的 Unicode 语义，再编码成 UTF-8。每条 DataChannel 消息最多 16384 字节，32 字节头采用 big-endian：

| 偏移 | 字节 | 字段 |
| --- | --- | --- |
| 0 | 4 | ASCII MGW1 |
| 4 | 1 | version=1 |
| 5 | 1 | flags=0 |
| 6 | 1 | control=1、conversation=2 |
| 7 | 1 | reserved=0 |
| 8 | 8 | messageSequence，1..2^63−1 |
| 16 | 4 | chunkIndex，从 0 开始 |
| 20 | 4 | chunkCount |
| 24 | 4 | totalBytes |
| 28 | 4 | payloadBytes |
| 32 | 变长 | payload |

每方向每通道的 messageSequence 独立从 1 连续递增。Kotlin/Swift 必须按 64 位整数解码，不能经 Double。chunkIndex 连续、不交错不同消息，每次最多重组一条；总长、片数、通道和序号必须一致，完整重组后才解码 UTF-8 和 JSON。非法 UTF-8、空 payload、重复/乱序片、溢出、跨通道、缺片超时都结束整组，不执行不完整业务。

共享黄金向量及非法头向量：[frames.json](../test/fixtures/transport-v1/frames.json)。control、sequence=1、正文 `{}` 的 34 字节为：

```text
4d475731010001000000000000000001000000000000000100000002000000027b7d
```

逻辑消息默认最多 16 MiB，两个通道合计重组预算 32 MiB，重组空闲超时 30 秒。每通道发送队列 16 MiB，高水位 256 KiB、低水位 64 KiB、等待超时 30 秒。关闭要取消全部等待。Worker IPC 的未确认字节也计入 bufferedAmount，接收侧待父线程确认的 IPC 字节另限每组 4 MiB，不把线程消息队列当无限缓冲。

过大请求必须在第一片发送前拒绝并保留草稿；确认完全未发送时，可在新的 ws-only 连接首次提交。超大响应返回小错误 `transport/ws-required`，含可用 requestId、requestType、maxLogicalMessageBytes，不截断伪装成功。对于流式通知，可能只有 requestType/kind，App 要重新取得快照。只有明确只读操作可自动重新查询；创建、Prompt、Steer、审批、安装、配置等写操作不能重放。

## 连接代次、文件和权限

MobileConnection 的 generation 由 Host 本地产生，客户端不指定。transportSessionId 只表示协商，不是 Harness sessionId。新承载获得新的逻辑 owner，旧 uploadId、transferId、订阅不能复制；文件上传、下载仍须走现有 Session 授权。断开时释放旧 owner，重连重新 open，首版无断点继承。

业务结果未知不能靠 requestId 推断幂等。恢复时先重新获取会话、历史及投影基线，丢弃旧 generation 回调；已发送写操作标记未确认并查询实际状态。已建立 RTC 故障后的第一次恢复用 ws-only，用户主动重连或下一连接周期再尝试 RTC。关闭、切主机、退出和撤销必须取消全部工作，不能回到其他主机。

## 联调客户端与平台分工

联调工具读取环境中的既有凭据，不执行首次自动配对，不持久化 token：

```bash
MGW_URL='wss://已信任入口/ws/mobile' \
MGW_DEVICE_ID='已有安装标识' \
MGW_GATEWAY_ID='已有网关 UUID' \
MGW_TOKEN='已有设备 token' \
node bin/webrtc-client.mjs
# 加 --ws-only 可对照 WebSocket。
```

建议通过已有秘密管理方式注入环境，不将真实凭据粘进共享日志或命令历史。工具验证 gatewayId、真实 hello、ping 和 workspaces，只输出阶段与承载。不会因失败自动重发写操作。测试失败注入和独立运行库互通见 `test/webrtc/`。

KMP 需在 GatewayTransport 下增加协商 wrapper 与 MGW1 编解码，延后 SplitGatewayTransport 的 conversation 握手；Android 增加原生 RTC adapter；iOS 抽出 GatewayClient 的传输边界。业务 UI 不接触 SDP、票据或 PC。当前仓库未修改这些 App 代码。

`/mgw/status.webrtc` 返回 enabled、mode、runtime、pending、activeGroups、stunConfigured 及每组两通道的规范化路径，不含候选 IP、SDP、票据或 token。路径来自实际选中的 candidate pair：私有 host/host 为 LAN，其余已知非 relay 为 P2P，未知则显示“WebRTC，路径待确认”。不能根据“开了开关”宣称设备正在 P2P。Cloudflare 仍可能终止信令 WSS 的 TLS；DTLS 不是抵御信令服务被控制的应用层 E2EE。

验证边界与实测记录见 [运行库决策](webrtc-runtime-decision.md) 和 [验收记录](webrtc-acceptance.md)。


## 管理页连接偏好（2026-10-31）

`GET /mgw/status` 新增 `pairingRoute`、`p2pUrl`、`tailscaleUrl` 和 `tailscale: { addresses, urls }`（本机网卡检测结果），`webrtc` 新增 `stunServers`。`POST /mgw/connection` 接收：

```json
{"route":"p2p","stunServers":[],"p2pUrl":"wss://your-gateway/ws/mobile"}
```

`route` 支持 `p2p`、`cloudflare`、`auto-lan`、`auto`、`lan`、`custom`、`tailscale`。`tailscale` 方案使用 `{ "route": "tailscale", "tailscaleUrl": "ws://100.64.0.10:3081/ws/mobile" }` 保存地址；该字段可省略以保留原值，空字符串清除地址，仅接受 `ws://` 与 Tailscale IPv4/IPv6 字面地址。该方案的配对 API 拒绝公网或普通局域网首选地址，二维码候选入口也仅保留 Tailscale 地址。检测结果不证明 tailnet 登录状态或手机可达性。`stunServers` 和 `p2pUrl` 可省略以保留原值；空 STUN 数组恢复 Cloudflare 默认发现服务；空地址字符串清除自定义配对入口。保存前校验协议、STUN 限制及字段类型；请求沿用本机管理面与同源校验。选择写入网关状态文件，文件权限 `0600`，不改变网关身份或设备凭证。新连接按最新选择创建传输，已存在的 RTC 组继续使用创建时的配置。


## 服务端网络检测

入口：移动设备 → 网络检测。页面可见且在前台时，每轮完成后间隔 2 秒调用 POST /mgw/network-test；退出、关闭窗口、进入后台会取消请求与探测监听，不影响设备业务连接。接口沿用本机管理面和同源校验，并发请求返回 409，1 秒内复用结果，最多 8 个通道并发、256 条连接；超出时提示截断。

响应按设备分组，列出控制/会话/兼容通道、连接代际、实际 WebSocket/WebRTC、RTC LAN/P2P 路径、RTT、统计和最近一分钟曲线。不返回 ICE 原始地址、凭证或 SDP。

WebSocket 使用随机相关载荷的协议 Ping/Pong，3 秒超时。Tunnel/代理可能自行处理协议 Ping，数值可能仅反映代理连接对端，不应当作 App 端到端 RTT；后者仍见手机网络检测页。

RTC 从 Worker 读取已选中 ICE pair 的统计，秒转毫秒，显示最近与连接平均 RTT。只有 ICE 测量计数变化才加入曲线点。无样本、断线、超时显示空值；读取异常不触发重连。Worker 统计 RPC 有超时和清理机制。


## 2026-10-31 网关增量 ICE 建连优化

网关使用固定的 werift 0.25.2。原实现等待所有本地候选和 STUN 探测结束后才返回 SDP 应答并启动 ICE/DTLS，单个不可达接口可能占满默认 5 秒探测预算。

`lib/rtc-trickle.mjs` 在 Worker 内适配该固定版本的收集步骤：首个本地候选可用后允许原有握手继续，其他候选和 STUN 探测照常在后台完成，不缩短发现公网地址的预算。远端候选立即处理，远端候选结束标记延后至本地收集结束，防止候选尚未齐备就提前判定失败。已在 SDP 宣告候选结束的客户端沿用完整收集路径。

双通道绑定、整组提交、票据与 DTLS 指纹验证仍由现有协议处理。后续收集异常会报告为可恢复的传输故障，关闭会释放收集等待；每个协商组仍使用独立 Worker。适配涉及固定版本的内部 `gatherCandidates` 方法，升级 werift 前必须运行 `trickle-unit.test.mjs` 和 `trickle.test.mjs`，确认 API 和实际 ICE/DTLS 行为一致。

本次无需新增配置。更新并重启网关后，已有支持 P2P 的移动端重新连接即可使用。没有修改 App 或 STUN 配置，也没有自动重启运行中的网关。
