import { stringifyWireFrame } from './wire-json.mjs'
// dsh-plugin-mobile-gateway — persistent Host plugin.
//
// Two directions:
//  1. Agent -> mobile: registers a WebSocket endpoint at /ws/mobile on the dsh
//     web server and forwards agent session output (the same `session/event`
//     feed the browser UI consumes) to connected mobile clients as curated
//     JSON text frames.
//  2. Mobile -> agent: clients send a message through the same socket; the
//     plugin admits it through the DSH Remote Gateway Host API.
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
//                     { "type": "message", "sessionId"?, "text"?, "images"?:
//                       [{ "mediaType", "data", "name"? }], "mode"?: "queue"|"steer",
//                       "workspaceId"?, "cwd"?, "clientTimeZone"? }
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
//                     { "type": "attachment", "sessionId", "attachmentId" }
//                        -> verified image metadata + canonical base64 bytes
//                     { "type": "file-list", "requestId"?, "sessionId", "path"? }
//                     { "type": "file-download-open", "requestId", "sessionId", "path" }
//                     { "type": "file-download-read", "transferId", "offset" }
//                     { "type": "file-download-cancel", "transferId" }
//                     { "type": "search", "query" }                -> session search
//                     { "type": "host" }                           -> host.describe snapshot (incl. default provider/model)
//                     { "type": "default-model" }                   -> agentDefaultModel.currentSelection()
//                     { "type": "save-default-model", "provider", "model", "reasoningEffort"? }
//                     { "type": "directories", "path"? }           -> server dir listing (fs-based)
//                     { "type": "directory-create", "path", "name" } -> create one child directory
//                     { "type": "workspace-create", "path" }       -> create workspace over a dir
//                     { "type": "fork", "sessionId", "atSeq"? }    -> branch a new session from a completed turn
//                     { "type": "session-cancel", "sessionId" }     -> stop the active turn and retain queued work
//                     { "type": "queue-update", "sessionId", "itemId",
//                       "action": "edit"|"remove"|"steer", "text"? }
//                        -> edit/remove one pending item or move it into the current turn
//                     { "type": "session-archive", "sessionId" }    -> hide a session from workspace surfaces
//                     { "type": "session-rename", "sessionId", "title" } -> persist a user-owned session title
//                     { "type": "models", "sessionId"? }           -> per-session catalog (with sessionId) or global (without)
//                     { "type": "providers" }                       -> configurable provider list (live/dormant)
//                     { "type": "commands", "sessionId" }          -> slash-command catalog for this session
//                     { "type": "command-execute", "sessionId", "line", "images"? } -> execute a Host command
//                     { "type": "command-options", "sessionId", "command" } -> normalized submenu options
//                     { "type": "command-select", "sessionId", "command", "optionId" } -> apply submenu option
//                     { "type": "select-model", "sessionId", "provider", "model", "reasoningEffort"? }
//                     { "type": "permission-options", "sessionId"? } -> permission presets (+ session knobs)
//                     { "type": "permission", "sessionId", "name" }  -> switch preset via /permission command
//                     { "type": "context-usage", "sessionId" }       -> tokenUsage + contextPressure projections
//                     { "type": "session-stats", "sessionId" }       -> sessionStats + tokenUsage projections
//                        (the input-box stats strip source)
//                     { "type": "tasks", "sessionId" }               -> current todo-list projection
//                     { "type": "goal", "sessionId" }                -> current goal projection
//                     { "type": "goal-edit", "sessionId", "ref", "objective"?, "maxGoalRounds"? }
//                     { "type": "goal-pause"|"goal-resume"|"goal-clear", "sessionId", "ref" }
//                     { "type": "agent-presets" }                     -> preset roster (+ isDefault)
//                     { "type": "defaults" }                          -> default agent preset + default permission
//                     { "type": "set-default", "target": "agent-preset"|"permission", "value" }
//                     { "type": "question-answer", "rpcId", "sessionId", "answers": [...] }
//                     { "type": "question-cancel", "rpcId", "sessionId" }
//                     { "type": "approval-response", "rpcId", "sessionId", "approvalId",
//                       "outcome": "allowed-once"|"rejected" }
//   server -> client: { "kind": "hello", "protocol": 3, "capabilities": ["images", "commands", "tasks", "goals", "session-cancel", "queue-control", "session-archive", "session-rename", "file-downloads"],
//                       "authenticated", "device"?, "port", "clients" }
//                     { "kind": "pong", "at" }
//                     { "kind": "subscribed", "sessionId" }
//                     { "kind": "sent", "sessionId", "mode", "command"? }
//                     { "kind": "workspaces" | "sessions" | "history" | "search", ...data }
//                     { "kind": "commands", "sessionId", "groups": [
//                       { "id", "title", "items": [{ "id", "name", "description", "ui" }] }
//                     ] }
//                     { "kind": "command-options", "sessionId", "command", "options": [
//                       { "id", "label", "detail"?, "description"?, "selected" }
//                     ] }
//                     { "kind": "command-executed", "sessionId", "line", "commandId", "result" }
//                     { "kind": "command-selected", "sessionId", "command", "selected" }
//                     { "kind": "attachment", "sessionId", "attachment", "data" }
//                     { "kind": "file-list", "requestId"?, "sessionId", "path", "entries" }
//                     { "kind": "file-download-opened", "requestId", "transferId", "sessionId",
//                       "path", "name", "mediaType", "size", "chunkBytes" }
//                     { "kind": "file-download-chunk", "transferId", "offset", "data", "eof", "sha256"? }
//                     { "kind": "file-download-cancelled", "transferId" }
//                     { "kind": "session-cancelled", "sessionId", "accepted": true }
//                     { "kind": "queue-item-updated", "sessionId", "itemId", "action", "accepted": true }
//                     { "kind": "session-queues", "queues": { "<sessionId>": [...] } }
//                     { "kind": "session-queue", "sessionId", "items": [...] }
//                     { "kind": "session-archived", "sessionId", "archivedSessionIds" }
//                     { "kind": "session-renamed", "sessionId", "title", "seq" }
//                     { "kind": "session-archives", "archivedSessionIds" }
//                     { "kind": "session-title-changed", "sessionId", "title", "seq", "time", "source"? }
//                     { "kind": "error", "code", "message", "requestType"?, "sessionId"? }
//                     { "kind": "event", "sessionId", "seq", "time", "event": { ... } }
//                     { "kind": "tasks", "sessionId", "asOfSeq", "todos" }
//                     { "kind": "goal", "sessionId", "asOfSeq", "goal" }
//                     { "kind": "goal-edit"|"goal-pause"|"goal-resume", "sessionId", "ref" }
//                     { "kind": "goal-clear", "sessionId", "cleared": true }
//                     { "kind": "tasks-updated", "sessionId", "asOfSeq", "todos" }
//                     { "kind": "goal-updated", "sessionId", "asOfSeq", "goal" }
//                     { "kind": "question-requested", "rpcId", "sessionId", "questions", "replay"? }
//                     { "kind": "question-response", "rpcId", "sessionId", "action", "accepted", "reason"? }
//                     { "kind": "question-resolved", "rpcId", "sessionId", "outcome" }
//                     { "kind": "approval-requested", "rpcId", "sessionId", "approvalId",
//                       "toolName", "callId"?, "reason"?, "replay"? }
//                     { "kind": "approval-response", "rpcId", "sessionId", "approvalId",
//                       "outcome", "accepted", "reason"? }
//                     { "kind": "approval-resolved", "rpcId", "sessionId", "approvalId", "outcome" }
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { WebSocketServer } from 'ws'
import devicesModule from './devices.js'
import { createDshHostAdapter, DSH_VERSION, SESSION_FORMAT_VERSION } from './dsh-host-adapter.mjs'
import { createSessionFollower } from './session-follower.mjs'
import { createGatewayState, GATEWAY_MODES } from './gateway-state.mjs'
import QRCode from 'qrcode'

const { createRegistry } = devicesModule

const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
})()
const MAX_PREVIEW = 400
const LOG_FILE = '/tmp/mobile-gateway.log'
const HELPER_SOCKET = '/run/dsh-mobile-gateway/helper.sock'
const DEFAULT_WS_PATH = '/ws/mobile'
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000
const DEFAULT_GATEWAY_WAIT_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_FILE_DOWNLOAD_MAX_BYTES = 512 * 1024 * 1024
const DEFAULT_FILE_DOWNLOAD_CHUNK_BYTES = 512 * 1024
const DEFAULT_FILE_DOWNLOAD_IDLE_MS = 2 * 60 * 1000
const DEFAULT_FILE_DOWNLOAD_MAX_TRANSFERS = 4
const INTERACTION_PROTOCOL_REVISION = 'question-approval-v2'
// DSH 0.1.1 allows up to 100 MiB of decoded images in one prompt. Base64 plus
// the JSON envelope needs roughly 4/3 of that on the wire. Keep this separately
// configurable so deployments may choose a lower transport ceiling.
const DEFAULT_MAX_WS_PAYLOAD_BYTES = 144 * 1024 * 1024
const MAX_MANAGEMENT_BODY_BYTES = 16 * 1024
const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const COMMAND_UI_OVERRIDES = Object.freeze({
  permission: Object.freeze({
    kind: 'select',
    optionsRequest: 'command-options',
    selectionRequest: 'command-select',
  }),
  model: Object.freeze({
    kind: 'select',
    optionsRequest: 'command-options',
    selectionRequest: 'command-select',
  }),
})
const COMMAND_CATALOG_COPY = Object.freeze({
  zh: Object.freeze({
    locale: 'zh-CN',
    commandsTitle: '命令',
    skillsTitle: '技能',
    userOnly: '仅用户',
    modelDescription: '选择本会话使用的模型',
    hints: Object.freeze({
      plan: '描述你的任务以生成计划',
      goal: '输入目标，智能体将持续执行',
    }),
  }),
  en: Object.freeze({
    locale: 'en',
    commandsTitle: 'Commands',
    skillsTitle: 'Skills',
    userOnly: 'user-only',
    modelDescription: 'Select the model for this conversation',
    hints: Object.freeze({
      plan: 'describe your task to generate plan',
      goal: 'describe the objective for a long-running task',
    }),
  }),
})

