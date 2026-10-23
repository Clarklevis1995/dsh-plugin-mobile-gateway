import assert from 'node:assert/strict'
import { test } from 'node:test'
import crypto from 'node:crypto'
import fsp from 'node:fs/promises'
import { createFileUploadManager } from '../lib/file-upload.mjs'
import { admitMessage, handleQuery } from '../lib/index.mjs'

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
function fixture(options = {}) {
  const stored = []
  const api = {
    sessions: { list: async () => ({ items: [{ sessionId: 's1' }, { sessionId: 's2' }] }) },
    files: { available: () => true, async upload({ sessionId, name, data }, signal) {
      const chunks = []
      for await (const chunk of data) { signal.throwIfAborted(); chunks.push(chunk) }
      const bytes = Buffer.concat(chunks)
      stored.push({ sessionId, name, bytes, spool: data.path })
      return { receiptId: `receipt-${stored.length}`, file: { attachmentId: `sha256:${digest(bytes)}`, name, bytes: bytes.length } }
    } },
  }
  const manager = createFileUploadManager(api, { fileUploadChunkBytes: 4, ...options })
  const client = {}
  let request = 0
  const send = (type, args = {}, owner = client) => manager.handle(owner, { type, requestId: `request-${++request}`, ...args })
  const open = (bytes, args = {}, owner = client) => send('file-upload-open',
    { sessionId: 's1', name: '说明.pdf', size: bytes.length, sha256: digest(bytes), ...args }, owner)
  const chunk = (uploadId, bytes, offset = 0, owner = client) => send('file-upload-chunk',
    { uploadId, offset, data: bytes.toString('base64') }, owner)
  return { api, manager, client, stored, send, open, chunk }
}

test('分块上传保持原始二进制，校验后存入官方附件并清理暂存；finish 可重试', async t => {
  const f = fixture()
  t.after(() => f.manager.dispose())
  const bytes = Buffer.from([0, 255, 1, 10, 13, 128, 42])
  const opened = await f.open(bytes)
  assert.equal(opened.kind, 'file-upload-opened')
  assert.equal(opened.chunkBytes, 4)
  assert.equal((await f.chunk(opened.uploadId, bytes.subarray(0, 4))).nextOffset, 4)
  assert.equal((await f.chunk(opened.uploadId, bytes.subarray(4), 4)).nextOffset, 7)
  assert.equal(f.stored.length, 0, '上传未完成不能取得 receipt')
  const finished = await f.send('file-upload-finish', { uploadId: opened.uploadId })
  assert.equal(finished.kind, 'file-upload-completed')
  assert.equal(finished.file.attachmentId, `sha256:${digest(bytes)}`)
  assert.equal(finished.sessionId, 's1')
  assert.deepEqual(f.stored[0].bytes, bytes)
  await assert.rejects(fsp.stat(f.stored[0].spool), { code: 'ENOENT' })
  const again = await f.send('file-upload-finish', { uploadId: opened.uploadId })
  assert.equal(again.receiptId, finished.receiptId)
  assert.notEqual(again.requestId, finished.requestId)
  assert.equal(f.stored.length, 1)
  assert.equal((await f.send('file-upload-finish', { uploadId: opened.uploadId }, {})).code, 'file-upload-not-found')
})

test('空文件和关闭配置', async t => {
  const f = fixture()
  t.after(() => f.manager.dispose())
  const opened = await f.open(Buffer.alloc(0))
  assert.equal((await f.send('file-upload-finish', { uploadId: opened.uploadId })).file.bytes, 0)
  const disabled = fixture({ fileUploadsEnabled: false })
  t.after(() => disabled.manager.dispose())
  assert.equal((await disabled.open(Buffer.alloc(0))).code, 'file-upload-disabled')
  f.api.files.available = () => false
  assert.equal((await f.open(Buffer.alloc(0))).code, 'file-upload-unavailable')
})

