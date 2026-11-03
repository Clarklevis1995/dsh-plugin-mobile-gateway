const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const React = require('react')
const { create, act } = require('react-test-renderer')

function loadPanel(locale = 'zh', statusOverrides = {}) {
  let api, sequence = 0, failSave = false, failStatus = false, statusGate = null, saveGate = null
  const calls = [], timers = new Map(), timeouts = new Map()
  let status = {
    platform: 'darwin', gatewayEnabled: true, gatewayMode: 'persistent', requireAuth: true,
    pairingRoute: 'lan', wsPath: '/ws/mobile', publicUrl: 'wss://gateway.example/ws/mobile',
    lan: { listening: true, enabled: true, urls: ['ws://10.23.45.67:3081/ws/mobile'], port: 3081 },
    cloudflare: { supported: true, enabled: false },
    webrtc: { enabled: false, mode: 'ws-only', runtime: 'disabled', stunServers: [] },
    ...statusOverrides,
  }
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    let data = {}, ok = true
    if (url === '/mgw/status') {
      const gate = statusGate; statusGate = null
      if (gate) await new Promise((resolve, reject) => {
        const cancel = () => reject(new Error('aborted'))
        options.signal?.addEventListener('abort', cancel, { once: true })
        gate.then(() => { options.signal?.removeEventListener('abort', cancel); resolve() })
      })
      if (failStatus) { failStatus = false; ok = false; data = { message: 'status unavailable' } }
      else data = status
    }
    else if (url === '/mgw/devices') data = { devices: [] }
    else if (url === '/mgw/connection') {
      const gate = saveGate; saveGate = null
      if (gate) await new Promise((resolve, reject) => {
        const cancel = () => reject(new Error('aborted'))
        options.signal?.addEventListener('abort', cancel, { once: true })
        gate.then(() => { options.signal?.removeEventListener('abort', cancel); resolve() })
      })
      const body = JSON.parse(options.body)
      if (failSave) { failSave = false; ok = false; data = { message: 'save failed' } }
      else {
        status = { ...status, pairingRoute: body.route,
          p2pUrl: body.p2pUrl ?? status.p2pUrl ?? '',
          tailscaleUrl: body.tailscaleUrl ?? status.tailscaleUrl ?? '',
          webrtc: { enabled: body.route === 'p2p', mode: body.route === 'p2p' ? 'prefer-webrtc' : 'ws-only', runtime: body.route === 'p2p' ? 'available' : 'disabled', stunServers: [] } }
        data = status
      }
    }
    else if (url === '/mgw/pair') data = {
      pairing: { expiresAt: Date.now() + 300000 }, svg: '<svg/>', qrPayload: 'synthetic-pairing',
      payload: { publicUrl: JSON.parse(options.body).publicUrl },
    }
    return { ok, json: async () => data }
  }
  const window = {
    __MGW_UI_LOCALE__: locale, localStorage: { getItem: () => null, setItem() {} },
    location: { protocol: 'http:', host: '127.0.0.1:3080' },
    setInterval: (fn) => { const id = ++sequence; timers.set(id, fn); return id },
    clearInterval: id => timers.delete(id),
    setTimeout: (fn, delay) => { const id = ++sequence; timeouts.set(id, { fn, delay }); return id }, clearTimeout: id => timeouts.delete(id),
    matchMedia: () => ({ matches: true }),
    __ModuleLoader__: { load: ({ factory }) => { api = factory(name => { assert.equal(name, 'react'); return React }) } },
  }
  const document = { hidden: true, getElementById: () => ({ focus() {} }), addEventListener() {}, removeEventListener() {}, activeElement: null }
  const file = process.env.MGW_CLIENT_SOURCE || path.join(__dirname, '../lib/client.js')
  const source = fs.readFileSync(file, 'utf8').replace('    return module.exports', '    exports.testing = { DevicePanel, pairingConnectionPlan, recommendConnection, ConnectionChoiceGuide, ConnectionPlanSummary, GatewaySelect, panelCss, styles, colors }; return module.exports')
  vm.runInNewContext(source, { window, document, navigator: { language: locale, userAgent: 'test' }, fetch, URL, AbortController, console, setTimeout, clearTimeout })
  return { ...api.testing, calls, timers, timeouts, failNextSave() { failSave = true },
    failNextStatus() { failStatus = true },
    updateStatus(update) { status = { ...status, ...update } },
    delayNextStatus() { let release; statusGate = new Promise(resolve => { release = resolve }); return release },
    delayNextSave() { let release; saveGate = new Promise(resolve => { release = resolve }); return release },
  }
}

const rtc = { webrtc: { enabled: true, mode: 'prefer-webrtc', runtime: 'available' } }

