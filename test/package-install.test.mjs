import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = fileURLToPath(new URL('../', import.meta.url))

test('published tarball keeps RTC disabled by default and loads it on opt-in with npm and pnpm without optional dependencies', { timeout: 300000 }, async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
  assert.equal(manifest.dependencies.werift, '0.25.2')
  assert.equal(manifest.optionalDependencies?.werift, undefined)
  assert.equal(manifest.engines.node, '>=22')
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-package-install-'))
  const env = { ...process.env }
  delete env.NODE_PATH
  // npm run 会向子进程注入 npm_config_*；安装验收必须使用临时项目自身的配置。
  for (const key of Object.keys(env)) if (key.toLowerCase().startsWith('npm_config_')) delete env[key]
  try {
    const packed = await run('npm', ['pack', '--json', '--pack-destination', temp, '--ignore-scripts'], { cwd: root, env })
    const artifact = JSON.parse(packed.stdout)[0]
    for (const file of ['lib/rtc-adapter.mjs', 'lib/rtc-worker-client.mjs', 'lib/rtc-worker.mjs', 'lib/transport-negotiation.mjs', 'lib/network-diagnostics.mjs']) {
      assert(artifact.files.some(entry => entry.path === file), `发布包缺少 ${file}`)
    }
    const tarball = path.join(temp, artifact.filename)
    console.log('已生成真正的插件 tarball，开始独立安装验收')
    for (const manager of ['npm', 'pnpm']) {
      const cwd = path.join(temp, manager)
      await fs.mkdir(cwd)
      await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name: 'gateway-install-fixture', version: '1.0.0', private: true, dependencies: { [manifest.name]: `file:${tarball}` } }))
      const args = manager === 'npm'
        ? ['install', '--omit=dev', '--omit=optional', '--ignore-scripts', '--no-audit', '--no-fund']
        : ['install', '--prod', '--no-optional', '--ignore-scripts', '--store-dir', path.join(temp, 'pnpm-store')]
      await run(manager, args, { cwd, env, timeout: 180000, maxBuffer: 2 * 1024 * 1024 })
      const installed = path.join(cwd, 'node_modules', manifest.name)
      assert.equal((await fs.lstat(installed)).isSymbolicLink(), manager === 'pnpm')
      await fs.writeFile(path.join(cwd, 'check.mjs'), `
        import assert from 'node:assert/strict'
        import { createRequire } from 'node:module'
        const entry = import.meta.resolve('dsh-plugin-mobile-gateway')
        const require = createRequire(entry)
        const rtc = require('werift')
        assert.equal(typeof rtc.RTCPeerConnection, 'function')
        const adapterURL = new URL('./rtc-adapter.mjs', entry)
        const { loadRtcAdapter } = await import(adapterURL)
        assert.equal((await loadRtcAdapter()).name, 'werift-worker')
        const { createTransportNegotiator } = await import(new URL('./transport-negotiation.mjs', entry))
        const { rtcWorkerCount } = await import(new URL('./rtc-worker-client.mjs', entry))
        const manager = createTransportNegotiator({ config: {}, identity: {}, isAuthorized: () => false })
        try {
          await manager.loaded
          assert.equal(manager.snapshot().runtime, 'disabled')
          assert.equal(manager.snapshot().enabled, false)
          assert.equal(manager.available, false)
          assert.equal(rtcWorkerCount(), 0)
          manager.configure({ enabled: true })
          await manager.loaded
          assert.equal(manager.snapshot().runtime, 'available')
          assert.equal(manager.snapshot().enabled, true)
          assert.equal(manager.available, true)
          assert.deepEqual(manager.snapshot().stunServers, ['stun:stun.cloudflare.com:3478'])
          assert.equal(rtcWorkerCount(), 0)
        } finally { await manager.dispose() }
        assert.equal(rtcWorkerCount(), 0)
        console.log('RTC disabled by default and available on opt-in; no gateway or PeerConnection started')
      `)
      const checked = await run(process.execPath, [path.join(cwd, 'check.mjs')], { cwd, env, timeout: 30000 })
      assert.match(checked.stdout, /RTC disabled by default and available on opt-in/)
      await run(process.execPath, ['--check', path.join(installed, 'lib/rtc-worker.mjs')], { cwd, env })
      console.log(`${manager}：禁用可选依赖的生产安装通过，RTC 默认关闭、显式启用后可用；未启动网关`)
    }
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
})
