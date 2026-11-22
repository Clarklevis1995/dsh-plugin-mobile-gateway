// DSH_INSTALL_ROOT=/path/to/@deepseek-ai/dsh node test/phone-context-official.test.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { apply } from '../lib/phone-tools.mjs'
import { BROKERS } from '../lib/device-tools.mjs'
import { DSH_VERSION } from '../lib/dsh-host-adapter.mjs'
assert.ok(process.env.DSH_INSTALL_ROOT, 'Set DSH_INSTALL_ROOT')
const require = createRequire(path.join(process.env.DSH_INSTALL_ROOT, 'package.json'))
assert.equal(require('@deepseek-ai/dsh-tools/package.json').version, DSH_VERSION)
const { Context, Service } = await import(require.resolve('@deepseek-ai/cordis'))
const { ToolsService } = await import(require.resolve('@deepseek-ai/dsh-tools'))
const ctx = new Context()
const prompt = new Service(ctx, 'systemPrompt')
prompt.tools = () => () => {}
const tools = new ToolsService(ctx), agent = { id: 'phone-context-agent' }
const previous = globalThis[BROKERS]
let enabled = true
try {
  globalThis[BROKERS] = new Map([['gateway', { phoneContextEnabled: () => enabled }]])
  tools.register({ name: 'other_tool', description: 'Unrelated tool', parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'object' }, render: () => [] }, execute: async () => ({}) })
  apply({ tools, on: () => () => {}, systemPrompt: { context() {} }, attachments: {} }, { gatewayId: 'gateway' })
  const context = { agent, signal: new AbortController().signal, modelSelection: {} }
  for (const value of [true, false, true]) {
    enabled = value
    const selection = await tools.resolve(context)
    try {
      const schemas = tools.schemas(agent, selection)
      const bindings = tools.definitions(agent, selection)
      assert.equal(schemas.some(tool => tool.name === 'other_tool'), true)
      assert.equal(schemas.some(tool => tool.name.startsWith('phone_')), value)
      assert.equal(bindings.some(tool => tool.name.startsWith('phone_')), value)
      if (!value) assert.deepEqual(schemas.map(tool => tool.name), ['other_tool'])
    } finally { selection.dispose() }
  }
} finally { globalThis[BROKERS] = previous; await ctx.fiber.dispose() }
console.log(`OFFICIAL PHONE CONTEXT TOOL SELECTION PASSED (DSH ${DSH_VERSION}; schemas and program bindings)`)