test('文件名、会话、大小、摘要与 requestId 校验', async t => {
  const f = fixture({ fileUploadMaxBytes: 8 })
  t.after(() => f.manager.dispose())
  for (const name of ['', '..', '../x', '/tmp/x', 'a\\b', 'a\0b', 'a\nb', 'x'.repeat(256)]) {
    assert.equal((await f.open(Buffer.alloc(0), { name })).code, 'bad-request', name)
  }
  assert.equal((await f.open(Buffer.alloc(9))).code, 'file-too-large')
  assert.equal((await f.open(Buffer.alloc(0), { size: -1 })).code, 'bad-request')
  assert.equal((await f.open(Buffer.alloc(0), { sha256: 'wrong' })).code, 'bad-request')
  assert.equal((await f.open(Buffer.alloc(0), { sessionId: 'unknown' })).code, 'session-not-found')
  assert.equal((await f.open(Buffer.alloc(0), { parentSessionId: 's2' })).code, 'subagent/attachment-invalid')
  assert.equal((await f.open(Buffer.alloc(0), { requestId: '' })).code, 'bad-request')
})

test('偏移、非法编码、分块大小与超量数据拒绝后仍可纠正；不完整 finish 保留进度', async t => {
  const f = fixture()
  t.after(() => f.manager.dispose())
  const bytes = Buffer.from('abc')
  const { uploadId } = await f.open(bytes)
  assert.equal((await f.chunk(uploadId, bytes, 1)).code, 'file-upload-offset')
  assert.equal((await f.send('file-upload-chunk', { uploadId, offset: 0, data: 'YQ' })).code, 'file-upload-invalid-data')
  assert.equal((await f.chunk(uploadId, Buffer.from('abcde'))).code, 'file-upload-invalid-data')
  assert.equal((await f.chunk(uploadId, Buffer.from('abcd'))).code, 'file-upload-size')
  assert.equal((await f.send('file-upload-finish', { uploadId })).code, 'file-upload-incomplete')
  assert.equal((await f.chunk(uploadId, bytes)).nextOffset, 3)
  assert.equal((await f.chunk(uploadId, bytes)).code, 'file-upload-offset')
  assert.equal((await f.send('file-upload-finish', { uploadId })).kind, 'file-upload-completed')
})

test('摘要错误不得调用 Host；不可跨连接操作；取消释放并发名额', async t => {
  const f = fixture({ fileUploadMaxTransfers: 1 })
  t.after(() => f.manager.dispose())
  const bytes = Buffer.from('abc')
  const { uploadId } = await f.open(bytes, { sha256: '0'.repeat(64) })
  assert.equal((await f.open(bytes)).code, 'file-upload-limit')
  assert.equal((await f.chunk(uploadId, bytes, 0, {})).code, 'file-upload-not-found')
  assert.equal((await f.send('file-upload-cancel', { uploadId }, {})).code, 'file-upload-not-found')
  await f.chunk(uploadId, bytes)
  assert.equal((await f.send('file-upload-finish', { uploadId })).code, 'file-upload-checksum')
  assert.equal(f.stored.length, 0)
  assert.equal((await f.send('file-upload-finish', { uploadId })).code, 'file-upload-not-found')
  const next = await f.open(bytes)
  assert.equal((await f.send('file-upload-cancel', { uploadId: next.uploadId })).kind, 'file-upload-cancelled')
  assert.equal((await f.open(bytes)).kind, 'file-upload-opened')
})

test('断开连接、超时和停止清理；新请求不能绕过已关闭的连接', async t => {
  const f = fixture({ fileUploadIdleMs: -1, fileUploadMaxTransfers: 1 })
  t.after(() => f.manager.dispose())
  const first = await f.open(Buffer.from('a'))
  await f.manager.expire()
  assert.equal((await f.chunk(first.uploadId, Buffer.from('a'))).code, 'file-upload-not-found')
  await f.open(Buffer.from('b'))
  await f.manager.closeClient(f.client)
  assert.equal((await f.open(Buffer.from('c'))).code, 'file-upload-cancelled')
  const other = {}
  assert.equal((await f.open(Buffer.from('d'), {}, other)).kind, 'file-upload-opened')
  await f.manager.dispose()
  assert.equal((await f.open(Buffer.from('e'), {}, other)).code, 'file-upload-cancelled')
})

