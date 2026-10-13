import assert from 'node:assert/strict'
import { createSpeechInputManager } from '../lib/speech-input.mjs'

const snapshot = { providers: [{ id: 'sensevoice-local', preparation: { phase: 'ready' } }],
  selection: { providerId: 'sensevoice-local', language: 'auto' }, maxAudioBytes: 4 * 1024 * 1024, maxDurationSeconds: 120 }
const wav = Buffer.alloc(364)
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(320, 40)
const audioBase64 = wav.toString('base64')
const transcript = { text: '帮我检查代码', audioSeconds: 0.01, inferenceSeconds: 0.1 }
const calls = []
let transcribe = async request => { calls.push(request); return transcript }
let followSignal
let followClosed = false
const api = { speech: {
  catalog: async () => snapshot,
  transcribe: (request, signal) => transcribe(request, signal),
  prepare: async (...args) => calls.push(args.slice(0, 2)),
  configure: async patch => calls.push(patch),
  cancelPreparation: async id => calls.push(id),
  follow: async function* (signal) {
    followSignal = signal
    try {
      yield snapshot
      await new Promise(resolve => {
        if (signal.aborted) resolve()
        else signal.addEventListener('abort', resolve, { once: true })
      })
    } finally { followClosed = true }
  },
} }
const manager = createSpeechInputManager(api)
const client = {}
const frames = []
const handle = (type, extra = {}, owner = client) => manager.handle(owner, { type, requestId: type, ...extra }, frame => frames.push(frame))
assert.equal((await handle('speech-catalog')).available, true)
assert.deepEqual(await handle('speech-transcribe', { audioBase64, providerId: 'sensevoice-local', language: 'zh' }),
  { kind: 'speech-transcript', requestId: 'speech-transcribe', ...transcript })
assert.deepEqual(calls[0], { audioBase64, providerId: 'sensevoice-local', language: 'zh' })
assert.equal((await handle('speech-transcribe', { audioBase64: '%%%=' })).code, 'speech/invalid-audio')
assert.equal((await handle('speech-transcribe', { audioBase64: 'A'.repeat(6 * 1024 * 1024) })).code, 'speech/invalid-audio')
assert.equal((await handle('speech-transcribe', { audioBase64, requestId: '' })).code, 'bad-request')
await handle('speech-prepare', { providerId: 'sensevoice-local', downloadSource: 'https://hf-mirror.com' })
assert.deepEqual(calls.at(-1), ['sensevoice-local', { downloadSource: 'https://hf-mirror.com' }])
await handle('speech-configure', { language: 'zh' })
assert.deepEqual(calls.at(-1), { language: 'zh' })
await handle('speech-cancel-preparation', { providerId: 'sensevoice-local' })
assert.equal(calls.at(-1), 'sensevoice-local')
await handle('speech-subscribe')
await new Promise(resolve => setImmediate(resolve))
assert.equal(frames[0].kind, 'speech-state')
await handle('speech-unsubscribe')
await new Promise(resolve => setImmediate(resolve))
assert.equal(followSignal.aborted, true)
assert.equal(followClosed, true)

// 取消必须属于同一连接，且迟到的成功结果不能覆盖取消。
let settle
let signal
transcribe = async (_request, value) => { signal = value; return new Promise(resolve => { settle = resolve }) }
const pending = handle('speech-transcribe', { requestId: 'record-1', audioBase64 })
await new Promise(resolve => setImmediate(resolve))
assert.equal((await handle('speech-transcribe', { requestId: 'record-2', audioBase64 })).code, 'speech/busy')
assert.equal((await handle('speech-catalog', { requestId: 'record-1' })).code, 'speech/request-in-progress')
assert.equal((await handle('speech-cancel', { targetRequestId: 'record-1' }, {})).code, 'speech/request-not-found')
assert.equal((await handle('speech-cancel', { targetRequestId: 'record-1' })).kind, 'speech-cancelled')
assert.equal(signal.aborted, true)
settle(transcript)
assert.equal((await pending).code, 'speech/cancelled')

const disconnected = handle('speech-transcribe', { requestId: 'record-3', audioBase64 })
await new Promise(resolve => setImmediate(resolve))
manager.closeClient(client)
assert.equal(signal.aborted, true)
settle(transcript)
assert.equal((await disconnected).code, 'speech/cancelled')
manager.dispose()

// 全局并发上限，断线释放信号，Provider 拒绝时保留官方错误代码。
{
  const signals = []
  const limited = createSpeechInputManager({ speech: {
    catalog: async () => snapshot,
    transcribe: async (_request, signal) => {
      signals.push(signal)
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    },
  } })
  const owners = Array.from({ length: 4 }, () => ({}))
  const pending = owners.map((owner, i) => limited.handle(owner, { type: 'speech-transcribe', requestId: `global-${i}`, audioBase64 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal((await limited.handle({}, { type: 'speech-transcribe', requestId: 'overflow', audioBase64 })).code, 'speech/busy')
  limited.dispose()
  assert.ok(signals.every(signal => signal.aborted))
  assert.ok((await Promise.all(pending)).every(frame => frame.code === 'speech/cancelled'))
}
transcribe = async () => { throw Object.assign(new Error('model not ready'), { code: 'speech/transcription-failed' }) }
const rejected = createSpeechInputManager(api)
assert.equal((await rejected.handle({}, { type: 'speech-transcribe', requestId: 'upstream', audioBase64 })).code, 'speech/transcription-failed')
rejected.dispose()

const unavailable = createSpeechInputManager({ speech: { catalog: async () => {
  throw Object.assign(new Error('not mounted'), { code: 'gateway/invocation-unavailable' })
} } })
assert.equal((await unavailable.handle({}, { type: 'speech-catalog', requestId: 'a' })).available, false)
unavailable.dispose()

const timeout = createSpeechInputManager({ speech: { catalog: async () => snapshot,
  transcribe: async (_request, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }),
} }, { transcriptionTimeoutMs: 10 })
// 测试进程不依靠 unref 的生产超时定时器保活。
const keepAlive = setTimeout(() => {}, 1000)
assert.equal((await timeout.handle({}, { type: 'speech-transcribe', requestId: 'timeout', audioBase64 })).code, 'speech/timeout')
clearTimeout(keepAlive)
timeout.dispose()
console.log('SPEECH INPUT TESTS PASSED')
