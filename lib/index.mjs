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
//   first pair:       Sec-WebSocket-Protocol: dsh-mobile-v1, dsh-pair.<one-time-code>
//                     X-DSH-Device-ID: <stable installation UUID>
//                     -> { "kind": "paired", "token", "device" } (exactly once)
//   later connects:   Authorization: Bearer <device-token>
//                     or Sec-WebSocket-Protocol: dsh-mobile-v1, dsh-auth.<device-token>
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
//   server -> client: { "kind": "hello", "protocol": 2, "authenticated", "device"?, "port", "clients" }
//                     { "kind": "pong", "at" }
//                     { "kind": "subscribed", "sessionId" }
//                     { "kind": "sent", "sessionId", "mode", "command"? }
//                     { "kind": "workspaces" | "sessions" | "history" | "search", ...data }
//                     { "kind": "error", "code", "message", "requestType"?, "sessionId"? }
//                     { "kind": "event", "sessionId", "seq", "time", "event": { ... } }
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { WebSocketServer } from 'ws'
import devicesModule from './devices.js'
import QRCode from 'qrcode'

const { createRegistry } = devicesModule

const MAX_PREVIEW = 400
const LOG_FILE = '/tmp/mobile-gateway.log'
const DEFAULT_WS_PATH = '/ws/mobile'
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000
const DEFAULT_GATEWAY_WAIT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_MANAGEMENT_BODY_BYTES = 16 * 1024

// Cordis validates this schema at plugin load and fills these defaults. Keep
// the defaults conservative: installing the bundle must never create an
// unauthenticated network control plane.
const Config = Schema.object({
  path: Schema.string().default(DEFAULT_WS_PATH),
  requireAuth: Schema.boolean().default(true),
  gatewayEnabled: Schema.boolean().default(false),
  gatewayWaitTimeoutMs: Schema.natural().min(30_000).max(30 * 60 * 1000).default(DEFAULT_GATEWAY_WAIT_TIMEOUT_MS),
  adminLoopbackOnly: Schema.boolean().default(true),
  publicUrl: Schema.string().default(''),
  deviceFile: Schema.string().default(''),
  pairingTtlMs: Schema.natural().min(30_000).max(15 * 60 * 1000).default(DEFAULT_PAIRING_TTL_MS),
  allowQueryToken: Schema.boolean().default(false),
  publicUrlFile: Schema.string().default('/etc/dsh-mobile-gateway/public-url'),
  lanEnabled: Schema.boolean().default(false),
  lanHost: Schema.string().default('0.0.0.0'),
  lanPort: Schema.natural().min(1).max(65535).default(3081),
  lanAdvertiseHost: Schema.string().default(''),
})

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

// ---------------------------------------------------------------------------
// Device auth: a QR carries a short-lived one-time pairing code. Claiming it
// over WebSocket yields a long-lived bearer token exactly once. The registry
// stores only the token digest. Management endpoints are local-machine only by
// default and mutating requests also require a same-origin browser context.
// ---------------------------------------------------------------------------
function isLoopback(req) {
  const addr = req.socket && req.socket.remoteAddress
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function parseProtocols(req) {
  const value = req.headers['sec-websocket-protocol']
  if (typeof value !== 'string') return []
  return value.split(',').map((entry) => entry.trim()).filter(Boolean)
}

function extractCredential(req, allowQueryToken) {
  const authorization = req.headers.authorization
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+([A-Za-z0-9_-]{43})$/i.exec(authorization.trim())
    if (match) return { kind: 'token', value: match[1] }
  }

  for (const protocol of parseProtocols(req)) {
    if (protocol.startsWith('dsh-auth.')) return { kind: 'token', value: protocol.slice('dsh-auth.'.length) }
    if (protocol.startsWith('dsh-pair.')) return { kind: 'pairing', value: protocol.slice('dsh-pair.'.length) }
  }

  try {
    const query = new URL(req.url || '/', 'http://localhost').searchParams
    const pairing = query.get('pairingCode')
    if (pairing) return { kind: 'pairing', value: pairing }
    const token = allowQueryToken && query.get('token')
    if (token) return { kind: 'token', value: token }
  } catch (error) { /* ignore */ }
  return undefined
}

