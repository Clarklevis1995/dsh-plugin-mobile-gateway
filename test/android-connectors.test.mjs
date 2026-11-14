import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createDeviceTools } from '../lib/device-tools.mjs'
import { validateArguments, validateResult } from '../lib/device-tool-validation.mjs'
import { withMapLinks, withMusicLinks } from '../lib/phone-tools.mjs'
const require = createRequire(import.meta.url)
const { createRegistry } = require('../lib/devices.js')
const operationId = 'aaaa1111-2222-4333-8444-555555555555'
const library = () => ({ items: [{ id: 'library:android:songs:42', title: 'Test', artist: 'Artist', album: 'Album', artworkURL: 'content://media/external/audio/albumart/12', durationSeconds: 185 }], kind: 'songs', offset: 0, limit: 20, hasMore: false, nextOffset: null, pagingLimitReached: false, source: 'android-media-store', scope: 'device-shared-audio', downloadedOnly: true, status: 'ok' })

test('Android audio result has explicit local scope and cannot pass as Apple Music or an arbitrary content URI', () => {
  assert.equal(validateResult('music.library', library()), true)
  for (const patch of [{ source: 'apple-music-library' }, { scope: 'device-synced-personal-library' }, { downloadedOnly: false }, { kind: 'playlists' }]) assert.equal(validateResult('music.library', { ...library(), ...patch }), false)
  for (const artworkURL of ['content://contacts/people/1', 'content://media/external/audio/albumart/../42', 'https://private.test/cover.jpg']) {
    const value = library(); value.items[0].artworkURL = artworkURL
    assert.equal(validateResult('music.library', value), false)
  }
  const value = library(); value.items[0].url = 'https://music.apple.com/song/123'
  assert.equal(validateResult('music.library', value), false)
})

test('Android local music cards are generated only from validated resource IDs and bounded metadata', () => {
  const result = withMusicLinks('music.library', library())
  assert.equal(result.musicLinks[0].url, 'whaleness-music://local/songs/42')
  const metadata = JSON.parse(Buffer.from(new URL(result.musicLinks[0].cardURL).hash.split('=')[1], 'base64url'))
  assert.equal(metadata.title, 'Test'); assert.equal(metadata.artworkURL, 'content://media/external/audio/albumart/12')
  assert.equal(metadata.durationSeconds, 185)
  const invalid = library(); invalid.items[0].id = 'library:android:songs:../42'
  assert.equal(withMusicLinks('music.library', invalid).musicLinks, undefined)
})

test('Android geocoder results generate Android map links without changing iOS output', () => {
  const value = { source: 'android-geocoder', items: [{ name: 'Place', latitude: 31.2, longitude: 121.5, address: 'Address' }], truncated: false }
  assert.equal(validateResult('maps.geocode', value), true)
  const android = withMapLinks('maps.geocode', {}, value, 'android')
  assert.equal(new URL(android.mapLinks[0].url).hostname, 'www.google.com')
  assert.equal(new URL(android.mapLinks[0].url).searchParams.get('query'), '31.2,121.5')
  assert.equal(new URL(withMapLinks('maps.geocode', {}, { ...value, source: 'apple-maps' }).mapLinks[0].url).hostname, 'maps.apple.com')
  assert.equal(validateResult('maps.geocode', { ...value, source: 'random-provider' }), false)
})

test('Android clock handoff is distinct from successfully scheduling an iOS alarm', () => {
  const args = { operationId, title: 'Wake', fireDate: '2026-11-12T08:00:00+08:00', timeZone: 'Asia/Shanghai' }
  assert.equal(validateArguments('alarms.open-create', args), true)
  const result = { ...args, status: 'handoff-requested', requiresConfirmation: true }
  assert.equal(validateResult('alarms.open-create', result), true)
  const direct = { ...args, status: 'handoff-requested', skipUIRequested: true }
  assert.equal(validateResult('alarms.open-create', direct), true)
  assert.equal(validateResult('alarms.open-create', { ...direct, status: 'created' }), false)
  assert.equal(validateResult('alarms.open-create', { ...direct, requiresConfirmation: true }), false)
  assert.equal(validateResult('alarms.create', result), false)
  assert.equal(validateResult('alarms.open-create', { ...result, status: 'created' }), false)
  assert.equal(validateResult('alarms.open-create', { ...result, requiresConfirmation: false }), false)
  assert.equal(validateArguments('alarms.open-create', { ...args, skipUI: true }), false)
})

