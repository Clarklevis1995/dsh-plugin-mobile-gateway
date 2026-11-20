import test from 'node:test'
import assert from 'node:assert/strict'
import { createBotImages } from '../lib/bot-images.mjs'
import { createBotAdapter, createBotChannel } from '../lib/bot-bridge.mjs'
import { createTestPeer } from './helpers/peer.mjs'

const signal = () => new AbortController().signal
const state = { bots: [{ id: 'chief', name: 'Chief', sessionId: 'dm', parts: ['old'], openParts: [{ sessionId: 'background', parts: ['bg-old'] }] }],
  rooms: [{ id: 'team', sessionId: 'room', ownParts: ['room-old'], parts: ['member-private', 'member-old', 'room-old'] }], exchangeTurns: { dm: [2] } }
const ref = { attachmentId: 'generated', mediaType: 'image/png', width: 2, height: 2, bytes: 4 }
const image = { type: 'image', attachment: ref }
const event = (seq, type, turn, content = [image]) => ({ seq, type, time: 1000 + seq,
  data: { ...(turn === undefined ? {} : { turn }), ...(type === 'user/message' ? { content } : { message: { content } }) } })
const start = (seq, turn) => ({ seq, type: 'turn/start', data: { turn } })
const defaults = { readPage: async () => ({ events: [], hasMore: false, cursor: 0 }),
  attachment: async () => ({ attachment: ref, data: Buffer.from('test').toString('base64') }), files: {} }
const images = options => createBotImages({ ...defaults, ...options })
const tick = () => new Promise(resolve => setImmediate(resolve))

test('私聊 assistant/tool 图片复用普通引用解析，隐藏与未知轮次不投影，公开文字保留', async () => {
  const rows = [event(0, 'tool/result'), start(1, 1), event(2, 'assistant/message', 1),
    event(3, 'tool/result'), start(4, 2), event(5, 'assistant/message', 2), event(6, 'tool/result'),
    start(7, 3), { ...event(8, 'user/message', 3, []), data: { turn: 3, content: [], source: { role: 'request' } } }, event(9, 'tool/result'),
    start(10, 4), { ...event(11, 'tool/result'), data: { meta: { kind: 'dsh-image-gen', attachment: { ...ref, attachmentId: 'meta' } } } }]
  const api = images({ readPage: async () => ({ events: rows, cursor: 11, hasMore: false }) })
  const page = await api.enrich('chat', { botId: 'chief' }, { items: [{ kind: 'bot', seq: 2, text: '公开回复', turn: 1 }], cursor: null }, state, signal())
  assert.deepEqual(page.items.map(item => item.seq), [2, 3, 11])
  assert.equal(page.items[0].text, '公开回复')
  assert.equal(page.items[0].imageRefs[0].sessionId, 'dm')
  assert.equal(page.items[2].imageRefs[0].attachmentId, 'meta')
})

test('归档分页保留原会话，向前查找 turn 不把前一页图片带进当前页', async () => {
  const calls = []
  const api = images({ readPage: async request => {
    calls.push(request)
    return request.beforeSeq === 8 ? { events: [start(1, 1), event(2, 'tool/result', 1)], cursor: 20, hasMore: false }
      : { events: [event(8, 'tool/result'), event(9, 'assistant/message', 1)], cursor: 20, hasMore: true }
  } })
  const page = await api.enrich('chat', { botId: 'chief', cursor: { part: 0, beforeSeq: 10 } },
    { items: [{ kind: 'bot', seq: 9, turn: 1, text: '旧消息' }], cursor: { part: 0, beforeSeq: 8 } }, state, signal())
  assert.deepEqual(page.items.map(item => item.seq), [8, 9])
  assert.ok(page.items.every(item => item.sessionId === 'old'))
  assert.equal(calls[1].throughSeq, 20)
})

test('群聊只补充可精确匹配的公开行；不读取和猜测成员内部图片', async () => {
  const calls = []
  const api = images({ readPage: async ({ sessionId }) => { calls.push(sessionId); return {
    events: [start(0, 1), event(1, 'user/message', 1), event(2, 'tool/result', 1)], cursor: 2, hasMore: false } } })
  const page = await api.enrich('room-chat', { roomId: 'team' }, { items: [
    { id: '1', kind: 'user', text: '公开图片' }, { id: 'relay:0', kind: 'bot', botId: 'chief', text: '公开发言' },
  ], cursor: null }, state, signal())
  assert.deepEqual(calls, ['room'])
  assert.equal(page.items.length, 2)
  assert.equal(page.items[0].imageRefs[0].sessionId, 'room')
  assert.equal(page.items[1].imageRefs, undefined)
})

