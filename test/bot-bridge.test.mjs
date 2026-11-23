import test from 'node:test'
import assert from 'node:assert/strict'
import { createBotAdapter, createBotChannel, readBotFeed } from '../lib/bot-bridge.mjs'
import { createTestPeer } from './helpers/peer.mjs'

const hello = { api: 1, capabilities: ['chat', 'feed'], boot: 'boot-1', seq: 1 }
const tick = () => new Promise(resolve => setImmediate(resolve))
const streamOf = chunks => new ReadableStream({ start(controller) {
  for (const chunk of chunks) controller.enqueue(chunk)
  controller.close()
} })

test('固定内部路由沿用 owner Peer，保留错误并屏蔽配对 URI', async () => {
  const peer = createTestPeer()
  const calls = []
  const api = createBotAdapter({ async fetch(request, receiver) {
    assert.equal(receiver, peer)
    assert.equal(request.url, 'http://localhost/api/bot')
    const body = await request.json()
    calls.push(body)
    if (body.endpoint === 'hello') return Response.json({ ok: true, value: hello })
    if (body.endpoint === 'state') return Response.json({ ok: true, value: { revision: 3, bots: [], phone: { pairing: 'secret' } } })
    return Response.json({ ok: false, error: { code: 'bot/stale', message: 'Already answered' } })
  } }, peer)
  assert.deepEqual(await api.call('hello', { api: [1] }), hello)
  assert.deepEqual(await api.call('state'), { revision: 3, bots: [] })
  await assert.rejects(api.call('answer-question', { sessionId: 's' }), { code: 'bot/stale' })
  for (const endpoint of ['phone-pair', 'secret-set', '../other', 'delete-room', 'constructor']) {
    await assert.rejects(api.call(endpoint), { code: 'bad-request' })
  }
  assert.equal(calls.length, 3)
  await assert.rejects(api.call('state', []), { code: 'bad-request' })
  await peer.dispose()
  await assert.rejects(api.call('state'))
  assert.equal(calls.length, 3)
})

test('Bot 删除只转发可写团队中的普通成员，并校验请求字段', async () => {
  const peer = createTestPeer()
  const calls = []
  let readOnly = null
  try {
    const api = createBotAdapter({ async fetch(request) {
      const body = await request.json()
      calls.push(body)
      if (body.endpoint === 'hello') return Response.json({ ok: true, value: { ...hello, capabilities: ['write-state'] } })
      if (body.endpoint === 'state') return Response.json({ ok: true, value: {
        mainBotId: 'chief', mainBotIds: ['chief', 'deputy'], readOnly,
        bots: ['chief', 'deputy', 'worker'].map(id => ({ id })), rooms: [{ id: 'group' }],
      } })
      return Response.json({ ok: true, value: { bots: [], phone: { pairing: 'internal' } } })
    } }, peer)
    assert.ok((await api.call('hello')).capabilities.includes('bot-deletion'))
    for (const id of ['chief', 'deputy']) {
      await assert.rejects(api.call('delete-bot', { id }), { code: 'bot/main-protected' })
    }
    for (const id of ['group', 'missing']) {
      await assert.rejects(api.call('delete-bot', { id }), { code: 'bot/stale' })
    }
    await assert.rejects(api.call('delete-bot', { id: '' }), { code: 'bad-request' })
    await assert.rejects(api.call('delete-bot', { id: 'worker', force: true }), { code: 'bad-request' })
    readOnly = 'another host owns the team'
    await assert.rejects(api.call('delete-bot', { id: 'worker' }), { code: 'bot/read-only' })
    assert.equal(calls.filter(call => call.endpoint === 'delete-bot').length, 0)
    readOnly = null
    assert.deepEqual(await api.call('delete-bot', { id: 'worker' }), { id: 'worker' })
    assert.deepEqual(calls.at(-1), { endpoint: 'delete-bot', payload: { id: 'worker' } })
  } finally {
    await peer.dispose()
  }
})

