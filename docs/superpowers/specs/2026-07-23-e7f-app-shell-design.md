# E7f — 앱 셸 정체성 설계 (한 줄 타이틀바 + 이름·아이콘·패키징)

2026-07-23 브레인스토밍 확정본. 사용자 원 요청: "헤더를 IntelliJ/VSCode처럼 — 닫기·최소화·전체와 헤더가 **한 줄**로"(현행은 OS 타이틀바와 앱 헤더가 두 줄) + "Electron 말고 앱 이름·아이콘 교체". 확정: 패키징까지 / 이름 **Git GUI** / 아이콘은 **Codex 이미지 생성 위임**.

## ① 한 줄 타이틀바 (macOS)

- BrowserWindow에 `titleBarStyle: 'hiddenInset'` — OS 타이틀바 줄 제거, 신호등(닫기·최소화·전체)만 앱 화면 안에 인셋으로 뜬다. `trafficLightPosition`은 기본값(플랜 실측으로 헤더 높이와 수직 정렬 확인 — 필요 시 y 조정).
- 헤더(App의 `<header>`)가 타이틀바를 겸한다:
  - 왼쪽에 신호등 폭 패딩(약 80px — 실측 조정). **전체화면에서는 신호등이 자동 숨김**이므로 패딩을 접는다(감지: `webkitfullscreenchange`가 아닌 Electron `enter-full-screen`/`leave-full-screen` → IPC push? 과설계 — CSS만으로: 플랜 실측에서 전체화면 시 `:fullscreen` 유사 신호로 접기 가능한지 확인, 불가하면 v1은 패딩 유지 수용·후속 노트).
  - 헤더 전체 `-webkit-app-region: drag` — 창 이동·더블클릭 최대화. 헤더 안 **모든 인터랙티브 요소**(버튼·스위처·배지 버튼·팝오버 트리거)는 `-webkit-app-region: no-drag`. 공용 규칙: 헤더 컨테이너에 drag, 직계 인터랙티브 래퍼에 no-drag 클래스 — 개별 버튼 나열보다 누락에 강하다. **누락 검증은 기존 E2E가 담당**(헤더 버튼 클릭 테스트 다수 — 드래그 영역이 클릭을 삼키면 즉시 실패).
- 창 제목 텍스트는 hiddenInset에서 표시되지 않는다 — 수용(창 전환 UI·미션 컨트롤에는 title이 쓰이므로 title은 설정한다).
- Windows/Linux: 현행 유지(기본 프레임). `process.platform === 'darwin'` 분기 — 개발 환경이 macOS뿐(YAGNI, 크로스 타이틀바는 후속).
- 기각 대안: 완전 frameless+자체 창버튼(신호등 모조 — 과설계), titleBarOverlay(Windows향).

## ② 앱 이름 "Git GUI"

- `app.setName('Git GUI')`(main 초기), BrowserWindow `title: 'Git GUI'`, `apps/desktop/src/renderer/index.html`의 `<title>` 교체, `apps/desktop/package.json`에 `productName: "Git GUI"`.
- 개발 모드 한계(정직): macOS 메뉴바 앱 이름은 dev에서 "Electron" 고정(번들 Info.plist 값) — 패키징 산출물에서만 "Git GUI". 독 아이콘은 dev에서도 런타임 교체(아래 ③).

## ③ 아이콘 — Codex 생성 위임

- 구현 단계에서 Codex(이미지 생성)에 위임: **1024×1024 PNG**, 지시문 — 앱 디자인 톤(보라 계열 #9f8fff 계열, 둥근 모서리 스퀘어클, 브랜치(⎇) 모티프, 미니멀·비개발자 친화, macOS Big Sur 스타일 아이콘 규격).
- 흐름: Codex 시안 생성 → 컨트롤러 육안 검수 → **사용자 승인 게이트**(시안 전송, 불만족 시 재생성) → `iconutil`(icns 변환: 1024 원본에서 iconset 크기들 sips 생성) → `apps/desktop/resources/icon.icns`·`icon.png`.
- dev 독 아이콘: main에서 `app.dock.setIcon(resources/icon.png)` (macOS, dev·패키징 공통 무해).

## ④ 패키징 (electron-builder)

- devDependency `electron-builder` 추가. `apps/desktop/package.json`에 build 설정: `appId`(예: `dev.gitgui.app` — 플랜에서 확정), `productName: "Git GUI"`, mac 타깃 `dmg`+`dir`, `icon: resources/icon.icns`, files(out/**·package.json — electron-vite 산출 기준 플랜 실측).
- 스크립트: `"package": "electron-vite build && electron-builder --mac"` — `pnpm --filter @git-gui/desktop package`.
- 검증: 패키징 exit 0 + 산출 `.app/Contents/Info.plist`의 `CFBundleName`/`CFBundleDisplayName` = "Git GUI" 스크립트 검증 + 산출 앱 실행 스모크 1회(수동 — 스크린샷 보고: 메뉴바 "Git GUI"·독 아이콘).
- 서명/공증은 범위 밖(로컬 사용 — Gatekeeper는 로컬 빌드 실행에 문제없음).
- pnpm 함정 주의: electron-builder도 빌드 스크립트 정책 대상일 수 있음 — `pnpm-workspace.yaml onlyBuiltDependencies` 확장은 플랜 실측(E7b node-pty 관례).

## 에러·엣지

| 상황 | 처리 |
| --- | --- |
| 드래그 영역이 버튼 클릭을 삼킴 | no-drag 공용 규칙 + 기존 헤더 클릭 E2E 46+건이 회귀 가드 |
| 전체화면에서 왼쪽 패딩 공백 | 플랜 실측으로 접기 시도, 불가 시 v1 수용(후속 노트) |
| E2E 숨김 창 + hiddenInset | show:false와 무충돌(플랜 실측 — 전 스위트로 확인) |
| dev에서 메뉴바 "Electron" | 한계 명시(② — 패키징 산출물에서 해결) |
| 아이콘 시안 불만족 | 사용자 승인 게이트에서 재생성 루프 |
| 패키징 후 node-pty 네이티브 모듈 | electron-builder가 asarUnpack/rebuild 처리 필요 여부 플랜 실측(spawn-helper 권한 포함) |

## 테스트

- **E2E**: 전 스위트 무회귀(핵심 — no-drag 누락 검출), 창 제목 "Git GUI" 검증 1건 추가(`browserWindow.getTitle()` 또는 document.title).
- **패키징 게이트**: package 스크립트 exit 0 + Info.plist 이름 검증 스크립트(자동) + 산출 앱 실행 스모크(수동 1회·스크린샷 — 메뉴바·독).
- **플랜 사전 실측**: hiddenInset+show:false 조합(E2E 전제), 신호등 기본 위치와 헤더 높이 정렬, 전체화면 패딩 접기 신호, electron-vite 산출 구조와 electron-builder files 설정, node-pty 패키징(asarUnpack·spawn-helper 실행권한), pnpm onlyBuiltDependencies 필요 여부.

## 범위 밖 (후속)

- Windows/Linux 커스텀 타이틀바, 서명·공증·자동 업데이트, dmg 배경 커스텀, 메뉴(Menu) 한글화·정리
