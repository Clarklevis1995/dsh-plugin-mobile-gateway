[English](../../README.md) · [简体中文](../../README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Português (Brasil)**

> Alguns documentos detalhados de protocolo e integração estão disponíveis somente em chinês.

<p align="center">
  <img src="../assets/whale-girl-ios-app-promo-16x9.png" alt="Whaleness e Mobile Gateway" width="100%">
</p>

# dsh-plugin-mobile-gateway

> **v0.12.0 · publicação pendente** — Compatível com DSH 0.2.2-rc.1 e Node.js 24.9+. Adiciona citações, tarefas agendadas do Host, atualizações e detalhes de plugins e seleção de idioma que acompanha o DSH. Corrige projeções em lote e leitura de imagens. [Alterações](../../CHANGELOG.md) · [Integração móvel](../dsh-0.2.2-rc.1-mobile-integration.md)

Gateway móvel de terceiros para DeepSeek Harness com autenticação de dispositivos. Sessões e eventos ao vivo; fila com sincronização, edição, exclusão e Steer; arquivamento/renomeação bidirecionais; parar/continuar geração; tarefas e Goal atual; menus de comandos e habilidades do servidor; intervenção humana; imagens e arquivos. A instalação adiciona Dispositivos móveis ao WebUI para ativar o gateway, gerar QR e gerenciar dispositivos confiáveis.

> Código atual para **DSH 0.2.2-rc.1**, com Connection Peer e Session format 4. Cursores antigos exigem uma nova base de histórico.
>
> Fluxo em quadros `assistant-stream` separados. Atualize assinaturas, cache e paginação conforme o [guia rc.2](../dsh-rc2-mobile-integration.md). Mudanças ainda não publicadas.
>
> v0.11.1 (código atual, não publicado): envio de arquivos em blocos, SHA-256, confirmação de progresso, cancelamento e limpeza ao desconectar. Usa armazenamento oficial de anexos DSH e credenciais por sessão para mensagens e referências ao vivo/históricas. Integre `file-upload-v1`; [guia de envio](../file-upload-app-integration.md).
>
> v0.11.0: equipes, subagentes, membros, tarefas compartilhadas, diretórios aninhados, estado ao vivo, histórico próprio, troca de visualização, conversa, imagens e parada. Descubra capacidades; [guia de equipes](../agent-team-app-integration.md).
>
> v0.10.4: listas mantêm apenas títulos e pontos de corte para evitar timeouts em túneis com muitas sessões. Metadados e histórico completo preservados; clientes existentes não precisam mudar.
>
> v0.10.3: Connection Peer em chamadas Remote/assinaturas DSH 0.2.1-rc.2, corrige `Cannot read properties of undefined (reading 'signal')` e libera Peer ao parar. Protocolo móvel inalterado.
>
> v0.10.2: eventos de cartões e referências seguras, reutilizando download em blocos para cartões/links de arquivos. [Guia de cartões](../file-cards-mobile-integration.md).
>
> v0.10.1: voz oficial, preparo/estado do modelo, transcrição, cancelamento e limpeza. Usa speech Remote oficial sem incluir modelos ASR.
>
> v0.10.0: janela central responsiva ao tema do host, menus uniformes, destaque de conexão, diálogo QR animado separado, avisos de reinício dispensáveis por instância, dispositivos online por padrão e offline expansíveis, nomes e numeração de duplicados. Modo Tunnel aplicado automaticamente; parâmetros nomeados salvos explicitamente.
>
> v0.9.0: plugins DSH 0.2.0-rc.2, Tunnels Quick/nomeados com `cloudflared` verificado no cache privado, orientação LAN/pública, reinício do gateway e parada DSH Web sem nova aba.
>
> v0.7.3: espaçamento da seta do seletor de modo.
>
> v0.7.2: conexões conversa/controle separadas, sessões vazias, parar/continuar, fila editável com exclusão/Steer e arquivamento/renomeação bidirecionais.

## Protocolo e compatibilidade DSH

Clientes usam `dsh-mobile-v1`, não o Remote interno DSH. Um Host Adapter separado conecta ao Remote Gateway DSH 0.2.1-rc.2. Session, Workspace, Settings, Commands, Goals, Schedule, Permission Presets, Plugin Manager e parâmetros estritos ficam no adaptador. Quadros e interface: [integração RC2](../dsh-0.2.0-rc.2-plugin-management-mobile-integration.md).

Cada chamada Remote exige `peer`. `ctx.connection.createPeer()` cria um Peer de usuário local liberado com o plugin. O adaptador o injeta em solicitações, leituras iniciais e assinaturas; o móvel não define identidade. Perguntas/aprovações continuam nos listeners Host. Ausência causa `Cannot read properties of undefined (reading 'signal')`. Após atualizar DSH, reinstale este código e reinicie `dsh web`; sem alteração no protocolo do telefone.

Verifique no DSH oficial instalado: Gateway/Connection reais, serviços de teste, sem ler/escrever sessões do usuário:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
```

Autenticação e `dsh-mobile-v1` / `hello.protocol = 3` não mudam. Tokens ao vivo não consomem `seq` persistente. Assine `assistantStream: true` para `session-snapshot` atômico e deltas separados; `event` só contém eventos persistentes. Sem nova assinatura, apenas mensagens persistentes.

Histórico inclui `historyFormatVersion` e `cursor`. Ao trocar formato, limpe cache e reinstale a base. Paginação `beforeSeq` e fork `atSeq` exigem `historyFormatVersion: 4`.
Integração/aceitação: [guia rc.2](../dsh-rc2-mobile-integration.md). Migração anterior: [plano Remote Gateway](../remote-gateway-refactor-plan.md).

- WebSocket: `/ws/mobile`
- LAN: `ws://<局域网 IP>:3081/ws/mobile`
- Linux público: `wss://<公网 IP>/ws/mobile`
- Protocolo: [PROTOCOL.md](../../PROTOCOL.md)

Código atual permite consultar/alterar predefinição do Agent em sessão vazia até a primeira conversa. Descubra `session-agent-preset`; [guia do cliente](../session-agent-preset-app-integration.md). Interface exige integração; não publicado.

`turn-outline-v1` transmite estrutura completa dos turnos WebUI e atualizações para marcadores, prévias pergunta/resposta e saltos paginados sem todo o texto. Reconectar controle ou novo dispositivo restaura a base; sem estrutura Host, use turnos carregados. [Guia de navegação](../turn-outline-app-integration.md). Interface separada; não publicado.

`file-upload-v1`: clientes pareados enviam PDF, Office, arquivos compactados, áudio e outros em blocos pelo controle. Após SHA-256, armazenamento oficial e envio com credenciais da sessão. Progresso, cancelamento, limpeza e referências ao vivo/históricas; mesmas regras WebUI, sem caminhos de host escolhidos pelo cliente. Quadros, estados, limites e testes: [guia de envio](../file-upload-app-integration.md). Interface separada; não publicado.

`agent-team-v1` e `subagent-conversations-v1`: membros/tarefas, diretórios aninhados, projeção/estado ao vivo, histórico/assinaturas próprios, conversa e parada. Destinos, JSON, regras, troca/reconexão, erros e aceitação: [guia de equipes](../agent-team-app-integration.md). Capacidades do gateway; interface separada, não publicado.

## Vários gateways: primeira fase (código atual)

`gatewayId` estável, `gatewayName` configurável, endpoints candidatos e modos Desativado / Temporário / Permanente persistidos. Uma app pode parear várias máquinas; implemente gestão conforme o [guia](../multi-gateway-app-integration.md). Nenhuma nova versão npm publicada para esse código.

Permanente aceita dispositivos autorizados após reinícios. Requer DSH ativo, máquina acordada e rede acessível; sem descoberta automática ou retransmissão.

Exemplo de `config` do plugin:

```yaml
gatewayMode: persistent
gatewayName: 家里电脑
requireAuth: true
endpoints:
  - wss://gateway.example.com/ws/mobile
  - ws://192.168.1.10:3081/ws/mobile
```

Prioridade: **seleção salva na interface > `gatewayMode` > antigo `gatewayEnabled`**. Sem seleção, `gatewayEnabled: true` significa Permanente; false, Desativado.

- Desativado: desconecta imediatamente e permanece assim após reinício.
- Temporário: sem conexão bem-sucedida em 5 minutos, desativa e salva; após conectar permanece ativo nessa execução. Reinício reinicia espera. `gatewayWaitTimeoutMs`: 30 segundos a 30 minutos.
- Permanente: sem temporizador de ausência. QR continua expirando em 5 minutos por padrão; timeouts de arquivos não mudam.

Estado em `<deviceFile>.gateway.json`, normalmente `~/.dsh/mobile-gateway-devices.json.gateway.json`, ou `gatewayStateFile`. UUID v4 e preferências, permissões `0600`, troca atômica com arquivo temporário vizinho. Corrupção impede início sem regenerar identidade silenciosamente. Cada instância tem registro/estado próprios.

Preserve ambos ao atualizar/migrar. Para clone independente, não copie identidade/estado nem registro; gere identidade e pareie de novo. Não apague identidade em execução. Para configuração inicial: pare, faça backup, mude só `mode` para `null`, preserve `version`/`gatewayId` e reinicie.

`gatewayName`: até 80 caracteres, hostname por padrão. `endpoints`: até 16 extras, 2048 caracteres cada. Mescla preferidos, públicos e LAN; total acima de 16 gera erro. Todos devem alcançar o mesmo gateway pelo telefone; não use `0.0.0.0` / `::`. WSS em rede pública.

Testes/passos manuais: [aceitação](../multi-gateway-phase1-acceptance.md). Escopo: [lista multigateway](../multi-gateway-todo.md).

## Cliente associado Android e iOS

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile) é um cliente nativo de terceiros desenvolvido independentemente para este gateway. Android 7.0+ e iOS / iPadOS 16.1+, lógica Kotlin Multiplatform, interfaces Jetpack Compose e SwiftUI/UIKit. Espaços/sessões, conversa ao vivo, equipes/tarefas, envio/prévia de arquivos, seleção de texto, tabelas Markdown, histórico/cache, voz, aprovações e menus do servidor. iPhone Duo e telas amplas adaptam orientação/espaço; efeitos variam por sistema/aparelho. Downloads, configuração e capturas atuais no repositório do cliente.

