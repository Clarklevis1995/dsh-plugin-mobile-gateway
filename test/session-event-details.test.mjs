import assert from 'node:assert/strict'
import { assistantFinish, assistantUsage, toolResultDetails, turnReasonDetails } from '../lib/session-event-details.mjs'
import { handleQuery } from '../lib/index.mjs'

const tail = '\n[stderr]\nOperation not permitted\n[sandbox: file access denied under workspace-write mode]\n[exit code: 1]'
const output = 'command output\n' + 'x'.repeat(30_000) + tail
const data = { turn: 1, step: 0, message: { toolCallId: 'c', content: [{ type: 'text', text: output }] } }
const details = toolResultDetails(data)
assert.equal(details.outputTruncated, true)
assert.ok(details.output.startsWith('command output\n'))
assert.ok(details.output.endsWith(tail))
assert.ok(details.output.length < 16_100)
assert.equal(toolResultDetails({ message: { content: [
  { type: 'tool-result', isError: true, content: [{ type: 'text', text: 'nested error' }] },
] } }).output, 'nested error')
assert.equal(toolResultDetails({}).output, '')
assert.equal(assistantFinish({ stream: [{ type: 'text-chunks', texts: ['not a finish'] }] }), undefined)
assert.deepEqual(assistantFinish({ stream: [{ type: 'chunk', chunk: { type: 'finish',
  reason: { kind: 'aborted', failure: { message: 'Cancelled', code: 'ABORTED' } } } }] }),
{ kind: 'aborted', failure: { message: 'Cancelled', code: 'ABORTED' } })
assert.deepEqual(turnReasonDetails({ kind: 'aborted', reason: { kind: 'user' } }),
  { kind: 'aborted', reason: { kind: 'user' } })
const event = { type: 'tool/result', seq: 1, time: 1, data }
const api = { sessions: { history: async () => ({ historyFormatVersion: 4, events: [{ event }] }) } }
const history = await handleQuery(api, null, null, { type: 'history', sessionId: 's', view: 'conversation' })
assert.deepEqual(history.events[0].data.output, details.output)
assert.equal(history.events[0].data.outputTruncated, true)
assert.ok(history.events[0].data.message.content[0].text.length < 2100)
assert.equal(data.message.content[0].text, output)
console.log('SESSION EVENT DIAGNOSTICS TESTS PASSED')

// RC.4/RC.5 将拒答从 MALFORMED_RESPONSE 区分为 CONTENT_REFUSED。
// 精简历史不得在移除 stream 时丢失拒答原因，不能将其降为网络错误。
const refused = { message: 'DeepSeek refused to answer under its content safety review: blocked image', code: 'CONTENT_REFUSED' }
const billed = { inputTokens: 12, outputTokens: 5, totalTokens: 20, cacheReadTokens: 3 }
const attempt = { type: 'assistant/attempt', seq: 2, time: 2, data: { turn: 1, step: 0,
  stream: [
    { type: 'chunk', time: 1, chunk: { type: 'usage', usage: { inputTokens: 12, outputTokens: 1 } } },
    { type: 'chunk', time: 2, chunk: { type: 'usage', usage: billed } },
    { type: 'chunk', time: 2, chunk: { type: 'finish', reason: { kind: 'error', failure: refused } } },
  ] } }
const ended = { type: 'turn/end', seq: 3, time: 3, data: { turn: 1, reason: { kind: 'error', error: refused } } }
const refusalHistory = await handleQuery({ sessions: { history: async () => ({ historyFormatVersion: 4,
  events: [{ event: attempt }, { event: ended }] }) } }, null, null,
{ type: 'history', sessionId: 'refused-session', view: 'conversation' })
assert.deepEqual(refusalHistory.events[0].data.finish, { kind: 'error', failure: refused })
assert.deepEqual(turnReasonDetails(refusalHistory.events[1].data.reason), { kind: 'error', error: refused })
assert.equal('stream' in refusalHistory.events[0].data, false)
assert.deepEqual(refusalHistory.events[0].data.usage, billed)
assert.deepEqual(assistantUsage(attempt.data), billed)
assert.deepEqual(assistantUsage({ ...attempt.data, usage: { totalTokens: 20 } }), { totalTokens: 20 })
assert.equal(assistantUsage({ stream: [] }), undefined)
assert.deepEqual(assistantUsage({ stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } } }] }), { inputTokens: 0, outputTokens: 0 })
console.log('RC.5 REFUSAL HISTORY PRESERVATION PASSED')
