import crypto from 'node:crypto'

export function websocketRtt(socket, { signal, timeoutMs = 3000, now = () => performance.now() } = {}) {
  return new Promise(resolve => {
    if (socket.readyState !== 1 || signal?.aborted) { resolve({ status: 'cancelled', rttMs: null }); return }
    const payload = Buffer.from(`mgw-net:${crypto.randomUUID()}`)
    const started = now()
    let timer, finished = false
    const finish = result => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      socket.off('pong', pong); socket.off('close', closed); socket.off('error', failed)
      signal?.removeEventListener('abort', aborted)
      resolve({ ...result, measurement: 'websocket-ping' })
    }
    const pong = data => { if (Buffer.from(data).equals(payload)) finish({ status: 'ok', rttMs: Math.max(0, now() - started) }) }
    const closed = () => finish({ status: 'disconnected', rttMs: null })
    const failed = () => finish({ status: 'error', rttMs: null })
    const aborted = () => finish({ status: 'cancelled', rttMs: null })
    socket.on('pong', pong); socket.once('close', closed); socket.once('error', failed)
    signal?.addEventListener('abort', aborted, { once: true })
    timer = setTimeout(() => finish({ status: 'timeout', rttMs: null }), timeoutMs)
    try { socket.ping(payload, error => { if (error) failed() }) } catch { failed() }
  })
}

export function rtcNetworkStats(report) {
  const values = [...report.values()]
  const transport = values.find(value => value.type === 'transport' && value.selectedCandidatePairId)
  const pair = transport ? report.get(transport.selectedCandidatePairId) :
    values.find(value => value.type === 'candidate-pair' && value.nominated && value.state === 'succeeded')
  if (!pair) return { status: 'unavailable', rttMs: null, measurement: 'rtc-ice' }
  const measured = Number.isFinite(pair.roundTripTimeMeasurements) && pair.roundTripTimeMeasurements > 0
  return {
    status: measured && Number.isFinite(pair.currentRoundTripTime) ? 'ok' : 'unavailable',
    measurement: 'rtc-ice',
    rttMs: measured && Number.isFinite(pair.currentRoundTripTime) ? Math.max(0, pair.currentRoundTripTime * 1000) : null,
    averageRttMs: measured && Number.isFinite(pair.totalRoundTripTime) ? pair.totalRoundTripTime * 1000 / pair.roundTripTimeMeasurements : null,
    measurementCount: measured ? pair.roundTripTimeMeasurements : 0,
  }
}

async function abortable(operation, signal, timeoutMs = 3000) {
  const safe = Promise.resolve(operation).catch(() => ({ status: 'error', rttMs: null }))
  if (signal?.aborted) return { status: 'cancelled', rttMs: null }
  let timer, onAbort
  try {
    return await Promise.race([
      safe,
      new Promise(resolve => {
        onAbort = () => resolve({ status: 'cancelled', rttMs: null })
        signal?.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(() => resolve({ status: 'timeout', rttMs: null }), timeoutMs)
      }),
    ])
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}

export function createNetworkDiagnostics({ clients, devices, now = () => Date.now() }) {
  let busy = false, disposed = false, last = null, activeAbort
  const histories = new Map()
  return {
    async measure({ signal } = {}) {
      if (disposed) throw new Error('network diagnostics disposed')
      if (busy) throw Object.assign(new Error('network diagnostics busy'), { status: 409 })
      if (signal?.aborted) return { at: now(), devices: [] }
      if (last && now() - last.at < 1000) return last
      busy = true
      const abort = new AbortController()
      activeAbort = abort
      const cancel = () => abort.abort()
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        const connections = [...clients].filter(client => client.readyState === 1 && client.deviceId).slice(0, 256)
        const known = new Map(devices().map(device => [device.id, device]))
        const rows = new Array(connections.length)
        let index = 0
        await Promise.all(Array.from({ length: Math.min(8, connections.length) }, async () => {
          while (!abort.signal.aborted) {
            const current = index++
            if (current >= connections.length) break
            const client = connections[current]
            let result
            try {
              result = await abortable(Promise.resolve(client.adapter.probeNetwork({ signal: abort.signal })), abort.signal)
            } catch { result = { status: 'error', rttMs: null } }
            if (!result || typeof result !== 'object') result = { status: 'unavailable', rttMs: null }
            if (client.readyState !== 1 || !clients.has(client)) result = { status: 'disconnected', rttMs: null }
            result = { measurement: client.transport === 'webrtc' ? 'rtc-ice' : 'websocket-ping', ...result }
            if (result.status !== 'ok' || !Number.isFinite(result.rttMs) || result.rttMs < 0) result.rttMs = null
            const key = client.generation
            const history = histories.get(key) || []
            if (!abort.signal.aborted && result.status !== 'cancelled') {
              const changed = result.measurement !== 'rtc-ice' || history.at(-1)?.measurementCount !== result.measurementCount
              if (changed) history.push({ at: now(), rttMs: result.rttMs, measurementCount: result.measurementCount })
              while (history.length && (history.length > 60 || now() - history[0].at > 60000)) history.shift()
              histories.set(key, history)
            }
            const rtts = history.map(item => item.rttMs).filter(Number.isFinite).sort((a, b) => a - b)
            rows[current] = {
              deviceId: client.deviceId, name: known.get(client.deviceId)?.displayName || known.get(client.deviceId)?.name || '',
              connectionId: key, channel: client.mobileChannel, transport: client.transport,
              ...result, samples: history.map(({ at, rttMs }) => ({ at, rttMs })),
              p95RttMs: rtts.length ? rtts[Math.ceil(rtts.length * .95) - 1] : null,
              averageRttMs: result.measurement === 'rtc-ice' ? result.averageRttMs : rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null,
            }
          }
        }))
        const alive = new Set(connections.map(client => client.generation))
        for (const key of histories.keys()) if (!alive.has(key)) histories.delete(key)
        const grouped = new Map()
        for (const row of rows.filter(Boolean)) {
          if (!grouped.has(row.deviceId)) grouped.set(row.deviceId, { deviceId: row.deviceId, name: row.name, channels: [] })
          const { deviceId, name, ...channel } = row
          grouped.get(deviceId).channels.push(channel)
        }
        const snapshot = { at: now(), devices: [...grouped.values()], truncated: [...clients].filter(client => client.readyState === 1 && client.deviceId).length > connections.length }
        if (!abort.signal.aborted) last = snapshot
        return snapshot
      } finally { signal?.removeEventListener('abort', cancel); activeAbort = null; busy = false }
    },
    dispose() { disposed = true; activeAbort?.abort(); histories.clear(); last = null },
  }
}
