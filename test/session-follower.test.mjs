import assert from 'node:assert/strict'
import { createFollowDecoder, createSessionFollower } from '../lib/session-follower.mjs'

const snapshot = (sessionId = 's1', assistantStream = { revision: 0 }) => ({
  type: 'snapshot', header: { version: 3, id: sessionId }, cursor: 41,
  records: [], hasMore: false, projections: { asOfSeq: 41, values: {} }, assistantStream,
})
const start = (attemptId = 'a1', revision = 1) => ({ type: 'assistant-stream', frame: {
  type: 'start', attemptId, revision, startedAfterSeq: 41, turn: 2, step: 3,
} })
const chunk = (index, revision = index + 2) => ({ type: 'assistant-stream', frame: {
  type: 'chunk', attemptId: 'a1', revision, index, time: 100 + index,
  chunk: { type: 'text-delta', index: 0, text: index === 0 ? 'Hello' : ' world' },
} })
const settlement = eventType => ({ type: 'event', event: {
  type: eventType, seq: 42, time: 102, data: { turn: 2, step: 3 },
} })
const end = (outcome, index = 2, revision = 4) => ({ type: 'assistant-stream', frame: {
  type: 'end', attemptId: 'a1', revision, index, outcome,
} })

// Chunk identity never consumes the durable seq; turn/step come from start.
for (const eventType of ['assistant/message', 'assistant/attempt']) {
  const decode = createFollowDecoder('s1')
  decode(snapshot())
  decode(start())
  for (let index = 0; index < 2; index++) {
    const next = decode(chunk(index))
    assert.equal(next.frame.turn, 2)
    assert.equal(next.frame.step, 3)
    assert.equal(next.frame.index, index)
    assert.equal('seq' in next.frame, false)
  }
  assert.equal(decode(settlement(eventType)).event.seq, 42)
  assert.equal(decode(end({ kind: 'committed', eventType, seq: 42 })).frame.outcome.seq, 42)
}

// Reconnect in the middle of an attempt resumes at the baseline's nextIndex.
const activeAttempt = { attemptId: 'a1', startedAfterSeq: 41, turn: 2, step: 3, nextIndex: 1,
  stream: [{ type: 'text-chunks', time0: 100, index: 0, texts: ['Hello'], dt: [] }] }
{
  const decode = createFollowDecoder('s1')
  assert.deepEqual(decode(snapshot('s1', { revision: 2, activeAttempt })).assistantStream.activeAttempt, activeAttempt)
  assert.equal(decode(chunk(1)).frame.turn, 2)
  assert.equal(decode(end({ kind: 'abandoned' })).frame.type, 'end')
  assert.equal(decode(start('retry-attempt', 5)).frame.attemptId, 'retry-attempt')
}
{
  const decode = createFollowDecoder('s1')
  decode(snapshot()); decode(start())
  assert.equal(decode(end({ kind: 'abandoned' }, 0, 2)).frame.index, 0)
}
for (const invalid of [chunk(1, 2), chunk(0, 3), end({ kind: 'committed', eventType: 'assistant/message', seq: 42 }, 0, 2)]) {
  const decode = createFollowDecoder('s1')
  decode(snapshot()); decode(start())
  assert.throws(() => decode(invalid))
}
{
  const decode = createFollowDecoder('s1')
  decode(snapshot()); decode(start()); decode(chunk(0))
  assert.throws(() => decode(chunk(0)), /revision gap/)
}
assert.throws(() => createFollowDecoder('s1')(snapshot('s2')), /invalid snapshot/)
assert.throws(() => createFollowDecoder('s1')({ ...snapshot(), assistantStream: undefined }), /missing assistant/)

// A stream gap aborts the broken producer before opening a new generation.
{
  let opens = 0
  const signals = []
  const frames = []
  const errors = []
  const api = { async openSessionStream(sessionId, signal) {
    signals.push(signal)
    const opening = ++opens
    return (async function* () {
      yield snapshot(sessionId)
      if (opening === 1) { yield start(); yield chunk(0, 10) }
    })()
  } }
  const follower = createSessionFollower(api, { retryMs: 1,
    onFrame(frame, context) {
      frames.push({ frame, context })
      if (opens === 2) follower.stop()
    },
    onError(error, context) { errors.push({ error, context }) },
  })
  await follower.start('s1', 'subscription-1')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].context.retrying, true)
  assert.match(errors[0].error.message, /revision gap/)
  assert.equal(signals.every(signal => signal.aborted), true)
  assert.notEqual(frames[0].context.streamId, frames.at(-1).context.streamId)
  assert.equal(frames.at(-1).context.subscriptionId, 'subscription-1')
}

// A slow obsolete opening must never publish after switching subscriptions.
{
  let release
  const firstOpening = new Promise(resolve => { release = resolve })
  const signals = []
  const frames = []
  const api = { async openSessionStream(sessionId, signal) {
    signals.push(signal)
    if (sessionId === 's1') await firstOpening
    return (async function* () { yield snapshot(sessionId) })()
  } }
  const follower = createSessionFollower(api, {
    onFrame(frame, context) { frames.push(context); follower.stop() },
    onError(error) { throw error },
  })
  const oldTask = follower.start('s1', 'old')
  const newTask = follower.start('s2', 'new')
  release()
  await Promise.all([oldTask, newTask])
  assert.deepEqual(frames.map(frame => frame.sessionId), ['s2'])
  assert.equal(signals.every(signal => signal.aborted), true)
}

console.log('SESSION FOLLOWER TESTS PASSED')
