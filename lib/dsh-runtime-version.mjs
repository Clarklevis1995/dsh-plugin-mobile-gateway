import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/** 从宿主入口解析启动包，避免误读插件依赖或 PATH 上另一份 DSH 的版本。 */
export function resolveDshRuntimeVersion(entrypoint = process.argv[1]) {
  if (!entrypoint) return undefined
  try {
    const entry = fs.realpathSync(path.resolve(entrypoint))
    const require = createRequire(entry)
    const filename = require.resolve('@deepseek-ai/dsh-app-boot/package.json')
    const manifest = JSON.parse(fs.readFileSync(filename, 'utf8'))
    const version = manifest.version
    // 探测失败时省略字段，不能把适配基线伪装成实际版本。
    return manifest.name === '@deepseek-ai/dsh-app-boot'
      && typeof version === 'string'
      && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)
      ? version : undefined
  } catch {
    return undefined
  }
}
