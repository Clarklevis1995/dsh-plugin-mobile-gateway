// Browser half of dsh-plugin-mobile-gateway. The package manifest makes this
// bundle part of DSH's client-module graph; it contributes one sidebar footer
// action and one shell overlay without replacing shipped UI seats.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-mobile-gateway',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const exports = module.exports
    // UI locale: Chinese stays the default; English is used when the browser
    // (or the mobile app WebView) asks for it. tr() translates plain strings and
    // tagged templates keep interpolation values in order.
    const UI_LOCALE = (() => {
      try {
        const forced = window.localStorage.getItem('mobile-gateway-ui-locale')
        if (forced === 'en' || forced === 'zh' || forced === 'ja') return forced
      } catch { /* storage unavailable */ }
      try {
        if (window.__MGW_UI_LOCALE__ === 'en' || window.__MGW_UI_LOCALE__ === 'zh' || window.__MGW_UI_LOCALE__ === 'ja') return window.__MGW_UI_LOCALE__
      } catch { /* window unavailable */ }
      try {
        const lang = String(navigator.language || '')
        if (/^en\b/i.test(lang)) return 'en'
        if (/^ja\b/i.test(lang)) return 'ja'
        return 'zh'
      } catch { return 'zh' }
    })()
    const EN_UI = {
  "正在读取网关环境…": "Reading gateway environment...",
  "macOS 电脑": "macOS computer",
  "Windows 电脑": "Windows computer",
  "Linux 服务器": "Linux server",
  "当前设备": "this device",
  "当前检测：\u0000；局域网入口\u0000；\u0000。": "Detected: \u0000; LAN entry \u0000; \u0000.",
  "已就绪": "ready",
  "未就绪": "not ready",
  "公网服务器入口已配置": "public server entry configured",
  "\u0000 Tunnel 已连接": "\u0000 Tunnel connected",
  "命名": "named",
  "隧道已连接，公网入口未验证或检测失败": "tunnel connected, public entry not verified or check failed",
  "Cloudflare Tunnel 连接中": "Cloudflare Tunnel connecting",
  "外网入口未连接": "public entry not connected",
  "手机与 DSH 处于可互访的同一局域网时，建议选“局域网直连”。": "When the phone and DSH are on the same reachable LAN, choose \"LAN direct\".",
  "如果手机和 DSH 在同一局域网，先确认局域网入口已开启并监听成功。": "If the phone and DSH are on the same LAN, first confirm the LAN entry is enabled and listening.",
  "手机在外网时，建议使用已配置的公网服务器地址（“自动选择”）。": "When the phone is off-LAN, use the configured public server address (\"Auto\").",
  "手机在外网时，建议选“Cloudflare 外网”；当前命名 Tunnel 有固定域名。": "When the phone is off-LAN, choose \"Cloudflare\"; the named Tunnel has a fixed domain.",
  "手机在外网临时使用时，建议选“Cloudflare 外网”；Quick 地址变化后需要重新确认。": "For temporary off-LAN use, choose \"Cloudflare\"; a Quick address change requires re-confirmation.",
  "手机在外网时，无自有域名可开启 Quick Tunnel；有域名且需要固定地址可配置命名 Tunnel。": "Off-LAN without a domain, enable Quick Tunnel; with a domain and a fixed address, configure a named Tunnel.",
  "手机在外网时，若使用受支持的 Ubuntu/Debian 服务器且有固定公网 IPv4，可先配置“公网接入”，再选“自动选择”。": "Off-LAN on a supported Ubuntu/Debian server with a fixed public IPv4, configure \"Public access\" first, then choose \"Auto\".",
  "手机在外网时，需要一个可访问的 wss:// 地址；可在“手动输入地址”中填写。": "Off-LAN requires a reachable wss:// address; enter it under \"Manual address\".",
  "在线": "Online",
  "离线": "Offline",
  "最近连接：\u0000": "Last seen: \u0000",
  "尚未连接": "Never connected",
  "吊销 \u0000": "Revoke \u0000",
  "吊销中…": "Revoking...",
  "吊销": "Revoke",
  "已刷新 · \u0000": "Refreshed · \u0000",
  "DSH Web 已收到停止指令。需要时可在 Terminal 运行 dsh web 重新启动。": "DSH Web received the stop command. Run `dsh web` in a terminal to start it again.",
  "正在重启 DSH Web，当前连接会短暂中断…": "Restarting DSH Web; the current connection will briefly drop...",
  "DSH Web 重启超时，请检查 /tmp/mobile-gateway.log": "DSH Web restart timed out; check /tmp/mobile-gateway.log",
  "当前浏览器不允许直接写入剪贴板，请选中文本后手动复制": "This browser does not allow direct clipboard writes; select the text and copy it manually",
  "关闭设备鉴权后，任何能访问移动网关的人都可以控制 DSH。此选项仅限 Debug 阶段使用，确定继续吗？": "Disabling device authentication lets anyone who can reach the mobile gateway control DSH. This is for Debug only. Continue?",
  "已吊销 \u0000": "Revoked \u0000",
  "吊销失败：\u0000": "Revoke failed: \u0000",
  "设备配对二维码": "Device pairing QR code",
  "关闭配对窗口": "Close pairing window",
  "使用移动客户端扫码": "Scan with the mobile client",
  "一次性设备配对二维码": "One-time device pairing QR code",
  "Base64URL 配对字符串": "Base64URL pairing string",
  "✓ 已复制": "✓ Copied",
  "复制配对 Token": "Copy pairing token",
  "已复制到剪贴板": "Copied to clipboard",
  "有效期至 \u0000；扫码成功后此二维码立即失效。": "Valid until \u0000; this QR is invalidated immediately after a successful scan.",
  "移动设备管理": "Mobile device management",
  "移动设备": "Mobile devices",
  "正在加载网关状态…": "Loading gateway status...",
  "移动网关已开启 · \u0000": "Mobile gateway on · \u0000",
  "设备鉴权已开启": "device authentication on",
  "本机设备鉴权已关闭": "local device authentication off",
  "移动网关已关闭 · 普通 WebUI 模式": "Mobile gateway off · normal WebUI mode",
  "工具": "Tools",
  "网关工具": "Gateway tools",
  "重启当前网关": "Restart gateway",
  "结束当前进程并重新启动 DSH Web": "End the current process and restart DSH Web",
  "停止 DSH Web": "Stop DSH Web",
  "结束后台进程，所有连接将断开": "End the background process; all connections will drop",
  "关闭": "Off",
  "移动网关设置分组": "Mobile gateway settings group",
  "通用设置": "General",
  "连接与配对": "Connection & pairing",
  "可信设备": "Trusted devices",
  "关闭重启提醒": "Dismiss restart reminder",
  "关闭提醒": "Dismiss",
  "若安装或更新后连接异常，请重启应用": "If connections misbehave after install or update, restart the app",
  "完全退出并重启 APP／Desktop；Web UI 请重启 DSH Web 服务。": "Fully quit and restart the APP/Desktop; for the Web UI, restart the DSH Web service.",
  "端口仍被占用时，请关闭其他 Harness 实例。": "If the port is still in use, close other Harness instances.",
  "网关运行模式": "Gateway mode",
  "重启后保持开启": "Stay on after restart",
  "等待可信设备连接，约 \u0000 分钟后自动关闭": "Waiting for a trusted device; auto-off in ~\u0000 min",
  "设备已连接过，本次运行保持开启；重启后重新计时": "A device has connected; stays on for this run and the timer restarts after a restart",
  "不接受移动设备连接": "No mobile device connections",
  "临时开启": "Temporary",
  "常驻开启": "Persistent",
  "设备鉴权": "Device authentication",
  "已开启，仅允许可信设备连接": "On — only trusted devices may connect",
  "已关闭，仅影响本机 Debug 入口": "Off — affects only the local Debug entry",
  "关闭设备鉴权": "Disable device authentication",
  "开启设备鉴权": "Enable device authentication",
  "Debug 模式：本机 DSH 入口将跳过设备凭证校验；独立局域网入口仍强制鉴权。": "Debug mode: the local DSH entry skips device credential checks; the separate LAN entry still enforces authentication.",
  "配对连接方式": "Pairing route",
  "连接方式说明与场景建议": "Route descriptions and advice",
  "怎么选连接方式": "How to choose a route",
  "局域网直连": "LAN direct",
  "手机与 DSH 在同一个可互访的局域网，使用 ws:// 私有地址；离开该网络就无法直连。": "Phone and DSH on the same reachable LAN, using a private ws:// address; unreachable once off that network.",
  "Cloudflare Channel（命名 Tunnel）": "Cloudflare Channel (named Tunnel)",
  "PC 主动连接 Cloudflare，外网用固定域名的 wss://；需要 Cloudflare 账户和域名。": "The PC dials Cloudflare; off-LAN access uses a fixed-domain wss://; needs a Cloudflare account and domain.",
  "无需账户或域名，Cloudflare 分配临时 wss:// 地址；隧道重建后地址可能变化。": "No account or domain needed; Cloudflare assigns a temporary wss:// address that may change when the tunnel rebuilds.",
  "公网服务器连接": "Public server",
  "DSH 运行在有固定公网 IPv4 的 Linux 服务器上，配置公网入口后用 wss:// 公网 IP 连接。": "DSH runs on a Linux server with a fixed public IPv4; configure public access, then connect via wss:// to the public IP.",
  "结合当前环境": "Based on this environment",
  "面板无法判断手机当前网络；请按手机所在位置选择，提示不会替你修改选择。": "The panel cannot detect the phone’s network; choose based on where the phone is. Hints will not change the selection.",
  "自动选择 · 优先外网": "Auto · prefer off-LAN",
  "局域网直连 · 当前不可用": "LAN direct · currently unavailable",
  "Cloudflare 外网": "Cloudflare (off-LAN)",
  "手动输入地址": "Manual address",
  "外网使用 Cloudflare Tunnel 进行连接，请在下方进行设置。": "Off-LAN connections use Cloudflare Tunnel; configure it below.",
  "WebSocket 地址": "WebSocket address",
  "局域网监听失败：\u0000": "LAN listener failed: \u0000",
  "局域网入口已开启\u0000": "LAN entry on\u0000",
  "，端口 \u0000": ", port \u0000",
  "局域网入口启动中…": "LAN entry starting...",
  "正在生成…": "Generating...",
  "请先开启移动网关": "Enable the mobile gateway first",
  "等待连接地址": "Waiting for an address",
  "生成配对二维码": "Generate pairing QR",
  "配对码仅可使用一次，5 分钟内有效。": "The pairing code is single-use and valid for 5 minutes.",
  "Cloudflare Tunnel · 外网接入": "Cloudflare Tunnel · off-LAN access",
  "首次开启自动准备 Tunnel 组件。": "Enabling it prepares the Tunnel component automatically.",
  "接入方式": "Access method",
  "Cloudflare 接入方式": "Cloudflare access method",
  "Quick Tunnel · 无需域名": "Quick Tunnel · no domain",
  "命名 Tunnel · 固定域名": "Named Tunnel · fixed domain",
  "临时地址可能变化，变化后需重新扫码。": "The temporary address may change; re-scan after a change.",
  "先在 Cloudflare 创建命名 Tunnel，把公开域名的 Service URL 设为 ": "Create a named Tunnel in Cloudflare first, set the public hostname’s Service URL to ",
  "。Tunnel Token 仅授权连接，不能自动创建公开主机名或 DNS；还需确认域名存在指向 Tunnel UUID.cfargotunnel.com 的已代理 CNAME 记录。": ". The Tunnel Token only authorises the connection; it cannot create public hostnames or DNS. Also confirm a proxied CNAME for the domain points to <Tunnel UUID>.cfargotunnel.com.",
  "公开域名": "Public hostname",
  "已保存；留空则保持原 Token": "Saved; leave blank to keep the current token",
  "粘贴 eyJ… Token": "Paste eyJ... token",
  "正在处理…": "Working...",
  "保存并连接": "Save and connect",
  "一键开启 Quick Tunnel": "Enable Quick Tunnel",
  "开启命名 Tunnel": "Enable named Tunnel",
  "检测公网 DNS / TLS / WebSocket": "Check public DNS / TLS / WebSocket",
  "重启 Tunnel": "Restart Tunnel",
  "关闭 Cloudflare Tunnel": "Disable Cloudflare Tunnel",
  "重启会短暂断开连接。": "Restarting briefly drops connections.",
  "未开启": "Off",
  "正在启动本机入口…": "Starting local entry...",
  "正在准备 cloudflared（首次需下载）…": "Preparing cloudflared (downloads on first use)...",
  "正在连接 Cloudflare…": "Connecting to Cloudflare...",
  "隧道传输已连接（不等于公网入口可达）": "Tunnel transport connected (does not mean the public entry is reachable)",
  "等待移动网关开启": "Waiting for the mobile gateway",
  "（检测时间：\u0000）": "(checked at \u0000)",
  "公网接入": "Public access",
  "正在检查系统组件…": "Checking system components...",
  "端口需要更新：Nginx 当前为 \u0000，DSH 当前为 \u0000": "Port update needed: Nginx is \u0000, DSH is \u0000",
  "已配置\u0000": "Configured\u0000",
  "，Nginx 转发至 DSH 端口 \u0000": ", Nginx forwards to DSH port \u0000",
  "Helper 已就绪，将自动使用当前 DSH 端口\u0000": "Helper ready; will use the current DSH port automatically\u0000",
  "服务器公网 IPv4": "Server public IPv4",
  "正在配置 Nginx 与证书…": "Configuring Nginx and certificates...",
  "更新公网配置": "Update public config",
  "配置公网接入": "Configure public access",
  "尚未安装系统 Helper。请在服务器执行一次初始化：": "System Helper is not installed. Run the one-time init on the server:",
  "刷新中…": "Refreshing...",
  "刷新": "Refresh",
  "加载中…": "Loading...",
  "暂无已配对设备。": "No paired devices yet.",
  "当前没有在线设备。": "No devices online.",
  "收起离线设备": "Hide offline devices",
  "展开其他已配对设备（\u0000）": "Show other paired devices (\u0000)",
  "插件版本 \u0000": "Plugin version \u0000",
  "安装应用": "Install app",
  "在手机上安装应用": "Install the app on your phone",
  "手机与这台 DSH 需要在同一局域网，或先连接 VPN。": "The phone and this DSH must be on the same LAN, or the phone must be connected to the VPN first.",
  "下载 Android 安装包 (APK)。": "Download the Android APK.",
  "在浏览器提示时允许“安装未知应用”，然后打开下载的文件完成安装。": "When the browser asks, allow installing unknown apps, then open the downloaded file to install.",
  "打开应用，连接 VPN 后，扫描本页“连接与配对”中的二维码。": "Open the app, connect to the VPN, then scan the QR code under Connection & pairing.",
  "下载 APK": "Download APK",
  "打开最新 Release": "Open latest release",
  "查看 Release": "View release",
  "需要 Android 7 或更高版本。": "Requires Android 7 or later.",
  "先在 App Store 安装 TestFlight。": "Install TestFlight from the App Store first.",
  "加入 Whaleness 公测并安装测试版。": "Join the Whaleness beta and install the test build.",
  "连接 VPN 后，扫描本页“连接与配对”中的二维码。": "Connect to the VPN, then scan the QR code under Connection & pairing.",
  "需要 iOS 17 或更高版本。": "Requires iOS 17 or later.",
  "打开 TestFlight": "Open TestFlight",
  "加入公测": "Join the beta",
  "正在获取最新版本…": "Fetching the latest version...",
  "最新版本": "Latest version",
  "最新版本：\u0000": "Latest version: \u0000"
}
    const JA_UI = {
  "正在读取网关环境…": "ゲートウェイ環境を読み取り中…",
  "macOS 电脑": "macOS コンピュータ",
  "Windows 电脑": "Windows コンピュータ",
  "Linux 服务器": "Linux サーバー",
  "当前设备": "このデバイス",
  "当前检测：\u0000；局域网入口\u0000；\u0000。": "現在の検出結果：\u0000；LAN 入口\u0000；\u0000。",
  "已就绪": "準備完了",
  "未就绪": "未準備",
  "公网服务器入口已配置": "パブリックサーバーの入口が設定済みです",
  "\u0000 Tunnel 已连接": "\u0000 Tunnel が接続されています",
  "命名": "名前付き",
  "隧道已连接，公网入口未验证或检测失败": "トンネルは接続されていますが、パブリック入口は未検証か検出に失敗しました",
  "Cloudflare Tunnel 连接中": "Cloudflare Tunnel に接続中",
  "外网入口未连接": "外部入口が接続されていません",
  "手机与 DSH 处于可互访的同一局域网时，建议选“局域网直连”。": "スマホと DSH が互いに到達できる同じ LAN にある場合は、「LAN 直接接続」がおすすめです。",
  "如果手机和 DSH 在同一局域网，先确认局域网入口已开启并监听成功。": "スマホと DSH が同じ LAN にある場合は、まず LAN 入口が有効で待ち受けできていることを確認してください。",
  "手机在外网时，建议使用已配置的公网服务器地址（“自动选择”）。": "スマホが外部ネットワークにある場合は、設定済みのパブリックサーバーアドレスの使用がおすすめです（「自動選択」）。",
  "手机在外网时，建议选“Cloudflare 外网”；当前命名 Tunnel 有固定域名。": "スマホが外部ネットワークにある場合は、「Cloudflare 外部」がおすすめです。現在の名前付き Tunnel には固定ドメインがあります。",
  "手机在外网临时使用时，建议选“Cloudflare 外网”；Quick 地址变化后需要重新确认。": "スマホを外部ネットワークで一時的に使う場合は、「Cloudflare 外部」がおすすめです。Quick アドレスが変わったら再確認が必要です。",
  "手机在外网时，无自有域名可开启 Quick Tunnel；有域名且需要固定地址可配置命名 Tunnel。": "スマホが外部ネットワークにあり、独自ドメインがなければ Quick Tunnel を有効化できます。ドメインがあり固定アドレスが必要な場合は名前付き Tunnel を設定してください。",
  "手机在外网时，若使用受支持的 Ubuntu/Debian 服务器且有固定公网 IPv4，可先配置“公网接入”，再选“自动选择”。": "スマホが外部ネットワークにあり、対応している Ubuntu/Debian サーバーで固定のパブリック IPv4 を使う場合は、先に「パブリックアクセス」を設定してから「自動選択」を選んでください。",
  "手机在外网时，需要一个可访问的 wss:// 地址；可在“手动输入地址”中填写。": "スマホが外部ネットワークにある場合は、到達できる wss:// アドレスが必要です。「アドレスを手動入力」に記入できます。",
  "在线": "オンライン",
  "离线": "オフライン",
  "最近连接：\u0000": "最終接続：\u0000",
  "尚未连接": "まだ接続されていません",
  "吊销 \u0000": "\u0000 を取り消す",
  "吊销中…": "取り消し中…",
  "吊销": "取り消し",
  "已刷新 · \u0000": "更新済み · \u0000",
  "DSH Web 已收到停止指令。需要时可在 Terminal 运行 dsh web 重新启动。": "DSH Web は停止命令を受け取りました。必要なら Terminal で dsh web を実行して再起動してください。",
  "正在重启 DSH Web，当前连接会短暂中断…": "DSH Web を再起動しています。現在の接続は短時間切断されます…",
  "DSH Web 重启超时，请检查 /tmp/mobile-gateway.log": "DSH Web の再起動がタイムアウトしました。/tmp/mobile-gateway.log を確認してください",
  "当前浏览器不允许直接写入剪贴板，请选中文本后手动复制": "このブラウザではクリップボードへの直接書き込みができません。テキストを選択して手動でコピーしてください",
  "关闭设备鉴权后，任何能访问移动网关的人都可以控制 DSH。此选项仅限 Debug 阶段使用，确定继续吗？": "デバイス認証を無効にすると、モバイルゲートウェイに到達できる人は誰でも DSH を制御できてしまいます。このオプションは Debug 段階専用です。続行しますか？",
  "已吊销 \u0000": "\u0000 を取り消しました",
  "吊销失败：\u0000": "取り消しに失敗しました：\u0000",
  "设备配对二维码": "デバイスペアリング用 QR コード",
  "关闭配对窗口": "ペアリングウィンドウを閉じる",
  "使用移动客户端扫码": "モバイルクライアントでスキャン",
  "一次性设备配对二维码": "ワンタイムのデバイスペアリング用 QR コード",
  "Base64URL 配对字符串": "Base64URL ペアリング文字列",
  "✓ 已复制": "✓ コピーしました",
  "复制配对 Token": "ペアリング Token をコピー",
  "已复制到剪贴板": "クリップボードにコピーしました",
  "有效期至 \u0000；扫码成功后此二维码立即失效。": "有効期限は \u0000 までです。スキャンが成功すると、この QR コードは直ちに無効になります。",
  "移动设备管理": "モバイルデバイス管理",
  "移动设备": "モバイルデバイス",
  "正在加载网关状态…": "ゲートウェイの状態を読み込み中…",
  "移动网关已开启 · \u0000": "モバイルゲートウェイはオンです · \u0000",
  "设备鉴权已开启": "デバイス認証はオンです",
  "本机设备鉴权已关闭": "このマシンのデバイス認証はオフです",
  "移动网关已关闭 · 普通 WebUI 模式": "モバイルゲートウェイはオフです · 通常の WebUI モード",
  "工具": "ツール",
  "网关工具": "ゲートウェイツール",
  "重启当前网关": "現在のゲートウェイを再起動",
  "结束当前进程并重新启动 DSH Web": "現在のプロセスを終了して DSH Web を再起動",
  "停止 DSH Web": "DSH Web を停止",
  "结束后台进程，所有连接将断开": "バックグラウンドプロセスを終了します。すべての接続が切断されます",
  "关闭": "オフ",
  "移动网关设置分组": "モバイルゲートウェイ設定グループ",
  "通用设置": "一般設定",
  "连接与配对": "接続とペアリング",
  "可信设备": "信頼済みデバイス",
  "关闭重启提醒": "再起動リマインダーを閉じる",
  "关闭提醒": "リマインダーを閉じる",
  "若安装或更新后连接异常，请重启应用": "インストールや更新の後に接続がおかしい場合は、アプリを再起動してください",
  "完全退出并重启 APP／Desktop；Web UI 请重启 DSH Web 服务。": "APP／Desktop は完全に終了して再起動してください。Web UI の場合は DSH Web サービスを再起動してください。",
  "端口仍被占用时，请关闭其他 Harness 实例。": "ポートがまだ使用中の場合は、他の Harness インスタンスを閉じてください。",
  "网关运行模式": "ゲートウェイの動作モード",
  "重启后保持开启": "再起動後もオンのままにする",
  "等待可信设备连接，约 \u0000 分钟后自动关闭": "信頼済みデバイスの接続を待っています。約 \u0000 分後に自動でオフになります",
  "设备已连接过，本次运行保持开启；重启后重新计时": "デバイスが接続したことがあるため、今回はオンのままです。再起動後にタイマーはリセットされます",
  "不接受移动设备连接": "モバイルデバイスの接続を受け付けません",
  "临时开启": "一時的にオン",
  "常驻开启": "常時オン",
  "设备鉴权": "デバイス認証",
  "已开启，仅允许可信设备连接": "オン — 信頼済みデバイスのみ接続できます",
  "已关闭，仅影响本机 Debug 入口": "オフ — このマシンの Debug 入口にのみ影響します",
  "关闭设备鉴权": "デバイス認証を無効化",
  "开启设备鉴权": "デバイス認証を有効化",
  "Debug 模式：本机 DSH 入口将跳过设备凭证校验；独立局域网入口仍强制鉴权。": "Debug モード：このマシンの DSH 入口ではデバイス資格情報の検証をスキップします。独立した LAN 入口では引き続き認証が必須です。",
  "配对连接方式": "ペアリングの接続方法",
  "连接方式说明与场景建议": "接続方法の説明とシナリオ別のおすすめ",
  "怎么选连接方式": "接続方法の選び方",
  "局域网直连": "LAN 直接接続",
  "手机与 DSH 在同一个可互访的局域网，使用 ws:// 私有地址；离开该网络就无法直连。": "スマホと DSH が互いに到達できる同じ LAN にあり、プライベートな ws:// アドレスを使います。そのネットワークを離れると直接接続はできません。",
  "Cloudflare Channel（命名 Tunnel）": "Cloudflare Channel（名前付き Tunnel）",
  "PC 主动连接 Cloudflare，外网用固定域名的 wss://；需要 Cloudflare 账户和域名。": "PC から Cloudflare へ接続し、外部からは固定ドメインの wss:// を使います。Cloudflare アカウントとドメインが必要です。",
  "无需账户或域名，Cloudflare 分配临时 wss:// 地址；隧道重建后地址可能变化。": "アカウントやドメインは不要です。Cloudflare が一時的な wss:// アドレスを割り当てます。トンネルが再構築されるとアドレスが変わることがあります。",
  "公网服务器连接": "パブリックサーバー接続",
  "DSH 运行在有固定公网 IPv4 的 Linux 服务器上，配置公网入口后用 wss:// 公网 IP 连接。": "DSH が固定のパブリック IPv4 を持つ Linux サーバーで動いています。パブリック入口を設定した後、wss:// のパブリック IP で接続します。",
  "结合当前环境": "現在の環境に基づいて",
  "面板无法判断手机当前网络；请按手机所在位置选择，提示不会替你修改选择。": "パネルはスマホの現在のネットワークを判定できません。スマホの場所に合わせて選んでください。ヒントが選択を勝手に変えることはありません。",
  "自动选择 · 优先外网": "自動選択 · 外部を優先",
  "局域网直连 · 当前不可用": "LAN 直接接続 · 現在は利用できません",
  "Cloudflare 外网": "Cloudflare 外部",
  "手动输入地址": "アドレスを手動入力",
  "外网使用 Cloudflare Tunnel 进行连接，请在下方进行设置。": "外部からは Cloudflare Tunnel で接続します。下で設定してください。",
  "WebSocket 地址": "WebSocket アドレス",
  "局域网监听失败：\u0000": "LAN の待ち受けに失敗しました：\u0000",
  "局域网入口已开启\u0000": "LAN 入口はオンです\u0000",
  "，端口 \u0000": "、ポート \u0000",
  "局域网入口启动中…": "LAN 入口を起動中…",
  "正在生成…": "生成中…",
  "请先开启移动网关": "先にモバイルゲートウェイをオンにしてください",
  "等待连接地址": "接続アドレスを待っています",
  "生成配对二维码": "ペアリング用 QR コードを生成",
  "配对码仅可使用一次，5 分钟内有效。": "ペアリングコードは 1 回のみ使用でき、有効期限は 5 分間です。",
  "Cloudflare Tunnel · 外网接入": "Cloudflare Tunnel · 外部アクセス",
  "首次开启自动准备 Tunnel 组件。": "有効にすると Tunnel コンポーネントが自動で準備されます。",
  "接入方式": "アクセス方法",
  "Cloudflare 接入方式": "Cloudflare のアクセス方法",
  "Quick Tunnel · 无需域名": "Quick Tunnel · ドメイン不要",
  "命名 Tunnel · 固定域名": "名前付き Tunnel · 固定ドメイン",
  "临时地址可能变化，变化后需重新扫码。": "一時アドレスは変わることがあります。変わった場合は再度スキャンしてください。",
  "先在 Cloudflare 创建命名 Tunnel，把公开域名的 Service URL 设为 ": "まず Cloudflare で名前付き Tunnel を作成し、公開ホスト名の Service URL を次に設定してください：",
  "。Tunnel Token 仅授权连接，不能自动创建公开主机名或 DNS；还需确认域名存在指向 Tunnel UUID.cfargotunnel.com 的已代理 CNAME 记录。": "。Tunnel Token は接続の認可にのみ使われ、公開ホスト名や DNS を自動で作成することはできません。ドメインに、Tunnel UUID.cfargotunnel.com を指すプロキシ済み CNAME レコードがあることも確認してください。",
  "公开域名": "公開ドメイン",
  "已保存；留空则保持原 Token": "保存済み。空欄にすると現在の Token のままになります",
  "粘贴 eyJ… Token": "eyJ… Token を貼り付け",
  "正在处理…": "処理中…",
  "保存并连接": "保存して接続",
  "一键开启 Quick Tunnel": "Quick Tunnel をワンクリックで有効化",
  "开启命名 Tunnel": "名前付き Tunnel を有効化",
  "检测公网 DNS / TLS / WebSocket": "パブリック DNS / TLS / WebSocket を検出",
  "重启 Tunnel": "Tunnel を再起動",
  "关闭 Cloudflare Tunnel": "Cloudflare Tunnel を無効化",
  "重启会短暂断开连接。": "再起動すると接続が短時間切断されます。",
  "未开启": "オフ",
  "正在启动本机入口…": "このマシンの入口を起動中…",
  "正在准备 cloudflared（首次需下载）…": "cloudflared を準備中（初回はダウンロードが必要です）…",
  "正在连接 Cloudflare…": "Cloudflare に接続中…",
  "隧道传输已连接（不等于公网入口可达）": "トンネルの転送は接続されています（パブリック入口に到達できることとは別です）",
  "等待移动网关开启": "モバイルゲートウェイがオンになるのを待っています",
  "（检测时间：\u0000）": "（検出時刻：\u0000）",
  "公网接入": "パブリックアクセス",
  "正在检查系统组件…": "システムコンポーネントを確認中…",
  "端口需要更新：Nginx 当前为 \u0000，DSH 当前为 \u0000": "ポートの更新が必要です：Nginx は現在 \u0000、DSH は現在 \u0000",
  "已配置\u0000": "設定済み\u0000",
  "，Nginx 转发至 DSH 端口 \u0000": "、Nginx は DSH のポート \u0000 へ転送します",
  "Helper 已就绪，将自动使用当前 DSH 端口\u0000": "Helper の準備ができています。現在の DSH ポートを自動で使います\u0000",
  "服务器公网 IPv4": "サーバーのパブリック IPv4",
  "正在配置 Nginx 与证书…": "Nginx と証明書を設定中…",
  "更新公网配置": "パブリック設定を更新",
  "配置公网接入": "パブリックアクセスを設定",
  "尚未安装系统 Helper。请在服务器执行一次初始化：": "システム Helper がまだインストールされていません。サーバーで初期化を 1 回実行してください：",
  "刷新中…": "更新中…",
  "刷新": "更新",
  "加载中…": "読み込み中…",
  "暂无已配对设备。": "ペアリング済みのデバイスはまだありません。",
  "当前没有在线设备。": "現在オンラインのデバイスはありません。",
  "收起离线设备": "オフラインのデバイスを隠す",
  "展开其他已配对设备（\u0000）": "他のペアリング済みデバイスを表示（\u0000）",
  "插件版本 \u0000": "プラグインのバージョン \u0000",
  "安装应用": "アプリをインストール",
  "在手机上安装应用": "スマホにアプリをインストール",
  "手机与这台 DSH 需要在同一局域网，或先连接 VPN。": "スマホとこの DSH は同じ LAN にあるか、先に VPN に接続する必要があります。",
  "下载 Android 安装包 (APK)。": "Android インストールパッケージ（APK）をダウンロードします。",
  "在浏览器提示时允许“安装未知应用”，然后打开下载的文件完成安装。": "ブラウザで求められたら「不明なアプリのインストール」を許可し、ダウンロードしたファイルを開いてインストールを完了してください。",
  "打开应用，连接 VPN 后，扫描本页“连接与配对”中的二维码。": "アプリを開き、VPN に接続した後、本ページの「接続とペアリング」にある QR コードをスキャンしてください。",
  "下载 APK": "APK をダウンロード",
  "打开最新 Release": "最新の Release を開く",
  "查看 Release": "Release を表示",
  "需要 Android 7 或更高版本。": "Android 7 以降が必要です。",
  "先在 App Store 安装 TestFlight。": "まず App Store で TestFlight をインストールしてください。",
  "加入 Whaleness 公测并安装测试版。": "Whaleness のベータに参加してテスト版をインストールしてください。",
  "连接 VPN 后，扫描本页“连接与配对”中的二维码。": "VPN に接続した後、本ページの「接続とペアリング」にある QR コードをスキャンしてください。",
  "需要 iOS 17 或更高版本。": "iOS 17 以降が必要です。",
  "打开 TestFlight": "TestFlight を開く",
  "加入公测": "ベータに参加",
  "正在获取最新版本…": "最新バージョンを取得中…",
  "最新版本": "最新バージョン",
  "最新版本：\u0000": "最新バージョン：\u0000",
}
    function tr(strings, ...values) {
      const dict = UI_LOCALE === 'en' ? EN_UI : UI_LOCALE === 'ja' ? JA_UI : undefined
      if (typeof strings === 'string') return dict ? (dict[strings] ?? strings) : strings
      const key = strings.raw.join('\u0000')
      const translated = dict ? dict[key] : undefined
      if (translated === undefined) {
        return strings.reduce((acc, part, index) => acc + part + (index < values.length ? String(values[index]) : ''), '')
      }
      let next = 0
      return translated.replace(/\u0000/g, () => {
        const value = values[next++]
        return value === undefined ? '' : String(value)
      })
    }

    let open = false
    const listeners = new Set()
    const setOpen = (value) => {
      open = value
      for (const listener of listeners) listener()
    }
    const subscribe = (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const getOpen = () => open

    // Shared Web UI / Desktop semantic tokens update with the host theme.
    const restartNoticeStorageKey = 'mobile-gateway-dismissed-restart-notice'
    let dismissedRestartInstance = null
    try { dismissedRestartInstance = window.localStorage.getItem(restartNoticeStorageKey) } catch { /* storage unavailable */ }

    const colors = {
      panel: 'var(--dsw-alias-bg-layer-2, var(--color-bg, Canvas))',
      card: 'var(--dsw-alias-bg-module-platform, var(--color-bg-elevated, Canvas))',
      text: 'var(--dsw-alias-label-primary, var(--color-text, CanvasText))',
      muted: 'var(--dsw-alias-label-secondary, var(--color-text-muted, GrayText))',
      border: 'var(--dsw-alias-border-l3, var(--color-border, rgba(127,127,127,.24)))',
      accent: 'var(--dsw-alias-button-primary-fill, var(--color-primary, #4f7cff))',
      accentText: 'var(--dsw-alias-label-primary-foreground, #fff)',
      danger: 'var(--dsw-alias-state-error-primary, #dc4c64)',
      success: 'var(--dsw-alias-state-success-primary, #2fb171)',
    }
    const RELEASES_LATEST = 'https://github.com/Clarklevis1995/dsh-mobile/releases/latest'
    const TESTFLIGHT_URL = 'https://testflight.apple.com/join/1Euwby6r'
    const TESTFLIGHT_APP_URL = 'https://apps.apple.com/app/testflight/id899247664'
    const INSTALL_SHOTS = {
      android: 'data:image/webp;base64,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',
      ios: 'data:image/webp;base64,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',
    }
    const styles = {
      backdrop: {
        position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'auto',
        background: 'var(--dsw-alias-bg-mask-1, rgba(0,0,0,.32))', display: 'flex',
        justifyContent: 'center', alignItems: 'center',
        padding: 'max(16px, var(--dsh-frame-overlay-top, 16px)) 16px', boxSizing: 'border-box',
      },
      panel: {
        width: 'clamp(640px, 84vw, 1120px)', maxWidth: '100%', maxHeight: '100%', minHeight: 0, height: 'min(780px, calc(100dvh - 48px))', overflow: 'hidden',
        scrollbarWidth: 'none', msOverflowStyle: 'none',
        display: 'flex', flexDirection: 'column',
        background: colors.panel, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 'var(--dsw-radius-panel, 16px)',
        boxShadow: 'var(--dsw-elevation-prominent, 0 20px 60px rgba(0,0,0,.22))', padding: 24,
        fontFamily: 'var(--dsw-font-family, system-ui, sans-serif)', fontSize: 13, boxSizing: 'border-box',
      },
      header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexShrink: 0 },
      title: { margin: 0, fontSize: 22, fontWeight: 650 },
      card: { background: 'transparent', border: 0, borderBottom: `1px solid ${colors.border}`, borderRadius: 0, padding: '16px 0', marginBottom: 0, flexShrink: 0 },
      label: { display: 'block', color: colors.muted, fontSize: 12, marginBottom: 6 },
      input: { width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 10, padding: '8px 12px', marginBottom: 8, background: colors.card, color: 'inherit', outline: 'none' },
      pairingText: { width: '100%', minHeight: 86, boxSizing: 'border-box', resize: 'vertical', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '9px 10px', margin: '10px 0', background: 'transparent', color: 'inherit', outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere' },
      button: { cursor: 'pointer', border: `1px solid ${colors.border}`, background: 'transparent', borderRadius: 8, padding: '7px 11px', color: 'inherit', font: 'inherit' },
      headerButton: { width: 34, height: 34, boxSizing: 'border-box', border: 0, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
      primary: { background: colors.accent, color: colors.accentText, borderColor: colors.accent, width: '100%' },
      muted: { color: colors.muted, fontSize: 12, lineHeight: 1.45 },
      row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 12, alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${colors.border}` },
      badge: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, marginLeft: 8, color: colors.muted },
      dot: { width: 7, height: 7, borderRadius: 99, display: 'inline-block' },
      error: { color: colors.danger, background: 'rgba(220,76,100,.12)', borderRadius: 8, padding: 10, marginBottom: 12 },
      qr: { display: 'block', width: 220, height: 220, margin: '12px auto', background: '#fff', borderRadius: 10, padding: 8 },
      helpButton: { width: 20, height: 20, boxSizing: 'border-box', padding: 0, borderRadius: '50%', border: 0, background: 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.1))', color: 'var(--dsw-alias-label-tertiary, #888)', cursor: 'help', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 600, lineHeight: 1 },
      helpBubble: { position: 'absolute', top: '100%', left: 0, zIndex: 20, width: 'min(300px, calc(100vw - 88px))', maxHeight: 'min(440px, calc(100vh - 160px))', overflowY: 'auto', boxSizing: 'border-box', padding: 12, borderRadius: 10, border: `1px solid ${colors.border}`, background: colors.panel, color: colors.text, boxShadow: '0 12px 28px rgba(0,0,0,.35)', fontSize: 12, lineHeight: 1.5 },
      toolsMenu: { position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, width: 250, maxWidth: 'calc(100vw - 48px)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 5, background: colors.panel, boxShadow: '0 12px 28px rgba(0,0,0,.35)' },
      toolsItem: { display: 'block', width: '100%', padding: '9px 10px', textAlign: 'left', border: 0, borderRadius: 7, background: 'transparent', color: colors.text, font: 'inherit', cursor: 'pointer' },
      switch: { position: 'relative', display: 'inline-flex', width: 42, height: 24, flexShrink: 0 },
      switchInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
      switchTrack: { position: 'absolute', inset: 0, borderRadius: 99, transition: 'background .18s ease', cursor: 'pointer' },
      switchKnob: { position: 'absolute', top: 3, width: 18, height: 18, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.35)', transition: 'left .18s ease', pointerEvents: 'none' },
      version: { flexShrink: 0, marginTop: 'auto', padding: '18px 2px 0', color: colors.muted, fontSize: 11, lineHeight: 1.4, textAlign: 'right', letterSpacing: '.02em' },
    }

    const panelCss = `
      @keyframes mgw-pairing-enter {
        from { opacity: 0; transform: scale(.82); }
        to { opacity: 1; transform: scale(1); }
      }
      .mgw-pairing-dialog {
        transform-origin: center;
        animation: mgw-pairing-enter 240ms cubic-bezier(.2, .8, .2, 1);
      }
      @keyframes mgw-pairing-exit {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(.82); }
      }
      .mgw-pairing-dialog[data-closing="true"] {
        animation: mgw-pairing-exit 180ms ease-in forwards;
        pointer-events: none;
      }
      @media (prefers-reduced-motion: reduce) {
        .mgw-pairing-dialog { animation: none; }
      }
      .mobile-gateway-panel, .mobile-gateway-panel *, .mgw-pairing-dialog, .mgw-pairing-dialog *, .mgw-select-menu {
        scrollbar-width: none !important;
        -ms-overflow-style: none;
      }
      .mobile-gateway-panel::-webkit-scrollbar, .mobile-gateway-panel *::-webkit-scrollbar,
      .mgw-pairing-dialog::-webkit-scrollbar, .mgw-pairing-dialog *::-webkit-scrollbar, .mgw-select-menu::-webkit-scrollbar {
        display: none !important;
        width: 0;
        height: 0;
      }
      .mobile-gateway-panel .mgw-body { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 28px; flex: 1; min-height: 0; }
      .mobile-gateway-panel .mgw-nav { display: flex; flex-direction: column; gap: 4px; }
      .mobile-gateway-panel .mgw-nav button { text-align: left; border: 0; padding: 12px 14px; border-radius: 10px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .mobile-gateway-panel .mgw-nav button[aria-current="page"] { background: var(--dsw-alias-bg-overlay, rgba(127,127,127,.12)); font-weight: 500; }
      .mobile-gateway-panel .mgw-nav button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08)); }
      .mobile-gateway-panel .mgw-content { min-width: 0; overflow-y: auto; scrollbar-width: none; padding-right: 4px; }
      .mobile-gateway-panel .mgw-content::-webkit-scrollbar { display: none; }
      .mobile-gateway-panel .mgw-content p { margin: 6px 0 10px; }
      .mobile-gateway-panel strong { font-weight: 550; }
      .mobile-gateway-panel .mgw-section-title { margin: 0 0 10px; font-size: 17px; line-height: 1.4; font-weight: 650; color: inherit; }
      .mobile-gateway-panel .mgw-setting-row { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
      .mobile-gateway-panel .mgw-setting-row select { width: auto !important; max-width: 100%; min-width: 150px; margin-bottom: 0 !important; flex-shrink: 1; }
      .mobile-gateway-panel .mgw-cloudflare-block input, .mobile-gateway-panel .mgw-cloudflare-block .mgw-select-trigger { background: var(--dsw-alias-bg-layer-2, Canvas) !important; }
      .mobile-gateway-panel .mgw-setting-label { font-size: 14px; font-weight: 550; color: inherit; }

      .mobile-gateway-panel input:focus-visible, .mobile-gateway-panel select:focus-visible, .mobile-gateway-panel button:focus-visible { outline: 2px solid var(--dsw-alias-label-primary, currentColor); outline-offset: 2px; }
      @media (max-width: 640px) {
        .mobile-gateway-panel .mgw-body { grid-template-columns: minmax(0, 1fr); gap: 8px; }
        .mobile-gateway-panel .mgw-nav { flex-direction: row; }
        .mobile-gateway-panel .mgw-nav button { flex: 1; padding: 10px 6px; text-align: center; }
      }
    `

    function GatewaySelect({ style, children, value, onChange, disabled, ...props }) {
      const options = React.Children.toArray(children).filter((child) => React.isValidElement(child))
      const [menu, setMenu] = React.useState(null)
      const [active, setActive] = React.useState(0)
      const buttonRef = React.useRef(null)
      const menuRef = React.useRef(null)
      const menuId = React.useId()
      const selected = options.find((option) => option.props.value === value)
      const enabled = options.map((option, index) => option.props.disabled ? -1 : index).filter((index) => index >= 0)
      const close = (restoreFocus = false) => {
        setMenu(null)
        if (restoreFocus) buttonRef.current?.focus()
      }
      const openMenu = () => {
        if (disabled) return
        const rect = buttonRef.current.getBoundingClientRect()
        const computed = window.getComputedStyle(buttonRef.current)
        const fontSize = parseFloat(computed.fontSize) || 14
        const lineHeight = parseFloat(computed.lineHeight) || fontSize * 1.5
        const measure = document.createElement('canvas').getContext('2d')
        if (measure) measure.font = computed.font || `${fontSize}px sans-serif`
        const longest = Math.max(...options.map((option) => measure
          ? measure.measureText(String(option.props.children)).width : String(option.props.children).length * fontSize))
        const height = Math.min(options.length * Math.max(40, lineHeight + 16) + 14, window.innerHeight - 24)
        const width = Math.min(Math.max(rect.width, longest + 72, 200), window.innerWidth - 24)
        setActive(Math.max(0, options.findIndex((option) => option.props.value === value && !option.props.disabled)))
        setMenu({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
          top: Math.max(12, rect.bottom + height + 6 <= window.innerHeight - 12 ? rect.bottom + 6 : rect.top - height - 6), width, maxHeight: window.innerHeight - 24 })
      }
      const choose = (index) => {
        const option = options[index]
        if (!option || option.props.disabled) return
        onChange?.({ target: { value: option.props.value } })
        close(true)
      }
      React.useEffect(() => {
        if (!menu) return
        menuRef.current?.focus()
        const outside = (event) => {
          if (!buttonRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) close()
        }
        const scrolled = (event) => { if (!menuRef.current?.contains(event.target)) close() }
        const resized = () => close()
        document.addEventListener('pointerdown', outside)
        document.addEventListener('scroll', scrolled, true)
        window.addEventListener('resize', resized)
        return () => {
          document.removeEventListener('pointerdown', outside)
          document.removeEventListener('scroll', scrolled, true)
          window.removeEventListener('resize', resized)
        }
      }, [menu])
      React.useEffect(() => {
        if (menu) document.getElementById(`${menuId}-${active}`)?.scrollIntoView({ block: 'nearest' })
      }, [active, menu])
      return React.createElement('span', { style: { display: 'inline-flex', maxWidth: '100%', minWidth: 0 } },
        React.createElement('button', { ...props, className: 'mgw-select-trigger', ref: buttonRef, type: 'button', disabled,
          'aria-haspopup': 'listbox', 'aria-expanded': !!menu, 'aria-controls': menu ? menuId : undefined,
          onClick: () => menu ? close() : openMenu(),
          onKeyDown: (event) => {
            if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openMenu() }
          },
          style: { ...style, width: 'auto', maxWidth: '100%', marginBottom: 0, border: 0, borderRadius: 12,
            padding: '10px 16px', background: colors.card, color: colors.text, font: 'inherit', cursor: disabled ? 'default' : 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 18, opacity: disabled ? .5 : 1 } },
          React.createElement('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, selected?.props.children || value),
          React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
            strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } },
            React.createElement('path', { d: 'M6 9l6 6 6-6' }))),
        menu ? React.createElement('div', { className: 'mgw-select-menu', ref: menuRef, id: menuId, role: 'listbox', tabIndex: -1,
          'aria-label': props['aria-label'], 'aria-activedescendant': `${menuId}-${active}`,
          style: { ...menu, position: 'fixed', zIndex: 1250, boxSizing: 'border-box', overflowY: 'auto', padding: 6,
            background: colors.panel, color: colors.text, border: `1px solid ${colors.border}`, borderRadius: 14,
            boxShadow: 'var(--dsw-elevation-prominent, 0 8px 28px rgba(0,0,0,.12))', outline: 'none' },
          onKeyDown: (event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true) }
            else if (event.key === 'Tab') close()
            else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(active) }
            else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault()
              const index = enabled.indexOf(active)
              setActive(event.key === 'Home' ? enabled[0] : event.key === 'End' ? enabled[enabled.length - 1]
                : enabled[(index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length])
            }
          } }, options.map((option, index) => React.createElement('div', { key: option.props.value,
            id: `${menuId}-${index}`, role: 'option', 'aria-selected': option.props.value === value, 'aria-disabled': !!option.props.disabled,
            onPointerMove: () => { if (!option.props.disabled) setActive(index) }, onClick: () => choose(index),
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, minHeight: 40, whiteSpace: 'nowrap',
              boxSizing: 'border-box', padding: '8px 12px', borderRadius: 8, cursor: option.props.disabled ? 'default' : 'pointer',
              opacity: option.props.disabled ? .4 : 1, background: active === index ? 'var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.08))' : 'transparent' } },
            React.createElement('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }, title: String(option.props.children) }, option.props.children), option.props.value === value ? React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24',
              fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style: { flexShrink: 0 } },
              React.createElement('path', { d: 'M5 12l4 4L19 6' })) : null))) : null)
    }

    async function request(path, options) {
      const response = await fetch(path, { credentials: 'same-origin', ...options })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`)
      return body
    }

    function inferredUrl(wsPath) {
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      return `${scheme}//${window.location.host}${wsPath || '/ws/mobile'}`
    }

    function lanPairingUrl(status) {
      const urls = status?.lan?.listening && Array.isArray(status.lan.urls) ? status.lan.urls : []
      return urls.find((url) => !/^ws:\/\/169\.254\./.test(url)) || urls[0] || ''
    }

    function pairingUrlFor(route, status) {
      const lanUrl = lanPairingUrl(status)
      const tunnelUrl = status.cloudflare?.enabled ? status.cloudflare.publicUrl || '' : ''
      if (route === 'lan') return lanUrl
      if (route === 'cloudflare') return tunnelUrl
      if (status.cloudflare?.enabled && status.cloudflare.mode === 'quick') return tunnelUrl
      return tunnelUrl || status.publicUrl || lanUrl || inferredUrl(status.wsPath)
    }

    function connectionAdvice(status, publicSetup) {
      if (!status) return { detected: tr('正在读取网关环境…'), local: '', remote: '' }
      const system = status.platform === 'darwin' ? tr('macOS 电脑') : status.platform === 'win32' ? tr('Windows 电脑') : status.platform === 'linux' ? tr('Linux 服务器') : tr('当前设备')
      const lanReady = !!lanPairingUrl(status)
      const tunnel = status.cloudflare
      const tunnelReady = !!(tunnel?.enabled && tunnel.publicReady === true && tunnel.publicUrl)
      const serverReady = status.platform === 'linux' && !!(
        (publicSetup?.configured && publicSetup.publicUrl) || /^wss:\/\//.test(status.publicUrl || ''))
      const detected = tr`当前检测：${system}；局域网入口${lanReady ? tr('已就绪') : tr('未就绪')}；${serverReady ? tr('公网服务器入口已配置') : tunnelReady ? tr`${tunnel.mode === 'quick' ? 'Quick' : tr('命名')} Tunnel 已连接` : tunnel?.enabled ? (tunnel.state === 'online' ? tr('隧道已连接，公网入口未验证或检测失败') : tr('Cloudflare Tunnel 连接中')) : tr('外网入口未连接')}。`
      const local = lanReady
        ? tr('手机与 DSH 处于可互访的同一局域网时，建议选“局域网直连”。')
        : tr('如果手机和 DSH 在同一局域网，先确认局域网入口已开启并监听成功。')
      let remote
      if (serverReady) remote = tr('手机在外网时，建议使用已配置的公网服务器地址（“自动选择”）。')
      else if (tunnelReady && tunnel.mode === 'named') remote = tr('手机在外网时，建议选“Cloudflare 外网”；当前命名 Tunnel 有固定域名。')
      else if (tunnelReady) remote = tr('手机在外网临时使用时，建议选“Cloudflare 外网”；Quick 地址变化后需要重新确认。')
      else if (status.platform === 'darwin' || status.platform === 'win32') remote = tr('手机在外网时，无自有域名可开启 Quick Tunnel；有域名且需要固定地址可配置命名 Tunnel。')
      else if (status.platform === 'linux') remote = tr('手机在外网时，若使用受支持的 Ubuntu/Debian 服务器且有固定公网 IPv4，可先配置“公网接入”，再选“自动选择”。')
      else remote = tr('手机在外网时，需要一个可访问的 wss:// 地址；可在“手动输入地址”中填写。')
      return { detected, local, remote }
    }

    function DeviceRow({ device, onRevoke, revoking }) {
      const triggerRevoke = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!revoking) onRevoke(device)
      }
      return React.createElement('div', { style: styles.row },
        React.createElement('div', { style: { minWidth: 0, overflow: 'hidden' } },
          React.createElement('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            device.displayName || device.name,
            React.createElement('span', { style: styles.badge },
              React.createElement('span', { style: { ...styles.dot, background: device.online ? colors.success : colors.muted } }),
              device.online ? tr('在线') : tr('离线'))),
          React.createElement('div', { style: { ...styles.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 } },
            device.lastSeenAt ? tr`最近连接：${new Date(device.lastSeenAt).toLocaleString()}` : tr('尚未连接'))),
        React.createElement('button', {
          type: 'button',
          disabled: revoking,
          style: {
            ...styles.button,
            color: colors.danger,
            background: 'transparent',
            borderColor: 'rgba(220,76,100,.55)',
            flexShrink: 0,
            minWidth: 54,
            opacity: revoking ? .6 : 1,
          },
          title: tr`吊销 ${device.displayName || device.name}`,
          // Pointer-up is more reliable than click inside the shell overlay on
          // touch devices. The click handler remains for keyboard activation.
          onPointerUp: triggerRevoke,
          onClick: (event) => {
            if (event.detail === 0) triggerRevoke(event)
          },
        }, revoking ? tr('吊销中…') : tr('吊销')))
    }

    function InstallGuide({ release, loading, platform, onPlatform }) {
      const page = (release && release.page) || RELEASES_LATEST
      const version = (release && release.tag) || ''
      const link = (label, href, primary) => React.createElement('a', {
        href: href || RELEASES_LATEST,
        target: '_blank',
        rel: 'noopener noreferrer',
        style: {
          ...styles.button,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          textDecoration: 'none',
          ...(primary ? { background: colors.accent, color: colors.accentText, borderColor: colors.accent } : {}),
        },
      }, label)
      const tab = (id, label) => React.createElement('button', {
        type: 'button',
        'aria-pressed': platform === id,
        onClick: () => onPlatform(id),
        style: {
          ...styles.button,
          ...(platform === id ? { background: colors.accent, color: colors.accentText, borderColor: colors.accent } : {}),
        },
      }, label)
      const steps = (items) => React.createElement('ol', { style: { margin: '0 0 14px', paddingLeft: 20, lineHeight: 1.7 } },
        items.map((item, index) => React.createElement('li', { key: index, style: { marginBottom: 6 } }, item)))
      const image = (src) => React.createElement('img', {
        src,
        alt: '',
        style: { width: '100%', maxWidth: 380, display: 'block', margin: '10px auto 0', borderRadius: 12, border: `1px solid ${colors.border}`, background: '#fff' },
      })
      return React.createElement('section', { style: styles.card },
        React.createElement('h3', { className: 'mgw-section-title' }, tr('在手机上安装应用')),
        React.createElement('p', { style: styles.muted }, tr('手机与这台 DSH 需要在同一局域网，或先连接 VPN。')),
        React.createElement('div', { style: { display: 'flex', gap: 8, margin: '12px 0' } },
          tab('android', 'Android'), tab('ios', 'iOS')),
        platform === 'ios'
          ? React.createElement(React.Fragment, null,
              steps([
                tr('先在 App Store 安装 TestFlight。'),
                tr('加入 Whaleness 公测并安装测试版。'),
                tr('连接 VPN 后，扫描本页“连接与配对”中的二维码。'),
              ]),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
                link(tr('加入公测'), TESTFLIGHT_URL, true),
                link(tr('打开 TestFlight'), TESTFLIGHT_APP_URL, false)),
              React.createElement('p', { style: styles.muted }, tr('需要 iOS 17 或更高版本。')),
              image(INSTALL_SHOTS.ios))
          : React.createElement(React.Fragment, null,
              steps([
                tr('下载 Android 安装包 (APK)。'),
                tr('在浏览器提示时允许“安装未知应用”，然后打开下载的文件完成安装。'),
                tr('打开应用，连接 VPN 后，扫描本页“连接与配对”中的二维码。'),
              ]),
              React.createElement('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 } },
                link(release && release.apk ? tr('下载 APK') : tr('打开最新 Release'), release && release.apk ? release.apk : page, true),
                link(tr('查看 Release'), page, false)),
              React.createElement('p', { style: styles.muted }, tr('需要 Android 7 或更高版本。')),
              image(INSTALL_SHOTS.android)),
        React.createElement('p', { style: { ...styles.muted, marginTop: 12 } },
          loading ? tr('正在获取最新版本…') : version ? tr`最新版本：${version}` : tr('最新版本'))
      )
    }

    function DevicePanel() {
      const [activeSection, setActiveSection] = React.useState('general')
      const [installPlatform, setInstallPlatform] = React.useState(() => /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ? 'ios' : 'android')
      const [installRelease, setInstallRelease] = React.useState(null)
      const [installLoading, setInstallLoading] = React.useState(false)
      const [devices, setDevices] = React.useState(null)
      const [showAllDevices, setShowAllDevices] = React.useState(false)
      const [status, setStatus] = React.useState(null)
      const [dismissedNotice, setDismissedNotice] = React.useState(() => dismissedRestartInstance)
      const [publicUrl, setPublicUrl] = React.useState('')
      const [pairingRoute, setPairingRoute] = React.useState('auto')
      const [connectionHelpOpen, setConnectionHelpOpen] = React.useState(false)
      const [toolsOpen, setToolsOpen] = React.useState(false)
      const [toolBusy, setToolBusy] = React.useState(false)
      const [toolNotice, setToolNotice] = React.useState('')
      const stoppedRef = React.useRef(false)
      const [publicIp, setPublicIp] = React.useState('')
      const [publicSetup, setPublicSetup] = React.useState(null)
      const [publicSetupBusy, setPublicSetupBusy] = React.useState(false)
      const [cloudflareHost, setCloudflareHost] = React.useState('')
      const [cloudflareToken, setCloudflareToken] = React.useState('')
      const [cloudflareMode, setCloudflareMode] = React.useState('quick')
      const [cloudflareBusy, setCloudflareBusy] = React.useState(false)
      const [qr, setQr] = React.useState(null)
      const pairingDialogRef = React.useRef(null)
      const [pairingClosing, setPairingClosing] = React.useState(false)
      const pairingCloseTimer = React.useRef(null)
      const closePairingDialog = () => {
        if (pairingCloseTimer.current !== null) return
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          setQr(null)
          return
        }
        setPairingClosing(true)
        pairingCloseTimer.current = window.setTimeout(() => {
          pairingCloseTimer.current = null
          setQr(null)
          setPairingClosing(false)
        }, 180)
      }
      React.useEffect(() => {
        setPairingClosing(false)
        return () => {
          if (pairingCloseTimer.current !== null) {
            window.clearTimeout(pairingCloseTimer.current)
            pairingCloseTimer.current = null
          }
        }
      }, [qr])
      React.useEffect(() => {
        let alive = true
        const cacheKey = 'mobile-gateway-latest-release'
        const fallback = { tag: '', page: RELEASES_LATEST, apk: '', ipa: '' }
        const load = async () => {
          setInstallLoading(true)
          try {
            let data = null
            try {
              const raw = window.localStorage.getItem(cacheKey)
              if (raw !== null) {
                const cached = JSON.parse(raw)
                if (Date.now() - cached.at < 6 * 60 * 60 * 1000) data = cached.data
              }
            } catch { /* storage unavailable */ }
            if (data === null) {
              const response = await fetch('https://api.github.com/repos/Clarklevis1995/dsh-mobile/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
              if (!response.ok) throw new Error('HTTP ' + response.status)
              data = await response.json()
              try { window.localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), data })) } catch { /* storage unavailable */ }
            }
            if (!alive) return
            const assets = Array.isArray(data.assets) ? data.assets : []
            setInstallRelease({
              tag: data.tag_name || '',
              page: data.html_url || fallback.page,
              apk: (assets.find((asset) => /\.apk$/i.test(asset.name || '')) || {}).browser_download_url || '',
              ipa: (assets.find((asset) => /\.ipa$/i.test(asset.name || '')) || {}).browser_download_url || '',
            })
          } catch {
            if (alive) setInstallRelease(fallback)
          } finally {
            if (alive) setInstallLoading(false)
          }
        }
        load()
        return () => { alive = false }
      }, [])
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      const [refreshing, setRefreshing] = React.useState(false)
      const [refreshNotice, setRefreshNotice] = React.useState(null)
      const [pairingTokenCopied, setPairingTokenCopied] = React.useState(false)
      const [deviceNotice, setDeviceNotice] = React.useState(null)
      const [deviceNoticeError, setDeviceNoticeError] = React.useState(false)
      const [revokingIds, setRevokingIds] = React.useState(() => new Set())
      const revokingIdsRef = React.useRef(new Set())
      const automaticUrlRef = React.useRef('')
      const pairingRouteRef = React.useRef('auto')
      const cloudflareModeLoadedRef = React.useRef(false)

      const refresh = React.useCallback(async () => {
        try {
          const [deviceData, statusData] = await Promise.all([
            request('/mgw/devices'),
            request('/mgw/status'),
          ])
          const nextDevices = deviceData.devices || []
          // Keep existing DOM rows alive when polling returns identical data.
          // Replacing them every three seconds can swallow a pointer/click that
          // started on the old button and ended after React replaced the row.
          if (revokingIdsRef.current.size === 0) {
            setDevices((current) => JSON.stringify(current) === JSON.stringify(nextDevices) ? current : nextDevices)
          }
          setStatus((current) => JSON.stringify(current) === JSON.stringify(statusData) ? current : statusData)
          if (statusData.cloudflare && statusData.cloudflare.hostname) {
            setCloudflareHost((current) => current || statusData.cloudflare.hostname)
          }
          if (statusData.cloudflare && !cloudflareModeLoadedRef.current) {
            cloudflareModeLoadedRef.current = true
            setCloudflareMode(statusData.cloudflare.mode || 'quick')
          }
          if (pairingRouteRef.current === 'cloudflare' && !statusData.cloudflare?.enabled) {
            pairingRouteRef.current = 'auto'
            setPairingRoute('auto')
          }
          if (pairingRouteRef.current !== 'custom') {
            const preferredUrl = pairingUrlFor(pairingRouteRef.current, statusData)
            if (automaticUrlRef.current && preferredUrl !== automaticUrlRef.current) setQr(null)
            automaticUrlRef.current = preferredUrl
            setPublicUrl(preferredUrl)
          }
          return true
        } catch (cause) {
          setError(cause.message)
          return false
        }
      }, [])

      const manualRefresh = async () => {
        if (refreshing) return
        setRefreshing(true)
        setRefreshNotice(null)
        const succeeded = await refresh()
        setRefreshing(false)
        if (succeeded) {
          setError(null)
          setRefreshNotice(tr`已刷新 · ${new Date().toLocaleTimeString()}`)
          window.setTimeout(() => setRefreshNotice(null), 2200)
        }
      }

      const runTool = async (tool) => {
        if (toolBusy) return
        setToolsOpen(false)
        setToolBusy(true)
        setToolNotice('')
        setError(null)
        try {
          const oldPid = status?.webPid
          await request(`/mgw/tools/${tool}`, { method: 'POST' })
          if (tool === 'stop-web') {
            stoppedRef.current = true
            setToolNotice(tr('DSH Web 已收到停止指令。需要时可在 Terminal 运行 dsh web 重新启动。'))
            return
          }
          if (tool === 'restart-web') {
            setToolNotice(tr('正在重启 DSH Web，当前连接会短暂中断…'))
            const deadline = Date.now() + 60_000
            while (Date.now() < deadline) {
              await new Promise((resolve) => window.setTimeout(resolve, 700))
              try {
                const next = await request('/mgw/status')
                if (next.webPid && next.webPid !== oldPid) {
                  window.location.reload()
                  return
                }
              } catch { /* old process is shutting down */ }
            }
            throw new Error(tr('DSH Web 重启超时，请检查 /tmp/mobile-gateway.log'))
          }
        } catch (cause) {
          setError(cause.message)
          setToolNotice('')
        } finally {
          setToolBusy(false)
        }
      }

      React.useEffect(() => {
        let active = true
        refresh()
        request('/mgw/public-setup').then((data) => {
          if (!active) return
          setPublicSetup(data)
          if (data.publicUrl) {
            const match = /^wss:\/\/([^/]+)\/ws\/mobile$/.exec(data.publicUrl)
            if (match) setPublicIp(match[1])
          }
        }).catch((cause) => active && setPublicSetup({ installed: false, configured: false, error: cause.message }))
        const timer = window.setInterval(() => { if (!stoppedRef.current) refresh() }, 3000)
        return () => { active = false; window.clearInterval(timer) }
      }, [refresh])

      React.useEffect(() => {
        if (!qr) return
        const previousFocus = document.activeElement
        pairingDialogRef.current?.querySelector('button')?.focus()
        return () => previousFocus?.focus()
      }, [qr])

      const choosePairingRoute = (route) => {
        pairingRouteRef.current = route
        setPairingRoute(route)
        setQr(null)
        if (route === 'custom') {
          automaticUrlRef.current = ''
          return
        }
        if (status) {
          const nextUrl = pairingUrlFor(route, status)
          automaticUrlRef.current = nextUrl
          setPublicUrl(nextUrl)
        }
      }

      const configurePublicAccess = async () => {
        if (publicSetupBusy) return
        setPublicSetupBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/public-setup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicIp }),
          })
          setPublicSetup(data)
          if (data.publicUrl && pairingRouteRef.current === 'auto') {
            automaticUrlRef.current = data.publicUrl
            setPublicUrl(data.publicUrl)
          }
        } catch (cause) {
          setError(cause.message)
        } finally {
          setPublicSetupBusy(false)
        }
      }

      const configureCloudflare = async (enabled, mode = cloudflareMode) => {
        if (cloudflareBusy) return
        setCloudflareBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/cloudflare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, ...(enabled ? {
              mode,
              ...(mode === 'named' ? { hostname: cloudflareHost, token: cloudflareToken } : {}),
            } : {}) }),
          })
          setCloudflareToken('')
          setStatus((current) => ({ ...(current || {}), cloudflare: data, gatewayEnabled: data.gatewayEnabled, gatewayMode: data.gatewayMode, publicUrl: data.publicUrl || null }))
          if (!enabled && pairingRouteRef.current === 'cloudflare') {
            pairingRouteRef.current = 'auto'
            setPairingRoute('auto')
          }
          await refresh()
        } catch (cause) {
          setError(cause.message)
        } finally {
          setCloudflareBusy(false)
        }
      }

      const checkCloudflare = async () => {
        if (cloudflareBusy) return
        setCloudflareBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/cloudflare/check', { method: 'POST' })
          setStatus((current) => ({ ...(current || {}), cloudflare: data }))
        } catch (cause) { setError(cause.message) }
        finally { setCloudflareBusy(false) }
      }

      const restartCloudflare = async () => {
        if (cloudflareBusy) return
        setCloudflareBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/cloudflare/restart', { method: 'POST' })
          if (data.mode === 'quick') setQr(null)
          setStatus((current) => ({ ...(current || {}), cloudflare: data }))
          await refresh()
        } catch (cause) {
          setError(cause.message)
        } finally {
          setCloudflareBusy(false)
        }
      }

      const createPairing = async (endpoint) => request('/mgw/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl: endpoint }),
      })

      const pair = async () => {
        setBusy(true)
        setError(null)
        setPairingTokenCopied(false)
        try {
          const data = await createPairing(publicUrl)
          setQr(data)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }

      const copyPairingText = async () => {
        if (!qr || !qr.qrPayload) return
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error(tr('当前浏览器不允许直接写入剪贴板，请选中文本后手动复制'))
          }
          await navigator.clipboard.writeText(qr.qrPayload)
          setError(null)
          setPairingTokenCopied(true)
          window.setTimeout(() => setPairingTokenCopied(false), 2200)
        } catch (cause) {
          setPairingTokenCopied(false)
          setError(cause.message)
        }
      }

      const changeGatewayMode = async (mode) => {
        setBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/gateway', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode }),
          })
          setStatus((current) => ({ ...(current || {}), ...data }))
          if (mode === 'disabled') setQr(null)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }

      const toggleAuth = async () => {
        const enabled = !(status && status.requireAuth)
        if (!enabled && !window.confirm(tr('关闭设备鉴权后，任何能访问移动网关的人都可以控制 DSH。此选项仅限 Debug 阶段使用，确定继续吗？'))) return
        setBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          })
          setStatus((current) => ({ ...(current || {}), requireAuth: data.requireAuth }))
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }

      const revoke = async (device) => {
        if (revokingIdsRef.current.has(device.id)) return
        setDeviceNotice(null)
        setDeviceNoticeError(false)
        setError(null)
        revokingIdsRef.current.add(device.id)
        setRevokingIds((current) => new Set(current).add(device.id))
        try {
          await request(`/mgw/devices/${encodeURIComponent(device.id)}/revoke`, { method: 'POST' })
          setDevices((current) => Array.isArray(current) ? current.filter((item) => item.id !== device.id) : current)
          setDeviceNotice(tr`已吊销 ${device.displayName || device.name}`)
          window.setTimeout(() => setDeviceNotice(null), 2200)
        } catch (cause) {
          setDeviceNoticeError(true)
          setDeviceNotice(tr`吊销失败：${cause.message}`)
          setError(cause.message)
        } finally {
          revokingIdsRef.current.delete(device.id)
          setRevokingIds((current) => {
            const next = new Set(current)
            next.delete(device.id)
            return next
          })
          await refresh()
        }
      }

      const restartNoticeInstance = status?.gatewayInstanceId || (status?.webPid ? String(status.webPid) : null)
      const dismissRestartNotice = () => {
        dismissedRestartInstance = restartNoticeInstance
        setDismissedNotice(restartNoticeInstance)
        try { window.localStorage.setItem(restartNoticeStorageKey, restartNoticeInstance) } catch { /* keep in-memory dismissal */ }
      }

      const onlineDevices = (devices || []).filter((device) => device.online)
      const offlineDevices = (devices || []).filter((device) => !device.online)
      const visibleDevices = showAllDevices ? [...onlineDevices, ...offlineDevices] : onlineDevices

      const advice = connectionAdvice(status, publicSetup)
      const helpLine = (name, description) => React.createElement('div', { style: { marginTop: 7 } },
        React.createElement('strong', null, name), '：', description)

      return React.createElement('div', { style: styles.backdrop, onMouseDown: () => setOpen(false) },
        qr ? React.createElement('div', { style: { ...styles.backdrop, zIndex: 1201 },
          onMouseDown: (event) => { event.stopPropagation(); closePairingDialog() } },
          React.createElement('div', { className: 'mgw-pairing-dialog', 'data-closing': pairingClosing, ref: pairingDialogRef, role: 'dialog', 'aria-modal': true, 'aria-label': tr('设备配对二维码'), tabIndex: -1,
            style: { ...styles.panel, width: 'min(520px, 100%)', height: 'auto', overflowY: 'auto', scrollbarWidth: 'none' },
            onMouseDown: (event) => event.stopPropagation(),
            onKeyDown: (event) => {
              if (event.key === 'Escape') { event.stopPropagation(); closePairingDialog() }
              if (event.key === 'Tab') {
                const items = [...event.currentTarget.querySelectorAll('button, textarea')]
                const first = items[0], last = items[items.length - 1]
                if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus() }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
              }
            } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
              React.createElement('button', { type: 'button', style: { ...styles.button, ...styles.headerButton }, 'aria-label': tr('关闭配对窗口'), onClick: closePairingDialog }, '✕')),
          React.createElement('section', { style: { textAlign: 'center' } },
            React.createElement('strong', null, tr('使用移动客户端扫码')),
            React.createElement('img', { style: styles.qr, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`, alt: tr('一次性设备配对二维码') }),
            React.createElement('label', { style: { ...styles.label, textAlign: 'left' } }, tr('Base64URL 配对字符串')),
            React.createElement('textarea', { style: styles.pairingText, value: qr.qrPayload, readOnly: true, spellCheck: false, onFocus: (event) => event.target.select() }),
            React.createElement('button', { style: { ...styles.button, width: '100%', marginBottom: 8, borderColor: pairingTokenCopied ? colors.success : colors.border, color: pairingTokenCopied ? colors.success : colors.text }, onClick: copyPairingText }, pairingTokenCopied ? tr('✓ 已复制') : tr('复制配对 Token')),
            pairingTokenCopied ? React.createElement('div', { style: { ...styles.muted, color: colors.success, marginBottom: 8 } }, tr('已复制到剪贴板')) : null,
            React.createElement('div', { style: styles.muted }, tr`有效期至 ${new Date(qr.pairing.expiresAt).toLocaleTimeString()}；扫码成功后此二维码立即失效。`)))) : null,
        React.createElement('aside', { className: 'mobile-gateway-panel', inert: qr ? true : undefined, 'aria-hidden': qr ? true : undefined, style: styles.panel, onMouseDown: (event) => { event.stopPropagation(); setToolsOpen(false) }, role: 'dialog', 'aria-modal': true, 'aria-label': tr('移动设备管理') },
          React.createElement('div', { style: styles.header },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.title }, tr('移动设备')),
              React.createElement('div', { style: styles.muted }, !status ? tr('正在加载网关状态…') : status.gatewayEnabled ? tr`移动网关已开启 · ${status.requireAuth ? tr('设备鉴权已开启') : tr('本机设备鉴权已关闭')}` : tr('移动网关已关闭 · 普通 WebUI 模式'))),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement('div', { style: { position: 'relative' }, onMouseDown: (event) => event.stopPropagation() },
                React.createElement('button', {
                  type: 'button', style: { ...styles.button, ...styles.headerButton, borderRadius: '50%' }, title: tr('工具'), 'aria-label': tr('工具'),
                  'aria-haspopup': 'menu', 'aria-expanded': toolsOpen,
                  onClick: () => setToolsOpen((value) => !value),
                }, React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                  React.createElement('path', { d: 'M10.3 2.8h3.4l.5 2.2a7.6 7.6 0 0 1 1.7.7l1.9-1.2 2.4 2.4L19 8.8c.3.5.5 1.1.7 1.7l2.2.5v3.4l-2.2.5a7.6 7.6 0 0 1-.7 1.7l1.2 1.9-2.4 2.4-1.9-1.2a7.6 7.6 0 0 1-1.7.7l-.5 2.2h-3.4l-.5-2.2a7.6 7.6 0 0 1-1.7-.7l-1.9 1.2-2.4-2.4L5 16.6a7.6 7.6 0 0 1-.7-1.7l-2.2-.5V11l2.2-.5A7.6 7.6 0 0 1 5 8.8L3.8 6.9l2.4-2.4 1.9 1.2a7.6 7.6 0 0 1 1.7-.7l.5-2.2Z' }),
                  React.createElement('circle', { cx: 12, cy: 12.7, r: 3.1 }))),
                toolsOpen ? React.createElement('div', { style: styles.toolsMenu, role: 'menu', 'aria-label': tr('网关工具') },
                  React.createElement('button', {
                    type: 'button', role: 'menuitem', disabled: toolBusy || stoppedRef.current || !status?.tools?.restartWeb,
                    style: { ...styles.toolsItem, opacity: status?.tools?.restartWeb ? 1 : .5 },
                    onClick: () => runTool('restart-web'),
                  }, tr('重启当前网关'),
                  React.createElement('span', { style: { ...styles.muted, display: 'block', marginTop: 2 } }, tr('结束当前进程并重新启动 DSH Web'))),
                  React.createElement('button', {
                    type: 'button', role: 'menuitem', disabled: toolBusy || stoppedRef.current || !status?.tools?.stopWeb,
                    style: { ...styles.toolsItem, color: colors.danger, opacity: status?.tools?.stopWeb ? 1 : .5 },
                    onClick: () => runTool('stop-web'),
                  }, tr('停止 DSH Web'),
                  React.createElement('span', { style: { ...styles.muted, display: 'block', marginTop: 2 } }, tr('结束后台进程，所有连接将断开'))))
                  : null),
              React.createElement('button', { style: { ...styles.button, ...styles.headerButton }, onClick: () => setOpen(false), 'aria-label': tr('关闭') },
                React.createElement('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', 'aria-hidden': true },
                  React.createElement('path', { d: 'M6 6l12 12M18 6L6 18' }))))),
          React.createElement('div', { className: 'mgw-body' },
            React.createElement('nav', { className: 'mgw-nav', 'aria-label': tr('移动网关设置分组') },
              [['general', tr('通用设置')], ['pairing', tr('连接与配对')], ['devices', tr('可信设备')], ['install', tr('安装应用')]].map(([id, label]) =>
                React.createElement('button', { key: id, type: 'button', 'aria-current': activeSection === id ? 'page' : undefined,
                  onClick: () => { setActiveSection(id); setConnectionHelpOpen(false); setToolsOpen(false) } }, label))),
            React.createElement('div', { className: 'mgw-content', key: activeSection },
          React.createElement('div', { hidden: activeSection !== 'install' },
            React.createElement(InstallGuide, { release: installRelease, loading: installLoading, platform: installPlatform, onPlatform: setInstallPlatform })),
          restartNoticeInstance && dismissedNotice !== restartNoticeInstance ? React.createElement('section', { style: { ...styles.card, position: 'relative', padding: '10px 40px 10px 12px', border: '1px solid', borderRadius: 10, marginBottom: 8, background: 'var(--dsw-alias-state-warn-tertiary, #fff7df)', borderColor: 'color-mix(in srgb, #d99a16 35%, transparent)', fontSize: 12, lineHeight: 1.6 }, role: 'note' },
            React.createElement('button', { type: 'button', 'aria-label': tr('关闭重启提醒'), title: tr('关闭提醒'),
              style: { ...styles.button, position: 'absolute', right: 8, top: 8, border: 0, width: 24, height: 24, padding: 0, color: colors.muted },
              onClick: dismissRestartNotice }, '✕'),
            React.createElement('strong', null, tr('若安装或更新后连接异常，请重启应用')),
            React.createElement('div', { style: { color: colors.muted, marginTop: 4 } },
              tr('完全退出并重启 APP／Desktop；Web UI 请重启 DSH Web 服务。')),
            React.createElement('div', { style: { color: colors.muted, marginTop: 4 } },
              tr('端口仍被占用时，请关闭其他 Harness 实例。'))) : null,
          toolNotice ? React.createElement('div', { style: { ...styles.muted, marginBottom: 10 } }, toolNotice) : null,
          error ? React.createElement('div', { style: styles.error }, error) : null,
          React.createElement('div', { hidden: activeSection !== 'general' },
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('strong', null, tr('网关运行模式')),
                React.createElement('div', { style: { ...styles.muted, marginTop: 4 } }, status && status.gatewayEnabled
                  ? status.gatewayMode === 'persistent'
                    ? tr('重启后保持开启')
                    : status.waitExpiresAt
                      ? tr`等待可信设备连接，约 ${Math.max(1, Math.ceil((status.waitExpiresAt - Date.now()) / 60000))} 分钟后自动关闭`
                      : tr('设备已连接过，本次运行保持开启；重启后重新计时')
                  : tr('不接受移动设备连接'))),
              React.createElement('span', { style: { position: 'relative', display: 'inline-flex', flexShrink: 0 } },
                React.createElement(GatewaySelect, {
                  style: { ...styles.input, width: 'auto', marginBottom: 0, padding: '8px 40px 8px 12px', appearance: 'none', WebkitAppearance: 'none' },
                  'aria-label': tr('网关运行模式'),
                  value: status ? status.gatewayMode || (status.gatewayEnabled ? 'temporary' : 'disabled') : 'disabled',
                  disabled: busy || !status,
                  onChange: (event) => changeGatewayMode(event.target.value),
                },
                React.createElement('option', { value: 'disabled' }, tr('关闭')),
                React.createElement('option', { value: 'temporary' }, tr('临时开启')),
                React.createElement('option', { value: 'persistent' }, tr('常驻开启'))),
              )),
            status && status.gatewayId ? React.createElement('div', { style: { ...styles.muted, marginTop: 12, overflowWrap: 'anywhere' } },
              status.gatewayName) : null),
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('strong', null, tr('设备鉴权')),
                React.createElement('div', { style: { ...styles.muted, marginTop: 4 } }, status && status.requireAuth ? tr('已开启，仅允许可信设备连接') : tr('已关闭，仅影响本机 Debug 入口'))),
              React.createElement('label', { style: { ...styles.switch, opacity: busy || !status ? .55 : 1 }, title: status && status.requireAuth ? tr('关闭设备鉴权') : tr('开启设备鉴权') },
                React.createElement('input', {
                  type: 'checkbox',
                  role: 'switch',
                  'aria-label': tr('设备鉴权'),
                  'aria-checked': !!(status && status.requireAuth),
                  checked: !!(status && status.requireAuth),
                  disabled: busy || !status,
                  onChange: toggleAuth,
                  style: styles.switchInput,
                }),
                React.createElement('span', { style: { ...styles.switchTrack, background: status && status.requireAuth ? colors.success : colors.danger } }),
                React.createElement('span', { style: { ...styles.switchKnob, left: status && status.requireAuth ? 21 : 3 } }))),
            status && !status.requireAuth
              ? React.createElement('p', { style: { ...styles.error, margin: '12px 0 0' } }, tr('Debug 模式：本机 DSH 入口将跳过设备凭证校验；独立局域网入口仍强制鉴权。'))
              : null),
          ),
          React.createElement('div', { hidden: activeSection !== 'pairing' },
          React.createElement('section', { style: styles.card },
            React.createElement('div', { className: 'mgw-setting-row' },
            React.createElement('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }, onMouseLeave: () => setConnectionHelpOpen(false) },
              React.createElement('h3', { className: 'mgw-section-title', style: { marginBottom: 0 } }, tr('配对连接方式')),
              React.createElement('button', {
                type: 'button',
                style: styles.helpButton,
                'aria-label': tr('连接方式说明与场景建议'),
                'aria-expanded': connectionHelpOpen,
                'aria-describedby': connectionHelpOpen ? 'mgw-route-help' : undefined,
                onMouseEnter: () => setConnectionHelpOpen(true),
                onFocus: () => setConnectionHelpOpen(true),
                onBlur: () => setConnectionHelpOpen(false),
                onClick: () => setConnectionHelpOpen(true),
                onKeyDown: (event) => { if (event.key === 'Escape') setConnectionHelpOpen(false) },
              }, '?'),
              connectionHelpOpen ? React.createElement('div', { id: 'mgw-route-help', role: 'tooltip', style: styles.helpBubble },
                React.createElement('strong', null, tr('怎么选连接方式')),
                helpLine(tr('局域网直连'), tr('手机与 DSH 在同一个可互访的局域网，使用 ws:// 私有地址；离开该网络就无法直连。')),
                helpLine(tr('Cloudflare Channel（命名 Tunnel）'), tr('PC 主动连接 Cloudflare，外网用固定域名的 wss://；需要 Cloudflare 账户和域名。')),
                helpLine('Quick Channel（Quick Tunnel）', tr('无需账户或域名，Cloudflare 分配临时 wss:// 地址；隧道重建后地址可能变化。')),
                helpLine(tr('公网服务器连接'), tr('DSH 运行在有固定公网 IPv4 的 Linux 服务器上，配置公网入口后用 wss:// 公网 IP 连接。')),
                React.createElement('div', { style: { borderTop: `1px solid ${colors.border}`, marginTop: 10, paddingTop: 8 } },
                  React.createElement('strong', null, tr('结合当前环境')),
                  React.createElement('div', { style: { color: colors.muted, marginTop: 4 } }, advice.detected),
                  React.createElement('div', { style: { marginTop: 6 } }, advice.local),
                  React.createElement('div', { style: { marginTop: 6 } }, advice.remote),
                  React.createElement('div', { style: { color: colors.muted, marginTop: 6 } }, tr('面板无法判断手机当前网络；请按手机所在位置选择，提示不会替你修改选择。'))))
                : null),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 14px', maxWidth: '100%' } },
            React.createElement(GatewaySelect, { style: styles.input, value: pairingRoute, onChange: (event) => choosePairingRoute(event.target.value), disabled: !status, 'aria-label': tr('配对连接方式') },
              React.createElement('option', { value: 'auto' }, tr('自动选择 · 优先外网')),
              lanPairingUrl(status) || pairingRoute === 'lan'
                ? React.createElement('option', { value: 'lan', disabled: !lanPairingUrl(status) }, lanPairingUrl(status)
                  ? tr('局域网直连')
                  : tr('局域网直连 · 当前不可用'))
                : null,
              status?.cloudflare?.enabled ? React.createElement('option', { value: 'cloudflare' }, tr('Cloudflare 外网')) : null,
              React.createElement('option', { value: 'custom' }, tr('手动输入地址'))),
              (pairingRoute === 'auto' || pairingRoute === 'cloudflare') && status?.cloudflare?.supported
                ? React.createElement('span', { style: { fontSize: 12, lineHeight: 1.5, fontWeight: 500,
                    color: 'var(--dsw-alias-link, #4176e6)' } }, tr('外网使用 Cloudflare Tunnel 进行连接，请在下方进行设置。')) : null)),
            React.createElement('label', { style: styles.label }, tr('WebSocket 地址')),
            React.createElement('input', { style: styles.input, value: publicUrl, onChange: (event) => { choosePairingRoute('custom'); setPublicUrl(event.target.value) }, placeholder: 'ws://192.168.1.10:3081/ws/mobile', spellCheck: false }),
            status && status.lan && status.lan.enabled
              ? React.createElement('div', { style: { ...styles.muted, margin: '-7px 0 10px', fontWeight: 500, color: status.lan.error ? colors.danger : status.lan.listening ? colors.success : 'var(--dsw-alias-link, #4176e6)' } },
                  status.lan.error
                    ? tr`局域网监听失败：${status.lan.error}`
                    : status.lan.listening
                      ? tr`局域网入口已开启${status.lan.urls && status.lan.urls.length ? `：${status.lan.urls.join('、')}` : tr`，端口 ${status.lan.port}`}`
                      : tr('局域网入口启动中…'))
              : null,
            React.createElement('button', {
              style: { ...styles.button, ...styles.primary, opacity: busy || !(status && status.gatewayEnabled) || !publicUrl.trim() ? .65 : 1 },
              disabled: busy || !(status && status.gatewayEnabled) || !publicUrl.trim(),
              onClick: pair,
            }, busy ? tr('正在生成…') : !(status && status.gatewayEnabled) ? tr('请先开启移动网关') : !publicUrl.trim() ? tr('等待连接地址') : tr('生成配对二维码')),
            React.createElement('p', { style: { ...styles.muted, margin: '10px 0 0' } }, tr('配对码仅可使用一次，5 分钟内有效。'))),
          (pairingRoute === 'auto' || pairingRoute === 'cloudflare') && status?.cloudflare?.supported
            ? React.createElement('section', { className: 'mgw-cloudflare-block', style: { ...styles.card, background: colors.card, border: 0, borderRadius: 16, padding: 18, marginTop: 16 } },
                React.createElement('h3', { className: 'mgw-section-title' }, tr('Cloudflare Tunnel · 外网接入')),
                React.createElement('p', { style: styles.muted }, tr('首次开启自动准备 Tunnel 组件。')),
                React.createElement('div', { className: 'mgw-setting-row' },
                React.createElement('span', { className: 'mgw-setting-label' }, tr('接入方式')),
                React.createElement(GatewaySelect, { style: styles.input, value: cloudflareMode, 'aria-label': tr('Cloudflare 接入方式'), onChange: (event) => {
                    const mode = event.target.value
                    setCloudflareMode(mode)
                    if (status.cloudflare.enabled && mode !== status.cloudflare.mode &&
                        (mode === 'quick' || (status.cloudflare.configured && cloudflareHost === status.cloudflare.hostname && !cloudflareToken))) {
                      void configureCloudflare(true, mode)
                    }
                  }, disabled: cloudflareBusy },
                  React.createElement('option', { value: 'quick' }, tr('Quick Tunnel · 无需域名')),
                  React.createElement('option', { value: 'named' }, tr('命名 Tunnel · 固定域名')))),
                cloudflareMode === 'quick'
                  ? React.createElement('p', { style: styles.muted }, tr('临时地址可能变化，变化后需重新扫码。'))
                  : React.createElement(React.Fragment, null,
                      React.createElement('p', { style: styles.muted }, tr('先在 Cloudflare 创建命名 Tunnel，把公开域名的 Service URL 设为 '), React.createElement('code', null, `http://127.0.0.1:${status.cloudflare.port}`), tr('。Tunnel Token 仅授权连接，不能自动创建公开主机名或 DNS；还需确认域名存在指向 Tunnel UUID.cfargotunnel.com 的已代理 CNAME 记录。')),
                      React.createElement('label', { style: styles.label }, tr('公开域名')),
                      React.createElement('input', { style: styles.input, value: cloudflareHost, onChange: (event) => setCloudflareHost(event.target.value.trim()), placeholder: 'gateway.example.com', spellCheck: false }),
                      React.createElement('label', { style: styles.label }, 'Tunnel Token'),
                      React.createElement('input', { style: styles.input, type: 'password', value: cloudflareToken, onChange: (event) => setCloudflareToken(event.target.value.trim()), placeholder: status.cloudflare.configured ? tr('已保存；留空则保持原 Token') : tr('粘贴 eyJ… Token'), autoComplete: 'off', spellCheck: false })),
                (!status.cloudflare.enabled || (cloudflareMode === 'named' &&
                  (status.cloudflare.mode !== 'named' || cloudflareHost !== status.cloudflare.hostname || !!cloudflareToken)))
                  ? React.createElement('button', {
                  style: { ...styles.button, ...styles.primary, opacity: cloudflareBusy || (cloudflareMode === 'named' && (!cloudflareHost || (!cloudflareToken && !status.cloudflare.configured))) ? .65 : 1 },
                  disabled: cloudflareBusy || (cloudflareMode === 'named' && (!cloudflareHost || (!cloudflareToken && !status.cloudflare.configured))),
                  onClick: () => configureCloudflare(true),
                }, cloudflareBusy ? tr('正在处理…') : status.cloudflare.enabled ? tr('保存并连接') : cloudflareMode === 'quick' ? tr('一键开启 Quick Tunnel') : tr('开启命名 Tunnel')) : null,
                status.cloudflare.enabled
                  ? React.createElement(React.Fragment, null,
                      React.createElement('button', { style: { ...styles.button, width: '100%', marginTop: 8 }, disabled: cloudflareBusy || status.cloudflare.state !== 'online', onClick: checkCloudflare }, tr('检测公网 DNS / TLS / WebSocket')),
                      React.createElement('button', { style: { ...styles.button, width: '100%', marginTop: 8 }, disabled: cloudflareBusy || !status.gatewayEnabled, onClick: restartCloudflare }, tr('重启 Tunnel')),
                      React.createElement('button', { style: { ...styles.button, width: '100%', marginTop: 8 }, disabled: cloudflareBusy, onClick: () => configureCloudflare(false) }, tr('关闭 Cloudflare Tunnel')),
                      React.createElement('p', { style: styles.muted }, tr('重启会短暂断开连接。')))
                  : null,
                React.createElement('div', { style: { ...styles.muted, marginTop: 9, overflowWrap: 'anywhere', fontWeight: 500, color: status.cloudflare.error ? colors.danger : status.cloudflare.state === 'online' ? colors.success : ['starting', 'preparing', 'connecting'].includes(status.cloudflare.state) ? 'var(--dsw-alias-link, #4176e6)' : colors.muted } },
                  status.cloudflare.error || ({ disabled: tr('未开启'), starting: tr('正在启动本机入口…'), preparing: tr('正在准备 cloudflared（首次需下载）…'), connecting: tr('正在连接 Cloudflare…'), online: tr('隧道传输已连接（不等于公网入口可达）'), 'waiting-for-gateway': tr('等待移动网关开启') }[status.cloudflare.state] || status.cloudflare.state),
                  status.cloudflare.publicUrl ? ` · ${status.cloudflare.publicUrl}` : ''),
                 status.cloudflare.enabled && status.cloudflare.endpointHealth
                   ? React.createElement('p', { style: { ...styles.muted, overflowWrap: 'anywhere', fontWeight: 500, color: status.cloudflare.endpointHealth.state === 'reachable' ? colors.success : status.cloudflare.endpointHealth.state === 'checking' ? 'var(--dsw-alias-link, #4176e6)' : status.cloudflare.endpointHealth.state === 'unchecked' ? colors.muted : colors.danger } },
                       status.cloudflare.endpointHealth.message,
                       status.cloudflare.endpointHealth.checkedAt ? tr`（检测时间：${status.cloudflare.endpointHealth.checkedAt}）` : '')
                   : null)
              : null,
          status && status.platform === 'linux' ? React.createElement('section', { style: styles.card },
            React.createElement('h3', { className: 'mgw-section-title' }, tr('公网接入')),
            publicSetup === null
              ? React.createElement('p', { style: styles.muted }, tr('正在检查系统组件…'))
              : publicSetup.installed
                ? React.createElement(React.Fragment, null,
                    React.createElement('div', { style: { ...styles.muted, margin: '5px 0 12px' } }, publicSetup.configured
                      ? publicSetup.backendPort && status && status.webPort && publicSetup.backendPort !== status.webPort
                        ? tr`端口需要更新：Nginx 当前为 ${publicSetup.backendPort}，DSH 当前为 ${status.webPort}`
                        : tr`已配置${publicSetup.backendPort ? tr`，Nginx 转发至 DSH 端口 ${publicSetup.backendPort}` : ''}`
                      : tr`Helper 已就绪，将自动使用当前 DSH 端口${status && status.webPort ? ` ${status.webPort}` : ''}`),
                    React.createElement('label', { style: styles.label }, tr('服务器公网 IPv4')),
                    React.createElement('input', {
                      style: styles.input,
                      value: publicIp,
                      onChange: (event) => setPublicIp(event.target.value.trim()),
                      placeholder: '203.0.113.10',
                      inputMode: 'decimal',
                      spellCheck: false,
                    }),
                    React.createElement('button', {
                      style: { ...styles.button, ...styles.primary, opacity: publicSetupBusy || !publicIp ? .65 : 1 },
                      disabled: publicSetupBusy || !publicIp,
                      onClick: configurePublicAccess,
                    }, publicSetupBusy ? tr('正在配置 Nginx 与证书…') : publicSetup.configured ? tr('更新公网配置') : tr('配置公网接入')),
                    publicSetup.publicUrl
                      ? React.createElement('div', { style: { ...styles.muted, marginTop: 9, overflowWrap: 'anywhere' } }, publicSetup.publicUrl)
                      : null)
                : React.createElement(React.Fragment, null,
                    React.createElement('p', { style: { ...styles.muted, marginBottom: 8 } }, tr('尚未安装系统 Helper。请在服务器执行一次初始化：')),
                    React.createElement('code', { style: { display: 'block', fontSize: 10, lineHeight: 1.5, overflowWrap: 'anywhere', userSelect: 'all' } }, 'npx --yes dsh-plugin-mobile-gateway@latest init'))) : null,

          ),
          React.createElement('div', { hidden: activeSection !== 'devices' },
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('h3', { className: 'mgw-section-title', style: { marginBottom: 0 } }, tr('可信设备')),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                deviceNotice || refreshNotice ? React.createElement('span', {
                  style: { ...styles.muted, color: deviceNoticeError ? colors.danger : colors.success },
                }, deviceNotice || refreshNotice) : null,
                React.createElement('button', {
                  style: { ...styles.button, opacity: refreshing ? .6 : 1 },
                  disabled: refreshing,
                  onClick: manualRefresh,
                }, refreshing ? tr('刷新中…') : tr('刷新')))),
            devices === null
              ? React.createElement('p', { style: styles.muted }, tr('加载中…'))
              : devices.length === 0
                ? React.createElement('p', { style: styles.muted }, tr('暂无已配对设备。'))
                : React.createElement(React.Fragment, null,
                  visibleDevices.length === 0 ? React.createElement('p', { style: styles.muted }, tr('当前没有在线设备。')) : null,
                  visibleDevices.map((device) => React.createElement(DeviceRow, {
                    key: device.id,
                    device,
                    onRevoke: revoke,
                    revoking: revokingIds.has(device.id),
                  })),
                  offlineDevices.length > 0 ? React.createElement('button', {
                    type: 'button',
                    style: { ...styles.button, marginTop: 10, color: colors.muted },
                    'aria-expanded': showAllDevices,
                    onClick: () => setShowAllDevices((value) => !value),
                  }, showAllDevices ? tr('收起离线设备') : tr`展开其他已配对设备（${offlineDevices.length}）`) : null)),
          )),
          ),
          status && status.version
            ? React.createElement('div', { style: styles.version, 'aria-label': tr`插件版本 ${status.version}` }, `v${status.version}`)
            : null))
    }

    function FooterButton(props) {
      const isOpen = React.useSyncExternalStore(subscribe, getOpen)
      const wide = !!props.wide
      const iconSize = wide ? 16 : 18
      const icon = React.createElement('svg', {
        width: iconSize,
        height: iconSize,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.8,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      React.createElement('rect', { x: 6, y: 2, width: 12, height: 20, rx: 2.5 }),
      React.createElement('path', { d: 'M10 18h4' }))
      return React.createElement('button', {
        title: tr('移动设备管理'),
        'aria-label': tr('移动设备管理'),
        'aria-pressed': isOpen,
        onClick: () => setOpen(!isOpen),
        style: {
          cursor: 'pointer',
          background: 'transparent',
          border: 'none',
          color: 'inherit',
          font: 'inherit',
          display: 'flex',
          alignItems: 'center',
          justifyContent: wide ? 'flex-start' : 'center',
          gap: wide ? 8 : 0,
          boxSizing: 'border-box',
          width: wide ? 'calc(100% + 4px)' : 36,
          height: wide ? 42 : 36,
          margin: wide ? '4px -2px' : '3px 0',
          padding: wide ? '0 10px 0 8px' : 0,
          lineHeight: wide ? '22px' : 'normal',
        },
      }, icon, wide ? React.createElement('span', null, tr('移动设备')) : null)
    }

    function OverlayEntry() {
      const isOpen = React.useSyncExternalStore(subscribe, getOpen)
      return isOpen ? React.createElement(DevicePanel) : null
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.textContent = panelCss
        document.head.appendChild(style)
        return () => style.remove()
      }, 'mobile-gateway: panel styles')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'mobile-gateway-devices', order: 80, label: tr('移动设备') },
        (props) => React.createElement(FooterButton, props),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'mobile-gateway-devices-panel', order: 100, label: tr('移动设备') },
        () => React.createElement(OverlayEntry),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
