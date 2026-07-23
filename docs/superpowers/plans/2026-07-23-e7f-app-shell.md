# E7f — 앱 셸 정체성 구현 계획 (한 줄 타이틀바·Git GUI 브랜딩·아이콘·패키징)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) 구문으로 추적한다.

**Goal:** ①macOS 신호등과 앱 헤더를 한 줄로(hiddenInset·드래그 영역·전체화면 패딩 접기) ②앱 이름 "Git GUI"(창·독·패키징 산출물) ③Codex 생성 아이콘 ④electron-builder 패키징. 스펙 `docs/superpowers/specs/2026-07-23-e7f-app-shell-design.md`.

**Architecture:** 타이틀바는 CSS 중심(헤더 drag + 인터랙티브 no-drag 공용 셀렉터 — 개별 나열 금지·기존 헤더 클릭 E2E가 회귀 가드), 전체화면 접기는 **실측 2로 CSS 신호 불가 판명** → 최소 push 채널(window:full-screen — E7b repo:changed 관례) 신설. 아이콘 생성은 **컨트롤러 수행 태스크**(Codex 위임·사용자 승인 게이트). 패키징은 electron-vite external 구조(실측 5: main이 node-pty만 external require) 위에 electron-builder를 얹는다 — pnpm 함정(E7b)은 실측 단계로 방어.

**Tech Stack:** 기존 + devDependency `electron-builder`(신규 — Task 3).

**기준 커밋:** main = `ce4eb40`. 기준선: 단위 **450 tests**(38 files), E2E **70**(smoke 64 + hosting 6). 작업 브랜치: **`feature/e7f-app-shell`** (Task 1 Step 0에서 생성).

## 사전 실측 기록 (2026-07-23, macOS · Electron 35.7.5 — 미니 프로브 실기동)

1. **hiddenInset + show:false 공존**: `titleBarStyle: 'hiddenInset'` 창을 숨긴 채 `capturePage` 정상(1800×1000 캡처) — E2E 숨김 창·스크린샷 전제 유지.
2. **전체화면 CSS 신호 불가**: `matchMedia('(display-mode: fullscreen)')`이 OS 전체화면 전환 중에도 false — CSS만으로 신호등 패딩을 접을 수 없다 → **최소 push**(main `enter-full-screen`/`leave-full-screen` → `window:full-screen` boolean send → body 클래스 토글)로 해결(스펙의 "불가 시 수용"보다 개선 — E7b push 관례로 소형).
3. **헤더 현행**: `.app__header`(layout.css)는 `padding: var(--space-3) var(--space-5)`의 플렉스 행 — 왼쪽 신호등 인셋 폭은 hiddenInset 기본 위치 기준 약 80px(구현 후 스크린샷 검수로 조정 — 어긋나면 `trafficLightPosition` y 보정·편차 보고).
4. **index.html `<title>`은 이미 "Git GUI"** — 창 제목은 document.title이 우선이라 현행 창도 Git GUI(추가 확정: BrowserWindow `title`·`app.setName`으로 창 생성 전·비로드 상태도 통일).
5. **번들 구조**: electron-vite `externalizeDepsPlugin`(workspace 패키지만 인라인) — main 번들(102KB)의 external require는 **node-pty뿐**. 패키징 files는 `out/**`+`package.json`+node-pty 모듈이면 충분(나머지 deps는 renderer 번들에 인라인). node-pty는 네이티브 → `asarUnpack` 필수 + spawn-helper 실행권한(E7b tarball 결손) 재확인.
6. **개발 모드 한계(재확인)**: 메뉴바 앱 이름은 dev에서 "Electron"(Info.plist) — 패키징 산출물에서만 교체. 독 아이콘은 dev에서 `app.dock.setIcon` 즉시 반영.

## 파일 구조 (책임 지도)

