[English](../../README.md) · [简体中文](../../README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Español](README.es.md) · **Français** · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

> Certains documents détaillés de protocole et d’intégration sont actuellement en chinois uniquement.

<p align="center">
  <img src="../assets/whale-girl-ios-app-promo-16x9.png" alt="Whaleness et Mobile Gateway" width="100%">
</p>

# dsh-plugin-mobile-gateway

Passerelle mobile tierce pour DeepSeek Harness avec authentification des appareils. Sessions et événements en direct, messages en attente avec édition/suppression/Steer, archivage et renommage bidirectionnels, arrêt/reprise de génération, tâches et Goal courant, menus de commandes et compétences fournis par le serveur, intervention humaine, images et fichiers. L’installation ajoute Appareils mobiles dans WebUI pour activer la passerelle, générer les QR et gérer les appareils approuvés.

> Le code actuel cible **DSH 0.2.1-rc.2**, nécessite Connection Peer et utilise Session format 4. Les anciens curseurs d’historique nécessitent une nouvelle base.
>
> Le flux utilise des trames `assistant-stream` séparées. Adaptez abonnements, caches et pagination au [guide rc.2](../dsh-rc2-mobile-integration.md). Ces modifications ne sont pas encore publiées.
>
> v0.11.1 (code actuel, non publié) : envoi de fichiers par blocs, vérification SHA-256, accusés de progression, annulation et nettoyage à la déconnexion. Réutilise le stockage officiel des pièces jointes DSH et les identifiants propres à la session pour les fichiers et références en direct/historiques. Intégrer `file-upload-v1` ; voir le [guide d’envoi](../file-upload-app-integration.md).
>
> v0.11.0 : équipes et conversations de sous-agents, membres, tableaux partagés, répertoires imbriqués, état en direct, historique indépendant, changement de vue, conversation, images et arrêt. Découvrir les capacités ; voir le [guide des équipes](../agent-team-app-integration.md).
>
> v0.10.4 : les listes ne gardent que titres et points de coupe des projections afin d’éviter les délais sur tunnels avec de nombreuses sessions. Métadonnées et projections complètes de l’historique conservées ; aucun changement client nécessaire.
>
> v0.10.3 : Connection Peer pour Remote et abonnements DSH 0.2.1-rc.2, correction de `Cannot read properties of undefined (reading 'signal')`, libération du Peer à l’arrêt. Protocole mobile inchangé.
>
> v0.10.2 : événements de cartes de fichiers et résolution sécurisée des références, avec téléchargements par blocs pour cartes et liens de fichiers. [Guide des cartes](../file-cards-mobile-integration.md).
>
> v0.10.1 : saisie vocale officielle, préparation/état du modèle, transcription, annulation et nettoyage à la déconnexion. Utilise speech Remote officiel, sans modèles ASR intégrés.
>
> v0.10.0 : fenêtre centrée adaptative au thème, menus uniformes et état de connexion mis en évidence, dialogue QR animé distinct, rappel de redémarrage masquable par instance, appareils en ligne par défaut et hors ligne dépliables, noms et numérotation des doublons. Mode Tunnel appliqué automatiquement ; paramètres nommés enregistrés explicitement.
>
> v0.9.0 : gestion des plugins DSH 0.2.0-rc.2, contrôle Quick/named Tunnel avec `cloudflared` vérifié en cache privé, aide LAN/publique, redémarrage passerelle et arrêt DSH Web sans nouvel onglet.
>
> v0.7.3 : espacement de la flèche du sélecteur de mode.
>
> v0.7.2 : connexions conversation/contrôle distinctes, sessions vides, arrêt/reprise, file avec édition/suppression/Steer, archivage et renommage bidirectionnels.

## Protocole et compatibilité DSH

Le client utilise `dsh-mobile-v1`, pas le Remote interne DSH. Un Host Adapter distinct rejoint Remote Gateway DSH 0.2.1-rc.2 ; espaces Session, Workspace, Settings, Commands, Goals, Schedule, Permission Presets, Plugin Manager et paramètres stricts restent dans cet adaptateur. Trames et interface : [intégration RC2](../dsh-0.2.0-rc.2-plugin-management-mobile-integration.md).

