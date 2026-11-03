export const DEFAULT_STUN_SERVERS = Object.freeze(['stun:stun.cloudflare.com:3478'])

// 管理页的空值表示恢复自动发现；底层显式 [] 仍可用于仅 host candidate 的离线测试。
export function managedStunServers(value) {
  return value === undefined || (Array.isArray(value) && value.length === 0) ? [...DEFAULT_STUN_SERVERS] : value
}

export const TRANSPORT_CAPABILITY = 'webrtc-upgrade-v1'
export const RTC_CHANNELS = ['control', 'conversation']
export const RTC_LABELS = Object.freeze({
  control: 'dsh-mobile-control-v1',
  conversation: 'dsh-mobile-conversation-v1',
})
export const TRANSPORT_DEFAULTS = Object.freeze({
  enabled: false,
  mode: 'prefer-webrtc',
  stunServers: DEFAULT_STUN_SERVERS,
  negotiationTimeoutMs: 12000,
  rtcConnectTimeoutMs: 8000,
  bindTimeoutMs: 5000,
  maxFrameBytes: 16384,
  maxLogicalMessageBytes: 16777216,
  maxPendingNegotiations: 8,
  maxActiveGroups: 16,
})
export const RTC_LIMITS = Object.freeze({
  headerBytes: 32,
  maxSignalBytes: 65536,
  maxSdpBytes: 49152,
  maxCandidateBytes: 4096,
  maxCandidates: 256,
  maxBindBytes: 4096,
  highWaterBytes: 262144,
  lowWaterBytes: 65536,
  sendTimeoutMs: 30000,
  reassemblyTimeoutMs: 30000,
  reassemblyBudgetBytes: 33554432,
  queueBudgetBytes: 16777216,
  perDeviceGroups: 2,
})

export function transportError(code, security = true) {
  return Object.assign(new Error(code), { code, security })
}

export function normalizeTransportConfig(input = {}) {
  const result = { ...TRANSPORT_DEFAULTS, ...input }
  if (typeof result.enabled !== 'boolean' || !['prefer-webrtc', 'ws-only'].includes(result.mode))
    throw new TypeError('invalid webrtc mode')
  for (const [key, min, max] of [
    ['negotiationTimeoutMs', 100, 60000],
    ['rtcConnectTimeoutMs', 100, 60000],
    ['bindTimeoutMs', 100, 30000],
    ['maxFrameBytes', 1024, 16384],
    ['maxLogicalMessageBytes', 1024, 16777216],
    ['maxPendingNegotiations', 1, 32],
    ['maxActiveGroups', 1, 64],
  ])
    if (!Number.isSafeInteger(result[key]) || result[key] < min || result[key] > max)
      throw new TypeError(`invalid webrtc ${key}`)
  if (
    !Array.isArray(result.stunServers) ||
    result.stunServers.length > 8 ||
    result.stunServers.some(
      (url) =>
        typeof url !== 'string' ||
        !/^stun:[a-z\d.-]+(?::\d{1,5})?$/i.test(url) ||
        url.length > 256 ||
        /example\.(com|net|org)/i.test(url),
    )
  ) {
    throw new TypeError('webrtc stunServers must contain real STUN URLs; TURN is not supported')
  }
  result.stunServers = Object.freeze([...result.stunServers])
  return Object.freeze(result)
}

export function receiveLimits(value) {
  if (
    !value ||
    !Number.isSafeInteger(value.maxFrameBytes) ||
    value.maxFrameBytes < 1024 ||
    value.maxFrameBytes > 16384 ||
    !Number.isSafeInteger(value.maxLogicalMessageBytes) ||
    value.maxLogicalMessageBytes < 1024 ||
    value.maxLogicalMessageBytes > 16777216
  ) {
    throw transportError('transport/invalid-limits')
  }
  return { maxFrameBytes: value.maxFrameBytes, maxLogicalMessageBytes: value.maxLogicalMessageBytes }
}

// JSON.parse 会吞掉重复字段；信令与绑定必须在解析时拒绝这类歧义。
export function parseTransportJson(data, maxBytes = RTC_LIMITS.maxSignalBytes) {
  if (Buffer.byteLength(data) > maxBytes) throw transportError('transport/message-too-large')
  let source
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(data))
  } catch {
    throw transportError('transport/invalid-json')
  }
  let offset = 0
  const space = () => {
    while (/[\x20\t\r\n]/.test(source[offset] || '\0')) offset++
  }
  const string = () => {
    const start = offset++
    while (offset < source.length) {
      const char = source[offset++]
      if (char === '"') return JSON.parse(source.slice(start, offset))
      if (char === '\\') offset++
    }
    throw transportError('transport/invalid-json')
  }
  const value = (depth) => {
    if (depth > 64) throw transportError('transport/json-depth')
    space()
    if (source[offset] === '"') {
      string()
      return
    }
    if (source[offset] === '{') {
      offset++
      space()
      const keys = new Set()
      if (source[offset] === '}') {
        offset++
        return
      }
      for (;;) {
        space()
        if (source[offset] !== '"') throw transportError('transport/invalid-json')
        const key = string()
        if (keys.has(key)) throw transportError('transport/duplicate-field')
        keys.add(key)
        space()
        if (source[offset++] !== ':') throw transportError('transport/invalid-json')
        value(depth + 1)
        space()
        const next = source[offset++]
        if (next === '}') return
        if (next !== ',') throw transportError('transport/invalid-json')
      }
    }
    if (source[offset] === '[') {
      offset++
      space()
      if (source[offset] === ']') {
        offset++
        return
      }
      for (;;) {
        value(depth + 1)
        space()
        const next = source[offset++]
        if (next === ']') return
        if (next !== ',') throw transportError('transport/invalid-json')
      }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset))
    if (!match) throw transportError('transport/invalid-json')
    offset += match[0].length
  }
  try {
    value(0)
    space()
    if (offset !== source.length) throw transportError('transport/invalid-json')
    const result = JSON.parse(source)
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw transportError('transport/invalid-json')
    return result
  } catch (error) {
    throw error.code?.startsWith('transport/') ? error : transportError('transport/invalid-json')
  }
}
