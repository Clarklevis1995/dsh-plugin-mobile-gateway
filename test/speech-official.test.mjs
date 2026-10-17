import { createTestPeer } from './helpers/peer.mjs'
// 可选契约验证：使用本机已安装的官方 DSH，不下载模型或新增运行依赖。
// DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { createSpeechInputManager } from '../lib/speech-input.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT to the installed official DSH directory')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const { default: SpeechController } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-experimental-api-speech-to-text')).href)
const { version } = require('@deepseek-ai/dsh-experimental-api-speech-to-text/package.json')
assert.equal(version, '0.2.1-rc.2')
let calls = 0
const controller = { config: { maxAudioBytes: 4194304, maxDurationSeconds: 120 }, ctx: { speechToText: {
  snapshot: () => ({ providers: [{ id: 'sensevoice-local', preparation: { phase: 'ready' } }],
    selection: { providerId: 'sensevoice-local', language: 'auto' } }),
  resolve: spec => { calls++; assert.equal(spec.audio.readUInt32LE(24), 16000); return spec },
  transcribe: async (_spec, signal) => { signal.throwIfAborted(); return { text: '官方接口验证', audioSeconds: 0.01, inferenceSeconds: 0.1 } },
} } }
const host = createDshHostAdapter({
  invoke: async ({ namespace, method, args, signal }) => {
    assert.equal(namespace, 'speech')
    if (method === 'catalog') return SpeechController.prototype.catalog.call(controller)
    assert.equal(method, 'transcribe')
    return SpeechController.prototype.transcribe.call(controller, args.request, signal)
  },
  stream: async () => { throw new Error('not used') },
}, createTestPeer())
const manager = createSpeechInputManager(host)
const wav = Buffer.alloc(364)
wav.write('RIFF'); wav.writeUInt32LE(356, 4); wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(16000, 24); wav.writeUInt32LE(32000, 28); wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(320, 40)
const client = {}
const request = bytes => manager.handle(client, { type: 'speech-transcribe', requestId: 'official',
  providerId: 'sensevoice-local', language: 'zh', audioBase64: bytes.toString('base64') })
assert.equal((await request(wav)).text, '官方接口验证')
const wrongSampleRate = Buffer.from(wav)
wrongSampleRate.writeUInt32LE(48000, 24)
assert.equal((await request(wrongSampleRate)).code, 'speech/transcription-failed')
assert.equal((await request(Buffer.from('not a wav'))).code, 'speech/transcription-failed')
assert.equal(calls, 1, 'Invalid audio must be rejected before provider selection')
manager.dispose()
console.log('OFFICIAL SPEECH REMOTE CONTRACT TESTS PASSED (DSH 0.2.1-rc.2; recognizer mocked)')
