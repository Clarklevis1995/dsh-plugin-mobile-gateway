**English** · [简体中文](README.zh-CN.md) · [日本語](docs/readme/README.ja.md) · [한국어](docs/readme/README.ko.md) · [Español](docs/readme/README.es.md) · [Français](docs/readme/README.fr.md) · [Deutsch](docs/readme/README.de.md) · [Português (Brasil)](docs/readme/README.pt-BR.md)

> Some linked protocol and integration documents are currently available only in Chinese.

<p align="center">
  <img src="docs/assets/whale-girl-ios-app-promo-16x9.png" alt="Whaleness mobile client and Mobile Gateway" width="100%">
</p>

# dsh-plugin-mobile-gateway

A third-party mobile gateway for DeepSeek Harness with device authentication. Supports sessions and live events; queued-message synchronization, editing, deletion, and Steer; bidirectional session archiving and renaming; stopping and resuming generation; task lists and the current Goal; server-driven command and skill menus; human-in-the-loop workflows; and image and file transfers. After installation, a Mobile Devices entry appears in the Harness WebUI sidebar for enabling the gateway, generating pairing QR codes, and managing trusted devices.

> The current source targets **DSH 0.2.1-rc.2**, requires the Connection Peer interface, and uses Session format 4. Older history cursors require a fresh baseline.
>
> Live output now uses separate `assistant-stream` frames. Mobile clients must update subscriptions, caches, and pagination according to the [rc.2 integration guide](docs/dsh-rc2-mobile-integration.md). These changes are not yet released.
>
> v0.11.1 (current source, not yet released): chunked file uploads with SHA-256 verification, progress acknowledgments, cancellation, and disconnect cleanup. Reuses official DSH attachment storage and session-scoped credentials for sending files with messages and resolving live/history file references. Clients must implement `file-upload-v1`; see the [file upload integration guide](docs/file-upload-app-integration.md).
>
> v0.11.0: Agent teams and subagent conversations, including members, shared task boards, nested subagent directories, live runtime status, independent history, view switching, continued conversations, image input, and stopping subagents. Clients must discover capabilities; see the [Agent team integration guide](docs/agent-team-app-integration.md).
>
> v0.10.4: session-list projections now retain only titles and projection cut points, avoiding timeouts when many sessions pass through public tunnels. Session metadata and full history projections remain available; existing mobile clients need no changes.
>
> v0.10.3: DSH 0.2.1-rc.2 compatibility adds Connection Peer to Remote calls and live subscriptions, fixes `Cannot read properties of undefined (reading 'signal')`, and releases the Peer when the gateway stops. The mobile protocol is unchanged.
>
> v0.10.2: forwards file-card events and safely resolves file references, reusing chunked downloads for mobile file cards and previews of file links in text. See the [file card and preview guide](docs/file-cards-mobile-integration.md).
>
> v0.10.1: integrates official voice input with model preparation/status, mobile audio transcription, cancellation, and cleanup on disconnect. Recognition uses the official speech Remote; the gateway does not bundle ASR models.
>
> v0.10.0: responsive, centered Mobile Devices window with the host's light/dark theme; consistent dropdowns and connection highlights; a separate animated pairing QR dialog; dismissible restart reminders per gateway instance; online-only trusted devices by default, expandable offline devices, mobile device names and duplicate numbering; automatic application of Tunnel mode changes and explicit saving of named Tunnel settings.
>
> v0.9.0: DSH 0.2.0-rc.2 plugin management; panel controls for Cloudflare Quick/named Tunnels using verified `cloudflared` in the plugin's private cache; LAN/public pairing guidance; gateway restart and DSH Web stop actions without opening another browser tab.
>
> v0.7.3: adjusts arrow spacing in the gateway-mode dropdown.
>
> v0.7.2: separate conversation/control connections, empty sessions, stop/resume generation, queued-message sync/edit/delete/Steer, and bidirectional session archiving and renaming.

## Protocol and DSH Compatibility Layer

Mobile clients use this project's `dsh-mobile-v1`, not DSH's internal Remote protocol. A separate Host Adapter connects to the DSH 0.2.1-rc.2 Remote Gateway. Namespaces such as Session, Workspace, Settings, Commands, Goals, Schedule, Permission Presets, and Plugin Manager, together with their strict parameters, are confined to that adapter. See the [RC2 plugin management integration plan](docs/dsh-0.2.0-rc.2-plugin-management-mobile-integration.md) for request frames and mobile UI design.

