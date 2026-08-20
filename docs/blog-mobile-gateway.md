# 让手机成为 AI Agent 的第二块屏幕：dsh-plugin-mobile-gateway

> 一个给 DeepSeek Harness 写的常驻插件：在不改动宿主一行代码的前提下，为移动端加上一条经过设备鉴权的实时通道。

---

## 一、它解决什么问题

用过 CLI 形态 Coding Agent 的人大概都有同一个体验：给 Agent 派一个稍复杂的任务，它开始读文件、跑测试、改代码，一轮下来三五分钟。这三五分钟里你被钉在电脑前——不是因为你要做什么，而是因为你**不知道它做到哪了**。

`dsh-plugin-mobile-gateway` 要解决的就是这件事：

> **把手机变成远端 Agent 的第二块屏幕**——实时看到思考、工具调用和回答，随时下发新任务。

![移动设备管理面板](assets/mobile-device-management.png)

它的定位很轻：**不重新实现任何 Agent 逻辑**，只是把 DSH 浏览器 UI 用的那套官方 Host API 和 `session/event` 事件流，转译成一套精简的 JSON WebSocket 协议转发给手机。

---

## 二、当前支持的网络范围

这是需要先说清楚的边界：

| 场景 | 支持情况 |
|---|---|
| 家庭局域网（同一路由器下） | ✅ 已支持，零配置 |
| 办公局域网 | ✅ 已支持，零配置 |
| 可信 VPN 网络（WireGuard / 企业 VPN 等） | ✅ 已支持 |
| 本机浏览器调试 | ✅ 已支持 |
| **公网直连** | 🚧 **开发中** |

也就是说，**当前版本的定位是"可信私有网络内的移动端遥控"**。手机和电脑需要处在同一个可互访的私有网络里——同一个 Wi-Fi，或者通过 VPN 接入同一段内网。

> VPN 场景的前提：VPN 需要给客户端分配 RFC 1918 私有地址（如 `10.x.x.x`、`192.168.x.x`、`172.16-31.x.x`），这样才能通过插件的来源校验。

公网连接能力正在开发中。这不是技术难度问题，而是**安全边界问题**：一旦端点暴露到公网，就必须同时解决 TLS 终止、证书生命周期、速率限制、日志脱敏、暴力破解防护等一整套问题。在这些没有稳妥收口之前，插件选择把网络面**严格限制在私有网段**，宁可少一个场景，不留一个开口。

---

## 三、连接原理

### 3.1 两个监听器，各管一段

DSH 自己坚持只监听 `127.0.0.1`，这是它的安全立场。插件没有去改宿主、也没有劝它放开，而是**自己开了第二个窄口径 HTTP server**：

| 监听器 | 地址 | 提供什么 |
|---|---|---|
| DSH 自带（宿主） | `127.0.0.1:3080` | WebUI + `/mgw` 管理接口 + `/ws/mobile` |
| **插件自建（LAN）** | `0.0.0.0:3081` | **只有** `/ws/mobile`，别的全部 404 |

插件自建的这个监听器做了三层收窄：

```js
lanServer = http.createServer((req, res) => {
  sendJson(res, 404, { error: 'not-found' })          // ① 普通 HTTP 请求一律 404
})

lanServer.on('upgrade', (req, socket, head) => {
  if (pathname !== wsPath) {
    rejectUpgrade(socket, 404, 'not found')            // ② 只认 /ws/mobile 这一条路径
    return
  }
  if (!isPrivateNetworkHostname(req.socket.remoteAddress)) {
    rejectUpgrade(socket, 403,                         // ③ 只接受私有网段来源
      'LAN listener accepts private-network clients only')
    return
  }
  handleMobileUpgrade(req, socket, head, { lan: true, port: lanBoundPort })
})
```

它**不提供 WebUI、不提供管理接口**。暴露到局域网的，只是一个"只能做鉴权 WebSocket 连接"的端点。

