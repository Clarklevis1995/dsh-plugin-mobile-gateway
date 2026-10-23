import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const FILE_UPLOAD_REQUEST_TYPES = new Set([
  'file-upload-open', 'file-upload-chunk', 'file-upload-finish', 'file-upload-cancel',
])
export const FILE_UPLOAD_DEFAULTS = Object.freeze({
  fileUploadsEnabled: true,
  fileUploadMaxBytes: 512 * 1024 * 1024,
  fileUploadChunkBytes: 256 * 1024,
  fileUploadMaxTransfers: 4,
  fileUploadIdleMs: 2 * 60 * 1000,
  fileUploadCommitTimeoutMs: 180_000,
})

function failure(code, message) { return Object.assign(new Error(message), { code }) }
function check(condition, code, message) { if (!condition) throw failure(code, message) }
function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 255
    && name !== '.' && name !== '..' && !/[\x00-\x1f\x7f/\\]/.test(name)
}

// Receive bounded chunks in a private spool, verify exact bytes, then use DSH's
// streaming attachment admission. Never interpret client names as host paths.
export function createFileUploadManager(api, configuration = {}) {
  const options = { ...FILE_UPLOAD_DEFAULTS, ...configuration }
  const payloadLimit = Math.max(0, Math.floor(((options.maxPayloadBytes ?? 144 * 1024 * 1024) - 4096) / 4) * 3)
  const chunkBytes = Math.min(options.fileUploadChunkBytes, payloadLimit)
  const transfers = new Map()
  const completed = new Map()
  const closedClients = new WeakSet()
  let disposed = false

  const cleanup = async transfer => {
    if (transfer.handle) {
      await transfer.handle.close().catch(() => {})
      transfer.handle = undefined
    }
    if (transfer.directory) await fsp.rm(transfer.directory, { recursive: true, force: true })
  }
  const release = async transfer => {
    try { await cleanup(transfer) } finally { transfers.delete(transfer.id) }
  }
  const stop = async transfer => {
    transfer.abort.abort(failure('file-upload-cancelled', 'File upload cancelled'))
    // Keep the slot reserved until its writes/Host commit have actually stopped.
    await transfer.operation?.catch(() => {})
    await release(transfer)
  }
  const assertActive = transfer => {
    transfer.abort.signal.throwIfAborted()
    check(!disposed && !closedClients.has(transfer.client), 'file-upload-cancelled', 'Upload connection closed')
  }
  const run = (transfer, task) => {
    check(!transfer.operation, 'file-upload-busy', 'An upload operation is already in progress')
    const operation = task()
    transfer.operation = operation
    return operation.finally(() => { if (transfer.operation === operation) transfer.operation = undefined })
  }

  const open = async (client, msg) => {
    check(!disposed && !closedClients.has(client), 'file-upload-cancelled', 'Upload connection closed')
    check(api.files?.available(), 'file-upload-unavailable', 'The official file upload service is unavailable')
    check(typeof msg.sessionId === 'string' && msg.sessionId.trim(), 'bad-request', 'An existing sessionId is required')
    check(msg.parentSessionId === undefined && msg.subagentMode === undefined, 'subagent/attachment-invalid', 'Subagent file uploads are unsupported')
    check(validName(msg.name), 'bad-request', 'name must be a leaf filename of 1..255 characters without control characters')
    check(Number.isSafeInteger(msg.size) && msg.size >= 0, 'bad-request', 'size must be a nonnegative safe integer')
    check(msg.size <= options.fileUploadMaxBytes, 'file-too-large', 'File exceeds the configured upload limit')
    check(typeof msg.sha256 === 'string' && /^[a-fA-F0-9]{64}$/.test(msg.sha256), 'bad-request', 'sha256 must contain 64 hexadecimal digits')
    check(transfers.size < options.fileUploadMaxTransfers, 'file-upload-limit', 'Too many active uploads')
    const transfer = {
      id: crypto.randomUUID(), client, sessionId: msg.sessionId.trim(), name: msg.name,
      size: msg.size, sha256: msg.sha256.toLowerCase(), offset: 0, hash: crypto.createHash('sha256'),
      abort: new AbortController(), lastActiveAt: Date.now(),
    }
    transfers.set(transfer.id, transfer)
    try {
      return await run(transfer, async () => {
        const sessions = await api.sessions.list({}, AbortSignal.any([
          transfer.abort.signal, AbortSignal.timeout(options.fileUploadCommitTimeoutMs),
        ]))
        check(sessions.items?.some(item => item.sessionId === transfer.sessionId && item.origin !== 'subagent'),
          'session-not-found', 'No visible ordinary session exists with this ID')
        assertActive(transfer)
        transfer.directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-mobile-upload-'))
        transfer.path = path.join(transfer.directory, 'payload')
        transfer.handle = await fsp.open(transfer.path, 'wx', 0o600)
        assertActive(transfer)
        return { kind: 'file-upload-opened', uploadId: transfer.id, sessionId: transfer.sessionId,
          name: transfer.name, size: transfer.size, chunkBytes, maxBytes: options.fileUploadMaxBytes,
          idleTimeoutMs: options.fileUploadIdleMs }
      })
    } catch (error) {
      await release(transfer)
      throw error
    }
  }

  const receive = async (client, msg) => {
    if (msg.type === 'file-upload-open') return open(client, msg)
    check(typeof msg.uploadId === 'string' && msg.uploadId.length > 0, 'bad-request', 'uploadId is required')
    const done = completed.get(msg.uploadId)
    if (done?.client === client && msg.type === 'file-upload-finish') return done.frame
    const transfer = transfers.get(msg.uploadId)
    check(transfer?.client === client, 'file-upload-not-found', 'Upload is unknown or belongs to another connection')
    if (msg.type === 'file-upload-cancel') {
      await stop(transfer)
      return { kind: 'file-upload-cancelled', uploadId: msg.uploadId, sessionId: transfer.sessionId }
    }
    assertActive(transfer)
    return run(transfer, async () => {
      transfer.lastActiveAt = Date.now()
      if (msg.type === 'file-upload-chunk') {
        check(Number.isSafeInteger(msg.offset) && msg.offset === transfer.offset,
          'file-upload-offset', 'offset must equal the next expected byte')
        check(typeof msg.data === 'string' && msg.data.length > 0 && msg.data.length <= Math.ceil(chunkBytes / 3) * 4,
          'file-upload-invalid-data', 'Chunk must be nonempty canonical base64 within chunkBytes')
        const bytes = Buffer.from(msg.data, 'base64')
        check(bytes.length > 0 && bytes.length <= chunkBytes && bytes.toString('base64') === msg.data,
          'file-upload-invalid-data', 'Chunk must be nonempty canonical base64 within chunkBytes')
        check(transfer.offset + bytes.length <= transfer.size, 'file-upload-size', 'Chunk exceeds declared size')
        try {
          let written = 0
          while (written < bytes.length) {
            assertActive(transfer)
            const result = await transfer.handle.write(bytes, written, bytes.length - written, transfer.offset + written)
            check(result.bytesWritten > 0, 'file-upload-write-failed', 'Upload write made no progress')
            written += result.bytesWritten
          }
        } catch (error) {
          transfer.abort.abort(error)
          await release(transfer)
          throw error
        }
        assertActive(transfer)
        transfer.hash.update(bytes)
        transfer.offset += bytes.length
        return { kind: 'file-upload-chunk-accepted', uploadId: transfer.id, sessionId: transfer.sessionId, nextOffset: transfer.offset }
      }
      check(transfer.offset === transfer.size, 'file-upload-incomplete', 'Not all declared bytes have arrived')
      try {
        check(transfer.hash.digest('hex') === transfer.sha256, 'file-upload-checksum', 'SHA-256 does not match the uploaded bytes')
        await transfer.handle.close()
        transfer.handle = undefined
        const signal = AbortSignal.any([transfer.abort.signal, AbortSignal.timeout(options.fileUploadCommitTimeoutMs)])
        const result = await api.files.upload({ sessionId: transfer.sessionId, name: transfer.name,
          data: fs.createReadStream(transfer.path, { highWaterMark: chunkBytes }) }, signal)
        signal.throwIfAborted()
        assertActive(transfer)
        check(typeof result.receiptId === 'string' && result.receiptId.length > 0
          && typeof result.file?.attachmentId === 'string' && result.file.attachmentId.length > 0
          && typeof result.file.name === 'string' && result.file.bytes === transfer.size,
        'file-upload-invalid-response', 'Official upload result does not match the declared file')
        const frame = { kind: 'file-upload-completed', uploadId: transfer.id, sessionId: transfer.sessionId,
          receiptId: result.receiptId, file: { attachmentId: result.file.attachmentId, name: result.file.name, bytes: result.file.bytes },
          sha256: transfer.sha256 }
        completed.set(transfer.id, { client, frame, lastActiveAt: Date.now() })
        if (completed.size > 128) completed.delete(completed.keys().next().value)
        return frame
      } finally {
        await release(transfer)
      }
    })
  }

  return {
    async handle(client, msg) {
      const correlation = {
        ...(typeof msg.requestId === 'string' ? { requestId: msg.requestId } : {}),
        ...(typeof msg.sessionId === 'string' ? { sessionId: msg.sessionId } : {}),
        ...(typeof msg.uploadId === 'string' ? { uploadId: msg.uploadId } : {}),
      }
      try {
        check(options.fileUploadsEnabled, 'file-upload-disabled', 'File uploads are disabled')
        check(typeof msg.requestId === 'string' && msg.requestId.trim().length > 0 && msg.requestId.length <= 128,
          'bad-request', 'requestId must contain 1..128 characters')
        const frame = await receive(client, msg)
        return { ...frame, requestId: msg.requestId }
      } catch (error) {
        return { kind: 'error', requestType: msg.type, ...correlation,
          code: error.name === 'TimeoutError' ? 'file-upload-timeout'
            : typeof error.code === 'string' ? error.code : 'file-upload-failed',
          message: error.message || 'File upload failed' }
      }
    },
    async closeClient(client) {
      closedClients.add(client)
      await Promise.all([...transfers.values()].filter(transfer => transfer.client === client).map(stop))
      for (const [id, done] of completed) if (done.client === client) completed.delete(id)
    },
    async expire() {
      const cutoff = Date.now() - options.fileUploadIdleMs
      await Promise.all([...transfers.values()].filter(transfer => !transfer.operation && transfer.lastActiveAt < cutoff).map(stop))
      for (const [id, done] of completed) if (done.lastActiveAt < cutoff) completed.delete(id)
    },
    async dispose() {
      disposed = true
      await Promise.all([...transfers.values()].map(stop))
      completed.clear()
    },
  }
}