// Cordis validates this schema at plugin load and fills these defaults. Keep
// the defaults conservative: installing the bundle must never create an
// unauthenticated network control plane.
const Config = Schema.object({
  path: Schema.string().default(DEFAULT_WS_PATH),
  requireAuth: Schema.boolean().default(true),
  gatewayEnabled: Schema.boolean().default(false),
  gatewayMode: Schema.union(GATEWAY_MODES),
  gatewayStateFile: Schema.string().default(''),
  gatewayName: Schema.string().default(''),
  endpoints: Schema.array(Schema.string()).default([]),
  gatewayWaitTimeoutMs: Schema.natural().min(30_000).max(30 * 60 * 1000).default(DEFAULT_GATEWAY_WAIT_TIMEOUT_MS),
  maxPayloadBytes: Schema.natural().min(1024 * 1024).max(160 * 1024 * 1024).default(DEFAULT_MAX_WS_PAYLOAD_BYTES),
  fileDownloadsEnabled: Schema.boolean().default(true),
  fileDownloadMaxBytes: Schema.natural().min(1024 * 1024).max(2 * 1024 * 1024 * 1024).default(DEFAULT_FILE_DOWNLOAD_MAX_BYTES),
  fileDownloadChunkBytes: Schema.natural().min(64 * 1024).max(1024 * 1024).default(DEFAULT_FILE_DOWNLOAD_CHUNK_BYTES),
  fileDownloadIdleMs: Schema.natural().min(10_000).max(30 * 60 * 1000).default(DEFAULT_FILE_DOWNLOAD_IDLE_MS),
  fileDownloadMaxTransfers: Schema.natural().min(1).max(16).default(DEFAULT_FILE_DOWNLOAD_MAX_TRANSFERS),
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

function imagesOf(blocks) {
  const images = []
  for (const block of blocks) {
    if (!block || block.type !== 'image' || !block.attachment) continue
    const attachment = block.attachment
    images.push({
      attachmentId: attachment.attachmentId,
      mediaType: attachment.mediaType,
      bytes: attachment.bytes,
      width: attachment.width,
      height: attachment.height,
      ...(attachment.name ? { name: attachment.name } : {}),
    })
  }
  return images
}

// Build the small, owned JSON wire record for one session event. Reads only
// leaf fields of the live SessionEvent — never serializes live objects.
function buildWireEvent(session, event) {
  const base = { kind: 'event', sessionId: String(session.id), seq: event.seq, time: event.time,
    ...(event.surfaceOp === undefined ? {} : { surfaceOp: event.surfaceOp }),
    ...(event.sourceEventSeqs === undefined ? {} : { sourceEventSeqs: event.sourceEventSeqs }),
  }
  const d = event.data || {}
  switch (event.type) {
    case 'user/message': {
      const images = imagesOf(d.content || [])
      return Object.assign(base, {
        event: {
          type: 'user/message',
          text: textOf(d.content || []),
          source: d.source && d.source.kind,
          ...(images.length ? { images } : {}),
        },
      })
    }
    case 'assistant/message': {
      const blocks = (d.message && d.message.content) || []
      let text = ''
      let reasoning = ''
      const toolCalls = []
      const images = imagesOf(blocks)
      for (const block of blocks) {
        if (!block) continue
        if (block.type === 'text' && typeof block.text === 'string') text += block.text
        else if (block.type === 'reasoning' && typeof block.text === 'string') reasoning += block.text
        else if (block.type === 'tool-call') toolCalls.push({ id: block.id, name: block.name, arguments: block.arguments })
      }
      return Object.assign(base, {
        event: { type: 'assistant/message', turn: d.turn, step: d.step, text, reasoning, toolCalls,
          ...(d.interrupted === true ? { interrupted: true } : {}),
          ...(d.usage === undefined ? {} : { usage: d.usage }),
          ...(images.length ? { images } : {}),
        },
      })
    }
    case 'assistant/attempt':
      return Object.assign(base, { event: { type: event.type, turn: d.turn, step: d.step, stream: d.stream } })
    case 'session/title':
      return Object.assign(base, {
        event: {
          type: 'session/title',
          title: d.title,
          ...(d.source ? { source: d.source } : {}),
        },
      })
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
          isError: !!d.error || ((d.message && d.message.content) || []).some(block => block?.type === 'tool-result' && block.isError === true),
          preview,
        },
      })
    }
    case 'command/run':
      return Object.assign(base, {
        event: {
          type: 'command/run',
          commandId: d.commandId,
          name: d.name,
          ...(typeof d.args === 'string' ? { args: d.args } : {}),
          ...(d.source ? { source: d.source } : {}),
        },
      })
    case 'command/done':
      return Object.assign(base, {
        event: {
          type: 'command/done',
          commandId: d.commandId,
          outcome: d.kind,
          ...(typeof d.text === 'string' ? { text: d.text } : {}),
          ...(typeof d.sourceEventSeq === 'number' ? { sourceEventSeq: d.sourceEventSeq } : {}),
        },
      })
    case 'compaction/start':
      return Object.assign(base, {
        event: {
          type: 'compaction/start',
          compactionId: d.compactionId,
          ...(d.sourceCommandId ? { sourceCommandId: d.sourceCommandId } : {}),
          turn: d.turn ?? null,
        },
      })
    case 'compaction/summary':
      return Object.assign(base, {
        event: {
          type: 'compaction/summary',
          compactionId: d.compactionId,
          ...(d.sourceCommandId ? { sourceCommandId: d.sourceCommandId } : {}),
          shadowedItemCount: Array.isArray(d.shadowedSeqs) ? d.shadowedSeqs.length : null,
          shadowedTokenCount: typeof d.shadowedTokenCount === 'number' ? d.shadowedTokenCount : null,
        },
      })
    case 'compaction/end':
      return Object.assign(base, {
        event: {
          type: 'compaction/end',
          compactionId: d.compactionId,
          ...(d.sourceCommandId ? { sourceCommandId: d.sourceCommandId } : {}),
          turn: d.turn ?? null,
          ...(typeof d.error === 'string' ? { error: d.error } : {}),
        },
      })
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

function parseWireImages(rawImages, requestType) {
  const images = rawImages === undefined ? [] : rawImages
  if (!Array.isArray(images)) {
    return { error: { kind: 'error', code: 'bad-request', message: 'images must be an array', requestType } }
  }
  if (images.length > 20) {
    return { error: { kind: 'error', code: 'bad-request', message: 'a request can contain at most 20 images', requestType } }
  }
  const imageParts = []
  for (let index = 0; index < images.length; index++) {
    const image = images[index]
    if (!image || typeof image !== 'object') {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}] must be an object`, requestType } }
    }
    if (!IMAGE_MEDIA_TYPES.has(image.mediaType)) {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}].mediaType is unsupported`, requestType } }
    }
    if (typeof image.data !== 'string' || image.data.length === 0) {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}].data must be a non-empty base64 string`, requestType } }
    }
    if (image.name !== undefined && (typeof image.name !== 'string' || image.name.length > 255)) {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}].name must be a string of at most 255 characters`, requestType } }
    }
    imageParts.push({
      type: 'image',
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name ? { name: image.name } : {}),
    })
  }
  return { value: imageParts }
}

function commandNameOf(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('/')) return null
  const end = trimmed.search(/\s/)
  return (end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)) || null
}

async function listHostCommands(host, sessionId) {
  const listed = await host.commands.list(sessionId, new AbortController().signal)
  if (!Array.isArray(listed)) throw new Error('commands/list returned an invalid catalog')
  return listed
}

async function executeHostCommand(host, sessionId, line, images, requestType) {
  try {
    const execution = await host.commands.execute(sessionId, line, images, new AbortController().signal)
    if (execution === undefined || execution === null) {
      return { kind: 'error', code: 'unknown-command', message: `unknown or malformed command: ${line}`, requestType, sessionId }
    }
    log(`command executed: session=${sessionId} line=${JSON.stringify(line)} commandId=${execution.commandId} outcome=${execution.result.kind}`)
    return {
      kind: 'command-executed',
      sessionId,
      line,
      commandId: execution.commandId,
      result: execution.result,
    }
  } catch (error) {
    const code = error && error.code ? error.code : 'internal'
    const message = error && error.message ? error.message : String(error)
    log(`command rejected: session=${sessionId} ${code}: ${message}`)
    return { kind: 'error', code, message, requestType, sessionId }
  }
}

async function admitCommand(host, msg) {
  const sessionId = requireSessionId(msg)
  if (sessionId.error) return sessionId.error
  const line = typeof msg.line === 'string' ? msg.line.trim() : ''
  const name = commandNameOf(line)
  if (!name) {
    return { kind: 'error', code: 'bad-request', message: 'command-execute requires a slash-prefixed line', requestType: 'command-execute', sessionId: sessionId.value }
  }
  const parsedImages = parseWireImages(msg.images, 'command-execute')
  if (parsedImages.error) return { ...parsedImages.error, sessionId: sessionId.value }
  try {
    const listed = await listHostCommands(host, sessionId.value)
    const descriptor = listed.find((command) => command && command.name === name)
    if (!descriptor) {
      return { kind: 'error', code: 'unknown-command', message: `command not found: /${name}`, requestType: 'command-execute', sessionId: sessionId.value }
    }
    if (parsedImages.value.length > 0 && !commandAcceptsAttachments(descriptor)) {
      return { kind: 'error', code: 'bad-request', message: `/${name} does not accept image attachments`, requestType: 'command-execute', sessionId: sessionId.value }
    }
    return executeHostCommand(host, sessionId.value, line, parsedImages.value, 'command-execute')
  } catch (error) {
    const code = error && error.code ? error.code : 'internal'
    const message = error && error.message ? error.message : String(error)
    return { kind: 'error', code, message, requestType: 'command-execute', sessionId: sessionId.value }
  }
}

// Handle one mobile -> agent message through the official host API. Returns
// the wire frame to send back, or null when nothing should be sent.
async function admitMessage(api, msg) {
  const text = typeof msg.text === 'string' ? msg.text.trim() : ''
  const parsedImages = parseWireImages(msg.images, 'message')
  if (parsedImages.error) return parsedImages.error
  const imageParts = parsedImages.value
  if (!text && imageParts.length === 0) {
    return { kind: 'error', code: 'bad-request', message: 'message requires non-empty text or at least one image' }
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
      const created = await api.sessions.create(createPayload)
      sessionId = created.sessionId
      log(`mobile message created new session ${sessionId} (${JSON.stringify(createPayload)})`)
    }

    const resp = await api.sessions.prompt({
      sessionId,
      mode,
      // Match the official WebUI ordering: images first, optional text last.
      content: [...imageParts, ...(text ? [{ type: 'text', text }] : [])],
      ...(typeof msg.clientTimeZone === 'string' && msg.clientTimeZone.trim() ? { clientTimeZone: msg.clientTimeZone.trim() } : {}),
    })
    log(`mobile message accepted: session=${sessionId} mode=${mode} images=${imageParts.length} text="${text.slice(0, 60)}"`)
    return {
      kind: 'sent',
      sessionId,
      mode,
      ...(resp.command ? { command: resp.command } : {}),
    }
  } catch (error) {
    const code = error && error.code ? error.code : 'internal'
    const message = error && error.message ? error.message : String(error)
    log(`mobile message failed: ${message}`)
    return { kind: 'error', code, message, ...(sessionId ? { sessionId } : {}) }
  }
}

