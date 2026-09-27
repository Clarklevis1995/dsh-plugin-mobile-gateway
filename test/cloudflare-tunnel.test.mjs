import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter, once } from 'node:events'
import { PassThrough } from 'node:stream'
import WebSocket from 'ws'
import { createCloudflareTunnel } from '../lib/cloudflare-tunnel.mjs'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cloudflare-test-'))
const file = path.join(temp, 'cloudflare.json')
const token = 'eyJ.test-token'
const children = []
const spawnProcess = (command, args, options) => {
  const child = new EventEmitter()
  child.stderr = new PassThrough()
  child.killed = false
  child.kill = () => { child.killed = true; child.emit('exit', 0, 'SIGTERM') }
  children.push({ command, args, options, child })
  queueMicrotask(() => {
    if (args.includes('--url')) child.stderr.write(`https://quick-${children.length}.trycloudflare.com\n`)
    child.stderr.write('Registered tunnel connection')
  })
  return child
}
const probe = net.createServer()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const port = probe.address().port
probe.close()
await once(probe, 'close')

let gatewayEnabled = true
let acceptedUpgrades = 0
const create = () => createCloudflareTunnel({
  file, port, wsPath: '/ws/mobile', supported: true, spawnProcess,
  prepareExecutable: async () => '/fake/cloudflared',
  isGatewayEnabled: () => gatewayEnabled,
  onUpgrade: (_req, socket, _head, transport) => {
    acceptedUpgrades += 1
    assert.equal(transport.lan, true)
    socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
  },
})
const tunnel = create()
assert.equal(tunnel.snapshot().state, 'disabled')
await assert.rejects(tunnel.configure({ enabled: true, hostname: 'bad/url', token }), /hostname/)
await assert.rejects(tunnel.configure({ enabled: true, mode: 'named', hostname: 'gateway.example.com' }), /Token/)
const active = await tunnel.configure({ enabled: true, mode: 'named', hostname: 'gateway.example.com', token })
assert.equal(active.publicUrl, 'wss://gateway.example.com/ws/mobile')
assert.equal(active.configured, true)
await new Promise((resolve) => setImmediate(resolve))
assert.equal(tunnel.snapshot().state, 'online')
assert.equal(children.length, 1)
assert.deepEqual(children[0].args, ['tunnel', '--no-autoupdate', '--loglevel', 'info', 'run'])
assert.equal(children[0].options.env.TUNNEL_TOKEN, token)
assert.equal(children[0].args.join(' ').includes(token), false)
assert.equal(fs.statSync(file).mode & 0o777, 0o600)
assert.equal(JSON.stringify(tunnel.snapshot()).includes(token), false)

const base = `http://127.0.0.1:${port}`
assert.equal((await fetch(`${base}/mgw/status`)).status, 404)
assert.equal((await fetch(`${base}/`)).status, 404)
const wrong = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/wrong`)
  ws.once('unexpected-response', (_request, response) => resolve(response.statusCode))
  ws.on('error', () => {})
})
assert.equal(wrong, 404)
const denied = await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/mobile`)
  ws.once('unexpected-response', (_request, response) => resolve(response.statusCode))
  ws.on('error', () => {})
})
assert.equal(denied, 401)
assert.equal(acceptedUpgrades, 1)

gatewayEnabled = false
await tunnel.reconcile()
assert.equal(children[0].child.killed, true)
assert.equal(tunnel.snapshot().state, 'waiting-for-gateway')
gatewayEnabled = true
await tunnel.reconcile()
assert.equal(children.length, 2)
await tunnel.configure({ enabled: false })
assert.equal(children[1].child.killed, true)
assert.equal(tunnel.snapshot().state, 'disabled')
await tunnel.configure({ enabled: true, mode: 'quick' })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(children.length, 3)
assert.equal(tunnel.snapshot().publicUrl, 'wss://quick-3.trycloudflare.com/ws/mobile')
assert.equal(children[2].args.includes('--url'), true)
assert.equal(children[2].options.env.TUNNEL_TOKEN, undefined)
tunnel.dispose()

const restored = create()
assert.equal(restored.snapshot().enabled, true)
await restored.reconcile()
await new Promise((resolve) => setImmediate(resolve))
assert.equal(children.length, 4)
assert.equal(restored.snapshot().mode, 'quick')
assert.equal(restored.snapshot().publicUrl, 'wss://quick-4.trycloudflare.com/ws/mobile')
restored.dispose()
fs.rmSync(temp, { recursive: true, force: true })
console.log('CLOUDFLARE TUNNEL TESTS PASSED')
