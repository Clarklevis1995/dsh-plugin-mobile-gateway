import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { createTransportNegotiator } from '../../lib/transport-negotiation.mjs'
import { MobileConnection } from '../../lib/mobile-connection.mjs'
import { RTC_LABELS } from '../../lib/transport-config.mjs'
import { encodeTransportMessage } from '../../lib/transport-framing.mjs'

const identity = { gatewayId: '11111111-1111-4111-8111-111111111111' }
const limits = { maxFrameBytes: 16384, maxLogicalMessageBytes: 16777216 }
const sdp =
  'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 ' +
  Array(32).fill('AA').join(':') +
  '\r\n'
class Socket extends EventEmitter {
  readyState = 1
  sent = []
  send(wire) {
    this.sent.push(JSON.parse(wire))
  }
  receive(frame) {
    this.emit('message', typeof frame === 'string' ? frame : JSON.stringify(frame))
  }
  close(code) {
    if (this.readyState !== 1) return
    this.code = code
    this.readyState = 3
    this.emit('close')
  }
}
class DC extends EventEmitter {
  constructor(channel) {
    super()
    this.label = RTC_LABELS[channel]
    this.readyState = 'open'
    this.ordered = true
    this.reliable = true
    this.bufferedAmount = 0
    this.sent = []
  }
  send(data) {
    this.sent.push(data)
  }
  close() {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.emit('close')
  }
}
async function harness(config = {}, runtimeLoader) {
  let allowed = true,
    executions = 0,
    presence = 0,
    peerCloses = 0
  const peers = [],
    connections = []
  const adapter = {
    createPeer(options) {
      const peer = {
        ...options,
        maxMessageSize: 16384,
        async answer() {
          return sdp
        },
        async addCandidate() {},
        path: () => ({ transport: 'webrtc', path: 'unknown' }),
        async close() {
          peerCloses++
        },
      }
      peers.push(peer)
      return peer
    },
  }
  const manager = createTransportNegotiator({
    identity,
    config: { enabled: true, ...config },
    runtimeLoader: runtimeLoader || (async () => adapter),
    isAuthorized: () => allowed,
    onBootstrapPresence(_id, online) {
      presence += online ? 1 : -1
    },
  })
  await manager.loaded
  const attach = (deviceId = 'device-a') => {
    const socket = new Socket()
    manager.attach({
      socket,
      device: { id: deviceId },
      hello: { kind: 'hello', ...identity, protocol: 3, capabilities: ['split-channels'] },
      activate(transport, channel) {
        const connection = new MobileConnection(transport, { deviceId, channel })
        connections.push(connection)
        connection.on('message', () => executions++)
        connection.send(JSON.stringify({ kind: 'hello', ...identity, protocol: 3 }))
      },
    })
    return socket
  }
  const negotiate = (socket) => {
    socket.receive({
      type: 'transport-negotiate',
      requestId: 'n1',
      version: 1,
      preferred: ['webrtc', 'websocket'],
      receiveLimits: limits,
    })
    return socket.sent.find((frame) => frame.kind === 'transport-offered')
  }
  const bind = async (socket, offered, channel, changes = {}) => {
    socket.receive({
      type: 'transport-signal',
      transportSessionId: offered.transportSessionId,
      channel,
      signalSeq: 1,
      signalType: 'offer',
      sdp,
    })
    await delay(0)
    const peer = peers.at(-1),
      dc = new DC(channel)
    peer.onChannel(dc)
    dc.emit(
      'message',
      JSON.stringify({
        type: 'transport-bind',
        version: 1,
        ...identity,
        transportSessionId: offered.transportSessionId,
        channel,
        ticket: offered.bindTickets[channel],
        ...changes,
      }),
      false,
    )
    return { peer, dc }
  }
  const select = (socket, offered, mode = 'webrtc', requestId = 's1') =>
    socket.receive({ type: 'transport-select', requestId, transportSessionId: offered.transportSessionId, mode })
  return {
    manager,
    attach,
    negotiate,
    bind,
    select,
    peers,
    connections,
    revoke() {
      allowed = false
    },
    get executions() {
      return executions
    },
    get presence() {
      return presence
    },
    get peerCloses() {
      return peerCloses
    },
  }
}

