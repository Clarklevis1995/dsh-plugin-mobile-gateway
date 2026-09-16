import assert from 'node:assert/strict'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { handleQuery, admitMessage } from '../lib/index.mjs'

function fixture() {
  const states = new Map()
  const calls = []
  let nextId = 0
  let beforeSelect = async () => {}
  let beforePrompt = async () => {}
  const presets = [{ id: 'standard', name: '标准模式', isDefault: true },
    { id: 'minimal', name: '精简模式' }, { id: 'broken', broken: 'missing plugin' }]
  const api = createDshHostAdapter({
    async invoke(call) {
      calls.push(call)
      const { namespace, method, args } = call
      if (namespace === 'agentPresets' && method === 'list') return { presets, modeSelectionEnabled: true }
      if (namespace === 'session' && method === 'create') {
        const sessionId = `new-${++nextId}`
        const agentPreset = args.request.agentPreset ?? 'standard'
        states.set(sessionId, { agentPreset, sessionListMetadata: { blank: true, lastPromptAt: null } })
        return { sessionId, agentPreset }
      }
      if (namespace === 'agentPresets' && method === 'select') {
        assert.deepEqual(Object.keys(args).sort(), ['agentId', 'agentPreset'])
        await beforeSelect()
        if (!presets.some(p => p.id === args.agentPreset)) throw Object.assign(new Error('missing preset'), { code: 'agent-preset/not-found' })
        if (args.agentPreset === 'broken') throw Object.assign(new Error('missing plugin'), { code: 'agent-preset/invalid' })
        states.get(args.agentId).agentPreset = args.agentPreset
        return args.agentPreset
      }
      if (namespace === 'session' && method === 'prompt') {
        await beforePrompt()
        return { accepted: true }
      }
      throw new Error(`unexpected ${namespace}/${method}`)
    },
    async stream(call) {
      assert.equal(call.namespace, 'session')
      assert.equal(call.method, 'follow')
      assert.equal(call.args.request.maxMessages, 1)
      const sessionId = call.args.request.address.sessionId
      if (!states.has(sessionId)) throw Object.assign(new Error('missing session'), { code: 'session/not-found' })
      return (async function* () {
        yield { type: 'snapshot', header: { id: sessionId, version: 3 }, cursor: 4, records: [], hasMore: true,
          projections: { asOfSeq: 4, values: structuredClone(states.get(sessionId)) } }
      })()
    },
  })
  return { api, states, calls, presets, setBeforeSelect: fn => { beforeSelect = fn }, setBeforePrompt: fn => { beforePrompt = fn } }
}

const f = fixture()
const query = msg => handleQuery(f.api, f.api, null, msg)
const created = await query({ type: 'session-create', requestId: 'create-1', workspaceId: 'w1', agentPreset: ' minimal ' })
assert.equal(created.agentPreset, 'minimal')
const sessionId = created.sessionId
assert.deepEqual(f.calls[0].args.request, { workspaceId: 'w1', agentPreset: 'minimal' })
assert.deepEqual((await query({ type: 'agent-presets' })).presets, f.presets)
assert.deepEqual(await query({ type: 'session-agent-preset', sessionId, requestId: 'get-1' }), {
  kind: 'session-agent-preset', sessionId, agentPreset: 'minimal', locked: false, requestId: 'get-1',
})
for (const agentPreset of ['standard', 'minimal']) {
  assert.deepEqual(await query({ type: 'select-agent-preset', sessionId, agentPreset, requestId: agentPreset }), {
    kind: 'select-agent-preset', sessionId, agentPreset, requestId: agentPreset,
  })
}
for (const [agentPreset, code] of [['unknown', 'agent-preset/not-found'], ['broken', 'agent-preset/invalid']]) {
  const result = await query({ type: 'select-agent-preset', sessionId, agentPreset, requestId: 'failure' })
  assert.equal(result.code, code)
  assert.equal(result.requestType, 'select-agent-preset')
  assert.equal(result.requestId, 'failure')
  assert.equal(f.states.get(sessionId).agentPreset, 'minimal')
}
for (const agentPreset of ['', ' ', null, {}, 1]) {
  const before = f.calls.length
  assert.equal((await query({ type: 'select-agent-preset', sessionId, agentPreset })).code, 'bad-request')
  assert.equal((await query({ type: 'session-create', requestId: 'invalid', agentPreset })).code, 'bad-request')
  assert.equal(f.calls.length, before)
}
assert.equal((await query({ type: 'select-agent-preset', agentPreset: 'minimal' })).code, 'bad-request')
assert.equal((await query({ type: 'session-agent-preset', sessionId: 'missing' })).code, 'session/not-found')

