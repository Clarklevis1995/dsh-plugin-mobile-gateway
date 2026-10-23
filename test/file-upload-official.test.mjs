// DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/file-upload-official.test.mjs
// 使用官方流式路由、附件存储、凭证和 prompt 准入；所有文件均在临时目录。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import { createDshHostAdapter, DSH_VERSION } from '../lib/dsh-host-adapter.mjs'
import { createFileUploadManager } from '../lib/file-upload.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT to the installed official DSH directory')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context, Service } = await load('@deepseek-ai/cordis')
const { HostConnectionService } = await load('@deepseek-ai/dsh-client-connection')
const { FileUploads } = await load('@deepseek-ai/dsh-client-file-upload')
const { LocalAttachmentStore } = await load('@deepseek-ai/dsh-attachment-local')
const controllerUrl = pathToFileURL(require.resolve('@deepseek-ai/dsh-api-session-controller'))
const { SessionCommandController } = await import(new URL('./types/commands.js', controllerUrl).href)
assert.equal(require('@deepseek-ai/dsh-client-file-upload/package.json').version, DSH_VERSION)
const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-upload-official-'))
const ctx = new Context()
const connection = new HostConnectionService(ctx, [], {})
const peer = connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' })
const attachments = new LocalAttachmentStore(ctx, { dshHome: directory })
const agents = new Map()
const received = []
const agentService = new Service(ctx, 'agents')
agentService.get = id => agents.get(id)
const commands = new Service(ctx, 'commands')
commands.registerFileReceiptResolver = () => () => {}
const uploads = new FileUploads(ctx)
const makeAgent = id => ({ id, session: { header: {}, snapshotEvents: () => [] },
  inbox: { nextTurn: [], nextStep: [] },
  followup(message) { this.inbox.nextTurn.push(message); received.push(message) },
  steer(message) { this.inbox.nextStep.push(message); received.push(message) },
})
agents.set('s1', makeAgent('s1'))
agents.set('s2', makeAgent('s2'))
const host = createDshHostAdapter({ invoke: async () => ({}), stream: async () => (async function* () {})() }, peer, connection)
host.sessions.list = async () => ({ items: [{ sessionId: 's1' }, { sessionId: 's2' }] })
const manager = createFileUploadManager(host, { fileUploadChunkBytes: 4 })
const client = {}
const send = (type, args) => manager.handle(client, { type, requestId: crypto.randomUUID(), ...args })
try {
  assert.equal(host.files.available(), true)
  const bytes = Buffer.from('原始文件\0\xff')
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex')
  const opened = await send('file-upload-open', { sessionId: 's1', name: '移动附件.pdf', size: bytes.length, sha256 })
  assert.equal(opened.kind, 'file-upload-opened', JSON.stringify(opened))
  for (let offset = 0; offset < bytes.length; offset += 4) {
    assert.equal((await send('file-upload-chunk', { uploadId: opened.uploadId, offset,
      data: bytes.subarray(offset, offset + 4).toString('base64') })).kind, 'file-upload-chunk-accepted')
  }
  const completed = await send('file-upload-finish', { uploadId: opened.uploadId })
  assert.equal(completed.kind, 'file-upload-completed', JSON.stringify(completed))
  assert.equal(completed.file.attachmentId, `sha256:${sha256}`)
  assert.deepEqual(await fsp.readFile(attachments.fileHostPath(completed.file)), bytes)
  assert.deepEqual(uploads.resolve(agents.get('s1'), completed.receiptId), completed.file)
  assert.equal(uploads.resolve(agents.get('s2'), completed.receiptId), undefined)
  const promptContext = { ctx: { agents: agentService, attachments, fileUploads: uploads },
    resolveAgent: async id => agents.get(id) }
  const prompt = { sessionId: 's1', requestId: 'official-send', mode: 'queue',
    content: [{ type: 'file', receiptId: completed.receiptId }] }
  await SessionCommandController.prototype.prompt.call(promptContext, prompt, { kind: 'user', rpcId: prompt.requestId })
  assert.deepEqual(received[0].content, [{ type: 'file', attachment: completed.file }])
  uploads.observeSessionEvent(agents.get('s1').session, { type: 'user/message', data: {
    source: { kind: 'user', rpcId: prompt.requestId },
  } })
  assert.equal(uploads.resolve(agents.get('s1'), completed.receiptId), undefined)
  // 相同请求 ID 的重试由官方 inbox 幂等处理，不再次解析已退休凭证。
  await SessionCommandController.prototype.prompt.call(promptContext, prompt, { kind: 'user', rpcId: prompt.requestId })
  assert.equal(received.length, 1)
  await assert.rejects(() => SessionCommandController.prototype.prompt.call(promptContext,
    { ...prompt, sessionId: 's2', requestId: 'foreign-send' }, { kind: 'user', rpcId: 'foreign-send' }),
  { code: 'session/attachment-invalid' })
  console.log(`OFFICIAL FILE UPLOAD CONTRACT TESTS PASSED (DSH ${DSH_VERSION}; isolated temporary store and Agent fixtures)`)
} finally {
  await manager.dispose()
  await peer.dispose()
  await ctx.fiber.dispose()
  await fsp.rm(directory, { recursive: true, force: true })
}
