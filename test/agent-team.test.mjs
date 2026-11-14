import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import WebSocket from 'ws'
import plugin, { handleQuery, admitMessage } from '../lib/index.mjs'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { createTestPeer, createTestConnection } from './helpers/peer.mjs'

const child = { sessionId: 'scout', parentSessionId: 'lead', subagentMode: 'continuable' }
const team = { members: [
  { id: 'lead', name: 'lead', role: 'lead', phase: 'active' },
  { id: 'scout', name: 'footage-scout', role: 'teammate', phase: 'active' },
], tasks: [{ id: 'task-1', revision: 2, subject: '素材勘察', description: '逐帧分析',
  status: 'in_progress', ownerName: 'footage-scout', blockedBy: [], writeScopes: ['promo/analysis'],
  ready: false, writeScopeWarnings: [] }] }
const catalog = [{ id: 'scout', mode: 'continuable', label: '逐帧分析', createdAt: 1 },
  { id: 'external', mode: 'external', createdAt: 2 }]
const values = { agentTeam: team, subagentCatalog: catalog, todos: [{ content: '分析素材', status: 'pending' }] }
const calls = []
let projectionResult = { kind: 'sequenced', asOfSeq: 7, values }
const transport = {
  async invoke(call) {
    calls.push(call)
    if (call.method === 'projections') return projectionResult
    if (call.namespace === 'subagents') {
      const address = call.args.request ?? call.args
      if (address.parentSessionId !== 'lead') throw Object.assign(new Error('wrong parent'), { code: 'subagent/unauthorized' })
      return call.method === 'prompt' ? { messageId: 'accepted-1' } : { accepted: true }
    }
    if (call.method === 'page') return { records: [], hasMore: false }
    throw new Error(`unexpected ${call.namespace}/${call.method}`)
  },
  async stream(call) {
    calls.push(call)
    const address = call.args.request.address
    assert.equal(address.kind, 'subagent')
    assert.deepEqual(address, { kind: 'subagent', parentSessionId: 'lead', childSessionId: 'scout', mode: 'continuable' })
    return (async function* () {
      yield { type: 'snapshot', header: { id: 'scout', version: 4 }, cursor: 7,
        records: [], hasMore: false, projections: { asOfSeq: 7, values }, assistantStream: { revision: 0 } }
    })()
  },
}
const api = createDshHostAdapter(transport, createTestPeer(), undefined, { runtimeVersion: '0.2.2-rc.1' })
const query = msg => handleQuery(api, api, null, msg)

test('团队与子智能体投影保留原始字段、可用性和迁移语义', async () => {
  for (const [type, key] of [['agent-team', 'agentTeam'], ['subagents', 'subagentCatalog']]) {
    const frame = await query({ type, sessionId: 'lead', requestId: type })
    assert.equal(frame.requestId, type)
    assert.equal(frame.asOfSeq, 7)
    assert.equal(frame.projectionState, 'ready')
    assert.deepEqual(frame[key], values[key])
  }
  projectionResult = { kind: 'sequenced', asOfSeq: 8, values: {} }
  assert.equal((await query({ type: 'agent-team', sessionId: 'lead' })).projectionState, 'unavailable')
  projectionResult = { kind: 'sequenced', asOfSeq: 9, values: { subagentCatalog: [] } }
  assert.equal((await query({ type: 'subagents', sessionId: 'lead' })).projectionState, 'ready')
  projectionResult = { kind: 'migration-required', values }
  const migrating = await query({ type: 'agent-team', sessionId: 'lead' })
  assert.equal(migrating.projectionState, 'migration-required')
  assert.equal('asOfSeq' in migrating, false)
  projectionResult = null
  assert.equal((await query({ type: 'agent-team', sessionId: 'missing', requestId: 'missing' })).code, 'session/not-found')
  projectionResult = { kind: 'sequenced', asOfSeq: 7, values }
})

test('RC.3 团队无 members 的查询和畸形值校验', async () => {
  const raw = { enabled: true, tasks: team.tasks, failure: 'retained diagnostic' }
  projectionResult = { kind: 'sequenced', asOfSeq: 10, values: { agentTeam: raw, subagentCatalog: catalog } }
  const result = await query({ type: 'agent-team', sessionId: 'lead', requestId: 'rc3' })
  assert.equal(result.kind, 'agent-team')
  assert.equal(result.projectionState, 'ready')
  assert.deepEqual(result.agentTeam, { ...raw, members: [] })
  assert.equal(Object.hasOwn(raw, 'members'), false)
  assert.deepEqual((await query({ type: 'subagents', sessionId: 'lead' })).subagentCatalog, catalog)
  for (const invalid of [{ enabled: true, tasks: {} }, { tasks: [] }, { enabled: true, tasks: [], members: null }]) {
    projectionResult = { kind: 'sequenced', asOfSeq: 11, values: { agentTeam: invalid } }
    assert.equal((await query({ type: 'agent-team', sessionId: 'lead' })).kind, 'error')
  }
  projectionResult = { kind: 'sequenced', asOfSeq: 7, values }
})