test('bootstrap cannot run business; strict duplicate fields and unauthorized attach fail closed', async () => {
  for (const payload of [{ type: 'session-create', requestId: 'write' }, '{"type":"ping","type":"session-create"}']) {
    const h = await harness()
    const socket = h.attach()
    socket.receive(payload)
    assert.equal(socket.code, 4003)
    assert.equal(h.executions, 0)
    assert.equal(h.presence, 0)
    await h.manager.dispose()
  }
  const h = await harness()
  h.revoke()
  const socket = h.attach()
  assert.equal(socket.code, 4003)
  assert.equal(socket.sent.length, 0)
  await h.manager.dispose()
})

test('dual bind and explicit commit, idempotent select, conflict closes whole group', async () => {
  const h = await harness()
  const socket = h.attach()
  const offered = h.negotiate(socket)
  assert.equal(h.connections.length, 0)
  assert.equal(h.presence, 1)
  await h.bind(socket, offered, 'control')
  assert(!socket.sent.some((frame) => frame.kind === 'transport-ready'))
  await h.bind(socket, offered, 'conversation')
  assert(socket.sent.some((frame) => frame.kind === 'transport-ready'))
  assert.equal(h.connections.length, 0)
  h.select(socket, offered)
  assert.equal(h.connections.length, 2)
  assert.equal(h.presence, 0)
  h.select(socket, offered, 'webrtc', 'again')
  assert.equal(h.connections.length, 2)
  assert.equal(socket.sent.filter((frame) => frame.kind === 'transport-selected').length, 2)
  h.select(socket, offered, 'websocket')
  assert.equal(socket.code, 4003)
  assert(h.connections.every((c) => c.readyState === 3))
  await h.manager.dispose()
  assert.equal(h.peerCloses, 2)
})

test('tickets reject cross channel, gateway, session, wrong secret and replay; no business executes', async () => {
  for (const mutate of [
    (o) => ({ channel: 'conversation' }),
    (o) => ({ gatewayId: crypto.randomUUID() }),
    (o) => ({ transportSessionId: crypto.randomUUID() }),
    (o) => ({ ticket: o.bindTickets.conversation }),
    (o) => ({ ticket: 'x' }),
  ]) {
    const h = await harness()
    const socket = h.attach()
    const offered = h.negotiate(socket)
    await h.bind(socket, offered, 'control', mutate(offered))
    assert.equal(socket.code, 4003)
    assert.equal(h.executions, 0)
    await h.manager.dispose()
  }
  const h = await harness()
  const socket = h.attach()
  const offered = h.negotiate(socket)
  const { dc } = await h.bind(socket, offered, 'control')
  dc.emit(
    'message',
    JSON.stringify({
      type: 'transport-bind',
      version: 1,
      ...identity,
      transportSessionId: offered.transportSessionId,
      channel: 'control',
      ticket: offered.bindTickets.control,
    }),
    false,
  )
  assert.equal(socket.code, 4003)
  await h.manager.dispose()
})

test('signaling sequence, stale session, invalid SDP and certificate errors stop instead of downgrade', async () => {
  for (const change of [
    { signalSeq: 2 },
    { transportSessionId: crypto.randomUUID() },
    { sdp: 'invalid' },
    { signalType: 'answer' },
  ]) {
    const h = await harness()
    const socket = h.attach()
    const offered = h.negotiate(socket)
    socket.receive({
      type: 'transport-signal',
      channel: 'control',
      signalSeq: 1,
      transportSessionId: offered.transportSessionId,
      signalType: 'offer',
      sdp,
      ...change,
    })
    assert.equal(socket.code, 4003)
    await h.manager.dispose()
  }
  const h = await harness()
  const socket = h.attach()
  const offered = h.negotiate(socket)
  const { peer } = await h.bind(socket, offered, 'control')
  peer.onFailure(Object.assign(new Error('not logged secret'), { code: 'transport/dtls-failed', security: true }))
  assert.equal(socket.code, 4003)
  assert.equal(socket.sent.at(-1).recoverable, false)
  await h.manager.dispose()
})

test('connect timeout offers explicit WSS selection; atomic replacement does not double-dispatch', async () => {
  const h = await harness({ rtcConnectTimeoutMs: 100, negotiationTimeoutMs: 1000 })
  const socket = h.attach()
  const offered = h.negotiate(socket)
  await h.bind(socket, offered, 'control')
  await delay(130)
  assert.equal(socket.sent.at(-1).recoverable, true)
  assert.equal(h.connections.length, 0)
  h.select(socket, offered, 'websocket')
  assert.equal(h.connections.length, 1)
  assert.equal(h.connections[0].transport, 'websocket')
  socket.receive({ type: 'ping' })
  assert.equal(h.executions, 1)
  h.select(socket, offered, 'websocket', 'duplicate')
  assert.equal(h.executions, 1)
  socket.close()
  await h.manager.dispose()
  assert.equal(h.presence, 0)
  assert.equal(h.peerCloses, 1)
})

