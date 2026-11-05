// 使用候选版发布包的 Gateway、Connection 和严格参数描述符，业务数据位于内存。
// DSH_INSTALL_ROOT=/path/to/@deepseek-ai/dsh node test/dsh-022-official.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createDshHostAdapter, DSH_VERSION } from '../lib/dsh-host-adapter.mjs'
import { handleQuery } from '../lib/index.mjs'
assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const load = name => import(require.resolve(name))
const { Context, Service } = await load('@deepseek-ai/cordis')
const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection')
const { TypertGatewayService } = await load('@deepseek-ai/dsh-api-gateway')
const descriptors = new Map()
for (const pkg of ['dsh-schedule', 'dsh-plugin-manager', 'dsh-api-session-controller']) {
  assert.equal(require(`@deepseek-ai/${pkg}/package.json`).version, DSH_VERSION)
  const { TYPERT } = await load(`@deepseek-ai/${pkg}/typert`)
  for (const d of TYPERT.invocations) descriptors.set(`${d.namespace}/${d.method}`, d)
}
const ctx = new Context()
const peer = HostConnectionService.prototype.createPeer.call({ ctx }, { principal: { kind: 'owner' }, interactions: 'none' })
const seen = []
const task = { id: 't1', kind: 'every', title: '提醒', prompt: '检查', everySeconds: 3600,
  target: { kind: 'session', sessionId: 's1' }, involvedSessionIds: ['s1'], status: 'active',
  scheduledAt: '2099-01-01T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' }
class ScheduleFixture extends Service {
  constructor(ctx) { super(ctx, 'schedule'); this.typertRemote = { service: this, serviceKey: 'schedule', namespace: 'schedule' } }
  catalog() { return [task] }
  remoteList(request) { seen.push(request); return { items: [task], shown: 1, total: 1, limit: 10, offset: 0 } }
  view() { return task }
  remoteCreate(request) { seen.push(request); return task }
  remoteEdit(request) { seen.push(request); return request.action === 'delete' ? { id: task.id, deleted: true } : { ...task, ...request.patch } }
  run(request) { seen.push(request); return { id: task.id, code: 'schedule_execution_pending' } }
  remoteHistory() { return { id: task.id, records: [], earlierRecordsUnavailable: false, earlierRecordsPruned: false, retention: { days: 30, records: 200 } } }
  deleteInactive() { return { deleted: 0 } }
}
class PluginFixture extends Service {
  constructor(ctx) { super(ctx, 'pluginManager'); this.typertRemote = { service: this, serviceKey: 'pluginManager', namespace: 'pluginManager' } }
  listVersions(name, options) { seen.push({ name, options }); return { status: 'listed', installed: '1.0.0', registry: null, attempts: [], versions: [], omitted: 0 } }
  readBundleDetail(name, language) { seen.push({ name, language }); return { status: 'found', origin: 'readme', path: 'README.md', markdown: '# Details' } }
  updateBundle(name, version, options) { seen.push({ name, version, options }); return { from: '1.0.0', to: version, step: 'install', result: { changed: true, application: 'applied', stage: 'install', target: name } } }
}
class SessionFixture extends Service {
  constructor(ctx) { super(ctx, 'sessionController'); this.typertRemote = { service: this, serviceKey: 'sessionController', namespace: 'session' } }
  async *control() { yield { type: 'projection', sessionId: 's1', seq: 5, changes: [{ key: 'todos', val: [] }, { key: 'goal', val: null }] } }
}
new ScheduleFixture(ctx)
new PluginFixture(ctx)
new SessionFixture(ctx)
const registry = new Service(ctx, 'typert')
registry.local = { get: id => descriptors.get(id), hasSeen: () => false }
const gateway = new TypertGatewayService(ctx, TypertGatewayService.Config({}))
const api = createDshHostAdapter(gateway, peer)
const query = msg => handleQuery(api, api, null, msg)
try {
  const first = await query({ type: 'schedule-list', limit: 10, offset: 0 })
  assert.equal(first.total, 1, JSON.stringify(first))
  assert.equal((await query({ type: 'schedule-list', sessionId: 's1' })).items.length, 1)
  assert.equal((await query({ type: 'schedule-create', title: '提醒', prompt: '检查', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'new' } })).id, 't1')
  assert.equal((await query({ type: 'schedule-edit', id: 't1', action: 'update', expectedUpdatedAt: task.updatedAt, patch: { active: false } })).status, 'active')
  assert.equal((await query({ type: 'schedule-edit', id: 't1', action: 'delete', expectedUpdatedAt: task.updatedAt })).deleted, true)
  assert.equal((await query({ type: 'schedule-history', id: 't1', limit: 20 })).records.length, 0)
  assert.equal((await query({ type: 'schedule-run', id: 't1' })).code, 'schedule_execution_pending')
  assert.equal((await query({ type: 'schedule-delete-inactive', confirm: true })).deleted, 0)
  assert.equal((await query({ type: 'plugin-versions', requestId: 'v1', name: 'example', registry: null })).result.status, 'listed')
  assert.equal((await query({ type: 'plugin-detail', requestId: 'd1', name: 'example', language: 'zh-CN' })).result.markdown, '# Details')
  assert.equal((await query({ type: 'plugin-update', requestId: 'u1', name: 'example', version: '1.1.0' })).result.result.application, 'applied')
  assert.deepEqual(seen.at(-1), { name: 'example', version: '1.1.0', options: { requestId: 'u1' } })
  const frames = []
  for await (const frame of api.openControlStream()) frames.push(frame)
  assert.deepEqual(frames.map(frame => frame.key), ['todos', 'goal'])
  console.log(`OFFICIAL MANAGEMENT DESCRIPTOR TESTS PASSED (DSH ${DSH_VERSION}; in-memory business fixtures)`)
} finally { await peer.dispose(); await ctx.fiber.dispose() }
