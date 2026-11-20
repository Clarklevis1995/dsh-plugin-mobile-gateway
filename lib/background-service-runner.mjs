// The systemd-owned runner waits for the foreground server to release its ports.
import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const processStartTime = stat => stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]

export async function waitForPrevious(previous, { read = file => fs.readFile(file, 'utf8'), pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now } = {}) {
  if (await read('/proc/sys/kernel/random/boot_id') !== previous.boot) return
  const deadline = now() + 30_000
  while (true) {
    let stat
    try { stat = await read(`/proc/${previous.pid}/stat`) } catch (error) { if (error.code === 'ENOENT') return; throw error }
    if (processStartTime(stat) !== processStartTime(previous.identity) || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')) return
    if (now() >= deadline) throw new Error('原 DSH Web 未在 30 秒内退出，后台接管失败')
    await pause(200)
  }
}

export async function launch(spec) {
  await waitForPrevious(spec.previous)
  const child = spawn(spec.execPath, spec.args, { cwd: spec.cwd, env: spec.env, stdio: ['ignore', 'inherit', 'inherit'] })
  let stopping = false
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child.kill(signal) })
  child.once('error', error => { console.error(error.message); process.exitCode = 1 })
  child.once('exit', (code, signal) => { process.exitCode = stopping ? 0 : code ?? (signal ? 1 : 0) })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await launch(JSON.parse(await fs.readFile(process.argv[2], 'utf8'))) } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
