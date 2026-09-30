const OFFICIAL_CONFIGURATION_ITEMS = Object.freeze([
  { id: 'shell', namespaces: ['bash-sandbox', 'pwsh-sandbox'] },
  { id: 'agent-loop', namespaces: ['agent-loop'] },
  { id: 'subagent', namespaces: ['subagent', 'subagent-model-selection-settings'] },
  { id: 'web-search', namespaces: ['web-search-deepseek'] },
])

export const PLUGIN_REQUEST_TYPES = new Set([
  'plugin-catalog',
  'plugin-registries',
  'plugin-inspect',
  'plugin-install',
  'plugin-install-status',
  'plugin-install-cancel',
  'plugin-bundle-set-enabled',
  'plugin-entry-set-enabled',
  'plugin-remove',
  'plugin-settings',
  'plugin-settings-mutate',
  'plugin-version-exemptions',
  'plugin-version-exemption-set',
])

const FLAT_RESPONSE_TYPES = new Set([
  'plugin-catalog', 'plugin-registries', 'plugin-settings',
  'plugin-settings-mutate', 'plugin-version-exemptions',
])

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonempty(value, maxLength = 2048) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength
}

function badRequest(type, requestId, message) {
  return { kind: 'error', code: 'bad-request', message, requestType: type,
    ...(requestId === undefined ? {} : { requestId }) }
}