test('switching connection modes fills the matching address and pairs with it', async () => {
  const lan = 'ws://10.23.45.67:3081/ws/mobile'
  const tail = 'ws://100.64.0.10:3081/ws/mobile'
  const cloud = 'wss://fresh.trycloudflare.com/ws/mobile'
  const api = loadPanel('zh', {
    p2pUrl: lan, tailscaleUrl: 'ws://100.64.0.99:3081/ws/mobile',
    tailscale: { addresses: ['100.64.0.10'], urls: [tail] },
    cloudflare: { supported: true, enabled: true, publicReady: true, publicUrl: cloud },
  })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
  const choose = async route => act(async () => root.root.findAllByType(api.GatewaySelect)
    .find(node => node.props['aria-label'] === '连接方案').props.onChange({ target: { value: route } }))
  for (const [route, expected] of [
    ['p2p', cloud], ['tailscale', tail], ['cloudflare', cloud], ['lan', lan],
    ['tailscale', tail], ['p2p', cloud], ['auto-lan', lan], ['auto', cloud],
  ]) {
    await choose(route)
    assert.equal(input().props.value, expected, route)
    await act(async () => actionButton(root, 'pair').props.onClick())
    assert.equal(JSON.parse(api.calls.filter(call => call.url === '/mgw/pair').at(-1).options.body).publicUrl, expected)
  }
  assert.equal(JSON.parse(api.calls.filter(call => call.url === '/mgw/connection' &&
    JSON.parse(call.options.body).route === 'p2p').at(-1).options.body).p2pUrl, cloud)
  const refresh = root.root.findAllByType('button').find(button => button.props.onClick?.name === 'manualRefresh')
  await choose('p2p')
  await act(async () => refresh.props.onClick())
  assert.equal(input().props.value, cloud, '轮询不能还原为之前串入的局域网地址')
  await act(async () => root.unmount())
})

test('unavailable mode addresses stay empty rather than reuse another network', async () => {
  const tail = 'ws://100.64.0.10:3081/ws/mobile'
  const api = loadPanel('zh', {
    pairingRoute: 'tailscale', tailscaleUrl: tail, publicUrl: tail, p2pUrl: tail,
    tailscale: { addresses: ['100.64.0.10'], urls: [tail] },
    lan: { listening: true, enabled: true, urls: [tail, 'ws://127.0.0.1:3080/ws/mobile'], port: 3081 },
    cloudflare: { supported: true, enabled: false },
  })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  for (const route of ['lan', 'p2p', 'cloudflare']) {
    await act(async () => root.root.findAllByType(api.GatewaySelect)
      .find(node => node.props['aria-label'] === '连接方案').props.onChange({ target: { value: route } }))
    assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, '', route)
    assert.equal(actionButton(root, 'pair').props.disabled, true, route)
  }
  await act(async () => root.unmount())
})