test('RC.3 子会话请求使用新描述符并验证父子地址', async () => {
  const seen = []
  const modern = createDshHostAdapter({
    async *stream(call) {
      seen.push(call)
      if (call.args.request.address.parentSessionId !== 'lead') {
        throw Object.assign(new Error('wrong parent'), { code: 'subagent/unauthorized' })
      }
      yield { type: 'snapshot', header: { id: 'scout', version: 4 }, cursor: 1,
        records: [], hasMore: false, projections: { asOfSeq: 1, values: { agentTeam: { enabled: false, tasks: [] } } } }
    },
    async invoke(call) { seen.push(call); return call.method === 'prompt' ? { messageId: 'm3' } : { accepted: true } },
  }, createTestPeer(), undefined, { runtimeVersion: '0.2.2-rc.3' })
  await modern.sessions.prompt({ ...child, requestId: 'r3', mode: 'queue', content: [{ type: 'text', text: '继续' }] })
  assert.deepEqual(seen.at(-1).args.request, { requestId: 'r3', childSessionId: 'scout', delivery: 'queue', content: [{ type: 'text', text: '继续' }] })
  await modern.sessions.cancel(child)
  assert.equal(seen.at(-1).method, 'interruptByUser')
  assert.deepEqual(seen.at(-1).args, { childSessionId: 'scout' })
  const count = seen.filter(call => call.method === 'prompt').length
  await assert.rejects(() => modern.sessions.prompt({ ...child, parentSessionId: 'wrong', mode: 'queue', content: [] }), { code: 'subagent/unauthorized' })
  await assert.rejects(() => modern.sessions.cancel({ ...child, parentSessionId: 'wrong' }), { code: 'subagent/unauthorized' })
  assert.equal(seen.filter(call => call.method === 'prompt').length, count)
  assert.equal(seen.filter(call => call.method === 'interruptByUser').length, 1)
  const history = await modern.sessions.history(child)
  assert.deepEqual(history.projections.values.agentTeam, { enabled: false, tasks: [], members: [] })
})

test('RC.3 控制流的批量与旧式投影一致规范化，保留 null 失效语义', async () => {
  const raw = Object.freeze({ enabled: false, tasks: [], failure: 'diagnostic' })
  const host = createDshHostAdapter({
    invoke: async () => ({}),
    async *stream() {
      yield { type: 'projection', sessionId: 'lead', seq: 1, key: 'agentTeam', value: raw }
      yield { type: 'projection', sessionId: 'lead', seq: 2, changes: [
        { key: 'agentTeam', val: raw }, { key: 'todos', val: [] },
      ] }
      yield { type: 'projection', sessionId: 'lead', seq: 3, changes: [{ key: 'agentTeam', val: null }] }
    },
  }, createTestPeer())
  const frames = []
  for await (const frame of host.openControlStream()) frames.push(frame)
  assert.deepEqual(frames[0].value, { ...raw, members: [] })
  assert.deepEqual(frames[1].value, frames[0].value)
  assert.deepEqual(frames[2], { type: 'projection', sessionId: 'lead', seq: 2, key: 'todos', value: [] })
  assert.equal(frames[3].value, null)
  assert.equal(Object.hasOwn(raw, 'members'), false)
})

test('子会话历史、分页、独立待办和实时流使用官方父子地址', async () => {
  const history = await query({ type: 'history', ...child, requestId: 'h1', beforeSeq: 7, historyFormatVersion: 4 })
  assert.equal(history.kind, 'history')
  assert.equal(history.requestId, 'h1')
  assert.equal(history.parentSessionId, 'lead')
  assert.equal(calls.find(c => c.method === 'page').args.request.address.childSessionId, 'scout')
  const tasks = await query({ type: 'tasks', ...child, requestId: 'todos' })
  assert.deepEqual(tasks.todos, values.todos)
  assert.equal(tasks.requestId, 'todos')
  const stream = await api.openSessionStream('scout', new AbortController().signal, child)
  for await (const frame of stream) assert.equal(frame.header.id, 'scout')
})

