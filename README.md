<p align="center">
  <img src="docs/assets/whale-girl-ios-app-promo-16x9.png" alt="DeepSeek Harness Mobile 与移动网关" width="100%">
</p>

# dsh-plugin-mobile-gateway

让 iPhone 通过经过设备鉴权的 WebSocket 连接 DeepSeek Harness。安装后，Harness WebUI 左侧边栏会出现“移动设备”入口，可直接开启网关、生成配对二维码和管理可信设备。

- WebSocket：`/ws/mobile`
- 局域网：`ws://<局域网 IP>:3081/ws/mobile`
- 公网：`wss://<公网 IP>/ws/mobile`
- 协议文档：[PROTOCOL.md](PROTOCOL.md)

## 配套 iOS 客户端

[DeepSeek Harness Mobile](https://github.com/Clarklevis1995/dsh-mobile) 是本仓库的兄弟项目。它是面向 iOS 17+ 的 SwiftUI 原生客户端，支持工作区与会话、历史和实时对话、图片、Agent 执行轨迹、Human-in-the-loop、模型与权限设置。

<table>
  <tr>
    <td width="33.33%" align="center"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/main/Docs/images/screenshots/home.png" alt="iOS 工作区首页" width="100%"></td>
    <td width="33.33%" align="center"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/main/Docs/images/screenshots/conversation-dark.png" alt="iOS 深色对话界面" width="100%"></td>
    <td width="33.33%" align="center"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/main/Docs/images/screenshots/pairing-dark.png" alt="iOS 设备配对界面" width="100%"></td>
  </tr>
  <tr>
    <td align="center"><strong>工作区首页</strong></td>
    <td align="center"><strong>实时对话</strong></td>
    <td align="center"><strong>设备配对</strong></td>
  </tr>
</table>

## 安装插件

前提：已经安装 `dsh` CLI，并能正常启动 `dsh web`。

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

安装后停止并重新启动 WebUI：

```bash
dsh web
```

打开 WebUI，确认左侧边栏底部出现“移动设备”。

## 局域网配对

适用于 DSH 电脑和 iPhone 位于同一个可互访的局域网。

1. 打开 WebUI 的“移动设备”。
2. 开启“允许移动设备连接”。
3. 保持“设备鉴权”开启。
4. 确认面板显示 `ws://<电脑局域网 IP>:3081/ws/mobile`。
5. 填写设备名称并点击“生成配对二维码”。
6. 在 iOS 客户端打开“设备认证”，扫描二维码。
7. WebUI 的可信设备显示“在线”后即完成。

如果系统防火墙拦截连接，只允许私有网络访问 TCP `3081`。不要把 3081 开放到公网。

## 公网 IP 配对

适用于带固定公网 IPv4 的 Ubuntu/Debian 服务器（其他发行版本可自行尝试）。Node.js 通过 nvm 安装时，也使用下面的命令。

### 1. 配置端口

从云厂商控制台复制服务器的公网 IPv4，并在安全组中放行入站 TCP `80` 和 `443`。

不要开放 TCP `3080` 和 `3081`！！！
不要开放 TCP `3080` 和 `3081`！！！
不要开放 TCP `3080` 和 `3081`！！！

### 2. 配置公网入口

把示例 IP 替换为云厂商控制台中的实际公网 IPv4：

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest setup \
  --ip 203.0.113.10 \
  --port 3080
```

安装器完成后，重新启动：

```bash
dsh web
```

### 3. 打开远程 WebUI（使用端口转发，VSCode等IDE自带）

如果 WebUI 运行在远程服务器，在自己的电脑执行：

```bash
ssh -N -L 3080:127.0.0.1:3080 <服务器用户名>@<服务器公网 IP>
```

然后在本地浏览器打开：

```text
http://127.0.0.1:3080
```

### 4. 使用 WebUI 配对

1. 打开“移动设备”。
2. 开启“允许移动设备连接”。
3. 保持“设备鉴权”开启。
4. 确认 WebSocket 地址为 `wss://<公网 IP>/ws/mobile`。
5. 填写设备名称并点击“生成配对二维码”。
6. iPhone 打开“设备认证”，扫描二维码；也可以复制 Base64URL 配对字符串手动连接。
7. WebUI 的可信设备显示“在线”后即完成。

二维码只能使用一次，并会在 5 分钟后过期；超时后在 WebUI 重新生成即可。

## 公网入口管理

查看状态：

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

移除公网入口：

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## 更新插件

重新安装 npm 最新版本：

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

随后停止并重新启动 `dsh web`。

## 卸载插件

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

## 常见问题

| 现象 | 处理方式 |
|---|---|
| WebUI 没有“移动设备” | 确认安装在 `web` profile，并完整重启 `dsh web` |
| iOS 收到 `503` | 回到 WebUI 开启“允许移动设备连接” |
| iOS 收到 `401` | 在 WebUI 重新生成二维码并配对 |
| 公网连接超时 | 检查云安全组、服务器防火墙和 TCP `80/443` |
| 公网地址没有自动显示 | 确认已执行 `setup --ip <公网 IP>`，然后重启 `dsh web` |
| 需要查看服务端日志 | 执行 `tail -f /tmp/mobile-gateway.log` |

## 源码开发

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

源码修改后需要重新安装插件并重启 `dsh web`。