function registryOption(msg, type, requestId) {
  if (msg.registry === undefined) return { value: undefined }
  if (msg.registry === null || (nonempty(msg.registry) && /^https?:\/\//i.test(msg.registry))) {
    return { value: msg.registry }
  }
  return { error: badRequest(type, requestId, 'registry must be null or an HTTP(S) URL') }
}

function requireName(msg, field, type, requestId) {
  if (!nonempty(msg[field], 512)) return { error: badRequest(type, requestId, `${field} must be a non-empty string`) }
  return { value: msg[field].trim() }
}

async function pluginCatalog(api) {
  const inventory = await api.plugins.inventory()
  if (!record(inventory) || !Array.isArray(inventory.entries)) throw new Error('pluginInventory/list returned an invalid inventory')
  if (inventory.managementAvailable !== true) {
    return { managementAvailable: false, bundles: [], plugins: [], officialItems: [], settingsWritable: false }
  }
  const [bundles, plugins, settings] = await Promise.all([
    api.plugins.listBundles(),
    api.plugins.listPlugins(),
    api.settings.describe(),
  ])
  if (!Array.isArray(bundles) || !Array.isArray(plugins) || !Array.isArray(settings?.namespaces)) {
    throw new Error('plugin manager returned an invalid catalog')
  }
  const available = new Set(settings.namespaces.map(item => item.ns))
  const officialItems = OFFICIAL_CONFIGURATION_ITEMS
    .filter(item => item.namespaces.some(ns => available.has(ns)))
    .map(item => ({ id: item.id, namespaces: item.namespaces.filter(ns => available.has(ns)) }))
  return {
    managementAvailable: true,
    bundles: bundles.map(bundle => ({
      ...bundle,
      experimental: bundle.name.startsWith('@deepseek-ai/dsh-experimental-'),
    })),
    plugins,
    officialItems,
    settingsWritable: settings.writable === true,
  }
}

/**
 * The mobile wire owns its request names and correlation ids. The Host adapter
 * owns Typert endpoint names and argument descriptors.
 */
export async function handlePluginQuery(api, msg, { onInstallStart, onInstallEnd } = {}) {
  const type = msg?.type
  if (!PLUGIN_REQUEST_TYPES.has(type)) return null
  const requestId = nonempty(msg.requestId, 128) ? msg.requestId.trim() : undefined
  if (!requestId) return badRequest(type, undefined, `${type} requires a requestId`)

  try {
    let value
    let kind = type
    if (type === 'plugin-catalog') {
      value = await pluginCatalog(api)
    } else if (type === 'plugin-registries') {
      value = await api.plugins.registries()
    } else if (type === 'plugin-inspect' || type === 'plugin-install') {
      const spec = requireName(msg, 'spec', type, requestId)
      if (spec.error) return spec.error
      const registry = registryOption(msg, type, requestId)
      if (registry.error) return registry.error
      if (type === 'plugin-inspect') {
        value = await api.plugins.inspect(spec.value, registry.value === undefined ? undefined : { registry: registry.value })
        kind = 'plugin-inspection'
      } else {
        if (msg.enabled !== undefined && typeof msg.enabled !== 'boolean') {
          return badRequest(type, requestId, 'enabled must be a boolean')
        }
        if (msg.approvedBuilds !== undefined && (!Array.isArray(msg.approvedBuilds)
          || msg.approvedBuilds.length > 100 || msg.approvedBuilds.some(name => !nonempty(name, 512)))) {
          return badRequest(type, requestId, 'approvedBuilds must be an array of package names')
        }
        const options = {
          requestId,
          ...(msg.enabled === undefined ? {} : { enabled: msg.enabled }),
          ...(registry.value === undefined ? {} : { registry: registry.value }),
          ...(msg.approvedBuilds === undefined ? {} : { approvedBuilds: msg.approvedBuilds }),
        }
        onInstallStart?.(requestId)
        try {
          value = await api.plugins.installBundle(spec.value, options)
        } finally {
          onInstallEnd?.(requestId)
        }
        kind = 'plugin-install-result'
      }
    } else if (type === 'plugin-install-status' || type === 'plugin-install-cancel') {
      const installId = requireName(msg, 'installId', type, requestId)
      if (installId.error) return installId.error
      value = type === 'plugin-install-status'
        ? await api.plugins.waitForInstall(installId.value)
        : await api.plugins.cancelInstall(installId.value)
    } else if (type === 'plugin-bundle-set-enabled' || type === 'plugin-entry-set-enabled') {
      const field = type === 'plugin-bundle-set-enabled' ? 'name' : 'entryId'
      const target = requireName(msg, field, type, requestId)
      if (target.error) return target.error
      if (typeof msg.enabled !== 'boolean') return badRequest(type, requestId, 'enabled must be a boolean')
      value = type === 'plugin-bundle-set-enabled'
        ? await api.plugins.setBundleEnabled(target.value, msg.enabled)
        : await api.plugins.setPluginEnabled(target.value, msg.enabled)
    } else if (type === 'plugin-remove') {
      const name = requireName(msg, 'name', type, requestId)
      if (name.error) return name.error
      value = await api.plugins.removeBundle(name.value)
    } else if (type === 'plugin-settings') {
      const described = await api.settings.describe()
      if (!record(described) || !Array.isArray(described.namespaces)) throw new Error('settings/describe returned an invalid response')
      if (msg.ns !== undefined) {
        const ns = requireName(msg, 'ns', type, requestId)
        if (ns.error) return ns.error
        const namespace = described.namespaces.find(item => item.ns === ns.value)
        if (!namespace) return { kind: 'error', code: 'plugin-settings/not-found',
          message: `settings namespace is unavailable: ${ns.value}`, requestType: type, requestId }
        value = { writable: described.writable === true, namespace }
      } else {
        value = described
      }
    } else if (type === 'plugin-settings-mutate') {
      const ns = requireName(msg, 'ns', type, requestId)
      if (ns.error) return ns.error
      if (!Number.isSafeInteger(msg.expectedRevision) || msg.expectedRevision < 0) {
        return badRequest(type, requestId, 'expectedRevision must be a non-negative integer')
      }
      if (!Array.isArray(msg.ops) || msg.ops.length < 1 || msg.ops.length > 100
        || msg.ops.some(op => !record(op) || !['set', 'unset'].includes(op.op)
          || !Array.isArray(op.path) || op.path.some(part => !nonempty(part, 256))
          || (op.op === 'set' && !Object.hasOwn(op, 'value')))) {
        return badRequest(type, requestId, 'ops must contain valid set or unset path edits')
      }
      value = await api.settings.mutate({ ns: ns.value, ops: msg.ops, expectedRevision: msg.expectedRevision })
    } else if (type === 'plugin-version-exemptions') {
      value = await api.plugins.listVersionExemptions()
    } else if (type === 'plugin-version-exemption-set') {
      const packageVersion = requireName(msg, 'packageVersion', type, requestId)
      const runtimeVersion = requireName(msg, 'runtimeVersion', type, requestId)
      if (packageVersion.error || runtimeVersion.error) return packageVersion.error || runtimeVersion.error
      if (typeof msg.enabled !== 'boolean' || (msg.acceptRisk !== undefined && typeof msg.acceptRisk !== 'boolean')) {
        return badRequest(type, requestId, 'enabled and acceptRisk must be booleans')
      }
      value = await api.plugins.setVersionExemption(packageVersion.value, runtimeVersion.value,
        msg.enabled, msg.acceptRisk)
    }
    return { kind, requestId, ...(FLAT_RESPONSE_TYPES.has(type) && record(value)
      ? value : { result: value }) }
  } catch (error) {
    return { kind: 'error', code: error?.code || 'internal',
      message: error?.message || String(error), requestType: type, requestId }
  }
}
