import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export function webRestartAvailable(profile, runtime = process) {
  if (profile?.name !== 'web' || !runtime.argv?.[1]) return false
  try {
    return /[/\\]@deepseek-ai[/\\]dsh[/\\]lib[/\\]bin\.js$/.test(realpathSync(runtime.argv[1]))
  } catch {
    return false
  }
}

export async function prepareWebRestart(runtime = process, spawnChild = spawn) {
  const argv = runtime.argv.slice(1)
  // DSH Web opens a browser on every boot by default. This restart was
  // initiated from an existing tab, so keep that tab and suppress the handoff.
  const terminator = argv.indexOf('--')
  const flagEnd = terminator < 0 ? argv.length : terminator
  if (!argv.slice(0, flagEnd).includes('--no-open')) argv.splice(flagEnd, 0, '--no-open')
  const payload = Buffer.from(JSON.stringify({
    pid: runtime.pid,
    execPath: runtime.execPath,
    execArgv: runtime.execArgv,
    argv,
    cwd: runtime.cwd(),
  })).toString('base64url')
  const helper = spawnChild(runtime.execPath, [fileURLToPath(new URL('./web-restart.mjs', import.meta.url)), payload], {
    cwd: runtime.cwd(), env: runtime.env, detached: true, stdio: 'ignore',
  })
  await new Promise((resolve, reject) => {
    helper.once('spawn', resolve)
    helper.once('error', reject)
  })
  helper.unref()
}
