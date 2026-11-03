import crypto from 'node:crypto'
import { loadRtcAdapter, validateDataChannel } from './rtc-adapter.mjs'
import { RtcMobileTransport } from './rtc-mobile-transport.mjs'
import { WebSocketMobileTransport } from './ws-mobile-transport.mjs'
import { createReassemblyBudget } from './transport-framing.mjs'
import {
  RTC_CHANNELS,
  RTC_LIMITS,
  TRANSPORT_CAPABILITY,
  normalizeTransportConfig,
  parseTransportJson,
  receiveLimits,
  transportError,
} from './transport-config.mjs'
import { stringifyWireFrame } from './wire-json.mjs'

const hash = (value) => crypto.createHash('sha256').update(value).digest()
const validRequestId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128

export function validateOffer(sdp) {
  if (
    typeof sdp !== 'string' ||
    Buffer.byteLength(sdp) > RTC_LIMITS.maxSdpBytes ||
    !/^v=0\r?$/m.test(sdp) ||
    !/^a=fingerprint:sha-256 (?:[\da-f]{2}:){31}[\da-f]{2}\r?$/im.test(sdp)
  )
    throw transportError('transport/invalid-sdp')
  const media = sdp.split(/\r?\n/).filter((line) => line.startsWith('m='))
  if (
    media.length !== 1 ||
    !/^m=application \d+ (?:UDP\/)?DTLS\/SCTP /i.test(media[0]) ||
    / typ relay(?: |\r|$)/m.test(sdp) ||
    (sdp.match(/^a=candidate:/gm) || []).length > RTC_LIMITS.maxCandidates
  )
    throw transportError('transport/invalid-sdp')
}

