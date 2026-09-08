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

    // Bilingual helper: Chinese locales see zh text, everything else sees en.
    const L = (zh, en) => /^zh/i.test((typeof navigator !== 'undefined' && navigator.language) || '') ? zh : en

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
      primary: { background: colors.accent, color: '#fff', borderColor: colors.accent, width: '100%' },
      muted: { color: colors.muted, fontSize: 12, lineHeight: 1.55 },
      row: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', columnGap: 12, alignItems: 'center', padding: '12px 0', borderBottom: `1px solid ${colors.border}` },
      badge: { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, marginLeft: 8, color: colors.muted },
      dot: { width: 7, height: 7, borderRadius: 99, display: 'inline-block' },
      error: { color: '#ff8092', background: 'rgba(220,76,100,.12)', borderRadius: 8, padding: 10, marginBottom: 12 },
      qr: { display: 'block', width: 220, height: 220, margin: '12px auto', background: '#fff', borderRadius: 10, padding: 8 },
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

    function DeviceRow({ device, onRevoke, revoking }) {
      const triggerRevoke = (event) => {
        event.preventDefault()
        event.stopPropagation()
        if (!revoking) onRevoke(device)
      }
      return React.createElement('div', { style: styles.row },
        React.createElement('div', { style: { minWidth: 0, overflow: 'hidden' } },
          React.createElement('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
            device.name,
            React.createElement('span', { style: styles.badge },
              React.createElement('span', { style: { ...styles.dot, background: device.online ? colors.success : colors.muted } }),
              device.online ? L(`在线${device.connections > 1 ? ` · ${device.connections} 个连接` : ''}`, `Online${device.connections > 1 ? ` · ${device.connections} connection${device.connections > 1 ? 's' : ''}` : ''}`) : L('离线', 'Offline'))),
          React.createElement('div', { style: { ...styles.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 3 } },
            device.lastSeenAt ? `Last seen: ${new Date(device.lastSeenAt).toLocaleString()}` : L('尚未连接', 'Never connected'))),
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
          title: L(`吊销 ${device.name}`, `Revoke ${device.name}`),
          // Pointer-up is more reliable than click inside the shell overlay on
          // touch devices. The click handler remains for keyboard activation.
          onPointerUp: triggerRevoke,
          onClick: (event) => {
            if (event.detail === 0) triggerRevoke(event)
          },
        }, revoking ? L('吊销中…', 'Revoking…') : L('吊销', 'Revoke')))
    }

    function DevicePanel() {
      const [devices, setDevices] = React.useState(null)
      const [status, setStatus] = React.useState(null)
      const [publicUrl, setPublicUrl] = React.useState('')
      const [publicIp, setPublicIp] = React.useState('')
      const [publicSetup, setPublicSetup] = React.useState(null)
      const [publicSetupBusy, setPublicSetupBusy] = React.useState(false)
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
          const lanUrl = statusData.lan && Array.isArray(statusData.lan.urls) ? statusData.lan.urls[0] : ''
          const preferredUrl = statusData.publicUrl || lanUrl || inferredUrl(statusData.wsPath)
          setPublicUrl((current) => {
            if (!current || current === automaticUrlRef.current) {
              automaticUrlRef.current = preferredUrl
              return preferredUrl
            }
            return current
          })
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
          setRefreshNotice(L(`已刷新 · ${new Date().toLocaleTimeString()}`, `Refreshed · ${new Date().toLocaleTimeString()}`))
          window.setTimeout(() => setRefreshNotice(null), 2200)
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
        const timer = window.setInterval(refresh, 3000)
        return () => { active = false; window.clearInterval(timer) }
      }, [refresh])

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
          if (data.publicUrl) {
            automaticUrlRef.current = data.publicUrl
            setPublicUrl(data.publicUrl)
          }
        } catch (cause) {
          setError(cause.message)
        } finally {
          setPublicSetupBusy(false)
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
            throw new Error(L('当前浏览器不允许直接写入剪贴板，请选中文本后手动复制', 'This browser does not allow direct clipboard writes — select the text and copy manually.'))
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

      const toggleGateway = async () => {
        const enabled = !(status && status.gatewayEnabled)
        setBusy(true)
        setError(null)
        try {
          const data = await request('/mgw/gateway', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          })
          setStatus((current) => ({ ...(current || {}), ...data }))
          if (!enabled) setQr(null)
        } catch (cause) {
          setError(cause.message)
        } finally {
          setBusy(false)
        }
      }

      const toggleAuth = async () => {
        const enabled = !(status && status.requireAuth)
        if (!enabled && !window.confirm(L('关闭设备鉴权后，任何能访问移动网关的人都可以控制 DSH。此选项仅限 Debug 阶段使用，确定继续吗？', 'Disabling device authentication lets anyone who can reach the mobile gateway control DSH. This option is intended for Debug use only. Continue?'))) return
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
          setDeviceNotice(L(`已吊销 ${device.name}`, `Revoked ${device.name}`))
          window.setTimeout(() => setDeviceNotice(null), 2200)
        } catch (cause) {
          setDeviceNoticeError(true)
          setDeviceNotice(L(`吊销失败：${cause.message}`, `Revoke failed: ${cause.message}`))
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

      return React.createElement('div', { style: styles.backdrop, onMouseDown: () => setOpen(false) },
        React.createElement('aside', { style: styles.panel, onMouseDown: (event) => event.stopPropagation(), role: 'dialog', 'aria-modal': true, 'aria-label': L('移动设备管理', 'Mobile device management') },
          React.createElement('div', { style: styles.header },
            React.createElement('div', null,
              React.createElement('h2', { style: styles.title }, L('移动设备', 'Mobile devices')),
              React.createElement('div', { style: styles.muted }, status && status.gatewayEnabled ? L('移动网关已开启 · 设备鉴权生效中', 'Mobile gateway on · device auth enforced') : L('移动网关已关闭 · 普通 WebUI 模式', 'Mobile gateway off · standard WebUI mode'))),
            React.createElement('button', { style: styles.button, onClick: () => setOpen(false), 'aria-label': L('关闭', 'Close') }, '✕')),
          error ? React.createElement('div', { style: styles.error }, error) : null,
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('strong', null, L('允许移动设备连接', 'Allow mobile devices')),
                React.createElement('div', { style: { ...styles.muted, marginTop: 4 } }, status && status.gatewayEnabled
                  ? status.connectedClients > 0
                    ? L(`${status.connectedClients} 个连接，网关保持开启`, `${status.connectedClients} connection${status.connectedClients === 1 ? '' : 's'} — gateway stays on`)
                    : L(`等待可信设备连接${status.waitExpiresAt ? `，约 ${Math.max(1, Math.ceil((status.waitExpiresAt - Date.now()) / 60000))} 分钟后自动关闭` : ''}`, `Waiting for a trusted device to connect${status.waitExpiresAt ? `, auto-closing in ~${Math.max(1, Math.ceil((status.waitExpiresAt - Date.now()) / 60000))} min` : ''}`)
                  : L('关闭时不会接受移动设备连接', 'Mobile devices cannot connect while the gateway is off'))),
              React.createElement('label', { style: { ...styles.switch, opacity: busy || !status ? .55 : 1 }, title: status && status.gatewayEnabled ? L('关闭移动网关', 'Turn off mobile gateway') : L('开启移动网关', 'Turn on mobile gateway') },
                React.createElement('input', {
                  type: 'checkbox',
                  role: 'switch',
                  'aria-label': L('允许移动设备连接', 'Allow mobile devices'),
                  'aria-checked': !!(status && status.gatewayEnabled),
                  checked: !!(status && status.gatewayEnabled),
                  disabled: busy || !status,
                  onChange: toggleGateway,
                  style: styles.switchInput,
                }),
                React.createElement('span', { style: { ...styles.switchTrack, background: status && status.gatewayEnabled ? colors.success : colors.muted } }),
                React.createElement('span', { style: { ...styles.switchKnob, left: status && status.gatewayEnabled ? 21 : 3 } })))),
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center' } },
              React.createElement('div', null,
                React.createElement('strong', null, L('设备鉴权', 'Device authentication')),
                React.createElement('div', { style: { ...styles.muted, marginTop: 4 } }, status && status.requireAuth ? L('已开启，仅允许可信设备连接', 'On — only trusted devices may connect') : L('已关闭，仅影响本机 Debug 入口', 'Off — affects only the local Debug entry'))),
              React.createElement('label', { style: { ...styles.switch, opacity: busy || !status ? .55 : 1 }, title: status && status.requireAuth ? L('关闭设备鉴权', 'Turn off device authentication') : L('开启设备鉴权', 'Turn on device authentication') },
                React.createElement('input', {
                  type: 'checkbox',
                  role: 'switch',
                  'aria-label': L('设备鉴权', 'Device authentication'),
                  'aria-checked': !!(status && status.requireAuth),
                  checked: !!(status && status.requireAuth),
                  disabled: busy || !status,
                  onChange: toggleAuth,
                  style: styles.switchInput,
                }),
                React.createElement('span', { style: { ...styles.switchTrack, background: status && status.requireAuth ? colors.success : colors.danger } }),
                React.createElement('span', { style: { ...styles.switchKnob, left: status && status.requireAuth ? 21 : 3 } }))),
            status && !status.requireAuth
              ? React.createElement('p', { style: { ...styles.error, margin: '12px 0 0' } }, L('Debug 模式：本机 DSH 入口将跳过设备凭证校验；独立局域网入口仍强制鉴权。', 'Debug mode: the local DSH entry skips device credential checks; the standalone LAN entry still requires authentication.'))
              : null),
          React.createElement('section', { style: styles.card },
            React.createElement('strong', null, L('公网接入', 'Public access')),
            publicSetup === null
              ? React.createElement('p', { style: styles.muted }, L('正在检查系统组件…', 'Checking system components…'))
              : publicSetup.installed
                ? React.createElement(React.Fragment, null,
                    React.createElement('div', { style: { ...styles.muted, margin: '5px 0 12px' } }, publicSetup.configured
                      ? publicSetup.backendPort && status && status.webPort && publicSetup.backendPort !== status.webPort
                        ? L(`端口需要更新：Nginx 当前为 ${publicSetup.backendPort}，DSH 当前为 ${status.webPort}`, `Port update required: Nginx forwards from ${publicSetup.backendPort}, DSH listens on ${status.webPort}`)
                        : L(`已配置${publicSetup.backendPort ? `，Nginx 转发至 DSH 端口 ${publicSetup.backendPort}` : ''}`, `Configured${publicSetup.backendPort ? ` — Nginx forwards to DSH port ${publicSetup.backendPort}` : ''}`)
                      : L(`Helper 已就绪，将自动使用当前 DSH 端口${status && status.webPort ? ` ${status.webPort}` : ''}`, `Helper ready — follows the current DSH port${status && status.webPort ? ` (${status.webPort})` : ''}`)),
                    React.createElement('label', { style: styles.label }, L('服务器公网 IPv4', 'Server public IPv4')),
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
                    }, publicSetupBusy ? L('正在配置 Nginx 与证书…', 'Configuring Nginx and certificates…') : publicSetup.configured ? L('更新公网配置', 'Update public configuration') : L('配置公网接入', 'Set up public access')),
                    publicSetup.publicUrl
                      ? React.createElement('div', { style: { ...styles.muted, marginTop: 9, overflowWrap: 'anywhere' } }, publicSetup.publicUrl)
                      : null)
                : React.createElement(React.Fragment, null,
                    React.createElement('p', { style: { ...styles.muted, marginBottom: 8 } }, L('尚未安装系统 Helper。请在服务器执行一次初始化：', 'System Helper is not installed yet. Run this once on the server:')),
                    React.createElement('code', { style: { display: 'block', fontSize: 10, lineHeight: 1.5, overflowWrap: 'anywhere', userSelect: 'all' } }, 'npx --yes dsh-plugin-mobile-gateway@latest init'))),
          React.createElement('section', { style: styles.card },
            React.createElement('label', { style: styles.label }, L('WebSocket 地址', 'WebSocket URL')),
            React.createElement('input', { style: styles.input, value: publicUrl, onChange: (event) => { automaticUrlRef.current = ''; setPublicUrl(event.target.value) }, placeholder: 'ws://192.168.1.10:3081/ws/mobile', spellCheck: false }),
            status && status.lan && status.lan.enabled
              ? React.createElement('div', { style: { ...styles.muted, margin: '-7px 0 10px', color: status.lan.error ? colors.danger : colors.muted } },
                  status.lan.error
                    ? L(`局域网监听失败：${status.lan.error}`, `LAN listener failed: ${status.lan.error}`)
                    : status.lan.listening
                      ? L(`局域网入口已开启${status.lan.urls && status.lan.urls.length ? `：${status.lan.urls.join('、')}` : `，端口 ${status.lan.port}`}`, `LAN entry is up${status.lan.urls && status.lan.urls.length ? `: ${status.lan.urls.join(', ')}` : ` on port ${status.lan.port}`}`)
                      : L('局域网入口启动中…', 'LAN entry is starting…'))
              : null,
            React.createElement('label', { style: styles.label }, L('设备名称', 'Device name')),
            React.createElement('input', { style: styles.input, value: deviceName, onChange: (event) => setDeviceName(event.target.value), maxLength: 80, placeholder: 'iPhone' }),
            React.createElement('button', { style: { ...styles.button, ...styles.primary, opacity: busy || !(status && status.gatewayEnabled) ? .65 : 1 }, disabled: busy || !(status && status.gatewayEnabled), onClick: pair }, busy ? L('正在生成…', 'Generating…') : status && status.gatewayEnabled ? L('生成配对二维码', 'Generate pairing QR code') : L('请先开启移动网关', 'Turn on the mobile gateway first')),
            React.createElement('p', { style: { ...styles.muted, margin: '10px 0 0' } }, L('同一局域网可直接使用私有地址的 ws://；公网地址仍必须使用 wss://。配对码只能使用一次，并在 5 分钟内过期。', 'On the same LAN you can use a private ws:// address directly; public addresses must still use wss://. A pairing code works only once and expires within 5 minutes.'))),
          qr ? React.createElement('section', { style: { ...styles.card, textAlign: 'center' } },
            React.createElement('strong', null, L('使用 iOS 客户端扫码', 'Scan with the iOS app')),
            React.createElement('img', { style: styles.qr, src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr.svg)}`, alt: L('一次性设备配对二维码', 'One-time device pairing QR code') }),
            React.createElement('label', { style: { ...styles.label, textAlign: 'left' } }, L('Base64URL 配对字符串', 'Base64URL pairing payload')),
            React.createElement('textarea', { style: styles.pairingText, value: qr.qrPayload, readOnly: true, spellCheck: false, onFocus: (event) => event.target.select() }),
            React.createElement('button', { style: { ...styles.button, width: '100%', marginBottom: 8, borderColor: pairingTokenCopied ? colors.success : colors.border, color: pairingTokenCopied ? colors.success : colors.text }, onClick: copyPairingText }, pairingTokenCopied ? L('✓ 已复制', '✓ Copied') : L('复制配对 Token', 'Copy pairing token')),
            pairingTokenCopied ? React.createElement('div', { style: { ...styles.muted, color: colors.success, marginBottom: 8 } }, L('已复制到剪贴板', 'Copied to clipboard')) : null,
            React.createElement('div', { style: styles.muted }, L(`有效期至 ${new Date(qr.pairing.expiresAt).toLocaleTimeString()}；扫码成功后此二维码立即失效。`, `Valid until ${new Date(qr.pairing.expiresAt).toLocaleTimeString()}; this QR code stops working immediately after a successful scan.`))) : null,
          React.createElement('section', { style: styles.card },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement('strong', null, L('可信设备', 'Trusted devices')),
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
                deviceNotice || refreshNotice ? React.createElement('span', {
                  style: { ...styles.muted, color: deviceNoticeError ? colors.danger : colors.success },
                }, deviceNotice || refreshNotice) : null,
                React.createElement('button', {
                  style: { ...styles.button, opacity: refreshing ? .6 : 1 },
                  disabled: refreshing,
                  onClick: manualRefresh,
                }, refreshing ? L('刷新中…', 'Refreshing…') : L('刷新', 'Refresh')))),
            devices === null
              ? React.createElement('p', { style: styles.muted }, L('加载中…', 'Loading…'))
              : devices.length === 0
                ? React.createElement('p', { style: styles.muted }, L('暂无已配对设备。', 'No paired devices yet.'))
                : devices.map((device) => React.createElement(DeviceRow, {
                    key: device.id,
                    device,
                    onRevoke: revoke,
                    revoking: revokingIds.has(device.id),
                  }))),
          status && status.version
            ? React.createElement('div', { style: styles.version, 'aria-label': L(`插件版本 ${status.version}`, `Plugin version ${status.version}`) }, `v${status.version}`)
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
        title: L('移动设备管理', 'Mobile device management'),
        'aria-label': L('移动设备管理', 'Mobile device management'),
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
      }, icon, wide ? React.createElement('span', null, L('移动设备', 'Mobile devices')) : null)
    }

    function OverlayEntry() {
      const isOpen = React.useSyncExternalStore(subscribe, getOpen)
      return isOpen ? React.createElement(DevicePanel) : null
    }

    const inject = ['slots']
    function apply(ctx) {
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
        { name: 'sidebar.footer.action', id: 'mobile-gateway-devices', order: 80, label: L('移动设备', 'Mobile devices') },
        (props) => React.createElement(FooterButton, props),
      ))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register(
        { name: 'shell.overlay', id: 'mobile-gateway-devices-panel', order: 100, label: L('移动设备', 'Mobile devices') },
        () => React.createElement(OverlayEntry),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
