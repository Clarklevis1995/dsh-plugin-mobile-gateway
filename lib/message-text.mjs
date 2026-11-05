/** 与 DSH Web 的 formatQuoteText 保持一致，引用以 Markdown 持久化。 */
export function serializeMessageText(text, textParts) {
  if (textParts === undefined) return typeof text === 'string' ? text.trim() : ''
  if (text !== undefined || !Array.isArray(textParts) || textParts.length < 1 || textParts.length > 100
    || textParts.some(part => !part || !['text', 'quote'].includes(part.type)
      || typeof part.text !== 'string' || (part.type === 'quote' && !part.text.trim()))) {
    throw new Error('textParts requires 1..100 text/quote parts and cannot be combined with text')
  }
  let result = ''
  let previousQuote = false
  for (const part of textParts) {
    if (part.type === 'quote') {
      if (!previousQuote) result = result.trimEnd()
      if (result) result += '\n\n'
      result += part.text.replace(/\r\n?/gu, '\n').split('\n').map(line => `> ${line}`).join('\n')
    } else {
      const next = previousQuote ? part.text.trimStart() : part.text
      if (previousQuote && next) result += '\n\n'
      result += result ? next : next.trimStart()
    }
    previousQuote = part.type === 'quote' || (previousQuote && !part.text.trim())
  }
  return previousQuote ? result : result.trimEnd()
}

/** 识别顶层块引用，保留代码围栏与原始正文，历史和实时使用同一规则。 */
export function messageTextParts(text) {
  const parts = []
  let fence
  let quoted = false
  for (const line of text.replace(/\r\n?/gu, '\n').split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    const quote = !fence && /^> /u.test(line)
    const type = quote ? 'quote' : 'text'
    const value = quote ? line.slice(2) : line
    const previous = parts.at(-1)
    if (previous?.type === type) previous.text += `\n${value}`
    else parts.push({ type, text: value })
    quoted ||= quote
    if (marker && !quote) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
    }
  }
  return quoted ? parts : undefined
}

export function userMessageTextParts(content = []) {
  return messageTextParts(content.filter(block => block?.type === 'text' && typeof block.text === 'string')
    .map(block => block.text).join(''))
}
