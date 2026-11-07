[English](../../README.md) · [简体中文](../../README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Español** · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

> Algunos documentos detallados de protocolo e integración solo están disponibles en chino.

<p align="center">
  <img src="../assets/whale-girl-ios-app-promo-16x9.png" alt="Whaleness y Mobile Gateway" width="100%">
</p>

# dsh-plugin-mobile-gateway

> **v0.12.0 · pendiente de publicación** — Compatible con DSH 0.2.2-rc.1 y Node.js 24.9+. Añade citas de chat, tareas programadas del Host, actualizaciones y detalles de plugins, y un selector de idioma que sigue DSH. Corrige las actualizaciones de proyecciones por lotes y la lectura de imágenes. [Cambios](../../CHANGELOG.md) · [Integración móvil](../dsh-0.2.2-rc.1-mobile-integration.md)

Gateway móvil de terceros para DeepSeek Harness con autenticación de dispositivos. Admite sesiones y eventos en directo; sincronización, edición, eliminación y Steer de mensajes en cola; archivado y renombrado bidireccionales; detener y reanudar generación; tareas y Goal actual; menús de comandos y habilidades del servidor; intervención humana; e imágenes y archivos. Tras instalarlo aparece Dispositivos móviles en WebUI para habilitar el gateway, generar códigos QR y gestionar dispositivos de confianza.

> El código actual se adapta a **DSH 0.2.2-rc.1**, requiere Connection Peer y usa Session format 4. Los cursores de historial antiguos necesitan una nueva base.
>
> El flujo usa tramas `assistant-stream` independientes. Actualiza suscripciones, cachés y paginación según la [guía rc.2](../dsh-rc2-mobile-integration.md). Cambios aún no publicados.
>
> v0.11.1 (código actual, aún no publicado): subida de archivos por bloques con SHA-256, confirmación de progreso, cancelación y limpieza al desconectar. Reutiliza el almacenamiento oficial de adjuntos DSH y credenciales por sesión para enviar archivos y referencias en directo/históricas. Implementa `file-upload-v1`; consulta la [guía de subida](../file-upload-app-integration.md).
>
> v0.11.0: equipos y conversaciones de subagentes, miembros, tableros compartidos, directorios anidados, estado en directo, historial independiente, cambio de vista, conversación, imágenes y detención. Usa descubrimiento de capacidades y la [guía de equipos](../agent-team-app-integration.md).
>
> v0.10.4: las listas de sesiones conservan solo títulos y puntos de corte para evitar tiempos de espera en túneles con muchas sesiones. Se mantienen metadatos e historial completo; no requiere cambios en clientes existentes.
>
> v0.10.3: Connection Peer en llamadas Remote y suscripciones para DSH 0.2.1-rc.2; corrige `Cannot read properties of undefined (reading 'signal')` y libera Peer al detenerse. Protocolo móvil sin cambios.
>
> v0.10.2: eventos de tarjetas y resolución segura de referencias, con descarga por bloques para tarjetas y enlaces de archivos. Véase la [guía de tarjetas](../file-cards-mobile-integration.md).
>
> v0.10.1: entrada de voz oficial, preparación/estado del modelo, transcripción, cancelación y limpieza al desconectar. Usa speech Remote oficial sin incluir modelos ASR.
>
> v0.10.0: ventana adaptable centrada con tema del host, menús uniformes, resaltado de conexión, diálogo QR animado independiente, avisos de reinicio descartables por instancia, dispositivos en línea por defecto y sin conexión desplegables, nombres y numeración de duplicados. El modo Tunnel se aplica automáticamente; la configuración del Tunnel con nombre se guarda explícitamente.
>
> v0.9.0: gestión de plugins DSH 0.2.0-rc.2; control de Tunnels Quick/con nombre con `cloudflared` verificado en caché privada; orientación LAN/pública; reinicio del gateway y parada de DSH Web sin otra pestaña.
>
> v0.7.3: ajuste del espacio de la flecha del selector de modo.
>
> v0.7.2: conexiones separadas de conversación/control, sesiones vacías, detener/reanudar, cola con edición/eliminación/Steer y archivado/renombrado bidireccionales.

## Protocolo y compatibilidad con DSH

El cliente usa `dsh-mobile-v1`, no el Remote interno de DSH. Un Host Adapter separado conecta con Remote Gateway de DSH 0.2.1-rc.2; los espacios Session, Workspace, Settings, Commands, Goals, Schedule, Permission Presets y Plugin Manager y sus parámetros estrictos quedan dentro del adaptador. Tramas y diseño móvil: [integración de plugins RC2](../dsh-0.2.0-rc.2-plugin-management-mobile-integration.md).

Cada llamada Remote de DSH 0.2.1-rc.2 necesita `peer`. `ctx.connection.createPeer()` crea un Peer de usuario local que se libera con el plugin. Host Adapter lo inyecta en solicitudes, lecturas iniciales y suscripciones; el móvil no elige identidad. Preguntas y aprobaciones siguen usando listeners Host. Omitirlo provoca `Cannot read properties of undefined (reading 'signal')`. Tras actualizar DSH, reinstala este código y reinicia `dsh web`; el protocolo del teléfono no cambia.

Verifica con DSH oficial local: Gateway/Connection reales, servicios de prueba y sin leer ni modificar sesiones del usuario:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
```

La autenticación y `dsh-mobile-v1` / `hello.protocol = 3` no cambian. Los tokens en directo no consumen `seq` persistentes. Suscribe `assistantStream: true` para recibir `session-snapshot` atómico y deltas separados; `event` solo incluye eventos persistentes. Sin la nueva suscripción solo llegan mensajes persistentes.

El historial incluye `historyFormatVersion` y `cursor`. Al cambiar formato, limpia cachés y reinstala la base. Paginación con `beforeSeq` o fork con `atSeq` requieren `historyFormatVersion: 4`.
Integración y aceptación: [guía rc.2](../dsh-rc2-mobile-integration.md). Migración anterior: [plan Remote Gateway](../remote-gateway-refactor-plan.md).

- WebSocket: `/ws/mobile`
- LAN: `ws://<局域网 IP>:3081/ws/mobile`
- Servidor Linux público: `wss://<公网 IP>/ws/mobile`
- Protocolo: [PROTOCOL.md](../../PROTOCOL.md)

El código añade selección de modo de sesión: consulta y cambia el preajuste del Agent en una sesión vacía hasta la primera conversación. Descubre `session-agent-preset`; sigue la [guía del cliente](../session-agent-preset-app-integration.md). La interfaz requiere integración; aún no publicado.

`turn-outline-v1` transmite el esquema completo de turnos de WebUI y sus cambios para mostrar marcadores, previsualizar preguntas/respuestas y paginar hacia un turno sin cargar todo el texto. Reconectar control o un nuevo dispositivo restaura la base; sin esquema del Host se usan turnos cargados. [Guía de navegación](../turn-outline-app-integration.md). Interfaz separada; aún no publicado.

`file-upload-v1` permite subir PDF, Office, archivos comprimidos y audio por bloques sobre control. Tras verificar SHA-256 se almacenan como adjuntos oficiales y se envían con credenciales por sesión. Admite progreso, cancelación, limpieza y referencias en directo/históricas; respeta admisión WebUI sin escribir en rutas elegidas por el cliente. Tramas, estados, límites y pruebas: [guía de subida](../file-upload-app-integration.md). Interfaz separada; aún no publicado.

`agent-team-v1` y `subagent-conversations-v1` añaden miembros, tableros, directorios anidados, proyección y estado en directo, historial/suscripciones independientes, conversación y detención. Destinos, JSON, reglas, cambio/reconexión, errores y aceptación: [guía de equipos](../agent-team-app-integration.md). Son capacidades del gateway; interfaz separada. Aún no publicado.

## Varios gateways: primera fase (código actual)

`gatewayId` estable, `gatewayName` configurable, direcciones candidatas y modos Desactivado / Temporal / Permanente persistentes. Una app puede emparejar distintas máquinas; su gestión debe seguir la [guía](../multi-gateway-app-integration.md). Este código no tiene nueva versión npm publicada.

El modo Permanente acepta dispositivos autorizados después de reiniciar. Requiere DSH activo, máquina despierta y red accesible; no aporta descubrimiento automático ni retransmisión.

Ejemplo de `config` del plugin:

```yaml
gatewayMode: persistent
gatewayName: 家里电脑
requireAuth: true
endpoints:
  - wss://gateway.example.com/ws/mobile
  - ws://192.168.1.10:3081/ws/mobile
```

Prioridad: **selección guardada en interfaz > `gatewayMode` > antiguo `gatewayEnabled`**. Sin selección, `gatewayEnabled: true` significa Permanente; false, Desactivado.

- Desactivado: desconecta inmediatamente y sigue así tras reiniciar.
- Temporal: sin conexión exitosa en 5 minutos, se apaga y guarda ese estado; tras conectar, permanece activo durante esa ejecución. Reiniciar reinicia la espera. `gatewayWaitTimeoutMs`: 30 segundos–30 minutos.
- Permanente: sin temporizador por ausencia de dispositivos. Los QR siguen caducando en 5 minutos y los tiempos de transferencia no cambian.

Estado: `<deviceFile>.gateway.json`, normalmente `~/.dsh/mobile-gateway-devices.json.gateway.json`, configurable con `gatewayStateFile`. Contiene UUID v4 y preferencias, permisos `0600`, reemplazo atómico mediante archivo temporal vecino. Si se corrompe, falla el inicio sin generar otra identidad. Cada instancia necesita registro y estado independientes.

Conserva ambos archivos al actualizar o migrar. Para clonar otro gateway independiente, no copies identidad/estado ni registro: genera identidad y empareja otra vez. No borres la identidad en ejecución. Para restaurar configuración inicial, detén, respalda estado, cambia solo `mode` a `null`, conserva `version` y `gatewayId` y reinicia.

`gatewayName`: 80 caracteres como máximo; por defecto nombre del host. `endpoints`: 16 candidatos de hasta 2048 caracteres. Se añaden preferidos, públicos y LAN; más de 16 en total produce error. Todos deben apuntar al mismo gateway y ser accesibles desde el móvil; no uses `0.0.0.0` / `::`. Usa WSS públicamente.

Pruebas y pasos manuales: [aceptación](../multi-gateway-phase1-acceptance.md). Alcance: [lista multigateway](../multi-gateway-todo.md).

## Cliente complementario Android e iOS

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile) es un cliente nativo de terceros desarrollado de forma independiente para este gateway. Compatible con Android 7.0+ e iOS / iPadOS 16.1+, comparte lógica con Kotlin Multiplatform y usa Jetpack Compose y SwiftUI/UIKit. Incluye espacios y sesiones, conversaciones en directo, equipos y tareas compartidas, subida/vista previa de archivos, selección de texto, tablas Markdown, historial/caché local, voz, aprobaciones y menús del servidor. Los diseños de iPhone Duo y pantallas grandes se adaptan a la orientación y espacio; los efectos dependen del sistema y dispositivo. Descargas, instalación y capturas actuales en su repositorio.

