import { RTC_LIMITS, transportError } from './transport-config.mjs'

const MAGIC = Buffer.from('MGW1')
const MAX_SEQUENCE = (1n << 63n) - 1n
const channelId = (channel) => (channel === 'control' ? 1 : channel === 'conversation' ? 2 : 0)

export function* encodeTransportMessage(
  bytes,
  { channel, sequence, maxFrameBytes = 16384, maxLogicalMessageBytes = 16777216 },
) {
  if (!channelId(channel) || typeof sequence !== 'bigint' || sequence < 1n || sequence > MAX_SEQUENCE)
    throw transportError('transport/sequence')
  if (bytes.length < 1 || bytes.length > maxLogicalMessageBytes) throw transportError('transport/ws-required', false)
  const payloadSize = maxFrameBytes - RTC_LIMITS.headerBytes
  if (!Number.isSafeInteger(payloadSize) || payloadSize < 1 || maxFrameBytes > 16384)
    throw transportError('transport/invalid-limits')
  const count = Math.ceil(bytes.length / payloadSize)
  for (let index = 0; index < count; index++) {
    const payload = bytes.subarray(index * payloadSize, Math.min(bytes.length, (index + 1) * payloadSize))
    const frame = Buffer.allocUnsafe(RTC_LIMITS.headerBytes + payload.length)
    MAGIC.copy(frame)
    frame[4] = 1
    frame[5] = 0
    frame[6] = channelId(channel)
    frame[7] = 0
    frame.writeBigUInt64BE(sequence, 8)
    frame.writeUInt32BE(index, 16)
    frame.writeUInt32BE(count, 20)
    frame.writeUInt32BE(bytes.length, 24)
    frame.writeUInt32BE(payload.length, 28)
    payload.copy(frame, 32)
    yield frame
  }
}

export function createReassemblyBudget(maxBytes = RTC_LIMITS.reassemblyBudgetBytes) {
  let used = 0
  return {
    get used() {
      return used
    },
    reserve(size) {
      if (used + size > maxBytes) throw transportError('transport/reassembly-budget')
      used += size
    },
    release(size) {
      used -= size
    },
  }
}

export function createTransportDecoder({
  channel,
  maxFrameBytes = 16384,
  maxLogicalMessageBytes = 16777216,
  budget = createReassemblyBudget(),
  idleTimeoutMs = RTC_LIMITS.reassemblyTimeoutMs,
  onFailure = () => {},
}) {
  let sequence = 1n,
    partial = null,
    timer = null,
    closed = false
  const reset = () => {
    clearTimeout(timer)
    timer = null
    if (partial) budget.release(partial.total)
    partial = null
  }
  const close = () => {
    closed = true
    reset()
  }
  return {
    close,
    push(input) {
      try {
        if (closed) throw transportError('transport/closed')
        const frame = Buffer.from(input.buffer || input, input.byteOffset || 0, input.byteLength)
        if (
          frame.length <= 32 ||
          frame.length > maxFrameBytes ||
          !frame.subarray(0, 4).equals(MAGIC) ||
          frame[4] !== 1 ||
          frame[5] !== 0 ||
          frame[6] !== channelId(channel) ||
          frame[7] !== 0
        )
          throw transportError('transport/framing')
        const seq = frame.readBigUInt64BE(8),
          index = frame.readUInt32BE(16),
          count = frame.readUInt32BE(20)
        const total = frame.readUInt32BE(24),
          size = frame.readUInt32BE(28)
        if (
          seq !== sequence ||
          seq > MAX_SEQUENCE ||
          size < 1 ||
          frame.length !== 32 + size ||
          total < 1 ||
          total > maxLogicalMessageBytes ||
          count < 1 ||
          count > total ||
          index >= count ||
          count * (maxFrameBytes - 32) < total ||
          size > total
        )
          throw transportError('transport/framing')
        if (!partial) {
          if (index !== 0) throw transportError('transport/chunk-order')
          budget.reserve(total)
          partial = { total, count, next: 0, used: 0, buffer: Buffer.allocUnsafe(total) }
        }
        if (
          index !== partial.next ||
          total !== partial.total ||
          count !== partial.count ||
          partial.used + size > total ||
          count - index - 1 > total - partial.used - size
        )
          throw transportError('transport/chunk-order')
        frame.copy(partial.buffer, partial.used, 32)
        partial.used += size
        partial.next++
        clearTimeout(timer)
        if (partial.next === count) {
          if (partial.used !== total) throw transportError('transport/framing')
          const text = new TextDecoder('utf-8', { fatal: true }).decode(partial.buffer)
          JSON.parse(text)
          reset()
          sequence++
          return text
        }
        timer = setTimeout(() => {
          close()
          onFailure(transportError('transport/chunk-timeout'))
        }, idleTimeoutMs)
        return null
      } catch (error) {
        close()
        throw error.code?.startsWith('transport/') ? error : transportError('transport/framing')
      }
    },
  }
}