test('quota and rate limits are bounded, close returns quotas; dependency failure preserves WSS eligibility', async () => {
  const h = await harness({ maxPendingNegotiations: 2 })
  const first = h.attach()
  const second = h.attach()
  const third = h.attach()
  assert.equal(third.code, 1013)
  first.close()
  const fourth = h.attach()
  assert.equal(fourth.readyState, 1)
  second.close()
  fourth.close()
  assert.equal(h.manager.snapshot().pending, 0)
  await h.manager.dispose()
  const flood = await harness()
  const socket = flood.attach()
  for (let i = 0; i < 45; i++) socket.receive({ type: 'ping' })
  assert.equal(socket.code, 4003)
  await flood.manager.dispose()
  const missing = await harness({}, async () => {
    throw new Error('missing optional dependency')
  })
  assert.equal(missing.manager.available, false)
  assert.equal(missing.manager.snapshot().runtime, 'unavailable')
  await missing.manager.dispose()
})

test('revoke, extra channels, binary business before select, and framing errors close both PCs', async () => {
  for (const trigger of ['revoke', 'extra', 'early', 'bad-frame']) {
    const h = await harness()
    const socket = h.attach()
    const offered = h.negotiate(socket)
    const control = await h.bind(socket, offered, 'control')
    await h.bind(socket, offered, 'conversation')
    if (trigger === 'revoke') h.manager.closeDevice('device-a')
    if (trigger === 'extra') control.peer.onChannel(new DC('control'))
    if (trigger === 'early')
      control.dc.emit(
        'message',
        [...encodeTransportMessage(Buffer.from('{"type":"ping"}'), { channel: 'control', sequence: 1n })][0],
        true,
      )
    if (trigger === 'bad-frame') {
      h.select(socket, offered)
      control.dc.emit('message', Buffer.from('bad'), true)
    }
    assert.equal(socket.readyState, 3)
    assert.equal(h.executions, 0)
    await h.manager.dispose()
    assert.equal(h.peerCloses, 2)
  }
})

test('two devices have isolated tickets, generations, revocation and business owners', async () => {
  const h = await harness()
  const a = h.attach('device-a')
  const b = h.attach('device-b')
  const offeredA = h.negotiate(a)
  const offeredB = h.negotiate(b)
  try {
    await h.bind(a, offeredA, 'control', { ticket: offeredB.bindTickets.control })
    assert.equal(a.code, 4003)
    assert.equal(b.readyState, 1)
    const control = await h.bind(b, offeredB, 'control')
    await h.bind(b, offeredB, 'conversation')
    h.select(b, offeredB)
    assert.notEqual(h.connections[0].generation, h.connections[1].generation)
    assert.throws(() => {
      h.connections[0].deviceId = 'device-a'
    })
    h.manager.closeDevice('device-a')
    assert.equal(b.readyState, 1)
    control.dc.emit(
      'message',
      [...encodeTransportMessage(Buffer.from('{"type":"ping"}'), { channel: 'control', sequence: 1n })][0],
      true,
    )
    assert.equal(h.executions, 1)
    h.manager.closeDevice('device-b')
    assert.equal(b.readyState, 3)
  } finally {
    await h.manager.dispose()
  }
})

test('late RTC failure callbacks cannot close the already selected WebSocket generation', async () => {
  const h = await harness()
  const socket = h.attach()
  const offered = h.negotiate(socket)
  try {
    const { peer } = await h.bind(socket, offered, 'control')
    h.select(socket, offered, 'websocket')
    peer.onFailure(Object.assign(new Error('old peer callback'), { code: 'transport/old-generation', security: false }))
    await delay(0)
    assert.equal(socket.readyState, 1)
    socket.receive({ type: 'ping' })
    assert.equal(h.executions, 1)
  } finally {
    await h.manager.dispose()
  }
})


test('automatic Cloudflare discovery is signaled to clients and used by both peers', async () => {
  const h = await harness()
  try {
    const socket = h.attach()
    const offered = h.negotiate(socket)
    const expected = [{ urls: ['stun:stun.cloudflare.com:3478'] }]
    assert.deepEqual(offered.iceServers, expected)
    await h.bind(socket, offered, 'control')
    await h.bind(socket, offered, 'conversation')
    assert.deepEqual(h.peers.map(peer => peer.iceServers), [expected, expected])
  } finally { await h.manager.dispose() }
})


