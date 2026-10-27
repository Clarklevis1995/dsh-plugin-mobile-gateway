import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const loggingURL = new URL('../lib/logging.mjs', import.meta.url).href
const restartPath = new URL('../lib/web-restart.mjs', import.meta.url)

function inTemporaryDirectory(body) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-logging-'))
  try { body(directory) } finally { fs.rmSync(directory, { recursive: true, force: true }) }
}

function environment(directory) {
  // Windows 使用 TEMP/TMP；Unix 使用 TMPDIR。
  return { ...process.env, TMPDIR: directory, TEMP: directory, TMP: directory }
}

function writeFixture(directory) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { log } from ${JSON.stringify(loggingURL)}; log('logging-fixture')`],
  { env: environment(directory), encoding: 'utf8' })
}

test('writes logs under the platform temporary directory, including paths with spaces', () => {
  inTemporaryDirectory(root => {
    const directory = path.join(root, 'temporary logs')
    fs.mkdirSync(directory)
    const result = writeFixture(directory)
    assert.equal(result.status, 0, result.stderr)
    assert.match(fs.readFileSync(path.join(directory, 'mobile-gateway.log'), 'utf8'), /logging-fixture/)
    assert.match(result.stdout, /logging-fixture/)
    assert.equal(result.stderr, '')
  })
})

test('reports file failures to stderr and preserves normal output without throwing', () => {
  inTemporaryDirectory(root => {
    const result = writeFixture(path.join(root, 'missing-directory'))
    assert.equal(result.status, 0)
    assert.match(result.stdout, /logging-fixture/)
    assert.match(result.stderr, /cannot write log file/)
    assert.match(result.stderr, /mobile-gateway\.log/)
  })
})

test('restart diagnostics use the same platform log file', () => {
  inTemporaryDirectory(directory => {
    const result = spawnSync(process.execPath, [fileURLToPath(restartPath),
      Buffer.from(JSON.stringify({ pid: -1 })).toString('base64url')],
    { env: environment(directory), encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(fs.readFileSync(path.join(directory, 'mobile-gateway.log'), 'utf8'), /invalid restart handoff/)
  })
})
