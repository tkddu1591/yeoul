import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { isAbsolute, join } from 'node:path'
import { WINDOW_CHANNELS, type WindowLayout } from '@git-gui/ipc-contract'
import { openRepoPath, registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { assertAbsoluteRepoPath } from './repo-open-guard'
import { readTheme, readWindows, registerSettingsHandlers, saveWindows } from './settings'
import { registerTerminalHandlers } from './terminal-handlers'
import { createWindowRegistry } from './window-registry'

// 창의 정본 (E15b) — 어느 창이 어느 저장소를 열었나·그 창의 레이아웃. main만 안다
const registry = createWindowRegistry()

/** tokens.css의 --color-bg와 짝 — 부팅 창 배경색으로 쓴다(E13 흰 화면 제거).
 * 실측: 앱 최상위에서 실제로 페인트되는 배경은 --color-surface(카드·패널 전용)가 아니라
 * body의 --color-bg다(base.css `body { background: var(--color-bg) }`) — #root와 .app은
 * 배경을 지정하지 않아(layout.css) body 배경이 창 전체에 그대로 비친다. --color-surface를
 * 썼다면 body 배경과 미묘하게 어긋나는 색이 창 생성 직후 잠깐 보였을 것이다.
 * 값이 바뀌면 여기도 손으로 맞춘다 (use-terminal-sessions.ts TERMINAL_FONT_FAMILY와 같은 관례) */
const APP_BACKGROUND = { light: '#f4f5f7', dark: '#16181d' } as const

/** 창 배경색을 저장된 테마로 정한다 — 저장값이 없으면(첫 실행) renderer의 resolveInitialTheme과
 * 같은 폴백(OS 다크모드 설정)을 쓴다. 이 색은 BrowserWindow가 생성되는 순간부터 칠해져 있어,
 * 창이 페인트를 마치고 보이는 시점에 흰 배경이 낄 틈이 없다 */
function resolveBackgroundColor(): string {
  const saved = readTheme()
  const dark = saved === 'dark' || (saved === undefined && nativeTheme.shouldUseDarkColors)
  return dark ? APP_BACKGROUND.dark : APP_BACKGROUND.light
}

// 앱 이름 (E7f) — 창 전환 UI·일부 메뉴에 반영. dev 메뉴바는 "Electron" 고정(Info.plist — 실측 6),
// 패키징 산출물(electron-builder productName)에서 완전히 "Git GUI"가 된다
app.setName('Git GUI')
// dev에서도 독에 Electron 아이콘 대신 앱 아이콘 (macOS — 패키징 전에도 정체성 유지).
// !app.isPackaged가 반드시 필요하다: 이 png는 electron-builder의 files 목록에 없어 asar에 안 들어가고
// (패키징 앱은 Info.plist가 가리키는 icon.icns로 이미 아이콘을 받는다), 패키징 앱에서 부르면
// "Failed to load image from path …/app.asar/resources/icon.png"로 **앱이 즉시 죽는다**.
// E7f가 이 줄을 넣은 뒤로 패키징 산출물은 한 번도 뜬 적이 없었다 — verify-app-bundle.mjs가
// 아이콘 파일 존재만 보고 실제 실행은 보지 않았기 때문이다 (E14b 후속 실측)
if (process.platform === 'darwin' && !app.isPackaged) {
  app.dock?.setIcon(join(__dirname, '../../resources/icon.png'))
}

// E2E·테스트 격리 — userData를 임시 폴더로 재지정할 수 있게 한다 (설정 파일이 실제 프로필을 오염하지 않게)
if (process.env.GIT_GUI_USER_DATA) {
  app.setPath('userData', process.env.GIT_GUI_USER_DATA)
}

// E2E 창 비간섭 — Playwright 실행 중 창이 사용자 화면을 가리거나 포커스를 뺏지 않게 숨긴 채 띄운다.
// CDP 입력·렌더·스크린샷은 숨김 창에서도 전부 동작한다(플랜 실측: isVisible false에서
// 클릭·드래그·키보드·screenshot(1200·960) 정상 + 기존 42건 전체 통과).
// 패키징된 앱에서는 무시한다 (GIT_GUI_E2E_GH_TOKEN과 동일 관례)
const isE2E = !app.isPackaged && process.env.GIT_GUI_E2E_REPO !== undefined
// 로컬 디버깅 opt-out (E6a 후속) — GIT_GUI_E2E_SHOW=1이면 숨김 게이트만 무시하고 창을 보여준다.
// 스로틀 해제 등 나머지 E2E 동작은 유지. 프로덕션(isPackaged)·CI 기본 동작 무변
const isE2EShow = isE2E && process.env.GIT_GUI_E2E_SHOW === '1'

/** 새 창이 무엇을 열고 어떤 모습으로 뜰지 (E15b) — 여는 쪽이 정해 넘긴다 */
interface WindowSeed {
  repoPath: string | null
  layout: WindowLayout
}

function createWindow(seed: WindowSeed = { repoPath: null, layout: {} }): BrowserWindow {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Git GUI',
    // E7f 한 줄 타이틀바(macOS) → E7h ⑦: hiddenInset은 신호등 y가 OS 고정이라 헤더와 안 맞았다 —
    // hidden + trafficLightPosition으로 헤더 세로 중앙에 맞춘다.
    // y=22 실측: .app__header 실높이 58px → Math.round((58-14)/2) = 22 (신호등 지름 14px 관례)
    // 앱 헤더가 타이틀바를 겸한다(드래그·패딩은 renderer CSS). 숨김 캡처와 공존(실측 1)
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 20, y: 22 } }
      : {}),
    // E13 — 창이 뜨는 순간부터 이 색으로 칠해져 있다(콘텐츠가 없는 흰 배경 대신). 저장된
    // 테마를 못 읽는 극단적 실패에도 폴백값이 있어 undefined가 되지 않는다
    backgroundColor: resolveBackgroundColor(),
    // E13 — 페인트 전에 보여주지 않는다: 첫 페인트가 끝난 뒤(ready-to-show)에야 드러난다.
    // 숨김 창도 첫 페인트는 일어난다(paintWhenInitiallyHidden 기본 true) — 스크린샷의 전제는
    // 그대로 유지된다(show 여부와 무관)
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 숨김 창의 타이머·rAF 스로틀로 E2E 대기가 길어지지 않게 — E2E에서만 해제
      backgroundThrottling: !isE2E,
    },
  })

  // 레지스트리 등록은 **여기서 동기적으로** 한다 (E15b). preload의 settings:get-sync가 이보다
  // 늦게 돌고, 그때 이 창의 layout 씨앗을 읽어야 새 창이 열어준 창을 닮는다. loadFile 뒤로
  // 미루면 늦는다. repo:initial-path도 같은 이유로 여기 등록된 repoPath를 읽는다
  registry.add(window.webContents.id, { repoPath: seed.repoPath, layout: seed.layout })
  // closed 시점에는 webContents가 이미 파괴돼 id 접근이 안전하지 않다 — 미리 잡아 둔다
  const windowId = window.webContents.id
  window.on('closed', () => registry.remove(windowId))

  // E13 — 흰 화면 제거 2단계: 페인트가 끝난 뒤에만 보여준다. E2E 숨김 규칙(E6a)과 합성한다 —
  // isE2E && !isE2EShow는 계속 숨긴 채로 둔다(이 분기를 안 타므로 창은 영원히 안 보인다).
  // 그 외(일반 실행, GIT_GUI_E2E_SHOW=1)는 바뀐 게 시점뿐이다: 예전엔 창 생성 즉시(콘텐츠
  // 없는 흰 화면) 보였다면, 이제는 첫 페인트가 끝난 뒤에야 보인다 — 그 사이는 backgroundColor가
  // 대신 채운다
  window.once('ready-to-show', () => {
    if (!isE2E || isE2EShow) window.show()
  })

  // 전체화면에서는 신호등이 숨는다 — 헤더의 신호등 패딩을 접게 push (E7f 실측 2: CSS 신호 불가)
  window.on('enter-full-screen', () => {
    window.webContents.send(WINDOW_CHANNELS.fullScreen, true)
  })
  window.on('leave-full-screen', () => {
    window.webContents.send(WINDOW_CHANNELS.fullScreen, false)
  })

  // 창으로 돌아오면 재조회 — 감시가 못 잡은 잔여와 감시가 죽은 경우(watch error로 조용히 닫힘)를 메운다 (E10)
  window.on('focus', () => {
    window.webContents.send(WINDOW_CHANNELS.focused)
  })

  // 이 창은 preload로 git 조작 API를 갖는 특권 창이다 — 외부 네비게이션과 새 창을 차단한다
  // (파일 드래그&드롭의 file:// 네비게이션 같은 기본 동작도 여기서 막힌다)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // 패키징된 앱에서는 env로 임의 URL을 주입할 수 없어야 한다
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return window
}

