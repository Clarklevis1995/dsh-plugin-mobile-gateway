import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectMobileTestClient } from '../../bin/webrtc-client.mjs'
import { startGateway } from './helpers.mjs'
import { rtcWorkerCount } from '../../lib/rtc-worker-client.mjs'

let available = true
try {
  await import('werift')
} catch {
  available = false
}

test(
  'real dual PeerConnections run gateway business and preserve channel authorization',
  { skip: !available, timeout: 45000 },
  async () => {
    const gateway = await startGateway()
    let client
    try {
      client = await connectMobileTestClient(gateway)
      assert.equal(client.mode, 'webrtc')
      const status = await gateway.request('status')
      assert.equal(status.connectedClients, 2)
      assert.equal(status.webrtc.activeGroups, 1)
      assert(['lan', 'p2p'].includes(status.webrtc.paths[0].channels.control.path))
      assert.equal(status.webrtc.paths[0].channels.control.localCandidateType, 'host')
      await client.send('control', { type: 'ping' })
      await client.inbox.take((frame) => frame.kind === 'pong' && frame.channel === 'control')
      await client.send('control', { type: 'workspaces' })
      assert.equal(
        (await client.inbox.take((frame) => frame.kind === 'workspaces')).items[0].workspaceId,
        'rtc-workspace',
      )
      await client.send('conversation', { type: 'history', sessionId: 'rtc-session', requestId: 'rtc-history' })
      const history = await client.inbox.take((frame) => frame.kind === 'history')
      assert.equal(history.requestId, 'rtc-history')
      assert.equal(history.historyFormatVersion, 4)
      await client.send('control', { type: 'history', sessionId: 'rtc-session' })
      assert.equal((await client.inbox.take((frame) => frame.kind === 'error')).code, 'wrong-channel')
      await client.send('control', { type: 'session-create', requestId: 'rtc-create' })
      assert.equal(
        (await client.inbox.take((frame) => frame.kind === 'session-created')).sessionId,
        'rtc-created-session',
      )
      await client.close()
      client = null
      for (let i = 0; i < 100 && (await gateway.request('status')).connectedClients; i++)
        await new Promise((resolve) => setTimeout(resolve, 10))
      assert.equal((await gateway.request('status')).connectedClients, 0)
      assert.equal((await gateway.request('status')).webrtc.activeGroups, 0)
    } finally {
      await client?.close()
      await gateway.close()
    }
  },
)

test('legacy capability fallback and ws-only retain real gateway business', { timeout: 15000 }, async () => {
  const gateway = await startGateway({ enabled: false })
  let client
  try {
    client = await connectMobileTestClient(gateway)
    assert.equal(client.mode, 'websocket')
    await client.send('control', { type: 'ping' })
    await client.inbox.take((frame) => frame.kind === 'pong')
    await client.send('conversation', { type: 'history', sessionId: 'rtc-session' })
    await client.inbox.take((frame) => frame.kind === 'history')
  } finally {
    await client?.close()
    await gateway.close()
  }
})

test(
  'real RTC message boundaries, device revocation, and new-generation WSS reconnect',
  { skip: !available, timeout: 60000 },
  async () => {
    const gateway = await startGateway()
    let client
    try {
      client = await connectMobileTestClient(gateway)
      await client.send('control', 0)
      for (const size of [16384, 16777216]) {
        const overhead = Buffer.byteLength(JSON.stringify({ type: 'ping', padding: '' }))
        await client.send('control', { type: 'ping', padding: 'x'.repeat(size - overhead) })
        await client.inbox.take((frame) => frame.kind === 'pong', 30000)
      }
      await client.send('control', { type: 'session-create', requestId: 'no-replay' })
      await client.inbox.take((frame) => frame.kind === 'session-created')
      const count = gateway.calls.filter((call) => call.method === 'create').length
      await client.close()
      client = await connectMobileTestClient({ ...gateway, mode: 'ws-only' })
      await client.send('control', { type: 'ping' })
      await client.inbox.take((frame) => frame.kind === 'pong')
      assert.equal(gateway.calls.filter((call) => call.method === 'create').length, count)
      await gateway.request(`devices/${gateway.registryId}/revoke`, {})
      await assert.rejects(client.inbox.take(() => false))
    } finally {
      await client?.close()
      await gateway.close()
    }
  },
)

