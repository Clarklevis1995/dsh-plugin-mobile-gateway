import { capturePhoneMessage, preparePhoneStep, phoneOrigin } from '../lib/phone-request-sources.mjs'
import { createTestConnection } from './helpers/peer.mjs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { once } = require('node:events')
const WebSocket = require('ws')
const crypto = require('node:crypto')
const plugin = (await import('../lib/index.mjs')).default
const { createRegistry } = require('../lib/devices.js')

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

function expectRejected(url, options = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options)
    ws.once('open', () => reject(new Error('expected WebSocket rejection')))
    ws.once('unexpected-response', (_request, response) => resolve(response.statusCode))
    ws.once('error', () => {})
  })
}

;(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-auth-'))
  const registryFile = path.join(temp, 'devices.json')
  const publicUrlFile = path.join(temp, 'public-url')
  fs.writeFileSync(publicUrlFile, '# Managed by test\nwss://203.0.113.10/ws/mobile\n')

  // Registry contract: pairing is single-use and neither the pairing code nor
  // the long-lived token is persisted.
  const registry = createRegistry(registryFile, { pairingTtlMs: 60_000 })
  const pairing = registry.createPairing('Test iPhone')
  assert.equal(registry.hasPairing(pairing.code), true)
  const clientDeviceId = '8f22f2b1-b4c0-42bd-bd91-b145f8b375a4'
  let claimed = registry.claimPairing(pairing.code)
  assert.ok(claimed)
  assert.equal(registry.claimPairing(pairing.code), undefined)
  assert.equal(registry.authenticate(claimed.token, clientDeviceId).id, claimed.device.id)
  const firstDeviceId = claimed.device.id
  const firstToken = claimed.token
  const secondPairing = registry.createPairing('Renamed Test iPhone')
  claimed = registry.claimPairing(secondPairing.code, clientDeviceId, 'Renamed Test iPhone')
  assert.equal(claimed.device.id, firstDeviceId)
  assert.equal(registry.list().length, 1)
  assert.equal(registry.list()[0].name, 'Renamed Test iPhone')
  assert.equal(registry.authenticate(firstToken), undefined)
  assert.equal(registry.authenticate(claimed.token).id, firstDeviceId)
  const stored = fs.readFileSync(registryFile, 'utf8')
  assert.equal(stored.includes(pairing.code), false)
  assert.equal(stored.includes(claimed.token), false)
  assert.equal(fs.statSync(registryFile).mode & 0o777, 0o600)
  registry.connected(claimed.device.id)
  assert.equal(registry.list()[0].online, true)
  registry.disconnected(claimed.device.id)
  assert.equal(registry.list()[0].online, false)
  assert.equal(registry.revoke(claimed.device.id), true)
  assert.equal(registry.authenticate(claimed.token), undefined)

  const firstNamed = registry.claimPairing(registry.createPairing('Ignored desktop name').code, 'named-device-001', '我的手机')
  const secondNamed = registry.claimPairing(registry.createPairing().code, 'named-device-002', '我的手机')
  assert.deepEqual(registry.list().map((device) => device.displayName), ['我的手机 (1)', '我的手机 (2)'])
  assert.equal(registry.list()[0].name, '我的手机')
  registry.authenticate(firstNamed.token, 'named-device-001', '新名称')
  assert.deepEqual(registry.list().map((device) => device.displayName), ['新名称', '我的手机'])
  registry.revoke(firstNamed.device.id)
  registry.revoke(secondNamed.device.id)
  const unnamed = registry.claimPairing(registry.createPairing('Ignored desktop name').code, 'unnamed-device-001')
  assert.equal(unnamed.device.name, '未命名设备')
  registry.revoke(unnamed.device.id)

  let managementRoute
  let upgradeRoute
  let disposePlugin
  const uploadedFiles = new Map()
  const prompts = []
  const events = {}
  const sourceProofs = []
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
    connection: createTestConnection(),
    typertGateway: {
      async invoke(request) {
        if (request.namespace === 'session' && request.method === 'list') return { items: [{ sessionId: 's1' }, { sessionId: 's2' }] }
        if (request.namespace === 'session' && request.method === 'prompt') {
          const prompt = request.args.request
          prompts.push(prompt)
          const sourceAgent = { id: prompt.sessionId }
          const sourceMessage = { id: `host-message-${prompt.requestId}`, source: { kind: 'user', rpcId: prompt.requestId, clientTimeZone: prompt.clientTimeZone } }
          capturePhoneMessage({ agent: sourceAgent, message: sourceMessage })
          preparePhoneStep({ agent: sourceAgent, turn: 1, step: 1, messages: [sourceMessage] })
          sourceProofs.push({ requestId: prompt.requestId, origin: phoneOrigin(sourceAgent) })
          const content = prompt.content.map(part => {
            if (part.type !== 'file') return part
            const uploaded = uploadedFiles.get(part.receiptId)
            if (uploaded?.sessionId !== prompt.sessionId) throw Object.assign(new Error('File was not uploaded for this session'), { code: 'session/attachment-invalid' })
            return { type: 'file', attachment: uploaded.file }
          })
          events['session/event']({ id: prompt.sessionId }, { type: 'user/message', seq: 1, time: 1,
            data: { content, source: { kind: 'user' } } })
          return { accepted: true }
        }
        if (request.namespace === 'speech' && request.method === 'catalog') return {
          providers: [{ id: 'sensevoice-local', preparation: { phase: 'ready' } }],
          selection: { providerId: 'sensevoice-local', language: 'auto' },
          maxAudioBytes: 4194304, maxDurationSeconds: 120,
        }
        if (request.namespace === 'speech' && request.method === 'transcribe') {
          assert.equal(request.args.request.audioBase64, 'AA==')
          assert.ok(request.signal instanceof AbortSignal)
          return { text: '测试语音', audioSeconds: 1, inferenceSeconds: 0.1 }
        }
        throw new Error('unexpected Remote invocation')
      },
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
    on(name, listener) { events[name] = listener; return () => {} },
    effect(factory) { disposePlugin = factory() },
  }
  ctx.connection.createSharedFetchHandler = channel => {
    assert.equal(channel, '/api')
    return {
      requestBodyMode: () => 'streaming',
      async fetch(request, peer) {
        assert.equal(peer, ctx.connection.peers[0])
        const url = new URL(request.url)
        assert.equal(url.pathname, '/api/session/uploadFileBinary')
        const bytes = Buffer.from(await request.arrayBuffer())
        const receiptId = crypto.randomUUID()
        const file = { attachmentId: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
          name: url.searchParams.get('name'), bytes: bytes.length }
        uploadedFiles.set(receiptId, { sessionId: url.searchParams.get('sessionId'), file, bytes })
        return Response.json({ ok: true, value: { receiptId, file } })
      },
    }
  }
  plugin.apply(ctx, {
    requireAuth: true,
    gatewayEnabled: false,
    gatewayWaitTimeoutMs: 1_000,
    adminLoopbackOnly: true,
    pairingTtlMs: 60_000,
    deviceFile: path.join(temp, 'integration-devices.json'),
    publicUrlFile,
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  webServer.port = server.address().port
  const base = `http://127.0.0.1:${webServer.port}`
  const wsUrl = `ws://127.0.0.1:${webServer.port}/ws/mobile`

  const initialStatus = await (await fetch(`${base}/mgw/status`)).json()
  assert.equal(initialStatus.version, JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  assert.equal(initialStatus.publicUrl, 'wss://203.0.113.10/ws/mobile')
  assert.equal(initialStatus.webPort, webServer.port)
  const helperStatus = await (await fetch(`${base}/mgw/public-setup`)).json()
  assert.equal(helperStatus.installed, false)

  const blockedPublicSetup = await fetch(`${base}/mgw/public-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ publicIp: '8.8.8.8' }),
  })
  assert.equal(blockedPublicSetup.status, 403)

  assert.equal(await expectRejected(wsUrl), 503)

  const enableGatewayResponse = await fetch(`${base}/mgw/gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(enableGatewayResponse.status, 200)
  const enableGatewayBody = await enableGatewayResponse.json()
  assert.equal(enableGatewayBody.gatewayEnabled, true)
  assert.equal(typeof enableGatewayBody.waitExpiresAt, 'number')
  assert.equal(await expectRejected(wsUrl), 401)

  await new Promise((resolve) => setTimeout(resolve, 1_100))
  const timedOutStatus = await (await fetch(`${base}/mgw/status`)).json()
  assert.equal(timedOutStatus.gatewayEnabled, false)
  assert.equal(await expectRejected(wsUrl), 503)
  const reopenResponse = await fetch(`${base}/mgw/gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(reopenResponse.status, 200)

  const disableAuthResponse = await fetch(`${base}/mgw/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(disableAuthResponse.status, 200)
  assert.equal((await disableAuthResponse.json()).requireAuth, false)
  const debugSocket = new WebSocket(wsUrl)
  const debugHelloPromise = waitForMessage(debugSocket, 'hello')
  await once(debugSocket, 'open')
  assert.equal((await debugHelloPromise).authenticated, false)
  const unauthenticatedSpeech = waitForMessage(debugSocket, 'error')
  debugSocket.send(JSON.stringify({ type: 'speech-catalog', requestId: 'unauthenticated-speech' }))
  assert.equal((await unauthenticatedSpeech).code, 'authentication-required')
  const unauthenticatedUpload = waitForMessage(debugSocket, 'error')
  debugSocket.send(JSON.stringify({ type: 'file-upload-open', requestId: 'anonymous-upload' }))
  assert.equal((await unauthenticatedUpload).code, 'authentication-required')
  const unauthenticatedFileMessage = waitForMessage(debugSocket, 'error')
  debugSocket.send(JSON.stringify({ type: 'message', sessionId: 's1', requestId: 'anonymous-file', files: [{ receiptId: 'fake' }] }))
  assert.equal((await unauthenticatedFileMessage).code, 'authentication-required')

  const debugClosePromise = once(debugSocket, 'close')
  const enableAuthResponse = await fetch(`${base}/mgw/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ enabled: true }),
  })
  assert.equal(enableAuthResponse.status, 200)
  const enableAuthBody = await enableAuthResponse.json()
  assert.equal(enableAuthBody.requireAuth, true)
  assert.equal(enableAuthBody.disconnected, 1)
  await debugClosePromise
  assert.equal(await expectRejected(wsUrl), 401)

  const crossOrigin = await fetch(`${base}/mgw/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
    body: JSON.stringify({ name: 'Blocked', publicUrl: wsUrl }),
  })
  assert.equal(crossOrigin.status, 403)

  const insecurePublic = await fetch(`${base}/mgw/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Blocked', publicUrl: 'ws://gateway.example.com/ws/mobile' }),
  })
  assert.equal(insecurePublic.status, 400)

  const pairResponse = await fetch(`${base}/mgw/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Integration iPhone', publicUrl: wsUrl }),
  })
  assert.equal(pairResponse.status, 201)
  const pairBody = await pairResponse.json()
  assert.equal(pairBody.payload.publicUrl, wsUrl)
  assert.equal(typeof pairBody.payload.pairingCode, 'string')
  assert.match(pairBody.qrPayload, /^[A-Za-z0-9_-]+$/)
  assert.deepEqual(
    JSON.parse(Buffer.from(pairBody.qrPayload, 'base64url').toString('utf8')),
    pairBody.payload,
  )
  assert.equal('token' in pairBody, false)

  assert.equal(
    await expectRejected(wsUrl, ['dsh-mobile-v1', `dsh-pair.${pairBody.payload.pairingCode}`]),
    400,
  )

  const pairedSocket = new WebSocket(
    wsUrl,
    ['dsh-mobile-v1', `dsh-pair.${pairBody.payload.pairingCode}`],
    { headers: { 'X-DSH-Device-ID': clientDeviceId } },
  )
  const pairedPromise = waitForMessage(pairedSocket, 'paired')
  const helloPromise = waitForMessage(pairedSocket, 'hello')
  await once(pairedSocket, 'open')
  const pairedFrame = await pairedPromise
  const hello = await helloPromise
  assert.equal(pairedSocket.protocol, 'dsh-mobile-v1')
  assert.equal(hello.authenticated, true)
  assert.equal(hello.protocol, 3)
  assert.deepEqual(hello.capabilities, [
    'split-channels',
    'network-diagnostics-v1',
    'assistant-stream-v1',
    'history-format-version',
    'projection-baseline',
    'turn-outline-v1',
    'images',
    'message-quotes-v1',
    'tool-result-images-v1',
    'session-create',
    'session-agent-preset',
    'agent-team-v1',
    'agent-team-mode-v1',
    'subagent-conversations-v1',
    'commands',
    'tasks',
    'goals',
    'schedule-management',
    'schedule-management-v2',
    'plugin-management-v1',
    'plugin-updates-v1',
    'speech-input-v1',
    'device-tools-v1',
    'file-upload-v1',
    'session-cancel',
    'queue-control',
    'session-archive',
    'session-rename',
    'file-downloads',
    'file-references-v1',
  ])
  const speechCatalog = waitForMessage(pairedSocket, 'speech-catalog')
  pairedSocket.send(JSON.stringify({ type: 'speech-catalog', requestId: 'speech-info' }))
  assert.equal((await speechCatalog).available, true)
  const speechTranscript = waitForMessage(pairedSocket, 'speech-transcript')
  pairedSocket.send(JSON.stringify({ type: 'speech-transcribe', requestId: 'speech-record', audioBase64: 'AA==' }))
  assert.equal((await speechTranscript).text, '测试语音')
  const connectedStatus = await (await fetch(`${base}/mgw/status`)).json()
  assert.equal(connectedStatus.gatewayEnabled, true)
  assert.equal(connectedStatus.waitExpiresAt, null)
  assert.equal(typeof pairedFrame.token, 'string')
  assert.equal(await expectRejected(
    `${wsUrl}?pairingCode=${encodeURIComponent(pairBody.payload.pairingCode)}`,
    { headers: { 'X-DSH-Device-ID': clientDeviceId } },
  ), 401)

  const tokenSocket = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${pairedFrame.token}`, 'X-DSH-Channel': 'control' } })
  const tokenHelloPromise = waitForMessage(tokenSocket, 'hello')
  await once(tokenSocket, 'open')
  assert.equal((await tokenHelloPromise).authenticated, true)
  const controlSpeech = waitForMessage(tokenSocket, 'speech-transcript')
  tokenSocket.send(JSON.stringify({ type: 'speech-transcribe', requestId: 'control-speech', audioBase64: 'AA==' }))
  assert.equal((await controlSpeech).requestId, 'control-speech')
  const conversationSocket = new WebSocket(wsUrl, { headers: {
    Authorization: `Bearer ${pairedFrame.token}`, 'X-DSH-Channel': 'conversation',
  } })
  await once(conversationSocket, 'open')
  const wrongChannel = waitForMessage(conversationSocket, 'error')
  conversationSocket.send(JSON.stringify({ type: 'speech-catalog', requestId: 'wrong-speech-channel' }))
  assert.equal((await wrongChannel).code, 'wrong-channel')
  const wrongUploadChannel = waitForMessage(conversationSocket, 'error')
  conversationSocket.send(JSON.stringify({ type: 'file-upload-open', requestId: 'wrong-upload-channel' }))
  assert.equal((await wrongUploadChannel).requestId, 'wrong-upload-channel')
  const uploadBytes = Buffer.from('移动端 PDF 测试\0\xff')
  const uploadHash = crypto.createHash('sha256').update(uploadBytes).digest('hex')
  const openedPromise = waitForMessage(tokenSocket, 'file-upload-opened')
  tokenSocket.send(JSON.stringify({ type: 'file-upload-open', requestId: 'upload-open', sessionId: 's1',
    name: '移动文件.pdf', size: uploadBytes.length, sha256: uploadHash }))
  const opened = await openedPromise
  const foreignUpload = waitForMessage(pairedSocket, 'error')
  pairedSocket.send(JSON.stringify({ type: 'file-upload-finish', requestId: 'foreign-finish', uploadId: opened.uploadId }))
  assert.equal((await foreignUpload).code, 'file-upload-not-found')
  const acceptedChunk = waitForMessage(tokenSocket, 'file-upload-chunk-accepted')
  tokenSocket.send(JSON.stringify({ type: 'file-upload-chunk', requestId: 'upload-chunk', uploadId: opened.uploadId,
    offset: 0, data: uploadBytes.toString('base64') }))
  assert.equal((await acceptedChunk).nextOffset, uploadBytes.length)
  const completedPromise = waitForMessage(tokenSocket, 'file-upload-completed')
  tokenSocket.send(JSON.stringify({ type: 'file-upload-finish', requestId: 'upload-finish', uploadId: opened.uploadId }))
  const completed = await completedPromise
  assert.equal(completed.sha256, uploadHash)
  assert.deepEqual(uploadedFiles.get(completed.receiptId).bytes, uploadBytes)
  const fileMessage = waitForMessage(conversationSocket, 'sent')
  const fileEvent = waitForMessage(pairedSocket, 'event')
  conversationSocket.send(JSON.stringify({ type: 'message', requestId: 'send-file', sessionId: 's1',
    text: '分析这个文件', files: [{ receiptId: completed.receiptId }] }))
  assert.equal((await fileMessage).requestId, 'send-file')
  assert.equal(prompts.at(-1).requestId, 'send-file')
  assert.deepEqual((await fileEvent).event.files, [completed.file])
  const foreignReceipt = waitForMessage(conversationSocket, 'error')
  conversationSocket.send(JSON.stringify({ type: 'message', requestId: 'foreign-receipt', sessionId: 's2', files: [{ receiptId: completed.receiptId }] }))
  assert.equal((await foreignReceipt).code, 'session/attachment-invalid')
  const conversationClosed = once(conversationSocket, 'close')
  conversationSocket.close()
  await conversationClosed

  const devicesResponse = await fetch(`${base}/mgw/devices`)
  const devicesBody = await devicesResponse.json()
  assert.equal(devicesBody.devices.length, 1)
  assert.equal(devicesBody.devices[0].online, true)
  assert.equal(devicesBody.devices[0].connections, 2)
  const sourceSent = waitForMessage(pairedSocket, 'sent')
  pairedSocket.send(JSON.stringify({ type: 'message', sessionId: 's1', requestId: 'source-routing-proof', text: 'source routing proof',
    deviceId: 'forged-other-phone', source: { gatewayId: 'forged-gateway', deviceId: 'forged-other-phone' }, clientTimeZone: 'Asia/Shanghai' }))
  assert.equal((await sourceSent).requestId, 'source-routing-proof')
  const proof = sourceProofs.find(row => row.requestId === 'source-routing-proof')
  assert.equal(proof.origin.deviceId, devicesBody.devices[0].id)
  assert.equal(proof.origin.gatewayId, connectedStatus.gatewayId)
  assert.equal(proof.origin.timeZone, 'Asia/Shanghai')


  // 真实 HTTP 管理权限 → 控制 WebSocket → 手机结果 → Agent 等待调用。
  const phoneId = devicesBody.devices[0].id
  const registeredPhone = waitForMessage(tokenSocket, 'device-tools-registered')
  tokenSocket.send(JSON.stringify({ type: 'device-tools-register', version: 1, requestId: 'native-connectors', capabilityRevision: 1,
    modules: [{ id: 'calendar', enabled: true, available: true }] }))
  const phoneRegistration = await registeredPhone
  assert.equal(phoneRegistration.permissions.calendar, false)
  assert.equal(phoneRegistration.statusQuery, true)
  assert.deepEqual(phoneRegistration.modules, [{ id: 'calendar', enabled: true, available: true, tools: ['calendar.busy'] }])
  const phoneStatus = waitForMessage(tokenSocket, 'device-tools-status')
  tokenSocket.send(JSON.stringify({ type: 'device-tools-status', version: 1, requestId: 'inspect-registration' }))
  const currentRegistration = await phoneStatus
  assert.equal(currentRegistration.requestId, 'inspect-registration')
  assert.equal(currentRegistration.status, 'registered')
  assert.equal(currentRegistration.connectionLeaseId, phoneRegistration.connectionLeaseId)
  assert.deepEqual(currentRegistration.modules, phoneRegistration.modules)
  assert.equal(currentRegistration.permissions.calendar, false)

  for (const [revision, allowed] of [[2, true], [3, false]]) {
    const synced = waitForMessage(tokenSocket, 'device-tools-registered')
    tokenSocket.send(JSON.stringify({ type: 'device-tools-register', version: 1, requestId: `phone-toggle-${revision}`, capabilityRevision: revision,
      modules: [{ id: 'calendar', enabled: allowed, available: true }], permissionChanges: { calendar: allowed } }))
    const snapshot = await synced
    assert.equal(snapshot.permissionSync, true)
    assert.equal(snapshot.permissions.calendar, allowed)
    assert.equal(createRegistry(path.join(temp, 'integration-devices.json')).list().find(row => row.id === phoneId).permissions.calendar, allowed)
  }
  const readOnlyRegistration = waitForMessage(tokenSocket, 'device-tools-registered')
  tokenSocket.send(JSON.stringify({ type: 'device-tools-register', version: 1, requestId: 'phone-register-only', capabilityRevision: 4,
    modules: [{ id: 'calendar', enabled: true, available: true }] }))
  assert.equal((await readOnlyRegistration).permissions.calendar, false)

  const permissionUrl = `${base}/mgw/devices/${encodeURIComponent(phoneId)}/permissions`
  assert.equal((await fetch(permissionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: JSON.stringify({ permissions: { calendar: true } }) })).status, 403)
  assert.equal((await fetch(permissionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ permissions: { contacts: true } }) })).status, 400)
  const permissionPush = waitForMessage(tokenSocket, 'device-tools-permissions')
  assert.equal((await fetch(permissionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ permissions: { calendar: true } }) })).status, 200)
  assert.equal((await permissionPush).permissions.calendar, true)
  assert.equal(createRegistry(path.join(temp, 'integration-devices.json')).list().find(row => row.id === phoneId).permissions.calendar, true)
  const broker = globalThis[Symbol.for('whaleness.phone-tools.brokers.v1')].get(connectedStatus.gatewayId)
  const context = { deviceId: phoneId, sessionId: 's1', toolCallId: 'native-tool-call' }
  const range = { start: '2026-11-10T00:00:00+08:00', end: '2026-11-11T00:00:00+08:00', timeZone: 'Asia/Shanghai' }
  const invocation = waitForMessage(tokenSocket, 'device-tool-invoke')
  const phoneResult = broker.invoke(context, 'calendar.busy', range)
  const requested = await invocation
  assert.equal(requested.sessionId, 's1')
  assert.deepEqual(requested.arguments, range)
  const reply = { type: 'device-tool-result', version: 1, invocationId: requested.invocationId, connectionLeaseId: requested.connectionLeaseId,
    status: 'success', result: { busyIntervals: [], collectedAt: '2026-11-10T00:00:00Z' } }
  pairedSocket.send(JSON.stringify(reply)) // 同一设备的旧连接没有本次调用租约。
  tokenSocket.send(JSON.stringify(reply))
  assert.deepEqual(await phoneResult, reply.result)
  const pendingCall = waitForMessage(tokenSocket, 'device-tool-invoke')
  const cancelledResult = broker.invoke(context, 'calendar.busy', range)
  const cancelledAssertion = assert.rejects(cancelledResult, /tool_disabled/)
  await pendingCall
  const cancelledFrame = waitForMessage(tokenSocket, 'device-tool-cancel')
  await fetch(permissionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ permissions: { calendar: false } }) })
  await cancelledFrame; await cancelledAssertion


  // New iPhone advertises its actual write tools; a real WS result completes the Agent call.
  const writableRegistration = waitForMessage(tokenSocket, 'device-tools-registered')
  tokenSocket.send(JSON.stringify({ type: 'device-tools-register', version: 1, requestId: 'writable-iphone', capabilityRevision: 5,
    modules: [
      { id: 'calendar', enabled: true, available: true, tools: ['calendar.busy', 'calendar.create'] },
      { id: 'reminders', enabled: true, available: true, tools: ['reminders.list', 'reminders.create'] },
      { id: 'alarms', enabled: true, available: true, tools: ['alarms.create', 'alarms.list', 'alarms.cancel'] },
      { id: 'music', enabled: true, available: true, tools: ['music.library', 'music.play-library', 'music.catalog-search'] },
      { id: 'location', enabled: true, available: true, tools: ['location.precise', 'maps.search', 'maps.geocode', 'maps.reverse-geocode', 'maps.directions', 'maps.open', 'maps.markers.create', 'maps.markers.list', 'maps.markers.update', 'maps.markers.delete'] },
    ], permissionChanges: { calendar: true, reminders: true, alarms: true, music: true, location: true } }))
  assert.equal((await writableRegistration).permissions.alarms, true)
  const operationId = '819e6e40-5008-4d8e-917e-31dbd0046a47'
  const creates = [
    ['calendar.create', { operationId, title: 'Meeting', ...range, alertMinutesBefore: 15 }, { id: 'event-created', title: 'Meeting', ...range, allDay: false, operationId, status: 'created' }],
    ['reminders.create', { operationId, title: 'Buy milk', timeZone: range.timeZone }, { id: 'reminder-created', title: 'Buy milk', dueDate: null, timeZone: range.timeZone, notify: false, priority: 0, operationId, status: 'created' }],
    ['alarms.create', { operationId, title: 'Wake up', fireDate: range.start, timeZone: range.timeZone }, { id: operationId, title: 'Wake up', fireDate: range.start, timeZone: range.timeZone, state: 'scheduled', operationId, status: 'created' }],
    ['music.library', {}, { items: [{ id: 'library:i.test', title: 'Song', artworkURL: 'https://is1-ssl.mzstatic.com/image/thumb/Music/test/300x300bb.jpg', durationSeconds: 245, url: 'https://music.apple.com/song/123' }], kind: 'songs', offset: 0, limit: 20, hasMore: false, nextOffset: null,
      pagingLimitReached: false, source: 'apple-music-library', scope: 'device-synced-personal-library', downloadedOnly: false, status: 'ok' }],
    ['music.catalog-search', { query: 'Song' }, { items: [{ id: 'catalog:123', title: 'Song', artist: 'Singer', album: 'Album', artworkURL: 'https://is1-ssl.mzstatic.com/image/thumb/Music/test/300x300bb.jpg', durationSeconds: 245, url: 'https://music.apple.com/song/123' }], source: 'apple-music-catalog' }],
    ['music.play-library', { kind: 'songs', itemId: 'library:i.test' }, { playbackState: 1, playbackSeconds: 0, requested: 'music.play-library' }],
    ['location.precise', {}, { latitude: 31.234567, longitude: 121.456789, precision: 'precise', horizontalAccuracyMeters: 12, sampledAt: '2026-11-10T00:00:00Z' }],
    ['maps.search', { query: 'coffee', latitude: 31, longitude: 121 }, { items: [{ name: 'Cafe', latitude: 31, longitude: 121, address: 'Street' }], truncated: false, source: 'apple-maps' }],
    ['maps.open', { latitude: 31, longitude: 121 }, { status: 'handoff-requested', latitude: 31, longitude: 121, name: 'Destination', mode: 'show' }],
    ['maps.markers.create', { operationId, name: 'Parking', latitude: 31, longitude: 121 }, { marker: { id: operationId, name: 'Parking', latitude: 31, longitude: 121, address: '', notes: '', revision: 1, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-10T00:00:00Z' }, operationId, status: 'created', replayed: false, source: 'whaleness-host-markers' }],
    ['maps.markers.list', {}, { items: [], total: 0, offset: 0, limit: 20, hasMore: false, nextOffset: null, source: 'whaleness-host-markers' }],
  ]
  for (const [tool, args, result] of creates) {
    const requested = waitForMessage(tokenSocket, 'device-tool-invoke')
    const completed = broker.invoke({ ...context, toolCallId: tool }, tool, args)
    const request = await requested
    if (args.operationId) assert.equal(request.arguments.operationId, operationId)
    assert.equal(request.sessionId, context.sessionId)
    tokenSocket.send(JSON.stringify({ type: 'device-tool-result', version: 1, invocationId: request.invocationId,
      connectionLeaseId: request.connectionLeaseId, status: 'success', result }))
    assert.deepEqual(await completed, result)
  }
  const writeDevices = await (await fetch(`${base}/mgw/devices`)).json()
  assert.deepEqual(writeDevices.devices[0].modules.alarms.tools, ['alarms.create', 'alarms.list', 'alarms.cancel'])

  const rePairResponse = await fetch(`${base}/mgw/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Integration iPhone Renamed', publicUrl: wsUrl }),
  })
  assert.equal(rePairResponse.status, 201)
  const rePairBody = await rePairResponse.json()
  const rePairedSocket = new WebSocket(
    wsUrl,
    ['dsh-mobile-v1', `dsh-pair.${rePairBody.payload.pairingCode}`],
    { headers: { 'X-DSH-Device-ID': clientDeviceId, 'X-DSH-Device-Name': Buffer.from('Integration iPhone Renamed').toString('base64') } },
  )
  const rePairedPromise = waitForMessage(rePairedSocket, 'paired')
  await once(rePairedSocket, 'open')
  const rePairedFrame = await rePairedPromise
  assert.equal(rePairedFrame.device.id, pairedFrame.device.id)
  assert.notEqual(rePairedFrame.token, pairedFrame.token)
  const rePairedDevices = await (await fetch(`${base}/mgw/devices`)).json()
  assert.equal(rePairedDevices.devices.length, 1)
  assert.equal(rePairedDevices.devices[0].name, 'Integration iPhone Renamed')
  assert.equal(rePairedDevices.devices[0].connections, 3)
  assert.equal(await expectRejected(wsUrl, { headers: { Authorization: `Bearer ${pairedFrame.token}` } }), 401)

  const closePromise = once(tokenSocket, 'close')
  const revokeResponse = await fetch(`${base}/mgw/devices/${pairedFrame.device.id}/revoke`, {
    method: 'POST',
    headers: { Origin: base },
  })
  assert.equal(revokeResponse.status, 200)
  await closePromise
  assert.equal(await expectRejected(wsUrl, { headers: { Authorization: `Bearer ${pairedFrame.token}` } }), 401)
  assert.equal(await expectRejected(wsUrl, { headers: { Authorization: `Bearer ${rePairedFrame.token}` } }), 401)

  // Browser-style clients cannot set X-DSH-Device-ID. They may carry the same
  // installation-level id in a `dsh-device.` subprotocol instead; the pairing
  // code and the issued token stay the only credentials.
  const browserDeviceId = 'a1b2c3d4-5e6f-4a7b-8c9d-0e1f2a3b4c5d._-'
  if (typeof globalThis.WebSocket === 'function') {
    // Browser-compatible constructors accept all supported punctuation but
    // reject ':' before a handshake can be sent.
    for (const id of ['abcd.efgh', 'abcd_efgh', 'abcd-efgh']) {
      const nativeSocket = new globalThis.WebSocket(wsUrl, ['dsh-mobile-v1', `dsh-device.${id}`])
      nativeSocket.addEventListener('error', () => {})
      nativeSocket.close()
    }
    assert.throws(
      () => new globalThis.WebSocket(wsUrl, ['dsh-mobile-v1', 'dsh-device.abcd:efgh']),
      { name: 'SyntaxError' },
    )
  }
  const browserPairResponse = await fetch(`${base}/mgw/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ name: 'Browser WebUI', publicUrl: wsUrl }),
  })
  assert.equal(browserPairResponse.status, 201)
  const browserPairBody = await browserPairResponse.json()
  // A malformed subprotocol id counts as a missing device id; the single-use
  // code must survive the rejection so the client can retry with a valid id.
  assert.equal(await expectRejected(
    wsUrl,
    ['dsh-mobile-v1', `dsh-pair.${browserPairBody.payload.pairingCode}`, 'dsh-device.short'],
  ), 400)
  const browserDeviceNameText = '浏览器 WebUI'
  const browserDeviceName = Buffer.from(browserDeviceNameText, 'utf8').toString('base64url')
  const oversizedDeviceName = `${Buffer.from('x'.repeat(384), 'utf8').toString('base64url')}A`
  assert.equal(oversizedDeviceName.length, 513)
  const controlDeviceName = Buffer.from('Bad\u0001Name', 'utf8').toString('base64url')
  const replacementDeviceName = Buffer.from('Bad\uFFFDName', 'utf8').toString('base64url')
  const browserSocket = new WebSocket(
    wsUrl,
    ['dsh-mobile-v1', `dsh-pair.${browserPairBody.payload.pairingCode}`,
      `dsh-device.${browserDeviceId}`, `dsh-device-name.${oversizedDeviceName}`,
      'dsh-device-name.A', `dsh-device-name.${controlDeviceName}`,
      `dsh-device-name.${replacementDeviceName}`, `dsh-device-name.${browserDeviceName}`],
  )
  const browserPairedPromise = waitForMessage(browserSocket, 'paired')
  const browserHelloPromise = waitForMessage(browserSocket, 'hello')
  await once(browserSocket, 'open')
  const browserPairedFrame = await browserPairedPromise
  const browserHello = await browserHelloPromise
  assert.equal(browserSocket.protocol, 'dsh-mobile-v1')
  assert.equal(browserHello.authenticated, true)
  assert.equal(browserPairedFrame.device.name, browserDeviceNameText)
  assert.equal(typeof browserPairedFrame.token, 'string')
  const storedDevices = JSON.parse(fs.readFileSync(path.join(temp, 'integration-devices.json'), 'utf8'))
  assert.equal(storedDevices.devices.at(-1).clientDeviceId, browserDeviceId)
  // Browser reconnect: token and device id both travel in subprotocols, no headers.
  // A 512-character encoded name remains valid, updates the display name and
  // is truncated to the same 80-character bound as the header transport.
  const maxEncodedDeviceName = Buffer.from('x'.repeat(384), 'utf8').toString('base64url')
  assert.equal(maxEncodedDeviceName.length, 512)
  const browserTokenSocket = new WebSocket(
    wsUrl,
    ['dsh-mobile-v1', `dsh-auth.${browserPairedFrame.token}`, `dsh-device.${browserDeviceId}`,
      `dsh-device-name.${maxEncodedDeviceName}`],
  )
  const browserTokenHelloPromise = waitForMessage(browserTokenSocket, 'hello')
  await once(browserTokenSocket, 'open')
  assert.equal((await browserTokenHelloPromise).authenticated, true)
  const browserDevices = await (await fetch(`${base}/mgw/devices`)).json()
  assert.equal(browserDevices.devices.length, 1)
  assert.equal(browserDevices.devices[0].name, 'x'.repeat(80))
  // Batch removal is one persisted change: disconnect all selected devices/channels,
  // cancel native work, keep unselected devices and reject deleted credentials.
  const pairBulkPhone = async installation => {
    const response = await fetch(`${base}/mgw/pair`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ publicUrl: wsUrl }) })
    const body = await response.json()
    const socket = new WebSocket(wsUrl, ['dsh-mobile-v1', `dsh-pair.${body.payload.pairingCode}`],
      { headers: { 'X-DSH-Device-ID': installation } })
    const paired = waitForMessage(socket, 'paired'), hello = waitForMessage(socket, 'hello')
    await once(socket, 'open'); await hello
    return { socket, ...(await paired) }
  }
  const bulkOther = await pairBulkPhone('bulk-other-installation'), bulkKeep = await pairBulkPhone('bulk-keep-installation')
  const bulkUrl = `${base}/mgw/devices/revoke`
  const bulkRequest = (body, origin = base) => fetch(bulkUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) })
  const selectedIds = [browserPairedFrame.device.id, bulkOther.device.id]
  assert.equal((await bulkRequest({ deviceIds: selectedIds }, 'https://other.example')).status, 403)
  for (const body of [{}, { deviceIds: [] }, { deviceIds: [selectedIds[0], null] }, { deviceIds: selectedIds, unexpected: true }]) {
    assert.equal((await bulkRequest(body)).status, 400)
    assert.equal((await (await fetch(`${base}/mgw/devices`)).json()).devices.length, 3)
  }
  const bulkRegistered = waitForMessage(bulkOther.socket, 'device-tools-registered')
  bulkOther.socket.send(JSON.stringify({ type: 'device-tools-register', version: 1, requestId: 'batch-register', capabilityRevision: 1,
    modules: [{ id: 'calendar', enabled: true, available: true }], permissionChanges: { calendar: true } }))
  await bulkRegistered
  const bulkInvocation = waitForMessage(bulkOther.socket, 'device-tool-invoke')
  const bulkPending = broker.invoke({ deviceId: bulkOther.device.id, sessionId: 'bulk-test', toolCallId: 'pending-before-removal' }, 'calendar.busy', range)
  const bulkCancelled = assert.rejects(bulkPending, /device_disconnected/)
  await bulkInvocation
  const bulkCancelFrame = waitForMessage(bulkOther.socket, 'device-tool-cancel')
  const removedConnections = [browserSocket, browserTokenSocket, bulkOther.socket].map(socket => once(socket, 'close'))
  const removedResponse = await bulkRequest({ deviceIds: [...selectedIds, selectedIds[0], 'already-removed'] })
  assert.equal(removedResponse.status, 200)
  const removedBody = await removedResponse.json()
  assert.deepEqual(new Set(removedBody.revokedIds), new Set(selectedIds))
  assert.deepEqual(removedBody.devices.map(device => device.id), [bulkKeep.device.id])
  await bulkCancelFrame; await bulkCancelled; await Promise.all(removedConnections)
  assert.equal(bulkKeep.socket.readyState, WebSocket.OPEN)
  for (const token of [browserPairedFrame.token, bulkOther.token]) assert.equal(await expectRejected(wsUrl, { headers: { Authorization: `Bearer ${token}` } }), 401)
  const persistedAfterBatch = createRegistry(path.join(temp, 'integration-devices.json'))
  assert.deepEqual(persistedAfterBatch.list().map(device => device.id), [bulkKeep.device.id])
  assert.equal(persistedAfterBatch.authenticate(bulkKeep.token).id, bulkKeep.device.id)
  assert.deepEqual((await (await bulkRequest({ deviceIds: selectedIds })).json()).revokedIds, [])
  assert.deepEqual((await (await fetch(`${base}/mgw/devices`)).json()).devices.map(device => device.id), [bulkKeep.device.id])
  bulkKeep.socket.close()

  const disableGatewayResponse = await fetch(`${base}/mgw/gateway`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ enabled: false }),
  })
  assert.equal(disableGatewayResponse.status, 200)
  assert.equal((await disableGatewayResponse.json()).gatewayEnabled, false)
  assert.equal(await expectRejected(wsUrl), 503)

  pairedSocket.close()
  rePairedSocket.close()
  disposePlugin()
  server.close()
  await once(server, 'close')
  fs.rmSync(temp, { recursive: true })
  console.log('AUTH AND PAIRING TESTS PASSED')
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
