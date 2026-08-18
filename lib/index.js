// dsh-plugin-mobile-gateway — persistent Host plugin.
//
// Two directions:
//  1. Agent -> mobile: registers a WebSocket endpoint at /ws/mobile on the dsh
//     web server and forwards agent session output (the same `session/event`
//     feed the browser UI consumes) to connected mobile clients as curated
//     JSON text frames.
//  2. Mobile -> agent: clients send a message through the same socket; the
//     plugin admits it through the official host API (apiProxy.sessions.prompt)
//     so it enters the target session exactly like a browser-submitted prompt.
//
// Wire protocol (JSON text frames):
//   client -> server: { "type": "ping" }
//                     { "type": "subscribe", "sessionId": "..." }  (optional filter)
//                     { "type": "unsubscribe" }
//                     { "type": "message", "sessionId"?, "text", "mode"?: "queue"|"steer",
//                       "workspaceId"?, "cwd"? }
//                        sessionId omitted -> a new session is created first; the
//                        new session can be placed in a workspace via workspaceId
//                        (or cwd; at most one, workspaceId wins)
//                     { "type": "workspaces" }                     -> workspace list
//                     { "type": "sessions" }                       -> session list
//                     { "type": "history", "sessionId", "beforeSeq"?, "maxMessages"?,
//                       "maxBytes"?, "view"?: "conversation" }
//                        -> raw SessionEvent page (scheme A), capped at maxBytes
//                           (default 4 MiB); hasMore + nextBeforeSeq page backward;
//                           view:"conversation" trims chunk/header events and tool output
//                     { "type": "search", "query" }                -> session search
//                     { "type": "host" }                           -> host.describe snapshot (incl. default provider/model)
//                     { "type": "default-model" }                   -> agentDefaultModel.currentSelection()
//                     { "type": "save-default-model", "provider", "model", "reasoningEffort"? }
//                     { "type": "directories", "path"? }           -> server dir listing (fs-based)
//                     { "type": "workspace-create", "path" }       -> create workspace over a dir
//                     { "type": "fork", "sessionId", "atSeq"? }    -> branch a new session from a completed turn
//                     { "type": "models", "sessionId"? }           -> per-session catalog (with sessionId) or global (without)
//                     { "type": "providers" }                       -> configurable provider list (live/dormant)
//                     { "type": "select-model", "sessionId", "provider", "model", "reasoningEffort"? }
//                     { "type": "permission-options", "sessionId"? } -> permission presets (+ session knobs)
//                     { "type": "permission", "sessionId", "name" }  -> switch preset via /permission command
//                     { "type": "context-usage", "sessionId" }       -> tokenUsage + contextPressure projections
//                     { "type": "session-stats", "sessionId" }       -> sessionStats + tokenUsage projections
//                        (the input-box stats strip source)
//                     { "type": "agent-presets" }                     -> preset roster (+ isDefault)
//                     { "type": "defaults" }                          -> default agent preset + default permission
//                     { "type": "set-default", "target": "agent-preset"|"permission", "value" }
//   server -> client: { "kind": "hello", "protocol": 1, "port", "clients" }
//                     { "kind": "pong", "at" }
//                     { "kind": "subscribed", "sessionId" }
//                     { "kind": "sent", "sessionId", "mode", "command"? }
//                     { "kind": "workspaces" | "sessions" | "history" | "search", ...data }
//                     { "kind": "error", "code", "message", "requestType"?, "sessionId"? }
//                     { "kind": "event", "sessionId", "seq", "time", "event": { ... } }
'use strict'

const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { WebSocketServer } = require('ws')

const MAX_PREVIEW = 400
const LOG_FILE = '/tmp/mobile-gateway.log'

function log(line) {
  const msg = `[${new Date().toISOString()}] ${line}`
  console.log('mobile-gateway:', msg)
  try {
    fs.appendFileSync(LOG_FILE, msg + '\n')
  } catch (error) {
    // never let logging break the gateway
  }
}

// Extract plain text from a ContentBlock[] (text blocks only).
function textOf(blocks) {
  let text = ''
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}