test(
  'real RTC setup timeout commits whole group to working WebSocket business',
  { skip: !available, timeout: 15000 },
  async () => {
    const gateway = await startGateway({ enabled: true, rtcConnectTimeoutMs: 100, negotiationTimeoutMs: 4000 })
    let client
    try {
      client = await connectMobileTestClient(gateway)
      assert.equal(client.mode, 'websocket')
      await client.send('control', { type: 'workspaces' })
      await client.inbox.take((frame) => frame.kind === 'workspaces')
      assert.equal((await gateway.request('status')).webrtc.activeGroups, 0)
    } finally {
      await client?.close()
      await gateway.close()
    }
  },
)

test(
  'repeated real RTC connect/close returns UDP sockets and groups to baseline',
  { skip: !available, timeout: 180000 },
  async () => {
    const gateway = await startGateway()
    let client
    const udpCount = () => process._getActiveHandles().filter((h) => ['udp4', 'udp6'].includes(h.type)).length
    const baseline = udpCount(),
      cycles = Number(process.env.MGW_RTC_CYCLES || 3)
    try {
      for (let i = 0; i < cycles; i++) {
        client = await connectMobileTestClient(gateway)
        await client.send('control', { type: 'ping' })
        await client.inbox.take((frame) => frame.kind === 'pong')
        await client.close()
        client = null
        for (let j = 0; j < 100 && (await gateway.request('status')).webrtc.activeGroups; j++)
          await new Promise((resolve) => setTimeout(resolve, 5))
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
      assert.equal((await gateway.request('status')).webrtc.activeGroups, 0)
      assert.equal((await gateway.request('status')).webrtc.pending, 0)
      assert.equal(udpCount(), baseline)
      for (let i = 0; i < 100 && rtcWorkerCount(); i++) await new Promise((resolve) => setTimeout(resolve, 10))
      assert.equal(rtcWorkerCount(), 0)
      console.log(
        `RTC cleanup: ${cycles} cycles, main-thread UDP baseline=${baseline}, after=${udpCount()}, live RTC workers=${rtcWorkerCount()}`,
      )
    } finally {
      await client?.close()
      await gateway.close()
    }
  },
)

test(
  'unreachable configured STUN is cancelled without residual Worker resources',
  { skip: !available, timeout: 15000 },
  async () => {
    const gateway = await startGateway({
      enabled: true,
      stunServers: ['stun:127.0.0.1:9'],
      rtcConnectTimeoutMs: 250,
      negotiationTimeoutMs: 4000,
    })
    let client
    try {
      client = await connectMobileTestClient(gateway)
      assert.equal(client.mode, 'websocket')
      await client.send('control', { type: 'ping' })
      await client.inbox.take((frame) => frame.kind === 'pong')
      assert.equal((await gateway.request('status')).webrtc.activeGroups, 0)
    } finally {
      await client?.close()
      await gateway.close()
    }
  },
)

test(
  'real DTLS fingerprint mismatch stops without WebSocket activation or Host writes',
  { skip: !available, timeout: 15000 },
  async () => {
    const { loadRtcPeerModule } = await import('../../lib/rtc-worker-client.mjs')
    const module = await loadRtcPeerModule()
    class WrongFingerprintPeer extends module.RTCPeerConnection {
      async createOffer() {
        const offer = await super.createOffer()
        this.originalOffer = offer
        return {
          ...offer,
          sdp: offer.sdp.replace(
            /(a=fingerprint:sha-256 )([\dA-F]{2})/i,
            (_whole, prefix, first) => prefix + (first.toUpperCase() === 'AA' ? 'BB' : 'AA'),
          ),
        }
      }
      setLocalDescription() {
        return super.setLocalDescription(this.originalOffer)
      }
    }
    const gateway = await startGateway()
    try {
      await assert.rejects(
        connectMobileTestClient({
          ...gateway,
          rtcModuleLoader: async () => ({ RTCPeerConnection: WrongFingerprintPeer }),
        }),
        (error) => error.security === true,
      )
      assert.equal((await gateway.request('status')).connectedClients, 0)
      assert.equal(gateway.calls.filter((call) => call.method === 'create').length, 0)
    } finally {
      await gateway.close()
    }
  },
)