更关键的一点：WebUI 上那个 Debug 用的"关闭设备鉴权"开关**管不到它**——

```js
// LAN 入口无条件强制鉴权，Debug 开关只影响 loopback
if ((requireAuth || transport.lan === true) && !device) {
  logAuthRejected(req)
  rejectUpgrade(socket, 401, 'missing or invalid device credential')
  return
}
```

一个"方便调试"的开关，永远不可能把暴露在局域网上的端点变成开放控制面。

### 3.2 私有网段判定

来源校验和地址合法性校验都走同一个函数，覆盖 IPv4 私有段、链路本地、`.local` 主机名，以及 IPv6 的 `fc00::/7` 和 `fe80::/10`：

```js
function isPrivateNetworkHostname(hostname) {
  let normalized = hostname.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  if (normalized.startsWith('::ffff:')) normalized = normalized.slice('::ffff:'.length)
  if (isLocalHostname(normalized) || normalized.endsWith('.local')) return true

  const octets = normalized.split('.').map(Number)
  if (octets.length === 4 && octets.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) {
    return octets[0] === 10                                        // 10.0.0.0/8
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) // 172.16.0.0/12
      || (octets[0] === 192 && octets[1] === 168)                  // 192.168.0.0/16
      || (octets[0] === 169 && octets[1] === 254)                  // 链路本地
  }
  return /^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(normalized)
}
```

这个函数同时也是"什么地址允许用明文 `ws://`"的唯一判据。只有 localhost、`.local` 和上面这些私有段可以用 `ws://`，其他地址一律要求 `wss://`：

```js
if (url.protocol === 'ws:' && !isPrivateNetworkHostname(url.hostname))
  throw badRequest('publicUrl must use wss:// outside localhost or a private LAN')
```

### 3.3 地址自动探测

用户不需要自己查 IP。面板打开时插件会枚举网卡，并且**把虚拟网卡降级为 fallback**，优先展示物理网卡地址：

```js
function privateLanAddresses() {
  const physical = []
  const fallback = []
  const virtualInterface = /^(?:docker|br-|veth|utun|awdl|llw|vmnet|vbox|virbr|tailscale|wg)/i
  for (const [name, records] of Object.entries(os.networkInterfaces())) {
    for (const record of records || []) {
      if (!record || record.internal || record.family !== 'IPv4'
          || !isPrivateNetworkHostname(record.address)) continue
      const target = virtualInterface.test(name) ? fallback : physical
      if (!target.includes(record.address)) target.push(record.address)
    }
  }
  return physical.length ? physical : fallback
}
```

有了这段，面板里显示的就是 `192.168.1.23` 而不是某个 Docker 桥地址。**这个细节决定了"零配置"到底成不成立。**

面板最终填入的地址优先级是：配置的公网地址 → 局域网探测地址 → 从当前页面推断。用户手动改过之后，轮询不会再覆盖。

### 3.4 双向数据流

**下行（Agent → 手机）**：监听宿主的 `session/event`，和浏览器 UI 消费的是同一条 feed：

```js
const disposeEvents = ctx.on('session/event', (session, event) => {
  if (clients.size === 0) return              // 无客户端时零开销
  const wire = buildWireEvent(session, event) // 压成小 JSON
  if (!wire) return
  const payload = JSON.stringify(wire)
  for (const client of clients) {
    if (client.filterSessionId && client.filterSessionId !== String(session.id)) continue
    if (client.readyState === 1) client.send(payload)
  }
})
```

`buildWireEvent` 遵守一条纪律（源码注释原文）：

> Reads only leaf fields of the live SessionEvent — never serializes live objects.

**只读叶子字段，绝不序列化活对象。** 既避免把宿主内部结构泄漏到网线上，也避免循环引用和意外的巨型 payload。

**上行（手机 → Agent）**：走官方 API，不开旁路：

