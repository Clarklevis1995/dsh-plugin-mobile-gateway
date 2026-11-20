const IMAGE_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

export function parseWireImages(rawImages, requestType) {
  const images = rawImages === undefined ? [] : rawImages
  if (!Array.isArray(images)) {
    return { error: { kind: 'error', code: 'bad-request', message: 'images must be an array', requestType } }
  }
  if (images.length > 20) {
    return { error: { kind: 'error', code: 'bad-request', message: 'a request can contain at most 20 images', requestType } }
  }
  const imageParts = []
  for (let index = 0; index < images.length; index++) {
    const image = images[index]
    if (!image || typeof image !== 'object') {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}] must be an object`, requestType } }
    }
    if (!IMAGE_MEDIA_TYPES.has(image.mediaType)) {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}].mediaType is unsupported`, requestType } }
    }
    if (typeof image.data !== 'string' || image.data.length === 0) {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}].data must be a non-empty base64 string`, requestType } }
    }
    if (image.name !== undefined && (typeof image.name !== 'string' || image.name.length > 255)) {
      return { error: { kind: 'error', code: 'bad-request', message: `images[${index}].name must be a string of at most 255 characters`, requestType } }
    }
    imageParts.push({
      type: 'image',
      mediaType: image.mediaType,
      data: image.data,
      ...(image.name ? { name: image.name } : {}),
    })
  }
  return { value: imageParts }
}