Tout appel Remote DSH 0.2.1-rc.2 exige `peer`. `ctx.connection.createPeer()` crée un Peer utilisateur local libéré avec le plugin. Host Adapter l’injecte dans requêtes, lectures initiales et abonnements ; le mobile ne choisit pas l’identité. Questions/approbations restent gérées par les listeners Host. Son absence provoque `Cannot read properties of undefined (reading 'signal')`. Après mise à jour DSH, réinstallez ce code et relancez `dsh web` ; protocole du téléphone inchangé.

Vérifiez avec DSH officiel installé : Gateway/Connection réels, services métier de test, aucune lecture/écriture des sessions utilisateur :

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
```

Authentification et `dsh-mobile-v1` / `hello.protocol = 3` inchangés. Les tokens en direct ne consomment plus le `seq` persistant. Abonnez-vous avec `assistantStream: true` pour recevoir `session-snapshot` atomique et deltas séparés. `event` ne contient que les événements persistants ; sans nouvel abonnement seuls les messages persistants arrivent.

L’historique comprend `historyFormatVersion` et `cursor`. Au changement de format, videz le cache et réinstallez la base. Pagination `beforeSeq` et fork `atSeq` doivent envoyer `historyFormatVersion: 4`.
Intégration et validation : [guide rc.2](../dsh-rc2-mobile-integration.md). Ancienne migration : [plan Remote Gateway](../remote-gateway-refactor-plan.md).

- WebSocket : `/ws/mobile`
- LAN : `ws://<局域网 IP>:3081/ws/mobile`
- Serveur Linux public : `wss://<公网 IP>/ws/mobile`
- Protocole : [PROTOCOL.md](../../PROTOCOL.md)

Le code ajoute le choix du mode de session : consulter/modifier le préréglage Agent d’une session vide jusqu’à la première conversation. Découvrir `session-agent-preset` et suivre le [guide client](../session-agent-preset-app-integration.md). Interface à intégrer ; non publié.

`turn-outline-v1` transmet le plan complet des tours WebUI et ses mises à jour pour afficher repères, aperçus questions/réponses et navigation paginée sans tout charger. Reconnexion du contrôle ou nouvel appareil restaure la base ; sans plan Host, utiliser les tours chargés. [Guide de navigation](../turn-outline-app-integration.md). Interface séparée ; non publié.

`file-upload-v1` envoie PDF, Office, archives, audio et autres fichiers par blocs sur le contrôle appairé. Après SHA-256, stockage officiel puis envoi avec identifiants de session. Progression, annulation, nettoyage et références en direct/historiques ; mêmes règles d’admission que WebUI, jamais un chemin hôte choisi par le client. Trames, états, limites et validation : [guide d’envoi](../file-upload-app-integration.md). Interface séparée ; non publié.

`agent-team-v1` et `subagent-conversations-v1` : membres, tableaux, répertoires imbriqués, projections/états en direct, historiques/abonnements indépendants, conversation et arrêt. Adresses, JSON, règles, changement/reconnexion, erreurs et validation : [guide des équipes](../agent-team-app-integration.md). Capacités passerelle ; interface séparée, non publié.

## Plusieurs passerelles : phase un (code actuel)

`gatewayId` stable, `gatewayName` configurable, adresses candidates et modes Désactivé / Temporaire / Permanent persistants. Une application peut appairer plusieurs machines ; sa gestion doit suivre le [guide](../multi-gateway-app-integration.md). Aucune nouvelle version npm publiée pour ce code.

Permanent accepte les appareils autorisés après redémarrage. Nécessite DSH actif, hôte éveillé et réseau accessible ; ni découverte automatique ni relais réseau.

Exemple de `config` du plugin :

```yaml
gatewayMode: persistent
gatewayName: 家里电脑
requireAuth: true
endpoints:
  - wss://gateway.example.com/ws/mobile
  - ws://192.168.1.10:3081/ws/mobile
```

Priorité : **choix UI enregistré > `gatewayMode` > ancien `gatewayEnabled`**. Sans choix, `gatewayEnabled: true` signifie Permanent ; false, Désactivé.

- Désactivé : déconnexion immédiate, état conservé au redémarrage.
- Temporaire : sans connexion réussie sous 5 minutes, désactive et enregistre cet état ; après connexion reste actif pour cette exécution. Un redémarrage relance l’attente. `gatewayWaitTimeoutMs` : 30 secondes à 30 minutes.
- Permanent : pas de minuterie sans appareil. QR toujours valable 5 minutes par défaut ; délais de fichiers inchangés.

