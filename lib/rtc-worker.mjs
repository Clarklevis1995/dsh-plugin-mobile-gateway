import { rtcNetworkStats } from './network-diagnostics.mjs'
import { enableTrickleIce } from './rtc-trickle.mjs'
// 每个协商组一个 Worker，退出时由 Node 回收运行库尚未完成的异步工作。
import { parentPort } from 'node:worker_threads'
import { RTCPeerConnection } from 'werift'
const peers = new Map()
let pendingReceiveBytes = 0
const post = (value) => parentPort.postMessage(value)
function state(id, pc) {
  const pair = pc.iceTransports[0]?.getSelectedCandidatePair()
  const candidate = (value) => {
    if (!value) return null
    const parts = value.candidate.split(' ')
    return {
      type: parts[parts.indexOf('typ') + 1],
      private: /^(?:10\.|127\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|f[cd][\da-f]{2}:|fe80:|::1$)/i.test(
        parts[4],
      ),
    }
  }
  const local = candidate(pair?.local),
    remote = candidate(pair?.remote)
  const path =
    !local || !remote
      ? 'unknown'
      : [local.type, remote.type].includes('relay')
        ? 'turn'
        : local.type === 'host' && remote.type === 'host' && local.private && remote.private
          ? 'lan'
          : 'p2p'
  post({
    event: 'state',
    id,
    connectionState: pc.connectionState,
    iceConnectionState: pc.iceConnectionState,
    maxMessageSize: pc.sctp?.maxMessageSize,
    localDescription: pc.localDescription ? { type: pc.localDescription.type, sdp: pc.localDescription.sdp } : null,
    path: {
      transport: 'webrtc',
      path,
      ...(local ? { localCandidateType: local.type } : {}),
      ...(remote ? { remoteCandidateType: remote.type } : {}),
    },
  })
}
function attachDc(id, dc, dcId) {
  const peer = peers.get(id)
  peer.channels.set(dcId, dc)
  const changed = () => post({ event: 'dc-state', id, dcId, state: dc.readyState, bufferedAmount: dc.bufferedAmount })
  dc.onopen = changed
  dc.onclose = changed
  dc.onmessage = (event) => {
    const bytes = Buffer.byteLength(event.data)
    if (bytes > 16384 || pendingReceiveBytes + bytes > 4 * 1024 * 1024) {
      post({ event: 'security-failure', id })
      return
    }
    pendingReceiveBytes += bytes
    post({ event: 'dc-message', id, dcId, data: event.data, bytes })
  }
  dc.onerror = () => post({ event: 'security-failure', id })
  dc.bufferedAmountLowThreshold = 65536
  dc.bufferedAmountLow.subscribe(changed)
  changed()
}
const interval = setInterval(() => {
  for (const [id, peer] of peers)
    for (const [dcId, dc] of peer.channels) {
      if (peer.amounts.get(dcId) === dc.bufferedAmount) continue
      peer.amounts.set(dcId, dc.bufferedAmount)
      post({ event: 'dc-buffer', id, dcId, bufferedAmount: dc.bufferedAmount })
    }
}, 10)
interval.unref()
parentPort.on('message', async (message) => {
  const { id, callId, op } = message
  try {
    if (op === 'received') {
      pendingReceiveBytes -= message.bytes
      return
    }
    if (op === 'create') {
      const pc = new RTCPeerConnection(message.config)
      enableTrickleIce(pc, () => {
        if (peers.get(id)?.pc === pc) post({ event: 'transport-failure', id })
      })
      peers.set(id, { pc, channels: new Map(), amounts: new Map(), nextDc: 1 })
      pc.onicecandidate = (event) =>
        post({
          event: 'candidate',
          id,
          candidate: event.candidate
            ? {
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid ?? null,
                sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
              }
            : null,
        })
      pc.ondatachannel = (event) => {
        const dc = event.channel,
          peer = peers.get(id),
          dcId = peer.nextDc++
        post({
          event: 'datachannel',
          id,
          dcId,
          label: dc.label,
          ordered: dc.ordered,
          maxRetransmits: dc.maxRetransmits,
          maxPacketLifeTime: dc.maxPacketLifeTime,
        })
        attachDc(id, dc, dcId)
      }
      pc.onconnectionstatechange = () => state(id, pc)
      pc.oniceconnectionstatechange = () => state(id, pc)
      return
    }
    const peer = peers.get(id)
    if (!peer) return
    const { pc } = peer
    let value
    if (op === 'create-channel') {
      const dc = pc.createDataChannel(message.label, message.options)
      attachDc(id, dc, message.dcId)
    } else if (op === 'offer') value = await pc.createOffer()
    else if (op === 'answer') value = await pc.createAnswer()
    else if (op === 'set-remote') {
      await pc.setRemoteDescription(message.description)
      for (const dtls of pc.dtlsTransports)
        dtls.onStateChange.subscribe((next) => {
          if (next === 'failed') post({ event: 'security-failure', id })
        })
    } else if (op === 'set-local') {
      // werift 空 iceServers 仍会隐式使用 Google STUN。此处只允许 Host 下发的目标。
      if (pc.config.iceServers.length === 0)
        for (const transport of pc.iceTransports) transport.connection.stunServer = undefined
      await pc.setLocalDescription(message.description)
    } else if (op === 'candidate') await pc.addIceCandidate(message.candidate)
    else if (op === 'network-stats') value = rtcNetworkStats(await pc.getStats())
    else if (op === 'send') {
      const dc = peer.channels.get(message.dcId)
      if (!dc || dc.readyState !== 'open') throw new Error('closed channel')
      dc.send(typeof message.data === 'string' ? message.data : Buffer.from(message.data))
      post({ event: 'sent', id, dcId: message.dcId, bytes: message.bytes, bufferedAmount: dc.bufferedAmount })
    } else if (op === 'close-channel') peer.channels.get(message.dcId)?.close()
    else if (op === 'close') {
      peers.delete(id)
      await pc.close()
    }
    if (peers.has(id)) state(id, pc)
    if (callId) post({ callId, value })
  } catch {
    if (callId) post({ callId, error: 'rtc-operation-failed' })
    else post({ event: 'security-failure', id })
  }
})
