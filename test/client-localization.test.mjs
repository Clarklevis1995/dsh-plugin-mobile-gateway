import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const source = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')

function loadClient({ language = 'en-US', hostLocale = language, storage = new Map(), storageThrows = false } = {}) {
  const registrations = new Map()
  const subscribers = new Set()
  const hookFrames = new Map()
  let activeFrame
  let renderRequested = false
  let storeNotifications = 0
  const effects = []
  const requests = []
  const localeListeners = new Set()
  const contextDisposers = []
  const localeService = { getSnapshot: () => ({ active: hostLocale }), subscribe(listener) { localeListeners.add(listener); return () => localeListeners.delete(listener) } }
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat().filter(child => child !== null && child !== undefined && child !== false) }
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const owner = activeFrame
      owner.index++
      const listener = () => { renderRequested = true; storeNotifications++; owner.notifications++ }
      const unsubscribe = subscribe(listener)
      subscribers.add(unsubscribe)
      return getSnapshot()
    },
    useState(initial) {
      const frame = activeFrame
      const index = frame.index++
      if (!(index in frame.values)) frame.values[index] = typeof initial === 'function' ? initial() : initial
      return [frame.values[index], value => {
        frame.values[index] = typeof value === 'function' ? value(frame.values[index]) : value
        renderRequested = true
      }]
    },
    useRef(initial) {
      const frame = activeFrame
      const index = frame.index++
      if (!(index in frame.values)) frame.values[index] = { current: initial }
      return frame.values[index]
    },
    useCallback(callback) { activeFrame.index++; return callback },
    useEffect(effect) { activeFrame.index++; effects.push(effect) },
  }
  const window = {
    location: { protocol: 'http:', host: 'localhost' },
    __ModuleLoader__: { load(definition) { registrations.set('factory', definition.factory) } },
    setInterval() { return 1 },
    clearInterval() {},
  }
  const sandbox = {
    window,
    navigator: { language },
    localStorage: {
      getItem(key) { if (storageThrows) throw new Error('storage blocked'); return storage.get(key) ?? null },
      setItem(key, value) { if (storageThrows) throw new Error('storage blocked'); storage.set(key, value) },
      removeItem(key) { if (storageThrows) throw new Error('storage blocked'); storage.delete(key) },
    },
    React,
    fetch: async (path, options = {}) => {
      requests.push({ path, options })
      return { ok: true, json: async () => path === '/mgw/cloudflare/restart'
        ? { enabled: true, mode: 'quick', state: 'online', publicUrl: 'wss://quick.example/ws/mobile' }
        : path === '/mgw/devices'
      ? { devices: [{ id: 'device-1', name: 'Phone', online: true, connections: 2, lastSeenAt: '2026-10-01T12:00:00Z' }] }
      : path === '/mgw/status'
        ? { platform: 'linux', lan: { listening: true, urls: ['ws://192.0.2.1:8080'] }, gatewayEnabled: true,
          gatewayMode: 'persistent', tools: { restartWeb: true, stopWeb: true }, version: '1.2.3',
          cloudflare: { supported: true, enabled: true, mode: 'quick', state: 'online', publicUrl: 'wss://quick.example/ws/mobile' } }
        : { configured: false } }
    },
    URL,
    URLSearchParams,
    Date,
    Set,
    Map,
    Promise,
    console,
    encodeURIComponent,
  }
  vm.runInNewContext(source, sandbox, { filename: 'lib/client.js' })
  const exports = registrations.get('factory')(() => React)
  exports.apply({ locale: localeService, effect(factory) { contextDisposers.push(factory()) }, slots: {
    inject(_name, register) { register() },
    register(meta, render) { registrations.set(meta.name, { meta, render }) },
  } })
  const footerRegistration = registrations.get('sidebar.footer.action')
  const overlayRegistration = registrations.get('shell.overlay')
  function renderComponent(component, props = {}) {
    let frame = hookFrames.get(component)
    if (!frame) { frame = { values: [], index: 0, notifications: 0 }; hookFrames.set(component, frame) }
    frame.index = 0
    activeFrame = frame
    try { return component(props) } finally { activeFrame = undefined }
  }
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(renderComponent(node.type, node.props))
    return { ...node, children: node.children.map(expand) }
  }
  async function runEffects() {
    for (const effect of effects.splice(0)) effect()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  function setHostLocale(value) { hostLocale = value; for (const listener of localeListeners) listener() }
  function disposeContext() { for (const dispose of contextDisposers.splice(0)) dispose?.() }
  function renderOverlay() {
    renderRequested = false
    const entry = overlayRegistration.render()
    return expand(entry)
  }
  function click(node) { return node.props.onClick?.({ detail: 0, preventDefault() {}, stopPropagation() {} }) }
  function find(node, predicate) {
    if (!node || typeof node !== 'object') return undefined
    if (!Array.isArray(node) && predicate(node)) return node
    for (const child of Array.isArray(node) ? node : node.children || []) {
      const match = find(child, predicate)
      if (match) return match
    }
  }
  function resetNotifications() { for (const frame of hookFrames.values()) frame.notifications = 0 }
  function notificationsFor(componentName) {
    return [...hookFrames].filter(([component]) => component.name === componentName).reduce((sum, [, frame]) => sum + frame.notifications, 0)
  }
  return { storage, subscribers, requests, resetNotifications, notificationsFor, footerRegistration, overlayRegistration, renderComponent, renderOverlay, runEffects, setHostLocale, disposeContext, get localeSubscriberCount() { return localeListeners.size }, click, find,
    get renderRequested() { return renderRequested }, get storeNotifications() { return storeNotifications } }
}