État : `<deviceFile>.gateway.json`, normalement `~/.dsh/mobile-gateway-devices.json.gateway.json`, configurable via `gatewayStateFile`. UUID v4, préférences, permissions `0600`, remplacement atomique par fichier temporaire voisin. Une corruption bloque le démarrage sans identité silencieusement renouvelée. Chaque instance a son registre et son état.

Conservez les deux fichiers lors d’une migration/mise à jour. Pour cloner une passerelle indépendante, ne copiez ni identité/état ni registre ; générez une identité et réappairez. Ne supprimez pas l’identité en exécution. Pour reprendre la configuration initiale, arrêtez, sauvegardez, changez seulement `mode` en `null`, conservez `version` et `gatewayId`, puis relancez.

`gatewayName` : 80 caractères maximum, nom d’hôte par défaut. `endpoints` : 16 adresses supplémentaires de 2048 caractères maximum. Adresses préférées, publiques et LAN ajoutées ; total supérieur à 16 refusé. Toutes doivent joindre la même passerelle depuis le téléphone ; ni `0.0.0.0` / `::`. WSS pour le public.

Tests et étapes manuelles : [rapport de validation](../multi-gateway-phase1-acceptance.md). Périmètre : [liste multi-passerelle](../multi-gateway-todo.md).

## Client associé Android et iOS

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile) est un client natif tiers développé indépendamment pour cette passerelle. Android 7.0+ et iOS / iPadOS 16.1+, logique Kotlin Multiplatform, interfaces Jetpack Compose et SwiftUI/UIKit. Espaces/sessions, conversations en direct, équipes/tâches partagées, envoi/aperçu de fichiers, sélection de texte, tableaux Markdown, historique/cache, voix, approbations et menus serveur. Les dispositions iPhone Duo/grand écran s’adaptent à l’orientation et à l’espace ; effets selon système/appareil. Téléchargements, guide et captures actuelles dans son dépôt.

> Captures iOS récentes : le lot 1.7.10 date des 22–23 octobre 2026 et les captures iPhone Duo du 26 octobre 2026. L’interface est en chinois. [Sources du produit](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/SOURCES.md) · [Sources Duo](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/SOURCES.md).

### iPhone Duo : paysage, portrait et navigation

<table>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp" alt="Accueil déplié en paysage" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp" alt="Fond d’accueil en paysage" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Accueil déplié en paysage</strong></td>
    <td align="center"><strong>Fond d’accueil en paysage</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp" alt="Réglages en paysage" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp" alt="Conversation en paysage" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Réglages en paysage</strong></td>
    <td align="center"><strong>Conversation en paysage</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp" alt="Barre latérale de navigation ouverte" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp" alt="Accueil déplié en portrait" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Barre latérale de navigation ouverte</strong></td>
    <td align="center"><strong>Accueil déplié en portrait</strong></td>
  </tr>
</table>

### Équipes, pièces jointes et stockage local

<table>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp" alt="Membres de l’équipe d’Agents" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp" alt="Tâches partagées de l’équipe" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp" alt="Sélecteur de fichiers et d’images" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Membres de l’équipe d’Agents</strong></td>
    <td align="center"><strong>Tâches partagées de l’équipe</strong></td>
    <td align="center"><strong>Sélecteur de fichiers et d’images</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp" alt="Écran de sélection de texte" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp" alt="Fichiers dans une conversation" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp" alt="Notes de version intégrées" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Écran de sélection de texte</strong></td>
    <td align="center"><strong>Fichiers dans une conversation</strong></td>
    <td align="center"><strong>Notes de version intégrées</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp" alt="Stockage local et catégories du cache" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp" alt="Saisie vocale par appui prolongé" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp" alt="Fichier joint dans la zone de saisie" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Stockage local et catégories du cache</strong></td>
    <td align="center"><strong>Saisie vocale par appui prolongé</strong></td>
    <td align="center"><strong>Fichier joint dans la zone de saisie</strong></td>
  </tr>
</table>

## Installer le plugin

Prévoir `dsh` CLI, `pnpm` et `dsh web` fonctionnel. Vérifiez `pnpm --version` avec l’utilisateur courant. L’utilisateur doit pouvoir appeler `pnpm`.

Pour le LAN, installez le plugin :

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