test('plan separates the pairing entry from P2P and never promises phone reachability', () => {
  const { pairingConnectionPlan: plan } = loadPanel()
  const publicPlan = plan('p2p', rtc, 'wss://gateway.example/ws/mobile')
  assert.equal(publicPlan.valid, true)
  assert.equal(publicPlan.transport, '优先 P2P，失败回退 WebSocket')
  assert.match(publicPlan.note, /实际连接确认/)
  for (const host of ['100.64.0.10', '100.64.0.0', '100.127.255.255', '[fd7a:115c:a1e0::1]']) {
    const tail = plan('p2p', rtc, `ws://${host}:3081/ws/mobile`)
    assert.equal(tail.entry, 'Tailscale 私有网络')
    assert.equal(tail.transport, 'WebSocket')
    assert.match(tail.note, /同一 tailnet/)
    assert.equal(tail.rtcEligible, false)
  }
  const magic = plan('custom', rtc, 'wss://host.example.ts.net/ws/mobile')
  assert.match(magic.note, /iOS.*ws:\/\//)
  assert.equal(plan('custom', rtc, 'ws://host.example.ts.net/ws/mobile').valid, false)
  assert.match(plan('p2p', rtc, 'ws://127.0.0.1:3080/ws/mobile').note, /真机/)
  assert.equal(plan('p2p', rtc, 'ws://10.23.45.67:3081/ws/mobile').transport, 'WebSocket')
})

test('invalid public plaintext, credentials and malformed addresses remain blocked', () => {
  const { pairingConnectionPlan: plan } = loadPanel()
  for (const url of ['', 'not-a-url', 'ws://100.63.255.255:3081/ws/mobile', 'ws://100.128.0.0:3081/ws/mobile',
    'ws://203.0.113.1/ws/mobile', 'wss://user:pass@gateway.example/ws/mobile', 'wss://gateway.example/ws/mobile?token=x',
    'wss://gateway.example/ws/mobile#x', 'ws://0.0.0.0:3081/ws/mobile', 'file:///tmp/a']) {
    assert.equal(plan('custom', {}, url).valid, false, url)
  }
  assert.equal(plan('custom', {}, 'https://gateway.example/ws/mobile').valid, true)
})

test('Cloudflare setup and P2P runtime readiness are explained separately', () => {
  const { pairingConnectionPlan: plan } = loadPanel()
  const status = { ...rtc, cloudflare: { enabled: true, publicReady: false, publicUrl: 'wss://demo.trycloudflare.com/ws/mobile' } }
  assert.match(plan('cloudflare', status, status.cloudflare.publicUrl).note, /尚未验证/)
  const loading = { webrtc: { enabled: true, mode: 'prefer-webrtc', runtime: 'loading' } }
  assert.equal(plan('p2p', loading, 'wss://gateway.example/ws/mobile').transport, 'WebSocket；P2P 组件尚未就绪')
})

async function answerWizard(root, values = ['remote', 'pc', 'yes']) {
  await act(async () => root.root.findByProps({ 'aria-controls': 'mgw-connection-wizard' }).props.onClick())
  for (const [index, key] of ['network', 'host', 'tailscale'].entries()) {
    await act(async () => root.root.findByProps({ 'data-answer': `${key}:${values[index]}` }).props.onClick())
  }
}

test('recommendations cover LAN, Tailscale, public servers and unavailable entries', () => {
  const { recommendConnection: recommend } = loadPanel()
  const status = { lan: { listening: true, urls: ['ws://127.0.0.1:3080/ws/mobile', 'ws://100.64.0.10:3081/ws/mobile', 'ws://10.23.45.67:3081/ws/mobile'] }, cloudflare: { supported: true } }
  const answers = { network: 'lan', host: 'pc', tailscale: 'yes' }
  assert.equal(recommend({}, status), null)
  assert.equal(recommend(answers, null), null)
  for (const host of ['pc', 'server', 'unknown']) {
    for (const tailscale of ['yes', 'partial', 'no']) {
      const plan = recommend({ ...answers, host, tailscale }, status)
      assert.equal(plan.route, 'lan')
      assert.equal(plan.address, 'ws://10.23.45.67:3081/ws/mobile')
    }
  }
  const remote = { ...answers, network: 'remote' }
  assert.equal(recommend(remote, status).address, 'ws://100.64.0.10:3081/ws/mobile')
  assert.match(recommend({ ...remote, tailscale: 'partial' }, status).reason, /另一端登录/)
  const empty = recommend(answers, { lan: { listening: false, urls: status.lan.urls } })
  assert.equal(empty.address, '')
  assert.match(empty.next, /开启局域网服务/)
  const noTail = { ...remote, tailscale: 'no' }
  assert.equal(recommend(noTail, status).route, 'cloudflare')
  assert.equal(recommend({ ...noTail, network: 'unknown' }, status).route, 'cloudflare')
  const server = { ...noTail, host: 'server' }
  assert.match(recommend(server, status).title, /配置服务器/)
  assert.equal(recommend(server, status, 'wss://server.example/ws/mobile').address, 'wss://server.example/ws/mobile')
  assert.equal(recommend(noTail, status, 'wss://host.tailnet.ts.net/ws/mobile').route, 'cloudflare')
  assert.match(recommend(noTail, { cloudflare: { supported: false } }).title, /安装并配置 Tailscale/)
  const tailMissing = recommend(remote, {}, 'wss://host.tailnet.ts.net/ws/mobile')
  assert.equal(tailMissing.address, '')
  const readyTunnel = { cloudflare: { supported: true, enabled: true, publicReady: true, publicUrl: 'wss://demo.trycloudflare.com/ws/mobile' } }
  const tunnel = recommend(noTail, readyTunnel, readyTunnel.cloudflare.publicUrl)
  assert.equal(tunnel.route, 'cloudflare')
  assert.match(tunnel.next, /Quick Tunnel/)
})

test('English wizard is translated and does not apply until the user accepts', async () => {
  const api = loadPanel('en'), actions = []
  let root
  await act(async () => { root = create(React.createElement(api.ConnectionChoiceGuide, {
    status: { cloudflare: { supported: false } }, disabled: false,
    onChoose: async (...args) => { actions.push(args); return true }, onManual() {},
  })) })
  assert.equal(root.root.findByProps({ 'aria-controls': 'mgw-connection-wizard' }).props['aria-expanded'], false)
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 0)
  await act(async () => root.root.findByProps({ 'aria-controls': 'mgw-connection-wizard' }).props.onClick())
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 1)
  const dialog = root.root.findByProps({ id: 'mgw-connection-wizard' })
  assert.equal(dialog.props.role, 'dialog')
  assert.equal(dialog.props['aria-modal'], true)
  await act(async () => root.root.findByProps({ 'aria-label': 'Close connection guide' }).props.onClick())
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 0)
  await answerWizard(root)
  assert.equal(actions.length, 0)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /\p{Script=Han}/u)
  const applyButton = root.root.findByProps({ 'data-wizard-apply': true })
  assert.equal(applyButton.props.style.borderRadius, 10)
  assert.equal(applyButton.props.style.font, 'inherit')
  await act(async () => root.root.findByProps({ 'data-wizard-apply': true }).props.onClick())
  assert.deepEqual(actions[0], ['tailscale', 'tailscale', ''])
  assert.equal(root.root.findByProps({ 'data-wizard-apply': true }).props.disabled, true)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /\p{Script=Han}/u)
  await act(async () => root.unmount())
})