| 파일 | 책임 |
| --- | --- |
| `apps/desktop/src/main/index.ts` (수정) | hiddenInset(darwin)·title·setName·full-screen push·dock 아이콘 |
| `packages/ipc-contract/src/index.ts` (수정) | WINDOW_CHANNELS·WindowApi(onFullScreen) |
| `apps/desktop/src/preload/index.ts` (수정) | windowApi 브리지 |
| `apps/desktop/src/renderer/src/env.d.ts`류 (실독) | window.windowApi 타입(기존 terminalApi 선언 위치 관례) |
| `apps/desktop/src/renderer/src/App.tsx` (수정) | full-screen 클래스 토글 effect |
| `apps/desktop/src/renderer/src/layout.css` (수정) | 헤더 drag·no-drag·신호등 패딩·fullscreen 접기 |
| `apps/desktop/resources/icon.png`·`icon.icns` (신규 — Task 2) | Codex 생성 아이콘 |
| `apps/desktop/electron-builder.yml` (신규) + `package.json` scripts | 패키징 설정 |
| `scripts/verify-app-bundle.mjs` (신규) | Info.plist 이름·아이콘 검증 |
| `apps/desktop/e2e/smoke.spec.ts` (수정) | 창 제목 E2E +1 |

## 검증 게이트 요약

| 시점 | 기대치 |
| --- | --- |
| 기준선 (ce4eb40) | 450 tests + E2E 70 (smoke 64 + hosting 6) |
| Task 1 후 | 450 유지 + smoke **65**(창 제목 +1) — 전 스위트 무회귀가 no-drag 검증 |
| Task 2 후 | 아이콘 자산 + 사용자 승인 완료 + dev 독 아이콘 확인 |
| Task 3 후 | `pnpm --filter @git-gui/desktop package` exit 0 + verify-app-bundle 통과 |
| 최종 (Task 4) | **450 tests** + typecheck + build + E2E **71**(smoke 65 + hosting 6) + last-screen 0건 + 산출 앱 실행 스모크(메뉴바·독 스크린샷) + README |

---

### Task 1: ①② 한 줄 타이틀바 + 이름 통일

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `packages/ipc-contract/src/index.ts`
- Modify: `apps/desktop/src/preload/index.ts` (+ windowApi 타입 선언 파일 실독)
- Modify: `apps/desktop/src/renderer/src/App.tsx`
- Modify: `apps/desktop/src/renderer/src/layout.css`
- Test: `apps/desktop/e2e/smoke.spec.ts` (+1)

- [ ] **Step 0: 브랜치 생성** — main(ce4eb40)에서 `git checkout -b feature/e7f-app-shell`.

- [ ] **Step 1: 계약 — window 표면.** `packages/ipc-contract/src/index.ts` 파일 끝(TERMINAL_CHANNELS 뒤)에 추가:

```ts

/** 창 상태 표면 (E7f) — 전체화면 여부 push. 신호등 패딩 접기에 쓴다(실측 2: CSS 신호 불가) */
export interface WindowApi {
  /** 전체화면 전환 push 구독 — 해제 함수를 반환한다 */
  onFullScreen(listener: (isFullScreen: boolean) => void): () => void
}

export const WINDOW_API_KEY = 'windowApi' as const

export const WINDOW_CHANNELS = {
  /** push(main→renderer) — enter/leave-full-screen (E7f) */
  fullScreen: 'window:full-screen',
} as const
```

- [ ] **Step 2: main — 창 옵션·이름·push.** `apps/desktop/src/main/index.ts` 편집 3곳.

(a) import 기존:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
```

교체:

```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW_CHANNELS } from '@git-gui/ipc-contract'
```

(b) 이름 — 기존:

```ts
// E2E·테스트 격리 — userData를 임시 폴더로 재지정할 수 있게 한다 (설정 파일이 실제 프로필을 오염하지 않게)
if (process.env.GIT_GUI_USER_DATA) {
  app.setPath('userData', process.env.GIT_GUI_USER_DATA)
}
```

교체:

```ts
// 앱 이름 (E7f) — 창 전환 UI·일부 메뉴에 반영. dev 메뉴바는 "Electron" 고정(Info.plist — 실측 6),
// 패키징 산출물(electron-builder productName)에서 완전히 "Git GUI"가 된다
app.setName('Git GUI')