Pour une IP publique Linux, utilisez l’initialiseur unifié : installation/mise à jour puis demande sudo unique pour le Helper :

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`init` installe la version exacte du paquet npm exécuté dans le profil DSH et ignore l’attente des nouvelles versions pnpm pour cette seule version, alignant plugin et Helper.

Arrêtez puis relancez WebUI après installation :

```bash
dsh web
```

Vérifiez Appareils mobiles en bas de la barre latérale.

## Appairage LAN

Pour l’ordinateur DSH et le mobile sur un LAN mutuellement accessible.

1. Ouvrez Appareils mobiles dans WebUI.
2. Choisissez Permanent ou Temporaire pour un appairage bref.
3. Gardez l’authentification activée.
4. Choisissez LAN direct et vérifiez `ws://<电脑局域网 IP>:3081/ws/mobile`. Le Tunnel peut rester actif. L’aide explique les routes et usages sans changer la sélection.
5. Nommez l’appareil et générez le QR.
6. Scannez dans l’authentification du client mobile.
7. Terminé quand WebUI indique En ligne.

Si le pare-feu bloque, autorisez TCP `3081` seulement sur réseaux privés. Ne publiez pas 3081.

## Appairage par IP publique Linux

> [!NOTE]
> Ici, IP publique désigne un serveur Linux. Depuis `v0.6.4`, installation unifiée pour Ubuntu/Debian avec IPv4 publique fixe, Node.js, `pnpm` et `dsh` CLI déjà installés. CentOS non pris en charge.

### 1. Préparer les ports

Copiez l’IPv4 publique du fournisseur et autorisez TCP entrant `80` et `443`. Ne publiez ni WebUI ni TCP `3081`.

### 2. Initialiser

Vérifiez `pnpm` avec l’utilisateur DSH ordinaire :

```bash
pnpm --version
```

Exécutez avec ce même utilisateur, sans `root` ni `sudo npx` :

```bash
npm_config_registry=https://registry.npmjs.org \
npx --yes dsh-plugin-mobile-gateway@latest init
```

Installation/mise à jour du plugin, sudo unique pour Nginx, Certbot, Helper et minuteries de renouvellement. `init` aligne les versions exactes.

Lancez ou relancez WebUI :

```bash
dsh web
```

### 3. Ouvrir WebUI distant

Préférez le transfert de ports de VS Code/Cursor ou exécutez sur votre ordinateur :

```bash
ssh -N -L <本地端口>:127.0.0.1:<DSH 实际端口> <服务器用户名>@<服务器公网 IP>
```

Ouvrez localement :

```text
http://127.0.0.1:<本地端口>
```

### 4. Configurer l’accès public

Dans Appareils mobiles → Accès public, entrez l’IPv4 du fournisseur puis configurez/actualisez. Le Helper détecte le port `dsh web` et configure Nginx, TLS et `wss://<公网 IP>/ws/mobile`.

<p align="center">
  <img src="../assets/public-access-ui.jpg" alt="Configuration de l’accès public dans le panneau" width="960">
</p>

### 5. Appairer

1. Autorisez les connexions mobiles et gardez l’authentification.
2. Nommez l’appareil et générez le QR.
3. Scannez depuis le téléphone.
4. Vérifiez En ligne dans WebUI.

QR à usage unique, expiration après 5 minutes ; régénérez si nécessaire.

## Accès distant Windows / macOS domestique

Sans IP fixe généralement : pas de redirection de ports routeur recommandée. Quick Tunnel sans compte/domaine ou Tunnel nommé à domaine fixe. Premier usage : téléchargement/vérification du `cloudflared` officiel dans le cache utilisateur ; aucun service système manuel requis.

Lancez `dsh web`. L’ordinateur doit rester éveillé, connecté et DSH actif ; veille ou arrêt coupe l’accès.

### Cloudflare Quick Tunnel (temporaire)

Par défaut Automatique · Priorité LAN. Dans Appareils mobiles → Connexion et appairage, choisissez Priorité public ou Cloudflare public ; une aide rose indique la configuration manquante. Choisissez Quick Tunnel · Sans domaine et activez. Télécharge `cloudflared` au besoin et utilise `wss://<名称>.trycloudflare.com/ws/mobile`. Pour le LAN, revenez à Priorité LAN ou LAN direct sans arrêter le Tunnel. Générez/scannez le QR. Désactiver arrête le Tunnel ; redémarrer DSH restaure Quick avec **une nouvelle adresse aléatoire**.

