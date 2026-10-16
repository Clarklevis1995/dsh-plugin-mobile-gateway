import assert from 'node:assert/strict'
import { assistantFinish, toolResultDetails, turnReasonDetails } from '../lib/session-event-details.mjs'
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