> Capturas recentes de iOS: o conjunto 1.7.10 foi capturado em 22–23 de outubro de 2026; o conjunto iPhone Duo, em 26 de outubro de 2026. A interface está em chinês. [Fontes do produto](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/SOURCES.md) · [Fontes Duo](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/SOURCES.md).

### iPhone Duo: paisagem, retrato e navegação

<table>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp" alt="Início desdobrado em paisagem" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp" alt="Fundo do início em paisagem" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Início desdobrado em paisagem</strong></td>
    <td align="center"><strong>Fundo do início em paisagem</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp" alt="Configurações em paisagem" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp" alt="Conversa em paisagem" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Configurações em paisagem</strong></td>
    <td align="center"><strong>Conversa em paisagem</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp" alt="Barra lateral de navegação aberta" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp" alt="Início desdobrado em retrato" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Barra lateral de navegação aberta</strong></td>
    <td align="center"><strong>Início desdobrado em retrato</strong></td>
  </tr>
</table>

### Equipes, anexos e armazenamento local

<table>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp" alt="Membros da equipe de Agents" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp" alt="Tarefas compartilhadas da equipe" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp" alt="Seletor de arquivos e imagens" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Membros da equipe de Agents</strong></td>
    <td align="center"><strong>Tarefas compartilhadas da equipe</strong></td>
    <td align="center"><strong>Seletor de arquivos e imagens</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp" alt="Tela dedicada de seleção de texto" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp" alt="Arquivos em uma conversa" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp" alt="Notas de versão incluídas" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Tela dedicada de seleção de texto</strong></td>
    <td align="center"><strong>Arquivos em uma conversa</strong></td>
    <td align="center"><strong>Notas de versão incluídas</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp" alt="Armazenamento local e categorias de cache" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp" alt="Entrada de voz ao segurar" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp" alt="Arquivo anexado no editor" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Armazenamento local e categorias de cache</strong></td>
    <td align="center"><strong>Entrada de voz ao segurar</strong></td>
    <td align="center"><strong>Arquivo anexado no editor</strong></td>
  </tr>
