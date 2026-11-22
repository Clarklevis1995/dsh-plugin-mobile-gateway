// 验证官方 RC.5 自动搜索的边界；提供方为内存替身，不调用真实搜索或收费服务。
// DSH_INSTALL_ROOT=/path/to/@deepseek-ai/dsh node test/rc5-search-official.test.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { DSH_VERSION } from '../lib/dsh-host-adapter.mjs'

assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
assert.equal(require('@deepseek-ai/dsh-web/package.json').version, DSH_VERSION)
const { Context } = await import(require.resolve('@deepseek-ai/cordis'))
const { WebRuntime } = await import(require.resolve('@deepseek-ai/dsh-web'))
const ctx = new Context()
const previous = process.env.DSH_WEB_SEARCH_PROVIDER
delete process.env.DSH_WEB_SEARCH_PROVIDER
let configured, selected
const available = new Set(['deepseek-official', 'deepseek-search-api'])
const web = new WebRuntime(ctx, { searchProvider: { get: () => configured }, fetchProvider: { get: () => undefined } })
const register = id => web.registerSearchProvider({ id, title: id,
  available: () => available.has(id),
  async search(request) { selected = id; return { query: request.query, sources: [], truncated: false } },
})
try {
  register('deepseek-official')
  register('deepseek-search-api')
  for (const [route, expected] of [['deepseek-official', 'deepseek-official'], ['deepseek-account', 'deepseek-official'],
    ['other', 'deepseek-search-api'], [undefined, 'deepseek-search-api']]) {
    await web.search({ query: 'fixture', ...(route === undefined ? {} : { llmProvider: route }) })
    assert.equal(selected, expected)
  }
  available.delete('deepseek-official')
  await web.search({ query: 'fixture', llmProvider: 'deepseek-official' })
  assert.equal(selected, 'deepseek-search-api', '自动模式中只有一个其他可用提供方时使用它')
  configured = 'deepseek-official'
  await assert.rejects(() => web.search({ query: 'fixture' }), { code: 'WEB_PROVIDER_CONFIGURED_UNAVAILABLE' })
  configured = 'deepseek-search-api'
  await web.search({ query: 'fixture', llmProvider: 'deepseek-official' })
  assert.equal(selected, configured, '显式配置优先于模型路由')
  configured = undefined
  available.add('custom')
  available.add('second-custom')
  register('custom')
  register('second-custom')
  await assert.rejects(() => web.search({ query: 'fixture', llmProvider: 'deepseek-official' }), { code: 'WEB_PROVIDER_AMBIGUOUS' })
} finally {
  await ctx.fiber.dispose()
  if (previous === undefined) delete process.env.DSH_WEB_SEARCH_PROVIDER
  else process.env.DSH_WEB_SEARCH_PROVIDER = previous
}
console.log(`OFFICIAL SEARCH ROUTING, EXPLICIT SELECTION AND AVAILABILITY PASSED (DSH ${DSH_VERSION})`)
