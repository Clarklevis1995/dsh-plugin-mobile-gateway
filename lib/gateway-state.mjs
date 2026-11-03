import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { normalizeTransportConfig } from './transport-config.mjs'

export const PAIRING_ROUTES = ['p2p', 'auto-lan', 'auto', 'lan', 'cloudflare', 'custom', 'tailscale']

export const GATEWAY_MODES = ['disabled', 'temporary', 'persistent']

// A dedicated file keeps installation identity independent of device revocation.
// A malformed file must fail startup rather than silently replace that identity.
export function createGatewayState(file) {
  const validate = (value) => {
    if (!value || value.version !== 1 ||
        typeof value.gatewayId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.gatewayId) ||
        (value.mode !== null && !GATEWAY_MODES.includes(value.mode))) {
      throw new Error('invalid gateway identity or mode')
    }
    if (value.pairingRoute !== undefined && !PAIRING_ROUTES.includes(value.pairingRoute)) throw new Error('invalid pairing route')
    if (value.webrtc !== undefined) normalizeTransportConfig(value.webrtc)
    if (value.tailscaleUrl !== undefined && typeof value.tailscaleUrl !== 'string') throw new Error('invalid Tailscale address')
    if (value.p2pUrl !== undefined && typeof value.p2pUrl !== 'string') throw new Error('invalid P2P address')
    return value
  }
  const read = () => validate(JSON.parse(fs.readFileSync(file, 'utf8')))
  const write = (value, initial = false) => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
    try {
      fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      if (initial) fs.linkSync(tmp, file) // Never overwrite a concurrently created identity.
      else fs.renameSync(tmp, file)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }
  let state
  try {
    try {
      state = read()
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      state = { version: 1, gatewayId: crypto.randomUUID(), mode: null }
      try { write(state, true) } catch (cause) {
        if (cause.code !== 'EEXIST') throw cause
        state = read()
      }
    }
    fs.chmodSync(file, 0o600)
  } catch (error) {
    throw new Error(`failed to load gateway state ${file}: ${error.message}`, { cause: error })
  }
  return {
    get gatewayId() { return state.gatewayId },
    get mode() { return state.mode },
    get pairingRoute() { return state.pairingRoute },
    get webrtc() { return state.webrtc },
    get p2pUrl() { return state.p2pUrl || '' },
    get tailscaleUrl() { return state.tailscaleUrl || '' },
    setConnection(route, webrtc, p2pUrl = state.p2pUrl || '', tailscaleUrl = state.tailscaleUrl || '') {
      if (!PAIRING_ROUTES.includes(route)) throw new TypeError('invalid pairing route')
      const next = { ...state, pairingRoute: route, webrtc: normalizeTransportConfig(webrtc), p2pUrl, tailscaleUrl }
      validate(next)
      write(next)
      state = next
    },
    setMode(mode) {
      if (!GATEWAY_MODES.includes(mode)) throw new TypeError('invalid gateway mode')
      const next = { ...state, mode }
      write(next)
      state = next
    },
  }
}