</table>

## Instalar o plugin

Requer `dsh` CLI, `pnpm` e `dsh web` funcionando. Verifique `pnpm --version` com o usuário atual. O usuário deve conseguir executar `pnpm`.

Para LAN, instale:

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

Para IP público Linux, use inicialização unificada. Instala/atualiza plugin e pede sudo uma vez para Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`init` instala a versão exata do pacote npm executado no perfil DSH e ignora a espera pnpm somente para essa versão, alinhando plugin/Helper.

Pare e reinicie WebUI após instalação:

```bash
dsh web
```

Verifique Dispositivos móveis ao fim da barra lateral.

## Pareamento LAN

Computador DSH e móvel na mesma LAN com acesso mútuo.

1. Abra Dispositivos móveis no WebUI.
2. Escolha Permanente ou Temporário para pareamento breve.
3. Mantenha autenticação ativa.
4. Escolha LAN direta e confirme `ws://<电脑局域网 IP>:3081/ws/mobile`. Tunnel pode continuar ativo. Ajuda explica rotas/cenários sem trocar seleção.
5. Nomeie o dispositivo e gere QR.
6. Abra autenticação no cliente móvel e escaneie.
7. Conclui ao aparecer Online no WebUI.

Se o firewall bloquear, permita TCP `3081` só em rede privada. Não exponha 3081 publicamente.

