import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const plugin = (await import('../lib/index.mjs')).default
const { handleQuery } = await import('../lib/index.mjs')
const assert = await import('node:assert/strict')
{
  const calls = []
  const api = { sessions: {
    create: async (payload) => { calls.push(payload); return { sessionId: 'empty-1' } },
    prompt: () => { throw new Error('Empty creation must never start an agent turn') },
  } }
  const created = await handleQuery(api, null, null, { type: 'session-create', requestId: 'r1', workspaceId: ' w1 ', cwd: '/ignored' })
  assert.deepEqual(created, { kind: 'session-created', sessionId: 'empty-1', requestId: 'r1' })
  assert.deepEqual(calls, [{ workspaceId: 'w1' }])
  api.sessions.create = async () => { throw new Error('creation failed') }
  const failed = await handleQuery(api, null, null, { type: 'session-create', requestId: 'r2' })
  assert.equal(failed.kind, 'error')
  assert.equal(failed.requestType, 'session-create')
  assert.equal(failed.requestId, 'r2')
}

// Compact v3 history and reject stale/unversioned cursor coordinates before RPC.
{
  const stream = [{ type: 'text-chunks', time0: 1, index: 0, dt: [], texts: ['x'.repeat(100_000)] }]
  let historyCalls = 0
  let forkCalls = 0
  const api = { sessions: {
    history: async () => { historyCalls++; return { historyFormatVersion: 3, cursor: 5, hasMore: true,
      projections: { asOfSeq: 5, values: {} }, events: [
        { event: { type: 'system/message', seq: 1, time: 1, data: { message: { content: [{ type: 'text', text: 'private system prompt' }] } } } },
        { event: { type: 'assistant/message', seq: 2, time: 2, data: { turn: 1, step: 0, interrupted: true, usage: { outputTokens: 3 }, stream,
          message: { content: [{ type: 'text', text: 'answer' }] } } } },
        { event: { type: 'assistant/attempt', seq: 3, time: 3, data: { turn: 1, step: 1, stream } } },
      ] } },
    fork: async () => { forkCalls++; return { sessionId: 'branch' } },
  } }
  const page = await handleQuery(api, null, null, { type: 'history', sessionId: 's1', view: 'conversation' })
  assert.deepEqual(page.events.map(event => event.type), ['assistant/message', 'assistant/attempt'])
  assert.ok(page.events.every(event => !('stream' in event.data)))
  assert.ok(page.bytes < 1000)
  assert.equal(page.events[0].data.interrupted, true)
  assert.equal(page.historyFormatVersion, 3)
  assert.equal(page.cursor, 5)
  assert.equal(page.nextBeforeSeq, 2)
  const raw = await handleQuery(api, null, null, { type: 'history', sessionId: 's1' })
  assert.equal(raw.events[2].data.stream[0].texts[0].length, 100_000)
  for (const historyFormatVersion of [undefined, 1, 2]) {
    const error = await handleQuery(api, null, null, { type: 'history', sessionId: 's1', beforeSeq: 2, historyFormatVersion })
    assert.equal(error.code, 'history-format-mismatch')
    assert.equal(error.resetRequired, true)
    const forkError = await handleQuery(api, null, null, { type: 'fork', sessionId: 's1', atSeq: 2, historyFormatVersion })
    assert.equal(forkError.code, 'history-format-mismatch')
  }
  assert.equal(historyCalls, 2)
  assert.equal(forkCalls, 0)
  await handleQuery(api, null, null, { type: 'history', sessionId: 's1', beforeSeq: 2, historyFormatVersion: 3 })
  await handleQuery(api, null, null, { type: 'fork', sessionId: 's1', atSeq: 2, historyFormatVersion: 3 })
  assert.equal(historyCalls, 3)
  assert.equal(forkCalls, 1)
  assert.equal((await handleQuery(api, null, null, { type: 'fork', sessionId: 's1', atSeq: 2.5, historyFormatVersion: 3 })).code, 'bad-request')
  api.sessions.history = async () => ({ hasMore: true, events: [{ event: { type: 'system/message', seq: 10, data: {} } }] })
  const hidden = await handleQuery(api, null, null, { type: 'history', sessionId: 's1', view: 'conversation' })
  assert.deepEqual(hidden.events, [])
  assert.equal(hidden.nextBeforeSeq, 10)
}

const directoryTestRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-directory-'))
const fileDownloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-mobile-files-'))
const fileDownloadDir = path.join(fileDownloadRoot, 'builds')
const fileDownloadBytes = Buffer.alloc(150 * 1024, 0x5a)
const outsideFile = path.join(os.tmpdir(), `dsh-mobile-outside-${process.pid}.bin`)
fs.mkdirSync(fileDownloadDir)
fs.writeFileSync(path.join(fileDownloadDir, 'app-release.apk'), fileDownloadBytes)
fs.writeFileSync(path.join(fileDownloadRoot, 'guide.pdf'), Buffer.from('%PDF-1.7\nmobile gateway\n'))
fs.writeFileSync(outsideFile, Buffer.from('outside workspace'))
fs.symlinkSync(outsideFile, path.join(fileDownloadRoot, 'outside-link.bin'))