// Build the small, owned JSON wire record for one session event. Reads only
// leaf fields of the live SessionEvent — never serializes live objects.
function buildWireEvent(session, event) {
  const base = { sessionId: String(session.id), seq: event.seq, time: event.time }
  const d = event.data || {}
  switch (event.type) {
    case 'user/message':
      return Object.assign(base, {
        event: {
          type: 'user/message',
          text: textOf(d.content || []),
          source: d.source && d.source.kind,
        },
      })
    case 'assistant/chunk': {
      const chunk = d.chunk || {}
      const ev = { type: 'assistant/chunk', turn: d.turn, step: d.step, chunkType: chunk.type }
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') ev.text = chunk.text
      if (chunk.type === 'tool-call-delta') ev.tool = { id: chunk.id, name: chunk.name, argumentsDelta: chunk.argumentsDelta }
      if (chunk.type === 'usage') ev.usage = chunk.usage
      if (chunk.type === 'finish') ev.finish = { kind: chunk.reason && chunk.reason.kind }
      return Object.assign(base, { event: ev })
    }
    case 'assistant/message': {
      const blocks = (d.message && d.message.content) || []
      let text = ''
      let reasoning = ''
      const toolCalls = []
      for (const block of blocks) {
        if (!block) continue
        if (block.type === 'text' && typeof block.text === 'string') text += block.text
        else if (block.type === 'reasoning' && typeof block.text === 'string') reasoning += block.text
        else if (block.type === 'tool-call') toolCalls.push({ id: block.id, name: block.name, arguments: block.arguments })
      }
      return Object.assign(base, {
        event: { type: 'assistant/message', turn: d.turn, step: d.step, text, reasoning, toolCalls },
      })
    }
    case 'tool/call':
      return Object.assign(base, {
        event: { type: 'tool/call', turn: d.turn, step: d.step, callId: d.callId, name: d.name, arguments: d.arguments },
      })
    case 'tool/result': {
      let preview = ''
      for (const block of (d.message && d.message.content) || []) {
        for (const inner of (block && block.content) || []) {
          if (inner.type === 'text' && typeof inner.text === 'string') preview += inner.text
        }
      }
      if (preview.length > MAX_PREVIEW) preview = preview.slice(0, MAX_PREVIEW) + '…'
      return Object.assign(base, {
        event: {
          type: 'tool/result',
          turn: d.turn,
          step: d.step,
          callId: d.message && d.message.source && d.message.source.callId,
          isError: !!d.error,
          preview,
        },
      })
    }
    case 'turn/start':
    case 'turn/end':
    case 'step/start':
    case 'step/end':
      return Object.assign(base, {
        event: { type: event.type, turn: d.turn, step: d.step, reason: d.reason && d.reason.kind },
      })
    default:
      return Object.assign(base, { event: { type: event.type } })
  }
}