test('late ICE candidates and EOC remain valid while ready awaits selection', async () => {
  const h = await harness()
  try {
    const socket = h.attach(), offered = h.negotiate(socket)
    const { peer } = await h.bind(socket, offered, 'control')
    await h.bind(socket, offered, 'conversation')
    const added = []
    peer.addCandidate = async value => { added.push(value) }
    const candidate = {
      candidate: 'candidate:1 1 UDP 2122260223 203.0.113.10 50000 typ host',
      sdpMid: '0', sdpMLineIndex: 0,
    }
    socket.receive({ type: 'transport-signal', transportSessionId: offered.transportSessionId,
      channel: 'control', signalSeq: 2, signalType: 'candidate', candidate })
    socket.receive({ type: 'transport-signal', transportSessionId: offered.transportSessionId,
      channel: 'control', signalSeq: 3, signalType: 'end-of-candidates' })
    await delay(0)
    assert.equal(socket.readyState, 1)
    assert.deepEqual(added, [candidate, null])
    assert.equal(h.executions, 0)
    assert.equal(h.connections.length, 0)
    h.select(socket, offered)
    assert.equal(h.connections.length, 2)
    assert.equal(h.manager.snapshot().activeGroups, 1)
  } finally { await h.manager.dispose() }
})

test('ready ICE signaling retains session channel sequence and payload validation', async () => {
  for (const mutate of [
    frame => ({ ...frame, transportSessionId: crypto.randomUUID() }),
    frame => ({ ...frame, channel: 'other' }),
    frame => ({ ...frame, signalSeq: 3 }),
    frame => ({ ...frame, signalType: 'offer', sdp }),
    frame => ({ ...frame, signalType: 'candidate', candidate: { candidate: 'bad', sdpMid: '0', sdpMLineIndex: 0 } }),
  ]) {
    const h = await harness()
    try {
      const socket = h.attach(), offered = h.negotiate(socket)
      await h.bind(socket, offered, 'control')
      await h.bind(socket, offered, 'conversation')
      socket.receive(mutate({ type: 'transport-signal', transportSessionId: offered.transportSessionId,
        channel: 'control', signalSeq: 2, signalType: 'end-of-candidates' }))
      assert.equal(socket.code, 4003)
      assert.equal(h.executions, 0)
      assert.equal(h.connections.length, 0)
    } finally { await h.manager.dispose() }
  }
})


test('two valid ICE streams use their candidate budgets without exhausting control rate', async () => {
  const h = await harness()
  try {
    const groups = []
    for (let group = 0; group < 2; group++) {
      const socket = h.attach(), offered = h.negotiate(socket)
      await h.bind(socket, offered, 'control')
      await h.bind(socket, offered, 'conversation')
      groups.push({ socket, offered })
    }
    for (const { socket, offered } of groups) {
      for (const channel of ['control', 'conversation']) {
        for (let i = 0; i < 256; i++) {
          socket.receive({ type: 'transport-signal', transportSessionId: offered.transportSessionId,
            channel, signalSeq: i + 2, signalType: 'candidate', candidate: {
              candidate: `candidate:${i + 1} 1 UDP 2122260223 203.0.113.10 ${50000 + i} typ host`,
              sdpMid: '0', sdpMLineIndex: 0,
            } })
        }
        socket.receive({ type: 'transport-signal', transportSessionId: offered.transportSessionId,
          channel, signalSeq: 258, signalType: 'end-of-candidates' })
        assert.equal(socket.readyState, 1)
      }
      h.select(socket, offered)
      assert.equal(socket.readyState, 1)
    }
    assert.equal(h.manager.snapshot().activeGroups, 2)
    assert.equal(h.connections.length, 4)
  } finally { await h.manager.dispose() }
})

test('ICE candidate overflow is still rejected with a separate signaling budget', async () => {
  const h = await harness()
  try {
    const socket = h.attach(), offered = h.negotiate(socket)
    await h.bind(socket, offered, 'control')
    for (let i = 0; i <= 256; i++) {
      socket.receive({ type: 'transport-signal', transportSessionId: offered.transportSessionId,
        channel: 'control', signalSeq: i + 2, signalType: 'candidate', candidate: {
          candidate: `candidate:${i + 1} 1 UDP 2122260223 203.0.113.10 ${50000 + i} typ host`,
          sdpMid: '0', sdpMLineIndex: 0,
        } })
      if (i < 256) assert.equal(socket.readyState, 1)
    }
    assert.equal(socket.code, 4003)
    assert.equal(h.executions, 0)
  } finally { await h.manager.dispose() }
})
