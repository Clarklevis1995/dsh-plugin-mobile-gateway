import { performance } from 'node:perf_hooks'

// 请求来源由已鉴权连接写入，通过宿主新入队消息的稳定 id 绑定；不从用户文本或模型参数推断。
const KEY = Symbol.for('whaleness.phone-request-sources.v1')
const state = globalThis[KEY] ??= { admissions: new Map(), agents: new WeakMap() }
const fail = code => Object.assign(new Error(code), { code })
const keyOf = (sessionId, requestId) => JSON.stringify([String(sessionId), requestId])
function agentState(agent) {
  let row = state.agents.get(agent)
  if (!row) { row = { messages: new Map(), turn: null, step: null, origin: null, preparedAt: null, claimedBatch: [] }; state.agents.set(agent, row) }
  return row
}

export function beginPhoneMessage(sessionId, requestId, source) {
  if (![sessionId, requestId, source?.gatewayId, source?.deviceId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256)) throw fail('invalid_request_source')
  const key = keyOf(sessionId, requestId)
  let row = state.admissions.get(key)
  if (row && (row.source.gatewayId !== source.gatewayId || row.source.deviceId !== source.deviceId)) throw fail('request_source_conflict')
  if (!row) {
    if (state.admissions.size >= 2048) throw fail('request_source_busy')
    row = { refs: 0, source: Object.freeze({ gatewayId: source.gatewayId, deviceId: source.deviceId, requestId, receivedAt: performance.now() }) }
    state.admissions.set(key, row)
  }
  row.refs += 1
  let ended = false
  return () => {
    if (ended) return
    ended = true; row.refs -= 1
    if (row.refs === 0 && state.admissions.get(key) === row) state.admissions.delete(key)
  }
}

export function capturePhoneMessage({ agent, message }) {
  const requestId = message?.source?.rpcId
  if (!agent || typeof message?.id !== 'string' || typeof requestId !== 'string') return false
  const row = state.admissions.get(keyOf(agent.id, requestId))
  if (!row) return false
  const messages = agentState(agent).messages
  if (!messages.has(message.id)) messages.set(message.id, { claimed: false, origin: Object.freeze({
    kind: 'device', ...row.source,
    ...(typeof message.source.clientTimeZone === 'string' ? { timeZone: message.source.clientTimeZone } : {}),
  }) })
  return true
}
export function discardPhoneMessage({ agent, message }) { state.agents.get(agent)?.messages.delete(message?.id) }
function resetTurn(row, turn) {
  if (row.turn === turn) return
  for (const [id, message] of row.messages) if (message.claimed) row.messages.delete(id)
  row.origin = null; row.claimedBatch = []; row.turn = turn
}
function selectOrigin(row, messages) {
  const inputs = messages.filter(message => message?.source?.kind === 'user' || row.messages.has(message?.id))
  if (!inputs.length) return row.origin
  const origins = inputs.map(message => row.messages.get(message.id)?.origin ?? null)
  const keys = new Set(origins.map(origin => origin ? JSON.stringify([origin.gatewayId, origin.deviceId]) : null))
  return keys.size > 1 ? Object.freeze({ kind: 'ambiguous' }) : origins.at(-1)
}
// SDK 在 pre-step 前组装上下文；实际出队时先绑定，让本步模型一开始就知道来源。
export function claimPhoneMessage({ agent, message, turn }) {
  const row = agentState(agent)
  resetTurn(row, turn)
  row.claimedBatch.push({ id: message.id, source: { kind: message.source?.kind } })
  const captured = row.messages.get(message.id)
  if (captured) captured.claimed = true
}
export function preparePhoneStep({ agent, turn, step, messages }) {
  const row = agentState(agent)
  resetTurn(row, turn)
  // 其他宿主策略可能替换或拒绝输入；以实际进入本步的消息再次确认，不能凭旧上下文调用。
  row.origin = selectOrigin(row, messages)
  row.claimedBatch = []
  for (const message of messages) {
    const captured = row.messages.get(message?.id)
    if (captured) captured.claimed = true
  }
  row.turn = turn; row.step = step; row.preparedAt = performance.now()
}
export function clearPhoneTurn(agent) {
  const row = state.agents.get(agent)
  if (!row) return
  for (const [id, message] of row.messages) if (message.claimed) row.messages.delete(id)
  row.origin = null; row.claimedBatch = []; row.turn = null; row.step = null; row.preparedAt = null
}
export function phoneOrigin(agent) {
  const row = agent && state.agents.get(agent)
  return row ? selectOrigin(row, row.claimedBatch) : null
}
export function phoneStepTiming(agent) {
  const row = agent && state.agents.get(agent)
  return row?.preparedAt == null ? null : Math.max(0, Math.round(performance.now() - row.preparedAt))
}
