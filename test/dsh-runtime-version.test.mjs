import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { resolveDshRuntimeVersion } from '../lib/dsh-runtime-version.mjs'

test('报告宿主启动包实际版本，支持符号链接入口与版本升级', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-version-'))
  try {
    const entry = path.join(root, 'lib/bin.js')
    fs.mkdirSync(path.dirname(entry), { recursive: true })
    fs.writeFileSync(entry, '')
    const dir = path.join(root, 'node_modules/@deepseek-ai/dsh-app-boot')
    fs.mkdirSync(dir, { recursive: true })
    const manifest = path.join(dir, 'package.json')
    const write = version => fs.writeFileSync(manifest, JSON.stringify({ name: '@deepseek-ai/dsh-app-boot', version }))
    const link = path.join(root, 'dsh')
    fs.symlinkSync(entry, link)
    write('0.2.1-rc.5')
    assert.equal(resolveDshRuntimeVersion(link), '0.2.1-rc.5')
    write('0.2.1-rc.6+build.1')
    assert.equal(resolveDshRuntimeVersion(entry), '0.2.1-rc.6+build.1')
    write('unknown')
    assert.equal(resolveDshRuntimeVersion(entry), undefined)
    fs.writeFileSync(manifest, '{broken')
    assert.equal(resolveDshRuntimeVersion(entry), undefined)
    fs.unlinkSync(manifest)
    assert.equal(resolveDshRuntimeVersion(entry), undefined)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('未知宿主不回退为适配基线', () => {
  assert.equal(resolveDshRuntimeVersion(''), undefined)
  assert.equal(resolveDshRuntimeVersion('/nonexistent/dsh/bin.js'), undefined)
})
