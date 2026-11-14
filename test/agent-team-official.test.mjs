// 使用本机官方 Gateway、Connection 和生成的严格描述符；业务替身不读写真实会话。
// DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/agent-team-official.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createDshHostAdapter, DSH_VERSION } from '../lib/dsh-host-adapter.mjs'
assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const load = spec => import(pathToFileURL(require.resolve(spec)).href)
const { Context, Service } = await load('@deepseek-ai/cordis')
const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection')
const { TypertGatewayService } = await load('@deepseek-ai/dsh-api-gateway')
const { TYPERT: subagents } = await load('@deepseek-ai/dsh-subagent/typert')
const { TYPERT: agentTeams } = await load('@deepseek-ai/dsh-agent-team/typert')
const { TYPERT: sessions } = await load('@deepseek-ai/dsh-api-session-controller/typert')
assert.equal(require('@deepseek-ai/dsh-subagent/package.json').version, DSH_VERSION)
const descriptors = new Map([...subagents.invocations, ...sessions.invocations, ...agentTeams.invocations].map(d => [`${d.namespace}/${d.method}`, d]))
const ctx = new Context()
const peer = HostConnectionService.prototype.createPeer.call({ ctx }, { principal: { kind: 'owner' }, interactions: 'none' })
const seen = []
const { teamProjectionDefinition } = await import(new URL('./types/projection.js', pathToFileURL(require.resolve('@deepseek-ai/dsh-agent-team'))).href)
const team = teamProjectionDefinition.wire.view(teamProjectionDefinition.init({ id: 'lead' }, 0))
assert.equal('members' in team, false)
class SessionFixture extends Service {
  constructor(ctx) { super(ctx, 'sessionController'); this.typertRemote = { service: this, serviceKey: 'sessionController', namespace: 'session' } }
  projections(request, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    assert.deepEqual(request, { sessionId: 'lead' })
    seen.push('projections')
    return { kind: 'sequenced', asOfSeq: 7, values: { agentTeam: team, subagentCatalog: [] } }
  }
  async *follow(request, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    assert.deepEqual(request.address, { kind: 'subagent', parentSessionId: 'lead', childSessionId: 'scout', mode: 'continuable' })
    seen.push('follow')
    yield { type: 'snapshot', header: { version: 4, id: 'scout', createdAt: 1, isSeeded: false,
      origin: 'subagent', parentSession: 'lead' }, cursor: 7, records: [], hasMore: false,
      projections: { asOfSeq: 7, values: { subagentCatalog: [] } },
      ...(request.assistantStream ? { assistantStream: { revision: 0 } } : {}) }
  }
  page(request, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    assert.deepEqual(request.address, { kind: 'subagent', parentSessionId: 'lead', childSessionId: 'scout', mode: 'continuable' })
    assert.equal(request.throughSeq, 7)
    assert.equal(request.beforeSeq, 5)
    seen.push('page')
    return { records: [], hasMore: false }
  }
}
class SubagentFixture extends Service {
  constructor(ctx) { super(ctx, 'subagents'); this.typertRemote = { service: this, serviceKey: 'subagents', namespace: 'subagents' } }
  prompt(request, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(signal.aborted, false)
    assert.deepEqual(request, { requestId: 'human-1', childSessionId: 'scout',
      delivery: 'queue', content: [{ type: 'text', text: '继续' }], clientTimeZone: 'Asia/Shanghai' })
    seen.push('prompt')
    return { messageId: 'message-1' }
  }
  interruptByUser(childSessionId) {
    assert.equal(childSessionId, 'scout')
    seen.push('interrupt')
    return { accepted: true }
  }
}
class TeamFixture extends Service {
  constructor(ctx) { super(ctx, 'agentTeams'); this.typertRemote = { service: this, serviceKey: 'agentTeams', namespace: 'agentTeams' } }
  setEnabled(agentId, enabled, signal) {
    assert.equal(this.ctx.invocation.peer, peer)
    assert.equal(agentId, 'lead')
    assert.equal(signal.aborted, false)
    team.enabled = enabled
    seen.push('setEnabled')
  }
}
new TeamFixture(ctx)
new SessionFixture(ctx)
new SubagentFixture(ctx)
const registry = new Service(ctx, 'typert')
registry.lookups = new Map([['agent', {wire: 'agentId', wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId', resolve: id => id}]])
registry.local = { get: id => descriptors.get(id), hasSeen: () => false }
const gateway = new TypertGatewayService(ctx, TypertGatewayService.Config({}))
try {
  const api = createDshHostAdapter(gateway, peer)
  assert.deepEqual((await api.sessions.projections({ sessionId: 'lead' })).values.agentTeam, { ...team, members: [] })
  const target = { sessionId: 'scout', parentSessionId: 'lead', subagentMode: 'continuable' }
  const history = await api.sessions.history({ ...target, beforeSeq: 5 })
  assert.equal(history.cursor, 7)
  for await (const frame of await api.openSessionStream('scout', new AbortController().signal, target)) {
    assert.equal(frame.header.id, 'scout')
  }
  assert.deepEqual(await api.sessions.prompt({ ...target, requestId: 'human-1', mode: 'queue',
    content: [{ type: 'text', text: '继续' }], clientTimeZone: 'Asia/Shanghai' }), { messageId: 'message-1' })
  assert.deepEqual(await api.sessions.cancel(target), { accepted: true })
  assert.equal((await api.agentTeams.setEnabled({sessionId: 'lead', enabled: true})).agentTeam.enabled, true)
  assert.equal((await api.agentTeams.setEnabled({sessionId: 'lead', enabled: false})).agentTeam.enabled, false)
  assert.deepEqual(seen, ['projections', 'follow', 'page', 'follow', 'follow', 'prompt', 'follow', 'interrupt', 'setEnabled', 'projections', 'setEnabled', 'projections'])
} finally { await peer.dispose() }
console.log(`OFFICIAL AGENT TEAM DESCRIPTOR TESTS PASSED (DSH ${DSH_VERSION}; business fixtures)`)
