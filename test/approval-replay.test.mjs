import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { once } from 'node:events'
import test from 'node:test'
import WebSocket from 'ws'
import plugin from '../lib/index.mjs'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function waitUntil(predicate) {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    assert.ok(Date.now() < deadline, '等待网关事件超时')
    await delay(5)
  }
}

async function gateway(t, enabled = true) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-approval-replay-'))
  const listeners = {}
  const sockets = []
  let upgrade, dispose, connections = 0
  const server = http.createServer((req, res) => { res.writeHead(404); res.end() })
  server.on('upgrade', (req, socket, head) => {
    connections += 1
    socket.once('close', () => { connections -= 1 })
    upgrade.handler(req, socket, head)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const ctx = {
    webServer: {
      port: server.address().port,
      register() { return () => {} },
      registerUpgrade(route) { upgrade = route; return () => {} },
    },
    typertGateway: {
      async invoke() { return { items: [] } },
      async stream(request) {
        return (async function* () {
          yield { type: 'baseline', value: request.namespace === 'workspace'
            ? { items: [], archivedSessionIds: [] } : { projections: {} } }
          while (!request.signal.aborted) await delay(5)
        })()
      },
    },
    agentDefaultModel: {},
    on(name, handler) { listeners[name] = handler; return () => {} },
    effect(factory) { dispose = factory() },
  }
  plugin.apply(ctx, {
    gatewayEnabled: enabled,
    requireAuth: false,
    deviceFile: path.join(directory, 'devices.json'),
  })
  t.after(async () => {
    sockets.forEach(socket => socket.terminate())
    dispose()
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return {
    request(next, signal) {
      return listeners['approval/request']({
        agent: { id: 'approval-session' }, toolName: 'bash', reason: '审批重放回归', signal,
      }, next)
    },
    async connect() {
      const frames = []
      const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws/mobile`, {
        headers: { 'X-DSH-Channel': 'control' },
      })
      sockets.push(socket)
      socket.on('message', data => frames.push(JSON.parse(data.toString())))
      await waitUntil(() => frames.some(frame => frame.kind === 'hello'))
      // connect 重放同步排在 hello 之后；用其后的 projection-baseline 确认初始帧已处理。
      await waitUntil(() => frames.some(frame => frame.kind === 'projection-baseline'))
      return { socket, frames }
    },
    async disconnect(socket) {
      const closed = once(socket, 'close')
      socket.close()
      await closed
      await waitUntil(() => connections === 0)
    },
  }
}

test('控制连接重连间隙产生的审批在重连后重放，桌面端仍可决定', async t => {
  const host = await gateway(t)
  const first = await host.connect()
  await host.disconnect(first.socket)
  let resolveDesktop
  const pending = host.request(() => new Promise(resolve => { resolveDesktop = resolve }))
  const second = await host.connect()
  try {
    const replay = second.frames.find(frame => frame.kind === 'approval-requested')
    assert.equal(replay?.sessionId, 'approval-session')
    assert.equal(replay.replay, true)
    resolveDesktop('allowed-once')
    assert.equal(await pending, 'allowed-once')
    await waitUntil(() => second.frames.some(frame => frame.kind === 'approval-resolved'))
  } finally {
    resolveDesktop('allowed-once')
  }
})

test('首次手机连接也能收到桌面端仍在等待的审批', async t => {
  const host = await gateway(t)
  let resolveDesktop
  const pending = host.request(() => new Promise(resolve => { resolveDesktop = resolve }))
  try {
    const { frames } = await host.connect()
    assert.equal(frames.find(frame => frame.kind === 'approval-requested')?.replay, true)
  } finally {
    resolveDesktop('rejected')
    await pending
  }
})

test('没有手机连接时，桌面端已完成的审批不会再次重放', async t => {
  const host = await gateway(t)
  assert.equal(await host.request(() => 'allowed-once'), 'allowed-once')
  const { frames } = await host.connect()
  assert.equal(frames.some(frame => frame.kind === 'approval-requested'), false)
})

test('没有手机也没有桌面答复时保持回退，不挂住请求', async t => {
  const host = await gateway(t)
  assert.equal(await host.request(() => undefined), undefined)
  const { frames } = await host.connect()
  assert.equal(frames.some(frame => frame.kind === 'approval-requested'), false)
})

test('没有手机时保留桌面端同步异常和异步拒绝', async t => {
  const host = await gateway(t)
  const error = new Error('desktop approval unavailable')
  await assert.rejects(async () => host.request(() => { throw error }), value => value === error)
  await assert.rejects(host.request(() => Promise.reject(error)), value => value === error)
})

test('等待期间取消的审批不再重放', async t => {
  const host = await gateway(t)
  const controller = new AbortController()
  const pending = host.request(() => new Promise(() => {}), controller.signal)
  controller.abort()
  assert.equal(await pending, 'cancelled')
  const { frames } = await host.connect()
  assert.equal(frames.some(frame => frame.kind === 'approval-requested'), false)
})

test('停用网关时仍直接交给桌面端处理审批', async t => {
  const host = await gateway(t, false)
  const requestSignal = new AbortController().signal
  assert.equal(await host.request(() => 'allowed-once', requestSignal), 'allowed-once')
})
