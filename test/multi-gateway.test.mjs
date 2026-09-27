import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import WebSocket from 'ws'
import plugin, { Config } from '../lib/index.mjs'
import { createGatewayState } from '../lib/gateway-state.mjs'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-multi-gateway-'))
const instances = []
const installationId = 'multi-gateway-client-installation'
let checks = 0
function passed(label) { checks += 1; console.log(`PASS ${checks}: ${label}`) }

async function start(name, overrides = {}) {
  let management, upgrade, dispose
  const server = http.createServer((req, res) => management.handler(req, res))
  server.on('upgrade', (req, socket, head) => upgrade.handler(req, socket, head))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const config = {
    deviceFile: path.join(temp, `${name}-devices.json`),
    gatewayName: name,
    publicUrlFile: path.join(temp, 'no-public-url'),
    gatewayWaitTimeoutMs: 120,
    gatewayEnabled: true,
    ...overrides,
  }
  const ctx = {
    webServer: {
      port,
      register(route) { management = route; return () => {} },
      registerUpgrade(route) { upgrade = route; return () => {} },
    },
    typertGateway: {
      async invoke() { throw new Error('unexpected invoke') },
      async stream(req) {
        return (async function* () {
          yield { type: 'baseline', value: req.namespace === 'workspace'
            ? { items: [], archivedSessionIds: [] } : { projections: {} } }
          while (!req.signal.aborted) await delay(5)
        })()
      },
    },
    agentDefaultModel: {},
    on() { return () => {} },
    effect(factory) { dispose = factory() },
  }
  plugin.apply(ctx, config)
  const instance = {
    url: `ws://127.0.0.1:${port}/ws/mobile`,
    async request(route, body) {
      const response = await fetch(`http://127.0.0.1:${port}/mgw/${route}`, body === undefined ? {} : {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      return { status: response.status, data: await response.json() }
    },
    restart(changes = {}) { dispose(); Object.assign(config, changes); plugin.apply(ctx, config) },
    async close() { dispose(); await new Promise((resolve) => server.close(resolve)) },
  }
  instances.push(instance)
  return instance
}

async function connect(instance, { code, token, channel = 'control' } = {}) {
  const ws = new WebSocket(instance.url, ['dsh-mobile-v1', `${code ? 'dsh-pair' : 'dsh-auth'}.${code || token}`], {
    headers: { 'X-DSH-Device-ID': installationId, 'X-DSH-Channel': channel },
  })
  const frames = []
  const hello = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('hello timeout')) }, 2000)
    ws.on('error', (error) => { clearTimeout(timer); reject(error) })
    ws.on('message', (data) => {
      const frame = JSON.parse(data)
      frames.push(frame)
      if (frame.kind === 'hello') { clearTimeout(timer); resolve(frame) }
    })
  })
  return { ws, hello, paired: frames.find((frame) => frame.kind === 'paired') }
}
async function rejected(instance, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(instance.url, { headers: { Authorization: `Bearer ${token}`, 'X-DSH-Device-ID': installationId } })
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('rejection timeout')) }, 2000)
    ws.on('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('unexpected connection')) })
    ws.on('unexpected-response', (req, res) => { clearTimeout(timer); resolve(res.statusCode); res.destroy(); req.destroy() })
    ws.on('error', () => {})
  })
}
async function pair(instance, extra = {}) {
  const response = await instance.request('pair', { name: 'Phone', publicUrl: instance.url, ...extra })
  assert.equal(response.status, 201)
  return response.data
}