test('actual panel keeps LAN while answering, preserves its address on save failure and permits retry', async () => {
  const api = loadPanel()
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
  assert.match(input().props.value, /10\.23/)
  await answerWizard(root)
  assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 0)
  assert.match(input().props.value, /10\.23/)
  api.failNextSave()
  await act(async () => root.root.findByProps({ 'data-wizard-apply': true }).props.onClick())
  assert.match(input().props.value, /10\.23/)
  assert.match(JSON.stringify(root.toJSON()), /保存失败/)
  await act(async () => root.root.findByProps({ 'data-wizard-apply': true }).props.onClick())
  assert.equal(input().props.value, '')
  const body = JSON.parse(api.calls.filter(call => call.url === '/mgw/connection').at(-1).options.body)
  assert.deepEqual(body, { route: 'tailscale', tailscaleUrl: '' })
  const generate = () => root.root.findAllByType('button').find(button => button.props.onClick?.name === 'pair')
  assert.equal(generate().props.disabled, true)
  await act(async () => input().props.onChange({ target: { value: 'ws://100.64.0.10:3081/ws/mobile' } }))
  assert.equal(generate().props.disabled, false)
  await act(async () => input().props.onChange({ target: { value: 'ws://100.128.0.0:3081/ws/mobile' } }))
  assert.equal(generate().props.disabled, true)
  await act(async () => root.unmount())
  assert.equal(api.timers.size, 0)
})

test('manual settings stay visible while recommendations only appear after opening the guide', async () => {
  const api = loadPanel('zh', { publicUrl: '' })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  await answerWizard(root, ['remote', 'pc', 'no'])
  assert.match(JSON.stringify(root.root.findByProps({ className: 'mgw-wizard-result' }).findByType('h3').children), /Cloudflare/)
  await act(async () => root.root.findByProps({ 'data-wizard-back': true }).props.onClick())
  assert.equal(root.root.findByProps({ 'data-answer': 'tailscale:no' }).props['aria-pressed'], true)
  await act(async () => root.root.findByProps({ 'data-answer': 'tailscale:yes' }).props.onClick())
  assert.match(JSON.stringify(root.root.findByProps({ className: 'mgw-wizard-result' }).findByType('h3').children), /Tailscale/)
  const manual = root.root.findByProps({ id: 'mgw-manual-route' })
  assert.equal(manual.type, 'div')
  assert.equal(manual.props.hidden, undefined)
  for (let ancestor = manual; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.type, 'details')
  await act(async () => root.root.findByProps({ 'data-wizard-manual': true }).props.onClick())
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 0)
  assert.equal(root.root.findByProps({ 'aria-controls': 'mgw-connection-wizard' }).props['aria-expanded'], false)
  assert.equal(root.root.findByProps({ id: 'mgw-manual-route' }).type, 'div')
  assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 0)
  assert.match(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, /10\.23/)
  await act(async () => root.unmount())
})

test('accepting recommendations reuses the matching Tailscale or public entry', async () => {
  for (const [answers, address] of [
    [['remote', 'pc', 'yes'], 'ws://100.64.0.10:3081/ws/mobile'],
    [['remote', 'server', 'no'], 'wss://server.example/ws/mobile'],
  ]) {
    const api = loadPanel('zh', { endpoints: [address], publicUrl: '' })
    let root
    await act(async () => { root = create(React.createElement(api.DevicePanel)) })
    await answerWizard(root, answers)
    await act(async () => root.root.findByProps({ 'data-wizard-apply': true }).props.onClick())
    assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, address)
    await act(async () => root.unmount())
  }
})

test('choosing P2P manually preserves an entered public address and keeps Save outside STUN settings', async () => {
  const api = loadPanel()
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
  const endpoint = 'wss://my-host.example/ws/mobile'
  await act(async () => input().props.onChange({ target: { value: endpoint } }))
  await act(async () => root.root.findAllByType(api.GatewaySelect).find(select => select.props['aria-label'] === '连接方案').props.onChange({ target: { value: 'p2p' } }))
  const body = JSON.parse(api.calls.filter(call => call.url === '/mgw/connection').at(-1).options.body)
  assert.equal(body.route, 'p2p')
  assert.equal(body.p2pUrl, endpoint)
  assert.equal(input().props.value, endpoint)
  await act(async () => input().props.onChange({ target: { value: 'wss://next-host.example/ws/mobile' } }))
  const save = root.root.findAllByType('button').find(button => button.props.onClick?.name === 'saveP2pSettings')
  assert.equal(save.props.disabled, false)
  for (let ancestor = save.parent; ancestor; ancestor = ancestor.parent) assert.notEqual(ancestor.type, 'details')
  await act(async () => root.unmount())
})

