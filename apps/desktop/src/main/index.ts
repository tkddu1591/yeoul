import { app, BaseWindow, ipcMain, nativeTheme, WebContentsView } from 'electron'
import { isAbsolute, join } from 'node:path'
import { WINDOW_CHANNELS, type WindowLayout, type WindowOpenResult } from '@git-gui/ipc-contract'
import { openRepoPath, registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { assertAbsoluteRepoPath } from './repo-open-guard'
import { readTheme, readWindows, registerSettingsHandlers, saveWindows } from './settings'
import { registerTerminalHandlers } from './terminal-handlers'
import { createTrailingDebounce } from './watch-filter'
import { createWindowRegistry } from './window-registry'

/**
 * 레이아웃 변경을 디스크에 묶어 쓰는 간격 (E15b 리뷰 I-1) — 도크 높이·우측 폭 드래그는 초당
 * 여러 번 온다. E10의 감시 디바운스를 그대로 재사용한다(트레일링 1회)
 */
const LAYOUT_PERSIST_MS = 250

// 창의 정본 (E15b) — 어느 창이 어느 저장소를 열었나·그 창의 레이아웃. main만 안다.
//
// 바뀔 때마다 디스크에 남긴다 (E15b 리뷰 I-1): 예전엔 `before-quit` 한 번이 유일한 영속
// 지점이라, 창을 닫고 종료하면 그 창의 레이아웃이 통째로 증발했다(main 대비 회귀 — main은
// `settings:set`마다 파일에 썼다). 레이아웃은 묶어서, 창 목록은 즉시 쓴다
const persistLayout = createTrailingDebounce(LAYOUT_PERSIST_MS, () =>
  saveWindows(registry.snapshot()),
)
/**
 * `before-quit`이 지나갔는가 — 지나갔으면 **목록은 얼어붙는다** (E15b 리뷰 I-1 실측).
 *
 * ⌘Q는 `before-quit` → 창들을 **하나씩** 닫는 순서다. 그 각각의 `closed`도 레지스트리 변경이라,
 * 얼리지 않으면 마지막 창 하나만 남은 중간 스냅샷이 방금 저장한 올바른 목록을 덮어쓴다
 * (실측: 창 둘을 열고 종료했더니 복원이 1개만 됐다 — 전체 E2E에서 «껐다 켜면 …» 1건이 빨갰다.
 * 닫히는 속도에 달린 경합이라 단독 실행에서는 초록이었다).
 *
 * 종료 중의 `closed`는 "사용자가 창을 닫았다"가 아니라 "앱이 내려간다"다 — 둘을 가르는
 * 신호가 정확히 이 순서다. 창을 먼저 닫고 종료하는 경로(Windows/Linux의 X)는 `closed`가
 * `before-quit`보다 **앞**이라 영향받지 않는다
 */
let quitting = false
const registry = createWindowRegistry((kind) => {
  if (quitting) return
  if (kind === 'layout') persistLayout.hit()
  else saveWindows(registry.snapshot())
})

/** tokens.css의 --color-bg와 짝 — 부팅 창 배경색으로 쓴다(E13 흰 화면 제거).
 * 실측: 앱 최상위에서 실제로 페인트되는 배경은 --color-surface(카드·패널 전용)가 아니라
 * body의 --color-bg다(base.css `body { background: var(--color-bg) }`) — #root와 .app은
 * 배경을 지정하지 않아(layout.css) body 배경이 창 전체에 그대로 비친다. --color-surface를
 * 썼다면 body 배경과 미묘하게 어긋나는 색이 창 생성 직후 잠깐 보였을 것이다.
 * 값이 바뀌면 여기도 손으로 맞춘다 (use-terminal-sessions.ts TERMINAL_FONT_FAMILY와 같은 관례) */
const APP_BACKGROUND = { light: '#f4f5f7', dark: '#16181d' } as const

/** 창 배경색을 저장된 테마로 정한다 — 저장값이 없으면(첫 실행) renderer의 resolveInitialTheme과
 * 같은 폴백(OS 다크모드 설정)을 쓴다. 이 색은 창(BaseWindow)과 뷰(WebContentsView) 둘 다에
 * 생성 순간부터 칠해져 있어, 창이 페인트를 마치고 보이는 시점에 흰 배경이 낄 틈이 없다 */
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

/** createWindow의 산출물 (E15c) — Task 2~7이 창과 뷰를 각각 쓴다 */
interface CreatedWindow {
  window: BaseWindow
  view: WebContentsView
}

/** 뷰 id → 그 뷰가 사는 창 (E15c). registry는 electron을 모르므로 실물 연결은 여기(index.ts) 몫이다.
 * BaseWindow에는 webContents가 없어 예전의 getAllWindows().find(webContents.id)가 불가능하다 */
const windowOfView = new Map<number, BaseWindow>()

function createWindow(seed: WindowSeed = { repoPath: null, layout: {} }): CreatedWindow {
  const window = new BaseWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Git GUI',
    // E7f 한 줄 타이틀바(macOS) → E7h ⑦: hiddenInset은 신호등 y가 OS 고정이라 헤더와 안 맞았다 —
    // hidden + trafficLightPosition으로 헤더 세로 중앙에 맞춘다.
    // y=22 실측: .app__header 실높이 58px → Math.round((58-14)/2) = 22 (신호등 지름 14px 관례)
    // 앱 헤더가 타이틀바를 겸한다(드래그·패딩은 renderer CSS). 숨김 캡처와 공존(실측 1)
    // → E15c: BrowserWindow가 아니라 BaseWindow지만 같은 옵션을 받는다
    // (실측: BaseWindowConstructorOptions에 titleBarStyle·trafficLightPosition 있음 — electron.d.ts).
    // E15b에서 네이티브 탭을 막았던 hidden이 여기서는 아무것도 안 막는다 — 탭은 우리가 그린다
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 20, y: 22 } }
      : {}),
    // E13 — 창이 뜨는 순간부터 이 색으로 칠해져 있다(콘텐츠가 없는 흰 배경 대신). 저장된
    // 테마를 못 읽는 극단적 실패에도 폴백값이 있어 undefined가 되지 않는다
    backgroundColor: resolveBackgroundColor(),
    // E13 — 페인트 전에 보여주지 않는다: 뷰가 로드를 마친 뒤에야 드러난다(아래 did-finish-load)
    show: false,
  })

  const view = createRepoView()
  window.contentView.addChildView(view)
  fitViewToWindow(window, view)
  // 창 리사이즈마다 뷰를 창 크기에 맞춘다 — BrowserWindow 시절엔 공짜였던 것
  window.on('resize', () => fitViewToWindow(window, view))

  // ready-to-show는 BrowserWindow의 이벤트다 — BaseWindow에는 없다 (첫 페인트 신호가
  // WebContentsView에는 노출되지 않는다: webContents의 'paint'는 오프스크린 전용).
  // did-finish-load는 페인트 이전일 수 있지만, 뷰 배경색을 창 배경색과 같게 칠해 두므로
  // (createRepoView의 setBackgroundColor) 페인트 전 프레임도 흰색이 아니라 테마색이다 —
  // E13의 판정 기준(창이 드러날 때 흰 배경이 한 프레임도 안 보인다)을 배경색으로 만족한다.
  // E2E 숨김 규칙(E6a)과의 합성은 그대로: isE2E && !isE2EShow는 계속 숨긴 채로 둔다
  view.webContents.once('did-finish-load', () => {
    if (!isE2E || isE2EShow) window.show()
  })

  // 레지스트리 등록은 **여기서 동기적으로** 한다 (E15b). preload의 settings:get-sync가 이보다
  // 늦게 돌고(동기 IPC도 이 틱이 끝나야 처리된다), 그때 이 창의 layout 씨앗을 읽어야 새 창이
  // 열어준 창을 닮는다. repo:initial-path도 같은 이유로 여기 등록된 repoPath를 읽는다.
  // 키는 view.webContents.id — E15b의 sender.id 배선(git-handlers·terminal-handlers·settings)이
  // 전부 그대로 산다(sender가 곧 이 뷰의 webContents다)
  registry.add(view.webContents.id, { repoPath: seed.repoPath, layout: seed.layout })
  // closed 시점에는 webContents가 이미 파괴돼 id 접근이 안전하지 않다 — 미리 잡아 둔다
  const viewId = view.webContents.id
  windowOfView.set(viewId, window)
  window.on('closed', () => {
    registry.remove(viewId)
    windowOfView.delete(viewId)
    // 실측 (E15c): BrowserWindow와 달리 BaseWindow는 닫혀도 뷰의 webContents를 파괴하지
    // 않는다(닫은 뒤 getAllWebContents()에 1개 잔류·'destroyed' 미발화). 명시적으로 닫아야
    // git-handlers·terminal-handlers의 once('destroyed') 정리(감시·pty)가 돈다
    if (!view.webContents.isDestroyed()) view.webContents.close()
  })
  // 반대 방향도 (E15c 실측): webContents가 먼저 파괴돼도(Playwright page.close()의
  // Target.closeTarget, DOM window.close()) BaseWindow는 안 닫힌다 — BrowserWindow 시절엔
  // 자기 webContents 파괴가 곧 창 닫힘이었다. 빈 창이 남고 registry에서도 안 빠져,
  // 복원이 닫은 창을 되살린다(E2E «창 둘 중 하나만 닫고 종료» 2건이 여기서 빨갰다 —
  // 저장 목록에 [A,B]가 남아 복원이 2창을 만들었다). isDestroyed 가드가 상호 재귀를 끊는다
  view.webContents.once('destroyed', () => {
    if (!window.isDestroyed()) window.close()
  })

  // 전체화면에서는 신호등이 숨는다 — 헤더의 신호등 패딩을 접게 push (E7f 실측 2: CSS 신호 불가)
  window.on('enter-full-screen', () => {
    view.webContents.send(WINDOW_CHANNELS.fullScreen, true)
  })
  window.on('leave-full-screen', () => {
    view.webContents.send(WINDOW_CHANNELS.fullScreen, false)
  })

  // 창으로 돌아오면 재조회 — 감시가 못 잡은 잔여와 감시가 죽은 경우(watch error로 조용히 닫힘)를 메운다 (E10)
  window.on('focus', () => {
    view.webContents.send(WINDOW_CHANNELS.focused)
  })

  return { window, view }
}

