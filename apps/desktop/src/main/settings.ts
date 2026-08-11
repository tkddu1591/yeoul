import { app, ipcMain, safeStorage } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  sanitizePersistedSettings,
  sanitizeSettings,
  SETTINGS_CHANNELS,
  splitSettings,
  type PersistedSettings,
  type PersistedWindow,
} from '@git-gui/ipc-contract'
import type { WindowRegistry } from './window-registry'

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

/** 저장된 테마 — 부팅 창 배경색 결정에 쓴다(index.ts, E13 흰 화면 제거). GitHub 토큰과 달리
 * 이미 renderer 표면 필드라(sanitizeSettings 대상) 노출 범위를 넓히는 게 아니다 — theme 하나만
 * 돌려주는 가장 좁은 형태로 export한다 */
export function readTheme(): 'light' | 'dark' | undefined {
  return current().theme
}

/**
 * 마지막 종료 시점의 창들 (E15b 복원) — renderer 표면이 아니라 별도 export다.
 * `settings:get-sync`가 쓰는 sanitizeSettings는 이 필드를 걷어내므로 렌더러로 새지 않는다
 */
export function readWindows(): PersistedWindow[] {
  return current().windows ?? []
}

/**
 * 창 목록을 디스크에 남긴다 — **빈 목록은 무시한다** (E15b 리뷰 I-1).
 *
 * 왜 무시하나: 종료 경로가 플랫폼마다 다른데 **빈 목록은 그 차이의 산물일 뿐 사용자의 뜻이
 * 아니다.** macOS ⌘Q는 `before-quit` → 창 닫기 순서라 그 시점 레지스트리에 창들이 남아 있지만,
 * Windows/Linux는 마지막 창의 X가 `closed`(→`remove`) → `window-all-closed` → `app.quit()` →
 * `before-quit` 순서라 **정상 종료가 항상 빈 목록**이다(index.ts:244). 그대로 저장하면 그
 * 플랫폼에서는 복원도 레이아웃 기억도 영영 죽는다(실측: `settings-after-close-then-quit={"windows":[]}` ·
 * `left-visible-after-restart=true`).
 *
 * "닫은 창은 다음에 안 뜬다"와 충돌하지 않는다 — **여럿 중 하나**를 닫으면 목록이 안 비므로
 * 그 창은 그대로 빠진다. 충돌은 "전부 닫고 종료"에서만 생기는데, 그건 위 순서 때문에 정상
 * 종료와 구분할 방법이 없다
 */
export function saveWindows(list: PersistedWindow[]): void {
  if (list.length === 0) return
  save({ ...current(), windows: list })
}

export function registerSettingsHandlers(registry: WindowRegistry): void {
  ipcMain.on(SETTINGS_CHANNELS.getSync, (event) => {
    // renderer 표면 필드만 추린다 — hosting(토큰)은 renderer로 절대 보내지 않는다.
    // 거기에 **이 창의** 레이아웃을 얹어 평평하게 돌려준다 (E15b) — 렌더러는 분리를 모른다.
    // 레지스트리 등록이 new BrowserWindow 직후 동기적으로 일어나므로 여기서 이미 있다
    const layout = registry.get(event.sender.id)?.layout ?? {}
    event.returnValue = { ...sanitizeSettings(current()), ...layout }
  })
  ipcMain.handle(SETTINGS_CHANNELS.set, (event, partial: unknown) => {
    // 성격에 따라 갈라 보낸다 — 앱 공용은 파일에, 창별은 그 창의 레지스트리 항목에 (E15b).
    // renderer 입력도 표면 sanitize만 병합한다 — renderer가 hosting(토큰)을 쓸 수 없다
    const { app: appPart, layout } = splitSettings(partial)
    // 빈 객체면 건너뛴다 — 창별 필드만 담긴 set이 앱 설정 파일을 매번 다시 쓰면 디스크 쓰기가
    // 무의미하게 는다(도크 높이 드래그는 초당 여러 번 온다)
    if (Object.keys(appPart).length > 0) save({ ...current(), ...appPart })
    if (Object.keys(layout).length > 0) registry.setLayout(event.sender.id, layout)
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
