// Persistent paired-device registry for mobile-gateway authentication.
//
// Long-lived device tokens are generated with 256 bits of entropy and are
// never written to disk. Only their SHA-256 digests are persisted. Pairing
// codes are one-time, short-lived, and memory-only, so a restart invalidates
// every outstanding QR code without affecting already paired devices.
'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const path = require('node:path')

const STORE_VERSION = 3
const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000

function digest(secret) {
  return crypto.createHash('sha256').update(secret, 'utf8').digest('hex')
}

function safeEqualHex(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b)
}

function publicDevice(device, connections) {
  return {
    id: device.id,
    name: device.name,
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt || null,
    online: connections > 0,
    connections,
  }
}

function normalizeClientDeviceId(value) {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return /^[A-Za-z0-9._:-]{8,128}$/.test(normalized) ? normalized : undefined
}

function createRegistry(file, options = {}) {
  const pairingTtlMs = Number.isSafeInteger(options.pairingTtlMs) && options.pairingTtlMs > 0
    ? options.pairingTtlMs
    : DEFAULT_PAIRING_TTL_MS
  let devices = []
  const pairings = new Map()
  const online = new Map()

  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify({ version: STORE_VERSION, devices }, null, 2), { mode: 0o600 })
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, file)
  }

  const load = () => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (!Array.isArray(parsed.devices)) return
      let migrated = false
      devices = parsed.devices.flatMap((row) => {
        if (!row || typeof row.id !== 'string' || typeof row.name !== 'string') return []
        let tokenHash = typeof row.tokenHash === 'string' ? row.tokenHash : undefined
        // Migrate the v1 development format without invalidating an existing
        // device. The plaintext is removed on the next atomic save.
        if (!tokenHash && typeof row.token === 'string' && row.token !== '') {
          tokenHash = digest(row.token)
          migrated = true
        }
        if (!tokenHash || !/^[a-f0-9]{64}$/.test(tokenHash)) return []
        return [{
          id: row.id,
          name: row.name.slice(0, 80),
          clientDeviceId: normalizeClientDeviceId(row.clientDeviceId),
          tokenHash,
          createdAt: Number.isFinite(row.createdAt) ? row.createdAt : Date.now(),
          lastSeenAt: Number.isFinite(row.lastSeenAt) ? row.lastSeenAt : null,
          revokedAt: Number.isFinite(row.revokedAt) ? row.revokedAt : (row.revoked ? Date.now() : null),
        }]
      })
      if (migrated || parsed.version !== STORE_VERSION) save()
      else fs.chmodSync(file, 0o600)
    } catch (error) {
      if (error && error.code !== 'ENOENT') throw new Error(`failed to load device registry: ${error.message}`, { cause: error })
    }
  }

  const prunePairings = (now = Date.now()) => {
    for (const [codeHash, pairing] of pairings) {
      if (pairing.expiresAt <= now) pairings.delete(codeHash)
    }
  }

  load()

  return {
    list() {
      return devices
        .filter((device) => !device.revokedAt)
        .map((device) => publicDevice(device, online.get(device.id) || 0))
    },

    count() {
      return devices.filter((device) => !device.revokedAt).length
    },

    createPairing(name) {
      prunePairings()
      const code = crypto.randomBytes(32).toString('base64url')
      const pairing = {
        id: crypto.randomUUID(),
        name: typeof name === 'string' && name.trim() !== '' ? name.trim().slice(0, 80) : '未命名设备',
        expiresAt: Date.now() + pairingTtlMs,
      }
      pairings.set(digest(code), pairing)
      return { ...pairing, code }
    },

    hasPairing(code) {
      prunePairings()
      return typeof code === 'string' && pairings.has(digest(code))
    },

    claimPairing(code, clientDeviceId) {
      prunePairings()
      if (typeof code !== 'string' || code === '') return undefined
      const codeHash = digest(code)
      const pairing = pairings.get(codeHash)
      if (!pairing) return undefined
      // Delete before doing any further work: claiming is single-use even if a
      // later socket upgrade fails.
      pairings.delete(codeHash)
      const token = crypto.randomBytes(32).toString('base64url')
      const normalizedClientDeviceId = normalizeClientDeviceId(clientDeviceId)
      let device = normalizedClientDeviceId
        ? devices.find((candidate) => !candidate.revokedAt && candidate.clientDeviceId === normalizedClientDeviceId)
        : undefined
      if (device) {
        // A valid one-time pairing code authorizes credential rotation. Keep
        // the stable server-side device record while replacing its token, so
        // re-pairing one iOS installation never creates duplicate rows.
        device.name = pairing.name
        device.tokenHash = digest(token)
        device.clientDeviceId = normalizedClientDeviceId
      } else {
        device = {
          id: pairing.id,
          name: pairing.name,
          clientDeviceId: normalizedClientDeviceId,
          tokenHash: digest(token),
          createdAt: Date.now(),
          lastSeenAt: null,
          revokedAt: null,
        }
        devices.push(device)
      }
      save()
      return { device: publicDevice(device, 0), token }
    },

    authenticate(token, clientDeviceId) {
      if (typeof token !== 'string' || token === '') return undefined
      const tokenHash = digest(token)
      const device = devices.find((candidate) => !candidate.revokedAt && safeEqualHex(candidate.tokenHash, tokenHash))
      const normalizedClientDeviceId = normalizeClientDeviceId(clientDeviceId)
      if (device && normalizedClientDeviceId && !device.clientDeviceId) {
        // Migration path for devices paired before installation IDs existed:
        // a valid long-lived token proves ownership of this record, so it is
        // safe to bind the client's stable ID without creating a new device.
        const conflict = devices.some((candidate) => candidate !== device && !candidate.revokedAt && candidate.clientDeviceId === normalizedClientDeviceId)
        if (!conflict) {
          device.clientDeviceId = normalizedClientDeviceId
          save()
        }
      }
      return device ? publicDevice(device, online.get(device.id) || 0) : undefined
    },

    connected(deviceId) {
      const device = devices.find((candidate) => candidate.id === deviceId && !candidate.revokedAt)
      if (!device) return false
      online.set(deviceId, (online.get(deviceId) || 0) + 1)
      device.lastSeenAt = Date.now()
      save()
      return true
    },

    disconnected(deviceId) {
      const count = online.get(deviceId) || 0
      if (count <= 1) online.delete(deviceId)
      else online.set(deviceId, count - 1)
    },

    revoke(deviceId) {
      const index = devices.findIndex((candidate) => candidate.id === deviceId && !candidate.revokedAt)
      if (index < 0) return false
      devices.splice(index, 1)
      online.delete(deviceId)
      save()
      return true
    },
  }
}

module.exports = { createRegistry, digest }
