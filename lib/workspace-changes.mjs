import { stringifyWireFrame } from './wire-json.mjs'

export const WORKSPACE_CHANGES_REQUEST_TYPES = new Set(['workspace-changes-summary', 'workspace-changes-diff'])
const SUMMARY_LIMIT = 1024 * 1024
const DIFF_LIMIT = 4 * 1024 * 1024
const routes = { summary: '/api/changes.summary', diff: '/api/changes.diff' }
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const integer = value => Number.isSafeInteger(value) && value >= 0
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const failure = (code, message) => Object.assign(new Error(message), { code })
const tooLarge = () => failure('workspace-changes-response-too-large', 'Change response exceeds the byte budget')

function abortable(task, signal) {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve(task).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

async function readJson(response, limit, signal) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('Missing change response body')
  const chunks = []
  let bytes = 0
  try {
    if (Number(response.headers.get('content-length')) > limit) throw tooLarge()
    while (true) {
      const { done, value } = await abortable(reader.read(), signal)
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) throw tooLarge()
      chunks.push(Buffer.from(value))
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

function changedFile(value) {
  if (!record(value) || typeof value.path !== 'string' || typeof value.display !== 'string'
    || !integer(value.added) || !integer(value.deleted)
    || (value.binary !== undefined && value.binary !== true)
    || (value.oversized !== undefined && value.oversized !== true)) throw new Error('Invalid changed file')
  const { path, display, added, deleted, binary, oversized } = value
  return { path, display, added, deleted, ...(binary ? { binary } : {}), ...(oversized ? { oversized } : {}) }
}

function summaryValue(value) {
  if (!record(value) || !integer(value.turn) || value.turn < 1 || !Array.isArray(value.files)
    || !integer(value.total) || value.total < value.files.length || !integer(value.added) || !integer(value.deleted)) {
    throw new Error('Invalid change summary')
  }
  return { turn: value.turn, total: value.total, added: value.added, deleted: value.deleted,
    files: value.files.map(changedFile) }
}

function diffValue(value) {
  if (!record(value) || typeof value.path !== 'string' || typeof value.display !== 'string') throw new Error('Invalid change comparison')
  const { kind, path, display } = value
  if (kind === 'binary' || kind === 'oversized') return { kind, path, display }
  if (kind !== 'text' || typeof value.before !== 'boolean' || typeof value.after !== 'boolean'
    || typeof value.coarse !== 'boolean' || !Array.isArray(value.hunks)) throw new Error('Invalid text comparison')
  const hunks = value.hunks.map(hunk => {
    if (!record(hunk) || !integer(hunk.oldStart) || hunk.oldStart < 1 || !integer(hunk.oldLines)
      || !integer(hunk.newStart) || hunk.newStart < 1 || !integer(hunk.newLines) || !Array.isArray(hunk.lines)) {
      throw new Error('Invalid diff hunk')
    }
    let oldLines = 0, newLines = 0
    for (const line of hunk.lines) {
      if (typeof line !== 'string' || ![' ', '+', '-'].includes(line[0])) throw new Error('Invalid diff line')
      if (line[0] !== '+') oldLines++
      if (line[0] !== '-') newLines++
    }
    if (oldLines !== hunk.oldLines || newLines !== hunk.newLines) throw new Error('Invalid diff line counts')
    return { oldStart: hunk.oldStart, oldLines, newStart: hunk.newStart, newLines, lines: hunk.lines }
  })
  return { kind, path, display, before: value.before, after: value.after, coarse: value.coarse, hunks }
}

function coordinates(payload, diff) {
  if (!nonempty(payload.sessionId) || payload.sessionId.length > 2048 || !integer(payload.seq)
    || (diff && !integer(payload.index)) || payload.childSessionId !== undefined) {
    throw failure('bad-request', 'Changes require sessionId, a non-negative seq, and for diff a non-negative index; subagents are unsupported')
  }
}

// Only fixed official Fetch routes cross the Host boundary. Buffered mode alone
// cannot detect a registered GET route: Connection also returns it for 404s.
export function createWorkspaceChangesAdapter(handler, peer) {
  let available = false
  let probing
  const fetchResponse = async (url, signal) => {
    signal.throwIfAborted()
    const task = Promise.resolve().then(() => handler.fetch(new Request(url, { signal }), peer))
    task.then(response => { if (signal.aborted) void response.body?.cancel().catch(() => {}) }, () => {})
    return abortable(task, signal)
  }
  return {
    available: () => available && !peer.signal.aborted,
    refresh() {
      if (!handler?.fetch || peer.signal.aborted) return Promise.resolve(false)
      if (probing) return probing
      const signal = AbortSignal.any([peer.signal, AbortSignal.timeout(2000)])
      probing = Promise.all(Object.values(routes).map(async route => {
        // Both official routes validate coordinates before touching a Session.
        const response = await fetchResponse(new URL(route, 'http://localhost'), signal)
        await response.body?.cancel()
        return response.status === 400
      })).then(results => { available = results.every(Boolean); return available }, () => { available = false; return false })
        .finally(() => { probing = undefined })
      return probing
    },
    async read(method, payload, callerSignal) {
      coordinates(payload, method === 'diff')
      if (!Object.hasOwn(routes, method)) throw failure('bad-request', 'Invalid change query')
      if (!handler?.fetch) throw failure('workspace-changes-unavailable', 'Host change routes are unavailable')
      const signal = AbortSignal.any([peer.signal, AbortSignal.timeout(30_000), ...(callerSignal ? [callerSignal] : [])])
      signal.throwIfAborted()
      if (!available && !await abortable(this.refresh(), signal)) {
        throw failure('workspace-changes-unavailable', 'Host change routes are unavailable')
      }
      const url = new URL(routes[method], 'http://localhost')
      url.searchParams.set('sessionId', payload.sessionId)
      url.searchParams.set('seq', payload.seq)
      if (method === 'diff') url.searchParams.set('index', payload.index)
      const response = await fetchResponse(url, signal)
      if (!response.ok) {
        await response.body?.cancel()
        const code = response.status === 404 ? 'workspace-changes-missing'
          : response.status === 401 || response.status === 403 ? 'authentication-required' : 'workspace-changes-failed'
        throw failure(code, `Host change query returned HTTP ${response.status}`)
      }
      const value = await readJson(response, method === 'diff' ? DIFF_LIMIT : SUMMARY_LIMIT, signal)
      return method === 'diff' ? diffValue(value) : summaryValue(value)
    },
  }
}

export async function handleWorkspaceChangesQuery(api, msg, signal) {
  const identity = Object.fromEntries(['requestId', 'sessionId', 'seq', 'index']
    .filter(key => ['string', 'number'].includes(typeof msg[key])).map(key => [key, msg[key]]))
  try {
    const diff = msg.type === 'workspace-changes-diff'
    if (!WORKSPACE_CHANGES_REQUEST_TYPES.has(msg.type) || !nonempty(msg.requestId) || msg.requestId.length > 128) {
      throw failure('bad-request', 'A non-empty requestId of at most 128 characters is required')
    }
    coordinates(msg, diff)
    if (!api.workspaceChanges) throw failure('workspace-changes-unavailable', 'Host change routes are unavailable')
    const value = await api.workspaceChanges.read(diff ? 'diff' : 'summary', msg, signal)
    const frame = { kind: msg.type, requestId: msg.requestId, sessionId: msg.sessionId, seq: msg.seq,
      ...(diff ? { index: msg.index, diff: value } : { summary: value }) }
    if (Buffer.byteLength(stringifyWireFrame(frame)) > (diff ? DIFF_LIMIT : SUMMARY_LIMIT)) throw tooLarge()
    return frame
  } catch (error) {
    return { kind: 'error', ...identity, requestType: msg.type, code: error.code && typeof error.code === 'string'
      ? error.code : 'workspace-changes-failed', message: error.message || 'Change query failed' }
  }
}
