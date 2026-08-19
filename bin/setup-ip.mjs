#!/usr/bin/env node

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const MARKER = '# Managed by dsh-plugin-mobile-gateway'
const CONFIG_DIR = '/etc/dsh-mobile-gateway'
const PUBLIC_URL_FILE = path.join(CONFIG_DIR, 'public-url')
const WEBROOT = '/var/lib/dsh-mobile-gateway/acme'
const NGINX_CONFIG = '/etc/nginx/conf.d/dsh-mobile-gateway.conf'
const CERTBOT_HOME = '/opt/dsh-mobile-gateway/certbot'
const CERTBOT = path.join(CERTBOT_HOME, 'bin/certbot')
const RENEW_SERVICE = '/etc/systemd/system/dsh-mobile-gateway-cert-renew.service'
const RENEW_TIMER = '/etc/systemd/system/dsh-mobile-gateway-cert-renew.timer'

function printHelp() {
  console.log(`Usage:
  dsh-plugin-mobile-gateway setup [--ip <public IPv4>] [--port 3080] [--email <address>] [--yes]
  dsh-plugin-mobile-gateway status
  dsh-plugin-mobile-gateway remove [--yes]

The setup command supports Ubuntu/Debian servers. It keeps DSH on 127.0.0.1,
publishes only /ws/mobile through Nginx on 443, obtains a short-lived trusted
Let's Encrypt IP certificate, and installs automatic renewal.`)
}

function parseArgs(argv) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'setup'
  const values = { command, port: 3080, yes: false, ip: '', email: '' }
  const args = command === argv[0] ? argv.slice(1) : argv
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--yes' || arg === '-y') values.yes = true
    else if (arg === '--ip') values.ip = args[++index] || ''
    else if (arg === '--port') values.port = Number(args[++index])
    else if (arg === '--email') values.email = args[++index] || ''
    else if (arg === '--help' || arg === '-h') values.command = 'help'
    else throw new Error(`unknown argument: ${arg}`)
  }
  return values
}

function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`)
  return execFileSync(command, args, { stdio: 'inherit', ...options })
}

function commandExists(command) {
  try {
    execFileSync('sh', ['-c', `command -v "$1" >/dev/null 2>&1`, 'sh', command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function writeManagedFile(file, content, mode = 0o644) {
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8')
    if (!existing.startsWith(MARKER)) {
      throw new Error(`refusing to overwrite unmanaged file: ${file}`)
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 })
  const temporary = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temporary, content, { mode })
  fs.renameSync(temporary, file)
  fs.chmodSync(file, mode)
}

function metadataPublicIp() {
  return new Promise((resolve) => {
    const request = http.get({
      host: 'metadata.tencentyun.com',
      path: '/latest/meta-data/public-ipv4',
      timeout: 2_500,
      headers: { 'User-Agent': 'dsh-mobile-gateway-setup' },
    }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolve(response.statusCode === 200 ? body.trim() : ''))
    })
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve(''))
  })
}

function assertPublicIpv4(value) {
  if (net.isIP(value) !== 4) throw new Error(`invalid public IPv4 address: ${value || '(empty)'}`)
  const octets = value.split('.').map(Number)
  const privateAddress = octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] === 0
    || octets[0] >= 224
  if (privateAddress) throw new Error(`${value} is not a public IPv4 address`)
}

function certName(ip) {
  return `dsh-mobile-gateway-${ip.replaceAll('.', '-')}`
}

function nginxHttpConfig(ip) {
  return `${MARKER}
server {
    listen 80;
    server_name ${ip};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
        default_type text/plain;
    }

    location / { return 404; }
}
`
}

function nginxTlsConfig(ip, backendPort) {
  const liveDirectory = `/etc/letsencrypt/live/${certName(ip)}`
  return `${nginxHttpConfig(ip)}
server {
    listen 443 ssl;
    server_name ${ip};
    server_tokens off;
    access_log off;

    ssl_certificate ${liveDirectory}/fullchain.pem;
    ssl_certificate_key ${liveDirectory}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location = /ws/mobile {
        if ($args != "") { return 404; }
        proxy_pass http://127.0.0.1:${backendPort};
        proxy_http_version 1.1;
        proxy_set_header Host 127.0.0.1:${backendPort};
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }

    location / { return 404; }
}
`
}

function renewalService() {
  return `${MARKER}
[Unit]
Description=Renew the DSH mobile gateway IP certificate
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=${CERTBOT} renew --quiet --deploy-hook /bin/systemctl reload nginx
`
}

function renewalTimer() {
  return `${MARKER}
[Unit]
Description=Twice-daily renewal check for the DSH mobile gateway IP certificate

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=20m
Persistent=true

[Install]
WantedBy=timers.target
`
}

async function confirm(message, assumeYes) {
  if (assumeYes) return true
  if (!process.stdin.isTTY) throw new Error('interactive confirmation is unavailable; rerun with --yes')
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout })
  const answer = await terminal.question(`${message} [y/N] `)
  terminal.close()
  return /^y(es)?$/i.test(answer.trim())
}

function assertRoot() {
  if (typeof process.getuid === 'function' && process.getuid() !== 0) {
    throw new Error('setup/remove must run as root; prepend sudo to the command')
  }
}

async function setup(options) {
  assertRoot()
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error(`invalid backend port: ${options.port}`)
  if (options.email && !/^\S+@\S+\.\S+$/.test(options.email)) throw new Error(`invalid email address: ${options.email}`)
  if (!commandExists('apt-get') || !commandExists('systemctl')) {
    throw new Error('automatic setup currently supports systemd-based Ubuntu/Debian servers only')
  }

  const ip = options.ip || await metadataPublicIp()
  if (!ip) throw new Error('unable to detect a Tencent Cloud public IP; rerun with --ip <public IPv4>')
  assertPublicIpv4(ip)

  console.log(`
