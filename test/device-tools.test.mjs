import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { createDeviceTools, MODULES, BROKERS } from '../lib/device-tools.mjs'
import { validateArguments, validateResult, appleMusicURL, appleMusicArtworkURL } from '../lib/device-tool-validation.mjs'
import { apply, withMapLinks, withMusicLinks } from '../lib/phone-tools.mjs'
const require = createRequire(import.meta.url)
const { createRegistry } = require('../lib/devices.js')
const range = { start: '2026-11-10T00:00:00+08:00', end: '2026-11-11T00:00:00+08:00', timeZone: 'Asia/Shanghai' }
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-tools-'))
  const file = path.join(dir, 'devices.json'), registry = createRegistry(file)
  const { device, token } = registry.claimPairing(registry.createPairing().code, 'installation-1', 'Phone')
  const broker = createDeviceTools({ registry })
  t.after(() => { broker.dispose(); fs.rmSync(dir, { recursive: true, force: true }) })
  function client(generation = 1, deviceId = device.id) {
    return { deviceId, generation, readyState: 1, mobileChannel: 'control', frames: [], sendFrame(frame) { this.frames.push(frame) } }
  }
  function register(c, revision = 1, enabled = true) {
    broker.handle(c, { type: 'device-tools-register', version: 1, requestId: `reg-${revision}`, capabilityRevision: revision, modules: MODULES.map(id => ({ id, enabled, available: true })) })
    return c.frames.at(-1).connectionLeaseId
  }
  const context = { deviceId: device.id, sessionId: 'session-1', toolCallId: 'call-1' }
  function complete(c, result = { busyIntervals: [] }, lease = c.frames.at(-1).connectionLeaseId) {
    const call = c.frames.findLast(frame => frame.kind === 'device-tool-invoke')
    broker.handle(c, { type: 'device-tool-result', version: 1, invocationId: call.invocationId, connectionLeaseId: lease, status: 'success', result })
  }
  return { file, registry, device, token, broker, client, register, context, complete }
}
test('permissions default off, persist per device, exclude contacts and reset on re-pair', t => {
  const f = fixture(t)
  assert.deepEqual(Object.values(f.registry.list()[0].permissions), MODULES.map(() => false))
  f.registry.setPermissions(f.device.id, { calendar: true, health: true })
  assert.equal(createRegistry(f.file).list()[0].permissions.health, true)
  assert.throws(() => f.registry.setPermissions(f.device.id, { contacts: true }), TypeError)
  const another = f.registry.claimPairing(f.registry.createPairing().code, 'installation-2', 'Phone')
  assert.equal(another.device.permissions.calendar, false)
  f.registry.claimPairing(f.registry.createPairing().code, 'installation-1', 'Phone')
  assert.equal(f.registry.list().find(row => row.id === f.device.id).permissions.calendar, false)
  f.registry.revoke(f.device.id)
  assert.equal(createRegistry(f.file).list().length, 1)
})
test('requires paired control connection and both permission switches', async t => {
  const f = fixture(t), c = f.client()
  assert.throws(() => f.register(f.client(0, 'unknown')), /authentication/)
  assert.throws(() => f.register({ ...c, mobileChannel: 'conversation' }), /wrong-channel/)
  f.register(c)
  await assert.rejects(f.broker.invoke(f.context, 'calendar.busy', range), /tool_disabled/)
  f.registry.setPermissions(f.device.id, { calendar: true })
  f.register(c, 2, false)
  await assert.rejects(f.broker.invoke(f.context, 'calendar.busy', range), /tool_disabled/)
  f.register(c, 3)
  const promise = f.broker.invoke(f.context, 'calendar.busy', range)
  f.complete(c)
  assert.deepEqual(await promise, { busyIntervals: [] })
})
test('new leases reject stale results and old connection takeover, including after close', async t => {
  const f = fixture(t), c = f.client(), old = f.register(c)
  f.registry.setPermissions(f.device.id, { calendar: true })
  const pending = f.broker.invoke(f.context, 'calendar.busy', range)
  const rejected = assert.rejects(pending, /stale_lease/)
  const fresh = f.register(c, 2)
  assert.notEqual(old, fresh); await rejected
  const next = f.client(2); f.register(next)
  assert.throws(() => f.register(c, 3), /stale_lease/)
  f.broker.close(next)
  assert.throws(() => f.register(c, 4), /stale_lease/)
})
test('revocation and cancellation stop in-flight work immediately', async t => {
  const f = fixture(t), c = f.client(); f.register(c)
  f.registry.setPermissions(f.device.id, { calendar: true })
  const abort = new AbortController(), promise = f.broker.invoke({ ...f.context, signal: abort.signal }, 'calendar.busy', range)
  const rejected = assert.rejects(promise, /cancelled/); abort.abort(); await rejected
  assert.equal(c.frames.at(-1).kind, 'device-tool-cancel')
  const second = f.broker.invoke(f.context, 'calendar.busy', range), denied = assert.rejects(second, /tool_disabled/)
  f.registry.setPermissions(f.device.id, { calendar: false }); f.broker.changed(f.device.id); await denied
})
test('strict ranges, bounded images and fixed tool whitelist', async t => {
  const f = fixture(t), c = f.client(); f.register(c); f.registry.setPermissions(f.device.id, { photos: true })
  assert.equal(validateArguments('calendar.busy', { ...range, end: '2026-12-31T00:00:00Z' }), false)
  assert.equal(validateArguments('calendar.busy', { ...range, timeZone: 'not-a-zone' }), false)
  assert.equal(validateResult('calendar.busy', { busyIntervals: [], attachments: [{ attachmentId: 'forged' }] }), false)
  assert.equal(validateArguments('location.current', { requestedPrecision: 'precise' }), false)
  assert.equal(validateArguments('photos.select', { search: 'all' }), false)
  await assert.rejects(f.broker.invoke(f.context, 'contacts.list', {}), /invalid_request/)
  const promise = f.broker.invoke(f.context, 'photos.select', {}), rejected = assert.rejects(promise, /invalid_result/)
  f.complete(c, { images: [{ mediaType: 'image/jpeg', width: 3000, height: 3000, data: 'AA==' }] }); await rejected
})
test('Agent plugin carries real execution identity, renders durable images and disambiguates gateways', async t => {
  const definitions = new Map(), registered = { on: () => () => {}, systemPrompt: { context: () => () => {} }, tools: { register: value => definitions.set(value.name, value) }, attachments: { saveImages: async images => images.map(image => ({ attachmentId: 'stored-image', mediaType: image.mediaType, bytes: image.data.length, width: 1, height: 1 })) } }
  apply(registered)
  let received
  globalThis[BROKERS] = new Map([['g1', { list: () => [], invoke: async (context, tool, args) => { received = { context, tool, args }; return { busyIntervals: [] } } }]])
  t.after(() => { delete globalThis[BROKERS] })
  const exec = { agent: { id: 'actual-session' }, callId: 'actual-call', signal: new AbortController().signal }
  await definitions.get('phone_tool').execute({ deviceId: 'explicit-device', tool: 'calendar.busy', arguments: range }, exec)
  assert.equal(received.context.sessionId, exec.agent.id); assert.equal(received.context.toolCallId, exec.callId)
  assert.equal(received.context.deviceId, 'explicit-device'); assert.equal(received.context.signal, exec.signal)
  globalThis[BROKERS].set('g2', {})
  await assert.rejects(definitions.get('phone_devices').execute({}, exec), /gateway_selection_required/)
  const scoped = new Map(); apply({ ...registered, tools: { register: value => scoped.set(value.name, value) } }, { gatewayId: 'g1' })
  assert.deepEqual(await scoped.get('phone_devices').execute({}, exec), { devices: [] })
  globalThis[BROKERS].get('g1').invoke = async () => ({ images: [{ mediaType: 'image/jpeg', data: 'AA==' }] })
  const photoTool = scoped.get('phone_tool'), value = await photoTool.execute({ deviceId: 'explicit-device', tool: 'photos.select', arguments: {} }, exec)
  assert.equal(photoTool.output.render({ tool: 'photos.select' }, value)[1].attachment.attachmentId, 'stored-image')
  assert.equal(JSON.stringify(value).includes('AA=='), false)
})