test('子会话发消息和停止走专用官方接口，保留请求 ID 和图片', async () => {
  const image = { mediaType: 'image/png', data: 'aGVsbG8=', name: '参考.png' }
  const sent = await admitMessage(api, { type: 'message', ...child, text: '继续', images: [image],
    mode: 'steer', requestId: 'human-1', clientTimeZone: 'Asia/Shanghai' })
  assert.equal(sent.kind, 'sent')
  assert.equal(sent.messageId, 'accepted-1')
  const prompt = calls.find(c => c.namespace === 'subagents' && c.method === 'prompt')
  assert.deepEqual(prompt.args, { request: { requestId: 'human-1', parentSessionId: 'lead', childSessionId: 'scout',
    mode: 'continuable', delivery: 'steer', clientTimeZone: 'Asia/Shanghai',
    content: [{ type: 'image', ...image }, { type: 'text', text: '继续' }] } })
  assert.ok(prompt.peer.signal instanceof AbortSignal)
  const stopped = await query({ type: 'session-cancel', ...child, requestId: 'stop' })
  assert.equal(stopped.kind, 'session-cancelled')
  assert.equal(stopped.requestId, 'stop')
  assert.deepEqual(calls.find(c => c.method === 'interruptByParent').args,
    { parentSessionId: 'lead', childSessionId: 'scout', mode: 'continuable' })
  assert.equal((await admitMessage(api, { type: 'message', ...child, parentSessionId: 'wrong', text: '继续' })).code,
    'subagent/unauthorized')
  for (const subagentMode of ['one-shot', 'unknown']) {
    assert.equal((await admitMessage(api, { type: 'message', ...child, subagentMode, text: '继续' })).code, 'subagent/not-resumable')
    assert.equal((await query({ type: 'session-cancel', ...child, subagentMode })).code, 'subagent/not-resumable')
  }
  for (const patch of [{ parentSessionId: '' }, { parentSessionId: 'scout' }, { subagentMode: 'external' },
    { subagentMode: null }, { sessionId: '' }, { parentSessionId: undefined }]) {
    assert.equal((await query({ type: 'history', ...child, ...patch })).code, 'bad-request')
  }
  for (const patch of [{}, { images: [{}] }, { agentPreset: 'team', text: '继续' }]) {
    const error = await admitMessage(api, { type: 'message', ...child, requestId: 'invalid-1', ...patch })
    assert.equal(error.code, 'bad-request')
    assert.equal(error.requestId, 'invalid-1')
    assert.equal(error.sessionId, 'scout')
  }
  const stalePage = await query({ type: 'history', ...child, requestId: 'stale-page', beforeSeq: 7 })
  assert.equal(stalePage.code, 'history-format-mismatch')
  assert.equal(stalePage.requestId, 'stale-page')
})

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitUntil(predicate) {
  const end = Date.now() + 3000
  while (!predicate()) { assert.ok(Date.now() < end, '等待网关帧超时'); await delay(5) }
}

