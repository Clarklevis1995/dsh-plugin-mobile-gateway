import assert from 'node:assert/strict'
import { test } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createBackgroundService, unitQuote } from '../lib/background-service.mjs'
import { waitForPrevious } from '../lib/background-service-runner.mjs'

async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-background-'))
  t.after(() => fs.rm(home, { recursive: true, force: true }))
  const bin = path.join(home, '@deepseek-ai/dsh/lib/bin.js')
  await fs.mkdir(path.dirname(bin), { recursive: true })
  await fs.writeFile(bin, '')
  const runtime = { platform: 'linux', argv: [process.execPath, bin, 'web'], execArgv: [], execPath: process.execPath,
    pid: 123, getuid: () => 1000, cwd: () => home, env: { PATH: '/bin', API_TOKEN: 'private' } }
  let enabled = false, linger = options.linger ?? true
  const calls = []
  const run = async (exe, args) => {
    calls.push([exe, ...args])
    if (options.noBus && exe === 'systemctl') throw new Error('no bus')
    if (args.includes('show-user')) return { stdout: linger ? 'yes' : 'no' }
    if (args.includes('enable-linger')) { if (options.denied) throw new Error('denied'); linger = true }
    if (args.includes('is-enabled')) return { stdout: enabled ? 'enabled' : 'disabled' }
    if (args.includes('is-active')) return { stdout: options.active ? 'active' : 'inactive' }
    if (args.includes('enable')) enabled = true
    if (args.includes('disable')) enabled = false
    return { stdout: '' }
  }
  const args = { profile: { name: 'web' }, runtime, home, run, readProc: async file => file.includes('boot_id') ? 'boot' : 'stat' }
  return { home, runtime, args, calls, service: createBackgroundService(args) }
}

test('installs a private launch snapshot, enables systemd, and disables without stopping', async t => {
  const f = await fixture(t, { linger: false })
  const result = await f.service.configure(true)
  assert.equal(result.handoff, true)
  assert.equal(result.enabled, true)
  assert.equal(result.linger, true)
  const directory = path.join(f.home, '.config/systemd/user')
  const unit = await fs.readFile(path.join(directory, result.unit), 'utf8')
  assert.match(unit, /Restart=on-failure/)
  assert.match(unit, /WantedBy=default.target/)
  assert.ok(!unit.includes('private'))
  const specPath = path.join(directory, result.unit + '.json')
  assert.equal((await fs.stat(specPath)).mode & 0o777, 0o600)
  const spec = JSON.parse(await fs.readFile(specPath, 'utf8'))
  assert.equal(spec.env.API_TOKEN, 'private')
  assert.equal(spec.env.DSH_BACKGROUND_UNIT, result.unit)
  assert.deepEqual(spec.args, [...f.runtime.argv.slice(1), '--no-open'])
  const managed = createBackgroundService({ ...f.args, runtime: { ...f.runtime, argv: [process.execPath, ...spec.args], env: spec.env } })
  assert.equal(managed.managed, true)
  assert.equal((await managed.status()).unit, result.unit)
  await managed.control('restart')
  assert.ok(f.calls.some(call => call.includes('--no-block') && call.includes('restart')))
  assert.equal((await managed.configure(false)).enabled, false)
  assert.ok(!f.calls.some(call => call.includes('stop') || call.includes('disable-linger')))
})

test('unsupported profiles and missing systemd cannot enable a service', async t => {
  const f = await fixture(t, { noBus: true })
  assert.equal((await f.service.status()).available, false)
  await assert.rejects(f.service.configure(true), /systemd/)
  assert.equal((await createBackgroundService({ ...f.args, profile: { name: 'tui' } }).status()).supported, false)
})

test('denied linger and running duplicate leave the foreground server intact', async t => {
  const denied = await fixture(t, { linger: false, denied: true })
  await assert.rejects(denied.service.configure(true), /sudo loginctl enable-linger 1000/)
  assert.ok(!denied.calls.some(call => call.includes('start')))
  const active = await fixture(t, { active: true })
  await assert.rejects(active.service.configure(true), /已有后台服务/)
  assert.ok(!active.calls.some(call => call.includes('enable')))
})

test('systemd paths escape specifiers, quotes and shell expansion characters', () => {
  assert.equal(unitQuote('/a b/"%$\\'), '"/a b/\\"%%$$\\\\"')
  assert.throws(() => unitQuote('/a\nb'))
})

const stat = (start, state = 'S') => `123 (name with ) spaces) ${state} ${Array(18).fill('0').join(' ')} ${start} 0`
test('handoff waits for the old process, detects PID reuse and reboot, and times out', async () => {
  const previous = { pid: 123, identity: stat(42), boot: 'boot' }
  let pauses = 0
  await waitForPrevious(previous, { read: async file => file.includes('boot_id') ? 'boot' : stat(pauses ? 43 : 42), pause: async () => { pauses++ } })
  assert.equal(pauses, 1)
  await waitForPrevious(previous, { read: async () => 'new-boot' })
  await waitForPrevious(previous, { read: async file => file.includes('boot_id') ? 'boot' : stat(42, 'Z') })
  let time = 0
  await assert.rejects(waitForPrevious(previous, { read: async file => file.includes('boot_id') ? 'boot' : stat(42), now: () => time, pause: async () => { time += 30_000 } }), /30 秒/)
})