test('phone permission changes persist only for its own device; reconnect never overrides host revocation', t => {
  const f = fixture(t), c = f.client()
  const other = f.registry.claimPairing(f.registry.createPairing().code, 'installation-other', 'Other phone')
  const update = (revision, permissionChanges) => f.broker.handle(c, { type: 'device-tools-register', version: 1,
    requestId: `sync-${revision}`, capabilityRevision: revision,
    modules: [{ id: 'photos', enabled: permissionChanges?.photos !== false, available: true }],
    ...(permissionChanges ? { permissionChanges } : {}) })
  update(1, { photos: true })
  assert.equal(c.frames.at(-1).permissionSync, true)
  assert.equal(c.frames.at(-1).permissions.photos, true)
  assert.equal(createRegistry(f.file).list().find(row => row.id === f.device.id).permissions.photos, true)
  assert.equal(f.registry.list().find(row => row.id === other.device.id).permissions.photos, false)
  f.registry.setPermissions(f.device.id, { photos: false }); f.broker.changed(f.device.id)
  update(2)
  assert.equal(c.frames.at(-1).permissions.photos, false)
  update(3, { photos: true })
  update(4, { photos: false })
  assert.equal(createRegistry(f.file).list().find(row => row.id === f.device.id).permissions.photos, false)
})
test('invalid and stale permission changes cannot grant access; failed saves never acknowledge success', t => {
  const f = fixture(t), old = f.client(), current = f.client(2)
  f.register(old); f.register(current)
  const message = { type: 'device-tools-register', version: 1, requestId: 'sync', capabilityRevision: 2,
    modules: [{ id: 'photos', enabled: true, available: true }], permissionChanges: { photos: true } }
  assert.throws(() => f.broker.handle(old, message), /stale_lease/)
  for (const changes of [{ contacts: true }, { photos: 'true' }, { photos: true, contacts: true }, [], null]) {
    assert.throws(() => f.broker.handle(current, { ...message, permissionChanges: changes }), /invalid_request/)
    assert.equal(f.registry.list()[0].permissions.photos, false)
  }
  for (const module of [{ id: 'photos', enabled: false, available: true }, { id: 'photos', enabled: true, available: false }]) {
    assert.throws(() => f.broker.handle(current, { ...message, modules: [module] }), /invalid_request/)
  }
  const save = f.registry.setPermissions
  f.registry.setPermissions = () => { throw new Error('disk error') }
  assert.throws(() => f.broker.handle(current, message), /permission_save_failed/)
  assert.equal(f.registry.list()[0].permissions.photos, false)
  f.registry.setPermissions = save
  f.broker.handle(current, message)
  assert.equal(current.frames.at(-1).permissions.photos, true)
  f.registry.setPermissions(f.device.id, { photos: false })
  assert.throws(() => f.broker.handle(current, message), /stale_revision/)
  assert.equal(f.registry.list()[0].permissions.photos, false)
})

test('authenticated message identity binds the active step, not the latest phone sending to the session', async t => {
  const { beginPhoneMessage, capturePhoneMessage, preparePhoneStep, phoneOrigin, clearPhoneTurn } = await import('../lib/phone-request-sources.mjs')
  const agent = { id: 'source-session' }
  const a = { gatewayId: 'gateway-a', deviceId: 'phone-a' }, b = { gatewayId: 'gateway-b', deviceId: 'phone-b' }
  const messageA = { id: 'message-a', source: { kind: 'user', rpcId: 'request-a', clientTimeZone: 'Asia/Shanghai' } }
  const messageB = { id: 'message-b', source: { kind: 'user', rpcId: 'request-b', clientTimeZone: 'Asia/Tokyo' } }
  const endA = beginPhoneMessage(agent.id, 'request-a', a), endB = beginPhoneMessage(agent.id, 'request-b', b)
  t.after(() => { endA(); endB(); clearPhoneTurn(agent) })
  assert.equal(capturePhoneMessage({ agent, message: messageA }), true)
  assert.equal(capturePhoneMessage({ agent, message: messageB }), true)
  endA(); endB()
  preparePhoneStep({ agent, turn: 1, step: 1, messages: [messageA] })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-a')
  preparePhoneStep({ agent, turn: 1, step: 2, messages: [] })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-a')
  preparePhoneStep({ agent, turn: 2, step: 1, messages: [messageB] })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-b')
  preparePhoneStep({ agent, turn: 3, step: 1, messages: [{ id: 'desktop-message', source: { kind: 'user', rpcId: 'desktop' } }] })
  assert.equal(phoneOrigin(agent), null)
})