const listeners = {}
const presetSession = { agentPreset: 'standard', sessionListMetadata: { blank: true, lastPromptAt: null } }
let disposer = null
const server = http.createServer((req, res) => { res.writeHead(404); res.end() })
const webServer = {
  port: 18086,
  register() { return () => {} },
  registerUpgrade(route) { server.on('upgrade', (req, socket, head) => route.handler(req, socket, head)); return () => {} },
}
function fakeApi() {
  const promptCalls = []
  const createCalls = []
  const cancelCalls = []
  const queueUpdateCalls = []
  const archiveCalls = []
  const renameCalls = []
  const settingsUpdates = []
  const goalCalls = []
  const imageAttachment = {
    attachmentId: 'att-image-1',
    mediaType: 'image/png',
    bytes: 8,
    width: 2,
    height: 2,
    name: 'sample.png',
  }
  const recordGoalCall = (method) => async (request) => {
    goalCalls.push({ method, payload: request.payload })
    const value = method === 'clear'
      ? { cleared: true }
      : { ref: { id: request.payload.ref.id, revision: request.payload.ref.revision + 1 } }
    return { rpcId: 'r', result: { ok: true, value } }
  }
  return {
    promptCalls,
    cancelCalls,
    queueUpdateCalls,
    archiveCalls,
    renameCalls,
    settingsUpdates,
    goalCalls,
    get _createCalls() { return createCalls },
    skills: {
      async list() {
        return {
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              skills: [
                { name: 'android-cli', description: 'Install and use the Android CLI', whenToUse: 'Use for Android device automation', modelInvocable: true },
                { name: 'design-taste-frontend', description: 'Improve frontend visual design', modelInvocable: false },
              ],
            },
          },
        }
      },
    },
    llm: {
      async models() { return { rpcId: 'r', result: { ok: true, value: { groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'Low' }] } }] }], failures: [] } } } },
      async providers() { return { rpcId: 'r', result: { ok: true, value: { providers: [{ provider: 'deepseek', displayName: 'DeepSeek', declared: true }] } } } },
    },
    agentPresets: {
      async list() { return { rpcId: 'r', result: { ok: true, value: { presets: [{ id: 'standard', trust: 'system', isDefault: true }, { id: 'minimal', trust: 'system', isDefault: false }], authorable: true, hasDocument: false } } } },
    },
    workspace: {
      async list() { return { rpcId: 'r', result: { ok: true, value: { items: [], archivedSessionIds: [] } } } },
      async create() { return { rpcId: 'r', result: { ok: true, value: { workspace: { workspaceId: 'w', path: '/tmp', title: 't', sessionIds: [], createdAt: 'c', updatedAt: 'u' }, created: true } } } },
      async archiveSession(req) {
        archiveCalls.push(req.payload)
        return { rpcId: 'r', result: { ok: true, value: { archivedSessionIds: [req.payload.sessionId] } } }
      },
    },
    settings: {
      async describe() { return { rpcId: 'r', result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [
        { ns: 'agent-presets', schema: { properties: {} }, value: { default: 'standard' }, revision: 1 },
        { ns: 'permission', schema: { properties: {} }, value: { defaultPreset: 'ask' }, revision: 1 },
      ] } } } },
      async update(req) { settingsUpdates.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { ns: req.payload.ns, value: req.payload.patch, revision: 2 } } } },
    },
    goals: {
      edit: recordGoalCall('edit'),
      pause: recordGoalCall('pause'),
      resume: recordGoalCall('resume'),
      clear: recordGoalCall('clear'),
    },
    sessions: {
      async list() {
        return {
          rpcId: 'r',
          result: {
            ok: true,
            value: {
              items: [
                { sessionId: 's1', cwd: fileDownloadRoot, updatedAt: 1, running: false, blank: false, projections: { values: { turnOutline: [{ response: '鼓掌 ' + String.fromCharCode(0xd83d) + '…', prompt: '👏' }] } } },
                { sessionId: 's2', cwd: fileDownloadRoot, updatedAt: 2, running: false, blank: false },
              ],
            },
          },
        }
      },
      async history() {
        const fakeEvents = [
          { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'image', attachment: imageAttachment }, { type: 'text', text: 'hi' }] } },
          { type: 'assistant/chunk', seq: 2, time: 2, data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'a' } } },
          { type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'hello' }] } } },
          { type: 'tool/call', seq: 4, time: 4, data: { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{}' } },
          { type: 'tool/result', seq: 5, time: 5, data: { turn: 1, step: 0, message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(5000) }] }] } } },
          { type: 'request/header', seq: 6, time: 6, data: { header: { system: 'sys'.repeat(2000) }, reason: 'initial' } },
          { type: 'assistant/message', seq: 7, time: 7, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'done' }] } } },
        ]
        return { rpcId: 'r', result: { ok: true, value: { events: fakeEvents.map((e) => ({ event: e })), hasMore: false, projections: { asOfSeq: 42, values: { tokenUsage: { totals: { inputTokens: 10, outputTokens: 5 }, last: null }, contextPressure: { contextWindow: 128000, pressureTokens: 1500, surfaceTokens: 2000 }, permissions: { options: [{ value: 'ask', name: 'Ask', description: 'Ask before risky operations' }, { value: 'workspace-write', name: 'Workspace Write' }], currentValue: 'ask' }, sessionStats: { turns: 6, steps: 69, llmMs: 2280000, toolMs: 41400, ttftMs: 2600, ttftSteps: 1, decodeMs: 5000, decodeTokens: 385, lastTurn: 6, openStep: null, pendingCalls: {} }, todos: [{ content: 'Inspect Android CLI/SDK environment', status: 'completed' }, { content: 'Get android CLI running', status: 'in_progress' }, { content: 'Choose project template', status: 'pending' }], goal: { goal: { id: 'goal-1', revision: 7, objective: '初始化一个 Android app', phase: 'active', maxGoalRounds: 12 }, roundsStarted: 3, createdAt: 1, updatedAt: 2 } } } } } }
      },
      async search() { return { rpcId: 'r', result: { ok: true, value: { items: [], hasMore: false } } } },
      async attachment(req) {
        return {
          rpcId: 'r',
          result: {
            ok: true,
            value: { attachment: { ...imageAttachment, attachmentId: req.payload.attachmentId }, data: 'iVBORw0KGgo=' },
          },
        }
      },
      async models() { return { rpcId: 'r', result: { ok: true, value: { current: { provider: 'deepseek', model: 'deepseek-chat' }, routable: true, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }], failures: [] } } } },
      async selectModel(req) { return { rpcId: 'r', result: { ok: true, value: { selected: req.payload } } } },
      async prompt(req) { promptCalls.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { accepted: true, command: { kind: 'success', text: 'switched to ' + (req.payload.content[0].text) } } } } },
      async create(req) { createCalls.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { sessionId: 's-new-' + createCalls.length } } } },
      async fork(req) { return { rpcId: 'r', result: { ok: true, value: { sessionId: 's-branch-1' } } } },
      async cancel(req) { cancelCalls.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { accepted: true } } } },
      async updateQueue(req) { queueUpdateCalls.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { accepted: true } } } },
      async rename(req) {
        renameCalls.push(req.payload)
        return { rpcId: 'r', result: { ok: true, value: { title: req.payload.title.trim(), seq: 95 } } }
      },
    },
  }
}
const api = fakeApi()
const ctx = {
  get(name) { return name === 'webServer' ? webServer : undefined },
  on(name, fn) { listeners[name] = fn; return () => {} },
  effect(fn) { disposer = fn() },
}
ctx.webServer = webServer
const invokeCalls = []
const controlFrames = []
const workspaceFrames = []
const liveFollows = new Map()
const savedSelections = []
ctx.agentDefaultModel = {
  currentSelection() { return { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } },
  async saveSelection(sel) { savedSelections.push(sel) },
}
ctx.typertGateway = {
  async invoke(req) {
    invokeCalls.push(req)
    if (req.namespace === 'agentPresets' && req.method === 'select') {
      assert.equal(req.args.agentId, 'preset-session')
      presetSession.agentPreset = req.args.agentPreset
      listeners['session/event']({ id: 'preset-session' }, {
        type: 'agent-preset/selected', seq: 9500, time: 100, data: { agentPreset: req.args.agentPreset },
      })
      return req.args.agentPreset
    }
    if (req.namespace === 'commands' && req.method === 'list') {
      return [
        { name: 'compact', description: 'Compact older conversation history' },
        { name: 'permission', description: 'Switch the permission preset', input: { hint: '<preset>' } },
        { name: 'plan', description: 'Enter or leave plan mode', input: { hint: '[off|message]', attachments: true } },
      ]
    }
    if (req.namespace === 'commands' && req.args && req.args.line === '/permission missing') {
      throw { code: 'unknown-command', message: 'no such command' }
    }
    if (req.namespace === 'commands' && req.args && req.args.line === '/plan fail') {
      return { commandId: 'cmd-error', result: { kind: 'error', text: 'plan failed' } }
    }
    if (req.namespace === 'commands') return { commandId: 'cmd-1', result: { kind: 'success', text: 'switched' } }
    const request = req.args.request || {}
    const unwrap = async (method, payload = request) => (await method({ payload })).result.value
    if (req.namespace === 'session') {
      if (req.method === 'list') return unwrap(api.sessions.list)
      if (req.method === 'search') return unwrap(api.sessions.search)
      if (req.method === 'create') return unwrap(api.sessions.create, request)
      if (req.method === 'prompt') {
        const { requestId: _requestId, ...payload } = request
        return unwrap(api.sessions.prompt, payload)
      }
      if (req.method === 'attachment') return unwrap(api.sessions.attachment)
      if (req.method === 'fork') return unwrap(api.sessions.fork)
      if (req.method === 'cancel') return unwrap(api.sessions.cancel)
      if (req.method === 'updateQueue') return unwrap(api.sessions.updateQueue)
      if (req.method === 'rename') return unwrap(api.sessions.rename)
      if (req.method === 'selectModel') return unwrap(api.sessions.selectModel)
      if (req.method === 'modelCatalog') {
        const catalog = await unwrap(api.sessions.models, {})
        return {
          default: ctx.agentDefaultModel.currentSelection(),
          routableProviders: catalog.groups.map((group) => group.id),
          groups: catalog.groups,
          failures: catalog.failures,
        }
      }
      if (req.method === 'canOpenWorkspacePath') return true
    }
    if (req.namespace === 'workspace' && req.method === 'create') return unwrap(api.workspace.create)
    if (req.namespace === 'workspace' && req.method === 'archiveSession') return unwrap(api.workspace.archiveSession)
    if (req.namespace === 'settings' && req.method === 'describe') return unwrap(api.settings.describe, {})
    if (req.namespace === 'settings' && req.method === 'update') {
      return unwrap(api.settings.update, { ns: req.args.ns, patch: req.args.patch })
    }
    if (req.namespace === 'skills' && req.method === 'list') return unwrap(api.skills.list)
    if (req.namespace === 'agentPresets' && req.method === 'list') return unwrap(api.agentPresets.list, {})
    if (req.namespace === 'llm' && req.method === 'listConfigurableProviders') {
      return (await unwrap(api.llm.providers, {})).providers
    }
    if (req.namespace === 'goals') {
      const payload = { sessionId: req.args.agentId, ref: req.args.ref, ...(req.args.request || {}) }
      const value = await unwrap(api.goals[req.method], payload)
      return req.method === 'clear'
        ? { id: req.args.ref.id, revision: req.args.ref.revision + 1 }
        : { id: value.ref.id, revision: value.ref.revision }
    }
    throw new Error(`unexpected Remote call ${req.namespace}/${req.method}`)
  },
  async stream(req) {
    if (req.namespace === 'session' && req.method === 'follow' && req.args.request.address.sessionId === 'preset-session') {
      return (async function* () {
        yield { type: 'snapshot', header: { version: 3, id: 'preset-session' }, cursor: 9500, records: [], hasMore: false,
          projections: { asOfSeq: 9500, values: structuredClone(presetSession) } }
      })()
    }
    if (req.namespace === 'workspace' && req.method === 'follow') {
      const value = (await api.workspace.list()).result.value
      return (async function* () {
        yield { type: 'baseline', value }
        while (!req.signal.aborted) {
          if (workspaceFrames.length > 0) yield workspaceFrames.shift()
          else await new Promise((resolve) => setTimeout(resolve, 5))
        }
      })()
    }
    if (req.namespace === 'session' && req.method === 'follow' && req.args.request.assistantStream === true) {
      const sessionId = req.args.request.address.sessionId
      const state = liveFollows.get(sessionId)
      assert.ok(state, 'test requires a live follow fixture')
      assert.equal(req.args.request.maxMessages, 12, 'live opening must bound history at the Host')
      state.signals.push(req.signal)
      return (async function* () {
        yield structuredClone(state.snapshot)
        while (!req.signal.aborted) {
          if (state.frames.length) yield state.frames.shift()
          else await new Promise(resolve => setTimeout(resolve, 5))
        }
      })()
    }
    if (req.namespace === 'session' && req.method === 'follow') {
      if (req.args.request.address.sessionId === 'broken-history') {
        assert.equal(req.args.request.maxMessages, 1)
        throw Object.assign(new Error('adapter refuses this format v0 Session: unexpected member origin'),
          { code: 'SESSION_QUERY_PERSISTENCE_FAILED' })
      }
      const value = (await api.sessions.history()).result.value
      const records = value.events.map((entry) => ({ type: 'event', event: entry.event }))
      return (async function* () {
        yield { type: 'snapshot', header: { version: 3, id: req.args.request.address.sessionId }, cursor: 91, records, hasMore: value.hasMore, projections: value.projections }
      })()
    }
    if (req.namespace === 'session' && req.method === 'control') {
      return (async function* () {
        yield {
          type: 'baseline',
          value: {
            queues: {
              s1: [{ id: 'message-1', placement: 'queued', rpcId: 'prompt-1', message: { id: 'message-1', content: [{ type: 'text', text: '原消息' }] } }],
            },
            jobs: {},
            projections: {},
          },
        }
        while (!req.signal.aborted) {
          if (controlFrames.length > 0) yield controlFrames.shift()
          else await new Promise((resolve) => setTimeout(resolve, 5))
        }
      })()
    }
    throw new Error(`unexpected Remote stream ${req.namespace}/${req.method}`)
  },
}
plugin.apply(ctx, {
  gatewayEnabled: true,
  requireAuth: false,
  deviceFile: '/tmp/dsh-mobile-gateway-dispatch-test-devices.json',
  fileDownloadChunkBytes: 64 * 1024,
})
server.listen(webServer.port)

