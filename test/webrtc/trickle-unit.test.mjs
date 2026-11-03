import assert from 'node:assert/strict'
import { test } from 'node:test'
import { enableTrickleIce } from '../../lib/rtc-trickle.mjs'

function fixture() {
  let resolve, reject, listener
  const gathering = new Promise((yes, no) => { resolve = yes; reject = no })
  const candidates = [], failures = []
  const pc = {
    onIceCandidate: { subscribe(callback) {
      listener = callback
      return { unSubscribe() { listener = null } }
    } },
    gatherCandidates: () => gathering,
    async addIceCandidate(candidate) { candidates.push(candidate) },
    async close() {},
  }
  enableTrickleIce(pc, () => failures.push('gather-failed'))
  return { pc, candidates, failures, resolve, reject, emit: candidate => listener?.(candidate) }
}

test('first candidate releases setup, later gathering remains pending and remote EOC is deferred', async () => {
  const f = fixture()
  const setup = f.pc.gatherCandidates()
  let complete = false
  setup.then(() => { complete = true })
  await Promise.resolve()
  assert.equal(complete, false)
  f.emit({ candidate: 'host' })
  await setup
  const candidate = { candidate: 'remote-srflx' }
  await f.pc.addIceCandidate(candidate)
  let ended = false
  const end = f.pc.addIceCandidate(null).then(() => { ended = true })
  await Promise.resolve()
  assert.deepEqual(f.candidates, [candidate])
  assert.equal(ended, false)
  f.resolve()
  await end
  assert.deepEqual(f.candidates, [candidate, null])
})

test('empty gathering completes without waiting for a candidate', async () => {
  const f = fixture()
  const setup = f.pc.gatherCandidates()
  f.resolve()
  await setup
  assert.deepEqual(f.failures, [])
})

test('late gathering failure is reported after early setup without an unhandled rejection', async () => {
  const f = fixture()
  const setup = f.pc.gatherCandidates()
  f.emit({ candidate: 'host' })
  await setup
  f.reject(new Error('failed STUN socket'))
  await Promise.resolve()
  await Promise.resolve()
  assert.deepEqual(f.failures, ['gather-failed'])
})

test('close releases pending setup and prevents deferred EOC from touching a closed peer', async () => {
  const f = fixture()
  const setup = f.pc.gatherCandidates()
  const ended = assert.rejects(f.pc.addIceCandidate(null), /closed/)
  await f.pc.close()
  await setup
  f.resolve()
  await ended
  assert.deepEqual(f.candidates, [])
  await assert.rejects(f.pc.gatherCandidates(), /closed/)
})

test('gathering failure before a usable candidate rejects setup', async () => {
  const f = fixture()
  const setup = f.pc.gatherCandidates()
  f.reject(new Error('failed to gather'))
  await assert.rejects(setup, /failed to gather/)
  assert.deepEqual(f.failures, ['gather-failed'])
})

test('unsupported runtime API is rejected instead of silently skipping validation', () => {
  assert.throws(() => enableTrickleIce({}), /unsupported/)
})

test('complete non-trickle SDP keeps full gathering for compatibility', async () => {
  const f = fixture()
  f.pc.remoteDescription = { sdp: 'v=0\r\na=end-of-candidates\r\n' }
  const setup = f.pc.gatherCandidates()
  let complete = false
  setup.then(() => { complete = true })
  f.emit({ candidate: 'host' })
  await Promise.resolve()
  assert.equal(complete, false)
  f.resolve()
  await setup
})