test('RPC retries and conflicting admission cannot overwrite the already admitted message source', async t => {
  const { beginPhoneMessage, capturePhoneMessage, preparePhoneStep, phoneOrigin, clearPhoneTurn } = await import('../lib/phone-request-sources.mjs')
  const agent = { id: 'source-retry-session' }, message = { id: 'admitted-id', source: { kind: 'user', rpcId: 'same-request' } }
  const first = beginPhoneMessage(agent.id, 'same-request', { gatewayId: 'g1', deviceId: 'phone-a' })
  assert.throws(() => beginPhoneMessage(agent.id, 'same-request', { gatewayId: 'g1', deviceId: 'phone-b' }), /request_source_conflict/)
  capturePhoneMessage({ agent, message }); first()
  // 宿主已去重的请求不会再发 inbox/inserted，因此不能改写原消息身份。
  const retry = beginPhoneMessage(agent.id, 'same-request', { gatewayId: 'g1', deviceId: 'phone-b' }); retry()
  preparePhoneStep({ agent, turn: 1, step: 1, messages: [message] })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-a')
  clearPhoneTurn(agent)
})

test('mobile shortcuts route in one call to the authenticated source and never guess another online phone', async t => {
  const { beginPhoneMessage } = await import('../lib/phone-request-sources.mjs')
  const definitions = new Map(), listeners = new Map(), contexts = [], invocations = []
  apply({
    on: (name, fn) => { listeners.set(name, fn); return () => {} }, systemPrompt: { context: value => contexts.push(value) },
    tools: { register: value => definitions.set(value.name, value) }, attachments: {},
  })
  globalThis[BROKERS] = new Map([
    ['g1', { list: () => [{ id: 'phone-a', name: 'Source Phone', online: true, permissions: { reminders: true }, modules: { reminders: { enabled: true, available: true } } }], invoke: async (context, tool, args) => { invocations.push({ context, tool, args }); return { items: [] } } }],
    ['g2', { list: () => [{ id: 'phone-b', name: 'Other Phone', online: true, permissions: { reminders: true }, modules: { reminders: { enabled: true, available: true } } }], invoke: async () => { throw new Error('wrong gateway') } }],
  ])
  t.after(() => { delete globalThis[BROKERS] })
  const agent = { id: 'source-shortcut-session' }, exec = { agent, callId: 'call', signal: new AbortController().signal }
  const message = { id: 'shortcut-message', source: { kind: 'user', rpcId: 'request', clientTimeZone: 'Asia/Shanghai' } }
  const end = beginPhoneMessage(agent.id, 'request', { gatewayId: 'g1', deviceId: 'phone-a' })
  listeners.get('agent/inbox/inserted')({ agent, message }); end()
  listeners.get('agent/inbox/claimed')({ agent, message, turn: 1 })
  // The SDK assembles system context before pre-step, so the first model call must already see its source.
  assert.match(contexts[0].text({ agent }), /phone-a/)
  assert.match(contexts[0].text({ agent }), /phone_reminders_list/)
  await listeners.get('agent/pre-step')({ agent, turn: 1, step: 1, messages: [message], signal: exec.signal }, async () => ({ kind: 'enter', messages: [message] }))
  const { timeZone, ...dates } = range
  assert.deepEqual(await definitions.get('phone_reminders_list').execute(dates, exec), { items: [] })
  assert.equal(invocations.length, 1)
  assert.equal(invocations[0].context.deviceId, 'phone-a')
  assert.equal(invocations[0].args.timeZone, 'Asia/Shanghai')
  assert.equal(invocations[0].tool, 'reminders.list')
  assert.match(contexts[0].text({ agent }), /phone_reminders_list/)
  await assert.rejects(definitions.get('phone_tool').execute({ deviceId: 'phone-b', tool: 'reminders.list', arguments: range }, exec), /device_source_mismatch/)
  globalThis[BROKERS].get('g1').invoke = async context => { assert.equal(context.deviceId, 'phone-a'); throw Object.assign(new Error('device_offline'), { code: 'device_offline' }) }
  await assert.rejects(definitions.get('phone_reminders_list').execute(dates, exec), /device_offline/)
  listeners.get('agent/status')({ agent, status: 'idle' })
  await assert.rejects(definitions.get('phone_reminders_list').execute(dates, exec), /device_not_bound/)
})

test('an ambiguous input batch cannot silently choose one of its phones', async t => {
  const { beginPhoneMessage, capturePhoneMessage, preparePhoneStep, phoneOrigin, clearPhoneTurn } = await import('../lib/phone-request-sources.mjs')
  const agent = { id: 'ambiguous-source-session' }
  const messages = ['a', 'b'].map(id => ({ id: `message-${id}`, source: { kind: 'user', rpcId: `rpc-${id}` } }))
  for (const [index, message] of messages.entries()) {
    const end = beginPhoneMessage(agent.id, message.source.rpcId, { gatewayId: 'g1', deviceId: `phone-${index}` })
    capturePhoneMessage({ agent, message }); end()
  }
  preparePhoneStep({ agent, turn: 1, step: 1, messages })
  assert.equal(phoneOrigin(agent).kind, 'ambiguous')
  clearPhoneTurn(agent)
})

test('message admission uses trusted connection source without adding text markers or changing request IDs', async t => {
  const { admitMessage } = await import('../lib/index.mjs')
  const { capturePhoneMessage, preparePhoneStep, phoneOrigin, clearPhoneTurn } = await import('../lib/phone-request-sources.mjs')
  const agent = { id: 'trusted-admission-session' }
  let payload
  const api = { sessions: { prompt: async request => {
    payload = request
    const message = { id: 'host-generated-message', source: { kind: 'user', rpcId: request.requestId, clientTimeZone: request.clientTimeZone } }
    assert.equal(capturePhoneMessage({ agent, message }), true)
    preparePhoneStep({ agent, turn: 1, step: 1, messages: [message] })
    return { accepted: true }
  } } }
  const frame = await admitMessage(api, { type: 'message', sessionId: agent.id, requestId: 'original-client-request', text: '查看手机提醒事项',
    clientTimeZone: 'Asia/Shanghai', deviceId: 'forged-phone', source: { deviceId: 'forged-phone' } }, { gatewayId: 'actual-gateway', deviceId: 'actual-phone' })
  assert.equal(frame.kind, 'sent')
  assert.equal(frame.requestId, 'original-client-request')
  assert.equal(payload.requestId, 'original-client-request')
  assert.deepEqual(payload.content, [{ type: 'text', text: '查看手机提醒事项' }])
  assert.equal(phoneOrigin(agent).deviceId, 'actual-phone')
  assert.equal(phoneOrigin(agent).gatewayId, 'actual-gateway')
  assert.equal(capturePhoneMessage({ agent, message: { id: 'not-admitted', source: { rpcId: 'original-client-request' } } }), false)
  clearPhoneTurn(agent)
})


