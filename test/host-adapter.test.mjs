import { createTestPeer } from './helpers/peer.mjs'
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

const peer = createTestPeer()
const calls = []
const turnOutline = [{ turn: 1, seq: 1, prompt: '调整输入框阴影', response: '已减轻阴影。' }]
const gateway = {
  async invoke(call) {
    assert.equal(call.peer, peer)
    assert.equal(call.peer.signal.aborted, false)
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
    if (call.namespace === 'schedule' && (call.method === 'catalog' || call.method === 'list')) return []
    if (call.namespace === 'schedule') return { id: 'task-1', deleted: true }
    return { accepted: true }
  },
  async stream(call) {
    assert.equal(call.peer, peer)
    assert.equal(call.peer.signal.aborted, false)
    calls.push(call)
    if (call.namespace === 'speech' || call.method === 'control') return (async function* () {})()
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
          projections: { asOfSeq: 9, values: { turnOutline,
            modelSelection: { lastUsed: null, next: { provider: 'deepseek', model: 'chat' } } } },
        }
      })()
    }
    throw new Error(`unexpected stream ${call.namespace}/${call.method}`)
  },
}

const host = createDshHostAdapter(gateway, peer)
assert.throws(() => createDshHostAdapter(gateway), /requires a DSH Connection Peer/)

// 官方流式路由走 Connection 注册表与固定 Peer，不发送真实 HTTP 请求。
{
  let available = true
  let rejection
  const uploadHost = createDshHostAdapter(gateway, peer, {
    createSharedFetchHandler(channel) {
      assert.equal(channel, '/api')
      return {
        requestBodyMode: ({ method, url }) => {
          assert.equal(method, 'POST')
          assert.equal(url.pathname, '/api/session/uploadFileBinary')
          return available ? 'streaming' : 'buffered'
        },
        async fetch(request, receiver) {
          assert.equal(receiver, peer)
          const url = new URL(request.url)
          assert.equal(url.searchParams.get('sessionId'), 's1')
          assert.equal(url.searchParams.get('name'), '报告 #1.pdf')
          assert.equal(request.headers.get('content-type'), 'application/octet-stream')
          assert.deepEqual(Buffer.from(await request.arrayBuffer()), Buffer.from([0, 255, 13]))
          return Response.json(rejection ? { ok: false, error: rejection }
            : { ok: true, value: { receiptId: 'receipt-1', file: { attachmentId: 'opaque', name: '报告 #1.pdf', bytes: 3 } } })
        },
      }
    },
  })
  const request = () => ({ sessionId: 's1', name: '报告 #1.pdf', data: (async function* () { yield Buffer.from([0, 255]); yield Buffer.from([13]) })() })
  assert.equal(uploadHost.files.available(), true)
  assert.equal((await uploadHost.files.upload(request())).receiptId, 'receipt-1')
  rejection = { code: 'session/attachment-invalid', message: 'unsupported provider' }
  await assert.rejects(() => uploadHost.files.upload(request()), { code: 'session/attachment-invalid' })
  const cancelled = new AbortController()
  cancelled.abort(Object.assign(new Error('cancelled'), { code: 'file-upload-cancelled' }))
  await assert.rejects(() => uploadHost.files.upload(request(), cancelled.signal), { code: 'file-upload-cancelled' })
  available = false
  assert.equal(uploadHost.files.available(), false)
  await assert.rejects(() => uploadHost.files.upload(request()), { code: 'file-upload-unavailable' })
  assert.equal(host.files.available(), false)
}