/** 새 창은 열어준 창의 레이아웃을 씨앗으로 받는다 (사용자 결정). 그 창이 없으면 빈 레이아웃 —
 * 렌더러가 기본값을 쓴다 */
function seedLayoutFrom(openerId: number): WindowLayout {
  return { ...(registry.get(openerId)?.layout ?? {}) }
}

/** 새 창에서 연다 (E15b). 창을 만드는 것은 index.ts 책임이라 이 핸들러만 여기 있다 */
function registerWindowHandlers(): void {
  ipcMain.handle(WINDOW_CHANNELS.open, async (event, repoPath: unknown) => {
    if (repoPath === null) {
      createWindow({ repoPath: null, layout: seedLayoutFrom(event.sender.id) })
      return
    }
    // 인자는 디스크 설정에서 온 렌더러 입력이라 repo.open과 **같은 검증**을 거친다 — 검증 없이
    // 씨앗으로 넣으면 그 창이 임의 디렉터리에서 git을 돌리는 통로가 된다
    const opened = await openRepoPath(assertAbsoluteRepoPath(repoPath))
    if (!opened.ok) throw new Error(opened.message)
    // 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 앞으로 가져온다 (사용자 결정)
    const existing = registry.findByRepoPath(opened.path)
    if (existing !== undefined) {
      const found = BrowserWindow.getAllWindows().find((w) => w.webContents.id === existing)
      // 탭으로 묶여 있어도 focus()면 macOS가 그 탭을 앞으로 가져온다
      found?.show()
      found?.focus()
      return
    }
    createWindow({ repoPath: opened.path, layout: seedLayoutFrom(event.sender.id) })
  })
}