test('claimed sources are available before assembly and revalidated against actual step messages', async t => {
  const { beginPhoneMessage, capturePhoneMessage, claimPhoneMessage, preparePhoneStep, phoneOrigin, clearPhoneTurn } = await import('../lib/phone-request-sources.mjs')
  const agent = { id: 'pre-assembly-source-session' }
  const messages = ['a', 'b'].map(id => ({ id: `message-${id}`, source: { kind: 'user', rpcId: `request-${id}` } }))
  t.after(() => clearPhoneTurn(agent))
  for (const [index, message] of messages.entries()) {
    const end = beginPhoneMessage(agent.id, message.source.rpcId, { gatewayId: 'g1', deviceId: `phone-${index}` })
    capturePhoneMessage({ agent, message }); end()
  }
  claimPhoneMessage({ agent, message: messages[0], turn: 1 })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-0')
  // Reading the context must not consume the first claim or hide ambiguity when a second input joins it.
  claimPhoneMessage({ agent, message: messages[1], turn: 1 })
  assert.equal(phoneOrigin(agent).kind, 'ambiguous')
  // A downstream input policy can filter a batch before the model runs.
  preparePhoneStep({ agent, turn: 1, step: 1, messages: [messages[0]] })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-0')
  preparePhoneStep({ agent, turn: 1, step: 2, messages: [] })
  assert.equal(phoneOrigin(agent).deviceId, 'phone-0')
  const desktop = { id: 'desktop', source: { kind: 'user', rpcId: 'desktop-request' } }
  claimPhoneMessage({ agent, message: desktop, turn: 2 })
  assert.equal(phoneOrigin(agent), null)
  preparePhoneStep({ agent, turn: 2, step: 1, messages: [desktop] })
  assert.equal(phoneOrigin(agent), null)
})


test('write schemas reject ambiguous or unbounded input and validate durable creation receipts', () => {
  const operationId = '819e6e40-5008-4d8e-917e-31dbd0046a47'
  const reminder = { operationId, title: 'Buy milk', timeZone: 'Asia/Shanghai' }
  assert.equal(validateArguments('reminders.create', reminder), true)
  assert.equal(validateArguments('reminders.create', { ...reminder, dueDate: range.start, notify: true, priority: 1 }), true)
  for (const patch of [{ operationId: 'retry' }, { title: '' }, { title: 'x'.repeat(501) }, { priority: true }, { priority: 3 }, { notify: true }, { dueDate: 'tomorrow' }, { notes: 'x'.repeat(2001) }, { contacts: [] }]) {
    assert.equal(validateArguments('reminders.create', { ...reminder, ...patch }), false)
  }
  const event = { ...reminder, ...range, alertMinutesBefore: 15 }
  assert.equal(validateArguments('calendar.create', event), true)
  for (const patch of [{ end: range.start }, { end: '2027-11-10T00:00:00+08:00' }, { allDay: 1 }, { alertMinutesBefore: true }, { alertMinutesBefore: -1 }, { timeZone: 'invalid-zone' }]) {
    assert.equal(validateArguments('calendar.create', { ...event, ...patch }), false)
  }
  const receipt = { id: 'native-reminder', title: reminder.title, dueDate: null, timeZone: reminder.timeZone, notify: false, priority: 0, operationId, status: 'created' }
  assert.equal(validateResult('reminders.create', receipt), true)
  assert.equal(validateResult('reminders.create', { ...receipt, attachments: [] }), false)
  assert.equal(validateResult('reminders.create', { ...receipt, status: 'maybe' }), false)
  const alarm = { id: operationId, title: 'Wake up', fireDate: range.start, timeZone: range.timeZone, state: 'scheduled' }
  assert.equal(validateArguments('alarms.create', { ...reminder, fireDate: range.start }), true)
  assert.equal(validateArguments('alarms.cancel', { operationId, alarmId: operationId }), true)
  assert.equal(validateArguments('alarms.cancel', { operationId, alarmId: 'not-owned' }), false)
  assert.equal(validateResult('alarms.create', { ...alarm, operationId, status: 'created' }), true)
  assert.equal(validateResult('alarms.list', { items: [alarm], truncated: false, source: 'whaleness-host-alarms' }), true)
  assert.equal(validateResult('alarms.list', { items: [alarm], truncated: false, source: 'apple-clock' }), false)
})

test('new writes require explicit phone tool support; lost or revoked writes report unknown outcome', async t => {
  const f = fixture(t), c = f.client(), args = { operationId: '819e6e40-5008-4d8e-917e-31dbd0046a47', title: 'Buy milk', timeZone: 'Asia/Shanghai' }
  f.register(c); f.registry.setPermissions(f.device.id, { reminders: true })
  await assert.rejects(f.broker.invoke(f.context, 'reminders.create', args), /tool_unsupported/)
  const registration = { type: 'device-tools-register', version: 1, requestId: 'new-version', capabilityRevision: 2,
    modules: [{ id: 'reminders', enabled: true, available: true, tools: ['reminders.list', 'reminders.create'] }] }
  assert.throws(() => f.broker.handle(c, { ...registration, modules: [{ id: 'reminders', enabled: true, available: true, tools: ['calendar.create'] }] }), /invalid_request/)
  f.broker.handle(c, registration)
  const receipt = { id: 'native-reminder', title: args.title, dueDate: null, timeZone: args.timeZone, notify: false, priority: 0, operationId: args.operationId, status: 'created' }
  const created = f.broker.invoke(f.context, 'reminders.create', args)
  assert.equal(c.frames.at(-1).arguments.operationId, args.operationId)
  f.complete(c, receipt)
  assert.deepEqual(await created, receipt)
  const mismatch = f.broker.invoke(f.context, 'reminders.create', args), mismatchError = assert.rejects(mismatch, /outcome_unknown/)
  f.complete(c, { ...receipt, operationId: 'c6fed84a-a7ef-400f-bd3f-66e36ae845de' }); await mismatchError
  const lost = f.broker.invoke(f.context, 'reminders.create', args), lostError = assert.rejects(lost, /outcome_unknown/)
  f.broker.close(c); await lostError
  f.broker.handle(c, { ...registration, capabilityRevision: 3 })
  const revoked = f.broker.invoke(f.context, 'reminders.create', args), revokedError = assert.rejects(revoked, /outcome_unknown/)
  f.registry.setPermissions(f.device.id, { reminders: false }); f.broker.changed(f.device.id); await revokedError
})