DSH 0.2.1-rc.2 requires `peer` on every Remote call. The gateway creates a local-user Peer with `ctx.connection.createPeer()` and disposes of it with the plugin. The Host Adapter injects it into regular requests, initial reads, and live subscriptions; mobile clients cannot choose the caller identity. Questions and approvals still use the gateway's Host listeners. Older gateways that omit it fail with `Cannot read properties of undefined (reading 'signal')`. After upgrading DSH, reinstall this source version and restart `dsh web`; the phone protocol needs no change.

Verify this contract against a locally installed official DSH (real Gateway/Connection, test business services, no user sessions read or written):

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
```

Pairing authentication and `dsh-mobile-v1` / `hello.protocol = 3` are unchanged. Live tokens no longer consume persistent event `seq` values: explicitly subscribe with `assistantStream: true` to receive an atomic `session-snapshot` and separate deltas. Regular `event` frames contain only persistent events. Clients without the new subscription receive persistent messages only.

History responses include `historyFormatVersion` and `cursor`. Clear history caches and install a fresh baseline when the format changes. Pagination with `beforeSeq` or a fork with `atSeq` must also send `historyFormatVersion: 4`.
See the [rc.2 mobile integration guide](docs/dsh-rc2-mobile-integration.md) for current integration and acceptance checks, and the [Remote Gateway refactoring plan](docs/remote-gateway-refactor-plan.md) for earlier migration records.

- WebSocket: `/ws/mobile`
- LAN: `ws://<局域网 IP>:3081/ws/mobile`
- Public Linux server: `wss://<公网 IP>/ws/mobile`
- Protocol reference: [PROTOCOL.md](PROTOCOL.md)

The current source adds session mode selection: after creating an empty session, a client can query/change its Agent preset until the first conversation turn. Discover `session-agent-preset` and follow the [client integration guide](docs/session-agent-preset-app-integration.md). Client UI integration is required; this source change is not yet released.

The current source adds `turn-outline-v1`: forwards the full WebUI turn outline and live updates so clients can show turn markers and question/answer previews and paginate to a turn without loading all message bodies. Reconnecting the control channel or connecting a new device restores the outline baseline; if the Host has no outline, fall back to loaded turns. See the [turn navigation guide](docs/turn-outline-app-integration.md). Client UI integration is separate; not yet released.

The current source adds `file-upload-v1`: paired clients upload PDFs, Office files, archives, audio, and other files in chunks over the control connection. SHA-256-verified files enter official DSH attachment storage and are sent with session-scoped credentials. Supports acknowledgments, cancellation, disconnect cleanup, and live/history file references. Uses official WebUI attachment admission rules and never writes to a client-specified host path. See the [file upload guide](docs/file-upload-app-integration.md) for frames, client state machines, limits, and acceptance checks. Client UI integration is separate; not yet released.

The current source adds `agent-team-v1` and `subagent-conversations-v1`: member/shared-board queries, nested subagent directories, live team projections and member status, independent subagent history/subscriptions, continued conversations, and stop actions. The [Agent team integration guide](docs/agent-team-app-integration.md) covers target addresses, full JSON examples, board rules, switching/reconnection state machines, errors, and acceptance criteria. These are gateway capabilities; client UI integration is separate. Not yet released.

## Multi-Gateway Phase One (Current Source)

Provides a stable `gatewayId`, configurable `gatewayName`, pairing endpoint candidates, and persistent Off / Temporary / Persistent modes. One app can pair independently with gateways on different machines; client-side multi-gateway management must implement the [integration guide](docs/multi-gateway-app-integration.md). No new npm version has been published for this source change.

Choose Persistent in Mobile Devices to continue accepting authorized devices across restarts. DSH must remain running, the host awake, and the network reachable. This does not provide automatic discovery or a network relay.

