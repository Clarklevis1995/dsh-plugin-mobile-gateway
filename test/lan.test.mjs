import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const WebSocket = require('ws')
const plugin = (await import('../lib/index.mjs')).default

function expectRejected(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    ws.once('open', () => reject(new Error('expected WebSocket rejection')))
    ws.once('unexpected-response', (_request, response) => resolve(response.statusCode))
    ws.once('error', () => {})
  })
}

function waitForMessage(ws, kind) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${kind}`)), 2000)
    const onMessage = (data) => {
      const frame = JSON.parse(data.toString())
      if (frame.kind !== kind) return
      clearTimeout(timer)
      ws.off('message', onMessage)
      resolve(frame)
    }
    ws.on('message', onMessage)
  })
}

async function waitForLanStatus(base) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await (await fetch(`${base}/mgw/status`)).json()
    if (status.lan && (status.lan.listening || status.lan.error)) return status
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('LAN listener did not become ready')
}

;(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-lan-'))
  let managementRoute
  let upgradeRoute
  let disposePlugin
  const server = http.createServer((req, res) => {
    if (managementRoute && (req.url === managementRoute.path || req.url.startsWith(`${managementRoute.path}/`))) {
      managementRoute.handler(req, res)
      return
    }
    res.writeHead(404).end()
  })
  const webServer = {
    port: 0,
    register(route) { managementRoute = route; return () => { managementRoute = undefined } },
    registerUpgrade(route) { upgradeRoute = route; return () => { upgradeRoute = undefined } },
  }
  server.on('upgrade', (req, socket, head) => {
    if (upgradeRoute) upgradeRoute.handler(req, socket, head)
    else socket.destroy()
  })
  const ctx = {
    webServer,
    apiProxy: {},
    typertGateway: {},
    agentDefaultModel: {},
    on() { return () => {} },
    effect(factory) { disposePlugin = factory() },
  }

  plugin.apply(ctx, {
    requireAuth: false,
    gatewayEnabled: true,
    gatewayWaitTimeoutMs: 60_000,
    adminLoopbackOnly: true,
    pairingTtlMs: 60_000,
    deviceFile: path.join(temp, 'devices.json'),
    publicUrlFile: path.join(temp, 'missing-public-url'),
    lanEnabled: true,
    lanHost: '127.0.0.1',
    lanPort: 0,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  webServer.port = server.address().port
  const base = `http://127.0.0.1:${webServer.port}`

  const status = await waitForLanStatus(base)
  assert.equal(status.lan.enabled, true)
  assert.equal(status.lan.listening, true)
  assert.equal(status.lan.requireAuth, true)
  assert.equal(status.lan.error, null)
  assert.equal(status.lan.urls.length, 1)
  const lanUrl = status.lan.urls[0]
  assert.equal(lanUrl, `ws://127.0.0.1:${status.lan.port}/ws/mobile`)

  // Main loopback listener follows the debug switch, but LAN never does.
  assert.equal(await expectRejected(lanUrl), 401)

  const lanHttp = await fetch(`http://127.0.0.1:${status.lan.port}/mgw/status`)
  assert.equal(lanHttp.status, 404)

  const pairResponse = await fetch(`${base}/mgw/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'LAN iPhone', publicUrl: lanUrl }),
  })
  assert.equal(pairResponse.status, 201)
  const pair = await pairResponse.json()
  assert.equal(pair.payload.publicUrl, lanUrl)

  const deviceId = '7bb30e78-4a31-4478-aae1-00a41d280637'
  const ws = new WebSocket(
    lanUrl,
    ['dsh-mobile-v1', `dsh-pair.${pair.payload.pairingCode}`],
    { headers: { 'X-DSH-Device-ID': deviceId } },
  )
  const pairedPromise = waitForMessage(ws, 'paired')
  const helloPromise = waitForMessage(ws, 'hello')
  await once(ws, 'open')
  const paired = await pairedPromise
  const hello = await helloPromise
  assert.equal(hello.authenticated, true)
  assert.equal(hello.port, status.lan.port)
  assert.equal(typeof paired.token, 'string')

  ws.close()
  await once(ws, 'close')
  disposePlugin()
  server.close()
  await once(server, 'close')
  fs.rmSync(temp, { recursive: true })
  console.log('LAN LISTENER TESTS PASSED')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
