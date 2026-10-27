// Detached handoff process: only launched by the loopback-only management API.
import { spawn } from 'node:child_process'
import { openSync, closeSync } from 'node:fs'
import { LOG_FILE, log } from './logging.mjs'

const note = (message) => log(`web restart: ${message}`)

try {
  const spec = JSON.parse(Buffer.from(process.argv[2] || '', 'base64url').toString())
  if (!Number.isSafeInteger(spec.pid) || spec.pid <= 0 || typeof spec.execPath !== 'string'
    || !Array.isArray(spec.execArgv) || !Array.isArray(spec.argv) || typeof spec.cwd !== 'string') {
    throw new Error('invalid restart handoff')
  }
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try { process.kill(spec.pid, 0) } catch (error) {
      if (error.code === 'ESRCH') break
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  try {
    process.kill(spec.pid, 0)
    throw new Error('old DSH Web process did not exit within 30 seconds')
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
  let fd
  try {
    fd = openSync(LOG_FILE, 'a')
  } catch (error) {
    note(`cannot redirect child logs to ${LOG_FILE}: ${error?.message || String(error)}`)
  }
  try {
    const child = spawn(spec.execPath, [...spec.execArgv, ...spec.argv], {
      cwd: spec.cwd, env: process.env, detached: true, stdio: ['ignore', fd ?? 'inherit', fd ?? 'inherit'],
    })
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve)
      child.once('error', reject)
    })
    child.unref()
    note(`started DSH Web pid=${child.pid}`)
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
} catch (error) {
  note(error?.message || String(error))
  process.exitCode = 1
}