test('私聊补齐已完成的协作动态和原生问答，保留顺序并过滤隐藏、失败和无关工具', async () => {
  const call = (seq, name, args) => ({ seq, type: 'tool/call', data: { callId: String(seq), name, arguments: JSON.stringify(args) } })
  const result = (seq, origin, text, outcome = { isError: false }) => ({
    seq, time: 1000 + seq, type: 'tool/result',
    data: { message: { toolCallId: String(origin), content: [{ type: 'text', text }], ...outcome } },
  })
  const rows = [start(1, 1),
    call(2, 'create_bot', { name: '研究员', instructions: '内部说明' }), result(3, 2, 'Created 研究员. It is greeting the user now.'),
    call(4, 'message_bot', { to: '研究员', message: '内部消息' }), result(5, 4, 'Delivered to 研究员.', { ok: true }),
    call(6, 'message_bot', { to: '研究员' }), result(7, 6, 'You cannot message yourself.'),
    call(8, 'message_bot', { to: '研究员' }), result(9, 8, 'Delivered to 研究员.', { ok: false }),
    call(10, 'read_file', { name: '研究员' }), result(11, 10, 'Created 研究员.'),
    call(12, 'ask_user_question', { questions: [{ question: '关注什么？', options: ['A', { label: '架构' }, 'C', '对比'] }] }),
    result(13, 12, JSON.stringify({ answers: [{ selected: ['架构', '对比'] }] })),
    start(15, 2), call(16, 'create_bot', { name: '隐藏成员' }), result(17, 16, 'Created 隐藏成员.') ]
  const roster = { ...state, bots: [...state.bots, { id: 'research', name: '研究员' }] }
  const api = images({ readPage: async () => ({ events: rows, cursor: 17, hasMore: false }) })
  const original = { items: [{ seq: 1, turn: 1, kind: 'user' }, { seq: 14, turn: 1, kind: 'bot' },
    { seq: 15, turn: 2, kind: 'user' }], cursor: null }
  const page = await api.enrich('chat', { botId: 'chief', historyDetails: true }, original, roster, signal())
  assert.deepEqual(page.items.map(item => item.seq), [1, 3, 5, 13, 14, 15])
  assert.deepEqual(page.items.slice(1, 3).map(item => [item.event, item.botId, item.name, item.time]),
    [['bot-created', 'research', '研究员', 1003], ['bot-messaged', 'research', '研究员', 1005]])
  assert.deepEqual(page.items[3].questions[0].options, ['A', '架构', 'C', '对比'])
  assert.deepEqual(page.items[3].answers[0].selected, ['架构', '对比'])
  assert.doesNotMatch(JSON.stringify(page), /内部消息|内部说明|隐藏成员/)
  const legacy = await api.enrich('chat', { botId: 'chief' }, original, roster, signal())
  assert.deepEqual(legacy.items.map(item => item.seq), [1, 14, 15])
})

test('交付文件作为独立会话行，保留路径、说明和归档来源，隐藏轮次及群成员内部文件不投影', async () => {
  const present = (seq, turn, path, description) => ({
    seq, time: 1000 + seq, type: 'deliverables/presented', data: { turn, files: [{ path, description }] },
  })
  const api = images({ readPage: async () => ({
    events: [start(1, 1), present(3, 1, '/workspace/reports/report.md', '调研报告'),
      start(5, 2), present(7, 2, 'hidden.md'), start(9, 3), present(10, 3, 'directory/'),
      start(11, 4), { ...event(12, 'user/message', 4, []), data: { source: { kind: 'bot', role: 'reply' } } },
      present(13, 4, 'file-only.md')],
    cursor: 13, hasMore: false,
  }) })
  const value = { items: [{ seq: 2, turn: 1, kind: 'bot' }, { seq: 4, turn: 1, kind: 'bot' },
    { seq: 9, turn: 3, kind: 'bot' }], cursor: null }
  const roster = { ...state, exchangeTurns: { old: [2] } }
  const page = await api.enrich('chat', { botId: 'chief', cursor: { part: 0 }, historyDetails: true }, value, roster, signal())
  assert.deepEqual(page.items.map(item => item.seq), [2, 3, 4, 9, 13])
  assert.deepEqual(page.items[1], { seq: 3, turn: 1, time: 1003, kind: 'file', sessionId: 'old',
    files: [{ path: '/workspace/reports/report.md', description: '调研报告' }] })
  const group = await api.enrich('room-chat', { roomId: 'team', historyDetails: true }, value, roster, signal())
  assert.deepEqual(group.items.map(item => item.seq), [2, 4, 9])
})

