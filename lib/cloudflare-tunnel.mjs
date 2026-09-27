import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { ensureCloudflared } from './cloudflared-binary.mjs'

function hostnameOf(value) {
  if (typeof value !== 'string') throw new TypeError('Cloudflare hostname is required')
  const hostname = value.trim().toLowerCase()
  if (hostname.length > 253 || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(hostname) ||
      !hostname.includes('.') || hostname.includes('..') ||
      hostname.split('.').some((label) => label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    throw new TypeError('Cloudflare hostname must be a domain name, for example gateway.example.com')
  }
  return hostname
}

function tokenOf(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 8192 || /\s/.test(value)) {
    throw new TypeError('Cloudflare Tunnel Token must be a nonempty token without whitespace')
  }
  return value
}

function readState(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (value?.version !== 1 || typeof value.enabled !== 'boolean' ||
        typeof value.hostname !== 'string' || typeof value.token !== 'string') {
      throw new TypeError('invalid Cloudflare Tunnel settings')
    }
    if (value.hostname) hostnameOf(value.hostname)
    if (value.token) tokenOf(value.token)
    value.mode ??= 'named'
    if (!['named', 'quick'].includes(value.mode)) throw new TypeError('invalid Cloudflare Tunnel mode')
    if (value.enabled && value.mode === 'named' && (!value.hostname || !value.token)) {
      throw new TypeError('enabled named tunnel has no hostname or token')
    }
    fs.chmodSync(file, 0o600)
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, enabled: false, mode: 'quick', hostname: '', token: '' }
    throw new Error(`failed to load Cloudflare Tunnel settings ${file}: ${error.message}`, { cause: error })
  }
}

function writeState(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
    fs.renameSync(temporary, file)
    fs.chmodSync(file, 0o600)
  } finally {
    fs.rmSync(temporary, { force: true })
  }
}

