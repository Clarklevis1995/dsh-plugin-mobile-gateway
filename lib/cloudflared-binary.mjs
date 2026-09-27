import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CLOUDFLARED_VERSION = '2026.9.3'
const MAX_RELEASE_BYTES = 80 * 1024 * 1024
// GitHub's asset digests for the pinned Cloudflare release. The release API may
// return 403 even when the public release assets remain available.
const RELEASE_DIGESTS = Object.freeze({
  'cloudflared-darwin-amd64.tgz': 'd1155d0837487f261183b15c1eab6c4ebcad9dc49b94675f1524c3564cea3977',
  'cloudflared-darwin-arm64.tgz': '587c2cfb1c230fe36c7fa7727da78be459dae028cabe8c001291999350f07095',
  'cloudflared-windows-386.exe': '9b95ddc2eba67b86ed3dc4cc2a15881960563031b52ce564376af41fb91ad402',
  'cloudflared-windows-amd64.exe': 'f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2',
})
const BINARY_DIGESTS = Object.freeze({
  'cloudflared-darwin-amd64.tgz': 'ab588b3b4db9cdb4476c30a3db2a72635b1d8327d44741fee6799a0f37b0ec07',
  'cloudflared-darwin-arm64.tgz': '5472c1a01c84bc31b3021056a73b4e5774ddddefc572124ea8fdf6c340639f32',
  'cloudflared-windows-386.exe': RELEASE_DIGESTS['cloudflared-windows-386.exe'],
  'cloudflared-windows-amd64.exe': RELEASE_DIGESTS['cloudflared-windows-amd64.exe'],
})

export function cloudflaredAsset(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) {
    return `cloudflared-darwin-${arch === 'x64' ? 'amd64' : 'arm64'}.tgz`
  }
  if (platform === 'win32' && arch === 'x64') return 'cloudflared-windows-amd64.exe'
  if (platform === 'win32' && arch === 'ia32') return 'cloudflared-windows-386.exe'
  throw new Error(`unsupported Cloudflare PC architecture: ${platform}/${arch}`)
}

async function readBounded(response, limit) {
  if (!response.ok) throw new Error(`Cloudflare binary download returned HTTP ${response.status} from GitHub Releases`)
  const length = Number(response.headers.get('content-length'))
  if (length > limit) throw new Error('Cloudflare binary download exceeds the size limit')
  const chunks = []
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > limit) throw new Error('Cloudflare binary download exceeds the size limit')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks, size)
}

async function regularExecutable(file) {
  try { return (await fs.lstat(file)).isFile() } catch { return false }
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

// The default executable stays in DSH's private cache. External binaries are
// used only when an explicit path is configured.
export async function ensureCloudflared({ cacheDir, executable = 'cloudflared',
  platform = process.platform, arch = process.arch, fetchImpl = fetch,
  releaseDigests = RELEASE_DIGESTS, binaryDigests = BINARY_DIGESTS } = {}) {
  if (executable !== 'cloudflared') return executable
  const assetName = cloudflaredAsset(platform, arch)
  const destination = path.join(cacheDir, `${CLOUDFLARED_VERSION}-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`)
  await fs.mkdir(cacheDir, { recursive: true, mode: 0o700 })
  await fs.chmod(cacheDir, 0o700)
  const expectedDigest = releaseDigests[assetName]
  const expectedBinaryDigest = binaryDigests[assetName]
  if (!/^[0-9a-f]{64}$/.test(expectedDigest || '') ||
      !/^[0-9a-f]{64}$/.test(expectedBinaryDigest || '')) {
    throw new Error('Cloudflare release has no verifiable binary for this PC')
  }
  if (await regularExecutable(destination)) {
    if (await sha256File(destination) === expectedBinaryDigest) {
      await fs.chmod(destination, 0o700)
      return destination
    }
    await fs.rm(destination)
  }

  const expectedUrl = `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/${assetName}`
  const response = await fetchImpl(expectedUrl, {
    headers: { 'User-Agent': 'dsh-mobile-gateway' },
    signal: AbortSignal.timeout(120_000),
  })
  const archive = await readBounded(response, MAX_RELEASE_BYTES)
  const actual = crypto.createHash('sha256').update(archive).digest('hex')
  if (actual !== expectedDigest) {
    throw new Error('Cloudflare binary checksum mismatch')
  }

  const stage = await fs.mkdtemp(path.join(cacheDir, '.cloudflared-'))
  try {
    let source
    if (assetName.endsWith('.tgz')) {
      const archiveFile = path.join(stage, assetName)
      await fs.writeFile(archiveFile, archive, { mode: 0o600 })
      await execFileAsync('tar', ['-xzf', archiveFile, '-C', stage], { timeout: 30_000 })
      source = path.join(stage, 'cloudflared')
      if (!await regularExecutable(source)) throw new Error('Cloudflare archive contains no cloudflared executable')
    } else {
      source = path.join(stage, 'cloudflared.exe')
      await fs.writeFile(source, archive, { mode: 0o700 })
    }
    if (await sha256File(source) !== expectedBinaryDigest) throw new Error('Cloudflare executable checksum mismatch')
    await fs.chmod(source, 0o700)
    if (!await regularExecutable(destination)) await fs.rename(source, destination)
    return destination
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}
