import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const net = require('node:net')
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
  const portProbe = net.createServer()
  portProbe.listen(0, '127.0.0.1')
  await once(portProbe, 'listening')
  const cloudflarePort = portProbe.address().port
  portProbe.close()
  await once(portProbe, 'close')
  const fakeCloudflared = path.join(temp, 'fake-cloudflared')
  fs.writeFileSync(fakeCloudflared, '#!/usr/bin/env node\nif (process.argv.includes("--url")) process.stderr.write("https://sample-quick.trycloudflare.com\\n")\nprocess.stderr.write("Registered tunnel connection\\n")\nsetInterval(() => {}, 1000)\n', { mode: 0o700 })
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
    typertGateway: {
      async invoke() { throw new Error('unexpected Remote invocation') },
      async stream(request) {
        return (async function* () {
          if (request.namespace === 'workspace' && request.method === 'follow') {
            yield { type: 'baseline', value: { items: [], archivedSessionIds: [] } }
            while (!request.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 5))
          }
          if (request.namespace === 'session' && request.method === 'control') {
            yield { type: 'baseline', value: { projections: {} } }
            while (!request.signal.aborted) await new Promise((resolve) => setTimeout(resolve, 5))
          }
        })()
      },
    },
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
    cloudflarePort,
    cloudflaredPath: fakeCloudflared,
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
  assert.deepEqual(status.tools, { restartWeb: false, stopWeb: false })
  for (const action of ['restart-web', 'stop-web']) {
    const unavailable = await fetch(`${base}/mgw/tools/${action}`, {
      method: 'POST', headers: { Origin: base },
    })
    assert.equal(unavailable.status, 409)
    const rejected = await fetch(`${base}/mgw/tools/${action}`, {
      method: 'POST', headers: { Origin: 'https://other.example' },
    })
    assert.equal(rejected.status, 403)
  }
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
  assert.equal(pair.payload.gatewayId, status.gatewayId)
  assert.deepEqual(pair.payload.endpoints, [lanUrl])
  assert.deepEqual(status.endpoints, [lanUrl])

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
  assert.equal(paired.gatewayId, status.gatewayId)
  assert.equal(hello.gatewayId, status.gatewayId)

  // A token paired through LAN identifies the same gateway on the host listener.
  const main = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`, {
    headers: { Authorization: `Bearer ${paired.token}`, 'X-DSH-Device-ID': deviceId },
  })
  const mainHelloPromise = waitForMessage(main, 'hello')
  await once(main, 'open')
  assert.equal((await mainHelloPromise).gatewayId, hello.gatewayId)
  main.close()
  await once(main, 'close')

  if (process.platform === 'darwin' || process.platform === 'win32') {
    const configured = await fetch(`${base}/mgw/cloudflare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ enabled: true, mode: 'named', hostname: 'gateway.example.com', token: 'eyJ.test-token' }),
    })
    assert.equal(configured.status, 200)
    const tunnelStatus = await configured.json()
    assert.equal(tunnelStatus.publicUrl, 'wss://gateway.example.com/ws/mobile')
    assert.equal(tunnelStatus.gatewayMode, 'persistent')
    assert.equal(JSON.stringify(tunnelStatus).includes('eyJ.test-token'), false)
    const tunnelUrl = `ws://127.0.0.1:${cloudflarePort}/ws/mobile`
    assert.equal((await fetch(`http://127.0.0.1:${cloudflarePort}/mgw/status`)).status, 404)
    // The main listener's Debug switch is off, but the tunnel still requires a device.
    assert.equal(await expectRejected(tunnelUrl), 401)
    const tunnelClient = new WebSocket(tunnelUrl, {
      headers: { Authorization: `Bearer ${paired.token}`, 'X-DSH-Device-ID': deviceId },
    })
    const tunnelHello = waitForMessage(tunnelClient, 'hello')
    await once(tunnelClient, 'open')
    assert.equal((await tunnelHello).authenticated, true)
    tunnelClient.close()
    await once(tunnelClient, 'close')
    let connected = false
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const current = await (await fetch(`${base}/mgw/status`)).json()
      if (current.cloudflare.state === 'online') { connected = true; break }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(connected, true)
    const live = await (await fetch(`${base}/mgw/status`)).json()
    assert.equal(live.endpoints.includes('wss://gateway.example.com/ws/mobile'), true)
    assert.equal(live.cloudflare.enabled, true)
    assert.equal(JSON.stringify(live).includes('eyJ.test-token'), false)
    assert.equal(fs.statSync(`${path.join(temp, 'devices.json')}.cloudflare.json`).mode & 0o777, 0o600)
    const switched = await fetch(`${base}/mgw/cloudflare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ enabled: true, mode: 'quick' }),
    })
    assert.equal(switched.status, 200)
    let quickStatus
    for (let attempt = 0; attempt < 50; attempt += 1) {
      quickStatus = await (await fetch(`${base}/mgw/status`)).json()
      if (quickStatus.cloudflare.state === 'online') break
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(quickStatus.cloudflare.publicUrl, 'wss://sample-quick.trycloudflare.com/ws/mobile')
    assert.equal(quickStatus.publicUrl, quickStatus.cloudflare.publicUrl)
    assert.equal(quickStatus.endpoints.includes(quickStatus.cloudflare.publicUrl), true)
    const lanPairResponse = await fetch(`${base}/mgw/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ name: 'LAN preferred iPhone', publicUrl: lanUrl }),
    })
    assert.equal(lanPairResponse.status, 201)
    const lanPair = await lanPairResponse.json()
    assert.equal(lanPair.payload.publicUrl, lanUrl)
    assert.equal(lanPair.payload.endpoints[0], lanUrl)
    assert.equal(lanPair.payload.endpoints.includes(quickStatus.cloudflare.publicUrl), true)
    assert.equal(await expectRejected(tunnelUrl), 401)
    const disabled = await fetch(`${base}/mgw/cloudflare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ enabled: false }),
    })
    assert.equal(disabled.status, 200)
    assert.equal((await disabled.json()).enabled, false)
  }

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
