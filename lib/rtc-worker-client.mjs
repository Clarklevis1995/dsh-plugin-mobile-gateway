import { Worker } from 'node:worker_threads'
import crypto from 'node:crypto'
import { transportError } from './transport-config.mjs'

const liveWorkers = new Set()
export const rtcWorkerCount = () => liveWorkers.size

// API 限于本项目使用的 DataChannel 子集；不加载音视频，不把业务 JSON 交给 Worker 解析。
export async function loadRtcPeerModule() {
  await import('werift')
  const pools = new Map()
  const defaultGroup = crypto.randomUUID()
  let nextId = 0,
    nextCall = 0
  class DataChannel {
    constructor(peer, id, label, options = {}) {
      this.peer = peer
      this.id = id
      this.label = label
      this.ordered = options.ordered !== false
      this.maxRetransmits = options.maxRetransmits ?? null
      this.maxPacketLifeTime = options.maxPacketLifeTime ?? null
      this.readyState = 'connecting'
      this.remoteBuffered = 0
      this.inflight = 0
    }
    get bufferedAmount() {
      return this.remoteBuffered + this.inflight
    }
    send(data) {
      if (this.readyState !== 'open') throw transportError('transport/closed', false)
      const bytes = Buffer.byteLength(data)
      if (bytes > 16384) throw transportError('transport/message-too-large')
      this.inflight += bytes
      this.peer.post({ op: 'send', dcId: this.id, data, bytes })
    }
    close() {
      if (this.readyState === 'closed') return
      this.readyState = 'closed'
      this.peer.post({ op: 'close-channel', dcId: this.id })
      this.onclose?.()
    }
  }
  function poolFor(group) {
    if (pools.has(group)) return pools.get(group)
    const worker = new Worker(new URL('./rtc-worker.mjs', import.meta.url), {
      execArgv: [],
      env: { ...process.env, DEBUG: '' },
    })
    liveWorkers.add(worker)
    const pool = { worker, peers: new Map(), pending: new Map() }
    pools.set(group, pool)
    const fail = () => {
      for (const pending of pool.pending.values()) pending.reject(transportError('transport/rtc-worker-closed', false))
      pool.pending.clear()
      for (const peer of pool.peers.values()) {
        peer.iceConnectionState = 'failed'
        peer.oniceconnectionstatechange?.()
      }
    }
    worker.on('error', fail)
    worker.on('exit', () => {
      liveWorkers.delete(worker)
      if (pool.peers.size) fail()
    })
    worker.on('message', (event) => {
      if (event.callId) {
        const pending = pool.pending.get(event.callId)
        if (pending) {
          pool.pending.delete(event.callId)
          event.error ? pending.reject(transportError('transport/rtc-operation-failed')) : pending.resolve(event.value)
        }
        return
      }
      const peer = pool.peers.get(event.id)
      if (!peer || peer.closed) {
        if (event.event === 'dc-message') pool.worker.postMessage({ op: 'received', bytes: event.bytes })
        return
      }
      const dc = peer.channels.get(event.dcId)
      if (event.event === 'state') {
        const prior = peer.iceConnectionState
        peer.connectionState = event.connectionState
        peer.iceConnectionState = event.iceConnectionState
        peer.localDescription = event.localDescription
        peer.sctp = { maxMessageSize: event.maxMessageSize || 16384 }
        peer.path = event.path
        if (prior !== peer.iceConnectionState) peer.oniceconnectionstatechange?.()
        peer.onconnectionstatechange?.()
      } else if (event.event === 'transport-failure') {
        peer.iceConnectionState = 'failed'
        peer.oniceconnectionstatechange?.()
      } else if (event.event === 'candidate') peer.onicecandidate?.({ candidate: event.candidate })
      else if (event.event === 'datachannel') {
        const channel = new DataChannel(peer, event.dcId, event.label, event)
        peer.channels.set(event.dcId, channel)
        peer.ondatachannel?.({ channel })
      } else if (event.event === 'security-failure') peer.onsecurityfailure?.()
      else if (dc) {
        if (event.event === 'dc-state') {
          const prior = dc.readyState
          dc.readyState = event.state
          dc.remoteBuffered = event.bufferedAmount
          if (prior !== dc.readyState) {
            if (dc.readyState === 'open') dc.onopen?.()
            else if (dc.readyState === 'closed') dc.onclose?.()
          }
        } else if (event.event === 'dc-message') {
          try {
            dc.onmessage?.({ data: typeof event.data === 'string' ? event.data : Buffer.from(event.data) })
          } finally {
            peer.post({ op: 'received', bytes: event.bytes })
          }
        } else if (event.event === 'dc-buffer') dc.remoteBuffered = event.bufferedAmount
        else if (event.event === 'sent') {
          dc.inflight -= event.bytes
          dc.remoteBuffered = event.bufferedAmount
        }
      }
    })
    return pool
  }
  class RTCPeerConnection {
    constructor(config = {}) {
      this.id = ++nextId
      this.group = config.workerGroupId || defaultGroup
      this.closed = false
      this.channels = new Map()
      this.iceConnectionState = 'new'
      this.connectionState = 'new'
      this.localDescription = null
      this.path = { transport: 'webrtc', path: 'unknown' }
      this.pool = poolFor(this.group)
      this.pool.peers.set(this.id, this)
      const { workerGroupId, ...runtimeConfig } = config
      this.post({ op: 'create', config: runtimeConfig })
    }
    post(message) {
      if (!this.closed) this.pool.worker.postMessage({ id: this.id, ...message })
    }
    request(op, fields = {}, timeoutMs) {
      if (this.closed) return Promise.reject(transportError('transport/closed', false))
      const callId = ++nextCall
      return new Promise((resolve, reject) => {
        const timer = timeoutMs ? setTimeout(() => {
          this.pool.pending.delete(callId)
          reject(transportError('transport/stats-timeout', false))
        }, timeoutMs) : null
        this.pool.pending.set(callId, {
          resolve: value => { clearTimeout(timer); resolve(value) },
          reject: error => { clearTimeout(timer); reject(error) }, peerId: this.id,
        })
        this.post({ op, callId, ...fields })
      })
    }
    createDataChannel(label, options = {}) {
      const dcId = 0
      if (this.channels.has(dcId)) throw transportError('transport/extra-channel')
      const dc = new DataChannel(this, dcId, label, options)
      this.channels.set(dcId, dc)
      this.post({ op: 'create-channel', dcId, label, options })
      return dc
    }
    networkStats() { return this.request('network-stats', {}, 2500) }
    createOffer() {
      return this.request('offer')
    }
    createAnswer() {
      return this.request('answer')
    }
    setLocalDescription(description) {
      return this.request('set-local', { description })
    }
    setRemoteDescription(description) {
      return this.request('set-remote', { description })
    }
    addIceCandidate(candidate) {
      return this.request('candidate', { candidate })
    }
    async close() {
      if (this.closed) return
      this.post({ op: 'close' })
      this.closed = true
      this.pool.peers.delete(this.id)
      for (const [key, pending] of this.pool.pending)
        if (pending.peerId === this.id) {
          this.pool.pending.delete(key)
          pending.reject(transportError('transport/closed', false))
        }
      for (const dc of this.channels.values()) {
        dc.readyState = 'closed'
        dc.onclose?.()
      }
      if (!this.pool.peers.size) {
        pools.delete(this.group)
        await this.pool.worker.terminate()
      }
    }
  }
  return { RTCPeerConnection }
}