// Proxy one read-only query to the official host API (the same surface the
// browser uses). Success returns `{ kind: <type>, ...value }`; failure returns
// the uniform `{ kind: 'error', code, message, requestType }` frame.
async function proxyQuery(api, type, method, payload, signal) {
  try {
    const value = signal ? await method(payload, signal) : await method(payload)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${type} returned an invalid response`)
    }
    log(`query ok: ${type}`)
    return { kind: type, ...value }
  } catch (error) {
    const code = error && error.code ? error.code : 'internal'
    const message = error && error.message ? error.message : String(error)
    log(`query failed: ${type} -> ${code}: ${message}`)
    return { kind: 'error', code, message, requestType: type }
  }
}

// Projection queries must keep the caller's request identity on failure.
// They need the opening cut and projections, not the full conversation body.
async function querySessionProjection(api, requestType, sessionId) {
  const history = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), { sessionId, maxMessages: 1 })
  return history.kind === 'error' ? { ...history, requestType, sessionId } : history
}

function fileTransferError(code, message, requestType, sessionId) {
  return {
    kind: 'error',
    code,
    message,
    requestType,
    ...(sessionId ? { sessionId } : {}),
  }
}

function fileMediaType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.apk': return 'application/vnd.android.package-archive'
    case '.doc': return 'application/msword'
    case '.docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case '.ipa': return 'application/octet-stream'
    case '.json': return 'application/json'
    case '.pdf': return 'application/pdf'
    case '.ppt': return 'application/vnd.ms-powerpoint'
    case '.pptx': return 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    case '.txt': return 'text/plain'
    case '.xls': return 'application/vnd.ms-excel'
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    case '.zip': return 'application/zip'
    default: return 'application/octet-stream'
  }
}

function workspaceRelativePath(root, target) {
  const relative = path.relative(root, target)
  return relative ? relative.split(path.sep).join('/') : '.'
}

function isInsideWorkspace(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function normalizedWorkspaceInput(value, { allowEmpty = false } = {}) {
  if (value === undefined && allowEmpty) return '.'
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed && allowEmpty) return '.'
  if (!trimmed || trimmed.includes('\0') || path.isAbsolute(trimmed)) return null
  if (trimmed.split(/[\\/]+/).includes('..')) return null
  return trimmed
}

// Owns only workspace-scoped, regular-file downloads. The host API has an
// image-only attachment read path, so arbitrary document/archive bytes must be
// guarded here instead of accepting a host path from the mobile client.
function createFileTransferManager(api, options) {
  const transfers = new Map()

  const closeTransfer = async (transferId) => {
    const transfer = transfers.get(transferId)
    if (!transfer) return false
    transfers.delete(transferId)
    try {
      await transfer.handle.close()
    } catch {
      // A failed close cannot make a completed or cancelled transfer usable.
    }
    return true
  }

  const resolveSessionRoot = async (sessionId, requestType) => {
    const sessions = await proxyQuery(api, requestType, api.sessions.list.bind(api.sessions), {})
    if (sessions.kind === 'error') return sessions
    const item = Array.isArray(sessions.items)
      ? sessions.items.find((entry) => entry && String(entry.sessionId) === sessionId)
      : null
    if (!item) return fileTransferError('session-not-found', 'no such session', requestType, sessionId)
    if (typeof item.cwd !== 'string' || !item.cwd.trim()) {
      return fileTransferError('file-workspace-unavailable', 'the session has no working directory', requestType, sessionId)
    }
    try {
      const root = await fsp.realpath(item.cwd)
      const stat = await fsp.stat(root)
      if (!stat.isDirectory()) {
        return fileTransferError('file-workspace-unavailable', 'the session working directory is unavailable', requestType, sessionId)
      }
      return { root }
    } catch {
      return fileTransferError('file-workspace-unavailable', 'the session working directory is unavailable', requestType, sessionId)
    }
  }

  const resolveWorkspaceTarget = async (sessionId, rawPath, requestType, inputOptions) => {
    const requested = normalizedWorkspaceInput(rawPath, inputOptions)
    if (!requested) {
      return fileTransferError('bad-request', `${requestType} requires a relative workspace path`, requestType, sessionId)
    }
    const rootResult = await resolveSessionRoot(sessionId, requestType)
    if (rootResult.kind === 'error') return rootResult
    const candidate = path.resolve(rootResult.root, requested)
    if (!isInsideWorkspace(rootResult.root, candidate)) {
      return fileTransferError('file-not-allowed', 'path must stay inside the session working directory', requestType, sessionId)
    }
    try {
      const target = await fsp.realpath(candidate)
      if (!isInsideWorkspace(rootResult.root, target)) {
        return fileTransferError('file-not-allowed', 'path must stay inside the session working directory', requestType, sessionId)
      }
      const stat = await fsp.stat(target)
      return { root: rootResult.root, target, stat }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return fileTransferError('file-not-found', 'file does not exist', requestType, sessionId)
      }
      return fileTransferError('file-unreadable', 'file cannot be read', requestType, sessionId)
    }
  }

  const fileList = async (msg) => {
    const session = requireSessionId(msg)
    if (session.error) return session.error
    const resolved = await resolveWorkspaceTarget(session.value, msg.path, 'file-list', { allowEmpty: true })
    if (resolved.kind === 'error') return resolved
    if (!resolved.stat.isDirectory()) {
      return fileTransferError('file-not-directory', 'path is not a directory', 'file-list', session.value)
    }
    try {
      const dirents = await fsp.readdir(resolved.target, { withFileTypes: true })
      const entries = []
      for (const dirent of dirents) {
        if (dirent.isSymbolicLink()) continue
        const child = path.join(resolved.target, dirent.name)
        if (dirent.isDirectory()) {
          entries.push({ name: dirent.name, path: workspaceRelativePath(resolved.root, child), kind: 'directory' })
        } else if (dirent.isFile()) {
          const stat = await fsp.stat(child)
          entries.push({
            name: dirent.name,
            path: workspaceRelativePath(resolved.root, child),
            kind: 'file',
            bytes: stat.size,
            modifiedAt: stat.mtimeMs,
            mediaType: fileMediaType(child),
          })
        }
      }
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1))
      const requestId = typeof msg.requestId === 'string' && msg.requestId.trim() ? msg.requestId.trim() : null
      return {
        kind: 'file-list',
        ...(requestId ? { requestId } : {}),
        sessionId: session.value,
        path: workspaceRelativePath(resolved.root, resolved.target),
        entries,
      }
    } catch {
      return fileTransferError('file-unreadable', 'directory cannot be read', 'file-list', session.value)
    }
  }

  const open = async (client, msg) => {
    const requestId = typeof msg.requestId === 'string' && msg.requestId.trim() ? msg.requestId.trim() : null
    const session = requireSessionId(msg)
    if (!requestId) return fileTransferError('bad-request', 'file-download-open requires a requestId', 'file-download-open')
    if (session.error) return session.error
    if (transfers.size >= options.fileDownloadMaxTransfers) {
      return fileTransferError('file-transfer-limit', 'too many active file downloads', 'file-download-open', session.value)
    }
    const resolved = await resolveWorkspaceTarget(session.value, msg.path, 'file-download-open')
    if (resolved.kind === 'error') return resolved
    if (!resolved.stat.isFile()) {
      return fileTransferError('file-not-regular', 'only regular files can be downloaded', 'file-download-open', session.value)
    }
    if (resolved.stat.size > options.fileDownloadMaxBytes) {
      return fileTransferError('file-too-large', 'file exceeds the configured download limit', 'file-download-open', session.value)
    }

    let handle
    try {
      // Reject a last-moment leaf symlink replacement after the realpath
      // containment check above. macOS and Linux both support O_NOFOLLOW.
      handle = await fsp.open(resolved.target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
      const opened = await handle.stat()
      if (!opened.isFile() || opened.size !== resolved.stat.size) {
        await handle.close()
        return fileTransferError('file-changed', 'file changed before download could start', 'file-download-open', session.value)
      }
    } catch {
      return fileTransferError('file-unreadable', 'file cannot be opened', 'file-download-open', session.value)
    }

    const transferId = crypto.randomUUID()
    const transfer = {
      client,
      handle,
      sessionId: session.value,
      path: workspaceRelativePath(resolved.root, resolved.target),
      name: path.basename(resolved.target),
      mediaType: fileMediaType(resolved.target),
      size: resolved.stat.size,
      offset: 0,
      hash: crypto.createHash('sha256'),
      reading: false,
      lastActiveAt: Date.now(),
    }
    transfers.set(transferId, transfer)
    log(`file download opened: transfer=${transferId} session=${transfer.sessionId} bytes=${transfer.size}`)
    return {
      kind: 'file-download-opened',
      requestId,
      transferId,
      sessionId: transfer.sessionId,
      path: transfer.path,
      name: transfer.name,
      mediaType: transfer.mediaType,
      size: transfer.size,
      chunkBytes: options.fileDownloadChunkBytes,
    }
  }

  const read = async (client, msg) => {
    const transferId = typeof msg.transferId === 'string' && msg.transferId.trim() ? msg.transferId.trim() : null
    if (!transferId) return fileTransferError('bad-request', 'file-download-read requires a transferId', 'file-download-read')
    const transfer = transfers.get(transferId)
    if (!transfer || transfer.client !== client) {
      return fileTransferError('file-transfer-not-found', 'file download is no longer active', 'file-download-read')
    }
    if (!Number.isSafeInteger(msg.offset) || msg.offset !== transfer.offset) {
      return fileTransferError('file-transfer-offset', 'offset must match the next unread byte', 'file-download-read', transfer.sessionId)
    }
    if (transfer.reading) {
      return fileTransferError('file-transfer-busy', 'a chunk read is already in progress', 'file-download-read', transfer.sessionId)
    }

    transfer.reading = true
    try {
      const remaining = transfer.size - transfer.offset
      const bytesToRead = Math.min(options.fileDownloadChunkBytes, remaining)
      const chunk = Buffer.allocUnsafe(bytesToRead)
      const { bytesRead } = bytesToRead === 0
        ? { bytesRead: 0 }
        : await transfer.handle.read(chunk, 0, bytesToRead, transfer.offset)
      if (bytesRead !== bytesToRead) {
        await closeTransfer(transferId)
        return fileTransferError('file-changed', 'file changed during download', 'file-download-read', transfer.sessionId)
      }
      const payload = bytesRead === chunk.length ? chunk : chunk.subarray(0, bytesRead)
      transfer.hash.update(payload)
      const offset = transfer.offset
      transfer.offset += bytesRead
      transfer.lastActiveAt = Date.now()
      const eof = transfer.offset === transfer.size
      const frame = {
        kind: 'file-download-chunk',
        transferId,
        offset,
        data: payload.toString('base64'),
        eof,
      }
      if (eof) {
        frame.sha256 = transfer.hash.digest('hex')
        await closeTransfer(transferId)
        log(`file download completed: transfer=${transferId} bytes=${transfer.size}`)
      }
      return frame
    } catch {
      await closeTransfer(transferId)
      return fileTransferError('file-unreadable', 'file cannot be read', 'file-download-read', transfer.sessionId)
    } finally {
      transfer.reading = false
    }
  }

  const cancel = async (client, msg) => {
    const transferId = typeof msg.transferId === 'string' && msg.transferId.trim() ? msg.transferId.trim() : null
    if (!transferId) return fileTransferError('bad-request', 'file-download-cancel requires a transferId', 'file-download-cancel')
    const transfer = transfers.get(transferId)
    if (!transfer || transfer.client !== client) {
      return fileTransferError('file-transfer-not-found', 'file download is no longer active', 'file-download-cancel')
    }
    await closeTransfer(transferId)
    log(`file download cancelled: transfer=${transferId}`)
    return { kind: 'file-download-cancelled', transferId }
  }

  const expire = async () => {
    const cutoff = Date.now() - options.fileDownloadIdleMs
    for (const [transferId, transfer] of transfers) {
      if (transfer.lastActiveAt < cutoff && !transfer.reading) {
        await closeTransfer(transferId)
        log(`file download expired: transfer=${transferId}`)
      }
    }
  }

  return {
    async handle(client, msg) {
      if (!options.fileDownloadsEnabled) {
        return fileTransferError('file-download-disabled', 'file downloads are disabled by gateway configuration', msg.type)
      }
      if (msg.type === 'file-list') return fileList(msg)
      if (msg.type === 'file-download-open') return open(client, msg)
      if (msg.type === 'file-download-read') return read(client, msg)
      if (msg.type === 'file-download-cancel') return cancel(client, msg)
      return null
    },
    async closeClient(client) {
      for (const [transferId, transfer] of transfers) {
        if (transfer.client === client) await closeTransfer(transferId)
      }
    },
    async dispose() {
      for (const transferId of [...transfers.keys()]) await closeTransfer(transferId)
    },
    expire,
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

function directoryCreateError(code, message) {
  return { kind: 'error', code, message, requestType: 'directory-create' }
}

// Create one child directory directly on the host filesystem. This deliberately
// shares the same backend as `directories`: macOS native Directory Picker only
// exposes its system dialog and does not implement remote createDirectory RPCs.
async function createServerDirectory(parentPath, directoryName) {
  if (typeof parentPath !== 'string' || parentPath.trim() === '') {
    return directoryCreateError('bad-request', 'directory-create requires an absolute parent path')
  }
  const parent = path.resolve(parentPath.trim())
  if (!path.isAbsolute(parentPath.trim())) {
    return directoryCreateError('bad-request', 'directory-create path must be absolute')
  }

  if (typeof directoryName !== 'string') {
    return directoryCreateError('bad-request', 'directory-create requires a folder name')
  }
  const name = directoryName.trim()
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    return directoryCreateError('bad-request', 'directory-create name must be a single non-empty folder name')
  }

  try {
    const stat = await fsp.stat(parent)
    if (!stat.isDirectory()) {
      return directoryCreateError('directory-create-failed', 'parent path is not a directory')
    }
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    log(`query failed: directory-create -> ${message}`)
    return directoryCreateError('directory-create-failed', message)
  }

  const target = path.join(parent, name)
  try {
    await fsp.mkdir(target)
    log(`query ok: directory-create (${target})`)
    return { kind: 'directory-create', path: target }
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      return directoryCreateError('directory-exists', 'directory already exists')
    }
    const message = error && error.message ? error.message : String(error)
    log(`query failed: directory-create -> ${message}`)
    return directoryCreateError('directory-create-failed', message)
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

// Goal mutations use DSH's compare-and-set reference. Returning a stale
// revision is intentionally rejected by DSH instead of overwriting a newer
// WebUI/mobile update.
function requireGoalRef(msg, sessionId) {
  const ref = msg.ref
  const id = ref && typeof ref.id === 'string' && ref.id.trim() !== '' ? ref.id.trim() : null
  const revision = ref && typeof ref.revision === 'number' && Number.isSafeInteger(ref.revision) && ref.revision > 0
    ? ref.revision
    : null
  if (!id || revision === null) {
    return {
      error: {
        kind: 'error',
        code: 'bad-request',
        message: `${typeof msg.type === 'string' ? msg.type : 'goal mutation'} requires ref.id and a positive integer ref.revision`,
        requestType: typeof msg.type === 'string' ? msg.type : 'goal',
        sessionId,
      },
    }
  }
  return { value: { id, revision } }
}

async function readSessionProjection(api, type, sessionId, key) {
  const history = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), { sessionId })
  if (history.kind !== 'history') return history
  const values = (history.projections && history.projections.values) || {}
  return {
    kind: type,
    sessionId,
    asOfSeq: history.projections ? history.projections.asOfSeq : undefined,
    [key]: Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null,
  }
}

async function mutateGoal(api, type, method, payload) {
  if (!api.goals || typeof api.goals[method] !== 'function') {
    return {
      kind: 'error',
      code: 'unsupported',
      message: 'goal management is unavailable in this DSH host',
      requestType: type,
      sessionId: payload.sessionId,
    }
  }
  return proxyQuery(api, type, api.goals[method].bind(api.goals), payload)
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
// Opening snapshots should be readable before older history is requested.
// Keep the newest indivisible message even when it alone exceeds this budget.
const HISTORY_OPENING_MAX_BYTES = 256 * 1024
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
    case 'request/context':
    case 'system/message':
      // token-level replay / system-prompt header: not rendered on the chat page
      return null
    case 'assistant/message':
    case 'assistant/attempt': {
      const { stream, ...data } = event.data || {}
      return { ...event, data }
    }
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

function validateHistoryCursor(msg, sessionId, field) {
  if (msg[field] === undefined && msg.historyFormatVersion === undefined) return null
  if (msg.historyFormatVersion !== SESSION_FORMAT_VERSION) {
    return { kind: 'error', code: 'history-format-mismatch', requestType: msg.type, sessionId,
      historyFormatVersion: SESSION_FORMAT_VERSION, resetRequired: true,
      message: 'Reload the Session baseline before using a history or fork cursor; historyFormatVersion must be 3' }
  }
  if (msg[field] !== undefined && (!Number.isSafeInteger(msg[field]) || msg[field] < 0)) {
    return { kind: 'error', code: 'bad-request', requestType: msg.type, sessionId,
      message: `${field} must be a non-negative safe integer` }
  }
  return null
}

function historyPage(value, msg) {
  const rawEvents = value.events.map(entry => entry.event)
  const maxBytes = Number.isSafeInteger(msg.maxBytes) && msg.maxBytes > 0 ? msg.maxBytes : HISTORY_DEFAULT_MAX_BYTES
  const trim = msg.view === 'conversation'
  const capped = capHistoryEvents(rawEvents, maxBytes, trim)
  const hasMore = value.hasMore === true || capped.dropped > 0
  // An all-hidden page still needs a cursor so callers can reach older text.
  const oldest = capped.events[0]?.seq ?? rawEvents[0]?.seq
  return { ...value, kind: 'history', sessionId: msg.sessionId,
    events: capped.events, bytes: capped.bytes, hasMore,
    ...(trim ? { view: 'conversation' } : {}),
    ...(hasMore && oldest !== undefined ? { nextBeforeSeq: oldest } : {}),
  }
}

function resolveCommandCatalogCopy(locale) {
  return typeof locale === 'string' && !locale.toLowerCase().startsWith('zh')
    ? COMMAND_CATALOG_COPY.en
    : COMMAND_CATALOG_COPY.zh
}

// DSH 0.1.5-rc.2 command descriptors use input.attachments.
function commandAcceptsAttachments(command) {
  return command?.input?.attachments === true
}

function commandUiDescriptor(command, copy) {
  const override = COMMAND_UI_OVERRIDES[command.name]
  if (override) return { ...override, insertText: `/${command.name}` }
  if (command.input && typeof command.input.hint === 'string') {
    const displayHint = copy.hints[command.name]
    return {
      kind: 'input',
      insertText: `/${command.name} `,
      hint: command.input.hint,
      ...(displayHint ? { displayHint } : {}),
      images: commandAcceptsAttachments(command),
      submitRequest: 'command-execute',
    }
  }
  return { kind: 'immediate', submitRequest: 'command-execute', submitText: `/${command.name}` }
}

function skillUiDescriptor(skill) {
  return {
    kind: 'input',
    insertText: `/${skill.name} `,
    images: true,
    submitRequest: 'message',
  }
}

function modelCommandOptionId(provider, model) {
  return Buffer.from(JSON.stringify([provider, model]), 'utf8').toString('base64url')
}

function decodeModelCommandOptionId(optionId) {
  try {
    const value = JSON.parse(Buffer.from(optionId, 'base64url').toString('utf8'))
    if (!Array.isArray(value) || value.length !== 2 || value.some((part) => typeof part !== 'string' || part === '')) return null
    return { provider: value[0], model: value[1] }
  } catch {
    return null
  }
}

async function loadCommandOptions(api, command, sessionId) {
  if (command === 'model') {
    const frame = await proxyQuery(api, 'models', api.sessions.models.bind(api.sessions), { sessionId })
    if (frame.kind !== 'models') return frame
    const options = []
    for (const group of frame.groups || []) {
      for (const model of group.models || []) {
        options.push({
          id: modelCommandOptionId(String(group.id), String(model.id)),
          label: String(model.name || model.id),
          detail: String(group.name || group.id),
          ...(model.description ? { description: String(model.description) } : {}),
          selected: frame.current && frame.current.provider === group.id && frame.current.model === model.id,
        })
      }
    }
    return { kind: 'command-options', sessionId, command, options }
  }

  if (command === 'permission') {
    const history = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), { sessionId })
    if (history.kind !== 'history') return history
    const permissions = history.projections && history.projections.values && history.projections.values.permissions
    if (!permissions || !Array.isArray(permissions.options) || typeof permissions.currentValue !== 'string') {
      return {
        kind: 'error',
        code: 'command-options-unavailable',
        message: 'permission options are unavailable for this session',
        requestType: 'command-options',
        sessionId,
      }
    }
    return {
      kind: 'command-options',
      sessionId,
      command,
      options: permissions.options.map((option) => ({
        id: String(option.value),
        label: String(option.name || option.value),
        ...(option.description ? { description: String(option.description) } : {}),
        selected: option.value === permissions.currentValue,
      })),
    }
  }

  return {
    kind: 'error',
    code: 'bad-request',
    message: `command does not provide selectable options: ${command}`,
    requestType: 'command-options',
    sessionId,
  }
}

async function selectCommandOption(api, host, command, sessionId, optionId) {
  const catalog = await loadCommandOptions(api, command, sessionId)
  if (catalog.kind !== 'command-options') return catalog
  const option = catalog.options.find((candidate) => candidate.id === optionId)
  if (!option) {
    return {
      kind: 'error',
      code: 'bad-request',
      message: `unknown option for ${command}: ${optionId}`,
      requestType: 'command-select',
      sessionId,
    }
  }

  if (command === 'permission') {
    try {
      const execution = await host.commands.execute(
        sessionId,
        '/permission ' + optionId,
        [],
        new AbortController().signal,
      )
      if (!execution || !execution.result) throw new Error('permission command returned an invalid result')
      if (execution.result.kind === 'error') {
        return { kind: 'error', code: 'command-error', message: execution.result.text, requestType: 'command-select', sessionId }
      }
      return { kind: 'command-selected', sessionId, command, selected: { ...option, selected: true } }
    } catch (error) {
      const code = error && error.code ? error.code : 'internal'
      const message = error && error.message ? error.message : String(error)
      return { kind: 'error', code, message, requestType: 'command-select', sessionId }
    }
  }

  if (command === 'model') {
    const selection = decodeModelCommandOptionId(optionId)
    if (!selection) {
      return { kind: 'error', code: 'bad-request', message: 'invalid model option id', requestType: 'command-select', sessionId }
    }
    const models = await proxyQuery(api, 'models', api.sessions.models.bind(api.sessions), { sessionId })
    if (models.kind !== 'models') return models
    const group = (models.groups || []).find((candidate) => candidate.id === selection.provider)
    const model = group && (group.models || []).find((candidate) => candidate.id === selection.model)
    if (!model) {
      return { kind: 'error', code: 'bad-request', message: 'model option is no longer available', requestType: 'command-select', sessionId }
    }
    const payload = { sessionId, ...selection }
    const reasoningEffort = models.current && models.current.provider === selection.provider && models.current.model === selection.model
      ? models.current.reasoningEffort
      : model.reasoning && model.reasoning.defaultEffort
    if (reasoningEffort) payload.reasoningEffort = reasoningEffort
    const selected = await proxyQuery(api, 'select-model', api.sessions.selectModel.bind(api.sessions), payload)
    if (selected.kind !== 'select-model') return selected
    return {
      kind: 'command-selected',
      sessionId,
      command,
      selected: { ...option, selected: true },
      value: selected.selected,
    }
  }

  return { kind: 'error', code: 'bad-request', message: `command is not selectable: ${command}`, requestType: 'command-select', sessionId }
}

// Dispatch one mobile query frame; returns the wire frame to send back.
async function handleQuery(api, host, agentDefaultModel, msg) {
  if (msg.type === 'session-create') {
    if (typeof msg.requestId !== 'string' || !msg.requestId.trim()) {
      return { kind: 'error', code: 'bad-request', message: 'session-create requires a requestId', requestType: 'session-create' }
    }
    const payload = {}
    if (typeof msg.workspaceId === 'string' && msg.workspaceId.trim()) {
      payload.workspaceId = msg.workspaceId.trim()
    } else if (typeof msg.cwd === 'string' && msg.cwd.trim()) {
      payload.cwd = msg.cwd.trim()
    }
    const frame = await proxyQuery(api, 'session-created', api.sessions.create.bind(api.sessions), payload)
    return { ...frame, ...(frame.kind === 'error' ? { requestType: 'session-create' } : {}), requestId: msg.requestId }
  }
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
    const cursorError = validateHistoryCursor(msg, sessionId, 'beforeSeq')
    if (cursorError) return cursorError
    const payload = { sessionId }
    if (typeof msg.beforeSeq === 'number' && Number.isFinite(msg.beforeSeq)) payload.beforeSeq = msg.beforeSeq
    if (typeof msg.maxMessages === 'number' && Number.isFinite(msg.maxMessages)) payload.maxMessages = msg.maxMessages
    const frame = await proxyQuery(api, 'history', api.sessions.history.bind(api.sessions), payload)
    if (frame.kind === 'history') return historyPage(frame, { ...msg, sessionId })
    return frame
  }
  if (msg.type === 'attachment') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const attachmentId = typeof msg.attachmentId === 'string' && msg.attachmentId.trim() !== '' ? msg.attachmentId.trim() : null
    if (!attachmentId) {
      return { kind: 'error', code: 'bad-request', message: 'attachment requires an attachmentId', requestType: 'attachment', sessionId: sessionId.value }
    }
    const frame = await proxyQuery(api, 'attachment', api.sessions.attachment.bind(api.sessions), {
      sessionId: sessionId.value,
      attachmentId,
    })
    if (frame.kind === 'attachment') frame.sessionId = sessionId.value
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
    const cursorError = validateHistoryCursor(msg, sessionId.value, 'atSeq')
    if (cursorError) return cursorError
    const payload = { sessionId: sessionId.value }
    if (typeof msg.atSeq === 'number' && Number.isFinite(msg.atSeq)) payload.atSeq = Math.floor(msg.atSeq)
    const frame = await proxyQuery(api, 'fork', api.sessions.fork.bind(api.sessions), payload)
    if (frame.kind === 'fork') {
      log(`forked session ${sessionId.value} -> ${frame.sessionId}${payload.atSeq !== undefined ? ' at seq ' + payload.atSeq : ''}`)
    }
    return frame
  }
  if (msg.type === 'session-cancel') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const frame = await proxyQuery(
      api,
      'session-cancel',
      api.sessions.cancel.bind(api.sessions),
      { sessionId: sessionId.value },
    )
    if (frame.kind === 'error') return { ...frame, sessionId: sessionId.value }
    return { ...frame, kind: 'session-cancelled', sessionId: sessionId.value }
  }
  if (msg.type === 'queue-update') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const itemId = typeof msg.itemId === 'string' && msg.itemId.trim() ? msg.itemId.trim() : null
    const actionKind = typeof msg.action === 'string' ? msg.action.trim() : ''
    if (!itemId || !['edit', 'remove', 'steer'].includes(actionKind)) {
      return {
        kind: 'error',
        code: 'bad-request',
        message: 'queue-update requires itemId and action edit, remove, or steer',
        requestType: 'queue-update',
        sessionId: sessionId.value,
      }
    }
    let action
    if (actionKind === 'edit') {
      if (typeof msg.text !== 'string' || !msg.text.trim()) {
        return {
          kind: 'error',
          code: 'bad-request',
          message: 'queue-update edit requires non-empty text',
          requestType: 'queue-update',
          sessionId: sessionId.value,
          itemId,
        }
      }
      action = { kind: 'edit', content: [{ type: 'text', text: msg.text }] }
    } else {
      action = { kind: actionKind }
    }
    const frame = await proxyQuery(
      api,
      'queue-update',
      api.sessions.updateQueue.bind(api.sessions),
      { sessionId: sessionId.value, itemId, action },
    )
    if (frame.kind === 'error') return { ...frame, sessionId: sessionId.value, itemId }
    return {
      ...frame,
      kind: 'queue-item-updated',
      sessionId: sessionId.value,
      itemId,
      action: actionKind,
    }
  }
  if (msg.type === 'session-archive') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const frame = await proxyQuery(
      api,
      'session-archive',
      api.workspace.archiveSession.bind(api.workspace),
      { sessionId: sessionId.value },
    )
    if (frame.kind === 'error') return { ...frame, sessionId: sessionId.value }
    return { ...frame, kind: 'session-archived', sessionId: sessionId.value }
  }
  if (msg.type === 'session-rename') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    if (typeof msg.title !== 'string' || !msg.title.trim()) {
      return {
        kind: 'error',
        code: 'bad-request',
        message: 'session-rename requires a non-empty title',
        requestType: 'session-rename',
        sessionId: sessionId.value,
      }
    }
    const frame = await proxyQuery(
      api,
      'session-rename',
      api.sessions.rename.bind(api.sessions),
      { sessionId: sessionId.value, title: msg.title },
    )
    if (frame.kind === 'error') return { ...frame, sessionId: sessionId.value }
    return { ...frame, kind: 'session-renamed', sessionId: sessionId.value }
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
  if (msg.type === 'directory-create') {
    return createServerDirectory(msg.path, msg.name)
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
  if (msg.type === 'command-execute') {
    return admitCommand(host, msg)
  }
  if (msg.type === 'commands') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const copy = resolveCommandCatalogCopy(msg.locale)
    try {
      // This is the same session-scoped catalog used by the official Web UI.
      // Copy only the stable descriptor fields so no live Typert object crosses
      // the mobile wire. The Web UI also contributes /model client-side; expose
      // the equivalent action here so mobile clients can render the same menu.
      const [listed, skillFrame] = await Promise.all([
        listHostCommands(host, sessionId.value),
        api.skills && typeof api.skills.list === 'function'
          ? proxyQuery(api, 'skills', api.skills.list.bind(api.skills), { sessionId: sessionId.value })
          : Promise.resolve({ kind: 'error', code: 'unsupported', message: 'skill catalog is unavailable', requestType: 'skills' }),
      ])
      if (!Array.isArray(listed)) throw new Error('commands/list returned an invalid catalog')
      const commands = listed
        .filter((command) => command && typeof command.name === 'string' && typeof command.description === 'string')
        .map((command) => ({
          id: `command:${command.name}`,
          name: command.name,
          description: command.description,
          source: 'host',
          action: 'execute',
          ui: commandUiDescriptor(command, copy),
          ...(command.input && typeof command.input.hint === 'string'
            ? { input: { hint: command.input.hint, ...(commandAcceptsAttachments(command) ? { images: true } : {}) } }
            : {}),
        }))
      if (!commands.some((command) => command.name === 'model')) {
        commands.push({
          id: 'command:model',
          name: 'model',
          description: copy.modelDescription,
          source: 'client',
          action: 'select-model',
          ui: commandUiDescriptor({ name: 'model' }, copy),
        })
      }
      const skills = skillFrame.kind === 'skills' && Array.isArray(skillFrame.skills)
        ? skillFrame.skills
          .filter((skill) => skill && typeof skill.name === 'string' && typeof skill.description === 'string')
          .map((skill) => ({
            id: `skill:${skill.name}`,
            name: skill.name,
            description: skill.modelInvocable === true ? skill.description : `${copy.userOnly} · ${skill.description}`,
            source: 'skill',
            action: 'insert',
            modelInvocable: skill.modelInvocable === true,
            ...(typeof skill.whenToUse === 'string' && skill.whenToUse !== '' ? { whenToUse: skill.whenToUse } : {}),
            ui: skillUiDescriptor(skill),
          }))
        : []
      const groups = [
        { id: 'commands', title: copy.commandsTitle, items: commands },
        ...(skills.length > 0 ? [{ id: 'skills', title: copy.skillsTitle, items: skills }] : []),
      ]
      const warnings = skillFrame.kind === 'error'
        ? [{ source: 'skills', code: skillFrame.code, message: skillFrame.message }]
        : []
      log(`command catalog queried: session=${sessionId.value} commands=${commands.length} skills=${skills.length}`)
      return {
        kind: 'commands',
        sessionId: sessionId.value,
        locale: copy.locale,
        groups,
        ...(warnings.length > 0 ? { warnings } : {}),
      }
    } catch (error) {
      const code = error && error.code ? error.code : 'internal'
      const message = error && error.message ? error.message : String(error)
      log(`command catalog failed: session=${sessionId.value} ${code}: ${message}`)
      return { kind: 'error', code, message, requestType: 'commands', sessionId: sessionId.value }
    }
  }
  if (msg.type === 'command-options') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const command = typeof msg.command === 'string' && msg.command.trim() !== '' ? msg.command.trim() : null
    if (!command) return { kind: 'error', code: 'bad-request', message: 'command-options requires a command', requestType: 'command-options', sessionId: sessionId.value }
    return loadCommandOptions(api, command, sessionId.value)
  }
  if (msg.type === 'command-select') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const command = typeof msg.command === 'string' && msg.command.trim() !== '' ? msg.command.trim() : null
    const optionId = typeof msg.optionId === 'string' && msg.optionId !== '' ? msg.optionId : null
    if (!command || !optionId) return { kind: 'error', code: 'bad-request', message: 'command-select requires command and optionId', requestType: 'command-select', sessionId: sessionId.value }
    return selectCommandOption(api, host, command, sessionId.value, optionId)
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
      out.sessionId = sessionId
      const hist = await querySessionProjection(api, msg.type, sessionId)
      if (hist.kind === 'error') return hist
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
      // commands/execute 的当前 Typert descriptor 要求 images 字段始终存在；
      // 权限斜杠命令没有附件，因此显式传空数组。
      const execution = await host.commands.execute(
        sessionId.value,
        '/permission ' + name,
        [],
        new AbortController().signal,
      )
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
    const hist = await querySessionProjection(api, msg.type, sessionId.value)
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
    const hist = await querySessionProjection(api, msg.type, sessionId.value)
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
  if (msg.type === 'tasks') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    return readSessionProjection(api, 'tasks', sessionId.value, 'todos')
  }
  if (msg.type === 'goal') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    return readSessionProjection(api, 'goal', sessionId.value, 'goal')
  }
  if (msg.type === 'goal-edit') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const ref = requireGoalRef(msg, sessionId.value)
    if (ref.error) return ref.error
    const payload = { sessionId: sessionId.value, ref: ref.value }
    if (typeof msg.objective === 'string' && msg.objective.trim() !== '') payload.objective = msg.objective.trim()
    if (typeof msg.maxGoalRounds === 'number' && Number.isSafeInteger(msg.maxGoalRounds) && msg.maxGoalRounds > 0) {
      payload.maxGoalRounds = msg.maxGoalRounds
    }
    if (payload.objective === undefined && payload.maxGoalRounds === undefined) {
      return { kind: 'error', code: 'bad-request', message: 'goal-edit requires a non-empty objective or a positive maxGoalRounds', requestType: 'goal-edit', sessionId: sessionId.value }
    }
    return mutateGoal(api, 'goal-edit', 'edit', payload)
  }
  if (msg.type === 'goal-pause' || msg.type === 'goal-resume' || msg.type === 'goal-clear') {
    const sessionId = requireSessionId(msg)
    if (sessionId.error) return sessionId.error
    const ref = requireGoalRef(msg, sessionId.value)
    if (ref.error) return ref.error
    const method = msg.type === 'goal-pause' ? 'pause' : msg.type === 'goal-resume' ? 'resume' : 'clear'
    return mutateGoal(api, msg.type, method, { sessionId: sessionId.value, ref: ref.value })
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
  let url
  try { url = new URL(raw) } catch { throw badRequest('invalid WebSocket endpoint URL') }
  if (url.protocol === 'https:') url.protocol = 'wss:'
  if (url.protocol === 'http:') url.protocol = 'ws:'
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw badRequest('publicUrl must use wss:// (ws:// is allowed only for localhost and private LAN addresses)')
  if (url.username || url.password || url.search || url.hash) throw badRequest('publicUrl must not contain credentials, query parameters, or a fragment')
  if (['0.0.0.0', '[::]', '::'].includes(url.hostname)) throw badRequest('endpoint must not use an unspecified listen address')
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
      try {
        const body = data === '' ? {} : JSON.parse(data)
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TypeError('expected an object')
        resolve(body)
      } catch (cause) {
        const error = new Error('request body must be a JSON object', { cause })
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

function callSystemHelper(message, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    let settled = false
    let body = ''
    const finish = (error, value) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolve(value)
    }
    const socket = net.createConnection(HELPER_SOCKET)
    socket.setEncoding('utf8')
    socket.setTimeout(timeoutMs)
    socket.on('connect', () => socket.write(`${JSON.stringify(message)}\n`))
    socket.on('data', (chunk) => {
      body += chunk
      if (body.length > 1024 * 1024) return finish(new Error('system helper response is too large'))
      const newline = body.indexOf('\n')
      if (newline < 0) return
      try {
        const response = JSON.parse(body.slice(0, newline))
        if (!response || response.ok !== true) throw new Error(response && response.error ? response.error : 'system helper request failed')
        finish(null, response.result)
      } catch (error) {
        finish(error)
      }
    })
    socket.on('timeout', () => finish(new Error('system helper request timed out')))
    socket.on('error', (error) => finish(error))
    socket.on('end', () => {
      if (!settled) finish(new Error('system helper closed without a response'))
    })
  })
}

async function systemHelperStatus() {
  try {
    return await callSystemHelper({ action: 'status' })
  } catch (error) {
    return {
      installed: false,
      configured: false,
      error: error && error.message ? error.message : String(error),
    }
  }
}

const plugin = {
  name: 'mobile-gateway',
  Config,
  // Hard dependencies: the gateway registers on the host web server and
  // admits mobile messages through the Host Remote Gateway. Cordis must not
  // activate this row before either service exists.
  inject: ['webServer', 'typertGateway', 'agentDefaultModel'],
  // exported for local tests; Cordis ignores unknown plugin fields
  admitMessage,
  handleQuery,
  apply(ctx, config) {
    const webServer = ctx.webServer
    const api = createDshHostAdapter(ctx.typertGateway)
    const host = api
    const agentDefaultModel = ctx.agentDefaultModel
    const options = {
      path: DEFAULT_WS_PATH,
      requireAuth: true,
      gatewayEnabled: false,
      gatewayStateFile: '',
      gatewayName: '',
      endpoints: [],
      gatewayWaitTimeoutMs: DEFAULT_GATEWAY_WAIT_TIMEOUT_MS,
      maxPayloadBytes: DEFAULT_MAX_WS_PAYLOAD_BYTES,
      fileDownloadsEnabled: true,
      fileDownloadMaxBytes: DEFAULT_FILE_DOWNLOAD_MAX_BYTES,
      fileDownloadChunkBytes: DEFAULT_FILE_DOWNLOAD_CHUNK_BYTES,
      fileDownloadIdleMs: DEFAULT_FILE_DOWNLOAD_IDLE_MS,
      fileDownloadMaxTransfers: DEFAULT_FILE_DOWNLOAD_MAX_TRANSFERS,
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
    if (options.gatewayMode !== undefined && !GATEWAY_MODES.includes(options.gatewayMode)) throw new Error('invalid gatewayMode')
    if (typeof options.gatewayName !== 'string' || options.gatewayName.trim().length > 80) throw new Error('gatewayName must be at most 80 characters')
    const normalizeEndpoints = (values) => {
      if (!Array.isArray(values) || values.length > 16 || values.some((value) => typeof value !== 'string' || !value.trim() || value.length > 2048)) {
        throw badRequest('endpoints must be an array of at most 16 nonempty URLs (2048 characters each)')
      }
      return [...new Set(values.map((value) => normalizePublicUrl(value, { headers: {} }, wsPath)))]
    }
    const configuredEndpoints = normalizeEndpoints(options.endpoints)
    const gatewayState = createGatewayState(options.gatewayStateFile || `${deviceFile}.gateway.json`)
    const gatewayIdentity = { gatewayId: gatewayState.gatewayId, gatewayName: options.gatewayName.trim() || os.hostname().slice(0, 80) }
    const registry = createRegistry(deviceFile, { pairingTtlMs: options.pairingTtlMs })
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes,
      // Authentication data may ride in requested subprotocols, but a secret
      // must never be echoed as the negotiated protocol.
      handleProtocols(protocols) {
        return protocols.has('dsh-mobile-v1') ? 'dsh-mobile-v1' : false
      },
    })
    const clients = new Set()
    const pendingQuestions = new Map()
    const pendingApprovals = new Map()
    const fileTransfers = createFileTransferManager(api, options)
    const fileTransferExpiryTimer = setInterval(() => {
      fileTransfers.expire().catch((error) => {
        log(`file download expiry failed: ${error && error.message ? error.message : String(error)}`)
      })
    }, Math.min(options.fileDownloadIdleMs, 30_000))
    const backgroundStreamAbort = new AbortController()
    let archivedSessionIds = null
    let sessionQueues = null
    let sessionProjectionBaselines = {}
    let counter = 0
    let gatewayMode = gatewayState.mode ?? options.gatewayMode ?? (options.gatewayEnabled === true ? 'persistent' : 'disabled')
    let gatewayEnabled = gatewayMode !== 'disabled'
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

    const advertisedEndpoints = (primary, extra = []) => {
      const publicUrl = configuredPublicUrl()
      return normalizeEndpoints([...new Set([
        ...(primary ? [primary] : []),
        ...extra,
        ...configuredEndpoints,
        ...(publicUrl ? [publicUrl] : []),
        ...(lanListening ? lanWebSocketUrls(options, wsPath, lanBoundPort) : []),
      ])])
    }

    const setGatewayMode = (mode, reason, persist = true) => {
      if (!GATEWAY_MODES.includes(mode)) throw badRequest('mode must be disabled, temporary, or persistent')
      // Commit before changing the live service, so a failed save never reports success.
      if (persist) gatewayState.setMode(mode)
      if (waitTimer) clearTimeout(waitTimer)
      waitTimer = null
      gatewayMode = mode
      gatewayEnabled = mode !== 'disabled'
      waitExpiresAt = null
      connectedSinceEnabled = [...clients].some((client) => client.readyState === 1)
      if (mode === 'temporary' && !connectedSinceEnabled) {
        waitExpiresAt = Date.now() + options.gatewayWaitTimeoutMs
        waitTimer = setTimeout(() => {
          waitTimer = null
          if (!gatewayEnabled || connectedSinceEnabled || [...clients].some((client) => client.readyState === 1)) return
          gatewayEnabled = false
          gatewayMode = 'disabled'
          waitExpiresAt = null
          try { gatewayState.setMode('disabled') } catch (error) {
            log(`failed to persist automatic gateway disable: ${error.message}`)
          }
          log('mobile gateway automatically disabled: no device connected before timeout')
        }, options.gatewayWaitTimeoutMs)
      } else if (mode === 'disabled') {
        for (const client of clients) client.close(4004, 'mobile gateway disabled')
      }
      log(`mobile gateway mode=${mode}${reason ? `: ${reason}` : ''}`)
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

    const questionFrameFor = (rpcId, payload, replay = false) => ({
      kind: 'question-requested',
      rpcId: String(rpcId),
      sessionId: String(payload.sessionId),
      questions: payload.questions,
      ...(replay ? { replay: true } : {}),
    })

    const approvalFrameFor = (rpcId, payload, replay = false) => ({
      kind: 'approval-requested',
      rpcId: String(rpcId),
      sessionId: String(payload.sessionId),
      approvalId: String(payload.approvalId),
      toolName: payload.toolName,
      ...(payload.callId !== undefined ? { callId: payload.callId } : {}),
      ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
      ...(replay ? { replay: true } : {}),
    })

    const broadcastInteractionFrame = (frame) => {
      const wire = stringifyWireFrame(frame)
      for (const client of clients) {
        if (client.mobileChannel === 'conversation') continue
        if (client.filterSessionId && client.filterSessionId !== frame.sessionId) continue
        if (client.readyState === 1) client.send(wire)
      }
    }

    // Session-list metadata must reach every connected client even when it is
    // subscribed to one conversation. Subscriptions only scope the heavier
    // conversation and interaction streams.
    const broadcastSessionMetadataFrame = (frame) => {
      const wire = stringifyWireFrame(frame)
      for (const client of clients) {
        if (client.mobileChannel === 'conversation') continue
        if (client.readyState === 1) client.send(wire)
      }
    }

    const replayPendingInteractions = (ws, trigger) => {
      if (ws.mobileChannel === 'conversation') return { questionCount: 0, approvalCount: 0 }
      let questionCount = 0
      let approvalCount = 0
      for (const pending of pendingQuestions.values()) {
        if (ws.filterSessionId && ws.filterSessionId !== pending.sessionId) continue
        ws.send(stringifyWireFrame(questionFrameFor(pending.rpcId, pending, true)))
        questionCount += 1
      }
      for (const pending of pendingApprovals.values()) {
        if (ws.filterSessionId && ws.filterSessionId !== pending.sessionId) continue
        ws.send(stringifyWireFrame(approvalFrameFor(pending.rpcId, pending, true)))
        approvalCount += 1
      }
      log(`interaction replay: trigger=${trigger} filtered=${Boolean(ws.filterSessionId)} questions=${questionCount} approvals=${approvalCount}`)
      return { questionCount, approvalCount }
    }

    const hasInteractionClient = (sessionId) => [...clients].some((client) => (
      client.readyState === 1
      && client.mobileChannel !== 'conversation'
      && (!client.filterSessionId || client.filterSessionId === sessionId)
    ))

    const completeQuestion = (pending, action, answer, cancellationCode = 'ASK_CANCELLED') => {
      if (pendingQuestions.get(pending.rpcId) !== pending) return false
      pendingQuestions.delete(pending.rpcId)
      pending.cleanup()
      if (action === 'answer') pending.resolve(answer)
      else {
        const error = new Error('question cancelled by mobile user')
        error.name = 'UserQuestionError'
        error.code = cancellationCode
        pending.reject(error)
      }
      broadcastInteractionFrame({
        kind: 'question-resolved',
        rpcId: pending.rpcId,
        sessionId: pending.sessionId,
        outcome: action === 'answer' ? 'answered' : 'cancelled',
      })
      return true
    }

    const normalizeQuestionAnswers = (pending, answers) => {
      if (answers.length !== pending.questions.length) return { error: 'answers must cover every question exactly once' }
      const normalized = []
      for (let index = 0; index < pending.questions.length; index += 1) {
        const question = pending.questions[index]
        const answer = answers[index]
        if (!answer || typeof answer !== 'object' || answer.id !== question.id || !Array.isArray(answer.selected)) {
          return { error: 'answers must preserve question order, ids, and selected arrays' }
        }
        if (answer.selected.some((label) => typeof label !== 'string')) return { error: 'selected values must be strings' }
        if (new Set(answer.selected).size !== answer.selected.length) return { error: 'selected values must not repeat' }
        const offered = new Set((question.options || []).map((option) => option.label))
        if (answer.selected.some((label) => !offered.has(label))) return { error: 'selected values must match offered option labels' }
        if (question.multiSelect !== true && answer.selected.length > 1) return { error: 'single-select questions accept at most one selection' }
        let custom
        if (answer.custom !== undefined) {
          if (typeof answer.custom !== 'string' || !answer.custom.trim()) return { error: 'custom answers must be non-empty strings' }
          custom = answer.custom.trim()
        }
        if (question.multiSelect !== true && custom !== undefined && answer.selected.length > 0) {
          return { error: 'single-select custom answers cannot accompany a selection' }
        }
        normalized.push({ id: answer.id, selected: [...answer.selected], ...(custom === undefined ? {} : { custom }) })
      }
      return { value: { answers: normalized } }
    }

    const completeApproval = (pending, outcome) => {
      if (pendingApprovals.get(pending.rpcId) !== pending) return false
      pendingApprovals.delete(pending.rpcId)
      pending.cleanup()
      pending.resolve(outcome)
      broadcastInteractionFrame({
        kind: 'approval-resolved',
        rpcId: pending.rpcId,
        sessionId: pending.sessionId,
        approvalId: pending.approvalId,
        outcome,
      })
      return true
    }

    const fallbackQuestion = (pending) => {
      if (pendingQuestions.get(pending.rpcId) !== pending) return
      pendingQuestions.delete(pending.rpcId)
      pending.cleanup()
      Promise.resolve().then(pending.next).then(pending.resolve, pending.reject)
    }

    const fallbackApproval = (pending) => {
      if (pendingApprovals.get(pending.rpcId) !== pending) return
      pendingApprovals.delete(pending.rpcId)
      pending.cleanup()
      Promise.resolve().then(pending.next).then(pending.resolve, pending.reject)
    }

    const releaseUnclaimedInteractions = () => {
      for (const pending of [...pendingQuestions.values()]) {
        if (!hasInteractionClient(pending.sessionId)) fallbackQuestion(pending)
      }
      for (const pending of [...pendingApprovals.values()]) {
        if (!hasInteractionClient(pending.sessionId)) fallbackApproval(pending)
      }
    }

    const respondToQuestion = async (msg, cancel = false) => {
      const rpcId = typeof msg.rpcId === 'string' && msg.rpcId.trim() ? msg.rpcId.trim() : null
      const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() ? msg.sessionId.trim() : null
      if (!rpcId || !sessionId) {
        return { kind: 'error', code: 'bad-request', message: `${msg.type} requires rpcId and sessionId`, requestType: msg.type }
      }

      const pending = pendingQuestions.get(rpcId)
      if (!pending) {
        return { kind: 'question-response', rpcId, sessionId, action: cancel ? 'cancel' : 'answer', accepted: false, reason: 'not-pending' }
      }
      if (pending.sessionId !== sessionId) {
        return { kind: 'error', code: 'bad-request', message: 'sessionId does not match the pending question', requestType: msg.type, sessionId }
      }
      if (!cancel && !Array.isArray(msg.answers)) {
        return { kind: 'error', code: 'bad-request', message: 'question-answer requires an answers array', requestType: msg.type, sessionId }
      }
      const normalized = cancel ? null : normalizeQuestionAnswers(pending, msg.answers)
      if (normalized?.error) {
        return { kind: 'error', code: 'bad-response', message: normalized.error, requestType: msg.type, sessionId }
      }
      const answer = normalized?.value
      const accepted = completeQuestion(pending, cancel ? 'cancel' : 'answer', answer)
      log(`question response: rpcId=${rpcId} session=${sessionId} action=${cancel ? 'cancel' : 'answer'} accepted=${accepted}`)
      return {
        kind: 'question-response',
        rpcId,
        sessionId,
        action: cancel ? 'cancel' : 'answer',
        accepted,
        ...(!accepted ? { reason: 'not-pending' } : {}),
      }
    }

    const respondToApproval = async (msg) => {
      const rpcId = typeof msg.rpcId === 'string' && msg.rpcId.trim() ? msg.rpcId.trim() : null
      const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() ? msg.sessionId.trim() : null
      const approvalId = typeof msg.approvalId === 'string' && msg.approvalId.trim() ? msg.approvalId.trim() : null
      const outcome = msg.outcome
      if (!rpcId || !sessionId || !approvalId) {
        return { kind: 'error', code: 'bad-request', message: 'approval-response requires rpcId, sessionId, and approvalId', requestType: msg.type }
      }
      if (outcome !== 'allowed-once' && outcome !== 'rejected') {
        return { kind: 'error', code: 'bad-request', message: 'approval-response outcome must be "allowed-once" or "rejected"', requestType: msg.type, sessionId }
      }

      const pending = pendingApprovals.get(rpcId)
      if (!pending) {
        return { kind: 'approval-response', rpcId, sessionId, approvalId, outcome, accepted: false, reason: 'not-pending' }
      }
      if (pending.sessionId !== sessionId || pending.approvalId !== approvalId) {
        return { kind: 'error', code: 'bad-request', message: 'approval-response does not match the pending approval', requestType: msg.type, sessionId }
      }
      const accepted = completeApproval(pending, outcome)
      log(`approval response: rpcId=${rpcId} approvalId=${approvalId} session=${sessionId} outcome=${outcome} accepted=${accepted}`)
      return {
        kind: 'approval-response',
        rpcId,
        sessionId,
        approvalId,
        outcome,
        accepted,
        ...(!accepted ? { reason: 'not-pending' } : {}),
      }
    }

    // Saved user choice wins; a temporary startup gets a fresh first-connection window.
    setGatewayMode(gatewayMode, 'startup', false)

    log(`applying: version=${PLUGIN_VERSION} interactionProtocol=${INTERACTION_PROTOCOL_REVISION} path=${wsPath}, webServer.port=${webServer.port}, gatewayEnabled=${gatewayEnabled}, requireAuth=${requireAuth}, devices=${registry.count()}`)

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
              version: PLUGIN_VERSION,
              requireAuth,
              gatewayEnabled,
              gatewayMode,
              ...gatewayIdentity,
              endpoints: advertisedEndpoints(),
              waitExpiresAt,
              connectedClients: clients.size,
              webPort: webServer.port,
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
          } else if (req.method === 'GET' && p === '/mgw/public-setup') {
            sendJson(res, 200, await systemHelperStatus())
          } else if (req.method === 'POST' && p === '/mgw/public-setup') {
            const body = await readBody(req)
            if (typeof body.publicIp !== 'string' || !body.publicIp.trim()) throw badRequest('publicIp is required')
            const result = await callSystemHelper({
              action: 'configure',
              publicIp: body.publicIp.trim(),
              backendPort: webServer.port,
            }, 15 * 60 * 1000)
            log(`public endpoint configured: ${result.publicUrl} -> 127.0.0.1:${result.backendPort}`)
            sendJson(res, 200, result)
          } else if (req.method === 'POST' && p === '/mgw/gateway') {
            const body = await readBody(req)
            if (body.mode !== undefined && body.enabled !== undefined) throw badRequest('provide mode or enabled, not both')
            if (body.mode === undefined && typeof body.enabled !== 'boolean') throw badRequest('mode or boolean enabled is required')
            setGatewayMode(body.mode !== undefined ? body.mode : (body.enabled ? 'temporary' : 'disabled'), 'changed from management UI')
            sendJson(res, 200, { gatewayEnabled, gatewayMode, waitExpiresAt, connectedClients: clients.size })
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
            const endpoints = advertisedEndpoints(publicUrl, normalizeEndpoints(body.endpoints ?? []))
            const pairing = registry.createPairing(name)
            const payload = {
              version: 2,
              publicUrl,
              pairingCode: pairing.code,
              expiresAt: pairing.expiresAt,
              ...gatewayIdentity,
              endpoints,
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
          const requestedChannel = req.headers['x-dsh-channel']
          ws.mobileChannel = ['control', 'conversation'].includes(requestedChannel) ? requestedChannel : 'legacy'
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

          const sendFrame = frame => {
            if (ws.readyState === 1) ws.send(stringifyWireFrame(frame))
          }
          ws.sessionFollower = createSessionFollower(api, {
            onFrame(frame, context) {
              if (frame.type === 'snapshot') {
                sendFrame({ ...historyPage(frame.history, { sessionId: context.sessionId, view: 'conversation', maxBytes: HISTORY_OPENING_MAX_BYTES }),
                  kind: 'session-snapshot', ...context, assistantStream: frame.assistantStream, replace: true })
              } else if (frame.type === 'event') {
                sendFrame({ ...buildWireEvent({ id: context.sessionId }, frame.event), ...context })
              } else {
                sendFrame({ kind: 'assistant-stream', ...context, frame: frame.frame })
              }
            },
            onError(error, context) {
              sendFrame({ kind: 'session-stream-reset', ...context,
                code: error.code || 'stream-interrupted', message: error.message })
            },
          })

          ws.on('message', (data) => {
            let msg
            try {
              msg = JSON.parse(data.toString())
            } catch (error) {
              ws.send(stringifyWireFrame({ kind: 'error', message: 'invalid json' }))
              return
            }
            if (!msg || typeof msg.type !== 'string') return
            const conversationRequest = ['message', 'history', 'subscribe', 'unsubscribe'].includes(msg.type)
            if ((ws.mobileChannel === 'control' && conversationRequest) ||
                (ws.mobileChannel === 'conversation' && !conversationRequest && msg.type !== 'ping')) {
              ws.send(stringifyWireFrame({ kind: 'error', code: 'wrong-channel', requestType: msg.type, message: 'Request belongs to the other mobile channel' }))
              return
            }

            if (msg.type === 'ping') {
              ws.send(stringifyWireFrame({ kind: 'pong', at: Date.now() }))
            } else if (msg.type === 'subscribe') {
              if (msg.assistantStream !== undefined && typeof msg.assistantStream !== 'boolean') {
                sendFrame({ kind: 'error', code: 'bad-request', requestType: 'subscribe', message: 'assistantStream must be a boolean' })
                return
              }
              const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.trim() ? msg.sessionId.trim() : undefined
              if (msg.assistantStream === true && !sessionId) {
                sendFrame({ kind: 'error', code: 'bad-request', requestType: 'subscribe', message: 'assistantStream requires a sessionId' })
                return
              }
              ws.sessionFollower.stop()
              ws.filterSessionId = sessionId
              ws.sessionFollowerActive = msg.assistantStream === true
              const subscriptionId = crypto.randomUUID()
              sendFrame({ kind: 'subscribed', sessionId: sessionId || null, subscriptionId, assistantStream: ws.sessionFollowerActive })
              if (ws.sessionFollowerActive) {
                void ws.sessionFollower.start(sessionId, subscriptionId).catch(error => {
                  log(`session follower failed: ${error.message}`)
                  if (ws.readyState === 1) ws.close(1011, 'session follower failed')
                })
              }
              replayPendingInteractions(ws, 'subscribe')
            } else if (msg.type === 'unsubscribe') {
              ws.sessionFollower.stop()
              ws.sessionFollowerActive = false
              ws.filterSessionId = undefined
              sendFrame({ kind: 'subscribed', sessionId: null, assistantStream: false })
            } else if (msg.type === 'question-answer' || msg.type === 'question-cancel') {
              respondToQuestion(msg, msg.type === 'question-cancel').then((frame) => {
                if (frame && ws.readyState === 1) ws.send(stringifyWireFrame(frame))
              })
            } else if (msg.type === 'approval-response') {
              respondToApproval(msg).then((frame) => {
                if (frame && ws.readyState === 1) ws.send(stringifyWireFrame(frame))
              })
            } else if (msg.type === 'file-list' || msg.type === 'file-download-open' ||
                       msg.type === 'file-download-read' || msg.type === 'file-download-cancel') {
              fileTransfers.handle(ws, msg).then((frame) => {
                if (frame && ws.readyState === 1) ws.send(stringifyWireFrame(frame))
              })
            } else if (msg.type === 'message') {
              admitMessage(api, msg).then((frame) => {
                if (frame && ws.readyState === 1) ws.send(stringifyWireFrame(frame))
              })
            } else if (msg.type === 'workspaces' || msg.type === 'sessions' || msg.type === 'history' || msg.type === 'attachment' ||
                       msg.type === 'search' || msg.type === 'host' || msg.type === 'directories' || msg.type === 'directory-create' ||
                       msg.type === 'workspace-create' || msg.type === 'session-create' || msg.type === 'models' || msg.type === 'commands' || msg.type === 'command-execute' ||
                       msg.type === 'command-options' || msg.type === 'command-select' || msg.type === 'select-model' ||
                       msg.type === 'permission-options' || msg.type === 'permission' || msg.type === 'context-usage' ||
                       msg.type === 'agent-presets' || msg.type === 'defaults' || msg.type === 'set-default' ||
                       msg.type === 'session-stats' || msg.type === 'default-model' ||
                       msg.type === 'save-default-model' || msg.type === 'fork' || msg.type === 'session-cancel' || msg.type === 'queue-update' ||
                       msg.type === 'session-archive' || msg.type === 'session-rename' || msg.type === 'providers' ||
                       msg.type === 'tasks' || msg.type === 'goal' || msg.type === 'goal-edit' ||
                       msg.type === 'goal-pause' || msg.type === 'goal-resume' || msg.type === 'goal-clear') {
              handleQuery(api, host, agentDefaultModel, msg).then((frame) => {
                if (frame && ws.readyState === 1) ws.send(stringifyWireFrame(frame))
              })
            } else {
              ws.send(stringifyWireFrame({ kind: 'error', message: 'unknown message type: ' + msg.type }))
            }
          })

          ws.on('close', () => {
            ws.sessionFollower.stop()
            clients.delete(ws)
            if (ws.deviceId) registry.disconnected(ws.deviceId)
            releaseUnclaimedInteractions()
            fileTransfers.closeClient(ws).catch((error) => {
              log(`file download cleanup failed: ${error && error.message ? error.message : String(error)}`)
            })
            log(`client disconnected (id=${id}, remaining=${clients.size})`)
          })

          log(`client connected (id=${id}, total=${clients.size})${device ? ' device=' + device.name : ''}`)
          if (paired) {
            ws.send(stringifyWireFrame({
              kind: 'paired',
              token: paired.token,
              device: paired.device,
              ...gatewayIdentity,
            }))
          }
          ws.send(stringifyWireFrame({
            kind: 'hello',
            ...gatewayIdentity,
            protocol: 3,
            dshVersion: DSH_VERSION,
            historyFormatVersion: SESSION_FORMAT_VERSION,
            capabilities: [
              'split-channels',
              'assistant-stream-v1',
              'history-format-version',
              'projection-baseline',
              'images',
              'session-create',
              'commands',
              'tasks',
              'goals',
              'session-cancel',
              'queue-control',
              'session-archive',
              'session-rename',
              ...(options.fileDownloadsEnabled ? ['file-downloads'] : []),
            ],
            port: transport.port || webServer.port,
            clients: clients.size,
            authenticated: !!device,
            ...(device ? { device: { id: device.id, name: device.name } } : {}),
          }))
          if (ws.mobileChannel !== 'conversation' && archivedSessionIds !== null) {
            ws.send(stringifyWireFrame({ kind: 'session-archives', archivedSessionIds }))
          }
          if (ws.mobileChannel !== 'conversation' && sessionQueues !== null) {
            ws.send(stringifyWireFrame({ kind: 'session-queues', queues: Object.fromEntries(sessionQueues) }))
          }
          if (ws.mobileChannel !== 'conversation') {
            sendFrame({ kind: 'projection-baseline', projections: sessionProjectionBaselines })
          }
          replayPendingInteractions(ws, 'connect')
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
      if (event.type === 'session/title' && typeof event.data?.title === 'string') {
        broadcastSessionMetadataFrame({
          kind: 'session-title-changed',
          sessionId: String(session.id),
          title: event.data.title,
          seq: event.seq,
          time: event.time,
          ...(event.data.source ? { source: event.data.source } : {}),
        })
      }
      const payload = stringifyWireFrame(wire)
      for (const client of clients) {
        if (client.mobileChannel === 'control' || client.sessionFollowerActive) continue
        if (client.filterSessionId && client.filterSessionId !== String(session.id)) continue
        if (client.readyState === 1) client.send(payload)
      }
    })
    log('session/event listener attached')

    const disposeQuestions = ctx.on('user-questions/request', (request, next) => {
      const sessionId = request?.agent?.id === undefined ? null : String(request.agent.id)
      if (!sessionId || !Array.isArray(request.questions) || !hasInteractionClient(sessionId)) return next()
      const rpcId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const pending = pendingQuestions.get(rpcId)
          if (pending) completeQuestion(pending, 'cancel', undefined, 'ASK_ABORTED')
        }
        request.signal?.addEventListener('abort', onAbort, { once: true })
        const pending = {
          rpcId,
          sessionId,
          questions: request.questions,
          next,
          resolve,
          reject,
          cleanup: () => request.signal?.removeEventListener('abort', onAbort),
        }
        pendingQuestions.set(rpcId, pending)
        broadcastInteractionFrame(questionFrameFor(rpcId, pending))
        log(`question requested: rpcId=${rpcId} session=${sessionId} questions=${request.questions.length}`)
      })
    }, { prepend: true })

    const disposeApprovals = ctx.on('approval/request', (request, next) => {
      const sessionId = request?.agent?.id === undefined ? null : String(request.agent.id)
      if (!sessionId || typeof request.toolName !== 'string' || !hasInteractionClient(sessionId)) return next()
      const rpcId = crypto.randomUUID()
      const approvalId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          const pending = pendingApprovals.get(rpcId)
          if (pending) completeApproval(pending, 'cancelled')
        }
        request.signal?.addEventListener('abort', onAbort, { once: true })
        const pending = {
          rpcId,
          sessionId,
          approvalId,
          toolName: request.toolName,
          ...(request.callId !== undefined ? { callId: request.callId } : {}),
          ...(request.reason !== undefined ? { reason: request.reason } : {}),
          next,
          resolve,
          reject,
          cleanup: () => request.signal?.removeEventListener('abort', onAbort),
        }
        pendingApprovals.set(rpcId, pending)
        broadcastInteractionFrame(approvalFrameFor(rpcId, pending))
        log(`approval requested: rpcId=${rpcId} approvalId=${approvalId} session=${sessionId} tool=${request.toolName}`)
      })
    }, { prepend: true })

    const waitForBackgroundRetry = () => new Promise((resolve) => {
      if (backgroundStreamAbort.signal.aborted) {
        resolve()
        return
      }
      const finish = () => {
        clearTimeout(timer)
        backgroundStreamAbort.signal.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, 1_000)
      backgroundStreamAbort.signal.addEventListener('abort', finish, { once: true })
    })

    const installArchivedSessionIds = (value) => {
      if (!Array.isArray(value)) throw new Error('workspace/follow returned invalid archivedSessionIds')
      const next = value.map((sessionId) => String(sessionId))
      if (archivedSessionIds !== null
        && archivedSessionIds.length === next.length
        && archivedSessionIds.every((sessionId, index) => sessionId === next[index])) return
      archivedSessionIds = next
      broadcastSessionMetadataFrame({ kind: 'session-archives', archivedSessionIds: next })
      log(`session archive state forwarded: count=${next.length}`)
    }

    const normalizeQueueItems = (value, endpoint) => {
      if (!Array.isArray(value)) throw new Error(`${endpoint} returned invalid queue items`)
      return value.map((candidate) => {
        const message = candidate && typeof candidate === 'object' && !Array.isArray(candidate)
          ? candidate.message
          : null
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)
          || typeof candidate.id !== 'string' || !candidate.id
          || !['queued', 'steering', 'context'].includes(candidate.placement)
          || !message || typeof message !== 'object' || Array.isArray(message)
          || typeof message.id !== 'string' || !message.id
          || !Array.isArray(message.content)
          || (candidate.rpcId !== undefined && typeof candidate.rpcId !== 'string')) {
          throw new Error(`${endpoint} returned an invalid queue item`)
        }
        return {
          id: candidate.id,
          placement: candidate.placement,
          ...(candidate.rpcId === undefined ? {} : { rpcId: candidate.rpcId }),
          message: { id: message.id, content: message.content },
        }
      })
    }

    const installSessionQueueBaseline = (value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('session/control baseline returned invalid queues')
      }
      const next = new Map()
      for (const [sessionId, items] of Object.entries(value)) {
        next.set(sessionId, normalizeQueueItems(items, 'session/control baseline'))
      }
      sessionQueues = next
      broadcastSessionMetadataFrame({ kind: 'session-queues', queues: Object.fromEntries(next) })
      log(`session queue baseline forwarded: sessions=${next.size}`)
    }

    const installSessionQueue = (sessionIdValue, itemsValue) => {
      const sessionId = typeof sessionIdValue === 'string' && sessionIdValue ? sessionIdValue : null
      if (!sessionId) throw new Error('session/control returned an invalid queue sessionId')
      const items = normalizeQueueItems(itemsValue, 'session/control queue')
      if (sessionQueues === null) sessionQueues = new Map()
      sessionQueues.set(sessionId, items)
      broadcastSessionMetadataFrame({ kind: 'session-queue', sessionId, items })
      log(`session queue forwarded: session=${sessionId} items=${items.length}`)
    }

    const projectionFrame = (sessionId, key, value, seq) => ({
      kind: key === 'todos' ? 'tasks-updated' : 'goal-updated', sessionId, asOfSeq: seq,
      [key]: value,
    })

    const installProjectionBaseline = value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid projection baseline')
      const next = {}
      for (const [sessionId, baseline] of Object.entries(value)) {
        if (!Number.isSafeInteger(baseline?.asOfSeq) || !baseline.values || typeof baseline.values !== 'object' || Array.isArray(baseline.values)) {
          throw new Error('invalid session projection baseline')
        }
        Object.defineProperty(next, sessionId, { enumerable: true, configurable: true, writable: true,
          value: { asOfSeq: baseline.asOfSeq, values: { todos: baseline.values.todos ?? null, goal: baseline.values.goal ?? null } } })
      }
      const previous = sessionProjectionBaselines
      sessionProjectionBaselines = next
      broadcastSessionMetadataFrame({ kind: 'projection-baseline', projections: next })
      for (const sessionId of new Set([...Object.keys(previous), ...Object.keys(next)])) {
        const baseline = Object.hasOwn(next, sessionId) ? next[sessionId] : null
        for (const key of ['todos', 'goal']) {
          broadcastInteractionFrame(projectionFrame(sessionId, key, baseline?.values[key] ?? null,
            baseline?.asOfSeq ?? previous[sessionId].asOfSeq))
        }
      }
    }

    const workspaceTask = (async () => {
      while (!backgroundStreamAbort.signal.aborted) {
        try {
          const stream = await api.openWorkspaceStream(backgroundStreamAbort.signal)
          for await (const frame of stream) {
            if (frame?.type === 'baseline') {
              installArchivedSessionIds(frame.value?.archivedSessionIds)
            } else if (frame?.type === 'archived') {
              installArchivedSessionIds(frame.archivedSessionIds)
            }
          }
          if (!backgroundStreamAbort.signal.aborted) log('workspace stream ended; retrying')
        } catch (error) {
          if (!backgroundStreamAbort.signal.aborted) {
            log(`workspace stream failed; retrying: ${error && error.message ? error.message : String(error)}`)
          }
        }
        if (!backgroundStreamAbort.signal.aborted) await waitForBackgroundRetry()
      }
    })()
    void workspaceTask

    const controlTask = (async () => {
      while (!backgroundStreamAbort.signal.aborted) {
        try {
          const stream = await api.openControlStream(backgroundStreamAbort.signal)
          for await (const frame of stream) {
            if (frame?.type === 'baseline') {
              installProjectionBaseline(frame.value?.projections)
              installSessionQueueBaseline(frame.value?.queues)
            } else if (frame?.type === 'queue') {
              installSessionQueue(frame.sessionId, frame.items)
            } else if (frame?.type === 'projection' && (frame.key === 'todos' || frame.key === 'goal')) {
              const sessionId = String(frame.sessionId)
              const previous = Object.hasOwn(sessionProjectionBaselines, sessionId) ? sessionProjectionBaselines[sessionId] : null
              Object.defineProperty(sessionProjectionBaselines, sessionId, { enumerable: true, configurable: true, writable: true,
                value: { asOfSeq: frame.seq, values: { ...previous?.values, [frame.key]: frame.value } } })
              broadcastInteractionFrame(projectionFrame(sessionId, frame.key, frame.value, frame.seq))
              log(`projection forwarded: key=${frame.key} session=${sessionId} seq=${frame.seq}`)
            }
          }
          if (!backgroundStreamAbort.signal.aborted) log('session control stream ended; retrying')
        } catch (error) {
          if (!backgroundStreamAbort.signal.aborted) {
            log(`session control stream failed; retrying: ${error && error.message ? error.message : String(error)}`)
          }
        }
        if (!backgroundStreamAbort.signal.aborted) await waitForBackgroundRetry()
      }
    })()
    void controlTask
    log('Host waterfall interaction listeners, workspace stream, and session control stream attached')

    ctx.effect(() => () => {
      if (waitTimer) clearTimeout(waitTimer)
      clearInterval(fileTransferExpiryTimer)
      backgroundStreamAbort.abort()
      for (const pending of [...pendingQuestions.values()]) fallbackQuestion(pending)
      for (const pending of [...pendingApprovals.values()]) fallbackApproval(pending)
      fileTransfers.dispose().catch((error) => {
        log(`file download disposal failed: ${error && error.message ? error.message : String(error)}`)
      })
      disposeUpgrade()
      disposeMgmt()
      disposeEvents()
      disposeQuestions()
      disposeApprovals()
      if (lanServer) lanServer.close()
      for (const client of clients) {
        client.sessionFollower?.stop()
        client.terminate()
      }
      clients.clear()
      wss.close()
      log('plugin stopped, all sockets closed')
    })
  },
}

export { Config, admitMessage, handleQuery }
export default plugin
