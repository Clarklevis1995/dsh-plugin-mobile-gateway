import { spawnSync } from 'node:child_process'
const result = spawnSync(process.execPath, ['--test', 'test/webrtc/real.test.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, MGW_RTC_CYCLES: '100' },
})
process.exitCode = result.status ?? 1