test('WebSocket 团队跨视图更新、重新连接基线和子视图切换', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-team-'))
  const rawValues = { ...values, agentTeam: { enabled: true, tasks: team.tasks } }
  const listeners = {}, controls = [], sockets = []
  let upgrade, dispose
  const server = http.createServer()
  server.on('upgrade', (req, socket, head) => upgrade.handler(req, socket, head))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const ctx = {
    webServer: { port: server.address().port, register() { return () => {} },
      registerUpgrade(route) { upgrade = route; return () => {} } },
    connection: createTestConnection(), agentDefaultModel: {},
    on(name, handler) { listeners[name] = handler; return () => {} },
    effect(factory) { dispose = factory() },
    typertGateway: {
      async invoke(call) {
        if (call.namespace === 'agentTeams') {
          assert.equal(call.method, 'setEnabled')
          assert.deepEqual(Object.keys(call.args).sort(), ['agentId', 'enabled'])
          rawValues.agentTeam = { ...rawValues.agentTeam, enabled: call.args.enabled }
          return undefined
        }
        if (call.method === 'projections' && call.args.request?.sessionId === 'lead') {
          return { kind: 'sequenced', asOfSeq: 7, values: rawValues }
        }
        return transport.invoke(call)
      },
      async stream(call) {
        if (call.namespace === 'session' && call.method === 'follow') {
          const address = call.args.request.address
          const id = address.childSessionId ?? address.sessionId
          return (async function* () {
            yield { type: 'snapshot', header: { id, version: 4 }, cursor: 7,
              records: [], hasMore: false, projections: { asOfSeq: 7, values: rawValues }, assistantStream: { revision: 0 } }
            while (!call.signal.aborted) await delay(5)
          })()
        }
        return (async function* () {
          yield { type: 'baseline', value: call.namespace === 'workspace'
            ? { items: [], archivedSessionIds: [] } : { projections: { lead: { asOfSeq: 7, values: rawValues } } } }
          while (!call.signal.aborted) {
            if (call.method === 'control' && controls.length) yield controls.shift()
            else await delay(5)
          }
        })()
      },
    },
  }
  plugin.apply(ctx, { gatewayEnabled: true, requireAuth: false, deviceFile: path.join(dir, 'devices.json') })
  t.after(async () => { sockets.forEach(s => s.terminate()); dispose();
    await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }) })
  async function connect(channel) {
    const frames = []
    const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/mobile`, { headers: { 'X-DSH-Channel': channel } })
    sockets.push(socket)
    socket.on('message', data => frames.push(JSON.parse(data.toString())))
    await waitUntil(() => frames.some(f => f.kind === 'hello'))
    return { socket, frames }
  }
  const control = await connect('control'), conversation = await connect('conversation')
  assert.ok(control.frames[0].capabilities.includes('agent-team-v1'))
  assert.ok(control.frames[0].capabilities.includes('agent-team-mode-v1'))
  for (const enabled of [false, true]) {
    const requestId = `mode-${enabled}`
    control.socket.send(JSON.stringify({type: 'agent-team-set-enabled', sessionId: 'lead', requestId, enabled}))
    await waitUntil(() => control.frames.some(f => f.kind === 'agent-team-mode-set' && f.requestId === requestId))
    const saved = control.frames.find(f => f.kind === 'agent-team-mode-set' && f.requestId === requestId)
    assert.equal(saved.agentTeam.enabled, enabled)
    assert.equal(saved.agentTeam.tasks.length, 1)
    assert.equal(saved.projectionState, 'ready')
  }
  await waitUntil(() => control.frames.some(f => f.kind === 'projection-baseline'))
  assert.deepEqual(control.frames.find(f => f.kind === 'projection-baseline').projections.lead.values.agentTeam,
    { ...rawValues.agentTeam, members: [] })
  conversation.socket.send(JSON.stringify({ type: 'subscribe', ...child, assistantStream: true }))
  await waitUntil(() => conversation.frames.some(f => f.kind === 'session-snapshot' && f.sessionId === 'scout'))
  const snapshot = conversation.frames.find(f => f.kind === 'session-snapshot')
  assert.equal(snapshot.parentSessionId, 'lead')
  assert.deepEqual(snapshot.projections.values.agentTeam, { ...rawValues.agentTeam, members: [] })
  const rawUpdated = { enabled: true, tasks: [{ ...team.tasks[0], revision: 3, status: 'completed' }] }
  const updated = { ...rawUpdated, members: [] }
  controls.push({ type: 'projection', sessionId: 'lead', changes: [{ key: 'agentTeam', val: rawUpdated }], seq: 8 })
  listeners['api-session/status']('scout', true)
  await waitUntil(() => control.frames.some(f => f.kind === 'agent-team-updated' && f.asOfSeq === 8))
  assert.ok(control.frames.some(f => f.kind === 'session-status' && f.sessionId === 'scout' && f.running))
  assert.equal(conversation.frames.some(f => f.kind === 'agent-team-updated'), false)
  const reconnected = await connect('control')
  await waitUntil(() => reconnected.frames.some(f => f.kind === 'projection-baseline'))
  assert.deepEqual(reconnected.frames.find(f => f.kind === 'projection-baseline').projections.lead.values.agentTeam, updated)
  conversation.socket.send(JSON.stringify({ type: 'subscribe', sessionId: 'lead', assistantStream: true }))
  await waitUntil(() => conversation.frames.some(f => f.kind === 'session-snapshot' && f.sessionId === 'lead'))
  const leadSnapshot = conversation.frames.find(f => f.kind === 'session-snapshot' && f.sessionId === 'lead')
  assert.notEqual(leadSnapshot.subscriptionId, snapshot.subscriptionId)
  control.socket.send(JSON.stringify({ type: 'history', ...child }))
  await waitUntil(() => control.frames.some(f => f.code === 'wrong-channel'))
  controls.push({ type: 'baseline', value: { projections: { lead: { asOfSeq: 9, values: {} } } } })
  await waitUntil(() => control.frames.some(f => f.kind === 'agent-team-updated' && f.asOfSeq === 9 && f.agentTeam === null))
})