test('first-use UI chooses LAN even with public entries and no saved route', async () => {
  const api = loadPanel('zh', { pairingRoute: undefined,
    cloudflare: { supported: true, enabled: true, mode: 'quick', state: 'online', publicReady: true, publicUrl: 'wss://demo.trycloudflare.com/ws/mobile' } })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, 'ws://10.23.45.67:3081/ws/mobile')
  const selection = root.root.findAllByType('button').find(button => button.props['aria-label'] === '连接方案')
  assert.equal(selection.findAllByType('span')[0].children[0], '局域网直连')
  const routeSelect = root.root.findAllByType(api.GatewaySelect).find(select => select.props['aria-label'] === '连接方案')
  const options = React.Children.toArray(routeSelect.props.children).filter(React.isValidElement)
  assert.equal(options.some(option => ['auto-lan', 'auto'].includes(option.props.value)), false)
  const p2pOption = options.find(option => option.props.value === 'p2p')
  assert.equal(p2pOption.props.disabled, true)
  assert.match(p2pOption.props.children, /P2P（建设中）/)
  assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 0)
  await act(async () => root.unmount())
})

test('saved P2P selection is displayed without overwriting it with the LAN default', async () => {
  const api = loadPanel('zh', { pairingRoute: 'p2p', p2pUrl: 'wss://saved-host.example/ws/mobile',
    webrtc: { enabled: true, mode: 'prefer-webrtc', runtime: 'available', stunServers: [] } })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, 'wss://saved-host.example/ws/mobile')
  const selection = root.root.findAllByType('button').find(button => button.props['aria-label'] === '连接方案')
  assert.match(selection.findAllByType('span')[0].children[0], /P2P/)
  assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 0)
  await act(async () => root.unmount())
})


test('LAN recommendation uses a real LAN address across refreshes and waits when none exists', async () => {
  for (const urls of [
    ['ws://127.0.0.1:3080/ws/mobile', 'ws://100.64.0.10:3081/ws/mobile', 'ws://10.23.45.67:3081/ws/mobile'],
    ['ws://127.0.0.1:3080/ws/mobile', 'ws://100.64.0.10:3081/ws/mobile'],
  ]) {
    const api = loadPanel('zh', { lan: { listening: true, enabled: true, urls, port: 3081 } })
    let root
    await act(async () => { root = create(React.createElement(api.DevicePanel)) })
    await answerWizard(root, ['lan', 'pc', 'yes'])
    await act(async () => root.root.findByProps({ 'data-wizard-apply': true }).props.onClick())
    const expected = urls.length === 3 ? urls[2] : ''
    assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, expected)
    const refresh = root.root.findAllByType('button').find(button => button.props.onClick?.name === 'manualRefresh')
    await act(async () => refresh.props.onClick())
    assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, expected)
    await act(async () => root.unmount())
  }
})

test('accepting a Tunnel recommendation reveals configuration without enabling it', async () => {
  const api = loadPanel('zh', { publicUrl: '' })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  await answerWizard(root, ['remote', 'pc', 'no'])
  await act(async () => root.root.findByProps({ 'data-wizard-apply': true }).props.onClick())
  const saves = api.calls.filter(call => call.options.method === 'POST')
  assert.equal(saves.length, 1)
  assert.deepEqual(JSON.parse(saves[0].options.body), { route: 'cloudflare' })
  assert.equal(root.root.findAllByProps({ className: 'mgw-cloudflare-block' }).length, 1)
  await act(async () => root.unmount())
})

test('repeated apply clicks while a save is pending produce one request', async () => {
  const api = loadPanel(), actions = []
  let resolveSave, root, first
  const pending = new Promise(resolve => { resolveSave = resolve })
  await act(async () => { root = create(React.createElement(api.ConnectionChoiceGuide, {
    status: {}, onChoose: (...args) => { actions.push(args); return pending }, onManual() {},
  })) })
  await answerWizard(root)
  await act(async () => {
    const apply = root.root.findByProps({ 'data-wizard-apply': true }).props.onClick
    first = apply()
    await apply()
  })
  assert.equal(actions.length, 1)
  assert.equal(root.root.findByProps({ 'data-wizard-apply': true }).props.disabled, true)
  const close = root.root.findByProps({ 'aria-label': '关闭连接方式向导' })
  assert.equal(close.props.disabled, true)
  await act(async () => close.props.onClick())
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 1)
  await act(async () => { resolveSave(true); await first })
  assert.match(JSON.stringify(root.toJSON()), /已应用推荐方案/)
  await act(async () => root.unmount())
})


