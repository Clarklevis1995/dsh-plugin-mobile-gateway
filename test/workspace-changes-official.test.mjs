// DSH_INSTALL_ROOT=/path/to/@deepseek-ai/dsh node test/workspace-changes-official.test.mjs
// 官方 Connection 与 Deliverables 路由；工作区摘要服务使用可控 fixtures。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { createDshHostAdapter, DSH_VERSION } from '../lib/dsh-host-adapter.mjs'
import { handleQuery } from '../lib/index.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection')
const { apply } = await load('@deepseek-ai/dsh-client-ui-deliverables')
assert.equal(require('@deepseek-ai/dsh-client-ui-deliverables/package.json').version, DSH_VERSION)
const ctx = new Context()
const connection = new HostConnectionService(ctx, [], {})
const owner = connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
const guest = connection.createPeer({ principal: { kind: 'anonymous' }, interactions: 'none' })
const remote = { invoke() {}, stream() {} }
const host = createDshHostAdapter(remote, owner, connection)
const summary = { turn: 1, cwd: '/secret', snapshot: { before: 'tree-1', after: 'tree-2' },
  total: 1, added: 1, deleted: 1, files: [{ path: 'a.md', display: 'a.md', added: 1, deleted: 1 }] }
let live = true
const cleanup = []
try {
  // Buffered mode also describes absent routes: the probe must distinguish 404.
  assert.equal(await host.workspaceChanges.refresh(), false)
  apply({ connection, effect: fn => cleanup.push(fn), workspaceChanges: {
    summary(id, seq) { return live && id === 's1' && seq === 42 ? summary : undefined },
    async diff(id, seq, index, signal) {
      assert.equal(signal.aborted, false)
      return live && id === 's1' && seq === 42 && index === 0
        ? { kind: 'text', path: 'a.md', display: 'a.md', before: true, after: true, coarse: false,
          hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-a', '+b'] }] } : undefined
    },
  } })
  assert.equal(await host.workspaceChanges.refresh(), true)
  const send = (type, extra = {}) => handleQuery(host, null, null,
    { type: `workspace-changes-${type}`, sessionId: 's1', seq: 42, requestId: type, ...extra })
  const response = await send('summary')
  assert.equal(response.summary.files[0].added, 1)
  assert.equal(response.summary.cwd, undefined)
  assert.equal(response.summary.snapshot, undefined)
  assert.equal((await send('diff', { index: 0 })).diff.hunks[0].lines[1], '+b')
  assert.equal((await send('diff', { index: 1 })).code, 'workspace-changes-missing')
  const guestHost = createDshHostAdapter(remote, guest, connection)
  assert.equal(await guestHost.workspaceChanges.refresh(), false)
  // Real Connection must refuse a guest even when the caller bypasses probing.
  assert.equal((await connection.createSharedFetchHandler('/api').fetch(
    new Request('http://localhost/api/changes.summary?sessionId=s1&seq=42'), guest)).status, 403)
  live = false
  assert.equal((await send('summary')).code, 'workspace-changes-missing')
  console.log(`OFFICIAL WORKSPACE CHANGES ROUTE TESTS PASSED (DSH ${DSH_VERSION}; summary service fixtures)`)
} finally {
  for (const dispose of cleanup) await dispose()
  await owner.dispose()
  await guest.dispose()
  await ctx.fiber.dispose()
}
