// 使用已安装的官方 Gateway / Connection 验证 Peer 契约，不启动 DSH 或读写用户会话。
// DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDshHostAdapter, DSH_VERSION } from '../lib/dsh-host-adapter.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT to the installed official DSH directory')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const load = spec => import(pathToFileURL(require.resolve(spec)).href)
const { Context, Service } = await load('@deepseek-ai/cordis')
const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection')
const { TypertGatewayService } = await load('@deepseek-ai/dsh-api-gateway')
const { apply: installTurnOutline } = await load('@deepseek-ai/dsh-session-turn-outline')
assert.equal(require('@deepseek-ai/dsh-api-gateway/package.json').version, DSH_VERSION)

// 使用官方投影折叠生成大纲，验证预览和落定语义，并通过真实 Gateway 传输。
let outlineDefinition
installTurnOutline({ sessionProjections: { register(definition) { outlineDefinition = definition } } })
let outlineState = outlineDefinition.init()
const foldOutline = event => {
  outlineState = outlineDefinition.apply(outlineState, event)
  return outlineDefinition.wire.view(outlineState)
}
foldOutline({ type: 'turn/start', seq: 1, data: { turn: 0 } })
foldOutline({ type: 'user/message', seq: 2, data: {
  source: { kind: 'user' }, content: [{ type: 'text', text: '调整  输入框\n阴影' }],
} })
const pendingOutline = foldOutline({ type: 'assistant/message', seq: 3,
  data: { message: { content: [{ type: 'text', text: '已减轻  阴影。' }] } } })
assert.deepEqual(pendingOutline, [{ turn: 0, seq: 1, prompt: '调整 输入框 阴影', response: '' }])
const finalOutline = foldOutline({ type: 'turn/end', seq: 4, data: { turn: 0 } })
assert.deepEqual(finalOutline, [{ turn: 0, seq: 1, prompt: '调整 输入框 阴影', response: '已减轻 阴影。' }])

const ctx = new Context()
const peer = HostConnectionService.prototype.createPeer.call({ ctx }, {
  principal: { kind: 'owner' }, interactions: 'none',
})
const seen = []
const closed = []
class SessionFixture extends Service {
  constructor(ctx) {
    super(ctx, 'sessionController')
    this.typertRemote = { service: this, serviceKey: 'sessionController', namespace: 'session' }
  }
  list(_request, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    seen.push('list')
    return { items: [{ sessionId: 's1' }] }
  }
  async *follow(request, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    seen.push('follow')
    try {
      yield { type: 'snapshot', header: { version: 4, id: request.address.sessionId },
        cursor: 4, records: [], hasMore: false, projections: { asOfSeq: 4, values: { turnOutline: finalOutline } } }
      await new Promise(resolve => {
        signal.addEventListener('abort', resolve, { once: true })
        if (signal.aborted) resolve()
      })
    } finally { closed.push('follow') }
  }
  async *control(signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    seen.push('control')
    yield { type: 'baseline', value: { projections: {
      s1: { asOfSeq: 3, values: { turnOutline: pendingOutline } },
    } } }
    yield { type: 'projection', sessionId: 's1', key: 'turnOutline', seq: 4, value: finalOutline }
  }
}
class WorkspaceFixture extends Service {
  constructor(ctx) {
    super(ctx, 'workspaceController')
    this.typertRemote = { service: this, serviceKey: 'workspaceController', namespace: 'workspace' }
  }
  async *follow(signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    seen.push('workspace')
    yield { type: 'baseline', value: { items: [], archivedSessionIds: [] } }
  }
}
new SessionFixture(ctx)
new WorkspaceFixture(ctx)
// 只替换业务服务和描述符；调用、取消、Peer 生命周期均走官方实现。
const descriptors = new Map()
for (const [namespace, method, service, names, stream] of [
  ['session', 'list', 'sessionController', ['_request'], false],
  ['session', 'follow', 'sessionController', ['request'], true],
  ['session', 'control', 'sessionController', [], true],
  ['workspace', 'follow', 'workspaceController', [], true],
]) descriptors.set(`${namespace}/${method}`, {
  id: `${namespace}/${method}`, namespace, method, service,
  invocation: { kind: 'direct' },
  parameters: names.map(name => ({ name, wire: name, source: 'json', codec: { mode: 'src-json' } })),
  cancellation: { parameter: 'signal' }, result: { mode: 'src-json' },
  ...(stream ? { mode: 'stream' } : {}),
})
const registry = new Service(ctx, 'typert')
registry.local = { get: endpoint => descriptors.get(endpoint), hasSeen: () => false }
const gateway = new TypertGatewayService(ctx, TypertGatewayService.Config({}))

try {
  // 旧网关漏传 peer 时，官方 Gateway 确实抛出截图中的异常。
  await assert.rejects(() => gateway.invoke({ namespace: 'session', method: 'list', args: { _request: {} } }),
    /Cannot read properties of undefined \(reading 'signal'\)/)
  const host = createDshHostAdapter(gateway, peer)
  assert.deepEqual(await host.sessions.list(), { items: [{ sessionId: 's1' }] })
  const caller = new AbortController()
  const history = await host.sessions.history({ sessionId: 's1' }, caller.signal)
  assert.equal(history.cursor, 4)
  assert.deepEqual(history.projections.values.turnOutline, finalOutline)
  assert.equal(caller.signal.aborted, false)
  assert.deepEqual(closed, ['follow'], '读取首帧后应关闭官方订阅')
  assert.deepEqual(await host.workspace.list(), { items: [], archivedSessionIds: [] })
  const controls = []
  for await (const frame of await host.openControlStream(caller.signal)) controls.push(frame)
  assert.deepEqual(controls[0].value.projections.s1.values.turnOutline, pendingOutline)
  assert.deepEqual(controls[1], { type: 'projection', sessionId: 's1', key: 'turnOutline', seq: 4, value: finalOutline })
  const stream = await host.openSessionStream('s1', caller.signal)
  const iterator = stream[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value.type, 'snapshot')
  const pending = iterator.next()
  const ended = assert.rejects(pending, { code: 'gateway/cancelled' })
  await peer.dispose()
  await ended
  assert.equal(peer.signal.aborted, true)
  assert.equal(caller.signal.aborted, false)
  await assert.rejects(() => host.sessions.list(), { code: 'gateway/peer-disposed' })
  assert.deepEqual(seen, ['list', 'follow', 'workspace', 'control', 'follow'])
} finally {
  await peer.dispose()
}
console.log(`OFFICIAL HOST PEER AND TURN OUTLINE CONTRACT TESTS PASSED (DSH ${DSH_VERSION}; business fixtures)`)
