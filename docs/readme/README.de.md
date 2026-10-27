[English](../../README.md) · [简体中文](../../README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · **Deutsch** · [Português (Brasil)](README.pt-BR.md)

> Einige vertiefende Protokoll- und Integrationsdokumente sind derzeit nur auf Chinesisch verfügbar.

<p align="center">
  <img src="../assets/whale-girl-ios-app-promo-16x9.png" alt="Whaleness und Mobile Gateway" width="100%">
</p>

# dsh-plugin-mobile-gateway

Mobiles Drittanbieter-Gateway für DeepSeek Harness mit Geräteauthentifizierung. Sitzungen und Live-Ereignisse, Warteschlangen mit Bearbeiten/Löschen/Steer, bidirektionales Archivieren/Umbenennen, Generierung stoppen/fortsetzen, Aufgaben und aktuelles Goal, servergesteuerte Befehls-/Skill-Menüs, menschliche Freigaben sowie Bild-/Dateiübertragung. Nach Installation bietet Mobilgeräte in WebUI Gateway-Schalter, Kopplungs-QR und vertrauenswürdige Geräte.

> Aktueller Quellcode für **DSH 0.2.1-rc.2**, mit Connection Peer und Session format 4. Alte Verlaufscursor benötigen eine neue Basis.
>
> Live-Ausgabe nutzt separate `assistant-stream`-Frames. Abonnements, Cache und Paginierung gemäß [rc.2-Anleitung](../dsh-rc2-mobile-integration.md) anpassen. Noch nicht veröffentlicht.
>
> v0.11.1 (aktueller Quellcode, unveröffentlicht): blockweise Datei-Uploads mit SHA-256, Fortschrittsbestätigung, Abbruch und Bereinigung nach Verbindungsabbruch. Offizieller DSH-Anhangspeicher und sitzungsgebundene Zugangsdaten für Nachrichten und Live-/Verlaufsreferenzen. `file-upload-v1` integrieren; [Upload-Anleitung](../file-upload-app-integration.md).
>
> v0.11.0: Agent-Teams, Unterhaltungen von Subagents, Mitglieder, gemeinsame Aufgaben, verschachtelte Verzeichnisse, Live-Status, eigener Verlauf, Ansichtswechsel, weitere Unterhaltung, Bildeingabe und Stoppen. Fähigkeiten ermitteln; [Team-Anleitung](../agent-team-app-integration.md).
>
> v0.10.4: Sitzungslisten behalten nur Titel und Projektionsschnittpunkte, um Tunnel-Timeouts bei vielen Sitzungen zu vermeiden. Metadaten und vollständige Verlaufsprojektionen bleiben; keine Client-Anpassung nötig.
>
> v0.10.3: Connection Peer für DSH-0.2.1-rc.2-Remote-Aufrufe/Abonnements, behebt `Cannot read properties of undefined (reading 'signal')`, gibt Peer beim Stoppen frei. Mobiles Protokoll unverändert.
>
> v0.10.2: Dateikarten-Ereignisse und sichere Referenzen mit bestehenden Blockdownloads für Karten/Dateilinks. [Dateikarten-Anleitung](../file-cards-mobile-integration.md).
>
> v0.10.1: offizielle Spracheingabe, Modellvorbereitung/-status, Transkription, Abbruch und Bereinigung. Nutzt offizielles speech Remote ohne mitgelieferte ASR-Modelle.
>
> v0.10.0: zentriertes responsives Fenster mit Host-Design, einheitlichen Menüs, Verbindungsmarkierung, eigenem animiertem QR-Dialog und pro Instanz ausblendbaren Neustarthinweisen. Standardmäßig Online-Geräte, Offline-Geräte aufklappbar, Gerätenamen und Nummern bei Duplikaten. Tunnel-Modus sofort angewendet, benannte Einstellungen explizit gespeichert.
>
> v0.9.0: Plugin-Verwaltung für DSH 0.2.0-rc.2; Quick-/benannte Tunnels mit geprüftem `cloudflared` im privaten Cache; LAN-/Internethinweise; Gateway-Neustart und DSH-Web-Stopp ohne neuen Tab.
>
> v0.7.3: Pfeilabstand im Modusmenü angepasst.
>
> v0.7.2: getrennte Gesprächs-/Steuerverbindungen, leere Sitzungen, Stoppen/Fortsetzen, Warteschlangen mit Bearbeiten/Löschen/Steer und bidirektionales Archivieren/Umbenennen.

## Protokoll und DSH-Kompatibilität

Clients verwenden `dsh-mobile-v1`, nicht DSH-internes Remote. Ein eigener Host Adapter verbindet sich mit DSH 0.2.1-rc.2 Remote Gateway. Session, Workspace, Settings, Commands, Goals, Schedule, Permission Presets, Plugin Manager und strikte Parameter bleiben im Adapter. Frames und mobile Oberfläche: [RC2-Integration](../dsh-0.2.0-rc.2-plugin-management-mobile-integration.md).

Jeder Remote-Aufruf benötigt `peer`. `ctx.connection.createPeer()` erzeugt einen lokalen Benutzer-Peer mit Plugin-Lebensdauer. Der Adapter injiziert ihn in Anfragen, Erstlesevorgänge und Abonnements; Clients bestimmen keine Aufruferidentität. Fragen/Freigaben bleiben bei Host-Listenern. Fehlendes Feld verursacht `Cannot read properties of undefined (reading 'signal')`. Nach DSH-Upgrade Quellversion neu installieren und `dsh web` neu starten; Telefonprotokoll unverändert.

Mit lokal installiertem offiziellem DSH prüfen: echte Gateway/Connection, Testdienste, keine Benutzersitzungen lesen/schreiben:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
```

Authentifizierung und `dsh-mobile-v1` / `hello.protocol = 3` unverändert. Live-Tokens verbrauchen keine persistenten `seq`. Mit `assistantStream: true` atomaren `session-snapshot` und separate Deltas abonnieren. `event` enthält nur persistente Ereignisse; ohne neues Abonnement nur persistente Nachrichten.

Verlauf enthält `historyFormatVersion` und `cursor`. Bei Formatwechsel Cache löschen und Basis erneuern. Paginierung mit `beforeSeq` und Fork mit `atSeq` erfordern `historyFormatVersion: 4`.
Integration/Abnahme: [rc.2-Anleitung](../dsh-rc2-mobile-integration.md). Frühere Migration: [Remote-Gateway-Plan](../remote-gateway-refactor-plan.md).

- WebSocket: `/ws/mobile`
- LAN: `ws://<局域网 IP>:3081/ws/mobile`
- Öffentlicher Linux-Server: `wss://<公网 IP>/ws/mobile`
- Protokoll: [PROTOCOL.md](../../PROTOCOL.md)

Aktueller Code ergänzt Sitzungsmoduswahl: Agent-Voreinstellung leerer Sitzung bis zur ersten Unterhaltung abfragen/ändern. `session-agent-preset` ermitteln und [Client-Anleitung](../session-agent-preset-app-integration.md) befolgen. UI separat integrieren; unveröffentlicht.

`turn-outline-v1` überträgt vollständige WebUI-Turn-Gliederung und Änderungen für Markierungen, Frage-/Antwortvorschauen und paginierte Sprünge ohne vollständige Nachrichten. Neue Steuerverbindung/Geräte erhalten die Basis erneut; ohne Host-Gliederung auf geladene Turns zurückfallen. [Navigationsanleitung](../turn-outline-app-integration.md). UI separat; unveröffentlicht.

`file-upload-v1`: gepaarte Clients laden PDF, Office, Archive, Audio usw. blockweise über Steuerverbindung. Nach SHA-256 in offiziellem Speicher und mit Sitzungsberechtigungen versenden. Fortschritt, Abbruch, Bereinigung und Live-/Verlaufsreferenzen; offizielle WebUI-Zulassung, keine clientbestimmten Host-Pfade. Frames, Zustände, Limits und Abnahme: [Upload-Anleitung](../file-upload-app-integration.md). UI separat; unveröffentlicht.

`agent-team-v1` und `subagent-conversations-v1`: Mitglieder/Aufgaben, verschachtelte Verzeichnisse, Live-Projektion/-Status, eigener Verlauf/Abonnements, Unterhaltung und Stoppen. Zieladressen, JSON, Regeln, Wechsel/Wiederverbindung, Fehler und Abnahme: [Team-Anleitung](../agent-team-app-integration.md). Gateway-Fähigkeiten, UI separat; unveröffentlicht.

## Mehrere Gateways: Phase eins (aktueller Code)

Stabile `gatewayId`, konfigurierbarer `gatewayName`, Endpunktkandidaten, gespeicherte Modi Aus / Temporär / Dauerhaft. Eine App kann verschiedene Rechner koppeln; Verwaltung nach [Client-Anleitung](../multi-gateway-app-integration.md). Dafür noch keine neue npm-Version veröffentlicht.

Dauerhaft akzeptiert autorisierte Geräte nach Neustarts. DSH muss laufen, Rechner wach und Netzwerk erreichbar sein; keine automatische Suche oder Netzwerkvermittlung.

Beispiel für Plugin-`config`:

```yaml
gatewayMode: persistent
gatewayName: 家里电脑
requireAuth: true
endpoints:
  - wss://gateway.example.com/ws/mobile
  - ws://192.168.1.10:3081/ws/mobile
```

Priorität: **gespeicherte UI-Auswahl > `gatewayMode` > altes `gatewayEnabled`**. Ohne Auswahl bedeutet `gatewayEnabled: true` Dauerhaft, false Aus.

- Aus: sofort trennen und nach Neustart ausgeschaltet bleiben.
- Temporär: ohne erfolgreiche Verbindung standardmäßig nach 5 Minuten ausschalten und speichern; nach Verbindung für diesen Lauf aktiv bleiben. Neustart beginnt Wartezeit erneut. `gatewayWaitTimeoutMs`: 30 Sekunden bis 30 Minuten.
- Dauerhaft: kein Warte-Timer ohne Geräte. QR-Codes verfallen weiter nach 5 Minuten; Datei-Timeouts unverändert.

Status in `<deviceFile>.gateway.json`, meist `~/.dsh/mobile-gateway-devices.json.gateway.json`, alternativ `gatewayStateFile`. UUID v4 und Einstellungen, Rechte `0600`, atomarer Austausch über temporäre Datei im selben Ordner. Beschädigung verhindert Start statt stiller neuer Identität. Jede Instanz braucht eigene Registry/Statusdatei.

Beide Dateien bei Upgrade/Umzug erhalten. Für unabhängigen Klon keine Identität/Registry kopieren, neu erzeugen und koppeln. Identitätsdateien nicht im Betrieb löschen. Für Startkonfiguration stoppen, Status sichern, nur `mode` auf `null` setzen, `version`/`gatewayId` erhalten und neu starten.

`gatewayName`: höchstens 80 Zeichen, sonst Hostname. `endpoints`: bis 16 Zusatzadressen mit je 2048 Zeichen. Bevorzugte, öffentliche und LAN-Adressen werden ergänzt; mehr als 16 insgesamt ist ein Fehler. Alle müssen vom Telefon dasselbe Gateway erreichen, nicht `0.0.0.0` / `::`. Öffentlich WSS nutzen.

Tests/manuelle Schritte: [Abnahmebericht](../multi-gateway-phase1-acceptance.md). Umfang: [Checkliste](../multi-gateway-todo.md).

## Zugehöriger Android- und iOS-Client

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile) ist der unabhängig entwickelte native Drittanbieter-Client für dieses Gateway. Android 7.0+ und iOS / iPadOS 16.1+, gemeinsame Kotlin-Multiplatform-Logik mit Jetpack Compose und SwiftUI/UIKit. Arbeitsbereiche/Sitzungen, Live-Unterhaltungen, Teams/Aufgaben, Datei-Uploads/-vorschauen, Textauswahl, Markdown-Tabellen, Verlauf/Cache, Sprache, Freigaben und Servermenüs. iPhone Duo und breite Fenster passen sich Ausrichtung/Platz an; Effekte sind system-/geräteabhängig. Downloads, Einrichtung und aktuelle Bilder im Client-Repository.

