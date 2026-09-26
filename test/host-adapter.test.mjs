import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createDshHostAdapter, readHistoryRecords } from '../lib/dsh-host-adapter.mjs'

const gatewaySource = fs.readFileSync(new URL('../lib/index.mjs', import.meta.url), 'utf8')
assert.doesNotMatch(gatewaySource, /apiProxy|api\.events\.mux|api\.respond\s*\(/)
assert.doesNotMatch(gatewaySource, /typertGateway\.invoke|typertGateway\.stream/)

const packed = {
  type: 'event',
  event: {
    type: 'assistant/message', seq: 5, time: 107,
    data: { turn: 2, step: 1, message: { content: [{ type: 'text', text: '你好' }] },
      stream: [{ type: 'text-chunks', time0: 100, index: 0, texts: ['你', '好'], dt: [7] }] },
  },
}
assert.deepEqual(readHistoryRecords([packed]), [packed.event])
assert.throws(() => readHistoryRecords([{ type: 'chunks', event: packed.event }]), /requires event records/)

const calls = []
const gateway = {
  async invoke(call) {
    calls.push(call)
    if (call.namespace === 'session' && call.method === 'page') {
      return { records: [{ type: 'event', event: { type: 'user/message', seq: 1, time: 1, data: {} } }], hasMore: false }
    }
    if (call.namespace === 'session' && call.method === 'modelCatalog') {
      return {
        default: { provider: 'deepseek', model: 'chat' },
        routableProviders: ['deepseek'],
        groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'chat', name: 'Chat' }] }],
        failures: [],
      }
    }
    if (call.namespace === 'session' && call.method === 'list') return { items: [{ sessionId: 's1' }] }
    if (call.namespace === 'session' && call.method === 'canOpenWorkspacePath') return true
    if (call.namespace === 'permissionPresets' && call.method === 'catalog') return {
      options: [{ value: 'ask', name: 'Ask' }], defaultOptions: [{ value: 'ask', name: 'Ask' }], defaultPreset: 'ask',
    }
    if (call.namespace === 'llm' && call.method === 'listConfigurableProviders') return [{ provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'deepseek', settingsPath: [] }]
    if (call.namespace === 'goals' && call.method === 'edit') return { id: 'goal-1', revision: 2 }
    if (call.namespace === 'goals' && call.method === 'clear') return { id: 'goal-1', revision: 3 }
    if (call.namespace === 'commands' && call.method === 'list') return []
    return { accepted: true }
  },
  async stream(call) {
    calls.push(call)
    if (call.namespace === 'workspace') {
      return (async function* () {
        yield { type: 'baseline', value: { items: [{ workspaceId: 'w1' }], archivedSessionIds: [] } }
      })()
    }
    if (call.namespace === 'session' && call.method === 'follow') {
      return (async function* () {
        yield {
          type: 'snapshot',
          header: { version: 4, id: 's1' },
          cursor: 9,
          records: [packed],
          hasMore: true,
          projections: { asOfSeq: 9, values: { modelSelection: { lastUsed: null, next: { provider: 'deepseek', model: 'chat' } } } },
        }
      })()
    }
    throw new Error(`unexpected stream ${call.namespace}/${call.method}`)
  },
}

const host = createDshHostAdapter(gateway)

await host.sessions.list()
const sessionListCall = calls.find((call) => call.namespace === 'session' && call.method === 'list')
assert.deepEqual(sessionListCall.args, { _request: {} })

const history = await host.sessions.history({ sessionId: 's1' })
assert.equal(history.events.length, 1)
assert.equal(history.events[0].event.seq, 5)
assert.equal(history.historyFormatVersion, 4)
assert.equal(history.cursor, 9)
assert.equal(history.projections.asOfSeq, 9)

const older = await host.sessions.history({ sessionId: 's1', beforeSeq: 5, maxMessages: 20 })
assert.equal(older.events[0].event.type, 'user/message')
assert.equal(calls.filter(call => call.namespace === 'session' && call.method === 'follow').at(-1).args.request.maxMessages, 1)
const pageCall = calls.find((call) => call.namespace === 'session' && call.method === 'page')
assert.deepEqual(pageCall.args, {
  request: {
    address: { kind: 'session', sessionId: 's1' },
    throughSeq: 9,
    beforeSeq: 5,
    maxMessages: 20,
  },
})

await host.sessions.prompt({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] })
const promptCall = calls.find((call) => call.namespace === 'session' && call.method === 'prompt')
assert.equal(typeof promptCall.args.request.requestId, 'string')
assert.equal(promptCall.args.request.sessionId, 's1')

assert.deepEqual(await host.sessions.cancel({ sessionId: 's1' }), { accepted: true })
const cancelCall = calls.find((call) => call.namespace === 'session' && call.method === 'cancel')
assert.deepEqual(cancelCall.args, { request: { sessionId: 's1' } })

