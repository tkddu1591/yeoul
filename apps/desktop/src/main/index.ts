import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WINDOW_CHANNELS } from '@git-gui/ipc-contract'
import { registerGitHandlers } from './git-handlers'
import { registerHostingHandlers } from './hosting-handlers'
import { registerSettingsHandlers } from './settings'
import { registerTerminalHandlers } from './terminal-handlers'

// 앱 이름 (E7f) — 창 전환 UI·일부 메뉴에 반영. dev 메뉴바는 "Electron" 고정(Info.plist — 실측 6),
// 패키징 산출물(electron-builder productName)에서 완전히 "Git GUI"가 된다
app.setName('Git GUI')

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

function createWindow(): void {
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
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 숨김 창의 타이머·rAF 스로틀로 E2E 대기가 길어지지 않게 — E2E에서만 해제
      backgroundThrottling: !isE2E,
    },
  })

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
  window.webContents.on('will-navigate', (event) => event.preventDefault())

  // 패키징된 앱에서는 env로 임의 URL을 주입할 수 없어야 한다
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// macOS에서는 앱 실행 자체가 활성화되며 포커스를 훔칠 수 있다 — E2E에서는 dock 아이콘째 숨긴다
if (isE2E && !isE2EShow) app.dock?.hide()

app
  .whenReady()
  .then(() => {
    registerGitHandlers()
    registerSettingsHandlers()
    registerHostingHandlers()
    registerTerminalHandlers()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
  .catch((error) => {
    console.error('앱 초기화 실패:', error)
    app.quit()
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
