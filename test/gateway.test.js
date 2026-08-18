const http = require('node:http')
const plugin = require('/Users/lichaofan/DeepseekHarnessProject/dsh-plugin-mobile-gateway/lib/index.js')

const listeners = {}
let disposer = null
const server = http.createServer((req, res) => { res.writeHead(404); res.end() })
const webServer = {
  port: 18086,
  registerUpgrade(route) { server.on('upgrade', (req, socket, head) => route.handler(req, socket, head)); return () => {} },
}
function fakeApi() {
  const promptCalls = []
  const createCalls = []
  const settingsUpdates = []
  return {
    promptCalls,
    settingsUpdates,
    get _createCalls() { return createCalls },
    host: { async describe() { return { rpcId: 'r', result: { ok: true, value: { version: 't', cwd: '/Users/lichaofan', attachedSessions: 1, canOpenPath: true } } } } },
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
    },
    settings: {
      async describe() { return { rpcId: 'r', result: { ok: true, value: { writable: true, hasDocument: false, namespaces: [
        { ns: 'agent-presets', schema: { properties: {} }, value: { default: 'standard' }, revision: 1 },
        { ns: 'permission', schema: { properties: {} }, value: { defaultPreset: 'ask' }, revision: 1 },
      ] } } } },
      async update(req) { settingsUpdates.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { ns: req.payload.ns, value: req.payload.patch, revision: 2 } } } },
    },
    sessions: {
      async list() { return { rpcId: 'r', result: { ok: true, value: { items: [] } } } },
      async history() {
        const fakeEvents = [
          { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'hi' }] } },
          { type: 'assistant/chunk', seq: 2, time: 2, data: { turn: 1, step: 0, chunk: { type: 'text-delta', text: 'a' } } },
          { type: 'assistant/message', seq: 3, time: 3, data: { turn: 1, step: 0, message: { content: [{ type: 'text', text: 'hello' }] } } },
          { type: 'tool/call', seq: 4, time: 4, data: { turn: 1, step: 0, callId: 'c1', name: 'bash', arguments: '{}' } },
          { type: 'tool/result', seq: 5, time: 5, data: { turn: 1, step: 0, message: { source: { callId: 'c1' }, content: [{ type: 'tool-result', toolCallId: 'c1', content: [{ type: 'text', text: 'x'.repeat(5000) }] }] } } },
          { type: 'request/header', seq: 6, time: 6, data: { header: { system: 'sys'.repeat(2000) }, reason: 'initial' } },
          { type: 'assistant/message', seq: 7, time: 7, data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: 'done' }] } } },
        ]
        return { rpcId: 'r', result: { ok: true, value: { events: fakeEvents.map((e) => ({ event: e })), hasMore: false, projections: { asOfSeq: 42, values: { tokenUsage: { totals: { inputTokens: 10, outputTokens: 5 }, last: null }, contextPressure: { contextWindow: 128000, pressureTokens: 1500, surfaceTokens: 2000 }, permissions: { preset: 'ask', sandbox: 'none', approval: 'ask' }, sessionStats: { turns: 6, steps: 69, llmMs: 2280000, toolMs: 41400, ttftMs: 2600, ttftSteps: 1, decodeMs: 5000, decodeTokens: 385, lastTurn: 6, openStep: null, pendingCalls: {} } } } } } }
      },
      async search() { return { rpcId: 'r', result: { ok: true, value: { items: [], hasMore: false } } } },
      async models() { return { rpcId: 'r', result: { ok: true, value: { current: { provider: 'deepseek', model: 'deepseek-chat' }, routable: true, groups: [{ id: 'deepseek', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat', reasoning: { efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }], defaultEffort: 'low' } }] }], failures: [] } } } },
      async selectModel(req) { return { rpcId: 'r', result: { ok: true, value: { selected: req.payload } } } },
      async prompt(req) { promptCalls.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { accepted: true, command: { kind: 'success', text: 'switched to ' + (req.payload.content[0].text) } } } } },
      async create(req) { createCalls.push(req.payload); return { rpcId: 'r', result: { ok: true, value: { sessionId: 's-new-' + createCalls.length } } } },
      async fork(req) { return { rpcId: 'r', result: { ok: true, value: { sessionId: 's-branch-1' } } } },
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
ctx.apiProxy = api
const invokeCalls = []
const savedSelections = []
ctx.agentDefaultModel = {
  currentSelection() { return { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' } },
  async saveSelection(sel) { savedSelections.push(sel) },
}
ctx.typertGateway = {
  async invoke(req) {
    invokeCalls.push(req)
    if (req.args && req.args.line === '/permission missing') {
      throw { code: 'unknown-command', message: 'no such command' }
    }
    return { commandId: 'cmd-1', result: { kind: 'success', text: 'switched' } }
  },
}
plugin.apply(ctx)
server.listen(webServer.port)

const WebSocket = require('ws')
function waitFor(pred, timeout) { return new Promise((res) => { const t0 = Date.now(); const iv = setInterval(() => { if (pred()) { clearInterval(iv); res(true) } else if (Date.now() - t0 > timeout) { clearInterval(iv); res(false) } }, 20) }) }

;(async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${webServer.port}/ws/mobile`)
  const got = []
  ws.on('message', (d) => got.push(JSON.parse(d.toString())))
  await new Promise((r) => ws.once('open', r))
  await waitFor(() => got.length > 0, 2000)

  const cases = [
    ['workspaces', { type: 'workspaces' }, (m) => m.kind === 'workspaces'],
    ['sessions', { type: 'sessions' }, (m) => m.kind === 'sessions'],
    ['history+projections', { type: 'history', sessionId: 's1' }, (m) => m.kind === 'history' && m.sessionId === 's1' && m.projections && m.projections.values.tokenUsage && m.bytes > 0],
    ['history byte-capped', { type: 'history', sessionId: 's1', maxBytes: 300 }, (m) => m.kind === 'history' && m.bytes <= 350 && m.hasMore === true && typeof m.nextBeforeSeq === 'number' && m.events.length >= 1 && m.events[0].seq === m.nextBeforeSeq],
    ['history conversation trim', { type: 'history', sessionId: 's1', view: 'conversation', maxBytes: 200000 }, (m) => m.kind === 'history' && m.view === 'conversation' && !m.events.some((e) => e.type === 'assistant/chunk' || e.type === 'request/header') && m.events.some((e) => e.type === 'tool/result') && (() => { const tr = m.events.find((e) => e.type === 'tool/result'); const txt = tr.data.message.content[0].content[0].text; return txt.length <= 2001; })() && m.hasMore === false && m.nextBeforeSeq === undefined],
    ['search', { type: 'search', query: 'q' }, (m) => m.kind === 'search'],
    ['host', { type: 'host' }, (m) => m.kind === 'host'],
    ['directories', { type: 'directories', path: '/tmp' }, (m) => m.kind === 'directories'],
    ['workspace-create', { type: 'workspace-create', path: '/tmp' }, (m) => m.kind === 'workspace-create'],
    ['models', { type: 'models', sessionId: 's1' }, (m) => m.kind === 'models' && m.groups[0].models[0].reasoning.efforts.length === 2],
    ['select-model', { type: 'select-model', sessionId: 's1', provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }, (m) => m.kind === 'select-model' && m.selected.reasoningEffort === 'high'],
    ['select-model missing field', { type: 'select-model', sessionId: 's1', provider: 'deepseek' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['permission-options', { type: 'permission-options', sessionId: 's1' }, (m) => m.kind === 'permission-options' && m.namespace.ns === 'permission' && m.sessionPermissions && m.sessionPermissions.preset === 'ask'],
    ['permission', { type: 'permission', sessionId: 's1', name: 'code' }, (m) => m.kind === 'permission' && m.set === 'code' && m.commandId === 'cmd-1' && invokeCalls.some((c) => c.namespace === 'commands' && c.method === 'execute' && c.args.line === '/permission code' && c.args.agentId === 's1' && !('agent' in c.args)) && api.promptCalls.length === 0],
    ['permission missing name', { type: 'permission', sessionId: 's1' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['permission unknown command', { type: 'permission', sessionId: 's1', name: 'missing' }, (m) => m.kind === 'error' && m.code === 'unknown-command'],
    ['context-usage', { type: 'context-usage', sessionId: 's1' }, (m) => m.kind === 'context-usage' && m.tokenUsage.totals.inputTokens === 10 && m.contextPressure.contextWindow === 128000 && m.asOfSeq === 42],
['message create in workspace', { type: 'message', text: 'hi', workspaceId: 'w1' }, (m) => m.kind === 'sent' && api._createCalls.length >= 1 && JSON.stringify(api._createCalls[api._createCalls.length - 1]) === JSON.stringify({ workspaceId: 'w1' })],
    ['message create with cwd', { type: 'message', text: 'hi', cwd: '/tmp' }, (m) => m.kind === 'sent' && JSON.stringify(api._createCalls[api._createCalls.length - 1]) === JSON.stringify({ cwd: '/tmp' })],
    ['message create both -> workspaceId wins', { type: 'message', text: 'hi', workspaceId: 'w2', cwd: '/tmp' }, (m) => m.kind === 'sent' && JSON.stringify(api._createCalls[api._createCalls.length - 1]) === JSON.stringify({ workspaceId: 'w2' })],
    ['agent-presets', { type: 'agent-presets' }, (m) => m.kind === 'agent-presets' && m.presets.length === 2 && m.presets[0].isDefault === true],
    ['defaults', { type: 'defaults' }, (m) => m.kind === 'defaults' && m.agentPresetDefault === 'standard' && m.permissionDefault === 'ask'],
    ['set-default agent-preset', { type: 'set-default', target: 'agent-preset', value: 'minimal' }, (m) => m.kind === 'set-default' && m.applied === true && api.settingsUpdates.some((u) => u.ns === 'agent-presets' && u.patch.default === 'minimal')],
    ['set-default permission', { type: 'set-default', target: 'permission', value: 'code' }, (m) => m.kind === 'set-default' && m.applied === true && api.settingsUpdates.some((u) => u.ns === 'permission' && u.patch.defaultPreset === 'code')],
    ['set-default bad target', { type: 'set-default', target: 'nope', value: 'x' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['session-stats', { type: 'session-stats', sessionId: 's1' }, (m) => m.kind === 'session-stats' && m.sessionStats.turns === 6 && m.sessionStats.steps === 69 && m.sessionStats.llmMs === 2280000 && m.tokenUsage.totals.inputTokens === 10 && m.asOfSeq === 42],
    ['default-model', { type: 'default-model' }, (m) => m.kind === 'default-model' && m.selection.provider === 'deepseek' && m.selection.model === 'deepseek-chat' && m.selection.reasoningEffort === 'high'],
    ['save-default-model', { type: 'save-default-model', provider: 'deepseek', model: 'deepseek-reasoner', reasoningEffort: 'medium' }, (m) => m.kind === 'save-default-model' && m.saved.provider === 'deepseek' && m.saved.model === 'deepseek-reasoner' && m.saved.reasoningEffort === 'medium' && savedSelections.length === 1 && savedSelections[0].reasoningEffort === 'medium'],
    ['save-default-model missing fields', { type: 'save-default-model', provider: 'deepseek' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['fork', { type: 'fork', sessionId: 's1', atSeq: 42 }, (m) => m.kind === 'fork' && m.sessionId === 's-branch-1'],
    ['fork missing sessionId', { type: 'fork' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
    ['models global (no sessionId)', { type: 'models' }, (m) => m.kind === 'models' && m.groups.length === 1 && m.groups[0].models[0].id === 'deepseek-chat' && m.current === undefined],
    ['providers', { type: 'providers' }, (m) => m.kind === 'providers' && m.providers[0].provider === 'deepseek'],
    ['missing sessionId', { type: 'history' }, (m) => m.kind === 'error' && m.code === 'bad-request'],
  ]
  const results = []
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
