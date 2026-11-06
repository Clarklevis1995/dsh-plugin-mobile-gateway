const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const React = require('react')
const { create, act } = require('react-test-renderer')

const STORAGE_KEY = 'mobile-gateway-ui-locale'

function loadPanel({ language = 'zh-CN', stored = null, forced = undefined } = {}) {
  let api
  const storage = new Map()
  if (stored) storage.set(STORAGE_KEY, stored)
  const status = {
    platform: 'darwin', gatewayEnabled: true, gatewayMode: 'persistent', requireAuth: true,
    pairingRoute: 'lan', wsPath: '/ws/mobile',
    lan: { listening: true, enabled: true, urls: ['ws://10.0.0.5:3081/ws/mobile'], port: 3081 },
    cloudflare: { supported: true, enabled: false },
    webrtc: { enabled: false, mode: 'ws-only', runtime: 'disabled', stunServers: [] },
  }
  const fetch = async (url) => ({
    ok: true,
    json: async () => url === '/mgw/status' ? status : url === '/mgw/devices' ? { devices: [] } : {},
  })
  const window = {
    localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    location: { protocol: 'http:', host: '127.0.0.1:3080' },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    matchMedia: () => ({ matches: true }),
    __ModuleLoader__: { load: ({ factory }) => { api = factory(() => React) } },
  }
  if (forced !== undefined) window.__MGW_UI_LOCALE__ = forced
  const document = { hidden: true, addEventListener() {}, removeEventListener() {}, activeElement: null, getElementById: () => null }
  const source = fs.readFileSync(path.join(__dirname, '../lib/client.js'), 'utf8')
    .replace('    return module.exports',
      '    exports.testing = { DevicePanel, GatewaySelect, getUiLocale, getUiLocalePreference, setUiLocalePreference }; return module.exports')
  vm.runInNewContext(source, {
    window, document, navigator: { language, userAgent: 'test' },
    fetch, URL, AbortController, console, setTimeout, clearTimeout,
  })
  return { ...api.testing, storage }
}

async function mount(api) {
  let root
  await act(async () => { root = create(React.createElement(api.DevicePanel)) })
  return root
}

const heading = (root) => root.root.findByType('h2').props.children
const languageSelect = (root, api) => root.root.findAllByType(api.GatewaySelect)
  .find((node) => ['auto', 'en', 'zh', 'ja'].includes(node.props.value))
const chooseLocale = (root, api, value) => act(async () => {
  languageSelect(root, api).props.onChange({ target: { value } })
})

test('a browser outside en/ja falls back to Chinese and the panel switches to English in place', async () => {
  const api = loadPanel({ language: 'ru-RU' })
  const root = await mount(api)
  assert.equal(heading(root), '移动设备')
  assert.equal(languageSelect(root, api).props.value, 'auto')
  assert.equal(languageSelect(root, api).props['aria-label'], '界面语言')

  await chooseLocale(root, api, 'en')

  assert.equal(heading(root), 'Mobile devices')
  assert.equal(languageSelect(root, api).props.value, 'en')
  assert.equal(languageSelect(root, api).props['aria-label'], 'Language')
  assert.equal(api.storage.get(STORAGE_KEY), 'en')
  assert.equal(api.getUiLocale(), 'en')
  await act(async () => root.unmount())
})

test('a saved choice is applied on load and wins over the browser language', async () => {
  const api = loadPanel({ language: 'en-US', stored: 'ja' })
  const root = await mount(api)
  assert.equal(heading(root), 'モバイルデバイス')
  assert.equal(languageSelect(root, api).props.value, 'ja')
  await act(async () => root.unmount())
})

test('auto follows the browser again and clears the saved choice', async () => {
  const api = loadPanel({ language: 'en-US', stored: 'zh' })
  const root = await mount(api)
  assert.equal(heading(root), '移动设备')

  await chooseLocale(root, api, 'auto')

  assert.equal(heading(root), 'Mobile devices')
  assert.equal(languageSelect(root, api).props.value, 'auto')
  assert.equal(api.storage.has(STORAGE_KEY), false)
  assert.equal(api.getUiLocalePreference(), null)
  await act(async () => root.unmount())
})

test('the host locale override is shown as the current choice', async () => {
  const api = loadPanel({ language: 'zh-CN', forced: 'en' })
  const root = await mount(api)
  assert.equal(heading(root), 'Mobile devices')
  assert.equal(languageSelect(root, api).props.value, 'en')
  await act(async () => root.unmount())
})

test('unsupported and malformed locale values keep the current language', () => {
  const api = loadPanel({ language: 'ru-RU' })
  assert.equal(api.getUiLocale(), 'zh')

  api.setUiLocalePreference('de')
  assert.equal(api.getUiLocalePreference(), null)
  assert.equal(api.getUiLocale(), 'zh')
  assert.equal(api.storage.has(STORAGE_KEY), false)

  api.setUiLocalePreference('ja')
  assert.equal(api.getUiLocale(), 'ja')
  assert.equal(api.storage.get(STORAGE_KEY), 'ja')

  api.setUiLocalePreference('auto')
  assert.equal(api.getUiLocalePreference(), null)
  assert.equal(api.getUiLocale(), 'zh')
  assert.equal(api.storage.has(STORAGE_KEY), false)
})
