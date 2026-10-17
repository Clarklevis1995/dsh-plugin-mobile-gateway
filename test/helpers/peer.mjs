import assert from 'node:assert/strict'
import crypto from 'node:crypto'

export function createTestPeer(options = { principal: { kind: 'owner' }, interactions: 'none' }) {
  const abort = new AbortController()
  return {
    id: crypto.randomUUID(), ctx: {}, ...options, signal: abort.signal,
    async dispose() { abort.abort() },
  }
}

export function createTestConnection() {
  return {
    peers: [],
    createPeer(options) {
      assert.deepEqual(options, { principal: { kind: 'owner' }, interactions: 'none' })
      const peer = createTestPeer(options)
      this.peers.push(peer)
      return peer
    },
  }
}
