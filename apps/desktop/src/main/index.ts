import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerGitHandlers } from './git-handlers'

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
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

app
  .whenReady()
  .then(() => {
    registerGitHandlers()
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