// Handle one mobile -> agent message through the official host API. Returns
// the wire frame to send back, or null when nothing should be sent.
async function admitMessage(api, msg) {
  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  if (!text) {
    return { kind: 'error', code: 'bad-request', message: 'text must be a non-empty string' }
  }
  const mode = msg.mode === 'steer' ? 'steer' : 'queue'

  let sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : undefined
  try {
    if (sessionId === undefined) {
      // New session: optionally place it in a workspace (at most one of
      // workspaceId / cwd, per the host create contract; workspaceId wins).
      const createPayload = {}
      if (typeof msg.workspaceId === 'string' && msg.workspaceId.trim() !== '') {
        createPayload.workspaceId = msg.workspaceId.trim()
      }
      if (typeof msg.cwd === 'string' && msg.cwd.trim() !== '') {
        if (createPayload.workspaceId) log('mobile message: both workspaceId and cwd given, using workspaceId')
        else createPayload.cwd = msg.cwd.trim()
      }
      const created = await api.sessions.create({ rpcId: crypto.randomUUID(), payload: createPayload })
      if (!created.result.ok) {
        return { kind: 'error', code: created.result.error.code, message: created.result.error.message }
      }
      sessionId = created.result.value.sessionId
      log(`mobile message created new session ${sessionId} (${JSON.stringify(createPayload)})`)
    }

    const resp = await api.sessions.prompt({
      rpcId: crypto.randomUUID(),
      payload: { sessionId, mode, content: [{ type: 'text', text }] },
    })
    if (resp.result.ok) {
      log(`mobile message accepted: session=${sessionId} mode=${mode} text="${text.slice(0, 60)}"`)
      return {
        kind: 'sent',
        sessionId,
        mode,
        ...(resp.result.value.command ? { command: resp.result.value.command } : {}),
      }
    }
    log(`mobile message rejected: ${resp.result.error.code}: ${resp.result.error.message}`)
    return {
      kind: 'error',
      code: resp.result.error.code,
      message: resp.result.error.message,
      ...(sessionId ? { sessionId } : {}),
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    log(`mobile message failed: ${message}`)
    return { kind: 'error', code: 'internal', message, ...(sessionId ? { sessionId } : {}) }
  }
}

// Proxy one read-only query to the official host API (the same surface the
// browser uses). Success returns `{ kind: <type>, ...value }`; failure returns
// the uniform `{ kind: 'error', code, message, requestType }` frame.
async function proxyQuery(api, type, method, payload, signal) {
  try {
    const req = { rpcId: crypto.randomUUID(), payload }
    const resp = signal ? await method(req, signal) : await method(req)
    if (resp.result.ok) {
      log(`query ok: ${type}`)
      return { kind: type, ...resp.result.value }
    }
    log(`query rejected: ${type} -> ${resp.result.error.code}: ${resp.result.error.message}`)
    return {
      kind: 'error',
      code: resp.result.error.code,
      message: resp.result.error.message,
      requestType: type,
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    log(`query failed: ${type} -> ${message}`)
    return { kind: 'error', code: 'internal', message, requestType: type }
  }
}

// List one directory level directly with node:fs, mirroring the official
// browse backend's semantics (crumbs + name-sorted child directories). Works
// on every deployment regardless of the composed picker capability, which
// `host.listDirectory` would otherwise gate behind the `browse` capability.
async function listServerDirectory(target) {
  try {
    const home = os.homedir()
    const requested = target ? path.resolve(target) : home
    const crumbs = []
    let cur = requested
    for (;;) {
      crumbs.unshift({ name: cur === path.parse(cur).root ? cur : path.basename(cur), path: cur, hidden: false })
      const parent = path.dirname(cur)
      if (parent === cur) break
      cur = parent
    }
    const entries = []
    const dirents = await fsp.readdir(requested, { withFileTypes: true })
    for (const dirent of dirents) {
      if (!dirent.isDirectory() && !dirent.isSymbolicLink()) continue
      entries.push({ name: dirent.name, path: path.join(requested, dirent.name), hidden: dirent.name.startsWith('.') })
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    log(`query ok: directories (${requested}, ${entries.length} entries)`)
    return { kind: 'directories', path: requested, home, crumbs, entries, truncated: false }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    log(`query failed: directories -> ${message}`)
    return { kind: 'error', code: 'directory-unreadable', message, requestType: 'directories' }
  }
}

// Validate one sessionId field; returns { value } or { error }.
function requireSessionId(msg) {
  const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
  if (!sessionId) {
    return { error: { kind: 'error', code: 'bad-request', message: 'this request requires a sessionId', requestType: typeof msg.type === 'string' ? msg.type : 'query' } }
  }
  return { value: sessionId }
}

// ---------------------------------------------------------------------------
// History frame sizing: raw session logs can be huge (trajectory, tool output,
// context), so a single history response must never blow the client's
// WebSocket frame limit. We cap the serialized size per frame, keep the NEWEST
// suffix within the budget, and hand the client `hasMore` + `nextBeforeSeq` so
// it can page backward. An optional `view: "conversation"` trims events that
// are not needed for a chat page (token-level chunks, system-prompt headers)
// and truncates oversized tool-result text.
// ---------------------------------------------------------------------------
const HISTORY_DEFAULT_MAX_BYTES = 4 * 1024 * 1024 // 4 MiB per frame
const HISTORY_TOOL_RESULT_MAX_CHARS = 2000 // per text block in conversation view

function eventBytes(event) {
  return Buffer.byteLength(JSON.stringify(event), 'utf8')
}

// Trim one event for the conversation page: null drops it, otherwise a shallow
// copy with oversized payloads truncated. The events come from the host RPC as
// plain JSON, so copying is safe.
function trimConversationEvent(event) {
  switch (event.type) {
    case 'assistant/chunk':
    case 'request/header':
      // token-level replay / system-prompt header: not rendered on the chat page
      return null
    case 'tool/result': {
      const d = event.data || {}
      const message = d.message
      if (!message || !Array.isArray(message.content)) return event
      let changed = false
      const truncateBlock = (block) => {
        if (!block || typeof block !== 'object') return block
        if (block.type === 'text' && typeof block.text === 'string' && block.text.length > HISTORY_TOOL_RESULT_MAX_CHARS) {
          changed = true
          return { ...block, text: block.text.slice(0, HISTORY_TOOL_RESULT_MAX_CHARS) + '…' }
        }
        if (Array.isArray(block.content)) {
          return { ...block, content: block.content.map(truncateBlock) }
        }
        return block
      }
      const content = message.content.map(truncateBlock)
      if (!changed) return event
      return { ...event, data: { ...d, message: { ...message, content } } }
    }
    default:
      return event
  }
}

// Keep the newest suffix of `events` (ascending seq) within `maxBytes`.
// Always keeps the newest event even if it alone exceeds the budget (an event
// cannot be split); drops older events beyond the budget. Returns the kept
// events, their total serialized bytes, and whether anything was dropped.
function capHistoryEvents(events, maxBytes, trim) {
  const processed = trim ? events.map(trimConversationEvent).filter(Boolean) : events
  if (processed.length === 0) return { events: [], bytes: 0, dropped: 0 }
  let total = 0
  let keptStart = processed.length
  for (let i = processed.length - 1; i >= 0; i--) {
    const size = eventBytes(processed[i])
    if (keptStart === processed.length) {
      // always keep the newest event
      total = size
      keptStart = i
      continue
    }
    if (total + size > maxBytes) break
    total += size
    keptStart = i
  }
  return { events: processed.slice(keptStart), bytes: total, dropped: keptStart }
}

// Dispatch one mobile query frame; returns the wire frame to send back.
async function handleQuery(api, typertGateway, agentDefaultModel, msg) {
  if (msg.type === 'workspaces') {
    return proxyQuery(api, 'workspaces', api.workspace.list.bind(api.workspace), {})
  }
  if (msg.type === 'sessions') {
    return proxyQuery(api, 'sessions', api.sessions.list.bind(api.sessions), {})
  }
  if (msg.type === 'history') {
    const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
    if (!sessionId) {
      return { kind: 'error', code: 'bad-request', message: 'history requires a sessionId', requestType: 'history' }
    }
    const payload = { sessionId }
    if (typeof msg.beforeSeq === 'number' && Number.isFinite(msg.beforeSeq)) payload.beforeSeq = msg.beforeSeq
    if (typeof msg.maxMessages === 'number' && Number.isFinite(msg.maxMessages)) payload.maxMessages = msg.maxMessages
    const frame = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), payload)
    if (frame.kind === 'history') {
      // Scheme A base: pass the raw SessionEvent list through (drop the host
      // render intent); keep the projections block and echo the sessionId.
      const rawEvents = Array.isArray(frame.events) ? frame.events.map((entry) => entry.event) : []
      // Byte budget + optional conversation trim — keeps the frame under the
      // client's WebSocket limit and pages the rest via nextBeforeSeq.
      const maxBytes = typeof msg.maxBytes === 'number' && Number.isFinite(msg.maxBytes) && msg.maxBytes > 0
        ? Math.floor(msg.maxBytes)
        : HISTORY_DEFAULT_MAX_BYTES
      const trim = msg.view === 'conversation'
      const capped = capHistoryEvents(rawEvents, maxBytes, trim)
      frame.events = capped.events
      frame.sessionId = sessionId
      frame.bytes = capped.bytes
      if (trim) frame.view = 'conversation'
      // hasMore combines the host's message-count pagination with byte-drop.
      const apiHasMore = frame.hasMore === true
      const byteDropped = capped.dropped > 0
      frame.hasMore = apiHasMore || byteDropped > 0
      if (frame.hasMore && capped.events.length > 0) {
        frame.nextBeforeSeq = capped.events[0].seq // oldest kept event: page back from here
      }
    }
    return frame
  }
  if (msg.type === 'search') {
    const query = typeof msg.query === 'string' ? msg.query.trim() : ''
    if (!query) {
      return { kind: 'error', code: 'bad-request', message: 'search requires a query', requestType: 'search' }
    }
    return proxyQuery(api, 'search', api.sessions.search.bind(api.sessions), { query }, new AbortController().signal)
  }
  if (msg.type === 'host') {
    return proxyQuery(api, 'host', api.host.describe.bind(api.host), {})
  }
  if (msg.type === 'default-model') {
    try {
      const selection = agentDefaultModel.currentSelection()
      log(`default-model queried: ${selection.provider}/${selection.model}`)
      return { kind: 'default-model', selection }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      return { kind: 'error', code: 'internal', message, requestType: 'default-model' }
    }
  }
  if (msg.type === 'save-default-model') {
    const provider = typeof msg.provider === 'string' && msg.provider.trim() !== '' ? msg.provider.trim() : null
    const model = typeof msg.model === 'string' && msg.model.trim() !== '' ? msg.model.trim() : null
    if (!provider || !model) {
      return { kind: 'error', code: 'bad-request', message: 'save-default-model requires provider and model', requestType: 'save-default-model' }
    }
    const selection = { provider, model }
    if (typeof msg.reasoningEffort === 'string' && msg.reasoningEffort.trim() !== '') selection.reasoningEffort = msg.reasoningEffort.trim()
    try {
      await agentDefaultModel.saveSelection(selection)
      log(`default model saved: ${provider}/${model}${selection.reasoningEffort ? ' (effort=' + selection.reasoningEffort + ')' : ''}`)
      return { kind: 'save-default-model', saved: selection }
    } catch (error) {
      const message = error && error.message ? error.message : String(error)
      log(`save-default-model failed: ${message}`)
      return { kind: 'error', code: 'internal', message, requestType: 'save-default-model' }
    }
  }
  if (msg.type === 'fork') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const payload = { sessionId: sessionId.value }
    if (typeof msg.atSeq === 'number' && Number.isFinite(msg.atSeq)) payload.atSeq = Math.floor(msg.atSeq)
    const frame = await proxyQuery(api, 'fork', api.sessions.fork.bind(api.sessions), payload)
    if (frame.kind === 'fork') {
      log(`forked session ${sessionId.value} -> ${frame.sessionId}${payload.atSeq !== undefined ? ' at seq ' + payload.atSeq : ''}`)
    }
    return frame
  }
  if (msg.type === 'workspace-create') {
    const wsPath = typeof msg.path === 'string' && msg.path.trim() !== '' ? msg.path.trim() : null
    if (!wsPath) {
      return { kind: 'error', code: 'bad-request', message: 'workspace-create requires a path', requestType: 'workspace-create' }
    }
    return proxyQuery(api, 'workspace-create', api.workspace.create.bind(api.workspace), { path: wsPath })
  }
  if (msg.type === 'directories') {
    return listServerDirectory(typeof msg.path === 'string' && msg.path.trim() !== '' ? msg.path.trim() : undefined)
  }
  if (msg.type === 'models') {
    const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
    if (sessionId) {
      // per-session catalog: current selection + routable + full groups
      return proxyQuery(api, 'models', api.sessions.models.bind(api.sessions), { sessionId })
    }
    // global catalog: every provider route, no session needed
    return proxyQuery(api, 'models', api.llm.models.bind(api.llm), {})
  }
  if (msg.type === 'providers') {
    return proxyQuery(api, 'providers', api.llm.providers.bind(api.llm), {})
  }
  if (msg.type === 'select-model') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const provider = typeof msg.provider === 'string' && msg.provider.trim() !== '' ? msg.provider.trim() : null
    const model = typeof msg.model === 'string' && msg.model.trim() !== '' ? msg.model.trim() : null
    if (!provider || !model) {
      return { kind: 'error', code: 'bad-request', message: 'select-model requires provider and model', requestType: 'select-model' }
    }
    const payload = { sessionId: sessionId.value, provider, model }
    if (typeof msg.reasoningEffort === 'string' && msg.reasoningEffort.trim() !== '') payload.reasoningEffort = msg.reasoningEffort.trim()
    return proxyQuery(api, 'select-model', api.sessions.selectModel.bind(api.sessions), payload)
  }
  if (msg.type === 'permission-options') {
    const frame = await proxyQuery(api, 'permission-options', api.settings.describe.bind(api.settings), {})
    if (frame.kind !== 'permission-options') return frame
    const out = {
      kind: 'permission-options',
      namespace: (frame.namespaces || []).find((n) => n.ns === 'permission') || null,
    }
    const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() !== '' ? msg.sessionId.trim() : null
    if (sessionId) {
      const hist = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), { sessionId })
      if (hist.kind === 'history' && hist.projections && hist.projections.values) {
        out.sessionPermissions = hist.projections.values.permissions || null
      }
    }
    return out
  }
  if (msg.type === 'permission') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const name = typeof msg.name === 'string' && msg.name.trim() !== '' ? msg.name.trim() : null
    if (!name) {
      return { kind: 'error', code: 'bad-request', message: 'permission requires a name', requestType: 'permission' }
    }
    // Execute the /permission command through the Typert Remote gateway — the
    // same endpoint the browser calls (remote.commands.execute). This runs the
    // command registry handler WITHOUT sending anything to the model, and the
    // api-remotes agent lookup resumes cold sessions just like prompt does.
    try {
      const execution = await typertGateway.invoke({
        namespace: 'commands',
        method: 'execute',
        args: { agentId: sessionId.value, line: '/permission ' + name },
        signal: new AbortController().signal,
      })
      if (execution === undefined || execution === null) {
        return { kind: 'error', code: 'unknown-command', message: 'command not found: /permission', requestType: 'permission', sessionId: sessionId.value }
      }
      log(`permission switched: session=${sessionId.value} preset=${name} (commandId=${execution.commandId})`)
      return {
        kind: 'permission',
        sessionId: sessionId.value,
        set: name,
        commandId: execution.commandId,
        result: execution.result,
      }
    } catch (error) {
      const code = error && error.code ? error.code : 'internal'
      const message = error && error.message ? error.message : String(error)
      log(`permission rejected: ${code}: ${message}`)
      return { kind: 'error', code, message, requestType: 'permission', sessionId: sessionId.value }
    }
  }
  if (msg.type === 'context-usage') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const hist = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), { sessionId: sessionId.value })
    if (hist.kind !== 'history') return hist
    const values = (hist.projections && hist.projections.values) || {}
    return {
      kind: 'context-usage',
      sessionId: sessionId.value,
      asOfSeq: hist.projections ? hist.projections.asOfSeq : undefined,
      tokenUsage: values.tokenUsage || null,
      contextPressure: values.contextPressure || null,
    }
  }
  if (msg.type === 'session-stats') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const hist = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), { sessionId: sessionId.value })
    if (hist.kind !== 'history') return hist
    const values = (hist.projections && hist.projections.values) || {}
    return {
      kind: 'session-stats',
      sessionId: sessionId.value,
      asOfSeq: hist.projections ? hist.projections.asOfSeq : undefined,
      sessionStats: values.sessionStats || null,
      tokenUsage: values.tokenUsage || null,
      contextPressure: values.contextPressure || null,
    }
  }
  if (msg.type === 'agent-presets') {
    return proxyQuery(api, 'agent-presets', api.agentPresets.list.bind(api.agentPresets), {})
  }
  if (msg.type === 'defaults') {
    const frame = await proxyQuery(api, 'defaults', api.settings.describe.bind(api.settings), {})
    if (frame.kind !== 'defaults') return frame
    const agentPresetNs = (frame.namespaces || []).find((n) => n.ns === 'agent-presets')
    const permissionNs = (frame.namespaces || []).find((n) => n.ns === 'permission')
    return {
      kind: 'defaults',
      agentPresetDefault: agentPresetNs && agentPresetNs.value && agentPresetNs.value.default !== undefined ? agentPresetNs.value.default : null,
      permissionDefault: permissionNs && permissionNs.value && permissionNs.value.defaultPreset !== undefined ? permissionNs.value.defaultPreset : null,
    }
  }
  if (msg.type === 'set-default') {
    const target = typeof msg.target === 'string' && msg.target.trim() !== '' ? msg.target.trim() : null
    const value = typeof msg.value === 'string' && msg.value.trim() !== '' ? msg.value.trim() : null
    if (target !== 'agent-preset' && target !== 'permission') {
      return { kind: 'error', code: 'bad-request', message: 'set-default target must be "agent-preset" or "permission"', requestType: 'set-default' }
    }
    if (!value) {
      return { kind: 'error', code: 'bad-request', message: 'set-default requires a value', requestType: 'set-default' }
    }
    const ns = target === 'agent-preset' ? 'agent-presets' : 'permission'
    const patch = target === 'agent-preset' ? { default: value } : { defaultPreset: value }
    const updated = await proxyQuery(api, 'set-default', api.settings.update.bind(api.settings), { ns, patch })
    if (updated.kind !== 'set-default') return updated
    log(`default updated: ${ns}.${Object.keys(patch)[0]} = ${value}`)
    return { kind: 'set-default', target, value, applied: true, namespace: updated }
  }
  return null
}

