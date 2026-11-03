import assert from 'node:assert/strict'
import { test } from 'node:test'
import dgram from 'node:dgram'
import crypto from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { loadRtcAdapter } from '../../lib/rtc-adapter.mjs'
import { loadRtcPeerModule, rtcWorkerCount } from '../../lib/rtc-worker-client.mjs'

async function deadline(promise, milliseconds, message) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

// 仅本机 UDP 黑洞和原生 Peer，不启动插件实例、HTTP 服务或用户网关。
for (const respondToStun of [false, true]) {
test(`real channel opens during ${respondToStun ? 'delayed' : 'unreachable'} STUN gathering`, { timeout: 15000 }, async () => {
  const blackhole = dgram.createSocket('udp4')
  await new Promise(resolve => blackhole.bind(0, '127.0.0.1', resolve))
  let stunRequests = 0
  const timers = new Set()
  blackhole.on('message', (request, remote) => {
    stunRequests++
    if (!respondToStun || request.length < 20 || request.readUInt16BE(0) !== 1) return
    const response = Buffer.alloc(32)
    response.writeUInt16BE(0x0101, 0)
    response.writeUInt16BE(12, 2)
    request.copy(response, 4, 4, 20)
    response.writeUInt16BE(0x0020, 20)
    response.writeUInt16BE(8, 22)
    response[25] = 1
    response.writeUInt16BE(remote.port ^ 0x2112, 26)
    remote.address.split('.').forEach((value, i) => { response[28 + i] = Number(value) ^ request[4 + i] })
    const timer = setTimeout(() => {
      timers.delete(timer)
      blackhole.send(response, remote.port, remote.address)
    }, 1000)
    timers.add(timer)
  })
  const adapter = await loadRtcAdapter()
  const { RTCPeerConnection } = await loadRtcPeerModule()
  const client = new RTCPeerConnection({ iceServers: [], workerGroupId: crypto.randomUUID() })
  const outgoing = client.createDataChannel('dsh-mobile-control-v1', { ordered: true })
  let server, localReady = false, remoteReady = false, serverEoc = false
  const localCandidates = [], remoteCandidates = [], serverCandidates = []
  const pending = []
  const enqueue = work => { const result = work.catch(() => {}); pending.push(result) }
  const opened = new Promise(resolve => { outgoing.onopen = resolve })
  const reply = new Promise(resolve => { outgoing.onmessage = event => resolve(event.data) })
  const started = performance.now()
  try {
    client.onicecandidate = ({ candidate }) => {
      if (localReady) enqueue(server.addCandidate(candidate))
      else localCandidates.push(candidate)
    }
    server = adapter.createPeer({
      groupId: crypto.randomUUID(),
      iceServers: [{ urls: [`stun:127.0.0.1:${blackhole.address().port}`] }],
      onCandidate(candidate) {
        if (!candidate) serverEoc = true
        else serverCandidates.push(candidate)
        if (remoteReady) enqueue(client.addIceCandidate(candidate))
        else remoteCandidates.push(candidate)
      },
      onChannel(channel) { channel.on('message', data => channel.send(data)) },
      onFailure() {},
    })
    const offer = await client.createOffer()
    await client.setLocalDescription(offer)
    const answer = await deadline(server.answer(offer.sdp), 2500, 'answer waited for full STUN gathering')
    const answerMs = Math.round(performance.now() - started)
    assert.equal(serverEoc, false, 'answer must precede complete gathering')
    localReady = true
    for (const candidate of localCandidates) enqueue(server.addCandidate(candidate))
    await client.setRemoteDescription({ type: 'answer', sdp: answer })
    remoteReady = true
    for (const candidate of remoteCandidates) enqueue(client.addIceCandidate(candidate))
    await deadline(opened, 2500, 'ICE/DTLS waited for full STUN gathering')
    assert.equal(serverEoc, false, 'connection must work during gathering')
    outgoing.send('trickle-before-stun-timeout')
    assert.equal(await deadline(reply, 1000, 'data channel did not echo'), 'trickle-before-stun-timeout')
    await deadline((async () => {
      while (stunRequests === 0) await delay(5)
    })(), 500, 'configured STUN was skipped')
    console.log(`Trickle RTC: answer=${answerMs}ms, echo=${Math.round(performance.now() - started)}ms, gatheringComplete=${serverEoc}`)
    if (respondToStun) {
      await deadline((async () => { while (!serverEoc) await delay(5) })(), 2500, 'late STUN did not complete')
      assert(serverCandidates.some(candidate => candidate.candidate.includes(' typ srflx ')), 'late public candidate was lost')
      outgoing.send('still-open-after-gathering')
      const later = new Promise(resolve => { outgoing.onmessage = event => resolve(event.data) })
      assert.equal(await deadline(later, 1000, 'late candidates broke channel'), 'still-open-after-gathering')
    }
  } finally {
    await Promise.allSettled([client.close(), server?.close()])
    await Promise.all(pending)
    for (const timer of timers) clearTimeout(timer)
    await new Promise(resolve => blackhole.close(resolve))
  }
  assert.equal(rtcWorkerCount(), 0)
})

}

