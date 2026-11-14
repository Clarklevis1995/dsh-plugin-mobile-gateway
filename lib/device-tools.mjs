import { randomUUID } from 'node:crypto'
import { validateArguments, validateResult } from './device-tool-validation.mjs'
export const MODULES = Object.freeze(['calendar', 'reminders', 'location', 'photos', 'music', 'health', 'alarms'])
export const TOOLS = Object.freeze(['calendar.busy', 'reminders.list', 'location.current', 'photos.select', 'music.search', 'music.state', 'music.play', 'music.pause', 'music.seek', 'health.daily-summary', 'calendar.create', 'reminders.create', 'alarms.create', 'alarms.list', 'alarms.cancel', 'alarms.open-create', 'music.library', 'music.play-library', 'music.catalog-search', 'location.precise', 'maps.search', 'maps.geocode', 'maps.reverse-geocode', 'maps.directions', 'maps.open', 'maps.markers.create', 'maps.markers.list', 'maps.markers.update', 'maps.markers.delete'])
export const BROKERS = Symbol.for('whaleness.phone-tools.brokers.v1')
export const NEW_TOOLS = Object.freeze(['calendar.create', 'reminders.create', 'alarms.create', 'alarms.list', 'alarms.cancel', 'alarms.open-create', 'music.library', 'music.play-library', 'music.catalog-search', 'location.precise', 'maps.search', 'maps.geocode', 'maps.reverse-geocode', 'maps.directions', 'maps.open', 'maps.markers.create', 'maps.markers.list', 'maps.markers.update', 'maps.markers.delete'])
export const moduleOf = tool => tool.startsWith('maps.') ? 'location' : tool.split('.')[0]
export const LEGACY_TOOLS = TOOLS.filter(tool => !NEW_TOOLS.includes(tool))
const WRITES = ['alarms.open-create', 'calendar.create', 'reminders.create', 'alarms.create', 'alarms.cancel', 'music.play', 'music.pause', 'music.seek', 'music.play-library', 'maps.open', 'maps.markers.create', 'maps.markers.update', 'maps.markers.delete']
const fail = code => Object.assign(new Error(code), { code })
export function createDeviceTools({ registry, enabled = () => true }) {
  const owners = new Map(), pending = new Map(), generations = new Map()
  const send = (owner, frame) => { try { if (owner.client.readyState === 1) owner.client.sendFrame(frame) } catch { /* caller settles pending independently */ } }
  const describe = owner => [...owner.modules].map(([id, row]) => ({ id, ...row }))
  function permissions(id) { return registry.list().find(device => device.id === id)?.permissions }
  function finish(id, error, result) {
    const row = pending.get(id)
    if (!row) return
    pending.delete(id); clearTimeout(row.timer); row.signal?.removeEventListener('abort', row.abort)
    if (error && WRITES.includes(row.tool) && ['device_disconnected', 'cancelled', 'stale_lease', 'invocation_timeout', 'tool_disabled', 'invalid_result', 'result_too_large'].includes(error)) error = 'outcome_unknown'
    error ? row.reject(fail(error)) : row.resolve(result)
  }
  function cancelOwned(owner, module, code = 'device_disconnected') {
    for (const [id, row] of pending) if (row.owner === owner && (!module || moduleOf(row.tool) === module)) {
      send(row.owner, { kind: 'device-tool-cancel', version: 1, invocationId: id, connectionLeaseId: row.owner.lease })
      finish(id, code)
    }
  }
  return {
    handle(client, msg) {
      if (typeof msg.type !== 'string' || !msg.type.startsWith('device-tool')) return false
      if (!enabled() || !client.deviceId || !permissions(client.deviceId)) throw fail('authentication-required')
      if (!['control', 'legacy'].includes(client.mobileChannel)) throw fail('wrong-channel')
      if (msg.version !== 1) throw fail('unsupported-version')
      if (msg.type === 'device-tools-status') {
        if (typeof msg.requestId !== 'string' || !msg.requestId || msg.requestId.length > 128) throw fail('invalid_request')
        const owner = owners.get(client.deviceId)
        const registered = owner?.client === client && client.readyState === 1
        client.sendFrame({ kind: 'device-tools-status', version: 1, requestId: msg.requestId,
          status: registered ? 'registered' : 'not-registered', statusQuery: true,
          ...(registered ? { connectionLeaseId: owner.lease, capabilityRevision: owner.revision } : {}),
          modules: registered ? describe(owner) : [], permissions: permissions(client.deviceId) })
        return true
      }
      if (msg.type === 'device-tools-register') {
        if (!Number.isSafeInteger(msg.capabilityRevision) || msg.capabilityRevision < 1 || !Array.isArray(msg.modules) || msg.modules.length > MODULES.length) throw fail('invalid_request')
        if (msg.platform !== undefined && !['android', 'ios'].includes(msg.platform)) throw fail('invalid_request')
        const modules = new Map()
        for (const entry of msg.modules) {
          if (!entry || !MODULES.includes(entry.id) || modules.has(entry.id) || typeof entry.enabled !== 'boolean' || typeof entry.available !== 'boolean') throw fail('invalid_request')
          if (entry.tools !== undefined && (!Array.isArray(entry.tools) || entry.tools.length > 256 || new Set(entry.tools).size !== entry.tools.length || entry.tools.some(tool => typeof tool !== 'string' || tool.length > 100 || !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(tool) || moduleOf(tool) !== entry.id))) throw fail('invalid_request')
          modules.set(entry.id, { enabled: entry.enabled, available: entry.available, tools: entry.tools?.filter(tool => TOOLS.includes(tool)) ?? LEGACY_TOOLS.filter(tool => moduleOf(tool) === entry.id) })
        }
        const old = owners.get(client.deviceId)
        if (client.generation < (generations.get(client.deviceId) ?? 0)) throw fail('stale_lease')
        if (typeof msg.requestId !== 'string' || msg.requestId.length > 128 || !msg.requestId) throw fail('invalid_request')
        if (old?.client === client && msg.capabilityRevision <= old.revision) throw fail('stale_revision')
        // 只同步本次手机操作明确携带的补丁；普通注册不从 enabled 推导授权。
        if (msg.permissionChanges !== undefined) {
          const changes = msg.permissionChanges
          if (!changes || typeof changes !== 'object' || Array.isArray(changes) || Object.entries(changes).some(([id, value]) =>
            !MODULES.includes(id) || typeof value !== 'boolean' || (value && (!modules.get(id)?.enabled || !modules.get(id)?.available)))) throw fail('invalid_request')
          try { registry.setPermissions(client.deviceId, changes) } catch { throw fail('permission_save_failed') }
        }
        const owner = { client, lease: randomUUID(), platform: msg.platform }
        if (old) cancelOwned(old, null, 'stale_lease')
        generations.set(client.deviceId, client.generation)
        owner.modules = modules; owner.revision = msg.capabilityRevision
        owners.set(client.deviceId, owner)
        for (const id of MODULES) if (!modules.get(id)?.enabled || !modules.get(id)?.available) cancelOwned(owner, id, 'tool_disabled')
        client.sendFrame({ kind: 'device-tools-registered', version: 1, requestId: msg.requestId, connectionLeaseId: owner.lease, capabilityRevision: owner.revision, permissionSync: true, permissions: permissions(client.deviceId), statusQuery: true, modules: describe(owner) })
      } else {
        const owner = owners.get(client.deviceId), row = pending.get(msg.invocationId)
        if (!owner || owner.client !== client || owner.lease !== msg.connectionLeaseId || !row || row.owner !== owner) return true
        if (!permissions(client.deviceId)?.[moduleOf(row.tool)]) { finish(msg.invocationId, 'tool_disabled'); return true }
        if (msg.type === 'device-tool-result') {
          if (Buffer.byteLength(JSON.stringify(msg)) > 128 * 1024) finish(msg.invocationId, 'result_too_large')
          else if (msg.status === 'success' && validateResult(row.tool, msg.result) && (row.operationId === undefined || msg.result.operationId === row.operationId)) finish(msg.invocationId, null, msg.result)
          else if (msg.status === 'error') finish(msg.invocationId, /^[a-z_]{1,64}$/.test(msg.error?.code) ? msg.error.code : 'device_error')
          else finish(msg.invocationId, 'invalid_result')
        } else if (msg.type === 'device-tool-cancelled') finish(msg.invocationId, 'cancelled')
      }
      return true
    },
    changed(deviceId) {
      const owner = owners.get(deviceId)
      if (!owner) return
      const current = permissions(deviceId)
      if (!current) { cancelOwned(owner); owners.delete(deviceId); return }
      for (const id of MODULES) if (!current[id]) cancelOwned(owner, id, 'tool_disabled')
      send(owner, { kind: 'device-tools-permissions', version: 1, connectionLeaseId: owner.lease, permissions: current })
    },
    close(client) { const owner = owners.get(client.deviceId); if (owner?.client === client) { cancelOwned(owner); owners.delete(client.deviceId) } },
    dispose() { for (const owner of owners.values()) cancelOwned(owner); owners.clear() },
    list() { return registry.list().map(device => {
      const owner = owners.get(device.id), ready = owner?.client.readyState === 1
      return { ...device, ...(ready && owner.platform ? { platform: owner.platform } : {}), connectorStatus: ready ? 'ready' : device.online ? 'not-registered' : 'offline', modules: Object.fromEntries(ready ? owner.modules : []) }
    }) },
    invoke({ deviceId, sessionId, toolCallId, signal, consentContext }, tool, args) {
      if (!enabled() || !TOOLS.includes(tool) || !sessionId || !toolCallId) return Promise.reject(fail('invalid_request'))
      if (!deviceId) return Promise.reject(fail('device_not_bound'))
      if (!validateArguments(tool, args) || Buffer.byteLength(JSON.stringify(args)) > 16 * 1024) return Promise.reject(fail('invalid_request'))
      const owner = owners.get(deviceId), module = moduleOf(tool)
      if (!owner || owner.client.readyState !== 1) return Promise.reject(fail(registry.list().find(device => device.id === deviceId)?.online ? 'connector_not_ready' : 'device_offline'))
      if (!permissions(deviceId)?.[module] || !owner.modules.get(module)?.enabled) return Promise.reject(fail('tool_disabled'))
      if (!owner.modules.get(module)?.available || !owner.modules.get(module)?.tools.includes(tool)) return Promise.reject(fail('tool_unsupported'))
      if ([...pending.values()].filter(row => row.owner === owner).length >= 2) return Promise.reject(fail('busy'))
      if (signal?.aborted) return Promise.reject(fail('cancelled'))
      return new Promise((resolve, reject) => {
        const invocationId = randomUUID()
        const abort = () => { send(owner, { kind: 'device-tool-cancel', version: 1, invocationId, connectionLeaseId: owner.lease }); finish(invocationId, 'cancelled') }
        const timer = setTimeout(() => { send(owner, { kind: 'device-tool-cancel', version: 1, invocationId, connectionLeaseId: owner.lease }); finish(invocationId, 'invocation_timeout') }, 120000)
        pending.set(invocationId, { owner, tool, operationId: args.operationId, signal, abort, resolve, reject, timer })
        signal?.addEventListener('abort', abort, { once: true })
        try { owner.client.sendFrame({ kind: 'device-tool-invoke', version: 1, invocationId, connectionLeaseId: owner.lease, sessionId, toolCallId, capabilityRevision: owner.revision, tool, arguments: args, timeoutMs: 120000, consentContext: consentContext ?? { providerId: null, modelId: null, sessionPersistence: true } }) } catch { finish(invocationId, 'device_disconnected') }
      })
    },
  }
}