> Capturas recientes de iOS: las imágenes de 1.7.10 se tomaron el 22–23 de octubre de 2026; las de iPhone Duo, el 26 de octubre de 2026. La interfaz está en chino. [Fuentes del producto](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/SOURCES.md) · [Fuentes de Duo](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/SOURCES.md).

### iPhone Duo: orientación y navegación adaptables

<table>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp" alt="Inicio desplegado en horizontal" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp" alt="Fondo del inicio horizontal" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Inicio desplegado en horizontal</strong></td>
    <td align="center"><strong>Fondo del inicio horizontal</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp" alt="Ajustes en horizontal" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp" alt="Conversación en horizontal" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Ajustes en horizontal</strong></td>
    <td align="center"><strong>Conversación en horizontal</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp" alt="Barra lateral de navegación abierta" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp" alt="Inicio desplegado en vertical" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Barra lateral de navegación abierta</strong></td>
    <td align="center"><strong>Inicio desplegado en vertical</strong></td>
  </tr>
</table>

### Equipos, adjuntos y almacenamiento local

<table>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp" alt="Miembros del equipo de Agents" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp" alt="Tareas compartidas del equipo" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp" alt="Selector de archivos e imágenes" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Miembros del equipo de Agents</strong></td>
    <td align="center"><strong>Tareas compartidas del equipo</strong></td>
    <td align="center"><strong>Selector de archivos e imágenes</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp" alt="Selección de texto independiente" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp" alt="Archivos en una conversación" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp" alt="Notas de versión incluidas" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Selección de texto independiente</strong></td>
    <td align="center"><strong>Archivos en una conversación</strong></td>
    <td align="center"><strong>Notas de versión incluidas</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp" alt="Almacenamiento local y categorías de caché" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp" alt="Entrada de voz al mantener pulsado" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp" alt="Archivo adjunto en el editor" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Almacenamiento local y categorías de caché</strong></td>
    <td align="center"><strong>Entrada de voz al mantener pulsado</strong></td>
    <td align="center"><strong>Archivo adjunto en el editor</strong></td>
  </tr>