test('write shortcuts bind the real source and timezone while old phones do not advertise writes', async t => {
  const { beginPhoneMessage, capturePhoneMessage, claimPhoneMessage, preparePhoneStep, clearPhoneTurn } = await import('../lib/phone-request-sources.mjs')
  const definitions = new Map(), contexts = [], calls = [], agent = { id: 'write-source' }, signal = new AbortController().signal
  apply({ on: () => () => {}, systemPrompt: { context: value => contexts.push(value) }, tools: { register: value => definitions.set(value.name, value) }, attachments: {} })
  const device = { id: 'source-phone', online: true, name: 'Source', permissions: { reminders: true }, modules: { reminders: { enabled: true, available: true } } }
  globalThis[BROKERS] = new Map([['source-gateway', { list: () => [device], invoke: async (context, tool, args) => { calls.push({ context, tool, args }); return { status: 'created' } } }]])
  t.after(() => { clearPhoneTurn(agent); delete globalThis[BROKERS] })
  const message = { id: 'source-write-message', source: { kind: 'user', rpcId: 'source-write-request', clientTimeZone: 'Asia/Shanghai' } }
  const end = beginPhoneMessage(agent.id, message.source.rpcId, { gatewayId: 'source-gateway', deviceId: 'source-phone' })
  capturePhoneMessage({ agent, message }); end(); claimPhoneMessage({ agent, message, turn: 1 })
  let context = JSON.parse(contexts[0].text({ agent }).split('\n').at(-1))
  assert.equal(context.shortcuts['reminders.create'], undefined)
  device.modules.reminders.tools = ['reminders.list', 'reminders.create']
  context = JSON.parse(contexts[0].text({ agent }).split('\n').at(-1))
  assert.equal(context.shortcuts['reminders.create'], 'phone_reminders_create')
  preparePhoneStep({ agent, messages: [message], turn: 1, step: 1 })
  const args = { operationId: '819e6e40-5008-4d8e-917e-31dbd0046a47', title: 'Buy milk' }
  await definitions.get('phone_reminders_create').execute(args, { agent, callId: 'write-call', signal })
  assert.equal(calls.length, 1); assert.equal(calls[0].context.deviceId, 'source-phone')
  assert.equal(calls[0].args.timeZone, 'Asia/Shanghai'); assert.equal(calls[0].args.operationId, args.operationId)
  assert.equal(calls[0].tool, 'reminders.create')
})


test('Apple Music browsing accepts no song-name query and validates bounded personal-library pages', () => {
  assert.equal(validateArguments('music.library', {}), true)
  assert.equal(validateArguments('music.library', { kind: 'playlists', offset: 20, limit: 50 }), true)
  for (const args of [{ kind: 'catalog' }, { limit: true }, { limit: 51 }, { offset: -1 }, { query: '' }, { query: 'x'.repeat(101) }]) assert.equal(validateArguments('music.library', args), false)
  const result = { items: [{ id: 'library:i.test', title: 'Song', artist: 'Artist', album: 'Album' }], kind: 'songs', offset: 0, limit: 20,
    hasMore: true, nextOffset: 1, pagingLimitReached: false, source: 'apple-music-library', scope: 'device-synced-personal-library', downloadedOnly: false, status: 'ok' }
  assert.equal(validateResult('music.library', result), true)
  assert.equal(validateResult('music.library', { ...result, source: 'catalog' }), false)
  assert.equal(validateResult('music.library', { ...result, nextOffset: 0 }), false)
  assert.equal(validateResult('music.library', { ...result, items: [{ id: 'library:i.test', title: 'Song', privateToken: 'forged' }] }), false)
  assert.equal(validateResult('music.library', { ...result, items: [], hasMore: false, nextOffset: null, status: 'empty-in-requested-scope' }), true)
  assert.equal(validateResult('music.library', { ...result, offset: 10000, nextOffset: null, pagingLimitReached: true }), true)
  assert.equal(validateArguments('music.play-library', { kind: 'songs', itemId: 'library:i.test' }), true)
  assert.equal(validateArguments('music.play-library', { kind: 'artists', itemId: 'library:i.test' }), false)
  assert.equal(validateArguments('music.play-library', { kind: 'songs', itemId: '123' }), false)
  assert.equal(validateArguments('music.play', { itemId: 'library:i.test' }), false)
})

test('Apple Music library tools require declared support and forward real query failures without returning empty songs', async t => {
  const f = fixture(t), c = f.client()
  f.register(c); f.registry.setPermissions(f.device.id, { music: true })
  await assert.rejects(f.broker.invoke(f.context, 'music.library', {}), /tool_unsupported/)
  f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'music-modern', capabilityRevision: 2,
    modules: [{ id: 'music', enabled: true, available: true, tools: ['music.library', 'music.play-library'] }] })
  const result = { items: [{ id: 'library:i.test', title: 'Song' }], kind: 'songs', offset: 0, limit: 20, hasMore: false, nextOffset: null,
    pagingLimitReached: false, source: 'apple-music-library', scope: 'device-synced-personal-library', downloadedOnly: false, status: 'ok' }
  const page = f.broker.invoke(f.context, 'music.library', {})
  assert.deepEqual(c.frames.at(-1).arguments, {})
  f.complete(c, result); assert.deepEqual(await page, result)
  const failure = f.broker.invoke(f.context, 'music.library', {}), rejected = assert.rejects(failure, /music_library_unavailable/)
  const call = c.frames.at(-1)
  f.broker.handle(c, { type: 'device-tool-result', version: 1, invocationId: call.invocationId, connectionLeaseId: call.connectionLeaseId, status: 'error', error: { code: 'music_library_unavailable' } })
  await rejected
  const playback = f.broker.invoke(f.context, 'music.play-library', { kind: 'songs', itemId: 'library:i.test' }), uncertain = assert.rejects(playback, /outcome_unknown/)
  f.broker.close(c); await uncertain
})