Example deployment settings (the mobile-gateway plugin's `config`):

```yaml
gatewayMode: persistent
gatewayName: 家里电脑
requireAuth: true
endpoints:
  - wss://gateway.example.com/ws/mobile
  - ws://192.168.1.10:3081/ws/mobile
```

Mode precedence: **saved UI selection > `gatewayMode` > legacy `gatewayEnabled`**. Without a saved selection, legacy `gatewayEnabled: true` means Persistent; false means Off.

- Off: disconnects mobile devices immediately and stays off after restart.
- Temporary: switches off and saves Off if no device connects successfully within 5 minutes by default. After a successful connection it stays on for that run. Restarting in Temporary mode restarts the wait. `gatewayWaitTimeoutMs` allows 30 seconds to 30 minutes.
- Persistent: no idle waiting timer. Pairing codes still expire after 5 minutes by default; file-transfer timeouts and other independent rules are unchanged.

State defaults to `<deviceFile>.gateway.json`, usually `~/.dsh/mobile-gateway-devices.json.gateway.json`, or a configured `gatewayStateFile`. It holds a random UUID v4 identity and user selections, has mode `0600`, and is atomically replaced using a temporary file in the same directory. Corruption fails startup rather than silently generating a new identity. Each running instance needs separate device registry and state files.

Keep both files when upgrading or migrating machines. For a new independent gateway clone, do not copy the original identity/state or device registry; generate a new identity and pair again. Do not delete identity files while running to reset modes. To reuse startup configuration, stop the instance, back up state, change only `mode` to `null`, retain `version` and `gatewayId`, then restart.

`gatewayName` allows up to 80 characters and defaults to the hostname. `endpoints` supplies up to 16 additional candidates, each at most 2048 characters; pairing also merges preferred, public, and listening LAN addresses and rejects totals above 16. All addresses must reach the same gateway; do not use `0.0.0.0` / `::`. They must be reachable from the phone; use WSS publicly.

See the [acceptance report](docs/multi-gateway-phase1-acceptance.md) for tests/manual steps and the [multi-gateway checklist](docs/multi-gateway-todo.md) for scope.

## Companion Android and iOS Client

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile) is the independently developed third-party native mobile client paired with this gateway. It supports Android 7.0+ and iOS / iPadOS 16.1+, sharing business logic through Kotlin Multiplatform with Jetpack Compose and SwiftUI/UIKit interfaces. Features include workspaces and sessions, live conversations, Agent teams and shared tasks, file uploads/previews, text selection, Markdown tables, local history/cache management, voice input, approvals, and server-driven command, skill, model, and permission menus. iPhone Duo and wide-screen layouts adapt to orientation and available space. System-dependent effects vary by OS and device. See the client repository for downloads, setup, and current screenshots.

> Latest iOS product screenshots: the 1.7.10 image set was captured on October 22–23, 2026; the iPhone Duo set was captured on October 26, 2026. The interface shown is Chinese. [Product screenshot sources](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/SOURCES.md) · [Duo screenshot sources](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/SOURCES.md).

### iPhone Duo: Landscape, Portrait, and Navigation

<table>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp" alt="Unfolded landscape home" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp" alt="Landscape home background" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Unfolded landscape home</strong></td>
    <td align="center"><strong>Landscape home background</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp" alt="Landscape settings" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp" alt="Landscape conversation" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Landscape settings</strong></td>
    <td align="center"><strong>Landscape conversation</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp" alt="Expanded navigation sidebar" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp" alt="Unfolded portrait home" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Expanded navigation sidebar</strong></td>
    <td align="center"><strong>Unfolded portrait home</strong></td>
  </tr>
</table>

### Teams, Attachments, and Local Storage

<table>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp" alt="Agent team members" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp" alt="Shared team tasks" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp" alt="File and image picker" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Agent team members</strong></td>
    <td align="center"><strong>Shared team tasks</strong></td>
    <td align="center"><strong>File and image picker</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp" alt="Dedicated text selection" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp" alt="Files in a conversation" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp" alt="Bundled release notes" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Dedicated text selection</strong></td>
    <td align="center"><strong>Files in a conversation</strong></td>
    <td align="center"><strong>Bundled release notes</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp" alt="Local storage and cache categories" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp" alt="Hold-to-talk input" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp" alt="File attachment in the composer" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Local storage and cache categories</strong></td>
    <td align="center"><strong>Hold-to-talk input</strong></td>
    <td align="center"><strong>File attachment in the composer</strong></td>
  </tr>
</table>

## Install the Plugin

Prerequisites: `dsh` CLI and `pnpm` installed, with `dsh web` working. Run `pnpm --version` to ensure the current user can find `pnpm`.

For LAN use, install the plugin:

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

For public-IP access on a Linux server, use the unified initializer. It installs/updates the plugin and requests sudo once to install the system Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`init` installs the exact version of the executing npm package into the DSH profile and skips pnpm's new-release waiting period for that version only, keeping plugin and Helper versions aligned.

After installation, stop and restart WebUI:

```bash
dsh web
```

