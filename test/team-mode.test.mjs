import assert from 'node:assert/strict'
import test from 'node:test'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { handleQuery } from '../lib/index.mjs'
import { createTestPeer, createTestConnection } from './helpers/peer.mjs'

function fixture({ version = '0.2.2-rc.3', failure } = {}) {
  const calls = [], peer = createTestPeer()
  let enabled = false
  const api = createDshHostAdapter({
    async invoke(call) {
      calls.push(call)
      if (call.namespace === 'agentTeams') {
        assert.equal(call.method, 'setEnabled')
        assert.deepEqual(Object.keys(call.args).sort(), ['agentId', 'enabled'])
        assert.equal(call.peer, peer)
        if (call.args.agentId === 'child') throw Object.assign(new Error('root required'), { code: 'TEAM_LEAD_REQUIRED' })
        if (failure) throw Object.assign(new Error(failure), { code: failure })
        enabled = call.args.enabled
        return undefined
      }
      assert.deepEqual(call.args, { request: { sessionId: 'lead' } })
      return { kind: 'sequenced', asOfSeq: 9, values: { agentTeam: { enabled, tasks: [{ id: 'history' }] } } }
    },
    async *stream() {},
  }, peer, createTestConnection(), { runtimeVersion: version })
  return { calls, api, query: msg => handleQuery(api, api, null, {
    type: 'agent-team-set-enabled', sessionId: 'lead', requestId: 'r1', enabled: true, ...msg,
  }) }
}

test('移动 Team 开关使用官方严格描述符，持久化后读取真实投影并保留历史任务', async () => {
  const f = fixture()
  assert.equal(f.api.agentTeams.available(), true)
  const on = await f.query({})
  assert.equal(on.kind, 'agent-team-mode-set')
  assert.equal(on.requestId, 'r1')
  assert.deepEqual(on.agentTeam, { enabled: true, tasks: [{ id: 'history' }], members: [] })
  const off = await f.query({ enabled: false, requestId: 'r2' })
  assert.equal(off.agentTeam.enabled, false)
  assert.equal(off.agentTeam.tasks.length, 1)
  assert.equal(off.asOfSeq, 9)
})

test('缺失布尔值、requestId、非法地址或额外子地址在写入前拒绝', async () => {
  for (const patch of [{ enabled: 'true' }, { enabled: null }, { enabled: undefined }, { requestId: '' },
    { requestId: undefined }, { sessionId: '' }, { parentSessionId: 'other' }, { subagentMode: 'continuable' }]) {
    const f = fixture()
    assert.equal((await f.query(patch)).code, 'bad-request')
    assert.equal(f.calls.length, 0)
  }
})

test('宿主拒绝子会话、权限和持久化失败，不返回虚假的成功投影', async () => {
  for (const [options, patch, code] of [[{}, { sessionId: 'child' }, 'TEAM_LEAD_REQUIRED'],
    [{ failure: 'FORBIDDEN' }, {}, 'FORBIDDEN'], [{ failure: 'flush-failed' }, {}, 'flush-failed']]) {
    const f = fixture(options)
    const result = await f.query(patch)
    assert.equal(result.kind, 'error')
    assert.equal(result.code, code)
    assert.equal(result.requestType, 'agent-team-set-enabled')
    assert.equal(result.requestId, 'r1')
    assert.equal(f.calls.length, 1)
  }
})

test('旧 RC.1 宿主保留只读团队能力，不提供模式写入', async () => {
  const f = fixture({ version: '0.2.2-rc.1' })
  assert.equal(f.api.agentTeams.available(), false)
  assert.equal((await f.query({})).code, 'unsupported')
  assert.equal(f.calls.length, 0)
})