test('dual real peers bind before group commit while STUN is pending, then exchange MGW business', { timeout: 15000 }, async () => {
  const { EventEmitter } = await import('node:events')
  const { createTransportNegotiator } = await import('../../lib/transport-negotiation.mjs')
  const { encodeTransportMessage, createTransportDecoder } = await import('../../lib/transport-framing.mjs')
  const adapter = await loadRtcAdapter()
  const { RTCPeerConnection } = await loadRtcPeerModule()
  const blackhole = dgram.createSocket('udp4')
  await new Promise(resolve => blackhole.bind(0, '127.0.0.1', resolve))
  const gatewayId = crypto.randomUUID(), groupId = crypto.randomUUID()
  const limits = { maxFrameBytes: 16384, maxLogicalMessageBytes: 16777216 }
  const messages = [], activations = [], errors = [], peers = {}, bound = new Set(), pongs = new Set()
  let offered, committed = false, allowConversation = false
  const socket = new EventEmitter()
  socket.readyState = 1
  socket.send = wire => {
    const frame = JSON.parse(wire)
    messages.push(frame)
    if (frame.kind === 'transport-offered') offered = frame
    if (frame.kind === 'transport-failed') errors.push(frame.code)
    if (frame.kind !== 'transport-signal') return
    const peer = peers[frame.channel]
    peer.tail = peer.tail.then(async () => {
      if (frame.signalType === 'answer') {
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: frame.sdp })
        peer.remoteReady = true
        for (const candidate of peer.candidates) await peer.pc.addIceCandidate(candidate)
        peer.candidates = []
      } else {
        const candidate = frame.signalType === 'candidate' ? frame.candidate : null
        if (peer.remoteReady) await peer.pc.addIceCandidate(candidate)
        else peer.candidates.push(candidate)
      }
    }).catch(error => errors.push(error.message))
  }
  socket.close = () => {
    if (socket.readyState === 1) { socket.readyState = 3; socket.emit('close') }
  }
  const send = frame => socket.emit('message', JSON.stringify(frame))
  const manager = createTransportNegotiator({
    identity: { gatewayId },
    config: { enabled: true, stunServers: [`stun:127.0.0.1:${blackhole.address().port}`] },
    runtimeLoader: async () => adapter,
    isAuthorized: () => true,
  })
  const waitFor = condition => deadline((async () => {
    while (!condition()) {
      if (errors.length) throw new Error(errors[0])
      await delay(5)
    }
  })(), 2500, 'dual channel handshake waited for STUN')
  const started = performance.now()
  try {
    await manager.loaded
    manager.attach({ socket, device: { id: 'trickle-dual-test' },
      hello: { kind: 'hello', gatewayId, protocol: 3, capabilities: ['split-channels'] },
      activate(transport, channel) {
        activations.push(channel)
        transport.on('message', text => {
          const request = JSON.parse(text)
          if (request.type === 'ping') void transport.send(JSON.stringify({ kind: 'pong', requestId: request.requestId }))
        })
      },
    })
    send({ type: 'transport-negotiate', requestId: 'trickle-test', version: 1, preferred: ['webrtc', 'websocket'], receiveLimits: limits })
    await waitFor(() => offered)
    for (const channel of ['control', 'conversation']) {
      const pc = new RTCPeerConnection({ iceServers: [], workerGroupId: groupId })
      const dc = pc.createDataChannel(`dsh-mobile-${channel}-v1`, { ordered: true })
      const peer = { pc, dc, seq: 0, remoteReady: false, candidates: [], tail: Promise.resolve() }
      peers[channel] = peer
      peer.bind = () => dc.send(JSON.stringify({ type: 'transport-bind', version: 1, gatewayId,
        transportSessionId: offered.transportSessionId, channel, ticket: offered.bindTickets[channel] }))
      dc.onopen = () => { if (channel === 'control' || allowConversation) peer.bind() }
      const decoder = createTransportDecoder({ channel, ...limits })
      dc.onmessage = event => {
        if (typeof event.data === 'string') {
          if (JSON.parse(event.data).kind === 'transport-bound') bound.add(channel)
        } else {
          const text = decoder.push(Buffer.from(event.data))
          if (text && JSON.parse(text).kind === 'pong') pongs.add(channel)
        }
      }
      pc.onicecandidate = ({ candidate }) => {
        if (committed) return
        send({ type: 'transport-signal', transportSessionId: offered.transportSessionId, channel,
          signalSeq: ++peer.seq, ...(candidate ? { signalType: 'candidate', candidate } : { signalType: 'end-of-candidates' }) })
      }
      const offer = await pc.createOffer()
      send({ type: 'transport-signal', transportSessionId: offered.transportSessionId, channel,
        signalSeq: ++peer.seq, signalType: 'offer', sdp: offer.sdp })
      await pc.setLocalDescription(offer)
    }
    await waitFor(() => bound.has('control'))
    assert.deepEqual(activations, [], 'one bound channel must not activate business')
    assert.equal(messages.some(frame => frame.kind === 'transport-ready'), false)
    allowConversation = true
    if (peers.conversation.dc.readyState === 'open') peers.conversation.bind()
    await waitFor(() => messages.some(frame => frame.kind === 'transport-ready'))
    assert.equal(bound.size, 2)
    committed = true
    send({ type: 'transport-select', requestId: 'select-trickle', transportSessionId: offered.transportSessionId, mode: 'webrtc' })
    assert.deepEqual(activations, ['control', 'conversation'])
    for (const [channel, peer] of Object.entries(peers)) {
      for (const frame of encodeTransportMessage(Buffer.from(JSON.stringify({ type: 'ping', requestId: channel })),
        { channel, sequence: 1n, ...limits })) peer.dc.send(frame)
    }
    await waitFor(() => pongs.size === 2)
    assert.deepEqual(errors, [])
    assert.equal(manager.snapshot().activeGroups, 1)
    console.log(`Trickle dual group: bound+commit+business=${Math.round(performance.now() - started)}ms`)
  } finally {
    committed = true
    await Promise.allSettled(Object.values(peers).map(peer => peer.pc.close()))
    await manager.dispose()
    await new Promise(resolve => blackhole.close(resolve))
  }
  assert.equal(rtcWorkerCount(), 0)
})