Open WebUI and confirm Mobile Devices appears at the bottom of the left sidebar.

## LAN Pairing

For the DSH computer and mobile device on the same mutually reachable LAN.

1. Open Mobile Devices in WebUI.
2. Set Gateway Mode to Persistent, or Temporary for short pairing sessions.
3. Leave Device Authentication enabled.
4. Choose Direct LAN under Pairing Connection Method and verify `ws://<电脑局域网 IP>:3081/ws/mobile`. Cloudflare Tunnel can remain enabled. The adjacent help icon explains available routes for this environment and suggests scenarios without changing the selection.
5. Enter a device name and select Generate Pairing QR Code.
6. Open device authentication in the mobile client and scan the QR code.
7. Pairing is complete when the trusted device shows Online in WebUI.

If a firewall blocks the connection, allow TCP `3081` only on private networks. Do not expose 3081 publicly.

## Public-IP Pairing on Linux Servers

> [!NOTE]
> Public-IP pairing here specifically means Linux servers. The one-command setup is available since `v0.6.4` for Ubuntu/Debian with a fixed public IPv4. Node.js, `pnpm`, and the `dsh` CLI must already be installed. CentOS is not currently supported.

### 1. Prepare Public Ports

Copy the public IPv4 from your cloud console and allow inbound TCP `80` and `443` in its security group. Do not expose the DSH WebUI port or TCP `3081` publicly.

### 2. Initialize

First confirm the regular DSH user can run `pnpm`:

```bash
pnpm --version
```

Then run as that same regular user, not `root` or `sudo npx`:

```bash
npm_config_registry=https://registry.npmjs.org \
npx --yes dsh-plugin-mobile-gateway@latest init
```

This installs/updates the plugin and requests sudo once for Nginx, Certbot, the system Helper, and certificate renewal timers. `init` aligns the exact DSH-profile and Helper versions.

Start or restart WebUI afterward:

```bash
dsh web
```

### 3. Open Remote WebUI

Prefer the built-in port forwarding in VS Code, Cursor, or similar IDEs. Alternatively, run on your own computer:

```bash
ssh -N -L <本地端口>:127.0.0.1:<DSH 实际端口> <服务器用户名>@<服务器公网 IP>
```

Then open in your local browser:

```text
http://127.0.0.1:<本地端口>
```

### 4. Configure the Public Endpoint

Open Mobile Devices, enter the cloud console's public IPv4 in Public Access, and choose Configure Public Access or Update Public Configuration. The Helper detects the current `dsh web` port and configures Nginx, TLS certificates, and `wss://<公网 IP>/ws/mobile`.

<p align="center">
  <img src="docs/assets/public-access-ui.jpg" alt="Configure public access in the Mobile Devices panel" width="960">
</p>

### 5. Pair the Mobile Device

1. Enable Allow Mobile Connections and leave Device Authentication enabled.
2. Enter a device name and generate a pairing QR code.
3. Open device authentication on the phone and scan the QR code.
4. Pairing is complete when the device shows Online in WebUI.

QR codes are single-use and expire after 5 minutes. Generate a new one in WebUI if needed.

## Remote Access to Home Windows / macOS Computers

Home computers usually lack a fixed public IP; router port forwarding is not recommended here. The Windows/macOS panel offers account/domain-free Quick Tunnels and fixed-domain named Tunnels. On first use, the plugin downloads and verifies official Cloudflare `cloudflared` into the current user's cache. No manual system service installation is required.

Start `dsh web` first. The computer must stay awake, online, and running DSH; sleep or process exit interrupts remote access.

### Cloudflare Quick Tunnel (Temporary Access)

The default is Automatic · Prefer LAN. For remote access, change Pairing Connection Method under Mobile Devices → Connection & Pairing to Automatic · Prefer Public or Cloudflare Public. A pink setup hint appears if the public route is not ready. Under Cloudflare Tunnel choose Quick Tunnel · No Domain and enable it. First use downloads `cloudflared`; once connected, the generated `wss://<名称>.trycloudflare.com/ws/mobile` becomes the pairing address. For LAN use, select Automatic · Prefer LAN or Direct LAN; the Tunnel may stay on. Generate a QR code and scan it in the app. Switching off stops the Tunnel. Restarting DSH restores an enabled Quick mode with a **new random address**.

