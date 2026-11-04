// 工具图片只传递持久附件引用，字节继续由 Host 的会话附件接口读取。
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function toolImages(data, type = 'tool/result') {
  const images = new Map()
  const add = attachment => {
    if (!attachment || typeof attachment.attachmentId !== 'string' || !attachment.attachmentId.trim()
      || !IMAGE_TYPES.has(attachment.mediaType)
      || !['bytes', 'width', 'height'].every(key => Number.isSafeInteger(attachment[key]) && attachment[key] > 0)) return
    const ref = {}
    for (const key of ['attachmentId', 'mediaType', 'bytes', 'width', 'height']) ref[key] = attachment[key]
    if (typeof attachment.name === 'string') ref.name = attachment.name
    images.set(ref.attachmentId, ref)
  }
  const visit = blocks => {
    if (!Array.isArray(blocks)) return
    for (const block of blocks) {
      if (block?.type === 'image') add(block.attachment)
      else if (block?.type === 'tool-result' && block.isError !== true) visit(block.content)
    }
  }
  // 失败结果不当作成功生图；成功批次仍可包含单项失败的文字。
  if (data.isError === true || data.message?.isError === true || data.error) return []
  visit(type === 'tool/result' ? data.message?.content : data.content)
  // dsh-image-gen 的普通调用还会持久化 presentation meta；兼容仅保留 meta 的结果。
  const meta = data.meta
  const candidates = meta?.kind === 'dsh-image-gen-batch' && Array.isArray(meta.images) ? meta.images : [meta]
  for (const candidate of candidates) {
    if (candidate?.kind === 'dsh-image-gen') add(candidate.attachment)
  }
  return [...images.values()]
}