> Aktuelle iOS-Produktbilder: Der Bildsatz 1.7.10 stammt vom 22.–23. Oktober 2026, die iPhone-Duo-Bilder vom 26. Oktober 2026. Die Oberfläche ist Chinesisch. [Produktbildquellen](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/SOURCES.md) · [Duo-Bildquellen](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/SOURCES.md).

### iPhone Duo: Querformat, Hochformat und Navigation

<table>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp" alt="Aufgeklappte Startseite im Querformat" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp" alt="Startseitenhintergrund im Querformat" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Aufgeklappte Startseite im Querformat</strong></td>
    <td align="center"><strong>Startseitenhintergrund im Querformat</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp" alt="Einstellungen im Querformat" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp" alt="Unterhaltung im Querformat" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Einstellungen im Querformat</strong></td>
    <td align="center"><strong>Unterhaltung im Querformat</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp" alt="Geöffnete Navigationsseitenleiste" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp" alt="Aufgeklappte Startseite im Hochformat" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Geöffnete Navigationsseitenleiste</strong></td>
    <td align="center"><strong>Aufgeklappte Startseite im Hochformat</strong></td>
  </tr>
</table>

### Teams, Anhänge und lokaler Speicher

<table>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp" alt="Mitglieder des Agent-Teams" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp" alt="Gemeinsame Teamaufgaben" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp" alt="Datei- und Bildauswahl" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Mitglieder des Agent-Teams</strong></td>
    <td align="center"><strong>Gemeinsame Teamaufgaben</strong></td>
    <td align="center"><strong>Datei- und Bildauswahl</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp" alt="Eigene Textauswahlansicht" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp" alt="Dateien in einer Unterhaltung" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp" alt="Mitgelieferte Versionshinweise" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Eigene Textauswahlansicht</strong></td>
    <td align="center"><strong>Dateien in einer Unterhaltung</strong></td>
    <td align="center"><strong>Mitgelieferte Versionshinweise</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp" alt="Lokaler Speicher und Cache-Kategorien" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp" alt="Spracheingabe durch Gedrückthalten" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp" alt="Dateianhang in der Eingabe" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Lokaler Speicher und Cache-Kategorien</strong></td>
    <td align="center"><strong>Spracheingabe durch Gedrückthalten</strong></td>
    <td align="center"><strong>Dateianhang in der Eingabe</strong></td>
  </tr>
