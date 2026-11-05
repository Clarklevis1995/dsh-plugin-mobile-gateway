import assert from 'node:assert/strict'
import { createDshHostAdapter, readHistoryRecords } from '../lib/dsh-host-adapter.mjs'
import { handleQuery, admitMessage } from '../lib/index.mjs'
import { serializeMessageText, messageTextParts } from '../lib/message-text.mjs'
import { createTestPeer } from './helpers/peer.mjs'

const parts = [{ type: 'text', text: '先看这里  ' }, { type: 'quote', text: '第一行\r\n第二行\n' },
  { type: 'quote', text: '另一个引用' }, { type: 'text', text: '  请解释' }]
const text = '先看这里\n\n> 第一行\n> 第二行\n> \n\n> 另一个引用\n\n请解释'
assert.equal(serializeMessageText(undefined, parts), text)
assert.equal(serializeMessageText(undefined, [{ type: 'quote', text: ' a \n' }]), '>  a \n> ')
assert.equal(messageTextParts(text).filter(part => part.type === 'quote').length, 2)
assert.equal(messageTextParts('```md\n> code\n```'), undefined)
assert.equal(messageTextParts('~~~~\n> code\n~~~\n> still code\n~~~~'), undefined)
assert.deepEqual(messageTextParts('```\n> code\n```\n> quote').at(-1), { type: 'quote', text: 'quote' })
for (const invalid of [[], [{ type: 'quote', text: ' ' }], [{ type: 'image', text: 'bad' }]]) {
  assert.throws(() => serializeMessageText(undefined, invalid))
}
assert.throws(() => serializeMessageText('duplicate', parts))

const calls = []
const task = { id: 't1', kind: 'rrule', rrule: 'FREQ=DAILY', title: '检查构建', prompt: '检查日志',
  target: { kind: 'session', sessionId: 's1' }, involvedSessionIds: ['s1'], status: 'active',
  scheduledAt: '2099-01-01T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z' }
const api = createDshHostAdapter({
  async invoke(call) {
    calls.push(call)
    const { namespace, method, args } = call
    if (namespace === 'session' && method === 'prompt') return { accepted: true }
    if (namespace === 'schedule') {
      if (method === 'catalog') return [task]
      if (method === 'list') return { items: [task], shown: 1, total: 1, limit: 10, offset: 0 }
      if (method === 'view') return args.request.id === task.id ? task : { id: args.request.id, code: 'schedule_not_found' }
      if (method === 'edit') {
        if (args.request.expectedUpdatedAt !== task.updatedAt) return { id: task.id, code: 'schedule_conflict' }
        return args.request.action === 'delete' ? { id: task.id, deleted: true } : { ...task, ...args.request.patch }
      }
      if (method === 'history') return { id: task.id, records: [] }
      if (method === 'deleteInactive') return { deleted: 2 }
      if (method === 'create') return { ...task, ...args.request }
      if (method === 'run') return { id: task.id, code: 'schedule_execution_pending' }
    }
    if (namespace === 'pluginManager') return { status: method === 'listVersions' ? 'listed' : 'none' }
    throw new Error(`unexpected endpoint ${namespace}/${method}`)
  },
  async *stream(call) {
    if (call.method === 'control') {
      yield { type: 'projection', sessionId: 's1', seq: 5, changes: [
        { key: 'todos', val: [] }, { key: 'goal', val: null }, { key: 'future', val: {} },
      ] }
    } else throw new Error('unexpected stream')
  },
}, createTestPeer())
const query = msg => handleQuery(api, api, null, msg)
const normalized = []
for await (const frame of api.openControlStream()) normalized.push(frame)
assert.deepEqual(normalized.map(frame => [frame.key, frame.value, frame.seq]), [['todos', [], 5], ['goal', null, 5], ['future', {}, 5]])

const sent = await admitMessage(api, { type: 'message', sessionId: 's1', requestId: 'quote-1', textParts: parts })
assert.equal(sent.kind, 'sent')
assert.equal(sent.requestId, 'quote-1')
assert.equal(calls.at(-1).args.request.requestId, 'quote-1')
assert.deepEqual(calls.at(-1).args.request.content, [{ type: 'text', text }])
const invalidCount = calls.length
assert.equal((await admitMessage(api, { type: 'message', sessionId: 's1', text: 'x', textParts: parts })).code, 'bad-request')
assert.equal(calls.length, invalidCount)
const event = { type: 'user/message', seq: 4, time: 1, data: { content: [{ type: 'text', text }], source: { kind: 'user', rpcId: 'quote-1' } } }
const [history] = readHistoryRecords([{ type: 'event', event }])
assert.deepEqual(history.data.textParts, messageTextParts(text))
assert.equal(event.data.textParts, undefined)

