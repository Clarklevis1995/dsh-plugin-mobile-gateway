import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { EventEmitter } from 'node:events'
import { createTransportDecoder, createReassemblyBudget, encodeTransportMessage } from '../../lib/transport-framing.mjs'
import { parseTransportJson, normalizeTransportConfig, DEFAULT_STUN_SERVERS, managedStunServers } from '../../lib/transport-config.mjs'
import { RtcMobileTransport } from '../../lib/rtc-mobile-transport.mjs'

const vectors = JSON.parse(fs.readFileSync(new URL('../fixtures/transport-v1/frames.json', import.meta.url)))

test('shared golden vectors and malformed headers', () => {
  for (const vector of vectors.valid) {
    const chunks = [...encodeTransportMessage(Buffer.from(vector.json), { channel: vector.channel, sequence: 1n })]
    assert.equal(chunks[0].toString('hex'), vector.hex)
    const decoder = createTransportDecoder({ channel: vector.channel })
    assert.equal(decoder.push(Buffer.from(vector.hex, 'hex')), vector.json)
    decoder.close()
  }
  for (const vector of vectors.invalid) {
    const budget = createReassemblyBudget()
    const decoder = createTransportDecoder({ channel: vector.channel, budget })
    assert.throws(() => decoder.push(Buffer.from(vector.hex, 'hex')), undefined, vector.name)
    assert.equal(budget.used, 0)
  }
})

test('UTF-8 boundaries, 16 KiB frames, 16 MiB messages, empty and oversized input', () => {
  const limits = { channel: 'conversation', sequence: 1n }
  for (const length of [1, 16340, 16350, 16352, 16353, 16777216 - 14]) {
    const json = JSON.stringify({ text: 'x'.repeat(length) + '中文🐋' })
    if (Buffer.byteLength(json) > 16777216) continue
    const decoder = createTransportDecoder(limits)
    let result
    for (const chunk of encodeTransportMessage(Buffer.from(json), limits)) {
      assert(chunk.length <= 16384)
      result = decoder.push(chunk)
    }
    assert.equal(result, json)
    decoder.close()
  }
  const decoder = createTransportDecoder(limits)
  const exact = Buffer.from('"' + 'a'.repeat(16777214) + '"')
  let result
  for (const chunk of encodeTransportMessage(exact, limits)) result = decoder.push(chunk)
  assert.equal(Buffer.byteLength(result), 16777216)
  decoder.close()
  assert.throws(() => [...encodeTransportMessage(Buffer.alloc(16777217), limits)], { code: 'transport/ws-required' })
  assert.throws(() => [...encodeTransportMessage(Buffer.alloc(0), limits)])
  assert.throws(() => [...encodeTransportMessage(Buffer.from('{}'), { ...limits, sequence: 1n << 63n })])
  const malformed = [...encodeTransportMessage(Buffer.from([0x22, 0xff, 0x22]), limits)][0]
  assert.throws(() => createTransportDecoder(limits).push(malformed))
})

test('duplicate/order errors, sequence isolation, budget and timeout release', async () => {
  const chunks = [
    ...encodeTransportMessage(Buffer.from(JSON.stringify({ text: 'x'.repeat(2000) })), {
      channel: 'control',
      sequence: 1n,
      maxFrameBytes: 1024,
    }),
  ]
  for (const order of [[0, 0], [1], [0, 2]]) {
    const budget = createReassemblyBudget()
    const decoder = createTransportDecoder({ channel: 'control', maxFrameBytes: 1024, budget })
    assert.throws(() => {
      for (const i of order) decoder.push(chunks[i])
    })
    assert.equal(budget.used, 0)
  }
  const budget = createReassemblyBudget(3000)
  const one = createTransportDecoder({ channel: 'control', maxFrameBytes: 1024, budget })
  const two = createTransportDecoder({ channel: 'control', maxFrameBytes: 1024, budget })
  one.push(chunks[0])
  assert(budget.used > 2000)
  assert.throws(() => two.push(chunks[0]), { code: 'transport/reassembly-budget' })
  one.close()
  assert.equal(budget.used, 0)
  let failure
  const timed = createTransportDecoder({
    channel: 'control',
    maxFrameBytes: 1024,
    budget,
    idleTimeoutMs: 5,
    onFailure: (error) => {
      failure = error
    },
  })
  timed.push(chunks[0])
  await delay(20)
  assert.equal(failure.code, 'transport/chunk-timeout')
  assert.equal(budget.used, 0)
  const sequential = createTransportDecoder({ channel: 'control' })
  const minimal = [...encodeTransportMessage(Buffer.from('{}'), { channel: 'control', sequence: 1n })][0]
  assert.equal(sequential.push(minimal), '{}')
  assert.throws(() => sequential.push(minimal))
})