test('early gathering never bypasses DTLS fingerprint verification', { timeout: 15000 }, async () => {
  const adapter = await loadRtcAdapter()
  const { RTCPeerConnection } = await loadRtcPeerModule()
  const client = new RTCPeerConnection({ iceServers: [], workerGroupId: crypto.randomUUID() })
  const channel = client.createDataChannel('dsh-mobile-control-v1', { ordered: true })
  let server, localReady = false, remoteReady = false, opened = false, businessMessages = 0
  const localCandidates = [], remoteCandidates = [], pending = []
  const enqueue = work => pending.push(work.catch(() => {}))
  channel.onopen = () => { opened = true }
  let rejectHandshake
  const rejected = new Promise(resolve => { rejectHandshake = resolve })
  try {
    client.onicecandidate = ({ candidate }) => {
      if (localReady) enqueue(server.addCandidate(candidate))
      else localCandidates.push(candidate)
    }
    server = adapter.createPeer({
      groupId: crypto.randomUUID(), iceServers: [],
      onCandidate(candidate) {
        if (remoteReady) enqueue(client.addIceCandidate(candidate))
        else remoteCandidates.push(candidate)
      },
      onChannel(dc) { dc.on('message', () => { businessMessages++ }) },
      onFailure(error) { if (error.security === true) rejectHandshake(error) },
    })
    const offer = await client.createOffer()
    await client.setLocalDescription(offer)
    const wrong = offer.sdp.replace(/(a=fingerprint:sha-256 )([\dA-F]{2})/i,
      (_whole, prefix, first) => prefix + (first.toUpperCase() === 'AA' ? 'BB' : 'AA'))
    assert.notEqual(wrong, offer.sdp)
    const answer = await server.answer(wrong)
    localReady = true
    for (const candidate of localCandidates) enqueue(server.addCandidate(candidate))
    await client.setRemoteDescription({ type: 'answer', sdp: answer })
    remoteReady = true
    for (const candidate of remoteCandidates) enqueue(client.addIceCandidate(candidate))
    const error = await deadline(rejected, 4000, 'DTLS fingerprint mismatch was not rejected')
    assert.equal(error.code, 'transport/dtls-failed')
    assert.equal(opened, false)
    assert.equal(businessMessages, 0)
  } finally {
    await Promise.allSettled([client.close(), server?.close()])
    await Promise.all(pending)
  }
  assert.equal(rtcWorkerCount(), 0)
})