/**
 * 시작할 때 창을 만든다 — 껐을 때 그대로 (E15b).
 *
 * 저장된 목록이 없으면(첫 실행) 빈 창 하나 — 예전 동작과 같다.
 */
async function createStartupWindows(): Promise<void> {
  const restored = readWindows()
  // GIT_GUI_E2E_REPO가 있으면 **저장된 목록으로 창을 여럿 만들지 않는다** — 기존 E2E 143건이
  // 전부 "창 하나, 그 저장소" 하나를 전제로 짜여 있어 복원이 창을 더 만들면 대량으로 깨진다.
  //
  // 다만 레이아웃 기억은 저장소 목록과 **다른 문제라** 첫 창의 레이아웃은 그대로 복원한다.
  // E15b가 rightWidth·leftCollapsed를 settings.json에서 이 목록으로 옮겼으므로, 여기서
  // 씨앗으로 주지 않으면 재시작 지속성 E2E 2건(:373 우측 폭 · :3500 좌측 접힘)이 영영 빨갛다 —
  // 창 하나짜리 재시작도 복원 경로를 타야 한다. (플랜은 이 블록 전체를 환경변수로 감싸라고
  // 했는데, 그러면 그 2건이 돌아올 길이 없다 — 실측으로 갈랐다)
  const seededRepo = process.env.GIT_GUI_E2E_REPO
  if (seededRepo !== undefined) {
    createWindow({ repoPath: seededRepo, layout: restored[0]?.layout ?? {} })
    return
  }
  let created = 0
  for (const saved of restored) {
    if (saved.repoPath !== null) {
      // 이 경로는 사람이 편집할 수 있는 디스크 파일에서 왔고 그대로 git의 cwd가 된다 —
      // repo.open·window.open과 **같은 검증**을 거친다. 다만 여기서는 던지지 않고 건너뛴다:
      // 손으로 망가뜨린 항목 하나가 앱 시작을 통째로 막으면 안 된다
      if (!isAbsolute(saved.repoPath)) continue
      const opened = await openRepoPath(saved.repoPath)
      // 없어진 저장소는 그 창을 만들지 않고 넘어간다. 알림은 띄우지 않는다 — 시작하자마자
      // 배너를 보는 건 성가시고, 그 경로는 최근 목록에서도 곧 빠진다
      if (!opened.ok) continue
      createWindow({ repoPath: opened.path, layout: saved.layout })
    } else {
      createWindow({ repoPath: null, layout: saved.layout })
    }
    created += 1
  }
  // 저장된 창이 없거나 전부 사라졌으면 빈 창 하나 — 창 없이 시작하면 macOS에서 되살릴 길이
  // 독 아이콘 클릭(activate)뿐이다
  if (created === 0) createWindow()
}

// macOS에서는 앱 실행 자체가 활성화되며 포커스를 훔칠 수 있다 — E2E에서는 dock 아이콘째 숨긴다
if (isE2E && !isE2EShow) app.dock?.hide()

app
  .whenReady()
  .then(async () => {
    registerGitHandlers(registry)
    registerSettingsHandlers(registry)
    registerHostingHandlers()
    registerTerminalHandlers()
    registerWindowHandlers()
    // 종료 직전의 스냅샷을 남긴다 (E15b) — 창이 닫히는 'closed'가 아니라 여기서 한 번 찍는다.
    // ⌘Q(app.quit)는 before-quit → 창 닫기 순서라 이 시점의 레지스트리에 창들이 아직 다 있다
    // (실측: Playwright의 app.close()도 main에서 app.quit()을 부르므로 그대로 발화한다).
    // 반대로 사용자가 창을 하나씩 다 닫고 나서 종료하면 목록은 비어 저장된다 — 그건 의도다.
    // "닫은 창은 다음에 안 뜬다"가 맞는 동작이라 되살리지 않는다
    app.on('before-quit', () => {
      saveWindows(registry.snapshot())
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
    // GIT_GUI_E2E_REPO는 "**시작할 때** 이 저장소를 열어라"지 "새 창마다 열어라"가 아니다.
    // 예전엔 repo:initial-path가 씨앗이 없을 때마다 이 환경변수로 되돌아가, ⌘N이 만든 빈 창이
    // E2E에서만 조용히 그 저장소를 열었다 — 빈 창(RepoPicker) 경로가 E2E로 검증 불가능해진다
    // (E15b Task 5 실측: 최근 목록 테스트가 여기서 빨갛게 났다). 씨앗은 첫 창에만 준다
    await createStartupWindows()
  })
  .catch((error) => {
    console.error('앱 초기화 실패:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
