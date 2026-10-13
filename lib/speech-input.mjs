// 移动连接只代理官方 speech Remote，不持有识别模型或写入会话历史。
export const SPEECH_REQUEST_TYPES = new Set([
  'speech-catalog', 'speech-subscribe', 'speech-unsubscribe', 'speech-configure',
  'speech-prepare', 'speech-cancel-preparation', 'speech-transcribe', 'speech-cancel',
])

const MAX_AUDIO_BYTES = 4 * 1024 * 1024
const UNAVAILABLE_CODES = new Set(['gateway/invocation-unavailable', 'gateway/definition-unavailable', 'gateway/service-unavailable'])

function failure(code, message) {
  return Object.assign(new Error(message), { code })
}

function identifier(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) {
    throw failure('bad-request', `${name} must be a nonempty string of at most 128 characters`)
  }
  return value.trim()
}

function errorFrame(msg, error) {
  return { kind: 'error', requestType: msg.type,
    ...(typeof msg.requestId === 'string' ? { requestId: msg.requestId } : {}),
    code: UNAVAILABLE_CODES.has(error?.code) ? 'speech/unavailable' : error?.code || 'speech/failed',
    message: UNAVAILABLE_CODES.has(error?.code)
      ? 'Enable the official voice input bundle in DSH plugin management' : error?.message || 'Speech operation failed' }
}