export function createTransportNegotiator({
  config: input,
  identity,
  isAuthorized,
  onBootstrapPresence = () => {},
  runtimeLoader = loadRtcAdapter,
  log = () => {},
}) {
  let settings = normalizeTransportConfig(input)
  const groups = new Set()
  const closing = new Set()
  const rates = new Map()
  let adapter = null, disposed = false, runtime = 'disabled', loaded = Promise.resolve()
  const enabled = () => settings.enabled && settings.mode !== 'ws-only'
  const prepare = () => {
    if (!enabled() || ['loading', 'available'].includes(runtime)) return
    runtime = 'loading'
    loaded = Promise.resolve().then(runtimeLoader).then(
      value => { if (!disposed) { adapter = value; runtime = 'available' } },
      () => { if (!disposed) runtime = 'unavailable' },
    )
  }
  prepare()
  const pending = () => [...groups].filter((g) => !g.selected).length
  const active = () => [...groups].filter((g) => g.selected === 'webrtc').length
  const authorized = (deviceId) => !disposed && isAuthorized(deviceId)
  // ICE 合法突发按已接纳的组数、双通道候选上限与 EOC 预留独立预算。
  // 控制帧仍使用 40 个突发额度；两个池都按每秒 20 个令牌恢复。
  const iceBurst = RTC_LIMITS.perDeviceGroups * RTC_CHANNELS.length * (RTC_LIMITS.maxCandidates + 1)
  const rate = (deviceId, iceSignal) => {
    const now = performance.now()
    const device = rates.get(deviceId) || {}
    const key = iceSignal ? 'ice' : 'control'
    const capacity = iceSignal ? iceBurst : 40
    const value = device[key] || { at: now, tokens: capacity }
    value.tokens = Math.min(capacity, value.tokens + (now - value.at) * 0.02)
    value.at = now
    device[key] = value
    rates.set(deviceId, device)
    if (value.tokens < 1) throw transportError(iceSignal ? 'transport/ice-rate-limit' : 'transport/rate-limit')
    value.tokens--
  }
  const trackClose = (peer) => {
    const operation = Promise.resolve()
      .then(() => peer.close())
      .catch(() => {})
      .finally(() => closing.delete(operation))
    closing.add(operation)
  }
  return {
    get loaded() { return loaded },
    configure(input) {
      if (disposed) throw new Error('transport disposed')
      settings = normalizeTransportConfig(input)
      prepare()
    },
    get available() {
      return !disposed && enabled() && runtime === 'available'
    },
    snapshot() {
      return {
        enabled: settings.enabled,
        mode: settings.mode,
        runtime: enabled() ? runtime : 'disabled',
        pending: pending(),
        activeGroups: active(),
        stunConfigured: settings.stunServers.length > 0,
        stunServers: [...settings.stunServers],
        paths: [...groups]
          .filter((g) => g.selected === 'webrtc')
          .map((g) => ({
            traceId: g.traceId,
            channels: Object.fromEntries(RTC_CHANNELS.map((channel) => [channel, g.channels[channel].peer.path()])),
          })),
      }
    },
    attach({ socket, device, hello, activate }) {
      // 每组固定一份配置；管理页修改只影响后续连接，不能改变在途协商的限制和计时。
      const config = settings
      const limits = receiveLimits(config)
      const deviceId = device.id
      if (!authorized(deviceId)) {
        socket.close(4003, 'transport authorization failed')
        return
      }
      if (
        pending() >= config.maxPendingNegotiations ||
        [...groups].filter((g) => g.deviceId === deviceId && g.selected !== 'websocket').length >=
          RTC_LIMITS.perDeviceGroups
      ) {
        socket.close(1013, 'transport capacity reached')
        return
      }
      const group = { deviceId, traceId: crypto.randomBytes(6).toString('hex'), channels: {}, selected: null }
      groups.add(group)
      let closed = false,
        counted = true,
        phase = 'bootstrap',
        sessionId = null,
        offered = null
      let receive = null,
        connectTimer = null
      const started = performance.now()
      const send = (frame) => {
        if (!closed && socket.readyState === 1) socket.send(stringifyWireFrame(frame))
      }
      const present = (value) => {
        if (counted !== value) {
          counted = value
          onBootstrapPresence(deviceId, value)
        }
      }
      onBootstrapPresence(deviceId, true)
      const closePeers = () => {
        clearTimeout(connectTimer)
        for (const state of Object.values(group.channels)) {
          clearTimeout(state.bindTimer)
          state.ticketHash = null
          state.dc?.off('message', state.bind)
          state.transport?.close()
          if (!state.transport) state.dc?.close()
          if (state.peer) {
            trackClose(state.peer)
            state.peer = null
          }
        }
      }
      const close = (code = 1000) => {
        if (closed) return
        closed = true
        phase = 'closed'
        clearTimeout(deadline)
        closePeers()
        present(false)
        groups.delete(group)
        if (![...groups].some((g) => g.deviceId === deviceId)) rates.delete(deviceId)
        socket.off('message', receive)
        socket.off('close', onClose)
        if (socket.readyState === 1) socket.close(code, 'transport group ended')
      }
      group.close = close
      const failure = (error) => {
        if (closed) return
        if (phase === 'ws-offered' && error.security === false) return
        const security = error.security !== false
        log(
          `rtc trace=${group.traceId} stage=${phase} elapsedMs=${Math.round(performance.now() - started)} code=${error.code?.startsWith('transport/') ? error.code : 'transport/internal'} security=${security}`,
        )
        send({
          kind: 'transport-failed',
          ...(sessionId ? { transportSessionId: sessionId } : {}),
          code: security ? 'transport/security-failed' : 'transport/rtc-unavailable',
          recoverable: !security && !group.selected,
        })
        if (security || group.selected) {
          close(security ? 4003 : 1011)
          return
        }
        phase = 'ws-offered'
        closePeers()
      }
      const deadline = setTimeout(() => close(1008), config.negotiationTimeoutMs)
      const onClose = () => close()
      socket.on('close', onClose)
      socket.on('error', () => {})
      const sendSignal = (name, payload) => {
        if (closed || !['negotiating', 'ready'].includes(phase)) return
        const state = group.channels[name]
        send({
          kind: 'transport-signal',
          transportSessionId: sessionId,
          channel: name,
          signalSeq: ++state.sentSeq,
          ...payload,
        })
      }
      const ready = () => {
        if (phase !== 'negotiating' || !RTC_CHANNELS.every((name) => group.channels[name]?.transport)) return
        phase = 'ready'
        clearTimeout(connectTimer)
        send({
          kind: 'transport-ready',
          transportSessionId: sessionId,
          channels: { control: 'bound', conversation: 'bound' },
        })
      }
      const attachChannel = (name, dc) => {
        try {
          if (closed || phase === 'ws-offered' || group.selected === 'websocket') {
            dc.close()
            return
          }
          if (phase !== 'negotiating') throw transportError('transport/extra-channel')
          const state = group.channels[name]
          if (state.dc) {
            dc.close()
            throw transportError('transport/extra-channel')
          }
          validateDataChannel(dc, name)
          state.dc = dc
          const startBindTimer = () => {
            state.bindTimer = setTimeout(
              () => failure(transportError('transport/bind-timeout', false)),
              config.bindTimeoutMs,
            )
          }
          if (dc.readyState === 'open') startBindTimer()
          else dc.once('open', startBindTimer)
          dc.once('failure', failure)
          dc.once('close', () => {
            if (!closed && !group.selected && phase !== 'ws-offered')
              failure(transportError('transport/channel-closed', false))
          })
          state.bind = (data, binary) => {
            try {
              if (binary) throw transportError('transport/invalid-bind')
              const bind = parseTransportJson(data, RTC_LIMITS.maxBindBytes)
              if (
                !authorized(deviceId) ||
                socket.readyState !== 1 ||
                phase !== 'negotiating' ||
                bind.type !== 'transport-bind' ||
                bind.version !== 1 ||
                bind.gatewayId !== identity.gatewayId ||
                bind.transportSessionId !== sessionId ||
                bind.channel !== name ||
                typeof bind.ticket !== 'string' ||
                !state.ticketHash ||
                !crypto.timingSafeEqual(hash(bind.ticket), state.ticketHash)
              )
                throw transportError('transport/invalid-bind')
              state.ticketHash = null
              clearTimeout(state.bindTimer)
              dc.off('message', state.bind)
              const actualFrameLimit = Math.min(state.peer.maxMessageSize, offered.maxFrameBytes)
              if (actualFrameLimit <= 32) throw transportError('transport/invalid-limits')
              state.transport = new RtcMobileTransport(dc, {
                networkStats: () => state.peer.networkStats(),
                requireStart: true,
                channel: name,
                receiveLimits: limits,
                sendLimits: { ...offered, maxFrameBytes: actualFrameLimit },
                budget: group.budget,
                onFailure: failure,
              })
              dc.send(
                stringifyWireFrame({
                  kind: 'transport-bound',
                  version: 1,
                  ...identity,
                  transportSessionId: sessionId,
                  channel: name,
                }),
              )
              ready()
            } catch (error) {
              failure(error)
            }
          }
          dc.on('message', state.bind)
        } catch (error) {
          dc.close()
          failure(error)
        }
      }
      const select = (msg) => {
        if (
          !sessionId ||
          !validRequestId(msg.requestId) ||
          msg.transportSessionId !== sessionId ||
          !['webrtc', 'websocket'].includes(msg.mode)
        )
          throw transportError('transport/invalid-select')
        if (group.selected && group.selected !== msg.mode) throw transportError('transport/conflicting-select')
        if (
          msg.mode === 'webrtc' &&
          (!['ready', 'active'].includes(phase) || (active() >= config.maxActiveGroups && !group.selected))
        )
          throw transportError('transport/not-ready')
        if (group.selected) {
          send({ kind: 'transport-selected', requestId: msg.requestId, transportSessionId: sessionId, mode: msg.mode })
          return
        }
        group.selected = msg.mode
        phase = 'active'
        clearTimeout(deadline)
        clearTimeout(connectTimer)
        send({ kind: 'transport-selected', requestId: msg.requestId, transportSessionId: sessionId, mode: msg.mode })
        present(false)
        if (msg.mode === 'websocket') {
          closePeers()
          socket.off('message', receive)
          const intercept = (data) => {
            let frame
            try {
              frame = JSON.parse(data.toString())
            } catch {
              return false
            }
            if (!frame?.type?.startsWith?.('transport-')) return false
            try {
              const parsed = parseTransportJson(data)
              if (!authorized(deviceId) || parsed.type !== 'transport-select')
                throw transportError('transport/already-selected')
              select(parsed)
            } catch (error) {
              failure(error)
            }
            return true
          }
          activate(new WebSocketMobileTransport(socket, { intercept }), 'control')
        } else {
          for (const name of RTC_CHANNELS) group.channels[name].transport.activate()
          for (const name of RTC_CHANNELS) activate(group.channels[name].transport, name)
          log(
            `rtc trace=${group.traceId} stage=active elapsedMs=${Math.round(performance.now() - started)} transport=webrtc`,
          )
        }
      }
      const signal = (msg) => {
        // DataChannel 绑定完成不代表 ICE gathering 已结束；ready 到 select 之间仍可能收到在途候选。
        if (!['negotiating', 'ready'].includes(phase) || msg.transportSessionId !== sessionId || !RTC_CHANNELS.includes(msg.channel))
          throw transportError('transport/stale-signal')
        const state = group.channels[msg.channel]
        if (!Number.isSafeInteger(msg.signalSeq) || msg.signalSeq !== state.receivedSeq + 1)
          throw transportError('transport/signal-order')
        state.receivedSeq++
        if (msg.signalType === 'offer') {
          if (state.peer) throw transportError('transport/duplicate-offer')
          validateOffer(msg.sdp)
          state.peer = adapter.createPeer({
            groupId: sessionId,
            channel: msg.channel,
            iceServers: config.stunServers.map((url) => ({ urls: [url] })),
            maxFrameBytes: limits.maxFrameBytes,
            onCandidate: (candidate) =>
              sendSignal(
                msg.channel,
                candidate ? { signalType: 'candidate', candidate } : { signalType: 'end-of-candidates' },
              ),
            onChannel: (dc) => attachChannel(msg.channel, dc),
            onFailure: (error) => {
              if (state.peer && phase !== 'ws-offered') failure(error)
            },
          })
          const currentPeer = state.peer
          void currentPeer
            .answer(msg.sdp)
            .then(async (sdp) => {
              if (closed || phase !== 'negotiating' || state.peer !== currentPeer || !sdp) return
              sendSignal(msg.channel, { signalType: 'answer', sdp })
              state.descriptionReady = true
              for (const candidate of state.candidates) {
                if (closed || state.peer !== currentPeer) return
                await currentPeer.addCandidate(candidate)
              }
              state.candidates = []
            })
            .catch((error) => {
              if (!closed && state.peer === currentPeer && phase !== 'ws-offered')
                failure(error.code?.startsWith('transport/') ? error : transportError('transport/sdp-failed'))
            })
        } else if (msg.signalType === 'candidate' || msg.signalType === 'end-of-candidates') {
          if (state.ended || (msg.signalType === 'candidate' && ++state.candidateCount > RTC_LIMITS.maxCandidates))
            throw transportError('transport/candidate-limit')
          const candidate = msg.signalType === 'candidate' ? msg.candidate : null
          if (msg.signalType === 'candidate' && candidate === null) throw transportError('transport/invalid-candidate')
          if (
            candidate !== null &&
            (!candidate ||
              typeof candidate.candidate !== 'string' ||
              !/^candidate:/.test(candidate.candidate) ||
              / typ relay(?: |$)/.test(candidate.candidate) ||
              Buffer.byteLength(JSON.stringify(candidate)) > RTC_LIMITS.maxCandidateBytes ||
              !(candidate.sdpMid === null || (typeof candidate.sdpMid === 'string' && candidate.sdpMid.length <= 32)) ||
              !(
                candidate.sdpMLineIndex === null ||
                (Number.isInteger(candidate.sdpMLineIndex) && candidate.sdpMLineIndex === 0)
              ))
          )
            throw transportError('transport/invalid-candidate')
          if (candidate === null) state.ended = true
          if (state.descriptionReady) {
            const candidatePeer = state.peer
            void candidatePeer.addCandidate(candidate).catch(() => {
              if (!closed && state.peer === candidatePeer && phase !== 'ws-offered')
                failure(transportError('transport/candidate-failed'))
            })
          } else state.candidates.push(candidate)
        } else throw transportError('transport/invalid-signal')
      }
      receive = (data) => {
        try {
          if (closed || !authorized(deviceId)) throw transportError('transport/authorization')
          const msg = parseTransportJson(data)
          const iceSignal = msg.type === 'transport-signal' &&
            ['candidate', 'end-of-candidates'].includes(msg.signalType) &&
            ['negotiating', 'ready'].includes(phase) && msg.transportSessionId === sessionId &&
            RTC_CHANNELS.includes(msg.channel)
          rate(deviceId, iceSignal)
          if (msg.type === 'ping') {
            send({ kind: 'pong', at: Date.now() })
            return
          }
          if (msg.type === 'transport-negotiate') {
            if (
              phase !== 'bootstrap' ||
              msg.version !== 1 ||
              !validRequestId(msg.requestId) ||
              !Array.isArray(msg.preferred) ||
              msg.preferred.length !== 2 ||
              msg.preferred[0] !== 'webrtc' ||
              msg.preferred[1] !== 'websocket'
            )
              throw transportError('transport/invalid-negotiate')
            offered = receiveLimits(msg.receiveLimits)
            offered.maxFrameBytes = Math.min(limits.maxFrameBytes, offered.maxFrameBytes)
            offered.maxLogicalMessageBytes = Math.min(limits.maxLogicalMessageBytes, offered.maxLogicalMessageBytes)
            sessionId = crypto.randomUUID()
            phase = 'negotiating'
            group.budget = createReassemblyBudget()
            const tickets = {}
            for (const name of RTC_CHANNELS) {
              tickets[name] = crypto.randomBytes(32).toString('base64url')
              group.channels[name] = {
                ticketHash: hash(tickets[name]),
                receivedSeq: 0,
                sentSeq: 0,
                candidates: [],
                candidateCount: 0,
              }
            }
            send({
              kind: 'transport-offered',
              requestId: msg.requestId,
              transportSessionId: sessionId,
              expiresInMs: Math.max(0, Math.floor(config.negotiationTimeoutMs - (performance.now() - started))),
              iceServers: config.stunServers.map((url) => ({ urls: [url] })),
              channels: RTC_CHANNELS,
              receiveLimits: limits,
              bindTickets: tickets,
            })
            connectTimer = setTimeout(
              () => failure(transportError('transport/connect-timeout', false)),
              config.rtcConnectTimeoutMs,
            )
          } else if (
            msg.type === 'transport-signal' &&
            phase === 'ws-offered' &&
            msg.transportSessionId === sessionId
          ) {
            // 已撤销临时 PC；拒绝本次网络失败前已在途的信令，仍允许显式提交 WSS。
            send({ kind: 'error', code: 'transport/negotiation-ended', requestType: msg.type })
          } else if (msg.type === 'transport-signal') signal(msg)
          else if (msg.type === 'transport-select') select(msg)
          else throw transportError('transport/bootstrap-only')
        } catch (error) {
          failure(error)
        }
      }
      socket.on('message', receive)
      send({
        ...hello,
        capabilities: [...hello.capabilities, TRANSPORT_CAPABILITY],
        transport: {
          version: 1,
          bootstrap: true,
          modes: ['webrtc', 'websocket'],
          negotiateTimeoutMs: config.negotiationTimeoutMs,
          ...limits,
        },
      })
    },
    closeDevice(deviceId) {
      for (const group of [...groups]) if (group.deviceId === deviceId) group.close(4003)
    },
    closeAll() {
      for (const group of [...groups]) group.close(4004)
    },
    async dispose() {
      disposed = true
      for (const group of [...groups]) group.close(1001)
      await Promise.all([...closing])
      rates.clear()
    },
  }
}
