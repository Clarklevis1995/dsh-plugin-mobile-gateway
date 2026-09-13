import crypto from 'node:crypto'
import { readSessionSnapshot } from './dsh-host-adapter.mjs'

function integer(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum
}

function requireAttempt(attempt) {
  if (!attempt || typeof attempt.attemptId !== 'string' || !attempt.attemptId
    || !integer(attempt.turn) || !integer(attempt.step)
    || !integer(attempt.startedAfterSeq, -1)) throw new Error('invalid assistant attempt')
  return attempt
}

// Validate the two independent clocks. No transient frame owns a Session seq.
export function createFollowDecoder(sessionId) {
  let cursor
  let revision
  let active
  return frame => {
    if (cursor === undefined) {
      const history = readSessionSnapshot(frame, sessionId)
      const baseline = frame.assistantStream
      if (!baseline || !integer(baseline.revision)) throw new Error('missing assistant stream baseline')
      if (baseline.activeAttempt !== undefined) {
        const attempt = requireAttempt(baseline.activeAttempt)
        if (!integer(attempt.nextIndex) || !Array.isArray(attempt.stream)
          || attempt.startedAfterSeq > history.cursor) throw new Error('invalid assistant baseline')
        active = { ...attempt }
      }
      cursor = history.cursor
      revision = baseline.revision
      return { type: 'snapshot', history, assistantStream: baseline }
    }
    if (frame?.type === 'event') {
      if (!frame.event || frame.event.seq !== cursor + 1) throw new Error('session event sequence gap')
      cursor = frame.event.seq
      return frame
    }
    if (frame?.type !== 'assistant-stream') throw new Error('unexpected session follow frame')
    const next = frame.frame
    if (!next || next.revision !== revision + 1) throw new Error('assistant stream revision gap')
    if (next.type === 'start') {
      requireAttempt(next)
      if (active || next.startedAfterSeq > cursor) throw new Error('unexpected assistant start')
      active = { ...next, nextIndex: 0 }
    } else {
      if (!active || next.attemptId !== active.attemptId || next.index !== active.nextIndex) {
        throw new Error('assistant stream attempt/index gap')
      }
      if (next.type === 'chunk') {
        if (!integer(next.time) || !next.chunk || typeof next.chunk.type !== 'string') {
          throw new Error('invalid assistant chunk')
        }
        active.nextIndex += 1
      } else if (next.type === 'end') {
        const outcome = next.outcome
        if (!outcome || (outcome.kind !== 'abandoned' && (outcome.kind !== 'committed'
          || !['assistant/message', 'assistant/attempt'].includes(outcome.eventType)
          || !integer(outcome.seq) || outcome.seq > cursor || outcome.seq <= active.startedAfterSeq))) {
          throw new Error('invalid assistant settlement')
        }
      } else throw new Error('unexpected assistant frame')
    }
    revision = next.revision
    const normalized = { ...next, turn: active.turn, step: active.step }
    if (next.type === 'end') active = undefined
    return { type: 'assistant-stream', frame: normalized }
  }
}

function delay(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) return resolve()
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    signal.addEventListener('abort', finish, { once: true })
  })
}

// One follow per opted-in connection. Each opening owns a new stream identity
// and atomic snapshot, including a reconnecting Agent's active attempt.
export function createSessionFollower(api, { onFrame, onError, retryMs = 1000 }) {
  let current
  const stop = () => {
    const previous = current
    current = undefined
    previous?.abort.abort()
  }
  const start = (sessionId, subscriptionId) => {
    stop()
    const state = { abort: new AbortController() }
    current = state
    const task = (async () => {
      let failures = 0
      while (current === state && !state.abort.signal.aborted) {
        const attemptAbort = new AbortController()
        const signal = AbortSignal.any([state.abort.signal, attemptAbort.signal])
        const streamId = crypto.randomUUID()
        const context = { sessionId, subscriptionId, streamId }
        const decode = createFollowDecoder(sessionId)
        let iterator
        let permanent = false
        try {
          const stream = await api.openSessionStream(sessionId, signal)
          iterator = stream[Symbol.asyncIterator]()
          while (current === state && !signal.aborted) {
            const item = await iterator.next()
            if (current !== state || signal.aborted) break
            if (item.done) throw new Error('session follow ended')
            const decoded = decode(item.value)
            onFrame(decoded, context)
          }
        } catch (error) {
          if (current !== state || signal.aborted) break
          permanent = ['unsupported-session-format', 'session/not-found', 'gateway/bad-request'].includes(error.code)
          onError(error, { ...context, retrying: !permanent })
        } finally {
          // Abort before return: the producer may be waiting for another event.
          attemptAbort.abort()
          try { await iterator?.return?.() } catch { /* The opening failure was already reported. */ }
        }
        if (permanent) break
        await delay(Math.min(retryMs * 2 ** Math.min(failures++, 5), 30_000), state.abort.signal)
      }
    })()
    return task
  }
  return { start, stop }
}