Public IPv4: ${ip}
DSH backend: http://127.0.0.1:${options.port}
Public endpoint: wss://${ip}/ws/mobile

Before continuing, open inbound TCP ports 80 and 443 in the Tencent Cloud
security group. Only /ws/mobile will be proxied; the WebUI and /mgw remain private.`)
  if (!await confirm('Install Nginx/Certbot and configure this public endpoint?', options.yes)) {
    console.log('Cancelled.')
    return
  }

  run('apt-get', ['update'])
  run('apt-get', ['install', '-y', 'nginx', 'python3', 'python3-venv'])
  if (!fs.existsSync(CERTBOT)) {
    run('python3', ['-m', 'venv', CERTBOT_HOME])
    run(path.join(CERTBOT_HOME, 'bin/pip'), ['install', '--upgrade', 'pip'])
  }
  run(path.join(CERTBOT_HOME, 'bin/pip'), ['install', '--upgrade', 'certbot>=5.4,<6'])

  fs.mkdirSync(path.join(WEBROOT, '.well-known/acme-challenge'), { recursive: true, mode: 0o755 })
  writeManagedFile(NGINX_CONFIG, nginxHttpConfig(ip))
  run('nginx', ['-t'])
  run('systemctl', ['enable', '--now', 'nginx'])
  run('systemctl', ['reload', 'nginx'])

  const certificateArgs = [
    'certonly', '--non-interactive', '--agree-tos',
    '--preferred-profile', 'shortlived',
    '--webroot', '--webroot-path', WEBROOT,
    '--ip-address', ip,
    '--cert-name', certName(ip),
    '--keep-until-expiring',
  ]
  if (options.email) certificateArgs.push('--email', options.email)
  else certificateArgs.push('--register-unsafely-without-email')
  run(CERTBOT, certificateArgs)

  writeManagedFile(NGINX_CONFIG, nginxTlsConfig(ip, options.port))
  writeManagedFile(PUBLIC_URL_FILE, `${MARKER}\nwss://${ip}/ws/mobile\n`)
  writeManagedFile(RENEW_SERVICE, renewalService())
  writeManagedFile(RENEW_TIMER, renewalTimer())
  run('nginx', ['-t'])
  run('systemctl', ['reload', 'nginx'])
  run('systemctl', ['daemon-reload'])
  run('systemctl', ['enable', '--now', path.basename(RENEW_TIMER)])

  console.log(`
Setup completed.

1. Restart dsh web so the plugin reads ${PUBLIC_URL_FILE}.
2. Open “移动设备”, enable the gateway, and generate a pairing QR code.
3. The iOS client should connect to wss://${ip}/ws/mobile.

Check later with:
  sudo npx dsh-plugin-mobile-gateway status`)
}

function status() {
  const endpoint = fs.existsSync(PUBLIC_URL_FILE)
    ? fs.readFileSync(PUBLIC_URL_FILE, 'utf8').split(/\r?\n/).find((line) => line.startsWith('wss://'))
    : ''
  console.log(`Public endpoint: ${endpoint || 'not configured'}`)
  console.log(`Nginx config: ${fs.existsSync(NGINX_CONFIG) ? NGINX_CONFIG : 'not installed'}`)
  console.log(`Renewal timer: ${fs.existsSync(RENEW_TIMER) ? RENEW_TIMER : 'not installed'}`)
  if (commandExists('systemctl') && fs.existsSync(RENEW_TIMER)) {
    try { run('systemctl', ['--no-pager', 'status', path.basename(RENEW_TIMER)]) } catch {}
  }
}

async function remove(options) {
  assertRoot()
  if (!await confirm('Remove the managed Nginx endpoint and renewal timer? Certificates and installed packages will be kept.', options.yes)) {
    console.log('Cancelled.')
    return
  }
  if (commandExists('systemctl')) {
    try { run('systemctl', ['disable', '--now', path.basename(RENEW_TIMER)]) } catch {}
  }
  for (const file of [NGINX_CONFIG, PUBLIC_URL_FILE, RENEW_SERVICE, RENEW_TIMER]) {
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, 'utf8')
    if (!content.startsWith(MARKER)) throw new Error(`refusing to remove unmanaged file: ${file}`)
    fs.rmSync(file)
    console.log(`Removed ${file}`)
  }
  if (commandExists('systemctl')) run('systemctl', ['daemon-reload'])
  if (commandExists('nginx')) {
    run('nginx', ['-t'])
    run('systemctl', ['reload', 'nginx'])
  }
  console.log('Public IP endpoint removed. Existing certificates and packages were left intact.')
}

export {
  assertPublicIpv4,
  certName,
  nginxHttpConfig,
  nginxTlsConfig,
  parseArgs,
  renewalService,
  renewalTimer,
}

function isMainModule(argvEntry) {
  if (!argvEntry) return false
  try {
    return fs.realpathSync(argvEntry) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

export { isMainModule }

if (isMainModule(process.argv[1])) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'help') printHelp()
    else if (options.command === 'setup') await setup(options)
    else if (options.command === 'status') status()
    else if (options.command === 'remove') await remove(options)
    else throw new Error(`unknown command: ${options.command}`)
  } catch (error) {
    console.error(`\nError: ${error && error.message ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