test('expanded maps validate precise coordinates, bounded search and honest navigation handoff', () => {
  assert.equal(validateArguments('location.precise', { maxAgeSeconds: 30 }), true)
  assert.equal(validateArguments('location.precise', { maxAgeSeconds: true }), false)
  const precise = { latitude: 31.234567, longitude: 121.456789, precision: 'precise', horizontalAccuracyMeters: 12, sampledAt: '2026-11-10T00:00:00Z' }
  assert.equal(validateResult('location.precise', precise), true)
  assert.equal(validateResult('location.current', precise), false)
  assert.equal(validateResult('location.precise', { ...precise, latitude: 91 }), false)
  assert.equal(validateArguments('maps.search', { query: 'coffee', latitude: 31, longitude: 121, radiusMeters: 1500 }), true)
  for (const args of [{ query: '' }, { query: 'coffee', latitude: 31 }, { query: 'coffee', radiusMeters: 5000 }, { query: 'coffee', limit: 21 }, { query: 'coffee', latitude: 91, longitude: 121 }]) assert.equal(validateArguments('maps.search', args), false)
  const places = { items: [{ name: 'Cafe', latitude: 31, longitude: 121, address: 'Street' }], truncated: false, source: 'apple-maps' }
  assert.equal(validateResult('maps.search', places), true)
  assert.equal(validateResult('maps.search', { ...places, items: [{ ...places.items[0], contacts: [] }] }), false)
  assert.equal(validateArguments('maps.geocode', { address: 'Shanghai', limit: 5 }), true)
  assert.equal(validateArguments('maps.reverse-geocode', { latitude: 31, longitude: 121 }), true)
  const route = { startLatitude: 31, startLongitude: 121, endLatitude: 31.1, endLongitude: 121.2 }
  assert.equal(validateArguments('maps.directions', { ...route, transport: 'walking' }), true)
  assert.equal(validateArguments('maps.directions', { ...route, transport: 'transit' }), false)
  assert.equal(validateResult('maps.directions', { routes: [{ name: 'Route', distanceMeters: 100, expectedTravelSeconds: 60, steps: [{ instruction: 'Walk straight', distanceMeters: 100 }], stepsTruncated: false }], transport: 'walking', truncated: false, estimatedAt: '2026-11-10T00:00:00Z', source: 'apple-maps' }), true)
  assert.equal(validateArguments('maps.open', { latitude: 31, longitude: 121, mode: 'directions', transport: 'transit' }), true)
  assert.equal(validateArguments('maps.open', { latitude: 31, longitude: 121, transport: 'walking' }), false)
  const handoff = { latitude: 31, longitude: 121, name: 'Destination', mode: 'show', status: 'handoff-requested' }
  assert.equal(validateResult('maps.open', handoff), true)
  assert.equal(validateResult('maps.open', { ...handoff, status: 'navigation-started' }), false)
})

test('maps use the existing location grant and reject legacy phones; revocation cancels pending map work', async t => {
  const f = fixture(t), c = f.client()
  f.register(c); f.registry.setPermissions(f.device.id, { location: true })
  await assert.rejects(f.broker.invoke(f.context, 'maps.search', { query: 'coffee' }), /tool_unsupported/)
  const register = revision => f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'map-support', capabilityRevision: revision,
    modules: [{ id: 'location', enabled: true, available: true, tools: ['location.current', 'location.precise', 'maps.search', 'maps.open'] }] })
  register(2)
  const result = { items: [{ name: 'Cafe', latitude: 31, longitude: 121, address: 'Street' }], truncated: false, source: 'apple-maps' }
  const search = f.broker.invoke(f.context, 'maps.search', { query: 'coffee' })
  f.complete(c, result); assert.deepEqual(await search, result)
  const pending = f.broker.invoke(f.context, 'maps.search', { query: 'coffee' }), rejected = assert.rejects(pending, /tool_disabled/)
  f.registry.setPermissions(f.device.id, { location: false }); f.broker.changed(f.device.id); await rejected
  f.registry.setPermissions(f.device.id, { location: true }); register(3)
  const handoff = f.broker.invoke(f.context, 'maps.open', { latitude: 31, longitude: 121 }), unknown = assert.rejects(handoff, /outcome_unknown/)
  f.broker.close(c); await unknown
})


test('saved marker schemas enforce named coordinates, explicit writes, pagination and revision guards', () => {
  const operationId = '819e6e40-5008-4d8e-917e-31dbd0046a47', markerId = '6be8c005-c76e-4fca-9f00-18cab3a1bb02'
  const args = { operationId, name: 'Parking', latitude: 31.234567, longitude: 121.456789, notes: 'B2' }
  assert.equal(validateArguments('maps.markers.create', args), true)
  for (const patch of [{ name: '' }, { name: 'bad\0name' }, { latitude: true }, { longitude: 181 }, { notes: 'x'.repeat(1001) }, { extra: 'bad' }]) assert.equal(validateArguments('maps.markers.create', { ...args, ...patch }), false)
  assert.equal(validateArguments('maps.markers.update', { operationId, markerId, name: 'New name', expectedRevision: 1 }), true)
  assert.equal(validateArguments('maps.markers.update', { operationId, markerId }), false)
  assert.equal(validateArguments('maps.markers.update', { operationId, markerId, latitude: 31 }), false)
  assert.equal(validateArguments('maps.markers.delete', { operationId, markerId }), true)
  assert.equal(validateArguments('maps.markers.list', { query: 'Parking', limit: 20 }), true)
  assert.equal(validateArguments('maps.markers.list', { limit: 21 }), false)
  const marker = { id: markerId, name: 'Parking', latitude: 31.234567, longitude: 121.456789, address: '', notes: 'B2', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }
  const receipt = { marker, operationId, status: 'created', replayed: false, source: 'whaleness-host-markers' }
  assert.equal(validateResult('maps.markers.create', receipt), true)
  assert.equal(validateResult('maps.markers.create', { ...receipt, marker: { ...marker, privateToken: 'forged' } }), false)
  const page = { items: [marker], total: 1, offset: 0, limit: 20, hasMore: false, nextOffset: null, source: 'whaleness-host-markers' }
  assert.equal(validateResult('maps.markers.list', page), true)
  assert.equal(validateResult('maps.markers.list', { ...page, total: 0 }), false)
  assert.equal(validateResult('maps.markers.delete', { markerId, operationId, status: 'deleted', existed: true, replayed: false, source: 'whaleness-host-markers' }), true)
})

test('markers are grouped under location grants and only supported phones receive save operations', async t => {
  const f = fixture(t), c = f.client(), operationId = '819e6e40-5008-4d8e-917e-31dbd0046a47'
  const args = { operationId, name: 'Parking', latitude: 31, longitude: 121 }
  f.register(c); f.registry.setPermissions(f.device.id, { location: true })
  await assert.rejects(f.broker.invoke(f.context, 'maps.markers.create', args), /tool_unsupported/)
  f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'markers', capabilityRevision: 2,
    modules: [{ id: 'location', enabled: true, available: true, tools: ['maps.markers.create', 'maps.markers.list', 'maps.markers.update', 'maps.markers.delete'] }] })
  const page = f.broker.invoke(f.context, 'maps.markers.list', {})
  f.complete(c, { items: [], total: 0, offset: 0, limit: 20, hasMore: false, nextOffset: null, source: 'whaleness-host-markers' })
  assert.equal((await page).total, 0)
  const save = f.broker.invoke(f.context, 'maps.markers.create', args), uncertain = assert.rejects(save, /outcome_unknown/)
  assert.equal(c.frames.at(-1).arguments.operationId, operationId)
  f.registry.setPermissions(f.device.id, { location: false }); f.broker.changed(f.device.id); await uncertain
})