// E2E·테스트 격리 — userData를 임시 폴더로 재지정할 수 있게 한다 (설정 파일이 실제 프로필을 오염하지 않게)
if (process.env.GIT_GUI_USER_DATA) {
  app.setPath('userData', process.env.GIT_GUI_USER_DATA)
}
```

(c) 창 생성 — 기존:

```ts
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    // 숨김 창도 첫 페인트는 일어난다(paintWhenInitiallyHidden 기본 true) — 스크린샷의 전제
    show: !isE2E || isE2EShow,
    webPreferences: {
```

교체:

```ts
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Git GUI',
    // E7f 한 줄 타이틀바(macOS) — OS 타이틀바 줄을 없애고 신호등만 인셋으로 띄워
    // 앱 헤더가 타이틀바를 겸한다(드래그·패딩은 renderer CSS). 숨김 캡처와 공존(실측 1)
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    // 숨김 창도 첫 페인트는 일어난다(paintWhenInitiallyHidden 기본 true) — 스크린샷의 전제
    show: !isE2E || isE2EShow,
    webPreferences: {
```

그리고 같은 함수의 기존:

```ts
  // 이 창은 preload로 git 조작 API를 갖는 특권 창이다 — 외부 네비게이션과 새 창을 차단한다
  // (파일 드래그&드롭의 file:// 네비게이션 같은 기본 동작도 여기서 막힌다)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
```

교체:

```ts
  // 전체화면에서는 신호등이 숨는다 — 헤더의 신호등 패딩을 접게 push (E7f 실측 2: CSS 신호 불가)
  window.on('enter-full-screen', () => {
    window.webContents.send(WINDOW_CHANNELS.fullScreen, true)
  })
  window.on('leave-full-screen', () => {
    window.webContents.send(WINDOW_CHANNELS.fullScreen, false)
  })

  // 이 창은 preload로 git 조작 API를 갖는 특권 창이다 — 외부 네비게이션과 새 창을 차단한다
  // (파일 드래그&드롭의 file:// 네비게이션 같은 기본 동작도 여기서 막힌다)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
```

- [ ] **Step 3: preload.** `apps/desktop/src/preload/index.ts` — terminalApi 브리지·expose 관례를 실독해 같은 형태로 추가(import에 `WINDOW_CHANNELS`·`WINDOW_API_KEY`·`type WindowApi`, 구현·contextBridge expose — terminalApi 블록 바로 뒤·편차 보고):

```ts
const windowApi: WindowApi = {
  onFullScreen: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) =>
      listener(isFullScreen)
    ipcRenderer.on(WINDOW_CHANNELS.fullScreen, wrapped)
    return () => ipcRenderer.removeListener(WINDOW_CHANNELS.fullScreen, wrapped)
  },
}
```

expose는 기존 `contextBridge.exposeInMainWorld(TERMINAL_API_KEY, terminalApi)` 줄 뒤에 `contextBridge.exposeInMainWorld(WINDOW_API_KEY, windowApi)`. renderer 전역 타입 선언(`window.terminalApi`가 선언된 파일 실독 — 같은 곳에 `windowApi: WindowApi` 추가·편차 보고).

- [ ] **Step 4: App — 클래스 토글.** `apps/desktop/src/renderer/src/App.tsx`의 E7e 자동 fetch effect(기존 앵커) 바로 뒤에 추가 — 기존:

```ts
  const repoPathForFetch = store.repoPath
  useEffect(() => {
    if (!autoFetch || repoPathForFetch === null) return
    void store.autoFetchRemotes()
    const timer = window.setInterval(() => void store.autoFetchRemotes(), 600_000)
    return () => window.clearInterval(timer)
    // store 액션은 zustand에서 안정 참조 — repoPath·autoFetch 전이에만 재구독
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, repoPathForFetch])
```

교체:

```ts
  const repoPathForFetch = store.repoPath
  useEffect(() => {
    if (!autoFetch || repoPathForFetch === null) return
    void store.autoFetchRemotes()
    const timer = window.setInterval(() => void store.autoFetchRemotes(), 600_000)
    return () => window.clearInterval(timer)
    // store 액션은 zustand에서 안정 참조 — repoPath·autoFetch 전이에만 재구독
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch, repoPathForFetch])

  // E7f 전체화면 전환 — 신호등이 숨는 동안 헤더의 신호등 패딩을 접는다 (body 클래스 — CSS 몫)
  useEffect(() => {
    return window.windowApi.onFullScreen((isFullScreen) => {
      document.body.classList.toggle('is-fullscreen', isFullScreen)
    })
  }, [])