function openPanel(client) {
  const footer = client.footerRegistration.render()
  const trigger = client.renderComponent(footer.type, footer.props)
  client.click(trigger)
  return client.renderOverlay()
}

function textContent(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  return (Array.isArray(node) ? node : node.children || []).map(textContent).join(' ')
}

for (const [language, expected] of [['zh-CN', '移动设备'], ['zh', '移动设备'], ['en-US', 'Mobile devices'], ['fr-FR', 'Mobile devices']]) {
  const client = loadClient({ language })
  assert.equal(client.footerRegistration.meta.label, expected, `${language} should choose the expected locale`)
}

const invalidSaved = loadClient({ language: 'fr-FR', storage: new Map([['mgw-ui-lang', 'fr']]) })
assert.equal(invalidSaved.footerRegistration.meta.label, 'Mobile devices', 'invalid saved locales should fall back to English')
const blockedStorage = loadClient({ language: 'zh-TW', storageThrows: true })
assert.equal(blockedStorage.footerRegistration.meta.label, '移动设备', 'unavailable storage should use device locale without throwing')
const blockedPanel = openPanel(blockedStorage)
const blockedToggle = blockedStorage.find(blockedPanel, node => node.type === 'button' && node.props['aria-label'] === '切换语言')
blockedStorage.click(blockedToggle)
assert.doesNotThrow(() => blockedStorage.renderOverlay(), 'language changes should work when storage writes fail')

const hostPreferred = loadClient({ language: 'en-US', hostLocale: 'zh-Hans-CN' })
assert.equal(hostPreferred.footerRegistration.meta.label, '移动设备', 'active host locale should take precedence over browser language')
const hostPanel = openPanel(hostPreferred)
assert.equal(hostPreferred.find(hostPanel, node => node.props.role === 'dialog')?.props['aria-label'], '移动设备管理')
hostPreferred.setHostLocale('en-GB')
const hostPanelEn = hostPreferred.renderOverlay()
assert.equal(hostPreferred.find(hostPanelEn, node => node.props.role === 'dialog')?.props['aria-label'], 'Mobile device management', 'live host locale changes should rerender the open panel')
assert.equal(hostPreferred.footerRegistration.meta.label, 'Mobile devices', 'live host locale changes should update the sidebar label')
assert.equal(hostPreferred.localeSubscriberCount, 1, 'apply should subscribe through the host-owned locale effect')
hostPreferred.disposeContext()
assert.equal(hostPreferred.localeSubscriberCount, 0, 'host effect disposer should release the locale subscription')
hostPreferred.setHostLocale('zh-CN')
assert.equal(hostPreferred.footerRegistration.meta.label, 'Mobile devices', 'disposed context should stop following host locale changes')

const saved = new Map([['mgw-ui-lang', 'en']])
const savedOverride = loadClient({ language: 'zh-CN', hostLocale: 'zh-CN', storage: saved })
assert.equal(savedOverride.footerRegistration.meta.label, 'Mobile devices', 'saved override should win over device locale')
const reloaded = loadClient({ language: 'zh-CN', storage: saved })
assert.equal(reloaded.footerRegistration.meta.label, 'Mobile devices', 'saved override should survive module reload')
savedOverride.setHostLocale('zh-TW')
assert.equal(savedOverride.footerRegistration.meta.label, 'Mobile devices', 'saved override should take precedence over live host changes')

