// 隔离官方发布包的真实流转换器；不访问模型服务或用户会话。
// DSH_INSTALL_ROOT=/path/to/@deepseek-ai/dsh node test/rc5-refusal-official.test.mjs
import assert from 'node:assert/strict'
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { DSH_VERSION } from '../lib/dsh-host-adapter.mjs'
import { assistantUsage, failureDetails } from '../lib/session-event-details.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
assert.equal(require('@deepseek-ai/dsh-llm-deepseek/package.json').version, DSH_VERSION)
// 此包只发布合并后的 JS；内部转换器使用发布包附带的原始 TS，由 Node 转译。
const source = pathToFileURL(require.resolve('@deepseek-ai/dsh-llm-deepseek/src/translate.ts'))
const sourceRoot = new URL('./', source).href
const hooks = registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(sourceRoot) && url.endsWith('.ts')) {
      return { format: 'module', shortCircuit: true,
        source: stripTypeScriptTypes(fs.readFileSync(new URL(url), 'utf8'), { mode: 'transform', sourceUrl: url }) }
    }
    return nextLoad(url, context)
  },
})
const { translate } = await import(source.href)
hooks.deregister()
const output = []
async function* events() {
  yield { type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 0 } } }
  yield { type: 'message_delta', usage: { output_tokens: 5 }, delta: {
    stop_reason: 'refusal', stop_details: { type: 'refusal', explanation: 'blocked image' },
  } }
  yield { type: 'message_stop' }
}
await assert.rejects(async () => {
  for await (const chunk of translate(events(), 'deepseek-v4-flash')) output.push(chunk)
}, error => {
  const wire = failureDetails(error)
  assert.equal(wire.code, 'CONTENT_REFUSED')
  assert.match(wire.message, /blocked image/)
  return true
})
assert.deepEqual(output.at(-1), { type: 'usage', usage: { inputTokens: 12, outputTokens: 5, totalTokens: 17 } })
assert.equal(output.some(chunk => chunk.type === 'finish'), false)
assert.deepEqual(assistantUsage({ stream: output.map(chunk => ({ type: 'chunk', chunk })) }), output.at(-1).usage)
console.log(`OFFICIAL REFUSAL CODE, EXPLANATION AND BILLED USAGE PASSED (DSH ${DSH_VERSION})`)
