const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const React = require('react')
const { create, act } = require('react-test-renderer')

test('actual network page renders metrics and cancels polling on background or unmount', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/client.js'), 'utf8')
  const component = source.slice(source.indexOf('    function ServerNetworkDiagnostics()'), source.indexOf('    function DevicePanel()'))
  const listeners = new Map(), timers = new Map(), calls = []
  const document = { hidden: false, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key) }
  let sequence = 0, pending = false
  const data = { at: Date.now(), devices: [{ deviceId: 'd1', name: 'Phone', channels: [
    { connectionId: 1, channel: 'control', transport: 'webrtc', path: 'p2p', status: 'ok', measurement: 'rtc-ice', rttMs: 32, averageRttMs: 30, samples: [{ at: Date.now(), rttMs: 32 }] },
    { connectionId: 2, channel: 'conversation', transport: 'websocket', status: 'timeout', measurement: 'websocket-ping', rttMs: null, averageRttMs: null, p95RttMs: null, samples: [] },
  ] }] }
  const request = (_url, options) => {
    calls.push(options)
    if (!pending) return Promise.resolve(data)
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true }))
  }
  const sandbox = { React, document, request, AbortController, Date, tr: text => text, styles: {}, colors: {}, window: {
    setTimeout: (fn, duration) => { const id = ++sequence; timers.set(id, { fn, duration }); return id },
    clearTimeout: id => timers.delete(id),
  } }
  vm.createContext(sandbox)
  const Component = vm.runInContext(component + '\nServerNetworkDiagnostics', sandbox)
  let root
  await act(async () => { root = create(React.createElement(Component)) })
  assert.equal(calls.length, 1)
  const json = JSON.stringify(root.toJSON())
  assert.match(json, /32.0 ms/)
  assert.match(json, /直连 P2P/)
  assert.match(json, /WebSocket/)
  assert.match(json, /探测超时/)
  assert.match(json, /ICE 链路统计/)
  assert.equal(root.root.findAllByType('svg').length, 2)
  assert.equal(timers.size, 1)
  pending = true
  await act(async () => { const [id, task] = [...timers][0]; timers.delete(id); task.fn() })
  assert.equal(calls.length, 2)
  await act(async () => { document.hidden = true; listeners.get('visibilitychange')() })
  assert.equal(calls[1].signal.aborted, true)
  assert.equal(timers.size, 0)
  assert.match(JSON.stringify(root.toJSON()), /后台已暂停检测/)
  pending = false
  await act(async () => { document.hidden = false; listeners.get('visibilitychange')() })
  assert.equal(calls.length, 3)
  assert.equal(timers.size, 1)
  await act(async () => root.unmount())
  assert.equal(calls[2].signal.aborted, true)
  assert.equal(timers.size, 0)
  assert.equal(listeners.size, 0)
})