Quick Tunnel needs no Cloudflare account, Token, or domain, but its address may change after DSH restarts or tunnel reconnection. The app trusts only confirmed addresses: generate a new QR code and scan again after changes. **An online computer does not guarantee the old URL still works.** Cloudflare positions Quick Tunnel for testing/development, with concurrency limits and no availability guarantee. See the [Quick Tunnel documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Update Tunnel Configuration saves the mode and named-Tunnel parameters; unchanged settings do not reconnect. Restart Tunnel interrupts mobile connections and recreates the Cloudflare tunnel without restarting DSH Web. Quick mode may obtain a new address, clearing the old QR code; scan again with the new URL. This does not upgrade `cloudflared` automatically.

### Cloudflare Named Tunnel (Fixed Address)

1. [Create a remotely managed Tunnel](https://developers.cloudflare.com/tunnel/get-started/) in Cloudflare, add a public hostname such as `gateway.example.com`, and set **Service URL** to `http://127.0.0.1:3082`. No Cloudflare system service or inbound router port is required.
2. Copy the Token from Add a replica, select Named Tunnel · Fixed Domain under Mobile Devices → Cloudflare Tunnel, enter the hostname/Token, and enable it. The plugin selects Persistent mode and starts the dedicated local listener and `cloudflared`. After tunnel registration it separately checks local DNS, TLS, and the public gateway route. On success, use the supplied `wss://gateway.example.com/ws/mobile` to generate a QR code.
3. Starting `dsh web` restores enabled Tunnels automatically. Closing Cloudflare Tunnel in the panel stops the managed `cloudflared` and dedicated listener. Manually disabling the gateway pauses the Tunnel; enabling it resumes it.

Both Cloudflare routes accept only `/ws/mobile` WebSocket. Other HTTP paths, including DSH WebUI and `/mgw`, return 404. Device credentials are always required, even if local Debug authentication is disabled. Named-Tunnel Tokens are stored in `<deviceFile>.cloudflare.json` (default `~/.dsh/mobile-gateway-devices.json.cloudflare.json`) with mode `0600` and never returned to the browser. The default private `cloudflared-bin` cache does not use system/other-app binaries. Every start verifies the cached file; only a missing/corrupt cache triggers a fixed-version download with SHA-256 checked against official assets. An external binary is used only with explicit `cloudflaredPath`. If `cloudflarePort` changes, update the named-Tunnel Service URL port too. The cached `cloudflared` is checked at every start.

#### Endpoint Checks and Status

`state: online` means only that cloudflared registered a tunnel connection, not that the public hostname, TLS, or origin route works. Status also includes `endpointHealth` (state, hint, check time, error code) and `publicReady`. The panel checks once after connecting; Check Public DNS / TLS / WebSocket retries via the management-authenticated `POST /mgw/cloudflare/check` without restarting the Tunnel.

Checks use system DNS and HTTPS WebSocket requests with strict certificate verification, no pairing/device tokens, and no redirects. Only HTTP 401 with the gateway echoing the fresh random probe marker proves the authenticated route is reachable; generic proxy/Cloudflare Access 401 responses do not count. The marker appears only in rejections without valid device credentials and grants no access. This is a local network snapshot, not proof of phone connectivity, authentication, or session sync.

Local DNS failure does not prove a public record is absent: new records may encounter cached NXDOMAIN, local DNS, VPN, or proxy issues. Check the public hostname and proxied CNAME, then retry later; do not disable TLS verification. The plugin runs remotely managed Tunnels using a Tunnel Token, which does not create DNS or hostname routes. Separately authorized cloudflared CLI/API operations can create them, but are outside this check.

### Tailscale (For Long-Term Use)

1. Install [Tailscale](https://tailscale.com/download) on the computer and phone and join the same Tailnet.
2. Run in Windows PowerShell or a macOS terminal:

```bash
tailscale serve --bg 3081
```

3. Run `tailscale serve status` to find `https://<设备名>.<tailnet>.ts.net`.
4. Use `wss://<设备名>.<tailnet>.ts.net/ws/mobile` as the WebSocket Address in WebUI, then generate a QR code to pair.

Tailscale Serve allows only devices permitted by the same Tailnet's access rules and provides HTTPS automatically. Use `tailscale serve reset` to stop forwarding. See the [Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Connection Options

| Scenario | Recommended Route | Mobile WebSocket Address | Additional Setup | Ports and Authentication |
|---|---|---|---|---|
| Same LAN | Plugin LAN listener | `ws://<电脑局域网 IP>:3081/ws/mobile` | No Helper/Nginx; host and phone must reach each other | Private TCP `3081` only; keep authentication on |
| Local iOS Simulator | DSH WebUI local route | `ws://127.0.0.1:<DSH WebUI 端口>/ws/mobile` | No Helper/Nginx or separate port `3081` | No external ports; disable authentication only for Debug |
| Public Linux server | Helper + Nginx + TLS | `wss://<服务器公网 IPv4>/ws/mobile` | Run `init`, then enter public IPv4 in WebUI | Allow TCP `80/443`; do not expose DSH/`3081`; authentication required |
| Home Windows / macOS | Cloudflare named Tunnel | `wss://<公开域名>/ws/mobile` | Route public hostname to `127.0.0.1:3082`; enter hostname/Token in panel | No router forwarding; dedicated listener requires device authentication |
| Home Windows / macOS | Cloudflare Quick Tunnel | `wss://<随机名称>.trycloudflare.com/ws/mobile` | Enable in panel; scan again after URL changes | No account/domain/router forwarding; device authentication required |
| Home Windows / macOS | Tailscale Serve | `wss://<Tailscale 域名>/ws/mobile` | Forward to `127.0.0.1:3081` and enter generated URL in WebUI | No router forwarding; keep authentication on |

## Manage Linux Public Access

Check status:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

Remove public access:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## Update the Plugin

Rerun initialization to update both the plugin and system Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

Then stop and restart `dsh web`.

## Uninstall

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

To remove the system Helper too (existing Nginx public-access configuration is retained):

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove-helper
```

## Troubleshooting

| Symptom | Action |
|---|---|
| No Mobile Devices entry | Install in the `web` profile and fully restart `dsh web` |
| Mobile client receives `503` | Enable mobile connections in WebUI |
| Mobile client receives `401` | Generate a new QR code and pair again |
| Linux public connection times out | Check cloud security groups, firewall, and TCP `80/443` |
| No Linux public address | Enter public IPv4 under Mobile Devices → Public Access and update |
| Cloudflare download fails | Check access to GitHub Releases; alternatively install cloudflared and set `cloudflaredPath` to its absolute path |
| App fails after Quick Tunnel restart | Regenerate and rescan the QR code after URL changes; use a named Tunnel for a fixed address |
| Quick Tunnel fails with existing Cloudflare configuration | Quick Tunnel cannot currently share the configuration directory containing `~/.cloudflared/config.yaml`; inspect panel errors and follow the [official guidance](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Cloudflare connected but app unreachable | Verify the route's Service URL matches the panel's `http://127.0.0.1:<端口>`; check DNS and pairing credentials |
| Need server logs | Read `mobile-gateway.log` in the system temporary directory (Windows: `%TEMP%`; macOS: `$TMPDIR`; Linux usually `/tmp`) |

## Source Development

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

The panel's Tools menu offers Restart Current Gateway and Stop DSH Web. Restart works only when launched through `dsh web`: it ends the current Web process and relaunches with the original arguments plus `--no-open`. The existing tab waits and refreshes; no new tab opens. The replacement process runs in the background, outside the original terminal's foreground job. Stop it through the same menu or send `SIGTERM` to the DSH process listening on the Web port. Connections briefly drop, and the Quick Tunnel URL may change. Reinstall the plugin and restart `dsh web` after source changes.


## Official Voice Input Integration

The gateway integrates DSH 0.2.0-rc.2's official experimental voice-input plugin. Clients can list recognizers, subscribe to preparation progress, prepare models, set recognition preferences, and submit recordings for transcription. Cancellation/disconnect aborts transcription; results are not automatically sent to the Agent.

1. Enable Voice Input (`@deepseek-ai/dsh-experimental-voice-input-bundle`) in DSH plugin management and download/prepare its model.
2. Query `speech-catalog` through the paired control WebSocket; confirm plugin availability and model `ready`/`standby`.
3. After a hold-to-talk recording, convert the complete audio to 16 kHz mono PCM16 WAV and upload Base64 via `speech-transcribe`.
4. Put `speech-transcript` text in the composer, then send using the existing `message` after user confirmation.

Models run on the DSH computer; the phone needs no recognition weights. Only complete-recording transcription is currently provided; clients must implement recording controls, permissions, and conversion. See the [protocol reference](PROTOCOL.md#官方语音输入speech-input-v1) for interfaces, preparation, and errors.

Verify real WAV validation against the installed official plugin (test recognition Provider, no model download):

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
```
