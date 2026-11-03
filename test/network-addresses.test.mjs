import { isTailscaleIp, tailscaleInterfaceStatus } from '../lib/tailscale-addresses.mjs'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isAllowedMobileSource, isLocalHostname, isPrivateNetworkHostname } from '../lib/network-addresses.mjs'

test('Tailscale shared IPv4 bounds and IPv4-mapped socket addresses are accepted', () => {
  for (const ip of ['100.64.0.0', '100.100.10.20', '100.127.255.255']) {
    assert.equal(isPrivateNetworkHostname(ip), true, ip)
    assert.equal(isAllowedMobileSource(ip), true, ip)
    assert.equal(isAllowedMobileSource(`::ffff:${ip}`), true, ip)
    assert.equal(isAllowedMobileSource(`[::ffff:${ip}]`), true, ip)
  }
})

test('other public ranges, malformed addresses and names cannot be accepted as socket sources', () => {
  for (const ip of ['100.63.255.255', '100.128.0.0', '100.255.255.255', '100.64.256.1', '100.64.1', '203.0.113.1', '8.8.8.8']) {
    assert.equal(isPrivateNetworkHostname(ip), false, ip)
    assert.equal(isAllowedMobileSource(ip), false, ip)
    assert.equal(isAllowedMobileSource(`::ffff:${ip}`), false, ip)
  }
  for (const value of ['', undefined, null, 'localhost', 'phone.local', 'host.example.ts.net', '100.64.1.1.example']) {
    assert.equal(isAllowedMobileSource(value), false, String(value))
  }
  assert.equal(isPrivateNetworkHostname('host.example.ts.net'), false)
})

test('LAN and IPv6 sources retain their existing behavior and loopback stays distinct', () => {
  for (const ip of ['127.0.0.1', '10.0.0.2', '172.16.0.1', '10.23.45.67', '::1', 'fd7a:115c:a1e0::1', 'fe80::1%en0']) {
    assert.equal(isAllowedMobileSource(ip), true, ip)
  }
  assert.equal(isPrivateNetworkHostname('host.local'), true)
  assert.equal(isLocalHostname('127.0.0.1'), true)
  assert.equal(isLocalHostname('100.100.10.20'), false)
  assert.equal(isLocalHostname('fd7a:115c:a1e0::1'), false)
})


test('Tailscale detection uses host tunnel interfaces and respects the actual listener binding', () => {
  const interfaces = {
    en0: [{ address: '10.23.45.66', internal: false }, { address: '100.64.1.1', internal: false }],
    utun5: [{ address: '100.64.0.10', internal: false }, { address: 'fd7a:115c:a1e0::7', internal: false }],
    Tailscale: [{ address: '100.64.0.10', internal: false }, { address: '100.128.0.1', internal: false }],
    lo: [{ address: '100.99.0.1', internal: true }],
  }
  const listener = { listening: true, host: '0.0.0.0', port: 3081, wsPath: '/ws/mobile' }
  const status = tailscaleInterfaceStatus(listener, interfaces)
  assert.deepEqual(status.addresses, ['100.64.0.10', 'fd7a:115c:a1e0::7'])
  assert.deepEqual(status.urls, ['ws://100.64.0.10:3081/ws/mobile'])
  assert.equal(tailscaleInterfaceStatus({ ...listener, host: '127.0.0.1' }, interfaces).urls.length, 0)
  assert.equal(tailscaleInterfaceStatus({ ...listener, listening: false }, interfaces).urls.length, 0)
  assert.equal(tailscaleInterfaceStatus({ ...listener, host: '::' }, interfaces).urls[1], 'ws://[fd7a:115c:a1e0::7]:3081/ws/mobile')
  assert.equal(tailscaleInterfaceStatus(listener, {}).addresses.length, 0)
  for (const value of ['100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0::1']) assert.equal(isTailscaleIp(value), true)
  for (const value of ['100.63.0.1', '100.128.0.1', '100.64.256.1', '100.64.1.2.example', 'fd7a:115c:a1e1::1', null]) assert.equal(isTailscaleIp(value), false)
})
