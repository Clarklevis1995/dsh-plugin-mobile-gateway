#!/usr/bin/env node
// 可执行联调客户端；凭据仅从环境读取，不写入参数、SDP、ICE 或诊断。
import { EventEmitter } from 'node:events'
import { pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import { RTC_LABELS, TRANSPORT_CAPABILITY, transportError, parseTransportJson } from '../lib/transport-config.mjs'
import { createTransportDecoder, encodeTransportMessage, createReassemblyBudget } from '../lib/transport-framing.mjs'
import { stringifyWireFrame } from '../lib/wire-json.mjs'
import { loadRtcPeerModule } from '../lib/rtc-worker-client.mjs'

export class FrameInbox {
  constructor(maxBytes = 32 * 1024 * 1024) {
    this.frames = []
    this.waiters = []
    this.bytes = 0
    this.maxBytes = maxBytes
  }
  push(frame) {
    const index = this.waiters.findIndex((waiter) => waiter.predicate(frame))
    if (index >= 0) {
      const [waiter] = this.waiters.splice(index, 1)
      clearTimeout(waiter.timer)
      waiter.resolve(frame)
      return
    }
    const size = Buffer.byteLength(JSON.stringify(frame))
    if (this.bytes + size > this.maxBytes || this.frames.length >= 512)
      throw transportError('transport/client-inbox-budget')
    this.frames.push({ frame, size })
    this.bytes += size
  }
  take(predicate, timeoutMs = 15000) {
    if (this.error) return Promise.reject(this.error)
    const index = this.frames.findIndex((entry) => predicate(entry.frame))
    if (index >= 0) {
      const [entry] = this.frames.splice(index, 1)
      this.bytes -= entry.size
      return Promise.resolve(entry.frame)
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, reject }
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1)
        reject(transportError('transport/client-timeout', false))
      }, timeoutMs)
      this.waiters.push(waiter)
    })
  }
  close(error = transportError('transport/closed', false)) {
    if (this.error) return
    this.error = error
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
    this.frames = []
    this.bytes = 0
  }
}

