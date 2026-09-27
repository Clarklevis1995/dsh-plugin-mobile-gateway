import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { webRestartAvailable, prepareWebRestart } from '../lib/gateway-tools.mjs'

const temp = mkdtempSync(path.join(os.tmpdir(), 'dsh-gateway-tools-'))
const bin = path.join(temp, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
mkdirSync(path.dirname(bin), { recursive: true })
writeFileSync(bin, '')
const runtime = {
  pid: 1234,
  execPath: process.execPath,
  execArgv: ['--expose-internals'],
  argv: [process.execPath, bin, 'web'],
  cwd: () => temp,
  env: { DSH_HOME: temp },
}
assert.equal(webRestartAvailable({ name: 'web' }, runtime), true)
assert.equal(webRestartAvailable({ name: 'tui' }, runtime), false)
assert.equal(webRestartAvailable({ name: 'web' }, { ...runtime, argv: [process.execPath, 'other.js'] }), false)

let launched
let unrefCount = 0
await prepareWebRestart(runtime, (exe, args, options) => {
  launched = { exe, args, options }
  const child = new EventEmitter()
  child.unref = () => { unrefCount++ }
  queueMicrotask(() => child.emit('spawn'))
  return child
})
assert.equal(launched.exe, runtime.execPath)
assert.equal(launched.options.detached, true)
assert.equal(launched.options.stdio, 'ignore')
assert.equal(unrefCount, 1)
const handoff = JSON.parse(Buffer.from(launched.args[1], 'base64url').toString())
assert.deepEqual(handoff, {
  pid: 1234, execPath: runtime.execPath, execArgv: runtime.execArgv,
  argv: [bin, 'web', '--no-open'], cwd: temp,
})
assert.deepEqual(runtime.argv, [process.execPath, bin, 'web'])

await prepareWebRestart({ ...runtime, argv: [process.execPath, bin, 'web', '--no-open', '--', 'tail'] }, (_exe, args) => {
  launched = { args }
  const child = new EventEmitter()
  child.unref = () => {}
  queueMicrotask(() => child.emit('spawn'))
  return child
})
assert.deepEqual(JSON.parse(Buffer.from(launched.args[1], 'base64url').toString()).argv,
  [bin, 'web', '--no-open', '--', 'tail'])

await prepareWebRestart({ ...runtime, argv: [process.execPath, bin, 'web', '--', '--no-open'] }, (_exe, args) => {
  launched = { args }
  const child = new EventEmitter()
  child.unref = () => {}
  queueMicrotask(() => child.emit('spawn'))
  return child
})
assert.deepEqual(JSON.parse(Buffer.from(launched.args[1], 'base64url').toString()).argv,
  [bin, 'web', '--no-open', '--', '--no-open'])

await prepareWebRestart({ ...runtime, argv: [process.execPath, bin, 'web', '--', 'tail'] }, (_exe, args) => {
  launched = { args }
  const child = new EventEmitter()
  child.unref = () => {}
  queueMicrotask(() => child.emit('spawn'))
  return child
})
assert.deepEqual(JSON.parse(Buffer.from(launched.args[1], 'base64url').toString()).argv,
  [bin, 'web', '--no-open', '--', 'tail'])

console.log('gateway tools tests passed')