## Pareamento por IP público Linux

> [!NOTE]
> IP público aqui significa servidor Linux. Desde `v0.6.4`, Ubuntu/Debian com IPv4 pública fixa e Node.js, `pnpm`, `dsh` CLI já instalados. CentOS não suportado.

### 1. Preparar portas

Copie IPv4 pública do provedor e libere entrada TCP `80`/`443`. Não exponha WebUI nem TCP `3081`.

### 2. Inicializar

Confirme `pnpm` com usuário comum DSH:

```bash
pnpm --version
```

Execute com esse usuário, sem `root` nem `sudo npx`:

```bash
npm_config_registry=https://registry.npmjs.org \
npx --yes dsh-plugin-mobile-gateway@latest init
```

Instala/atualiza plugin e pede sudo uma vez para Nginx, Certbot, Helper e temporizadores de renovação. `init` alinha versões exatas.

Inicie/reinicie WebUI:

```bash
dsh web
```

### 3. Abrir WebUI remoto

Prefira encaminhamento de portas VS Code/Cursor ou execute no computador local:

```bash
ssh -N -L <本地端口>:127.0.0.1:<DSH 实际端口> <服务器用户名>@<服务器公网 IP>
```

Abra no navegador local:

```text
http://127.0.0.1:<本地端口>
```

### 4. Configurar entrada pública

Em Dispositivos móveis → Acesso público, informe IPv4 do provedor e configure/atualize. Helper detecta porta `dsh web` e configura Nginx, TLS e `wss://<公网 IP>/ws/mobile`.

<p align="center">
  <img src="../assets/public-access-ui.jpg" alt="Configuração pública no painel de dispositivos" width="960">
</p>

### 5. Parear

1. Permita conexões móveis e mantenha autenticação.
2. Informe nome e gere QR.
3. Escaneie pela autenticação do telefone.
4. Verifique Online no WebUI.

QR de uso único, expira em 5 minutos; gere novamente se preciso.

## Acesso remoto Windows / macOS doméstico

Geralmente sem IP fixo; não se recomenda abrir portas do roteador. Quick Tunnel sem conta/domínio ou Tunnel nomeado fixo. Primeiro uso baixa/verifica `cloudflared` oficial no cache do usuário; sem serviço manual.

Inicie `dsh web`; mantenha computador acordado, online e DSH ativo. Suspensão/saída interrompem acesso.

### Cloudflare Quick Tunnel (temporário)

