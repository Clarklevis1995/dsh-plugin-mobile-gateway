# 公网 IP 命令行配对指南

适用于通过 nvm 安装 Node.js、已经可以直接使用 `dsh` 命令的 Ubuntu/Debian 服务器。服务器端不需要打开 WebUI：终端会直接输出 iOS 所需的 Base64URL 配对字符串。

## 1. 放行公网端口

先在云安全组中放行 TCP `80` 和 `443`。不要开放 `3080`、`3081` 或 `/mgw/*`。

如果服务器启用了 UFW：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 2. 安装插件和辅助命令

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
sudo apt-get update
sudo apt-get install -y jq tmux
```

## 3. 配置公网 WSS

获取服务器公网 IPv4：

```bash
PUBLIC_IP="$(curl -4 -fsS https://ifconfig.me)"
printf 'Public IP: %s\n' "$PUBLIC_IP"
```

如果显示的不是服务器实际公网 IPv4，请手动执行 `PUBLIC_IP="实际公网IP"`。

因为 Node.js 来自 nvm，运行安装器时需要把当前 `PATH` 传给 `sudo`：

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest setup \
  --ip "$PUBLIC_IP" \
  --port 3080
```

安装成功后检查：

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

应显示：

```text
wss://<公网IP>/ws/mobile
```

## 4. 启动 DSH

```bash
tmux new -s dsh
dsh web
```

看到 `dsh web: http://127.0.0.1:3080` 后，按 `Ctrl+B`，再按 `D`，让 DSH 在后台继续运行。

## 5. 在终端生成配对字符串

重新读取公网地址，并明确开启设备鉴权和移动网关：

```bash
PUBLIC_IP="$(curl -4 -fsS https://ifconfig.me)"
PUBLIC_URL="wss://$PUBLIC_IP/ws/mobile"

curl -fsS -X POST http://127.0.0.1:3080/mgw/auth \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}'

curl -fsS -X POST http://127.0.0.1:3080/mgw/gateway \
  -H 'Content-Type: application/json' \
  -d '{"enabled":true}'
```

生成一次性 Base64URL 配对字符串：

```bash
PAIRING_TEXT="$(
  jq -nc --arg name 'iPhone' --arg url "$PUBLIC_URL" \
    '{name:$name,publicUrl:$url}' \
  | curl -fsS -X POST http://127.0.0.1:3080/mgw/pair \
      -H 'Content-Type: application/json' \
      --data-binary @- \
  | jq -r '.qrPayload'
)"

if [ -z "$PAIRING_TEXT" ] || [ "$PAIRING_TEXT" = 'null' ]; then
  echo '生成配对字符串失败，请检查 DSH 和插件日志'
else
  printf '\n复制下面这一整行到 iPhone：\n\n%s\n\n' "$PAIRING_TEXT"
fi
```

配对字符串只能使用一次，并在 5 分钟后过期。如果超时，重新执行本节最后两段命令。

## 6. 在 iPhone 完成绑定

1. 打开 iOS 客户端的“设备认证”。
2. 把终端输出的整行内容粘贴到“手动输入配对信息”。
3. 点击“配对并连接”或“重新配对并连接”。
4. 状态显示“已连接”后点击“完成”。

iOS 会把长期设备凭证保存到 Keychain，之后启动时会自动重新连接，不需要再次执行配对。

## 7. 检查结果

服务器查看可信设备：

```bash
curl -fsS http://127.0.0.1:3080/mgw/devices | jq
```

查看插件日志：

```bash
tail -f /tmp/mobile-gateway.log
```

常见结果：

- `503`：移动网关未开启，重新执行第 5 节的网关开启命令。
- `401`：配对字符串过期、已使用或客户端凭证无效，重新生成配对字符串。
- 公网连接超时：检查云安全组、UFW、Nginx，以及 TCP `80/443`。

查看后台 DSH：

```bash
tmux attach -t dsh
```
