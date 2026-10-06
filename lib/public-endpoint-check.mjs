import dns from 'node:dns/promises'
import https from 'node:https'
import crypto from 'node:crypto'

// No credentials, redirects or certificate exceptions. A 401 alone is ambiguous:
// require the gateway to echo our random probe nonce in its auth rejection.
export async function checkPublicEndpoint(endpoint, { timeoutMs = 8000, lookup = dns.lookup, request = https.request } = {}) {
  const checkedAt = new Date().toISOString()
  const result = (state, message, extra = {}) => ({ state, message, checkedAt, ...extra })
  let url
  try {
    url = new URL(endpoint)
    if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) throw new Error()
  } catch { return result('invalid-url', 'The public entry must be a wss:// address without credentials.') }
  let timer
  try {
    await Promise.race([
      lookup(url.hostname),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'ETIMEDOUT' })), timeoutMs) }),
    ])
  } catch (error) {
    return result('dns-error', ['ENOTFOUND', 'ENODATA'].includes(error.code)
      ? 'This computer could not resolve the public domain; that does not mean the public DNS record is missing. Check the domain, DNS cache, network proxy, and the proxied Cloudflare CNAME record. If you just saved the configuration, try again shortly.'
      : 'DNS lookup failed or timed out; check the local network and DNS, then try again.', { code: error.code || 'DNS_ERROR' })
  } finally { clearTimeout(timer) }
  return new Promise((resolve) => {
    let done = false
    let deadline
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(deadline)
      resolve(value)
    }
    let req
    try {
      const key = crypto.randomBytes(16).toString('base64')
      const nonce = crypto.randomBytes(16).toString('hex')
      req = request({ hostname: url.hostname, port: url.port || 443, path: url.pathname || '/', method: 'GET', rejectUnauthorized: true,
        headers: { Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Protocol': 'dsh-mobile-v1', 'X-DSH-Gateway-Probe': nonce } })
      deadline = setTimeout(() => { finish(result('network-error', 'Public TLS/WebSocket check timed out; check the network, proxy, and Cloudflare origin configuration.', { code: 'ETIMEDOUT' })); req.destroy() }, timeoutMs)
      req.on('response', (res) => {
        const status = res.statusCode
        finish(status === 401 && res.headers['x-dsh-gateway-probe'] === nonce ? result('reachable', 'Local check: TLS verified, and the mobile gateway route is confirmed and requires authentication. This does not confirm that the phone can reach it or that sessions will sync.', { httpStatus: status })
          : result('route-error', `Public entry returned HTTP ${status}; mobile gateway route not confirmed. The named tunnel Service should be HTTP and point to the dedicated local origin port; also check Cloudflare Access and security rules.`, { httpStatus: status }))
        res.destroy()
      })
      req.on('upgrade', (res, socket) => {
        finish(result('auth-warning', 'The public WebSocket accepted a connection without credentials; check device auth settings.', { httpStatus: res.statusCode }))
        socket.destroy()
      })
      req.on('error', (error) => {
        const tlsError = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '')
        finish(result(tlsError ? 'tls-error' : 'network-error', tlsError
          ? 'Public TLS handshake or certificate verification failed; check the domain certificate, system clock, and network proxy. Do not turn off certificate verification.'
          : 'Public connection failed; check DNS, network, proxy, and tunnel origin configuration.', { code: error.code || 'CONNECT_ERROR' }))
      })
      req.end()
    } catch { finish(result('network-error', 'Could not start the public endpoint check.')); req?.destroy() }
  })
}