</table>

## Instalar el plugin

Requiere `dsh` CLI, `pnpm` y `dsh web` operativo. Comprueba `pnpm --version` con el usuario actual. El usuario debe poder ejecutar `pnpm`.

Para LAN, instala el plugin:

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

Para IP pública en Linux, usa el inicializador unificado. Instala/actualiza el plugin y solicita sudo una vez para el Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`init` instala en el perfil DSH la versión exacta del paquete npm ejecutado y omite la espera de nuevas versiones de pnpm solo para ella, alineando plugin y Helper.

Detén y reinicia WebUI tras instalar:

```bash
dsh web
```

Comprueba que Dispositivos móviles aparece al final de la barra lateral.

## Emparejamiento LAN

Para el ordenador DSH y el móvil en una LAN mutuamente accesible.

1. Abre Dispositivos móviles en WebUI.
2. Elige modo Permanente o Temporal para un emparejamiento breve.
3. Mantén activada la autenticación de dispositivos.
4. Selecciona LAN directa y confirma `ws://<电脑局域网 IP>:3081/ws/mobile`. Cloudflare Tunnel puede seguir activo. El icono de ayuda explica rutas y escenarios sin modificar la selección.
5. Introduce el nombre y genera el QR.
6. Abre la autenticación en el cliente móvil y escanea.
7. Finaliza cuando WebUI muestre el dispositivo En línea.

