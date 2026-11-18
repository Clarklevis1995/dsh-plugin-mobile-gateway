import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { webRestartAvailable } from './gateway-tools.mjs'

const execute = promisify(execFile)
const MARKER = '# Managed by dsh-plugin-mobile-gateway\n'

// systemd performs specifier and environment expansion even without a shell.
export function unitQuote(value) {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('后台服务路径包含不支持的控制字符')
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => '$$') + '"'
}

export function createBackgroundService({ profile, runtime = process, home = os.homedir(), run = execute, readProc = file => fs.readFile(file, 'utf8') } = {}) {
  const argv = runtime.argv.slice(1)
  const flagEnd = argv.indexOf('--')
  const noOpen = argv.indexOf('--no-open')
  if (noOpen >= 0 && (flagEnd < 0 || noOpen < flagEnd)) argv.splice(noOpen, 1)
  const id = createHash('sha256').update(JSON.stringify([runtime.cwd(), runtime.env.DSH_HOME || '', argv])).digest('hex').slice(0, 16)
  const unit = `dsh-mobile-gateway-${id}.service`
  const directory = path.join(runtime.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'systemd', 'user')
  const unitPath = path.join(directory, unit)
  const specPath = path.join(directory, `${unit}.json`)
  const managed = runtime.env.DSH_BACKGROUND_UNIT === unit
  const command = async (exe, args) => (await run(exe, args, { timeout: 10_000, maxBuffer: 64 * 1024 })).stdout.trim()
  const systemctl = (...args) => command('systemctl', ['--user', '--no-ask-password', ...args])
  const supported = () => runtime.platform === 'linux' && webRestartAvailable(typeof profile === 'function' ? profile() : profile, runtime)
  let pending = false

  const status = async () => {
    const result = { supported: supported(), available: false, enabled: false, managed, unit }
    if (!result.supported) return { ...result, reason: '仅支持 Linux 上通过 dsh web 启动的实例' }
    try {
      await systemctl('show-environment')
      result.available = true
      result.linger = await command('loginctl', ['show-user', String(runtime.getuid()), '--property=Linger', '--value']) === 'yes'
      try { result.enabled = await systemctl('is-enabled', unit) === 'enabled' } catch { /* not installed */ }
      if (!result.linger) result.reason = `需要允许退出登录后运行；请在服务器执行 sudo loginctl enable-linger ${runtime.getuid()}`
    } catch {
      result.available = false
      result.reason = '无法连接 systemd 用户服务，请确认服务器使用 systemd 且当前用户的 user manager 已启动'
    }
    return result
  }

  const configure = async enabled => {
    if (pending) throw new Error('后台服务正在切换，请稍后重试')
    pending = true
    try {
      const current = await status()
      if (!current.available) throw new Error(current.reason)
      if (!enabled) {
        await systemctl('disable', unit)
        return { ...await status(), handoff: false }
      }
      if (!current.linger) {
        try { await command('loginctl', ['--no-ask-password', 'enable-linger', String(runtime.getuid())]) } catch {
          throw new Error(current.reason)
        }
        if (!(await status()).linger) throw new Error(current.reason)
      }
      let previous
      try { previous = await fs.readFile(unitPath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (previous && !previous.startsWith(MARKER)) throw new Error('拒绝覆盖非网关管理的 systemd 服务')
      // Do not start a second server over an already running service.
      if (!managed) {
        let active = false
        try { active = await systemctl('is-active', unit) === 'active' } catch { /* inactive */ }
        if (active) throw new Error('此工作目录已有后台服务运行，请连接该实例或先停止它')
      }
      const launchArgv = runtime.argv.slice(1)
      const end = launchArgv.indexOf('--')
      if (!launchArgv.slice(0, end < 0 ? launchArgv.length : end).includes('--no-open')) launchArgv.splice(end < 0 ? launchArgv.length : end, 0, '--no-open')
      const env = { ...runtime.env, DSH_BACKGROUND_UNIT: unit }
      for (const key of ['INVOCATION_ID', 'NOTIFY_SOCKET', 'JOURNAL_STREAM', 'SYSTEMD_EXEC_PID', 'LISTEN_PID', 'LISTEN_FDS', 'LISTEN_FDNAMES']) delete env[key]
      const spec = { execPath: runtime.execPath, args: [...runtime.execArgv, ...launchArgv], cwd: runtime.cwd(), env,
        previous: { pid: runtime.pid, identity: await readProc(`/proc/${runtime.pid}/stat`), boot: await readProc('/proc/sys/kernel/random/boot_id') } }
      await fs.mkdir(directory, { recursive: true })
      // Credentials inherited from the launching shell must only be readable by this user.
      await fs.writeFile(`${specPath}.tmp`, JSON.stringify(spec), { mode: 0o600 })
      await fs.chmod(`${specPath}.tmp`, 0o600)
      await fs.rename(`${specPath}.tmp`, specPath)
      const runner = fileURLToPath(new URL('./background-service-runner.mjs', import.meta.url))
      await fs.writeFile(unitPath, `${MARKER}[Unit]\nDescription=DSH Web mobile gateway\nStartLimitIntervalSec=60\nStartLimitBurst=5\n\n[Service]\nType=simple\nExecStart=${[runtime.execPath, runner, specPath].map(unitQuote).join(' ')}\nRestart=on-failure\nRestartSec=3\nTimeoutStopSec=30\nKillMode=control-group\n\n[Install]\nWantedBy=default.target\n`, { mode: 0o600 })
      await systemctl('daemon-reload')
      await systemctl('enable', unit)
      if (!managed) {
        try { await systemctl('start', unit) } catch (error) {
          await systemctl('disable', unit).catch(() => {})
          throw error
        }
      }
      return { ...await status(), handoff: !managed }
    } finally { pending = false }
  }
  return { status, configure, managed, control: action => systemctl('--no-block', action, unit) }
}
