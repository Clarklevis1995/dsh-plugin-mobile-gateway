// Browser half of dsh-plugin-mobile-gateway. The package manifest makes this
// bundle part of DSH's client-module graph; it contributes one sidebar footer
// action and one shell overlay without replacing shipped UI seats.
window.__ModuleLoader__.load({
  id: 'dsh-plugin-mobile-gateway',
  factory: (require) => {
    const React = require('react')
    const module = { exports: {} }
    const exports = module.exports

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
    // Bilingual management copy adapted from Clarklevis1995/dsh-plugin-mobile-gateway PR #16.
    // Management-UI copy in Chinese and English. A saved plugin override wins;
    // otherwise follow Harness locale, with browser language as the provisional
    // fallback. Unsupported languages fall back to English.
    const LANG_KEY = 'mgw-ui-lang'
    const readSavedLanguage = () => {
      try {
        const saved = typeof localStorage !== 'undefined' && localStorage.getItem(LANG_KEY)
        if (saved === 'zh' || saved === 'en') return saved
      } catch { /* storage unavailable */ }
      return null
    }
    const browserLanguage = () =>
      (typeof navigator !== 'undefined' && /^zh(-|$)/i.test(navigator.language || '')) ? 'zh' : 'en'
    let languageOverride = readSavedLanguage()
    let hostLanguage = null
    let UI_LANG = languageOverride || browserLanguage()
    const languageListeners = new Set()
    const subscribeLanguage = (listener) => {
      languageListeners.add(listener)
      return () => languageListeners.delete(listener)
    }
    const getLanguage = () => UI_LANG
    const publishLanguage = (lang) => {
      if (lang === UI_LANG) return
      UI_LANG = lang
      for (const listener of languageListeners) listener()
    }
    const setUiLang = (lang) => {
      if (lang !== 'zh' && lang !== 'en') return
      languageOverride = lang
      try { if (typeof localStorage !== 'undefined') localStorage.setItem(LANG_KEY, lang) } catch { /* storage unavailable */ }
      publishLanguage(lang)
    }
    const followHostLanguage = () => {
      languageOverride = null
      try { if (typeof localStorage !== 'undefined') localStorage.removeItem(LANG_KEY) } catch { /* storage unavailable */ }
      publishLanguage(hostLanguage || browserLanguage())
    }
    // Live lookup so a language switch applies on the next render without
    // rewiring every call site (connectionAdvice and DeviceRow read T too).
    const STRINGS = {
      zh: {
        adviceLoading: '正在读取网关环境…',
        sysMacos: 'macOS 电脑', sysWindows: 'Windows 电脑', sysLinux: 'Linux 服务器', sysOther: '当前设备',
        detectedPrefix: '当前检测：', detectedLan: '；局域网入口', detectedSep: '；', detectedEnd: '。',
        ready: '已就绪', notReady: '未就绪',
        serverReady: '公网服务器入口已配置', namedTunnel: '命名', tunnelConnected: 'Tunnel 已连接',
        tunnelConnecting: 'Cloudflare Tunnel 连接中', remoteNotConnected: '外网入口未连接',
        localLanOk: '手机与 DSH 处于可互访的同一局域网时，建议选“局域网直连”。',
        localLanCheck: '如果手机和 DSH 在同一局域网，先确认局域网入口已开启并监听成功。',
        remoteServer: '手机在外网时，建议使用已配置的公网服务器地址（“自动选择”）。',
        remoteNamed: '手机在外网时，建议选“Cloudflare 外网”；当前命名 Tunnel 有固定域名。',
        remoteQuick: '手机在外网临时使用时，建议选“Cloudflare 外网”；Quick 地址变化后需要重新确认。',
        remoteNoDomain: '手机在外网时，无自有域名可开启 Quick Tunnel；有域名且需要固定地址可配置命名 Tunnel。',
        remoteLinux: '手机在外网时，若使用受支持的 Ubuntu/Debian 服务器且有固定公网 IPv4，可先配置“公网接入”，再选“自动选择”。',
        remoteManual: '手机在外网时，需要一个可访问的 wss:// 地址；可在“手动输入地址”中填写。',
        online: '在线', offline: '离线', neverConnected: '尚未连接',
        conns: (n) => ` · ${n} 个连接`,
        lastSeenAt: (s) => `最近连接：${s}`,
        revokeTitle: (name) => `吊销 ${name}`,
        revoke: '吊销', revoking: '吊销中…',
        refreshedAt: (time) => `已刷新 · ${time}`,
        stopNotice: 'DSH Web 已收到停止指令。需要时可在 Terminal 运行 dsh web 重新启动。',
        restartingNotice: '正在重启 DSH Web，当前连接会短暂中断…',
        restartTimeout: 'DSH Web 重启超时，请检查 /tmp/mobile-gateway.log',
        clipboardError: '当前浏览器不允许直接写入剪贴板，请选中文本后手动复制',
        confirmDisableAuth: '关闭设备鉴权后，任何能访问移动网关的人都可以控制 DSH。此选项仅限 Debug 阶段使用，确定继续吗？',
        revokedIs: (name) => `已吊销 ${name}`,
        revokeFailIs: (msg) => `吊销失败：${msg}`,
        colon: '：',
        panelAria: '移动设备管理', panelTitle: '移动设备',
        langToggle: '切换语言', langOther: 'EN', langAuto: '自动', langFollowHost: '跟随应用语言',
        gatewayOn: '移动网关已开启 · 设备鉴权生效中', gatewayOff: '移动网关已关闭 · 普通 WebUI 模式',
        toolsTitle: '工具', toolsMenuAria: '网关工具',
        restartGateway: '重启当前网关', restartGatewayHint: '结束当前进程并重新启动 DSH Web',
        stopWeb: '停止 DSH Web', stopWebHint: '结束后台进程，所有连接将断开',
        closeAria: '关闭',
        modeTitle: '网关运行模式',
        modePersistentHint: '常驻开启，重启后保持；无需设备在线',
        tempWait: (mins) => `等待可信设备连接，约 ${mins} 分钟后自动关闭`,
        modeTempUsed: '设备已连接过，本次运行保持开启；重启后重新计时',
        modeOffHint: '关闭时不会接受移动设备连接，重启后保持关闭',
        modeOff: '关闭', modeTemporary: '临时开启', modePersistent: '常驻开启',
        authTitle: '设备鉴权',
        authOn: '已开启，仅允许可信设备连接', authOff: '已关闭，仅影响本机 Debug 入口',
        authEnable: '开启设备鉴权', authDisable: '关闭设备鉴权',
        debugNote: 'Debug 模式：本机 DSH 入口将跳过设备凭证校验；独立局域网入口仍强制鉴权。',
        cfTitle: 'Cloudflare Tunnel · PC 外网接入',
        cfIntro: '首次开启时自动下载并校验 cloudflared；公网入口只接受已鉴权的移动 WebSocket。',
        cfMethod: '接入方式', cfQuick: 'Quick Tunnel · 无需域名', cfNamed: '命名 Tunnel · 固定域名',
        cfQuickNote: 'Cloudflare 会分配随机地址；DSH 重启或隧道重连后地址可能改变，手机需重新扫码确认新地址。适合临时使用。',
        cfNamedIntro: '先在 Cloudflare 创建命名 Tunnel，把公开域名的 Service URL 设为 ',
        cfNamedEnd: '。',
        cfDomain: '公开域名',
        cfTokenKept: '已保存；留空则保持原 Token', cfTokenPaste: '粘贴 eyJ… Token',
        cfWorking: '正在处理…', cfUpdate: '更新 Tunnel 配置',
        cfStartQuick: '一键开启 Quick Tunnel', cfStartNamed: '开启命名 Tunnel',
        cfStop: '关闭 Cloudflare Tunnel',
        cfRestart: '重启 Tunnel',
        cfRestartNote: '重启会短暂断开手机连接；Quick Tunnel 可能获得新地址，需要重新扫码。',
        cfRestartError: '请先开启移动网关和 Cloudflare Tunnel',
        restartUnavailable: '只能在通过 dsh web 启动的 Web profile 中重启',
        stopUnavailable: '只能停止通过 dsh web 启动的 Web profile',
        restartPending: 'DSH Web 正在重启',
        stopPending: 'DSH Web 正在重启或停止',
        unnamedDevice: '未命名设备',
        cfOff: '未开启', cfStarting: '正在启动本机入口…',
        cfPreparing: '正在准备 cloudflared（首次需下载）…',
        cfConnecting: '正在连接 Cloudflare…', cfOnline: '已连接 Cloudflare',
        cfWaitGateway: '等待移动网关开启',
        listSep: '、',
        publicTitle: '公网接入', publicChecking: '正在检查系统组件…',
        portLine: (be, web) => `端口需要更新：Nginx 当前为 ${be}，DSH 当前为 ${web}`,
        configuredLine: (port) => port ? `已配置，Nginx 转发至 DSH 端口 ${port}` : '已配置',
        helperLine: (web) => `Helper 已就绪，将自动使用当前 DSH 端口${web ? ` ${web}` : ''}`,
        publicIpv4: '服务器公网 IPv4',
        publicWorking: '正在配置 Nginx 与证书…',
        publicUpdate: '更新公网配置', publicSetup: '配置公网接入',
        publicNoHelper: '尚未安装系统 Helper。请在服务器执行一次初始化：',
        pairingTitle: '配对连接方式', pairingGuideAria: '连接方式说明与场景建议',
        pairingGuide: '怎么选连接方式',
        routeLan: '局域网直连', routeLanDesc: '手机与 DSH 在同一个可互访的局域网，使用 ws:// 私有地址；离开该网络就无法直连。',
        routeCfNamed: 'Cloudflare Channel（命名 Tunnel）', routeCfNamedDesc: 'PC 主动连接 Cloudflare，外网用固定域名的 wss://；需要 Cloudflare 账户和域名。',
        routeCfQuick: 'Quick Channel（Quick Tunnel）', routeCfQuickDesc: '无需账户或域名，Cloudflare 分配临时 wss:// 地址；隧道重建后地址可能变化。',
        routePublic: '公网服务器连接', routePublicDesc: 'DSH 运行在有固定公网 IPv4 的 Linux 服务器上，配置公网入口后用 wss:// 公网 IP 连接。',
        pairingEnv: '结合当前环境',
        pairingEnvNote: '面板无法判断手机当前网络；请按手机所在位置选择，提示不会替你修改选择。',
        routeAuto: '自动选择 · 优先外网', routeCf: 'Cloudflare 外网', routeCustom: '手动输入地址',
        wsAddress: 'WebSocket 地址',
        lanFailed: (err) => `局域网监听失败：${err}`,
        lanOnUrls: (urls) => `局域网入口已开启：${urls}`,
        lanOnPort: (port) => `局域网入口已开启，端口 ${port}`,
        lanStarting: '局域网入口启动中…',
        lanRouteWith: (host) => `局域网直连 · ${host}`,
        lanUnavailable: '局域网直连 · 当前不可用',
        deviceName: '设备名称',
        generating: '正在生成…', needGatewayFirst: '请先开启移动网关',
        waitUrl: '等待连接地址', makeQr: '生成配对二维码',
        pairingNote: '同一局域网选择“局域网直连”，无需关闭 Cloudflare Tunnel。局域网使用私有地址的 ws://；公网地址必须使用 wss://。配对码只能使用一次，并在 5 分钟内过期。',
        iosScan: '使用 iOS 客户端扫码', qrAlt: '一次性设备配对二维码',
        pairingString: 'Base64URL 配对字符串',
        copied: '✓ 已复制', copyToken: '复制配对 Token',
        copiedNote: '已复制到剪贴板',
        validUntilAt: (time) => `有效期至 ${time}；扫码成功后此二维码立即失效。`,
        trustedTitle: '可信设备', refreshing: '刷新中…', refresh: '刷新',
        loading: '加载中…', noDevices: '暂无已配对设备。',
        pluginVersion: (v) => `插件版本 ${v}`,
      },
      en: {
        adviceLoading: 'Reading gateway environment…',
        sysMacos: 'macOS computer', sysWindows: 'Windows computer', sysLinux: 'Linux server', sysOther: 'Current device',
        detectedPrefix: 'Detected: ', detectedLan: '; LAN entry ', detectedSep: ';', detectedEnd: '.',
        ready: 'ready', notReady: 'not ready',
        serverReady: 'public server entry configured', namedTunnel: 'Named', tunnelConnected: 'tunnel connected',
        tunnelConnecting: 'Connecting to Cloudflare Tunnel', remoteNotConnected: 'remote entry not connected',
        localLanOk: 'When the phone and DSH share a mutually reachable LAN, choose “Direct LAN”.',
        localLanCheck: 'If the phone and DSH are on the same LAN, confirm the LAN entry is enabled and listening.',
        remoteServer: 'When the phone is off-LAN, use the configured public server address (“Automatic”).',
        remoteNamed: 'When the phone is off-LAN, choose “Cloudflare Remote”; the named tunnel has a fixed domain.',
        remoteQuick: 'For temporary off-LAN use, choose “Cloudflare Remote”; re-confirm if the Quick address changes.',
        remoteNoDomain: 'When the phone is off-LAN, start a Quick Tunnel with no domain of your own; with a domain and a need for a fixed address, configure a named tunnel.',
        remoteLinux: 'When the phone is off-LAN, on a supported Ubuntu/Debian server with a fixed public IPv4, set up “Public access” first, then choose “Automatic”.',
        remoteManual: 'When the phone is off-LAN, you need a reachable wss:// address; enter it under “Enter address manually”.',
        online: 'Online', offline: 'Offline', neverConnected: 'Never connected',
        conns: (n) => ` · ${n} connections`,
        lastSeenAt: (s) => `Last connected: ${s}`,
        revokeTitle: (name) => `Revoke ${name}`,
        revoke: 'Revoke', revoking: 'Revoking…',
        refreshedAt: (time) => `Refreshed · ${time}`,
        stopNotice: 'DSH Web received the stop command. Restart it with dsh web in a terminal when needed.',
        restartingNotice: 'Restarting DSH Web; the current connection will drop briefly…',
        restartTimeout: 'DSH Web restart timed out; check /tmp/mobile-gateway.log',
        clipboardError: 'This browser blocks direct clipboard writes; select the text and copy it manually',
        confirmDisableAuth: 'Turning off device auth lets anyone who can reach the mobile gateway control DSH. Only use this while debugging. Continue?',
        revokedIs: (name) => `Revoked ${name}`,
        revokeFailIs: (msg) => `Revoke failed: ${msg}`,
        colon: ': ',
        panelAria: 'Mobile device management', panelTitle: 'Mobile devices',
        langToggle: 'Switch language', langOther: '中文', langAuto: 'Auto', langFollowHost: 'Use app language',
        gatewayOn: 'Mobile gateway on · device auth enforced', gatewayOff: 'Mobile gateway off · plain WebUI mode',
        toolsTitle: 'Tools', toolsMenuAria: 'Gateway tools',
        restartGateway: 'Restart current gateway', restartGatewayHint: 'Exit the current process and restart DSH Web',
        stopWeb: 'Stop DSH Web', stopWebHint: 'End the background process; all connections will drop',
        closeAria: 'Close',
        modeTitle: 'Gateway mode',
        modePersistentHint: 'Always on, persists across restarts; no device needs to be online',
        tempWait: (mins) => `Waiting for a trusted device, about ${mins} min, then closes automatically`,
        modeTempUsed: 'A device has connected; stays on for this run, timer restarts on reboot',
        modeOffHint: 'Off: no mobile connections accepted; stays off after restart',
        modeOff: 'Off', modeTemporary: 'Temporary', modePersistent: 'Always on',
        authTitle: 'Device auth',
        authOn: 'On: only trusted devices may connect', authOff: 'Off: only affects the local debug entry',
        authEnable: 'Turn on device auth', authDisable: 'Turn off device auth',
        debugNote: 'Debug mode: the local DSH entry skips device credential checks; the separate LAN entry still enforces auth.',
        cfTitle: 'Cloudflare Tunnel · PC remote access',
        cfIntro: 'On first enable, cloudflared is downloaded and verified automatically; the public entry only accepts authenticated mobile WebSockets.',
        cfMethod: 'Access method', cfQuick: 'Quick Tunnel · no domain needed', cfNamed: 'Named tunnel · fixed domain',
        cfQuickNote: 'Cloudflare assigns a random address; it may change after a DSH restart or tunnel reconnect, so the phone must re-scan to confirm the new address. Best for temporary use.',
        cfNamedIntro: 'First create a named tunnel in Cloudflare and set the public hostname’s Service URL to ',
        cfNamedEnd: '.',
        cfDomain: 'Public domain',
        cfTokenKept: 'Saved; leave blank to keep the current token', cfTokenPaste: 'Paste eyJ… token',
        cfWorking: 'Working…', cfUpdate: 'Update tunnel config',
        cfStartQuick: 'Start Quick Tunnel', cfStartNamed: 'Start named tunnel',
        cfStop: 'Turn off Cloudflare Tunnel',
        cfRestart: 'Restart Tunnel',
        cfRestartNote: 'Restarting briefly disconnects your phone. Quick Tunnel may receive a new address; scan the new QR code to reconnect.',
        cfRestartError: 'Enable the mobile gateway and Cloudflare Tunnel first',
        restartUnavailable: 'Can only restart a Web profile launched via dsh web',
        stopUnavailable: 'Can only stop a Web profile launched via dsh web',
        restartPending: 'DSH Web is restarting',
        stopPending: 'DSH Web is restarting or stopping',
        unnamedDevice: 'Unnamed device',
        cfOff: 'Off', cfStarting: 'Starting local entry…',
        cfPreparing: 'Preparing cloudflared (first run downloads it)…',
        cfConnecting: 'Connecting to Cloudflare…', cfOnline: 'Connected to Cloudflare',
        cfWaitGateway: 'Waiting for mobile gateway',
        listSep: ', ',
        publicTitle: 'Public access', publicChecking: 'Checking system components…',
        portLine: (be, web) => `Port needs updating: Nginx currently ${be}, DSH currently ${web}`,
        configuredLine: (port) => port ? `Configured, Nginx forwards to DSH port ${port}` : 'Configured',
        helperLine: (web) => `Helper ready; current DSH port is used automatically${web ? ` ${web}` : ''}`,
        publicIpv4: 'Server public IPv4',
        publicWorking: 'Configuring Nginx and certificates…',
        publicUpdate: 'Update public config', publicSetup: 'Set up public access',
        publicNoHelper: 'System helper not installed. Run one-time setup on the server:',
        pairingTitle: 'Pairing connection method', pairingGuideAria: 'Connection method guide and scenario advice',
        pairingGuide: 'Which connection method to choose',
        routeLan: 'Direct LAN', routeLanDesc: 'Phone and DSH are on the same mutually reachable LAN, using ws:// private addresses; no direct connection outside that network.',
        routeCfNamed: 'Cloudflare Channel (named tunnel)', routeCfNamedDesc: 'The PC connects out to Cloudflare; external access uses a fixed-domain wss://; needs a Cloudflare account and domain.',
        routeCfQuick: 'Quick Channel (Quick Tunnel)', routeCfQuickDesc: 'No account or domain needed; Cloudflare assigns a temporary wss:// address; it may change when the tunnel is rebuilt.',
        routePublic: 'Public server connection', routePublicDesc: 'DSH runs on a Linux server with a fixed public IPv4; connect via the wss:// public IP after configuring the public entry.',
        pairingEnv: 'For your current environment',
        pairingEnvNote: 'The panel cannot tell which network the phone is on; choose by where the phone is. Suggestions never change your selection.',
        routeAuto: 'Automatic · prefer remote', routeCf: 'Cloudflare Remote', routeCustom: 'Enter address manually',
        wsAddress: 'WebSocket address',
        lanFailed: (err) => `LAN listen failed: ${err}`,
        lanOnUrls: (urls) => `LAN entry on: ${urls}`,
        lanOnPort: (port) => `LAN entry on, port ${port}`,
        lanStarting: 'Starting LAN entry…',
        lanRouteWith: (host) => `Direct LAN · ${host}`,
        lanUnavailable: 'Direct LAN · currently unavailable',
        deviceName: 'Device name',
        generating: 'Generating…', needGatewayFirst: 'Enable the mobile gateway first',
        waitUrl: 'Waiting for connection address', makeQr: 'Generate pairing QR code',
        pairingNote: 'On the same LAN choose “Direct LAN”; no need to turn off the Cloudflare Tunnel. LAN uses ws:// private addresses; public addresses must use wss://. Each pairing code is single-use and expires in 5 minutes.',
        iosScan: 'Scan with the iOS client', qrAlt: 'One-time device pairing QR code',
        pairingString: 'Base64URL pairing string',
        copied: '✓ Copied', copyToken: 'Copy pairing token',
        copiedNote: 'Copied to clipboard',
        validUntilAt: (time) => `Valid until ${time}; this QR code expires immediately after a successful scan.`,
        trustedTitle: 'Trusted devices', refreshing: 'Refreshing…', refresh: 'Refresh',
        loading: 'Loading…', noDevices: 'No paired devices yet.',
        pluginVersion: (v) => `Plugin version ${v}`,
      },
    }
    const T = new Proxy({}, { get: (_, key) => STRINGS[UI_LANG][key] })
    const message = (key, ...args) => ({ key, args })
    const formatMessage = (value) => {
      if (!value) return ''
      if (typeof value === 'string') return localizedError(value)
      if (value.key === 'refreshedAt') return T.refreshedAt(localTime(value.at))
      if (value.key === 'revokedIs') return T.revokedIs(deviceLabel(value.device))
      if (value.key === 'revokeFailIs') return T.revokeFailIs(localizedError(value.args[0]))
      const translated = T[value.key]
      return typeof translated === 'function' ? translated(...value.args) : translated
    }
    // Localize known management errors without changing error codes or hiding
    // unknown diagnostics from the server. Resolve at render time for switching.
    const localizedError = (value) => {
      for (const key of ['cfRestartError', 'restartUnavailable', 'stopUnavailable', 'restartPending', 'stopPending', 'restartTimeout', 'clipboardError']) {
        if (value === STRINGS.en[key] || value === STRINGS.zh[key]) return T[key]
      }
      return value
    }
    const deviceLabel = (device) => device.name || T.unnamedDevice
    const locale = () => UI_LANG === 'zh' ? 'zh-CN' : 'en'
    const localTime = (value) => new Date(value).toLocaleTimeString(locale())

    const colors = {
      panel: 'var(--color-bg, #111318)',
      card: 'var(--color-bg-elevated, rgba(127,127,127,.08))',
      text: 'var(--color-text, #f4f4f5)',
      muted: 'var(--color-text-muted, #9297a2)',
      border: 'var(--color-border, rgba(127,127,127,.24))',
      accent: 'var(--color-primary, #4f7cff)',
      danger: '#dc4c64',
      success: '#2fb171',
    }
    const styles = {
      backdrop: {
        position: 'fixed', inset: 0, zIndex: 1200, pointerEvents: 'auto',
        background: 'rgba(0,0,0,.32)', display: 'flex', justifyContent: 'flex-end',
      },
      panel: {
        width: 380, maxWidth: 'calc(100vw - 24px)', height: '100%', overflowY: 'auto',
        display: 'flex', flexDirection: 'column',
        background: colors.panel, color: colors.text, borderLeft: `1px solid ${colors.border}`,
        boxShadow: '-12px 0 40px rgba(0,0,0,.22)', padding: 20,
        fontFamily: 'system-ui, sans-serif', fontSize: 13, boxSizing: 'border-box',
      },
      header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18, flexShrink: 0 },
      title: { margin: 0, fontSize: 18, fontWeight: 650 },
      card: { background: colors.card, border: `1px solid ${colors.border}`, borderRadius: 12, padding: 14, marginBottom: 12, flexShrink: 0 },
      label: { display: 'block', color: colors.muted, fontSize: 12, marginBottom: 6 },
      input: { width: '100%', boxSizing: 'border-box', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '8px 10px', marginBottom: 10, background: 'transparent', color: 'inherit', outline: 'none' },
      pairingText: { width: '100%', minHeight: 86, boxSizing: 'border-box', resize: 'vertical', border: `1px solid ${colors.border}`, borderRadius: 8, padding: '9px 10px', margin: '10px 0', background: 'transparent', color: 'inherit', outline: 'none', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, lineHeight: 1.45, overflowWrap: 'anywhere' },
      button: { cursor: 'pointer', border: `1px solid ${colors.border}`, background: 'transparent', borderRadius: 8, padding: '7px 11px', color: 'inherit', font: 'inherit' },
      headerButton: { width: 34, height: 34, boxSizing: 'border-box', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
      primary: { background: colors.accent, color: '#fff', borderColor: colors.accent, width: '100%' },
      muted: { color: colors.muted, fontSize: 12, lineHeight: 1.55 },
      row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 12, alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${colors.border}` },
      badge: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, marginLeft: 8, color: colors.muted },
      dot: { width: 7, height: 7, borderRadius: 99, display: 'inline-block' },
      error: { color: '#ff8092', background: 'rgba(220,76,100,.12)', borderRadius: 8, padding: 10, marginBottom: 12 },
      qr: { display: 'block', width: 220, height: 220, margin: '12px auto', background: '#fff', borderRadius: 10, padding: 8 },
      helpButton: { width: 20, height: 20, boxSizing: 'border-box', padding: 0, borderRadius: '50%', border: `1px solid ${colors.muted}`, background: 'transparent', color: colors.muted, cursor: 'help', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 12, fontWeight: 600, lineHeight: 1 },
      helpBubble: { position: 'absolute', top: '100%', left: 0, zIndex: 20, width: 'min(300px, calc(100vw - 88px))', maxHeight: 'min(440px, calc(100vh - 160px))', overflowY: 'auto', boxSizing: 'border-box', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,.18)', background: '#20242c', color: '#f4f4f5', boxShadow: '0 12px 28px rgba(0,0,0,.35)', fontSize: 12, lineHeight: 1.5 },
      toolsMenu: { position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, width: 250, maxWidth: 'calc(100vw - 48px)', border: `1px solid ${colors.border}`, borderRadius: 10, padding: 5, background: '#20242c', boxShadow: '0 12px 28px rgba(0,0,0,.35)' },
      toolsItem: { display: 'block', width: '100%', padding: '9px 10px', textAlign: 'left', border: 0, borderRadius: 7, background: 'transparent', color: colors.text, font: 'inherit', cursor: 'pointer' },
      switch: { position: 'relative', display: 'inline-flex', width: 42, height: 24, flexShrink: 0 },
      switchInput: { position: 'absolute', opacity: 0, width: 1, height: 1 },
      switchTrack: { position: 'absolute', inset: 0, borderRadius: 99, transition: 'background .18s ease', cursor: 'pointer' },
      switchKnob: { position: 'absolute', top: 3, width: 18, height: 18, borderRadius: 99, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.35)', transition: 'left .18s ease', pointerEvents: 'none' },
      version: { flexShrink: 0, marginTop: 'auto', padding: '18px 2px 0', color: colors.muted, fontSize: 11, lineHeight: 1.4, textAlign: 'right', letterSpacing: '.02em' },
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
      if (!status) return { detected: T.adviceLoading, local: '', remote: '' }
      const system = status.platform === 'darwin' ? T.sysMacos : status.platform === 'win32' ? T.sysWindows : status.platform === 'linux' ? T.sysLinux : T.sysOther
      const lanReady = !!lanPairingUrl(status)
      const tunnel = status.cloudflare
      const tunnelReady = !!(tunnel?.enabled && tunnel.publicReady === true && tunnel.publicUrl)
      const serverReady = status.platform === 'linux' && !!(
        (publicSetup?.configured && publicSetup.publicUrl) || /^wss:\/\//.test(status.publicUrl || ''))
      const detected = `${T.detectedPrefix}${system}${T.detectedLan}${lanReady ? T.ready : T.notReady}${T.detectedSep}${serverReady ? T.serverReady : tunnelReady ? `${tunnel.mode === 'quick' ? 'Quick' : T.namedTunnel} ${T.tunnelConnected}` : tunnel?.enabled ? (tunnel.state === 'online' ? '隧道已连接，公网入口未验证或检测失败' : T.tunnelConnecting) : T.remoteNotConnected}${T.detectedEnd}`
      const local = lanReady
        ? T.localLanOk
        : T.localLanCheck
      let remote
      if (serverReady) remote = T.remoteServer
      else if (tunnelReady && tunnel.mode === 'named') remote = T.remoteNamed
      else if (tunnelReady) remote = T.remoteQuick
      else if (status.platform === 'darwin' || status.platform === 'win32') remote = T.remoteNoDomain
      else if (status.platform === 'linux') remote = T.remoteLinux
      else remote = T.remoteManual
      return { detected, local, remote }
    }

    function DeviceRow({ device, onRevoke, revoking }) {
      React.useSyncExternalStore(subscribeLanguage, getLanguage)
      const triggerRevoke = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!revoking) onRevoke(device)
      }
      return React.createElement('div', { style: styles.row },
        React.createElement('div', { style: { minWidth: 0, overflow: 'hidden' } },
          React.createElement('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            deviceLabel(device),
            React.createElement('span', { style: styles.badge },
              React.createElement('span', { style: { ...styles.dot, background: device.online ? colors.success : colors.muted } }),
              device.online ? `${T.online}${device.connections > 1 ? T.conns(device.connections) : ''}` : T.offline)),
          React.createElement('div', { style: { ...styles.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 } },
            device.lastSeenAt ? T.lastSeenAt(new Date(device.lastSeenAt).toLocaleString(locale())) : T.neverConnected)),
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
          title: T.revokeTitle(deviceLabel(device)),
          // Pointer-up is more reliable than click inside the shell overlay on
          // touch devices. The click handler remains for keyboard activation.
          onPointerUp: triggerRevoke,
          onClick: (event) => {
            if (event.detail === 0) triggerRevoke(event)
          },
        }, revoking ? T.revoking : T.revoke))
    }

    function DevicePanel() {
      React.useSyncExternalStore(subscribeLanguage, getLanguage)
      const [devices, setDevices] = React.useState(null)
      const [status, setStatus] = React.useState(null)
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
      const [deviceName, setDeviceName] = React.useState('iPhone')
      const [qr, setQr] = React.useState(null)
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
          setRefreshNotice({ key: 'refreshedAt', at: Date.now() })
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
            setToolNotice(message('stopNotice'))
            return
          }
          if (tool === 'restart-web') {
            setToolNotice(message('restartingNotice'))
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
            throw new Error(T.restartTimeout)
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

      const configureCloudflare = async (enabled) => {
        if (cloudflareBusy) return
        setCloudflareBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/cloudflare', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled, ...(enabled ? {
              mode: cloudflareMode,
              ...(cloudflareMode === 'named' ? { hostname: cloudflareHost, token: cloudflareToken } : {}),
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
        body: JSON.stringify({ name: deviceName, publicUrl: endpoint }),
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
            throw new Error(T.clipboardError)
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
        if (!enabled && !window.confirm(T.confirmDisableAuth)) return
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
          setDeviceNotice({ key: 'revokedIs', device })
          window.setTimeout(() => setDeviceNotice(null), 2200)
        } catch (cause) {
          setDeviceNoticeError(true)
          setDeviceNotice(message('revokeFailIs', cause.message))
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

      const advice = connectionAdvice(status, publicSetup)
      const helpLine = (name, description) => React.createElement('div', { style: { marginTop: 7 } },
        React.createElement('strong', null, name), T.colon, description)

      return React.createElement('div', { style: styles.backdrop, onMouseDown: () => setOpen(false) },
        React.createElement('aside', { style: styles.panel, onMouseDown: (event) => { event.stopPropagation(); setToolsOpen(false) }, role: 'dialog', 'aria-modal': true, 'aria-label': T.panelAria },
          React.createElement('div', { style: styles.header },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.title }, T.panelTitle),
              React.createElement('div', { style: styles.muted }, status && status.gatewayEnabled ? T.gatewayOn : T.gatewayOff)),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
              React.createElement('button', {
                type: 'button', style: { ...styles.button, ...styles.headerButton, fontSize: 12 }, title: T.langToggle, 'aria-label': T.langToggle,
                onClick: () => { setUiLang(UI_LANG === 'zh' ? 'en' : 'zh') },
              }, T.langOther),
              React.createElement('button', {
                type: 'button', style: { ...styles.button, ...styles.headerButton, fontSize: 11 }, title: T.langFollowHost, 'aria-label': T.langFollowHost,
                onClick: followHostLanguage,
              }, T.langAuto),
              React.createElement('div', { style: { position: 'relative' }, onMouseDown: (event) => event.stopPropagation() },
                React.createElement('button', {
                  type: 'button', style: { ...styles.button, ...styles.headerButton, borderRadius: '50%' }, title: T.toolsTitle, 'aria-label': T.toolsTitle,
                  'aria-haspopup': 'menu', 'aria-expanded': toolsOpen,
                  onClick: () => setToolsOpen((value) => !value),
                }, React.createElement('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
                  React.createElement('path', { d: 'M10.3 2.8h3.4l.5 2.2a7.6 7.6 0 0 1 1.7.7l1.9-1.2 2.4 2.4L19 8.8c.3.5.5 1.1.7 1.7l2.2.5v3.4l-2.2.5a7.6 7.6 0 0 1-.7 1.7l1.2 1.9-2.4 2.4-1.9-1.2a7.6 7.6 0 0 1-1.7.7l-.5 2.2h-3.4l-.5-2.2a7.6 7.6 0 0 1-1.7-.7l-1.9 1.2-2.4-2.4L5 16.6a7.6 7.6 0 0 1-.7-1.7l-2.2-.5V11l2.2-.5A7.6 7.6 0 0 1 5 8.8L3.8 6.9l2.4-2.4 1.9 1.2a7.6 7.6 0 0 1 1.7-.7l.5-2.2Z' }),
                  React.createElement('circle', { cx: 12, cy: 12.7, r: 3.1 }))),
                toolsOpen ? React.createElement('div', { style: styles.toolsMenu, role: 'menu', 'aria-label': T.toolsMenuAria },
                  React.createElement('button', {
                    type: 'button', role: 'menuitem', disabled: toolBusy || stoppedRef.current || !status?.tools?.restartWeb,
                    style: { ...styles.toolsItem, opacity: status?.tools?.restartWeb ? 1 : .5 },
                    onClick: () => runTool('restart-web'),
                  }, T.restartGateway,
                  React.createElement('span', { style: { ...styles.muted, display: 'block', marginTop: 2 } }, T.restartGatewayHint)),
                  React.createElement('button', {
                    type: 'button', role: 'menuitem', disabled: toolBusy || stoppedRef.current || !status?.tools?.stopWeb,
                    style: { ...styles.toolsItem, color: colors.danger, opacity: status?.tools?.stopWeb ? 1 : .5 },
                    onClick: () => runTool('stop-web'),
                  }, T.stopWeb,
                  React.createElement('span', { style: { ...styles.muted, display: 'block', marginTop: 2 } }, T.stopWebHint)))
                  : null),
              React.createElement('button', { style: { ...styles.button, ...styles.headerButton }, onClick: () => setOpen(false), 'aria-label': T.closeAria }, '✕'))),
          toolNotice ? React.createElement('div', { style: { ...styles.muted, marginBottom: 10 } }, formatMessage(toolNotice)) : null,
          error ? React.createElement('div', { style: styles.error }, localizedError(error)) : null,
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('strong', null, T.modeTitle),
                React.createElement('div', { style: { ...styles.muted, marginTop: 4 } }, status && status.gatewayEnabled
                  ? status.gatewayMode === 'persistent'
                    ? T.modePersistentHint
                    : status.waitExpiresAt
                      ? T.tempWait(Math.max(1, Math.ceil((status.waitExpiresAt - Date.now()) / 60000)))
                      : T.modeTempUsed
                  : T.modeOffHint)),
              React.createElement('span', { style: { position: 'relative', display: 'inline-flex', flexShrink: 0 } },
                React.createElement('select', {
                  style: { ...styles.input, width: 'auto', marginBottom: 0, padding: '8px 40px 8px 12px', appearance: 'none', WebkitAppearance: 'none' },
                  'aria-label': T.modeTitle,
                  value: status ? status.gatewayMode || (status.gatewayEnabled ? 'temporary' : 'disabled') : 'disabled',
                  disabled: busy || !status,
                  onChange: (event) => changeGatewayMode(event.target.value),
                },
                React.createElement('option', { value: 'disabled' }, T.modeOff),
                React.createElement('option', { value: 'temporary' }, T.modeTemporary),
                React.createElement('option', { value: 'persistent' }, T.modePersistent)),
                React.createElement('span', {
                  'aria-hidden': true,
                  style: {
                    position: 'absolute', right: 15, top: '50%', width: 7, height: 7,
                    borderRight: `1.5px solid ${colors.text}`, borderBottom: `1.5px solid ${colors.text}`,
                    transform: 'translateY(-65%) rotate(45deg)', pointerEvents: 'none',
                  },
                }))),
            status && status.gatewayId ? React.createElement('div', { style: { ...styles.muted, marginTop: 12, overflowWrap: 'anywhere' } },
              `${status.gatewayName} · ${status.gatewayId}`) : null),
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('strong', null, T.authTitle),
                React.createElement('div', { style: { ...styles.muted, marginTop: 4 } }, status && status.requireAuth ? T.authOn : T.authOff)),
              React.createElement('label', { style: { ...styles.switch, opacity: busy || !status ? .55 : 1 }, title: status && status.requireAuth ? T.authDisable : T.authEnable },
                React.createElement('input', {
                  type: 'checkbox',
                  role: 'switch',
                  'aria-label': T.authTitle,
                  'aria-checked': !!(status && status.requireAuth),
                  checked: !!(status && status.requireAuth),
                  disabled: busy || !status,
                  onChange: toggleAuth,
                  style: styles.switchInput,
                }),
                React.createElement('span', { style: { ...styles.switchTrack, background: status && status.requireAuth ? colors.success : colors.danger } }),
                React.createElement('span', { style: { ...styles.switchKnob, left: status && status.requireAuth ? 21 : 3 } }))),
            status && !status.requireAuth
              ? React.createElement('p', { style: { ...styles.error, margin: '12px 0 0' } }, T.debugNote)
              : null),
          status && status.cloudflare && status.cloudflare.supported
            ? React.createElement('section', { style: styles.card },
                React.createElement('strong', null, T.cfTitle),
                React.createElement('p', { style: styles.muted }, T.cfIntro),
                React.createElement('label', { style: styles.label }, T.cfMethod),
                React.createElement('select', { style: styles.input, value: cloudflareMode, onChange: (event) => setCloudflareMode(event.target.value), disabled: cloudflareBusy },
                  React.createElement('option', { value: 'quick' }, T.cfQuick),
                  React.createElement('option', { value: 'named' }, T.cfNamed)),
                cloudflareMode === 'quick'
                  ? React.createElement('p', { style: styles.muted }, T.cfQuickNote)
                  : React.createElement(React.Fragment, null,
                      React.createElement('p', { style: styles.muted }, T.cfNamedIntro, React.createElement('code', null, `http://127.0.0.1:${status.cloudflare.port}`), T.cfNamedEnd, 'Tunnel Token 仅授权连接，不能自动创建公开主机名或 DNS；还需确认域名存在指向 Tunnel UUID.cfargotunnel.com 的已代理 CNAME 记录。'),
                      React.createElement('label', { style: styles.label }, T.cfDomain),
                      React.createElement('input', { style: styles.input, value: cloudflareHost, onChange: (event) => setCloudflareHost(event.target.value.trim()), placeholder: 'gateway.example.com', spellCheck: false }),
                      React.createElement('label', { style: styles.label }, 'Tunnel Token'),
                      React.createElement('input', { style: styles.input, type: 'password', value: cloudflareToken, onChange: (event) => setCloudflareToken(event.target.value.trim()), placeholder: status.cloudflare.configured ? T.cfTokenKept : T.cfTokenPaste, autoComplete: 'off', spellCheck: false })),
                React.createElement('button', {
                  style: { ...styles.button, ...styles.primary, opacity: cloudflareBusy || (cloudflareMode === 'named' && (!cloudflareHost || (!cloudflareToken && !status.cloudflare.configured))) ? .65 : 1 },
                  disabled: cloudflareBusy || (cloudflareMode === 'named' && (!cloudflareHost || (!cloudflareToken && !status.cloudflare.configured))),
                  onClick: () => configureCloudflare(true),
                }, cloudflareBusy ? T.cfWorking : status.cloudflare.enabled && cloudflareMode === status.cloudflare.mode ? T.cfUpdate : cloudflareMode === 'quick' ? T.cfStartQuick : T.cfStartNamed),
                status.cloudflare.enabled
                  ? React.createElement(React.Fragment, null,
                      React.createElement('button', { style: { ...styles.button, width: '100%', marginTop: 8 }, disabled: cloudflareBusy || status.cloudflare.state !== 'online', onClick: checkCloudflare }, '检测公网 DNS / TLS / WebSocket'),
                      React.createElement('button', { style: { ...styles.button, width: '100%', marginTop: 8 }, disabled: cloudflareBusy || !status.gatewayEnabled, onClick: restartCloudflare }, T.cfRestart),
                      React.createElement('button', { style: { ...styles.button, width: '100%', marginTop: 8 }, disabled: cloudflareBusy, onClick: () => configureCloudflare(false) }, T.cfStop),
                      React.createElement('p', { style: styles.muted }, T.cfRestartNote))
                  : null,
                React.createElement('div', { style: { ...styles.muted, marginTop: 9, overflowWrap: 'anywhere', color: status.cloudflare.error ? colors.danger : colors.muted } },
                  localizedError(status.cloudflare.error) || ({ disabled: T.cfOff, starting: T.cfStarting, preparing: T.cfPreparing, connecting: T.cfConnecting, online: '隧道传输已连接（不等于公网入口可达）', 'waiting-for-gateway': T.cfWaitGateway }[status.cloudflare.state] || status.cloudflare.state),
                  status.cloudflare.publicUrl ? ` · ${status.cloudflare.publicUrl}` : ''),
                 status.cloudflare.enabled && status.cloudflare.endpointHealth
                   ? React.createElement('p', { style: { ...styles.muted, overflowWrap: 'anywhere', color: ['unchecked', 'checking', 'reachable'].includes(status.cloudflare.endpointHealth.state) ? colors.muted : colors.danger } },
                       status.cloudflare.endpointHealth.message,
                       status.cloudflare.endpointHealth.checkedAt ? `（检测时间：${status.cloudflare.endpointHealth.checkedAt}）` : '')
                   : null)
              : null,
          status && status.platform === 'linux' ? React.createElement('section', { style: styles.card },
            React.createElement('strong', null, T.publicTitle),
            publicSetup === null
              ? React.createElement('p', { style: styles.muted }, T.publicChecking)
              : publicSetup.installed
                ? React.createElement(React.Fragment, null,
                    React.createElement('div', { style: { ...styles.muted, margin: '5px 0 12px' } }, publicSetup.configured
                      ? publicSetup.backendPort && status && status.webPort && publicSetup.backendPort !== status.webPort
                        ? T.portLine(publicSetup.backendPort, status.webPort)
                        : T.configuredLine(publicSetup.backendPort)
                      : T.helperLine(status && status.webPort)),
                    React.createElement('label', { style: styles.label }, T.publicIpv4),
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
                    }, publicSetupBusy ? T.publicWorking : publicSetup.configured ? T.publicUpdate : T.publicSetup),
                    publicSetup.publicUrl
                      ? React.createElement('div', { style: { ...styles.muted, marginTop: 9, overflowWrap: 'anywhere' } }, publicSetup.publicUrl)
                      : null)
                : React.createElement(React.Fragment, null,
                    React.createElement('p', { style: { ...styles.muted, marginBottom: 8 } }, T.publicNoHelper),
                    React.createElement('code', { style: { display: 'block', fontSize: 10, lineHeight: 1.5, overflowWrap: 'anywhere', userSelect: 'all' } }, 'npx --yes dsh-plugin-mobile-gateway@latest init'))) : null,
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { position: 'relative', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }, onMouseLeave: () => setConnectionHelpOpen(false) },
              React.createElement('span', { style: { ...styles.label, marginBottom: 0 } }, T.pairingTitle),
              React.createElement('button', {
                type: 'button',
                style: styles.helpButton,
                'aria-label': T.pairingGuideAria,
                'aria-expanded': connectionHelpOpen,
                'aria-describedby': connectionHelpOpen ? 'mgw-route-help' : undefined,
                onMouseEnter: () => setConnectionHelpOpen(true),
                onFocus: () => setConnectionHelpOpen(true),
                onBlur: () => setConnectionHelpOpen(false),
                onClick: () => setConnectionHelpOpen(true),
                onKeyDown: (event) => { if (event.key === 'Escape') setConnectionHelpOpen(false) },
              }, '?'),
              connectionHelpOpen ? React.createElement('div', { id: 'mgw-route-help', role: 'tooltip', style: styles.helpBubble },
                React.createElement('strong', null, T.pairingGuide),
                helpLine(T.routeLan, T.routeLanDesc),
                helpLine(T.routeCfNamed, T.routeCfNamedDesc),
                helpLine(T.routeCfQuick, T.routeCfQuickDesc),
                helpLine(T.routePublic, T.routePublicDesc),
                React.createElement('div', { style: { borderTop: '1px solid rgba(255,255,255,.18)', marginTop: 10, paddingTop: 8 } },
                  React.createElement('strong', null, T.pairingEnv),
                  React.createElement('div', { style: { color: '#c6cbd4', marginTop: 4 } }, advice.detected),
                  React.createElement('div', { style: { marginTop: 6 } }, advice.local),
                  React.createElement('div', { style: { marginTop: 6 } }, advice.remote),
                  React.createElement('div', { style: { color: '#aeb6c3', marginTop: 6 } }, T.pairingEnvNote)))
                : null),
            React.createElement('select', { style: styles.input, value: pairingRoute, onChange: (event) => choosePairingRoute(event.target.value), disabled: !status, 'aria-label': T.pairingTitle },
              React.createElement('option', { value: 'auto' }, T.routeAuto),
              lanPairingUrl(status) || pairingRoute === 'lan'
                ? React.createElement('option', { value: 'lan', disabled: !lanPairingUrl(status) }, lanPairingUrl(status)
                  ? T.lanRouteWith(lanPairingUrl(status).replace(/^wss?:\/\//, '').split('/')[0])
                  : T.lanUnavailable)
                : null,
              status?.cloudflare?.enabled ? React.createElement('option', { value: 'cloudflare' }, T.routeCf) : null,
              React.createElement('option', { value: 'custom' }, T.routeCustom)),
            React.createElement('label', { style: styles.label }, T.wsAddress),
            React.createElement('input', { style: styles.input, value: publicUrl, onChange: (event) => { choosePairingRoute('custom'); setPublicUrl(event.target.value) }, placeholder: 'ws://192.168.1.10:3081/ws/mobile', spellCheck: false }),
            status && status.lan && status.lan.enabled
              ? React.createElement('div', { style: { ...styles.muted, margin: '-7px 0 10px', color: status.lan.error ? colors.danger : colors.muted } },
                  status.lan.error
                    ? T.lanFailed(status.lan.error)
                    : status.lan.listening
                      ? (status.lan.urls && status.lan.urls.length ? T.lanOnUrls(status.lan.urls.join(T.listSep)) : T.lanOnPort(status.lan.port))
                      : T.lanStarting)
              : null,
            React.createElement('label', { style: styles.label }, T.deviceName),
            React.createElement('input', { style: styles.input, value: deviceName, onChange: (event) => setDeviceName(event.target.value), maxLength: 80, placeholder: 'iPhone' }),
            React.createElement('button', {
              style: { ...styles.button, ...styles.primary, opacity: busy || !(status && status.gatewayEnabled) || !publicUrl.trim() ? .65 : 1 },
              disabled: busy || !(status && status.gatewayEnabled) || !publicUrl.trim(),
              onClick: pair,
            }, busy ? T.generating : !(status && status.gatewayEnabled) ? T.needGatewayFirst : !publicUrl.trim() ? T.waitUrl : T.makeQr),
            React.createElement('p', { style: { ...styles.muted, margin: '10px 0 0' } }, T.pairingNote)),
          qr ? React.createElement('section', { style: { ...styles.card, textAlign: 'center' } },
            React.createElement('strong', null, T.iosScan),
            React.createElement('img', { style: styles.qr, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`, alt: T.qrAlt }),
            React.createElement('label', { style: { ...styles.label, textAlign: 'left' } }, T.pairingString),
            React.createElement('textarea', { style: styles.pairingText, value: qr.qrPayload, readOnly: true, spellCheck: false, onFocus: (event) => event.target.select() }),
            React.createElement('button', { style: { ...styles.button, width: '100%', marginBottom: 8, borderColor: pairingTokenCopied ? colors.success : colors.border, color: pairingTokenCopied ? colors.success : colors.text }, onClick: copyPairingText }, pairingTokenCopied ? T.copied : T.copyToken),
            pairingTokenCopied ? React.createElement('div', { style: { ...styles.muted, color: colors.success, marginBottom: 8 } }, T.copiedNote) : null,
            React.createElement('div', { style: styles.muted }, T.validUntilAt(localTime(qr.pairing.expiresAt)))) : null,
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('strong', null, T.trustedTitle),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                deviceNotice || refreshNotice ? React.createElement('span', {
                  style: { ...styles.muted, color: deviceNoticeError ? colors.danger : colors.success },
                }, formatMessage(deviceNotice || refreshNotice)) : null,
                React.createElement('button', {
                  style: { ...styles.button, opacity: refreshing ? .6 : 1 },
                  disabled: refreshing,
                  onClick: manualRefresh,
                }, refreshing ? T.refreshing : T.refresh))),
            devices === null
              ? React.createElement('p', { style: styles.muted }, T.loading)
              : devices.length === 0
                ? React.createElement('p', { style: styles.muted }, T.noDevices)
                : devices.map((device) => React.createElement(DeviceRow, {
                    key: device.id,
                    device,
                    onRevoke: revoke,
                    revoking: revokingIds.has(device.id),
                  }))),
          status && status.version
            ? React.createElement('div', { style: styles.version, 'aria-label': T.pluginVersion(status.version) }, `v${status.version}`)
            : null))
    }

    function FooterButton(props) {
      React.useSyncExternalStore(subscribeLanguage, getLanguage)
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
        title: T.panelAria,
        'aria-label': T.panelAria,
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
      }, icon, wide ? React.createElement('span', null, T.panelTitle) : null)
    }

    function OverlayEntry() {
      const isOpen = React.useSyncExternalStore(subscribe, getOpen)
      return isOpen ? React.createElement(DevicePanel) : null
    }

    const inject = ['slots', 'locale']
    function apply(ctx) {
      // Consume the public Harness locale service. The plugin's explicit saved
      // choice takes precedence until the user selects Auto; never write host settings.
      const adoptHostLanguage = () => {
        hostLanguage = /^zh(-|$)/i.test(ctx.locale.getSnapshot().active || '') ? 'zh' : 'en'
        if (!languageOverride) publishLanguage(hostLanguage)
      }
      adoptHostLanguage()
      ctx.effect(() => ctx.locale.subscribe(adoptHostLanguage), 'mobile-gateway: host language')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'mobile-gateway-devices', order: 80, get label() { return T.panelTitle } },
        (props) => React.createElement(FooterButton, props),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'mobile-gateway-devices-panel', order: 100, get label() { return T.panelTitle } },
        () => React.createElement(OverlayEntry),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