Si bloquea el firewall, permite TCP `3081` solo en redes privadas. No publiques 3081.

## Emparejamiento por IP pública en Linux

> [!NOTE]
> Aquí IP pública significa servidor Linux. Disponible desde `v0.6.4` para Ubuntu/Debian con IPv4 pública fija. Requiere Node.js, `pnpm` y `dsh` CLI. CentOS aún no compatible.

### 1. Preparar puertos

Copia la IPv4 pública del proveedor y permite TCP entrante `80` y `443` en el grupo de seguridad. No publiques WebUI ni TCP `3081`.

### 2. Inicializar

Confirma que el usuario normal de DSH puede usar `pnpm`:

```bash
pnpm --version
```

Ejecuta con ese usuario, sin `root` ni `sudo npx`:

```bash
npm_config_registry=https://registry.npmjs.org \
npx --yes dsh-plugin-mobile-gateway@latest init
```

Instala/actualiza el plugin y pide sudo una vez para Nginx, Certbot, Helper y temporizadores de renovación. `init` mantiene versiones exactas alineadas.

Inicia o reinicia WebUI:

```bash
dsh web
```

### 3. Abrir WebUI remoto

Prioriza reenvío de puertos de VS Code, Cursor u otro IDE. También puedes ejecutar en tu ordenador:

```bash
ssh -N -L <本地端口>:127.0.0.1:<DSH 实际端口> <服务器用户名>@<服务器公网 IP>
```

Abre en el navegador local:

```text
http://127.0.0.1:<本地端口>
```

### 4. Configurar entrada pública

En Dispositivos móviles → Acceso público, introduce la IPv4 del proveedor y configura/actualiza. El Helper detecta el puerto de `dsh web` y configura Nginx, TLS y `wss://<公网 IP>/ws/mobile`.

<p align="center">
  <img src="../assets/public-access-ui.jpg" alt="Configuración del acceso público en el panel" width="960">
</p>

### 5. Emparejar

1. Permite conexiones móviles y conserva la autenticación.
2. Introduce el nombre y genera el QR.
3. Escanea desde la autenticación del móvil.
4. Comprueba En línea en WebUI.

QR de un solo uso, caduca en 5 minutos; vuelve a generarlo si hace falta.

## Acceso remoto a Windows / macOS doméstico

Normalmente sin IP fija: no se recomienda abrir puertos del router. El panel ofrece Quick Tunnel sin cuenta/dominio y Tunnel con nombre/dominio fijo. Descarga y verifica `cloudflared` oficial en la caché del usuario al primer uso; no requiere servicio del sistema manual.

Inicia `dsh web`. Mantén ordenador despierto, conectado y DSH activo; suspensión o salida interrumpen el acceso.

### Cloudflare Quick Tunnel (temporal)

El valor predeterminado es Automático · Preferir LAN. En Dispositivos móviles → Conexión y emparejamiento, cambia a Preferir público o Cloudflare público; una indicación rosa avisa si falta configuración. Elige Quick Tunnel · Sin dominio y actívalo. Descarga `cloudflared` si falta y utiliza `wss://<名称>.trycloudflare.com/ws/mobile`. Para LAN vuelve a preferir LAN o LAN directa sin apagar el túnel. Genera/escanea el QR. Desactivar detiene el túnel; reiniciar DSH restaura Quick con **otra dirección aleatoria**.