test('media-session state exposes player metadata, with no arbitrary extra fields', () => {
  const value = { source: 'android-media-session', playbackState: 1, playbackSeconds: 12, playerPackage: 'com.netease.cloudmusic', track: { title: 'Title', artist: 'Artist' } }
  assert.equal(validateResult('music.state', value), true)
  assert.equal(validateResult('music.state', { ...value, track: { ...value.track, privateToken: 'secret' } }), false)
  assert.equal(validateResult('music.state', { ...value, playbackSeconds: NaN }), false)
})

test('Android declares only implemented capabilities and keeps the same registration status contract', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-connectors-'))
  const registry = createRegistry(path.join(dir, 'devices.json'))
  const { device } = registry.claimPairing(registry.createPairing().code, 'android-installation', 'Android test')
  const broker = createDeviceTools({ registry })
  t.after(() => { broker.dispose(); fs.rmSync(dir, { recursive: true, force: true }) })
  const frames = []
  const client = { deviceId: device.id, generation: 1, readyState: 1, mobileChannel: 'control', sendFrame(frame) { frames.push(frame) } }
  broker.handle(client, { type: 'device-tools-register', version: 1, requestId: 'reg', platform: 'android', capabilityRevision: 1,
    modules: [{ id: 'music', enabled: true, available: true, tools: ['music.library'] }, { id: 'alarms', enabled: true, available: true, tools: ['alarms.open-create'] }], permissionChanges: { music: true, alarms: true } })
  const registration = frames.at(-1)
  assert.equal(broker.list()[0].platform, 'android')
  assert.deepEqual(registration.modules[1].tools, ['alarms.open-create'])
  broker.handle(client, { type: 'device-tools-status', version: 1, requestId: 'status' })
  assert.equal(frames.at(-1).connectionLeaseId, registration.connectionLeaseId)
  assert.equal(frames.at(-1).status, 'registered')
  await assert.rejects(broker.invoke({ deviceId: device.id, sessionId: 's', toolCallId: 'c' }, 'alarms.create', { operationId, title: 'Wake', fireDate: '2026-11-12T08:00:00+08:00', timeZone: 'Asia/Shanghai' }), /tool_unsupported/)
  const pending = broker.invoke({ deviceId: device.id, sessionId: 's', toolCallId: 'm' }, 'music.library', {})
  const call = frames.at(-1)
  broker.handle(client, { type: 'device-tool-result', version: 1, invocationId: call.invocationId, connectionLeaseId: registration.connectionLeaseId, status: 'success', result: library() })
  assert.deepEqual(await pending, library())
})

test('Android song search can return artwork and a card without inventing a cloud catalog match', () => {
  const result = { source: 'android-media-store', truncated: false, items: [{ ...library().items[0], id: '42' }] }
  assert.equal(validateResult('music.search', result), true)
  assert.equal(withMusicLinks('music.search', result).musicLinks[0].url, 'whaleness-music://local/songs/42')
  assert.equal(validateResult('music.search', { ...result, items: [{ ...result.items[0], url: 'https://music.apple.com/song/123' }] }), false)
})


test('neutral map cards preserve route intent and use the same schema on both platforms', () => {
  const args = { endLatitude: 31.2, endLongitude: 121.5, transport: 'walking' }
  const a = withMapLinks('maps.directions', args, { routes: [{}] }, 'android').mapLinks[0]
  const b = withMapLinks('maps.directions', args, { routes: [{}] }, 'ios').mapLinks[0]
  assert.equal(a.cardURL, b.cardURL)
  const url = new URL(a.cardURL)
  assert.equal(url.protocol, 'whaleness-map:')
  assert.equal(url.hostname, 'place')
  assert.equal(url.searchParams.get('v'), '1')
  assert.equal(url.searchParams.get('coordinateSystem'), 'wgs84')
  assert.equal(url.searchParams.get('mode'), 'directions')
  assert.equal(url.searchParams.get('transport'), 'walking')
  assert.equal(url.searchParams.get('latitude'), '31.2')
  assert.equal(a.destination.longitude, 121.5)
  const place = withMapLinks('maps.search', {}, { items: [{ name: 'A & B # 店', latitude: 0, longitude: -180 }] }).mapLinks[0]
  assert.equal(new URL(place.cardURL).searchParams.get('name'), 'A & B # 店')
  assert.equal(place.destination.mode, 'show')
})


