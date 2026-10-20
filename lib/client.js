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
        if (forced === 'en' || forced === 'zh') return forced
      } catch { /* storage unavailable */ }
      try {
        if (window.__MGW_UI_LOCALE__ === 'en' || window.__MGW_UI_LOCALE__ === 'zh') return window.__MGW_UI_LOCALE__
      } catch { /* window unavailable */ }
      try { return /^en\b/i.test(String(navigator.language || '')) ? 'en' : 'zh' } catch { return 'zh' }
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
  "插件版本 \u0000": "Plugin version \u0000"
}
    function tr(strings, ...values) {
      if (typeof strings === 'string') return UI_LOCALE === 'en' ? (EN_UI[strings] ?? strings) : strings
      const key = strings.raw.join('\u0000')
      const translated = UI_LOCALE === 'en' ? EN_UI[key] : undefined
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

    function DevicePanel() {
      const [activeSection, setActiveSection] = React.useState('general')
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
              [['general', tr('通用设置')], ['pairing', tr('连接与配对')], ['devices', tr('可信设备')]].map(([id, label]) =>
                React.createElement('button', { key: id, type: 'button', 'aria-current': activeSection === id ? 'page' : undefined,
                  onClick: () => { setActiveSection(id); setConnectionHelpOpen(false); setToolsOpen(false) } }, label))),
            React.createElement('div', { className: 'mgw-content', key: activeSection },
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
