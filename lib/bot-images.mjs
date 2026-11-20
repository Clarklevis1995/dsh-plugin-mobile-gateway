import { createHash } from 'node:crypto'
import { toolImages } from './tool-images.mjs'

const MAX_IMAGE = 16 * 1024 * 1024
const CHUNK = 384 * 1024
const MIMES = new Map([['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'], ['gif', 'image/gif'], ['bmp', 'image/bmp']])
const fail = message => Object.assign(new Error(message), { code: 'bot-image-invalid' })
const chainOf = (entry, room = false) => [...(entry[room ? 'ownParts' : 'parts'] ?? []), entry.sessionId].filter(Boolean)
const imageRefs = event => toolImages({ ...event.data, message: event.data?.message ?? { content: event.data?.content } })
const historyTools = new Set(['create_bot', 'message_bot', 'ask_user_question'])
const toolSucceeded = message => message?.isError !== true
  && (message?.ok === true || (message?.ok === undefined && message?.isError === false))

function parseObject(value) {
  try { return typeof value === 'string' ? JSON.parse(value) : value }
  catch { return undefined }
}

function taskUpdate(call, message, roster) {
  const args = parseObject(call.arguments)
  const result = Array.isArray(message.content) ? message.content.find(block => block?.type === 'text')?.text : undefined
  if (typeof result !== 'string') return
  if (call.name === 'ask_user_question') {
    const question = args?.questions?.[0]
    const answer = parseObject(result)?.answers?.[0]
    const prompt = question?.question || question?.header
    if (typeof prompt !== 'string' || !prompt.trim() || !answer) return
    const options = Array.isArray(question.options)
      ? question.options.slice(0, 26).map(option => typeof option === 'string' ? option : option?.label) : []
    const selected = Array.isArray(answer.selected) ? answer.selected.filter(label => typeof label === 'string').slice(0, 26) : []
    const custom = typeof answer.custom === 'string' ? answer.custom : ''
    if (!selected.length && !custom.trim()) return
    return { kind: 'answer', questions: [{ id: 'question', question: prompt, options }],
      answers: [{ id: 'question', selected, custom }] }
  }
  const created = call.name === 'create_bot'
  const target = created ? args?.name : args?.to
  if (typeof target !== 'string' || !target.trim() || target.length > 256) return
  // Some DS Bot tools return a refusal as text with ok=true. Check the success receipt.
  const prefixes = created ? ['Created '] : ['Delivered to ', 'Queued for ']
  if (!prefixes.some(prefix => result.startsWith(prefix))) return
  const member = roster.find(bot => bot.name?.toLowerCase() === target.trim().toLowerCase())
  return { kind: 'event', event: created ? 'bot-created' : 'bot-messaged',
    name: member?.name ?? target.trim(), ...(member ? { botId: member.id } : {}) }
}

function insertHistoryItem(items, item) {
  const at = items.findIndex(other => Number.isFinite(other.seq) && other.seq > item.seq)
  items.splice(at < 0 ? items.length : at, 0, item)
}

function presentedFiles(event) {
  return (Array.isArray(event.data?.files) ? event.data.files : []).slice(0, 20).flatMap(file => {
    const path = typeof file?.path === 'string' ? file.path.trim() : ''
    if (!path || path.length > 4096 || path.endsWith('/') || /[\x00-\x1f\x7f]/u.test(path)) return []
    return [{ path, ...(typeof file.description === 'string' ? { description: file.description.slice(0, 4096) } : {}) }]
  })
}

