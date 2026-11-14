// 移动端保留 sessionId 为当前视图 ID，父子关系只作为显式路由地址。
export function parseSessionTarget(msg, { optional = false } = {}) {
  const fail = message => ({ error: { kind: 'error', code: 'bad-request', requestType: msg.type, message,
    ...(typeof msg.requestId === 'string' ? { requestId: msg.requestId } : {}) } })
  const sessionId = typeof msg.sessionId === 'string' ? msg.sessionId.trim() : ''
  const hasChildAddress = msg.parentSessionId !== undefined || msg.subagentMode !== undefined
  if (!sessionId && (!optional || hasChildAddress)) return fail('sessionId must be a non-empty string')
  if (!hasChildAddress) return { value: sessionId ? { sessionId } : {} }
  const parentSessionId = typeof msg.parentSessionId === 'string' ? msg.parentSessionId.trim() : ''
  if (!parentSessionId || parentSessionId === sessionId) return fail('parentSessionId must identify a different direct parent')
  if (!['continuable', 'one-shot', 'unknown'].includes(msg.subagentMode)) {
    return fail('subagentMode must be continuable, one-shot, or unknown')
  }
  return { value: { sessionId, parentSessionId, subagentMode: msg.subagentMode } }
}

export function sessionAddress(target) {
  return target.parentSessionId === undefined
    ? { kind: 'session', sessionId: target.sessionId }
    : { kind: 'subagent', parentSessionId: target.parentSessionId,
      childSessionId: target.sessionId, mode: target.subagentMode }
}

export const TEAM_PROJECTION_KINDS = {
  agentTeam: 'agent-team-updated',
  subagentCatalog: 'subagents-updated',
  subagent: 'subagent-identity-updated',
  subagentTiming: 'subagent-timing-updated',
}

/** RC.2 起成员由具名子代理目录提供，移动协议保留空 members 供旧端解码。 */
export function normalizeTeamProjection(value) {
  if (value == null) return value
  if (typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.tasks)
    || (Object.hasOwn(value, 'members') && !Array.isArray(value.members))
    || (!Object.hasOwn(value, 'members') && typeof value.enabled !== 'boolean')) {
    throw new Error('invalid team projection')
  }
  return Object.hasOwn(value, 'members') ? value : { ...value, members: [] }
}

export function normalizeProjectionValues(values) {
  if (!values || !Object.hasOwn(values, 'agentTeam')) return values
  return { ...values, agentTeam: normalizeTeamProjection(values.agentTeam) }
}
