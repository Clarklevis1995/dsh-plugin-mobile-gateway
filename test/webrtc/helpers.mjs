import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { setTimeout as delay } from 'node:timers/promises'
import WebSocket from 'ws'
import plugin from '../../lib/index.mjs'
import { createTestConnection } from '../helpers/peer.mjs'
import { FrameInbox } from '../../bin/webrtc-client.mjs'

export async function startGateway(webrtc = { enabled: true }, overrides = {}, implementation = plugin) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mgw-rtc-'))
  let management, upgrade, dispose
  const calls = []
  const listeners = new Map()
  const server = http.createServer((req, res) => management.handler(req, res))
  server.on('upgrade', (req, socket, head) => upgrade.handler(req, socket, head))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const ctx = {
    connection: createTestConnection(),
    agentDefaultModel: {},
    webServer: {
      port,
      register(route) {
        management = route
        return () => {}
      },
      registerUpgrade(route) {
        upgrade = route
        return () => {}
      },
    },
    typertGateway: {
      async invoke(call) {
        calls.push(call)
        if (call.method === 'create') return { sessionId: 'rtc-created-session' }
        if (call.method === 'list') return { items: [] }
        return { accepted: true }
      },
      async stream(call) {
        return (async function* () {
          if (call.namespace === 'workspace')
            yield {
              type: 'baseline',
              value: { items: [{ workspaceId: 'rtc-workspace', name: 'RTC workspace' }], archivedSessionIds: [] },
            }
          else if (call.method === 'follow')
            yield {
              type: 'snapshot',
              header: { version: 4, id: call.args.request.address.sessionId },
              cursor: 0,
              records: [
                {
                  type: 'event',
                  event: {
                    type: 'user/message',
                    seq: 0,
                    time: 1,
                    data: { message: { content: [{ type: 'text', text: '中文 RTC history' }] } },
                  },
                },
              ],
              projections: {
                asOfSeq: 0,
                values: { agentPreset: 'standard', sessionListMetadata: { blank: true, lastPromptAt: null } },
              },
              hasMore: false,
            }
          else yield { type: 'baseline', value: { projections: {} } }
          try {
            await delay(3600000, undefined, { signal: call.signal })
          } catch {
            /* cancelled */
          }
        })()
      },
    },
    on(event, handler) {
      listeners.set(event, handler)
      return () => listeners.delete(event)
    },
    effect(factory) {
      dispose = factory()
    },
  }
  implementation.apply(ctx, {
    gatewayEnabled: true,
    deviceFile: path.join(temp, 'devices.json'),
    publicUrlFile: path.join(temp, 'none'),
    webrtc,
    ...overrides,
  })
  const request = async (route, body) => {
    const response = await fetch(
      `http://127.0.0.1:${port}/mgw/${route}`,
      body === undefined
        ? {}
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
    )
    if (!response.ok) throw new Error(`management ${route}: ${response.status}`)
    return response.json()
  }
  const url = `ws://127.0.0.1:${port}/ws/mobile`
  const initialStatus = await request('status')
  const gatewayId = initialStatus.gatewayId
  const deviceId = 'rtc-test-installation'
  const pairing = await request('pair', { publicUrl: initialStatus.pairingRoute === 'tailscale' ? initialStatus.tailscaleUrl : url })
  const pairedSocket = new WebSocket(url, ['dsh-mobile-v1', `dsh-pair.${pairing.payload.pairingCode}`], {
    headers: { 'X-DSH-Device-ID': deviceId },
  })
  const pairedInbox = new FrameInbox()
  pairedSocket.on('message', (data) => pairedInbox.push(JSON.parse(data)))
  const paired = await pairedInbox.take((frame) => frame.kind === 'paired')
  const closed = new Promise((resolve) => pairedSocket.once('close', resolve))
  pairedSocket.close()
  await closed
  pairedInbox.close()
  if (webrtc.enabled && webrtc.mode !== 'ws-only') {
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await request('status')).webrtc.runtime !== 'loading') break
      await delay(20)
    }
  }
  return {
    request,
    url,
    gatewayId,
    deviceId,
    token: paired.token,
    registryId: paired.device.id,
    calls,
    listeners,
    async close() {
      dispose()
      server.closeAllConnections()
      await new Promise((resolve) => server.close(resolve))
      await fs.rm(temp, { recursive: true, force: true })
    },
  }
}