</table>

## Plugin installieren

`dsh` CLI und `pnpm` installieren; `dsh web` muss laufen können. Mit aktuellem Benutzer `pnpm --version` prüfen. Der Benutzer muss `pnpm` aufrufen können.

Für LAN-Nutzung installieren:

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

Für öffentliche Linux-IP den einheitlichen Initialisierer nutzen. Er installiert/aktualisiert das Plugin und fordert einmal sudo für den System-Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`init` installiert die genaue ausgeführte npm-Version ins DSH-Profil und überspringt pnpm-Neuveröffentlichungswartezeit nur dafür; Plugin/Helper bleiben gleich versioniert.

Danach WebUI stoppen und neu starten:

```bash
dsh web
```

Mobilgeräte unten in der Seitenleiste prüfen.

## LAN-Kopplung

DSH-Rechner und Mobilgerät im gegenseitig erreichbaren LAN.

1. Mobilgeräte in WebUI öffnen.
2. Dauerhaft oder für kurze Kopplung Temporär wählen.
3. Geräteauthentifizierung eingeschaltet lassen.
4. Direktes LAN wählen und `ws://<电脑局域网 IP>:3081/ws/mobile` prüfen. Cloudflare Tunnel darf aktiv bleiben. Hilfe erklärt Eingänge ohne Auswahländerung.
5. Gerätenamen eingeben und QR erzeugen.
6. Geräteauthentifizierung im Client öffnen und scannen.
7. Fertig, wenn WebUI Online anzeigt.

