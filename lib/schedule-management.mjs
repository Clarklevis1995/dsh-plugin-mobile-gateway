import { isDeepStrictEqual } from 'node:util'

export const SCHEDULE_REQUEST_TYPES = new Set([
  'schedule-catalog', 'schedule-list', 'schedule-view', 'schedule-history',
  'schedule-create', 'schedule-edit', 'schedule-run', 'schedule-delete-inactive',
  'schedule-update', 'schedule-delete',
])

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const name = value => typeof value === 'string' && value.trim().length > 0
function check(condition, message) {
  if (!condition) throw Object.assign(new Error(message), { code: 'bad-request' })
}

function revision(value) {
  check(value === null || name(value), 'expectedUpdatedAt must be the read timestamp or null')
  return value
}

function validatePatch(patch) {
  check(record(patch) && Object.keys(patch).length > 0, 'patch must contain at least one change')
  check(Object.keys(patch).every(key => ['title', 'prompt', 'timing', 'target', 'active'].includes(key)), 'unknown schedule patch field')
  if (patch.title !== undefined) check(name(patch.title) && patch.title.trim().length <= 120, 'title must contain 1..120 characters')
  if (patch.prompt !== undefined) check(name(patch.prompt), 'prompt must not be empty')
  if (patch.timing !== undefined) check(record(patch.timing), 'timing must be an object')
  if (patch.target !== undefined) check(record(patch.target), 'target must be an object')
  if (patch.active !== undefined) check(typeof patch.active === 'boolean', 'active must be a boolean')
  return patch
}

/** 旧更新没有 revision 时先比对完整规则，再使用读取到的 revision 原子提交。 */
function legacyRevision(expected, current) {
  check(record(expected) && expected.id === current.id, 'expected must contain the matching task record')
  if (Object.hasOwn(expected, 'updatedAt')) return revision(expected.updatedAt)
  const keys = ['id', 'kind', 'title', 'prompt', 'scheduledAt', 'afterSeconds', 'everySeconds', 'time', 'timeZone', 'weekdays', 'expression', 'rrule']
  const select = value => Object.fromEntries(keys.filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]))
  return isDeepStrictEqual(select(expected), select(current)) ? current.updatedAt ?? null : undefined
}

export async function handleScheduleQuery(api, msg) {
  if (!SCHEDULE_REQUEST_TYPES.has(msg.type)) return null
  const identity = {
    ...(msg.requestId === undefined ? {} : { requestId: msg.requestId }),
    ...(msg.sessionId === undefined ? {} : { sessionId: msg.sessionId }),
  }
  const response = value => ({ kind: msg.type, ...identity, ...value })
  try {
    if (msg.requestId !== undefined) check(name(msg.requestId) && msg.requestId.length <= 128, 'invalid requestId')
    if (msg.sessionId !== undefined) check(name(msg.sessionId), 'invalid sessionId')
    const sessionId = msg.sessionId?.trim()
    if (msg.type === 'schedule-catalog') return response(await api.schedule.catalog())
    if (msg.type === 'schedule-list') {
      const payload = {}
      if (sessionId) payload.sessionId = sessionId
      if (msg.active !== undefined) {
        check(!sessionId && typeof msg.active === 'boolean', 'active requires a host-wide list')
        payload.active = msg.active
      }
      if (msg.limit !== undefined) {
        check(!sessionId && Number.isSafeInteger(msg.limit) && msg.limit >= 1 && msg.limit <= 500, 'limit must be 1..500 on a host-wide list')
        payload.limit = msg.limit
      }
      if (msg.offset !== undefined) {
        check(!sessionId && Number.isSafeInteger(msg.offset) && msg.offset >= 0, 'offset must be nonnegative on a host-wide list')
        payload.offset = msg.offset
      }
      return response(await api.schedule.list(payload))
    }
    if (msg.type === 'schedule-create') {
      check(!sessionId, 'use target to choose a delivery session')
      const payload = validatePatch({ title: msg.title, prompt: msg.prompt, timing: msg.timing,
        ...(msg.target === undefined ? {} : { target: msg.target }) })
      check(name(payload.title) && name(payload.prompt) && record(payload.timing), 'create requires title, prompt and timing')
      return response(await api.schedule.create(payload))
    }
    if (msg.type === 'schedule-delete-inactive') {
      check(!sessionId, 'delete-inactive is host-wide')
      check(msg.confirm === true, 'delete-inactive requires confirm: true')
      return response(await api.schedule.deleteInactive({}))
    }
    check(name(msg.id), 'task id is required')
    const id = msg.id.trim()
    let current
    // 旧客户端的 sessionId 仍是作用域约束，不能借旧帧操作其他会话的任务。
    if (sessionId || msg.type === 'schedule-update') {
      current = await api.schedule.view({ id })
      if (current.code) return response({ ...current,
        ...(msg.type === 'schedule-update' ? { updated: false } : {}),
        ...(msg.type === 'schedule-delete' ? { deleted: false } : {}) })
      if (sessionId && current.target?.sessionId !== sessionId && !current.involvedSessionIds?.includes(sessionId)) {
        return response({ id, code: 'schedule_not_found',
          ...(msg.type === 'schedule-update' ? { updated: false } : {}),
          ...(msg.type === 'schedule-delete' ? { deleted: false } : {}) })
      }
    }
    if (msg.type === 'schedule-view') return response(current ?? await api.schedule.view({ id }))
    if (msg.type === 'schedule-run') return response(await api.schedule.run({ id }))
    if (msg.type === 'schedule-history') {
      check(Number.isSafeInteger(msg.limit) && msg.limit >= 1 && msg.limit <= 100, 'history limit must be 1..100')
      if (msg.before !== undefined) check(name(msg.before), 'before must be a non-empty cursor')
      return response(await api.schedule.history({ id, limit: msg.limit,
        ...(msg.before === undefined ? {} : { before: msg.before }) }))
    }
    if (msg.type === 'schedule-edit') {
      check(['update', 'delete'].includes(msg.action), 'action must be update or delete')
      const payload = { id, action: msg.action, expectedUpdatedAt: revision(msg.expectedUpdatedAt) }
      if (msg.action === 'update') payload.patch = validatePatch(msg.patch)
      return response(await api.schedule.edit(payload))
    }
    if (msg.type === 'schedule-delete') {
      const result = await api.schedule.edit({ id, action: 'delete',
        ...(msg.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: revision(msg.expectedUpdatedAt) }) })
      return response({ ...result, deleted: result.deleted === true })
    }
    const expectedUpdatedAt = legacyRevision(msg.expected, current)
    if (expectedUpdatedAt === undefined) return response({ id, updated: false, code: 'schedule_conflict' })
    const patch = Object.fromEntries(['title', 'prompt'].filter(key => msg[key] !== undefined).map(key => [key, msg[key]]))
    // 旧 change 的规则结构交由新版 timing 校验，无法转换的请求明确拒绝。
    if (msg.change !== undefined) {
      check(record(msg.change) && typeof msg.change.kind === 'string', 'change must be a typed timing object')
      patch.timing = msg.change
    }
    const result = await api.schedule.edit({ id, action: 'update', expectedUpdatedAt, patch: validatePatch(patch) })
    return response(result.code ? { ...result, updated: false } : { id, updated: true, record: result })
  } catch (error) {
    return { kind: 'error', requestType: msg.type, ...identity,
      code: error.code || 'internal', message: error.message || String(error),
      ...(record(error.details) ? { details: error.details } : {}) }
  }
}
