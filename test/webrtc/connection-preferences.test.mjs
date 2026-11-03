import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { startGateway } from './helpers.mjs'
import { connectMobileTestClient } from '../../bin/webrtc-client.mjs'
import { Config } from '../../lib/index.mjs'
import { normalizeTransportConfig } from '../../lib/transport-config.mjs'

const waitForRuntime = async gateway => {
  for (let i = 0; i < 100; i++) {
    const status = await gateway.request('status')
    if (status.webrtc.runtime !== 'loading') return status
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('RTC runtime load timed out')
}

test('first use defaults to LAN; saved route, STUN and endpoint survive restart without changing gateway identity', async () => {
  assert.equal(Config({}).webrtc.enabled, false)
  assert.equal(normalizeTransportConfig().enabled, false)
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-preferences-'))
  const stateFile = path.join(temp, 'gateway.json')
  let gateway
  try {
    gateway = await startGateway({}, { gatewayStateFile: stateFile })
    const initial = await waitForRuntime(gateway)
    assert.equal(initial.pairingRoute, 'lan')
    assert.equal(initial.webrtc.enabled, false)
    assert.equal(initial.webrtc.runtime, 'disabled')
    assert.deepEqual(initial.webrtc.stunServers, ['stun:stun.cloudflare.com:3478'])
    await gateway.request('connection', { route: 'p2p', stunServers: ['stun:stun.l.google.com:19302'], p2pUrl: gateway.url })
    const saved = await gateway.request('status')
    assert.deepEqual(saved.webrtc.stunServers, ['stun:stun.l.google.com:19302'])
    assert.equal(saved.p2pUrl, gateway.url)
    await gateway.request('connection', { route: 'cloudflare' })
    assert.equal((await gateway.request('status')).webrtc.enabled, false)
    await gateway.close()
    gateway = await startGateway({}, { gatewayStateFile: stateFile })
    const restored = await gateway.request('status')
    assert.equal(restored.gatewayId, initial.gatewayId)
    assert.equal(restored.pairingRoute, 'cloudflare')
    assert.equal(restored.webrtc.enabled, false)
    assert.equal(restored.webrtc.runtime, 'disabled')
    assert.deepEqual(restored.webrtc.stunServers, saved.webrtc.stunServers)
    assert.equal(restored.p2pUrl, saved.p2pUrl)
    await gateway.request('connection', { route: 'p2p', stunServers: [], p2pUrl: '' })
    const enabled = await waitForRuntime(gateway)
    assert.equal(enabled.webrtc.enabled, true)
    assert.equal(enabled.webrtc.runtime, 'available')
    assert.equal(enabled.p2pUrl, '')
    assert.deepEqual(enabled.webrtc.stunServers, ['stun:stun.cloudflare.com:3478'])
    await gateway.close()
    // 新默认值不能覆盖用户已经保存的 P2P 选择。
    gateway = await startGateway({}, { gatewayStateFile: stateFile })
    const restoredP2p = await waitForRuntime(gateway)
    assert.equal(restoredP2p.gatewayId, initial.gatewayId)
    assert.equal(restoredP2p.pairingRoute, 'p2p')
    assert.equal(restoredP2p.webrtc.enabled, true)
    assert.equal(restoredP2p.webrtc.runtime, 'available')
  } finally {
    await gateway?.close()
    await fs.rm(temp, { recursive: true, force: true })
  }
})

test('changing route preserves active RTC business and applies WebSocket/P2P choice to new connections', { timeout: 45000 }, async () => {
  const gateway = await startGateway()
  let active, next
  try {
    assert.equal((await gateway.request('status')).pairingRoute, 'p2p')
    active = await connectMobileTestClient(gateway)
    assert.equal(active.mode, 'webrtc')
    await gateway.request('connection', { route: 'cloudflare' })
    await active.send('control', { type: 'ping', requestId: 'existing-rtc' })
    await active.inbox.take(frame => frame.kind === 'pong' && frame.requestId === 'existing-rtc')
    assert.equal((await gateway.request('status')).webrtc.activeGroups, 1)
    next = await connectMobileTestClient(gateway)
    assert.equal(next.mode, 'websocket')
    await next.send('control', { type: 'ping', requestId: 'new-websocket' })
    await next.inbox.take(frame => frame.kind === 'pong' && frame.requestId === 'new-websocket')
    await next.close(); next = null
    await active.close(); active = null
    await gateway.request('connection', { route: 'p2p' })
    await waitForRuntime(gateway)
    next = await connectMobileTestClient(gateway)
    assert.equal(next.mode, 'webrtc')
  } finally {
    await next?.close()
    await active?.close()
    await gateway.close()
  }
})

test('connection preference validation and origin checks leave saved settings unchanged', async () => {
  const gateway = await startGateway({ enabled: false })
  const base = gateway.url.replace('ws:', 'http:').replace('/ws/mobile', '')
  try {
    for (const body of [{ route: 'bad' }, { route: 'p2p', enabled: false }, { route: 'p2p', stunServers: ['turn:relay.test'] },
      { route: 'p2p', stunServers: ['stun:stun.example.com:3478'] }, { route: 'p2p', p2pUrl: 123 }, { route: 'p2p', p2pUrl: 'file:///tmp/a' }]) {
      const response = await fetch(`${base}/mgw/connection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      assert.equal(response.status, 400, JSON.stringify(body))
    }
    const foreign = await fetch(`${base}/mgw/connection`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.invalid' }, body: JSON.stringify({ route: 'p2p' }) })
    assert.equal(foreign.status, 403)
    const status = await gateway.request('status')
    assert.equal(status.pairingRoute, 'lan')
    assert.equal(status.webrtc.enabled, false)
  } finally { await gateway.close() }
})


test('Tailscale choice and address persist, and public pairing cannot be substituted', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-tail-preferences-'))
  const stateFile = path.join(temp, 'gateway.json')
  let gateway
  try {
    gateway = await startGateway({ enabled: false }, { gatewayStateFile: stateFile, publicUrl: 'wss://gateway.example/ws/mobile' })
    const endpoint = 'ws://100.64.0.10:3081/ws/mobile'
    await gateway.request('connection', { route: 'tailscale', tailscaleUrl: endpoint })
    assert.equal((await gateway.request('status')).tailscaleUrl, endpoint)
    assert.equal((await gateway.request('status')).webrtc.enabled, false)
    for (const tailscaleUrl of ['wss://cloud.example/ws/mobile', 'ws://100.128.0.1:3081/ws/mobile', 'ws://192.168.1.1:3081/ws/mobile', 123]) {
      await assert.rejects(gateway.request('connection', { route: 'tailscale', tailscaleUrl }))
      assert.equal((await gateway.request('status')).tailscaleUrl, endpoint)
    }
    await assert.rejects(gateway.request('pair', { publicUrl: 'wss://old.trycloudflare.com/ws/mobile' }))
    const pairing = await gateway.request('pair', { publicUrl: endpoint })
    assert.equal(pairing.payload.publicUrl, endpoint)
    assert.deepEqual(pairing.payload.endpoints, [endpoint])
    await gateway.close()
    gateway = await startGateway({ enabled: false }, { gatewayStateFile: stateFile })
    const restored = await gateway.request('status')
    assert.equal(restored.pairingRoute, 'tailscale')
    assert.equal(restored.tailscaleUrl, endpoint)
    assert.ok(Array.isArray(restored.tailscale.addresses))
    assert.ok(Array.isArray(restored.tailscale.urls))
  } finally {
    await gateway?.close()
    await fs.rm(temp, { recursive: true, force: true })
  }
})
