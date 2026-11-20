// 只针对显式指定的隔离本机实例；默认只读，DSH_BOT_PROBE_SEND=1 时验证本地测试消息。
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

const url = new URL(process.env.DSH_BOT_PROBE_URL || 'http://127.0.0.1:3098')
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

try {
  const first = await connect(payload.pairingCode)
  const hello = await first.call('hello', { api: [1] })
  assert.equal(hello.api, 1)
  const team = await first.call('state', { avatars: 'ref' })
  assert.ok(Array.isArray(team.bots))
  assert.equal(team.phone, undefined)
  assert.ok(team.mainBotId)
  for (const room of team.rooms ?? []) {
    const history = await first.call('room-chat', { roomId: room.id })
    assert.ok(Array.isArray(history.items))
  }
  let chat = await first.call('chat', { botId: team.mainBotId })
  assert.ok(Array.isArray(chat.items))
  first.ws.send(JSON.stringify({ type: 'bot-subscribe', requestId: 'bot-probe-subscribe' }))
  const subscribed = await first.next(frame => frame.kind === 'bot-subscribed')
  const event = await first.next(frame => frame.kind === 'bot-event')
  assert.equal(event.subscriptionId, subscribed.subscriptionId)
  assert.equal(event.botEvent, 'hello')
  assert.equal(typeof event.botData.boot, 'string')
  assert.equal(event.event, undefined)
  assert.equal(event.data, undefined)
  let streamedReply = false
  if (process.env.DSH_BOT_PROBE_SEND === '1') {
    assert.equal(await first.call('send', { sessionId: team.mainBotId, text: 'Bot 通信验证（隔离测试）' }), true)
    const chunk = await first.next(frame => frame.kind === 'bot-event' && frame.botEvent === 'stream' && typeof frame.botData.text === 'string')
    assert.ok(chunk.botData.text.length > 0)
    await first.next(frame => frame.kind === 'bot-event' && frame.botEvent === 'message' && frame.botData.item?.kind === 'bot')
    chat = await first.call('chat', { botId: team.mainBotId })
    streamedReply = true
  }
  first.ws.close()
  await new Promise(resolve => first.ws.once('close', resolve))
  const second = await connect()
  const restored = await second.call('chat', { botId: team.mainBotId })
  assert.deepEqual(restored.items, chat.items)
  console.log(JSON.stringify({ plugin: hello.plugin, bots: team.bots.length, rooms: team.rooms?.length ?? 0,
    historyRows: chat.items.length, realFeed: event.botEvent, authenticatedReconnect: true, streamedReply }))
} finally {
  for (const ws of sockets) { if (ws.readyState === WebSocket.OPEN) ws.close(); else if (ws.readyState !== WebSocket.CLOSED) ws.terminate() }
}
