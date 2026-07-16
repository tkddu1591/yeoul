import { app, ipcMain } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { sanitizeSettings, SETTINGS_CHANNELS, type AppSettings } from '@git-gui/ipc-contract'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): AppSettings {
  try {
    return sanitizeSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    // 첫 실행·깨진 파일 — 빈 설정에서 시작한다 (설정은 전부 선택적)
    return {}
  }
}

export function registerSettingsHandlers(): void {
  let settings = loadSettings()
  ipcMain.on(SETTINGS_CHANNELS.getSync, (event) => {
    event.returnValue = settings
  })
  ipcMain.handle(SETTINGS_CHANNELS.set, (_event, partial: unknown) => {
    settings = { ...settings, ...sanitizeSettings(partial) }
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(settingsPath(), JSON.stringify(settings))
  })
}