// 官方实验性语音 Remote 使用各自的真实参数名，并传递取消信号。
{
  const signal = new AbortController().signal
  const request = { audioBase64: 'AA==', providerId: 'sensevoice-local', language: 'zh' }
  await host.speech.catalog(signal)
  await host.speech.transcribe(request, signal)
  await host.speech.prepare('sensevoice-local', { downloadSource: 'https://hf-mirror.com' }, signal)
  await host.speech.configure({ language: 'zh' }, signal)
  await host.speech.cancelPreparation('sensevoice-local', signal)
  assert.deepEqual(calls.filter(call => call.namespace === 'speech'), [
    { peer, namespace: 'speech', method: 'catalog', args: {}, signal },
    { peer, namespace: 'speech', method: 'transcribe', args: { request }, signal },
    { peer, namespace: 'speech', method: 'prepare', args: { providerId: 'sensevoice-local', options: { downloadSource: 'https://hf-mirror.com' } }, signal },
    { peer, namespace: 'speech', method: 'configure', args: { patch: { language: 'zh' } }, signal },
    { peer, namespace: 'speech', method: 'cancelPreparation', args: { providerId: 'sensevoice-local' }, signal },
  ])
}

await host.sessions.list()
const sessionListCall = calls.find((call) => call.namespace === 'session' && call.method === 'list')
assert.deepEqual(sessionListCall.args, { _request: {} })

const history = await host.sessions.history({ sessionId: 's1' })
assert.equal(history.events.length, 1)
assert.equal(history.events[0].event.seq, 5)
assert.equal(history.historyFormatVersion, 4)
assert.equal(history.cursor, 9)
assert.equal(history.projections.asOfSeq, 9)
assert.deepEqual(history.projections.values.turnOutline, turnOutline)

const older = await host.sessions.history({ sessionId: 's1', beforeSeq: 5, maxMessages: 20 })
assert.equal(older.events[0].event.type, 'user/message')
assert.deepEqual(older.projections.values.turnOutline, turnOutline)
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

// 工作区重命名/删除映射到官方 workspace/rename 与 workspace/delete Remote 方法。
assert.deepEqual(await host.workspace.rename({ workspaceId: 'w1', title: 'x' }), { accepted: true })
const workspaceRenameCall = calls.find((call) => call.namespace === 'workspace' && call.method === 'rename')
assert.deepEqual(workspaceRenameCall.args, { request: { workspaceId: 'w1', title: 'x' } })
assert.equal(workspaceRenameCall.peer, peer)

assert.deepEqual(await host.workspace.remove({ workspaceId: 'w1' }), { accepted: true })
const workspaceDeleteCall = calls.find((call) => call.namespace === 'workspace' && call.method === 'delete')
assert.deepEqual(workspaceDeleteCall.args, { request: { workspaceId: 'w1' } })
assert.equal(workspaceDeleteCall.peer, peer)

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

assert.deepEqual(await host.schedule.catalog(), { items: [] })
assert.deepEqual(await host.schedule.list({ sessionId: 's1' }), { items: [] })
assert.deepEqual(await host.schedule.delete({ sessionId: 's1', id: 'task-1' }), { id: 'task-1', deleted: true })
assert.deepEqual(calls.find((call) => call.namespace === 'schedule' && call.method === 'catalog').args, {})
assert.deepEqual(calls.find((call) => call.namespace === 'schedule' && call.method === 'list').args, { request: { sessionId: 's1' } })
assert.deepEqual(calls.find((call) => call.namespace === 'schedule' && call.method === 'delete').args, { request: { sessionId: 's1', id: 'task-1' } })

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
assert.deepEqual(calls.at(-1), { peer, namespace: 'session', method: 'follow',
  args: { request: { address: { kind: 'session', sessionId: 's1' }, maxMessages: 12, assistantStream: true } }, signal: followAbort.signal })
followAbort.abort()
await host.openControlStream(new AbortController().signal)
await host.speech.follow(new AbortController().signal)
const badHost = createDshHostAdapter({ invoke: async () => ({}), stream: async () => (async function* () {
  yield { type: 'snapshot', header: { id: 's1', version: 2 }, cursor: 0, records: [], projections: {} }
})() }, peer)
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
  }, peer)
  await snapshotHost.sessions.history({ sessionId: 's1' }, caller.signal)
  assert.equal(returned, true)
  assert.equal(caller.signal.aborted, false)
}