test('strict JSON rejects duplicate and escaped-duplicate fields, invalid UTF-8 and nesting', () => {
  for (const value of [
    '{"type":"a","type":"b"}',
    '{"type":"a","ty\\u0070e":"b"}',
    '{"nested":{"ticket":"a","ticket":"b"}}',
    '{} {}',
    '{"a":01}',
    '{"a":}',
    '[]',
  ])
    assert.throws(() => parseTransportJson(value))
  assert.throws(() => parseTransportJson(Buffer.from([0xff])))
  assert.throws(() => parseTransportJson('{"x":'.repeat(70) + '0' + '}'.repeat(70)))
  assert.equal(parseTransportJson('{"x":"中文🐋","a":[1,true,null,{"x":2}]}').x, '中文🐋')
  assert.throws(() => normalizeTransportConfig({ stunServers: ['turn:example.org:3478'] }))
  assert.throws(() => normalizeTransportConfig({ stunServers: ['stun:stun.example.com:3478'] }))
})

test('RTC backpressure waits, close cancels waiters, oversize response has explicit recovery error', async () => {
  const dc = new EventEmitter()
  dc.readyState = 'open'
  dc.bufferedAmount = 300000
  dc.sent = []
  dc.send = (data) => dc.sent.push(data)
  dc.close = () => {}
  const failures = []
  const transport = new RtcMobileTransport(dc, {
    channel: 'control',
    receiveLimits: { maxFrameBytes: 1024, maxLogicalMessageBytes: 1024 },
    sendLimits: { maxFrameBytes: 1024, maxLogicalMessageBytes: 1024 },
    onFailure: (error) => failures.push(error),
  })
  transport.activate()
  const pending = transport.send('{"kind":"pong"}')
  await delay(20)
  assert.equal(dc.sent.length, 0)
  dc.bufferedAmount = 0
  await pending
  assert(dc.sent.length > 0)
  dc.sent = []
  await transport.send(JSON.stringify({ kind: 'history', requestId: 'large-history', body: 'x'.repeat(2048) }))
  const decoder = createTransportDecoder({ channel: 'control' })
  // 前一条 pong 已消费 sequence=1。
  decoder.push([...encodeTransportMessage(Buffer.from('{}'), { channel: 'control', sequence: 1n })][0])
  const recovery = JSON.parse(decoder.push(dc.sent[0]))
  assert.equal(recovery.code, 'transport/ws-required')
  assert.equal(recovery.requestId, 'large-history')
  dc.bufferedAmount = 300000
  const cancelled = transport.send('{"kind":"pong"}')
  await delay(15)
  transport.close()
  await assert.rejects(cancelled)
  assert.equal(transport.queuedBytes, 0)
  assert.equal(failures.length, 0)
})

test('only RTC hello crosses the pre-ACK window; per-channel first ping releases bounded business queue', async () => {
  const dc = new EventEmitter()
  Object.assign(dc, { readyState: 'open', bufferedAmount: 0, sent: [] })
  dc.send = (data) => dc.sent.push(data)
  dc.close = () => {}
  const failures = []
  const transport = new RtcMobileTransport(dc, {
    channel: 'control',
    receiveLimits: { maxFrameBytes: 16384, maxLogicalMessageBytes: 16777216 },
    sendLimits: { maxFrameBytes: 16384, maxLogicalMessageBytes: 16777216 },
    requireStart: true,
    onFailure: (error) => failures.push(error),
  })
  transport.activate()
  await transport.send('{"kind":"hello"}')
  const baseline = transport.send('{"kind":"projection-baseline","projections":{}}')
  await delay(25)
  assert.equal(dc.sent.length, 1)
  const ping = [...encodeTransportMessage(Buffer.from('{"type":"ping"}'), { channel: 'control', sequence: 1n })][0]
  dc.emit('message', ping, true)
  await baseline
  assert.equal(dc.sent.length, 2)
  assert.equal(failures.length, 0)
  transport.close()
})


test('Cloudflare STUN is automatic by default and managed empty preferences restore it', () => {
  const expected = ['stun:stun.cloudflare.com:3478']
  assert.deepEqual(normalizeTransportConfig().stunServers, expected)
  assert.deepEqual(managedStunServers([]), expected)
  assert.deepEqual(managedStunServers(undefined), expected)
  const custom = ['stun:trusted.test:3478']
  assert.deepEqual(normalizeTransportConfig({ stunServers: managedStunServers(custom) }).stunServers, custom)
  assert.deepEqual(normalizeTransportConfig({ stunServers: [] }).stunServers, [])
  assert.throws(() => DEFAULT_STUN_SERVERS.push('stun:wrong.test'))
  assert.throws(() => normalizeTransportConfig().stunServers.push('stun:wrong.test'))
  for (const invalid of [null, 'stun:trusted.test', ['turn:trusted.test:3478']]) {
    assert.throws(() => normalizeTransportConfig({ stunServers: managedStunServers(invalid) }))
  }
})