/** 뷰 하나가 창 콘텐츠 전체를 덮는다 — 탭이 늘어도 이 함수는 그대로다(전부 전체 크기,
 * 보이는 것 하나) */
function fitViewToWindow(window: BaseWindow, view: WebContentsView): void {
  const { width, height } = window.getContentBounds()
  view.setBounds({ x: 0, y: 0, width, height })
}

// 플랜은 createRepoView(seed)였지만 Task 1에서는 씨앗을 쓸 곳이 없다(레지스트리 등록은
// createWindow가 한다) — 안 쓰는 매개변수는 lint에 걸리므로 탭별 씨앗이 생기는 태스크에서 더한다
function createRepoView(): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 숨김 창의 타이머·rAF 스로틀로 E2E 대기가 길어지지 않게 — E2E에서만 해제
      backgroundThrottling: !isE2E,
    },
  })
  // E13 — 뷰의 배킹은 기본 흰색이다: 창 backgroundColor 위를 뷰가 덮으므로, 뷰에도 같은
  // 테마색을 칠해야 첫 페인트 전에 흰 프레임이 안 보인다 (위 did-finish-load 주석 참조)
  view.setBackgroundColor(resolveBackgroundColor())
  // 이 뷰는 preload로 git 조작 API를 갖는 특권 표면이다 — 외부 네비게이션과 새 창을 차단한다
  // (파일 드래그&드롭의 file:// 네비게이션 같은 기본 동작도 여기서 막힌다)
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.on('will-navigate', (event) => event.preventDefault())

  // 패키징된 앱에서는 env로 임의 URL을 주입할 수 없어야 한다
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void view.webContents.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void view.webContents.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return view
}