export async function connectMobileTestClient({
  url,
  deviceId,
  token,
  gatewayId,
  mode = 'prefer-webrtc',
  receiveLimits = { maxFrameBytes: 16384, maxLogicalMessageBytes: 16777216 },
  onDiagnostic = () => {},
  rtcModuleLoader = loadRtcPeerModule,
}) {
  if (!gatewayId || !token || !deviceId) throw new TypeError('gatewayId, deviceId and token are required')
  const result = new EventEmitter()
  result.mode = 'websocket'
  result.peers = {}
  result.inbox = new FrameInbox()
  const signalInbox = new FrameInbox(256 * 1024)
  const sockets = []
  const decoders = []
  const pcs = []
  const sendSequences = { control: 1n, conversation: 1n }
  const sendTails = { control: Promise.resolve(), conversation: Promise.resolve() }
  let disposed = false,
    selected = false,
    commitSent = false,
    waitingBusinessHello = false,
    earlyHelloBytes = 0,
    sessionId,
    hostLimits = receiveLimits
  let businessControlAnnounced = false
  const budget = createReassemblyBudget()
  const fail = (error) => {
    signalInbox.close(error)
    result.inbox.close(error)
    result.emit('failure', error)
    void result.close()
  }
  const deliver = (frame, channel) => {
    if (frame.kind === 'hello' && frame.gatewayId !== gatewayId) throw transportError('transport/gateway-identity')
    result.inbox.push({ ...frame, channel })
    result.emit('frame', frame, channel)
  }
  let closeTask
  result.close = () =>
    (closeTask ||= (async () => {
      disposed = true
      for (const decoder of decoders) decoder.close()
      signalInbox.close()
      result.inbox.close()
      for (const socket of sockets) {
        socket.removeAllListeners('message')
        socket.close()
      }
      await Promise.all(pcs.map((pc) => pc.close()))
    })())
  const openSocket = (channel) => {
    const socket = new WebSocket(url, ['dsh-mobile-v1'], {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-DSH-Device-ID': deviceId,
        'X-DSH-Channel': channel,
        ...(channel === 'control' && mode !== 'ws-only' ? { 'X-DSH-Transport-Intent': 'negotiate-v1' } : {}),
      },
    })
    sockets.push(socket)
    socket.on('error', () => fail(transportError('transport/wss-failed', false)))
    socket.on('close', () => {
      if (!disposed) fail(transportError('transport/wss-closed', false))
    })
    return socket
  }
  const control = openSocket('control')
  const jsonSend = (frame) => {
    if (!disposed && control.readyState === 1) control.send(stringifyWireFrame(frame))
  }
  const signalSeq = { control: 0, conversation: 0 }
  const inboundSignalSeq = { control: 0, conversation: 0 }
  const signalTails = { control: Promise.resolve(), conversation: Promise.resolve() }
  const candidateQueues = { control: [], conversation: [] }
  const remoteReady = { control: false, conversation: false }
  const channels = {}
  control.on('message', (data) => {
    try {
      const frame = parseTransportJson(data)
      if (frame.kind === 'hello' && !frame.transport?.bootstrap) businessControlAnnounced = true
      if (frame.kind === 'transport-signal') {
        const name = frame.channel
        if (
          !['control', 'conversation'].includes(name) ||
          frame.transportSessionId !== sessionId ||
          frame.signalSeq !== ++inboundSignalSeq[name]
        )
          throw transportError('transport/signal-order')
        signalTails[name] = signalTails[name]
          .then(async () => {
            if (disposed || (selected && result.mode !== 'webrtc')) return
            const pc = result.peers[name]
            if (frame.signalType === 'answer') {
              await pc.setRemoteDescription({ type: 'answer', sdp: frame.sdp })
              remoteReady[name] = true
              for (const candidate of candidateQueues[name]) await pc.addIceCandidate(candidate)
              candidateQueues[name] = []
            } else if (frame.signalType === 'candidate' || frame.signalType === 'end-of-candidates') {
              const candidate = frame.signalType === 'candidate' ? frame.candidate : null
              if (remoteReady[name]) await pc.addIceCandidate(candidate)
              else {
                if (candidateQueues[name].length >= 256) throw transportError('transport/candidate-limit')
                candidateQueues[name].push(candidate)
              }
            } else throw transportError('transport/invalid-signal')
          })
          .catch(() => fail(transportError('transport/client-sdp-failed')))
      } else if (
        frame.kind.startsWith('transport-') ||
        (frame.kind === 'hello' && (!selected || waitingBusinessHello))
      ) {
        signalInbox.push(frame)
      } else if ((selected && result.mode === 'websocket') || businessControlAnnounced) deliver(frame, 'control')
      else if (frame.kind === 'transport-failed' && frame.recoverable === false)
        fail(transportError('transport/security-failed'))
    } catch (error) {
      fail(error)
    }
  })
  result.send = (channel, frame) => {
    if (disposed || !selected) return Promise.reject(transportError('transport/not-active'))
    const wire = stringifyWireFrame(frame)
    if (result.mode === 'websocket') {
      ;(channel === 'control' ? control : result.conversationSocket).send(wire)
      return Promise.resolve()
    }
    if (Buffer.byteLength(wire) > hostLimits.maxLogicalMessageBytes)
      return Promise.reject(transportError('transport/ws-required', false))
    const task = sendTails[channel].then(async () => {
      const dc = channels[channel]
      for (const chunk of encodeTransportMessage(Buffer.from(wire), {
        channel,
        sequence: sendSequences[channel],
        ...hostLimits,
      })) {
        const deadline = performance.now() + 30000
        while (dc.bufferedAmount > 65536) {
          if (disposed || performance.now() > deadline) throw transportError('transport/client-send-timeout', false)
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        if (disposed) throw transportError('transport/closed', false)
        dc.send(chunk)
      }
      sendSequences[channel]++
    })
    sendTails[channel] = task.catch(() => {})
    return task
  }
  try {
    const hello = await signalInbox.take((frame) => frame.kind === 'hello')
    if (hello.gatewayId !== gatewayId) throw transportError('transport/gateway-identity')
    if (mode !== 'ws-only' && hello.capabilities.includes(TRANSPORT_CAPABILITY) && hello.transport?.bootstrap) {
      jsonSend({
        type: 'transport-negotiate',
        requestId: 'test-negotiate',
        version: 1,
        preferred: ['webrtc', 'websocket'],
        receiveLimits,
      })
      const offered = await signalInbox.take((frame) => frame.kind === 'transport-offered')
      sessionId = offered.transportSessionId
      hostLimits = {
        maxFrameBytes: Math.min(receiveLimits.maxFrameBytes, offered.receiveLimits.maxFrameBytes),
        maxLogicalMessageBytes: Math.min(
          receiveLimits.maxLogicalMessageBytes,
          offered.receiveLimits.maxLogicalMessageBytes,
        ),
      }
      onDiagnostic({ phase: 'negotiating' })
      const readyPromise = signalInbox.take(
        (frame) => frame.kind === 'transport-ready' || frame.kind === 'transport-failed',
        Math.max(100, offered.expiresInMs - 1000),
      )
      // 预先注册超时处理，避免创建 PC 时的异步异常产生未处理 rejection。
      readyPromise.catch(() => {})
      const { RTCPeerConnection } = await rtcModuleLoader()
      for (const channel of ['control', 'conversation']) {
        const pc = new RTCPeerConnection({
          iceServers: offered.iceServers,
          maxMessageSize: receiveLimits.maxFrameBytes,
        })
        pcs.push(pc)
        result.peers[channel] = pc
        const dc = pc.createDataChannel(RTC_LABELS[channel], { ordered: true })
        channels[channel] = dc
        dc.binaryType = 'arraybuffer'
        const decoder = createTransportDecoder({ channel, ...receiveLimits, budget, onFailure: fail })
        decoders.push(decoder)
        let bound = false
        dc.onopen = () =>
          dc.send(
            stringifyWireFrame({
              type: 'transport-bind',
              version: 1,
              gatewayId,
              transportSessionId: sessionId,
              channel,
              ticket: offered.bindTickets[channel],
            }),
          )
        dc.onmessage = (event) => {
          try {
            if (!bound) {
              const frame = parseTransportJson(event.data, 4096)
              if (
                frame.kind !== 'transport-bound' ||
                frame.version !== 1 ||
                frame.gatewayId !== gatewayId ||
                frame.channel !== channel ||
                frame.transportSessionId !== sessionId
              )
                throw transportError('transport/invalid-bind')
              bound = true
              return
            }
            if (typeof event.data === 'string') throw transportError('transport/framing')
            const text = decoder.push(event.data)
            if (text !== null) {
              const frame = JSON.parse(text)
              if (!selected && frame.kind !== 'hello') throw transportError('transport/business-before-select')
              if (!selected && (earlyHelloBytes += Buffer.byteLength(text)) > 262144)
                throw transportError('transport/client-inbox-budget')
              deliver(frame, channel)
            }
          } catch (error) {
            fail(error)
          }
        }
        pc.onicecandidate = (event) => {
          if (commitSent) return
          jsonSend({
            type: 'transport-signal',
            transportSessionId: sessionId,
            channel,
            signalSeq: ++signalSeq[channel],
            ...(event.candidate
              ? {
                  signalType: 'candidate',
                  candidate: {
                    candidate: event.candidate.candidate.replace(/^a=/, ''),
                    sdpMid: event.candidate.sdpMid ?? null,
                    sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
                  },
                }
              : { signalType: 'end-of-candidates' }),
          })
        }
        void (async () => {
          const offer = await pc.createOffer()
          if (disposed || commitSent) return
          jsonSend({
            type: 'transport-signal',
            transportSessionId: sessionId,
            channel,
            signalSeq: ++signalSeq[channel],
            signalType: 'offer',
            sdp: offer.sdp,
          })
          await pc.setLocalDescription(offer)
        })().catch(() => {
          if (!disposed && !commitSent) fail(transportError('transport/client-offer-failed'))
        })
      }
      let ready
      try {
        ready = await readyPromise
      } catch (error) {
        if (error.security !== false) throw error
        ready = { recoverable: true }
      }
      if (ready.recoverable === false) throw transportError('transport/security-failed')
      const selectedMode = ready.kind === 'transport-ready' ? 'webrtc' : 'websocket'
      waitingBusinessHello = selectedMode === 'websocket'
      commitSent = true
      jsonSend({
        type: 'transport-select',
        requestId: 'test-select',
        transportSessionId: sessionId,
        mode: selectedMode,
      })
      const ack = await signalInbox.take((frame) => frame.kind === 'transport-selected', 2000)
      if (ack.transportSessionId !== sessionId || ack.mode !== selectedMode)
        throw transportError('transport/invalid-select')
      result.mode = selectedMode
      selected = true
      if (selectedMode === 'webrtc') {
        // selected 经 WSS 到达；两条 RTC 先 ping，释放各自的开场基线门控。
        await Promise.all(['control', 'conversation'].map((channel) => result.send(channel, { type: 'ping' })))
        for (const channel of ['control', 'conversation'])
          await result.inbox.take((frame) => frame.kind === 'hello' && frame.channel === channel)
        onDiagnostic({ phase: 'active', transport: 'webrtc', channels: ['control', 'conversation'] })
        return result
      }
      await Promise.all(pcs.map((pc) => pc.close()))
      const activeHello = await signalInbox.take((frame) => frame.kind === 'hello')
      if (activeHello.gatewayId !== gatewayId) throw transportError('transport/gateway-identity')
      waitingBusinessHello = false
    } else {
      selected = true
    }
    result.mode = 'websocket'
    const conversation = openSocket('conversation')
    result.conversationSocket = conversation
    conversation.on('message', (data) => {
      try {
        deliver(JSON.parse(data), 'conversation')
      } catch (error) {
        fail(error)
      }
    })
    await result.inbox.take((frame) => frame.kind === 'hello' && frame.channel === 'conversation')
    onDiagnostic({ phase: 'active', transport: 'websocket' })
    return result
  } catch (error) {
    await result.close()
    throw error
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const client = await connectMobileTestClient({
    url: process.env.MGW_URL,
    token: process.env.MGW_TOKEN,
    deviceId: process.env.MGW_DEVICE_ID,
    gatewayId: process.env.MGW_GATEWAY_ID,
    mode: process.argv.includes('--ws-only') ? 'ws-only' : 'prefer-webrtc',
    onDiagnostic: (value) => console.log(JSON.stringify(value)),
  })
  try {
    await client.send('control', { type: 'ping' })
    await client.inbox.take((frame) => frame.kind === 'pong')
    await client.send('control', { type: 'workspaces', requestId: 'rtc-workspaces' })
    const frame = await client.inbox.take((frame) => ['workspaces', 'error'].includes(frame.kind))
    console.log(JSON.stringify({ transport: client.mode, ping: 'ok', businessResponse: frame.kind }))
  } finally {
    await client.close()
  }
}