test('插件缺失、API 不兼容、非 JSON、响应过大分别报错', async () => {
  const peer = createTestPeer()
  for (const [response, endpoint, code] of [
    [new Response('', { status: 404 }), 'hello', 'bot-unavailable'],
    [Response.json({ ok: true, value: { api: null, capabilities: [] } }), 'hello', 'bot-version-unsupported'],
    [Response.json({ value: [] }), 'state', 'bot-invalid-response'],
    [Response.json({ ok: true, value: 'x'.repeat(4 * 1024 * 1024) }), 'state', 'bot-response-too-large'],
  ]) {
    const api = createBotAdapter({ fetch: async () => response }, peer)
    await assert.rejects(api.call(endpoint), { code })
  }
  await assert.rejects(createBotAdapter(null, peer).call('state'), { code: 'bot-unavailable' })
  await peer.dispose()
})

test('SSE 支持跨字节中文、CRLF、注释心跳和多行 data', async () => {
  const raw = new TextEncoder().encode(': keepalive\r\nevent: stream\r\ndata: {"text":\r\ndata: "你好"}\r\n\r\nevent: future\ndata: {}\n\nevent: message\ndata: {"item":{"seq":3}}\n\n')
  const received = []
  for await (const event of readBotFeed(streamOf([...raw].map(byte => Uint8Array.of(byte))), new AbortController().signal)) received.push(event)
  assert.deepEqual(received, [{ event: 'stream', data: { text: '你好' } }, { event: 'message', data: { item: { seq: 3 } } }])
})

test('取消 feed 释放 reader；恶意超长 data 有界失败', async () => {
  let cancelled = false
  const abort = new AbortController()
  const body = new ReadableStream({ cancel() { cancelled = true } })
  const pending = (async () => { for await (const event of readBotFeed(body, abort.signal)) assert.fail('Unexpected event') })()
  abort.abort()
  await assert.rejects(pending)
  await tick()
  assert.equal(cancelled, true)
  const large = new TextEncoder().encode(`data: ${'x'.repeat(4 * 1024 * 1024 + 1)}`)
  await assert.rejects(async () => { for await (const event of readBotFeed(streamOf([large]), new AbortController().signal)) {} }, { code: 'bot-response-too-large' })
})

test('subscribe 确认先于事件，EOF 发出 reset，断线释放订阅', async () => {
  const peer = createTestPeer()
  let controller
  let cancelled = false
  const adapter = createBotAdapter({ async fetch(request) {
    if (request.method === 'POST') return Response.json({ ok: true, value: hello })
    return new Response(new ReadableStream({ start(c) { controller = c }, cancel() { cancelled = true } }),
      { headers: { 'content-type': 'text/event-stream' } })
  } }, peer)
  const sent = []
  const abort = new AbortController()
  const channel = createBotChannel(adapter, { send: frame => sent.push(frame), signal: abort.signal })
  assert.equal(await channel.handle({ type: 'bot-subscribe', requestId: 'sub-1' }), null)
  await tick()
  controller.enqueue(new TextEncoder().encode('event: hello\ndata: {"boot":"boot-1","seq":1}\n\n'))
  await tick()
  assert.equal(sent[0].kind, 'bot-subscribed')
  assert.equal(sent[1].kind, 'bot-event')
  assert.equal(sent[1].botEvent, 'hello')
  assert.equal(sent[1].event, undefined, '不能与普通会话 event 字段类型冲突')
  assert.equal(sent[1].data, undefined, '不能与附件 data 字段类型冲突')
  controller.close()
  await tick()
  assert.equal(sent.at(-1).kind, 'bot-stream-reset')
  await channel.handle({ type: 'bot-subscribe', requestId: 'sub-2' })
  await tick()
  abort.abort()
  await tick()
  assert.equal(cancelled, true)
  await peer.dispose()
})