test('附件大图分块重组一致，预览与原图复用缓存，归属与偏移先校验', async () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 7, 123)
  let reads = 0
  const api = images({ attachment: async ({ sessionId, attachmentId }) => {
    assert.equal(sessionId, 'old'); assert.equal(attachmentId, 'generated'); reads++
    return { attachment: ref, data: bytes.toString('base64') }
  } })
  const parts = []
  let offset = 0, rev
  while (offset < bytes.length) {
    const part = await api.read('image', { sessionId: 'old', attachmentId: 'generated', offset }, state, signal())
    assert.ok(JSON.stringify(part).length < 4 * 1024 * 1024)
    assert.equal(part.offset, offset); assert.equal(part.done, part.nextOffset === bytes.length)
    if (rev) assert.equal(part.rev, rev)
    rev = part.rev; offset = part.nextOffset; parts.push(Buffer.from(part.data, 'base64'))
  }
  assert.deepEqual(Buffer.concat(parts), bytes)
  await api.read('image', { sessionId: 'old', attachmentId: 'generated', preview: true }, state, signal())
  assert.equal(reads, 1)
  for (const payload of [{ sessionId: 'foreign' }, { sessionId: 'old', offset: -1 }, { sessionId: 'old', offset: bytes.length }]) {
    await assert.rejects(api.read('image', { attachmentId: 'generated', ...payload }, state, signal()), { code: 'bot-image-invalid' })
  }
  assert.equal(reads, 1)
})

test('Bot 别名、归档和后台会话归属由公开状态决定，缓存不能绕过最新归属', async () => {
  const seen = []
  const api = images({ attachment: async payload => { seen.push(payload.sessionId); return defaults.attachment() } })
  for (const sessionId of ['chief', 'old', 'background', 'bg-old', 'member-old', 'room-old']) {
    await api.read('image', { sessionId, attachmentId: 'generated' }, state, signal())
  }
  assert.deepEqual(seen, ['dm', 'old', 'background', 'bg-old', 'member-old', 'room-old'])
  await assert.rejects(api.read('image', { sessionId: 'old', attachmentId: 'generated' }, { bots: [], rooms: [] }, signal()))
})

test('工作区图片只走官方 stat/readBytes，版本变化和不合法路径拒绝', async () => {
  const bytes = Buffer.alloc(800_000, 42)
  const seen = []
  const files = {
    async stat(payload) { seen.push(payload); return { absolutePath: '/workspace/plot.png', bytes: bytes.length, version: 'v1' } },
    async readBytes(payload) { seen.push(payload); return { data: bytes.subarray(payload.offset, payload.offset + payload.length),
      offset: payload.offset, bytes: bytes.length, version: 'v1' } },
  }
  const api = images({ files })
  const part = await api.read('markdown-image', { sessionId: 'chief', path: './plot.png' }, state, signal())
  assert.equal(part.size, bytes.length)
  assert.equal(seen.length, 4)
  assert.ok(seen.every(payload => payload.sessionId === 'dm'))
  assert.equal(seen[1].path, '/workspace/plot.png')
  for (const path of ['https://a/plot.png', 'file:///tmp/plot.png', './plot.txt', 'bad\0.png']) {
    await assert.rejects(api.read('markdown-image', { sessionId: 'chief', path }, state, signal()), { code: 'bot-image-invalid' })
  }
  const changed = images({ files: { ...files, async readBytes(payload) { return { ...await files.readBytes(payload), version: 'v2' } } } })
  await assert.rejects(changed.read('markdown-image', { sessionId: 'chief', path: './plot.png' }, state, signal()), /changed/)
})

test('官方会话图片、协作和问答只触发重读，切换与取消后旧 watcher 不再发消息', async () => {
  const watchers = [], received = []
  const api = images({ watch: (sessionId, signal, notify) => new Promise(resolve => {
    watchers.push({ sessionId, signal, notify }); signal.addEventListener('abort', resolve, { once: true })
  }) })
  const abort = new AbortController()
  const stop = api.listen(event => received.push(event), error => assert.fail(error), abort.signal)
  await api.enrich('chat', { botId: 'chief', historyDetails: true }, { items: [] }, state, signal())
  watchers[0].notify(event(1, 'tool/result', 1))
  assert.deepEqual(received[0], { event: 'message', data: { botId: 'chief', sessionId: 'dm' } })
  watchers[0].notify({ type: 'tool/call', data: { name: 'message_bot', callId: '1' } })
  watchers[0].notify({ type: 'tool/result', data: { message: { toolCallId: '1', isError: false } } })
  watchers[0].notify({ type: 'user/message', data: { source: { kind: 'user-question-reply' } } })
  assert.deepEqual(received, [received[0], received[0], received[0]])
  await api.enrich('room-chat', { roomId: 'team' }, { items: [] }, state, signal())
  assert.equal(watchers[0].signal.aborted, true)
  watchers[0].notify(event(2, 'tool/result', 1))
  assert.equal(received.length, 3)
  stop()
  assert.equal(watchers[1].signal.aborted, true)
})