test('map app cards use returned coordinates and encoded names without triggering a handoff', async t => {
  const place = { name: '咖啡 & Tea #1', latitude: 31.234567, longitude: 121.456789, address: '测试地址' }
  const original = { items: [place], source: 'apple-maps', truncated: false }
  const definitions = new Map()
  apply({ on: () => () => {}, systemPrompt: { context() {} }, tools: { register: definition => definitions.set(definition.name, definition) }, attachments: {} })
  const calls = []
  globalThis[BROKERS] = new Map([['test-cards', { list: () => [], invoke: async (_, tool) => { calls.push(tool); return original } }]])
  t.after(() => { delete globalThis[BROKERS] })
  const tool = definitions.get('phone_maps_search')
  const result = await tool.execute({ deviceId: 'phone', query: '咖啡' }, { agent: { id: 'card-session' }, callId: 'card-call', signal: new AbortController().signal })
  assert.deepEqual(calls, ['maps.search'])
  assert.equal(original.mapLinks, undefined)
  assert.deepEqual(result.items, original.items)
  const link = new URL(result.mapLinks[0].url)
  assert.equal(link.origin, 'https://maps.apple.com')
  assert.equal(link.searchParams.get('ll'), '31.234567,121.456789')
  assert.equal(link.searchParams.get('q'), place.name)
  assert.equal(result.mapLinks[0].address, place.address)
  assert.deepEqual(JSON.parse(tool.output.render({}, result)[0].text).mapLinks, result.mapLinks)
  assert.equal(withMapLinks('maps.search', {}, { items: [] }).mapLinks, undefined)
  assert.equal(withMapLinks('maps.search', {}, { items: [{ latitude: 91, longitude: 2 }, { latitude: true, longitude: 2 }] }).mapLinks, undefined)
  assert.equal(withMapLinks('location.current', {}, place), place)
  const route = withMapLinks('maps.directions', { endLatitude: 0, endLongitude: -180, transport: 'walking' }, { routes: [{}] })
  assert.equal(new URL(route.mapLinks[0].url).searchParams.get('daddr'), '0,-180')
  assert.equal(new URL(route.mapLinks[0].url).searchParams.get('dirflg'), 'w')
  assert.equal(withMapLinks('maps.directions', {}, { routes: [] }).mapLinks, undefined)
})


test('new phone tools do not discard supported connectors; unknown tools never become callable', async t => {
  const f = fixture(t), c = f.client()
  f.registry.connected(f.device.id)
  f.registry.setPermissions(f.device.id, { music: true, location: true })
  f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'future-phone', capabilityRevision: 1,
    modules: [{ id: 'music', enabled: true, available: true, tools: ['music.state', 'music.future-library'] },
      { id: 'location', enabled: true, available: true, tools: ['maps.search', 'maps.future-feature'] }] })
  const registered = f.broker.list().find(d => d.id === f.device.id)
  assert.equal(registered.connectorStatus, 'ready')
  assert.deepEqual(registered.modules.music.tools, ['music.state'])
  assert.deepEqual(registered.modules.location.tools, ['maps.search'])
  const search = f.broker.invoke(f.context, 'maps.search', { query: 'Cafe' })
  const expected = { items: [], truncated: false, source: 'apple-maps' }
  f.complete(c, expected); assert.deepEqual(await search, expected)
  await assert.rejects(f.broker.invoke(f.context, 'music.future-library', {}), /invalid_request/)
  for (const tools of [['contacts.read'], ['music.state', 'music.state'], [null], ['music.state ']]) {
    assert.throws(() => f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'bad', capabilityRevision: 2,
      modules: [{ id: 'music', enabled: true, available: true, tools }] }), /invalid_request/)
    assert.equal(f.broker.list()[0].connectorStatus, 'ready', 'bad registration must not erase an existing lease')
  }
})

test('online phone without a connector lease is not offline and conversation closure cannot erase its lease', async t => {
  const f = fixture(t), c = f.client(), conversation = f.client(2)
  f.registry.connected(f.device.id)
  f.registry.setPermissions(f.device.id, { calendar: true })
  assert.equal(f.broker.list()[0].online, true)
  assert.equal(f.broker.list()[0].connectorStatus, 'not-registered')
  await assert.rejects(f.broker.invoke(f.context, 'calendar.busy', range), /connector_not_ready/)
  f.register(c)
  assert.equal(f.broker.list()[0].connectorStatus, 'ready')
  f.broker.close(conversation)
  assert.equal(f.broker.list()[0].connectorStatus, 'ready')
  f.broker.close(c)
  assert.equal(f.broker.list()[0].connectorStatus, 'not-registered')
  assert.deepEqual(f.broker.list()[0].modules, {})
  assert.equal(f.broker.list()[0].permissions.calendar, true)
  f.registry.disconnected(f.device.id)
  assert.equal(f.broker.list()[0].connectorStatus, 'offline')
  await assert.rejects(f.broker.invoke(f.context, 'calendar.busy', range), /device_offline/)
})


test('phone receives only accepted registrations and status reads preserve its lease and grants', async t => {
  const f = fixture(t), c = f.client()
  f.registry.connected(f.device.id)
  f.registry.setPermissions(f.device.id, { music: true })
  const read = (client, requestId) => {
    f.broker.handle(client, { type: 'device-tools-status', version: 1, requestId })
    return client.frames.at(-1)
  }
  assert.equal(read(c, 'before').status, 'not-registered')
  f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'registration', capabilityRevision: 1,
    modules: [{ id: 'music', enabled: true, available: true, tools: ['music.library', 'music.future'] }] })
  const ack = c.frames.at(-1)
  assert.equal(ack.statusQuery, true)
  assert.deepEqual(ack.modules, [{ id: 'music', enabled: true, available: true, tools: ['music.library'] }])
  const identity = ack.connectionLeaseId
  const response = read(c, 'fresh')
  assert.equal(response.requestId, 'fresh')
  assert.equal(response.status, 'registered')
  assert.equal(response.connectionLeaseId, identity)
  assert.equal(response.capabilityRevision, 1)
  assert.equal(response.permissions.music, true)
  assert.deepEqual(response.modules, ack.modules)
  f.registry.setPermissions(f.device.id, { music: false })
  assert.equal(read(c, 'revoked').permissions.music, false)
  assert.equal(f.registry.list()[0].permissions.music, false, 'status reads cannot restore a permission')
  assert.throws(() => f.broker.handle(c, { type: 'device-tools-status', version: 1, requestId: '' }), /invalid_request/)
  const other = f.client(2)
  assert.equal(read(other, 'different-control').status, 'not-registered')
  assert.equal(other.frames.at(-1).connectionLeaseId, undefined)
  assert.equal(read(c, 'still-current').connectionLeaseId, identity)
  const conversation = { ...f.client(), mobileChannel: 'conversation' }
  assert.throws(() => read(conversation, 'wrong-channel'), /wrong-channel/)
  f.broker.close(c)
  assert.equal(read(c, 'closed').status, 'not-registered')
})

