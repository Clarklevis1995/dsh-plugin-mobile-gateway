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
