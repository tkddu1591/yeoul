# E7b — 내장 터미널 설계

2026-07-22 브레인스토밍 확정본. 사용자 요청(E7a 브레인스토밍에서 3에픽 분해): "워크트리를 쓰고 해당 터미널을 따라서 치기가 너무 불편했다 — 코덱스나 클로드코드의 터미널처럼, 내가 보고 있는 곳을 기준으로 쓰는 세션형 터미널. 위치만 잡아서."

## 로드맵 맥락

| 에픽 | 내용 | 상태 |
| --- | --- | --- |
| E7a | 실험 공간(브랜치) 패널 | 완료 (main=ff905f5) |
| **E7b (이 스펙)** | 내장 터미널 — 하단 도크·탭 여러 개·fs watch 상태 동기화 | 설계 |
| E7c | 워크트리 1급 관리 — 좌측 [워크트리] 탭, 선택하면 터미널 cwd가 그 폴더를 따라감 | 대기 |

E7b의 터미널 컨텍스트는 **저장소 루트 고정**이다(체크아웃된 브랜치가 곧 컨텍스트 — 브랜치를 전환해도 같은 폴더이므로 cwd 무변, 프롬프트 테마가 브랜치를 보여준다). E7c에서 "선택된 워크트리 폴더"로 확장될 수 있도록 세션 생성 시 cwd를 인자로 받는 구조로 만든다.

## 결정 사항과 근거 (사용자 확정)

- **배치: 하단 도크 (A안)** — 3열 아래 전체 폭 접이식(VSCode·IntelliJ 관례). 시각 목업 3안(하단 도크/중앙 분할/분리 창) 중 확정. 헤더 "터미널" 토글 버튼 + 상단 모서리 드래그 높이 조절. 접으면 0px(3열 레이아웃 무변), **접어도 세션 프로세스는 유지**된다.
- **세션: 탭 여러 개** — 도크 안 탭 바(+ 추가, ✕ 닫기). E7c에서 워크트리별 세션이 같은 탭 구조에 얹힌다.
- **상태 동기화: fs watch 상시** — 터미널(또는 외부 도구)로 저장소가 바뀌면 앱 화면이 자동 갱신된다. 감시 범위는 `.git` 한정(아래).
- **엔진: node-pty + xterm.js** — 진짜 PTY(색·인터랙티브·vim 동작). 대안 기각: child_process 파이프(TTY 아님 — 반쪽), 외부 터미널 열기(앱 안의 터미널이 아님).

## 아키텍처

### 터미널 엔진 (main 프로세스 소유)

- pty 프로세스는 **main이 소유**한다 — `Map<sessionId, IPty>`. renderer는 세션 id·바이트 스트림만 다룬다(기존 토큰 관례와 같은 "위험 리소스는 main 전용" 원칙).
- 쉘: `process.env.SHELL` 우선, 없으면 `/bin/zsh` → `/bin/bash` 폴백. 로그인 쉘 인자(`-l`)로 사용자 rc·PATH를 살린다.
- cwd: **allowlist된 저장소 루트로 고정**(git-handlers의 `assertAllowedRepo` 재사용). E7b의 세션 생성 API는 `create(repoPath)`뿐이다 — cwd 인자는 E7c(워크트리)에서 추가한다(YAGNI, 시그니처를 미리 넓히지 않는다). main 내부 spawn 함수만 cwd를 매개변수로 받는 구조로 두어 확장 지점을 남긴다.
- env: 사용자 env 그대로 + `TERM=xterm-256color`.
- 수명: 도크 접기는 kill 아님(세션 유지). 탭 ✕ 또는 쉘 exit 시 kill·정리. 앱 종료(before-quit) 시 전 세션 kill. 쉘이 스스로 죽으면(exit) renderer에 종료 이벤트 → 탭에 "종료됨" 표시 후 닫기.

### IPC — 앱 최초의 스트림 이벤트 채널

기존 invoke 관례(요청/응답)에 더해 **main→renderer push**가 필요하다:

- invoke: `terminal:create(repoPath) → { sessionId }` · `terminal:input(sessionId, data)` · `terminal:resize(sessionId, cols, rows)` · `terminal:kill(sessionId)`
- push(이벤트): `terminal:data(sessionId, chunk)` · `terminal:exit(sessionId, exitCode)` — preload가 `webContents.send` 구독을 콜백 브리지(`onData(cb)`/`onExit(cb)`, 해제 함수 반환)로 노출한다. 채널·페이로드는 ipc-contract에 타입으로 명시.
- 보안: sessionId는 main이 발급한 난수. input/resize/kill은 존재하는 세션 id만 통과(모르는 id는 조용히 무시가 아니라 에러). renderer가 임의 경로로 세션을 만들 수 없다(allowlist).

### fs watch — .git 한정 감시