```

- [ ] **Step 5: CSS — drag·no-drag·패딩.** `apps/desktop/src/renderer/src/layout.css` 기존:

```css
.app__header {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex: none;
}
```

교체:

```css
.app__header {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-5);
  /* E7f 한 줄 타이틀바 — 신호등(닫기·최소화·전체) 폭만큼 왼쪽을 비운다(hiddenInset 인셋).
     전체화면에서는 신호등이 숨어 body.is-fullscreen이 접는다(실측 2: push 신호) */
  padding-left: 80px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  flex: none;
  /* 헤더가 타이틀바를 겸한다 — 빈 곳 드래그로 창 이동·더블클릭 최대화 */
  -webkit-app-region: drag;
}
/* 드래그 영역이 클릭을 삼키면 안 된다 — 헤더 안 인터랙티브 요소 공용 no-drag
   (개별 나열 금지 — 새 버튼이 추가돼도 자동 적용. 누락은 헤더 클릭 E2E가 잡는다) */
.app__header :is(button, input, select, a, [role='button']) {
  -webkit-app-region: no-drag;
}
body.is-fullscreen .app__header {
  padding-left: var(--space-5);
}
```

- [ ] **Step 6: E2E — 창 제목.** `apps/desktop/e2e/smoke.spec.ts` 파일 끝(E7e 마지막 테스트 `'설정 — 받아오기 방식·자동 새로고침이 재시작 후에도 기억된다 (E7e)'`의 닫는 `})` 뒤)에 추가:

```ts

test('창 제목이 "Git GUI"다 — 한 줄 타이틀바에서도 창 전환 UI에 쓰인다 (E7f)', async () => {
  const repo = await createRepoWithChange()
  await execGitOrThrow(['checkout', '--', 'app.txt'], { cwd: repo })
  const app = await electron.launch({
    args: [APP_ROOT],
    env: { ...process.env, GIT_GUI_E2E_REPO: repo },
  })
  try {
    const window = await app.firstWindow()
    await expect(window.getByTestId('refresh')).toBeVisible()
    const title = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getTitle(),
    )
    expect(title).toBe('Git GUI')
  } finally {
    await app.close()
    await rm(repo, { recursive: true, force: true })
  }
})
```

- [ ] **Step 7: 게이트** — `pnpm typecheck` Done. 루트 `pnpm test` → **450 유지**. `cd apps/desktop && npx electron-vite build && npx playwright test e2e/smoke.spec.ts` → **65 passed**(핵심: 기존 64 전건 무회귀 = no-drag 검증). 실패 시 원인 수정(특히 헤더 클릭 계열이면 no-drag 셀렉터 보강·편차 보고).

- [ ] **Step 8: Commit**

```bash
git add packages/ipc-contract/src/index.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/layout.css apps/desktop/e2e/smoke.spec.ts
git commit -m "feat(desktop): E7f 한 줄 타이틀바 — hiddenInset·헤더 드래그/no-drag·전체화면 패딩 push·Git GUI 이름

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(windowApi 타입 선언 파일이 별도면 add에 포함 — 편차 보고.)

---

### Task 2: ③ 아이콘 — Codex 생성·사용자 승인·icns·독 반영 (**컨트롤러 수행**)

이 태스크는 컨트롤러(메인 세션)가 직접 수행한다 — Codex MCP·사용자 승인 게이트가 컨트롤러 도구이기 때문. 구현 서브에이전트에 위임하지 않는다.

**Files:**
- Create: `apps/desktop/resources/icon.png` (1024×1024) · `apps/desktop/resources/icon.icns`
- Modify: `apps/desktop/src/main/index.ts` (dock 아이콘)