test('建立中的旧订阅不能覆盖较新的订阅或取消请求', async () => {
  const pending = []
  const sent = []
  const abort = new AbortController()
  const api = {
    call: () => new Promise(resolve => pending.push(resolve)),
    async *follow(signal) { if (!signal.aborted) yield { event: 'hello', data: hello } },
  }
  const channel = createBotChannel(api, { send: frame => sent.push(frame), signal: abort.signal })
  const first = channel.handle({ type: 'bot-subscribe', requestId: 'old' })
  const second = channel.handle({ type: 'bot-subscribe', requestId: 'new' })
  pending[1](hello); await second
  pending[0](hello); await first
  assert.equal(sent.filter(frame => frame.kind === 'bot-subscribed').length, 1)
  assert.equal(sent[0].subscriptionId, 'new')
  sent.length = 0
  const third = channel.handle({ type: 'bot-subscribe', requestId: 'cancelled' })
  await channel.handle({ type: 'bot-unsubscribe', requestId: 'cancel' })
  pending[2](hello); await third
  assert.equal(sent.length, 0)
  abort.abort()
})

test('bot-call 回执关联及校验失败保持 requestId，不自动重发写操作', async () => {
  let calls = 0
  const abort = new AbortController()
  const channel = createBotChannel({ call: async () => { calls++; throw new Error('Connection lost') } },
    { send: () => {}, signal: abort.signal })
  const frame = await channel.handle({ type: 'bot-call', requestId: 'send-1', endpoint: 'send', payload: { text: 'hi' } })
  assert.equal(frame.requestId, 'send-1')
  assert.equal(frame.kind, 'error')
  assert.equal(calls, 1)
  const invalid = await channel.handle({ type: 'bot-call', requestId: 'x'.repeat(129) })
  assert.equal(invalid.code, 'bad-request')
  assert.equal(calls, 1)
  abort.abort()
})


test('图片读取与分块字段透传，并继续受固定路由及响应预算限制', async () => {
  const peer = createTestPeer()
  const calls = []
  const image = { mime: 'image/png', data: 'YWJj', offset: 393216, nextOffset: 393219, size: 393219, done: true, rev: 'r1' }
  const api = createBotAdapter({ async fetch(request, receiver) {
    assert.equal(receiver, peer)
    assert.equal(request.url, 'http://localhost/api/bot')
    calls.push(await request.json())
    return Response.json({ ok: true, value: image })
  } }, peer)
  for (const [endpoint, payload] of [
    ['image', { sessionId: 'member-archived', attachmentId: 'plot', offset: 393216, preview: false }],
    ['markdown-image', { sessionId: 'room', botId: 'researcher', path: './charts/plot.png', offset: 393216, preview: false }],
  ]) {
    assert.deepEqual(await api.call(endpoint, payload), image)
    assert.deepEqual(calls.at(-1), { endpoint, payload })
  }
  await peer.dispose()
})


test('官方头像引用保持原样，默认角色头像引用与颜色同步', async () => {
  const peer = createTestPeer()
  const photo = { botId: 'photo', ref: 'photo-hash', image: 'data:image/png;base64,YQ==' }
  let color = 'blue'
  const api = createBotAdapter({ async fetch(request) {
    const { endpoint, payload } = await request.json()
    if (endpoint === 'avatar') return Response.json({ ok: true, value: payload.botId === photo.botId
      ? photo : { botId: payload.botId, ref: null, image: null } })
    return Response.json({ ok: true, value: { bots: [
      { id: 'chief', name: 'Chief', color, avatar: { shape: 'whale' } },
      { id: photo.botId, avatar: { imageRef: photo.ref } },
    ] } })
  } }, peer)
  const initial = (await api.call('state', { avatars: 'ref' })).bots
  const chief = await api.call('avatar', { botId: 'chief' })
  assert.equal(chief.ref, initial[0].avatar.imageRef)
  assert.match(chief.image, /^data:image\/svg\+xml;base64,/)
  assert.equal(initial[1].avatar.imageRef, photo.ref)
  assert.deepEqual(await api.call('avatar', { botId: 'photo' }), photo)
  color = 'red'
  assert.notEqual((await api.call('state', { avatars: 'ref' })).bots[0].avatar.imageRef, chief.ref)
  await peer.dispose()
})