function extractClientDeviceId(req) {
  const value = req.headers['x-dsh-device-id']
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return /^[A-Za-z0-9._:-]{8,128}$/.test(normalized) ? normalized : undefined
}

function rejectUpgrade(socket, status, message) {
  const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : status === 503 ? 'Service Unavailable' : 'Bad Request'
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`)
  socket.destroy()
}

function isLocalHostname(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === 'localhost' || normalized === '::1' || /^127(?:\.\d{1,3}){3}$/.test(normalized)
}

function isPrivateNetworkHostname(hostname) {
  let normalized = hostname.replace(/^\[|\]$/g, '').split('%')[0].toLowerCase()
  if (normalized.startsWith('::ffff:')) normalized = normalized.slice('::ffff:'.length)
  if (isLocalHostname(normalized) || normalized.endsWith('.local')) return true
  const octets = normalized.split('.').map((part) => Number(part))
  if (octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      (octets[0] === 169 && octets[1] === 254)
  }
  return /^(?:f[cd][0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i.test(normalized)
}

function privateLanAddresses() {
  const physical = []
  const fallback = []
  const virtualInterface = /^(?:docker|br-|veth|utun|awdl|llw|vmnet|vbox|virbr|tailscale|wg)/i
  for (const [name, records] of Object.entries(os.networkInterfaces())) {
    for (const record of records || []) {
      if (!record || record.internal || record.family !== 'IPv4' || !isPrivateNetworkHostname(record.address)) continue
      const target = virtualInterface.test(name) ? fallback : physical
      if (!target.includes(record.address)) target.push(record.address)
    }
  }
  return physical.length ? physical : fallback
}

function lanWebSocketUrls(options, wsPath, boundPort) {
  if (!options.lanEnabled) return []
  const advertised = typeof options.lanAdvertiseHost === 'string' ? options.lanAdvertiseHost.trim() : ''
  const hosts = advertised
    ? [advertised]
    : options.lanHost && options.lanHost !== '0.0.0.0' && options.lanHost !== '::'
      ? [options.lanHost]
      : privateLanAddresses()
  return hosts
    .filter((host) => isPrivateNetworkHostname(host))
    .map((host) => `ws://${host.includes(':') ? `[${host}]` : host}:${boundPort}${wsPath}`)
}

function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function normalizePublicUrl(value, req, wsPath) {
  let raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) {
    const host = req.headers.host || `127.0.0.1`
    raw = `${req.socket && req.socket.encrypted ? 'wss' : 'ws'}://${host}${wsPath}`
  }
  const url = new URL(raw)
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw badRequest('publicUrl must use wss:// (ws:// is allowed only for localhost and private LAN addresses)')
  if (url.username || url.password || url.search || url.hash) throw badRequest('publicUrl must not contain credentials, query parameters, or a fragment')
  if (url.protocol === 'ws:' && !isPrivateNetworkHostname(url.hostname)) throw badRequest('publicUrl must use wss:// outside localhost or a private LAN')
  return url.toString()
}

