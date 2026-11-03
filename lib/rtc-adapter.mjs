import { EventEmitter } from 'node:events'
import { RTC_LABELS, transportError } from './transport-config.mjs'
import { loadRtcPeerModule } from './rtc-worker-client.mjs'

function wrapDataChannel(dc) {
  const channel = new EventEmitter()
  Object.defineProperties(channel, {
    label: { get: () => dc.label },
    ordered: { get: () => dc.ordered },
    reliable: { get: () => dc.maxRetransmits == null && dc.maxPacketLifeTime == null },
    readyState: { get: () => dc.readyState },
    bufferedAmount: { get: () => dc.bufferedAmount },
  })
  dc.onmessage = (event) => channel.emit('message', event.data, typeof event.data !== 'string')
  dc.onopen = () => channel.emit('open')
  dc.onclose = () => channel.emit('close')
  dc.onerror = () => channel.emit('failure', transportError('transport/datachannel-error'))
  channel.send = (data) => dc.send(data)
  channel.close = () => dc.close()
  return channel
}

export async function loadRtcAdapter() {
  const { RTCPeerConnection } = await loadRtcPeerModule()
  return {
    name: 'werift-worker',
    version: '0.25.2',
    createPeer({ groupId, iceServers, onCandidate, onChannel, onFailure, maxFrameBytes = 16384 }) {
      const pc = new RTCPeerConnection({ iceServers, maxMessageSize: maxFrameBytes, workerGroupId: groupId })
      let closed = false
      pc.onicecandidate = (event) => {
        if (!closed) onCandidate(event.candidate)
      }
      pc.ondatachannel = (event) => {
        if (closed) event.channel.close()
        else onChannel(wrapDataChannel(event.channel))
      }
      pc.onsecurityfailure = () => {
        if (!closed) onFailure(transportError('transport/dtls-failed'))
      }
      pc.oniceconnectionstatechange = () => {
        if (!closed && ['failed', 'disconnected', 'closed'].includes(pc.iceConnectionState))
          onFailure(transportError('transport/ice-failed', false))
      }
      return {
        async answer(sdp) {
          await pc.setRemoteDescription({ type: 'offer', sdp })
          if (closed) return null
          const answer = await pc.createAnswer()
          await pc.setLocalDescription(answer)
          return closed ? null : pc.localDescription.sdp
        },
        async networkStats() { return { ...await pc.networkStats(), path: pc.path.path } },
        addCandidate(candidate) {
          return pc.addIceCandidate(candidate)
        },
        get maxMessageSize() {
          return pc.sctp?.maxMessageSize || maxFrameBytes
        },
        path() {
          return pc.path
        },
        async close() {
          if (!closed) {
            closed = true
            await pc.close()
          }
        },
      }
    },
  }
}

export function validateDataChannel(channel, name) {
  if (channel.label !== RTC_LABELS[name] || channel.ordered !== true || channel.reliable !== true)
    throw transportError('transport/invalid-channel')
}