Padrão Automático · Priorizar LAN. Em Conexão e pareamento, mude para Priorizar público ou Cloudflare público; dica rosa indica configuração pendente. Escolha Quick Tunnel · Sem domínio e ative. Baixa `cloudflared` se necessário e usa `wss://<名称>.trycloudflare.com/ws/mobile`. Para LAN, volte a priorizar LAN ou LAN direta, sem desligar Tunnel. Gere/escaneie QR. Desligar interrompe o túnel; reiniciar DSH restaura Quick com **outro endereço aleatório**.

Sem conta, Token ou domínio; URL pode mudar ao reiniciar/reconectar. A app só aceita endereços confirmados: regenere e escaneie após mudar. **Computador online não garante URL antiga.** Quick visa testes/desenvolvimento, concorrência limitada, sem garantia de disponibilidade. [Documentação](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Atualizar salva modo/parâmetros; sem mudanças não reconecta. Reiniciar Tunnel interrompe conexões e recria túnel sem reiniciar DSH Web. Quick pode mudar URL e apagar QR; escaneie novamente. Não atualiza `cloudflared` automaticamente.

### Cloudflare Tunnel nomeado (fixo)

1. [Crie Tunnel gerenciado remotamente](https://developers.cloudflare.com/tunnel/get-started/), adicione `gateway.example.com`, **Service URL** `http://127.0.0.1:3082`. Sem serviço Cloudflare ou porta entrante no roteador.
2. Copie Token de Add a replica, escolha Tunnel nomeado · Domínio fixo, informe host/Token e ative. Modo Permanente, listener dedicado e `cloudflared`. Após registrar, verifica DNS/TLS/rota pública pela máquina; use `wss://gateway.example.com/ws/mobile` se aprovado.
3. `dsh web` restaura Tunnels ativos. Fechar Cloudflare Tunnel para processo/listener. Desligar manualmente gateway pausa; religar retoma. Também encerra o `cloudflared` gerenciado.

Só WebSocket `/ws/mobile`; outros caminhos, WebUI e `/mgw` retornam 404. Credenciais sempre exigidas mesmo com Debug local sem autenticação. Token em `<deviceFile>.cloudflare.json`, padrão `~/.dsh/mobile-gateway-devices.json.cloudflare.json`, permissões `0600`, nunca enviado ao navegador. Cache privado `cloudflared-bin`, sem binários de sistema/outras apps; verificado sempre, baixa versão fixa só se ausente/corrompido, com SHA-256 oficial. Externo só via `cloudflaredPath`. Mudar `cloudflarePort` exige atualizar Service URL. O `cloudflared` em cache é verificado ao iniciar.

#### Verificação pública e estado

`state: online` indica só registro do túnel, não domínio/TLS/rota. Inclui `endpointHealth` (estado, dica, hora, erro) e `publicReady`. Verifica após conectar e permite repetir DNS/TLS/WebSocket via `POST /mgw/cloudflare/check` com autenticação de gestão, sem reinício.

DNS do sistema, HTTPS WebSocket com certificado estrito, sem tokens/redirecionamentos. Só 401 com eco do marcador aleatório confirma rota protegida; 401 genérico proxy/Access não basta. Marcador apenas em recusas sem credenciais válidas, sem conceder acesso. Retrato local, não garante rede móvel, autenticação ou sincronização.

Falha DNS local não prova ausência pública: NXDOMAIN em cache, DNS, VPN ou proxy podem afetar. Confira host/CNAME com proxy e tente depois; não desative TLS. Token executa Tunnel remoto sem criar DNS/rotas. CLI/API com autorização adicional podem fazê-lo fora desta verificação.

### Tailscale (uso contínuo)

1. Instale [Tailscale](https://tailscale.com/download) no computador/móvel, no mesmo Tailnet.
2. Execute no PowerShell ou terminal macOS:

```bash
tailscale serve --bg 3081
```

3. Veja `tailscale serve status` para `https://<设备名>.<tailnet>.ts.net`.
4. Use `wss://<设备名>.<tailnet>.ts.net/ws/mobile` no WebUI e gere QR.

Serve permite só dispositivos autorizados no Tailnet e fornece HTTPS. Pare com `tailscale serve reset`. [Documentação](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Opções de conexão

| Cenário | Entrada | Endereço WebSocket móvel | Configuração | Portas e autenticação |
|---|---|---|---|---|
| Mesma LAN | Listener do plugin | `ws://<电脑局域网 IP>:3081/ws/mobile` | Sem Helper/Nginx; acesso mútuo | TCP privado `3081`; autenticação |
| Simulador iOS local | WebUI local | `ws://127.0.0.1:<DSH WebUI 端口>/ws/mobile` | Sem Helper/Nginx ou `3081` separado | Sem portas externas; desativar só Debug |
| Linux público | Helper + Nginx + TLS | `wss://<服务器公网 IPv4>/ws/mobile` | `init`, IPv4 no WebUI | TCP `80/443`; não expor DSH/`3081`; autenticação |
| Windows / macOS doméstico | Tunnel nomeado | `wss://<公开域名>/ws/mobile` | Rota a `127.0.0.1:3082`; host/Token | Sem portas do roteador; autenticação |
| Windows / macOS doméstico | Quick Tunnel | `wss://<随机名称>.trycloudflare.com/ws/mobile` | Ativar; escanear após URL mudar | Sem conta/domínio/portas; autenticação |
| Windows / macOS doméstico | Tailscale Serve | `wss://<Tailscale 域名>/ws/mobile` | Encaminhar `127.0.0.1:3081`; URL no WebUI | Sem portas do roteador; autenticação |

## Gerenciar acesso público Linux

Consultar estado:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

Remover acesso público:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## Atualizar

Repita inicialização para atualizar plugin e Helper:

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

Pare e reinicie `dsh web`.

## Desinstalar

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

Para remover também Helper, mantendo Nginx:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove-helper
```

## Solução de problemas

| Sintoma | Ação |
|---|---|
| Sem Dispositivos móveis | Instalar no perfil `web`, reiniciar `dsh web` |
| Cliente recebe `503` | Habilitar conexões no WebUI |
| Cliente recebe `401` | Regenerar QR e parear |
| Timeout Linux público | Conferir segurança, firewall e TCP `80/443` |
| Sem endereço Linux | Informar IPv4 pública e atualizar |
| Falha download Cloudflare | Verificar GitHub Releases ou instalar cloudflared e definir `cloudflaredPath` absoluto |
| Quick falha após reinício | Regenerar/escanear; Tunnel nomeado para URL fixa |
| Quick com configuração prévia | Não compartilha diretório com `~/.cloudflared/config.yaml`; ver erros e [guia oficial](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Tunnel online mas app falha | Conferir Service URL `http://127.0.0.1:<端口>`, DNS e credenciais |
| Logs do servidor | `mobile-gateway.log` em temporários: Windows `%TEMP%`, macOS `$TMPDIR`, Linux geralmente `/tmp` |

## Desenvolvimento do código

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

Ferramentas oferece Reiniciar gateway e Parar DSH Web. Reinício só ao iniciar por `dsh web`, preserva argumentos e adiciona `--no-open`; a aba espera e recarrega. Novo processo em segundo plano, fora da tarefa do terminal original. Pare por menu ou `SIGTERM` ao DSH da porta Web. Conexões interrompidas brevemente e URL Quick pode mudar. Reinstale/reinicie após mudanças. Reinicie `dsh web` ao terminar.


## Integração de voz oficial

Plugin experimental oficial DSH 0.2.0-rc.2: listar reconhecedores, preparar/acompanhar modelos, preferências e transcrição. Cancelar/desconectar aborta; não envia automaticamente ao Agent.

1. Ative Entrada de voz (`@deepseek-ai/dsh-experimental-voice-input-bundle`) e baixe/prepare modelo.
2. Consulte `speech-catalog` pelo controle pareado; confira disponibilidade e `ready`/`standby`.
3. Converta gravação completa em WAV PCM16 mono 16 kHz e envie Base64 por `speech-transcribe`.
4. Insira `speech-transcript` no editor; envie `message` após confirmação.

Modelos no computador DSH, sem pesos no telefone. Só gravações completas; cliente deve integrar botões, permissões e conversão. [Protocolo](../../PROTOCOL.md#官方语音输入speech-input-v1).

Verifique WAV no plugin oficial instalado, Provider de teste e sem baixar modelos:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
```
