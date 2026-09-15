import assert from 'node:assert/strict'
import { stringifyWireFrame } from '../lib/wire-json.mjs'

const malformed = '为你鼓掌 ' + String.fromCharCode(0xd83d) + '…'
const source = { kind: 'sessions', items: [{ sessionId: 's1', projections: {
  values: { turnOutline: [{ response: malformed }] },
} }] }
const before = JSON.stringify(source)
const decoded = JSON.parse(stringifyWireFrame(source))
assert.equal(decoded.items[0].projections.values.turnOutline[0].response, '为你鼓掌 �…')
assert.equal(JSON.stringify(source), before, '不能修改输入或已缓存的投影')

for (const kind of ['session-snapshot', 'history', 'event', 'assistant-stream']) {
  const frame = { kind, sessionId: 's1', cursor: 10, text: '👏😀中文', literal: '\\ud83d',
    nested: [String.fromCharCode(0xdc4f), String.fromCharCode(0xd83d), '\\', '"', null, 1, false] }
  const result = JSON.parse(stringifyWireFrame(frame))
  assert.equal(result.text, frame.text)
  assert.equal(result.literal, frame.literal)
  assert.deepEqual(result.nested, ['�', '�', '\\', '"', null, 1, false])
  assert.equal(result.cursor, 10)
}
assert.equal(stringifyWireFrame({ text: '正常 👏', array: [1, true, null] }),
  JSON.stringify({ text: '正常 👏', array: [1, true, null] }))
console.log('PASS wire JSON: malformed previews, valid emoji, escaped literals, nested values, immutable input')