Bei Firewallproblemen TCP `3081` nur privat freigeben. 3081 nicht öffentlich öffnen.

## Öffentliche IP unter Linux koppeln

> [!NOTE]
> Öffentliche IP meint hier Linux-Server. Seit `v0.6.4` für Ubuntu/Debian mit fester öffentlicher IPv4, installiertem Node.js, `pnpm` und `dsh` CLI. CentOS nicht unterstützt.

### 1. Ports vorbereiten

Öffentliche IPv4 aus Cloud-Konsole übernehmen, eingehend TCP `80`/`443` freigeben. Weder WebUI noch TCP `3081` veröffentlichen.

### 2. Initialisieren

`pnpm` mit regulärem DSH-Benutzer prüfen:

```bash
pnpm --version
```

Als derselbe Benutzer ausführen, nicht `root` oder `sudo npx`:

```bash
npm_config_registry=https://registry.npmjs.org \
npx --yes dsh-plugin-mobile-gateway@latest init
```

Plugin installieren/aktualisieren, einmal sudo für Nginx, Certbot, Helper und Erneuerungstimer. `init` gleicht exakte Versionen ab.

WebUI starten oder neu starten:

```bash
dsh web
```

### 3. Entfernte WebUI öffnen

Portweiterleitung von VS Code/Cursor bevorzugen oder lokal ausführen:

```bash
ssh -N -L <本地端口>:127.0.0.1:<DSH 实际端口> <服务器用户名>@<服务器公网 IP>
```

Im lokalen Browser öffnen:

```text
http://127.0.0.1:<本地端口>
```

### 4. Öffentlichen Zugang einrichten

Unter Mobilgeräte → Öffentlicher Zugang die Cloud-IPv4 eintragen und konfigurieren/aktualisieren. Helper erkennt den `dsh web`-Port und richtet Nginx, TLS und `wss://<公网 IP>/ws/mobile` ein.

<p align="center">
  <img src="../assets/public-access-ui.png" alt="Öffentlichen Zugang im Gerätebereich konfigurieren" width="420">
</p>

### 5. Gerät koppeln

1. Mobile Verbindungen und Authentifizierung aktivieren.
2. Gerätename und QR erzeugen.
3. Am Telefon über Geräteauthentifizierung scannen.
4. Online in WebUI prüfen.

QR einmalig, 5 Minuten gültig; bei Bedarf neu erzeugen.

## Fernzugriff auf private Windows-/macOS-Rechner

Meist keine feste IP; Router-Portweiterleitung wird hier nicht empfohlen. Quick Tunnel ohne Konto/Domain oder benannter Tunnel mit fester Domain. Beim ersten Start offizielles `cloudflared` herunterladen, prüfen und im Benutzer-Cache speichern; kein manueller Systemdienst.

Zuerst `dsh web` starten. Rechner wach, online und DSH aktiv halten; Ruhezustand/Prozessende trennt Fernzugriff.

### Cloudflare Quick Tunnel (temporär)

Standard Automatisch · LAN bevorzugen. Unter Verbindung/Kopplung auf Öffentlich bevorzugen oder Cloudflare öffentlich umstellen; rosa Hinweis bei fehlender Einrichtung. Quick Tunnel · Ohne Domain einschalten. Lädt `cloudflared` bei Bedarf und verwendet `wss://<名称>.trycloudflare.com/ws/mobile`. Für LAN zurückstellen; Tunnel darf bleiben. QR erzeugen/scannen. Ausschalten stoppt Tunnel; DSH-Neustart stellt Quick mit **neuer Zufallsadresse** wieder her.