function isSameOrigin(req) {
  const origin = req.headers.origin
  if (origin === undefined) return true
  if (typeof origin !== 'string' || typeof req.headers.host !== 'string') return false
  try {
    return new URL(origin).host === req.headers.host
  } catch (error) {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    let bytes = 0
    let oversized = false
    req.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > MAX_MANAGEMENT_BODY_BYTES) oversized = true
      else data += chunk
    })
    req.on('end', () => {
      if (oversized) {
        const error = new Error('request body is too large')
        error.status = 413
        reject(error)
        return
      }
      try { resolve(data === '' ? {} : JSON.parse(data)) } catch (cause) {
        const error = new Error('request body must be valid JSON', { cause })
        error.status = 400
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function securityHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, { ...securityHeaders('application/json; charset=utf-8'), 'Content-Length': Buffer.byteLength(body) })
  res.end(body)
}

const plugin = {
  name: 'mobile-gateway',
  Config,
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
    const options = {
      path: DEFAULT_WS_PATH,
      requireAuth: true,
      gatewayEnabled: false,
      gatewayWaitTimeoutMs: DEFAULT_GATEWAY_WAIT_TIMEOUT_MS,
      adminLoopbackOnly: true,
      publicUrl: '',
      deviceFile: '',
      pairingTtlMs: DEFAULT_PAIRING_TTL_MS,
      allowQueryToken: false,
      publicUrlFile: '/etc/dsh-mobile-gateway/public-url',
      lanEnabled: false,
      lanHost: '0.0.0.0',
      lanPort: 3081,
      lanAdvertiseHost: '',
      ...(config || {}),
    }
    const wsPath = options.path
    if (typeof wsPath !== 'string' || !wsPath.startsWith('/') || wsPath.endsWith('/') || wsPath.includes('?') || wsPath.includes('#')) {
      throw new Error('mobile-gateway: path must be an absolute pathname without a trailing slash, query, or fragment')
    }
    if (options.lanEnabled === true && (typeof options.lanHost !== 'string' || !options.lanHost.trim())) {
      throw new Error('mobile-gateway: lanHost must be a non-empty listen address')
    }
    if (options.lanEnabled === true && options.lanAdvertiseHost && !isPrivateNetworkHostname(options.lanAdvertiseHost)) {
      throw new Error('mobile-gateway: lanAdvertiseHost must be localhost or a private LAN address')
    }
    let requireAuth = options.requireAuth !== false
    const adminLoopbackOnly = options.adminLoopbackOnly !== false
    const deviceFile = options.deviceFile || path.join(os.homedir(), '.dsh', 'mobile-gateway-devices.json')
    const registry = createRegistry(deviceFile, { pairingTtlMs: options.pairingTtlMs })
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 1024 * 1024,
      // Authentication data may ride in requested subprotocols, but a secret
      // must never be echoed as the negotiated protocol.
      handleProtocols(protocols) {
        return protocols.has('dsh-mobile-v1') ? 'dsh-mobile-v1' : false
      },
    })
    const clients = new Set()
    let counter = 0
    let gatewayEnabled = options.gatewayEnabled === true
    let waitExpiresAt = null
    let waitTimer = null
    let connectedSinceEnabled = false
    let lastAuthRejectLogAt = 0
    let suppressedAuthRejects = 0
    let lanServer = null
    let lanListening = false
    let lanListenError = null
    let lanBoundPort = options.lanPort
    const configuredPublicUrl = () => {
      if (typeof options.publicUrl === 'string' && options.publicUrl.trim()) return options.publicUrl.trim()
      if (typeof options.publicUrlFile !== 'string' || !options.publicUrlFile.trim()) return ''
      try {
        return fs.readFileSync(options.publicUrlFile, 'utf8')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line && !line.startsWith('#')) || ''
      } catch (error) {
        if (!error || error.code !== 'ENOENT') log(`unable to read publicUrlFile: ${error && error.message ? error.message : String(error)}`)
        return ''
      }
    }

    const setGatewayEnabled = (enabled, reason) => {
      if (waitTimer) clearTimeout(waitTimer)
      waitTimer = null
      gatewayEnabled = enabled
      waitExpiresAt = null
      connectedSinceEnabled = false
      if (enabled) {
        waitExpiresAt = Date.now() + options.gatewayWaitTimeoutMs
        waitTimer = setTimeout(() => {
          waitTimer = null
          if (!gatewayEnabled || connectedSinceEnabled || clients.size > 0) return
          gatewayEnabled = false
          waitExpiresAt = null
          log('mobile gateway automatically disabled: no device connected before timeout')
        }, options.gatewayWaitTimeoutMs)
      } else {
        for (const client of clients) client.close(4004, 'mobile gateway disabled')
      }
      log(`mobile gateway ${enabled ? 'enabled' : 'disabled'}${reason ? `: ${reason}` : ''}`)
    }

    const logAuthRejected = (req) => {
      const now = Date.now()
      if (now - lastAuthRejectLogAt >= 30_000) {
        const suffix = suppressedAuthRejects ? ` (${suppressedAuthRejects} repeated attempts suppressed)` : ''
        const remote = (req.socket && req.socket.remoteAddress) || 'unknown'
        const origin = typeof req.headers.origin === 'string' ? req.headers.origin.slice(0, 160) : '-'
        const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'].slice(0, 160) : '-'
        log(`auth rejected: missing or invalid device credential; remote=${remote}; origin=${origin}; user-agent=${userAgent}${suffix}`)
        lastAuthRejectLogAt = now
        suppressedAuthRejects = 0
      } else {
        suppressedAuthRejects += 1
      }
    }

    if (gatewayEnabled) setGatewayEnabled(true, 'enabled by startup config')

    log(`applying: path=${wsPath}, webServer.port=${webServer.port}, gatewayEnabled=${gatewayEnabled}, requireAuth=${requireAuth}, devices=${registry.count()}`)

    // ---- device management routes (loopback-gated admin surface) ----
    const disposeMgmt = webServer.register({
      kind: 'prefix',
      path: '/mgw',
      handler: async (req, res) => {
        try {
          if (adminLoopbackOnly && !isLoopback(req)) {
            sendJson(res, 403, { error: 'forbidden', message: 'management API is loopback-only' })
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD' && !isSameOrigin(req)) {
            sendJson(res, 403, { error: 'forbidden', message: 'cross-origin management request rejected' })
            return
          }
          const url = new URL(req.url || '/', 'http://x')
          const p = url.pathname
          if (req.method === 'GET' && p === '/mgw/status') {
            sendJson(res, 200, {
              requireAuth,
              gatewayEnabled,
              waitExpiresAt,
              connectedClients: clients.size,
              wsPath,
              publicUrl: configuredPublicUrl() || null,
              lan: {
                enabled: options.lanEnabled === true,
                listening: lanListening,
                host: options.lanHost,
                port: lanBoundPort,
                urls: lanWebSocketUrls(options, wsPath, lanBoundPort),
                requireAuth: true,
                error: lanListenError,
              },
              pairingTtlMs: options.pairingTtlMs,
              queryTokenAllowed: !!options.allowQueryToken,
            })
          } else if (req.method === 'POST' && p === '/mgw/gateway') {
            const body = await readBody(req)
            if (typeof body.enabled !== 'boolean') throw badRequest('enabled must be a boolean')
            setGatewayEnabled(body.enabled, 'changed from management UI')
            sendJson(res, 200, { gatewayEnabled, waitExpiresAt, connectedClients: clients.size })
          } else if (req.method === 'POST' && p === '/mgw/auth') {
            const body = await readBody(req)
            if (typeof body.enabled !== 'boolean') throw badRequest('enabled must be a boolean')
            requireAuth = body.enabled
            let disconnected = 0
            if (requireAuth) {
              for (const client of clients) {
                if (!client.deviceId) {
                  disconnected += 1
                  client.close(4003, 'authentication enabled')
                }
              }
            }
            log(`device authentication ${requireAuth ? 'enabled' : 'disabled'} from management UI`)
            sendJson(res, 200, { requireAuth, disconnected })
          } else if (req.method === 'GET' && p === '/mgw/devices') {
            sendJson(res, 200, { devices: registry.list() })
          } else if (req.method === 'POST' && p === '/mgw/pair') {
            if (!gatewayEnabled) {
              const error = new Error('enable the mobile gateway before creating a pairing code')
              error.status = 409
              throw error
            }
            const body = await readBody(req)
            const name = typeof body.name === 'string' ? body.name : undefined
            const publicUrl = normalizePublicUrl(body.publicUrl || configuredPublicUrl(), req, wsPath)
            const pairing = registry.createPairing(name)
            const payload = {
              version: 2,
              publicUrl,
              pairingCode: pairing.code,
              expiresAt: pairing.expiresAt,
            }
            // QR/manual pairing has one canonical wire representation: the
            // UTF-8 JSON payload encoded as unpadded Base64URL. Base64URL is
            // copy-safe and QR-safe (`+`, `/`, and `=` never appear), but is
            // encoding rather than encryption; secrecy still comes from the
            // short TTL and single-use pairing code.
            const qrPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
            const svg = await QRCode.toString(qrPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
            log(`pairing created: ${pairing.name} (${pairing.id}), expires=${new Date(pairing.expiresAt).toISOString()}`)
            sendJson(res, 201, {
              pairing: { id: pairing.id, name: pairing.name, expiresAt: pairing.expiresAt },
              payload,
              qrPayload,
              svg,
            })
          } else if (req.method === 'POST' && p.startsWith('/mgw/devices/') && p.endsWith('/revoke')) {
            const id = decodeURIComponent(p.slice('/mgw/devices/'.length, -'/revoke'.length))
            const revoked = registry.revoke(id)
            if (revoked) {
              for (const client of clients) {
                if (client.deviceId === id) client.close(4003, 'device revoked')
              }
              log(`device revoked: ${id}`)
            }
            sendJson(res, revoked ? 200 : 404, { revoked })
          } else if (req.method === 'GET' && p === '/mgw') {
            res.writeHead(302, { ...securityHeaders('text/plain; charset=utf-8'), Location: '/' })
            res.end('Open the device manager from the DSH sidebar.')
          } else {
            sendJson(res, 404, { error: 'not-found' })
          }
        } catch (error) {
          log(`mgmt route failed: ${error && error.message ? error.message : String(error)}`)
          const status = Number.isInteger(error && error.status) ? error.status : (error instanceof TypeError ? 400 : 500)
          sendJson(res, status, { error: status < 500 ? 'bad-request' : 'internal', message: error && error.message ? error.message : String(error) })
        }
      },
    })
    log(`management routes registered: /mgw (loopbackOnly=${adminLoopbackOnly})`)

    const handleMobileUpgrade = (req, socket, head, transport = {}) => {
        if (!gatewayEnabled) {
          rejectUpgrade(socket, 503, 'mobile gateway is disabled')
          return
        }
        let device
        let paired
        const credential = extractCredential(req, !!options.allowQueryToken)
        if (credential && credential.kind === 'pairing') {
          const clientDeviceId = extractClientDeviceId(req)
          if (!clientDeviceId) {
            log('pairing rejected: missing X-DSH-Device-ID (outdated client)')
            rejectUpgrade(socket, 400, 'pairing requires X-DSH-Device-ID; update the iOS client')
            return
          }
          paired = registry.claimPairing(credential.value, clientDeviceId)
          device = paired && paired.device
          if (!device) {
            log('pairing rejected: invalid, expired, or already-used code')
            rejectUpgrade(socket, 401, 'invalid or expired pairing code')
            return
          }
        } else if (credential && credential.kind === 'token') {
          device = registry.authenticate(credential.value, extractClientDeviceId(req))
        }

        // The separately exposed LAN listener is always authenticated. The
        // management UI's debug auth switch only affects the loopback DSH
        // listener and can never turn a LAN endpoint into an open control
        // plane.
        if ((requireAuth || transport.lan === true) && !device) {
          logAuthRejected(req)
          rejectUpgrade(socket, 401, 'missing or invalid device credential')
          return
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
          const id = ++counter
          ws.filterSessionId = undefined
          ws.deviceId = device && device.id
          clients.add(ws)
          if (device) registry.connected(device.id)
          if (!connectedSinceEnabled) {
            connectedSinceEnabled = true
            waitExpiresAt = null
            if (waitTimer) clearTimeout(waitTimer)
            waitTimer = null
            log('mobile gateway wait completed: device connected')
          }

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
                if (frame && ws.readyState === 1) ws.send(JSON.stringify(frame))
              })
            } else if (msg.type === 'workspaces' || msg.type === 'sessions' || msg.type === 'history' ||
                       msg.type === 'search' || msg.type === 'host' || msg.type === 'directories' ||
                       msg.type === 'workspace-create' || msg.type === 'models' || msg.type === 'select-model' ||
                       msg.type === 'permission-options' || msg.type === 'permission' || msg.type === 'context-usage' ||
                       msg.type === 'agent-presets' || msg.type === 'defaults' || msg.type === 'set-default' ||
                       msg.type === 'session-stats' || msg.type === 'default-model' ||
                       msg.type === 'save-default-model' || msg.type === 'fork' || msg.type === 'providers') {
              handleQuery(api, typertGateway, agentDefaultModel, msg).then((frame) => {
                if (frame && ws.readyState === 1) ws.send(JSON.stringify(frame))
              })
            } else {
              ws.send(JSON.stringify({ kind: 'error', message: 'unknown message type: ' + msg.type }))
            }
          })

          ws.on('close', () => {
            clients.delete(ws)
            if (ws.deviceId) registry.disconnected(ws.deviceId)
            log(`client disconnected (id=${id}, remaining=${clients.size})`)
          })

          log(`client connected (id=${id}, total=${clients.size})${device ? ' device=' + device.name : ''}`)
          if (paired) {
            ws.send(JSON.stringify({
              kind: 'paired',
              token: paired.token,
              device: paired.device,
            }))
          }
          ws.send(JSON.stringify({
            kind: 'hello',
            protocol: 2,
            port: transport.port || webServer.port,
            clients: clients.size,
            authenticated: !!device,
            ...(device ? { device: { id: device.id, name: device.name } } : {}),
          }))
        })
    }

    const disposeUpgrade = webServer.registerUpgrade({
      path: wsPath,
      handler(req, socket, head) {
        handleMobileUpgrade(req, socket, head, { port: webServer.port })
      },
    })
    log(`upgrade route registered: ${wsPath}`)

    // DSH intentionally keeps its own WebUI listener on loopback. When LAN
    // mode is enabled, expose a second, narrowly scoped listener that accepts
    // only the authenticated mobile WebSocket path. It does not serve the
    // WebUI or any /mgw management route.
    if (options.lanEnabled === true) {
      lanServer = http.createServer((req, res) => {
        sendJson(res, 404, { error: 'not-found' })
      })
      lanServer.on('upgrade', (req, socket, head) => {
        let pathname
        try {
          pathname = new URL(req.url || '/', 'http://lan.invalid').pathname
        } catch (error) {
          rejectUpgrade(socket, 400, 'invalid WebSocket path')
          return
        }
        if (pathname !== wsPath) {
          rejectUpgrade(socket, 404, 'not found')
          return
        }
        if (!req.socket || !req.socket.remoteAddress || !isPrivateNetworkHostname(req.socket.remoteAddress)) {
          rejectUpgrade(socket, 403, 'LAN listener accepts private-network clients only')
          return
        }
        handleMobileUpgrade(req, socket, head, { lan: true, port: lanBoundPort })
      })
      lanServer.on('error', (error) => {
        lanListening = false
        lanListenError = error && error.message ? error.message : String(error)
        log(`LAN listener failed: ${lanListenError}`)
      })
      lanServer.listen(options.lanPort, options.lanHost, () => {
        lanListening = true
        lanListenError = null
        const address = lanServer.address()
        if (address && typeof address === 'object') lanBoundPort = address.port
        const urls = lanWebSocketUrls(options, wsPath, lanBoundPort)
        log(`LAN listener ready: ${options.lanHost}:${lanBoundPort}${wsPath}${urls.length ? ` (${urls.join(', ')})` : ''}; authentication forced`)
      })
    }

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
      if (waitTimer) clearTimeout(waitTimer)
      disposeUpgrade()
      disposeMgmt()
      disposeEvents()
      if (lanServer) lanServer.close()
      for (const client of clients) client.terminate()
      clients.clear()
      wss.close()
      log('plugin stopped, all sockets closed')
    })
  },
}

export { Config, admitMessage, handleQuery }
export default plugin