try {
  assert.equal(Config({ gatewayMode: 'persistent' }).gatewayMode, 'persistent')
  assert.throws(() => Config({ gatewayMode: 'invalid' }))
  const statePath = path.join(temp, 'unit-state.json')
  const state = createGatewayState(statePath)
  assert.equal(state.mode, null)
  state.setMode('persistent')
  const loaded = createGatewayState(statePath)
  assert.equal(loaded.gatewayId, state.gatewayId)
  assert.equal(loaded.mode, 'persistent')
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600)
  for (const invalid of ['{', JSON.stringify({ version: 1, gatewayId: state.gatewayId, mode: 'invalid' })]) {
    fs.writeFileSync(statePath, invalid)
    assert.throws(() => createGatewayState(statePath), /failed to load gateway state/)
    assert.equal(fs.readFileSync(statePath, 'utf8'), invalid)
  }
  passed('schema, atomic persisted identity/mode, private file, corruption fails closed')

  const a = await start('A', { endpoints: ['https://gateway.example/ws/mobile'] })
  const b = await start('B')
  let status = (await a.request('status')).data
  const id = status.gatewayId
  assert.equal(status.gatewayName, 'A')
  assert.equal(status.gatewayMode, 'persistent')
  assert.equal(status.waitExpiresAt, null)
  assert.notEqual(id, (await b.request('status')).data.gatewayId)
  await delay(180)
  assert.equal((await a.request('status')).data.gatewayEnabled, true)
  passed('legacy startup config is persistent; independent instances have distinct identities')

  for (const body of [{ mode: 'invalid' }, { mode: null }, null, [], {}, { mode: 'persistent', enabled: true }]) {
    assert.equal((await a.request('gateway', body)).status, 400)
  }
  assert.equal((await a.request('gateway', { mode: 'disabled' })).data.gatewayEnabled, false)
  assert.equal(await rejected(a, 'invalid'), 503)
  a.restart({ gatewayMode: 'persistent' })
  assert.equal((await a.request('status')).data.gatewayMode, 'disabled')
  assert.equal((await a.request('status')).data.gatewayId, id)
  passed('explicit disable survives restart and overrides startup config; invalid mode requests rejected')

  const temporary = await a.request('gateway', { enabled: true })
  assert.equal(temporary.data.gatewayMode, 'temporary')
  assert.equal(typeof temporary.data.waitExpiresAt, 'number')
  a.restart()
  assert.equal((await a.request('status')).data.gatewayMode, 'temporary')
  await delay(180)
  assert.equal((await a.request('status')).data.gatewayMode, 'disabled')
  a.restart()
  assert.equal((await a.request('status')).data.gatewayMode, 'disabled')
  passed('legacy management toggle, temporary restart timer and persisted automatic disable')

  await a.request('gateway', { mode: 'temporary' })
  await a.request('gateway', { mode: 'persistent' })
  await delay(180)
  assert.equal((await a.request('status')).data.gatewayMode, 'persistent')
  a.restart({ gatewayMode: 'disabled', gatewayName: 'A renamed' })
  status = (await a.request('status')).data
  assert.equal(status.gatewayMode, 'persistent')
  assert.equal(status.gatewayName, 'A renamed')
  assert.equal(status.gatewayId, id)
  passed('persistent selection cancels temporary timer and survives restart/name/config changes')

  for (const endpoints of [['wss://0.0.0.0/ws/mobile'], ['wss://[::]/ws/mobile'], ['ws://public.example/ws/mobile'],
    ['wss://user:secret@gateway.example/ws/mobile'], ['wss://gateway.example/ws/mobile?token=x'],
    ['wss://gateway.example/ws/mobile#x'], ['not-a-url'], [''], 'not-an-array', Array(17).fill(a.url)]) {
    assert.equal((await a.request('pair', { publicUrl: a.url, endpoints })).status, 400)
  }
  const pairing = await pair(a, { endpoints: [a.url, 'wss://alternate.example/ws/mobile'] })
  assert.equal(pairing.payload.version, 2)
  assert.equal(pairing.payload.gatewayId, id)
  assert.equal(pairing.payload.publicUrl, a.url)
  assert.deepEqual(pairing.payload.endpoints, [a.url, 'wss://alternate.example/ws/mobile', 'wss://gateway.example/ws/mobile'])
  assert.match(pairing.qrPayload, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(JSON.parse(Buffer.from(pairing.qrPayload, 'base64url')), pairing.payload)
  // Mirrors the old client contract: existing required fields still have their original types.
  for (const field of ['publicUrl', 'pairingCode']) assert.equal(typeof pairing.payload[field], 'string')
  assert.equal(typeof pairing.payload.expiresAt, 'number')
  passed('v2 QR extension, canonical endpoints, deduplication, URL validation and legacy fields')

  const control = await connect(a, { code: pairing.payload.pairingCode })
  const token = control.paired.token
  assert.equal(control.paired.gatewayId, id)
  assert.equal(control.hello.gatewayId, id)
  assert.equal(control.hello.gatewayName, 'A renamed')
  assert.equal(control.hello.protocol, 3)
  assert.equal(control.ws.protocol, 'dsh-mobile-v1')
  assert.equal(await rejected(a, pairing.payload.pairingCode), 401)
  const conversation = await connect(a, { token, channel: 'conversation' })
  assert.equal(conversation.hello.gatewayId, control.hello.gatewayId)
  assert.equal(conversation.paired, undefined)
  passed('paired/hello identity and authenticated split-channel identity agree')

  await a.request('gateway', { mode: 'temporary' })
  assert.equal((await a.request('status')).data.waitExpiresAt, null)
  const closed = once(control.ws, 'close')
  control.ws.close(); conversation.ws.close()
  await closed
  await delay(180)
  assert.equal((await a.request('status')).data.gatewayEnabled, true)
  const freshPairing = await pair(a)
  const fresh = await connect(a, { code: freshPairing.payload.pairingCode })
  assert.equal(await rejected(a, token), 401)
  assert.equal(fresh.paired.device.id, control.paired.device.id)
  passed('temporary mode with connected clients stays open after disconnect; re-pair rotates token')

  const pairingB = await pair(b)
  const controlB = await connect(b, { code: pairingB.payload.pairingCode })
  assert.equal(await rejected(b, fresh.paired.token), 401)
  assert.equal(await rejected(a, controlB.paired.token), 401)
  const revoked = once(fresh.ws, 'close')
  assert.equal((await a.request(`devices/${fresh.paired.device.id}/revoke`, {})).status, 200)
  assert.equal((await revoked)[0], 4003)
  assert.equal(await rejected(a, fresh.paired.token), 401)
  assert.equal(controlB.ws.readyState, WebSocket.OPEN)
  passed('same installation pairs independently; tokens and revocation isolated across gateways')

  const closedB = once(controlB.ws, 'close')
  await b.request('gateway', { mode: 'disabled' })
  assert.equal((await closedB)[0], 4004)
  passed('disabling gateway closes existing clients with 4004')

  const savePath = path.join(temp, 'A-devices.json.gateway.json')
  const original = fs.readFileSync(savePath)
  fs.unlinkSync(savePath)
  fs.mkdirSync(savePath)
  try {
    assert.equal((await a.request('gateway', { mode: 'persistent' })).status, 500)
    assert.equal((await a.request('status')).data.gatewayMode, 'temporary')
  } finally {
    fs.rmdirSync(savePath)
    fs.writeFileSync(savePath, original)
  }
  passed('failed persistence does not change live mode or return success')

  console.log(`multi-gateway: ${checks} checks passed`)
} finally {
  for (const instance of instances.reverse()) await instance.close()
  fs.rmSync(temp, { recursive: true, force: true })
}