test('status inspection never cancels an in-flight connector call', async t => {
  const f = fixture(t), c = f.client()
  f.registry.setPermissions(f.device.id, { calendar: true })
  const lease = f.register(c)
  const call = f.broker.invoke(f.context, 'calendar.busy', range)
  f.broker.handle(c, { type: 'device-tools-status', version: 1, requestId: 'during-call' })
  assert.equal(c.frames.at(-1).connectionLeaseId, lease)
  assert.equal(c.frames.some(frame => frame.kind === 'device-tool-cancel'), false)
  const result = { busyIntervals: [] }
  f.complete(c, result, lease)
  assert.deepEqual(await call, result)
})


test('music cards keep official content URLs and never turn local IDs into catalog links', () => {
  const url = 'https://music.apple.com/cn/album/test/123?i=456&at=tracking'
  assert.equal(appleMusicURL(url), 'https://music.apple.com/cn/album/test/123?i=456')
  const rows = [{ id: 'library:i.local', title: 'Local song', artist: 'Singer' }, { id: 'library:i.shared', title: 'Song', artist: 'Singer', url }]
  const original = { items: rows }
  const result = withMusicLinks('music.library', original)
  assert.equal(result.musicLinks.length, 1)
  assert.equal(result.musicLinks[0].url, 'https://music.apple.com/cn/album/test/123?i=456')
  assert.equal(original.musicLinks, undefined)
  assert.equal(withMusicLinks('music.library', { items: [rows[0]] }).musicLinks, undefined)
  for (const url of ['https://music.apple.com.evil.test/song/123', 'https://user@music.apple.com/song/123', 'http://music.apple.com/song/123', 'https://music.apple.com/song/library:i.local', 'https://music.apple.com/song/123?i=1&i=2']) assert.equal(appleMusicURL(url), null)
  assert.equal(validateArguments('music.catalog-search', { query: 'Song', limit: 20 }), true)
  for (const args of [{ query: '' }, { query: 'Song', limit: true }, { query: 'Song', limit: 21 }, { query: 'Song', play: true }]) assert.equal(validateArguments('music.catalog-search', args), false)
  const catalog = { items: [{ id: 'catalog:123', title: 'Song', artist: 'Singer', url }], source: 'apple-music-catalog' }
  assert.equal(validateResult('music.catalog-search', catalog), true)
  assert.equal(validateResult('music.catalog-search', { ...catalog, items: [{ ...catalog.items[0], id: 'library:i.local' }] }), false)
  assert.equal(validateResult('music.catalog-search', { ...catalog, items: [{ ...catalog.items[0], url: 'https://evil.test' }] }), false)
})

test('catalog search is declared explicitly and music card generation performs no playback', async t => {
  const definitions = new Map()
  apply({ on: () => () => {}, systemPrompt: { context() {} }, tools: { register: value => definitions.set(value.name, value) }, attachments: {} })
  const calls = []
  const value = { items: [{ id: 'catalog:123', title: 'Song', url: 'https://music.apple.com/song/123' }], source: 'apple-music-catalog' }
  globalThis[BROKERS] = new Map([['music-cards', { list: () => [], invoke: async (_, tool, args) => { calls.push({ tool, args }); return value } }]])
  t.after(() => { delete globalThis[BROKERS] })
  const tool = definitions.get('phone_music_catalog_search')
  const result = await tool.execute({ deviceId: 'phone', query: 'Song' }, { agent: { id: 'music-card-session' }, callId: 'call', signal: new AbortController().signal })
  assert.deepEqual(calls, [{ tool: 'music.catalog-search', args: { query: 'Song' } }])
  assert.equal(result.musicLinks[0].url, value.items[0].url)
  assert.deepEqual(JSON.parse(tool.output.render({}, result)[0].text).musicLinks, result.musicLinks)
  const f = fixture(t), c = f.client()
  f.registry.setPermissions(f.device.id, { music: true }); f.register(c)
  await assert.rejects(f.broker.invoke(f.context, 'music.catalog-search', { query: 'Song' }), /tool_unsupported/)
  f.broker.handle(c, { type: 'device-tools-register', version: 1, requestId: 'catalog-enabled', capabilityRevision: 2,
    modules: [{ id: 'music', enabled: true, available: true, tools: ['music.catalog-search'] }] })
  const pending = f.broker.invoke(f.context, 'music.catalog-search', { query: 'Song' })
  f.complete(c, value)
  assert.deepEqual(await pending, value)
})


test('music artwork and metadata are validated and survive serialized card links', () => {
  const artworkURL = 'https://is1-ssl.mzstatic.com/image/thumb/Music/test/300x300bb.jpg'
  const row = { id: 'catalog:123', title: '真实歌名', artist: '歌手', album: '专辑', durationSeconds: 245, artworkURL, url: 'https://music.apple.com/cn/album/test/123?i=456' }
  const response = { items: [row], source: 'apple-music-catalog' }
  assert.equal(validateResult('music.catalog-search', response), true)
  const result = withMusicLinks('music.catalog-search', response)
  const { cardURL, url, ...details } = result.musicLinks[0]
  const parsed = new URL(cardURL)
  assert.equal(parsed.searchParams.get('i'), '456')
  const metadata = JSON.parse(Buffer.from(parsed.hash.slice('#dsh-music-card='.length), 'base64url'))
  assert.deepEqual(metadata, { v: 1, title: row.title, artist: row.artist, album: row.album, durationSeconds: 245, artworkURL })
  assert.equal(details.artworkURL, artworkURL)
  assert.equal(details.durationSeconds, 245)
  assert.equal(url, row.url)
  assert.equal(response.items[0].cardURL, undefined)
  for (const invalid of [{ artworkURL: 'https://evil.test/cover.jpg' }, { artworkURL: 'file:///cover.jpg' }, { durationSeconds: true }, { durationSeconds: -1 }, { durationSeconds: Infinity }]) {
    assert.equal(validateResult('music.catalog-search', { ...response, items: [{ ...row, ...invalid }] }), false)
  }
  assert.equal(appleMusicArtworkURL('https://mzstatic.com.evil.test/cover.jpg'), null)
  const plain = withMusicLinks('music.catalog-search', { ...response, items: [{ id: 'catalog:123', title: 'Song', url: row.url }] })
  assert.equal(plain.musicLinks[0].artworkURL, undefined)
  assert.ok(plain.musicLinks[0].cardURL)
})
