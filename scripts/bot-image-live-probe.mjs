import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { randomFillSync } from 'node:crypto'
import { crc32, deflateSync } from 'node:zlib'
// 仅对显式指定的隔离本机实例发送 mock 测试消息并创建临时图片；不用于用户运行中的主机。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const url = new URL(process.env.DSH_BOT_IMAGE_PROBE_URL)
assert.equal(url.hostname, '127.0.0.1')
assert.notEqual(url.port, '3080', '请使用隔离测试实例，不对现有网页主机创建验证设备')
const response = await fetch(new URL('/mgw/pair', url), {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(10_000),
})
assert.equal(response.status, 201)
const { payload } = await response.json()
const deviceId = randomUUID()
let token
let counter = 0
const sockets = []

async function connect(pairingCode) {
  const ws = new WebSocket(payload.publicUrl, ['dsh-mobile-v1', ...(pairingCode ? [`dsh-pair.${pairingCode}`] : [])], {
    headers: { 'X-DSH-Device-ID': deviceId, 'X-DSH-Channel': 'control', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  })
  sockets.push(ws)
  const inbox = []
  const waiters = new Set()
  ws.on('message', raw => {
    const frame = JSON.parse(raw)
    if (frame.kind === 'paired') token = frame.token
    const match = [...waiters].find(waiter => waiter.matches(frame))
    if (match) { waiters.delete(match); clearTimeout(match.timeout); match.resolve(frame) }
    else inbox.push(frame)
  })
  const next = matches => {
    const index = inbox.findIndex(matches)
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0])
    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve, timeout: setTimeout(() => { waiters.delete(waiter); reject(new Error('Bot probe response timed out')) }, 12_000) }
      waiters.add(waiter)
    })
  }
  ws.on('error', () => {})
  const hello = await next(frame => frame.kind === 'hello')
  assert.equal(hello.authenticated, true)
  assert.ok(hello.capabilities.includes('bot-v1'))
  const call = async (endpoint, payload = {}) => {
    const requestId = `bot-probe-${++counter}`
    ws.send(JSON.stringify({ type: 'bot-call', requestId, endpoint, payload }))
    const answer = await next(frame => frame.requestId === requestId)
    assert.equal(answer.kind, 'bot-result', `Bot endpoint failed: ${endpoint}: ${answer.code}`)
    return answer.value
  }
  return { ws, next, call }
}

const home = process.env.DSH_BOT_IMAGE_PROBE_HOME
assert.ok(home?.includes('/.dsh-test-'), 'An explicit, isolated DS-Bot bench is required')
const directory = await mkdtemp('/private/tmp/bot-img-')
const file = join(directory, 'plot.png')
const pngChunk = (name, data) => {
  const type = Buffer.from(name)
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))
  return Buffer.concat([length, type, data, checksum])
}
const structured = process.env.DSH_BOT_IMAGE_PROBE_STRUCTURED === '1'
const width = structured ? 64 : 1600, height = structured ? 64 : 1200
const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
const raw = Buffer.alloc((width * 4 + 1) * height)
for (let row = 0; row < height; row++) randomFillSync(raw, row * (width * 4 + 1) + 1, width * 4)
const original = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(raw, { level: 0 })), pngChunk('IEND', Buffer.alloc(0))])
await writeFile(file, original)
try {
  const first = await connect(payload.pairingCode)
  const team = await first.call('state', { avatars: 'ref' })
  const bot = team.bots.find(value => value.id === team.mainBotId)
  assert.ok(bot)
  // The benchmark's own bootstrap token stays inside this process.
  const log = await readFile(join(home, 'web.log'), 'utf8')
  const loginUrl = log.match(/http:\/\/[^\s]+token=[^\s]+/)?.[0]
  assert.ok(loginUrl)
  const login = await fetch(loginUrl, { redirect: 'manual' })
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie)
  const update = await fetch(new URL('/api/bot', url), { method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ endpoint: 'update-bot', payload: { id: bot.id, workDir: directory } }) })
  assert.equal((await update.json()).ok, true)
  const hello = await first.call('hello', { api: [1] })
  assert.ok(hello.capabilities.includes('image-chunks'))
  assert.ok(hello.capabilities.includes('agent-image-refs'))
  assert.equal(hello.imageBridge.provider, 'mobile-gateway')
  if (structured) {
    first.ws.send(JSON.stringify({ type: 'bot-subscribe', requestId: 'image-sub' }))
    await first.next(frame => frame.kind === 'bot-subscribed' && frame.requestId === 'image-sub')
    await first.call('chat', { botId: bot.id })
  }
  const markdown = structured ? `网关图片验证：${file}` : `![plot](${file})`
  await first.call('send', { sessionId: bot.id, text: markdown })
  if (structured) await first.next(frame => frame.kind === 'bot-event' && frame.botEvent === 'message'
    && frame.botData?.botId === bot.id && frame.botData?.sessionId && !frame.botData.item)
  let page
  for (let attempt = 0; attempt < 60; attempt++) {
    page = await first.call('chat', { botId: bot.id })
    if (page.items.some(item => item.kind === 'bot' && (structured ? item.imageRefs?.length : item.text?.includes(file)))) break
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const image = page.items.find(item => item.kind === 'bot' && item.imageRefs?.length)?.imageRefs[0]
  assert.ok(structured ? image : page.items.some(item => item.kind === 'bot' && item.text?.includes(file)), 'The Agent must return the image')
  const endpoint = structured ? 'image' : 'markdown-image'
  const target = structured ? { sessionId: image.sessionId, attachmentId: image.attachmentId } : { sessionId: page.sessionId ?? bot.sessionId, path: file }
  let expected = original
  if (structured) {
    first.ws.send(JSON.stringify({ type: 'attachment', requestId: 'ordinary-image', ...target }))
    const ordinary = await first.next(frame => (frame.kind === 'attachment' && frame.sessionId === target.sessionId)
      || (frame.kind === 'error' && frame.requestType === 'attachment'))
    assert.equal(ordinary.kind, 'attachment')
    expected = Buffer.from(ordinary.data, 'base64')
    assert.ok(expected.length > 0)
    assert.equal(image.width, 64); assert.equal(image.height, 64)
  }
  assert.ok(target.sessionId)
  const preview = await first.call(endpoint, { ...target, preview: true, offset: 0 })
  assert.equal(preview.offset, 0)
  assert.equal(preview.size, expected.length)
  assert.deepEqual(Buffer.from(preview.data, 'base64'), expected.subarray(0, preview.nextOffset))
  const parts = []
  let offset = 0, revision, count = 0
  for (;;) {
    const part = await first.call(endpoint, { ...target, preview: false, offset })
    const bytes = Buffer.from(part.data, 'base64')
    assert.equal(part.offset, offset)
    assert.equal(part.nextOffset, offset + bytes.length)
    assert.ok(bytes.length <= 384 * 1024)
    if (revision !== undefined) assert.equal(part.rev, revision)
    revision = part.rev
    parts.push(bytes); count++; offset = part.nextOffset
    if (part.done) break
    assert.ok(count < 44)
  }
  assert.deepEqual(Buffer.concat(parts), expected)
  process.stdout.write(JSON.stringify({ paired: true, agentMarkdown: !structured, structuredAttachment: structured, nativeImageInvalidation: structured, ordinaryAttachmentIdentical: structured, previewBytes: Buffer.from(preview.data, 'base64').length, originalBytes: expected.length, chunks: count, exactOriginal: true }) + '\n')
} finally {
  for (const socket of sockets) socket.close()
  await rm(directory, { recursive: true, force: true })
}