// A separate loopback listener exposes only the mobile WebSocket. In particular,
// Cloudflare can never reach the DSH WebUI or the /mgw management API through it.
export function createCloudflareTunnel({ file, port = 3082, wsPath, executable = 'cloudflared',
  supported = true, isGatewayEnabled, onUpgrade, log = () => {}, spawnProcess = spawn,
  prepareExecutable = ensureCloudflared }) {
  let settings = supported ? readState(file) : { version: 1, enabled: false, mode: 'quick', hostname: '', token: '' }
  let server = null
  let child = null
  let preparing = null
  let retryTimer = null
  let disposed = false
  let phase = 'disabled'
  let error = null
  let quickUrl = null
  let queue = Promise.resolve()
  const sockets = new Set()

  const shouldRun = () => supported && !disposed && settings.enabled && isGatewayEnabled()
  const publicUrl = () => settings.mode === 'quick'
    ? quickUrl
    : settings.hostname ? `wss://${settings.hostname}${wsPath}` : null
  const snapshot = () => ({
    supported,
    enabled: settings.enabled,
    mode: settings.mode,
    configured: !!(settings.hostname && settings.token),
    hostname: settings.hostname || null,
    publicUrl: settings.enabled ? publicUrl() : null,
    port,
    state: !settings.enabled ? 'disabled' : !isGatewayEnabled() ? 'waiting-for-gateway' : phase,
    error,
  })

  const stop = async () => {
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
    const previous = child
    child = null
    if (previous && !previous.killed) previous.kill()
    quickUrl = null
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    const listener = server
    server = null
    phase = 'disabled'
    error = null
    if (listener) await new Promise((resolve) => listener.close(resolve))
  }

  const startChild = () => {
    if (!shouldRun() || !server || child || preparing) return
    phase = 'preparing'
    error = null
    preparing = prepareExecutable({ cacheDir: path.join(path.dirname(file), 'cloudflared-bin'), executable })
      .then((binary) => {
        preparing = null
        if (!shouldRun() || !server || child) return
        phase = 'connecting'
        const quick = settings.mode === 'quick'
        const args = quick
          ? ['tunnel', '--no-autoupdate', '--loglevel', 'info', '--url', `http://127.0.0.1:${port}`]
          : ['tunnel', '--no-autoupdate', '--loglevel', 'info', 'run']
        const childEnv = { ...process.env }
        delete childEnv.TUNNEL_TOKEN
        if (!quick) childEnv.TUNNEL_TOKEN = settings.token
        const running = spawnProcess(binary, args, {
          env: childEnv,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        })
        child = running
        let diagnostics = ''
        let outputTail = ''
        let registered = false
        const onOutput = (chunk) => {
          if (child !== running) return
          const lines = chunk.toString().slice(0, 4096)
          outputTail = (outputTail + lines).slice(-4096)
          if (quick) {
            const match = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com\b/i.exec(outputTail)
            if (match) quickUrl = `wss://${match[1].toLowerCase()}.trycloudflare.com${wsPath}`
          }
          if (/Registered tunnel connection/i.test(outputTail)) {
            registered = true
            outputTail = ''
          } else if (/ERR|error/i.test(lines)) {
            diagnostics = (settings.token ? outputTail.replaceAll(settings.token, '[redacted]') : outputTail)
              .replace(/eyJ[A-Za-z0-9._=-]+/g, '[redacted]').trim().slice(-500)
          }
          if (registered && (!quick || quickUrl)) {
            phase = 'online'
            error = null
          }
        }
        running.stderr?.on('data', onOutput)
        running.stdout?.on('data', onOutput)
        const exited = (reason) => {
          if (child !== running) return
          child = null
          quickUrl = null
          phase = 'error'
          error = reason || diagnostics || 'cloudflared exited unexpectedly'
          log(`Cloudflare Tunnel stopped: ${error}`)
          if (shouldRun()) retryTimer = setTimeout(() => { retryTimer = null; startChild() }, 10_000)
        }
        running.once('error', (cause) => exited(cause.code === 'ENOENT'
          ? 'cloudflared is not installed or is not on PATH'
          : `cloudflared failed: ${cause.message}`))
        running.once('exit', (code, signal) => exited(diagnostics || `cloudflared exited (${signal || code})`))
      })
      .catch((cause) => {
        preparing = null
        if (!shouldRun()) return
        phase = 'error'
        error = `Cloudflare binary preparation failed: ${cause.message}`
        log(error)
        retryTimer = setTimeout(() => { retryTimer = null; startChild() }, 30_000)
      })
  }

  const start = async () => {
    if (server || !shouldRun()) return
    phase = 'starting'
    error = null
    const listener = http.createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
      res.end('Not found')
    })
    listener.on('connection', (socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
    listener.on('upgrade', (req, socket, head) => {
      let pathname
      try { pathname = new URL(req.url || '/', 'http://localhost').pathname } catch { pathname = '' }
      if (pathname !== wsPath) {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
        return
      }
      onUpgrade(req, socket, head, { lan: true, port })
    })
    try {
      await new Promise((resolve, reject) => {
        listener.once('error', reject)
        listener.listen(port, '127.0.0.1', () => {
          listener.off('error', reject)
          resolve()
        })
      })
      if (!shouldRun()) {
        listener.close()
        return
      }
      server = listener
      listener.on('error', (cause) => {
        const message = `Cloudflare origin listener failed: ${cause.message}`
        void stop().then(() => {
          if (!shouldRun()) return
          phase = 'error'
          error = message
          log(message)
          retryTimer = setTimeout(() => { retryTimer = null; void reconcile() }, 10_000)
        })
      })
      startChild()
    } catch (cause) {
      try { listener.close() } catch { /* The listener never opened. */ }
      if (shouldRun()) {
        phase = 'error'
        error = `Cloudflare origin listener failed: ${cause.message}`
        log(error)
        retryTimer = setTimeout(() => { retryTimer = null; void reconcile() }, 10_000)
      }
    }
  }

  const reconcile = () => {
    queue = queue.catch(() => {}).then(async () => {
      if (shouldRun()) await start()
      else await stop()
    })
    return queue
  }

  const configure = async ({ enabled, mode, hostname, token }) => {
    if (!supported) throw new TypeError('Cloudflare Tunnel is available on PC only')
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
    const next = {
      version: 1,
      enabled,
      mode: mode === undefined ? settings.mode : mode,
      hostname: hostname === undefined ? settings.hostname : hostnameOf(hostname),
      token: token === undefined || token === '' ? settings.token : tokenOf(token),
    }
    if (!['named', 'quick'].includes(next.mode)) throw new TypeError('mode must be named or quick')
    if (enabled && next.mode === 'named' && (!next.hostname || !next.token)) {
      throw new TypeError('hostname and Tunnel Token are required')
    }
    const changed = next.mode !== settings.mode || next.hostname !== settings.hostname || next.token !== settings.token
    writeState(file, next)
    settings = next
    if (changed) await stop()
    await reconcile()
    return snapshot()
  }

  const dispose = () => { disposed = true; void stop() }
  return { snapshot, configure, reconcile, dispose }
}
