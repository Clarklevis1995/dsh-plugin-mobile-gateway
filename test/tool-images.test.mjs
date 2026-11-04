import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toolImages } from '../lib/tool-images.mjs'

const image = { attachmentId: 'sha256:generated', mediaType: 'image/png', bytes: 42,
  width: 1024, height: 768, name: '西湖.png' }
const block = { type: 'image', attachment: { ...image, data: 'must-not-leak', hostPath: '/secret' } }

test('普通、嵌套及批量工具图片保留引用，去重且不包含图片字节或主机路径', () => {
  assert.deepEqual(toolImages({ message: { content: [block, { type: 'tool-result', content: [block,
    { type: 'image', attachment: { ...image, attachmentId: 'second' } }] }] } }),
  [image, { ...image, attachmentId: 'second' }])
})

test('支持生图插件单图和批量持久化元数据', () => {
  const meta = { kind: 'dsh-image-gen', attachment: image }
  assert.deepEqual(toolImages({ meta }), [image])
  assert.deepEqual(toolImages({ meta: { kind: 'dsh-image-gen-batch', images: [meta, {}, meta] } }), [image])
  assert.deepEqual(toolImages({ meta: { kind: 'unknown', attachment: image } }), [])
})

test('兼容 PTC 和 code 子调用，不扫描文字路径或接受远程 URL、Base64', () => {
  for (const type of ['tool/ptc-dispatch', 'tool/code-dispatch']) {
    assert.deepEqual(toolImages({ content: [block] }, type), [image])
    assert.deepEqual(toolImages({ isError: true, content: [block] }, type), [])
  }
  for (const attachment of [{ ...image, width: 0 }, { ...image, bytes: -1 },
    { ...image, mediaType: 'image/svg+xml' }, { ...image, attachmentId: '' }]) {
    assert.deepEqual(toolImages({ message: { content: [{ type: 'image', attachment }] } }), [])
  }
  assert.deepEqual(toolImages({ message: { content: [{ type: 'text', text: '/tmp/generated.png' },
    { type: 'image', data: 'AA==', url: 'https://example.com/image.png' }] } }), [])
})

test('失败与畸形结果不生成图片卡片', () => {
  assert.deepEqual(toolImages({ message: { isError: true, content: [block] } }), [])
  assert.deepEqual(toolImages({ error: { code: 'failed' }, message: { content: [block] } }), [])
  assert.deepEqual(toolImages({ message: { content: [{ type: 'tool-result', isError: true, content: [block] }] } }), [])
  assert.deepEqual(toolImages({ message: { content: [null, {}] } }), [])
})
