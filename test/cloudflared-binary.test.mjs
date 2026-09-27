import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cloudflaredAsset, ensureCloudflared } from '../lib/cloudflared-binary.mjs'

assert.equal(cloudflaredAsset('darwin', 'arm64'), 'cloudflared-darwin-arm64.tgz')
assert.equal(cloudflaredAsset('darwin', 'x64'), 'cloudflared-darwin-amd64.tgz')
assert.equal(cloudflaredAsset('win32', 'x64'), 'cloudflared-windows-amd64.exe')
assert.throws(() => cloudflaredAsset('linux', 'x64'), /unsupported/)

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-cloudflared-binary-'))
const assetName = cloudflaredAsset('win32', 'x64')
const assetUrl = `https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/${assetName}`
const binary = Buffer.from('fake cloudflared binary')
const digest = crypto.createHash('sha256').update(binary).digest('hex')
let calls = 0
const fetchImpl = async (url) => {
  calls += 1
  assert.equal(url, assetUrl)
  return new Response(binary, { status: 200 })
}
try {
  const installedDir = path.join(temp, 'external')
  await fs.mkdir(installedDir)
  const externalBinary = path.join(installedDir, 'cloudflared.exe')
  await fs.writeFile(externalBinary, 'another app owns this binary')
  const previousPath = process.env.PATH
  process.env.PATH = `${installedDir}${path.delimiter}${previousPath || ''}`
  let file
  try {
    file = await ensureCloudflared({ cacheDir: temp, platform: 'win32', arch: 'x64', fetchImpl,
      releaseDigests: { [assetName]: digest }, binaryDigests: { [assetName]: digest } })
  } finally {
    if (previousPath === undefined) delete process.env.PATH
    else process.env.PATH = previousPath
  }
  assert.notEqual(file, externalBinary)
  assert.deepEqual(await fs.readFile(file), binary)
  assert.equal(calls, 1)
  assert.equal(await ensureCloudflared({ cacheDir: temp, platform: 'win32', arch: 'x64', fetchImpl,
    releaseDigests: { [assetName]: digest }, binaryDigests: { [assetName]: digest } }), file)
  assert.equal(calls, 1)
  await fs.writeFile(file, 'corrupted cache')
  assert.equal(await ensureCloudflared({ cacheDir: temp, platform: 'win32', arch: 'x64', fetchImpl,
    releaseDigests: { [assetName]: digest }, binaryDigests: { [assetName]: digest } }), file)
  assert.deepEqual(await fs.readFile(file), binary)
  assert.equal(calls, 2)
  assert.equal(await ensureCloudflared({ cacheDir: temp, executable: externalBinary,
    fetchImpl: () => { throw new Error('unexpected download') } }), externalBinary)
  const broken = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-cloudflared-broken-'))
  try {
    await assert.rejects(ensureCloudflared({ cacheDir: broken, platform: 'win32', arch: 'x64',
      fetchImpl,
      releaseDigests: { [assetName]: '0'.repeat(64) },
      binaryDigests: { [assetName]: digest },
    }), /checksum mismatch/)
    assert.deepEqual(await fs.readdir(broken), [])
    await assert.rejects(ensureCloudflared({ cacheDir: broken, platform: 'win32', arch: 'x64',
      fetchImpl: async (url) => {
        assert.equal(url, assetUrl)
        return new Response(null, { status: 403 })
      },
    }), /HTTP 403 from GitHub Releases/)
    assert.deepEqual(await fs.readdir(broken), [])
  } finally {
    await fs.rm(broken, { recursive: true, force: true })
  }
  if (process.platform !== 'win32') {
    const sourceDir = path.join(temp, 'mac-source')
    await fs.mkdir(sourceDir)
    await fs.writeFile(path.join(sourceDir, 'cloudflared'), binary)
    const archiveFile = path.join(temp, 'cloudflared.tgz')
    execFileSync('tar', ['-czf', archiveFile, '-C', sourceDir, 'cloudflared'])
    const archive = await fs.readFile(archiveFile)
    const macDigest = crypto.createHash('sha256').update(archive).digest('hex')
    const macName = cloudflaredAsset('darwin', 'arm64')
    const macUrl = `https://github.com/cloudflare/cloudflared/releases/download/2026.9.3/${macName}`
    const macFile = await ensureCloudflared({ cacheDir: path.join(temp, 'mac-cache'), platform: 'darwin', arch: 'arm64',
      releaseDigests: { [macName]: macDigest },
      binaryDigests: { [macName]: digest },
      fetchImpl: async (url) => {
        assert.equal(url, macUrl)
        return new Response(archive, { status: 200 })
      },
    })
    assert.deepEqual(await fs.readFile(macFile), binary)
    assert.equal((await fs.stat(macFile)).mode & 0o777, 0o700)
  }
} finally {
  await fs.rm(temp, { recursive: true, force: true })
}
console.log('CLOUDFLARED BINARY TESTS PASSED')