test('Host 提交中取消会传播 signal，不能产生完成帧；同上传并发 finish 被拒绝', async t => {
  const f = fixture()
  t.after(() => f.manager.dispose())
  let started
  const ready = new Promise(resolve => { started = resolve })
  f.api.files.upload = async (_request, signal) => {
    started()
    await new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }) })
    signal.throwIfAborted()
  }
  const { uploadId } = await f.open(Buffer.alloc(0))
  const finishing = f.send('file-upload-finish', { uploadId })
  await ready
  assert.equal((await f.send('file-upload-finish', { uploadId })).code, 'file-upload-busy')
  const cancelled = f.send('file-upload-cancel', { uploadId })
  assert.equal((await finishing).code, 'file-upload-cancelled')
  assert.equal((await cancelled).kind, 'file-upload-cancelled')
})

test('并发 open 在异步查询前占用名额；断开尚未完成的 open 不泄漏名额', async t => {
  const f = fixture({ fileUploadMaxTransfers: 1 })
  t.after(() => f.manager.dispose())
  let release
  const gate = new Promise(resolve => { release = resolve })
  f.api.sessions.list = async () => { await gate; return { items: [{ sessionId: 's1' }] } }
  const opening = f.open(Buffer.alloc(0))
  assert.equal((await f.open(Buffer.alloc(0))).code, 'file-upload-limit')
  const closing = f.manager.closeClient(f.client)
  release()
  assert.equal((await opening).code, 'file-upload-cancelled')
  await closing
  assert.equal((await f.open(Buffer.alloc(0), {}, {})).kind, 'file-upload-opened')
})

test('文件凭证进入原生 prompt，支持纯文件与图文混合；拒绝跨目标与伪造引用结构', async () => {
  const calls = []
  const api = { sessions: { prompt: async payload => { calls.push(payload); return { accepted: true } } } }
  const files = [{ receiptId: 'receipt-1' }]
  assert.equal((await admitMessage(api, { type: 'message', sessionId: 's1', files, requestId: 'send-file-1' })).kind, 'sent')
  assert.equal(calls[0].requestId, 'send-file-1')
  assert.deepEqual(calls[0].content, [{ type: 'file', receiptId: 'receipt-1' }])
  await admitMessage(api, { type: 'message', sessionId: 's1', text: '请分析', files, requestId: 'send-file-2',
    images: [{ mediaType: 'image/png', data: 'AA==' }] })
  assert.deepEqual(calls[1].content.map(part => part.type), ['image', 'file', 'text'])
  for (const invalid of [[{ attachmentId: 'forged' }], [null], [{ receiptId: '' }], [files[0], files[0]]]) {
    assert.equal((await admitMessage(api, { type: 'message', sessionId: 's1', files: invalid })).code, 'bad-request')
  }
  assert.equal((await admitMessage(api, { type: 'message', files })).code, 'bad-request')
  assert.equal((await admitMessage(api, { type: 'message', sessionId: 'child', parentSessionId: 'parent',
    subagentMode: 'continuable', files })).code, 'subagent/attachment-invalid')
  assert.equal(calls.length, 2)
  assert.equal((await admitMessage(api, { type: 'message', sessionId: 's1', files })).code, 'bad-request')
  api.sessions.prompt = async () => { throw Object.assign(new Error('File was not uploaded for this session'), { code: 'session/attachment-invalid' }) }
  assert.equal((await admitMessage(api, { type: 'message', sessionId: 's2', files, requestId: 'send-file-3' })).code, 'session/attachment-invalid')
})

test('历史对话视图保留原生 file 附件', async () => {
  const content = [{ type: 'file', attachment: { attachmentId: 'opaque', name: '报告.pdf', bytes: 10 } }]
  const api = { sessions: { history: async () => ({ historyFormatVersion: 4, cursor: 1, hasMore: false,
    events: [{ event: { type: 'user/message', seq: 1, time: 1, data: { content } } }] }) } }
  const page = await handleQuery(api, null, null, { type: 'history', sessionId: 's1', view: 'conversation' })
  assert.deepEqual(page.events[0].data.content, content)
})