test('Android map preparation validates ready results and preserves manual navigation cards', () => {
  for (const mode of ['show', 'directions']) for (const transport of ['driving', 'walking', 'transit']) {
    const args = { latitude: 38.01573, longitude: 114.473655, name: '石家庄站 & 入口', mode, ...(mode === 'directions' ? { transport } : {}) }
    const ready = { ...args, status: 'ready' }
    assert.equal(validateResult('maps.open', ready), true)
    const result = withMapLinks('maps.open', args, ready, 'android')
    assert.equal(result.status, 'ready')
    assert.equal(ready.mapLinks, undefined)
    const card = new URL(result.mapLinks[0].cardURL)
    assert.equal(card.protocol, 'whaleness-map:')
    assert.equal(card.searchParams.get('mode'), mode)
    assert.equal(card.searchParams.get('transport'), mode === 'directions' ? transport : 'driving')
    assert.equal(card.searchParams.get('name'), args.name)
    assert.equal(card.searchParams.get('latitude'), String(args.latitude))
    assert.equal(card.searchParams.get('longitude'), String(args.longitude))
    assert.equal(validateResult('maps.open', { ...ready, status: 'navigation-started' }), false)
    assert.equal(validateResult('maps.open', { ...ready, latitude: 91 }), false)
  }
  const legacy = { latitude: 31, longitude: 121, name: 'Old phone', mode: 'show', status: 'handoff-requested' }
  assert.equal(validateResult('maps.open', legacy), true)
  assert.deepEqual(withMapLinks('maps.open', {}, legacy), legacy)
})

test('Android maps.open broker result becomes a rendered card and instructs the agent to wait for a click', async t => {
  const { apply } = await import('../lib/phone-tools.mjs')
  const { BROKERS } = await import('../lib/device-tools.mjs')
  const { beginPhoneMessage } = await import('../lib/phone-request-sources.mjs')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'android-map-ready-'))
  const registry = createRegistry(path.join(dir, 'devices.json'))
  const { device } = registry.claimPairing(registry.createPairing().code, 'map-phone', 'Android map phone')
  const broker = createDeviceTools({ registry })
  const frames = []
  const client = { deviceId: device.id, generation: 1, readyState: 1, mobileChannel: 'control', sendFrame: frame => frames.push(frame) }
  broker.handle(client, { type: 'device-tools-register', version: 1, requestId: 'reg', platform: 'android', capabilityRevision: 1,
    modules: [{ id: 'location', enabled: true, available: true, tools: ['maps.open'] }], permissionChanges: { location: true } })
  const lease = frames.at(-1).connectionLeaseId
  const definitions = new Map(), listeners = new Map(), contexts = []
  apply({ on: (name, fn) => { listeners.set(name, fn); return () => {} }, systemPrompt: { context: value => contexts.push(value) },
    tools: { register: value => definitions.set(value.name, value) }, attachments: {} })
  globalThis[BROKERS] = new Map([['map-gateway', broker]])
  t.after(() => { broker.dispose(); delete globalThis[BROKERS]; fs.rmSync(dir, { recursive: true, force: true }) })
  const agent = { id: 'map-ready-session' }, message = { id: 'map-message', source: { kind: 'user', rpcId: 'map-rpc' } }
  const end = beginPhoneMessage(agent.id, 'map-rpc', { gatewayId: 'map-gateway', deviceId: device.id })
  listeners.get('agent/inbox/inserted')({ agent, message }); end()
  listeners.get('agent/inbox/claimed')({ agent, message, turn: 1 })
  assert.match(contexts[0].text({ agent }), /必须由用户点击卡片选择应用后才跳转/)
  const args = { latitude: 31.2, longitude: 121.5, name: 'Destination', mode: 'directions', transport: 'transit' }
  const tool = definitions.get('phone_maps_open')
  const pending = tool.execute(args, { agent, callId: 'prepare-map', signal: new AbortController().signal })
  const call = frames.at(-1)
  assert.equal(call.tool, 'maps.open')
  broker.handle(client, { type: 'device-tool-result', version: 1, invocationId: call.invocationId,
    connectionLeaseId: lease, status: 'success', result: { ...args, status: 'ready' } })
  const result = await pending
  assert.equal(result.status, 'ready')
  assert.equal(result.mapLinks[0].destination.transport, 'transit')
  assert.deepEqual(JSON.parse(tool.output.render({}, result)[0].text).mapLinks, result.mapLinks)
  assert.equal(frames.filter(frame => frame.tool === 'maps.open').length, 1)
})