Kein Konto, Token oder Domain nötig; URL kann nach Neustart/Wiederverbindung wechseln. Die App vertraut nur bestätigten Adressen: QR erneut erzeugen/scannen. **Online-Rechner garantiert keine gültige alte URL.** Quick Tunnel dient Tests/Entwicklung, mit Parallelitätslimit ohne Verfügbarkeitsgarantie. [Dokumentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Konfiguration aktualisieren speichert Modus/Parameter, unverändert ohne Neuverbindung. Tunnel neu starten trennt mobile Verbindungen und baut Tunnel ohne DSH-Web-Neustart neu auf. Quick kann URL ändern und alten QR löschen; neu scannen. Kein automatisches `cloudflared`-Upgrade.

### Benannter Cloudflare Tunnel (feste Adresse)

1. [Remote verwalteten Tunnel erstellen](https://developers.cloudflare.com/tunnel/get-started/), etwa `gateway.example.com`, **Service URL** `http://127.0.0.1:3082`. Kein Systemdienst oder eingehender Router-Port.
2. Token aus Add a replica kopieren, Benannter Tunnel · Feste Domain wählen, Host/Token eingeben und einschalten. Dauerhafter Modus, dedizierter Listener und `cloudflared`. Nach Registrierung prüft der Host DNS/TLS/öffentliche Route separat; bei Erfolg QR mit `wss://gateway.example.com/ws/mobile` erzeugen.
3. `dsh web` stellt aktivierte Tunnels wieder her. Cloudflare Tunnel schließen stoppt Prozess/Listener. Gateway manuell aus pausiert Tunnel, einschalten setzt fort. Das verwaltete `cloudflared` wird ebenfalls beendet.

Nur `/ws/mobile` WebSocket; andere Pfade, WebUI und `/mgw` liefern 404. Zugangsdaten immer erforderlich, auch bei deaktivierter lokaler Debug-Authentifizierung. Token in `<deviceFile>.cloudflare.json`, meist `~/.dsh/mobile-gateway-devices.json.cloudflare.json`, Rechte `0600`, nie zum Browser. Privater `cloudflared-bin`-Cache ohne System-/Fremdbinärdateien; bei jedem Start geprüft, nur fehlend/beschädigt feste Version herunterladen und offiziellen SHA-256 prüfen. Extern nur mit `cloudflaredPath`. Bei geändertem `cloudflarePort` Service URL anpassen. Das zwischengespeicherte `cloudflared` wird beim Start geprüft.

#### Öffentliche Prüfung und Status

`state: online` bestätigt nur Tunnelregistrierung, keine Domain-/TLS-/Origin-Erreichbarkeit. Zusätzlich `endpointHealth` mit Status, Hinweis, Zeit und Fehler sowie `publicReady`. Automatische Prüfung nach Verbindung und DNS/TLS/WebSocket-Knopf über authentifiziertes `POST /mgw/cloudflare/check`, ohne Neustart.

System-DNS, HTTPS WebSocket mit strengen Zertifikaten, ohne Tokens/Weiterleitungen. Nur 401 mit Echo eines neuen Zufallsmarkers bestätigt die geschützte Route; allgemeines Proxy-/Access-401 genügt nicht. Marker nur bei Ablehnung ohne gültige Geräteberechtigung, ohne Zugriffsrecht. Lokale Momentaufnahme, keine Garantie für Telefonnetz, Authentifizierung oder Synchronisierung.

Lokaler DNS-Fehler beweist keinen fehlenden öffentlichen Eintrag: NXDOMAIN-Cache, DNS, VPN oder Proxy möglich. Host und Proxy-CNAME prüfen, später wiederholen; TLS-Prüfung nicht ausschalten. Tunnel-Token betreibt Remote-Tunnels, erstellt aber keine DNS/Routen. Zusätzlich autorisierte CLI/API können das außerhalb dieser Prüfung.

### Tailscale (dauerhafte Nutzung)

1. [Tailscale](https://tailscale.com/download) auf Rechner/Telefon installieren, gleiches Tailnet.
2. In PowerShell oder macOS-Terminal ausführen:

```bash
tailscale serve --bg 3081
```

3. Mit `tailscale serve status` die URL `https://<设备名>.<tailnet>.ts.net` prüfen.
4. `wss://<设备名>.<tailnet>.ts.net/ws/mobile` in WebUI eintragen und QR erzeugen.

Serve erlaubt nur autorisierte Geräte desselben Tailnets und liefert HTTPS. Mit `tailscale serve reset` stoppen. [Dokumentation](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Verbindungsoptionen

| Szenario | Zugang | Mobile WebSocket-Adresse | Einrichtung | Ports und Authentifizierung |
|---|---|---|---|---|
| Gleiches LAN | Plugin-LAN | `ws://<电脑局域网 IP>:3081/ws/mobile` | Kein Helper/Nginx; gegenseitig erreichbar | Nur privates TCP `3081`; Authentifizierung |
| Lokaler iOS-Simulator | WebUI lokal | `ws://127.0.0.1:<DSH WebUI 端口>/ws/mobile` | Kein Helper/Nginx oder separates `3081` | Keine externen Ports; Authentifizierung nur Debug aus |
| Öffentliches Linux | Helper + Nginx + TLS | `wss://<服务器公网 IPv4>/ws/mobile` | `init`, IPv4 in WebUI | TCP `80/443`; DSH/`3081` nicht öffentlich; Authentifizierung |
| Privates Windows / macOS | Benannter Tunnel | `wss://<公开域名>/ws/mobile` | Route auf `127.0.0.1:3082`; Host/Token | Keine Routerfreigabe; Geräteauthentifizierung |
| Privates Windows / macOS | Quick Tunnel | `wss://<随机名称>.trycloudflare.com/ws/mobile` | Einschalten, bei URL-Wechsel scannen | Kein Konto/Domain/Router-Port; Geräteauthentifizierung |
| Privates Windows / macOS | Tailscale Serve | `wss://<Tailscale 域名>/ws/mobile` | Auf `127.0.0.1:3081` weiterleiten; URL in WebUI | Keine Routerfreigabe; Authentifizierung |

## Linux-Internetzugang verwalten

Status prüfen:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

Öffentlichen Zugang entfernen:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## Aktualisieren

Initialisierung für Plugin und Helper erneut ausführen:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

Danach `dsh web` stoppen und neu starten.

## Deinstallieren

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

System-Helper ebenfalls entfernen, Nginx-Konfiguration bleibt erhalten:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove-helper
```

## Fehlerbehebung

| Problem | Maßnahme |
|---|---|
| Mobilgeräte fehlt | In Profil `web` installieren, `dsh web` vollständig neu starten |
| Client erhält `503` | Mobile Verbindungen in WebUI aktivieren |
| Client erhält `401` | QR erneuern und koppeln |
| Linux-Timeout | Sicherheitsgruppe, Firewall, TCP `80/443` prüfen |
| Linux-Adresse fehlt | Öffentliche IPv4 eintragen und aktualisieren |
| Cloudflare-Downloadfehler | GitHub Releases prüfen oder cloudflared installieren und absoluten `cloudflaredPath` setzen |
| Quick nach Neustart getrennt | QR erneuern/scannen; benannter Tunnel für feste URL |
| Quick und bestehende Konfiguration | Konfigurationsordner mit `~/.cloudflared/config.yaml` nicht gemeinsam nutzbar; Fehler und [offizielle Hinweise](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) prüfen |
| Tunnel online, App unerreichbar | Service URL `http://127.0.0.1:<端口>`, DNS und Berechtigung prüfen |
| Serverprotokolle | `mobile-gateway.log` im Tempordner: Windows `%TEMP%`, macOS `$TMPDIR`, Linux meist `/tmp` |

## Quellentwicklung

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

Werkzeuge bietet Gateway neu starten und DSH Web stoppen. Neustart nur bei Start über `dsh web`, ursprüngliche Argumente plus `--no-open`; bestehender Tab wartet/aktualisiert. Neuer Prozess läuft im Hintergrund außerhalb des Terminaljobs. Über Menü oder `SIGTERM` an den DSH-Web-Port-Prozess stoppen. Kurz getrennte Verbindungen und geänderte Quick-URL möglich. Nach Codeänderung Plugin neu installieren und neu starten. Anschließend `dsh web` neu starten.


## Offizielle Spracheingabe integrieren

Experimentelles offizielles DSH-0.2.0-rc.2-Plugin: Erkenner auflisten, Modelle vorbereiten/Fortschritt abonnieren, Präferenzen setzen, Aufnahmen transkribieren. Abbruch/Trennung beendet Transkription; kein automatisches Senden an Agent.

1. Spracheingabe (`@deepseek-ai/dsh-experimental-voice-input-bundle`) aktivieren und Modell laden/vorbereiten.
2. Über gekoppelte Steuerverbindung `speech-catalog` abfragen, Verfügbarkeit und `ready`/`standby` prüfen.
3. Gesamte Aufnahme in 16-kHz-Mono-PCM16-WAV umwandeln und Base64 über `speech-transcribe` senden.
4. `speech-transcript` in Eingabe setzen, nach Bestätigung mit `message` senden.

Modelle auf DSH-Rechner, keine Gewichte auf Telefon. Nur vollständige Aufnahmen; Aufnahmebedienung, Rechte und Konvertierung im Client integrieren. [Protokoll](../../PROTOCOL.md#官方语音输入speech-input-v1).

WAV-Prüfung mit installiertem offiziellem Plugin, Test-Provider und ohne Modelldownload:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
```