test('selecting Tailscale replaces a Cloudflare address, accepts a bare host IP and preserves drafts on refresh', async () => {
  const cloud = 'wss://old.trycloudflare.com/ws/mobile'
  for (const detected of ['', 'ws://100.64.0.10:3081/ws/mobile']) {
    const api = loadPanel('zh', { pairingRoute: 'cloudflare', publicUrl: cloud,
      cloudflare: { supported: true, enabled: true, publicUrl: cloud },
      tailscale: { addresses: detected ? ['100.64.0.10'] : [], urls: detected ? [detected] : [] } })
    let root
    await act(async () => { root = create(React.createElement(api.DevicePanel)) })
    const select = () => root.root.findAllByType(api.GatewaySelect).find(node => node.props['aria-label'] === '连接方案')
    const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
    assert.equal(input().props.value, cloud)
    await act(async () => select().props.onChange({ target: { value: 'tailscale' } }))
    assert.equal(input().props.value, detected)
    assert.equal(select().props.value, 'tailscale')
    assert.match(JSON.stringify(root.root.findByProps({ className: 'mgw-tailscale-guide' }).findAllByType('p').map(node => node.children)), /不是手机/)
    await act(async () => input().props.onChange({ target: { value: '100.64.0.11' } }))
    const refresh = root.root.findAllByType('button').find(button => button.props.onClick?.name === 'manualRefresh')
    await act(async () => refresh.props.onClick())
    assert.equal(input().props.value, '100.64.0.11')
    assert.equal(actionButton(root, 'pair').props.disabled, false)
    await act(async () => actionButton(root, 'pair').props.onClick())
    assert.equal(input().props.value, 'ws://100.64.0.11:3081/ws/mobile')
    const body = JSON.parse(api.calls.filter(call => call.url === '/mgw/connection').at(-1).options.body)
    assert.deepEqual(body, { route: 'tailscale', tailscaleUrl: input().props.value })
    const pairing = api.calls.find(call => call.url === '/mgw/pair')
    assert.deepEqual(JSON.parse(pairing.options.body), { publicUrl: input().props.value })
    await act(async () => root.unmount())
  }
})

test('Tailscale intent blocks stale public URLs and survives reload without automatic public fallback', async () => {
  const api = loadPanel('en', { pairingRoute: 'tailscale', tailscaleUrl: '', tailscale: { addresses: [], urls: [] } })
  assert.equal(api.pairingConnectionPlan('tailscale', {}, 'wss://demo.trycloudflare.com/ws/mobile').valid, false)
  assert.equal(api.pairingConnectionPlan('tailscale', {}, 'ws://192.168.1.1:3081/ws/mobile').valid, false)
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  assert.equal(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, '')
  const guide = root.root.findByProps({ className: 'mgw-tailscale-guide' })
  assert.match(JSON.stringify(guide.findAllByType('p').map(node => node.children)), /tailscale ip -4/)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /\p{Script=Han}/u)
  await act(async () => root.unmount())
})


function actionButton(root, name) {
  return root.root.findAllByType('button').find(button => button.props.onClick?.name === name)
}

test('detection shows loading, blocks duplicates and automatically fills and saves the fetched IP', async () => {
  const api = loadPanel('zh', { pairingRoute: 'tailscale', tailscaleUrl: 'ws://100.64.0.10:3081/ws/mobile',
    tailscale: { addresses: ['100.64.0.10'], urls: ['ws://100.64.0.10:3081/ws/mobile'] } })
  let root, operation
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
  await act(async () => input().props.onChange({ target: { value: '100.64.0.12' } }))
  api.updateStatus({ tailscale: { addresses: ['100.64.0.11'], urls: ['ws://100.64.0.11:3081/ws/mobile'] } })
  const release = api.delayNextStatus()
  const before = api.calls.filter(call => call.url === '/mgw/status').length
  await act(async () => { operation = actionButton(root, 'detectTailscale').props.onClick() })
  assert.equal(actionButton(root, 'detectTailscale').props['aria-busy'], true)
  assert.match(JSON.stringify(actionButton(root, 'detectTailscale').findAllByType('span').map(node => node.children.filter(child => typeof child === 'string'))), /正在检测/)
  const actions = root.root.findByProps({ className: 'mgw-tailscale-guide' }).findAllByType('button')
  assert.equal(actions.length, 1)
  assert.equal(actions[0].props.onClick.name, 'detectTailscale')
  assert.equal(input().props.disabled, true)
  assert.equal(actionButton(root, 'pair').props.disabled, true)
  await act(async () => actionButton(root, 'detectTailscale').props.onClick())
  assert.equal(api.calls.filter(call => call.url === '/mgw/status').length, before + 1)
  await act(async () => { release(); await operation })
  const toast = root.root.findByProps({ className: 'mgw-action-toast' })
  assert.match(toast.findByType('span').children[0], /100\.64\.0\.11/)
  assert.equal(toast.props['data-tone'], 'success')
  assert.equal(toast.findAllByType('button').length, 0)
  assert.equal([...api.timeouts.values()].filter(timer => timer.delay === 2000).length, 1)
  assert.equal(input().props.value, 'ws://100.64.0.11:3081/ws/mobile')
  const saves = api.calls.filter(call => call.url === '/mgw/connection')
  assert.equal(saves.length, 1)
  assert.deepEqual(JSON.parse(saves[0].options.body), { route: 'tailscale', tailscaleUrl: input().props.value })
  assert.equal(actionButton(root, 'pair').props.disabled, false)
  assert.equal(actionButton(root, 'detectTailscale').props['aria-busy'], false)
  await act(async () => root.unmount())
  assert.equal(api.timeouts.size, 0)
})