```js
const resp = await api.sessions.prompt({
  rpcId: crypto.randomUUID(),
  payload: { sessionId, mode, content: [{ type: 'text', text }] },
})
```

手机发的消息和浏览器提交的 prompt **走完全相同的路径**。`mode` 支持 `queue`（排队）和 `steer`（打断当前回合）。

---

## 四、配对原理

这是整个插件的安全核心。设计目标是：**长期凭证只在网线上出现一次，服务端磁盘上永远没有明文。**

### 4.1 完整流程

```
[WebUI]  点击"生成配对二维码"
   │
   ├─ createPairing()
   │    生成 256-bit 一次性配对码
   │    内存 Map 只存 SHA-256(code)，明文不落盘、不持久化
   │    5 分钟后过期
   │
   ├─ payload = { version:2, publicUrl, pairingCode, expiresAt }
   ├─ Base64URL（无 padding）编码
   └─ 渲染成 QR SVG，同时提供文本供手动粘贴

[iOS]  扫码 / 粘贴后建立连接
   │    Sec-WebSocket-Protocol: dsh-mobile-v1, dsh-pair.<code>
   │    X-DSH-Device-ID: <Keychain 中的安装级 UUID>
   │
   ├─ claimPairing()：先 delete 再干活 → 严格单次使用
   ├─ 签发 256-bit 长期 token
   ├─ 落盘只存 tokenHash（SHA-256）
   └─ 下发 { kind:'paired', token, device }   ← 仅此一次，不会再下发

[iOS]  token 写入 Keychain
   │
   └─ 后续所有连接：
        Authorization: Bearer <token>                        （推荐）
        或 Sec-WebSocket-Protocol: dsh-mobile-v1, dsh-auth.<token>
```

### 4.2 核心代码：签发与单次使用

```js
claimPairing(code, clientDeviceId) {
  prunePairings()
  if (typeof code !== 'string' || code === '') return undefined
  const codeHash = digest(code)
  const pairing = pairings.get(codeHash)
  if (!pairing) return undefined

  // 先删除再做后续工作：即使之后 socket upgrade 失败，这个码也已作废
  pairings.delete(codeHash)

  const token = crypto.randomBytes(32).toString('base64url')
  const normalizedClientDeviceId = normalizeClientDeviceId(clientDeviceId)

  // 同一台 iOS 重新配对时复用已有设备记录，只轮换凭证，不产生重复行
  let device = normalizedClientDeviceId
    ? devices.find((c) => !c.revokedAt && c.clientDeviceId === normalizedClientDeviceId)
    : undefined
  if (device) {
    device.name = pairing.name
    device.tokenHash = digest(token)          // 只存摘要
    device.clientDeviceId = normalizedClientDeviceId
  } else {
    device = {
      id: pairing.id,
      name: pairing.name,
      clientDeviceId: normalizedClientDeviceId,
      tokenHash: digest(token),               // 只存摘要
      createdAt: Date.now(),
      lastSeenAt: null,
      revokedAt: null,
    }
    devices.push(device)
  }
  save()
  return { device: publicDevice(device, 0), token }   // token 只在此刻返回
}
```

注意 `pairings.delete(codeHash)` 的位置——**在做任何其他工作之前**。这样即使后续 WebSocket 握手失败，这个配对码也已经作废了，不存在"失败可重试所以能被反复尝试"的窗口。

### 4.3 核心代码：凭证校验

```js
function digest(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
}

// 定长 + timing-safe 比较，不泄漏比较进度
function safeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b)
}

authenticate(token, clientDeviceId) {
  if (typeof token !== 'string' || token === '') return undefined
  const tokenHash = digest(token)
  const device = devices.find(
    (c) => !c.revokedAt && safeEqualHex(c.tokenHash, tokenHash))
  // ... 老设备补绑 clientDeviceId 的迁移逻辑
  return device ? publicDevice(device, online.get(device.id) || 0) : undefined
}
```