- [ ] **Step 1: Codex 위임 생성.** Codex에 이미지 생성 지시 — 프롬프트 요지: "macOS Big Sur 스타일 앱 아이콘, 1024×1024 PNG, 둥근 모서리 스퀘어클, 배경 보라 그라데이션(#9f8fff 계열), 중앙에 미니멀한 흰 브랜치(⎇) 모티프, 비개발자 친화적 친근함, 플랫·미묘한 입체감". 산출 파일을 scratchpad에 저장.

- [ ] **Step 2: 검수·사용자 승인 게이트.** 컨트롤러 육안 검수 → 사용자에게 시안 전송(SendUserFile) → **승인 대기**. 불만족이면 지시 조정 후 Step 1 반복.

- [ ] **Step 3: 변환·배치.** 승인본으로:

```bash
mkdir -p "apps/desktop/resources" /tmp/gitgui.iconset
cp <승인본.png> apps/desktop/resources/icon.png
for s in 16 32 64 128 256 512; do
  sips -z $s $s apps/desktop/resources/icon.png --out /tmp/gitgui.iconset/icon_${s}x${s}.png >/dev/null
  d=$((s*2)); sips -z $d $d apps/desktop/resources/icon.png --out /tmp/gitgui.iconset/icon_${s}x${s}@2x.png >/dev/null
done
iconutil -c icns /tmp/gitgui.iconset -o apps/desktop/resources/icon.icns
rm -rf /tmp/gitgui.iconset
```

- [ ] **Step 4: dev 독 아이콘.** `apps/desktop/src/main/index.ts` — Task 1 (b)가 만든 기존:

```ts
// 앱 이름 (E7f) — 창 전환 UI·일부 메뉴에 반영. dev 메뉴바는 "Electron" 고정(Info.plist — 실측 6),
// 패키징 산출물(electron-builder productName)에서 완전히 "Git GUI"가 된다
app.setName('Git GUI')
```

교체:

```ts
// 앱 이름 (E7f) — 창 전환 UI·일부 메뉴에 반영. dev 메뉴바는 "Electron" 고정(Info.plist — 실측 6),
// 패키징 산출물(electron-builder productName)에서 완전히 "Git GUI"가 된다
app.setName('Git GUI')
// dev에서도 독에 Electron 아이콘 대신 앱 아이콘 (macOS — 패키징 전에도 정체성 유지)
if (process.platform === 'darwin') {
  app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
}
```

(경로는 out/main 기준 상대 — dev·패키징 공통 동작을 Step 5에서 실기동 확인, 어긋나면 app.isPackaged 분기·편차 보고.)

- [ ] **Step 5: 확인·게이트** — `pnpm dev` 잠깐 실기동(독 아이콘 확인·스크린샷) 후 종료. 루트 `pnpm test` 450·typecheck·build 무회귀.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/resources/icon.png apps/desktop/resources/icon.icns apps/desktop/src/main/index.ts
git commit -m "feat(desktop): E7f 앱 아이콘 — Codex 생성(사용자 승인)·icns 변환·dev 독 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: ④ 패키징 — electron-builder

**Files:**
- Modify: `apps/desktop/package.json` (devDependency·scripts)
- Create: `apps/desktop/electron-builder.yml`
- Create: `scripts/verify-app-bundle.mjs`

- [ ] **Step 1: 설치 + pnpm 정책 실측.** `pnpm --filter @git-gui/desktop add -D electron-builder` 후 `pnpm install` 출력에서 빌드 스크립트 차단 경고 확인 — electron-builder 계열(app-builder-bin 등)이 차단되면 `pnpm-workspace.yaml`의 `onlyBuiltDependencies`에 추가(E7b 함정: package.json pnpm 필드 금지 — workspace yaml만). 결과를 편차 보고.

- [ ] **Step 2: 빌드 설정.** `apps/desktop/electron-builder.yml` 신규:

