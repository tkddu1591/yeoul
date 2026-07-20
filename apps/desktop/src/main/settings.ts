import { app, ipcMain, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  sanitizePersistedSettings,
  sanitizeSettings,
  SETTINGS_CHANNELS,
  type PersistedSettings,
} from '@git-gui/ipc-contract'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

function loadSettings(): PersistedSettings {
  try {
    return sanitizePersistedSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    // 첫 실행·깨진 파일 — 빈 설정에서 시작한다 (설정은 전부 선택적)
    return {}
  }
}

// renderer 설정과 토큰 저장(hosting-handlers)이 같은 파일을 쓴다 — 모듈 상태로 일원화한다
let settings: PersistedSettings | null = null

function current(): PersistedSettings {
  settings ??= loadSettings()
  return settings
}

function save(next: PersistedSettings): void {
  settings = next
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(settingsPath(), JSON.stringify(next))
}

export function registerSettingsHandlers(): void {
  ipcMain.on(SETTINGS_CHANNELS.getSync, (event) => {
    // renderer 표면 필드만 추린다 — hosting(토큰)은 renderer로 절대 보내지 않는다
    event.returnValue = sanitizeSettings(current())
  })
  ipcMain.handle(SETTINGS_CHANNELS.set, (_event, partial: unknown) => {
    // renderer 입력도 표면 sanitize만 병합한다 — renderer가 hosting(토큰)을 쓸 수 없다
    save({ ...current(), ...sanitizeSettings(partial) })
  })
}

/** GitHub 토큰 복호화 — safeStorage 불가·복호화 실패는 "토큰 없음"으로 취급한다 (재연결 안내는 UI 몫) */
export function readGitHubToken(): string | null {
  const stored = current().hosting?.github?.token
  if (stored === undefined || !safeStorage.isEncryptionAvailable()) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null
  }
}

/** 연결 시 함께 저장해 둔 계정 이름 — status 조회가 네트워크 없이 응답하게 한다 */
export function readGitHubLogin(): string | null {
  return current().hosting?.github?.login ?? null
}

export function saveGitHubConnection(token: string, login: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('이 컴퓨터에서는 토큰을 안전하게 저장할 수 없어요.')
  }
  const encrypted = safeStorage.encryptString(token).toString('base64')
  save({ ...current(), hosting: { github: { token: encrypted, login } } })
}

export function clearGitHubConnection(): void {
  const { hosting: _hosting, ...rest } = current()
  save(rest)
}