assert.equal((await query({ type: 'schedule-list', requestId: 'page', limit: 10, offset: 0 })).total, 1)
assert.deepEqual(calls.at(-1).args, { request: { limit: 10, offset: 0 } })
assert.equal((await query({ type: 'schedule-list', sessionId: 's2' })).items.length, 0)
assert.equal((await query({ type: 'schedule-list', sessionId: 's1' })).items.length, 1)
assert.equal((await query({ type: 'schedule-view', id: 't1' })).target.sessionId, 's1')
const edit = { type: 'schedule-edit', requestId: 'edit', id: 't1', action: 'update',
  expectedUpdatedAt: task.updatedAt, patch: { title: '新的标题', active: false } }
assert.equal((await query(edit)).title, '新的标题')
assert.deepEqual(calls.at(-1).args.request, { id: 't1', action: 'update', expectedUpdatedAt: task.updatedAt, patch: edit.patch })
assert.equal((await query({ ...edit, expectedUpdatedAt: null })).code, 'schedule_conflict')
assert.equal((await query({ ...edit, expectedUpdatedAt: undefined })).code, 'bad-request')
assert.equal((await query({ type: 'schedule-update', sessionId: 's1', id: 't1', expected: task, title: '新标题' })).updated, true)
const { updatedAt, ...withoutRevision } = task
assert.equal((await query({ type: 'schedule-update', sessionId: 's1', id: 't1', expected: withoutRevision, title: '新标题' })).updated, true)
assert.equal((await query({ type: 'schedule-update', id: 't1', expected: { ...withoutRevision, prompt: 'stale' }, title: '新标题' })).code, 'schedule_conflict')
const beforeScope = calls.length
assert.equal((await query({ ...edit, sessionId: 's2' })).code, 'schedule_not_found')
assert.equal(calls.length, beforeScope + 1)
assert.equal((await query({ type: 'schedule-delete', id: 't1', expectedUpdatedAt: task.updatedAt })).deleted, true)
assert.equal((await query({ type: 'schedule-run', id: 't1' })).code, 'schedule_execution_pending')
assert.equal((await query({ type: 'schedule-history', id: 't1', limit: 20 })).records.length, 0)
assert.equal((await query({ type: 'schedule-create', title: '提醒', prompt: '检查', timing: { kind: 'every', every_seconds: 3600 }, target: { kind: 'new' } })).target.kind, 'new')
assert.equal((await query({ type: 'schedule-delete-inactive' })).code, 'bad-request')
assert.equal((await query({ type: 'schedule-delete-inactive', confirm: true })).deleted, 2)
for (const msg of [
  { type: 'schedule-list', limit: 501 },
  { type: 'schedule-list', offset: -1 },
  { ...edit, patch: {} },
  { ...edit, patch: { active: 'false' } },
  { type: 'schedule-history', id: 't1', limit: 0 },
]) assert.equal((await query(msg)).code, 'bad-request')
for (const [msg, method, args] of [
  [{ type: 'plugin-versions', name: 'some-plugin', registry: null }, 'listVersions', { name: 'some-plugin', options: { registry: null } }],
  [{ type: 'plugin-detail', name: 'some-plugin', language: 'zh-CN' }, 'readBundleDetail', { name: 'some-plugin', language: 'zh-CN' }],
  [{ type: 'plugin-update', name: 'some-plugin', version: '1.2.3' }, 'updateBundle', { name: 'some-plugin', version: '1.2.3', options: { requestId: 'plugin-request' } }],
]) {
  const result = await query({ ...msg, requestId: 'plugin-request' })
  assert.equal(result.kind, msg.type === 'plugin-update' ? 'plugin-update-result' : msg.type)
  assert.equal(calls.at(-1).method, method)
  assert.deepEqual(calls.at(-1).args, args)
}
// 深历史附件固定同一日志切点，找到引用后才向 Host 请求图片。
const image = { attachmentId: 'sha256:image', mediaType: 'image/png', bytes: 10, width: 1, height: 1 }
const imageCalls = []
const imageApi = createDshHostAdapter({
  async invoke(call) {
    imageCalls.push(call)
    const request = call.args.request
    if (call.method === 'attachment') return { attachment: request.attachment, data: 'AA==' }
    if (request.beforeSeq === undefined) return { cursor: 10, hasMore: true,
      records: [{ type: 'event', event: { type: 'turn/end', seq: 10, data: {} } }] }
    return { cursor: 10, hasMore: false, records: [{ type: 'event', event: { type: 'user/message', seq: 1,
      data: { content: [{ type: 'image', attachment: image }] } } }] }
  }, async *stream() {},
}, createTestPeer())
assert.equal((await imageApi.sessions.attachment({ sessionId: 's1', attachmentId: image.attachmentId })).data, 'AA==')
assert.deepEqual(imageCalls[1].args.request, { address: { kind: 'session', sessionId: 's1' }, maxMessages: 100, beforeSeq: 10, throughSeq: 10 })
assert.deepEqual(imageCalls[2].args.request, { sessionId: 's1', attachment: image })
await assert.rejects(() => imageApi.sessions.attachment({ sessionId: 's1', attachmentId: 'foreign-image' }), { code: 'session/attachment-invalid' })
console.log('DSH 0.2.2 compatibility, quotes and management regression checks passed')