```yaml
# E7f 패키징 — 로컬 사용 목적(서명·공증 없음). electron-vite external 구조(실측 5):
# main/preload 번들은 out/에 있고 외부 require는 node-pty뿐 — files를 그만큼만 담는다
appId: dev.gitgui.app
productName: Git GUI
directories:
  output: dist
files:
  - out/**
  - package.json
  - "!node_modules/**"
  - node_modules/node-pty/**
asar: true
asarUnpack:
  - node_modules/node-pty/**
npmRebuild: false
mac:
  target:
    - dir
    - dmg
  icon: resources/icon.icns
  category: public.app-category.developer-tools
```

`apps/desktop/package.json` scripts의 기존:

```json
    "e2e": "electron-vite build && playwright test",
```

교체:

```json
    "e2e": "electron-vite build && playwright test",
    "package": "electron-vite build && electron-builder --mac --config electron-builder.yml",
```

- [ ] **Step 3: 검증 스크립트.** `scripts/verify-app-bundle.mjs` 신규:

```js
// E7f 패키징 검증 — 산출 .app의 이름·아이콘·네이티브 모듈을 확인한다 (게이트 스크립트)
import { execFileSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

const appPath = process.argv[2] ?? 'apps/desktop/dist/mac-arm64/Git GUI.app'
const plist = `${appPath}/Contents/Info.plist`
const read = (key) =>
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist]).toString().trim()

const failures = []
if (read('CFBundleName') !== 'Git GUI') failures.push(`CFBundleName=${read('CFBundleName')}`)
if (read('CFBundleDisplayName') !== 'Git GUI') failures.push(`CFBundleDisplayName=${read('CFBundleDisplayName')}`)
const iconFile = read('CFBundleIconFile')
if (!iconFile.startsWith('icon')) failures.push(`CFBundleIconFile=${iconFile}`)
// node-pty가 asar 밖에 풀렸고 spawn-helper가 실행 가능해야 pty가 산다 (E7b tarball 결손 재확인)
const helperGlob = `${appPath}/Contents/Resources/app.asar.unpacked/node_modules/node-pty/prebuilds`
if (!existsSync(helperGlob)) failures.push('node-pty prebuilds missing (asarUnpack)')
else {
  const helper = execFileSync('bash', ['-lc', `ls "${helperGlob}"/darwin-*/spawn-helper | head -1`]).toString().trim()
  if (helper === '') failures.push('spawn-helper missing')
  else if (!(statSync(helper).mode & 0o111)) failures.push(`spawn-helper not executable: ${helper}`)
}

if (failures.length > 0) {
  console.error('패키징 검증 실패:', failures.join(' / '))
  process.exit(1)
}
console.log('패키징 검증 통과: 이름·아이콘·node-pty(asarUnpack·spawn-helper 실행권한) OK')
```

- [ ] **Step 4: 패키징 실기동·게이트.** `pnpm --filter @git-gui/desktop package` → exit 0. `node scripts/verify-app-bundle.mjs` → 통과. **실측 조정 폭**: dist 경로(mac-arm64/mac)·files 구성·node-pty 하위 의존 누락 등은 electron-builder 실기동 결과에 맞춰 electron-builder.yml을 조정하고 전부 편차 보고(이 태스크의 본질이 실측이다). dist/는 `.gitignore`에 추가(실독 — 없으면 추가).

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/package.json apps/desktop/electron-builder.yml scripts/verify-app-bundle.mjs pnpm-workspace.yaml pnpm-lock.yaml .gitignore
git commit -m "feat(desktop): E7f 패키징 — electron-builder(mac dir+dmg)·번들 검증 스크립트(이름·아이콘·node-pty)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(pnpm-workspace.yaml·.gitignore 미변경이면 add에서 제외 — 편차 보고.)

---

### Task 4: 최종 게이트 + 실행 스모크 + README (**스모크는 컨트롤러 수행**)

- [ ] **Step 1: 전체 게이트** — 루트 `pnpm test` → **450**. `pnpm typecheck` Done. `pnpm --filter @git-gui/desktop build`. `pnpm --filter @git-gui/desktop e2e` → **71**(smoke 65 + hosting 6). last-screen 0건. `pnpm --filter @git-gui/desktop package` + verify 재통과.