/** 새 창은 열어준 창의 레이아웃을 씨앗으로 받는다 (사용자 결정). 그 창이 없으면 빈 레이아웃 —
 * 렌더러가 기본값을 쓴다 */
function seedLayoutFrom(openerId: number): WindowLayout {
  return { ...(registry.get(openerId)?.layout ?? {}) }
}

/** 새 창에서 연다 (E15b). 창을 만드는 것은 index.ts 책임이라 이 핸들러만 여기 있다 */
function registerWindowHandlers(): void {
  ipcMain.handle(
    WINDOW_CHANNELS.open,
    async (event, repoPath: unknown): Promise<WindowOpenResult> => {
      if (repoPath === null) {
        createWindow({ repoPath: null, layout: seedLayoutFrom(event.sender.id) })
        return { ok: true }
      }
      // 인자는 디스크 설정에서 온 렌더러 입력이라 repo.open과 **같은 검증**을 거친다 — 검증 없이
      // 씨앗으로 넣으면 그 창이 임의 디렉터리에서 git을 돌리는 통로가 된다
      const opened = await openRepoPath(assertAbsoluteRepoPath(repoPath))
      // 열기 실패는 예외가 아니다 (E15b 리뷰 I-2) — reason을 그대로 흘려보내야 렌더러가
      // E15a의 목록 제거 정책(reason !== 'failed')을 이 진입점에서도 쓸 수 있다.
      // 예전엔 여기서 throw했고 렌더러가 void로 버려 배너도 목록 정리도 없었다
      if (!opened.ok) return opened
      // 이미 그 저장소를 연 창이 있으면 새로 만들지 않고 앞으로 가져온다 (사용자 결정)
      const existing = registry.findByRepoPath(opened.path)
      if (existing !== undefined) {
        // BaseWindow에는 webContents가 없어 getAllWindows().find(webContents.id)가 불가능하다 —
        // 뷰 id → 창 역방향 맵으로 찾는다 (E15c)
        const found = windowOfView.get(existing)
        found?.show()
        found?.focus()
        return { ok: true }
      }
      createWindow({ repoPath: opened.path, layout: seedLayoutFrom(event.sender.id) })
      return { ok: true }
    },
  )
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
    // 종료 직전의 스냅샷을 남긴다 (E15b). ⌘Q(app.quit)는 before-quit → 창 닫기 순서라 이
    // 시점의 레지스트리에 창들이 아직 다 있다 (실측: Playwright의 app.close()도 main에서
    // app.quit()을 부르므로 그대로 발화한다).
    //
    // 이제 여기는 **유일한 영속 지점이 아니라 마지막 한 번**이다 (E15b 리뷰 I-1) — 디바운스가
    // 아직 안 터진 레이아웃까지 확실히 담기게 한다. 창을 하나씩 다 닫고 종료해 목록이 비면
    // saveWindows가 무시하므로 디스크의 마지막 목록이 그대로 남는다(그 함수의 주석 참조)
    app.on('before-quit', () => {
      persistLayout.dispose()
      saveWindows(registry.snapshot())
      // 여기서부터 목록을 얼린다 — 뒤이어 창들이 하나씩 닫히는 것은 사용자의 조작이 아니다
      quitting = true
    })
    app.on('activate', () => {
      if (BaseWindow.getAllWindows().length === 0) createWindow()
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
