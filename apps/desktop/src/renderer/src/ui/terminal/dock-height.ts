export const DOCK_HEIGHT_DEFAULT = 240
export const DOCK_HEIGHT_MIN = 120

/** 도크 높이 제한 — 최소 120px, 최대 뷰포트 60%(중앙 diff·우측 역사 생존 — 스펙) */
export function clampDockHeight(px: number, viewportHeight: number): number {
  const max = Math.max(DOCK_HEIGHT_MIN, Math.floor(viewportHeight * 0.6))
  return Math.min(Math.max(Math.round(px), DOCK_HEIGHT_MIN), max)
}

/** 저장값 → 높이. 깨진 값은 조용히 기본값으로 (column-resize 관례) */
export function parseStoredDockHeight(raw: unknown): number {
  const parsed = Number(raw)
  if (raw == null || !Number.isFinite(parsed) || parsed < DOCK_HEIGHT_MIN) {
    return DOCK_HEIGHT_DEFAULT
  }
  return Math.round(parsed)
}

export function loadDockHeight(): number {
  return parseStoredDockHeight(window.settingsApi.initial.terminalHeight)
}

export function saveDockHeight(px: number): void {
  void window.settingsApi.set({ terminalHeight: px })
}

export function loadDockOpen(): boolean {
  return window.settingsApi.initial.terminalOpen === true
}

export function saveDockOpen(open: boolean): void {
  void window.settingsApi.set({ terminalOpen: open })
}
