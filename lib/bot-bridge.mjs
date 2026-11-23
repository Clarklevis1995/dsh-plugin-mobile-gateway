import { botAppearanceCatalog, defaultAvatar } from './bot-avatars.mjs'
// DS-Bot 的固定业务路由适配；移动端不能指定 URL 或调用主机配对/密钥管理接口。
const API_URL = 'http://localhost/api/bot'
const FEED_URL = 'http://localhost/api/bot/feed'
const MAX_BYTES = 4 * 1024 * 1024
const READS = new Set(['hello', 'state', 'chat', 'room-chat', 'notices', 'avatar', 'image', 'markdown-image', 'file-text',
  'reference-candidates', 'models', 'efforts', 'memory-view', 'memory-history', 'usage-summary', 'schedules', 'run-stats',
  'creation-appearance', 'local-agents', 'local-agent-models', 'avatar-library'])
const WRITES = new Set(['send', 'stage-image', 'stop-chat', 'stop-member-work', 'stop-room-work',
  'answer-question', 'view-reply', 'approval-answer', 'memory-add', 'memory-edit', 'memory-forget',
  'schedule-create', 'schedule-delete', 'create-room', 'set-flags', 'create-bot', 'avatar-import', 'update-bot', 'duplicate-bot', 'delete-bot', 'set-main', 'send-attachments'])
const EVENTS = new Set(['hello', 'revision', 'live', 'message', 'stream', 'notice', 'room'])
export const BOT_REQUEST_TYPES = new Set(['bot-call', 'bot-subscribe', 'bot-unsubscribe'])
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const photo = value => typeof value === 'string' && value.length <= 160_000 &&
  /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
const localRoute = value => typeof value === 'string' && /^local-[a-z0-9-]{1,96}$/.test(value)
const limitedText = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max &&
  !/[\u0000-\u001f\u007f]/u.test(value)
const allowedKeys = (value, keys) => Object.keys(value).every(key => keys.includes(key))
// 只由网关提供固定的本地 Agent 图标，手机上传的头像仍限于位图。
const agentAvatar = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="25" y="29" width="50" height="42" rx="7" fill="#252332"/><path d="m35 40 7 6-7 6m12 2h9" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
).toString('base64')
const fail = (code, message) => Object.assign(new Error(message), { code })