### 4.4 凭证提取：为什么 token 不走 URL

```js
function extractCredential(req, allowQueryToken) {
  // ① 首选 Authorization 头，且严格校验长度（32 字节 base64url = 43 字符）
  const authorization = req.headers.authorization
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+([A-Za-z0-9_-]{43})$/i.exec(authorization.trim())
    if (match) return { kind: 'token', value: match[1] }
  }

  // ② 次选 WebSocket 子协议（不会进入常见的 URL access log）
  for (const protocol of parseProtocols(req)) {
    if (protocol.startsWith('dsh-auth.')) return { kind: 'token', value: protocol.slice(9) }
    if (protocol.startsWith('dsh-pair.')) return { kind: 'pairing', value: protocol.slice(9) }
  }

  // ③ 一次性配对码允许走 query（兼容性）；长期 token 默认禁止
  const query = new URL(req.url || '/', 'http://localhost').searchParams
  const pairing = query.get('pairingCode')
  if (pairing) return { kind: 'pairing', value: pairing }
  const token = allowQueryToken && query.get('token')
  if (token) return { kind: 'token', value: token }
}
```

长期 token 默认禁止放在 URL query（`allowQueryToken: false`），因为 query 会进入反向代理 access log、浏览器历史、APM 监控系统。而一次性配对码允许走 query——它单次使用 + 5 分钟过期，威胁窗口极小。

还有一处容易被忽略的防护：**密钥绝不回显为协商结果**。鉴权信息可以搭在子协议里传，但服务端握手时只回固定值：

```js
handleProtocols(protocols) {
  return protocols.has('dsh-mobile-v1') ? 'dsh-mobile-v1' : false
}
```

### 4.5 `X-DSH-Device-ID` 不是凭证

这点文档里反复强调过。它是客户端在 Keychain 里持久保存的安装级随机 UUID，唯一作用是**重新配对时复用同一条可信设备记录**，避免每次重连都刷出一堆重复设备行。它不能替代配对码或 token 完成鉴权：

```js
function extractClientDeviceId(req) {
  const value = req.headers['x-dsh-device-id']
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return /^[A-Za-z0-9._:-]{8,128}$/.test(normalized) ? normalized : undefined
}
```

配对时**必须**携带它，缺失直接 400 拒绝（提示升级客户端）。

### 4.6 关于 Base64URL 的诚实标注

配对载荷用 Base64URL 编码，源码注释写得很直白：

> Base64URL is copy-safe and QR-safe (`+`, `/`, and `=` never appear), but is **encoding rather than encryption**; secrecy still comes from the short TTL and single-use pairing code.

没有把 Base64 包装成"加密"，而是说清楚"保密性来自短 TTL 和单次使用"。这种诚实的注释比任何安全声明都可靠——它让后来的维护者知道**安全边界到底在哪**。

### 4.7 其余配对相关的安全措施

- **默认关闭 + 自愈**：网关默认 `false`；手动开启后 5 分钟内无设备连上会自动关闭（"忘记关掉"是最常见的人为漏洞）
- **文件权限**：设备文件 `0600`、目录 `0700`、临时文件 + `rename` 原子写入
- **格式迁移**：旧开发版的明文 token 会被自动 hash，下次保存时清除明文
- **管理面隔离**：`/mgw/*` 默认只接受 loopback；写操作额外要求同源（防 CSRF）；请求体上限 16 KiB
- **即时吊销**：删记录 + close code `4003` 踢掉现有连接，token 永久失效
- **日志抑制**：失败尝试按 30 秒窗口聚合，避免日志被刷爆，同时保留 remote / origin / user-agent 便于溯源

约定的 close code，客户端可以据此写状态机：

