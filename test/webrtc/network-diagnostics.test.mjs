import assert from 'node:assert/strict'
import { test } from 'node:test'
import { connectMobileTestClient } from '../../bin/webrtc-client.mjs'
import { startGateway } from './helpers.mjs'

for (const enabled of [false, true]) {
  test(`correlated network probes and legacy ping over ${enabled ? 'RTC' : 'WebSocket'}`, { timeout: 45000 }, async () => {
    const gateway = await startGateway({ enabled })
    let client
    try {
      client = await connectMobileTestClient(gateway)
      assert.equal(client.mode, enabled ? 'webrtc' : 'websocket')
      for (const channel of ['control', 'conversation']) {
        const requestId = `network-check:test:${channel}`
        await client.send(channel, { type: 'ping', requestId })
        const pong = await client.inbox.take(frame => frame.kind === 'pong' && frame.requestId === requestId)
        assert.equal(pong.channel, channel)
        assert.equal(typeof pong.at, 'number')
        for (const invalid of [undefined, '', 12, { bad: true }, 'x'.repeat(129)]) {
          await client.send(channel, { type: 'ping', requestId: invalid })
          const legacyPong = await client.inbox.take(frame => frame.kind === 'pong')
          assert.equal(Object.hasOwn(legacyPong, 'requestId'), false)
        }
      }
    } finally {
      await client?.close()
      await gateway.close()
    }
  })
}