test('兼容能力来自我们网关，官方插件不必识别图片端点；多设备订阅独立', async () => {
  const peer = createTestPeer(), watchers = [], controllers = [], sent = [[], []]
  const source = images({ watch: (sessionId, signal, notify) => new Promise(resolve => {
    watchers.push({ sessionId, signal, notify }); signal.addEventListener('abort', resolve, { once: true })
  }) })
  const upstream = []
  const api = createBotAdapter({ async fetch(request) {
    if (request.method === 'GET') return new Response(new ReadableStream({ start(c) { controllers.push(c) } }),
      { headers: { 'content-type': 'text/event-stream' } })
    const body = await request.json(); upstream.push(body.endpoint)
    const value = body.endpoint === 'hello' ? { api: 1, capabilities: ['chat', 'feed'] }
      : body.endpoint === 'state' ? { ...state, phone: { secret: true } } : { items: [], cursor: null }
    return Response.json({ ok: true, value })
  } }, peer, source)
  const hello = await api.call('hello')
  assert.equal(hello.imageBridge.provider, 'mobile-gateway')
  assert.deepEqual(hello.imageBridge.agentImageScopes, ['private-chat'])
  await api.call('image', { sessionId: 'chief', attachmentId: 'generated' })
  assert.equal(upstream.includes('image'), false)
  const aborts = [new AbortController(), new AbortController()]
  const channels = sent.map((frames, index) => createBotChannel(api, { send: frame => frames.push(frame), signal: aborts[index].signal }))
  for (const [index, channel] of channels.entries()) {
    await channel.handle({ type: 'bot-subscribe', requestId: `sub${index}` }); await tick()
    await channel.handle({ type: 'bot-call', requestId: `chat${index}`, endpoint: index ? 'room-chat' : 'chat',
      payload: index ? { roomId: 'team' } : { botId: 'chief' } })
  }
  assert.deepEqual(watchers.map(w => w.sessionId), ['dm', 'room'])
  watchers[0].notify(event(1, 'tool/result', 1)); await tick()
  assert.equal(sent[0].at(-1).botEvent, 'message')
  assert.equal(sent[1].some(frame => frame.botEvent === 'message'), false)
  aborts.forEach(abort => abort.abort()); await tick()
  assert.ok(watchers.every(w => w.signal.aborted))
  await peer.dispose()
})


test('公开状态切换分段时重建监听；旧订阅清理不能关闭新订阅', async () => {
  const watches = []
  const api = images({ watch: (sessionId, signal) => new Promise(resolve => {
    watches.push({ sessionId, signal }); signal.addEventListener('abort', resolve, { once: true })
  }) })
  const first = new AbortController(), second = new AbortController()
  const offFirst = api.listen(() => {}, assert.fail, first.signal)
  await api.enrich('chat', { botId: 'chief' }, { items: [] }, state, signal())
  const offSecond = api.listen(() => {}, assert.fail, second.signal)
  offFirst()
  assert.equal(watches[1].signal.aborted, false)
  api.updateState({ ...state, bots: [{ ...state.bots[0], sessionId: 'new-dm' }] })
  assert.equal(watches[1].signal.aborted, true)
  assert.equal(watches[2].sessionId, 'new-dm')
  offSecond()
  assert.equal(watches[2].signal.aborted, true)
})


test('读聊天期间发生分段切换时，旧快照图片仍归属旧会话', async () => {
  const sessions = []
  const api = images({ readPage: async ({ sessionId }) => {
    sessions.push(sessionId); return { events: [start(1, 1), event(2, 'assistant/message', 1)], hasMore: false }
  } })
  const nextState = { ...state, bots: [{ ...state.bots[0], parts: ['old', 'dm'], sessionId: 'new-dm' }] }
  const page = await api.enrich('chat', { botId: 'chief' }, { sessionId: 'dm', items: [] }, nextState, signal())
  assert.deepEqual(sessions, ['dm'])
  assert.equal(page.items[0].imageRefs[0].sessionId, 'dm')
})
