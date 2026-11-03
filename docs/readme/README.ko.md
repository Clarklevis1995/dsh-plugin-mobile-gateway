[English](../../README.md) · [简体中文](../../README.zh-CN.md) · [日本語](README.ja.md) · **한국어** · [Español](README.es.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · [Português (Brasil)](README.pt-BR.md)

> 일부 상세 프로토콜·통합 문서는 현재 중국어로만 제공됩니다.

<p align="center">
  <img src="../assets/whale-girl-ios-app-promo-16x9.png" alt="Whaleness와 Mobile Gateway" width="100%">
</p>

# dsh-plugin-mobile-gateway

기기 인증을 지원하는 DeepSeek Harness 서드파티 모바일 게이트웨이입니다. 세션·실시간 이벤트, 대기 메시지 동기화·편집·삭제·Steer, 세션 양방향 보관·이름 변경, 생성 중지·재개, 작업과 현재 Goal, 서버 기반 명령·스킬 메뉴, 사용자 질문·승인, 이미지·파일 전송을 지원합니다. 설치하면 WebUI 사이드바에 모바일 기기가 추가되어 게이트웨이 활성화, QR 생성, 신뢰 기기 관리를 할 수 있습니다.

> 현재 코드는 **DSH 0.2.1-rc.2**, Connection Peer, Session format 4를 기준으로 합니다. 이전 기록 커서는 기준 데이터를 다시 받아야 합니다.
>
> 스트림이 독립 `assistant-stream` 프레임으로 변경되었습니다. [rc.2 가이드](../dsh-rc2-mobile-integration.md)에 따라 구독·캐시·페이지 처리를 수정하세요. 아직 배포되지 않았습니다.
>
> v0.11.1(현재 코드, 미배포): 파일 청크 업로드, SHA-256, 진행 확인, 취소, 연결 종료 정리. 공식 DSH 첨부 저장소와 세션별 인증 정보를 재사용하여 메시지 첨부와 실시간·기록 파일 참조를 지원합니다. `file-upload-v1`을 구현하고 [업로드 가이드](../file-upload-app-integration.md)를 참고하세요.
>
> v0.11.0: Agent 팀과 하위 대화, 멤버, 공유 작업, 중첩 디렉터리, 실시간 상태, 개별 기록, 보기 전환, 대화 지속, 이미지, 중지를 지원합니다. 기능 탐색과 [팀 가이드](../agent-team-app-integration.md)를 따르세요.
>
> v0.10.4: 목록은 제목과 프로젝션 경계만 유지하여 많은 세션의 공개 터널 시간 초과를 개선합니다. 메타데이터와 전체 기록은 유지하며 기존 클라이언트 변경은 필요 없습니다.
>
> v0.10.3: DSH 0.2.1-rc.2 Remote·구독에 Connection Peer를 전달하여 `Cannot read properties of undefined (reading 'signal')`를 수정하고 중지 시 Peer를 해제합니다. 모바일 프로토콜은 같습니다.
>
> v0.10.2: 파일 카드 이벤트와 안전한 참조 해석, 기존 청크 다운로드를 통한 카드·본문 링크 미리보기. [파일 카드 가이드](../file-cards-mobile-integration.md).
>
> v0.10.1: 공식 음성 입력, 모델 준비·상태, 변환, 취소·연결 종료 정리. 공식 speech Remote를 사용하며 ASR 모델을 포함하지 않습니다.
>
> v0.10.0: 호스트 테마를 따르는 중앙 반응형 창, 통일 메뉴·연결 강조, 독립 QR 애니메이션 창, 인스턴스별 숨길 수 있는 재시작 안내. 기본 온라인 기기와 펼칠 수 있는 오프라인 목록, 기기명·중복 번호. Tunnel 모드는 즉시 적용하고 이름 있는 설정은 저장합니다.
>
> v0.9.0: DSH 0.2.0-rc.2 플러그인 관리, 전용 캐시의 검증된 `cloudflared`로 Quick/이름 있는 Tunnel 제어, LAN·외부 안내, 새 탭 없는 재시작·DSH Web 중지.
>
> v0.7.3: 모드 메뉴 화살표 간격 조정.
>
> v0.7.2: 대화·제어 별도 연결, 빈 세션, 중지·재개, 대기 메시지 편집·삭제·Steer, 양방향 보관·이름 변경.

## 프로토콜과 DSH 호환 계층

모바일은 내부 Remote가 아닌 `dsh-mobile-v1`을 사용합니다. 별도 Host Adapter가 DSH 0.2.1-rc.2 Remote Gateway에 연결하고 Session, Workspace, Settings, Commands, Goals, Schedule, Permission Presets, Plugin Manager와 엄격한 매개변수는 그 안에만 둡니다. 프레임·화면 설계는 [RC2 가이드](../dsh-0.2.0-rc.2-plugin-management-mobile-integration.md)를 참고하세요.

모든 Remote 호출에 `peer`가 필요합니다. `ctx.connection.createPeer()`로 로컬 사용자 Peer를 만들어 플러그인 종료 때 해제합니다. Adapter가 요청·첫 읽기·구독에 주입하며 모바일은 호출자 신원을 정하지 못합니다. 질문·승인은 Host 리스너가 처리합니다. 누락하면 `Cannot read properties of undefined (reading 'signal')`가 발생합니다. DSH 업그레이드 후 이 코드를 다시 설치하고 `dsh web`을 재시작하세요. 전화 프로토콜 변경은 필요 없습니다.

로컬 공식 DSH로 검증합니다. 실제 Gateway/Connection, 테스트 서비스이며 사용자 세션은 읽거나 쓰지 않습니다.

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/host-official.test.mjs
```

인증과 `dsh-mobile-v1` / `hello.protocol = 3`은 같습니다. 실시간 토큰은 영구 이벤트 `seq`를 소비하지 않습니다. `assistantStream: true`로 구독하여 원자적 `session-snapshot`과 별도 증분을 받습니다. `event`는 영구 이벤트만 포함하며 새 구독 없이는 영구 메시지만 받습니다.

기록은 `historyFormatVersion`과 `cursor`를 포함합니다. 형식 변경 시 캐시를 지우고 기준 데이터를 다시 설치합니다. `beforeSeq` 페이지 처리와 `atSeq` fork에는 `historyFormatVersion: 4`가 필요합니다.
통합·검증은 [rc.2 가이드](../dsh-rc2-mobile-integration.md), 이전 마이그레이션은 [Remote Gateway 계획](../remote-gateway-refactor-plan.md)을 참고하세요.

- WebSocket: `/ws/mobile`
- LAN: `ws://<局域网 IP>:3081/ws/mobile`
- 공개 Linux 서버: `wss://<公网 IP>/ws/mobile`
- 프로토콜: [PROTOCOL.md](../../PROTOCOL.md)

빈 세션을 만든 뒤 첫 대화 전까지 Agent 프리셋을 조회·변경할 수 있습니다. `session-agent-preset`을 탐색하고 [클라이언트 가이드](../session-agent-preset-app-integration.md)를 따르세요. UI 구현 별도, 아직 미배포입니다.

`turn-outline-v1`은 WebUI 전체 턴 개요와 갱신을 전달하여 본문 전체 없이 눈금·질문응답 미리보기·페이지 이동을 지원합니다. 제어 재연결·새 기기에서 기준을 복원하고 Host 개요가 없으면 로드한 턴으로 대체합니다. [탐색 가이드](../turn-outline-app-integration.md). UI 별도, 미배포입니다.

`file-upload-v1`: 페어링한 기기가 제어 연결로 PDF·Office·압축·음성 등을 청크 업로드합니다. SHA-256 후 공식 저장소에 보관하여 세션 인증으로 전송합니다. 진행·취소·정리·실시간/기록 참조를 제공하고 공식 WebUI 허용 규칙을 따르며 클라이언트 지정 호스트 경로에는 쓰지 않습니다. 프레임·상태·제한·검증은 [업로드 가이드](../file-upload-app-integration.md). UI 별도, 미배포입니다.

`agent-team-v1`, `subagent-conversations-v1`: 멤버·공유 작업, 중첩 목록, 팀 프로젝션·상태 동기화, 개별 기록·구독, 대화·중지. 대상·JSON·규칙·전환/재연결·오류·검증은 [팀 가이드](../agent-team-app-integration.md). 게이트웨이 기능이며 UI 별도, 미배포입니다.

## 다중 게이트웨이 1단계(현재 코드)

고정 `gatewayId`, 설정 가능한 `gatewayName`, 후보 주소와 저장되는 끔 / 임시 / 상시 모드. 여러 컴퓨터에 각각 페어링할 수 있으며 클라이언트 관리는 [가이드](../multi-gateway-app-integration.md)에 따라 구현해야 합니다. 새 npm 버전은 미배포입니다.

상시는 재시작 후에도 인증 기기를 허용합니다. DSH 실행, 깨어 있는 호스트, 연결 가능한 네트워크가 필요하며 자동 검색·중계는 제공하지 않습니다.

플러그인 `config` 예시:

```yaml
gatewayMode: persistent
gatewayName: 家里电脑
requireAuth: true
endpoints:
  - wss://gateway.example.com/ws/mobile
  - ws://192.168.1.10:3081/ws/mobile
```

우선순위: **저장한 UI 선택 > `gatewayMode` > 이전 `gatewayEnabled`**. 선택이 없으면 `gatewayEnabled: true`는 상시, false는 끔입니다.

- 끔: 즉시 연결 해제, 재시작 후에도 유지.
- 임시: 기본 5분 안에 성공한 연결이 없으면 끄고 저장합니다. 연결 성공 후 해당 실행 중 유지합니다. 재시작하면 대기를 다시 시작합니다. `gatewayWaitTimeoutMs`: 30초~30분.
- 상시: 미접속 종료 타이머 없음. QR 기본 5분 만료와 파일 전송 시간 제한은 같습니다.

상태는 `<deviceFile>.gateway.json`, 보통 `~/.dsh/mobile-gateway-devices.json.gateway.json`이며 `gatewayStateFile`로 지정합니다. UUID v4·설정, 권한 `0600`, 같은 폴더 임시 파일로 원자 교체합니다. 손상 시 조용히 ID를 바꾸지 않고 시작 오류를 냅니다. 인스턴스별로 독립 등록·상태 파일이 필요합니다.

업데이트·이전 시 둘 다 보존합니다. 독립 복제에는 기존 상태·등록을 복사하지 말고 새 ID와 페어링을 만드세요. 실행 중 ID를 지우지 마세요. 시작 설정 복원은 중지·백업 후 `mode`만 `null`로 바꾸고 `version`·`gatewayId`를 유지해 재시작합니다.

`gatewayName`: 최대 80자, 기본 호스트명. `endpoints`: 최대 16개, 각각 2048자. 선호·공개·LAN을 합쳐 16개를 넘으면 오류입니다. 모두 모바일에서 같은 게이트웨이에 도달해야 합니다. `0.0.0.0` / `::` 금지, 공개는 WSS입니다.

테스트·수동 단계는 [검증 보고서](../multi-gateway-phase1-acceptance.md), 범위는 [할 일 목록](../multi-gateway-todo.md)을 참고하세요.

## Android·iOS 연동 클라이언트

[Whaleness](https://github.com/Clarklevis1995/dsh-mobile)는 이 게이트웨이와 연동하는 독립 개발 서드파티 네이티브 앱입니다. Android 7.0+, iOS / iPadOS 16.1+, Kotlin Multiplatform 공유 로직과 Jetpack Compose·SwiftUI/UIKit UI를 사용합니다. 작업 공간·대화, 팀·공유 작업, 파일 업로드·미리보기, 문자 선택, Markdown 표, 기록·캐시, 음성, 승인, 서버 메뉴를 지원합니다. iPhone Duo·넓은 화면은 방향과 공간에 맞추며 효과는 OS·기기에 따라 다릅니다. 다운로드·설정·최신 이미지는 클라이언트 저장소에 있습니다.

> 최신 iOS 제품 이미지: 1.7.10 자료는 2026년 10월 22~23일, iPhone Duo 이미지는 2026년 10월 26일 촬영했습니다. UI는 중국어입니다. [제품 이미지 출처](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/SOURCES.md) · [Duo 이미지 출처](https://github.com/Clarklevis1995/dsh-mobile/blob/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/SOURCES.md).

### iPhone Duo: 가로, 세로, 탐색 레이아웃

<table>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home.webp" alt="펼친 가로 모드 홈" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-home-alt.webp" alt="가로 모드 홈 배경" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>펼친 가로 모드 홈</strong></td>
    <td align="center"><strong>가로 모드 홈 배경</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-settings.webp" alt="가로 모드 설정" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-conversation.webp" alt="가로 모드 대화" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>가로 모드 설정</strong></td>
    <td align="center"><strong>가로 모드 대화</strong></td>
  </tr>
  <tr>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/landscape-navigation.webp" alt="열린 탐색 사이드바" width="100%"></a></td>
    <td width="50.00%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-26-duo/portrait-home.webp" alt="펼친 세로 모드 홈" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>열린 탐색 사이드바</strong></td>
    <td align="center"><strong>펼친 세로 모드 홈</strong></td>
  </tr>
</table>

### 팀, 첨부 파일, 로컬 저장 공간

<table>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-members.webp" alt="Agent 팀 멤버" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/team-tasks.webp" alt="팀 공유 작업" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/attachment-picker.webp" alt="파일 및 이미지 선택" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>Agent 팀 멤버</strong></td>
    <td align="center"><strong>팀 공유 작업</strong></td>
    <td align="center"><strong>파일 및 이미지 선택</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/text-selection.webp" alt="독립 문자 선택 화면" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/conversation-files.webp" alt="대화의 파일 카드" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/release-notes.webp" alt="앱에 포함된 릴리스 노트" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>독립 문자 선택 화면</strong></td>
    <td align="center"><strong>대화의 파일 카드</strong></td>
    <td align="center"><strong>앱에 포함된 릴리스 노트</strong></td>
  </tr>
  <tr>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/storage.webp" alt="로컬 저장 공간과 캐시 분류" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/voice-input.webp" alt="길게 눌러 음성 입력" width="100%"></a></td>
    <td width="33.33%" align="center"><a href="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp"><img src="https://raw.githubusercontent.com/Clarklevis1995/dsh-mobile/1fa7aa7e2d3f50379d37fba251fb6e774416703b/Docs/images/screenshots/2026-10-23/file-upload.webp" alt="입력란의 파일 첨부" width="100%"></a></td>
  </tr>
  <tr>
    <td align="center"><strong>로컬 저장 공간과 캐시 분류</strong></td>
    <td align="center"><strong>길게 눌러 음성 입력</strong></td>
    <td align="center"><strong>입력란의 파일 첨부</strong></td>
  </tr>
</table>

## 플러그인 설치

`dsh` CLI·`pnpm` 설치, `dsh web` 실행 가능 상태가 필요합니다. 현재 사용자로 `pnpm --version`을 확인하세요. 현재 사용자가 `pnpm`을 호출할 수 있어야 합니다.

LAN에서는 플러그인을 설치합니다.

```bash
dsh plugin --profile web add dsh-plugin-mobile-gateway@latest
```

Linux 공개 IP는 통합 초기화를 사용합니다. 설치·업데이트 후 Helper 설치에 sudo를 한 번 요청합니다.

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`init`은 실행 중 npm 패키지의 정확한 버전을 DSH profile에 설치하고 그 버전만 pnpm 신규 버전 대기를 생략하여 Helper와 맞춥니다.

설치 후 WebUI를 중지·재시작합니다.

```bash
dsh web
```

사이드바 아래 모바일 기기를 확인합니다.

## LAN 페어링

DSH 컴퓨터와 모바일이 서로 접근 가능한 같은 LAN인 경우입니다.

1. WebUI 모바일 기기를 엽니다.
2. 상시, 짧은 페어링은 임시 모드를 선택합니다.
3. 기기 인증을 유지합니다.
4. LAN 직접 연결과 `ws://<电脑局域网 IP>:3081/ws/mobile`을 확인합니다. Tunnel은 유지해도 됩니다. 도움말은 환경·용도를 설명하며 선택을 바꾸지 않습니다.
5. 기기 이름을 입력하고 QR을 만듭니다.
6. 모바일 인증 화면에서 스캔합니다.
7. WebUI가 온라인이면 완료입니다.

방화벽 차단 시 TCP `3081`은 사설망에만 허용하고 공개하지 마세요.

## Linux 공개 IP 페어링

> [!NOTE]
> 공개 IP는 여기서 Linux 서버를 뜻합니다. `v0.6.4`부터 고정 공개 IPv4의 Ubuntu/Debian을 지원합니다. Node.js, `pnpm`, `dsh` CLI가 필요하며 CentOS는 미지원입니다.

### 1. 공개 포트 준비

클라우드 IPv4를 확인하고 보안 그룹에서 TCP `80`/`443`을 허용합니다. WebUI와 TCP `3081`은 공개하지 않습니다.

### 2. 초기화

일반 DSH 사용자로 `pnpm`을 확인합니다.

```bash
pnpm --version
```

같은 일반 사용자로 실행하며 `root`·`sudo npx`는 쓰지 않습니다.

```bash
npm_config_registry=https://registry.npmjs.org \
npx --yes dsh-plugin-mobile-gateway@latest init
```

플러그인 설치·업데이트와 Nginx·Certbot·Helper·갱신 타이머에 sudo를 한 번 요청합니다. `init`이 버전을 맞춥니다.

WebUI를 실행·재시작합니다.

```bash
dsh web
```

### 3. 원격 WebUI 열기

VS Code·Cursor 포트 전달을 우선하거나 로컬 컴퓨터에서 실행합니다.

```bash
ssh -N -L <本地端口>:127.0.0.1:<DSH 实际端口> <服务器用户名>@<服务器公网 IP>
```

로컬 브라우저에서 엽니다.

```text
http://127.0.0.1:<本地端口>
```

### 4. 공개 접속 설정

모바일 기기의 공개 접속에 IPv4를 넣고 설정·갱신합니다. Helper가 `dsh web` 포트를 읽어 Nginx·TLS·`wss://<公网 IP>/ws/mobile`을 설정합니다.

<p align="center">
  <img src="../assets/public-access-ui.jpg" alt="기기 패널에서 공개 접속 설정" width="960">
</p>

### 5. 기기 페어링

1. 모바일 연결과 인증을 활성화합니다.
2. 이름을 입력하고 QR을 만듭니다.
3. 모바일 인증에서 스캔합니다.
4. WebUI 온라인을 확인합니다.

QR은 일회용이며 5분 뒤 만료됩니다. 필요하면 다시 만드세요.

## 가정용 Windows / macOS 원격 연결

고정 IP가 없는 경우가 많아 라우터 포트 개방은 권장하지 않습니다. 계정·도메인 없는 Quick과 고정 도메인 Tunnel을 제공합니다. 처음 공식 `cloudflared`를 다운로드·검증해 사용자 캐시에 저장하며 수동 시스템 서비스는 필요 없습니다.

`dsh web`을 실행하고 컴퓨터를 깨어 있고 온라인이며 DSH가 실행 중인 상태로 유지합니다. 절전·종료는 연결을 끊습니다.

### Cloudflare Quick Tunnel(임시)

기본 자동·LAN 우선입니다. 연결·페어링에서 외부 우선 또는 Cloudflare 외부로 바꾸며 미설정 시 분홍 안내가 나타납니다. Quick·도메인 없음을 켜면 `cloudflared`를 받고 `wss://<名称>.trycloudflare.com/ws/mobile`을 씁니다. LAN은 LAN 우선·직접 연결로 복귀하고 Tunnel은 유지 가능합니다. QR을 만들고 스캔합니다. 끄면 중지, DSH 재시작은 Quick을 **새 임의 주소**로 복원합니다.

계정·Token·도메인은 필요 없지만 재시작·재연결로 URL이 바뀔 수 있습니다. 앱은 확인한 주소만 신뢰하므로 QR 재생성·스캔이 필요합니다. **PC 온라인이 이전 URL을 보장하지 않습니다.** Quick은 테스트·개발용, 동시 요청 제한과 가용성 보장 없음. [공식 문서](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).

설정 갱신은 모드·매개변수를 저장하며 같으면 재연결하지 않습니다. Tunnel 재시작은 모바일 연결과 터널만 재생성하고 DSH Web은 유지합니다. Quick URL 변경 시 이전 QR이 지워져 재스캔해야 합니다. `cloudflared`를 자동 업그레이드하지 않습니다.

### Cloudflare 이름 있는 Tunnel(고정)

1. [원격 관리 Tunnel 생성](https://developers.cloudflare.com/tunnel/get-started/), `gateway.example.com` 같은 호스트 추가, **Service URL** `http://127.0.0.1:3082` 지정. 시스템 서비스·라우터 수신 포트 불필요.
2. Add a replica Token을 복사해 이름 있는 Tunnel·고정 도메인에 입력하고 켭니다. 상시 모드, 전용 리스너, `cloudflared`를 실행하고 등록 후 로컬 DNS·TLS·공개 경로를 검사합니다. 성공하면 `wss://gateway.example.com/ws/mobile`로 QR 생성합니다.
3. `dsh web`은 켜진 Tunnel을 복원합니다. 닫으면 관리 프로세스·전용 리스너가 멈춥니다. 게이트웨이를 수동 끄면 일시 정지하고 켜면 재개합니다. 관리 중인 `cloudflared`도 중지합니다.

두 경로 모두 `/ws/mobile` WebSocket만 허용하며 WebUI·`/mgw` 등은 404입니다. 로컬 Debug 인증이 꺼져도 기기 인증은 필수입니다. Token은 `<deviceFile>.cloudflare.json`(기본 `~/.dsh/mobile-gateway-devices.json.cloudflare.json`)에 권한 `0600`으로 저장하고 브라우저에 반환하지 않습니다. 전용 `cloudflared-bin`만 쓰고 시스템·다른 앱 바이너리는 읽지 않습니다. 매 시작 검증, 누락·손상 시만 고정 버전을 받아 공식 SHA-256 확인. 외부는 `cloudflaredPath` 지정 시만 사용합니다. `cloudflarePort` 변경 시 Service URL도 변경합니다. 캐시의 `cloudflared`는 매번 검증합니다.

#### 공개 경로 검사와 상태

`state: online`은 등록만 뜻하며 도메인·TLS·경로를 보장하지 않습니다. `endpointHealth`(상태·안내·시각·오류)와 `publicReady`를 제공합니다. 연결 후 검사, 관리 인증을 쓰는 `POST /mgw/cloudflare/check`로 DNS/TLS/WebSocket 재검사하며 재시작하지 않습니다.

시스템 DNS, 엄격한 인증서의 HTTPS WebSocket, 토큰·리디렉션 없이 검사합니다. 401과 새 임의 표식의 응답만 성공이며 일반 proxy/Access 401은 아닙니다. 표식은 유효한 인증이 없는 거절에서만 반환하고 권한을 주지 않습니다. 로컬 순간 결과이며 전화망·인증·동기화를 보장하지 않습니다.

로컬 DNS 실패가 공개 레코드 부재를 증명하지 않습니다. NXDOMAIN 캐시, DNS·VPN·proxy를 확인하고 공개 호스트·프록시 CNAME을 점검해 재시도하세요. TLS 검증을 끄지 마세요. Token은 원격 Tunnel을 실행할 뿐 DNS·경로를 만들지 않습니다. 별도 권한 CLI/API 설정은 본 검사 밖입니다.

### Tailscale(장기 사용)

1. 컴퓨터·전화에 [Tailscale](https://tailscale.com/download)을 설치하고 같은 Tailnet에 가입합니다.
2. PowerShell 또는 macOS 터미널에서 실행합니다.

```bash
tailscale serve --bg 3081
```

3. `tailscale serve status`에서 `https://<设备名>.<tailnet>.ts.net`을 확인합니다.
4. `wss://<设备名>.<tailnet>.ts.net/ws/mobile`을 WebUI에 넣고 QR을 만듭니다.

Serve는 같은 Tailnet의 허용 기기만 접속하고 HTTPS를 제공합니다. 중지는 `tailscale serve reset`. [문서](https://tailscale.com/docs/reference/tailscale-cli/serve).

## 연결 방식 요약

| 상황 | 경로 | 모바일 WebSocket | 추가 설정 | 포트·인증 |
|---|---|---|---|---|
| 같은 LAN | 플러그인 LAN | `ws://<电脑局域网 IP>:3081/ws/mobile` | Helper/Nginx 불필요, 상호 접근 | TCP `3081` 사설망, 인증 활성 |
| 로컬 iOS 시뮬레이터 | 로컬 WebUI | `ws://127.0.0.1:<DSH WebUI 端口>/ws/mobile` | Helper/Nginx·별도 `3081` 불필요 | 외부 포트 없음, 인증 해제는 Debug만 |
| 공개 Linux | Helper + Nginx + TLS | `wss://<服务器公网 IPv4>/ws/mobile` | `init`, WebUI IPv4 | TCP `80/443`, DSH/`3081` 비공개, 인증 필수 |
| 가정 Windows / macOS | 이름 있는 Tunnel | `wss://<公开域名>/ws/mobile` | `127.0.0.1:3082` 경로, 호스트/Token | 라우터 개방 없음, 인증 필수 |
| 가정 Windows / macOS | Quick Tunnel | `wss://<随机名称>.trycloudflare.com/ws/mobile` | 활성화, URL 변경 후 스캔 | 계정·도메인·포트 없음, 인증 필수 |
| 가정 Windows / macOS | Tailscale Serve | `wss://<Tailscale 域名>/ws/mobile` | `127.0.0.1:3081` 전달, URL 입력 | 라우터 개방 없음, 인증 활성 |

## Linux 공개 접속 관리

상태 확인:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest status
```

공개 경로 제거:

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove
```

## 업데이트

초기화를 다시 실행해 플러그인과 Helper를 업데이트합니다.

```bash
npx --yes dsh-plugin-mobile-gateway@latest init
```

`dsh web`을 중지·재시작합니다.

## 제거

```bash
dsh plugin --profile web remove dsh-plugin-mobile-gateway
```

Helper도 제거할 경우(기존 Nginx 설정 유지):

```bash
sudo env "PATH=$PATH" npx --yes dsh-plugin-mobile-gateway@latest remove-helper
```

## 문제 해결

| 증상 | 해결 |
|---|---|
| 모바일 기기 없음 | `web` profile 설치, `dsh web` 완전 재시작 |
| `503` | WebUI에서 연결 허용 |
| `401` | QR 재생성·페어링 |
| Linux 공개 시간 초과 | 보안 그룹·방화벽·TCP `80/443` 확인 |
| 공개 주소 없음 | 공개 IPv4 입력·갱신 |
| Cloudflare 다운로드 실패 | GitHub Releases 확인 또는 설치 후 `cloudflaredPath` 절대 경로 지정 |
| Quick 재시작 후 실패 | QR 재생성·스캔, 고정은 이름 있는 Tunnel |
| 기존 Cloudflare 설정 충돌 | `~/.cloudflared/config.yaml` 폴더 공유 불가, 오류와 [공식 안내](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) 참고 |
| 연결됐지만 전화 실패 | Service URL `http://127.0.0.1:<端口>`, DNS·인증 확인 |
| 서버 로그 | 임시 폴더 `mobile-gateway.log`: Windows `%TEMP%`, macOS `$TMPDIR`, Linux 보통 `/tmp` |

## 소스 개발

```bash
dsh plugin --profile web add file:/absolute/path/to/dsh-plugin-mobile-gateway
npm test
```

도구 메뉴로 게이트웨이 재시작·DSH Web 중지가 가능합니다. `dsh web` 실행일 때만 재시작하며 기존 인수와 `--no-open`으로 실행하고 기존 탭이 대기·새로고침합니다. 새 프로세스는 원래 Terminal 전경 작업 밖의 백그라운드입니다. 메뉴 또는 Web 포트 DSH에 `SIGTERM`으로 중지합니다. 연결 일시 중단과 Quick URL 변경 가능. 코드 변경 후 재설치·재시작하세요. 마지막으로 `dsh web`을 재시작하세요.


## 공식 음성 입력 통합

DSH 0.2.0-rc.2 공식 실험 플러그인: 인식기 조회, 모델 준비·진행 구독, 환경 설정, 녹음 변환. 취소·연결 종료 시 중단하며 Agent에 자동 전송하지 않습니다.

1. 음성 입력(`@deepseek-ai/dsh-experimental-voice-input-bundle`) 활성화와 모델 다운로드·준비.
2. 페어링 제어 연결에서 `speech-catalog`, 가용성과 `ready`/`standby` 확인.
3. 전체 녹음을 16 kHz 모노 PCM16 WAV로 변환해 `speech-transcribe`로 Base64 전송.
4. `speech-transcript`를 입력란에 넣고 사용자 확인 후 `message` 전송.

모델은 DSH 컴퓨터에서 실행하며 전화에는 가중치가 필요 없습니다. 전체 녹음만 지원하고 UI·권한·변환은 클라이언트 구현이 필요합니다. [프로토콜](../../PROTOCOL.md#官方语音输入speech-input-v1).

공식 플러그인으로 WAV 검증, 인식 Provider는 테스트 대역, 모델 다운로드 없음:

```bash
DSH_INSTALL_ROOT=/absolute/path/to/@deepseek-ai/dsh node test/speech-official.test.mjs
```