- [ ] **Step 2: 실행 스모크(컨트롤러).** 산출 앱을 잠깐 실행 — **사용자 화면에 창이 잠깐 뜬다**(패키징 검증 특성상 불가피 — 이 한 번만). `open "apps/desktop/dist/mac-arm64/Git GUI.app"` → 몇 초 뒤 `screencapture`로 전체 화면 캡처(메뉴바 "Git GUI"·독 아이콘 확인) → 앱 종료(`osascript -e 'quit app "Git GUI"'`). 캡처 육안 검수 + 사용자 전송. 터미널 도크 열어 pty 동작 1회 확인(spawn-helper 검증 실전).

- [ ] **Step 3: README.** 기존(E7e 문단 끝):

```
연결(upstream) 없는 실험 공간을 백업하면 자동으로 원격에 만들어 연결하고 알려줍니다.
```

교체:

```
연결(upstream) 없는 실험 공간을 백업하면 자동으로 원격에 만들어 연결하고 알려줍니다. E7f로 앱이 진짜 앱다워졌습니다 — macOS에서 닫기·최소화·전체 버튼과 헤더가 한 줄이 되고(헤더 드래그로 창 이동·더블클릭 최대화), 앱 이름·아이콘이 "Git GUI"로 바뀌었으며, `pnpm --filter @git-gui/desktop package`로 설치 가능한 .app/.dmg를 만들 수 있습니다(이름·아이콘·터미널(node-pty)까지 검증 스크립트로 확인).
```

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README — E7f 앱 셸(한 줄 타이틀바·Git GUI 브랜딩·패키징) 반영

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## Self-review 수정 기록 (인라인 반영)

1. **스펙 커버리지**: ①T1 ②T1(+T3 productName) ③T2 ④T3 + 스모크 T4 — 전부 매핑. 스펙의 "전체화면 접기 불가 시 수용"은 실측 2로 불가 판명 → **최소 push로 개선 구현**(스펙 취지 상회 — 편차 아님·개선으로 기록).
2. **T2·T4를 컨트롤러 수행으로 명시** — Codex MCP·사용자 승인·화면 캡처는 컨트롤러 도구.
3. **no-drag를 공용 셀렉터로** — 개별 버튼 나열은 신규 버튼 누락 시한폭탄. `:is(...)` 셀렉터 + 기존 헤더 클릭 E2E 64건이 회귀 가드.
4. **패키징 태스크의 실측 조정 폭 명시** — electron-builder×pnpm×electron-vite 조합은 실기동 없이 확정 불가. 검증 스크립트(이름·아이콘·spawn-helper 실행권한)가 목표 불변식을 고정하고 files 구성은 조정 가능.
5. **index.html title은 이미 "Git GUI"**(실측 4) — 변경 목록에서 제외.

## 인용 앵커 검증 기록

**스크립트 실검증(2026-07-23, main=ce4eb40):** "기존:" 블록 전수 — 기준선 정확 1회 매칭 **8개**, 미래 앵커 1개(Task 1→2 setName 블록), 불일치 **0**.

작성 시점(main=ce4eb40) 실측 원문 발췌 앵커: index.ts(import·userData 블록·BrowserWindow 선두·setWindowOpenHandler 블록), layout.css(.app__header 전문), App.tsx(E7e 자동 fetch effect 전문), package.json(e2e 스크립트 줄), README(E7e 문단 끝 문장), smoke(E2E 앵커는 파일 끝 — E7e 마지막 테스트 뒤). **미확정(구현 시 실독·같은 취지·편차 보고): preload terminalApi 브리지·expose 형태와 windowApi 타입 선언 파일, dock.setIcon 경로(dev/패키징 실기동), electron-builder 산출 경로·files 조정, .gitignore.**

## 후속 노트 (이관 후보)

- Windows/Linux 커스텀 타이틀바, 서명·공증·자동 업데이트, dmg 배경, 메뉴 한글화, 트래픽라이트 y 미세 조정(검수 결과에 따라).