test('附件提交绑定当前 Bot 会话，角色设置只透传明示字段', async () => {
  const peer = createTestPeer()
  const submissions = []
  const settings = []
  let readOnly = null
  const api = createBotAdapter({ async fetch(request) {
    const { endpoint, payload } = await request.json()
    if (endpoint === 'state') return Response.json({ ok: true, value: {
      rooms: [{ id: 'room', sessionId: 'current' }], readOnly,
    } })
    settings.push(payload)
    return Response.json({ ok: true, value: true })
  } }, peer, undefined, async (sessionId, payload) => submissions.push({ sessionId, payload }))
  const target = { chatId: 'room', sessionId: 'current', text: 'see file', receipts: ['receipt'] }
  assert.equal(await api.call('send-attachments', target), true)
  await assert.rejects(api.call('send-attachments', { ...target, sessionId: 'older' }), { code: 'bot/stale' })
  readOnly = 'Locked'
  await assert.rejects(api.call('send-attachments', target), { code: 'bot/stale' })
  assert.deepEqual(submissions, [{ sessionId: 'current', payload: target }])
  await api.call('update-bot', { id: 'chief', name: 'New name', model: null })
  await assert.rejects(api.call('update-bot', { id: 'chief', browserGrants: {} }), { code: 'bad-request' })
  assert.deepEqual(settings, [{ id: 'chief', name: 'New name', model: null }])
  await peer.dispose()
})

test('reference candidates use the current authorized Bot session, including group sessions', async () => {
  const peer = createTestPeer()
  const lookups = []
  const api = createBotAdapter({ async fetch(request) {
    const { endpoint } = await request.json()
    assert.equal(endpoint, 'state')
    return Response.json({ ok: true, value: {
      bots: [{ id: 'chief', sessionId: 'chief-current' }],
      rooms: [{ id: 'group', sessionId: 'group-current' }],
    } })
  } }, peer, undefined, undefined, async (sessionId, query, quoted) => {
    lookups.push({ sessionId, query, quoted })
    return { items: [] }
  })
  await api.forConnection().call('reference-candidates', { chatId: 'group', query: 'draft notes/', quoted: true })
  await assert.rejects(api.call('reference-candidates', { chatId: 'chief-old', query: '' }), { code: 'bot/stale' })
  await assert.rejects(api.call('reference-candidates', { chatId: 'chief', query: 'a\nb' }), { code: 'bad-request' })
  assert.deepEqual(lookups, [{ sessionId: 'group-current', query: 'draft notes/', quoted: true }])
  await peer.dispose()
})

