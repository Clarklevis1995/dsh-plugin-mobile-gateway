import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { checkPublicEndpoint } from '../lib/public-endpoint-check.mjs'
import { createCloudflareTunnel } from '../lib/cloudflare-tunnel.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { gatewayProbeHeader } from '../lib/gateway-probe.mjs'

test('probe header is bounded and rejects header injection', () => {
  const nonce = 'a'.repeat(32)
  assert.equal(gatewayProbeHeader(nonce), `X-DSH-Gateway-Probe: ${nonce}\r\n`)
  for (const value of [undefined, ['a'], nonce + '\r\nInjected: yes', 'a'.repeat(33), 'token']) assert.equal(gatewayProbeHeader(value), '')
})

const lookup = async () => ({ address: '192.0.2.1', family: 4 })
function mockRequest({ status = 401, error, upgrade = false, hang = false, echo = true } = {}) {
  return (options) => {
    assert.equal(options.rejectUnauthorized, true)
    assert.equal(options.headers.Authorization, undefined)
    const req = new EventEmitter()
    req.destroy = () => {}
    req.end = () => queueMicrotask(() => {
      if (hang) return
      if (error) return req.emit('error', Object.assign(new Error(), { code: error }))
      const res = new EventEmitter(); res.statusCode = status; res.headers = echo ? { 'x-dsh-gateway-probe': options.headers['X-DSH-Gateway-Probe'] } : {}; res.destroy = () => {}
      req.emit(upgrade ? 'upgrade' : 'response', res, { destroy() {} })
    })
    return req
  }
}
test('reject invalid URLs and credentials before network access', async () => {
  for (const url of ['http://example.com', 'wss://user:secret@example.com', 'wss://example.com/?token=x']) {
    assert.equal((await checkPublicEndpoint(url)).state, 'invalid-url')
  }
})
test('DNS failure is actionable', async () => {
  const r = await checkPublicEndpoint('wss://example.com/ws/mobile', { lookup: async () => { throw Object.assign(new Error(), { code: 'ENOTFOUND' }) } })
  assert.equal(r.state, 'dns-error'); assert.match(r.message, /CNAME/)
})
test('bounded DNS timeout', async () => {
  const r = await checkPublicEndpoint('wss://example.com', { lookup: () => new Promise(() => {}), timeoutMs: 10 })
  assert.equal(r.code, 'ETIMEDOUT')
})
test('verified TLS with gateway auth rejection means route reachable', async () => {
  const r = await checkPublicEndpoint('wss://example.com/ws/mobile', { lookup, request: mockRequest() })
  assert.equal(r.state, 'reachable'); assert.equal(r.httpStatus, 401)
})
test('distinguish route, certificate, transport and disabled auth failures', async () => {
  for (const [options, state] of [[{ status: 401, echo: false }, 'route-error'], [{ status: 502 }, 'route-error'], [{ status: 403 }, 'route-error'], [{ error: 'CERT_HAS_EXPIRED' }, 'tls-error'], [{ error: 'ECONNRESET' }, 'network-error'], [{ upgrade: true, status: 101 }, 'auth-warning'], [{ hang: true }, 'network-error']]) {
    assert.equal((await checkPublicEndpoint('wss://example.com/ws/mobile', { lookup, request: mockRequest(options), timeoutMs: 10 })).state, state)
  }
})
test('online tunnel checks once, supports retry and ignores stale results after stop', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-life-test-'))
  const file = path.join(dir, 'state.json')
  await fs.writeFile(file, JSON.stringify({ version: 1, enabled: true, mode: 'named', hostname: 'example.com', token: 'test-token' }))
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { child.killed = true }
  let finishProbe; let calls = 0
  const tunnel = createCloudflareTunnel({ file, port: 0, wsPath: '/ws/mobile', isGatewayEnabled: () => true, onUpgrade() {}, prepareExecutable: async () => 'mock', spawnProcess: () => child,
    probeEndpoint: () => { calls++; return new Promise((resolve) => { finishProbe = resolve }) } })
  await tunnel.reconcile()
  await new Promise((resolve) => setImmediate(resolve))
  child.stdout.emit('data', Buffer.from('Registered tunnel connection'))
  const first = tunnel.checkEndpoint()
  assert.equal(first, tunnel.checkEndpoint())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1); assert.equal(tunnel.snapshot().publicReady, false)
  finishProbe({ state: 'reachable', message: 'OK' }); await first
  assert.equal(tunnel.snapshot().publicReady, true)
  child.stdout.emit('data', Buffer.from('Registered tunnel connection'))
  assert.equal(calls, 1)
  const retry = tunnel.checkEndpoint()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 2)
  await tunnel.configure({ enabled: false })
  finishProbe({ state: 'reachable', message: 'stale' }); await retry
  assert.equal(tunnel.snapshot().publicReady, false); assert.equal(tunnel.snapshot().endpointHealth.state, 'unchecked')
  tunnel.dispose()
})

test('tunnel snapshot does not claim public readiness while disabled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-check-test-'))
  const tunnel = createCloudflareTunnel({ file: path.join(dir, 'state.json'), supported: false, isGatewayEnabled: () => false })
  assert.equal(tunnel.snapshot().publicReady, false)
  assert.equal((await tunnel.checkEndpoint()).endpointHealth.state, 'unchecked')
  tunnel.dispose()
  // Leave the empty test directory: no user files are removed.
})
