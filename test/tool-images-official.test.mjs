// DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/tool-images-official.test.mjs
// 使用真实附件存储及官方附件授权方法，不读取用户会话或调用生图服务。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import os from 'node:os'
import fsp from 'node:fs/promises'
import { toolImages } from '../lib/tool-images.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
const load = name => import(pathToFileURL(require.resolve(name)).href)
const { Context } = await load('@deepseek-ai/cordis')
const { LocalAttachmentStore } = await load('@deepseek-ai/dsh-attachment-local')
const sharp = require('sharp')
const controller = pathToFileURL(require.resolve('@deepseek-ai/dsh-api-session-controller'))
const { SessionCommandController } = await import(new URL('./types/commands.js', controller))
const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-tool-images-'))
const ctx = new Context()
try {
  const store = new LocalAttachmentStore(ctx, { dshHome: directory })
  const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#98bca0' } }).png().toBuffer()
  const attachment = await store.saveImage({ mediaType: 'image/png', name: '生成图片.png',
    data: png })
  for (const type of ['tool/result', 'tool/ptc-dispatch']) {
    const content = [{ type: 'image', attachment }]
    const event = { type, seq: 1, data: type === 'tool/result' ? { message: { content } } : { content } }
    const [image] = toolImages(event.data, type)
    const source = { ctx: { attachments: store }, readSessionState: async sessionId => ({
      events: sessionId === 'owner' ? [event] : [],
    }) }
    const request = { sessionId: 'owner', attachmentId: image.attachmentId }
    const result = await SessionCommandController.prototype.attachment.call(source, request)
    assert.equal(result.attachment.attachmentId, image.attachmentId)
    assert.ok(Buffer.from(result.data, 'base64').length > 0)
    await assert.rejects(() => SessionCommandController.prototype.attachment.call(source,
      { ...request, sessionId: 'other' }), error => error.code === 'session/attachment-invalid')
  }
  console.log('PASS official generated image storage, tool/PTC reads and cross-session denial')
} finally {
  await ctx.fiber.dispose()
  await fsp.rm(directory, { recursive: true, force: true })
}
