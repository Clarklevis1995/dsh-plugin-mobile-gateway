import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { handleQuery } from '../lib/index.mjs'
import { createTestPeer } from './helpers/peer.mjs'

const summary = { turn: 3, total: 2, added: 2, deleted: 1,
  files: [{ path: '设计.md', display: '设计.md', added: 2, deleted: 1 }] }
const diff = { kind: 'text', path: '设计.md', display: '设计.md', before: true, after: true, coarse: false,
  hunks: [{ oldStart: 4, oldLines: 1, newStart: 4, newLines: 2, lines: ['-旧行', '+新行', '+'] }] }
const request = (type = 'summary', extra = {}) => ({ type: `workspace-changes-${type}`, requestId: 'r1',
  sessionId: 's /?#中文', seq: 160, ...(type === 'diff' ? { index: 0 } : {}), ...extra })
function fixture() {
  const peer = createTestPeer()
  const calls = []
  const state = { mounted: true, status: 200, value: undefined, body: undefined }
  const host = createDshHostAdapter({ invoke() {}, stream() {} }, peer, {
    createSharedFetchHandler(channel) {
      assert.equal(channel, '/api')
      return { async fetch(req, receiver) {
        assert.equal(receiver, peer)
        assert.equal(req.method, 'GET')
        const url = new URL(req.url)
        assert.ok(['/api/changes.summary', '/api/changes.diff'].includes(url.pathname))
        calls.push({ url, signal: req.signal })
        if (!state.mounted) return new Response('missing', { status: 404 })
        if (!url.searchParams.has('seq')) return new Response('invalid coordinates', { status: 400 })
        if (state.status !== 200) return new Response('error', { status: state.status })
        if (state.body) return new Response(state.body())
        return Response.json(state.value ?? (url.pathname.endsWith('summary') ? summary : diff))
      } }
    },
  })
  return { host, peer, calls, state }
}

test('固定认证路由探测、坐标编码、摘要与带行号差异', async () => {
  const { host, peer, calls } = fixture()
  try {
    assert.equal(host.workspaceChanges.available(), false)
    assert.equal(await host.workspaceChanges.refresh(), true)
    assert.equal(host.workspaceChanges.available(), true)
    for (const [type, value] of [['summary', summary], ['diff', diff]]) {
      const frame = await handleQuery(host, null, null, request(type))
      assert.deepEqual(frame, { kind: `workspace-changes-${type}`, requestId: 'r1', sessionId: 's /?#中文', seq: 160,
        ...(type === 'diff' ? { index: 0, diff: value } : { summary: value }) })
      const url = calls.at(-1).url
      assert.equal(url.searchParams.get('sessionId'), 's /?#中文')
      assert.equal(url.searchParams.get('seq'), '160')
    }
    assert.equal(calls.length, 4)
  } finally { await peer.dispose() }
})

test('参数错误在访问 Host 之前拒绝且保留请求坐标', async () => {
  const { host, peer, calls } = fixture()
  try {
    for (const extra of [{ requestId: '' }, { requestId: 'x'.repeat(129) }, { sessionId: ' ' }, { seq: -1 },
      { seq: 1.5 }, { seq: Number.MAX_SAFE_INTEGER + 1 }, { index: -1 }, { index: '0' }, { childSessionId: 'child' }]) {
      const frame = await handleQuery(host, null, null, request('diff', extra))
      assert.equal(frame.kind, 'error')
      assert.equal(frame.code, 'bad-request')
      assert.equal(frame.requestType, 'workspace-changes-diff')
    }
    assert.equal(calls.length, 0)
  } finally { await peer.dispose() }
})

test('路由未挂载、记录过期、认证与内部错误分别处理', async () => {
  const { host, state, peer } = fixture()
  try {
    state.mounted = false
    assert.equal(await host.workspaceChanges.refresh(), false)
    assert.equal((await handleQuery(host, null, null, request())).code, 'workspace-changes-unavailable')
    state.mounted = true
    assert.equal(await host.workspaceChanges.refresh(), true)
    for (const [status, code] of [[404, 'workspace-changes-missing'], [403, 'authentication-required'], [500, 'workspace-changes-failed']]) {
      state.status = status
      const frame = await handleQuery(host, null, null, request('diff'))
      assert.equal(frame.code, code)
      assert.equal(frame.requestId, 'r1')
      assert.equal(frame.seq, 160)
      assert.equal(frame.index, 0)
    }
  } finally { await peer.dispose() }
})

test('二进制、超限与粗略比较保留；内部快照字段不泄漏', async () => {
  const { host, state, peer } = fixture()
  try {
    for (const kind of ['binary', 'oversized']) {
      state.value = { kind, path: 'f', display: 'f', secret: 'omit' }
      assert.deepEqual((await handleQuery(host, null, null, request('diff'))).diff, { kind, path: 'f', display: 'f' })
    }
    state.value = { ...diff, coarse: true }
    assert.equal((await handleQuery(host, null, null, request('diff'))).diff.coarse, true)
    state.value = { ...summary, snapshot: { before: 'secret' }, cwd: '/private' }
    assert.deepEqual((await handleQuery(host, null, null, request())).summary, summary)
    for (const value of [{ ...diff, hunks: [{ ...diff.hunks[0], oldLines: 2 }] },
      { ...diff, hunks: [{ ...diff.hunks[0], lines: ['no prefix'] }] }, { ...diff, kind: 'unknown' }]) {
      state.value = value
      assert.equal((await handleQuery(host, null, null, request('diff'))).code, 'workspace-changes-failed')
    }
  } finally { await peer.dispose() }
})

test('分块限长、JSON 转义导致的 wire 超限与异常 JSON', async () => {
  const { host, state, peer } = fixture()
  try {
    let cancelled = false
    state.body = () => new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(256 * 1024)) },
      cancel() { cancelled = true },
    })
    assert.equal((await handleQuery(host, null, null, request())).code, 'workspace-changes-response-too-large')
    assert.equal(cancelled, true)
    // Raw UTF-8 fits; the correlated frame and JSON escaping exceed the budget.
    state.body = undefined
    state.value = { ...summary, files: [{ ...summary.files[0], path: '' }] }
    const baseBytes = Buffer.byteLength(JSON.stringify(state.value))
    state.value.files[0].path = '\\'.repeat(Math.floor((1024 * 1024 - 30 - baseBytes) / 2))
    assert.ok(Buffer.byteLength(JSON.stringify(state.value)) < 1024 * 1024)
    assert.equal((await handleQuery(host, null, null, request())).code, 'workspace-changes-response-too-large')
    state.body = () => '{invalid'
    assert.equal((await handleQuery(host, null, null, request())).code, 'workspace-changes-failed')
  } finally { await peer.dispose() }
})

test('连接取消会终止等待中的 body 并释放 reader', async () => {
  const { host, state, calls, peer } = fixture()
  try {
    await host.workspaceChanges.refresh()
    let cancelled = false
    state.body = () => new ReadableStream({ cancel() { cancelled = true } })
    const abort = new AbortController()
    const pending = handleQuery(host, null, null, request(), { signal: abort.signal })
    await new Promise(resolve => setImmediate(resolve))
    abort.abort()
    assert.equal((await pending).kind, 'error')
    assert.equal(calls.at(-1).signal.aborted, true)
    assert.equal(cancelled, true)
  } finally { await peer.dispose() }
})