module.exports = {
  name: 'mobile-gateway',
  // Hard dependencies: the gateway registers on the host web server and
  // admits mobile messages through the host API gateway. Cordis must not
  // activate this row before either service exists.
  inject: ['webServer', 'apiProxy', 'typertGateway', 'agentDefaultModel'],
  // exported for local tests; Cordis ignores unknown plugin fields
  admitMessage,
  handleQuery,
  apply(ctx, config) {
    const webServer = ctx.webServer
    const api = ctx.apiProxy
    const typertGateway = ctx.typertGateway
    const agentDefaultModel = ctx.agentDefaultModel
    const path = (config && config.path) || '/ws/mobile'
    const wss = new WebSocketServer({ noServer: true })
    const clients = new Set()
    let counter = 0

    log(`applying: path=${path}, webServer.port=${webServer.port}, apiProxy=${api ? 'present' : 'absent'}`)

    const disposeUpgrade = webServer.registerUpgrade({
      path,
      handler(req, socket, head) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const id = ++counter
          ws.filterSessionId = undefined
          clients.add(ws)

          ws.on('message', (data) => {
            let msg
            try {
              msg = JSON.parse(data.toString())
            } catch (error) {
              ws.send(JSON.stringify({ kind: 'error', message: 'invalid json' }))
              return
            }
            if (!msg || typeof msg.type !== 'string') return

            if (msg.type === 'ping') {
              ws.send(JSON.stringify({ kind: 'pong', at: Date.now() }))
            } else if (msg.type === 'subscribe') {
              ws.filterSessionId = typeof msg.sessionId === 'string' ? msg.sessionId : undefined
              ws.send(JSON.stringify({ kind: 'subscribed', sessionId: ws.filterSessionId || null }))
            } else if (msg.type === 'unsubscribe') {
              ws.filterSessionId = undefined
              ws.send(JSON.stringify({ kind: 'subscribed', sessionId: null }))
            } else if (msg.type === 'message') {
              admitMessage(api, msg).then((frame) => {
                if (frame) ws.send(JSON.stringify(frame))
              })
            } else if (msg.type === 'workspaces' || msg.type === 'sessions' || msg.type === 'history' ||
                       msg.type === 'search' || msg.type === 'host' || msg.type === 'directories' ||
                       msg.type === 'workspace-create' || msg.type === 'models' || msg.type === 'select-model' ||
                       msg.type === 'permission-options' || msg.type === 'permission' || msg.type === 'context-usage' ||
                       msg.type === 'agent-presets' || msg.type === 'defaults' || msg.type === 'set-default' ||
                       msg.type === 'session-stats' || msg.type === 'default-model' ||
                       msg.type === 'save-default-model' || msg.type === 'fork' || msg.type === 'providers') {
              handleQuery(api, typertGateway, agentDefaultModel, msg).then((frame) => {
                if (frame) ws.send(JSON.stringify(frame))
              })
            } else {
              ws.send(JSON.stringify({ kind: 'error', message: 'unknown message type: ' + msg.type }))
            }
          })

          ws.on('close', () => {
            clients.delete(ws)
            log(`client disconnected (id=${id}, remaining=${clients.size})`)
          })

          log(`client connected (id=${id}, total=${clients.size})`)
          ws.send(JSON.stringify({ kind: 'hello', protocol: 1, port: webServer.port, clients: clients.size }))
        })
      },
    })
    log(`upgrade route registered: ${path}`)

    const disposeEvents = ctx.on('session/event', (session, event) => {
      if (clients.size === 0) return
      const wire = buildWireEvent(session, event)
      if (!wire) return
      const payload = JSON.stringify(wire)
      for (const client of clients) {
        if (client.filterSessionId && client.filterSessionId !== String(session.id)) continue
        if (client.readyState === 1) client.send(payload)
      }
    })
    log('session/event listener attached')

    ctx.effect(() => () => {
      disposeUpgrade()
      disposeEvents()
      for (const client of clients) client.terminate()
      clients.clear()
      wss.close()
      log('plugin stopped, all sockets closed')
    })
  },
}