test('detection distinguishes no IP, unavailable listener, request failure and timeout', async () => {
  for (const scenario of ['none', 'listener', 'failure', 'timeout']) {
    const api = loadPanel('zh', { pairingRoute: 'tailscale', tailscale: scenario === 'listener'
      ? { addresses: ['100.64.0.10'], urls: [] } : { addresses: [], urls: [] } })
    let root, operation
    await act(async () => { root = create(React.createElement(api.DevicePanel)) })
    const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
    await act(async () => input().props.onChange({ target: { value: '100.64.0.12' } }))
    if (scenario === 'failure') api.failNextStatus()
    const release = scenario === 'timeout' ? api.delayNextStatus() : null
    await act(async () => { operation = actionButton(root, 'detectTailscale').props.onClick() })
    if (scenario === 'timeout') {
      const timeout = [...api.timeouts.values()].find(timer => timer.delay === 8000)
      await act(async () => { timeout.fn(); await operation })
      release()
    } else await act(async () => operation)
    const toast = root.root.findByProps({ className: 'mgw-action-toast' })
    const expected = { none: /未检测到/, listener: /100\.64\.0\.10.*尚未监听/, failure: /检测失败/, timeout: /检测超时/ }[scenario]
    assert.match(toast.findByType('span').children[0], expected)
    assert.equal(toast.props['data-tone'], ['failure', 'timeout'].includes(scenario) ? 'error' : 'warning')
    assert.equal(actionButton(root, 'detectTailscale').props.disabled, false)
    assert.equal(input().props.value, '100.64.0.12')
    assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 0)
    await act(async () => root.unmount())
  }
})

test('automatic saving retains loading and the old address until the save finishes', async () => {
  const endpoint = 'ws://100.64.0.11:3081/ws/mobile'
  const api = loadPanel('en', { pairingRoute: 'tailscale', tailscaleUrl: 'ws://100.64.0.10:3081/ws/mobile',
    tailscale: { addresses: ['100.64.0.11'], urls: [endpoint] } })
  let root, operation
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
  const release = api.delayNextSave()
  await act(async () => { operation = actionButton(root, 'detectTailscale').props.onClick() })
  assert.equal(actionButton(root, 'detectTailscale').props['aria-busy'], true)
  assert.match(JSON.stringify(actionButton(root, 'detectTailscale').findAllByType('span').map(node => node.children.filter(child => typeof child === 'string'))), /Saving automatically/)
  assert.equal(input().props.value, 'ws://100.64.0.10:3081/ws/mobile')
  await act(async () => actionButton(root, 'detectTailscale').props.onClick())
  assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 1)
  await act(async () => { release(); await operation })
  assert.equal(input().props.value, endpoint)
  const toast = root.root.findByProps({ className: 'mgw-action-toast' })
  assert.match(toast.findByType('span').children[0], /saved automatically.*100\.64\.0\.11/)
  assert.doesNotMatch(JSON.stringify(root.toJSON()), /\p{Script=Han}/u)
  await act(async () => root.unmount())
  assert.equal(api.timeouts.size, 0)
})

test('failed or timed out automatic saving preserves the address and allows retry', async () => {
  for (const scenario of ['failure', 'timeout']) {
    const endpoint = 'ws://100.64.0.11:3081/ws/mobile'
    const api = loadPanel('zh', { pairingRoute: 'tailscale', tailscaleUrl: 'ws://100.64.0.10:3081/ws/mobile',
      tailscale: { addresses: ['100.64.0.11'], urls: [endpoint] } })
    let root, operation
    await act(async () => { root = create(React.createElement(api.DevicePanel)) })
    const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
    if (scenario === 'failure') api.failNextSave()
    const release = scenario === 'timeout' ? api.delayNextSave() : null
    await act(async () => { operation = actionButton(root, 'detectTailscale').props.onClick() })
    if (scenario === 'timeout') {
      const timeout = [...api.timeouts.values()].find(timer => timer.delay === 8000)
      await act(async () => { timeout.fn(); await operation })
      release()
    } else await act(async () => operation)
    assert.equal(input().props.value, 'ws://100.64.0.10:3081/ws/mobile')
    const toast = root.root.findByProps({ className: 'mgw-action-toast' })
    assert.equal(toast.props.role, 'alert')
    assert.match(toast.findByType('span').children[0], scenario === 'timeout' ? /保存失败.*超时/ : /保存失败/)
    assert.equal(actionButton(root, 'detectTailscale').props.disabled, false)
    assert.equal(toast.findAllByType('button').length, 0)
    const [toastTimerId, toastTimeout] = [...api.timeouts.entries()].find(([, timer]) => timer.delay === 2000) || []
    assert.ok(toastTimeout, '错误 Toast 也应在 2 秒后自动消失')
    await act(async () => { api.timeouts.delete(toastTimerId); toastTimeout.fn() })
    assert.equal(root.root.findAllByProps({ className: 'mgw-action-toast' }).length, 0)
    await act(async () => actionButton(root, 'detectTailscale').props.onClick())
    assert.equal(input().props.value, endpoint)
    await act(async () => root.unmount())
    assert.equal(api.timeouts.size, 0)
  }
})

