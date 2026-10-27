import { appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const LOG_FILE = path.join(os.tmpdir(), 'mobile-gateway.log')

export function log(line) {
  const message = `[${new Date().toISOString()}] ${line}`
  console.log('mobile-gateway:', message)
  try {
    appendFileSync(LOG_FILE, message + '\n')
  } catch (error) {
    // 文件日志失败不能中断网关，stderr 仍保留诊断信息。
    console.error(`mobile-gateway: cannot write log file ${LOG_FILE}: ${error?.message || String(error)}`)
  }
}
