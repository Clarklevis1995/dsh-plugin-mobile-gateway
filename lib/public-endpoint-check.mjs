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
  } catch { return result('invalid-url', '公网入口必须是无凭证的 wss:// 地址。') }
  let timer
  try {
    await Promise.race([
      lookup(url.hostname),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'ETIMEDOUT' })), timeoutMs) }),
    ])
  } catch (error) {
    return result('dns-error', ['ENOTFOUND', 'ENODATA'].includes(error.code)
      ? '本机无法解析公网域名，不代表公共 DNS 记录一定不存在。请核对域名、DNS 缓存、网络代理及 Cloudflare 已代理的 CNAME 记录；若刚保存配置，请稍后重试。'
      : 'DNS 查询失败或超时，请检查本机网络和 DNS 后重试。', { code: error.code || 'DNS_ERROR' })
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
      deadline = setTimeout(() => { finish(result('network-error', '公网 TLS/WebSocket 检测超时；请检查网络、代理和 Cloudflare 源站配置。', { code: 'ETIMEDOUT' })); req.destroy() }, timeoutMs)
      req.on('response', (res) => {
        const status = res.statusCode
        finish(status === 401 && res.headers['x-dsh-gateway-probe'] === nonce ? result('reachable', '本机检测：TLS 校验通过，移动网关路由已确认且要求鉴权；不代表手机网络可达或会话同步成功。', { httpStatus: status })
          : result('route-error', `公网返回 HTTP ${status}，未确认移动网关路由。命名 Tunnel 的 Service 应为 HTTP，指向本机专用源站端口；同时检查 Cloudflare Access/安全规则。`, { httpStatus: status }))
        res.destroy()
      })
      req.on('upgrade', (res, socket) => {
        finish(result('auth-warning', '公网 WebSocket 未提供凭证即被接受，请检查设备鉴权设置。', { httpStatus: res.statusCode }))
        socket.destroy()
      })
      req.on('error', (error) => {
        const tlsError = /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code || '')
        finish(result(tlsError ? 'tls-error' : 'network-error', tlsError
          ? '公网 TLS 握手或证书校验失败；请检查域名证书、系统时间及网络代理，不要关闭证书校验。'
          : '公网连接失败；请检查 DNS、网络、代理及隧道源站配置。', { code: error.code || 'CONNECT_ERROR' }))
      })
      req.end()
    } catch { finish(result('network-error', '无法发起公网检测。')); req?.destroy() }
  })
}