function abortable(task, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(task).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function jsonResponse(response, signal) {
  const reader = response.body?.getReader()
  if (!reader) throw fail('bot-invalid-response', 'DS-Bot returned no body')
  let bytes = 0
  const chunks = []
  try {
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_BYTES) throw fail('bot-response-too-large', 'DS-Bot response exceeds the byte budget')
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

// 增量解码 UTF-8；兼容 CRLF、注释心跳、跨 chunk 的中文及多行 data。
export async function* readBotFeed(body, signal) {
  const reader = body?.getReader()
  if (!reader) throw fail('bot-invalid-response', 'DS-Bot feed has no body')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let buffer = ''
  let event = 'message'
  let data = []
  let eventBytes = 0
  try {
    while (true) {
      const next = await abortable(reader.read(), signal)
      if (next.done) break
      buffer += decoder.decode(next.value, { stream: true })
      if (Buffer.byteLength(buffer) > MAX_BYTES) throw fail('bot-response-too-large', 'DS-Bot feed line is too large')
      let newline
      while ((newline = buffer.indexOf('\n')) >= 0) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (line === '') {
          if (data.length && EVENTS.has(event)) {
            const value = JSON.parse(data.join('\n'))
            if (!record(value)) throw fail('bot-invalid-response', 'Invalid DS-Bot feed event')
            yield { event, data: value }
          }
          event = 'message'; data = []; eventBytes = 0
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':')
          const field = colon < 0 ? line : line.slice(0, colon)
          const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '')
          if (field === 'event') event = value
          if (field === 'data') {
            eventBytes += Buffer.byteLength(value)
            if (eventBytes > MAX_BYTES) throw fail('bot-response-too-large', 'DS-Bot feed event is too large')
            data.push(value)
          }
        }
      }
    }
    decoder.decode()
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function createBotAdapter(handler, peer, images, submitAttachments, referenceCandidates) {
  const request = async (url, init, signal) => {
    if (!handler?.fetch) throw fail('bot-unavailable', 'Host does not support DS-Bot routes')
    signal.throwIfAborted()
    const pending = Promise.resolve().then(() => handler.fetch(new Request(url, { ...init, signal }), peer))
    pending.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}) }, () => {})
    const response = await abortable(pending, signal)
    if (!response.ok) {
      void response.body?.cancel().catch(() => {})
      throw fail(response.status === 404 ? 'bot-unavailable' : 'bot-request-failed', `DS-Bot returned HTTP ${response.status}`)
    }
    return response
  }
  let chatRevision = 0
  const adapter = {
    forConnection: () => createBotAdapter(handler, peer, images?.fork(), submitAttachments, referenceCandidates),
    async call(endpoint, payload = {}, callerSignal) {
      if (!READS.has(endpoint) && !WRITES.has(endpoint)) throw fail('bad-request', 'Unsupported Bot endpoint')
      if (!record(payload)) throw fail('bad-request', 'Bot payload must be an object')
      const selection = ['chat', 'room-chat'].includes(endpoint) ? ++chatRevision : undefined
      const signal = AbortSignal.any([peer.signal, AbortSignal.timeout(30_000), ...(callerSignal ? [callerSignal] : [])])
      if (images && ['image', 'markdown-image'].includes(endpoint)) {
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        return images.read(endpoint, payload, state, signal)
      }
      if (endpoint === 'reference-candidates') {
        if (!referenceCandidates) throw fail('bot-unavailable', 'Reference discovery unavailable')
        if (typeof payload.chatId !== 'string' || !payload.chatId || payload.chatId.length > 256 ||
            typeof payload.query !== 'string' || payload.query.length > 256 || /[\u0000-\u001f\u007f]/u.test(payload.query) ||
            (payload.quoted !== undefined && typeof payload.quoted !== 'boolean')) {
          throw fail('bad-request', 'Invalid Bot reference query')
        }
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        const target = [...(state.bots ?? []), ...(state.rooms ?? [])].find(item => item.id === payload.chatId)
        if (typeof target?.sessionId !== 'string' || !target.sessionId) throw fail('bot/stale', 'The Bot session changed')
        return referenceCandidates(target.sessionId, payload.query, payload.quoted === true, signal)
      }
      if (endpoint === 'send-attachments') {
        if (!submitAttachments) throw fail('bot-unavailable', 'Attachment submission unavailable')
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        const target = [...(state.bots ?? []), ...(state.rooms ?? [])].find(item => item.id === payload.chatId)
        if (state.readOnly || !target || typeof target.sessionId !== 'string' || target.sessionId !== payload.sessionId) {
          throw fail('bot/stale', 'The Bot session changed or is read-only')
        }
        await submitAttachments(target.sessionId, payload, signal)
        return true
      }
      if (endpoint === 'creation-appearance') return botAppearanceCatalog()
      if (endpoint === 'create-room' || endpoint === 'set-flags') {
        if (endpoint === 'create-room') {
          if (!allowedKeys(payload, ['members', 'admin', 'greet']) || !Array.isArray(payload.members) ||
              payload.members.length < 2 || payload.members.length > 100 ||
              payload.members.some(id => !limitedText(id, 256)) ||
              new Set(payload.members).size !== payload.members.length || payload.admin !== payload.members[0] ||
              (payload.greet !== undefined && typeof payload.greet !== 'boolean')) {
            throw fail('bad-request', 'Select at least two Bots; the first member is the administrator')
          }
        } else if (!allowedKeys(payload, ['id', 'hidden']) || !limitedText(payload.id, 256) || payload.hidden !== false) {
          throw fail('bad-request', 'Only restoring a Bot to the sidebar is supported')
        }
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        if (state.readOnly) throw fail('bot/read-only', 'The Bot team is read-only')
        const members = endpoint === 'create-room' ? payload.members : [payload.id]
        if (members.some(id => !state.bots?.some(bot => bot.id === id))) {
          throw fail('bot/stale', 'A selected Bot no longer exists')
        }
      }
      if (endpoint === 'create-bot') {
        const { name, color, avatar, model, effort, agentAppearance } = payload
        const catalog = botAppearanceCatalog()
        if (!allowedKeys(payload, ['name', 'color', 'avatar', 'model', 'effort', 'agentAppearance']) ||
            typeof name !== 'string' || !limitedText(name, 40) || !name.trim() || /[@`]/.test(name) ||
            !catalog.colors.some(item => item.id === color) ||
            !record(avatar) || !allowedKeys(avatar, ['shape', 'image']) ||
            !catalog.shapes.some(item => item.id === avatar.shape) ||
            (avatar.image !== undefined && !photo(avatar.image)) ||
            (model !== undefined && !limitedText(model, 256)) ||
            (effort != null && !limitedText(effort, 64)) ||
            (agentAppearance !== undefined && (agentAppearance !== true || typeof model !== 'string' ||
              !localRoute(model.split('/')[0]) || !model.includes('/') || avatar.image !== undefined))) {
          throw fail('bad-request', 'Invalid Bot creation fields')
        }
        payload = { name: name.trim(), color, avatar: agentAppearance ? { ...avatar, image: agentAvatar } : avatar, model, effort }
      }
      if (endpoint === 'avatar-library') {
        if (!Number.isInteger(payload.offset) || payload.offset < 0 || payload.offset > 1000) {
          throw fail('bad-request', 'Invalid avatar page')
        }
        payload = { offset: payload.offset, limit: 12 }
      }
      if (endpoint === 'avatar-import') {
        if (!Array.isArray(payload.items) || payload.items.length !== 1 || !photo(payload.items[0]?.image)) {
          throw fail('bad-request', 'Invalid avatar photo')
        }
        const { image, name } = payload.items[0]
        payload = { items: [{ image, name: typeof name === 'string' ? name.slice(0, 120) : undefined }] }
      }
      if (endpoint === 'local-agents') payload = {}
      if (endpoint === 'local-agent-models') {
        if (!localRoute(payload.route)) throw fail('bad-request', 'Invalid local Agent route')
        payload = { route: payload.route }
      }
      if (endpoint === 'update-bot') {
        const fields = new Set(['id', 'name', 'role', 'instructions', 'model', 'effort', 'workDir', 'private', 'permission'])
        if (typeof payload.id !== 'string' || !payload.id || Object.keys(payload).some(key => !fields.has(key))) {
          throw fail('bad-request', 'Unsupported Bot settings field')
        }
      }
      if (endpoint === 'duplicate-bot' && (typeof payload.id !== 'string' || Object.keys(payload).length !== 1)) {
        throw fail('bad-request', 'A Bot ID is required')
      }
      if (endpoint === 'delete-bot') {
        if (!limitedText(payload.id, 256) || !payload.id.trim() || Object.keys(payload).length !== 1) {
          throw fail('bad-request', 'A Bot ID is required')
        }
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        if (state.readOnly) throw fail('bot/read-only', 'The Bot team is read-only')
        if (payload.id === state.mainBotId || state.mainBotIds?.includes(payload.id)) {
          throw fail('bot/main-protected', 'A Main Bot cannot be deleted')
        }
        if (!state.bots?.some(bot => bot.id === payload.id)) throw fail('bot/stale', 'The Bot no longer exists')
      }
      if (endpoint === 'set-main' && (typeof payload.id !== 'string' || typeof payload.replace !== 'string'
        || payload.main !== true || payload.primary !== true || Object.keys(payload).length !== 4)) {
        throw fail('bad-request', 'Specify the current and replacement main Bot')
      }
      const { historyDetails: _historyDetails, ...upstream } = endpoint === 'chat' ? payload : {}
      const body = JSON.stringify({ endpoint, payload: endpoint === 'chat' ? upstream : payload })
      if (Buffer.byteLength(body) > MAX_BYTES) throw fail('bad-request', 'Bot request exceeds the byte budget')
      const response = await request(API_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body }, signal)
      const answer = await jsonResponse(response, signal)
      if (!record(answer) || typeof answer.ok !== 'boolean') throw fail('bot-invalid-response', 'Invalid DS-Bot result')
      if (!answer.ok) throw fail(typeof answer.error?.code === 'string' ? answer.error.code : 'bot-request-failed',
        typeof answer.error?.message === 'string' ? answer.error.message : 'DS-Bot request failed')
      if (endpoint === 'hello' && (answer.value?.api !== 1 || !Array.isArray(answer.value.capabilities))) {
        throw fail('bot-version-unsupported', 'Update DS-Bot to a compatible mobile API version')
      }
      // 配对 URI 只能留在电脑上的配对界面；不经团队 state 传给其他设备。
      if (endpoint === 'create-bot') return { id: answer.value?.id }
      if (endpoint === 'create-room') {
        const { id, name, members, sessionId } = answer.value ?? {}
        return { id, name, members, sessionId }
      }
      if (endpoint === 'set-flags') return { id: payload.id }
      if (endpoint === 'delete-bot') return { id: payload.id }
      if (endpoint === 'local-agents') {
        const { detected, custom } = answer.value ?? {}
        return { items: [...(Array.isArray(detected) ? detected : []), ...(Array.isArray(custom) ? custom : [])]
          .filter(entry => localRoute(entry?.route) && limitedText(entry.name, 120))
          .map(({ route, name, signedIn }) => ({
            id: route, title: name, available: signedIn !== false, signedIn: typeof signedIn === 'boolean' ? signedIn : null, image: agentAvatar,
          })) }
      }
      if (endpoint === 'local-agent-models') return { items: (Array.isArray(answer.value) ? answer.value : [])
        .filter(entry => limitedText(entry?.id, 160))
        .map(({ id, name }) => ({ id: `${payload.route}/${id}`, title: typeof name === 'string' ? name : id })) }
      if (endpoint === 'state' && record(answer.value)) {
        const { phone, ...value } = answer.value
        images?.updateState(value)
        if (!Array.isArray(value.bots) || payload.avatars !== 'ref') return value
        return { ...value, bots: value.bots.map(bot => {
          if (bot.avatar?.imageRef || bot.avatar?.image) return bot
          return { ...bot, avatar: { ...bot.avatar, imageRef: defaultAvatar(bot).ref } }
        }) }
      }
      if (endpoint === 'avatar' && !answer.value?.image) {
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        const bot = state.bots?.find(item => item.id === payload.botId)
        return bot ? defaultAvatar(bot) : answer.value
      }
      if (images && ['chat', 'room-chat'].includes(endpoint)) {
        const state = await adapter.call('state', { avatars: 'ref' }, signal)
        return images.enrich(endpoint, payload, answer.value, state, signal, selection === chatRevision)
      }
      if (endpoint === 'hello') {
        const capabilities = new Set(answer.value.capabilities)
        if (capabilities.has('write-state')) {
          capabilities.add('bot-creation')
          capabilities.add('bot-deletion')
          capabilities.add('bot-conversations')
        }
        if (!images) return { ...answer.value, capabilities: [...capabilities] }
        for (const support of ['agent-image-refs', 'image-chunks', 'markdown-image', 'role-settings']) capabilities.add(support)
        if (referenceCandidates) capabilities.add('reference-candidates')
        if (submitAttachments) capabilities.add('bot-attachments')
        return { ...answer.value, capabilities: [...capabilities],
          imageBridge: { provider: 'mobile-gateway', agentImageScopes: ['private-chat'], maxBytes: 16 * 1024 * 1024 } }
      }
      return answer.value
    },
    async *follow(callerSignal) {
      const abort = new AbortController()
      const signal = AbortSignal.any([peer.signal, callerSignal, abort.signal])
      const response = await request(FEED_URL, { method: 'GET' }, signal)
      if (!response.headers.get('content-type')?.startsWith('text/event-stream')) {
        void response.body?.cancel().catch(() => {})
        throw fail('bot-invalid-response', 'DS-Bot did not return an event stream')
      }
      if (!images) { yield* readBotFeed(response.body, signal); return }
      const queue = []
      let wake, ended = false, error
      const finish = reason => { if (ended) return; ended = true; error = reason; wake?.() }
      const push = event => {
        if (ended || signal.aborted) return
        if (queue.length >= 128) { finish(fail('bot-response-too-large', 'Bot event queue overflow')); return }
        queue.push(event); wake?.()
      }
      const stop = images.listen(push, finish, signal)
      const aborted = () => finish(signal.reason)
      signal.addEventListener('abort', aborted, { once: true })
      const reader = (async () => {
        try {
          for await (const event of readBotFeed(response.body, signal)) {
            if (['revision', 'live'].includes(event.event)) await adapter.call('state', { avatars: 'ref' }, signal)
            push(event)
          }
          finish()
        }
        catch (failure) { finish(failure) }
      })()
      try {
        while (true) {
          signal.throwIfAborted()
          if (queue.length) { yield queue.shift(); continue }
          if (ended) { if (error) throw error; break }
          await new Promise(resolve => { wake = resolve })
          wake = undefined
        }
      } finally {
        stop(); abort.abort(); signal.removeEventListener('abort', aborted); await reader
      }
    },
  }
  return adapter
}

// 每条设备控制连接最多一个订阅，取消/替换后旧订阅的尾部绝不进入新订阅。
export function createBotChannel(api, { send, signal }) {
  api = api.forConnection?.() ?? api
  let active
  const stop = () => { active?.abort.abort(); active = undefined }
  const errorFrame = (msg, error) => ({ kind: 'error', requestType: msg.type, requestId: msg.requestId,
    code: error.code || (error.name === 'TimeoutError' ? 'bot-timeout' : 'bot-request-failed'), message: error.message })
  signal.addEventListener('abort', stop, { once: true })
  return {
    stop,
    async handle(msg) {
      try {
        if (typeof msg.requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(msg.requestId)) {
          throw fail('bad-request', 'A bounded Bot requestId is required')
        }
        if (msg.type === 'bot-unsubscribe') {
          stop()
          return { kind: 'bot-subscribed', requestId: msg.requestId, subscriptionId: null }
        }
        if (msg.type === 'bot-call') {
          const value = await api.call(msg.endpoint, msg.payload ?? {}, signal)
          return { kind: 'bot-result', requestId: msg.requestId, endpoint: msg.endpoint, value }
        }
        if (msg.type !== 'bot-subscribe') throw fail('bad-request', 'Unknown Bot request')
        stop()
        const owned = { id: msg.requestId, abort: new AbortController() }
        active = owned
        const hello = await api.call('hello', { api: [1] }, AbortSignal.any([signal, owned.abort.signal]))
        if (active !== owned || signal.aborted) return null
        send({ kind: 'bot-subscribed', requestId: msg.requestId, subscriptionId: owned.id, hello })
        void (async () => {
          try {
            for await (const frame of api.follow(AbortSignal.any([signal, owned.abort.signal]))) {
              if (active !== owned) return
              send({ kind: 'bot-event', subscriptionId: owned.id, botEvent: frame.event, botData: frame.data })
            }
            if (active === owned) throw fail('bot-feed-ended', 'DS-Bot stream ended; resynchronize before reconnecting')
          } catch (error) {
            if (active === owned && !signal.aborted && !owned.abort.signal.aborted) {
              active = undefined
              send({ kind: 'bot-stream-reset', subscriptionId: owned.id, code: error.code || 'bot-feed-interrupted', message: error.message })
            }
          }
        })()
        return null
      } catch (error) { return errorFrame(msg, error) }
    },
  }
}
