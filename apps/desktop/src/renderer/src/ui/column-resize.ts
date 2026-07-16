export const RIGHT_COLUMN_DEFAULT = 360

/** 우측 열 폭 제한 — 최소 260px(내용 붕괴 방지), 최대 뷰포트 45%(중앙 diff 생존) */
export function clampRightWidth(px: number, viewportWidth: number): number {
  const max = Math.max(260, Math.floor(viewportWidth * 0.45))
  return Math.min(Math.max(Math.round(px), 260), max)
}

/** 저장값 → 폭. 깨진 값은 조용히 기본값으로 (드래그로 다시 정하면 된다) */
export function parseStoredWidth(raw: unknown): number {
  const parsed = Number(raw)
  if (raw == null || !Number.isFinite(parsed) || parsed < 260) return RIGHT_COLUMN_DEFAULT
  return Math.round(parsed)
}

export function loadRightWidth(): number {
  return parseStoredWidth(window.settingsApi.initial.rightWidth)
}

export function saveRightWidth(px: number): void {
  void window.settingsApi.set({ rightWidth: px })
}

export function resetRightWidth(): void {
  void window.settingsApi.set({ rightWidth: RIGHT_COLUMN_DEFAULT })
}
