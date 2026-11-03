import { isIP } from 'node:net'

export function isLocalHostname(hostname) {
  if (typeof hostname !== 'string') return false
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

// 保持客户端和网关一致：只增加 Tailscale 的 100.64.0.0/10，不扩大到整个 100/8。
export function isPrivateNetworkHostname(hostname) {
  if (typeof hostname !== 'string') return false
  let normalized = hostname.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  if (normalized.startsWith('::ffff:')) normalized = normalized.slice('::ffff:'.length)
  if (isLocalHostname(normalized) || normalized.endsWith('.local')) return true
  const octets = normalized.split('.').map((part) => Number(part))
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return octets[0] === 10 ||
      (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
  }
  return /^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(normalized)
}

// 连接来源必须是 socket 给出的 IP；域名和代理请求头均不作为来源凭证。
export function isAllowedMobileSource(address) {
  if (typeof address !== 'string') return false
  const normalized = address.replace(/^\[|\]$/g, '').split('%')[0]
  return isIP(normalized) !== 0 && isPrivateNetworkHostname(normalized)
}