assert.deepEqual(await host.sessions.updateQueue({
  sessionId: 's1',
  itemId: 'message-1',
  action: { kind: 'edit', content: [{ type: 'text', text: '修改后' }] },
}), { accepted: true })
const updateQueueCall = calls.find((call) => call.namespace === 'session' && call.method === 'updateQueue')
assert.deepEqual(updateQueueCall.args, {
  request: {
    sessionId: 's1',
    itemId: 'message-1',
    action: { kind: 'edit', content: [{ type: 'text', text: '修改后' }] },
  },
})

assert.deepEqual(await host.sessions.rename({ sessionId: 's1', title: '新名称' }), { accepted: true })
const renameCall = calls.find((call) => call.namespace === 'session' && call.method === 'rename')
assert.deepEqual(renameCall.args, { request: { sessionId: 's1', title: '新名称' } })

assert.deepEqual(await host.workspace.archiveSession({ sessionId: 's1' }), { accepted: true })
const archiveCall = calls.find((call) => call.namespace === 'workspace' && call.method === 'archiveSession')
assert.deepEqual(archiveCall.args, { request: { sessionId: 's1' } })

const workspaceStreamAbort = new AbortController()
const workspaceStream = await host.openWorkspaceStream(workspaceStreamAbort.signal)
const workspaceOpening = await workspaceStream[Symbol.asyncIterator]().next()
assert.equal(workspaceOpening.value.type, 'baseline')
assert.ok(calls.some((call) => call.namespace === 'workspace' && call.method === 'follow' && call.signal === workspaceStreamAbort.signal))
workspaceStreamAbort.abort()

await host.settings.update({ ns: 'permission', patch: { defaultPreset: 'ask' } })
const settingsCall = calls.find((call) => call.namespace === 'settings' && call.method === 'update')
assert.deepEqual(settingsCall.args, { ns: 'permission', patch: { defaultPreset: 'ask' } })
assert.equal((await host.permissionPresets.catalog()).defaultPreset, 'ask')
assert.deepEqual(calls.find((call) => call.namespace === 'permissionPresets').args, {})

assert.deepEqual(
  await host.goals.edit({ sessionId: 's1', ref: { id: 'goal-1', revision: 1 }, objective: '完成重构' }),
  { ref: { id: 'goal-1', revision: 2 } },
)
const goalCall = calls.find((call) => call.namespace === 'goals' && call.method === 'edit')
assert.deepEqual(goalCall.args, {
  agentId: 's1',
  ref: { id: 'goal-1', revision: 1 },
  request: { objective: '完成重构' },
})

assert.deepEqual(await host.workspace.list(), { items: [{ workspaceId: 'w1' }], archivedSessionIds: [] })
assert.deepEqual(await host.llm.providers(), {
  providers: [{ provider: 'deepseek', displayName: 'DeepSeek', settingsNs: 'deepseek', settingsPath: [] }],
})

const sessionModels = await host.sessions.models({ sessionId: 's1' })
assert.deepEqual(sessionModels.current, { provider: 'deepseek', model: 'chat' })
assert.equal(sessionModels.routable, true)

await host.commands.execute('s1', '/plan-toggle', [{ type: 'image', mediaType: 'image/png', data: 'AA==' }])
const commandExecuteCall = calls.find((call) => call.namespace === 'commands' && call.method === 'execute')
assert.deepEqual(commandExecuteCall.args, {
  agentId: 's1',
  line: '/plan-toggle',
  submittedAttachments: [{ type: 'image', mediaType: 'image/png', data: 'AA==' }],
})

console.log('DSH HOST ADAPTER TESTS PASSED')

const followAbort = new AbortController()
await host.openSessionStream('s1', followAbort.signal)
assert.deepEqual(calls.at(-1), { namespace: 'session', method: 'follow',
  args: { request: { address: { kind: 'session', sessionId: 's1' }, maxMessages: 12, assistantStream: true } }, signal: followAbort.signal })
followAbort.abort()
const badHost = createDshHostAdapter({ invoke: async () => ({}), stream: async () => (async function* () {
  yield { type: 'snapshot', header: { id: 's1', version: 2 }, cursor: 0, records: [], projections: {} }
})() })
await assert.rejects(() => badHost.sessions.history({ sessionId: 's1' }), { code: 'unsupported-session-format' })

// Reading a snapshot must release its follow even with a caller-owned signal.
{
  const caller = new AbortController()
  let returned = false
  const snapshotHost = createDshHostAdapter({
    invoke: async () => ({}),
    stream: async call => ({
      [Symbol.asyncIterator]() { return this },
      async next() { return { done: false, value: { type: 'snapshot', header: { id: 's1', version: 4 },
        cursor: -1, records: [], projections: { asOfSeq: -1, values: {} } } } },
      async return() {
        assert.equal(call.signal.aborted, true)
        returned = true
        return { done: true }
      },
    }),
  })
  await snapshotHost.sessions.history({ sessionId: 's1' }, caller.signal)
  assert.equal(returned, true)
  assert.equal(caller.signal.aborted, false)
}
