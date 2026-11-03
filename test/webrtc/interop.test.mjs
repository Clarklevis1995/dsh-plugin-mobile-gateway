import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { connectMobileTestClient } from '../../bin/webrtc-client.mjs'
import { startGateway } from './helpers.mjs'

const nativeRoot = process.env.MGW_NATIVE_RTC_ROOT

test(
  'independent libdatachannel client interoperates with werift gateway',
  { skip: !nativeRoot, timeout: 60000 },
  async () => {
    const moduleUrl = pathToFileURL(path.join(nativeRoot, 'dist/esm/polyfill/index.mjs')).href
    const native = await import(moduleUrl)
    const nativeLibrary = await import(pathToFileURL(path.join(nativeRoot, 'dist/esm/lib/index.mjs')).href)
    const gateway = await startGateway()
    let client
    try {
      client = await connectMobileTestClient({ ...gateway, rtcModuleLoader: async () => native })
      assert.equal(client.mode, 'webrtc')
      for (const size of [16384, 16777216]) {
        const overhead = Buffer.byteLength(JSON.stringify({ type: 'ping', padding: '' }))
        await client.send('control', { type: 'ping', padding: 'x'.repeat(size - overhead) })
        await client.inbox.take((frame) => frame.kind === 'pong', 30000)
      }
      await client.send('control', { type: 'workspaces' })
      assert.equal(
        (await client.inbox.take((frame) => frame.kind === 'workspaces')).items[0].workspaceId,
        'rtc-workspace',
      )
      await client.send('conversation', { type: 'history', sessionId: 'interop-session' })
      await client.inbox.take((frame) => frame.kind === 'history')
    } finally {
      await client?.close()
      await gateway.close()
      nativeLibrary.cleanup()
    }
  },
)