const WebSocket = require('ws')
function waitFor(pred, timeout) { return new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { if (pred()) { clearInterval(iv); res(true) } else if (Date.now() - t0 > timeout) { clearInterval(iv); res(false) } }, 20) }) }

;(async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`)
  const got = []
  ws.on('message', (d) => got.push(JSON.parse(d.toString())))
  await new Promise((r) => ws.once('open', r))
  await waitFor(() => got.length > 0, 2000)

  const interactionResults = []
  listeners['session/event']({ id: 's1' }, { type: 'tool/result', seq: 9000, time: 1, data: {
    turn: 1, step: 0, message: { source: { callId: 'failed-call' }, content: [{ type: 'tool-result', isError: true, content: [{ type: 'text', text: 'failed' }] }] },
  } })
  listeners['session/event']({ id: 's1' }, { type: 'assistant/attempt', seq: 9001, time: 2, data: {
    turn: 1, step: 0, stream: [{ type: 'chunk', time: 1, chunk: { type: 'finish', reason: { kind: 'error' } } }],
  } })
  assert.equal(await waitFor(() => got.some(frame => frame.seq === 9001), 2000), true)
  assert.equal(got.find(frame => frame.seq === 9000).event.isError, true)
  assert.equal(got.find(frame => frame.seq === 9001).event.stream[0].type, 'chunk')
  interactionResults.push(['v3 failed tool and attempt payloads', true])

  // Auxiliary queries must report the real failure with their own request identity.
  for (const type of ['permission-options', 'context-usage', 'session-stats']) {
    const firstResponse = got.length
    ws.send(JSON.stringify({ type, sessionId: 'broken-history' }))
    assert.equal(await waitFor(() => got.slice(firstResponse).some(frame => frame.kind === 'error' && frame.requestType === type), 2000), true)
    const reply = got.slice(firstResponse).find(frame => frame.kind === 'error' && frame.requestType === type)
    assert.equal(reply.kind, 'error')
    assert.equal(reply.requestType, type)
    assert.equal(reply.sessionId, 'broken-history')
    assert.equal(reply.code, 'SESSION_QUERY_PERSISTENCE_FAILED')
    assert.match(reply.message, /unexpected member origin/)
    interactionResults.push([`${type} preserves history failure and correlation`, true])
  }

  // Opening byte budget keeps a contiguous latest suffix, without changing stream state.
  for (const oversizedLatest of [false, true]) {
    const sessionId = `opening-budget-${oversizedLatest}`
    const records = Array.from({ length: 60 }, (_, index) => ({ type: 'event', event: {
      type: 'assistant/message', seq: index + 1, time: index + 1, surfaceOp: 'append',
      data: { turn: index + 1, step: 1, message: { content: [{ type: 'text',
        text: `${index + 1}:` + '历史正文。'.repeat(oversizedLatest && index === 59 ? 30_000 : 4_000),
      }] } },
    } }))
    const prefix = { revision: 4, activeAttempt: { attemptId: 'active', turn: 61, step: 1,
      startedAfterSeq: 65, nextIndex: 1,
      stream: [{ type: 'text-chunks', time0: 100, index: 0, texts: ['继续生成'], dt: [] }] } }
    const projections = { asOfSeq: 65, values: { todos: [{ content: '任务', status: 'completed' }] } }
    const state = { signals: [], frames: [], snapshot: {
      type: 'snapshot', header: { version: 3, id: sessionId }, cursor: 65,
      records, hasMore: false, projections, assistantStream: prefix,
    } }
    liveFollows.set(sessionId, state)
    const socket = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`, { headers: { 'X-DSH-Channel': 'conversation' } })
    const frames = []
    socket.on('message', data => frames.push(JSON.parse(data.toString())))
    await new Promise(resolve => socket.once('open', resolve))
    try {
      socket.send(JSON.stringify({ type: 'subscribe', sessionId, assistantStream: true }))
      assert.equal(await waitFor(() => frames.some(frame => frame.kind === 'session-snapshot'), 2000), true)
      const snapshot = frames.find(frame => frame.kind === 'session-snapshot')
      assert.equal(snapshot.hasMore, true)
      assert.equal(snapshot.nextBeforeSeq, snapshot.events[0].seq)
      assert.deepEqual(snapshot.events.map(event => event.seq),
        Array.from({ length: snapshot.events.length }, (_, index) => snapshot.nextBeforeSeq + index))
      assert.equal(snapshot.events.at(-1).seq, 60)
      assert.equal(snapshot.events.at(-1).data.message.content[0].text, records.at(-1).event.data.message.content[0].text)
      assert.equal(snapshot.cursor, 65, 'filtered history tail must not replace durable watermark')
      assert.deepEqual(snapshot.assistantStream, prefix)
      assert.deepEqual(snapshot.projections, projections)
      if (oversizedLatest) assert.equal(snapshot.events.length, 1)
      else {
        assert.ok(snapshot.bytes <= 256 * 1024)
        assert.ok(snapshot.events.length < records.length)
        console.log(`opening budget: ${Buffer.byteLength(JSON.stringify(records))} -> ${snapshot.bytes} bytes; ${records.length} -> ${snapshot.events.length} events`)
      }
      interactionResults.push([`rc2 bounded opening with oversized latest=${oversizedLatest}`, true])
    } finally { socket.terminate() }
  }

  // rc.2 follow: authoritative snapshot, independent token identity, real settlement.
  {
    const state = { signals: [], frames: [], snapshot: {
      type: 'snapshot', header: { version: 3, id: 'live-1' }, cursor: 41,
      records: [], hasMore: false, projections: { asOfSeq: 41, values: {} }, assistantStream: { revision: 0 },
    } }
    liveFollows.set('live-1', state)
    const socket = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`, { headers: { 'X-DSH-Channel': 'conversation' } })
    const frames = []
    socket.on('message', data => frames.push(JSON.parse(data.toString())))
    await new Promise(resolve => socket.once('open', resolve))
    try {
      socket.send(JSON.stringify({ type: 'subscribe', sessionId: 'live-1', assistantStream: true }))
      assert.equal(await waitFor(() => frames.some(frame => frame.kind === 'session-snapshot'), 2000), true)
      const baseline = frames.find(frame => frame.kind === 'session-snapshot')
      assert.equal(baseline.historyFormatVersion, 3)
      assert.equal(baseline.cursor, 41)
      assert.equal(baseline.replace, true)
      state.frames.push({ type: 'assistant-stream', frame: { type: 'start', attemptId: 'a1', revision: 1, startedAfterSeq: 41, turn: 2, step: 3 } })
      for (const [index, text] of ['Hello', ' world'].entries()) state.frames.push({ type: 'assistant-stream', frame: {
        type: 'chunk', attemptId: 'a1', revision: index + 2, index, time: 100 + index, chunk: { type: 'text-delta', index: 0, text },
      } })
      const finalEvent = { type: 'assistant/message', seq: 42, time: 102,
        surfaceOp: 'append', data: { turn: 2, step: 3, interrupted: true, usage: { outputTokens: 2 },
          message: { content: [{ type: 'text', text: 'Hello world' }] } } }
      state.frames.push({ type: 'event', event: finalEvent }, { type: 'assistant-stream', frame: {
        type: 'end', attemptId: 'a1', revision: 4, index: 2, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 42 },
      } })
      listeners['session/event']({ id: 'live-1' }, finalEvent)
      assert.equal(await waitFor(() => frames.some(frame => frame.frame?.type === 'end'), 2000), true)
      const chunks = frames.filter(frame => frame.frame?.type === 'chunk')
      assert.equal(chunks.length, 2)
      assert.ok(chunks.every(frame => !('seq' in frame) && !('seq' in frame.frame) && frame.frame.turn === 2 && frame.frame.step === 3))
      assert.equal(frames.filter(frame => frame.kind === 'event').length, 1)
      assert.equal(frames.find(frame => frame.kind === 'event').event.interrupted, true)
      assert.equal(frames.find(frame => frame.kind === 'event').event.usage.outputTokens, 2)
      assert.equal(frames.find(frame => frame.kind === 'event').surfaceOp, 'append')
      socket.send(JSON.stringify({ type: 'unsubscribe' }))
      assert.equal(await waitFor(() => state.signals[0].aborted, 2000), true)
      interactionResults.push(['rc2 ordered follow and independent chunks', true])
    } finally { socket.terminate() }

    // A new connection joining mid-generation receives the entire active prefix.
    state.snapshot.assistantStream = { revision: 2, activeAttempt: { attemptId: 'a1', turn: 2, step: 3,
      startedAfterSeq: 41, nextIndex: 1, stream: [{ type: 'text-chunks', time0: 100, index: 0, dt: [], texts: ['Hello'] }] } }
    const reconnect = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`, { headers: { 'X-DSH-Channel': 'conversation' } })
    const restored = []
    reconnect.on('message', data => restored.push(JSON.parse(data.toString())))
    await new Promise(resolve => reconnect.once('open', resolve))
    reconnect.send(JSON.stringify({ type: 'subscribe', sessionId: 'live-1', assistantStream: true }))
    assert.equal(await waitFor(() => restored.some(frame => frame.kind === 'session-snapshot'), 2000), true)
    assert.equal(restored.find(frame => frame.kind === 'session-snapshot').assistantStream.activeAttempt.stream[0].texts[0], 'Hello')
    reconnect.terminate()
    assert.equal(await waitFor(() => state.signals.at(-1).aborted, 2000), true)
    interactionResults.push(['rc2 reconnect restores prefix and disconnect cancels follow', true])
  }

  // 两条真实 WebSocket：暂停对话接收后，控制连接仍能读取文件并管理会话。
  {
    const control = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`, { headers: { 'X-DSH-Channel': 'control' } })
    const conversation = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`, { headers: { 'X-DSH-Channel': 'conversation' } })
    const controls = []
    const conversations = []
    control.on('message', data => controls.push(JSON.parse(data.toString())))
    conversation.on('message', data => conversations.push(JSON.parse(data.toString())))
    try {
      assert.equal(await waitFor(() => controls.some(f => f.kind === 'hello') && conversations.some(f => f.kind === 'hello'), 2000), true)
      assert.equal(controls.find(f => f.kind === 'hello').capabilities.includes('split-channels'), true)
      conversation.send(JSON.stringify({ type: 'subscribe', sessionId: 's1' }))
      assert.equal(await waitFor(() => conversations.some(f => f.kind === 'subscribed'), 2000), true)
      listeners['session/event']({ id: 's1' }, { type: 'session/title', seq: 7001, time: Date.now(), data: { title: 'split test' } })
      assert.equal(await waitFor(() => controls.some(f => f.kind === 'session-title-changed') && conversations.some(f => f.seq === 7001), 2000), true)
      assert.equal(controls.some(f => f.seq === 7001 && f.event), false)
      assert.equal(conversations.some(f => f.kind === 'session-title-changed' || f.kind === 'session-archives'), false)
      conversation.pause()
      for (let seq = 7002; seq < 7258; seq++) {
        listeners['session/event']({ id: 's1' }, { type: 'assistant/message', seq, time: Date.now(), data: { message: { content: [{ type: 'text', text: 'x'.repeat(4096) }] }, turn: 1, step: 1 } })
      }
      control.send(JSON.stringify({ type: 'file-list', requestId: 'split-files', sessionId: 's1' }))
      assert.equal(await waitFor(() => controls.some(f => f.kind === 'file-list' && f.requestId === 'split-files'), 2000), true)
      control.send(JSON.stringify({ type: 'session-rename', sessionId: 's1', title: 'split renamed' }))
      assert.equal(await waitFor(() => controls.some(f => f.kind === 'session-renamed'), 2000), true)
      assert.equal(controls.some(f => f.event), false)
      conversation.resume()
      conversation.send(JSON.stringify({ type: 'subscribe', sessionId: 'preset-session' }))
      assert.equal(await waitFor(() => conversations.some(f => f.kind === 'subscribed' && f.sessionId === 'preset-session'), 2000), true)
      assert.ok(controls.find(f => f.kind === 'hello').capabilities.includes('session-agent-preset'))
      control.send(JSON.stringify({ type: 'session-agent-preset', sessionId: 'preset-session', requestId: 'preset-state' }))
      assert.equal(await waitFor(() => controls.some(f => f.requestId === 'preset-state'), 2000), true)
      assert.equal(controls.find(f => f.requestId === 'preset-state').locked, false)
      control.send(JSON.stringify({ type: 'select-agent-preset', sessionId: 'preset-session', agentPreset: 'minimal', requestId: 'preset-select' }))
      assert.equal(await waitFor(() => controls.some(f => f.requestId === 'preset-select')
        && conversations.some(f => f.event?.type === 'agent-preset/selected'), 2000), true)
      assert.equal(controls.find(f => f.requestId === 'preset-select').agentPreset, 'minimal')
      assert.equal(controls.find(f => f.kind === 'session-agent-preset-updated').agentPreset, 'minimal')
      assert.equal(conversations.find(f => f.event?.type === 'agent-preset/selected').event.agentPreset, 'minimal')
      assert.equal(conversations.some(f => f.kind === 'session-agent-preset-updated'), false)
      presetSession.sessionListMetadata = { blank: false, lastPromptAt: 101 }
      listeners['session/event']({ id: 'preset-session' }, { type: 'turn/start', seq: 9501, time: 101, data: { turn: 0 } })
      control.send(JSON.stringify({ type: 'select-agent-preset', sessionId: 'preset-session', agentPreset: 'standard', requestId: 'preset-locked' }))
      assert.equal(await waitFor(() => controls.some(f => f.requestId === 'preset-locked')
        && controls.some(f => f.kind === 'session-agent-preset-updated' && f.locked), 2000), true)
      assert.equal(controls.find(f => f.requestId === 'preset-locked').code, 'agent-preset/locked')
      conversation.send(JSON.stringify({ type: 'select-agent-preset', sessionId: 'preset-session', agentPreset: 'standard' }))
      assert.equal(await waitFor(() => conversations.some(f => f.code === 'wrong-channel' && f.requestType === 'select-agent-preset'), 2000), true)
      interactionResults.push(['session preset state, selection, locking and split-channel notifications', true])
      conversation.send(JSON.stringify({ type: 'file-list', requestId: 'wrong-lane', sessionId: 's1' }))
      assert.equal(await waitFor(() => conversations.some(f => f.code === 'wrong-channel'), 2000), true)
    } finally {
      conversation.terminate()
      control.terminate()
    }
  }

  const archiveBaselineReady = await waitFor(() => got.some((m) => m.kind === 'session-archives' && m.archivedSessionIds.length === 0), 2000)
  interactionResults.push(['session archive baseline on connect', archiveBaselineReady])
  const queueBaselineReady = await waitFor(() => got.some((m) => m.kind === 'session-queues' && m.queues.s1?.[0]?.id === 'message-1'), 2000)
  const queueBaseline = got.find((m) => m.kind === 'session-queues' && m.queues.s1?.[0]?.id === 'message-1')
  interactionResults.push(['session queue baseline on connect', queueBaselineReady && queueBaseline.queues.s1[0].placement === 'queued' && queueBaseline.queues.s1[0].message.content[0].text === '原消息'])
  const questionOne = listeners['user-questions/request']({
    agent: { id: 's1' },
    questions: [
      { id: 'direction', header: 'Research', question: 'Choose a direction', options: [{ label: 'Core', description: 'Architecture' }, { label: 'Mobile' }], multiSelect: false },
      { id: 'detail', question: 'Anything else?', options: [], multiSelect: false },
    ],
  }, () => Promise.reject(new Error('unexpected question fallback')))
  const questionTwo = listeners['user-questions/request']({
    agent: { id: 's2' },
    questions: [{ id: 'confirm', question: 'Continue?', options: [{ label: 'Yes' }, { label: 'No' }], multiSelect: false }],
  }, () => Promise.reject(new Error('unexpected question fallback'))).then(
    (value) => value,
    (error) => error,
  )
  const approvalOne = listeners['approval/request']({
    agent: { id: 's1' },
    toolName: 'bash',
    callId: 'call-1',
    reason: 'escalate sandbox to danger-full-access',
  }, () => Promise.resolve('unavailable'))
  const approvalTwo = listeners['approval/request']({
    agent: { id: 's2' },
    toolName: 'bash',
    reason: 'write outside the workspace',
  }, () => Promise.resolve('unavailable'))

  const requestedReady = await waitFor(() => got.filter((m) => m.kind === 'question-requested').length === 2, 2000)
  const requested = got.find((m) => m.kind === 'question-requested' && m.sessionId === 's1')
  const requestedTwo = got.find((m) => m.kind === 'question-requested' && m.sessionId === 's2')
  interactionResults.push(['question requested', requestedReady && requested && requested.questions.length === 2 && requested.questions[0].options[0].description === 'Architecture'])

  ws.send(JSON.stringify({
    type: 'question-answer',
    rpcId: requested.rpcId,
    sessionId: 's1',
    answers: [
      { id: 'direction', selected: ['Not offered'] },
      { id: 'detail', selected: [] },
    ],
  }))
  const invalidAnswerReady = await waitFor(() => got.some((m) => m.kind === 'error' && m.requestType === 'question-answer' && m.code === 'bad-response'), 2000)
  interactionResults.push(['question answer validation', invalidAnswerReady])

  ws.send(JSON.stringify({
    type: 'question-answer',
    rpcId: requested.rpcId,
    sessionId: 's1',
    answers: [
      { id: 'direction', selected: ['Mobile'] },
      { id: 'detail', selected: [], custom: 'Security' },
    ],
  }))
  const answerReady = await waitFor(() => got.some((m) => m.kind === 'question-response' && m.rpcId === requested.rpcId), 2000)
  const answerReceipt = got.find((m) => m.kind === 'question-response' && m.rpcId === requested.rpcId)
  const answerValue = await questionOne
  interactionResults.push(['question answer', answerReady && answerReceipt.accepted === true && answerValue.answers[1].custom === 'Security'])
  const answeredResolved = await waitFor(() => got.some((m) => m.kind === 'question-resolved' && m.rpcId === requested.rpcId && m.outcome === 'answered'), 2000)
  interactionResults.push(['question answered resolution', answeredResolved])

  const approvalRequestedReady = await waitFor(() => got.filter((m) => m.kind === 'approval-requested').length === 2, 2000)
  const requestedApproval = got.find((m) => m.kind === 'approval-requested' && m.sessionId === 's1')
  const requestedApprovalTwo = got.find((m) => m.kind === 'approval-requested' && m.sessionId === 's2')
  interactionResults.push(['approval requested', approvalRequestedReady && requestedApproval && requestedApproval.toolName === 'bash' && requestedApproval.callId === 'call-1' && requestedApproval.reason === 'escalate sandbox to danger-full-access'])

  const approvalReplayCount = got.filter((m) => m.kind === 'approval-requested' && m.rpcId === requestedApprovalTwo.rpcId).length
  ws.send(JSON.stringify({ type: 'subscribe', sessionId: 's2' }))
  const subscribedApprovalReady = await waitFor(() => got.filter((m) => m.kind === 'approval-requested' && m.rpcId === requestedApprovalTwo.rpcId).length > approvalReplayCount, 2000)
  const subscribedApproval = got.filter((m) => m.kind === 'approval-requested' && m.rpcId === requestedApprovalTwo.rpcId).at(-1)
  const wrongSessionApprovalCount = got.filter((m) => m.kind === 'approval-requested' && m.rpcId === requestedApproval.rpcId).length
  interactionResults.push(['approval replayed when existing session is opened', subscribedApprovalReady && subscribedApproval && subscribedApproval.replay === true && wrongSessionApprovalCount === 1])
  ws.send(JSON.stringify({ type: 'unsubscribe' }))
  await waitFor(() => got.some((m) => m.kind === 'subscribed' && m.sessionId === null), 2000)

  ws.send(JSON.stringify({
    type: 'approval-response',
    rpcId: requestedApproval.rpcId,
    sessionId: 's1',
    approvalId: requestedApproval.approvalId,
    outcome: 'allowed-once',
  }))
  const approvalAllowedReady = await waitFor(() => got.some((m) => m.kind === 'approval-response' && m.rpcId === requestedApproval.rpcId), 2000)
  const approvalAllowedReceipt = got.find((m) => m.kind === 'approval-response' && m.rpcId === requestedApproval.rpcId)
  interactionResults.push(['approval allowed once', approvalAllowedReady && approvalAllowedReceipt.accepted === true && approvalAllowedReceipt.outcome === 'allowed-once' && await approvalOne === 'allowed-once'])
  const approvalAllowedResolved = await waitFor(() => got.some((m) => m.kind === 'approval-resolved' && m.rpcId === requestedApproval.rpcId && m.approvalId === requestedApproval.approvalId && m.outcome === 'allowed-once'), 2000)
  interactionResults.push(['approval allowed resolution', approvalAllowedResolved])

  ws.send(JSON.stringify({
    type: 'approval-response',
    rpcId: requestedApprovalTwo.rpcId,
    sessionId: 's2',
    approvalId: requestedApprovalTwo.approvalId,
    outcome: 'rejected',
  }))
  const approvalRejectedReady = await waitFor(() => got.some((m) => m.kind === 'approval-response' && m.rpcId === requestedApprovalTwo.rpcId), 2000)
  const approvalRejectedReceipt = got.find((m) => m.kind === 'approval-response' && m.rpcId === requestedApprovalTwo.rpcId)
  interactionResults.push(['approval rejected', approvalRejectedReady && approvalRejectedReceipt.accepted === true && approvalRejectedReceipt.outcome === 'rejected' && await approvalTwo === 'rejected'])
  const approvalRejectedResolved = await waitFor(() => got.some((m) => m.kind === 'approval-resolved' && m.rpcId === requestedApprovalTwo.rpcId && m.approvalId === requestedApprovalTwo.approvalId && m.outcome === 'rejected'), 2000)
  interactionResults.push(['approval rejected resolution', approvalRejectedResolved])

  ws.send(JSON.stringify({ type: 'approval-response', rpcId: requestedApprovalTwo.rpcId, sessionId: 's2', approvalId: requestedApprovalTwo.approvalId, outcome: 'later' }))
  const badApprovalReady = await waitFor(() => got.some((m) => m.kind === 'error' && m.requestType === 'approval-response'), 2000)
  interactionResults.push(['approval invalid outcome', badApprovalReady])

  controlFrames.push({
      type: 'projection',
      sessionId: 's1',
      key: 'todos',
      value: [{ content: 'Inspect Android CLI/SDK environment', status: 'completed' }],
      seq: 93,
  })
  controlFrames.push({
      type: 'projection',
      sessionId: 's1',
      key: 'goal',
      value: { goal: { id: 'goal-1', revision: 8, objective: '初始化一个 Android app', phase: 'paused', maxGoalRounds: 12 }, roundsStarted: 3, createdAt: 1, updatedAt: 3 },
      seq: 94,
  })
  controlFrames.push({
    type: 'queue',
    sessionId: 's1',
    items: [{ id: 'message-1', placement: 'queued', rpcId: 'prompt-1', message: { id: 'message-1', content: [{ type: 'text', text: 'WebUI 修改后' }] } }],
  })
  const tasksUpdated = await waitFor(() => got.some((m) => m.kind === 'tasks-updated' && m.asOfSeq === 93), 2000)
  const goalUpdated = await waitFor(() => got.some((m) => m.kind === 'goal-updated' && m.asOfSeq === 94), 2000)
  const queueUpdated = await waitFor(() => got.some((m) => m.kind === 'session-queue' && m.sessionId === 's1' && m.items[0]?.message.content[0]?.text === 'WebUI 修改后'), 2000)
  interactionResults.push(['live task projection', tasksUpdated && got.find((m) => m.kind === 'tasks-updated' && m.asOfSeq === 93).todos[0].status === 'completed'])
  interactionResults.push(['live goal projection', goalUpdated && got.find((m) => m.kind === 'goal-updated' && m.asOfSeq === 94).goal.goal.phase === 'paused'])
  interactionResults.push(['live session queue update', queueUpdated])

  controlFrames.push({ type: 'baseline', value: { queues: {}, jobs: {}, projections: {
    s1: { asOfSeq: 94, values: { todos: [], goal: null } },
  } } })
  assert.equal(await waitFor(() => got.some(frame => frame.kind === 'projection-baseline' && frame.projections.s1?.values.goal === null), 2000), true)
  assert.equal(await waitFor(() => got.some(frame => frame.kind === 'goal-updated' && frame.goal === null && frame.asOfSeq === 94), 2000), true)
  interactionResults.push(['control reconnect restores projection baseline', true])
  workspaceFrames.push({ type: 'archived', archivedSessionIds: ['s1'] })
  const archivesUpdated = await waitFor(() => got.some((m) => m.kind === 'session-archives' && m.archivedSessionIds.includes('s1')), 2000)
  interactionResults.push(['live session archive state', archivesUpdated])

  ws.send(JSON.stringify({ type: 'subscribe', sessionId: 's2' }))
  await waitFor(() => got.some((m) => m.kind === 'subscribed' && m.sessionId === 's2'), 2000)
  listeners['session/event']({ id: 's1' }, {
    type: 'session/title',
    seq: 95,
    time: 95,
    data: { title: 'WebUI 新名称', messageSeqs: [], source: { kind: 'user' } },
  })
  const titleChanged = await waitFor(() => got.some((m) => m.kind === 'session-title-changed' && m.sessionId === 's1' && m.seq === 95), 2000)
  const filteredTitleEvent = got.some((m) => m.kind === 'event' && m.sessionId === 's1' && m.seq === 95)
  interactionResults.push(['live session title metadata ignores conversation filter', titleChanged && !filteredTitleEvent && got.find((m) => m.kind === 'session-title-changed' && m.seq === 95).title === 'WebUI 新名称'])
  ws.send(JSON.stringify({ type: 'unsubscribe' }))
  await waitFor(() => got.filter((m) => m.kind === 'subscribed' && m.sessionId === null).length >= 2, 2000)
  listeners['session/event']({ id: 's1' }, {
    type: 'session/title',
    seq: 96,
    time: 96,
    data: { title: '第二个名称', messageSeqs: [], source: { kind: 'fallback' } },
  })
  const titleEventReady = await waitFor(() => got.some((m) => m.kind === 'event' && m.sessionId === 's1' && m.seq === 96), 2000)
  const titleEvent = got.find((m) => m.kind === 'event' && m.sessionId === 's1' && m.seq === 96)
  interactionResults.push(['session title remains in ordered event stream', titleEventReady && titleEvent.event.title === '第二个名称' && titleEvent.event.source.kind === 'fallback'])

  ws.send(JSON.stringify({ type: 'file-list', requestId: 'files-1', sessionId: 's1' }))
  const fileListReady = await waitFor(() => got.some((m) => m.kind === 'file-list' && m.requestId === 'files-1'), 2000)
  const fileList = got.find((m) => m.kind === 'file-list' && m.requestId === 'files-1')
  interactionResults.push(['file list workspace only', fileListReady && fileList.path === '.' && fileList.entries.some((e) => e.path === 'builds' && e.kind === 'directory') && fileList.entries.some((e) => e.path === 'guide.pdf' && e.mediaType === 'application/pdf') && !fileList.entries.some((e) => e.name === 'outside-link.bin')])

  ws.send(JSON.stringify({ type: 'file-download-open', requestId: 'download-1', sessionId: 's1', path: 'builds/app-release.apk' }))
  const openedReady = await waitFor(() => got.some((m) => m.kind === 'file-download-opened' && m.requestId === 'download-1'), 2000)
  const opened = got.find((m) => m.kind === 'file-download-opened' && m.requestId === 'download-1')
  interactionResults.push(['file download open', openedReady && opened.name === 'app-release.apk' && opened.mediaType === 'application/vnd.android.package-archive' && opened.size === fileDownloadBytes.length && opened.chunkBytes === 64 * 1024])

  const downloadedChunks = []
  let nextOffset = 0
  let completedDownload = null
  while (openedReady && !completedDownload) {
    const beforeChunks = got.filter((m) => m.kind === 'file-download-chunk' && m.transferId === opened.transferId).length
    ws.send(JSON.stringify({ type: 'file-download-read', transferId: opened.transferId, offset: nextOffset }))
    const chunkReady = await waitFor(() => got.filter((m) => m.kind === 'file-download-chunk' && m.transferId === opened.transferId).length > beforeChunks, 2000)
    const chunk = got.filter((m) => m.kind === 'file-download-chunk' && m.transferId === opened.transferId).at(-1)
    if (!chunkReady || !chunk || chunk.offset !== nextOffset) break
    downloadedChunks.push(Buffer.from(chunk.data, 'base64'))
    nextOffset += downloadedChunks.at(-1).length
    if (chunk.eof) completedDownload = chunk
  }
  const downloadedBytes = Buffer.concat(downloadedChunks)
  const expectedSha256 = crypto.createHash('sha256').update(fileDownloadBytes).digest('hex')
  interactionResults.push(['file download chunks + sha256', completedDownload && downloadedBytes.equals(fileDownloadBytes) && completedDownload.sha256 === expectedSha256])

  ws.send(JSON.stringify({ type: 'file-download-open', requestId: 'cancel-1', sessionId: 's1', path: 'guide.pdf' }))
  const cancelOpenReady = await waitFor(() => got.some((m) => m.kind === 'file-download-opened' && m.requestId === 'cancel-1'), 2000)
  const cancelOpen = got.find((m) => m.kind === 'file-download-opened' && m.requestId === 'cancel-1')
  if (cancelOpenReady) ws.send(JSON.stringify({ type: 'file-download-cancel', transferId: cancelOpen.transferId }))
  const cancelledDownloadReady = await waitFor(() => cancelOpenReady && got.some((m) => m.kind === 'file-download-cancelled' && m.transferId === cancelOpen.transferId), 2000)
  interactionResults.push(['file download cancel', cancelledDownloadReady])

  ws.send(JSON.stringify({ type: 'file-download-open', requestId: 'escape-1', sessionId: 's1', path: '../outside.bin' }))
  const escapedPathReady = await waitFor(() => got.some((m) => m.kind === 'error' && m.requestType === 'file-download-open' && m.code === 'bad-request'), 2000)
  interactionResults.push(['file download rejects parent path', escapedPathReady])

  ws.send(JSON.stringify({ type: 'file-download-open', requestId: 'symlink-1', sessionId: 's1', path: 'outside-link.bin' }))
  const symlinkPathReady = await waitFor(() => got.some((m) => m.kind === 'error' && m.requestType === 'file-download-open' && m.code === 'file-not-allowed'), 2000)
  interactionResults.push(['file download rejects escaping symlink', symlinkPathReady])

  ws.send(JSON.stringify({ type: 'question-cancel', rpcId: requestedTwo.rpcId, sessionId: 's2' }))
  const cancelReady = await waitFor(() => got.some((m) => m.kind === 'question-response' && m.rpcId === requestedTwo.rpcId), 2000)
  const cancelReceipt = got.find((m) => m.kind === 'question-response' && m.rpcId === requestedTwo.rpcId)
  const cancelError = await questionTwo
  interactionResults.push(['question cancel', cancelReady && cancelReceipt.accepted === true && cancelError.code === 'ASK_CANCELLED'])
  const cancelledResolved = await waitFor(() => got.some((m) => m.kind === 'question-resolved' && m.rpcId === requestedTwo.rpcId && m.outcome === 'cancelled'), 2000)
  interactionResults.push(['question cancelled resolution', cancelledResolved])
  listeners['session/event']({ id: 's1' }, {
    type: 'user/message',
    seq: 88,
    time: 88,
    data: { id: 'user-live-88', content: [{ type: 'image', attachment: { attachmentId: 'att-live', mediaType: 'image/jpeg', bytes: 12, width: 3, height: 4, name: 'live.jpg' } }, { type: 'text', text: 'live image' }], source: { kind: 'user' } },
  })
  const liveImageReady = await waitFor(() => got.some((m) => m.kind === 'event' && m.seq === 88), 2000)
  const liveImageEvent = got.find((m) => m.kind === 'event' && m.seq === 88)
  interactionResults.push(['live image reference', liveImageReady && liveImageEvent.event.images[0].attachmentId === 'att-live' && liveImageEvent.event.text === 'live image'])
  interactionResults.push(['live user message identity', liveImageReady && liveImageEvent.event.raw?.id === 'user-live-88'])
  listeners['session/event']({ id: 's1' }, {
    type: 'command/run',
    seq: 89,
    time: 89,
    data: { commandId: 'cmd-compact', name: 'compact', source: { kind: 'user' } },
  })
  listeners['session/event']({ id: 's1' }, {
    type: 'compaction/summary',
    seq: 90,
    time: 90,
    data: { compactionId: 'compact-1', sourceCommandId: 'cmd-compact', shadowedSeqs: [1, 2, 3], shadowedTokenCount: 7230 },
  })
  listeners['session/event']({ id: 's1' }, {
    type: 'command/done',
    seq: 91,
    time: 91,
    data: { commandId: 'cmd-compact', kind: 'success', text: 'Compacted 3 history items.', sourceEventSeq: 90 },
  })
  const commandEventsReady = await waitFor(() => got.some((m) => m.kind === 'event' && m.seq === 91), 2000)
  const commandRun = got.find((m) => m.kind === 'event' && m.seq === 89)
  const compactSummary = got.find((m) => m.kind === 'event' && m.seq === 90)
  const commandDone = got.find((m) => m.kind === 'event' && m.seq === 91)
  interactionResults.push(['live command lifecycle', commandEventsReady && commandRun.event.name === 'compact' && commandRun.event.commandId === 'cmd-compact' && compactSummary.event.shadowedItemCount === 3 && compactSummary.event.shadowedTokenCount === 7230 && commandDone.event.outcome === 'success' && commandDone.event.sourceEventSeq === 90])
  for (const [name, pass] of interactionResults) console.log((pass ? 'PASS ' : 'FAIL ') + name)

  const deepseekChatOptionId = Buffer.from(JSON.stringify(['deepseek', 'deepseek-chat']), 'utf8').toString('base64url')
  const cases = [
    ['workspaces', { type: 'workspaces' }, (m) => m.kind === 'workspaces'],
    ['sessions Unicode preview', { type: 'sessions' }, (m) => m.kind === 'sessions' && m.items[0].projections.values.turnOutline[0].response === '鼓掌 �…' && m.items[0].projections.values.turnOutline[0].prompt === '👏'],
    ['history+projections', { type: 'history', sessionId: 's1' }, (m) => m.kind === 'history' && m.sessionId === 's1' && m.projections && m.projections.values.tokenUsage && m.bytes > 0],
    ['history image reference', { type: 'history', sessionId: 's1', view: 'conversation' }, (m) => m.kind === 'history' && m.events[0].data.content[0].attachment.attachmentId === 'att-image-1'],
    ['attachment bytes', { type: 'attachment', sessionId: 's1', attachmentId: 'att-image-1' }, (m) => m.kind === 'attachment' && m.sessionId === 's1' && m.attachment.mediaType === 'image/png' && m.data === 'iVBORw0KGgo='],
    ['attachment missing id', { type: 'attachment', sessionId: 's1' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['history byte-capped', { type: 'history', sessionId: 's1', maxBytes: 300 }, (m) => m.kind === 'history' && m.bytes <= 350 && m.hasMore === true && typeof m.nextBeforeSeq === 'number' && m.events.length >= 1 && m.events[0].seq === m.nextBeforeSeq],
    ['history conversation trim', { type: 'history', sessionId: 's1', view: 'conversation', maxBytes: 200000 }, (m) => m.kind === 'history' && m.view === 'conversation' && !m.events.some((e) => e.type === 'assistant/chunk' || e.type === 'request/header') && m.events.some((e) => e.type === 'tool/result') && (() => { const tr = m.events.find((e) => e.type === 'tool/result'); const txt = tr.data.message.content[0].content[0].text; return txt.length <= 2001; })() && m.hasMore === false && m.nextBeforeSeq === undefined],
    ['search', { type: 'search', query: 'q' }, (m) => m.kind === 'search'],
    ['host', { type: 'host' }, (m) => m.kind === 'host'],
    ['directories', { type: 'directories', path: '/tmp' }, (m) => m.kind === 'directories'],
    ['directory-create', { type: 'directory-create', path: directoryTestRoot, name: 'Sources' }, (m) => m.kind === 'directory-create' && m.path === path.join(directoryTestRoot, 'Sources') && fs.statSync(m.path).isDirectory()],
    ['directory-create duplicate', { type: 'directory-create', path: directoryTestRoot, name: 'Sources' }, (m) => m.kind === 'error' && m.code === 'directory-exists'],
    ['directory-create missing name', { type: 'directory-create', path: directoryTestRoot }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['directory-create dot name', { type: 'directory-create', path: directoryTestRoot, name: '..' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['directory-create nested name', { type: 'directory-create', path: directoryTestRoot, name: 'nested/child' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['directory-create relative parent', { type: 'directory-create', path: 'relative', name: 'Sources' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['directory-create missing parent', { type: 'directory-create', path: path.join(directoryTestRoot, 'missing'), name: 'Sources' }, (m) => m.kind === 'error' && m.code === 'directory-create-failed'],
    ['workspace-create', { type: 'workspace-create', path: '/tmp' }, (m) => m.kind === 'workspace-create'],
    ['models', { type: 'models', sessionId: 's1' }, (m) => m.kind === 'models' && m.groups[0].models[0].reasoning.efforts.length === 2],
    ['commands + skills', { type: 'commands', sessionId: 's1', locale: 'zh-CN' }, (m) => {
      const commands = m.groups?.[0]?.items || []
      const skills = m.groups?.[1]?.items || []
      return m.kind === 'commands' && m.sessionId === 's1' && m.locale === 'zh-CN' && m.groups.length === 2 &&
        m.groups[0].title === '命令' && m.groups[1].title === '技能' && commands.length === 4 &&
        commands[0].name === 'compact' && commands[0].ui.kind === 'immediate' && commands[0].ui.submitRequest === 'command-execute' && commands[0].ui.submitText === '/compact' &&
        commands[1].name === 'permission' && commands[1].ui.kind === 'select' && commands[1].ui.optionsRequest === 'command-options' && commands[1].ui.insertText === '/permission' &&
        commands[2].ui.kind === 'input' && commands[2].ui.insertText === '/plan ' && commands[2].ui.hint === '[off|message]' && commands[2].ui.displayHint === '描述你的任务以生成计划' && commands[2].ui.submitRequest === 'command-execute' && commands[2].ui.images === true &&
        commands[3].name === 'model' && commands[3].description === '选择本会话使用的模型' && commands[3].ui.kind === 'select' &&
        skills.length === 2 && skills[0].id === 'skill:android-cli' && skills[0].ui.kind === 'input' && skills[0].ui.submitRequest === 'message' && skills[0].ui.insertText === '/android-cli ' && skills[0].whenToUse === 'Use for Android device automation' &&
        skills[1].modelInvocable === false && skills[1].description.startsWith('仅用户 · ') && invokeCalls.some((c) => c.namespace === 'commands' && c.method === 'list' && c.args.agentId === 's1')
    }],
    ['commands English locale', { type: 'commands', sessionId: 's1', locale: 'en-US' }, (m) => m.kind === 'commands' && m.locale === 'en' && m.groups[0].title === 'Commands' && m.groups[1].title === 'Skills' && m.groups[0].items[2].ui.displayHint === 'describe your task to generate plan' && m.groups[1].items[1].description.startsWith('user-only · ')],
    ['commands missing sessionId', { type: 'commands' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['command-execute compact', { type: 'command-execute', sessionId: 's1', line: '/compact' }, (m) => m.kind === 'command-executed' && m.commandId === 'cmd-1' && m.line === '/compact' && m.result.kind === 'success' && api.promptCalls.length === 0 && invokeCalls.some((c) => c.namespace === 'commands' && c.method === 'execute' && c.args.agentId === 's1' && c.args.line === '/compact' && Array.isArray(c.args.submittedAttachments) && c.args.submittedAttachments.length === 0)],
    ['command-execute plan args + image', { type: 'command-execute', sessionId: 's1', line: '/plan 帮我完成 Android 端适配', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }, (m) => m.kind === 'command-executed' && invokeCalls.some((c) => c.method === 'execute' && c.args.line === '/plan 帮我完成 Android 端适配' && c.args.submittedAttachments.length === 1 && c.args.submittedAttachments[0].type === 'image' && c.args.submittedAttachments[0].data === 'iVBORw0KGgo=') && api.promptCalls.length === 0],
    ['command-execute handler error', { type: 'command-execute', sessionId: 's1', line: '/plan fail' }, (m) => m.kind === 'command-executed' && m.commandId === 'cmd-error' && m.result.kind === 'error' && m.result.text === 'plan failed'],
    ['command-execute rejects compact image', { type: 'command-execute', sessionId: 's1', line: '/compact', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'command-execute'],
    ['command-execute unknown', { type: 'command-execute', sessionId: 's1', line: '/missing' }, (m) => m.kind === 'error' && m.code === 'unknown-command'],
    ['command-execute invalid line', { type: 'command-execute', sessionId: 's1', line: 'compact' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['command-execute missing sessionId', { type: 'command-execute', line: '/compact' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['command-options permission', { type: 'command-options', sessionId: 's1', command: 'permission' }, (m) => m.kind === 'command-options' && m.command === 'permission' && m.options.length === 2 && m.options[0].id === 'ask' && m.options[0].selected === true && m.options[1].id === 'workspace-write'],
    ['command-select permission', { type: 'command-select', sessionId: 's1', command: 'permission', optionId: 'workspace-write' }, (m) => m.kind === 'command-selected' && m.command === 'permission' && m.selected.id === 'workspace-write' && m.selected.selected === true && invokeCalls.some((c) => c.method === 'execute' && c.args.line === '/permission workspace-write')],
    ['command-options model', { type: 'command-options', sessionId: 's1', command: 'model' }, (m) => m.kind === 'command-options' && m.command === 'model' && m.options.length === 1 && m.options[0].id === deepseekChatOptionId && m.options[0].label === 'DeepSeek Chat' && m.options[0].selected === true],
    ['command-select model', { type: 'command-select', sessionId: 's1', command: 'model', optionId: deepseekChatOptionId }, (m) => m.kind === 'command-selected' && m.command === 'model' && m.selected.label === 'DeepSeek Chat' && m.value.provider === 'deepseek' && m.value.model === 'deepseek-chat'],
    ['command-options unsupported', { type: 'command-options', sessionId: 's1', command: 'goal' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['select-model', { type: 'select-model', sessionId: 's1', provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, (m) => m.kind === 'select-model' && m.selected.reasoningEffort === 'high'],
    ['select-model missing field', { type: 'select-model', sessionId: 's1', provider: 'deepseek' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['permission-options', { type: 'permission-options', sessionId: 's1' }, (m) => m.kind === 'permission-options' && m.namespace.ns === 'permission' && m.sessionPermissions && m.sessionPermissions.currentValue === 'ask'],
    ['permission', { type: 'permission', sessionId: 's1', name: 'code' }, (m) => m.kind === 'permission' && m.set === 'code' && m.commandId === 'cmd-1' && invokeCalls.some((c) => c.namespace === 'commands' && c.method === 'execute' && c.args.line === '/permission code' && c.args.agentId === 's1' && Array.isArray(c.args.submittedAttachments) && c.args.submittedAttachments.length === 0 && !('agent' in c.args)) && api.promptCalls.length === 0],
    ['permission missing name', { type: 'permission', sessionId: 's1' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['permission unknown command', { type: 'permission', sessionId: 's1', name: 'missing' }, (m) => m.kind === 'error' && m.code === 'unknown-command'],
    ['context-usage', { type: 'context-usage', sessionId: 's1' }, (m) => m.kind === 'context-usage' && m.tokenUsage.totals.inputTokens === 10 && m.contextPressure.contextWindow === 128000 && m.asOfSeq === 42],
    ['tasks', { type: 'tasks', sessionId: 's1' }, (m) => m.kind === 'tasks' && m.sessionId === 's1' && m.asOfSeq === 42 && m.todos.length === 3 && m.todos[1].status === 'in_progress'],
    ['goal', { type: 'goal', sessionId: 's1' }, (m) => m.kind === 'goal' && m.sessionId === 's1' && m.asOfSeq === 42 && m.goal.goal.objective === '初始化一个 Android app' && m.goal.goal.phase === 'active'],
    ['goal-edit', { type: 'goal-edit', sessionId: 's1', ref: { id: 'goal-1', revision: 7 }, objective: '完成 Android app 初始化' }, (m) => m.kind === 'goal-edit' && m.ref.revision === 8 && api.goalCalls.some((c) => c.method === 'edit' && c.payload.objective === '完成 Android app 初始化')],
    ['goal-pause', { type: 'goal-pause', sessionId: 's1', ref: { id: 'goal-1', revision: 8 } }, (m) => m.kind === 'goal-pause' && m.ref.revision === 9 && api.goalCalls.some((c) => c.method === 'pause')],
    ['goal-resume', { type: 'goal-resume', sessionId: 's1', ref: { id: 'goal-1', revision: 9 } }, (m) => m.kind === 'goal-resume' && m.ref.revision === 10 && api.goalCalls.some((c) => c.method === 'resume')],
    ['goal-clear', { type: 'goal-clear', sessionId: 's1', ref: { id: 'goal-1', revision: 10 } }, (m) => m.kind === 'goal-clear' && m.cleared === true && api.goalCalls.some((c) => c.method === 'clear')],
    ['goal mutation missing ref', { type: 'goal-pause', sessionId: 's1' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'goal-pause'],
    ['message keeps slash text as prompt', { type: 'message', sessionId: 's1', text: '/compact' }, (m) => { const p = api.promptCalls[api.promptCalls.length - 1]; return m.kind === 'sent' && p.content.length === 1 && p.content[0].text === '/compact'; }],
    ['create empty session', { type: 'session-create', requestId: 'create-1', workspaceId: 'w1', cwd: '/ignored' }, (m) => m.kind === 'session-created' && m.requestId === 'create-1' && Boolean(m.sessionId) && JSON.stringify(api._createCalls.at(-1)) === JSON.stringify({ workspaceId: 'w1' })],
    ['create empty session requires correlation', { type: 'session-create' }, (m) => m.kind === 'error' && m.requestType === 'session-create' && m.code === 'bad-request'],
    ['message create in workspace', { type: 'message', text: 'hi', workspaceId: 'w1' }, (m) => m.kind === 'sent' && api._createCalls.length >= 1 && JSON.stringify(api._createCalls[api._createCalls.length - 1]) === JSON.stringify({ workspaceId: 'w1' })],
    ['message create with cwd', { type: 'message', text: 'hi', cwd: '/tmp' }, (m) => m.kind === 'sent' && JSON.stringify(api._createCalls[api._createCalls.length - 1]) === JSON.stringify({ cwd: '/tmp' })],
    ['message create both -> workspaceId wins', { type: 'message', text: 'hi', workspaceId: 'w2', cwd: '/tmp' }, (m) => m.kind === 'sent' && JSON.stringify(api._createCalls[api._createCalls.length - 1]) === JSON.stringify({ workspaceId: 'w2' })],
    ['message image upload', { type: 'message', sessionId: 's1', text: 'describe this', clientTimeZone: 'Asia/Shanghai', images: [{ mediaType: 'image/jpeg', data: '/9j/2Q==', name: 'photo.jpg' }] }, (m) => { const p = api.promptCalls[api.promptCalls.length - 1]; return m.kind === 'sent' && p.clientTimeZone === 'Asia/Shanghai' && p.content[0].type === 'image' && p.content[0].data === '/9j/2Q==' && p.content[1].text === 'describe this' }],
    ['message image only', { type: 'message', sessionId: 's1', images: [{ mediaType: 'image/png', data: 'iVBORw0KGgo=' }] }, (m) => { const p = api.promptCalls[api.promptCalls.length - 1]; return m.kind === 'sent' && p.content.length === 1 && p.content[0].type === 'image' }],
    ['message invalid image', { type: 'message', sessionId: 's1', images: [{ mediaType: 'image/tiff', data: 'AA==' }] }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['agent-presets', { type: 'agent-presets' }, (m) => m.kind === 'agent-presets' && m.presets.length === 2 && m.presets[0].isDefault === true],
    ['defaults', { type: 'defaults' }, (m) => m.kind === 'defaults' && m.agentPresetDefault === 'standard' && m.permissionDefault === 'ask'],
    ['set-default agent-preset', { type: 'set-default', target: 'agent-preset', value: 'minimal' }, (m) => m.kind === 'set-default' && m.applied === true && api.settingsUpdates.some((u) => u.ns === 'agent-presets' && u.patch.default === 'minimal')],
    ['set-default permission', { type: 'set-default', target: 'permission', value: 'code' }, (m) => m.kind === 'set-default' && m.applied === true && api.settingsUpdates.some((u) => u.ns === 'permission' && u.patch.defaultPreset === 'code')],
    ['set-default bad target', { type: 'set-default', target: 'nope', value: 'x' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['session-stats', { type: 'session-stats', sessionId: 's1' }, (m) => m.kind === 'session-stats' && m.sessionStats.turns === 6 && m.sessionStats.steps === 69 && m.sessionStats.llmMs === 2280000 && m.tokenUsage.totals.inputTokens === 10 && m.asOfSeq === 42],
    ['default-model', { type: 'default-model' }, (m) => m.kind === 'default-model' && m.selection.provider === 'deepseek' && m.selection.model === 'deepseek-chat' && m.selection.reasoningEffort === 'high'],
    ['save-default-model', { type: 'save-default-model', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'medium' }, (m) => m.kind === 'save-default-model' && m.saved.provider === 'deepseek' && m.saved.model === 'deepseek-reasoner' && m.saved.reasoningEffort === 'medium' && savedSelections.length === 1 && savedSelections[0].reasoningEffort === 'medium'],
    ['save-default-model missing fields', { type: 'save-default-model', provider: 'deepseek' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['fork', { type: 'fork', sessionId: 's1', atSeq: 42, historyFormatVersion: 3 }, (m) => m.kind === 'fork' && m.sessionId === 's-branch-1'],
    ['fork missing sessionId', { type: 'fork' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['session cancel', { type: 'session-cancel', sessionId: 's1' }, (m) => m.kind === 'session-cancelled' && m.sessionId === 's1' && m.accepted === true && api.cancelCalls.some((call) => call.sessionId === 's1')],
    ['session cancel missing sessionId', { type: 'session-cancel' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'session-cancel'],
    ['continue after session cancel', { type: 'message', sessionId: 's1', text: '继续' }, (m) => { const p = api.promptCalls[api.promptCalls.length - 1]; return m.kind === 'sent' && m.sessionId === 's1' && p.sessionId === 's1' && p.content[0].text === '继续'; }],
    ['queue edit', { type: 'queue-update', sessionId: 's1', itemId: 'message-1', action: 'edit', text: ' 修改后的消息 ' }, (m) => { const p = api.queueUpdateCalls.at(-1); return m.kind === 'queue-item-updated' && m.accepted === true && m.action === 'edit' && p.itemId === 'message-1' && p.action.kind === 'edit' && p.action.content[0].text === ' 修改后的消息 '; }],
    ['queue remove', { type: 'queue-update', sessionId: 's1', itemId: 'message-2', action: 'remove' }, (m) => { const p = api.queueUpdateCalls.at(-1); return m.kind === 'queue-item-updated' && m.action === 'remove' && p.action.kind === 'remove'; }],
    ['queue steer', { type: 'queue-update', sessionId: 's1', itemId: 'message-3', action: 'steer' }, (m) => { const p = api.queueUpdateCalls.at(-1); return m.kind === 'queue-item-updated' && m.action === 'steer' && p.action.kind === 'steer'; }],
    ['queue edit empty text', { type: 'queue-update', sessionId: 's1', itemId: 'message-1', action: 'edit', text: '   ' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'queue-update'],
    ['queue update invalid action', { type: 'queue-update', sessionId: 's1', itemId: 'message-1', action: 'later' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'queue-update'],
    ['queue update missing itemId', { type: 'queue-update', sessionId: 's1', action: 'remove' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'queue-update'],
    ['session archive', { type: 'session-archive', sessionId: 's1' }, (m) => m.kind === 'session-archived' && m.sessionId === 's1' && m.archivedSessionIds.includes('s1') && api.archiveCalls.some((call) => call.sessionId === 's1')],
    ['session archive missing sessionId', { type: 'session-archive' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'session-archive'],
    ['session rename', { type: 'session-rename', sessionId: 's1', title: ' App 新名称 ' }, (m) => m.kind === 'session-renamed' && m.sessionId === 's1' && m.title === 'App 新名称' && m.seq === 95 && api.renameCalls.some((call) => call.sessionId === 's1' && call.title === ' App 新名称 ')],
    ['session rename empty title', { type: 'session-rename', sessionId: 's1', title: '   ' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'session-rename'],
    ['session rename missing sessionId', { type: 'session-rename', title: '新名称' }, (m) => m.kind === 'error' && m.code === 'bad-request' && m.requestType === 'session-rename'],
    ['models global (no sessionId)', { type: 'models' }, (m) => m.kind === 'models' && m.groups.length === 1 && m.groups[0].models[0].id === 'deepseek-chat' && m.current === undefined],
    ['providers', { type: 'providers' }, (m) => m.kind === 'providers' && m.providers[0].provider === 'deepseek'],
    ['missing sessionId', { type: 'history' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
  ]
  const results = [...interactionResults]
  let i = 0
  const sendNext = () => {
    if (i >= cases.length) { finish(); return }
    const [name, payload, check] = cases[i]
    const before = got.length
    ws.send(JSON.stringify(payload))
    waitFor(() => got.length > before, 3000).then((ok) => {
      const m = got[got.length - 1]
      const pass = ok && check(m)
      results.push([name, pass])
      console.log((pass ? 'PASS ' : 'FAIL ') + name, pass ? '' : JSON.stringify(m).slice(0, 160))
      i++
      sendNext()
    })
  }
  function finish() {
    const failed = results.filter(([, ok]) => !ok)
    console.log(failed.length === 0 ? '\nFULL GATEWAY DISPATCH TESTS PASSED (' + results.length + ')' : `\n${failed.length} FAILED`)
    ws.close(); disposer(); server.close()
    process.exit(failed.length === 0 ? 0 : 1)
  }
  sendNext()
})().catch((e) => { console.error(e); process.exit(1) })
