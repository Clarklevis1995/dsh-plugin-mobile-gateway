import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { createFileTransferManager } from '../lib/index.mjs'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { createTestPeer } from './helpers/peer.mjs'

const options = { fileDownloadsEnabled: true, fileDownloadMaxBytes: 1024,
  fileDownloadMaxTransfers: 4, fileDownloadChunkBytes: 3, fileDownloadIdleMs: 120000 }
const fail = (code) => { throw Object.assign(new Error(code), { code }) }

async function fixture(t, absolutePath) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gateway-external-'))
  const cwd = path.join(root, 'workspace')
  await fs.mkdir(cwd)
  const outside = absolutePath ?? path.join(root, 'deliver', '底部图标 前后.png')
  let version = 'opaque:v1'
  const bytes = Buffer.from('hello')
  const calls = []
  let refusal
  const metadata = () => ({ absolutePath: outside, version, bytes: bytes.length })
  const api = { sessions: { list: async () => ({ items: [{ sessionId: 's1', cwd }] }) }, files: {
    stat: async (args) => { calls.push(['stat', args]); if (refusal) fail(refusal); return metadata() },
    readBytes: async (args) => { calls.push(['readBytes', args]); if (refusal) fail(refusal)
      return { ...metadata(), offset: args.offset, data: bytes.subarray(args.offset, args.offset + args.length),
        eof: args.offset + args.length >= bytes.length } },
  } }
  const manager = createFileTransferManager(api, options)
  const client = {}
  t.after(async () => { await manager.dispose(); await fs.rm(root, { recursive: true, force: true }) })
  return { manager, client, outside, calls, api, cwd, bytes,
    change: () => { version = 'opaque:v2' }, deny: (code) => { refusal = code } }
}

for (const [label, absolute] of [['POSIX', undefined], ['Windows', String.raw`D:\DSH\04-临时\deliver\前 后.png`],
  ['UNC', String.raw`\\server\share\deliver\前 后.png`]]) {
  test(`${label}: resolves and downloads outside workspace through Host with SHA-256`, async (t) => {
    const f = await fixture(t, absolute)
    const resolved = await f.manager.handle(f.client, { type: 'file-resolve', sessionId: 's1', path: f.outside, requestId: 'r1' })
    assert.equal(resolved.kind, 'file-resolved')
    assert.equal(resolved.path, f.outside.replace(/\\/g, '/'))
    assert.equal(resolved.name, resolved.path.split('/').at(-1))
    assert.equal(resolved.modifiedAt, undefined) // Host version is opaque, never a fabricated mtime cache key.
    const opened = await f.manager.handle(f.client, { type: 'file-download-open', sessionId: 's1', path: resolved.path, requestId: 'o1' })
    assert.equal(opened.kind, 'file-download-opened')
    assert.equal(opened.path, resolved.path)
    const chunks = []
    for (let offset = 0; offset < f.bytes.length;) {
      const chunk = await f.manager.handle(f.client, { type: 'file-download-read', transferId: opened.transferId, offset })
      assert.equal(chunk.kind, 'file-download-chunk')
      const data = Buffer.from(chunk.data, 'base64'); chunks.push(data); offset += data.length
      if (chunk.eof) assert.equal(chunk.sha256, crypto.createHash('sha256').update(f.bytes).digest('hex'))
    }
    assert.deepEqual(Buffer.concat(chunks), f.bytes)
    assert.equal(f.calls.filter(([method]) => method === 'readBytes').length, 2)
    assert.ok(f.calls.every(([, args]) => args.sessionId === 's1'))
  })
}

test('never falls back to native reads when Host denies an existing external file', async (t) => {
  const f = await fixture(t)
  await fs.mkdir(path.dirname(f.outside)); await fs.writeFile(f.outside, 'native secret')
  f.deny('fs/read-denied')
  const denied = await f.manager.handle(f.client, { type: 'file-download-open', sessionId: 's1', path: f.outside, requestId: 'd1' })
  assert.equal(denied.code, 'file-not-allowed')
  assert.equal(denied.requestId, 'd1')
})

test('maps missing files and rejects oversized files and external directory listing', async (t) => {
  const f = await fixture(t)
  f.deny('workspace-file/not-found')
  assert.equal((await f.manager.handle(f.client, { type: 'file-resolve', sessionId: 's1', path: f.outside, requestId: 'r1' })).code, 'file-not-found')
  f.deny(null)
  f.api.files.stat = async () => ({ absolutePath: f.outside, version: 'v1', bytes: 1025 })
  assert.equal((await f.manager.handle(f.client, { type: 'file-download-open', sessionId: 's1', path: f.outside, requestId: 'o1' })).code, 'file-too-large')
  const before = f.calls.length
  assert.equal((await f.manager.handle(f.client, { type: 'file-list', sessionId: 's1', path: f.outside })).code, 'bad-request')
  assert.equal(f.calls.length, before)
  for (const input of ['../secret', f.outside + '/../secret', 'bad\0name']) {
    assert.equal((await f.manager.handle(f.client, { type: 'file-resolve', sessionId: 's1', path: input, requestId: 'r2' })).code, 'bad-request')
  }
})

test('rechecks version, permissions and client ownership for every chunk', async (t) => {
  const f = await fixture(t)
  const open = () => f.manager.handle(f.client, { type: 'file-download-open', sessionId: 's1', path: f.outside, requestId: 'o1' })
  const read = (client, id, offset = 0) => f.manager.handle(client, { type: 'file-download-read', transferId: id, offset })
  const opened = await open()
  assert.equal((await read({}, opened.transferId)).code, 'file-transfer-not-found')
  assert.equal((await read(f.client, opened.transferId)).kind, 'file-download-chunk')
  f.change()
  assert.equal((await read(f.client, opened.transferId, 3)).code, 'file-changed')
  assert.equal((await read(f.client, opened.transferId, 3)).code, 'file-transfer-not-found')
  const again = await open()
  f.deny('EACCES')
  assert.equal((await read(f.client, again.transferId)).code, 'file-not-allowed')
})

test('Host adapter binds workspace file scope to the session and forwards bounded byte range', async () => {
  const peer = createTestPeer()
  const calls = []
  const adapter = createDshHostAdapter({ invoke: async (call) => { calls.push(call); return {} }, stream: async () => {} }, peer)
  await adapter.files.stat({ sessionId: 's1', path: '/tmp/output.png' })
  await adapter.files.readBytes({ sessionId: 's1', path: '/tmp/output.png', offset: 3, length: 5 })
  assert.equal(calls[0].namespace, 'workspaceFiles')
  assert.equal(calls[0].method, 'stat')
  assert.deepEqual(calls[0].args, { workspaceFileScopeId: 's1', path: '/tmp/output.png' })
  assert.equal(calls[0].peer, peer)
  assert.equal(calls[1].method, 'readBytes')
  assert.deepEqual(calls[1].args, { workspaceFileScopeId: 's1', path: '/tmp/output.png', options: { range: { offset: 3, length: 5 } } })
})
