import assert from 'node:assert/strict'

import {
  assertPublicIpv4,
  certName,
  nginxHttpConfig,
  nginxTlsConfig,
  parseArgs,
  renewalService,
  renewalTimer,
} from '../bin/setup-ip.mjs'

const parsed = parseArgs(['setup', '--ip', '203.0.113.7', '--port', '33080', '--email', 'ops@example.com', '--yes'])
assert.deepEqual(parsed, {
  command: 'setup',
  port: 33080,
  yes: true,
  ip: '203.0.113.7',
  email: 'ops@example.com',
})

assert.doesNotThrow(() => assertPublicIpv4('8.8.8.8'))
for (const address of ['', '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '224.0.0.1']) {
  assert.throws(() => assertPublicIpv4(address))
}

assert.equal(certName('203.0.113.7'), 'dsh-mobile-gateway-203-0-113-7')

const httpConfig = nginxHttpConfig('203.0.113.7')
assert.match(httpConfig, /listen 80;/)
assert.match(httpConfig, /server_name 203\.0\.113\.7;/)
assert.match(httpConfig, /\.well-known\/acme-challenge/)
assert.match(httpConfig, /location \/ \{ return 404; \}/)

const tlsConfig = nginxTlsConfig('203.0.113.7', 33080)
assert.match(tlsConfig, /listen 443 ssl;/)
assert.match(tlsConfig, /location = \/ws\/mobile/)
assert.match(tlsConfig, /proxy_pass http:\/\/127\.0\.0\.1:33080;/)
assert.match(tlsConfig, /if \(\$args != ""\) \{ return 404; \}/)
assert.doesNotMatch(tlsConfig, /location \/mgw/)

assert.match(renewalService(), /certbot renew --quiet/)
assert.match(renewalService(), /systemctl reload nginx/)
assert.match(renewalTimer(), /OnCalendar=\*-\*-\* 00,12:00:00/)

console.log('public IP setup tests passed')