test('Bot creation limits upstream fields and reuses the fixed local Agent avatar', async () => {
  const peer = createTestPeer()
  const forwarded = []
  const api = createBotAdapter({ async fetch(request) {
    const entry = await request.json()
    forwarded.push(entry)
    const result = {
      hello: { ...hello, capabilities: ['write-state'] },
      'local-agents': { detected: [{ route: 'local-codex-cli', name: 'Codex CLI', path: '/host/private', signIn: { path: '/host/token' }, signedIn: true }] },
      'local-agent-models': [{ id: 'example', name: 'Example', data: 'private' }],
      'create-bot': { id: 'new-bot', avatar: { internal: 'private' } },
    }
    return Response.json({ ok: true, value: result[entry.endpoint] })
  } }, peer)

  assert.ok((await api.call('hello')).capabilities.includes('bot-creation'))
  const catalog = await api.call('creation-appearance')
  assert.equal(catalog.shapes.length, 20)
  assert.equal(catalog.colors.length, 12)
  assert.ok(catalog.shapes.every(shape => shape.images.violet.startsWith('data:image/svg+xml;base64,')))
  const { items: [agent] } = await api.call('local-agents', { path: '/unused' })
  assert.deepEqual(Object.keys(agent).sort(), ['available', 'id', 'image', 'signedIn', 'title'])
  assert.deepEqual(await api.call('local-agent-models', { route: agent.id }), { items: [{ id: 'local-codex-cli/example', title: 'Example' }] })
  const draft = { name: 'New Bot', color: 'violet', avatar: { shape: 'star' }, model: 'local-codex-cli/default' }
  assert.deepEqual(await api.call('create-bot', { ...draft, agentAppearance: true }), { id: 'new-bot' })
  assert.deepEqual(forwarded.at(-1).payload, { ...draft, avatar: { ...draft.avatar, image: agent.image } })
  const requestCount = forwarded.length
  for (const malformed of [
    { ...draft, workDir: '/host/private' },
    { ...draft, name: { trim: true } },
    { ...draft, avatar: { shape: 'star', image: agent.image } },
    { ...draft, model: 'other/default', agentAppearance: true },
  ]) {
    await assert.rejects(api.call('create-bot', malformed), { code: 'bad-request' })
  }
  assert.equal(forwarded.length, requestCount)
  await peer.dispose()
})


test('新建会话沿用 Web 默认群聊规则，管理员必须为第一位，隐藏 Bot 可以恢复', async () => {
  const peer = createTestPeer()
  const calls = []
  let readOnly = false
  const api = createBotAdapter({ async fetch(request) {
    const body = await request.json()
    calls.push(body)
    if (body.endpoint === 'hello') return Response.json({ ok: true, value: { ...hello, capabilities: ['write-state'] } })
    if (body.endpoint === 'state') return Response.json({ ok: true, value: {
      readOnly, bots: [{ id: 'chief' }, { id: 'hidden', hidden: true }], rooms: [{ id: 'room' }],
    } })
    if (body.endpoint === 'create-room') return Response.json({ ok: true, value: {
      id: 'new', name: '主机默认群名', members: body.payload.members, sessionId: 'session-new', secret: 'never forward',
    } })
    return Response.json({ ok: true, value: true })
  } }, peer)
  try {
    assert.ok((await api.call('hello')).capabilities.includes('bot-conversations'))
    const payload = { members: ['hidden', 'chief'], admin: 'hidden', greet: true }
    assert.deepEqual(await api.call('create-room', payload), {
      id: 'new', name: '主机默认群名', members: ['hidden', 'chief'], sessionId: 'session-new',
    })
    assert.deepEqual(calls.at(-1), { endpoint: 'create-room', payload })
    assert.deepEqual(await api.call('set-flags', { id: 'hidden', hidden: false }), { id: 'hidden' })
    for (const bad of [
      { members: ['chief'], admin: 'chief' }, { members: ['chief', 'chief'], admin: 'chief' },
      { ...payload, admin: 'chief' }, { ...payload, mode: 'all' }, { ...payload, greet: 'yes' },
    ]) await assert.rejects(api.call('create-room', bad), { code: 'bad-request' })
    await assert.rejects(api.call('create-room', { members: ['chief', 'room'], admin: 'chief' }), { code: 'bot/stale' })
    await assert.rejects(api.call('set-flags', { id: 'hidden', hidden: true }), { code: 'bad-request' })
    await assert.rejects(api.call('set-flags', { id: 'hidden', hidden: false, pinned: true }), { code: 'bad-request' })
    readOnly = true
    const before = calls.filter(call => ['create-room', 'set-flags'].includes(call.endpoint)).length
    await assert.rejects(api.call('create-room', payload), { code: 'bot/read-only' })
    await assert.rejects(api.call('set-flags', { id: 'hidden', hidden: false }), { code: 'bot/read-only' })
    assert.equal(calls.filter(call => ['create-room', 'set-flags'].includes(call.endpoint)).length, before)
  } finally { await peer.dispose() }
})