// 只适配公开 Bot 状态和已有会话/附件/工作区文件能力，不读取 DS-Bot 内部文件或运行时。
export function createBotImages({ readPage, attachment, files, watch }) {
  const cache = new Map()
  const pending = new Map()
  let cacheBytes = 0
  let target, listener, watches
  const owns = (state, session) => state.bots?.some(bot => [...chainOf(bot),
    ...(bot.openParts ?? []).flatMap(part => chainOf(part))].includes(session))
    || state.rooms?.some(room => [...chainOf(room, true), ...(room.parts ?? [])].includes(session))

  async function events(sessionId, beforeSeq, lower, signal) {
    let rows = [], throughSeq
    // 补充范围与上游分页相同；最多向前寻找八页 turn/start，未知轮次的图片不发布。
    for (let pageIndex = 0; pageIndex < 8; pageIndex++) {
      const page = await readPage({ sessionId, beforeSeq, throughSeq }, signal)
      throughSeq ??= page.cursor
      const batch = page.events
      if (!Array.isArray(batch) || !batch.length) break
      if (pageIndex === 0 && lower === -Infinity) lower = batch[0].seq
      rows = [...batch, ...rows]
      if (!page.hasMore || (batch[0].seq <= lower && rows.some(e => e.seq <= lower && e.type === 'turn/start'))) break
      const next = batch[0].seq
      if (!Number.isSafeInteger(next) || (beforeSeq !== undefined && next >= beforeSeq)) throw fail('History did not advance')
      beforeSeq = next
    }
    let turn
    return { lower, rows: rows.map(event => {
      if (event.type === 'turn/start') turn = event.data?.turn
      return { ...event, imageTurn: Number.isSafeInteger(event.data?.turn) ? event.data.turn : turn }
    }) }
  }
  function restart() {
    watches?.abort()
    if (!listener || !target || !watch) return
    const current = target, subscriber = listener
    const abort = watches = new AbortController()
    const signal = AbortSignal.any([abort.signal, subscriber.signal])
    const calls = new Set()
    void watch(current.session, signal, event => {
      if (signal.aborted) return
      let updated = false
      if (current.details) {
        if (event.type === 'deliverables/presented') updated = true
        if (event.type === 'turn/start') calls.clear()
        if (event.type === 'tool/call' && historyTools.has(event.data?.name)
          && typeof event.data.callId === 'string') calls.add(event.data.callId)
        if (event.type === 'tool/result') {
          const message = event.data?.message
          updated = calls.delete(message?.toolCallId) && toolSucceeded(message)
        }
        if (event.type === 'user/message' && event.data?.source?.kind === 'user-question-reply') updated = true
      }
      if (!updated && !imageRefs(event).length) return
      // 只触发重新读取公开聊天，不把原始会话事件直接发送到聊天列表。
      subscriber.notify({ event: current.room ? 'room' : 'message',
        data: { [current.room ? 'roomId' : 'botId']: current.id, sessionId: current.session } })
    }).catch(error => { if (!signal.aborted) subscriber.fail(error) })
  }
  async function enrich(endpoint, payload, value, state, signal, track = true) {
    if (!Array.isArray(value?.items)) return value
    const room = endpoint === 'room-chat'
    const entry = (room ? state.rooms : state.bots)?.find(item => item.id === payload[room ? 'roomId' : 'botId'])
    if (!entry) return value
    const chain = chainOf(entry, room)
    const index = payload.cursor?.part ?? (!room && value.sessionId
      ? chain.indexOf(value.sessionId) : chain.length - 1)
    if (!Number.isSafeInteger(index) || index < 0 || index >= chain.length) return value
    const session = chain[index]
    if (!session) return value
    const metadata = !room && payload.historyDetails === true
    const next = { id: entry.id, room, session: entry.sessionId, details: metadata }
    if (track && JSON.stringify(next) !== JSON.stringify(target)) { target = next; restart() }
    let lower = value.cursor?.part === index && Number.isSafeInteger(value.cursor?.beforeSeq) ? value.cursor.beforeSeq : -Infinity
    const history = await events(session, payload.cursor?.beforeSeq, lower, signal)
    const rows = history.rows
    lower = history.lower
    const items = value.items.map(item => ({ ...item, sessionId: item.sessionId ?? session }))
    const hidden = new Set(state.exchangeTurns?.[session] ?? [])
    const privateTurns = new Set(rows.filter(event => event.type === 'user/message'
      && ['request', 'stopped'].includes(event.data?.source?.role)).map(event => event.imageTurn))
    // Only reconstruct collaboration in private conversations that DS Bot exposes.
    const visibleTurns = new Set(items.filter(item => ['user', 'bot', 'answer'].includes(item.kind)).map(item => item.turn))
    for (const event of rows) {
      if (event.type !== 'user/message') continue
      const source = event.data?.source
      if (source?.kind === 'user' || source?.kind === 'schedule' ||
          (source?.kind === 'bot' && ['reply', 'report'].includes(source.role) && source.handoff !== true && source.deferred !== true)) {
        visibleTurns.add(event.imageTurn)
      }
    }
    const calls = new Map()
    for (const event of rows) {
      const turn = event.imageTurn
      if (metadata && Number.isSafeInteger(turn) && visibleTurns.has(turn) && !hidden.has(turn) && !privateTurns.has(turn)) {
        if (event.type === 'deliverables/presented' && event.seq >= lower) {
          const files = presentedFiles(event)
          if (files.length) insertHistoryItem(items, { kind: 'file', seq: event.seq, time: event.time, turn, sessionId: session, files })
        }
        if (event.type === 'tool/call' && historyTools.has(event.data?.name)
          && typeof event.data.callId === 'string') calls.set(event.data.callId, { data: event.data, turn })
        if (event.type === 'tool/result') {
          const message = event.data?.message
          const call = calls.get(message?.toolCallId)
          calls.delete(message?.toolCallId)
          if (call?.turn === turn && event.seq >= lower && toolSucceeded(message)) {
            const item = taskUpdate(call.data, message, state.bots ?? [])
            if (item) insertHistoryItem(items, { ...item, seq: event.seq, time: event.time, turn, sessionId: session })
          }
        }
      }
      if (event.seq < lower) continue
      const refs = imageRefs(event)
      if (!refs.length || hidden.has(event.imageTurn) || privateTurns.has(event.imageTurn)) continue
      let current = items.find(item => Number(item.seq ?? item.id) === event.seq && ['bot', 'user', 'post'].includes(item.kind))
      if (!current) {
        // 群成员内部输出缺少可靠的公开发言来源映射，不能猜测作者后暴露给群聊。
        if (room || !Number.isSafeInteger(event.imageTurn) || !['assistant/message', 'tool/result'].includes(event.type)) continue
        current = { kind: 'bot', id: `image:${session}:${event.seq}`, seq: event.seq, text: '', time: event.time,
          turn: event.imageTurn, botId: entry.id, name: entry.name, sessionId: session }
        insertHistoryItem(items, current)
      }
      current.imageRefs = [...(current.imageRefs ?? []), ...refs.map(ref => ({ ...ref, mime: ref.mediaType, sessionId: session }))]
        .filter((ref, i, all) => all.findIndex(other => other.attachmentId === ref.attachmentId && (other.sessionId ?? session) === (ref.sessionId ?? session)) === i)
    }
    return { ...value, items }
  }
  async function load(endpoint, payload, sessionId, signal) {
    let bytes, mime
    if (endpoint === 'image') {
      if (typeof payload.attachmentId !== 'string' || !payload.attachmentId.trim()) throw fail('Missing attachment id')
      // 与普通会话共用历史引用归属检查以及官方 session.attachment 字节读取。
      const value = await attachment({ sessionId, attachmentId: payload.attachmentId }, signal)
      bytes = Buffer.from(value.data, 'base64'); mime = value.attachment?.mediaType
    } else {
      const path = payload.path
      mime = typeof path === 'string' ? MIMES.get(path.split('.').at(-1).toLowerCase()) : undefined
      if (!mime || !path || path.includes('\0') || /^[a-z][a-z\d+.-]*:\/\//i.test(path)) throw fail('Invalid workspace image path')
      const stat = await files.stat({ sessionId, path }, signal)
      if (!Number.isSafeInteger(stat.bytes) || stat.bytes < 1 || stat.bytes > MAX_IMAGE) throw fail('Workspace image is too large')
      bytes = Buffer.alloc(stat.bytes)
      for (let offset = 0; offset < bytes.length;) {
        const part = await files.readBytes({ sessionId, path: stat.absolutePath, offset, length: Math.min(CHUNK, bytes.length - offset) }, signal)
        if (!(part.data instanceof Uint8Array) || !part.data.length || part.offset !== offset || part.version !== stat.version
          || part.bytes !== stat.bytes || part.data.length > bytes.length - offset) throw fail('Workspace image changed')
        bytes.set(part.data, offset); offset += part.data.length
      }
    }
    signal.throwIfAborted()
    if (![...MIMES.values()].includes(mime) || !bytes.length || bytes.length > MAX_IMAGE) throw fail('Invalid image')
    return { bytes, mime, at: Date.now(), rev: createHash('sha256').update(bytes).digest('hex') }
  }
  async function read(endpoint, payload, state, signal) {
    const offset = payload.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= MAX_IMAGE) throw fail('Invalid image offset')
    const alias = state.bots?.find(bot => bot.id === payload.sessionId) ?? state.rooms?.find(room => room.id === payload.sessionId)
    const session = alias?.sessionId ?? payload.sessionId
    if (!session || !owns(state, session)) throw fail('Image session is not owned by this Bot team')
    const key = JSON.stringify([session, endpoint, payload.attachmentId, payload.path])
    let entry = cache.get(key)
    if (entry && Date.now() - entry.at > 20_000) { cache.delete(key); cacheBytes -= entry.bytes.length; entry = undefined }
    if (!entry) {
      if (!pending.has(key)) pending.set(key, load(endpoint, payload, session, signal).then(value => {
        cache.set(key, value); cacheBytes += value.bytes.length
        while (cache.size > 8 || cacheBytes > 32 * 1024 * 1024) {
          const first = cache.keys().next().value; cacheBytes -= cache.get(first).bytes.length; cache.delete(first)
        }
        return value
      }).finally(() => pending.delete(key)))
      entry = await pending.get(key)
    }
    signal.throwIfAborted()
    if (offset >= entry.bytes.length) throw fail('Invalid image offset')
    const nextOffset = Math.min(entry.bytes.length, offset + CHUNK)
    return { mime: entry.mime, data: entry.bytes.subarray(offset, nextOffset).toString('base64'), offset, nextOffset,
      size: entry.bytes.length, done: nextOffset === entry.bytes.length, rev: entry.rev }
  }
  function updateState(state) {
    if (!target || !Array.isArray(state.bots) || !Array.isArray(state.rooms)) return
    const entry = (target.room ? state.rooms : state.bots).find(item => item.id === target.id)
    if (!entry) { target = undefined; watches?.abort(); return }
    if (entry.sessionId && entry.sessionId !== target.session) {
      target = { ...target, session: entry.sessionId }; restart()
    }
  }
  return { enrich, read, updateState, fork: () => createBotImages({ readPage, attachment, files, watch }), listen(notify, fail, signal) {
    const subscriber = { notify, fail, signal }
    listener = subscriber; restart()
    return () => { if (listener === subscriber) { watches?.abort(); listener = undefined } }
  } }
}