Ni compte, Token ni domaine Cloudflare requis ; l’URL peut changer après redémarrage/reconnexion. L’application n’accepte que les adresses confirmées : régénérez et scannez après changement. **Un ordinateur en ligne ne garantit pas l’ancienne URL.** Quick Tunnel vise tests/développement, concurrence limitée et aucune disponibilité garantie. [Documentation](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

Mettre à jour enregistre mode/paramètres, sans reconnexion si inchangés. Redémarrer Tunnel interrompt les connexions et recrée le tunnel sans redémarrer DSH Web ; Quick peut changer URL et effacer l’ancien QR, donc rescanner. N’actualise pas automatiquement `cloudflared`.

### Cloudflare Tunnel nommé (adresse fixe)

1. [Créez un Tunnel géré à distance](https://developers.cloudflare.com/tunnel/get-started/), ajoutez `gateway.example.com` et **Service URL** `http://127.0.0.1:3082`. Ni service Cloudflare ni port entrant du routeur.
2. Copiez le Token Add a replica, choisissez Tunnel nommé · Domaine fixe, saisissez hôte/Token et activez. Mode Permanent, listener dédié et `cloudflared`. Après enregistrement, vérifie DNS, TLS et route publique depuis l’hôte ; générez un QR avec `wss://gateway.example.com/ws/mobile` après réussite.
3. `dsh web` restaure les Tunnels activés. Fermer Cloudflare Tunnel arrête processus/listener. Désactiver manuellement la passerelle met en pause ; réactiver reprend. Le `cloudflared` géré est également arrêté.

Seul WebSocket `/ws/mobile` est accepté ; autres chemins, WebUI et `/mgw` renvoient 404. Identifiants toujours requis même si Debug local désactive l’authentification. Token dans `<deviceFile>.cloudflare.json` (défaut `~/.dsh/mobile-gateway-devices.json.cloudflare.json`), permissions `0600`, jamais renvoyé au navigateur. Cache privé `cloudflared-bin`, sans binaires système/autres apps ; vérifié à chaque lancement, téléchargement de version fixe seulement si absent/corrompu avec SHA-256 officiel. Binaire externe seulement via `cloudflaredPath`. Modifier `cloudflarePort` exige d’adapter Service URL. Le `cloudflared` en cache est vérifié au démarrage.

#### Vérification publique et état

`state: online` confirme seulement l’enregistrement du tunnel, pas domaine/TLS/route. `endpointHealth` (état, aide, date, erreur) et `publicReady` le complètent. Vérification après connexion et bouton DNS/TLS/WebSocket via `POST /mgw/cloudflare/check` authentifié, sans redémarrage.

DNS système, HTTPS WebSocket avec certificats stricts, sans tokens ni redirections. Seul 401 avec écho du marqueur aléatoire prouve la route protégée ; 401 générique proxy/Access insuffisant. Marqueur uniquement dans les refus sans identifiants valides, sans accorder d’accès. Instantané local, aucune garantie pour réseau mobile, authentification ou synchronisation.

Échec DNS local ≠ absence d’enregistrement public : NXDOMAIN en cache, DNS, VPN ou proxy possibles. Vérifiez hôte/CNAME avec proxy puis réessayez ; ne désactivez pas TLS. Le Token exécute les Tunnels distants sans créer DNS/routes. CLI/API séparément autorisés peuvent le faire, hors de cette vérification.

### Tailscale (usage durable)

1. Installez [Tailscale](https://tailscale.com/download) sur ordinateur/mobile, dans le même Tailnet.
2. Exécutez dans PowerShell ou terminal macOS :

```bash
tailscale serve --bg 3081
```

3. Consultez `tailscale serve status` pour `https://<设备名>.<tailnet>.ts.net`.
4. Utilisez `wss://<设备名>.<tailnet>.ts.net/ws/mobile` dans WebUI et générez le QR.

Serve n’accepte que les appareils autorisés du Tailnet et fournit HTTPS. Arrêt : `tailscale serve reset`. [Documentation](https://tailscale.com/docs/reference/tailscale-cli/serve).

## Options de connexion

| Scénario | Entrée | Adresse WebSocket mobile | Configuration | Ports et authentification |
|---|---|---|---|---|
| Même LAN | Listener du plugin | `ws://<电脑局域网 IP>:3081/ws/mobile` | Sans Helper/Nginx ; accès mutuel | TCP privé `3081` ; authentification |
| Simulateur iOS local | WebUI local | `ws://127.0.0.1:<DSH WebUI 端口>/ws/mobile` | Sans Helper/Nginx ni port `3081` séparé | Aucun port externe ; désactivation seulement Debug |
| Linux public | Helper + Nginx + TLS | `wss://<服务器公网 IPv4>/ws/mobile` | `init`, IPv4 dans WebUI | TCP `80/443` ; pas DSH/`3081` ; authentification |
| Windows / macOS domestique | Tunnel nommé | `wss://<公开域名>/ws/mobile` | Route vers `127.0.0.1:3082` ; hôte/Token | Aucun transfert routeur ; authentification |
| Windows / macOS domestique | Quick Tunnel | `wss://<随机名称>.trycloudflare.com/ws/mobile` | Activer ; rescanner après changement | Sans compte/domaine/transfert ; authentification |
| Windows / macOS domestique | Tailscale Serve | `wss://<Tailscale 域名>/ws/mobile` | Transfert vers `127.0.0.1:3081` ; URL WebUI | Aucun transfert routeur ; authentification |

## Gérer l’accès public Linux

Consulter l’état :

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

Supprimer l’accès public :

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## Mettre à jour

Relancez l’initialisation pour le plugin et le Helper :

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

Arrêtez et relancez `dsh web`.

## Désinstaller

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

Pour supprimer aussi le Helper, en conservant la configuration Nginx :

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove-helper
```

## Dépannage

| Symptôme | Action |
|---|---|
| Pas d’Appareils mobiles | Installer dans `web`, relancer complètement `dsh web` |
| Client reçoit `503` | Activer les connexions WebUI |
| Client reçoit `401` | Régénérer le QR et appairer |
| Délai Linux public | Vérifier sécurité, pare-feu et TCP `80/443` |
| Pas d’adresse Linux | Entrer IPv4 dans Accès public et actualiser |
| Échec téléchargement Cloudflare | Vérifier GitHub Releases ou installer cloudflared et définir `cloudflaredPath` absolu |
| Échec après redémarrage Quick | Régénérer/scanner ; Tunnel nommé pour URL fixe |
| Quick et configuration existante | Incompatible avec répertoire contenant `~/.cloudflared/config.yaml` ; voir erreurs et [guide officiel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) |
| Connecté mais inaccessible | Vérifier Service URL `http://127.0.0.1:<端口>`, DNS et identifiants |
| Journaux serveur | `mobile-gateway.log` dans temporaires : Windows `%TEMP%`, macOS `$TMPDIR`, Linux généralement `/tmp` |

## Développement source

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

Outils propose Redémarrer passerelle et Arrêter DSH Web. Redémarrage uniquement après lancement par `dsh web`, arguments conservés plus `--no-open` ; l’onglet attend et recharge. Nouveau processus en arrière-plan, hors tâche du terminal initial. Arrêter par menu ou `SIGTERM` au processus DSH du port Web. Connexions coupées brièvement et URL Quick potentiellement changée. Réinstaller/relancer après modification. Relancez ensuite `dsh web`.


## Intégration de la voix officielle

Plugin expérimental officiel DSH 0.2.0-rc.2 : répertorier les moteurs, préparer/suivre modèles, régler préférences et transcrire. Annulation/déconnexion interrompt ; aucun envoi automatique à l’Agent.

1. Activez Saisie vocale (`@deepseek-ai/dsh-experimental-voice-input-bundle`), téléchargez/préparez le modèle.
2. Consultez `speech-catalog` par contrôle appairé ; disponibilité et `ready`/`standby`.
3. Convertissez l’enregistrement complet en WAV PCM16 mono 16 kHz puis Base64 via `speech-transcribe`.
4. Insérez `speech-transcript` dans la saisie ; envoyez `message` après confirmation.

Modèle sur ordinateur DSH, aucun poids sur téléphone. Transcription d’enregistrements complets seulement ; boutons, permissions et conversion à intégrer. [Protocole](../../PROTOCOL.md#官方语音输入speech-input-v1).

Vérifiez WAV avec plugin officiel installé, Provider de test et sans téléchargement de modèle :

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
```