- **감시 대상(main):** 저장소의 `.git` 디렉터리에서 앱 화면과 직결된 것만 — `HEAD`, `index`, `refs/`(재귀), `MERGE_HEAD`·`REBASE_*`·`CHERRY_PICK_HEAD`·`REVERT_HEAD` 등 상태 마커, `packed-refs`. **작업 트리 파일 편집은 감시하지 않는다**(명시적 범위 밖 — 성능 함정. 파일 편집 반영은 기존처럼 앱 조작·새로고침 시).
- 구현: `fs.watch`(macOS recursive 지원) 또는 경량 폴백 — 구체 선택은 플랜 사전 실측(이벤트 폭주 패턴·심링크 gitdir). 외부 라이브러리(chokidar) 도입은 실측에서 fs.watch가 부족할 때만.
- **디바운스 ~300ms** (git 한 명령이 index·HEAD·refs를 연쇄로 건드린다 — 마지막 이벤트 후 한 번만 발화). 디바운스 로직은 순수 함수/클래스로 분리해 단위 테스트.
- 발화: `repo:changed` push 이벤트 → renderer(store)가 받아서 **busy가 아닐 때만** `fetchSnapshot` 갱신(자기 작업은 이미 갱신하므로 이중 방지 + 작업 중 스냅샷 경합 방지). busy 중 도착한 이벤트는 버리지 않고 "pending" 플래그로 두었다가 busy 해제 시 1회 갱신.
- 수명: 저장소 열 때 시작, 저장소 전환·앱 종료 시 정리. E2E 게이트: 감시가 E2E 43+ 시나리오의 스냅샷 타이밍 단언을 흔들지 않는지 전 스위트 통과로 검증(흔들면 E2E 환경 한정 비활성이 아니라 **원인 수정** — 감시는 실사용 기능이다).

## UI — TerminalDock

- `App` 레이아웃: 기존 `app__main`(3열) 아래에 도크 영역. 열림/닫힘·높이(px)는 settings 영속(기존 우측 폭 관례). 기본 높이 ~240px, 최소 120px·최대 창의 60%.
- 헤더에 "터미널" 토글 버튼(Badge `terminal`) + 단축키(⌘\` — 플랜에서 기존 키보드 헬퍼 관례 확인 후 확정).
- 도크 구성: 상단 얇은 바(드래그 핸들 겸용) — 좌측 "터미널" 라벨 + 현재 cwd·브랜치 힌트, 탭들(`1: zsh` 형태, ✕), `+` 추가, 우측 닫기(접기) 버튼.
- 터미널 뷰: xterm.js + fit addon(도크 크기 변화·창 리사이즈 시 refit → resize IPC). 테마: 앱 다크/라이트 토큰에서 배경·전경 매핑(색약 대응은 쉘 출력 영역이라 범위 밖).
- 성능: 탭 전환 시 숨긴 세션의 xterm 인스턴스는 유지(DOM display 토글) — 스크롤백 보존. 스크롤백 상한 xterm 기본(1000행) 유지.
- 프레젠테이션/로직 분리: xterm 배선·세션 수명은 `ui/terminal/` 훅+클래스로 분리, TerminalDock 컴포넌트는 렌더만.

## 에러·엣지

| 상황 | 처리 |
| --- | --- |
| node-pty 로드 실패(재빌드 누락 등) | 도크에 읽히는 에러("터미널 엔진을 불러오지 못했어요…") — 앱 다른 기능 무영향 |
| 쉘 spawn 실패 | 탭에 에러 표시 + 닫기 가능 |
| 세션 많음 | 상한 8개, 초과 시 친절 거부 |
| 저장소 전환 | 기존 세션은 이전 저장소 cwd로 계속(죽이지 않음) — 탭 라벨에 저장소 이름 병기. 감시는 새 저장소로 교체 |
| 도크 열림 + 창 축소 | 도크 최대 높이 클램프(창의 60%) — 3열 min-height 보장 |
| E2E | 숨김 창에서 pty 동작 여부 사전 실측. 터미널 E2E는 echo·commit 시나리오로 검증 |

## 의존성·빌드 (플랜 사전 실측 대상)

- `node-pty`(네이티브) — Electron 35 ABI 재빌드 배선(electron-vite externals + `@electron/rebuild` 또는 prebuilt). **사전 실측: 설치→빌드→spawn→E2E(숨김 창)에서 echo 왕복**이 플랜 작성 전 확정돼야 한다.
- `@xterm/xterm` + `@xterm/addon-fit`(renderer, 순수 JS).

## 테스트

- **단위**: 디바운스 로직(타이머 가짜), 감시 대상 경로 필터 순수 함수, 탭 상태 리듀서(추가/닫기/활성 전환 — 순수 함수로 분리 시).
- **E2E**: ① 도크 열기 → 세션 생성 → `echo` 실행 → 출력 표시, ② 터미널에서 `git commit` → **역사·변경 목록 자동 갱신**(fs watch 검증), ③ 탭 추가·전환·닫기, ④ 도크 접기 후 다시 열어도 세션 유지. 기존 52건 전 스위트 무회귀(감시 도입 영향 포함).
- 게이트 수치는 플랜에서 확정.

## 범위 밖 (후속)

- 워크트리 컨텍스트 따라가기(E7c), 세션별 cwd 지정 UI
- 터미널 검색·분할·링크 클릭(xterm addon류)
- 작업 트리 파일 편집 감시(변경 목록 실시간화)
- 쉘 선택 설정 UI
