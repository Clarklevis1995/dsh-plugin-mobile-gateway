import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { websocketRtt, rtcNetworkStats, createNetworkDiagnostics } from '../lib/network-diagnostics.mjs'

class Socket extends EventEmitter {
  readyState = 1
  ping(payload) { this.payload = payload }
}

test('WebSocket RTT matches protocol payload and ignores business or unrelated pong', async () => {
  const socket = new Socket()
  let now = 100
  const pending = websocketRtt(socket, { now: () => now })
  socket.emit('pong', Buffer.from('heartbeat'))
  now = 135
  socket.emit('pong', socket.payload)
  assert.deepEqual(await pending, { status: 'ok', rttMs: 35, measurement: 'websocket-ping' })
  for (const name of ['pong', 'close', 'error']) assert.equal(socket.listenerCount(name), 0)
})

test('timeout, page abort, disconnect and send failure all release probe listeners', async () => {
  for (const mode of ['timeout', 'abort', 'close', 'error']) {
    const socket = new Socket(), abort = new AbortController()
    const pending = websocketRtt(socket, { signal: abort.signal, timeoutMs: 8 })
    if (mode === 'abort') abort.abort()
    if (mode === 'close') socket.emit('close')
    if (mode === 'error') socket.emit('error', new Error('failure'))
    const result = await pending
    assert.equal(result.status, { timeout: 'timeout', abort: 'cancelled', close: 'disconnected', error: 'error' }[mode])
    assert.equal(result.rttMs, null)
    assert.equal(socket.listenerCount('pong'), 0)
  }
})

test('ICE stats use the selected pair in seconds and do not invent zero before a measurement', () => {
  const report = new Map([
    ['transport', { type: 'transport', selectedCandidatePairId: 'selected' }],
    ['wrong', { type: 'candidate-pair', nominated: true, state: 'succeeded', currentRoundTripTime: 99, roundTripTimeMeasurements: 1 }],
    ['selected', { type: 'candidate-pair', currentRoundTripTime: .032, totalRoundTripTime: .1, roundTripTimeMeasurements: 4 }],
  ])
  assert.equal(rtcNetworkStats(report).rttMs, 32)
  assert.equal(rtcNetworkStats(report).averageRttMs, 25)
  report.get('selected').roundTripTimeMeasurements = 0
  assert.equal(rtcNetworkStats(report).rttMs, null)
  assert.equal(rtcNetworkStats(new Map()).status, 'unavailable')
})

const connection = (generation, channel, adapter, transport = 'websocket') => ({ generation, deviceId: 'd1', mobileChannel: channel, transport, adapter, readyState: 1 })

test('only connected registered devices are grouped and generations isolate history', async () => {
  let now = 10000
  const control = connection(1, 'control', { probeNetwork: async () => ({ status: 'ok', measurement: 'websocket-ping', rttMs: 20 }) })
  const conversation = connection(2, 'conversation', { probeNetwork: async () => ({ status: 'ok', measurement: 'rtc-ice', rttMs: 10, measurementCount: 1, path: 'lan', averageRttMs: 10 }) }, 'webrtc')
  const offline = { ...connection(3, 'legacy', {}), readyState: 3 }
  const clients = new Set([control, conversation, offline, { ...control, deviceId: null }])
  const manager = createNetworkDiagnostics({ clients, devices: () => [{ id: 'd1', displayName: 'Phone' }], now: () => now })
  const first = await manager.measure()
  assert.equal(first.devices.length, 1)
  assert.equal(first.devices[0].name, 'Phone')
  assert.equal(first.devices[0].channels.length, 2)
  assert.equal(first.devices[0].channels[1].path, 'lan')
  assert.equal(await manager.measure(), first)
  now += 2000
  const second = await manager.measure()
  assert.equal(second.devices[0].channels[0].samples.length, 2)
  assert.equal(second.devices[0].channels[1].samples.length, 1, 'unchanged ICE sample must not create fake fresh RTT samples')
  clients.delete(control); clients.add({ ...control, generation: 4 })
  now += 2000
  const changed = await manager.measure()
  assert.equal(changed.devices[0].channels.find(item => item.connectionId === 4).samples.length, 1)
  manager.dispose()
})

test('overlapping polls are rejected and cancelling a page aborts pending pings without disconnecting the client', async () => {
  const socket = new Socket()
  const client = connection(1, 'control', { probeNetwork: options => websocketRtt(socket, options) })
  const manager = createNetworkDiagnostics({ clients: new Set([client]), devices: () => [] })
  const abort = new AbortController()
  const pending = manager.measure({ signal: abort.signal })
  await assert.rejects(manager.measure(), error => error.status === 409)
  abort.abort()
  await pending
  assert.equal(client.readyState, 1)
  assert.equal(socket.listenerCount('pong'), 0)
  manager.dispose()
  await assert.rejects(manager.measure(), /disposed/)
})

test('a peer closing during a read cannot report a successful latency', async () => {
  const client = connection(1, 'control', { probeNetwork: async () => { client.readyState = 3; return { status: 'ok', rttMs: 5 } } })
  const manager = createNetworkDiagnostics({ clients: new Set([client]), devices: () => [] })
  const state = await manager.measure()
  assert.equal(state.devices[0].channels[0].status, 'disconnected')
  assert.equal(state.devices[0].channels[0].rttMs, null)
  manager.dispose()
})

test('actual RTC worker serves stats RPC and closes without a gateway or network connection', { timeout: 15000 }, async () => {
  const { loadRtcAdapter } = await import('../lib/rtc-adapter.mjs')
  const { rtcWorkerCount } = await import('../lib/rtc-worker-client.mjs')
  const baseline = rtcWorkerCount()
  const adapter = await loadRtcAdapter()
  const peer = adapter.createPeer({ groupId: 'network-diagnostics-test', iceServers: [], onCandidate() {}, onChannel() {}, onFailure() {} })
  try {
    const result = await peer.networkStats()
    assert.equal(result.measurement, 'rtc-ice')
    assert.equal(result.status, 'unavailable')
    assert.equal(result.rttMs, null)
  } finally { await peer.close() }
  assert.equal(rtcWorkerCount(), baseline)
})