const client = loadClient({ language: 'zh-CN' })
let panel = openPanel(client)
await client.runEffects()
panel = client.renderOverlay()
let languageButton = client.find(panel, node => node.type === 'button' && node.props['aria-label'] === '切换语言')
assert.ok(languageButton, 'Chinese panel should expose a localized language toggle')
assert.equal(textContent(languageButton), 'EN', 'Chinese UI should offer English using its compact language code')
assert.equal(client.find(panel, node => node.props.role === 'dialog')?.props['aria-label'], '移动设备管理')
assert.ok(client.find(panel, node => node.type === 'button' && textContent(node) === '重启 Tunnel'), 'Cloudflare restart button should be Chinese')
assert.match(textContent(panel), /重启会短暂断开手机连接；Quick Tunnel 可能获得新地址，需要重新扫码。/, 'Cloudflare restart warning should be Chinese')
const guideButton = client.find(panel, node => node.type === 'button' && node.props['aria-label'] === '连接方式说明与场景建议')
assert.ok(guideButton, 'connection guide should expose a localized accessible label')
client.click(guideButton)
panel = client.renderOverlay()
assert.match(textContent(panel), /局域网入口已就绪/)
const toolsButton = client.find(panel, node => node.type === 'button' && node.props['aria-label'] === '工具')
assert.ok(toolsButton, 'tools menu should have an accessible name')
client.click(toolsButton)
panel = client.renderOverlay()
assert.match(textContent(panel), /重启当前网关/)
assert.match(textContent(panel), /结束当前进程并重新启动 DSH Web/)
client.resetNotifications()
client.click(languageButton)
assert.ok(client.notificationsFor('FooterButton') > 0, 'language change must notify the sidebar subscription itself')
assert.ok(client.notificationsFor('DevicePanel') > 0, 'language change must notify the panel subscription itself')
panel = client.renderOverlay()
assert.equal(client.find(panel, node => node.props.role === 'dialog')?.props['aria-label'], 'Mobile device management', 'panel accessibility name should update immediately')
assert.match(textContent(panel), /Mobile gateway on · device auth enforced/, 'device status copy should update to English immediately')
assert.match(textContent(panel), /Online · 2 connections/, 'device connection status should update to English immediately')
assert.match(textContent(panel), /When the phone and DSH share a mutually reachable LAN/, 'connection advice should update to English immediately')
assert.match(textContent(panel), /Restarting briefly disconnects your phone/, 'Cloudflare disconnect warning should switch immediately')
assert.match(textContent(panel), /scan the new QR code to reconnect/, 'Cloudflare restart should explain re-pairing when its address changes')
const tunnelRestart = client.find(panel, node => node.type === 'button' && textContent(node) === 'Restart Tunnel')
assert.ok(tunnelRestart, 'Cloudflare restart button should switch to English immediately')
await client.click(tunnelRestart)
assert.ok(client.requests.some(({ path, options }) => path === '/mgw/cloudflare/restart' && options.method === 'POST'), 'localized restart action should preserve the upstream POST endpoint')
panel = client.renderOverlay()
assert.match(textContent(panel), /Restart current gateway/)
assert.match(textContent(panel), /Exit the current process and restart DSH Web/)
assert.ok(client.storeNotifications > 0, 'language change should notify useSyncExternalStore subscribers')
assert.ok(client.subscribers.size >= 3, 'overlay, panel, and sidebar should subscribe to shared stores')
assert.equal(client.storage.get('mgw-ui-lang'), 'en', 'language choice should be persisted')
const footer = client.footerRegistration.render()
const footerButton = client.renderComponent(footer.type, footer.props)
assert.equal(client.footerRegistration.meta.label, 'Mobile devices', 'sidebar slot label should switch to English immediately')
assert.equal(footerButton.props['aria-label'], 'Mobile device management')
assert.equal(footerButton.props.title, 'Mobile device management')
languageButton = client.find(panel, node => node.type === 'button' && node.props['aria-label'] === 'Switch language')
assert.ok(languageButton, 'English language toggle should exist')
assert.equal(textContent(languageButton), 'ZH', 'English UI should offer Chinese using its compact language code')
client.click(languageButton)
panel = client.renderOverlay()
assert.equal(client.storage.get('mgw-ui-lang'), 'zh', 'manual language toggle should persist')
client.setHostLocale('en-US')
panel = client.renderOverlay()
assert.equal(client.find(panel, node => node.props.role === 'dialog')?.props['aria-label'], '移动设备管理', 'saved override should win over live host changes')
const followHostButton = client.find(panel, node => node.type === 'button' && node.props['aria-label'] === '跟随应用语言')
assert.ok(followHostButton, 'follow app language action should be accessible')
client.click(followHostButton)
panel = client.renderOverlay()
assert.equal(client.storage.has('mgw-ui-lang'), false, 'following the app should clear the plugin override')
assert.equal(client.find(panel, node => node.props.role === 'dialog')?.props['aria-label'], 'Mobile device management', 'follow app should immediately adopt the active host locale')
console.log('PASS client localization: locale fallback, safe storage, saved override, immediate accessible UI updates, and restart messaging')