| 信号 | 含义 | 客户端应做 |
|---|---|---|
| `4003` | 鉴权被重新开启 / 设备被吊销 | 用 token 重连，失败则重新配对 |
| `4004` | 移动网关已关闭 | **停止自动重连** |
| HTTP `503` | 网关未开启 | 停止高频重连，等用户开启 |
| HTTP `401` | 凭证缺失 / 无效 / 被吊销 | 清除 Keychain，进入重新配对 |

---

## 五、插件是怎么挂上去的

DSH 用 Cordis 的依赖注入容器编排"服务行"。插件通过 `package.json` 的 `dsh.bundle.patch` 声明一个组合树补丁：

```yaml
# cordis.patch.yml
- insert:
    - id: mobile-gateway
      name: 'dsh-plugin-mobile-gateway'
      config:
        gatewayEnabled: false      # 默认关闭
        requireAuth: true          # 默认强制鉴权
        adminLoopbackOnly: true    # 管理面仅本机
        lanEnabled: true
        lanHost: 0.0.0.0
        lanPort: 3081
```

同时声明硬依赖，Cordis 保证服务就绪后才激活它：

```js
const plugin = {
  name: 'mobile-gateway',
  Config,
  inject: ['webServer', 'apiProxy', 'typertGateway', 'agentDefaultModel'],
  apply(ctx, config) { /* ... */ },
}
```

配置 schema 里的默认值全部站在安全一侧，注释写明了理由：

```js
// Secure by default: installing the bundle must never create an
// unauthenticated network control plane.
const Config = Schema.object({
  path: Schema.string().default('/ws/mobile'),
  requireAuth: Schema.boolean().default(true),
  gatewayEnabled: Schema.boolean().default(false),
  gatewayWaitTimeoutMs: Schema.natural().min(30_000).max(30 * 60 * 1000).default(300_000),
  adminLoopbackOnly: Schema.boolean().default(true),
  pairingTtlMs: Schema.natural().min(30_000).max(15 * 60 * 1000).default(300_000),
  allowQueryToken: Schema.boolean().default(false),
  lanEnabled: Schema.boolean().default(false),
  lanHost: Schema.string().default('0.0.0.0'),
  lanPort: Schema.natural().min(1).max(65535).default(3081),
})
```

浏览器侧的管理面板（`lib/client.js`）用 `React.createElement` 写成，**没有 JSX、没有打包步骤**，只往两个 slot 插东西，不替换任何官方 UI 座位：

```js
function apply(ctx) {
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    { name: 'sidebar.footer.action', id: 'mobile-gateway-devices', order: 80, label: '移动设备' },
    (props) => React.createElement(FooterButton, props),
  ))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'mobile-gateway-devices-panel', order: 100, label: '移动设备' },
    () => React.createElement(OverlayEntry),
  ))
}
```

---

## 六、安装方式

### 1. 安装插件（无需下载源码）

确保本机已能正常运行 DSH，然后：

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway
```

这条命令会从 npm 获取插件、安装依赖，并把它加入 `web` profile 的 bundle 列表。**不需要 clone 仓库，不需要 `pnpm install`。**

固定版本或直接装 GitHub 版：

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@0.4.2
dsh plugin --profile web add github:Clarklevis1995/dsh-plugin-mobile-gateway
```

### 2. 重启 WebUI（最容易踩的坑）

插件组合树**只在 WebUI 启动时加载**。刷新浏览器无效，必须停掉 `dsh web` 再重新启动。

启动前可以先验证插件是否进了组合配置：

```bash
dsh --profile web --dump-config | grep -A3 mobile-gateway
```

启动后左侧边栏底部出现"移动设备"入口，即安装成功。

### 3. 局域网连接（零配置）

重启后插件自动开一个 `3081` 监听。打开"移动设备"面板，"WebSocket 地址"会自动填好：

```text
ws://<运行 DSH 的电脑私有 IP>:3081/ws/mobile
```

需要注意：

