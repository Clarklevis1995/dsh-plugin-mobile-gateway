import assert from 'node:assert/strict'
import { createDshHostAdapter } from '../lib/dsh-host-adapter.mjs'
import { handleQuery } from '../lib/index.mjs'

const calls = []
const gateway = {
  async invoke(call) {
    calls.push(call)
    const key = `${call.namespace}/${call.method}`
    if (key === 'pluginInventory/list') return { managementAvailable: true, entries: [] }
    if (key === 'pluginManager/listBundles') return [
      { name: '@deepseek-ai/dsh-experimental-agent-team', optional: true, installed: false, enabled: false, rows: [] },
      { name: 'third-party', optional: false, installed: true, enabled: true, rows: [] },
    ]
    if (key === 'pluginManager/listPlugins') return [{ entryId: 'entry-1', enabled: true }]
    if (key === 'settings/describe') return { writable: true, hasDocument: true, namespaces: [
      { ns: 'bash-sandbox', revision: 2, schema: {}, value: {}, secrets: [] },
      { ns: 'web-search-deepseek', revision: 4, schema: {}, value: {}, secrets: [] },
    ] }
    if (key === 'pluginManager/inspect') return { status: 'accepted', kind: 'registry', name: 'example' }
    if (key === 'pluginManager/waitForInstall') return null
    if (key === 'pluginManager/cancelInstall') return { status: 'cancelled' }
    if (key === 'pluginManager/registries') return { registry: null, fallbackRegistries: [], resolved: null }
    if (key === 'pluginManager/listVersionExemptions') return { exemptions: {}, warnings: [] }
    if (key === 'settings/mutate') return { ns: call.args.ns, revision: 3, value: {} }
    return { changed: true, application: 'applied', stage: 'enable', target: 'example' }
  },
  async stream() { throw new Error('unexpected stream') },
}
const api = createDshHostAdapter(gateway)
const query = msg => handleQuery(api, api, null, msg)

const catalog = await query({ type: 'plugin-catalog', requestId: 'catalog-1' })
assert.equal(catalog.managementAvailable, true)
assert.equal(catalog.bundles.length, 2)
assert.equal(catalog.bundles[0].experimental, true)
assert.equal(catalog.bundles[1].experimental, false)
assert.equal(catalog.bundles[0].name, '@deepseek-ai/dsh-experimental-agent-team')
assert.deepEqual(catalog.officialItems, [
  { id: 'shell', namespaces: ['bash-sandbox'] },
  { id: 'web-search', namespaces: ['web-search-deepseek'] },
])
assert.deepEqual((await query({ type: 'plugin-registries', requestId: 'registries-1' })).fallbackRegistries, [])
assert.deepEqual(await query({ type: 'plugin-inspect', requestId: 'inspect-1', spec: 'example', registry: null }), {
  kind: 'plugin-inspection', requestId: 'inspect-1',
  result: { status: 'accepted', kind: 'registry', name: 'example' },
})
assert.deepEqual(calls.at(-1).args, { spec: 'example', options: { registry: null } })

const lifecycle = []
const installed = await handleQuery(api, api, null,
  { type: 'plugin-install', requestId: 'install-1', spec: 'example', approvedBuilds: ['dependency'] },
  { onInstallStart: id => lifecycle.push(['start', id]), onInstallEnd: id => lifecycle.push(['end', id]) })
assert.equal(installed.kind, 'plugin-install-result')
assert.deepEqual(lifecycle, [['start', 'install-1'], ['end', 'install-1']])
assert.deepEqual(calls.at(-1).args, { spec: 'example', options: { requestId: 'install-1', approvedBuilds: ['dependency'] } })
assert.deepEqual((await query({ type: 'plugin-install-status', requestId: 'status-1', installId: 'install-1' })).result, null)
assert.deepEqual((await query({ type: 'plugin-install-cancel', requestId: 'cancel-1', installId: 'install-1' })).result,
  { status: 'cancelled' })
assert.deepEqual((await query({ type: 'plugin-bundle-set-enabled', requestId: 'toggle-1', name: 'official-team', enabled: true })).result.application, 'applied')
assert.deepEqual(calls.at(-1).args, { name: 'official-team', enabled: true })
await query({ type: 'plugin-entry-set-enabled', requestId: 'entry-1', entryId: 'entry-1', enabled: false })
assert.deepEqual(calls.at(-1).args, { id: 'entry-1', enabled: false })
await query({ type: 'plugin-remove', requestId: 'remove-1', name: 'third-party' })
assert.deepEqual(calls.at(-1).args, { name: 'third-party' })

assert.equal((await query({ type: 'plugin-settings', requestId: 'settings-1', ns: 'bash-sandbox' })).namespace.revision, 2)
assert.equal((await query({ type: 'plugin-settings', requestId: 'settings-2', ns: 'missing' })).code, 'plugin-settings/not-found')
const ops = [{ op: 'set', path: ['timeout'], value: 60 }]
assert.equal((await query({ type: 'plugin-settings-mutate', requestId: 'mutate-1', ns: 'bash-sandbox',
  expectedRevision: 2, ops })).revision, 3)
assert.deepEqual(calls.at(-1).args, { ns: 'bash-sandbox', expectedRevision: 2, ops })
assert.deepEqual((await query({ type: 'plugin-version-exemptions', requestId: 'exemptions-1' })).exemptions, {})
await query({ type: 'plugin-version-exemption-set', requestId: 'exemption-1', packageVersion: 'a@1',
  runtimeVersion: '0.2.0', enabled: true, acceptRisk: true })
assert.deepEqual(calls.at(-1).args, { packageVersion: 'a@1', runtimeVersion: '0.2.0', enabled: true, acceptRisk: true })

const before = calls.length
for (const message of [
  { type: 'plugin-install', spec: 'example' },
  { type: 'plugin-install', requestId: 'bad-1', spec: '' },
  { type: 'plugin-install', requestId: 'bad-2', spec: 'example', approvedBuilds: 'all' },
  { type: 'plugin-bundle-set-enabled', requestId: 'bad-3', name: 'example', enabled: 'true' },
  { type: 'plugin-settings-mutate', requestId: 'bad-4', ns: 'bash-sandbox', expectedRevision: -1, ops },
]) assert.equal((await query(message)).code, 'bad-request')
assert.equal(calls.length, before)

console.log('plugin management tests passed')