test('a connection plan change cancels a pending detection before automatic saving', async () => {
  const api = loadPanel('zh', { pairingRoute: 'tailscale', tailscaleUrl: 'ws://100.64.0.10:3081/ws/mobile',
    tailscale: { addresses: ['100.64.0.11'], urls: ['ws://100.64.0.11:3081/ws/mobile'] } })
  let root, operation
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const release = api.delayNextStatus()
  await act(async () => { operation = actionButton(root, 'detectTailscale').props.onClick() })
  const select = root.root.findAllByType(api.GatewaySelect).find(node => node.props['aria-label'] === '连接方案')
  await act(async () => select.props.onChange({ target: { value: 'lan' } }))
  await act(async () => { release(); await operation })
  const saves = api.calls.filter(call => call.url === '/mgw/connection')
  assert.equal(saves.length, 1)
  assert.equal(JSON.parse(saves[0].options.body).route, 'lan')
  assert.match(root.root.findByProps({ id: 'mgw-pairing-url' }).props.value, /10\.23/)
  await act(async () => root.unmount())
})

test('manual Tailscale edits are saved before pairing and a failed save prevents pairing', async () => {
  const api = loadPanel('zh', { pairingRoute: 'tailscale', tailscaleUrl: 'ws://100.64.0.10:3081/ws/mobile' })
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const input = () => root.root.findByProps({ id: 'mgw-pairing-url' })
  await act(async () => input().props.onChange({ target: { value: '100.64.0.12' } }))
  api.failNextSave()
  await act(async () => actionButton(root, 'pair').props.onClick())
  assert.equal(api.calls.filter(call => call.url === '/mgw/pair').length, 0)
  assert.equal(input().props.value, '100.64.0.12')
  await act(async () => actionButton(root, 'pair').props.onClick())
  const requests = api.calls.filter(call => call.options.method === 'POST')
  assert.deepEqual(requests.map(call => call.url), ['/mgw/connection', '/mgw/connection', '/mgw/pair'])
  assert.equal(JSON.parse(requests[2].options.body).publicUrl, 'ws://100.64.0.12:3081/ws/mobile')
  await act(async () => root.unmount())
})

test('wizard modal traps keyboard focus and closes without saving or closing the device panel', async () => {
  const api = loadPanel()
  let root, stopped = 0, prevented = 0, focused = ''
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  const launch = () => root.root.findByProps({ 'aria-controls': 'mgw-connection-wizard' })
  await act(async () => launch().props.onClick())
  const dialog = root.root.findByProps({ id: 'mgw-connection-wizard' })
  const first = { focus() { focused = 'first' } }, last = { focus() { focused = 'last' } }
  const event = { key: 'Tab', shiftKey: false, currentTarget: { querySelectorAll: () => [first, last] },
    preventDefault() { prevented++ }, stopPropagation() { stopped++ } }
  await act(async () => dialog.props.onKeyDown(event))
  assert.equal(focused, 'first')
  await act(async () => dialog.props.onKeyDown({ ...event, shiftKey: true }))
  assert.equal(focused, 'last')
  await act(async () => dialog.props.onKeyDown({ ...event, key: 'Escape' }))
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 0)
  assert.equal(launch().props['aria-expanded'], false)
  assert.equal(stopped, 3)
  assert.equal(prevented, 3)
  await act(async () => launch().props.onClick())
  const backdrop = root.root.findByProps({ className: 'mgw-wizard-backdrop' })
  const target = {}
  await act(async () => backdrop.props.onMouseDown({ target, currentTarget: target, stopPropagation() { stopped++ } }))
  assert.equal(root.root.findAllByProps({ id: 'mgw-connection-wizard' }).length, 0)
  assert.equal(api.calls.filter(call => call.url === '/mgw/connection').length, 0)
  assert.equal(root.root.findAllByProps({ id: 'mgw-manual-route' }).length, 1)
  await act(async () => root.unmount())
})