// A pending selection must finish before a prompt from the other socket is admitted.
const entered = Promise.withResolvers()
const release = Promise.withResolvers()
f.setBeforeSelect(async () => { entered.resolve(); await release.promise })
const selection = query({ type: 'select-agent-preset', sessionId, agentPreset: 'standard' })
await entered.promise
const prompt = admitMessage(f.api, { type: 'message', sessionId, text: '开始对话' })
await new Promise(resolve => setImmediate(resolve))
assert.equal(f.calls.some(c => c.method === 'prompt'), false)
release.resolve()
await selection
assert.equal((await prompt).kind, 'sent')
assert.equal((await query({ type: 'session-agent-preset', sessionId })).locked, true)
const selectCalls = () => f.calls.filter(c => c.namespace === 'agentPresets' && c.method === 'select').length
const beforeLocked = selectCalls()
assert.equal((await query({ type: 'select-agent-preset', sessionId, agentPreset: 'minimal' })).code, 'agent-preset/locked')
assert.equal(selectCalls(), beforeLocked, 'accepted prompt locks even before the Host emits turn/start')

// Persisted facts enforce the same rule after restart, with no in-memory marker.
const restarted = fixture()
restarted.states.set('started', { agentPreset: 'standard', sessionListMetadata: { blank: false, lastPromptAt: 100 } })
await assert.rejects(restarted.api.agentPresets.select({ sessionId: 'started', agentPreset: 'minimal' }), { code: 'agent-preset/locked' })
assert.equal(restarted.calls.length, 0)
restarted.states.set('queued', { agentPreset: 'standard', sessionListMetadata: { blank: true, lastPromptAt: 100 } })
assert.equal((await restarted.api.agentPresets.session({ sessionId: 'queued' })).locked, true)
restarted.states.set('unknown-state', { agentPreset: 'standard' })
await assert.rejects(restarted.api.agentPresets.session({ sessionId: 'unknown-state' }), { code: 'agent-preset/unavailable' })

// Failed admission is retryable; first-message creation forwards the requested preset.
const fresh = fixture()
fresh.setBeforePrompt(async () => { throw new Error('admission failed') })
const failure = await admitMessage(fresh.api, { type: 'message', text: 'hello', agentPreset: 'minimal' })
assert.equal(failure.kind, 'error')
assert.equal((await fresh.api.agentPresets.session({ sessionId: failure.sessionId })).locked, false)
fresh.setBeforePrompt(async () => {})
assert.equal((await fresh.api.agentPresets.select({ sessionId: failure.sessionId, agentPreset: 'standard' })).agentPreset, 'standard')
assert.equal((await admitMessage(fresh.api, { type: 'message', sessionId: failure.sessionId, agentPreset: 'minimal', text: 'hello' })).code, 'bad-request')
assert.equal(fresh.calls[0].args.request.agentPreset, 'minimal')

// In the opposite arrival order, a switch waits for admission and is refused.
const reverse = fixture()
const reverseSession = await reverse.api.sessions.create({})
const promptEntered = Promise.withResolvers()
const promptRelease = Promise.withResolvers()
reverse.setBeforePrompt(async () => { promptEntered.resolve(); await promptRelease.promise })
const pendingPrompt = reverse.api.sessions.prompt({ sessionId: reverseSession.sessionId, mode: 'queue', content: [{ type: 'text', text: 'hello' }] })
await promptEntered.promise
const pendingSelection = reverse.api.agentPresets.select({ sessionId: reverseSession.sessionId, agentPreset: 'minimal' })
const refused = assert.rejects(pendingSelection, { code: 'agent-preset/locked' })
promptRelease.resolve()
await pendingPrompt
await refused
assert.equal(reverse.calls.some(c => c.namespace === 'agentPresets' && c.method === 'select'), false)

console.log('SESSION PRESET TESTS PASSED: selection, persistence, validation, locking and cross-channel admission order')
