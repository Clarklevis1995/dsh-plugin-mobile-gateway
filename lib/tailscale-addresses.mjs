import os from 'node:os'
import { isIP } from 'node:net'

export function isTailscaleIp(value) {
  if (typeof value !== 'string') return false
  const address = value.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(address) === 4) {
    const parts = address.split('.').map(Number)
    return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
  }
  return isIP(address) === 6 && address.startsWith('fd7a:115c:a1e0:')
}

// Only inspect this gateway process's network namespace; never infer a phone IP.
// A detected interface address does not prove tailnet login or phone reachability.
export function tailscaleInterfaceStatus({ listening, host, port, wsPath }, interfaces = os.networkInterfaces()) {
  const addresses = []
  for (const [name, records] of Object.entries(interfaces)) {
    const entries = (records || []).filter(record => record && !record.internal)
    const knownInterface = /^(tailscale|utun|tun\d)/i.test(name) ||
      entries.some(record => isIP(record.address) === 6 && isTailscaleIp(record.address))
    if (!knownInterface) continue
    for (const record of entries) {
      if (isTailscaleIp(record.address) && !addresses.includes(record.address)) addresses.push(record.address)
    }
  }
  addresses.sort((a, b) => isIP(a) - isIP(b))
  const boundHost = (host || '').replace(/^\[|\]$/g, '')
  const urls = listening ? addresses.filter(address =>
    boundHost === '::' || boundHost === address || (boundHost === '0.0.0.0' && isIP(address) === 4))
    .map(address => `ws://${isIP(address) === 6 ? `[${address}]` : address}:${port}${wsPath}`) : []
  return { addresses, urls }
}