export function createSpeechInputManager(api, { maxPayloadBytes = 64 * 1024 * 1024,
  transcriptionTimeoutMs = 180_000 } = {}) {
  const clients = new Map()
  let activeTranscriptions = 0
  let disposed = false
  // 为 JSON 信封留出空间；实际限制还须服从官方插件的目录。
  const audioLimit = Math.min(MAX_AUDIO_BYTES, Math.max(0, Math.floor((maxPayloadBytes - 4096) / 4) * 3))
  const stateFor = client => {
    if (disposed) throw failure('speech/unavailable', 'Speech gateway has been disposed')
    let state = clients.get(client)
    if (!state) {
      state = { operations: new Map(), follow: null, closed: false }
      clients.set(client, state)
    }
    return state
  }
  const normalizeCatalog = value => {
    if (!value || !Array.isArray(value.providers) || !value.selection
      || !Number.isSafeInteger(value.maxAudioBytes) || value.maxAudioBytes < 46
      || !Number.isFinite(value.maxDurationSeconds) || value.maxDurationSeconds < 1) {
      throw failure('speech/invalid-response', 'Official speech catalog is invalid')
    }
    return { ...value, maxAudioBytes: Math.min(audioLimit, value.maxAudioBytes),
      maxDurationSeconds: value.maxDurationSeconds, available: true }
  }
  const stopFollow = state => {
    state.follow?.abort.abort()
    state.follow = null
  }
  const catalog = async signal => normalizeCatalog(await api.speech.catalog(signal))

  return {
    async handle(client, msg, send) {
      try {
        const requestId = identifier(msg.requestId, 'requestId')
        const state = stateFor(client)
        if (msg.type === 'speech-cancel') {
          const targetRequestId = identifier(msg.targetRequestId, 'targetRequestId')
          const task = state.operations.get(targetRequestId)
          if (!task || task.type !== 'speech-transcribe') throw failure('speech/request-not-found', 'Transcription is not active on this connection')
          task.abort.abort(failure('speech/cancelled', 'Transcription cancelled'))
          return { kind: 'speech-cancelled', requestId, targetRequestId }
        }
        if (msg.type === 'speech-unsubscribe') {
          stopFollow(state)
          return { kind: 'speech-unsubscribed', requestId }
        }
        if (state.operations.has(requestId) || state.follow?.requestId === requestId) {
          throw failure('speech/request-in-progress', 'requestId is already active on this connection')
        }
        if (state.operations.size >= 8) throw failure('speech/busy', 'Too many pending speech requests')
        if (msg.type === 'speech-subscribe') {
          stopFollow(state)
          const follow = { abort: new AbortController(), requestId }
          state.follow = follow
          // 先回执，再按订阅 requestId 推送完整快照。Host 的准备任务不属于此观察连接。
          queueMicrotask(async () => {
            try {
              const stream = await api.speech.follow(follow.abort.signal)
              for await (const snapshot of stream) {
                if (state.closed || state.follow !== follow || follow.abort.signal.aborted) break
                send({ kind: 'speech-state', requestId, ...normalizeCatalog(snapshot) })
              }
              if (!follow.abort.signal.aborted) throw failure('speech/stream-ended', 'Speech readiness stream ended; subscribe again')
            } catch (error) {
              if (!state.closed && state.follow === follow && !follow.abort.signal.aborted) send(errorFrame(msg, error))
            } finally {
              if (state.follow === follow) state.follow = null
            }
          })
          return { kind: 'speech-subscribed', requestId }
        }
        const abort = new AbortController()
        const task = { abort, type: msg.type }
        let timer
        let admitted = false
        state.operations.set(requestId, task)
        try {
          if (msg.type === 'speech-catalog') {
            try { return { kind: 'speech-catalog', requestId, ...await catalog(abort.signal) } }
            catch (error) {
              if (UNAVAILABLE_CODES.has(error?.code)) return { kind: 'speech-catalog', requestId,
                available: false, providers: [], code: 'speech/unavailable',
                message: 'Enable the official voice input bundle in DSH plugin management' }
              throw error
            }
          }
          if (msg.type === 'speech-transcribe') {
            if ([...state.operations.values()].some(value => value !== task && value.type === msg.type)
              || activeTranscriptions >= 4) throw failure('speech/busy', 'Too many active transcriptions')
            const encoded = msg.audioBase64
            if (typeof encoded !== 'string' || !encoded.length || encoded.length > Math.ceil(audioLimit / 3) * 4) {
              throw failure('speech/invalid-audio', 'Audio is empty or exceeds the gateway byte limit')
            }
            const audio = Buffer.from(encoded, 'base64')
            if (audio.length > audioLimit || audio.toString('base64') !== encoded) {
              throw failure('speech/invalid-audio', 'Audio must use canonical base64 within the gateway byte limit')
            }
            const request = { audioBase64: encoded,
              ...(msg.providerId === undefined ? {} : { providerId: identifier(msg.providerId, 'providerId') }),
              ...(msg.language === undefined ? {} : { language: identifier(msg.language, 'language') }) }
            activeTranscriptions++
            admitted = true
            timer = setTimeout(() => abort.abort(failure('speech/timeout', 'Transcription timed out')), transcriptionTimeoutMs)
            timer.unref?.()
            const limits = await catalog(abort.signal)
            abort.signal.throwIfAborted()
            if (audio.length > limits.maxAudioBytes) throw failure('speech/invalid-audio', 'Audio exceeds the official plugin byte limit')
            // 官方 Remote 负责 WAV、采样率、语言、模型就绪与录音时长校验。
            const result = await api.speech.transcribe(request, abort.signal)
            abort.signal.throwIfAborted()
            if (typeof result?.text !== 'string' || !Number.isFinite(result.audioSeconds) || result.audioSeconds < 0
              || !Number.isFinite(result.inferenceSeconds) || result.inferenceSeconds < 0) {
              throw failure('speech/invalid-response', 'Official speech transcript is invalid')
            }
            return { kind: 'speech-transcript', requestId, text: result.text,
              audioSeconds: result.audioSeconds, inferenceSeconds: result.inferenceSeconds }
          }
          if (msg.type === 'speech-configure') {
            const patch = {
              ...(msg.providerId === undefined ? {} : { providerId: identifier(msg.providerId, 'providerId') }),
              ...(msg.language === undefined ? {} : { language: identifier(msg.language, 'language') }),
            }
            if (!Object.keys(patch).length) throw failure('bad-request', 'Provide providerId or language')
            await api.speech.configure(patch, abort.signal)
            return { kind: 'speech-configured', requestId }
          }
          const providerId = identifier(msg.providerId, 'providerId')
          if (msg.type === 'speech-prepare') {
            const options = msg.downloadSource === undefined ? undefined : { downloadSource: msg.downloadSource }
            if (options && (typeof options.downloadSource !== 'string' || !options.downloadSource.trim() || options.downloadSource.length > 2048)) {
              throw failure('bad-request', 'downloadSource must be an advertised nonempty origin')
            }
            await api.speech.prepare(providerId, options, abort.signal)
            return { kind: 'speech-preparing', requestId, providerId }
          }
          if (msg.type === 'speech-cancel-preparation') {
            await api.speech.cancelPreparation(providerId, abort.signal)
            return { kind: 'speech-preparation-cancelled', requestId, providerId }
          }
          throw failure('bad-request', 'Unknown speech request')
        } catch (error) {
          throw abort.signal.aborted ? abort.signal.reason : error
        } finally {
          clearTimeout(timer)
          state.operations.delete(requestId)
          if (admitted) activeTranscriptions--
        }
      } catch (error) { return errorFrame(msg, error) }
    },
    closeClient(client) {
      const state = clients.get(client)
      if (!state) return
      state.closed = true
      stopFollow(state)
      for (const task of state.operations.values()) task.abort.abort(failure('speech/cancelled', 'Mobile connection closed'))
      clients.delete(client)
    },
    dispose() {
      disposed = true
      for (const client of clients.keys()) this.closeClient(client)
    },
  }
}
