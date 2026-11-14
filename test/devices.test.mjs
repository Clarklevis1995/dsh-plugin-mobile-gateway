import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const { createRegistry } = createRequire(import.meta.url)('../lib/devices.js')
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-bulk-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, 'devices.json'), registry = createRegistry(file)
  const phones = ['a', 'b', 'c'].map(name => registry.claimPairing(registry.createPairing().code, `installation-${name}`, name))
  return { dir, file, registry, phones }
}
test('bulk revocation persists selected devices only and invalidates their credentials and permissions', t => {
  const { file, registry, phones: [a, b, c] } = fixture(t)
  registry.connected(a.device.id)
  registry.setPermissions(a.device.id, { calendar: true })
  registry.setPermissions(c.device.id, { photos: true })
  assert.deepEqual(registry.revokeMany([a.device.id, b.device.id, a.device.id, 'already-removed']), [a.device.id, b.device.id])
  assert.equal(registry.count(), 1)
  assert.equal(registry.authenticate(a.token), undefined)
  assert.equal(registry.authenticate(b.token), undefined)
  assert.equal(registry.authenticate(c.token).permissions.photos, true)
  const reloaded = createRegistry(file)
  assert.deepEqual(reloaded.list().map(row => row.id), [c.device.id])
  assert.equal(reloaded.list()[0].permissions.photos, true)
  assert.deepEqual(registry.revokeMany([a.device.id]), [])
  assert.equal(registry.revoke(c.device.id), true)
  assert.equal(registry.revoke(c.device.id), false)
})
test('bulk revocation validates the full batch before changing any device', t => {
  const { registry, phones: [a] } = fixture(t)
  for (const ids of [null, {}, [], [a.device.id, null], [a.device.id, ' '], ['x'.repeat(129)]]) {
    assert.throws(() => registry.revokeMany(ids), TypeError)
    assert.equal(registry.count(), 3)
    assert.ok(registry.authenticate(a.token))
  }
})
test('failed batch persistence restores devices, permissions, online state and credentials', t => {
  const { file, registry, phones: [a, b] } = fixture(t)
  registry.connected(a.device.id)
  registry.setPermissions(a.device.id, { calendar: true })
  const before = registry.list(), backup = `${file}.backup`
  fs.renameSync(file, backup); fs.mkdirSync(file)
  assert.throws(() => registry.revokeMany([a.device.id, b.device.id]))
  assert.deepEqual(registry.list(), before)
  assert.ok(registry.authenticate(a.token))
  assert.ok(registry.authenticate(b.token))
  assert.throws(() => registry.revoke(a.device.id))
  assert.deepEqual(registry.list(), before)
  fs.rmdirSync(file); fs.renameSync(backup, file)
  assert.equal(createRegistry(file).count(), 3)
})
