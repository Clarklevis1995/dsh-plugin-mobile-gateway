import { EventEmitter } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { RTC_LIMITS, transportError } from './transport-config.mjs'
import { createTransportDecoder, encodeTransportMessage } from './transport-framing.mjs'
import { stringifyWireFrame } from './wire-json.mjs'

export class RtcMobileTransport extends EventEmitter {
  kind = 'webrtc'
  constructor(dc, { channel, receiveLimits, sendLimits, budget, onFailure, requireStart = false, networkStats }) {
    super()
    this.networkStats = networkStats
    this.dc = dc
    this.channel = channel
    this.sendLimits = sendLimits
    this.onFailure = onFailure
    this.active = false
    this.started = !requireStart
    this.closed = false
    this.queuedBytes = 0
    this.peakQueuedBytes = 0
    this.sequence = 1n
    this.tail = Promise.resolve()
    this.abort = new AbortController()
    this.decoder = createTransportDecoder({ channel, ...receiveLimits, budget, onFailure })
    this.message = (data, binary) => {
      try {
        if (!this.active || !binary) throw transportError('transport/business-before-select')
        const text = this.decoder.push(data)
        if (text !== null) {
          if (!this.started && JSON.parse(text)?.type !== 'ping') throw transportError('transport/start-required')
          this.started = true
          this.emit('message', text)
        }
      } catch (error) {
        onFailure(error)
      }
    }
    this.onDcClose = () => {
      if (!this.closed) onFailure(transportError('transport/channel-closed', false))
    }
    dc.on('message', this.message)
    dc.on('close', this.onDcClose)
  }
  get readyState() {
    return !this.closed && this.active && this.dc.readyState === 'open' ? 1 : 3
  }
  async probeNetwork() {
    return this.networkStats ? this.networkStats() : { status: 'unavailable', measurement: 'rtc-ice', rttMs: null }
  }
  activate() {
    this.active = true
  }
  send(wire) {
    if (this.readyState !== 1) return Promise.resolve()
    let size = Buffer.byteLength(wire)
    if (size > this.sendLimits.maxLogicalMessageBytes) {
      const original = JSON.parse(wire)
      wire = stringifyWireFrame({
        kind: 'error',
        code: 'transport/ws-required',
        requestType: String(original.requestType || original.kind || 'unknown').slice(0, 128),
        ...(typeof original.requestId === 'string' && original.requestId.length <= 128
          ? { requestId: original.requestId }
          : {}),
        maxLogicalMessageBytes: this.sendLimits.maxLogicalMessageBytes,
        message: 'Response exceeds the RTC limit; reconnect using WebSocket. Do not replay writes.',
      })
      size = Buffer.byteLength(wire)
    }
    if (this.queuedBytes + size > RTC_LIMITS.queueBudgetBytes) {
      this.onFailure(transportError('transport/send-budget', false))
      return Promise.resolve()
    }
    this.queuedBytes += size
    const startupHello = !this.started && JSON.parse(wire).kind === 'hello'
    this.peakQueuedBytes = Math.max(this.peakQueuedBytes, this.queuedBytes)
    const task = this.tail
      .then(async () => {
        const deadline = performance.now() + RTC_LIMITS.sendTimeoutMs
        if (this.closed) return
        const bytes = Buffer.from(wire)
        while (!this.started && !startupHello) {
          if (performance.now() >= deadline) throw transportError('transport/start-timeout', false)
          await delay(10, undefined, { signal: this.abort.signal })
        }
        for (const frame of encodeTransportMessage(bytes, {
          channel: this.channel,
          sequence: this.sequence,
          ...this.sendLimits,
        })) {
          if (this.dc.bufferedAmount >= RTC_LIMITS.highWaterBytes) {
            while (this.dc.bufferedAmount > RTC_LIMITS.lowWaterBytes) {
              if (performance.now() >= deadline) throw transportError('transport/send-timeout', false)
              await delay(10, undefined, { signal: this.abort.signal })
            }
          }
          if (this.readyState !== 1) throw transportError('transport/closed', false)
          this.dc.send(frame)
        }
        this.sequence++
      })
      .finally(() => {
        this.queuedBytes -= size
      })
    this.tail = task.catch((error) => {
      if (!this.closed)
        this.onFailure(error.code?.startsWith('transport/') ? error : transportError('transport/send-failed', false))
    })
    return task
  }
  close() {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    this.decoder.close()
    this.dc.off('message', this.message)
    this.dc.off('close', this.onDcClose)
    this.dc.close()
    this.emit('close')
  }
}