Sin cuenta, Token ni dominio Cloudflare; la dirección puede cambiar al reiniciar o reconectar. La app solo confía en direcciones confirmadas: regenera y escanea tras cambiar. **Ordenador conectado no garantiza URL antigua válida.** Quick Tunnel es para pruebas/desarrollo, con límites de concurrencia y sin garantía de disponibilidad. [Documentación](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Actualizar configuración guarda modo y parámetros; sin cambios no reconecta. Reiniciar Tunnel corta conexiones y recrea el túnel sin reiniciar DSH Web; Quick puede cambiar URL y borrar el QR antiguo, por lo que debes escanear otra vez. No actualiza automáticamente `cloudflared`.

### Cloudflare Tunnel con nombre (dirección fija)

1. [Crea un Tunnel administrado remotamente](https://developers.cloudflare.com/tunnel/get-started/), añade un host como `gateway.example.com` y **Service URL** `http://127.0.0.1:3082`. Sin servicio Cloudflare ni puertos entrantes del router.
2. Copia Token de Add a replica, elige Tunnel con nombre · Dominio fijo, introduce host/Token y activa. Configura modo Permanente y ejecuta listener dedicado y `cloudflared`. Tras registrar, comprueba DNS, TLS y ruta pública desde la máquina; usa `wss://gateway.example.com/ws/mobile` si pasa la prueba.
3. `dsh web` restaura túneles habilitados. Cerrar Cloudflare Tunnel detiene proceso y listener. Apagar manualmente el gateway pausa el túnel; encender lo reanuda. También detiene el `cloudflared` administrado.

Ambas entradas solo aceptan WebSocket `/ws/mobile`; otras rutas, WebUI y `/mgw` devuelven 404. Siempre requieren credenciales, incluso si Debug local desactiva autenticación. Token en `<deviceFile>.cloudflare.json` (normalmente `~/.dsh/mobile-gateway-devices.json.cloudflare.json`), permisos `0600`, nunca enviado al navegador. Caché privada `cloudflared-bin`, sin binarios de otras apps/sistema; se verifica siempre y solo se descarga versión fija ante ausencia/corrupción, contrastando SHA-256 oficial. Binario externo solo con `cloudflaredPath`. Cambiar `cloudflarePort` requiere actualizar Service URL. El `cloudflared` de caché se verifica al iniciar.

#### Comprobación pública y estado

`state: online` solo indica registro del túnel, no garantiza dominio, TLS o ruta. Se ofrecen `endpointHealth` (estado, indicación, fecha, error) y `publicReady`. Comprueba al conectar y permite repetir DNS/TLS/WebSocket mediante `POST /mgw/cloudflare/check`, protegido por autenticación de gestión, sin reiniciar.

Usa DNS local, HTTPS WebSocket con certificado estricto, sin tokens ni redirecciones. Solo HTTP 401 con eco de marcador aleatorio confirma la ruta protegida; un 401 genérico del proxy/Access no basta. El marcador solo se devuelve al rechazar credenciales ausentes/inválidas y no da acceso. Es una instantánea local, no garantía de conexión del móvil, autenticación o sincronización.

Un fallo DNS local no prueba ausencia pública: puede haber NXDOMAIN en caché, DNS local, VPN o proxy. Revisa host/CNAME con proxy y reintenta; no desactives TLS. El Token ejecuta túneles administrados remotamente, pero no crea DNS/rutas. CLI/API con autorización adicional pueden hacerlo, fuera de esta comprobación.

### Tailscale (uso prolongado)

1. Instala [Tailscale](https://tailscale.com/download) en ordenador y móvil, en el mismo Tailnet.
2. Ejecuta en PowerShell o terminal macOS:

```bash
tailscale serve --bg 3081
```

3. Consulta `tailscale serve status` para obtener `https://<设备名>.<tailnet>.ts.net`.
4. Usa `wss://<设备名>.<tailnet>.ts.net/ws/mobile` en WebUI y genera QR.

Serve solo permite dispositivos autorizados en ese Tailnet y aporta HTTPS. Detén con `tailscale serve reset`. [Documentación](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Opciones de conexión

| Escenario | Entrada | Dirección WebSocket móvil | Configuración adicional | Puertos y autenticación |
|---|---|---|---|---|
| Misma LAN | Listener del plugin | `ws://<电脑局域网 IP>:3081/ws/mobile` | Sin Helper/Nginx; conectividad mutua | TCP privado `3081`; autenticación activa |
| Simulador iOS local | Entrada WebUI local | `ws://127.0.0.1:<DSH WebUI 端口>/ws/mobile` | Sin Helper/Nginx ni puerto `3081` separado | Sin puertos externos; desactivar autenticación solo en Debug |
| Linux público | Helper + Nginx + TLS | `wss://<服务器公网 IPv4>/ws/mobile` | Ejecutar `init`, introducir IPv4 en WebUI | TCP `80/443`; no exponer DSH/`3081`; autenticación obligatoria |
| Windows / macOS doméstico | Tunnel con nombre | `wss://<公开域名>/ws/mobile` | Ruta a `127.0.0.1:3082`; host/Token en panel | Sin puertos del router; autenticación obligatoria |
| Windows / macOS doméstico | Quick Tunnel | `wss://<随机名称>.trycloudflare.com/ws/mobile` | Activar; volver a escanear si cambia URL | Sin dominio/cuenta/puertos; autenticación obligatoria |
| Windows / macOS doméstico | Tailscale Serve | `wss://<Tailscale 域名>/ws/mobile` | Reenvío a `127.0.0.1:3081`; URL en WebUI | Sin puertos del router; autenticación activa |

## Gestionar acceso público Linux

Consultar estado:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

Eliminar entrada pública:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## Actualizar el plugin

Repite la inicialización para actualizar plugin y Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

Detén y reinicia `dsh web`.

## Desinstalar

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

Para eliminar también Helper, conservando configuración Nginx:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove-helper
```

## Problemas frecuentes

| Síntoma | Acción |
|---|---|
| Sin Dispositivos móviles | Instalar en perfil `web` y reiniciar `dsh web` |
| Cliente recibe `503` | Habilitar conexiones en WebUI |
| Cliente recibe `401` | Regenerar QR y emparejar |
| Tiempo de espera en Linux público | Comprobar seguridad, firewall y TCP `80/443` |
| No aparece dirección Linux | Introducir IPv4 en Acceso público y actualizar |
| Falla descarga Cloudflare | Revisar GitHub Releases o instalar cloudflared y configurar ruta absoluta `cloudflaredPath` |
| Falla tras reiniciar Quick | Regenerar y escanear; usar Tunnel con nombre para URL fija |
| Quick falla con configuración previa | No comparte directorio con `~/.cloudflared/config.yaml`; revisar errores y [guía oficial](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Cloudflare conectado pero móvil falla | Verificar Service URL `http://127.0.0.1:<端口>`, DNS y credenciales |
| Consultar logs | `mobile-gateway.log` en temporales: Windows `%TEMP%`, macOS `$TMPDIR`, Linux normalmente `/tmp` |

## Desarrollo desde código

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

Herramientas ofrece Reiniciar gateway y Detener DSH Web. Solo reinicia procesos iniciados con `dsh web`, reutilizando argumentos y añadiendo `--no-open`; la pestaña espera y recarga. El nuevo proceso queda en segundo plano, fuera del trabajo del terminal original. Detén desde el menú o envía `SIGTERM` al proceso DSH que escucha el puerto Web. Se interrumpen conexiones y puede cambiar URL Quick. Reinstala/reinicia tras modificar código. Reinicia `dsh web` al terminar.


## Integración de voz oficial

Integra el plugin experimental oficial de DSH 0.2.0-rc.2: consultar reconocedores, progreso y preparación, preferencias y transcripción. Cancelar o desconectar aborta; no envía automáticamente al Agent.

1. Activa Entrada de voz (`@deepseek-ai/dsh-experimental-voice-input-bundle`) y descarga/prepara el modelo.
2. Consulta `speech-catalog` por control emparejado y comprueba disponibilidad y `ready`/`standby`.
3. Tras grabar, convierte audio completo a WAV PCM16 mono 16 kHz y envía Base64 mediante `speech-transcribe`.
4. Coloca `speech-transcript` en el editor y envía `message` tras confirmación.

Modelos en ordenador DSH, sin pesos en teléfono. Solo transcripción de grabaciones completas; cliente debe implementar botones, permisos y conversión. Véase [protocolo](../../PROTOCOL.md#官方语音输入speech-input-v1).

Verifica validación WAV con el plugin oficial local, Provider de prueba y sin descargar modelos:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
```