- 手机和电脑必须在**可互访**的同一私有网络（访客 Wi-Fi 通常开了客户端隔离，不行）
- 系统防火墙询问时，允许 Node 接收私有网络入站连接（TCP `3081`）
- VPN 场景下，确认 VPN 分配的是 RFC 1918 私有地址

### 4. 配对 iOS 客户端

1. 面板里填设备名称（如 `iPhone`），保持"设备鉴权"开启
2. 开启"允许移动设备连接"
3. 点击"生成配对二维码"
4. iOS 客户端首页点认证按钮 → 扫码，或粘贴复制的 Base64URL 配对 Token
5. 首次连接成功后长期凭证写入 Keychain；面板中设备显示"在线"即完成

配对二维码**一次性使用、5 分钟过期**。之后启动 App 直接用 Keychain 凭证重连，不需要再扫码。重新配对同一套安装会复用设备身份，不会产生重复记录。

### 5. 更新与卸载

```bash
# 更新（插件不会自动更新）
dsh plugin --profile web remove dsh-plugin-mobile-gateway
dsh plugin --profile web add dsh-plugin-mobile-gateway
# 然后重启 dsh web

# 卸载（不会自动删除 ~/.dsh/mobile-gateway-devices.json）
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

### 6. 常见问题速查

| 现象 | 原因与处理 |
|---|---|
| 侧边栏没有"移动设备" | 确认用了 `--profile web`；`--dump-config` 检查组合树；**完整重启** `dsh web` |
| iOS 提示 `503` | 网关未开启，回 WebUI 打开"允许移动设备连接" |
| iOS 提示 `401` | 配对码过期 / 凭证无效 / 设备已被吊销；清除旧凭证重新配对 |
| iOS 提示 `403` | 来源不在私有网段（比如走了公网出口） |
| 真机连不上 `127.0.0.1` | 在手机上 `127.0.0.1` 指手机自己；用面板给出的私有 IP 地址 |
| 同 Wi-Fi 仍连不上 | 网络可能开了客户端隔离；放行电脑入站 TCP `3081` |
| 修改配置没生效 | 插件与组合配置只在启动时加载，需重启 WebUI |
| 需要排查服务端 | 看 `/tmp/mobile-gateway.log`，含连接 / 鉴权 / 查询 / 错误记录 |

### 7. 源码开发

只有需要修改插件本身时才用：

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
```

`file:` 是**复制安装**，改完源码必须先 remove 再 add 并重启。**不要用 `link:`**——依赖会从源码目录解析，导致 `ws` 等包找不到。

测试：

```bash
NODE_PATH=/path/to/dsh/node_modules node test/auth.test.mjs      # 鉴权 / 配对 / 吊销
NODE_PATH=/path/to/dsh/node_modules node test/gateway.test.mjs   # 完整协议链路
node test/lan.test.mjs                                            # 局域网监听 / 强制鉴权 / 管理接口隔离
```

---

## 七、小结

这个插件在技术上不"炫"——没有新算法，没有花哨架构。它的价值在于把一件具体的事做干净了，并且在每个岔路口都选了更克制的那一边：

- 想要局域网访问时，**没有**去让宿主监听 `0.0.0.0`，而是自己开一个只做一件事的窄口径监听
- 给了 Debug 开关，但把它**限制在 loopback + 当前进程 + 重启复位**
- 长期凭证只在网线上出现一次，磁盘上永远只有摘要
- 公网能力没做完，就**老实标明"开发中"**，而不是先开个口子再补安全

在 AI 让"写代码"变得越来越便宜的今天，这种克制反而是更稀缺的能力。

---

### 相关链接

- 项目仓库：[Clarklevis1995/dsh-plugin-mobile-gateway](https://github.com/Clarklevis1995/dsh-plugin-mobile-gateway)
- DeepSeek Harness：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 完整 WebSocket 协议：仓库内 `PROTOCOL.md`

*本文基于 dsh-plugin-mobile-gateway v0.4.2 源码撰写。公网连接能力开发中，后续会另文分享。*
